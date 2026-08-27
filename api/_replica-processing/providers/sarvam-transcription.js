import { ProcessingAdapterError } from "../contracts.js";
import { createSarvamSaarasProvider } from "../../_asr/providers/sarvam-saaras.js";
import { createReadStream } from "node:fs";

// Bridges the Sarvam Saaras batch ASR provider into the eight-step audio
// DAG's `transcribe` adapter contract. WS-AN, 2026-08-26 (owner directive):
// `transcribe` used to hard-wire Azure Fast Transcription, the one
// capability this subscription has never had (zero Cognitive Services
// accounts on it). Do not stand up a new vendor: `api/_asr/providers/
// sarvam-saaras.js` already implements the batch protocol (init, upload,
// start, poll, collect) end to end and is measured working on Hinglish
// (context/rejected.md#sarvam-batch-paths-were-three-guesses). This file
// reuses THAT protocol implementation rather than writing a second HTTP
// client for the same API — the DAG-shaped seam is new, the transport is
// not.
//
// ── why this does not go through `api/_asr/registry.js` ──────────────────
// The registry also offers a self-hosted lane, selected first when
// `ASR_SELF_HOSTED_ORIGIN`/`ASR_HMAC_SECRET` are set (SPEC-GURUKUL §8 item
// 1's vendor-independence directive). That lane hands the remote worker a
// SIGNED PULL URL — there is no bytes-in-hand step to intercept. Every other
// adapter in this DAG (see `azure-fast-transcription.js`'s
// `resolvePrivateInput`, which THROWS `azure_asr_private_url_forbidden` if a
// resolver ever returns a URL) enforces the opposite: a provider only ever
// receives bytes this process already fetched and integrity-checked through
// `storage.resolveInput`, never a raw pull URL it could use to read outside
// that check. Routing through the registry's selection would silently let a
// future self-hosted-ASR deploy hand out signed URLs from inside this DAG,
// which is a security posture change nobody has reviewed. The owner's
// instruction was Sarvam specifically; this file does exactly that and no
// more.
//
// ── the two shapes this reconciles ────────────────────────────────────────
// The ingestion ASR seam (api/_asr/contracts.js): one call,
//   transcribe(ref, hint) -> { turns: [{ speaker, text, t0, t1 }] }
// with no per-segment confidence and no returned language, because neither
// of its two existing callers (channel ingest, mirror-call) needed either.
//
// The DAG step (worker.js's `case "transcribe"`):
//   transcribe(common) -> { segments: [{ start_ms, end_ms, confidence, text,
//   language, words, ... }] }
// where `confidence` is REQUIRED (`assertSegments` rejects a non-finite one)
// and IS the value `api/_replica-claims.js` gates claim extraction on
// (`e.confidence>=0.55`).
//
// ── why confidence is 0 here, and not a guess ─────────────────────────────
// Sarvam's batch API (docs.sarvam.ai, checked 2026-08-26) documents its
// output fields as `transcript`, `timestamps`, and
// `diarized_transcript.entries{transcript,start_time_seconds,
// end_time_seconds,speaker_id}` — no confidence field at any granularity.
// Inventing a plausible-looking number (0.85, say) would let text nobody
// scored pass the >=0.55 claim gate as if it had been measured — the exact
// "plausible return hides a dead pipeline" shape this project has already
// paid for once (context/rejected.md). 0 is the honest floor: it never
// asserts a quality signal that was never produced, and every span this
// adapter writes stays out of automated claim mining until a human reviews
// it in the studio, or Sarvam ships a real score and this becomes a
// one-line change.
//
// ── language evidence is detected or explicitly labelled unavailable ────
// The default is Sarvam's documented auto-detection value (`unknown` on the
// wire). The batch result's predominant `language_code` and nullable
// `language_probability` cross the ASR seam with `language_source` naming
// whether they were detected, requested, or unavailable. A code-mix boolean
// is not returned by this API and stays null rather than being fabricated.
//
// ── why there is no chunking ──────────────────────────────────────────────
// Sarvam's batch API accepts files up to 2 hours long (and up to 20 files
// per job) per its own docs (docs.sarvam.ai/api/api-guides-tutorials/
// speech-to-text/batch-api.md, checked 2026-08-26). The owner's 822.7 s
// recording is comfortably inside that ceiling, so this adapter sends the
// file whole rather than splitting it.

const FAMILY = "asr";
const VERSION = "batch-v1";

