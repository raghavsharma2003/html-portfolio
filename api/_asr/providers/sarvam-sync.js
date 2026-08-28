// Sarvam's SYNCHRONOUS ASR lane — the one a live call can use. WS-X.
//
// ── why this is a second provider and not a flag on the batch one ─────────
// `sarvam-saaras.js` is the BATCH lane: init, upload to a directory SAS, start,
// poll, collect. Measured 2026-08-26 (context/STATE.md): 71 s of audio came
// back as 5 diarized turns in 137 SECONDS. That is the right lane for a
// two-hour lecture and it is not a lane a chip stream can live on — the owner
// would finish the call before the first chip arrived.
//
// The synchronous endpoint is a different shape entirely: one multipart POST,
// one JSON answer, measured 25 s of audio -> 200 in 4 134 ms with model
// `saarika:v2.5` (`saarika:v2` is deprecated). It also has a HARD 30 s CAP and
// says so ("Please use the batch API for longer audio files"). Two endpoints,
// two payload shapes, two limits, two models: folding them into one provider
// behind a boolean would make the 30 s cap a runtime surprise instead of a
// contract, so they are two providers and the caller picks by duration.
//
// ── what it does NOT do, and why that is honest ──────────────────────────
// NO DIARIZATION. The sync endpoint returns one `transcript` string. So this
// returns ONE turn with ONE speaker label, which is `contracts.js`'s stated
// rule for a provider that cannot diarize: "a provider that cannot diarize must
// return ONE label for the whole file rather than inventing per-utterance
// speakers — a fabricated speaker split does not fail here, it silently halves
// the teacher's measured corpus and every ratio computed from it."
//
// Inside a Mirror Call that is not a compromise: the window IS one speaker's
// turn, on their own authenticated session, and `api/_mirrorcall.js` labels it
// explicitly rather than letting `transcriptStats` guess the most talkative.
//
// ── the key ──────────────────────────────────────────────────────────────
// The subscription key travels in a header and appears in exactly one
// expression in this file. It is never interpolated into a URL, never put in an
// error, never returned. Same rule sarvam-saaras.js states.
import { asrInput, asrResult, langHint } from "../contracts.js";
import { readPrivateReplicaObject } from "../../_replica-storage.js";

const NAME = "sarvam-sync";
const DEFAULT_MODEL = "saarika:v2.5";
const DEFAULT_ORIGIN = "https://api.sarvam.ai";
const MAX_AUDIO_BYTES = 33_554_432; // 30 s of 24 kHz mono PCM16 is ~1.4 MB; this is generous headroom.

/** The provider's own hard limit, restated here so a caller can read it off the
 *  provider rather than off a comment. `api/_mirrorcall.js` refuses a longer
 *  window before any of this runs; this is the second copy. */
export const SARVAM_SYNC_MAX_MS = 30_000;

function fail(code, status = 502, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

export function createSarvamSyncProvider(options = {}) {
  const apiKey = String(options.apiKey || "");
  if (!apiKey) fail("asr_provider_unavailable", 503);
  const model = String(options.model || process.env.SARVAM_SYNC_ASR_MODEL || DEFAULT_MODEL);
  const origin = String(options.origin || process.env.SARVAM_API_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || 60_000);
  // Injected, so this file never becomes a second place that knows how the
  // private replica bucket is addressed.
  const readAudio = options.readAudio || ((ref) => readPrivateReplicaObject({
    storageBucket: ref.storageBucket,
    objectPath: ref.storagePath,
  }, {
    fetchImpl, maxBytes: MAX_AUDIO_BYTES, timeoutMs,
  }));
  const auth = { "api-subscription-key": apiKey };

  return Object.freeze({
    name: NAME,
    model,
    maxDurationMs: SARVAM_SYNC_MAX_MS,

    async transcribe(rawRef, hint = "hi-IN") {
      const ref = asrInput(rawRef);
      const language = langHint(hint);
      // The cap is checked against the DECLARED duration when there is one. A
      // ref that does not carry a duration is sent anyway — the endpoint's own
      // 4xx is then the answer, and inventing a refusal from a number we do not
      // have would be worse than asking.
      if (ref.durationMs && ref.durationMs > SARVAM_SYNC_MAX_MS) {
        fail("asr_sync_window_too_long", 413, { max_ms: SARVAM_SYNC_MAX_MS, duration_ms: ref.durationMs });
      }

      const object = await readAudio(ref);
      const body = object?.body;
      if (!body || !body.length) fail("asr_audio_unreadable", 502);

      const form = new FormData();
      form.append("file", new Blob([body], { type: ref.mime || "audio/wav" }), "window.wav");
      form.append("model", model);
      form.append("language_code", language === "auto" ? "unknown" : language);

      let response;
      try {
        response = await fetchImpl(`${origin}/speech-to-text`, {
          method: "POST",
          headers: { ...auth, Accept: "application/json" },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch { fail("asr_sync_unreachable", 503); }

      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { fail("asr_sync_response_invalid"); }
      if (!response.ok) {
        fail(`asr_sync_http_${response.status}`, response.status === 429 ? 429 : 502);
      }

      const transcript = String(payload?.transcript ?? "");
      // An empty transcript is a 422, not an empty turn list: `asrResult` would
      // refuse the empty list anyway, and this names WHY it was empty. A window
      // of silence reaching the mine as "" would deflate every per-1000 ratio
      // in the session with nothing reporting it.
      if (!transcript.trim()) fail("asr_sync_transcript_empty", 422);

      return asrResult(
        {
          turns: [{ speaker: "SPEAKER_00", text: transcript, t0: 0, t1: ref.durationMs || 0 }],
          provider: NAME,
          model,
        },
        { name: NAME, model },
      );
    },
  });
}
