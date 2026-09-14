// WS-R175. THE CALIBRATION ERASURE ORDERING BATTERY.
//
//   node evals/erasure-order/run.mjs
//
// context/rejected.md#ws-r170-calibration-generation-fk-graph-has-an-
// unverified-erasure-ordering-hazard found, reasoned about, and deliberately
// did NOT fix: four tables (WS-R170 found three; this suite's own parse of
// the real schema found a fourth, migration 030, that WS-R170 never looked
// at) hold a `calibration_version` foreign key back to
// `vy_replica_calibration(replica_id,version)` with Postgres's default NO
// ACTION, and a fifth (`vy_replica_voice_preference`) holds two more into
// `vy_replica_generation` with `on delete restrict` (Postgres enforces
// RESTRICT identically to NO ACTION at delete time - there is no "immediate"
// vs "end of statement" distinction in this database, whatever the SQL
// standard promises). None of the five was ever deleted BY NAME by
// `api/_replica-full-erasure.js`, only reached (if at all) through
// `vy_replica`'s own cascade - and this file's OWN standing rule, restated
// at nearly every block, is that relying on a cascade means relying on an
// FK nobody re-checks.
//
// This suite is the offline model AGENTS.md's own law
// ("offline-mocks-cannot-type-check-sql", EXPLAIN against the real database
// is the only true parser) says a workstream with no NEON_URL must build
// instead of reasoning by hand: it parses `db/schema.sql`'s real foreign
// keys (`fk-graph.mjs#parseForeignKeys`, never a hand-typed list - the
// schema-mirror gate's own precedent), computes exactly which tables a full
// replica erasure reaches (`cascadeReach`, the identical walk
// `scripts/relcheck.mjs`'s own live check runs against `pg_constraint`, run
// here offline against parsed text), and proves that every NO-ACTION-
// referencing table this workstream is about is deleted strictly before the
// table it references (`effectivePositions` + `findOrderingViolations`).
//
// Layer 1 proves the FIX against the REAL files. Layer 2 proves the CHECKER
// itself bites, with three synthetic negative controls that never touch a
// real file: (a) the ORIGINAL hazard shape (nobody names either table) is
// caught; (b) the fixed shape (explicit ordered deletes) clears it; (c) a
// WRONG order (explicit deletes present but in the wrong sequence) is still
// caught - proving this checks ORDER, not merely "was it named at all".
// Layer 3 proves the checker is not vacuously green on the real files: with
// the real fix's own explicit deletes removed from a COPY of the real
// source text, the real violations reappear, by name.
//
// Offline, deterministic, $0, no DB, no network, no model call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseForeignKeys, cascadeReach, explicitDeleteOrder, effectivePositions, findOrderingViolations,
} from "./fk-graph.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// ═════════════════════════════════════════════════════════════════════════
// LAYER 1 — the real files. Zero unresolved ordering violations for every
// NO-ACTION edge whose parent is vy_replica_calibration or vy_replica_
// generation (this workstream's own named scope, law 1's own words: "every
// FK that references vy_replica_calibration and vy_replica_generation").
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 1: the real schema and the real erasure file ──");

const schemaText = readFileSync(join(REPO, "db/schema.sql"), "utf8");
const erasureText = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");

const realEdges = parseForeignKeys(schemaText);
ok(`parsed a non-trivial foreign-key graph from db/schema.sql (not vacuously empty)`,
  realEdges.length >= 200, `got ${realEdges.length}`);

const realReach = cascadeReach(realEdges, "vy_replica");
ok("cascade reach from vy_replica is non-trivial (not vacuously empty)", realReach.size >= 50,
  `got ${realReach.size}`);
for (const t of ["vy_replica_calibration", "vy_replica_generation", "vy_replica_eval_run",
  "vy_replica_runtime_capability", "vy_replica_feedback_dataset", "vy_replica_voice_preference"]) {
  ok(`${t} is reached by vy_replica's own cascade (the hazard's own precondition)`, realReach.has(t));
}

// The exact five referencing tables (seven edges - voice_preference names
// two columns) WS-R170 plus this suite's own parse found - present BY NAME,
// never only by count, schema-mirror's own "sanity floor against the count
// matching by accident" restated.
const EXPECTED_NO_ACTION = [
  ["vy_replica_runtime_capability", "vy_replica_calibration"],
  ["vy_replica_eval_run", "vy_replica_calibration"],
  ["vy_replica_generation", "vy_replica_calibration"],
  ["vy_replica_feedback_dataset", "vy_replica_calibration"],
  ["vy_replica_voice_preference", "vy_replica_generation"],
];
const realNoActionKeys = new Set(
  realEdges.filter((e) => e.action === "no_action").map((e) => `${e.child}->${e.parent}`),
);
const missingExpected = EXPECTED_NO_ACTION.filter(([c, p]) => !realNoActionKeys.has(`${c}->${p}`));
ok("every named calibration/generation NO-ACTION referencer is found in the real schema",
  missingExpected.length === 0, missingExpected.map(([c, p]) => `${c}->${p}`).join(","));
