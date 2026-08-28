// earbench — the blind listening bench the fidelity law already depends on.
//
// ── why this file exists ──────────────────────────────────────────────────
// `context/decisions.md` (`voice-lane-live`, and the SPEC-GURUKUL §8.2 reweight
// behind `api/_fidelity.js`) says the ECAPA cosine score is a REGRESSION
// MONITOR and a floor, and that activation quality is decided by a blind
// owner-calibration pass. `rejected.md#azure-tts` is the evidence: every
// measured axis said switch and the owner's ear said no, and the axis the
// battery never had was ACCENT IDENTITY, which is a different property from
// pronunciation and is the one that decides whether the voice is theirs.
//
// The bench that law depends on did not exist. This is the instrument for it:
// pure design + blinding + statistics, no audio I/O policy, no network, so the
// half that decides a verdict is testable offline with fixtures — the same seam
// `api/_fidelity.js` bought by consuming vectors instead of audio.
//
// ── the one rule this module enforces on the caller ──────────────────────
// A listener must not be able to infer an arm from anything except the sound.
// Everything that can leak an arm is handled here and asserted in
// `evals/earbench/run.mjs`: stimulus ids are HMACs under a per-run secret that
// lives ONLY in the key file, every stimulus file is padded to one identical
// byte length, A/B position and the arm X is drawn from are counterbalanced,
// and the listener-facing trial list carries no arm, no item text and no
// ordering that correlates with either.
//
// NOTHING IN THIS FILE PRODUCES A RESULT. It produces a design and it scores an
// answer sheet. A report with no answer sheet says "no human has listened",
// which is the honest state of this bench until one does.
import { createHmac, createHash } from "node:crypto";

export const EARBENCH_VERSION = "earbench/v1";

// The rating axes. `accent` is its own axis on the direct instruction of
// `rejected.md#azure-tts`: "any future voice comparison must test accent
// authenticity as a first-class axis". It is NOT a sub-question of naturalness
// and it is NOT pronunciation — a line can be pronounced perfectly and belong
// to a different person's mouth.
export const RATING_AXES = Object.freeze([
  Object.freeze({
    id: "similarity",
    label: "Same person as the reference?",
    low: "clearly a different person",
    high: "indistinguishable from the reference speaker",
  }),
  Object.freeze({
    id: "naturalness",
    label: "Does it sound like a human being talking?",
    low: "obviously synthetic",
    high: "an ordinary human recording",
  }),
  Object.freeze({
    id: "accent",
    label: "Accent identity — is this the reference speaker's accent, not just correct pronunciation?",
    low: "wrong accent / nobody from where they are from",
    high: "their accent exactly",
  }),
]);

export const DEFAULT_POLICY = Object.freeze({
  // Two-sided alpha for "reliably distinguishable".
  alpha: 0.05,
  // Upper bound of the equivalence region for "indistinguishable from chance":
  // the 95% interval must sit entirely below this to claim it. 0.5 is chance;
  // 0.65 is the smallest edge this bench is willing to call "no edge worth
  // acting on". A bench that cannot reach this bound reports INCONCLUSIVE and
  // says how many more trials it needs — never "no difference found".
  equivalenceBound: 0.65,
  // Catch trials are trivially answerable (X is literally one of A/B). A
  // listener below this is not attending, and their sheet is reported as
  // INVALID rather than folded into a number.
  catchFloor: 0.9,
  ratingScale: 5,
});

// ── deterministic randomness ──────────────────────────────────────────────
// Order must be random but reproducible from the key file, otherwise a lost
// answer sheet cannot be re-scored and a disputed run cannot be re-derived.
export function seedFrom(...parts) {
  const digest = createHash("sha256").update(parts.join(" ")).digest();
  return digest.readUInt32BE(0) >>> 0;
}

