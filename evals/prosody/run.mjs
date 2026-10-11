// WS-R168. EmotionOS in the voice: `api/_voice/prosody.js`, proven offline
// against the 60-line, three-language fixture (`fixtures.mjs`) and a
// deterministic "fake waveform" measure (`estimateProsodyTimingMs`, this
// file's own honest-scope proxy — see `prosody.js`'s own comment on it).
//
//   node evals/prosody/run.mjs
//
// SECTION 1 proves the plan is well-formed for all 60 lines, in their own
// language, with no vibe and no register. SECTION 2 is the NEGATIVE CONTROL
// the brief names by name: a neutral plan (no vibe set, no register) leaves
// the base style byte-identical AND the text byte-identical, on all 60
// lines. SECTION 3 proves the plan changes the produced TIMING
// deterministically: for the SAME text, a "high energy" vibe is measurably
// faster than a "low energy" vibe, which is measurably faster once a
// "flat"/"upset" register applies on top of it — a strict, monotone
// ordering, checked on every one of the 60 lines. SECTION 4 proves the
// pause glyph is inserted only where the plan says it should be. SECTION 5
// proves `applyStyleDelta` never leaves the provider's own validated ranges,
// across every extreme of vibe and register. SECTION 6 is `planSha256`
// determinism — the same inputs hash the same, different inputs hash
// differently.
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import {
  NEUTRAL_PROSODY_PLAN,
  ZERO_STYLE_DELTA,
  applyProsodyPauses,
  applyStyleDelta,
  buildProsodyPlan,
  estimateProsodyTimingMs,
} from "../../api/_voice/prosody.js";
import { PROSODY_LINES } from "./fixtures.mjs";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// Hinglish is synthesised as "hi" — the SAME convention every other voice
// module in this directory uses (`hindi-text-frontend.js`'s own header).
const languageIdOf = (lang) => (lang === "en" ? "en" : "hi");

const BASE_STYLE = Object.freeze({ exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8 });

const HIGH_ENERGY_VIBE = Object.freeze({ warmth: 4, energy: 4, humour: 3, directness: 3, formality: 0 });
const LOW_ENERGY_VIBE = Object.freeze({ warmth: 0, energy: 0, humour: 0, directness: 0, formality: 4 });

