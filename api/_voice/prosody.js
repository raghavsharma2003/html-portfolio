// EmotionOS in the voice (WS-R168). A PURE mapper from the owner's five vibe
// dials (`api/_replica-vibe.js`, migration 164) plus an optional register
// read (`src/engine/register.ts`, WS-R153) to a closed PROSODY PLAN: rate,
// pause lengths, energy and a pitch-range hint. No I/O, no database, no
// provider call, no LLM prompt of any kind - this file only ever reads two
// small, already-validated objects and a language id, and returns numbers
// and enum strings. `evals/prosody/run.mjs` drives it directly.
//
// ── WHY THIS IS NOT A SECOND register.ts ────────────────────────────────
// `register.ts`'s own header explains why it owns no keyword table shared
// with `moment.ts`: a second copy of a similar-sounding table drifts from
// the first the moment one is edited and not the other. The SAME law says
// this file must not reimplement `readRegister` - it takes a RegisterResult
// as INPUT, already computed by whoever is calling it (`compiler.ts` for a
// text reply; nothing yet for a voice-only call - see the header on
// `buildProsodyPlan` below for the honest scope that leaves). The five
// literal register names below are restated, not imported, for the exact
// reason `register.ts` itself restates `HINDI_MARKER_WORDS` rather than
// importing a table from `relstate.ts`: this module must run standalone,
// offline, with zero dependencies outside this directory (the one exception,
// `../_room-speak-plan.js`'s `planReplySentences`, is the SAME sentence
// splitter `roomSpeak` already uses to decide "how many sentences", reused
// here rather than re-derived a second way, per this repo's own
// zero-orphan/no-second-implementation discipline).
//
// ── PROVIDER-NEUTRAL, EXPRESSED IN REAL FIELDS ──────────────────────────
// Two live voice providers exist in this tree (`registry.js`'s own header):
// `open_chatterbox_multilingual_v3` (primary, zero-shot, no SSML - its own
// request fields are `style.exaggeration` / `style.cfgWeight` /
// `style.temperature`, already read at
// `providers/open-chatterbox-preview.js`'s own `number(raw?.style?...)`
// calls) and `azure_personal_voice` (the enrolled-voice lifecycle lane).
// Neither accepts free-form pause markup. So this plan is expressed TWICE:
//   1. `styleDelta` - small, bounded deltas added to whichever base style
//      preset the caller already resolved (`applyStyleDelta`), landing on
//      the provider's OWN exaggeration/cfgWeight/temperature fields. This is
//      an AUTHORED mapping (energetic vibe -> more exaggeration, less
//      classifier-free adherence; excited/rushed register -> more
//      temperature), not a measured acoustic claim - the same "guarantees
//      normalization, not a pronunciation score" honesty line
//      `hindi-text-frontend.js`'s own contract comment draws for its job.
//   2. `pauseGlyph` - inserted BETWEEN sentences by `applyProsodyPauses`,
//      for the one caller that synthesises multiple sentences in a single
//      call (the studio's "hear the vibe" preview). The Room's own per-
//      sentence clips (WS-R156) already realise a sentence-boundary pause
//      structurally - one synthesis call per sentence, played back to back -
//      so `pauseGlyph` is not needed there; `pauseSentenceMs`/
//      `pauseClauseMs` are still returned so a caller who DOES want a text-
//      level pause has real, deterministic numbers rather than a guess.
//
// ── THE HONEST SCOPE ON REGISTER ────────────────────────────────────────
// `readRegister` is pull-only over the OTHER person's current turn text
// (`register.ts`'s own header). `roomSpeak` (`api/_room-surface.js`)
// synthesises the AI's OWN already-sent reply and has no access to the
// follower's latest turn text at that point in the call graph - the reply
// was already generated and approved by `gatedReply` before a voice request
// ever arrives, and threading the follower's raw text through the voice
// door would be a second, parallel place text can reach a rendering path,
// which is exactly the shape `roomSpeak`'s own header says never to build.
// So every caller in THIS tree passes `register: null` today; the plan
// below still accepts one, is fully proven with one via the offline eval,
// and degrades to the identical vibe-only plan when it is absent - see
// `context/rejected.md#ws-r168-register-not-threaded-into-roomspeak` for the
// full reasoning and what would reverse it.
import { planReplySentences } from "../_room-speak-plan.js";

export const PROSODY_CONTRACT = "vyakti-voice-prosody/v1";

export const RATE_BANDS = Object.freeze(["slow", "medium", "fast"]);
export const ENERGY_BANDS = Object.freeze(["low", "medium", "high"]);
export const PITCH_RANGE_BANDS = Object.freeze(["narrow", "normal", "wide"]);

