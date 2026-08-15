// WS-BATTERY shared primitives — SPEC.md §14 D0/D1/D2, docs/research/swap-test.md.
//
// Every deterministic counter the D-battery uses lives here ONCE, so D0
// (validity gate) and D1 (band recompute) can never silently disagree about
// how "words/turn" or "media-tag rate" is defined — the exact failure mode
// evals/fixtures.mjs's header warns about for the archive numbers themselves.
// This file computes on RAW text, no cleaning, matching evals/fixtures.mjs's
// own counting discipline ("nothing is cleaned here" — archives/load.mjs).
//
// Statistics discipline (context/measurements.md `fab-noise-floor`, this
// project's own words): judged-rate metrics spread 13.6pp on byte-identical
// input and ANY judged claim at n<300 is noise. Deterministic metrics below
// carry no judge noise (docs/research/swap-test.md §2.1 rule 1) and are
// therefore the only axes D0 is allowed to gate on — see d0.mjs.

// ── deterministic text counters (no LLM, no judge, exempt from judge noise) ─

export const rawWords = (text) => text.split(/\s+/).filter(Boolean).length;

export const meanRawWords = (turns) =>
  turns.length ? turns.reduce((a, t) => a + rawWords(t.text), 0) / turns.length : NaN;

export function percentile(nums, p) {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export function wordCountStats(turns) {
  const counts = turns.map((t) => rawWords(t.text));
  return {
    n: counts.length,
    mean: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : NaN,
    median: percentile(counts, 50),
    p90: percentile(counts, 90),
  };
}

export const questionShare = (turns) =>
  turns.length ? turns.filter((t) => t.text.includes("?")).length / turns.length : NaN;

// evals/fixtures.mjs's MEDIA_RE, kept byte-identical on purpose — two
// batteries measuring "a media tag" differently is exactly the drift this
// module exists to prevent.
export const MEDIA_RE = /\[(gif|sent a meme gif|voicenote|photo|selfie|sticker)[:\]]/i;
export const mediaTagRate = (turns) =>
  turns.length ? turns.filter((t) => MEDIA_RE.test(t.text)).length / turns.length : NaN;

// swap-test.md D1: "romanized-vs-Devanagari (hard fail on Devanagari)".
// Neither evals/fixtures.mjs nor any prior suite checks this — new coverage.
const DEVANAGARI_RE = /[ऀ-ॿ]/;
export const devanagariHits = (turns) => turns.filter((t) => DEVANAGARI_RE.test(t.text)).length;

// A small, deliberately conservative romanized-Hindi/Hinglish marker list —
// reporting-only (no reference band exists yet for this axis; swap-test.md
// D1 calls it "a malformed-Hinglish spot list", judged, so a purely lexical
// ratio here is advisory, never a flag condition on its own).
const HINGLISH_MARKERS =
  /\b(yaar|na|toh|bhi|kya|hai|nahi|nahin|matlab|acha|accha|arre|arey|thoda|bas|bilkul|sahi|kaise|kyun|kyu|haan|kar|karo|karna|tera|mera|apna|dekh|suno|chal)\b/gi;
export function codeSwitchRatio(turns) {
  let hits = 0, words = 0;
  for (const t of turns) {
    words += rawWords(t.text);
    hits += (t.text.match(HINGLISH_MARKERS) || []).length;
  }
  return words ? hits / words : NaN;
}

// spoken-register markers (call lane): stretched vowels / drawn-out
// interjections ("haaaan", "areee") — a cheap textual proxy for the D1
// "spoken-register marker rate" axis on transcribed voice turns.
const REGISTER_MARK_RE = /([a-z])\1{2,}/i; // any letter repeated 3+ times
export const registerMarkerRate = (turns) =>
  turns.length ? turns.filter((t) => REGISTER_MARK_RE.test(t.text)).length / turns.length : NaN;

export const byLane = (turns, lane) => turns.filter((t) => t.lane === lane);

// ── bootstrap CI (deterministic PRNG — reproducible across CI runs) ────────

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap CI over a statistic fn(sample) applied to `values`.
 *  Seeded — same input always produces the same CI, so a CI-band gate is
 *  reproducible in CI rather than being flaky by construction. */
export function bootstrapCI(values, statFn, { reps = 1000, alpha = 0.05, seed = 20260815 } = {}) {
  if (!values.length) return { lo: NaN, hi: NaN, point: NaN };
  const rnd = mulberry32(seed);
  const point = statFn(values);
  const stats = [];
  for (let r = 0; r < reps; r++) {
    const sample = new Array(values.length);
    for (let i = 0; i < values.length; i++) sample[i] = values[Math.floor(rnd() * values.length)];
    stats.push(statFn(sample));
  }
  stats.sort((a, b) => a - b);
  const lo = stats[Math.floor((alpha / 2) * reps)];
  const hi = stats[Math.ceil((1 - alpha / 2) * reps) - 1];
  return { lo, hi, point };
}

// ── judged-preference tally — the house rule, generalized from evals/fixtures.mjs ─
//
// unit = (lane,beat,rep); judged in both slot orders; a side wins the unit
// ONLY when both orders agree (docs/research/swap-test.md §1: "flips charged
// as ties", 61% slot-A position bias measured). NOTE (D0 discipline): this
// number is JUDGED and therefore carries judge noise — context/measurements.md
// `fab-noise-floor` says any judged rate is noise below n=300 units. The
// grok/luna archives carry only 48 judged units each. d0.mjs computes this
// for CONTEXT/REPORTING ONLY and never uses it to decide a flag — deterministic
// axes only decide flags. This is the literal mechanism behind "parity is not
// a pass": a battery that let 48-unit charm parity clear a candidate would be
// exactly the mistake charm-luna exists to catch.
export function tallyBothOrdersAgree(judgments, axis, incModel, candModel) {
  const units = new Map();
  for (const v of judgments.verdicts) {
    const k = `${v.lane}|${v.beat}|${v.rep}`;
    if (!units.has(k)) units.set(k, {});
    units.get(k)[v.order] = v[axis];
  }
  let inc = 0, cand = 0, tie = 0;
  for (const o of units.values()) {
    if (o[0] === undefined || o[1] === undefined) continue;
    if (o[0] === o[1] && o[0] === incModel) inc++;
    else if (o[0] === o[1] && o[0] === candModel) cand++;
    else tie++;
  }
  return { units: units.size, inc, cand, tie, n_judged: judgments.verdicts.length };
}

// ── OpenRouter judge caller — shared by any judged suite (D2/D5/vignette). ─
// House rule from evals/probes/affect-recitation.mjs: OpenRouter-billed,
// never the free Gemini pool (that quota is shared product infrastructure,
// context/measurements.md `free-tts-daily`: "the free tier is a DAILY budget
// and it runs out"). NEVER logs or returns the key itself.
export async function callJudge({ key, model, system, user, maxTokens = 700, temperature = 0 }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Meera WS-BATTERY" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.ok) {
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content ?? "";
        const usage = j?.usage ?? null;
        if (text.trim()) return { text, usage };
      } else if (r.status < 500 && r.status !== 429) {
        const body = await r.text();
        throw new Error(`upstream ${r.status}: ${body.slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((s) => setTimeout(s, 1200 * (attempt + 1)));
  }
  throw new Error("callJudge: exhausted retries");
}

// Reference bands live in evals/archives/fixtures.json, next to the archives
// they were recomputed from — not duplicated here (evals/archives/load.mjs's
// own rule: "the numbers the battery must reproduce are data under review,
// not constants buried in harness code").
export function loadReferenceBands() {
  // deferred import to keep this module import-cycle-free from load.mjs
  return import("../archives/load.mjs").then((m) => m.loadFixtureIndex().reference_bands);
}