// vy_replica_voice_preference contributes TWO edges into vy_replica_generation
// (left_generation_id, right_generation_id) - both must parse, not just one.
const voicePrefToGeneration = realEdges.filter(
  (e) => e.child === "vy_replica_voice_preference" && e.parent === "vy_replica_generation" && e.action === "no_action",
);
ok("vy_replica_voice_preference contributes BOTH its left/right generation edges, not just one",
  voicePrefToGeneration.length === 2, `got ${voicePrefToGeneration.length}`);

const realOrder = explicitDeleteOrder(erasureText);
ok("the real erasure file explicitly deletes vy_replica_calibration by name",
  realOrder.has("vy_replica_calibration"));
for (const t of ["vy_replica_runtime_capability", "vy_replica_eval_run", "vy_replica_generation",
  "vy_replica_feedback_dataset", "vy_replica_voice_preference"]) {
  ok(`the real erasure file explicitly deletes ${t} by name`, realOrder.has(t));
}

const realPositions = effectivePositions(realEdges, realReach, realOrder);
const realViolations = findOrderingViolations(realEdges, realReach, realPositions);
const scopedViolations = realViolations.filter(
  (v) => v.parent === "vy_replica_calibration" || v.parent === "vy_replica_generation",
);
ok("zero unresolved ordering violations for every calibration/generation NO-ACTION edge",
  scopedViolations.length === 0,
  scopedViolations.map((v) => `${v.child}->${v.parent}(${v.childPos},${v.parentPos})`).join(" "));

// Informational only, never a gate: the full graph (every NO-ACTION edge
// this repo's schema declares, not only the calibration/generation ones
// this workstream's own brief names) still carries pre-existing, OUT-OF-
// SCOPE ties this suite does not fail on - context/rejected.md's own new
// entry for this session names them for whoever picks the next one up.
console.log(`  info  ${realViolations.length - scopedViolations.length} pre-existing, out-of-scope ` +
  `ordering pairs remain elsewhere in the full FK graph (not this workstream's named scope; logged, not gated)`);

// ═════════════════════════════════════════════════════════════════════════
// LAYER 2 — synthetic negative controls. Never touch a real file: a tiny
// fabricated schema + erasure-source pair reproduces the ORIGINAL hazard
// shape exactly, then the fixed shape, then a WRONG order.
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 2: synthetic negative controls (the checker itself bites) ──");

// Synthetic table names carry the real "vy_" prefix on purpose:
// explicitDeleteOrder's own scan (the real function under test, never a
// second copy) only recognizes "vy_"/"meera_" tables - the identical
// constraint erasureReach's own scan in evals/creator-export/run.mjs
// already lives with, restated here rather than loosened for a test.
const SYN_SCHEMA = `
create table if not exists vy_syn_root (
  root_id uuid primary key
);
create table if not exists vy_syn_parent (
  parent_id uuid primary key,
  root_id uuid not null references vy_syn_root(root_id) on delete cascade,
  version integer not null
);
create table if not exists vy_syn_child (
  child_id uuid primary key,
  root_id uuid not null references vy_syn_root(root_id) on delete cascade,
  parent_version integer not null references vy_syn_parent(version)
);
`;

// (a) THE ORIGINAL HAZARD: neither vy_syn_parent nor vy_syn_child is ever
// deleted by name - only vy_replica's stand-in (vy_syn_root) is. This is
// the EXACT pre-fix shape of vy_replica_calibration/vy_replica_generation.
{
  const synErasureUnfixed = `delete from vy_syn_root x where x.root_id=$1;`;
  const edges = parseForeignKeys(SYN_SCHEMA);
  const reach = cascadeReach(edges, "vy_syn_root");
  const order = explicitDeleteOrder(synErasureUnfixed);
  const positions = effectivePositions(edges, reach, order);
  const violations = findOrderingViolations(edges, reach, positions);
  ok("NEGATIVE CONTROL (a): the original hazard shape (nothing named, both cascade-only) is caught",
    violations.length === 1 && violations[0].child === "vy_syn_child" && violations[0].parent === "vy_syn_parent",
    JSON.stringify(violations));
}

