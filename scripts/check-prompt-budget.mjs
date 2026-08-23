// Guard against the failure that once silently deleted her crisis helplines.
// v2 (WS-COMPILER M2): fixture-driven THROUGH THE REAL COMPILER (SPEC §3.3),
// not a hand-rolled re-measurement of persona.ts alone. Stays db-free — this
// runs in the APK workflow (.github/workflows/build-apk.yml), which has no
// NEON_URL — and it is the check-prompt-budget gate `verify-release.mjs`
// already calls, so nothing here needs a new gate file WS-COMPILER doesn't own.
//
// THREE LAYERS, kept visually separate because they answer different
// questions and only one of them may fail the build:
//
//   1. MANIFEST ARITHMETIC (compiler.ts's own numbers) — SPEC §0.2 flaw #2 /
//      §3.3: core cap 40,000 + tail cap 24,000 = SYSTEM_MAX 64,000 exactly,
//      and the undroppable set sits strictly under it. This is arithmetic on
//      constants, always computable, and it is the one CI is told to assert
//      "as numbers, not prose." HARD FAILS the build if broken.
//   2. OPERATIONAL CAPS — what api/chat.js actually slices the live prompt
//      at TODAY (unchanged by the M2 extraction: 64,000 core / 24,000 tail,
//      matching the "no content cut happens at extraction" law, SPEC §0.3
//      "Persona factoring charm risk"). Every real fixture is measured
//      against these. HARD FAILS the build if a compiled prompt would be
//      silently truncated in production right now — this is the guard's
//      original job and it is unchanged.
//   3. TARGET CAPS — the manifest's SPEC-declared numbers (CORE_CAP 40,000,
//      TAIL_CAP 24,000): the shape persona.ts's content is meant to fit
//      AFTER a charm-gated re-authoring pass that has not happened yet. Real
//      CORE content today measures 42.8k–47.1k across lanes — already over
//      this target. Reported LOUDLY as WARN, never failed: failing the build
//      on a target nothing has been asked to hit yet would be exactly the
//      "loud-fail" mechanism turned into busywork, and would block every
//      unrelated PR until someone re-authors 45k characters of the product
//      under a n≥300 dual-judge equivalence gate that is not this script's
//      job to demand. This is the honest, measured gap — see the M2 report.
//
// Also runs the byte-identity fixture battery (src/engine/__fixtures__/) as
// part of this gate, and the compiler's shape-lint structural checks
// (T10 pinned last, appended-last-set-of-exactly-two, CRISIS_LINES intact).
import { execFileSync, execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
let failed = false;
let warned = false;

// ── 0. byte-identity battery (WS-COMPILER's extraction proof) ──────────────
console.log("── byte-identity (compile() vs frozen oldOracle) ──");
try {
  execFileSync("node", [join(ROOT, "src/engine/__fixtures__/byte-identity.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
} catch {
  failed = true;
}

// ── build the bundle every other check reads from ──────────────────────────
const out = join(ROOT, "node_modules/.prompt-budget");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bundle = join(out, "entry.mjs");
execSync(
  `npx esbuild ${join(ROOT, "src/engine/__fixtures__/.budget-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${bundle} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const {
  compile,
  CORE_CAP,
  TAIL_CAP,
  SYSTEM_MAX,
  OPERATIONAL_CORE_CAP,
  OPERATIONAL_TAIL_CAP,
  computeManifestArithmetic,
  assertManifestArithmetic,
  applyDropOrder,
  CRISIS_LINES,
  checkAppendedLastExactlyTwo,
  checkDecisionPositions,
  lintLine,
  lintBlock,
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
  BUDGET_FIXTURES,
  AGE_TIER_SAFETY_OVERRIDE,
} = await import(bundle);

// ── 1. manifest arithmetic — hard fail ──────────────────────────────────────
console.log("\n── manifest arithmetic (SPEC §0.2 flaw #2, §3.3) ──");
try {
  assertManifestArithmetic();
  const a = computeManifestArithmetic();
  console.log(`  ok  CORE_CAP(${CORE_CAP}) + TAIL_CAP(${TAIL_CAP}) = SYSTEM_MAX(${SYSTEM_MAX})`);
  console.log(
    `  ok  undroppable set: actual ${a.undroppableActual} / at-cap ${a.undroppableAtCap} ` +
      `(headroom actual ${a.undroppableHeadroomActual}, at-cap ${a.undroppableHeadroomAtCap})`,
  );
} catch (e) {
  failed = true;
  console.log(`FAIL  ${e.message}`);
}

// ── guard/guarded parity — api/chat.js's literal caps must equal the
//    manifest's declared OPERATIONAL numbers, or the outer guard has drifted
//    from the thing it's supposed to enforce ──
const capOf = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
  if (!m) throw new Error(`could not find ${name} in api/chat.js — guard is stale, fix it`);
  return Number(m[1].replace(/_/g, ""));
};
const chatSrc = readFileSync(join(ROOT, "api/chat.js"), "utf8");
const liveCoreCap = capOf(chatSrc, "SYSTEM_MAX");
const liveTailCap = capOf(chatSrc, "TAIL_MAX");
console.log("\n── guard/guarded parity (api/chat.js vs compiler.ts manifest) ──");
if (liveCoreCap !== OPERATIONAL_CORE_CAP || liveTailCap !== OPERATIONAL_TAIL_CAP) {
  failed = true;
  console.log(
    `FAIL  api/chat.js caps (core=${liveCoreCap}, tail=${liveTailCap}) != compiler.ts OPERATIONAL caps ` +
      `(core=${OPERATIONAL_CORE_CAP}, tail=${OPERATIONAL_TAIL_CAP}) — guard and guarded have drifted`,
  );
} else {
  console.log(`  ok  api/chat.js caps match compiler.ts's declared OPERATIONAL caps exactly`);
}

// ── 2 & 3. fixture-driven checks, through the real compiler ────────────────
console.log("\n── fixtures, through the real compiler (SPEC §3.3) ──");
const check = (label, value, cap, { warnOnly = false } = {}) => {
  const pct = ((value / cap) * 100).toFixed(1);
  const over = value > cap;
  const tight = !over && value > cap * 0.9;
  if (over && !warnOnly) failed = true;
  if (over && warnOnly) warned = true;
  const state = over ? (warnOnly ? "OVER TARGET" : "OVER CAP") : tight ? "tight" : "ok";
  const tag = over ? (warnOnly ? "WARN" : "FAIL") : tight ? "WARN" : "  ok";
  console.log(`${tag}  ${label.padEnd(42)} ${String(value).padStart(6)} / ${cap}  (${pct}%) ${state}`);
};

for (const f of BUDGET_FIXTURES) {
  const { core, tail } = compile(f.input);
  console.log(`\n  [${f.id}] (${f.status}) — ${f.note}`);
  check(`${f.id} core (operational)`, core.length, OPERATIONAL_CORE_CAP);
  check(`${f.id} tail (operational)`, tail.length, OPERATIONAL_TAIL_CAP);
  check(`${f.id} core (target, SPEC §3.1)`, core.length, CORE_CAP, { warnOnly: true });
  check(`${f.id} tail (target, SPEC §3.2)`, tail.length, TAIL_CAP, { warnOnly: true });

  if (!core.includes(CRISIS_LINES)) {
    failed = true;
    console.log(`FAIL  [${f.id}] CRISIS_LINES missing from compiled core — never-truncated core is broken`);
  }

  const hasSearch = f.input.mode === "chat";
  const positions = checkDecisionPositions(tail, hasSearch);
  if (!positions.forgetLast) {
    failed = true;
    console.log(`FAIL  [${f.id}] FORGET_DECISION is not the tail's literal suffix (T10 must be pinned last)`);
  }
  if (hasSearch && !positions.searchLast) {
    failed = true;
    console.log(`FAIL  [${f.id}] SEARCH_DECISION is not positioned immediately before FORGET_DECISION`);
  }
  const appended = checkAppendedLastExactlyTwo(tail, hasSearch);
  if (!appended.ok) {
    failed = true;
    for (const reason of appended.reasons) console.log(`FAIL  [${f.id}] ${reason}`);
  }
}

// ── WS-INTEGRATE seams 1/2: with-state assertions through the REAL
//    compile() path — per-block budgets (T2/T4/T6), shapelint cleanliness,
//    the pull-only law (label changes, row selection never does), and the
//    age-tier UNCONDITIONAL drop (not a hint). Extends the fixture set per
//    the WS-INTEGRATE ticket's own safety-frame requirement. ────────────────
console.log("\n── with-state fixtures (WS-INTEGRATE seams 1/2) ──");
{
  const byId = Object.fromEntries(BUDGET_FIXTURES.map((f) => [f.id, f]));
  const T2_BUDGET = 1200;
  const T4_BUDGET = 1600;
  const T6_BUDGET = 2000;

  // grabs one telegraphic block by its header, up to the next blank-line gap
  const sectionOf = (tail, header) => {
    const i = tail.indexOf(header);
    if (i < 0) return "";
    const rest = tail.slice(i);
    const next = rest.indexOf("\n\n", header.length);
    return next < 0 ? rest : rest.slice(0, next);
  };
  // lint the CONTENT ROWS only ("- " lines), never the static header label —
  // matching relstate.ts's own finish() convention (lintBlock over
  // `lines.join("\n")`, never the header): shapelint targets authored-data
  // rows, not fixed scaffolding text (shapelint.ts's own job #1).
  const contentRows = (s) => s.split("\n").filter((l) => l.startsWith("- ")).join("\n");

  // rupture-open: T2/T4 present, moment-gated, budgets respected, lint clean
  {
    const { tail } = compile(byId["rupture-open"].input);
    const t2 = sectionOf(tail, "RELATIONSHIP STATE");
    const t4 = sectionOf(tail, "PATTERN NOTES");
    if (!t2.includes("repair: open")) {
      failed = true;
      console.log("FAIL  rupture-open: T2 missing rupture/repair content");
    } else {
      console.log("  ok  rupture-open: T2 rel.snapshot renders repair_state");
    }
    if (t2.length > T2_BUDGET) {
      failed = true;
      console.log(`FAIL  rupture-open: T2 over budget (${t2.length}/${T2_BUDGET})`);
    }
    // 20 candidate patterns, only "conflict"-tagged ones (7 of 20) are
    // moment-eligible for this turn's text, capped at 3 by renderDyadicActive
    const patternLines = t4.split("\n").filter((l) => l.startsWith("- "));
    if (patternLines.length < 1 || patternLines.length > 3) {
      failed = true;
      console.log(`FAIL  rupture-open: T4 pattern count out of [1,3]: ${patternLines.length}`);
    } else {
      console.log(`  ok  rupture-open: T4 dyadic.active moment-gated to ${patternLines.length} pattern(s) (cap 3)`);
    }
    if (t4.length > T4_BUDGET) {
      failed = true;
      console.log(`FAIL  rupture-open: T4 over budget (${t4.length}/${T4_BUDGET})`);
    }
    const lint = lintBlock(`${contentRows(t2)}\n${contentRows(t4)}`);
    if (!lint.clean) {
      failed = true;
      console.log(`FAIL  rupture-open: T2/T4 shapelint violations: ${lint.violations.map((v) => v.reasons.join(";")).join(" | ")}`);
    } else {
      console.log("  ok  rupture-open: T2/T4 shapelint clean");
    }
  }

  // pull-only law: identical row selection, header differs ONLY on deixis
  {
    const pulled = compile(byId["we-callbacks-pulled"].input).tail;
    const standing = compile(byId["we-callbacks-standing"].input).tail;
    const t6Pulled = sectionOf(pulled, "SHARED HISTORY");
    const t6Standing = sectionOf(standing, "SHARED HISTORY");
    const rowsOf = (s) => s.split("\n").filter((l) => l.startsWith("- ")).sort().join("\n");
    if (!t6Pulled.includes("ACTIVE")) {
      failed = true;
      console.log("FAIL  we-callbacks-pulled: expected ACTIVE label");
    }
    if (!t6Standing.includes("STANDING BACKGROUND")) {
      failed = true;
      console.log("FAIL  we-callbacks-standing: expected STANDING BACKGROUND label");
    }
    if (t6Standing.includes("ACTIVE") || t6Pulled.includes("STANDING BACKGROUND")) {
      failed = true;
      console.log("FAIL  we-callbacks: pull-only labels bled into the wrong fixture");
    }
    if (rowsOf(t6Pulled) !== rowsOf(t6Standing)) {
      failed = true;
      console.log("FAIL  we-callbacks: row SELECTION changed with the pull signal — pulled must change only the label (SPEC §6.3)");
    } else {
      console.log("  ok  we-callbacks: pull signal changes ONLY the header label, never row selection (0-unprompted-raises mechanism)");
    }
    // the 3rd WE_EPISODES fixture row (no shared-action token) must never render
    if (t6Pulled.includes("no shared-action token") || t6Standing.includes("no shared-action token")) {
      failed = true;
      console.log("FAIL  we-callbacks: a WE_TOKEN_RE-failing row leaked into T6");
    } else {
      console.log("  ok  we-callbacks: WE_TOKEN_RE client-side re-check holds (bad row never rendered)");
    }
    if (t6Pulled.length > T6_BUDGET || t6Standing.length > T6_BUDGET) {
      failed = true;
      console.log("FAIL  we-callbacks: T6 over budget");
    }
    // The " [21 aug]" episode-date suffix (relstate.ts weDay, P1-6) is
    // bracketed metadata, not a recitable clause — strip it before the word
    // count so a writer-capped 14-word summary plus its date does not read
    // as a 15-word line. Only the exact date shape is stripped.
    const stripWeDay = (b) => b.replace(/ \[\d{1,2} [a-z]{3}\]/g, "");
    const lint = lintBlock(stripWeDay(`${contentRows(t6Pulled)}\n${contentRows(t6Standing)}`));
    if (!lint.clean) {
      failed = true;
      console.log(`FAIL  we-callbacks: shapelint violations: ${lint.violations.map((v) => v.reasons.join(";")).join(" | ")}`);
    } else {
      console.log("  ok  we-callbacks: T6 shapelint clean");
    }
  }

  // age-tier hard-refusal: an UNCONDITIONAL drop, asserted against the real
  // compiled output — not merely that a flag was read
  {
    const { core: minorCore, tail: minorTail } = compile(byId["minor-tier"].input);
    if (!minorCore.includes(AGE_TIER_SAFETY_OVERRIDE)) {
      failed = true;
      console.log("FAIL  minor-tier: AGE_TIER_SAFETY_OVERRIDE missing from core");
    } else {
      console.log("  ok  minor-tier: AGE_TIER_SAFETY_OVERRIDE present, appended to the never-truncated core");
    }
    if (minorTail.includes("RELATIONSHIP STATE") || minorTail.includes("PATTERN NOTES")) {
      failed = true;
      console.log("FAIL  minor-tier: T2/T4 present despite romanceRegisters:false — must be an UNCONDITIONAL drop, not a hint");
    } else {
      console.log("  ok  minor-tier: T2/T4 unconditionally absent under the minor-safe gate, despite a real relBundle present");
    }
    const { core: okCore, tail: okTail } = compile(byId["age-tier-unrestricted"].input);
    if (okCore.includes(AGE_TIER_SAFETY_OVERRIDE)) {
      failed = true;
      console.log("FAIL  age-tier-unrestricted: override present despite romance:true/engagement:true");
    }
    if (!okTail.includes("RELATIONSHIP STATE")) {
      failed = true;
      console.log("FAIL  age-tier-unrestricted: T2 missing despite an unrestricted gate");
    } else {
      console.log("  ok  age-tier-unrestricted: gate is a real conditional (content flows when gates are open), not a permanently-on override");
    }
  }
}

// ── live lane (useCallEngine.ts tryStartLive / native watch config) ────────
// NOT compiled through compiler.ts — a real, separate assembly call site
// (M2 report deviation #3). Measured directly here, matching v1's approach,
// so this gate doesn't lose the one check that once caught the live lane at
// 45,042 chars (93.8% of the old cap).
console.log("\n── live lane (useCallEngine.ts — independent of compiler.ts) ──");
{
  const LIVE_USER = {
    name: "Aaaaaaaaaaaaaaaaaaaa",
    vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
    facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
  };
  const parts = buildSystemPromptParts(LIVE_USER, 999, "voice");
  const liveCore = parts.core + buildSpeechStyle("live");
  // tryStartLive's tail: parts.tail + inner.thread + [memories block] +
  // [herLife block] + inner.wants — no cultureNote, no SEARCH_DECISION, no
  // FORGET_DECISION (persona.ts tells her plainly she can't delete mid-call).
  // Bounds mirror check-prompt-budget v1's TAIL_EXTRAS/TASTE_EXTRAS comment.
  const TAIL_EXTRAS = 12 * 570 + 900 + 12 * 150 + 370 + 1_500;
  const TASTE_EXTRAS = 1_100; // inner.ts suppresses taste+week-shape on surface "watch" only
  // ── WHAT THIS BOUND STILL DOES NOT COUNT (WS-CALLLANE, 2026-08-23) ─────
  // Stated because an unstated omission is how a guard becomes a lie, and
  // NOT fixed here because fixing it is a product decision rather than an
  // arithmetic one.
  //
  // TAIL_EXTRAS is v1's: graph recall, herLife, and inner (thread + wants).
  // Both live compile sites also pass `relBundle` and `selfBundle`, which
  // light T2 (1,200) + T3 (1,000) + T6 (2,000) + T11 (600) + T13 (700), and
  // the live site's `activity` lights T15 (420) — 5,920 manifest bytes this
  // number has never included. They render only for a person a consolidation
  // pass has already run for, which is why the omission has never been felt,
  // and the honest worst case for an established user is therefore ~5,900
  // above what this prints.
  //
  // Adding them would put `live+watch tail (bound)` over 24,000 immediately,
  // i.e. the fix is "drop a block from the call lanes", which needs an owner
  // and an ear. Filed rather than performed. Every term added BELOW this line
  // is counted honestly against the number as it stands.
  //
  // ── WATCH_NO_THREAD: a reclaim, not a shave ───────────────────────────
  // `innerContext` computes `allowThread = gapEntry && !sheInitiated &&
  // surface !== "watch"`, so on the watch surface the carried-feeling block
  // and the week-shape block that shares its gate are structurally
  // unreachable — the native-watch compile site passes `innerThread: ""` and
  // could not do otherwise. TAIL_EXTRAS' last term (1,500) covers "her
  // carried feeling (one thread) and up to 3 wants"; this gives back only the
  // FIXED prose of the longer (negative) thread variant, measured from
  // inner.ts, leaving `thread.text`, the pickup suffix and the whole
  // week-shape allowance inside the 1,500 as headroom.
  // evals/callmem/run.mjs negative-tests the claim by rendering the same
  // interior on surface "pickup" and on surface "watch".
  // Measured 2026-08-23 at 455 characters of fixed prose; 450 is taken, so
  // the reclaim is strictly smaller than the thing reclaimed.
  const WATCH_NO_THREAD = -450;
  // ── WS-CALLMEM ────────────────────────────────────────────────────────
  // What guards the CALL brief is this block and nothing else: the live
  // prompt never passes through api/chat.js, so the operational caps above
  // reach it only because this section measures it against them by hand.
  // Every new block on this lane therefore has to be added HERE or it is
  // unguarded — which is the same "the guard exists and nobody extended it"
  // shape `engine-bundle-check-uncalled` records.
  //
  // BOTH lanes now carry the shared-history block (useCallEngine.ts folds it
  // into the `memories` string at the ring, so the live compile and the
  // native-watch compile both get it).
  const SHARED_HISTORY_EXTRAS = 700; // src/voice/callHistory.ts SHARED_HISTORY_BUDGET
  // WS-GAMEMEM's local activity ledger, call-sized. Rides the same `memories`
  // string (assembly-side, at the ring), so BOTH call lanes carry it — and it
  // is the family-6 fence on the one lane where the honesty gate cannot run.
  // Net cost is at most this: when it renders, `withoutServerActivityBlock`
  // takes the server's copy back out of the recall.
  const CALL_ACTIVITY_EXTRAS = 300; // src/voice/callHistory.ts CALL_ACTIVITY_BUDGET
  // ── WS-SHARENOW: the just-happened block ──────────────────────────────
  // What they did in the last 45 minutes — her own lines over a screen share,
  // a game that just closed, a call that just ended. Rides the same `memories`
  // string at the ring (`callGraphBlocks`), so BOTH call lanes carry it, and
  // it is FIRST in that string because it is the block a later round trip can
  // least re-derive (the share mirror is device-local).
  //
  // THE ARITHMETIC, stated because this term is what makes the margin below
  // small: before it, `live+watch tail (bound)` stood at 29,684 of 30,000
  // (316 spare) and `live tail (bound)` at 29,382 (618 spare). 300 of them is
  // this, leaving 16 and 318. evals/callmem/run.mjs asserts that subtraction
  // against these constants, so the bound and the budget cannot drift apart.
  // The margin on the watch lane is now genuinely 16 bytes: the NEXT block
  // anyone adds to a call lane trips this line, which is what the CALL_TAIL_CAP
  // note below says it is for.
  const JUST_HAPPENED_EXTRAS = 300; // src/voice/callHistory.ts JUST_HAPPENED_BUDGET
  // ── WS-CALLLANE: the session-fact slots, now on BOTH call lanes ────────
  // `nowMs` (T9, away.ts AWAY_BUDGET), `herCommitments` (T16, compiler.ts
  // HER_COMMITMENTS_BUDGET) and `recentTurns` (T14, repeat.ts RAISED_BUDGET).
  // The name changed from LIVE_ONLY_EXTRAS because the asymmetry it recorded
  // is gone: the native-watch compile passes all three too, paid for by
  // WATCH_NO_THREAD above. evals/callmem/run.mjs asserts every one of these
  // against the SOURCE of both call sites, so this bound cannot quietly
  // become a lie about what either site does.
  //
  // T15 session.activity rides `nowMs` too (renderActivity), but only the
  // LIVE site passes an `activity`, so it is structurally zero on watch. It
  // is not added here because it was already renderable on the live lane
  // before this change and was already uncounted — it belongs to the omission
  // recorded above (420 of that ~5,500), not to this term.
  const CALL_CLOCK_EXTRAS = 300 + 400 + 400;
  // The LIVE lane alone additionally passes `latestUserText` (the last thing
  // he typed before dialling, when it is fresh), which un-darks the two
  // moment-gated slots: T4 dyadic.active (1,600) and T12 self.arc (500). Both
  // returned "" on every call ever taken, because `momentGate("")` is moment
  // "none" and both renderers refuse it. The watch site cannot afford these —
  // see its own comment for the arithmetic.
  const LIVE_ONLY_EXTRAS = 1_600 + 500;
  // P1-4's cached-recall label (`withRecallAge`, RECALL_AGE_NOTE_MAX). Rides
  // the `memories` string, so BOTH lanes carry it, and only on the calls where
  // the ring fetch missed its deadline.
  const RECALL_AGE_EXTRAS = 80;
  // ── THE SIX BLOCKS THE BOUND NEVER COUNTED (coordinator, 2026-08-23) ───
  // WS-CALLLANE measured that T2 (1,200) + T3 (1,000) + T6 (2,000) +
  // T11 (600) + T13 (700) + T15 (420) all render on the call lanes for a
  // user the consolidation pass has run for, and none were in this
  // arithmetic — the bound passed by omission. Decision: count them and
  // raise the call-lane cap rather than drop memory blocks from calls; the
  // whole memory wave exists so that every lane is the same person, and the
  // marginal cost of the larger brief is ~$0.001/call at 2026 list price.
  // CALL_TAIL_CAP replaces OPERATIONAL_TAIL_CAP for the two call bounds only;
  // the chat tail keeps the original cap. Margin kept deliberately modest so
  // the next unplanned growth trips this line, not production.
  const RELATIONAL_BLOCK_EXTRAS = 1_200 + 1_000 + 2_000 + 600 + 700 + 420;
  // ── WS-HERNOW: ZERO ON THESE TWO LANES, AND THE ZERO IS THE POINT ──────
  // T7 gained a second half — her present minute, ~583 chars worst case
  // (`HER_NOW_WORST_CASE_CHARS`, tied to this number by evals/hernow.mjs).
  // It is counted as 0 here because NEITHER call site passes it, and the
  // reason is honesty rather than arithmetic: both of these prompts are
  // FROZEN (the live one at connect, the watch one when the share starts) and
  // the block carries an ELAPSED. "going on: about 20 min" baked in at pickup
  // is false forty minutes into the call. Her present reaches these lanes
  // through direct() — CALL_OPEN_DIRECTIVE's `scene`, an uplink frame rather
  // than this tail, worded from the same ledger row at the instant it is
  // true. The chat and cascade lanes DO carry the block; it is counted for
  // them where their bound is measured, inside HEAVY_HERLIFE
  // (src/engine/__fixtures__/budget.fixtures.ts), through the REAL renderer.
  // If either call site ever starts passing a present entry, this term stops
  // being 0 and the two `check(...)` calls below are where it is paid for.
  const HER_NOW_EXTRAS = 0;
  const CALL_TAIL_CAP = 30_000;

  // P0-2's mid-call re-query is deliberately NOT here. Its rows never enter a
  // compile: on the live lane they ride a silent direct() frame (uplink, not
  // prompt) and on the cascade lane they ride `extraMemories`, which is
  // api/chat.js's own sliced tail rather than this hand-measured one.
  // `MEMORY_NOTE_BUDGET` bounds it and evals/callmem/run.mjs asserts it.
  check("live core", liveCore.length, OPERATIONAL_CORE_CAP);
  check(
    "live tail (bound)",
    parts.tail.length +
      TAIL_EXTRAS +
      TASTE_EXTRAS +
      SHARED_HISTORY_EXTRAS +
      CALL_ACTIVITY_EXTRAS +
      JUST_HAPPENED_EXTRAS +
      RECALL_AGE_EXTRAS +
      CALL_CLOCK_EXTRAS +
      RELATIONAL_BLOCK_EXTRAS +
      HER_NOW_EXTRAS +
      LIVE_ONLY_EXTRAS,
    CALL_TAIL_CAP,
  );
  check("live core (target, SPEC §3.1)", liveCore.length, CORE_CAP, { warnOnly: true });
  const liveWatchCore = parts.core + buildSpeechStyle("live"); // native watch config's systemLive is identical
  check("live+watch core", liveWatchCore.length, OPERATIONAL_CORE_CAP);
  check(
    "live+watch tail (bound)",
    parts.tail.length +
      WATCH_MODE_NOTE.length +
      TAIL_EXTRAS +
      WATCH_NO_THREAD +
      SHARED_HISTORY_EXTRAS +
      CALL_ACTIVITY_EXTRAS +
      JUST_HAPPENED_EXTRAS +
      RECALL_AGE_EXTRAS +
      CALL_CLOCK_EXTRAS +
      RELATIONAL_BLOCK_EXTRAS +
      HER_NOW_EXTRAS,
    CALL_TAIL_CAP,
  ); // watch surface suppresses taste AND the carried thread — see above
  if (!liveCore.includes(CRISIS_LINES)) {
    failed = true;
    console.log("FAIL  live lane core is missing CRISIS_LINES");
  }
}

// ── shape-lint self-check (SPEC §3.3, `recited-prompt` law) ────────────────
// Proves lintLine/lintBlock actually catch the two measured failure shapes
// (sentence-shaped English, first-person-Meera line-initial) on a clean vs.
// a deliberately bad sample — a linter nobody has shown catches anything is
// not a guard. This does NOT lint persona.ts's core prose (see shapelint.ts
// header): it lints the shape real TAIL content rows are meant to have.
console.log("\n── shape-lint self-check (does the linter actually catch the recited-prompt shape?) ──");
{
  const telegraphic = "- goa trip (event, 2 days ago): planned with college friends for december";
  const recitable = "I told him I was so tired yesterday and it really helped.";
  const cleanReport = lintLine(telegraphic);
  const badReport = lintLine(recitable);
  if (cleanReport.reasons.length) {
    failed = true;
    console.log(`FAIL  telegraphic sample flagged (false positive): ${cleanReport.reasons.join("; ")}`);
  } else {
    console.log(`  ok  telegraphic sample passes clean: "${telegraphic}"`);
  }
  if (!badReport.reasons.length) {
    failed = true;
    console.log(`FAIL  sentence-shaped first-person sample was NOT caught (false negative): "${recitable}"`);
  } else {
    console.log(`  ok  recited-prompt-shaped sample caught: ${badReport.reasons.join("; ")}`);
  }
  // and a block-level pass over a fixture's actual memory content, with the
  // allowlist proven to exempt what it's supposed to (CRISIS_LINES-style verbatim rows)
  const block = lintBlock(`${telegraphic}\n${recitable}`, [recitable]);
  if (block.violations.length !== 0 || block.linesChecked !== 1) {
    failed = true;
    console.log(`FAIL  lintBlock allowlist did not exempt the allowlisted line as expected`);
  } else {
    console.log(`  ok  lintBlock allowlist exempts the one allowlisted line, still catches nothing else wrong`);
  }
}

// ── forced-overflow fixture: proves the declared drop order actually
//    executes (SPEC §3.3's check-prompt-budget-v2 requirement) — synthetic,
//    so it doesn't depend on persona.ts's real (currently over-target) size ──
console.log("\n── forced-overflow drop-order simulation ──");
{
  const synthetic = [
    { id: "T1", priority: "never", text: "x".repeat(1_500) },
    { id: "T5", priority: 2, text: "x".repeat(5_000) },
    { id: "T7", priority: 1, text: "x".repeat(2_000) }, // lower drop-prio: sacrificed first
    { id: "T8", priority: "never", text: "x".repeat(800) },
    { id: "T9", priority: "never", text: "x".repeat(300) },
    { id: "T10", priority: "never", text: "x".repeat(2_000) },
  ];
  // never-block total 4,600; +T7+T5 = 11,600 > cap, but 4,600+T5 alone =
  // 9,600 fits — dropping ONLY T7 (prio 1) is enough, so T5 (prio 2) must survive
  const capChars = 10_000;
  const result = applyDropOrder(synthetic, capChars);
  const keptIds = result.kept.map((b) => b.id).sort();
  const neverIds = synthetic.filter((b) => b.priority === "never").map((b) => b.id).sort();
  const neverAllKept = neverIds.every((id) => keptIds.includes(id));
  // T7 (drop prio 1) is sacrificed before T5 (drop prio 2) is ever touched
  const t7Dropped = result.dropped.some((b) => b.id === "T7");
  const t5Kept = result.kept.some((b) => b.id === "T5");
  if (!neverAllKept) {
    failed = true;
    console.log(`FAIL  undroppable blocks were dropped: kept=${keptIds.join(",")}`);
  } else {
    console.log(`  ok  all "never" blocks retained: ${neverIds.join(", ")}`);
  }
  if (!(t7Dropped && t5Kept)) {
    failed = true;
    console.log(`FAIL  drop order wrong: expected T7 (prio 1) dropped before T5 (prio 2)`);
  } else {
    console.log(`  ok  drop order executes lowest-priority-first: T7 dropped, T5 kept`);
  }
  console.log(`  ok  kept set totals ${result.totalChars} chars (cap ${capChars})`);
}

console.log(
  warned
    ? "\nNOTE: real CORE content exceeds the SPEC §3.1 TARGET cap on some lanes (WARN above, not failing " +
        "the build — no content cut has happened at extraction per SPEC §0.3; the operational caps that " +
        "actually gate production are still enforced and green)."
    : "",
);

if (failed) {
  console.error(
    "\nA hard gate failed — either the OPERATIONAL prompt caps (what api/chat.js actually enforces " +
      "today) were exceeded, the manifest's own arithmetic is broken, the compiler drifted from its " +
      "frozen byte-identity oracle, or a structural shape-lint assertion (T10 last, CRISIS_LINES intact, " +
      "appended-last-set-of-two) failed. Do not ignore this.",
  );
  process.exit(1);
}
console.log("\nprompt budget ok");
