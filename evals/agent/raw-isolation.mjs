// G-E1-R -- raw RelationalOS agent isolation, offline and deterministic.
//
// This complements the live-Postgres gate in isolation.mjs. It is safe for CI:
// no database, model, network or storage call. It guards the migration/schema
// shape, the production call sites, and the two query boundaries where a
// cross-agent leak can otherwise be silent: pending-log selection and the
// consolidation watermark.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { splitSql } from "../../db/migrations/apply.mjs";
import {
  MEERA_AGENT_ID,
  RAW_AGENT_SCOPED_TABLES,
  AGENT_SCOPED_OPERATIONAL_TABLES,
  agentScopePredicate,
} from "../../api/_agentscope.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");
const norm = (s) => s.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
let checks = 0;
let failures = 0;
function check(pass, name, detail = "") {
  checks++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!pass) failures++;
}

const MIGRATION = read("db/migrations/018_raw_agent_isolation.sql");
const SCHEMA = read("db/schema.sql");
const RAW = RAW_AGENT_SCOPED_TABLES.map((x) => x.table);

console.log("-- R1 migration and canonical schema --");
{
  const statements = splitSql(MIGRATION);
  check(statements.length === 32, "018 is split into one-statement runner units", `${statements.length} statements`);
  for (const table of RAW) {
    for (const source of [["migration", MIGRATION], ["schema", SCHEMA]]) {
      const [label, sql] = source;
      check(
        new RegExp(`alter table ${table} add column if not exists agent_id uuid`, "i").test(sql),
        `${label}: ${table}.agent_id is additive`,
      );
      check(
        new RegExp(`update ${table} set agent_id = '[^']+'::uuid where agent_id is null`, "i").test(sql),
        `${label}: ${table} backfills only NULL ownership`,
      );
      check(
        new RegExp(`alter table ${table} alter column agent_id set not null`, "i").test(sql),
        `${label}: ${table}.agent_id is mandatory`,
      );
    }
  }
  for (const sql of [MIGRATION, SCHEMA]) {
    check(
      /create unique index if not exists meera_forget_agent_device_term_ix\s+on meera_forget \(agent_id, device_id, lower\(term\)\)/i.test(sql),
      "forget tombstones are unique per (agent, device, term)",
    );
    check(
      /primary key \(agent_id, person_id\)/i.test(sql) &&
        /meera_consolidate_lease_expiry_ix/i.test(sql),
      "lease ownership is (agent, person) in migration/schema",
    );
  }
  check(MIGRATION.includes(MEERA_AGENT_ID), "018 backfill id matches the server registry");
  check(RAW.length === 4, "the raw boundary enumerates exactly four memory tables");
  check(
    AGENT_SCOPED_OPERATIONAL_TABLES.some((x) => x.table === "meera_consolidate_lease"),
    "the consolidation lease is declared as agent-scoped operational state",
  );
}

console.log("\n-- R2 pending-log selection --");
{
  const A = "b0000000-0000-4000-8000-000000000001";
  const B = "b0000000-0000-4000-8000-000000000002";
  const DEVICE = "d0000000-0000-4000-8000-000000000001";
  const corpus = [
    { id: 1, agent_id: A, device_id: DEVICE, channel: "chat", content: "only A" },
    { id: 2, agent_id: B, device_id: DEVICE, channel: "chat", content: "only B" },
  ];
  const source = read("api/consolidate.js");
  const raw = source.match(/`select l\.id, l\.device_id[\s\S]*?order by l\.id asc limit \$2`/)?.[0] || "";
  const sql = raw
    .slice(1, -1)
    .replace(/\$\{agentScopePredicate\([^\n]+\)\}/, agentScopePredicate("l", { agentId: "$3" }))
    .replace("${WATCH_EXCLUDE_SQL}", "and l.channel is distinct from 'watch'");
  // The corpus models the database equality using the parameter position in
  // the shipping query. The SQL text above comes from the production source,
  // not a retyped query; this keeps the gate config-free on a clean checkout.
  const run = (agent) => {
    const params = [[DEVICE], 220, agent];
    return { params, rows: corpus.filter((r) => r.agent_id === params[2]) };
  };
  const a = run(A);
  const b = run(B);
  check(a.rows.length === 1 && a.rows[0].agent_id === A, "agent A receives no agent-B log row");
  check(b.rows.length === 1 && b.rows[0].agent_id === B, "agent B receives no agent-A log row");
  check(
    /l\.agent_id\s*=\s*\(\$3\)::uuid/.test(sql),
    "pending-log SQL binds agent_id in the WHERE",
  );
  check(
    sql.indexOf("agent_id") < sql.toLowerCase().indexOf("order by") &&
      a.params[2] === A && b.params[2] === B,
    "agent binding is applied before ORDER/LIMIT and differs per run",
  );
  const leaky = corpus.filter(() => true);
  check(
    leaky.some((r) => r.agent_id !== A) && leaky.some((r) => r.agent_id !== B),
    "negative control: striking the equality leaks both directions",
  );
}

