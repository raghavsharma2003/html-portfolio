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
  check("live core", liveCore.length, OPERATIONAL_CORE_CAP);
  check("live tail (bound)", parts.tail.length + TAIL_EXTRAS + TASTE_EXTRAS, OPERATIONAL_TAIL_CAP);
  check("live core (target, SPEC §3.1)", liveCore.length, CORE_CAP, { warnOnly: true });
  const liveWatchCore = parts.core + buildSpeechStyle("live"); // native watch config's systemLive is identical
  check("live+watch core", liveWatchCore.length, OPERATIONAL_CORE_CAP);
  check(
    "live+watch tail (bound)",
    parts.tail.length + WATCH_MODE_NOTE.length + TAIL_EXTRAS,
    OPERATIONAL_TAIL_CAP,
  ); // watch surface suppresses taste — no TASTE_EXTRAS here
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
