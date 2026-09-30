import {
  CLAIM_EXTRACTION_JSON_SCHEMA,
  CLAIM_EXTRACTION_PROMPT,
  extractionMessages,
  validateExtractionOutput,
} from "../contracts.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

class OpenRouterClaimExtractionError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "OpenRouterClaimExtractionError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function fail(code, options) {
  throw new OpenRouterClaimExtractionError(code, options);
}

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function responseJson(response, maxBytes = 1_000_000) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) fail("openrouter_response_too_large", { retryable: true });
  let text;
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          fail("openrouter_response_too_large", { retryable: true });
        }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks, bytes).toString("utf8");
    } finally {
      reader.releaseLock();
    }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) fail("openrouter_response_too_large", { retryable: true });
  }
  try { return JSON.parse(text); } catch { fail("openrouter_response_invalid"); }
}

function deadline(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("openrouter-claim-timeout")), timeoutMs);
  const abort = () => controller.abort(signal.reason || new Error("claim-extraction-aborted"));
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  return {
    signal: controller.signal,
    close() { clearTimeout(timeout); signal?.removeEventListener?.("abort", abort); },
    timedOut() { return controller.signal.aborted && !signal?.aborted; },
  };
}

export function createOpenRouterClaimExtractor(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const model = String(options.model || "").trim();
  if (apiKey.length < 16) fail("openrouter_claim_auth_missing");
  if (!/^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(model) || model.length > 120) fail("openrouter_claim_model_invalid");
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") fail("openrouter_claim_fetch_required");
  const timeoutMs = Math.max(5_000, Math.min(45_000, Number(options.timeoutMs) || 40_000));
  return Object.freeze({
    family: "claim-extraction",
    name: "openrouter-structured-output",
    version: `openrouter-v1:${CLAIM_EXTRACTION_PROMPT}`,
    model,
    billing: Object.freeze({ meter: "openrouter_tokens", max_output_tokens: 4_000 }),
    async extract({ batch, signal }) {
      if (signal?.aborted) fail("claim_extraction_aborted");
      const timer = deadline(signal, timeoutMs);
      try {
        const response = await fetchImpl(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: extractionMessages(batch),
            temperature: 0,
            max_tokens: 4_000,
            provider: { require_parameters: true },
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vyakti_claim_extraction",
                description: "Evidence-cited proposed claims about the verified speaker",
                strict: true,
                schema: CLAIM_EXTRACTION_JSON_SCHEMA,
              },
            },
          }),
          signal: timer.signal,
        });
        if (!response.ok) fail(`openrouter_claim_http_${Number(response.status) || "unknown"}`, {
          retryable: retryable(Number(response.status)),
          status: Number(response.status) || 0,
        });
        const payload = await responseJson(response);
        const choice = payload?.choices?.[0];
        if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string")
          fail("openrouter_claim_response_incomplete", { retryable: choice?.finish_reason === "length" });
        return {
          output: validateExtractionOutput(choice.message.content, batch),
          usage: {
            input_tokens: Math.max(0, Number(payload?.usage?.prompt_tokens) || 0),
            output_tokens: Math.max(0, Number(payload?.usage?.completion_tokens) || 0),
          },
        };
      } catch (cause) {
        if (cause instanceof OpenRouterClaimExtractionError) throw cause;
        if (signal?.aborted) fail("claim_extraction_aborted");
        if (timer.timedOut()) fail("openrouter_claim_timeout", { retryable: true });
        fail("openrouter_claim_network_error", { retryable: true });
      } finally {
        timer.close();
      }
    },
  });
}