function adapterError(code, retryable = false) {
  return new ProcessingAdapterError(code, { code, retryable });
}

/** The underlying provider's `fail()` sets `status`; read THAT for
 *  retryability instead of re-deriving it from the code string, which would
 *  drift the moment a new failure code is added there. */
function retryableFrom(error) {
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500;
}

export function createSarvamTranscriptionAdapter(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  if (!apiKey) throw adapterError("sarvam_asr_config_missing");
  if (typeof options.resolveInput !== "function" && typeof options.withInputFile !== "function") {
    throw adapterError("sarvam_asr_input_resolver_missing");
  }
  const model = String(options.model || "saaras:v3");
  // Sources can be English, Hindi, or code-mixed. Sarvam documents `unknown`
  // as the auto-detection input and returns predominant `language_code` plus
  // `language_probability`; forcing hi-IN skips that detection entirely.
  const langHint = String(options.langHint || "auto");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const origin = options.origin;

  return Object.freeze({
    family: FAMILY,
    name: "sarvam-saaras-batch",
    version: VERSION,
    model,
    // No `billing` block: Sarvam pricing is unresolved (see
    // api/_asr/providers/sarvam-saaras.js's header) and worker.js only ever
    // reserves provider spend when `adapter.billing?.meter ===
    // "azure_speech_audio_ms"`. Leaving billing undefined means every job
    // through this adapter settles as `not_metered`, which is correct until
    // the real per-minute rate is confirmed and this is wired into
    // api/_provider-budget.js on purpose.
    async transcribe({ source, inputs, signal }) {
      if (!Array.isArray(inputs) || !inputs.length) throw adapterError("sarvam_asr_input_count_invalid");
      const segments = [];
      for (const input of inputs) {
        // The one and only byte read: through the SAME scoped, integrity-
        // checked resolver every other step uses. The Sarvam provider below
        // is given those bytes directly (via `readAudio`) rather than being
        // asked to fetch its own copy, so this stays a single storage read
        // and a single sha256 check, not two.
        const runResolved = async (resolved) => {
          const provider = createSarvamSaarasProvider({
            apiKey, model, fetchImpl, origin,
            readAudio: async () => ({ body: resolved.body, mime: resolved.mime, byteSize: resolved.byteSize }),
          });
          const ref = {
            storagePath: String(input.object_path || "").replace(/^\/+/, ""),
            sha256: input.sha256,
            mime: resolved.mime,
            byteSize: resolved.byteSize ?? resolved.body?.length ?? 0,
            durationMs: Number.isInteger(input.duration_ms) ? input.duration_ms : 0,
          };
          return provider.transcribe(ref, langHint);
        };
        let result;
        try {
          result = typeof options.withInputFile === "function"
            ? await options.withInputFile({ source, input, signal }, (file) => runResolved({
                body: createReadStream(file.path), mime: file.mime, byteSize: file.byteSize,
              }))
            : await runResolved(await options.resolveInput({ source, input, signal }));
        } catch (error) {
          if (error?.code) throw adapterError(String(error.code).slice(0, 96), retryableFrom(error));
          throw adapterError("sarvam_asr_unexpected_error", true);
        }
        for (const turn of result.turns) {
          const startMs = Math.max(0, Math.round(Number(turn.t0) || 0));
          const rawEndMs = Math.round(Number(turn.t1) || 0);
          // A provider that returned no per-turn timing (the undiarized
          // fallback `turnsFrom` uses when diarization is absent from the
          // response) reports t0=t1=0. Falling back to the input's OWN
          // measured duration — real evidence from `media_probe`, not a
          // guess — keeps the span honest about what it covers instead of
          // manufacturing a plausible-looking window.
          const endMs = rawEndMs > startMs
            ? rawEndMs
            : (Number.isInteger(input.duration_ms) && input.duration_ms > startMs ? input.duration_ms : startMs + 1);
          segments.push({
            artifact_id: input.artifact_id || null,
            start_ms: startMs,
            end_ms: endMs,
            confidence: 0,
            text: turn.text,
            language: result.languageCode || "unknown",
            language_probability: result.languageProbability,
            language_source: result.languageSource,
            words: [],
            speaker_key: turn.speaker ? `sarvam-${turn.speaker}` : null,
            code_switch: null,
          });
        }
      }
      return Object.freeze({ segments: Object.freeze(segments), usage: Object.freeze({}) });
    },
  });
}
