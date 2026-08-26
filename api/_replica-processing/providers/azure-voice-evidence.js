import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ProcessingAdapterError, assertSha256, canonicalJson, sha256Hex } from "../contracts.js";

const PROTOCOL = "vyakti-voice-evidence/v1";
const SAFE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Set(["audio/wav", "audio/x-wav", "audio/flac", "audio/mpeg", "audio/mp4", "video/mp4", "video/webm"]);
const EMBEDDING_FAMILIES = new Set(["speechbrain-ecapa-voxceleb", "speechbrain-xvector-voxceleb"]);

function fail(code, retryable = false, status = 503) {
  throw new ProcessingAdapterError(code, { code, retryable, status });
}

function secret(value) {
  const raw = String(value || "");
  let bytes;
  try { bytes = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { fail("voice_evidence_hmac_secret_invalid"); }
  if (!bytes || bytes.length < 32) fail("voice_evidence_hmac_secret_required");
  return bytes;
}

export function azureVoiceEvidenceConfig(env = process.env) {
  let origin;
  try { origin = new URL(String(env.AZURE_VOICE_EVIDENCE_ORIGIN || "")); }
  catch { fail("voice_evidence_origin_required"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    fail("voice_evidence_origin_invalid");
  }
  const maxAudioBytes = Number(env.VOICE_EVIDENCE_MAX_AUDIO_BYTES || 33_554_432);
  const timeoutMs = Number(env.VOICE_EVIDENCE_TIMEOUT_MS || 600_000);
  if (!Number.isSafeInteger(maxAudioBytes) || maxAudioBytes < 1_048_576 || maxAudioBytes > 50_331_648) {
    fail("voice_evidence_max_audio_invalid");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    fail("voice_evidence_timeout_invalid");
  }
  // How long to wait for a scaled-to-zero replica to become ready before
  // signing. The floor is above the measured GPU cold start (roughly 100 to
  // 160 s) because a shorter budget would give up during a wake that is
  // proceeding normally.
  const readyTimeoutMs = Number(env.VOICE_EVIDENCE_READY_TIMEOUT_MS || 300_000);
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 60_000 || readyTimeoutMs > 600_000) {
    fail("voice_evidence_ready_timeout_invalid");
  }
  return Object.freeze({
    origin: origin.origin,
    transportSecret: secret(env.AZURE_VOICE_EVIDENCE_HMAC_SECRET),
    maxAudioBytes,
    timeoutMs,
    readyTimeoutMs,
  });
}

function signature(key, ...parts) {
  return createHmac("sha256", key).update(parts.join("\n")).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

function deadlineSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function collectBounded(body, maxBytes, signal) {
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    const bytes = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (!bytes.length || bytes.length > maxBytes) fail("voice_evidence_input_size_invalid");
    return bytes;
  }
  if (!body || typeof body[Symbol.asyncIterator] !== "function") fail("voice_evidence_input_body_invalid");
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    if (signal?.aborted) fail("voice_evidence_aborted");
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
    if (!bytes) fail("voice_evidence_input_body_invalid");
    total += bytes.length;
    if (total > maxBytes) fail("voice_evidence_input_size_invalid");
    chunks.push(bytes);
  }
  if (!total) fail("voice_evidence_input_size_invalid");
  return Buffer.concat(chunks, total);
}

async function privateInputs(resolver, source, inputs, config, signal) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 4) fail("voice_evidence_input_count_invalid");
  const output = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    let resolved;
    try { resolved = await resolver({ source, input, signal }); }
    catch (error) {
      if (error instanceof ProcessingAdapterError) throw error;
      fail("voice_evidence_private_input_unavailable", true);
    }
    if (!resolved || typeof resolved !== "object" || "url" in resolved || "signedReadUrl" in resolved || "audioUrl" in resolved) {
      fail("voice_evidence_private_url_forbidden");
    }
    const mime = String(resolved.mime || input.mime || "").split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime) || mime !== String(input.mime || mime).split(";", 1)[0].trim().toLowerCase()) {
      fail("voice_evidence_input_mime_invalid");
    }
    const bytes = await collectBounded(resolved.body, config.maxAudioBytes, signal);
    const expected = assertSha256(input.sha256, "voice evidence input sha256");
    if (sha256Hex(bytes) !== expected || (resolved.byteSize != null && Number(resolved.byteSize) !== bytes.length)) {
      fail("voice_evidence_input_integrity_mismatch");
    }
    output.push(Object.freeze({
      input_key: `input-${index + 1}`,
      artifact_id: input.artifact_id || null,
      sha256: expected,
      mime,
      duration_ms: input.duration_ms == null ? null : Number(input.duration_ms),
      bytes,
    }));
  }
  return output;
}

