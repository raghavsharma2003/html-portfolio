// WS-M. The gate for the live-database bug class the mocks structurally cannot
// see: a bound parameter whose Postgres type is wrong, or undecidable.
//
// WHY THIS EXISTS
//
// Neon is reached over SQL-over-HTTP (api/_db.js), which sends bound parameters
// UNTYPED. Postgres then deduces ONE type per parameter per statement from all
// of its use sites. That deduction is silent when it works and fatal when it
// does not, and the failures only ever appear against a real server:
//
//   42883  operator does not exist: uuid = text
//   42804  column "x" is of type uuid but expression is of type text
//   42P08  inconsistent types deduced for parameter $N
//   42P18  could not determine data type of parameter $N
//
// Every offline suite in this repo mocks the database. A mock does not resolve
// operators, so all four are invisible to it — and the studio's first live
// "create replica" click 500'd on the first one. The eval that would have
// caught it has to read the SQL the way Postgres will, which is what this does.
//
// It runs entirely OFFLINE against the checked-in DDL. That is deliberate: a
// gate that needs a database and credentials is a gate CI skips, and a skipped
// gate is indistinguishable from a passing one.
//
// WHAT IT CHECKS
//
//   Rule A (everywhere, no exceptions) — a parameter whose use sites demand
//   incompatible types, or which has no type-determining site at all. These are
//   GUARANTEED runtime failures; each one is a 500 waiting for its first call.
//
//   Rule B (the replica/gurukul surface, see evals/sqlcast/surface.mjs) — every
//   parameter compared against or inserted into a non-text column carries an
//   explicit cast. This is the house style that makes Rule A unreachable by
//   construction rather than merely detected.
//
// A bare `$1` against a uuid column is NOT by itself a bug — measured against
// the live database, it deduces to uuid and works. Rule B is therefore a
// discipline on the newest surface, not a universal law, and the older meera_*
// paths are covered by Rule A alone. `surface.mjs` records why.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, needsCast } from "./sqlcast/schema.mjs";
import { templateLiterals, looksLikeSql, analyzeSql } from "./sqlcast/scan.mjs";
import { statementShapeDefects } from "./sqlcast/stmt.mjs";
import { isStrict } from "./sqlcast/surface.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

let failed = 0;
const problem = (msg) => {
  failed++;
  console.log("  FAIL " + msg);
};

// ─────────────────────────────────────────────────────── the schema is real
const schema = loadSchema(ROOT);
const tableCount = Object.keys(schema).length;
const columnCount = Object.values(schema).reduce(
  (n, cols) => n + Object.keys(cols).length,
  0,
);

// The worst failure mode of this whole suite is a DDL parser that quietly
// returns nothing: every query then resolves no column, flags no site, and the
// gate passes while checking exactly zero things. These floors make that loud.
// (Verified 2026-08-26 against the live database's information_schema: 111
// tables / 1351 columns, parsed exactly, zero type mismatches.)
if (tableCount < 100) problem(`DDL parse found only ${tableCount} tables — expected 100+`);
if (columnCount < 1200) problem(`DDL parse found only ${columnCount} columns — expected 1200+`);
for (const [t, c] of [
  ["vy_replica", "owner_user_id"],
  ["vy_replica", "replica_id"],
  ["vy_teacher_sheet", "agent_id"],
  ["vy_channel_watch", "replica_id"],
  ["vy_ingest_run", "run_id"],
  ["vy_voice_fidelity", "voice_profile_ref"],
]) {
  if (schema[t]?.[c] !== "uuid") {
    problem(`expected ${t}.${c} to parse as uuid, got ${schema[t]?.[c] ?? "nothing"}`);
  }
}
console.log(`  schema: ${tableCount} tables, ${columnCount} columns`);