export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── blinding ──────────────────────────────────────────────────────────────
// A stimulus id must carry zero information about its arm. A counter does
// (arm-major ordering), a hash of the audio does (identical bytes collide), and
// a hash of `arm|item` does too the moment anyone guesses the format. An HMAC
// under a secret that exists only inside the key file does not.
export function blindId(runSecret, arm, itemId, kind = "stimulus") {
  return createHmac("sha256", Buffer.from(String(runSecret), "hex"))
    .update([EARBENCH_VERSION, kind, arm, itemId].join(" "))
    .digest("hex")
    .slice(0, 16);
}

// ── the design ────────────────────────────────────────────────────────────
// ABX here asks about SPEAKER IDENTITY, not about a rendering of one sentence:
// X is a clip of a DIFFERENT item from one of the two arms, so the answer
// cannot be reached by matching words. That also makes the task the one the
// product actually cares about — "is this the same person" — rather than "are
// these two files the same file".
export function buildAbxTrials({ stimuli, arms, items, runSecret, seed }) {
  const random = rng(seed);
  const byArmItem = new Map(stimuli.map((s) => [`${s.arm} ${s.itemId}`, s]));
  const pairs = [];
  for (let i = 0; i < arms.length; i += 1) {
    for (let j = i + 1; j < arms.length; j += 1) pairs.push([arms[i], arms[j]]);
  }
  const trials = [];
  // Counterbalance the two binary choices — which arm X is drawn from, and
  // which side the matching stimulus sits on — over a four-cell cycle, reset
  // per arm pair, walking a SHUFFLED item order so the assignment cannot
  // correlate with item index either.
  //
  // The obvious version (xArm alternates every trial, side alternates every
  // two) is not balanced: over 18 trials it produces 10 A and 8 B, which the
  // counterbalance check caught the first time this ran. Four cells, four
  // combinations, exact balance at every multiple of two.
  const CYCLE = [
    { first: true, correct: "A" },
    { first: false, correct: "B" },
    { first: true, correct: "B" },
    { first: false, correct: "A" },
  ];
  for (const [armOne, armTwo] of pairs) {
    let flip = 0;
    for (const itemId of shuffle(items, random)) {
      const cell = CYCLE[flip % CYCLE.length];
      const xArm = cell.first ? armOne : armTwo;
      const correct = cell.correct;
      flip += 1;
      const otherArm = xArm === armOne ? armTwo : armOne;
      const others = items.filter((other) => other !== itemId);
      if (!others.length) continue;
      const xItemId = others[Math.floor(random() * others.length)];
      const matching = byArmItem.get(`${xArm} ${itemId}`);
      const foil = byArmItem.get(`${otherArm} ${itemId}`);
      const x = byArmItem.get(`${xArm} ${xItemId}`);
      if (!matching || !foil || !x) continue;
      trials.push({
        trialId: blindId(runSecret, `${armOne}+${armTwo}`, `${itemId}#abx`, "trial"),
        itemId,
        armA: correct === "A" ? xArm : otherArm,
        armB: correct === "A" ? otherArm : xArm,
        aId: correct === "A" ? matching.id : foil.id,
        bId: correct === "A" ? foil.id : matching.id,
        xId: x.id,
        xArm,
        xItemId,
        correct,
        isCatch: false,
      });
    }
  }
  // Catch trials: X is literally one of the two clips on screen. Anyone who is
  // listening at all gets these right; a sheet that does not is not a hard
  // result, it is an inattentive session, and the scorer says so instead of
  // averaging it in.
  const catchCount = Math.max(2, Math.round(trials.length * 0.15));
  const catchSource = shuffle(stimuli, random);
  for (let k = 0; k < catchCount; k += 1) {
    const match = catchSource[k % catchSource.length];
    const foil = catchSource[(k + 1 + Math.floor(random() * (catchSource.length - 1))) % catchSource.length];
    if (!foil || foil.id === match.id) continue;
    const correct = k % 2 === 0 ? "A" : "B";
    trials.push({
      trialId: blindId(runSecret, `catch${k}`, match.id, "trial"),
      itemId: match.itemId,
      armA: correct === "A" ? match.arm : foil.arm,
      armB: correct === "A" ? foil.arm : match.arm,
      aId: correct === "A" ? match.id : foil.id,
      bId: correct === "A" ? foil.id : match.id,
      xId: match.id,
      xArm: match.arm,
      xItemId: match.itemId,
      correct,
      isCatch: true,
    });
  }
  return shuffle(trials, random);
}

