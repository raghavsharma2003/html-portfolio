// Offline gate for migrations 010, 021 and 022. It proves that no shipping
// writer still relies on an agent default and no remaining natural-key
// arbiter prevents two agents from carrying independent relationship state.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_SCOPED_TABLES, RAW_AGENT_SCOPED_TABLES } from "../../api/_agentscope.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
let checks = 0;
function ok(name, value, detail = "") {
  assert.ok(value, `${name}${detail ? `: ${detail}` : ""}`);
  console.log(`ok ${++checks} - ${name}${detail ? ` (${detail})` : ""}`);
}

function sourceFiles(path) {
  const absolute = join(ROOT, path);
  const files = [];
  for (const item of readdirSync(absolute, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name === "dist" || item.name === "_engine.gen.js") continue;
    const relative = join(path, item.name);
    if (item.isDirectory()) files.push(...sourceFiles(relative));
    else if ([".js", ".mjs", ".ts", ".tsx"].includes(extname(item.name))) files.push(relative);
  }
  return files;
}

const AGENT_TABLES = new Set([...AGENT_SCOPED_TABLES, ...RAW_AGENT_SCOPED_TABLES].map((item) => item.table));
const FILES = [...sourceFiles("api"), ...sourceFiles("src"), ...sourceFiles("scripts")];

function missingAgentColumns(source, file = "fixture") {
  const missing = [];
  const insert = /insert\s+into\s+(vy_[a-z0-9_]+|meera_[a-z0-9_]+)\s*\(([^)]*)\)/gi;
  for (const match of source.matchAll(insert)) {
    const table = match[1].toLowerCase();
    if (!AGENT_TABLES.has(table)) continue;
    const columns = match[2].split(",").map((item) => item.trim().toLowerCase());
    if (!columns.includes("agent_id")) missing.push(`${file}:${table}`);
  }
  return missing;
}

const missing = [];
let inserts = 0;
for (const file of FILES) {
  const source = read(file);
  const hits = [...source.matchAll(/insert\s+into\s+(vy_[a-z0-9_]+|meera_[a-z0-9_]+)\s*\(([^)]*)\)/gi)]
    .filter((match) => AGENT_TABLES.has(match[1].toLowerCase()));
  inserts += hits.length;
  missing.push(...missingAgentColumns(source, file));
}
ok("all shipping inserts into agent-scoped tables name agent_id", missing.length === 0, `${inserts} inserts scanned`);
const negative = `insert into meera_log (device_id, content) values ($1,$2)`;
ok("negative control catches an omitted raw agent binding", missingAgentColumns(negative).length === 1);

const engine = `${read("src/engine/relstate.ts")}\n${read("src/engine/india.ts")}`;
const consolidate = read("api/consolidate.js");
ok("relational engine has no person-only conflict arbiter", !/on conflict \(person_id(?:,\s*(?:key|topic|lower\(name\)))?\)/i.test(engine));
ok("relational engine uses composite relationship arbiters", [
  /on conflict \(agent_id, person_id\)/i,
  /on conflict \(agent_id, person_id, key\)/i,
  /on conflict \(agent_id, person_id, topic\)/i,
  /on conflict \(agent_id, person_id, lower\(name\)\)/i,
].every((pattern) => pattern.test(engine)));
ok("phrase capture is agent-keyed", /on conflict \(agent_id, person_id, lower\(phrase\)\)/i.test(consolidate));

const migration010 = read("db/migrations/010_agent_strict.sql");
const m010 = splitSql(migration010);
ok("010 removes all twenty derived defaults", AGENT_SCOPED_TABLES.every(({ table }) => new RegExp(`alter table ${table} alter column agent_id drop default`, "i").test(migration010)), `${m010.length} statements`);
ok("010 removes four compatibility indexes", ["vy_rel_state", "vy_ritual", "vy_currency", "vy_india_profile"].every((table) => migration010.includes(`drop index if exists ${table}_person_compat_ix`)));
ok("010 widens kin and phrase uniqueness", /vy_kin \(agent_id, person_id, lower\(name\)\)/i.test(migration010) && /vy_phrase \(agent_id, person_id, lower\(phrase\)\)/i.test(migration010));

const migration021 = read("db/migrations/021_raw_agent_strict.sql");
ok("021 removes all raw and lease defaults", [...RAW_AGENT_SCOPED_TABLES.map((item) => item.table), "meera_consolidate_lease"].every((table) => new RegExp(`alter table ${table} alter column agent_id drop default`, "i").test(migration021)));
ok("021 consists only of idempotent default removals", splitSql(migration021).length === 5 && splitSql(migration021).every((sql) => /drop default$/i.test(sql)));

const migration022 = read("db/migrations/022_remaining_agent_keys.sql");
ok("022 rekeys session clocks by agent", /primary key \(agent_id, session_id\)/i.test(migration022));
ok("022 rekeys taste sources by agent", /unique \(agent_id, source, source_id\)/i.test(migration022));
ok("022 is re-application safe through catalog checks", splitSql(migration022).length === 2 && (migration022.match(/if not exists \(/gi) || []).length >= 2);

const clock = read("api/clock.js");
ok("clock writes and conflicts on the same agent/session tuple", (clock.match(/insert into vy_session \(agent_id, session_id/g) || []).length === 2 && (clock.match(/on conflict \(agent_id, session_id\)/g) || []).length === 2);
ok("legacy clock is pinned server-side, never request-selected", /MEERA_AGENT_ID/.test(clock) && !/body\.agent(?:Id|_id)?/.test(clock));

const taste = read("api/taste-queue.js");
ok("taste reads bind agent scope before selection", (taste.match(/agentScopePredicate/g) || []).length >= 4);
ok("taste insert and conflict are composite", /\(agent_id, person_id, take, keys, source/i.test(taste) && /on conflict \(agent_id, source, source_id\)/i.test(taste));
ok("legacy taste review is pinned server-side, never request-selected", /MEERA_AGENT_ID/.test(taste) && !/body\.agent(?:Id|_id)?/.test(taste));

console.log(`\n${checks} strict agent-readiness checks passed`);