/** Restated from `register.ts`'s own `REGISTERS` export - see this file's
 *  header for why a second copy, not an import, is the correct shape here. */
const REGISTERS = Object.freeze(["rushed", "upset", "excited", "flat", "neutral"]);

/** One direction table, reused for BOTH the energy index and the pitch
 *  index below (the second use inverted for formality, never for the sign
 *  of the register itself) - "excited"/"rushed" always push toward more
 *  energy and a wider range; "upset"/"flat" always push toward less of
 *  both. A single table keeps that coupling visible in one place rather
 *  than two tables that could quietly drift apart. */
const REGISTER_DELTA = Object.freeze({ rushed: 1, excited: 2, upset: -1, flat: -2 });

const VIBE_DIM_KEYS = Object.freeze(["warmth", "energy", "humour", "directness", "formality"]);
export const NEUTRAL_VIBE = Object.freeze({ warmth: 2, energy: 2, humour: 2, directness: 2, formality: 2 });

/** Every provider request field this module ever fills in, at its own
 *  neutral value - `applyStyleDelta(base, ZERO_STYLE_DELTA)` is required by
 *  the eval to return `base` unchanged, byte for byte. This IS the
 *  negative control the brief names: no vibe, no register, is this exact
 *  object, and this exact object changes nothing. */
export const ZERO_STYLE_DELTA = Object.freeze({ exaggeration: 0, cfgWeight: 0, temperature: 0 });

const LANGUAGES = new Set(["en", "hi"]);

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** One vibe dial, 0-4 integer - `_replica-vibe.js`'s own `dim()` range,
 *  restated (never imported: that file's validator THROWS on an out-of-
 *  range value because it is a write path; this is a read-only renderer
 *  and a malformed or absent dial degrades to the neutral midpoint rather
 *  than refusing to produce a plan at all - the same "no vibe yet" posture
 *  `getReplicaVibe` already documents for its own null return). */
function dimOf(vibe, key) {
  const n = Number(vibe?.[key]);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : NEUTRAL_VIBE[key];
}

/** A RegisterResult this module will actually act on, or `null`. Restates
 *  `renderRegisterHint`'s own gate (`register.ts`): only "high" confidence,
 *  and "neutral" never applies regardless of confidence - the identical
 *  rule, applied at a second render site for the identical reason. Any
 *  shape that is not a well-formed RegisterResult (wrong register name, a
 *  stray string, `undefined`) is treated exactly like "no register was
 *  ever computed" rather than thrown on - a voice call is not the place to
 *  fail a whole clip over a malformed optional hint. */
function appliedRegisterOf(register) {
  if (!register || typeof register !== "object") return null;
  if (!REGISTERS.includes(register.register)) return null;
  if (register.confidence !== "high") return null;
  if (register.register === "neutral") return null;
  return register.register;
}

/** `n` (0-4) -> one of the three band labels, the SAME thresholds every
 *  index in this file uses: 0-1 is the low end, 2 is the middle, 3-4 is
 *  the high end. One function, three label sets, so "which index crosses
 *  which threshold" is never answered two different ways. */
