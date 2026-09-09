import {
  CLAIM_EXTRACTION_JSON_SCHEMA,
  CLAIM_EXTRACTION_PROMPT,
  extractionMessages,
  validateExtractionOutput,
} from "../contracts.js";

export const AZURE_FOUNDRY_OPENAI_API_VERSION = "openai-v1";

// Azure's wire schema cannot carry these canonical string bounds. Keep the
// constraints in the local validator, and state them in the Azure-only
// instruction so the model has the same contract before local validation.
export const AZURE_CLAIM_SCHEMA_GUIDANCE = "Claim shape guidance: key must match ^[a-z][a-z0-9_]{1,63}$ (lowercase ASCII snake_case); body must be 3 to 500 characters. Never truncate or normalize a key or body; omit a claim that cannot satisfy these bounds.";

// Azure's wire subset excludes these constraints from our canonical schema:
// https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs
// Keep the canonical contract and validateExtractionOutput unchanged. The
// provider shape is never authority for citation, key, count or confidence checks.
const UNSUPPORTED_WIRE_KEYWORDS = new Set([
  "minLength", "maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems",
]);
function azureWireSchema(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(azureWireSchema));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !UNSUPPORTED_WIRE_KEYWORDS.has(key))
    .map(([key, child]) => [key, key === "properties"
      ? Object.freeze(Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, azureWireSchema(schema)])))
      : azureWireSchema(child)])));
}
export const AZURE_FOUNDRY_CLAIM_WIRE_SCHEMA = azureWireSchema(CLAIM_EXTRACTION_JSON_SCHEMA);

function azureExtractionMessages(batch) {
  const messages = extractionMessages(batch);
  return [{ ...messages[0], content: `${messages[0].content} ${AZURE_CLAIM_SCHEMA_GUIDANCE}` }, ...messages.slice(1)];
}

function validateAzureOutput(value, batch) {
  const raw = JSON.parse(value);
  // Let the canonical validator refuse the original top-level/count shape;
  // filtering must not turn an excessive batch into an admissible one.
  if (!Array.isArray(raw?.claims) || raw.claims.length > CLAIM_EXTRACTION_JSON_SCHEMA.properties.claims.maxItems)
    return validateExtractionOutput(raw, batch);
  let overlong = 0;
  const claims = raw.claims.filter((claim) => {
    // The local cleaner slices UTF-16 at 500. Reject before that slice can
    // remove a condition. This is deliberately stricter than JSON Schema's
    // Unicode code-point maxLength for astral characters. Keep valid siblings.
    if (typeof claim?.body === "string" && claim.body.length > 500) {
      overlong++;
      return false;
    }
    return true;
  });
  const output = validateExtractionOutput({ ...raw, claims }, batch);
  return overlong ? Object.freeze({ ...output,
    rejected: Object.freeze([...output.rejected, ...Array(overlong).fill("claim_body_too_long")].sort()),
  }) : output;
}

export class ClaimExtractionAdapterError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "ClaimExtractionAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function error(code, options) {
  return new ClaimExtractionAdapterError(code, options);
}

function endpoint(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw error("azure_foundry_config_missing"); }
  if (url.protocol !== "https:" || !/\.services\.ai\.azure\.com$/i.test(url.hostname) || url.username || url.password)
    throw error("azure_foundry_endpoint_invalid");
  url.pathname = "/openai/v1/chat/completions";
  url.search = "";
  url.hash = "";
  return url;
}

async function authorization(options) {
  const hasKey = typeof options.apiKey === "string" && options.apiKey.length >= 16;
  const hasToken = typeof options.tokenProvider === "function";
  if (hasKey === hasToken) throw error("azure_foundry_auth_config_invalid");
  if (hasKey) return { "api-key": options.apiKey };
  let token;
  try { token = await options.tokenProvider(); } catch { throw error("azure_foundry_auth_unavailable", { retryable: true }); }
  if (typeof token !== "string" || token.length < 16) throw error("azure_foundry_auth_unavailable", { retryable: true });
  return { Authorization: `Bearer ${token}` };
}

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function responseJson(response, maxBytes = 1_000_000) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw error("azure_foundry_response_too_large", { retryable: true });
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw error("azure_foundry_response_too_large", { retryable: true });
  try { return JSON.parse(text); } catch { throw error("azure_foundry_response_invalid"); }
}

function deadline(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("azure-foundry-timeout")), timeoutMs);
  const abort = () => controller.abort(signal.reason || new Error("claim-extraction-aborted"));
  signal?.addEventListener?.("abort", abort, { once: true });
  return {
    signal: controller.signal,
    close() { clearTimeout(timeout); signal?.removeEventListener?.("abort", abort); },
    timedOut() { return controller.signal.aborted && !signal?.aborted; },
  };
}

export function createAzureFoundryClaimExtractor(options = {}) {
  const url = endpoint(options.endpoint);
  const model = String(options.model || "").trim();
  if (!model || model.length > 120) throw error("azure_foundry_model_required");
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") throw error("azure_foundry_fetch_required");
  const timeoutMs = Math.max(5_000, Math.min(55_000, Number(options.timeoutMs) || 45_000));
  return Object.freeze({
    family: "claim-extraction",
    name: "azure-foundry-structured-output",
    version: `${AZURE_FOUNDRY_OPENAI_API_VERSION}:${CLAIM_EXTRACTION_PROMPT}:raw-body/v2`,
    model,
    messagesForBudget: azureExtractionMessages,
    billing: Object.freeze({ meter: "azure_foundry_tokens", max_output_tokens: 4_000 }),
    async extract({ batch, signal }) {
      const auth = await authorization(options);
      const timer = deadline(signal, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            model,
            messages: azureExtractionMessages(batch),
            temperature: 0,
            max_tokens: 4_000,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vyakti_claim_extraction",
                description: "Evidence-cited proposed claims about the verified speaker",
                strict: true,
                schema: AZURE_FOUNDRY_CLAIM_WIRE_SCHEMA,
              },
            },
          }),
          signal: timer.signal,
        });
        if (!response.ok) throw error(`azure_foundry_http_${Number(response.status) || "unknown"}`, {
          retryable: retryable(Number(response.status)), status: Number(response.status) || 0,
        });
        const payload = await responseJson(response);
        const choice = payload?.choices?.[0];
        if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string")
          throw error("azure_foundry_response_incomplete", { retryable: choice?.finish_reason === "length" });
        return {
          output: validateAzureOutput(choice.message.content, batch),
          usage: {
            input_tokens: Math.max(0, Number(payload?.usage?.prompt_tokens) || 0),
            output_tokens: Math.max(0, Number(payload?.usage?.completion_tokens) || 0),
          },
        };
      } catch (cause) {
        if (cause instanceof ClaimExtractionAdapterError) throw cause;
        if (signal?.aborted) throw error("claim_extraction_aborted");
        if (timer.timedOut()) throw error("azure_foundry_timeout", { retryable: true });
        throw error("azure_foundry_network_error", { retryable: true });
      } finally {
        timer.close();
      }
    },
  });
}