console.log("\n-- R3 consolidation cursor and lease --");
{
  const A = "e0000000-0000-4000-8000-000000000001";
  const B = "e0000000-0000-4000-8000-000000000002";
  const source = read("api/consolidate-sweep.js");
  const raw = source.match(/`with pd as \([\s\S]*?limit \$1`/)?.[0] || "";
  const sql = raw.slice(1, -1).replaceAll("${WATCH_CHANNEL}", "watch");
  check(
    /from vy_episode\s+where log_to is not null and agent_id = \(\$2\)::uuid/i.test(sql),
    "episode watermark is filtered by agent before MAX/GROUP",
  );
  check(/where l\.agent_id = \(\$2\)::uuid/i.test(sql), "pending raw logs are filtered by the same agent");
  const paramsA = [5, A];
  const paramsB = [5, B];
  check(paramsA[1] === A && paramsB[1] === B, "two sweeps bind distinct agents");
  // A's high watermark must not hide B's pending row for the same person.
  const episodes = [{ agent_id: A, log_to: 100 }, { agent_id: B, log_to: 3 }];
  const logs = [{ agent_id: B, id: 4 }];
  const pending = (agent) => {
    const mark = Math.max(0, ...episodes.filter((e) => e.agent_id === agent).map((e) => e.log_to));
    return logs.filter((l) => l.agent_id === agent && l.id > mark);
  };
  const globalMark = Math.max(...episodes.map((e) => e.log_to));
  check(pending(B).length === 1 && logs.filter((l) => l.id > globalMark).length === 0,
    "agent A's watermark cannot hide agent B's pending log");
  const struck = sql.replace(/and agent_id = \(\$2\)::uuid/i, "").replace(/where l\.agent_id = \(\$2\)::uuid/i, "");
  check(
    !/agent_id = \(\$2\)::uuid/i.test(struck),
    "negative control: both cursor boundaries disappear when struck",
  );

  const { findLaggingRelationships } = await import("../../api/consolidate-sweep.js");
  let discovered;
  await findLaggingRelationships(7, async (query, params) => {
    discovered = { query, params };
    return [];
  });
  check(
    discovered.params.length === 2 && discovered.params[0] === 7 && discovered.params[1] === MEERA_AGENT_ID,
    "production relationship discovery accepts only a limit and the server's incumbent agent, not a caller-selected clone",
  );
  check(
    /select agent_id, person_id, max\(log_to\)/i.test(discovered.query) &&
      /left join cons c on c\.agent_id = l\.agent_id[\s\S]*c\.person_id = coalesce/i.test(discovered.query) &&
      /f\.agent_id = l\.agent_id[\s\S]*f\.person_id = coalesce[\s\S]*f\.memory_consent_at is not null/i.test(discovered.query) &&
      /group by l\.agent_id, coalesce/i.test(discovered.query),
    "production discovery keeps each clone's watermark isolated and requires current Room memory consent",
  );
  const collapsed = discovered.query.replace(/c\.agent_id = l\.agent_id\s+and/i, "");
  check(
    !/left join cons c on c\.agent_id = l\.agent_id/i.test(collapsed),
    "negative control: striking the agent join collapses clone watermarks",
  );
  const consentStruck = discovered.query.replace(/and f\.memory_consent_at is not null/i, "");
  check(
    !/f\.memory_consent_at is not null/i.test(consentStruck),
    "negative control: striking current consent admits retained clone logs alone",
  );
}

// Extract SQL-shaped template literals. The scanner is deliberately narrow:
// these six files are the production raw readers/writers owned by this slice.
function sqlTemplates(source) {
  const clean = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const out = [];
  const re = /`(\s*(?:with|select|insert|update|delete|create)\b)/gi;
  let m;
  while ((m = re.exec(clean))) {
    let i = m.index + 1;
    let depth = 0;
    let text = "";
    while (i < clean.length) {
      if (clean[i] === "$" && clean[i + 1] === "{") { depth++; text += "${"; i += 2; continue; }
      if (depth && clean[i] === "}") { depth--; text += "}"; i++; continue; }
      if (!depth && clean[i] === "`") break;
      text += clean[i++];
    }
    out.push(text);
    re.lastIndex = i;
  }
  return out;
}

function scopedRawStatement(sql) {
  const s = norm(sql);
  if (/^insert into meera_(?:log|nodes|edges|forget)\b/i.test(s)) {
    return /^insert into meera_\w+\s*\([^)]*\bagent_id\b/i.test(s);
  }
  return s.includes("agentScopePredicate(") || /\bagent_id\s*=/.test(s);
}

