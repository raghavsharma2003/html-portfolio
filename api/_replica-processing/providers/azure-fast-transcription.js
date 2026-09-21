import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { ProcessingAdapterError, assertSha256, sha256Hex } from "../contracts.js";
import { assertAzureServingOrigin, isAzureOnlyServing } from "../../_model-serving-policy.js";

export const AZURE_FAST_TRANSCRIPTION_API_VERSION = "2025-10-15";
export const AZURE_FAST_TRANSCRIPTION_MAX_BYTES = 250_000_000;
export const AZURE_FAST_TRANSCRIPTION_MAX_DURATION_MS = 2 * 60 * 60 * 1_000;
export const AZURE_HINGLISH_LOCALES = Object.freeze(["en-IN", "hi-IN"]);

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_INPUT_BYTES = AZURE_FAST_TRANSCRIPTION_MAX_BYTES;
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
  return {
    bytes,
    byteSize: bytes.length,
    sha256: expectedSha,
    mime,
    extension: SUPPORTED_MIME.get(mime),
    transform: "none",
  };
}

async function hashPrivateFile(path, signal, createFileStream) {
  const digest = createHash("sha256");
  const stream = createFileStream(path, { signal, highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    throwIfAborted(signal);
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : null;
    if (!bytes) throw adapterError("azure_asr_input_body_invalid");
    digest.update(bytes);
  }
  throwIfAborted(signal);
  return digest.digest("hex");
}

async function resolvePrivateInputFile(file, input, maxBytes, signal, io, transformed = false) {
  if (!file || typeof file !== "object" || "audioUrl" in file || "signedReadUrl" in file || "url" in file) {
    throw adapterError("azure_asr_private_url_forbidden");
  }
  if (typeof file.path !== "string" || !file.path) throw adapterError("azure_asr_input_body_invalid");
  const mime = transformed
    ? String(file.mime || "").split(";", 1)[0].trim().toLowerCase()
    : normalizedMime(file, input);
  if (transformed && !SUPPORTED_MIME.has(mime)) throw adapterError("azure_asr_input_mime_invalid");
  let details;
  try { details = await io.statFile(file.path); }
  catch (error) {
    if (signal.aborted) throw error;
    throw adapterError("azure_asr_input_unavailable", true);
  }
  if (!details?.isFile?.()) throw adapterError("azure_asr_input_body_invalid");
  const byteSize = Number(details.size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > maxBytes) {
    throw adapterError("azure_asr_input_size_invalid");
  }
  const declaredSizes = [file.byteSize, transformed ? null : input.byte_size].filter((value) => value != null);
  if (declaredSizes.some((value) => Number(value) !== byteSize)) {
    throw adapterError("azure_asr_input_size_mismatch");
  }
  const expectedSha = assertSha256(input.sha256, "Azure ASR input sha256");
  if (transformed && (
    file.transform !== "azure-asr-flac-16k-mono-v1" ||
    assertSha256(file.sourceSha256, "Azure ASR transformed source sha256") !== expectedSha ||
    Number(file.sourceByteSize) !== Number(input.byte_size) ||
    Number(file.sourceDurationMs) !== Number(input.duration_ms)
  )) {
    throw adapterError("azure_asr_input_integrity_mismatch");
  }
  const transportSha = file.sha256 == null
    ? expectedSha
    : assertSha256(file.sha256, "Azure ASR resolved sha256");
  if (!transformed && transportSha !== expectedSha) throw adapterError("azure_asr_input_integrity_mismatch");
  let actualSha;
  try { actualSha = await hashPrivateFile(file.path, signal, io.createFileStream); }
  catch (error) {
    if (error instanceof ProcessingAdapterError || signal.aborted) throw error;
    throw adapterError("azure_asr_input_unavailable", true);
  }
  if (actualSha !== transportSha) throw adapterError("azure_asr_input_integrity_mismatch");
  return Object.freeze({
    path: file.path,
    byteSize,
    sha256: transportSha,
    mime,
    extension: SUPPORTED_MIME.get(mime),
    transform: transformed ? file.transform : "none",
  });
}

function multipartFileBody(audio, definition, signal, createFileStream) {
  const boundary = `----vyakti-${randomBytes(18).toString("hex")}`;
  const opening = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="audio"; filename="evidence.${audio.extension}"\r\n` +
    `Content-Type: ${audio.mime}\r\n\r\n`,
    "utf8",
  );
  const closing = Buffer.from(
    `\r\n--${boundary}\r\n` +
    "Content-Disposition: form-data; name=\"definition\"\r\n" +
    "Content-Type: application/json; charset=utf-8\r\n\r\n" +
    `${JSON.stringify(definition)}\r\n` +
    `--${boundary}--\r\n`,
    "utf8",
  );
  const body = Readable.from((async function* () {
    yield opening;
    const stream = createFileStream(audio.path, { signal, highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      throwIfAborted(signal);
      yield chunk;
    }
    throwIfAborted(signal);
    yield closing;
  })());
  return Object.freeze({
    body,
    headers: Object.freeze({
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(opening.length + audio.byteSize + closing.length),
    }),
  });
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

function isEmptyAzureSentinel(phrase) {
  const start = Number(phrase?.offsetMilliseconds);
  const confidence = Number(phrase?.confidence);
  const language = String(phrase?.locale || "").trim();
  return Number.isInteger(start) && start >= 0 && Number(phrase?.durationMilliseconds) === 0 &&
    typeof phrase?.text === "string" && phrase.text.trim() === "" &&
    Array.isArray(phrase.words) && phrase.words.length === 0 && LOCALE.test(language) &&
    Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 &&
    (phrase.speaker == null || (Number.isInteger(Number(phrase.speaker)) && Number(phrase.speaker) >= 0)) &&
    (phrase.channel == null || (Number.isInteger(Number(phrase.channel)) && Number(phrase.channel) >= 0));
}

export function normalizeAzureFastTranscription(payload, input) {
  if (!payload || !Array.isArray(payload.phrases) || !payload.phrases.length) {
    throw adapterError("azure_asr_response_invalid");
  }
  // Long-file responses can include a zero-length, content-free sentinel
  // before the real phrases. It carries no transcript or timing evidence and
  // is safe to omit only when every observed structural field matches that
  // exact shape. Missing words on any non-empty phrase remain a hard failure.
  const phrases = payload.phrases.filter((phrase) => !isEmptyAzureSentinel(phrase));
  if (!phrases.length) throw adapterError("azure_asr_response_invalid");
  const locales = new Set();
  const segments = phrases.map((phrase) => {
    const start = milliseconds(phrase?.offsetMilliseconds);
    // Azure occasionally returns a zero phrase duration for long recordings
    // while still returning complete, positive word-level spans. Treat the
    // words as the authoritative end bound in that one documented response
    // shape; never invent a span when the words cannot prove one.
    const duration = milliseconds(phrase?.durationMilliseconds);
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
      if (!wordText || wordStart < start || (duration > 0 && wordStart + wordDuration > start + duration)) {
        throw adapterError("azure_asr_response_invalid");
      }
      return Object.freeze({
        text: wordText,
        start_ms: wordStart,
        end_ms: wordStart + wordDuration,
        confidence: word.confidence == null ? null : finiteConfidence(word.confidence),
      });
    });
    const end = duration > 0 ? start + duration : Math.max(...words.map((word) => word.end_ms));
    if (!Number.isInteger(end) || end <= start || words.some((word) => word.end_ms > end)) {
      throw adapterError("azure_asr_response_invalid");
    }
    const speaker = phrase.speaker == null ? null : milliseconds(phrase.speaker);
    const channel = phrase.channel == null ? null : milliseconds(phrase.channel);
    return {
      artifact_id: input.artifact_id || null,
      start_ms: start,
      end_ms: end,
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

async function postTranscription({ endpoint, authHeaders, input, audio, definition, fetchImpl, maxResponseBytes, signal, beforeProviderRequest, createFileStream }) {
  let request;
  if (audio.path) {
    const multipart = multipartFileBody(audio, definition, signal, createFileStream);
    request = {
      method: "POST",
      headers: { ...authHeaders, ...multipart.headers },
      body: multipart.body,
      duplex: "half",
      signal,
    };
  } else {
    const form = new FormData();
    form.append("audio", new Blob([audio.bytes], { type: audio.mime }), `evidence.${audio.extension}`);
    form.append("definition", JSON.stringify(definition));
    request = { method: "POST", headers: authHeaders, body: form, signal };
  }
  let response;
  try {
    await beforeProviderRequest();
    response = await fetchImpl(
      `${endpoint}speechtotext/transcriptions:transcribe?api-version=${AZURE_FAST_TRANSCRIPTION_API_VERSION}`,
      request,
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
  const env = options.env || process.env;
  if (options.endpoint) assertAzureServingOrigin(options.endpoint, env);
  if (typeof options.resolveInput !== "function" && typeof options.withInputFile !== "function") {
    throw adapterError("azure_asr_input_resolver_missing");
  }
  if (typeof (options.fetchImpl || globalThis.fetch) !== "function" || typeof FormData !== "function" || typeof Blob !== "function") {
    throw adapterError("azure_asr_runtime_unsupported");
  }
  const endpoint = endpointUrl(options.endpoint);
  const getAuthHeaders = authFactory(options);
  const transport = options.fetchImpl || globalThis.fetch;
  const fetchImpl = (url, init) => {
    assertAzureServingOrigin(url, env);
    return transport(url, { ...init, ...(isAzureOnlyServing(env) ? { redirect: "error" } : {}) });
  };
  const locales = localeList(options.locales);
  const maxInputs = boundedInteger(options.maxInputs, 4, 1, 4);
  const maxInputBytes = boundedInteger(
    options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES, 1, AZURE_FAST_TRANSCRIPTION_MAX_BYTES,
  );
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 64 * 1024 * 1024);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 15 * 60_000);
  const io = Object.freeze({
    statFile: options.statFile || statFile,
    createFileStream: options.createFileStream || createReadStream,
  });
  if (typeof io.statFile !== "function" || typeof io.createFileStream !== "function") {
    throw adapterError("azure_asr_runtime_unsupported");
  }
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
    model: "azure-speech-fast-transcription",
    billing: Object.freeze({ meter: "azure_speech_audio_ms" }),
    async transcribe({ source, inputs, signal, billing }) {
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxInputs) {
        throw adapterError("azure_asr_input_count_invalid");
      }
      if (typeof billing?.beforeProviderRequest !== "function") throw adapterError("azure_asr_budget_hook_required");
      const segments = [];
      const transport = [];
      let audioMs = 0;
      for (const input of inputs) {
        if (!Number.isInteger(input?.duration_ms) || input.duration_ms < 1 ||
            input.duration_ms > AZURE_FAST_TRANSCRIPTION_MAX_DURATION_MS) {
          throw adapterError("azure_asr_input_duration_invalid");
        }
        const deadline = operationDeadline(signal, timeoutMs);
        try {
          const run = async (audio) => {
            const authHeaders = await getAuthHeaders(deadline.signal);
            segments.push(...await postTranscription({
              endpoint, authHeaders, input, audio, definition,
              fetchImpl, maxResponseBytes, signal: deadline.signal,
              beforeProviderRequest: billing.beforeProviderRequest,
              createFileStream: io.createFileStream,
            }));
            transport.push(Object.freeze({
              source_sha256: assertSha256(input.sha256, "Azure ASR input sha256"),
              transport_sha256: assertSha256(audio.sha256, "Azure ASR transport sha256"),
              transform: audio.transform,
              byte_size: audio.byteSize,
              mime: audio.mime,
            }));
          };
          if (typeof options.withInputFile === "function") {
            try {
              await options.withInputFile({ source, input, signal: deadline.signal }, async (file) => {
                const original = await resolvePrivateInputFile(
                  file, input, AZURE_FAST_TRANSCRIPTION_MAX_BYTES * 4, deadline.signal, io,
                );
                if (original.byteSize <= maxInputBytes) {
                  await run(original);
                  return;
                }
                if (typeof options.prepareInputFile !== "function") {
                  throw adapterError("azure_asr_input_size_invalid");
                }
                await options.prepareInputFile({
                  source, input, file: original, signal: deadline.signal, maxBytes: maxInputBytes,
                }, async (prepared) => {
                  await run(await resolvePrivateInputFile(
                    prepared, input, maxInputBytes, deadline.signal, io, true,
                  ));
                });
              });
            } catch (error) {
              if (error instanceof ProcessingAdapterError || deadline.signal.aborted) throw error;
              if (error?.code === "azure_asr_prepare_tool_unavailable") {
                throw adapterError("azure_asr_input_unavailable", true);
              }
              if (/^azure_asr_[a-z0-9_]+$/.test(String(error?.code || ""))) {
                throw adapterError(String(error.code), error.retryable === true);
              }
              throw adapterError("azure_asr_input_unavailable", true);
            }
          } else {
            await run(await resolvePrivateInput(options.resolveInput, source, input, maxInputBytes, deadline.signal));
          }
          // Azure Speech-to-text is billed per second. Each input is a
          // separate request, so round each request upward independently.
          audioMs += Math.ceil(input.duration_ms / 1_000) * 1_000;
        } catch (error) {
          const aborted = abortError(deadline, signal);
          if (aborted) throw aborted;
          if (error instanceof ProcessingAdapterError) throw error;
          throw adapterError("azure_asr_unexpected_error", true);
        } finally {
          deadline.cleanup();
        }
      }
      return Object.freeze({
        segments: Object.freeze(segments),
        usage: Object.freeze({ audio_ms: audioMs }),
        transport: Object.freeze(transport),
      });
    },
  });
}