console.log(`── ${PROSODY_LINES.length}-line fixture across en / hi / hi-Latn ──`);
{
  const byLang = { en: 0, hi: 0, "hi-Latn": 0 };
  for (const line of PROSODY_LINES) byLang[line.lang] = (byLang[line.lang] || 0) + 1;
  ok("the fixture itself carries exactly 60 lines", PROSODY_LINES.length === 60, `(actually ${PROSODY_LINES.length})`);
  ok("20 per language", byLang.en === 20 && byLang.hi === 20 && byLang["hi-Latn"] === 20, JSON.stringify(byLang));
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 1 — every line produces a well-formed plan
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 1: a well-formed plan for every line, in its own language ──");
{
  let allWellFormed = true;
  for (const line of PROSODY_LINES) {
    const plan = buildProsodyPlan({ vibe: null, register: null, languageId: languageIdOf(line.lang) });
    if (
      plan.languageId !== languageIdOf(line.lang) ||
      !["slow", "medium", "fast"].includes(plan.rateBand) ||
      !["low", "medium", "high"].includes(plan.energyBand) ||
      !["narrow", "normal", "wide"].includes(plan.pitchRangeBand) ||
      !Number.isInteger(plan.pauseSentenceMs) || !Number.isInteger(plan.pauseClauseMs) ||
      typeof plan.planSha256 !== "string" || !plan.planSha256
    ) {
      allWellFormed = false;
      console.log(`    malformed plan for ${line.id}`, plan);
    }
  }
  ok("all 60 lines produce a well-formed plan", allWellFormed);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 2 — NEGATIVE CONTROL: the neutral plan changes nothing
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 2: NEGATIVE CONTROL — no vibe, no register, changes nothing ──");
{
  let styleUnchanged = true;
  let textUnchanged = true;
  for (const line of PROSODY_LINES) {
    const plan = buildProsodyPlan({ vibe: null, register: null, languageId: languageIdOf(line.lang) });
    const style = applyStyleDelta(BASE_STYLE, plan.styleDelta);
    if (JSON.stringify(style) !== JSON.stringify(BASE_STYLE)) { styleUnchanged = false; }
    if (applyProsodyPauses(line.text, plan) !== line.text) { textUnchanged = false; }
  }
  ok("applyStyleDelta(base, neutralPlan.styleDelta) === base, on all 60 lines", styleUnchanged);
  ok("applyProsodyPauses(text, neutralPlan) === text, byte for byte, on all 60 lines", textUnchanged);

  ok("ZERO_STYLE_DELTA and the neutral plan's own styleDelta agree",
    JSON.stringify(NEUTRAL_PROSODY_PLAN.styleDelta) === JSON.stringify(ZERO_STYLE_DELTA));
  ok("applyStyleDelta(base, ZERO_STYLE_DELTA) === base (the explicit no-op path every caller falls back to)",
    JSON.stringify(applyStyleDelta(BASE_STYLE, ZERO_STYLE_DELTA)) === JSON.stringify(BASE_STYLE));
  ok("buildProsodyPlan({}) === NEUTRAL_PROSODY_PLAN's own en shape",
    JSON.stringify(buildProsodyPlan({ vibe: null, register: null, languageId: "en" })) === JSON.stringify(NEUTRAL_PROSODY_PLAN));

  // A malformed / absent vibe degrades to the SAME neutral plan as an
  // explicit `null` — never a thrown error, never a different shape.
  const fromUndefined = buildProsodyPlan({ languageId: "en" });
  const fromGarbage = buildProsodyPlan({ vibe: { warmth: "not-a-number", energy: -5 }, register: "not-an-object", languageId: "en" });
  ok("an entirely absent vibe/register argument list is the neutral plan",
    JSON.stringify(fromUndefined) === JSON.stringify(NEUTRAL_PROSODY_PLAN));
  ok("a malformed vibe/register degrades to the neutral plan rather than throwing",
    JSON.stringify(fromGarbage) === JSON.stringify(NEUTRAL_PROSODY_PLAN));

  // A low-confidence or "neutral" register is likewise inert — the SAME
  // render gate `renderRegisterHint` (`register.ts`) applies, restated here.
  const lowConfidence = buildProsodyPlan({ vibe: null, register: { register: "excited", confidence: "low" }, languageId: "en" });
  const neutralRegister = buildProsodyPlan({ vibe: null, register: { register: "neutral", confidence: "high" }, languageId: "en" });
  ok("low-confidence register never applies", JSON.stringify(lowConfidence) === JSON.stringify(NEUTRAL_PROSODY_PLAN));
  ok("\"neutral\" register never applies, even at high confidence", JSON.stringify(neutralRegister) === JSON.stringify(NEUTRAL_PROSODY_PLAN));
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 3 — the plan changes the MEASURED TIMING, monotonically
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 3: measured timing is strictly ordered, on every line ──");
{
  const rows = [];
  let allMonotone = true;
  for (const line of PROSODY_LINES) {
    const languageId = languageIdOf(line.lang);
    const fast = buildProsodyPlan({ vibe: HIGH_ENERGY_VIBE, register: { register: "excited", confidence: "high" }, languageId });
    const medium = buildProsodyPlan({ vibe: null, register: null, languageId });
    const slow = buildProsodyPlan({ vibe: LOW_ENERGY_VIBE, register: { register: "flat", confidence: "high" }, languageId });
    const msFast = estimateProsodyTimingMs(line.text, fast);
    const msMedium = estimateProsodyTimingMs(line.text, medium);
    const msSlow = estimateProsodyTimingMs(line.text, slow);
    rows.push({ id: line.id, lang: line.lang, msFast, msMedium, msSlow });
    if (!(msFast < msMedium && msMedium < msSlow)) allMonotone = false;
  }
  ok("every one of the 60 lines: excited+high-energy < neutral < flat+low-energy, strictly", allMonotone);

  // The measurement table this workstream's brief names — a sample printed
  // here for the transcript, the full 60-row table logged to
  // `context/measurements.md`.
  console.log("    sample (first 3 of 60):");
  for (const row of rows.slice(0, 3)) {
    console.log(`      ${row.id} (${row.lang}): fast=${row.msFast}ms medium=${row.msMedium}ms slow=${row.msSlow}ms`);
  }

  const meanFast = Math.round(rows.reduce((a, r) => a + r.msFast, 0) / rows.length);
  const meanMedium = Math.round(rows.reduce((a, r) => a + r.msMedium, 0) / rows.length);
  const meanSlow = Math.round(rows.reduce((a, r) => a + r.msSlow, 0) / rows.length);
  console.log(`    means over 60 lines: fast=${meanFast}ms medium=${meanMedium}ms slow=${meanSlow}ms`);
  ok("means are strictly ordered too (not just line-by-line)", meanFast < meanMedium && meanMedium < meanSlow);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 4 — the pause glyph lands exactly where the plan says it should
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 4: applyProsodyPauses inserts the glyph only where the plan calls for it ──");
{
  let correctPlacement = true;
  for (const line of PROSODY_LINES) {
    const languageId = languageIdOf(line.lang);
    const slow = buildProsodyPlan({ vibe: LOW_ENERGY_VIBE, register: null, languageId });
    const fast = buildProsodyPlan({ vibe: HIGH_ENERGY_VIBE, register: null, languageId });
    const sentenceCount = (line.text.match(/[.!?।॥]+/g) || []).length || 1;
    const slowResult = applyProsodyPauses(line.text, slow);
    const fastResult = applyProsodyPauses(line.text, fast);
    const glyphCount = (slowResult.match(/…/g) || []).length;
    // A single-sentence line never gets a glyph (nothing to separate); a
    // multi-sentence line under a "slow" plan gets exactly (sentences - 1).
    const expectedGlyphs = sentenceCount > 1 ? sentenceCount - 1 : 0;
    if (glyphCount !== expectedGlyphs) { correctPlacement = false; console.log(`    ${line.id}: expected ${expectedGlyphs} glyphs, got ${glyphCount}`); }
    if (fastResult !== line.text) { correctPlacement = false; console.log(`    ${line.id}: fast band must never insert a glyph`); }
  }
  ok("every line: slow band inserts exactly (sentence count - 1) glyphs; fast band inserts none", correctPlacement);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 5 — applyStyleDelta never leaves the provider's own ranges
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 5: applyStyleDelta stays inside open-chatterbox-preview.js's own validated ranges ──");
{
  const VIBES = [
    { warmth: 0, energy: 0, humour: 0, directness: 0, formality: 0 },
    { warmth: 4, energy: 4, humour: 4, directness: 4, formality: 4 },
    { warmth: 4, energy: 0, humour: 4, directness: 0, formality: 4 },
    { warmth: 0, energy: 4, humour: 0, directness: 4, formality: 0 },
  ];
  const REGISTERS = [null, { register: "excited", confidence: "high" }, { register: "rushed", confidence: "high" },
    { register: "upset", confidence: "high" }, { register: "flat", confidence: "high" }];
  let allInRange = true;
  for (const vibe of VIBES) {
    for (const register of REGISTERS) {
      const plan = buildProsodyPlan({ vibe, register, languageId: "en" });
      const style = applyStyleDelta(BASE_STYLE, plan.styleDelta);
      if (style.exaggeration < 0 || style.exaggeration > 1.5) allInRange = false;
      if (style.cfgWeight < 0 || style.cfgWeight > 1) allInRange = false;
      if (style.temperature < 0.2 || style.temperature > 1.5) allInRange = false;
    }
  }
  ok("every extreme vibe x register combination stays inside exaggeration [0,1.5] / cfgWeight [0,1] / temperature [0.2,1.5]",
    allInRange);

  // Also true at the far edge of an already-extreme BASE style (a caller
  // whose preset is already near a boundary, e.g. the "animated" preset's
  // own 0.96 exaggeration / 0.22 cfgWeight — `_replica-voice-preview.js`'s
  // own STYLE_PRESETS table).
  const edgeBase = { exaggeration: 0.96, cfgWeight: 0.22, temperature: 0.98 };
  let edgeInRange = true;
  for (const register of REGISTERS) {
    const plan = buildProsodyPlan({ vibe: { warmth: 4, energy: 4, humour: 4, directness: 4, formality: 0 }, register, languageId: "en" });
    const style = applyStyleDelta(edgeBase, plan.styleDelta);
    if (style.exaggeration < 0 || style.exaggeration > 1.5 || style.cfgWeight < 0 || style.cfgWeight > 1 ||
        style.temperature < 0.2 || style.temperature > 1.5) edgeInRange = false;
  }
  ok("an already-near-boundary base style (the \"animated\" preset) still clamps into range", edgeInRange);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 6 — planSha256 determinism
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 6: planSha256 is deterministic ──");
{
  const a = buildProsodyPlan({ vibe: HIGH_ENERGY_VIBE, register: { register: "excited", confidence: "high" }, languageId: "hi" });
  const b = buildProsodyPlan({ vibe: HIGH_ENERGY_VIBE, register: { register: "excited", confidence: "high" }, languageId: "hi" });
  const c = buildProsodyPlan({ vibe: LOW_ENERGY_VIBE, register: { register: "excited", confidence: "high" }, languageId: "hi" });
  ok("the SAME inputs hash the SAME", a.planSha256 === b.planSha256);
  ok("DIFFERENT inputs hash DIFFERENTLY", a.planSha256 !== c.planSha256);
  ok("a different languageId alone changes the hash",
    a.planSha256 !== buildProsodyPlan({ vibe: HIGH_ENERGY_VIBE, register: { register: "excited", confidence: "high" }, languageId: "en" }).planSha256);
}

console.log("\n── verdict ──");
console.log(`  total assertions   ${pass + fail}`);
console.log(`\nprosody: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
