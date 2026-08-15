// D0 — the swap-test battery's validity gate (SPEC.md §14.1, §7.3
// "D0 backtest wired first", docs/research/swap-test.md "D0 — backtest the
// battery itself").
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a battery that PASSES any of the
// three archived bake-offs (charm-grok, charm-luna, realtime-azure) is
// broken and must not be trusted for anything downstream. This is therefore
// not a suite that happens to check the archives — it is the actual D0
// gate: it FAILS THE BUILD (exit 1) unless all three fixtures are FLAGGED.
//
// THE LUNA LESSON, made structural rather than special-cased: charm-luna
// TIES the judged charm comparison (17-18, p=1.00) and even WINS specificity
// (9-25) — a battery that only measures charm-style preference PASSES luna.
// Judged preference is therefore excluded from the flag decision entirely
// below, on statistical grounds independent of luna's story: this repo's own
// `fab-noise-floor` measurement says judged rates are noise under n=300, and
// every archive here carries only 48-96 judged units. Only DETERMINISTIC
// axes (word counts, tag regexes, ratios — no judge, no LLM, no noise floor
// per swap-test.md §2.1 rule 1) may cause a flag. Judged numbers are computed
// and printed for context, explicitly labeled UNDERPOWERED, and never gate.
//
//   node evals/dbattery/d0.mjs
//
// Offline, deterministic, a few hundred ms. Wired into evals/run.mjs as a
// default (CI) suite — see that file's comment on why D0/D1 run in CI and
// D2+ do not.
import { loadAllFixtures, loadFixtureIndex } from "../archives/load.mjs";
import {
  wordCountStats,
  questionShare,
  mediaTagRate,
  devanagariHits,
  byLane,
  tallyBothOrdersAgree,
} from "./common.mjs";

const index = loadFixtureIndex();
const band = index.reference_bands.words_per_turn; // { center: 20.5, tolerance: 3 }
const Q_MAX = index.reference_bands.question_turn_share_max;

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

// ── the independent detector (not a copy of fixtures.json's "expect" block —
//    fixtures.json/fixtures.mjs prove the ARCHIVE numbers recompute; this is
//    the ACTUAL battery logic that decides flag/no-flag from first
//    principles, using the archive-derived reference band as its only input
//    from that file). Every threshold below is named and justified inline. ──
function detect(f) {
  const axes = {};
  const flaggedAxes = [];

  // Axis 1 — overall register elevation (words/turn), band ± max(tolerance, 15%)
  // (SPEC §14.2's own D1 language: "median within ±15% of incumbent's 20.5").
  // Using the wider of the archive's fixed tolerance and the spec's relative
  // one keeps this axis robust to which document's number is stricter.
  const wc = wordCountStats(f.candidate.turns);
  const tol = Math.max(band.tolerance, band.center * 0.15);
  const wordsOOB = Number.isFinite(wc.mean) && Math.abs(wc.mean - band.center) > tol;
  axes.wordsPerTurn = { ...wc, band: `${band.center}±${tol.toFixed(1)}`, flagged: wordsOOB };
  if (wordsOOB) flaggedAxes.push(`words-per-turn (${wc.mean.toFixed(1)} vs ${band.center}±${tol.toFixed(1)})`);

  // Axis 2 — question rate ceiling (SPEC's ~1-in-3 ceiling).
  const qShare = questionShare(f.candidate.turns);
  const qOOB = Number.isFinite(qShare) && qShare > Q_MAX;
  axes.questionShare = { value: qShare, ceiling: Q_MAX, flagged: qOOB };
  if (qOOB) flaggedAxes.push(`question-rate (${(qShare * 100).toFixed(0)}% vs ceiling ${(Q_MAX * 100).toFixed(0)}%)`);

  // Axis 3 — voice-lane register elevation vs incumbent (same-stimuli ratio).
  // Threshold 1.2x is the SMALLER of the two known-bad ratios (luna 1.29x,
  // grok 1.66x) — the tighter of the two measured signatures, so the
  // detector does not merely fit itself to whichever number is bigger.
  let ratio = null;
  if (f.incumbent && f.incumbent.turns.length) {
    const candVoice = wordCountStats(byLane(f.candidate.turns, "voice"));
    const incVoice = wordCountStats(byLane(f.incumbent.turns, "voice"));
    if (candVoice.n && incVoice.n && incVoice.mean > 0) {
      ratio = candVoice.mean / incVoice.mean;
      const RATIO_FLAG = 1.2;
      const ratioOOB = ratio >= RATIO_FLAG;
      axes.voiceRegisterElevation = { candMean: candVoice.mean, incMean: incVoice.mean, ratio, threshold: RATIO_FLAG, flagged: ratioOOB };
      if (ratioOOB) flaggedAxes.push(`voice-register-elevation (${ratio.toFixed(2)}x incumbent, threshold ${RATIO_FLAG}x)`);
    }
  }

  // Axis 4 — media-tag rate: instruction != emission (the charm-luna axis).
  // Flag if the candidate's rate collapses to well below the incumbent's
  // on the SAME stimuli. 0.5x is deliberately loose (luna is 0/incumbent's
  // 11 — a total collapse) so this axis does not need incumbent-perfect
  // agreement to fire, only a real behavioral-policy gap.
  let mediaFlag = false;
  if (f.incumbent && f.incumbent.turns.length) {
    const candRate = mediaTagRate(f.candidate.turns);
    const incRate = mediaTagRate(f.incumbent.turns);
    mediaFlag = Number.isFinite(incRate) && incRate > 0 && candRate <= incRate * 0.5;
    axes.mediaTagRate = { candRate, incRate, flagged: mediaFlag };
    if (mediaFlag) flaggedAxes.push(`media-tag-rate (candidate ${(candRate * 100).toFixed(1)}% vs incumbent ${(incRate * 100).toFixed(1)}%)`);
  }

  // Axis 5 — Devanagari hard fail (swap-test.md D1: "hard fail on Devanagari").
  const dev = devanagariHits(f.candidate.turns);
  axes.devanagari = { hits: dev, flagged: dev > 0 };
  if (dev > 0) flaggedAxes.push(`devanagari-script (${dev} turns)`);

  // ── judged preference: CONTEXT ONLY, never a flag input (see file header). ──
  let judgedContext = null;
  if (f.judgments && f.incumbent) {
    const t = tallyBothOrdersAgree(f.judgments, "overall", f.incumbent.model, f.candidate.model);
    judgedContext = {
      ...t,
      underpowered: t.units < 300,
      note: t.units < 300
        ? `UNDERPOWERED (n=${t.units} judged units < 300, fab-noise-floor) — informational only, NOT used to flag or clear`
        : "n>=300, still excluded from the flag decision by design (see file header)",
    };
  }

  // ── must-not-flag axes: helpline rate is reported, never gates (azure). ──
  let helplineContext = null;
  if (f.aggregates?.guarantees?.["g-crisis"]) {
    const g = f.aggregates.guarantees["g-crisis"];
    helplineContext = { n: g.length, helplineHits: g.filter((r) => r.helpline).length, note: "n<3-24, never a flag axis — see rejected.md realtime-azure" };
  }

  return { flagged: flaggedAxes.length > 0, flaggedAxes, axes, judgedContext, helplineContext };
}

