// GATE G-E1 — agent isolation (SPEC-AGENT-LAYER §7). THIS GATE BLOCKS THE
// AGENT LAYER. A single cross-agent row is a build failure, not a statistic,
// for the same reason evals/mp/gate0.mjs treats one ACL violation that way:
// Law E1 is the promise that what Meera learned about you is not available to
// any other AI person on this stack, and a promise with a failure rate is a
// setting, not a law.
//
//   node evals/agent/isolation.mjs            → build, assert, tear down, prove residue
//   node evals/agent/isolation.mjs --keep     → leave the fixture schema up for probing
//   node evals/agent/isolation.mjs --cleanup  → drop the fixture schema and exit
//
// NOT wired into evals/run.mjs, for gate0's stated reason: every suite in that
// runner is db-free (it runs in a workflow with no NEON_URL) and this one is
// not. It runs the REAL predicate against the REAL Postgres, because the
// failure modes that matter here are engine semantics — `agent_id = null`
// yielding NULL rather than TRUE, a NOT NULL column with a DEFAULT quietly
// filling a value an INSERT never named, an ON CONFLICT arbiter that does or
// does not resolve against a composite primary key. A JavaScript
// re-implementation of the predicate would pass this gate and ship a different
// predicate.
//
// ── the four arms ──────────────────────────────────────────────────────────
//
//   1. TRANSITIONAL STATE  — what 009's shape actually permits today, measured
//      rather than assumed: an INSERT that names no agent_id silently lands
//      under Meera, and a SECOND AGENT CANNOT EXIST for the four re-keyed
//      tables because of the `*_person_compat_ix` shims. This arm is what makes
//      db/migrations/010_agent_strict.sql a proven necessity rather than a
//      plan.
//   2. MIGRATION 010      — applied twice to the FIXTURE namespace (never to
//      production), then both facts from arm 1 re-measured: the silent insert
//      now fails loudly, and the second agent can exist.
//   3. THE PREDICATE      — api/_agentscope.js's shipping clause text, in the
//      WHERE of a batched cross join of every (agent, person) scenario against
//      every row of every agent-scoped table. 0 cross-agent rows required, with
//      a negative control that strikes the clause and must leak.
//   4. THE CALL SITES     — a static coverage arm over api/memory.js and
//      api/consolidate.js. Arm 3 proves the predicate; nothing in arm 3 proves
//      that retrieval USES it. This arm asserts that every SQL statement in
//      those two files touching an agent-scoped table is either scoped by the
//      predicate, an INSERT naming agent_id, or a DECLARED forget-lane
//      exception — and that the declared exception set is exactly the set that
//      exists, so a stale allowlist entry fails just as loudly as a new
//      unscoped statement.
//
// Arm 4's honest limit, stated rather than implied: it reads source text, not
// behaviour. It cannot execute api/memory.js's retrieval (those functions are
// not exported and the consolidation path needs a model and real money), so
// coverage is proven statically and the clause itself is proven dynamically.
// Its scanner strips full-line comments and then extracts template literals
// that begin with a SQL verb; a backticked SQL fragment hidden inside a
// trailing same-line comment that also names an agent-scoped table would be
// misread as a statement. No such case exists today and one would fail LOUD
// (an unexpected unscoped statement), never silent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import {
  agentScopePredicate,
  agentValue,
  AGENT_SCOPED_TABLES,
  MEERA_AGENT_ID,
} from "../../api/_agentscope.js";
import {
  PREFIX, TAG, A1, A2, AGENTS, PERSONS, FIXTURE_TABLES,
  ns, T, teardown, proveNoResidue, buildSchema, seed, lit,
} from "./harness.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const say = (s) => console.log(s);
const okmark = (b) => (b ? "  ok" : "FAIL");

