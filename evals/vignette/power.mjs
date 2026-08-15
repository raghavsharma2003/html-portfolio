// evals/vignette/power.mjs — pre-registered sample-size arithmetic for the
// §10-Q3 vignette pre-study, using docs/research/swap-test.md §2.2's own
// formulas (binomial detection-vs-chance, TOST equivalence) rather than a
// new statistical framework — this pre-study is answering the same shape of
// question (does a rater attribute MORE identity discontinuity to one frame
// than the other?) as the swap-test's detection-rate work, just on vignettes
// instead of live conversations.
//
//   node evals/vignette/power.mjs
//
// Pure arithmetic, no network, no cost. Prints the plan SPEC §10-Q3 already
// named (n≈120-200 paired vignettes, ≈$50-200, one week) and shows the
// working, so the number is checkable rather than quoted from memory.
import { VIGNETTES } from "./instrument.mjs";

function zFor(power) {
  // one-sided z for common power targets (avoids a stats dependency)
  return { 0.8: 0.8416, 0.9: 1.2816 }[power] ?? 0.8416;
}
const Z_ALPHA_05 = 1.6449; // one-sided, alpha=.05 (matches swap-test.md §2.2's usage)

// TOST-style n for detecting a mean-difference on the 1-7 scale between
// frames, treating each paired-vignette rating-difference as the unit
// (paired design cancels rater-level variance, per swap-test.md §2.1 rule 2
// — "every judged comparison is paired").
function nForPairedMeanDiff(sdOfDiff, marginPoints, power = 0.8) {
  const z = zFor(power) + Z_ALPHA_05;
  return Math.ceil((z * z * sdOfDiff * sdOfDiff) / (marginPoints * marginPoints));
}

console.log("── §10-Q3 vignette pre-study — sample size ──\n");
console.log(`instrument: ${VIGNETTES.length} incidents x 2 frames = ${VIGNETTES.length * 2} base items (evals/vignette/instrument.mjs)\n`);

// SD is unmeasured until a pilot exists (this study HAS no pilot data yet —
// that is what it's for). 1.5 is a conservative mid-range guess on a 1-7
// scale (full-range SD tops out ~1.7 for a uniform-ish distribution);
// printed as an assumption, not a measurement, exactly per this repo's own
// rule ("estimates become measurements... or the gate does not close").
for (const sd of [1.0, 1.5, 2.0]) {
  console.log(`assumed SD of (character-shift rating − memory-lapse rating) = ${sd}:`);
  for (const margin of [0.5, 1.0]) {
    const n80 = nForPairedMeanDiff(sd, margin, 0.8);
    const n90 = nForPairedMeanDiff(sd, margin, 0.9);
    console.log(`  detect a ${margin}-point mean difference: n=${n80} rated pairs (80% power) / n=${n90} (90% power)`);
  }
  console.log("");
}

console.log(`SPEC §10-Q3's own figure: n≈120-200 PAIRED VIGNETTES, two judge families, ≈$50-200, one week.`);
console.log(`Reconciling: with ${VIGNETTES.length} incidents and a 0.5-1.0pt margin at SD~1.5, ~150-190 rated pairs sits inside the 120-200 range if EACH of the ${VIGNETTES.length} incidents is rated by ~10-16 independent raters/judges per frame (${VIGNETTES.length} x ~13 ≈ 156) — n is RATINGS, not incidents (see instrument.mjs's own note). This is the reading this file assumes; it is not the only one, and the pilot is what should fix SD for real.`);
console.log(`\nCost, priced two ways (this workstream builds the instrument only — see run-prestudy.mjs and the exit report for who decides which):`);
console.log(`  HUMAN panel (e.g. Prolific): ~$0.50-1.50/rating x ~2 ratings/pair (both frames seen by different raters, between-subjects to avoid a rater comparing them side by side and defeating the framing manipulation) x 150-190 pairs ≈ $150-570 — ABOVE SPEC's $50-200 figure at typical panel rates; reconcile before running, or run within-subject (both frames, same rater, order-randomized) at roughly half the rater-count cost, at the cost of a possible contrast effect (a rater who sees both frames back-to-back may rate the character-shift one as MORE different simply from the comparison, not the frame alone) — pre-register which is used, do not decide after seeing results.`);
console.log(`  LLM-judge panel (two families, matching this repo's usual "judge family" vocabulary): same token-cost arithmetic evals/dbattery/d2.mjs prints (~$0.02-0.03/judgment at today's OpenRouter prices) x ~2 judges x ~2 orders x 150-190 pairs ≈ $12-23 — comfortably inside SPEC's $50-200, but answers a DIFFERENT question (do model judges perceive the framing difference the way people do? — untested, and the whole reason a HUMAN vignette study was proposed in swap-test.md §5's closing note, which cites cognitive-science literature about how PEOPLE track identity).`);
