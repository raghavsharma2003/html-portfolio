import { ProcessingAdapterError, assertSha256, sha256Hex } from "../contracts.js";

export const AZURE_FAST_TRANSCRIPTION_API_VERSION = "2025-10-15";
export const AZURE_FAST_TRANSCRIPTION_MAX_BYTES = 250_000_000;
export const AZURE_FAST_TRANSCRIPTION_MAX_DURATION_MS = 2 * 60 * 60 * 1_000;
export const AZURE_HINGLISH_LOCALES = Object.freeze(["en-IN", "hi-IN"]);

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const AZURE_HOST = /^(?:[a-z0-9-]+\.cognitiveservices\.azure\.com|[a-z0-9-]+\.api\.cognitive\.microsoft\.com)$/i;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$/;
const SUPPORTED_MIME = new Map([
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/flac", "flac"],
  ["audio/x-flac", "flac"],
  ["audio/mp4", "m4a"],
  ["audio/aac", "aac"],
  ["audio/webm", "webm"],
  ["audio/amr", "amr"],
  ["audio/speex", "spx"],
  ["audio/x-ms-wma", "wma"],
]);

function adapterError(code, retryable = false, details = {}) {
  const error = new ProcessingAdapterError("Azure fast transcription failed", { code, retryable });
  if (Number.isInteger(details.status)) error.status = details.status;
  if (Number.isFinite(details.retryAfterMs)) error.retryAfterMs = details.retryAfterMs;
  return error;
}

function endpointUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw adapterError("azure_asr_config_missing"); }
  if (url.protocol !== "https:" || !AZURE_HOST.test(url.hostname) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw adapterError("azure_asr_endpoint_invalid");
  }
  return `${url.origin}/`;
}

function boundedInteger(value, fallback, min, max, code = "azure_asr_config_invalid") {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw adapterError(code);
  return number;
}

function localeList(value) {
  const locales = value == null ? [...AZURE_HINGLISH_LOCALES] : [...value];
  if (!locales.length || locales.length > 10) throw adapterError("azure_asr_locales_invalid");
  const normalized = [...new Set(locales.map((locale) => String(locale).trim()))];
  if (normalized.some((locale) => !LOCALE.test(locale))) throw adapterError("azure_asr_locales_invalid");
  return Object.freeze(normalized);
}

function authFactory(options) {
  const hasKey = typeof options.apiKey === "string" && options.apiKey.length >= 16;
  const hasTokenProvider = typeof options.getAccessToken === "function";
  if (hasKey === hasTokenProvider) throw adapterError("azure_asr_auth_config_invalid");
  if (hasKey) return async () => ({ "Ocp-Apim-Subscription-Key": options.apiKey });
  return async (signal) => {
    let credential;
    try { credential = await options.getAccessToken({ signal }); }
    catch { throw adapterError("azure_asr_auth_unavailable", true); }
    const token = typeof credential === "string" ? credential : credential?.token;
    if (typeof token !== "string" || token.length < 16) throw adapterError("azure_asr_auth_unavailable", true);
    return { Authorization: `Bearer ${token}` };
  };
}

function operationDeadline(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("azure-asr-timeout"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function abortError(deadline, externalSignal) {
  if (deadline.didTimeOut()) return adapterError("azure_asr_timeout", true);
  if (externalSignal?.aborted || deadline.signal.aborted) return adapterError("azure_asr_aborted", false);
  return null;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
}

async function collectBounded(body, maxBytes, signal) {
  throwIfAborted(signal);
  if (body instanceof Blob) {
    if (body.size < 1 || body.size > maxBytes) throw adapterError("azure_asr_input_size_invalid");
    const bytes = Buffer.from(await body.arrayBuffer());
    throwIfAborted(signal);
    return bytes;
  }
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    const bytes = Buffer.isBuffer(body)
      ? Buffer.from(body)
      : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (bytes.length < 1 || bytes.length > maxBytes) throw adapterError("azure_asr_input_size_invalid");
    return bytes;
  }
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    throw adapterError("azure_asr_input_body_invalid");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    throwIfAborted(signal);
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : null;
    if (!bytes) throw adapterError("azure_asr_input_body_invalid");
    total += bytes.length;
    if (total > maxBytes) throw adapterError("azure_asr_input_size_invalid");
    chunks.push(bytes);
  }
  if (!total) throw adapterError("azure_asr_input_size_invalid");
  return Buffer.concat(chunks, total);
}

