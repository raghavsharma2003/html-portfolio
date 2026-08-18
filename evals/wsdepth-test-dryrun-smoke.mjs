// wsdepth-test-dryrun-smoke — the full nightly chain, in dry-run mode ONLY,
// against the LIVE database with no onlyPerson restriction: finalize ->
// honorific derivation -> trust/repair -> patterns -> phrases. Proves the
// whole chain executes end to end on real production data without crashing
// and, being dry-run throughout, writes nothing (row counts asserted
// unchanged before/after on every table this workstream's writers touch).
import { runConsolidation, runRelEventDerivation, runTrustRepairDerivation, runPatternExtraction, runPhraseCapture } from "../api/consolidate.js";
import { q } from "../api/_db.js";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const TABLES = ["vy_rel_event", "vy_rel_state", "vy_pattern", "vy_phrase", "vy_derivation", "vy_episode", "vy_fact"];
async function counts() {
  const out = {};
  for (const t of TABLES) {
    const rows = await q(`select count(*)::int n from ${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

const before = await counts();
console.log("row counts before:", JSON.stringify(before));

const t0 = Date.now();
const finalize = await runConsolidation({ dryRun: true, limit: 25 });
ok("finalize dry-run: ok (or a self-reported halt, never a throw)", typeof finalize.ok === "boolean", JSON.stringify(finalize).slice(0, 300));

const rel = await runRelEventDerivation({ dryRun: true, limit: 25 });
ok("honorific dry-run: ok:true", rel.ok === true, JSON.stringify(rel).slice(0, 300));

const trust = await runTrustRepairDerivation({ dryRun: true, limit: 25 });
ok("trust/repair dry-run: ok:true", trust.ok === true, JSON.stringify(trust).slice(0, 300));

const patterns = await runPatternExtraction({ dryRun: true, limit: 25 });
ok("pattern dry-run: ok:true", patterns.ok === true, JSON.stringify(patterns).slice(0, 300));

const phrases = await runPhraseCapture({ dryRun: true, limit: 25 });
ok("phrase dry-run: ok:true", phrases.ok === true, JSON.stringify(phrases).slice(0, 300));

console.log(`full chain dry-run: ${Date.now() - t0}ms`);
console.log(
  `persons touched (dry-run, read-only): finalize=${finalize.persons_processed ?? "n/a"} honorific=${rel.persons_processed} trust=${trust.persons_processed} patterns=${patterns.persons_processed} phrases=${phrases.persons_processed}`,
);

const after = await counts();
console.log("row counts after: ", JSON.stringify(after));
for (const t of TABLES) {
  ok(`${t}: unchanged by dry-run (${before[t]} -> ${after[t]})`, before[t] === after[t]);
}

console.log(failed ? `\n${failed} FAILURE(S)` : "\nfull nightly chain dry-run smoke passed");
process.exit(failed ? 1 : 0);
