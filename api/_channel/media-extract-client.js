// The transport to `services/media-extract` (Gurukul WS-S).
//
// `api/_replica-processing/providers/azure-voice-evidence.js` is the shape
// this copies, deliberately and almost line for line: the same signature
// construction over protocol/method/path/timestamp/nonce/body-digest, the
// same response-signature verification over nonce/status/response-digest, the
// same "a secret shorter than 32 bytes is a startup failure, not a warning".
// Two HMAC transports that differ in spelling are two transports that have to
// be audited separately.
//
// ── what crosses this boundary, and what cannot ──────────────────────────
// Out: a video id, an attestation envelope (receipt hash + channel key +
// expiry), a duration ceiling, and a pre-signed upload target.
// NOT out: an owner id, a replica id, a watch id, a person's name, a
// transcript, or a storage credential. The service is told WHAT was permitted
// and never WHO permitted it — services/voice-evidence's rule, and the reason
// this can be a service rather than a privileged part of the app.
// In: a digest, a byte count, a duration, a sample rate, an extractor
// version. Never bytes. The media went straight to storage.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PROTOCOL = "vyakti-media-extract/v1";
const SHA256 = /^[0-9a-f]{64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export class MediaExtractError extends Error {
  constructor(code, status = 502, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 502, details) {
  throw new MediaExtractError(code, status, details);
}

function secretBytes(value) {
  const raw = String(value || "");
  let bytes;
  try { bytes = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { fail("media_extract_hmac_secret_invalid", 503); }
  if (!bytes || bytes.length < 32) fail("media_extract_hmac_secret_required", 503);
  return bytes;
}

export function mediaExtractConfig(env = process.env) {
  let origin;
  try { origin = new URL(String(env.AZURE_MEDIA_EXTRACT_ORIGIN || "")); }
  catch { fail("media_extract_origin_required", 503); }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
    fail("media_extract_origin_invalid", 503);
  }
  const timeoutMs = Number(env.MEDIA_EXTRACT_TIMEOUT_MS || 1_800_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 3_600_000) {
    fail("media_extract_timeout_invalid", 503);
  }
  // The application-plane ceiling. The service enforces its own, which is the
  // second layer; this one is what a `vy_ingest_run` row's failure code
  // reports, so a teacher who uploads a nine-hour livestream is told "too
  // long" without a container ever being woken to say so.
  const maxDurationMs = Number(env.MEDIA_EXTRACT_MAX_DURATION_MS || 14_400_000);
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 60_000 || maxDurationMs > 21_600_000) {
    fail("media_extract_max_duration_invalid", 503);
  }
  return Object.freeze({
    origin: origin.origin,
    transportSecret: secretBytes(env.MEDIA_EXTRACT_HMAC_SECRET),
    timeoutMs,
    maxDurationMs,
  });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function signature(key, ...parts) {
  return createHmac("sha256", key).update(parts.join("\n")).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

async function call(config, path, payload, fetchImpl) {
  const body = Buffer.from(canonicalJson(payload));
  // A content digest and a MAC are different primitives; they get different
  // helpers here rather than one helper with a mode argument, because that is
  // how a signature ends up keyed on the wrong thing.
  const digest = createHash("sha256").update(body).digest("hex");
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(18).toString("base64url");
  let response;
  try {
    response = await fetchImpl(`${config.origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vyakti-Protocol": PROTOCOL,
        "X-Vyakti-Timestamp": timestamp,
        "X-Vyakti-Nonce": nonce,
        "X-Vyakti-Content-SHA256": digest,
        "X-Vyakti-Signature": signature(config.transportSecret, PROTOCOL, "POST", path, timestamp, nonce, digest),
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    fail("media_extract_unreachable", 503);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) fail("media_extract_response_size_invalid");
  const responseDigest = createHash("sha256").update(bytes).digest("hex");
  const expected = signature(config.transportSecret, PROTOCOL, "response", path, nonce, String(response.status), responseDigest);
  if (!equal(expected, response.headers.get("x-vyakti-response-signature"))) fail("media_extract_response_signature_invalid");
  let value;
  try { value = JSON.parse(bytes); }
  catch { fail("media_extract_response_invalid"); }
  if (!response.ok) {
    // The service's typed code is carried through UNCHANGED and prefixed, so
    // `channel_extract_bot_check` on a run row means the same thing the
    // service meant. A transport that flattened every failure to one code
    // would erase the whole point of classifying them.
    const code = String(value?.error || "media_extract_failed").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 100);
    fail(`channel_extract_${code}`, response.status === 403 || response.status === 413 ? response.status : 502);
  }
  return value;
}

/** The attestation envelope, validated on the way OUT as well as being
 *  checked by the service on the way in. A client that could send a malformed
 *  envelope would learn about it as a 403 from a container that had to be
 *  woken up; this turns it into a local failure with the same code. */
function envelope(attestation) {
  if (!attestation || !SHA256.test(String(attestation.receiptHash || ""))) {
    fail("channel_extract_attestation_missing", 403);
  }
  const expiresAt = Date.parse(String(attestation.expiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) fail("channel_extract_attestation_expired", 403);
  const key = String(attestation.channelKey || "");
  if (!key) fail("channel_extract_attestation_channel_invalid", 403);
  return {
    receipt_hash: String(attestation.receiptHash).toLowerCase(),
    channel_key: key,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

export function createMediaExtractClient(options = {}) {
  const config = options.config || mediaExtractConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;

  return Object.freeze({
    protocol: PROTOCOL,
    maxDurationMs: config.maxDurationMs,

    /** One video → one WAV at the caller's pre-signed upload target. */
    async extractAudio({ videoId, attestation, upload, maxDurationMs }) {
      if (!VIDEO_ID.test(String(videoId || ""))) fail("channel_extract_video_id_invalid", 400);
      const ceiling = Number(maxDurationMs || config.maxDurationMs);
      if (!Number.isSafeInteger(ceiling) || ceiling < 1000) fail("channel_extract_ceiling_invalid", 400);
      if (!upload?.url || typeof upload.url !== "string") fail("channel_extract_upload_target_invalid", 500);
      const result = await call(config, "/v1/extract", {
        video_id: String(videoId),
        max_duration_ms: ceiling,
        attestation: envelope(attestation),
        upload: { url: upload.url, headers: upload.headers || {} },
      }, fetchImpl);
      const sha256 = String(result?.sha256 || "").toLowerCase();
      const byteSize = Number(result?.byte_size);
      const durationMs = Number(result?.duration_ms);
      if (!SHA256.test(sha256) || !Number.isSafeInteger(byteSize) || byteSize < 1 ||
          !Number.isFinite(durationMs) || durationMs <= 0) {
        fail("channel_extract_response_invalid");
      }
      if (Number(result?.sample_rate_hz) !== 16_000 || Number(result?.channels) !== 1) {
        // The normalization is the contract with everything downstream, and a
        // service that returned a differently-shaped file would produce
        // measurements that look comparable and are not.
        fail("channel_extract_normalization_invalid");
      }
      return Object.freeze({
        sha256,
        byteSize,
        durationMs: Math.round(durationMs),
        sampleRateHz: 16_000,
        mime: "audio/wav",
        extractorVersion: String(result?.extractor_version || "unknown").slice(0, 32),
      });
    },

    /** The back catalogue, oldest-first, resumable. */
    async enumerateCatalogue({ attestation, afterVideoId = "", limit = 50 }) {
      const result = await call(config, "/v1/enumerate", {
        attestation: envelope(attestation),
        after_video_id: String(afterVideoId || ""),
        limit: Math.max(1, Math.min(200, Number(limit) || 50)),
      }, fetchImpl);
      const videos = Array.isArray(result?.videos) ? result.videos : fail("channel_extract_response_invalid");
      return Object.freeze({
        exhausted: Boolean(result?.exhausted),
        videos: Object.freeze(videos
          .filter((video) => VIDEO_ID.test(String(video?.video_id || "")))
          .map((video) => Object.freeze({
            videoId: String(video.video_id),
            durationMs: Math.max(0, Math.round(Number(video?.duration_ms) || 0)),
          }))),
      });
    },
  });
}