let failures = [];
const check = (name, pass, detail = "") => {
  say(`  ${okmark(pass)}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!pass) failures.push(name);
};

if (CLEANUP_ONLY) {
  const n = await teardown();
  const res = await proveNoResidue();
  say(`dropped ${n} fixture relation(s); residue: ${JSON.stringify(res)}`);
  process.exit(res.relations.length || res.productionRows.length ? 1 : 0);
}

const t0 = Date.now();

// ── 0. the mirrored constant ───────────────────────────────────────────────
//
// api/_agentscope.js is the FOURTH copy of Meera's agent id and the one
// scripts/verify-agent-id.mjs does not know about (that script belongs to
// WS-AGENT-SCHEMA and is not this workstream's to edit). A copied constant
// drifts unless something fails a gate when it does; this is that something for
// this copy. What drift costs is not an error — rows written under one uuid and
// read under another, looking exactly like "she doesn't remember me".
say("── 0. mirrored constant ──");
{
  const migSrc = readFileSync(join(ROOT, "db/migrations/009_agents.sql"), "utf8");
  const ids = [
    ...new Set((migSrc.match(/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/g) ?? []).map((s) => s.toLowerCase())),
  ];
  check(
    "api/_agentscope.js MEERA_AGENT_ID matches db/migrations/009_agents.sql",
    ids.length === 1 && ids[0] === MEERA_AGENT_ID,
    `(009: ${ids.join(", ") || "none"}; _agentscope: ${MEERA_AGENT_ID})`,
  );
  check(
    "§2's twenty agent-scoped tables are all declared",
    AGENT_SCOPED_TABLES.length === 20 && FIXTURE_TABLES.length === 20,
    `(${AGENT_SCOPED_TABLES.length} declared, ${FIXTURE_TABLES.length} in the fixture)`,
  );
}

// ── 1. build the fixture schema from the REAL DDL ──────────────────────────
say("\n── 1. building the fixture schema from db/schema.sql ──");
await teardown();
const built = await buildSchema();
say(`  ok  ${built.applied} statements applied to the ${PREFIX}* namespace (pre-010 shape: DEFAULT live, compat indexes present)`);

// ── 2. the transitional state, measured ────────────────────────────────────
say("\n── 2. what 009's shape permits today (the reason 010 exists) ──");
const SCRATCH = "a9e27002-0000-4000-8000-0000000000ff";
// api/_db.js raises `neon <status>` and deliberately does not carry the body,
// so a SQLSTATE is not available to assert on. Every claim below is therefore
// made from OUTCOME plus CATALOG state — did the statement fail, and is the
// constraint/default that would explain it actually there — which is a stronger
// pair than a string match on an error message anyway.
const failed = async (sql) => {
  try {
    await q(sql, [], 30_000);
    return false;
  } catch {
    return true;
  }
};
const indexExists = async (name) => {
  const [r] = await q(`select count(*)::int n from pg_indexes where indexname = $1`, [ns(name)]);
  return Number(r.n) > 0;
};
const columnDefault = async (table, col) => {
  const [r] = await q(
    `select column_default from information_schema.columns
      where table_name = $1 and column_name = $2`,
    [T(table), col],
  );
  return r?.column_default ?? null;
};

// (a) a writer that never heard of agents files rows under Meera, silently.
await q(
  `insert into ${T("vy_derivation")} (person_id, model, prompt_hash, input_from, input_to, wrote)
   values (${lit(SCRATCH)}::uuid, ${lit(`${TAG}no-agent-column`)}, 'fixture', 1, 2, '[]'::jsonb)`,
);
const [defRow] = await q(
  `select agent_id::text as a from ${T("vy_derivation")} where person_id = ${lit(SCRATCH)}::uuid`,
);
const defaultsToMeera = defRow?.a === MEERA_AGENT_ID;
check(
  "PRE-010: an INSERT naming no agent_id silently lands under Meera (the DEFAULT)",
  defaultsToMeera,
  `(got ${defRow?.a})`,
);

// (b) the compat index makes a second agent impossible on the four re-keyed
//     tables. This is the finding that turns 010 from housekeeping into a
//     precondition for the whole phase.
await q(
  `insert into ${T("vy_rel_state")} (agent_id, person_id, honorific)
   values (${lit(A1)}::uuid, ${lit(SCRATCH)}::uuid, 'tum')`,
);
const preBlocked = await failed(
  `insert into ${T("vy_rel_state")} (agent_id, person_id, honorific)
   values (${lit(A2)}::uuid, ${lit(SCRATCH)}::uuid, 'tum')`,
);
const COMPAT = ["vy_rel_state", "vy_ritual", "vy_currency", "vy_india_profile"].map(
  (t) => `${t}_person_compat_ix`,
);
const preCompat = [];
for (const ix of COMPAT) if (await indexExists(ix)) preCompat.push(ix);
check(
  "PRE-010: a SECOND agent cannot hold rel_state for a person the first knows",
  preBlocked && preCompat.length === 4,
  `(insert rejected: ${preBlocked}; compat indexes present: ${preCompat.length}/4)`,
);

// ── 3. migration 010, applied to the FIXTURE namespace only ────────────────
say("\n── 3. db/migrations/010_agent_strict.sql, applied to the fixture (never to production) ──");
const mig010 = splitSql(readFileSync(join(ROOT, "db/migrations/010_agent_strict.sql"), "utf8"));
for (const s of mig010) await q(ns(s), [], 60_000);
let idempotent = true;
try {
  for (const s of mig010) await q(ns(s), [], 60_000);
} catch (e) {
  idempotent = false;
  say(`      re-apply failed: ${String(e.message).slice(0, 160)}`);
}
check(`010 applies and re-applies cleanly (${mig010.length} statements, twice)`, idempotent);

const postDefaultBlocked = await failed(
  `insert into ${T("vy_derivation")} (person_id, model, prompt_hash, input_from, input_to, wrote)
   values (${lit(SCRATCH)}::uuid, ${lit(`${TAG}still-no-agent-column`)}, 'fixture', 1, 2, '[]'::jsonb)`,
);
const stillDefaulted = [];
for (const t of FIXTURE_TABLES) if (await columnDefault(t.table, "agent_id")) stillDefaulted.push(t.table);
check(
  "POST-010: the same INSERT now fails LOUDLY instead of filing under Meera",
  postDefaultBlocked && stillDefaulted.length === 0,
  `(insert rejected: ${postDefaultBlocked}; tables still carrying a DEFAULT: ${stillDefaulted.length}/20)`,
);

const postCompat = [];
for (const ix of COMPAT) if (await indexExists(ix)) postCompat.push(ix);
const postOk = !(await failed(
  `insert into ${T("vy_rel_state")} (agent_id, person_id, honorific)
   values (${lit(A2)}::uuid, ${lit(SCRATCH)}::uuid, 'tum')`,
));
check(
  "POST-010: a second agent CAN hold rel_state for the same person",
  postOk && postCompat.length === 0,
  `(compat indexes remaining: ${postCompat.length}/4)`,
);

// scratch rows are not part of the corpus — remove them before seeding so the
// oracle's row inventory is exactly what seed() wrote
for (const t of ["vy_derivation", "vy_rel_state"]) {
  await q(`delete from ${T(t)} where person_id = ${lit(SCRATCH)}::uuid`);
}

// ── 4. seed the two-agent corpus ───────────────────────────────────────────
say("\n── 4. seeding the two-agent corpus ──");
const { counts } = await seed();
const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
say(
  `  ok  ${AGENTS.length} agents x ${PERSONS.length} persons across ${FIXTURE_TABLES.length} agent-scoped tables ` +
    `= ${totalRows} rows`,
);
const shortfall = FIXTURE_TABLES.filter((t) => counts[t.table] !== AGENTS.length * PERSONS.length);
check(
  "every agent-scoped table holds rows for BOTH agents about the SAME people",
  shortfall.length === 0,
  shortfall.length ? `(short: ${shortfall.map((t) => `${t.table}=${counts[t.table]}`).join(", ")})` : "",
);

// ── 5. the scenarios ───────────────────────────────────────────────────────
//
// A scenario is one retrieval context: which agent is asking, about whom. Every
// scenario is evaluated against every agent-scoped table, so the gate's n is
// scenarios x tables — each one a retrieval that must return this agent's rows
// and nothing else.
await q(`create table ${T("scenario")} (sid int primary key, agent_id uuid not null, person_id uuid not null)`);
const scenarios = [];
let sid = 0;
for (const agent of AGENTS) for (const person of PERSONS) scenarios.push({ sid: sid++, agent, person });
await q(
  `insert into ${T("scenario")} (sid, agent_id, person_id) values ` +
    scenarios.map((s) => `(${s.sid}, ${lit(s.agent)}::uuid, ${lit(s.person)}::uuid)`).join(","),
);
const N = scenarios.length * FIXTURE_TABLES.length;
say(`\n── 5. ${scenarios.length} retrieval contexts x ${FIXTURE_TABLES.length} tables = n=${N} scoped retrievals ──`);

// ── 6. the predicate arm ───────────────────────────────────────────────────
//
// One batched round trip per table, cross-joining every scenario with every row
// and evaluating the SHIPPING predicate text — same clause, same cast, with the
// binding pointed at a scenario COLUMN instead of a positional parameter. That
// substitution is the reason agentScopePredicate() takes a bind map at all: the
// predicate that ships is the predicate that was tested.
const BIND = { agentId: "s.agent_id" };
const armQuery = (t, predicate) =>
  `select s.sid, f.agent_id::text as row_agent, count(*)::int as n
     from ${T("scenario")} s
     cross join ${T(t.table)} f
    where ${t.person ? `f.${t.person} = s.person_id` : "true"}
      ${predicate}
    group by 1, 2`;

// The oracle, written from §2 in plain JS rather than read off the returned
// row: a row is retrievable by scenario S iff it belongs to S's agent and (for
// a person-keyed table) to S's person. seed() writes exactly one row per
// (agent, person) per table, so the expected count is 1 — or PERSONS.length for
// the three tables that carry no person reference.
const expectedFor = (t) => (t.person ? 1 : PERSONS.length);

let violations = [];
let overBlocked = [];
let returnedTotal = 0;
for (const t of FIXTURE_TABLES) {
  const rows = await q(armQuery(t, agentScopePredicate("f", BIND)), [], 120_000);
  const got = new Map(); // sid -> {own, foreign}
  for (const s of scenarios) got.set(s.sid, { own: 0, foreign: 0 });
  for (const r of rows) {
    const s = scenarios[r.sid];
    const bucket = got.get(r.sid);
    if (r.row_agent === s.agent) bucket.own += Number(r.n);
    else bucket.foreign += Number(r.n);
    returnedTotal += Number(r.n);
  }
  for (const s of scenarios) {
    const b = got.get(s.sid);
    if (b.foreign > 0) violations.push({ table: t.table, sid: s.sid, agent: s.agent, n: b.foreign });
    if (b.own !== expectedFor(t)) {
      overBlocked.push({ table: t.table, sid: s.sid, got: b.own, want: expectedFor(t) });
    }
  }
}

say(`\n── 6. verdict ──`);
say(`  scoped retrievals        ${N}`);
say(`  rows returned            ${returnedTotal}`);
say(`  CROSS-AGENT ROWS         ${violations.reduce((a, v) => a + v.n, 0)}  (in ${violations.length} retrieval(s))`);
say(`  under-returned           ${overBlocked.length}  (predicate stricter than policy — reported, not tolerated)`);
if (violations.length) {
  for (const v of violations.slice(0, 20)) say(`    LEAK ${v.table} sid=${v.sid} agent=${v.agent} rows=${v.n}`);
}
if (overBlocked.length) {
  for (const v of overBlocked.slice(0, 20)) say(`    SHORT ${v.table} sid=${v.sid} got=${v.got} want=${v.want}`);
}
check("0 cross-agent rows retrieved", violations.length === 0);
check("no scenario under-returns its own agent's rows", overBlocked.length === 0);

// ── 7. NEGATIVE CONTROL ────────────────────────────────────────────────────
//
// A gate nobody has shown catches anything is not a gate (gate0's own control
// exists for this reason, and it is the reason `gate0-structural`'s zero is
// quotable). The predicate's ONE clause line is struck out of the SHIPPING text
// — not replaced by a hand-written alternative, which would test a different
// string — and every retrieval is re-run. The harness must now report leaks. If
// it does not, the zero above meant "the fixture cannot see a leak", not "there
// is no leak".
say(`\n── 7. negative control (the clause struck from the shipping predicate text) ──`);
const strike = (sql) => sql.replace(/^and .*$/m, "");
const controlText = strike(agentScopePredicate("f", BIND));
let controlLeaks = 0;
let controlTables = 0;
for (const t of FIXTURE_TABLES) {
  const rows = await q(armQuery(t, controlText), [], 120_000);
  let leaked = 0;
  for (const r of rows) if (r.row_agent !== scenarios[r.sid].agent) leaked += Number(r.n);
  if (leaked) controlTables++;
  controlLeaks += leaked;
}
check(
  "the harness discriminates: striking the clause leaks",
  controlLeaks > 0 && controlTables === FIXTURE_TABLES.length,
  `(${controlLeaks} cross-agent rows across ${controlTables}/${FIXTURE_TABLES.length} tables)`,
);

// ── 8. call-site coverage ──────────────────────────────────────────────────
//
// The DECLARED forget-lane exceptions. Every entry is a statement in
// api/memory.js's forget cascade, which is unscoped on purpose: SPEC §6 rules
// that a wipe deletes the person's rows across ALL agents, because it is their
// data and not the agent's, and G-E5 is a proven property that may not regress.
// Matching is by normalized prefix. The assertion runs BOTH ways — an
// undeclared unscoped statement fails, and so does a declared exception that no
// longer matches anything, because a stale allowlist is how an exception
// outlives its reason.
const FORGET_LANE = [
  "select id from vy_episode where person_id = $1 and log_from is not null",
  "select id from vy_episode where person_id = $1 and summary ~* $2",
  "select id from vy_episode where person_id = $1 and started_at < $3",
  "with recursive doomed as ( select id, superseded_by from vy_episode",
  "with recursive doomed as ( select id, superseded_by from vy_fact",
  "delete from vy_rel_event where person_id = $1",
  "delete from vy_pattern where person_id = $1",
  "delete from vy_kin where person_id = $1",
  "delete from vy_currency where person_id = $1",
  "delete from vy_ritual where person_id = $1",
  "delete from vy_phrase where person_id = $1",
  "delete from vy_embedding where person_id = $1",
  "delete from vy_derivation where person_id = $1",
  "delete from vy_session where person_id = $1",
  "select e.id from ${t(\"vy_episode\")} e",
  "delete from ${t(\"vy_fact\")} where citations && $1::bigint[]",
  "delete from ${t(\"vy_phrase\")} where origin_episode = any($1::bigint[])",
  "delete from ${t(\"vy_embedding\")}",
  "delete from ${t(\"vy_episode\")} where id = any($1::bigint[])",
  "delete from ${t(\"vy_disclosure_grant\")} where granted_by = $1 or granted_to = $1",
  "update ${t(\"vy_group_member\")} set left_at = now()",
];

const SCOPED_NAMES = AGENT_SCOPED_TABLES.map((t) => t.table);
const norm = (s) => s.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
const stripComments = (src) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

/** Template literals that begin with a SQL verb. See this file's header for the
 *  method and its stated limits. */
function sqlStatements(src) {
  const out = [];
  const re = /`(\s*(?:with|select|insert|update|delete|where)\b)/gi;
  let m;
  while ((m = re.exec(src))) {
    let j = m.index + 1;
    let depth = 0;
    let buf = "";
    while (j < src.length) {
      if (src[j] === "$" && src[j + 1] === "{") { depth++; buf += "${"; j += 2; continue; }
      if (depth > 0 && src[j] === "}") { depth--; buf += "}"; j++; continue; }
      if (depth === 0 && src[j] === "`") break;
      buf += src[j];
      j++;
    }
    out.push(buf);
    re.lastIndex = j;
  }
  return out;
}

say(`\n── 8. call-site coverage (api/memory.js, api/consolidate.js) ──`);
const usedLane = new Set();
let scopedCount = 0;
let writeCount = 0;
const undeclared = [];
for (const rel of ["api/memory.js", "api/consolidate.js"]) {
  const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
  for (const raw of sqlStatements(src)) {
    const s = norm(raw);
    if (!SCOPED_NAMES.some((t) => new RegExp(`\\b${t}\\b`).test(s))) continue;
    if (s.includes("agentScopePredicate(")) { scopedCount++; continue; }
    if (/^insert into vy_\w+ \(agent_id[,)]/.test(s)) { writeCount++; continue; }
    const hit = FORGET_LANE.find((f) => s.startsWith(f));
    if (hit) { usedLane.add(hit); continue; }
    undeclared.push(`${rel}: ${s.slice(0, 110)}`);
  }
}
const stale = FORGET_LANE.filter((f) => !usedLane.has(f));
say(`  scoped retrievals        ${scopedCount}`);
say(`  writes naming agent_id   ${writeCount}`);
say(`  declared forget-lane     ${usedLane.size}/${FORGET_LANE.length}`);
if (undeclared.length) for (const u of undeclared.slice(0, 20)) say(`    UNDECLARED  ${u}`);
if (stale.length) for (const u of stale) say(`    STALE       ${u}`);
check("no undeclared unscoped statement over an agent-scoped table", undeclared.length === 0);
check("no stale forget-lane exception", stale.length === 0);

// ── 8b. the same statements, PARSED AND PLANNED by the real Postgres ───────
//
// Arm 8 reads the statements; this one hands each of them to the engine. Every
// SQL literal over an agent-scoped table is rendered (the predicate call
// evaluated for real, the handful of other interpolations stubbed) and sent as
// `prepare <name> as <sql>`, which parses and PLANS against the live schema
// without executing a single row. That is what catches the class of mistake a
// text lint cannot see: an alias that does not exist, a column renamed by the
// alias, a `set` target qualified where Postgres forbids it, a parameter
// number off by one. Prepared names are session-local and Neon's SQL-over-HTTP
// endpoint is stateless per request, so this leaves nothing behind — it is the
// one arm with no teardown because it has nothing to tear down.
//
// A statement whose interpolations cannot be rendered is SKIPPED and COUNTED,
// never silently passed: a skipped check that reads like a passed check is how
// the meera_tel_session index shadowed its table for a day.
say(`\n── 8b. every such statement parsed + planned by the live engine ──`);
const STUBS = {
  agentScopePredicate,
  agentValue,
  days: 60,
  RELDERIVE_LOOKBACK_H: 30,
  t: (n) => n,
};
let planned = 0;
const unplanned = [];
const unrendered = [];
let pid = 0;
for (const rel of ["api/memory.js", "api/consolidate.js"]) {
  const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
  for (const raw of sqlStatements(src)) {
    if (!SCOPED_NAMES.some((t) => new RegExp(`\\b${t}\\b`).test(raw))) continue;
    if (/^\s*where\b/i.test(raw)) continue; // a fragment, not a statement
    let sql;
    try {
      sql = new Function(...Object.keys(STUBS), "return `" + raw + "`")(...Object.values(STUBS));
    } catch {
      unrendered.push(`${rel}: ${norm(raw).slice(0, 90)}`);
      continue;
    }
    if (/\$\{/.test(sql)) {
      unrendered.push(`${rel}: ${norm(sql).slice(0, 90)}`);
      continue;
    }
    try {
      await q(`prepare wsagent_parse_${pid++} as ${sql}`, [], 30_000);
      planned++;
    } catch {
      unplanned.push(`${rel}: ${norm(sql).slice(0, 140)}`);
    }
  }
}
say(`  planned                  ${planned}`);
say(`  not rendered (skipped)   ${unrendered.length}  ${unrendered.length ? "— forget-lane statements carrying a closure the renderer has no value for" : ""}`);
if (unplanned.length) for (const u of unplanned.slice(0, 20)) say(`    REJECTED  ${u}`);
check("every rendered statement parses and plans against the live schema", unplanned.length === 0);

// ── 9. latency, one round trip per retrieval ───────────────────────────────
//
// The batched arm above proves correctness; this proves the clause is free. It
// is a single equality against the leading column of 009's own (agent_id,
// person_id) index, so the expectation is that it costs nothing measurable
// beyond the Neon SQL-over-HTTP round trip itself.
const lat = [];
const single = agentScopePredicate("f", { agentId: "$2" });
for (const s of scenarios.slice(0, 24)) {
  const t = Date.now();
  await q(
    `select f.id from ${T("vy_fact")} f where f.person_id = $1 ${single}`,
    [s.person, s.agent],
    30_000,
  );
  lat.push(Date.now() - t);
}
lat.sort((a, b) => a - b);
say(`\n── 9. single-retrieval latency (n=${lat.length}) ──`);
say(`  p50 ${lat[Math.floor(lat.length / 2)]}ms  p95 ${lat[Math.floor(lat.length * 0.95)]}ms  (includes the round trip)`);

// ── 10. teardown + residue proof ───────────────────────────────────────────
let residue = { relations: [], productionRows: [] };
if (!KEEP) {
  const dropped = await teardown();
  residue = await proveNoResidue();
  say(`\n── 10. teardown ──`);
  say(`  dropped ${dropped} fixture relation(s)`);
  say(
    `  residue: ${residue.relations.length} fixture relation(s) remaining, ` +
      `${residue.productionRows.length} production table(s) carrying a fixture row ` +
      `${residue.productionRows.length ? JSON.stringify(residue.productionRows) : ""}`,
  );
  check("zero fixture relations survive teardown", residue.relations.length === 0);
  check("zero fixture rows in any production table", residue.productionRows.length === 0);
} else {
  say(`\n(--keep: fixture schema left in place; run --cleanup to drop it)`);
}

say(
  failures.length
    ? `\nG-E1 FAILED — ${failures.length} check(s): ${failures.join("; ")}`
    : `\nG-E1 PASSED — 0 cross-agent rows across n=${N} scoped retrievals ` +
        `(${scenarios.length} agent x person contexts x ${FIXTURE_TABLES.length} tables), ` +
        `negative control caught ${controlLeaks}, ${((Date.now() - t0) / 1000).toFixed(1)}s.`,
);
process.exit(failures.length ? 1 : 0);
