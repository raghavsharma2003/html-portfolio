// Diagnostic only. Never wired to a release gate. No provider calls or DB writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { approvedMirrorRecall } from "../../api/_experience-compiler/mirror-recall.js";
import { scenarios, comparisonScenarios, TABLES } from "./scenarios.mjs";

const compare = process.argv.includes("--compare");
const cases = compare ? comparisonScenarios() : scenarios();
assert.equal(cases.length, compare ? 52 : 40);
assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
const hash = value => createHash("sha256").update(value).digest("hex");
const provenance = {
  diagnostic: "mirror-memory-frontier/v1", measuredAt: new Date().toISOString(),
  scenarios: cases.length, synthetic: true, providerCalls: 0, writes: 0,
  recallSourceSha256: hash(readFileSync(new URL("../../api/_experience-compiler/mirror-recall.js", import.meta.url))),
  fixtureSha256: hash(JSON.stringify(cases)),
  disclosureSourceSha256: hash(readFileSync(new URL("../../api/_disclosure.js", import.meta.url))),
};
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ ...provenance, status: "NOT_RUN", method: "fixture-manifest-validation-only",
    realSqlExecuted: false, boundaryChecks: "NOT_RUN", relevance: "NOT_RUN",
    next: "Run with --live and NEON_URL for the isolated integration database. No retrieval or quality result follows from this mode." }, null, 2));
  process.exit(0);
}

// Explicit environment only: never fall back to gitignored production config.
if (!process.env.NEON_URL) throw new Error("explicit_isolated_NEON_URL_required");
const databaseUrl = new URL(process.env.NEON_URL);
async function q(query, params = []) {
  const response = await fetch(`https://${databaseUrl.hostname}/sql`, {
    method: "POST", headers: { "Neon-Connection-String": process.env.NEON_URL, "Content-Type": "application/json" },
    body: JSON.stringify({ query, params }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Never echo server errors, parameters, connection strings or response bodies.
    const error = await response.json().catch(() => ({}));
    throw new Error(`fixture_sql_failed_http_${response.status}_code_${/^[A-Z0-9]{5}$/.test(error.code) ? error.code : "unknown"}`);
  }
  return (await response.json()).rows ?? [];
}
const [database] = await q("select current_database() as name");
assert.equal(database.name, "vyakti_expert_integration_20260906", "isolated integration database required");
const results = [];
for (const scenario of cases) for (const arm of compare ? ["baseline", "lexical-shadow"] : ["baseline"]) {
  const rows = await approvedMirrorRecall(async (sql, params) => {
    assert.match(sql, /^with scope as \(/);
    // PostgreSQL executes the shipping SELECT unchanged after WITH. Fixtures
    // use actual schema composite types but bypass table constraints and RLS.
    // Shadow EVERY referenced relation so no real owner data enters results.
    const referenced = [...sql.matchAll(/\b(?:from|join)\s+(vy_[a-z_]+)/gi)].map(m => m[1]);
    for (const table of referenced) assert.ok(TABLES.includes(table), `unshadowed relation ${table}`);
    const fixtureParameter = params.length + 1;
    const ctes = TABLES.map(table => `${table} as (select * from jsonb_populate_recordset(null::public.${table}, $${fixtureParameter}::jsonb->'${table}'))`).join(",\n");
    return q(`with ${ctes},\n${sql.slice(5)}`, [...params, JSON.stringify(scenario.rows)]);
  }, scenario.owner, scenario.replica, { strategy: arm, query: scenario.query });
  const ids = rows.map(row => Number(row.id));
  const leaked = scenario.forbidden.filter(id => ids.includes(id));
  const missing = scenario.required.filter(id => !ids.includes(id));
  const baseline = results.find(r => r.id === scenario.id && r.arm === "baseline");
  const fallbackMismatch = arm === "lexical-shadow" && scenario.expectSameAsBaseline && JSON.stringify(ids) !== JSON.stringify(baseline.returnedIds);
  const boundaryFailure = leaked.length > 0 || (scenario.expectEmpty && ids.length > 0) || fallbackMismatch || ids.length > 8;
  results.push({ id: scenario.id, arm, inputFacts: scenario.rows.vy_fact.length, returnedIds: ids,
    requiredIds: scenario.required, missingIds: missing, forbiddenReturnedIds: leaked,
    status: boundaryFailure ? "BOUNDARY_FAILURE" : missing.length ? "RETRIEVAL_LIMITATION_OBSERVED" : "EXPECTED_RETRIEVAL_OBSERVED" });
}
const boundaryFailures = results.filter(r => r.status === "BOUNDARY_FAILURE");
const limitations = results.filter(r => r.status === "RETRIEVAL_LIMITATION_OBSERVED");
console.log(JSON.stringify({ ...provenance, database: database.name, realSqlExecuted: true,
  method: "shipping-recall-select-over-schema-typed-read-only-PostgreSQL-CTE-fixtures",
  status: boundaryFailures.length ? "BOUNDARY_FAILURE" : limitations.length ? "KNOWN_RETRIEVAL_LIMITATION" : "NO_LIMITATION_OBSERVED_IN_THIS_FIXTURE",
  boundaryFailures: boundaryFailures.length, retrievalLimitations: limitations.length,
  queryStrategy: compare ? "explicit-lexical-shadow-compared-to-unchanged-default" : "baseline-no-query-ranking",
  promotion: "NOT_PROMOTED: actual Mirror caller remains unchanged; cross-script equivalence and real owner quality remain unproven.",
  notProven: ["persisted writes", "foreign-key integrity", "RLS", "authenticated API journey", "provider answer correctness", "human quality", "production behavior"], results }, null, 2));
// 2 distinguishes an observed product limitation from diagnostic execution failure.
process.exitCode = boundaryFailures.length ? 1 : limitations.length ? 2 : 0;
