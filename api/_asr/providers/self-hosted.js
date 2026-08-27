// The in-house ASR lane — HMAC-brokered, vendor-independent (Gurukul WS-I).
//
// SPEC-GURUKUL.md §8 item 1 is an owner directive and it is what this file
// exists for: "In-house replica stack, vendor-independent. The self-hosted
// lane (services/open-voice-runtime, open weights on our own GPUs, fine-tuned
// per expert) is the PRIMARY voice path, not the fallback." The argument
// carries to ASR unchanged — an ingestion loop that only runs while a vendor
// contract holds is a core product loop a vendor can switch off — so
// `api/_asr/registry.js` prefers this lane over Sarvam whenever it is
// configured.
//
// ── it mirrors an ADMISSION pattern, not just an HTTP call ───────────────
// api/_voice/providers/open-chatterbox-preview.js is the model, deliberately
// and line-for-line where the mechanism is the same, because that file's
// shape is the thing that makes a GPU box on the public internet safe to
// talk to:
//
//   - a named protocol version in a header, so a rolling deploy cannot half
//     understand a request;
//   - an HMAC over (protocol, method, path, timestamp, nonce, body-hash) —
//     the body HASH, not the body, so signing cost does not scale with an
//     hour of audio;
//   - a signed RESPONSE, verified with `timingSafeEqual` before a single
//     field of it is read. This is the half most implementations skip, and
//     it is the half that matters: without it a hijacked origin can hand back
//     a transcript that becomes a real teacher's measured phrase bank;
//   - a MODEL COMMITMENT the response must echo, so "which model produced
//     this transcript" is answered by the transcript rather than by the
//     deploy log. SPEC §8 item 2 makes fidelity a numeric per-clone product
//     feature recomputed on every model update — that recomputation is only
//     meaningful if each artifact names the model it came from.
//
// ── the one deliberate difference from the voice provider ────────────────
// The voice lane sends its reference audio inline as base64 because a
// 90-second enrollment clip fits. A lecture does not: an hour of WAV is
// hundreds of megabytes and inlining it would put a real teacher's audio in a
// JSON string in a Node heap. So this lane sends a SIGNED, short-lived READ
// URL for the object and the runtime pulls it — the bytes go GPU-ward once,
// over a URL that expires, and the audio's sha256 is in the signed envelope
// so the runtime can prove it fetched what we meant.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import { createSignedReplicaRead } from "../../_replica-storage.js";
import { asrInput, asrResult, langHint } from "../contracts.js";

const PROTOCOL = "vyakti-open-asr/v1";
const NAME = "open-asr-runtime";
const DEFAULT_MODEL = "indic-conformer-hinglish-v1";
const PATH = "/v1/transcribe";
const TIMEOUT_MS = 900_000;      // an hour of audio, transcribed
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function fail(code, status = 503, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

function secret(value) {
  const raw = String(value || "");
  let bytes;
  try { bytes = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { fail("asr_hmac_secret_required"); }
  if (!bytes || bytes.length < 32) fail("asr_hmac_secret_required");
  return bytes;
}

/** Exactly `openChatterboxConfig`'s validation: https only, no credentials in
 *  the URL, bare origin. A userinfo-carrying origin is how a secret ends up
 *  in a log line, and a path-carrying one is how a signature over `path`
 *  stops meaning anything. */
export function selfHostedAsrConfig(env = process.env) {
  let origin;
  try { origin = new URL(String(env.ASR_SELF_HOSTED_ORIGIN || "")); }
  catch { fail("asr_origin_required"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    fail("asr_origin_invalid");
  }
  return Object.freeze({
    origin: origin.origin,
    transportSecret: secret(env.ASR_HMAC_SECRET),
    model: String(env.ASR_SELF_HOSTED_MODEL || DEFAULT_MODEL),
    modelCommitment: String(env.ASR_SELF_HOSTED_MODEL_COMMITMENT || ""),
  });
}

function signature(secretBytes, values) {
  return createHmac("sha256", secretBytes).update(values.join("\n")).digest("base64url");
}

function equal(left, right) {
  const one = Buffer.from(String(left || ""));
  const two = Buffer.from(String(right || ""));
  return one.length === two.length && one.length >= 32 && timingSafeEqual(one, two);
}

export function createSelfHostedAsrProvider(options = {}) {
  const config = selfHostedAsrConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  const signRead = options.signRead || ((locator) => createSignedReplicaRead(locator, { fetchImpl }));

  return Object.freeze({
    name: NAME,
    model: config.model,
    modelCommitment: config.modelCommitment,

    async transcribe(rawRef, hint = "hi-IN") {
      const ref = asrInput(rawRef);
      const language = langHint(hint);
      const requestId = randomUUID();
      const signed = await signRead({ storageBucket: ref.storageBucket, objectPath: ref.storagePath });
      const readUrl = String(signed?.url || signed || "");
      if (!readUrl.startsWith("https://")) fail("asr_signed_read_unavailable");

      const payload = {
        request_id: requestId,
        audio_url: readUrl,
        audio_sha256: ref.sha256,
        audio_mime: ref.mime || "audio/wav",
        audio_duration_ms: ref.durationMs,
        language_hint: language,
        with_diarization: true,
        model: config.model,
      };
      const body = Buffer.from(canonicalJson(payload));
      const bodyHash = sha256Hex(body);
      const timestamp = new Date().toISOString();
      const nonce = randomBytes(18).toString("base64url");

      let response;
      try {
        response = await fetchImpl(`${config.origin}${PATH}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Vyakti-Protocol": PROTOCOL,
            "X-Vyakti-Timestamp": timestamp,
            "X-Vyakti-Nonce": nonce,
            "X-Vyakti-Content-SHA256": bodyHash,
            "X-Vyakti-Signature": signature(config.transportSecret, [PROTOCOL, "POST", PATH, timestamp, nonce, bodyHash]),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch { fail("asr_self_hosted_unreachable"); }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_RESPONSE_BYTES) fail("asr_response_size_invalid");
      // Verified BEFORE parsing. A signature checked after the body has been
      // interpreted is a signature checked after the damage.
      const expected = signature(config.transportSecret, [PROTOCOL, "response", PATH, nonce, String(response.status), sha256Hex(bytes)]);
      if (!equal(response.headers.get("x-vyakti-response-signature"), expected)) fail("asr_response_signature_invalid");
      let result;
      try { result = JSON.parse(bytes.toString("utf8")); }
      catch { fail("asr_response_invalid"); }
      if (!response.ok) fail(String(result?.error || `asr_self_hosted_http_${response.status}`), response.status >= 500 ? 503 : 409);

      // The binding: this transcript is OF the audio we sent, FROM the model
      // we asked for, FOR the request we made. Any of the three failing means
      // the artifact cannot be attributed, and an unattributable transcript
      // must not become a named person's measured phrase bank.
      if (String(result?.request_id || "").toLowerCase() !== requestId ||
          String(result?.audio_sha256 || "") !== ref.sha256 ||
          String(result?.model || "") !== config.model ||
          (config.modelCommitment && String(result?.model_commitment || "") !== config.modelCommitment)) {
        fail("asr_response_binding_invalid", 409);
      }
      return asrResult({ turns: result?.turns, provider: NAME, model: config.model }, { name: NAME, model: config.model });
    },
  });
}