export function buildRatingTrials({ stimuli, runSecret, seed, referenceId }) {
  const random = rng(seed);
  return shuffle(
    stimuli.map((s) => ({
      ratingId: blindId(runSecret, s.arm, `${s.itemId}#rate`, "rating"),
      stimulusId: s.id,
      arm: s.arm,
      itemId: s.itemId,
      referenceId,
    })),
    random,
  );
}

// What the listener's machine is allowed to see. Everything that names an arm,
// an item text or a correct answer stays in the key.
export function listenerView({ runId, createdAt, abx, ratings, notes }) {
  return {
    version: EARBENCH_VERSION,
    runId,
    createdAt,
    axes: RATING_AXES,
    abx: abx.map((t) => ({ trialId: t.trialId, aId: t.aId, bId: t.bId, xId: t.xId })),
    ratings: ratings.map((r) => ({ ratingId: r.ratingId, stimulusId: r.stimulusId, referenceId: r.referenceId })),
    notes: notes || "",
  };
}

export function counterbalanceReport(trials) {
  const real = trials.filter((t) => !t.isCatch);
  const byPosition = { A: 0, B: 0 };
  const byXArm = new Map();
  for (const t of real) {
    byPosition[t.correct] += 1;
    byXArm.set(t.xArm, (byXArm.get(t.xArm) || 0) + 1);
  }
  const counts = [...byXArm.values()];
  return {
    trials: real.length,
    catchTrials: trials.length - real.length,
    correctA: byPosition.A,
    correctB: byPosition.B,
    positionBalanced: Math.abs(byPosition.A - byPosition.B) <= 1,
    xArmCounts: Object.fromEntries(byXArm),
    xArmBalanced: counts.length ? Math.max(...counts) - Math.min(...counts) <= 1 : true,
  };
}

// ── statistics ────────────────────────────────────────────────────────────
function logChoose(n, k) {
  let total = 0;
  for (let i = 0; i < k; i += 1) total += Math.log(n - i) - Math.log(i + 1);
  return total;
}

/** Exact binomial two-sided p (method of small p-values), p0 default 0.5. */
export function binomialTwoSidedP(k, n, p0 = 0.5) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || k < 0 || k > n) throw new Error("binomial inputs invalid");
  const pmf = (x) => Math.exp(logChoose(n, x) + x * Math.log(p0) + (n - x) * Math.log(1 - p0));
  const observed = pmf(k);
  const tolerance = observed * 1e-7;
  let total = 0;
  for (let x = 0; x <= n; x += 1) {
    const value = pmf(x);
    if (value <= observed + tolerance) total += value;
  }
  return Math.min(1, total);
}

/** One-sided (greater) exact binomial p. */
export function binomialOneSidedP(k, n, p0 = 0.5) {
  const pmf = (x) => Math.exp(logChoose(n, x) + x * Math.log(p0) + (n - x) * Math.log(1 - p0));
  let total = 0;
  for (let x = k; x <= n; x += 1) total += pmf(x);
  return Math.min(1, total);
}

/** Wilson score interval — the interval that stays inside [0,1] at small n. */
export function wilson(k, n, z = 1.959963985) {
  if (n < 1) return { low: 0, high: 1, point: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, low: Math.max(0, (centre - half) / d), high: Math.min(1, (centre + half) / d) };
}

// Two-sided 95% t quantiles, df 1..30; normal beyond. Small df matters here:
// this bench runs with one to three listeners, and using 1.96 at df=2 would
// report an interval about three times narrower than it is.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export function t95(df) {
  if (df < 1) return null;
  return df <= 30 ? T95[df - 1] : 1.959963985;
}