// (b) THE FIX: vy_syn_child named first, vy_syn_parent named second, forced
// via the file's own real "(select count(*) from earlier_cte)>=0" idiom.
{
  const synErasureFixed = `
    with target as (select $1::uuid root_id),
    children as (delete from vy_syn_child x using target t where x.root_id=t.root_id returning x.child_id),
    parents as (delete from vy_syn_parent x using target t where x.root_id=t.root_id
      and (select count(*) from children)>=0 returning x.parent_id),
    removed as (delete from vy_syn_root x using target t where x.root_id=t.root_id)
    select 1;
  `;
  const edges = parseForeignKeys(SYN_SCHEMA);
  const reach = cascadeReach(edges, "vy_syn_root");
  const order = explicitDeleteOrder(synErasureFixed);
  const positions = effectivePositions(edges, reach, order);
  const violations = findOrderingViolations(edges, reach, positions);
  ok("NEGATIVE CONTROL (b): the fixed shape (child named before parent) clears the violation",
    violations.length === 0, JSON.stringify(violations));
}

// (c) THE WRONG ORDER: both are named, but parent BEFORE child - proves this
// model checks ORDER, not merely "was every table named somewhere".
{
  const synErasureWrongOrder = `
    with target as (select $1::uuid root_id),
    parents as (delete from vy_syn_parent x using target t where x.root_id=t.root_id returning x.parent_id),
    children as (delete from vy_syn_child x using target t where x.root_id=t.root_id
      and (select count(*) from parents)>=0 returning x.child_id),
    removed as (delete from vy_syn_root x using target t where x.root_id=t.root_id)
    select 1;
  `;
  const edges = parseForeignKeys(SYN_SCHEMA);
  const reach = cascadeReach(edges, "vy_syn_root");
  const order = explicitDeleteOrder(synErasureWrongOrder);
  const positions = effectivePositions(edges, reach, order);
  const violations = findOrderingViolations(edges, reach, positions);
  ok("NEGATIVE CONTROL (c): both named but in the WRONG order is still caught",
    violations.length === 1 && violations[0].child === "vy_syn_child" && violations[0].parent === "vy_syn_parent",
    JSON.stringify(violations));
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 3 — the checker is not vacuously green on the REAL files: with the
// real fix's own explicit deletes stripped from a COPY of the real erasure
// source text, the real violations must reappear, by name. This is the
// canary against "the check always reports zero no matter what it is fed."
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 3: the real fix, un-applied on a copy, must re-trip the check ──");

{
  // Strip exactly the six CTEs this workstream added, leaving everything
  // else (including vy_replica_generation's PRE-EXISTING mentions the file
  // already had before this workstream) untouched.
  const withoutFix = erasureText.replace(
    /voice_preferences as \(delete from vy_replica_voice_preference[\s\S]*?returning x\.preference_id\),\s*/,
    "",
  ).replace(
    /eval_runs as \(delete from vy_replica_eval_run[\s\S]*?returning x\.eval_id\),\s*/,
    "",
  ).replace(
    /feedback_datasets as \(delete from vy_replica_feedback_dataset[\s\S]*?returning x\.dataset_id\),\s*/,
    "",
  ).replace(
    /runtime_capabilities as \(delete from vy_replica_runtime_capability[\s\S]*?returning x\.capability_id\),\s*/,
    "",
  ).replace(
    /generations as \(delete from vy_replica_generation[\s\S]*?returning x\.generation_id\),\s*/,
    "",
  ).replace(
    /calibrations as \(delete from vy_replica_calibration[\s\S]*?from generations\)>=0\),\s*/,
    "",
  );
  ok("the copy actually differs from the real file (the strip found something to remove)",
    withoutFix !== erasureText && withoutFix.length < erasureText.length);
  ok("the un-fixed copy no longer explicitly names vy_replica_calibration",
    !explicitDeleteOrder(withoutFix).has("vy_replica_calibration"));

  const order = explicitDeleteOrder(withoutFix);
  const positions = effectivePositions(realEdges, realReach, order);
  const violations = findOrderingViolations(realEdges, realReach, positions)
    .filter((v) => v.parent === "vy_replica_calibration" || v.parent === "vy_replica_generation");
  // Seven, not five: the four single-edge calibration referencers (runtime_
  // capability, eval_run, generation, feedback_dataset) plus THREE edges
  // into generation once it is cascade-only again - voice_preference's own
  // left AND right columns (two edges, one table), and vy_replica_turn_
  // feedback, which is undetectable as a problem in the FIXED file (it is
  // cascade-deleted via runtime_capability's own explicit delete before
  // generation is ever touched) but reappears the instant that explicit
  // delete is removed - proof this suite's own layer-1 zero is not an
  // accident of never having looked at turn_feedback at all.
  ok("un-applying the real fix on a copy re-trips all seven calibration/generation violations",
    violations.length === 7, `got ${violations.length}: ${violations.map((v) => v.child).join(",")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