function bandOf(n, labels) {
  if (n <= 1) return labels[0];
  if (n >= 3) return labels[2];
  return labels[1];
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

// A tiny, dependency-free FNV-1a over the canonical JSON - `planSha256` is
// an OBSERVABILITY value (a header, a log line), never a security boundary,
// so a fast non-cryptographic hash is the honest choice rather than
// reaching for `node:crypto` in a file whose whole point is running with
// zero imports outside its own directory tree.
function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * `{ vibe, register, languageId }` -> a closed, frozen prosody plan.
 *
 * `vibe` — the LIVE row shape `getReplicaVibe` returns (`warmth`, `energy`,
 * `humour`, `directness`, `formality`, each 0-4), or `null`/`undefined` for
 * "the owner has never set one" — treated as `NEUTRAL_VIBE`, never refused.
 *
 * `register` — a `RegisterResult` (`{ register, confidence }`) or `null`.
 * Only a "high" confidence, non-"neutral" register ever changes the plan;
 * every other shape (including a malformed one) is silently equivalent to
 * `null` — see `appliedRegisterOf`.
 *
 * `languageId` — "en" | "hi" (Hinglish is synthesised as "hi", the SAME
 * `voiceScriptMode`/`buildVoiceTextPlan` convention every other voice module
 * in this directory already uses — restated here, not re-decided).
 */
export function buildProsodyPlan({ vibe, register, languageId } = {}) {
  const language = String(languageId || "en").toLowerCase();
  if (!LANGUAGES.has(language)) fail("voice_prosody_language_invalid");

  const applied = appliedRegisterOf(register);
  const delta = applied ? REGISTER_DELTA[applied] : 0;

  const warmth = dimOf(vibe, "warmth");
  const energy = dimOf(vibe, "energy");
  const humour = dimOf(vibe, "humour");
  const directness = dimOf(vibe, "directness");
  const formality = dimOf(vibe, "formality");

  // ── RATE / ENERGY — one index, the vibe's own energy dial nudged by the
  // register (excited/rushed speed it up, upset/flat slow it down), fed
  // into two label sets that always move together by construction.
  const energyIndex = clamp(energy + delta, 0, 4);
  const rateBand = bandOf(energyIndex, RATE_BANDS);
  const energyBand = bandOf(energyIndex, ENERGY_BANDS);

  // ── PITCH RANGE — a SEPARATE index: warmth and humour widen it, a higher
  // formality dial narrows it (the "(4 - formality)" inversion is the one
  // place a dial's own scale is flipped, and it is flipped exactly once,
  // here, rather than at every call site). The identical register delta
  // table nudges this index too, in the same direction it nudges energy —
  // an excited turn reads as BOTH faster and more varied in pitch, never
  // one without the other, which is the coupling `REGISTER_DELTA`'s own
  // comment names as deliberate.
  const pitchBaseIndex = Math.round((warmth + humour + (4 - formality)) / 3);
  const pitchIndex = clamp(pitchBaseIndex + delta, 0, 4);
  const pitchRangeBand = bandOf(pitchIndex, PITCH_RANGE_BANDS);

  // ── PAUSE LENGTHS — a base per rate band, nudged by directness (a
  // directness of 3-4 reads as confident and clipped, shortening the
  // pause; 0-1 reads as hedging, lengthening it), clamped to a range no
  // caller should ever need to re-clamp. `pauseClauseMs` is a fixed
  // fraction of the sentence pause rather than an independent dial — a
  // clause boundary is always a shorter breath than a sentence boundary in
  // ordinary speech, in any of this product's three languages, so this is
  // authored as a ratio rather than a sixth number nobody asked to tune.
  const pauseSentenceBaseMs = { slow: 560, medium: 380, fast: 220 }[rateBand];
  const directnessAdjustMs = directness >= 3 ? -60 : directness <= 1 ? 60 : 0;
  const pauseSentenceMs = clamp(pauseSentenceBaseMs + directnessAdjustMs, 160, 700);
  const pauseClauseMs = Math.round(pauseSentenceMs * 0.45);

  // ── TEXT-LEVEL PAUSE TOKEN — only the "slow" band gets one. Neither
  // Chatterbox nor Azure Personal Voice's request shape carries an explicit
  // inter-sentence pause field (`registry.js`'s own header on what each
  // provider does and does not implement), so a caller who synthesises more
  // than one sentence in a single call (the studio preview; never the
  // Room, whose own per-sentence clips already realise this pause
  // structurally) gets a real, deterministic punctuation token instead of
  // a free-text instruction — `applyProsodyPauses`, below, is the one
  // function that ever uses it.
  const pauseGlyph = rateBand === "slow" ? "…" : "";

  // ── STYLE DELTA — small, bounded nudges to the provider's OWN
  // exaggeration/cfgWeight/temperature fields (`open-chatterbox-
  // preview.js`'s own validated ranges: exaggeration 0-1.5, cfgWeight 0-1,
  // temperature 0.2-1.5). Authored, not measured — the same honesty line
  // this file's own header draws.
  const exaggerationDelta = clamp(
    (energyBand === "high" ? 0.12 : energyBand === "low" ? -0.1 : 0) +
      (pitchRangeBand === "wide" ? 0.05 : pitchRangeBand === "narrow" ? -0.05 : 0),
    -0.2,
    0.2,
  );
  const cfgWeightDelta = clamp(rateBand === "fast" ? -0.08 : rateBand === "slow" ? 0.06 : 0, -0.15, 0.15);
  const temperatureDelta = clamp(
    applied === "excited" || applied === "rushed" ? 0.06 : applied === "upset" || applied === "flat" ? -0.06 : 0,
    -0.15,
    0.15,
  );

  const planCore = {
    contract: PROSODY_CONTRACT,
    languageId: language,
    rateBand,
    energyBand,
    pitchRangeBand,
    pauseSentenceMs,
    pauseClauseMs,
    pauseGlyph,
    appliedRegister: applied,
    vibe: Object.freeze({ warmth, energy, humour, directness, formality }),
    styleDelta: Object.freeze({
      exaggeration: exaggerationDelta,
      cfgWeight: cfgWeightDelta,
      temperature: temperatureDelta,
    }),
  };
  return Object.freeze({ ...planCore, planSha256: fnv1a(canonical(planCore)) });
}

/** The neutral plan every caller falls back to when no vibe has ever been
 *  set and no register applies — computed the SAME way (never a hand-typed
 *  second copy of the defaults) so `buildProsodyPlan({})` and
 *  `NEUTRAL_PROSODY_PLAN` are provably the same object shape, exercised by
 *  the eval's own negative control. */
export const NEUTRAL_PROSODY_PLAN = Object.freeze(
  buildProsodyPlan({ vibe: null, register: null, languageId: "en" }),
);

/**
 * `baseStyle` (`{ exaggeration, cfgWeight, temperature }`, the caller's
 * already-resolved preset) + a `styleDelta` (from a plan, or
 * `ZERO_STYLE_DELTA`) -> a new style object, each field independently
 * clamped to the SAME ranges `open-chatterbox-preview.js` itself validates
 * (`exaggeration` 0-1.5, `cfgWeight` 0-1, `temperature` 0.2-1.5), rounded to
 * four decimal places so two calls with the same inputs are byte-identical
 * once serialised — a float accumulation artifact must never be the reason
 * two "identical" requests hash differently.
 */
export function applyStyleDelta(baseStyle, styleDelta = ZERO_STYLE_DELTA) {
  const exaggeration = clamp(Number(baseStyle?.exaggeration ?? 0.5) + Number(styleDelta?.exaggeration ?? 0), 0, 1.5);
  const cfgWeight = clamp(Number(baseStyle?.cfgWeight ?? 0.5) + Number(styleDelta?.cfgWeight ?? 0), 0, 1);
  const temperature = clamp(Number(baseStyle?.temperature ?? 0.8) + Number(styleDelta?.temperature ?? 0), 0.2, 1.5);
  const round4 = (n) => Math.round(n * 10_000) / 10_000;
  return Object.freeze({ exaggeration: round4(exaggeration), cfgWeight: round4(cfgWeight), temperature: round4(temperature) });
}

/**
 * Inserts `plan.pauseGlyph` between sentences of `text`, for the ONE caller
 * that synthesises more than one sentence in a single provider call (the
 * studio "hear the vibe" preview — see this file's own header). A single-
 * sentence text, or a plan with no glyph (every band but "slow"), returns
 * `text` completely unchanged — the byte-identical negative control the
 * brief names. Reuses `planReplySentences` (`api/_room-speak-plan.js`), the
 * one splitter this whole product uses, rather than a second one.
 */
export function applyProsodyPauses(text, plan) {
  const clean = String(text ?? "");
  if (!plan?.pauseGlyph) return clean;
  const sentences = planReplySentences(clean);
  if (sentences.length < 2) return clean;
  return sentences.join(` ${plan.pauseGlyph} `);
}

// ── OFFLINE TIMING PROXY, FOR THE EVAL'S OWN "FAKE WAVEFORM" ONLY ────────
// Not a synthesis duration estimate and never wired into billing —
// `api/_room-voice.js`'s own `estimateClipSeconds` (characters-per-second,
// whole seconds, the number the voice cap actually spends) is untouched by
// this file and stays the ONLY estimator any money-adjacent code path
// reads. This one exists so `evals/prosody/run.mjs` can measure, in
// milliseconds and deterministically, that the plan it built actually
// moves the timing it claims to move — the same "prove it changed the
// timing" discipline `evals/echosim` applies to the call floor, expressed
// here as authored per-character/per-pause millisecond constants rather
// than a real acoustic model.
const MS_PER_CHAR_BY_RATE = Object.freeze({ slow: 62, medium: 46, fast: 36 });

export function estimateProsodyTimingMs(text, plan) {
  const clean = String(text ?? "").trim();
  const codePoints = Array.from(clean);
  const msPerChar = MS_PER_CHAR_BY_RATE[plan?.rateBand] ?? MS_PER_CHAR_BY_RATE.medium;
  const base = codePoints.length * msPerChar;
  const sentences = planReplySentences(clean);
  const sentenceBoundaries = Math.max(0, sentences.length - 1);
  const clauseBoundaries = (clean.match(/,/g) || []).length;
  const pauseSentenceMs = Number(plan?.pauseSentenceMs ?? 0);
  const pauseClauseMs = Number(plan?.pauseClauseMs ?? 0);
  return Math.round(base + sentenceBoundaries * pauseSentenceMs + clauseBoundaries * pauseClauseMs);
}