// WAKE FIRST, THEN SIGN. The order is the whole point.
//
// The evidence service scales to zero and takes roughly 100 to 160 s to load
// its models. A signed request sent into that window is held by Container Apps
// until the replica is up, and by then its timestamp is older than the
// service's 60 s anti-replay window, so it is rejected with HTTP 401
// transport_signature_invalid. Measured on production 2026-08-26: every cold
// attempt failed that way, and the only attempt that authenticated was one sent
// minutes after a previous run had already warmed the replica. A correct
// request with the correct key, guaranteed to fail, for a reason that has
// nothing to do with either.
//
// Widening the window is the wrong fix: the window IS the replay protection.
// The signature has to be made after the service can receive it, which is what
// this does.
//
// `/healthz` here is a REAL readiness check and not the trap in
// rejected.md#broker-healthz-is-a-front-door-not-a-readiness-check. That entry
// is about the open-voice BROKER, which answers at the front door and forwards
// separately. This endpoint is served by the evidence app itself and returns
// 200 only once its lifespan has finished loading models and set `ready`; while
// the app is up but still loading it returns 503. So a 200 here means the next
// request can actually be served.
//
// The probe's body is never read. This is a timing gate, not evidence.
async function awaitReady(config, fetchImpl, signal) {
  const deadline = Date.now() + config.readyTimeoutMs;
  let last = "none";
  while (Date.now() < deadline) {
    try {
      const probe = await fetchImpl(`${config.origin}/healthz`, {
        method: "GET",
        signal: deadlineSignal(signal, 30_000),
      });
      last = String(probe.status);
      try { await probe.body?.cancel(); } catch { /* provider response is not evidence */ }
      if (probe.status === 200) return;
    } catch {
      // The wake itself can fail while the replica is still being scheduled.
      last = "unreachable";
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  fail(last === "none" ? "voice_evidence_unreachable" : "voice_evidence_not_ready", true);
}

async function remote(config, operation, inputs, fetchImpl, signal) {
  const path = "/v1/analyze";
  await awaitReady(config, fetchImpl, signal);
  const payload = {
    operation,
    inputs: inputs.map((entry) => ({
      input_key: entry.input_key,
      sha256: entry.sha256,
      mime: entry.mime,
      duration_ms: entry.duration_ms,
      audio_base64: entry.bytes.toString("base64"),
    })),
  };
  const body = Buffer.from(canonicalJson(payload));
  const bodyHash = sha256Hex(body);
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
        "X-Vyakti-Content-SHA256": bodyHash,
        "X-Vyakti-Signature": signature(config.transportSecret, PROTOCOL, "POST", path, timestamp, nonce, bodyHash),
      },
      body,
      signal: deadlineSignal(signal, config.timeoutMs),
    });
  } catch {
    fail("voice_evidence_unreachable", true);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 80 * 1024 * 1024) fail("voice_evidence_response_too_large", true);
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (!responseBytes.length || responseBytes.length > 80 * 1024 * 1024) fail("voice_evidence_response_size_invalid", true);
  const responseHash = sha256Hex(responseBytes);
  const expected = signature(config.transportSecret, PROTOCOL, "response", path, nonce, String(response.status), responseHash);
  if (!equal(expected, response.headers.get("x-vyakti-response-signature"))) fail("voice_evidence_response_signature_invalid");
  let value;
  try { value = JSON.parse(responseBytes); }
  catch { fail("voice_evidence_response_invalid"); }
  if (!response.ok) fail(String(value?.error || "voice_evidence_failed"), response.status === 429 || response.status >= 500, response.status);
  return value;
}

function finite(value, min, max, code = "voice_evidence_response_invalid") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(code);
  return number;
}

function normalizedSegments(value) {
  if (!Array.isArray(value?.segments) || !value.segments.length || value.segments.length > 10_000) fail("voice_evidence_diarization_invalid");
  return value.segments.map((segment) => {
    const start = finite(segment.start_ms, 0, 86_400_000);
    const end = finite(segment.end_ms, start + 1, 86_400_000);
    if (!Number.isInteger(start) || !Number.isInteger(end) || !SAFE.test(String(segment.speaker_key || ""))) fail("voice_evidence_diarization_invalid");
    return Object.freeze({
      start_ms: start,
      end_ms: end,
      speaker_key: segment.speaker_key,
      confidence: finite(segment.confidence, 0, 1),
      target_likelihood: finite(segment.target_likelihood, 0, 1),
      overlap: Boolean(segment.overlap),
    });
  });
}