export function summariseNumbers(values) {
  const list = values.filter((v) => Number.isFinite(v));
  const n = list.length;
  if (!n) return { n: 0, mean: null, sd: null, ci: null };
  const mean = list.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean, sd: null, ci: null };
  const sd = Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const half = t95(n - 1) * (sd / Math.sqrt(n));
  return { n, mean, sd, ci: [mean - half, mean + half] };
}

/**
 * The verdict this whole instrument exists to produce. THREE outcomes, not two:
 *  - `distinguishable`  the listener beat chance and the interval says so
 *  - `indistinguishable` the interval sits entirely inside the equivalence
 *                        region — a real claim, not the absence of one
 *  - `inconclusive`      neither; reports how many trials would settle it
 * "not significant" is NOT evidence of equivalence, and a bench that conflates
 * the two would license "the clone is indistinguishable from the speaker" off a
 * run that simply had too few trials. That distinction IS the product.
 */
export function abxVerdict(correct, n, policy = DEFAULT_POLICY) {
  if (!n) return { verdict: "no-data", n: 0, correct: 0, chance: 0.5 };
  const interval = wilson(correct, n);
  const pTwo = binomialTwoSidedP(correct, n, 0.5);
  const pOne = binomialOneSidedP(correct, n, 0.5);
  const base = {
    n,
    correct,
    proportion: correct / n,
    chance: 0.5,
    ci95: [interval.low, interval.high],
    pTwoSided: pTwo,
    pOneSidedGreater: pOne,
    equivalenceBound: policy.equivalenceBound,
  };
  if (pOne < policy.alpha / 2 && interval.low > 0.5) {
    return { ...base, verdict: "distinguishable", reading: "reliably distinguishable from chance" };
  }
  if (interval.high < policy.equivalenceBound) {
    return {
      ...base,
      verdict: "indistinguishable",
      reading: `indistinguishable from chance at this bench's resolution (95% CI upper bound ${interval.high.toFixed(3)} < ${policy.equivalenceBound})`,
    };
  }
  return {
    ...base,
    verdict: "inconclusive",
    reading: "neither distinguishable nor shown equivalent — under-powered",
    trialsForEquivalence: trialsNeededForEquivalence(correct / n, policy),
  };
}

/** How many trials, at the observed rate, would put the whole CI under the bound. */
export function trialsNeededForEquivalence(observedRate, policy = DEFAULT_POLICY) {
  const p = Math.min(Math.max(observedRate, 0), 1);
  if (p >= policy.equivalenceBound) return null;
  for (let n = 8; n <= 4000; n += 4) {
    if (wilson(Math.round(p * n), n).high < policy.equivalenceBound) return n;
  }
  return null;
}

