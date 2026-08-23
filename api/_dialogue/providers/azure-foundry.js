import { DIALOGUE_OUTPUT_SCHEMA, DIALOGUE_PROMPT } from "../contracts.js";

export const AZURE_DIALOGUE_API_VERSION = "2024-05-01-preview";

export class DialogueAdapterError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "DialogueAdapterError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function fail(code, options) {
  throw new DialogueAdapterError(code, options);
}

function endpoint(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("dialogue_azure_config_missing"); }
  if (url.protocol !== "https:" || !/\.services\.ai\.azure\.com$/i.test(url.hostname) || url.username || url.password)
    fail("dialogue_azure_endpoint_invalid");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models/chat/completions`.replace(/\/+/g, "/");
  url.search = new URLSearchParams({ "api-version": AZURE_DIALOGUE_API_VERSION }).toString();
  return url;
}

function deadline(signal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("dialogue-timeout")), timeoutMs);
  const abort = () => controller.abort(signal.reason || new Error("dialogue-aborted"));
  signal?.addEventListener?.("abort", abort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.aborted && !signal?.aborted,
    close() { clearTimeout(timeout); signal?.removeEventListener?.("abort", abort); },
  };
}

async function responseJson(response, maxBytes = 512_000) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) fail("dialogue_azure_response_too_large", { retryable: true });
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) fail("dialogue_azure_response_too_large", { retryable: true });
  try { return JSON.parse(text); } catch { fail("dialogue_azure_response_invalid"); }
}

export function createAzureFoundryDialogueGenerator(options = {}) {
  const url = endpoint(options.endpoint);
  const model = String(options.model || "").trim();
  const apiKey = String(options.apiKey || "");
  if (!model || model.length > 120) fail("dialogue_azure_model_required");
  if (apiKey.length < 16) fail("dialogue_azure_auth_required");
  const fetchImpl = options.fetchImpl || fetch;
  if (typeof fetchImpl !== "function") fail("dialogue_azure_fetch_required");
  const timeoutMs = Math.max(5_000, Math.min(55_000, Number(options.timeoutMs) || 45_000));
  return Object.freeze({
    family: "dialogue",
    name: "azure-foundry-structured-output",
    version: `${AZURE_DIALOGUE_API_VERSION}:${DIALOGUE_PROMPT}`,
    model,
    billing: Object.freeze({ meter: "azure_foundry_tokens", max_output_tokens: 700 }),
    async generate({ prompt, signal }) {
      const timer = deadline(signal, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify({
            model,
            messages: prompt.messages,
            temperature: 0.45,
            max_tokens: 700,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vyakti_replica_dialogue",
                description: "A private replica reply with a controlled delivery plan",
                strict: true,
                schema: DIALOGUE_OUTPUT_SCHEMA,
              },
            },
          }),
          signal: timer.signal,
        });
        if (!response.ok) fail(`dialogue_azure_http_${Number(response.status) || "unknown"}`, {
          status: Number(response.status) || 0,
          retryable: [408, 409, 429].includes(Number(response.status)) || Number(response.status) >= 500,
        });
        const payload = await responseJson(response);
        const choice = payload?.choices?.[0];
        if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string")
          fail("dialogue_azure_response_incomplete", { retryable: choice?.finish_reason === "length" });
        return {
          output: choice.message.content,
          usage: {
            input_tokens: Math.max(0, Number(payload?.usage?.prompt_tokens) || 0),
            output_tokens: Math.max(0, Number(payload?.usage?.completion_tokens) || 0),
          },
        };
      } catch (error) {
        if (error instanceof DialogueAdapterError) throw error;
        if (signal?.aborted) fail("dialogue_aborted");
        if (timer.timedOut()) fail("dialogue_azure_timeout", { retryable: true });
        fail("dialogue_azure_network_error", { retryable: true });
      } finally {
        timer.close();
      }
    },
  });
}