function normalizedCandidates(value, inputs, maxBytes, requireParent) {
  if (!Array.isArray(value?.candidates) || !value.candidates.length || value.candidates.length > 8) fail("voice_evidence_candidates_invalid");
  const variants = new Set();
  return value.candidates.map((candidate) => {
    if (!SAFE.test(String(candidate.variant_key || "")) || variants.has(candidate.variant_key)) fail("voice_evidence_candidates_invalid");
    variants.add(candidate.variant_key);
    let body;
    try { body = Buffer.from(String(candidate.audio_base64 || ""), "base64"); }
    catch { fail("voice_evidence_candidate_audio_invalid"); }
    if (!body.length || body.length > maxBytes || body.toString("base64") !== candidate.audio_base64) fail("voice_evidence_candidate_audio_invalid");
    const digest = assertSha256(candidate.sha256, "voice evidence candidate sha256");
    if (sha256Hex(body) !== digest) fail("voice_evidence_candidate_integrity_mismatch");
    const inputSha = assertSha256(candidate.input_sha256, "voice evidence candidate input sha256");
    const parent = inputs.find((input) => input.sha256 === inputSha);
    if (!parent || (requireParent && !UUID.test(String(parent.artifact_id || "")))) fail("voice_evidence_candidate_lineage_invalid");
    if (candidate.mime !== "audio/wav" || !SAFE.test(String(candidate.transform_name || "")) || !SAFE.test(String(candidate.transform_version || ""))) {
      fail("voice_evidence_candidate_contract_invalid");
    }
    const duration = finite(candidate.duration_ms, 1, 1_200_000);
    if (!Number.isInteger(duration)) fail("voice_evidence_candidate_contract_invalid");
    return Object.freeze({
      variant_key: candidate.variant_key,
      body,
      sha256: digest,
      mime: "audio/wav",
      duration_ms: duration,
      input_sha256: inputSha,
      parent_artifact_id: requireParent ? parent.artifact_id : null,
      transform_name: candidate.transform_name,
      transform_version: candidate.transform_version,
      parameters: candidate.parameters && typeof candidate.parameters === "object" ? candidate.parameters : {},
      quality: candidate.quality && typeof candidate.quality === "object" ? candidate.quality : {},
    });
  });
}

function normalizedMeasurements(value, inputs) {
  if (!Array.isArray(value?.embeddings) || value.embeddings.length < 2 || value.embeddings.length > 16) fail("voice_evidence_embeddings_invalid");
  const embeddings = value.embeddings.map((embedding) => {
    if (!EMBEDDING_FAMILIES.has(embedding.family) || !SAFE.test(String(embedding.input_key || "")) ||
        !Array.isArray(embedding.vector) || embedding.vector.length < 64 || embedding.vector.length > 2048) {
      fail("voice_evidence_embeddings_invalid");
    }
    const input = inputs.find((entry) => entry.input_key === embedding.input_key);
    if (!input || embedding.vector.some((number) => !Number.isFinite(number) || Math.abs(number) > 10)) fail("voice_evidence_embeddings_invalid");
    return Object.freeze({
      ...(input.artifact_id ? { artifact_id: input.artifact_id } : { input: "raw" }),
      family: embedding.family,
      vector: Object.freeze(embedding.vector.map(Number)),
      confidence: finite(embedding.confidence, 0, 1),
    });
  });
  if (new Set(embeddings.map((entry) => entry.family)).size < 2) fail("voice_evidence_embedding_families_insufficient");
  if (!value.measurements || typeof value.measurements !== "object" || !value.quality || typeof value.quality !== "object") {
    fail("voice_evidence_measurements_invalid");
  }
  return Object.freeze({
    embeddings: Object.freeze(embeddings),
    confidence: finite(value.confidence, 0, 1),
    measurements: value.measurements,
    quality: value.quality,
  });
}

export function createAzureVoiceEvidenceAdapters(options = {}) {
  if (typeof options.resolveInput !== "function") fail("voice_evidence_input_resolver_missing");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") fail("voice_evidence_fetch_unavailable");
  const config = azureVoiceEvidenceConfig(options.env || process.env);
  const invoke = async (operation, request) => {
    const inputs = await privateInputs(options.resolveInput, request.source, request.inputs, config, request.signal);
    return { value: await remote(config, operation, inputs, fetchImpl, request.signal), inputs };
  };
  const meta = (family, name) => Object.freeze({ family, name, version: "vyakti-voice-evidence-v1" });
  return Object.freeze({
    diarize: Object.freeze({
      ...meta("diarization", "silero-ecapa-cluster"),
      async diarize(request) {
        const { value } = await invoke("diarize", request);
        return Object.freeze({ segments: Object.freeze(normalizedSegments(value)) });
      },
    }),
    separate: Object.freeze({
      ...meta("separation", "speechbrain-sepformer-whamr16k"),
      async separate(request) {
        const { value, inputs } = await invoke("separate", request);
        return Object.freeze({ candidates: Object.freeze(normalizedCandidates(value, inputs, config.maxAudioBytes, false)) });
      },
    }),
    enhance: Object.freeze({
      ...meta("enhancement", "deepfilternet3-dual-candidate"),
      async enhance(request) {
        const { value, inputs } = await invoke("enhance", request);
        return Object.freeze({ candidates: Object.freeze(normalizedCandidates(value, inputs, config.maxAudioBytes, true)) });
      },
    }),
    voice_quality: Object.freeze({
      ...meta("voice-analysis", "speechbrain-independent-speaker-evidence"),
      async measure(request) {
        const { value, inputs } = await invoke("voice_quality", request);
        return normalizedMeasurements(value, inputs);
      },
    }),
  });
}