// ───────────────────────────────────────────────────── negative controls
//
// A gate nobody has watched fail is a gate nobody knows works. Each fixture
// below is deliberately broken and MUST be caught; the matching repaired
// fixture MUST come back clean, so a rule that starts flagging everything is
// caught too.
const NEGATIVE = [
  {
    name: "uncast uuid comparison on the strict surface",
    sql: `select replica_id from vy_replica where owner_user_id = $1 limit 1`,
    rule: "violations",
  },
  {
    name: "uncast uuid in an INSERT column list",
    sql: `insert into vy_replica_audit (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
          values ($1, $2, 'x', 'y', 'z', 'p', 'allowed', '{}'::jsonb)`,
    rule: "violations",
  },
  {
    name: "uncast timestamptz comparison",
    sql: `select run_id from vy_ingest_run where created_at > $1`,
    rule: "violations",
  },
  {
    name: "uncast int in an UPDATE ... SET",
    sql: `update vy_ingest_run set proposed_delta_count = $1 where run_id = $2::uuid`,
    rule: "violations",
  },
  {
    name: "parameter pinned to text then compared to a uuid column (the original 500)",
    sql: `with lock as (select pg_advisory_xact_lock(hashtextextended($1::text, 0)))
          select r.replica_id from vy_replica r, lock where r.owner_user_id = $1`,
    rule: "conflicts",
  },
  {
    name: "one parameter used against both a text and a uuid column",
    sql: `select replica_id from vy_replica where display_name = $1 and owner_user_id = $1`,
    rule: "conflicts",
  },
  {
    name: "parameter with no type-determining site (jsonb_build_object only)",
    sql: `select jsonb_build_object('k', $2) from vy_replica where owner_user_id = $1::uuid`,
    rule: "conflicts",
  },
];

const POSITIVE = [
  {
    name: "the same comparison, cast",
    sql: `select replica_id from vy_replica where owner_user_id = $1::uuid limit 1`,
  },
  {
    name: "the same INSERT, cast",
    sql: `insert into vy_replica_audit (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
          values ($1::uuid, $2::uuid, 'x', 'y', 'z', 'p', 'allowed', '{}'::jsonb)`,
  },
  {
    name: "the original 500, repaired",
    sql: `with lock as (select pg_advisory_xact_lock(hashtextextended($1::text, 0)))
          select r.replica_id from vy_replica r, lock where r.owner_user_id = $1::uuid`,
  },
  {
    name: "jsonb_build_object argument, cast",
    sql: `select jsonb_build_object('k', $2::text) from vy_replica where owner_user_id = $1::uuid`,
  },
  {
    name: "coalesce resolves from its sibling column — must NOT be flagged",
    sql: `update vy_ingest_run set transcript_source = coalesce($3, transcript_source)
           where run_id = $1::uuid and owner_user_id = $2::uuid`,
  },
  {
    name: "a text column needs no cast — must NOT be flagged",
    sql: `select replica_id from vy_replica where display_name = $1`,
  },
];

for (const c of NEGATIVE) {
  const r = analyzeSql(c.sql, schema, needsCast);
  if (!r[c.rule].length) {
    problem(`negative control NOT caught (${c.rule}): ${c.name}`);
  }
}
for (const c of POSITIVE) {
  const r = analyzeSql(c.sql, schema, needsCast);
  if (r.violations.length || r.conflicts.length) {
    problem(
      `positive control wrongly flagged: ${c.name} — ` +
        [...r.violations, ...r.conflicts].map((v) => v.detail).join("; "),
    );
  }
}
console.log(
  `  controls: ${NEGATIVE.length} negative caught, ${POSITIVE.length} positive clean`,
);

// ───────────────────────────────── rule C/D controls: statement shape (0A000)
//
// Rule A/B are about VALUES: they need a call with the wrong type to bite.
// Rule C and D are worse — Postgres refuses the statement at PARSE time, so it
// can never execute for anybody, and an offline mock never asks it to parse.
// All three seed cases below are the real defects WS-M's EXPLAIN sweep found
// shipped in the tree, reduced; the repaired forms are what replaced them.
const SHAPE_BAD = [
  {
    name: "bare FOR UPDATE over a LEFT JOIN (api/_replica-full-erasure.js)",
    sql: `with target as (
            select j.job_id,r.agent_id from vy_replica_erasure_job j
              join vy_replica r on r.replica_id=j.replica_id
              left join vy_agent a on a.agent_id=r.agent_id
             where j.job_id=$1::uuid for update
          ) select job_id from target`,
  },
  {
    name: "FOR UPDATE OF naming the left-joined alias",
    sql: `select r.replica_id from vy_replica r
            left join vy_agent a on a.agent_id=r.agent_id
           where r.replica_id=$1::uuid for update of r,a`,
  },
  {
    name: "data-modifying CTE with no RETURNING, referenced (api/_replica-source-erasure.js)",
    sql: `with touched as (
            update vy_replica_source s set state='deleting' where s.replica_id=$1::uuid
          ), gone as (
            delete from vy_replica_claim c where c.replica_id=$1::uuid
              and (select count(*) from touched)>=0 returning c.replica_id
          ) select replica_id from gone`,
  },
  {
    name: "data-modifying CTE with no RETURNING, referenced (api/_replica-voice-delivery-policy.js)",
    sql: `with expired as (
            update vy_replica_voice_trial set state='expired' where replica_id=$1::uuid
          ) select t.trial_id from vy_replica_voice_trial t
             where t.replica_id=$1::uuid and (select count(*) from expired)>=0`,
  },
];