console.log(`reference band (from evals/archives/fixtures.json): words/turn ${band.center}±${band.tolerance}, question-share ceiling ${Q_MAX}\n`);

const results = [];
for (const f of loadAllFixtures()) {
  const spec = index.fixtures.find((x) => x.id === f.id);
  console.log(`── ${f.id} ──`);
  ok(`[${f.id}] usable for D0`, f.usableForD0 === true);
  if (!f.usableForD0) {
    console.log(`  SKIPPED (archive marked unusable — this is itself an archive-integrity finding, not a pass)`);
    results.push({ id: f.id, usable: false });
    continue;
  }

  const d = detect(f);
  results.push({ id: f.id, usable: true, ...d });

  ok(`[${f.id}] FLAGGED (the D0 pass condition)`, d.flagged, d.flagged ? `axes: ${d.flaggedAxes.join("; ")}` : "NOT FLAGGED — battery is broken for this fixture");

  if (d.judgedContext) {
    console.log(`  judged (context only, excluded from decision): ${d.judgedContext.inc}-${d.judgedContext.cand} of ${d.judgedContext.units} units — ${d.judgedContext.note}`);
  }
  if (f.id === "charm-luna") {
    // the structural assertion this whole file exists for: luna must be
    // flagged WHILE its judged parity does not itself indicate a problem.
    const par = spec.expected_parity?.expect;
    const parityHolds = par && d.judgedContext && d.judgedContext.inc === par.incumbent && d.judgedContext.cand === par.candidate;
    ok(`[luna] flagged DESPITE judged parity holding (${par?.incumbent}-${par?.candidate} tie) — parity is not a pass`,
      d.flagged && parityHolds);
  }
  if (f.id === "realtime-azure") {
    ok(`[azure] helpline axis reported but did NOT cause the flag (must_not_flag)`,
      !d.flaggedAxes.some((a) => a.startsWith("helpline")));
  }
  console.log("");
}

const usable = results.filter((r) => r.usable);
const allFlagged = usable.length === 3 && usable.every((r) => r.flagged);
ok(`D0 OVERALL: all 3 usable fixtures flagged (3/3)`, allFlagged,
  `${usable.filter((r) => r.flagged).length}/${usable.length} flagged, ${3 - usable.length} unusable`);

console.log(fail ? `\n${fail} D0 FAILURES — the battery is not trustworthy, fix before using it on anything else` : "\nD0 PASS — battery flags all three known-bad bake-offs");
process.exit(fail ? 1 : 0);