// ── scoring an answer sheet ───────────────────────────────────────────────
export function scoreBench({ key, sheets, policy = DEFAULT_POLICY }) {
  const trialById = new Map(key.trials.map((t) => [t.trialId, t]));
  const ratingById = new Map(key.ratings.map((r) => [r.ratingId, r]));
  const listeners = [];
  const ratedStimulusIds = new Set();
  const pairKey = (a, b) => [a, b].sort().join(" vs ");

  const abxByPair = new Map();
  const ratingsByArmAxis = new Map();
  const pairedByAxis = new Map();

  for (const sheet of sheets) {
    const answers = sheet.abx || {};
    let catchSeen = 0;
    let catchRight = 0;
    let seen = 0;
    let right = 0;
    const perPair = new Map();
    for (const [trialId, answer] of Object.entries(answers)) {
      const trial = trialById.get(trialId);
      if (!trial) continue;
      const choice = String(answer?.choice || "").toUpperCase();
      if (choice !== "A" && choice !== "B") continue;
      const correct = choice === trial.correct;
      if (trial.isCatch) {
        catchSeen += 1;
        if (correct) catchRight += 1;
        continue;
      }
      seen += 1;
      if (correct) right += 1;
      const pk = pairKey(trial.armA, trial.armB);
      const bucket = perPair.get(pk) || { n: 0, correct: 0 };
      bucket.n += 1;
      if (correct) bucket.correct += 1;
      perPair.set(pk, bucket);
    }
    const catchRate = catchSeen ? catchRight / catchSeen : null;
    const valid = catchSeen === 0 ? null : catchRate >= policy.catchFloor;
    listeners.push({
      listener: sheet.listener || "anonymous",
      abxTrials: seen,
      abxCorrect: right,
      catchTrials: catchSeen,
      catchCorrect: catchRight,
      catchRate,
      valid,
      ratings: Object.keys(sheet.ratings || {}).length,
    });
    // An invalid sheet contributes to nobody's numbers. It is reported, loudly,
    // and excluded — the alternative is a number carrying a session where the
    // listener demonstrably was not listening.
    if (valid === false) continue;

    for (const [pk, bucket] of perPair) {
      const agg = abxByPair.get(pk) || { n: 0, correct: 0 };
      agg.n += bucket.n;
      agg.correct += bucket.correct;
      abxByPair.set(pk, agg);
    }

    const perItemArmAxis = new Map();
    for (const [ratingId, answer] of Object.entries(sheet.ratings || {})) {
      const meta = ratingById.get(ratingId);
      if (!meta) continue;
      ratedStimulusIds.add(meta.stimulusId);
      for (const axis of RATING_AXES) {
        const value = Number(answer?.[axis.id]);
        if (!Number.isFinite(value)) continue;
        // "|" and not " ": arm ids contain hyphens and could one day contain a
        // space, and a bucket key that a split can mis-parse turns "clone-full,
        // accent" into an arm called "clone-full" and an axis called "-".
        const bucketKey = `${meta.arm}|${axis.id}`;
        const list = ratingsByArmAxis.get(bucketKey) || [];
        list.push(value);
        ratingsByArmAxis.set(bucketKey, list);
        perItemArmAxis.set(`${meta.itemId}|${meta.arm}|${axis.id}`, value);
      }
    }
    // Paired within listener and within item: the same ear, the same sentence,
    // two arms. This is the comparison with the least noise in it and the only
    // one that can carry an interval at n=1 listener.
    const arms = [...new Set(key.stimuli.map((s) => s.arm))];
    for (const axis of RATING_AXES) {
      for (let i = 0; i < arms.length; i += 1) {
        for (let j = i + 1; j < arms.length; j += 1) {
          for (const itemId of new Set(key.stimuli.map((s) => s.itemId))) {
            const left = perItemArmAxis.get(`${itemId}|${arms[i]}|${axis.id}`);
            const rightValue = perItemArmAxis.get(`${itemId}|${arms[j]}|${axis.id}`);
            if (!Number.isFinite(left) || !Number.isFinite(rightValue)) continue;
            const pk = `${arms[i]} minus ${arms[j]}|${axis.id}`;
            const list = pairedByAxis.get(pk) || [];
            list.push(left - rightValue);
            pairedByAxis.set(pk, list);
          }
        }
      }
    }
  }

  const abx = [...abxByPair.entries()].map(([pair, agg]) => ({
    pair,
    ...abxVerdict(agg.correct, agg.n, policy),
  }));

  const ratings = [...ratingsByArmAxis.entries()].map(([bucketKey, values]) => {
    const [arm, axis] = bucketKey.split("|");
    return { arm, axis, scale: policy.ratingScale, ...summariseNumbers(values) };
  });

  const paired = [...pairedByAxis.entries()].map(([bucketKey, values]) => {
    const [pair, axis] = bucketKey.split("|");
    const stats = summariseNumbers(values);
    const excludesZero = stats.ci ? stats.ci[0] > 0 || stats.ci[1] < 0 : null;
    return {
      pair,
      axis,
      ...stats,
      verdict: stats.n < 2 ? "no-data" : excludesZero ? "gap" : "no-detected-gap",
    };
  });

  const listened = listeners.some((l) => l.abxTrials > 0 || l.ratings > 0);
  return {
    version: EARBENCH_VERSION,
    runId: key.runId,
    policy,
    listened,
    // A self-test run carries locally generated tones, not a voice. It exists
    // to prove the mechanism and it must never be mistakable for a bench
    // result, so the flag rides all the way through to the printed report.
    selfTest: key.selfTest === true,
    contentMatched: key.contentMatched === true,
    blindingVerified: key.blindingVerified === true,
    arms: [...new Set(key.stimuli.map((s) => s.arm))],
    stimuli: key.stimuli.length,
    listeners,
    abx,
    ratings,
    paired,
    // Stimuli nobody was ever asked about. Zero is the expected value; anything
    // else means the design and the key disagree about what exists.
    unratedStimuli: key.stimuli.filter((s) => !ratedStimulusIds.has(s.id)).length,
  };
}

