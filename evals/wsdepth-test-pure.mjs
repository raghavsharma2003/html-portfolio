// wsdepth-test-pure — the mirrored pure functions in api/consolidate.js
// (clampTrustDelta/moveTrust/ruptureRepairShift/mapEpisodeCitations/
// tokenizePhrase) against relstate.ts's REAL originals, bundled fresh via
// esbuild the same way evals/run.mjs bundles the client engine — so this is
// a drift check, not just an isolated unit test: if a mirror silently
// diverges from its source of truth, this suite catches it, not a future
// nightly run's wrong write. $0, no network, no DB.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "wsdepth-"));
const BUNDLE = join(tmp, "relstate.bundle.mjs");

execSync(
  `npx esbuild ${join(ROOT, "src/engine/relstate.ts")} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);

const real = await import(BUNDLE);
const mine = await import(join(ROOT, "api/consolidate.js"));

let failed = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      got:  ${g}\n      want: ${w}`);
  }
};

// ── clampTrustDelta / moveTrust: mirror parity, real function vs mine, same inputs ──
const now = new Date("2026-08-18T12:00:00Z");
const cases = [
  [0.08, null, now],
  [0.08, new Date("2026-08-17T12:00:00Z").toISOString(), now], // 1 day elapsed
  [0.08, new Date("2026-08-18T11:00:00Z").toISOString(), now], // <1 day elapsed
  [-0.08, new Date("2026-08-15T12:00:00Z").toISOString(), now], // 3 days elapsed, decrease
  [0, new Date("2026-08-01T12:00:00Z").toISOString(), now],
];
for (const [raw, lastAt, n] of cases) {
  eq(`clampTrustDelta mirror parity raw=${raw} lastAt=${lastAt}`, mine.clampTrustDelta(raw, lastAt, n), real.clampTrustDelta(raw, lastAt, n));
}
for (const [raw, lastAt, n] of cases) {
  eq(`moveTrust mirror parity raw=${raw} lastAt=${lastAt}`, mine.moveTrust(0.3, raw, lastAt, n), real.moveTrust(0.3, raw, lastAt, n));
}
// bounds: never below 0, never above 1
eq("moveTrust floors at 0", mine.moveTrust(0.01, -0.9, null, now).next, 0);
eq("moveTrust ceilings at 1", mine.moveTrust(0.99, 0.9, null, now).next, 1);

// ── ruptureRepairShift: mirror parity across every state-machine branch ──
const rrCases = [
  [{ ruptureOpen: false, repairState: "none" }, true, false], // conflict opens rupture
  [{ ruptureOpen: true, repairState: "open" }, false, true], // their signal: repair begins
  [{ ruptureOpen: true, repairState: "repairing" }, false, true], // sustained: repaired
  [{ ruptureOpen: true, repairState: "repairing" }, true, false], // re-rupture during repair: regress
  [{ ruptureOpen: false, repairState: "none" }, false, false], // nothing: no move
  [{ ruptureOpen: true, repairState: "open" }, false, false], // nothing yet: no move
];
for (const [state, conflict, repair] of rrCases) {
  eq(
    `ruptureRepairShift mirror parity state=${JSON.stringify(state)} conflict=${conflict} repair=${repair}`,
    mine.ruptureRepairShift(state, conflict, repair),
    real.ruptureRepairShift(state, conflict, repair),
  );
}

// ── #86 record-vs-stance split: mirror parity for the new stanceLapsed
//    branch (default false above is already covered — every case above
//    ran with stanceLapsed omitted and stayed byte-identical) ──
const rrLapsedCases = [
  // stuck-open (never explicitly repaired) + fresh conflict + lapsed stance: re-opens
  [{ ruptureOpen: true, repairState: "open" }, true, false, true],
  // same state, stance NOT lapsed: falls through to the ordinary no-move case
  [{ ruptureOpen: true, repairState: "open" }, true, false, false],
  // repairing (mid-explicit-repair attempt) + lapsed: still the regress branch, unaffected by stanceLapsed
  [{ ruptureOpen: true, repairState: "repairing" }, true, false, true],
];
for (const [state, conflict, repair, lapsed] of rrLapsedCases) {
  eq(
    `ruptureRepairShift mirror parity (lapsed) state=${JSON.stringify(state)} conflict=${conflict} repair=${repair} lapsed=${lapsed}`,
    mine.ruptureRepairShift(state, conflict, repair, lapsed),
    real.ruptureRepairShift(state, conflict, repair, lapsed),
  );
}

// ── ruptureStance: mirror parity (mine has no relstate.ts equivalent
//    import path of its own — this is api/consolidate.js's separately
//    mirrored copy, same drift-check reasoning as everything above) ──
const stanceNow = new Date("2026-08-22T12:00:00Z");
const stanceCases = [
  [{ ruptureOpen: false, repairState: "none", lastMoveAt: null, warmEpisodesSince: 0 }],
  [{ ruptureOpen: true, repairState: "open", lastMoveAt: null, warmEpisodesSince: 0 }],
  [{ ruptureOpen: true, repairState: "open", lastMoveAt: new Date("2026-08-20T12:00:00Z").toISOString(), warmEpisodesSince: 0 }], // 2 days: open
  [{ ruptureOpen: true, repairState: "open", lastMoveAt: new Date("2026-07-01T12:00:00Z").toISOString(), warmEpisodesSince: 0 }], // 52 days: settled
  [{ ruptureOpen: true, repairState: "repairing", lastMoveAt: new Date("2026-08-20T12:00:00Z").toISOString(), warmEpisodesSince: 8 }], // 2 days but 8 warm episodes: settled
  [{ ruptureOpen: true, repairState: "repairing", lastMoveAt: new Date("2026-08-20T12:00:00Z").toISOString(), warmEpisodesSince: 7 }], // one short of the warm floor: still open
];
for (const [input] of stanceCases) {
  eq(
    `ruptureStance mirror parity input=${JSON.stringify(input)}`,
    mine.ruptureStance(input, stanceNow),
    real.ruptureStance(input, stanceNow),
  );
}

// ── mapEpisodeCitations: writer-window validation (WS-DEPTH-only, no
//    relstate.ts equivalent — tested against its own spec directly) ──
const episodes = [{ id: 101 }, { id: 102 }, { id: 103 }];
eq("mapEpisodeCitations: valid indices map to real ids, sorted+deduped", mine.mapEpisodeCitations([2, 0, 0], episodes), [101, 103]);
eq("mapEpisodeCitations: out-of-range indices dropped, never invented", mine.mapEpisodeCitations([0, 5, -1, 1.5], episodes), [101]);
eq("mapEpisodeCitations: non-array input yields no citations", mine.mapEpisodeCitations(null, episodes), []);
eq("mapEpisodeCitations: empty array yields no citations", mine.mapEpisodeCitations([], episodes), []);

// ── tokenizePhrase: script-agnostic word splitting (the Devanagari
//    combining-mark bug a naive \p{L}-only strip would reintroduce) ──
eq("tokenizePhrase: Hinglish", mine.tokenizePhrase("Kya kar rahe ho?"), ["kya", "kar", "rahe", "ho"]);
eq("tokenizePhrase: Devanagari with matras stays whole words", mine.tokenizePhrase("रही है क्या"), ["रही", "है", "क्या"]);
eq("tokenizePhrase: punctuation and extra whitespace collapse", mine.tokenizePhrase("  bhejo,   na!! apni.  "), ["bhejo", "na", "apni"]);

console.log(failed ? `\n${failed} FAILURE(S)` : "\nall pure-function checks passed");
process.exit(failed ? 1 : 0);
