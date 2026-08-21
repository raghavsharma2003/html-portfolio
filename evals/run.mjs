// The eval suite, runnable from a clean checkout: bundles the REAL source
// first, then runs every suite against the bundle. This exists because the
// suites lived only in a session scratchpad for two days — core IP protecting
// the crisis helplines and the parser, discoverable by exactly nobody, and one
// container reap away from gone. An eval that is not in version control
// protects nothing.
//
//   node evals/run.mjs           # all suites
//   node evals/run.mjs parse     # one suite
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(HERE, ".bundle.mjs");

// parsetest.v2 taught this the hard way: a frozen bundle passes forever while
// the source rots. Rebuild from source on every run, no cache.
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const suites = {
  parse: "parse.mjs",
  // WS-BURST. The multi-message wait policy — pure, offline, no model call,
  // wired here under the same `dead-writers` test as the suites below.
  burst: "burst.mjs",
  // WS-AWAY. T9 session.clock — the overnight-gap facts, and the negative
  // control that keeps them from becoming a greeting she recites.
  away: "away.mjs",
  // WS-REPEAT. T14 rel.raised — repetition seen, his reception carried
  // alongside it, and the control that keeps her own sentences out of it.
  repeat: "repeat.mjs",
  // WS-HANGUP. "cut the call" read off HIS words — the half of the ask that is
  // structurally decidable, since a voice-lane marker of hers can be spoken.
  hangup: "hangup.mjs",
  // WS-SEARCH. The frequency cap behind the widened (curiosity, not doubt)
  // search trigger — capped in code because a brief cannot enforce a budget.
  search: "search.mjs",
  // WS-CHESS. Rules, her move selection, and the structured move assessment.
  // Standalone, offline, $0, ~17s. Wired the moment it landed, because the
  // workstream that wrote it could not wire it (file ownership) and flagged
  // that `dead-writers` applied to it until someone did — a suite nothing
  // invokes is indistinguishable from a suite that does not exist.
  chess: "chess.mjs",
  // WS-ACTIVITY. The generic "what we are doing together" seam and its chess
  // adapter — plus the control that keeps dialogue out of it, since a line she
  // could say in this block is a line she would say every single game.
  activity: "activity.mjs",
  persona: "persona-invariants.mjs",
  fixtures: "fixtures.mjs",
  // WS-HONESTY. Offline and deterministic (no judge, no model call, no cost),
  // so it belongs in CI by the same test the D0/D1 note below applies. Wired
  // here rather than left as a standalone script because `dead-writers` is
  // this repo's law and it does not stop being true for evals: a suite
  // nothing invokes is indistinguishable from a suite that does not exist.
  honesty: "honesty/run.mjs",
  // WS-TIME. The two clocks (src/engine/timeline.ts) — her day as a pure
  // function of the hour, and what has moved in HIS world since they last
  // spoke. DB-free, network-free, model-free and ~11s, including its own
  // negative control (7 injected defects, 7 caught), so it belongs here by
  // the same `dead-writers` test the honesty suite is wired in under.
  time: "time/run.mjs",
  // WS-BATTERY (SPEC §13/§14): D0/D1 are offline and deterministic — no
  // judge, no model call, no cost — so they run here, in CI, on every build,
  // same as the suites above. D2 and up are judged/generative (real money)
  // and are DELIBERATELY NOT in this map: run them by hand via
  // `node evals/dbattery/d2.mjs` (gated internally behind
  // WSBAT_RUN_JUDGED=1 — see that file's header). Keeping them out of this
  // object, rather than adding an in-loop skip, is the mechanism that makes
  // "D2+ never runs in CI" true by construction instead of by remembering.
  d0: "dbattery/d0.mjs",
  d1: "dbattery/d1.mjs",
  // The judged suites' PLUMBING, not the judged suites: dryrun-check drives
  // judge-backtest and d2 end to end against a deterministic mock — no
  // network, $0, ~0.2s — so a pipeline regression is caught in CI while the
  // by-construction exclusion of real judged runs above stays intact.
  judgedryrun: "dbattery/dryrun-check.mjs",
  // WS-SELFBUNDLE (T-H1). Its OFFLINE half only: manifest declaration, drop
  // priorities and the tail-budget arithmetic for T11/T12/T13. Wired here
  // under the same `dead-writers` test as the two suites above.
  //
  // The suite's ACTUAL gate is `--live`, and it is deliberately NOT reachable
  // from this map: it seeds and tears down rows in the real database under the
  // real agent id, which is not a thing CI may do on every build (and the APK
  // workflow has no NEON_URL at all). Same by-construction exclusion the D2
  // note above describes — run it by hand:
  //     node evals/self/wiring.mjs --live
  selfwiring: "self/wiring.mjs",
  // WS-TRACE (docs/TRACE.md). The OFFLINE half: the content firewall, the
  // correlator replayed over two REAL production turns, the tap's cost, and a
  // structural check that no trace write sits on any reply path. No database,
  // no network, no money, ~2s — so it belongs here by the same test the
  // honesty and time suites are wired in under, and `dead-writers` does not
  // stop being true for evals.
  //
  // Its LIVE half (evals/trace/roundtrip.mjs) is deliberately not in this map,
  // for the same by-construction reason d2 and selfwiring --live are not: it
  // needs NEON_URL and it WRITES. Run it by hand:
  //     node evals/trace/roundtrip.mjs
  trace: "trace/run.mjs",
};
const pick = process.argv[2];
let failed = 0;
for (const [name, file] of Object.entries(suites)) {
  if (pick && pick !== name) continue;
  console.log(`\n── ${name} ──`);
  try {
    execSync(`node ${join(HERE, file)}`, { stdio: "inherit", cwd: ROOT });
  } catch {
    failed++;
  }
}
process.exit(failed ? 1 : 0);