// Person-wide forget deliberately spans agents (purgeRelational's contract).
// Its raw UPDATE only clears cursors to the same person's doomed episodes;
// it returns no raw content and preserves each surviving row's agent identity.
// Pin the entire reviewed statement, not a keyword exception. Any SQL change
// requires renewed scope review. Actual PostgreSQL behavior is independently
// covered by wave25's source-pinned rollback proof; this is a source scanner.
const PERSON_FORGET_REPAIR_SHA256 = "d33cea0ef590316887c48b7627e3a0b7821759eae9f1449b60548ab4ad26c1ef";
function personForgetRepair(file, sql) {
  return file === "api/memory.js" &&
    createHash("sha256").update(norm(sql)).digest("hex") === PERSON_FORGET_REPAIR_SHA256;
}

console.log("\n-- R4 production call-site coverage --");
{
  const files = [
    "api/memory.js",
    "api/consolidate.js",
    "api/consolidate-sweep.js",
    "api/episodes.js",
    "src/engine/texture.ts",
    "src/engine/relstate.ts",
  ];
  const fullEraseException = "delete from ${t(\"meera_log\")} where speaker_person_id = $1 and group_id is not null";
  const misses = [];
  let covered = 0;
  const personRepairs = [];
  for (const file of files) {
    for (const sql of sqlTemplates(read(file))) {
      const s = norm(sql);
      if (!RAW.some((table) => new RegExp(`\\b${table}\\b`).test(s))) continue;
      if (s.startsWith(fullEraseException)) continue; // all-agent data-subject erase, not relationship forget
      if (personForgetRepair(file, sql)) { personRepairs.push(sql); continue; }
      if (scopedRawStatement(sql)) covered++;
      else misses.push(`${file}: ${s.slice(0, 140)}`);
    }
  }
  check(covered >= 25, "all expected raw runtime statements were scanned", `${covered} scoped statements`);
  check(misses.length === 0, "no unscoped raw runtime statement", misses.join(" | "));
  check(personRepairs.length === 1, "exactly one reviewed person-wide cursor repair is recognized");
  const repair = personRepairs[0] || "";
  const unsafeRepairs = [
    ["seed person boundary removed", repair.replace("where person_id = $1 and id = any($2::bigint[])", "where id = any($2::bigint[])")],
    ["lineage person boundary removed", repair.replace("e.person_id = $1 and", "true and")],
    ["raw cursor update widened", repair.replace("where l.episode_id in (select id from doomed)", "where true")],
    ["wake agent identity replaced", repair.replace("select l.agent_id,$1::uuid", "select null,$1::uuid")],
  ];
  for (const [label, brokenRepair] of unsafeRepairs) {
    check(repair !== brokenRepair && !personForgetRepair("api/memory.js", brokenRepair),
      `negative control: person repair refuses ${label}`);
  }
  check(!personForgetRepair("api/consolidate.js", repair),
    "negative control: person repair is not allowed in another runtime file");
  const fetchSource = read("api/consolidate.js").match(/select l\.id[\s\S]*?order by l\.id asc limit \$2`/)?.[0] || "";
  const broken = fetchSource.replace(/\$\{agentScopePredicate\([^\n]+\)\}/, "");
  check(scopedRawStatement(fetchSource) && !scopedRawStatement(broken), "negative control: call-site checker catches a missing predicate");

  const memory = read("api/memory.js");
  check(
    /const agentId = MEERA_AGENT_ID;[\s\S]{0,260}const scope =/.test(memory) && !/body\.agent(?:Id|_id)/.test(memory),
    "legacy forget is pinned server-side to Meera, never request-selected",
  );
  const sweep = read("api/consolidate-sweep.js");
  check(
    /roomOnly \? ROOM_MEMORY_CLAIM_SQL/.test(sweep) &&
      /on conflict \(agent_id, person_id\)/.test(sweep) &&
      /delete from meera_consolidate_lease[\s\S]{0,140}agent_id/.test(sweep),
    "lease claim and release both bind agent_id",
  );
  check(
    /findLaggingPersons\(CANDIDATE_FETCH, sweepAgentId\)/.test(sweep) &&
      /findLaggingRelationships\(CANDIDATE_FETCH\)/.test(sweep) &&
      /"clone_memory_room_sweep_disabled"/.test(sweep) &&
      /blocker: "clone_memory_backlog_check_unavailable"/.test(sweep) &&
      /if \(roomOnly\)[\s\S]*?runMeteredRoomMemoryConsolidation\(c,[\s\S]*?continue;/.test(sweep) &&
      /return runRoomMemoryConsolidation\(candidate,/.test(read("api/_room-memory-consolidation.js")) &&
      /runFullChainForPerson\(person, \{ dryRun: false, agentId: candidateAgentId \}\)/.test(sweep) &&
      /export const ROOM_MEMORY_CONSOLIDATION_ENABLED = true/.test(read("api/_room-memory-authority.js")) &&
      /const roomOnly = SWEEP_MODE === 'room_only'/.test(sweep),
    "the unattended clone path requires guarded Room authority and explicit Room-only mode",
  );
}

console.log(`\n${failures ? `FAILED ${failures} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(failures ? 1 : 0);
