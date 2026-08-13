// check-citations — the cite_or_authored discipline, proven live (SPEC §4.2).
//
//   node scripts/check-citations.mjs   → exit 1 if the schema layer is missing
//
// Layer 1 of the four-layer citation enforcement is the SCHEMA: CHECK
// constraints that make an uncited derived row unwritable, and GIN indexes
// that make the forget cascade's citation-join a real plan instead of a
// sequential scan. This script proves those objects EXIST on the live
// database — because `create table if not exists` SKIPS silently when a
// relation of that name already exists (the meera_tel_session incident:
// the apply reported success, the object was wrong, everything failed at
// runtime much later). Read-only, catalog queries only, CI-fast.
//
// It also re-checks the data the constraints govern (belt and braces: a
// constraint added after bad rows landed would validate future writes while
// the old rows sit there violating the law), and reports the legacy
// quarantine population (provenance='legacy' — barred from being cited by
// new derivations, retired when a cited re-derivation lands).
import { q } from "../api/_db.js";

let failed = 0;
const t0 = Date.now();
const ok = (name, detail = "") => console.log(`  ok  ${name}${detail ? `  ${detail}` : ""}`);
const fail = (name, detail = "") => {
  failed++;
  console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
};

// ── the CHECK constraints, by name, with their exact expressions live ──
const WANT_CHECKS = {
  vy_fact_cite_or_authored: "vy_fact",
  vy_rel_event_cited: "vy_rel_event",
  vy_pattern_needs_two: "vy_pattern",
  vy_kin_cited: "vy_kin",
};
const cons = await q(
  `select conname, conrelid::regclass::text as tbl,
          pg_get_constraintdef(oid) as def
     from pg_constraint
    where contype = 'c' and conname = any($1)`,
  [Object.keys(WANT_CHECKS)],
);
const byName = new Map(cons.map((c) => [c.conname, c]));
for (const [name, tbl] of Object.entries(WANT_CHECKS)) {
  const c = byName.get(name);
  if (!c) fail(`constraint ${name}`, "MISSING");
  else if (c.tbl !== tbl) fail(`constraint ${name}`, `on ${c.tbl}, expected ${tbl}`);
  else ok(`constraint ${name}`, c.def.replace(/\s+/g, " ").slice(0, 60));
}

// ── the GIN indexes the citation-join deletes run over ──
const WANT_GIN = ["vy_fact_cit_ix", "vy_rel_event_cit_ix", "vy_pattern_cit_ix", "vy_kin_cit_ix"];
const idx = await q(
  `select indexname, indexdef from pg_indexes
    where schemaname = 'public' and indexname = any($1)`,
  [WANT_GIN],
);
const idxBy = new Map(idx.map((i) => [i.indexname, i.indexdef]));
for (const name of WANT_GIN) {
  const def = idxBy.get(name);
  if (!def) fail(`gin index ${name}`, "MISSING");
  else if (!/using gin/i.test(def)) fail(`gin index ${name}`, "exists but is not GIN");
  else ok(`gin index ${name}`);
}

// ── the data under the law (belt and braces) ──
const data = [
  [
    "vy_fact: cite-or-authored holds",
    `select count(*)::int n from vy_fact
      where provenance not in ('authored','legacy') and cardinality(citations) < 1`,
  ],
  ["vy_rel_event: every event cited", `select count(*)::int n from vy_rel_event where cardinality(citations) < 1`],
  ["vy_pattern: two-citation floor", `select count(*)::int n from vy_pattern where cardinality(citations) < 2`],
  ["vy_kin: every kin row cited", `select count(*)::int n from vy_kin where cardinality(citations) < 1`],
];
for (const [name, sql] of data) {
  const [row] = await q(sql, [], 30_000);
  const n = Number(row?.n ?? -1);
  if (n === 0) ok(name);
  else fail(name, `${n} violating row(s)`);
}

// legacy quarantine population — informational, never a failure by itself
const [legacy] = await q(`select count(*)::int n from vy_fact where provenance = 'legacy'`);
console.log(`  --  legacy-quarantined facts: ${legacy.n} (barred from citation by new derivations)`);

console.log(
  failed
    ? `\n${failed} citation-discipline check(s) FAILED in ${Date.now() - t0}ms`
    : `\ncitation discipline green (${Date.now() - t0}ms)`,
);
process.exit(failed ? 1 : 0);