const SHAPE_OK = [
  {
    name: "FOR UPDATE OF the non-nullable relations only — the repair",
    sql: `with target as (
            select j.job_id,r.agent_id from vy_replica_erasure_job j
              join vy_replica r on r.replica_id=j.replica_id
              left join vy_agent a on a.agent_id=r.agent_id
             where j.job_id=$1::uuid for update of j,r
          ) select job_id from target`,
  },
  {
    name: "bare FOR UPDATE with no outer join anywhere — legal, must NOT be flagged",
    sql: `select s.source_id from vy_replica_source s
           where s.replica_id=$1::uuid order by s.updated_at
           for update skip locked limit 1`,
  },
  {
    name: "a LEFT JOIN in a DIFFERENT CTE from the lock — must NOT be flagged",
    sql: `with a as (
            select r.replica_id,g.agent_id from vy_replica r
              left join vy_agent g on g.agent_id=r.agent_id where r.replica_id=$1::uuid
          ), b as (
            select s.source_id from vy_replica_source s where s.replica_id=$1::uuid for update
          ) select source_id from b`,
  },
  {
    name: "the same CTE, with RETURNING — the repair",
    sql: `with expired as (
            update vy_replica_voice_trial set state='expired' where replica_id=$1::uuid
            returning trial_id
          ) select t.trial_id from vy_replica_voice_trial t
             where t.replica_id=$1::uuid and (select count(*) from expired)>=0`,
  },
  {
    name: "no RETURNING and nothing references it — legal, must NOT be flagged",
    sql: `with expired as (
            update vy_replica_voice_trial set state='expired' where replica_id=$1::uuid
          ) select t.trial_id from vy_replica_voice_trial t where t.replica_id=$1::uuid`,
  },
  {
    name: "a read-only CTE with no RETURNING, referenced — legal, must NOT be flagged",
    sql: `with live as (
            select s.source_id from vy_replica_source s where s.replica_id=$1::uuid
          ) select source_id from live`,
  },
];

for (const c of SHAPE_BAD) {
  if (!statementShapeDefects(c.sql).length) {
    problem(`shape control NOT caught: ${c.name}`);
  }
}
for (const c of SHAPE_OK) {
  const d = statementShapeDefects(c.sql);
  if (d.length) {
    problem(`shape control wrongly flagged: ${c.name} — ${d.map((x) => x.detail).join("; ")}`);
  }
}
console.log(
  `  shape controls: ${SHAPE_BAD.length} negative caught, ${SHAPE_OK.length} positive clean`,
);

// ──────────────────────────────────────────────────────────── the real scan
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

let statements = 0,
  strictStatements = 0,
  conflictCount = 0,
  violationCount = 0,
  shapeCount = 0;

for (const file of walk(path.join(ROOT, "api")).sort()) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const strict = isStrict(rel);
  for (const t of templateLiterals(fs.readFileSync(file, "utf8"))) {
    if (!looksLikeSql(t.sql)) continue;
    statements++;
    if (strict) strictStatements++;
    const { violations, conflicts } = analyzeSql(t.sql, schema, needsCast);
    // Rule C/D apply EVERYWHERE, like rule A: a statement Postgres refuses to
    // parse is broken on the oldest surface exactly as much as the newest.
    for (const s of statementShapeDefects(t.sql)) {
      shapeCount++;
      problem(`${rel}:${t.line} — ${s.detail}`);
    }
    for (const c of conflicts) {
      conflictCount++;
      problem(`${rel}:${t.line} — ${c.detail}`);
    }
    if (!strict) continue;
    for (const v of violations) {
      violationCount++;
      problem(`${rel}:${t.line} — ${v.detail}; write ${v.want}`);
    }
  }
}

console.log(
  `  scanned: ${statements} SQL statements (${strictStatements} on the strict surface)`,
);
console.log(`  rule A (everywhere)      : ${conflictCount} conflicts`);
console.log(`  rule B (strict surface)  : ${violationCount} uncast sites`);
console.log(`  rule C/D (everywhere)    : ${shapeCount} unparseable statement shapes`);

if (failed) {
  console.log(`\nsqlcast: ${failed} FAILED`);
  process.exit(1);
}
console.log("sqlcast: ok");
