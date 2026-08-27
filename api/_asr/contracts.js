// The ASR seam's contract (Gurukul WS-I).
//
//   transcribe(audioRef, langHint) -> { turns:[...], provider, model,
//                                      languageCode, languageProbability, languageSource }
//
// One operation, because one operation is what the re-ingestion worker needs
// and a seam wider than its caller is a seam whose extra half is never
// exercised by anything (`dead-writers`).
//
// ── the turn shape is not negotiable, and it is not ours ─────────────────
// `{speaker, text, t0, t1}` minus the timings IS `TranscriptTurn` from
// src/engine/ingest/transcriptStats.ts, the wave-3 module this whole lane
// exists to feed. That module's own header explains why `speaker` is a
// diarization LABEL and never a name ("the ASR gives SPEAKER_00, the studio
// maps it later"), and `transcriptStats` picks the most-talkative label when
// none is given. So a provider that cannot diarize must return ONE label for
// the whole file rather than inventing per-utterance speakers — a fabricated
// speaker split does not fail here, it silently halves the teacher's measured
// corpus and every ratio computed from it.
//
// ── why Sarvam is first and Whisper is not a candidate at all ────────────
// docs/gurukul/ingestion-research.md §3, measured rather than preferred:
// Whisper large-v3 on distinct-script code-switched pairs (Hindi-English is
// exactly that) runs 32.33%-51.62% CER against 7.32-28.26% for same-script
// pairs. Sarvam Saaras "maintains phonetic integrity of mixed input" instead
// of translating Hindi into English mid-transcript, which is the specific
// failure Whisper exhibits and the specific thing that would destroy a
// Hinglish teacher's measured code-switch ratio. The research also flags its
// own gaps (the CER paper was not re-fetched; Sarvam's ₹30/hr vs ₹1.5/min
// pricing figures CONFLICT) and those flags travel with this seam rather than
// staying in the doc.
//
// ── nothing here reaches the network ─────────────────────────────────────
// Validation and value construction here, transport in providers/, selection
// in registry.js — api/_claim-extraction's split, so evals/channel.mjs can
// drive the real worker with a fake and no env.

const SHA256 = /^[0-9a-f]{64}$/;

/** A ceiling on one transcript. A two-hour lecture is roughly 20k words; this
 *  is ~10x that and exists because an unbounded transcript is an unbounded
 *  jsonb write and an unbounded prompt downstream. */
export const MAX_TRANSCRIPT_TURNS = 20_000;
export const MAX_TURN_CHARS = 4_000;

/** Language hints a provider may be given. `hi-IN` is the default because the
 *  product is Hinglish-first; `en-IN` exists because a physics lecture in
 *  English with Hindi underneath is the same corpus from the other end, and
 *  a hint is a hint, never a filter applied to the output. */
export const ASR_LANG_HINTS = Object.freeze(new Set(["hi-IN", "en-IN", "auto"]));

export class AsrError extends Error {
  constructor(code, status = 502, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 502, details) {
  throw new AsrError(code, status, details);
}

function clean(value, max = MAX_TURN_CHARS) {
  return Array.from(String(value ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    // A transcript is untrusted text that ends up near a prompt. The same
    // fence api/_claim-extraction/contracts.js puts on evidence text goes
    // here, at the seam, so no provider can be the one that forgot it.
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function langHint(value) {
  const hint = String(value || "hi-IN");
  return ASR_LANG_HINTS.has(hint) ? hint : fail("asr_lang_hint_unsupported", 400);
}

/** The audio a provider is asked to transcribe: a reference, matching what
 *  `api/_channel/contracts.js`'s `audioRef` produced. Re-validated here
 *  because the two seams are independent and a contract that trusted its
 *  neighbour's validation would be one refactor away from trusting nothing. */
export function asrInput(value) {
  const storagePath = clean(value?.storagePath ?? value?.storage_path, 512);
  if (!storagePath || storagePath.includes("://") || storagePath.startsWith("/")) fail("asr_audio_path_invalid", 400);
  const sha256 = String(value?.sha256 || "").toLowerCase();
  if (!SHA256.test(sha256)) fail("asr_audio_sha256_invalid", 400);
  return Object.freeze({
    storagePath,
    sha256,
    mime: clean(value?.mime, 64),
    byteSize: Number(value?.byteSize ?? value?.byte_size ?? 0),
    durationMs: Number(value?.durationMs ?? value?.duration_ms ?? 0),
  });
}

/** The result, validated as a whole. Two rules earn their place:
 *
 *  - EVERY turn keeps its speaker label verbatim after cleaning. A provider
 *    returning blank labels gets `SPEAKER_00`, one label for the file, which
 *    is the honest reading of "no diarization" — never a per-turn invention.
 *  - Timings must be non-decreasing. Out-of-order turns would reorder a
 *    lecture, and `splitHeldOut`'s per-speaker parity split rests on turn
 *    order being the order the words were said.
 */
export function asrResult(value, provider) {
  const turns = Array.isArray(value?.turns) ? value.turns : fail("asr_result_invalid");
  if (!turns.length) fail("asr_result_empty", 422);
  if (turns.length > MAX_TRANSCRIPT_TURNS) fail("asr_result_too_large", 413, { turns: turns.length });
  const out = [];
  let previousEnd = -1;
  for (const turn of turns) {
    const text = clean(turn?.text);
    const t0 = Number(turn?.t0 ?? turn?.start_ms ?? 0);
    const t1 = Number(turn?.t1 ?? turn?.end_ms ?? 0);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 < 0 || t1 < t0) fail("asr_turn_timing_invalid");
    if (t0 < previousEnd - 1_000) fail("asr_turn_order_invalid");
    previousEnd = t1;
    if (!text) continue;
    out.push(Object.freeze({ speaker: clean(turn?.speaker, 64) || "SPEAKER_00", text, t0, t1 }));
  }
  if (!out.length) fail("asr_result_empty", 422);
  const name = clean(value?.provider ?? provider?.name, 64);
  const model = clean(value?.model ?? provider?.model, 64);
  if (!name || !model) fail("asr_result_provenance_missing");
  const rawLanguageCode = value?.languageCode ?? value?.language_code ?? null;
  const languageCode = rawLanguageCode == null || rawLanguageCode === ""
    ? null
    : clean(rawLanguageCode, 16);
  if (languageCode != null && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(languageCode)) {
    fail("asr_language_code_invalid");
  }
  const rawProbability = value?.languageProbability ?? value?.language_probability ?? null;
  const languageProbability = rawProbability == null ? null : Number(rawProbability);
  if (languageProbability != null && (!Number.isFinite(languageProbability) || languageProbability < 0 || languageProbability > 1)) {
    fail("asr_language_probability_invalid");
  }
  const languageSource = clean(value?.languageSource ?? value?.language_source ?? "unavailable", 32);
  if (!new Set(["provider_detected", "requested_hint", "unavailable"]).has(languageSource)) {
    fail("asr_language_source_invalid");
  }
  if (languageSource === "provider_detected" && languageCode == null) fail("asr_detected_language_missing");
  if (languageSource !== "provider_detected" && languageProbability != null) fail("asr_language_probability_unbound");
  return Object.freeze({
    turns: Object.freeze(out), provider: name, model,
    languageCode, languageProbability, languageSource,
  });
}

export function assertAsrProvider(provider) {
  if (!provider || typeof provider.transcribe !== "function" || !provider.name || !provider.model) {
    fail("asr_provider_unavailable", 503);
  }
  return provider;
}