function normalizedMime(resolved, input) {
  const mime = String(resolved.mime || input.mime || "").split(";", 1)[0].trim().toLowerCase();
  const declared = input.mime ? String(input.mime).split(";", 1)[0].trim().toLowerCase() : mime;
  if (!SUPPORTED_MIME.has(mime) || mime !== declared) throw adapterError("azure_asr_input_mime_invalid");
  return mime;
}

async function resolvePrivateInput(resolver, source, input, maxBytes, signal) {
  let resolved;
  try { resolved = await resolver({ source, input, signal }); }
  catch (error) {
    if (error instanceof ProcessingAdapterError) throw error;
    if (signal.aborted) throw error;
    throw adapterError("azure_asr_input_unavailable", true);
  }
  if (!resolved || typeof resolved !== "object" || "audioUrl" in resolved || "signedReadUrl" in resolved || "url" in resolved) {
    throw adapterError("azure_asr_private_url_forbidden");
  }
  const mime = normalizedMime(resolved, input);
  const bytes = await collectBounded(resolved.body, maxBytes, signal);
  if (resolved.byteSize != null && Number(resolved.byteSize) !== bytes.length) {
    throw adapterError("azure_asr_input_size_mismatch");
  }
  const expectedSha = assertSha256(input.sha256, "Azure ASR input sha256");
  if (sha256Hex(bytes) !== expectedSha) throw adapterError("azure_asr_input_integrity_mismatch");
  return { bytes, mime, extension: SUPPORTED_MIME.get(mime) };
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return Math.min(3_600_000, Math.round(milliseconds));
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function readJsonBounded(response, maxBytes, signal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw adapterError("azure_asr_response_too_large", true);
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw adapterError("azure_asr_response_too_large", true);
    try { return JSON.parse(text); } catch { throw adapterError("azure_asr_response_invalid"); }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw adapterError("azure_asr_response_too_large", true);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks, total).toString("utf8")); }
  catch { throw adapterError("azure_asr_response_invalid"); }
}

function finiteConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw adapterError("azure_asr_response_invalid");
  return number;
}

function milliseconds(value, allowZero = true) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) throw adapterError("azure_asr_response_invalid");
  return number;
}

export function normalizeAzureFastTranscription(payload, input) {
  if (!payload || !Array.isArray(payload.phrases) || !payload.phrases.length) {
    throw adapterError("azure_asr_response_invalid");
  }
  const locales = new Set();
  const segments = payload.phrases.map((phrase) => {
    const start = milliseconds(phrase?.offsetMilliseconds);
    const duration = milliseconds(phrase?.durationMilliseconds, false);
    const text = typeof phrase?.text === "string" ? phrase.text.trim() : "";
    const language = String(phrase?.locale || "").trim();
    if (!text || !LOCALE.test(language) || !Array.isArray(phrase.words) || !phrase.words.length) {
      throw adapterError("azure_asr_response_invalid");
    }
    locales.add(language);
    const confidence = finiteConfidence(phrase.confidence);
    const words = phrase.words.map((word) => {
      const wordStart = milliseconds(word?.offsetMilliseconds);
      const wordDuration = milliseconds(word?.durationMilliseconds, false);
      const wordText = typeof word?.text === "string" ? word.text.trim() : "";
      if (!wordText || wordStart < start || wordStart + wordDuration > start + duration) {
        throw adapterError("azure_asr_response_invalid");
      }
      return Object.freeze({
        text: wordText,
        start_ms: wordStart,
        end_ms: wordStart + wordDuration,
        confidence: word.confidence == null ? null : finiteConfidence(word.confidence),
      });
    });
    const speaker = phrase.speaker == null ? null : milliseconds(phrase.speaker);
    const channel = phrase.channel == null ? null : milliseconds(phrase.channel);
    return {
      artifact_id: input.artifact_id || null,
      start_ms: start,
      end_ms: start + duration,
      confidence,
      text,
      language,
      words: Object.freeze(words),
      speaker_key: speaker == null ? null : `azure-speaker-${speaker}`,
      channel,
      code_switch: false,
    };
  });
  const codeSwitch = locales.size > 1;
  return Object.freeze(segments.map((segment) => Object.freeze({ ...segment, code_switch: codeSwitch })));
}