// ── plain-text report ─────────────────────────────────────────────────────
export function renderReport(report) {
  const lines = [];
  const pct = (v) => (v === null || v === undefined ? "  n/a" : `${(v * 100).toFixed(1)}%`);
  lines.push(`earbench report — run ${report.runId}`);
  if (report.selfTest) {
    lines.push("*** SELF-TEST — synthetic tones and a simulated listener. NOT A BENCH RESULT. ***");
  }
  lines.push(`arms: ${report.arms.join(", ")}   stimuli: ${report.stimuli}`);
  lines.push(`content-matched arms: ${report.contentMatched ? "yes" : "NO — arms differ in what is said, so content is a cue"}`);
  lines.push(`blinding verified by ASR: ${report.blindingVerified ? "yes" : "NO — disclosure trim checked by arithmetic only"}`);
  lines.push("");
  if (!report.listened) {
    lines.push("NO HUMAN HAS LISTENED. This run has stimuli, a design and a key, and zero answers.");
    lines.push("Nothing may be claimed about how any of these clips sound.");
    return lines.join("\n");
  }
  lines.push("listeners");
  for (const l of report.listeners) {
    const validity = l.valid === false ? "INVALID (failed catch trials)" : l.valid === null ? "no catch trials" : "valid";
    lines.push(`  ${l.listener.padEnd(16)} abx ${String(l.abxCorrect).padStart(3)}/${String(l.abxTrials).padEnd(3)} catch ${pct(l.catchRate)}  ratings ${l.ratings}  ${validity}`);
  }
  lines.push("");
  lines.push("ABX (chance = 50.0%)");
  for (const a of report.abx) {
    lines.push(`  ${a.pair}`);
    lines.push(`    ${a.correct}/${a.n} correct = ${pct(a.proportion)}  95% CI [${pct(a.ci95[0])}, ${pct(a.ci95[1])}]  p=${a.pTwoSided.toExponential(2)}`);
    lines.push(`    VERDICT ${a.verdict.toUpperCase()} — ${a.reading}`);
    if (a.trialsForEquivalence) lines.push(`    ~${a.trialsForEquivalence} trials at this rate would settle equivalence`);
  }
  lines.push("");
  lines.push(`ratings, 1-${report.policy.ratingScale} (accent is its own axis by law — rejected.md#azure-tts)`);
  for (const axis of RATING_AXES) {
    lines.push(`  ${axis.id}`);
    for (const r of report.ratings.filter((x) => x.axis === axis.id)) {
      const ci = r.ci ? `[${r.ci[0].toFixed(2)}, ${r.ci[1].toFixed(2)}]` : "n<2, no interval";
      lines.push(`    ${r.arm.padEnd(14)} n=${String(r.n).padStart(3)}  mean ${r.mean.toFixed(2)}  95% CI ${ci}`);
    }
    for (const p of report.paired.filter((x) => x.axis === axis.id)) {
      const ci = p.ci ? `[${p.ci[0].toFixed(2)}, ${p.ci[1].toFixed(2)}]` : "n<2";
      lines.push(`    paired ${p.pair.padEnd(24)} n=${String(p.n).padStart(3)}  mean diff ${p.mean === null ? "n/a" : p.mean.toFixed(2)}  95% CI ${ci}  ${p.verdict}`);
    }
  }
  return lines.join("\n");
}
