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
  // WS-GAMES: the chess→words layer — opening book, threat facts, shapelint.
  chesstalk: "chesstalk.mjs",
  // WS-ACTIVITY. The generic "what we are doing together" seam and its chess
  // adapter — plus the control that keeps dialogue out of it, since a line she
  // could say in this block is a line she would say every single game.
  activity: "activity.mjs",
  // Light/dark. Structural, because every way a theme breaks is silent — a
  // dark block reachable one way and not the other looks perfect to whoever
  // happened to have the matching OS setting.
  theme: "theme.mjs",
  // WS-GAMES: would-you-rather — deck lint, her-pick determinism, shapelint.
  wyr: "wyr.mjs",
  // WS-GAMES: tic-tac-toe — exhaustive legality + bounded imperfection.
  ttt: "ttt.mjs",
  // WS-GAMEPLAY: the chat-initiated game invite (src/engine/gameInvite.ts).
  // Deliberately lopsided toward NEGATIVE cases — a missed invite costs one
  // trip to the games menu, a spurious one is the app interrupting a
  // conversation to sell a board.
  gameinvite: "game-invite.mjs",
  // WS-GAMIFY: moments fire once, largest-tier-only, charter-clean.
  milestones: "milestones.mjs",
  // WS-SYNC: the push list, merge semantics and account-switch reset agree.
  sync: "sync.mjs",
  // WS-STATE: the boundary cluster. Move-record validation at the game
  // boundary, user coercion at every adopt, the cross-tab merge, and THE
  // CLASS CHECK: every optional AppState field is either wiped by the
  // teardown or exempted in writing. Offline, $0, ~2s.
  teardown: "teardown.mjs",
  persona: "persona-invariants.mjs",
  fixtures: "fixtures.mjs",
  // WS-HONESTY. Offline and deterministic (no judge, no model call, no cost),
  // so it belongs in CI by the same test the D0/D1 note below applies. Wired
  // here rather than left as a standalone script because `dead-writers` is
  // this repo's law and it does not stop being true for evals: a suite
  // nothing invokes is indistinguishable from a suite that does not exist.
  honesty: "honesty/run.mjs",
  // T-H3 (docs/HONESTY.md). The chat tail that rides the call's ONE assembly,
  // its shape-lint, its budget arithmetic, and the source assertion that every
  // frozen-at-connect compile site carries it. Offline, deterministic, $0,
  // ~2s — wired here rather than left standalone for the reason T-H4 gives:
  // `dead-writers` does not stop applying to evals.
  chattail: "chattail/run.mjs",
  // WS-CALLMEM. The four voice-call defects the first external tester found:
  // the call lane never carried what was said on the PREVIOUS call (chat did,
  // as turns), a long call loses its own beginning to the server's sliding
  // window, "bye" never ended anything, and a failed lookup was silent so she
  // announced a check and then invented. Offline, deterministic, $0, ~3s —
  // wired here rather than left standalone because `dead-writers` does not
  // stop applying to evals.
  callmem: "callmem/run.mjs",
  surface: "surface.mjs",
  // WS-MEMORY: finished games become graph episodes; the laundering predicate;
  // photo-forget path round-trips. Offline, db-free (config stub), ~2s.
  gamemem: "gamemem.mjs",
  // T-H2 (docs/HONESTY.md). An activity is a fact with an expiry: the
  // write-time classifier on SelfFact, the min(3h, next night) render window,
  // and the legacy byte-identity fixture proving a kind-less ledger still
  // renders exactly as it did. Offline, $0, ~2s.
  herlife: "herlife.mjs",
  // WS-AFFECT: one rupture, every channel — the T2 stance block compiles
  // byte-identical across chat/cascade/live/watch, lapses cross all four
  // together, the record never moves, and G2 holds in both directions on
  // both lanes. Offline, $0.
  rupturechannel: "rupture-channel/run.mjs",
  // WS-BURST. The greet-once predicate (src/engine/greeting.ts) and the
  // structural proof that a burst reaches the model as ONE user turn.
  greeting: "greeting.mjs",
  // WS-BURST. The wiring itself: the policy stays in the engine, and the
  // reply chain's flags are taken once and released in a finally — the
  // busy-held-across-recursion class made impossible rather than avoided.
  burstwiring: "burstwiring.mjs",
  // WS-WORLD. The sky-is-the-clock table: five states, their boundaries to
  // the minute, the away.ts dark-window invariant, the moon, and the ?sky=
  // seam the screenshot battery drives. Offline, deterministic, $0, ~2s.
  sky: "sky.mjs",
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
  // WS-DEPTH's own drift check — api/consolidate.js's plain-JS mirrors of
  // relstate.ts's clampTrustDelta/moveTrust/ruptureRepairShift/ruptureStance
  // (+ mapEpisodeCitations/tokenizePhrase, WS-DEPTH-only) against the REAL
  // relstate.ts, bundled fresh via esbuild. Existed already, wired nowhere
  // (`dead-writers`) — no workflow, no npm script, not this file — until
  // now. Offline, $0, no network, no DB.
  wsdepthpure: "wsdepth-test-pure.mjs",
  // #86 rupture_open record-vs-stance split (context/rejected.md
  // `rupture-never-closes`): proves the record survives a lapse untouched,
  // the stance actually lapses on the chosen time/warm-interaction
  // condition, and an explicit new rupture re-opens — including the exact
  // stuck-open-forever gap the ticket was filed for. Offline, fixture-based,
  // $0, bundled fresh from relstate.ts on every run.
  rupturelapse: "rupture-lapse.mjs",
  // WS-SPINE. The consolidation spine: the watch contract's negative test
  // (screen-derived turns can never become durable facts), kin precision
  // including the friend's-mother trap, watch-episode finalization, the
  // grounding checks for rel-state/phrase/pattern/life-told derivation,
  // change-over-time, second-agent parity, and the enablement rails.
  //
  // Wired here specifically because this is the suite that guards the change
  // which turns REAL SPEND ON: the hourly cron has been dry-run since it
  // shipped, and the run that flips it is the first one ever to derive from
  // months of backlog. Offline, deterministic, $0, ~3s — it costs CI nothing
  // and it is the only thing standing between a flipped flag and a fabricated
  // fact about somebody's mother.
  consolidation: "consolidation/run.mjs",
  // WS-RECALL. The retrieval cluster (the Hinglish tokenizer's 19-query
  // battery and its precision negatives, the two dead stores' new readers,
  // RRF fusion, the co-citation hop, and the structural proof that spaced
  // resurfacing is a rank modifier and never a trigger) plus the FATE walk
  // that asks every SERVER store what a forget does to it — the question
  // evals/teardown.mjs asks of every AppState field, one layer down, and the
  // one nobody was asking of the database. Offline, $0, no network, no DB.
  recall: "recall/run.mjs",
  // WS-MEMEVAL. THE LANE-PARITY GATE: one row per context block, one column
  // per lane (chat/cascade/live/watch), a verdict in every cell, and an
  // exemption that must state its reason in writing. It mechanises the rule
  // `rejected.md#call-opens-with-amnesia-by-construction` ends with and left
  // as prose — "every context block that exists must be asserted PRESENT on
  // every lane that claims it" — so the next dark block is caught at commit
  // time instead of by a paying tester. Carries its own negative control
  // (the pre-fix live lane must be seen going dark). Offline, $0, ~3s.
  lanes: "lanes/run.mjs",
  // WS-MEMEVAL / survey A4. The adversarial Hinglish forget battery. NOT a
  // gate: it reports a measured baseline against the CURRENT lexical matcher,
  // which is known to be poor on cross-lingual referents — a gate that fails
  // on a known-unfixed thing is noise, and noise is how a suite stops being
  // read. It fails only if the battery itself breaks or the baseline moves
  // DOWN, which is the direction nobody intends. See its header.
  forgetlex: "forget/a4.mjs",
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