async function postTranscription({ endpoint, authHeaders, input, audio, definition, fetchImpl, maxResponseBytes, signal }) {
  const form = new FormData();
  form.append("audio", new Blob([audio.bytes], { type: audio.mime }), `evidence.${audio.extension}`);
  form.append("definition", JSON.stringify(definition));
  let response;
  try {
    response = await fetchImpl(
      `${endpoint}speechtotext/transcriptions:transcribe?api-version=${AZURE_FAST_TRANSCRIPTION_API_VERSION}`,
      { method: "POST", headers: authHeaders, body: form, signal },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw adapterError("azure_asr_network_error", true);
  }
  if (!response?.ok) {
    const status = Number(response?.status || 0);
    try { await response?.body?.cancel(); } catch { /* content is intentionally not read or logged */ }
    throw adapterError(`azure_asr_http_${status || "unknown"}`, retryableStatus(status), {
      status,
      retryAfterMs: retryAfterMilliseconds(response?.headers?.get("retry-after")),
    });
  }
  const payload = await readJsonBounded(response, maxResponseBytes, signal);
  return normalizeAzureFastTranscription(payload, input);
}

export function createAzureFastTranscriptionAdapter(options = {}) {
  if (typeof options.resolveInput !== "function") throw adapterError("azure_asr_input_resolver_missing");
  if (typeof (options.fetchImpl || globalThis.fetch) !== "function" || typeof FormData !== "function" || typeof Blob !== "function") {
    throw adapterError("azure_asr_runtime_unsupported");
  }
  const endpoint = endpointUrl(options.endpoint);
  const getAuthHeaders = authFactory(options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const locales = localeList(options.locales);
  const maxInputs = boundedInteger(options.maxInputs, 4, 1, 4);
  const maxInputBytes = boundedInteger(
    options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES, 1, AZURE_FAST_TRANSCRIPTION_MAX_BYTES,
  );
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 64 * 1024 * 1024);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 15 * 60_000);
  const maxSpeakers = options.diarizationMaxSpeakers == null
    ? null
    : boundedInteger(options.diarizationMaxSpeakers, null, 2, 35);
  const definition = Object.freeze({
    locales,
    ...(maxSpeakers ? { diarization: Object.freeze({ enabled: true, maxSpeakers }) } : {}),
  });

  return Object.freeze({
    family: "asr",
    name: "azure-speech-fast-transcription",
    version: AZURE_FAST_TRANSCRIPTION_API_VERSION,
    async transcribe({ source, inputs, signal }) {
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxInputs) {
        throw adapterError("azure_asr_input_count_invalid");
      }
      const segments = [];
      for (const input of inputs) {
        if (!Number.isInteger(input?.duration_ms) || input.duration_ms < 1 ||
            input.duration_ms > AZURE_FAST_TRANSCRIPTION_MAX_DURATION_MS) {
          throw adapterError("azure_asr_input_duration_invalid");
        }
        const deadline = operationDeadline(signal, timeoutMs);
        try {
          const audio = await resolvePrivateInput(options.resolveInput, source, input, maxInputBytes, deadline.signal);
          const authHeaders = await getAuthHeaders(deadline.signal);
          segments.push(...await postTranscription({
            endpoint, authHeaders, input, audio, definition,
            fetchImpl, maxResponseBytes, signal: deadline.signal,
          }));
        } catch (error) {
          const aborted = abortError(deadline, signal);
          if (aborted) throw aborted;
          if (error instanceof ProcessingAdapterError) throw error;
          throw adapterError("azure_asr_unexpected_error", true);
        } finally {
          deadline.cleanup();
        }
      }
      return Object.freeze({ segments: Object.freeze(segments) });
    },
  });
}
