import { resolveReplyServingProvider } from "./_model-serving-policy.js";
import { azureSurfaceReplyConfig } from "./_azure-surface-reply.js";

const FAILURE_CODES = new Set([
  "model_serving_provider_denied", "azure_reply_endpoint_required",
  "azure_reply_endpoint_invalid", "azure_reply_model_required",
  "azure_reply_auth_required", "provider_budget_id_invalid",
  "provider_budget_limit_required", "provider_input_rate_required",
  "provider_output_rate_required", "neon_url_missing",
]);

// This is shared-reply configuration readiness, not a private-dialogue,
// encryption, auth, storage or remote-provider health check. No I/O occurs.
export function selfCheckServing(env = process.env) {
  if (env.VYAKTI_MODEL_SERVING !== "azure_only" && env.VYAKTI_REPLY_PROVIDER !== "azure_foundry") return null;
  const required = [
    "NEON_URL",
    env.AZURE_FOUNDRY_REPLY_ENDPOINT ? "AZURE_FOUNDRY_REPLY_ENDPOINT" : "AZURE_FOUNDRY_ENDPOINT",
    env.AZURE_FOUNDRY_REPLY_API_KEY ? "AZURE_FOUNDRY_REPLY_API_KEY" : "AZURE_FOUNDRY_API_KEY",
    "AZURE_FOUNDRY_REPLY_MODEL", "AZURE_REPLICA_APP_BUDGET_USD",
    "AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS", "AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS",
  ];
  try {
    resolveReplyServingProvider(env);
    azureSurfaceReplyConfig(env);
    if (!String(env.NEON_URL || "").trim()) throw Object.assign(new Error("neon_url_missing"), { code: "neon_url_missing" });
    return { required, check: { door: "provider: azure_foundry_shared_reply configuration", ok: true } };
  } catch (error) {
    // Do not forward arbitrary exception messages, codes or configuration data.
    const code = FAILURE_CODES.has(error?.code) ? error.code : "azure_reply_config_invalid";
    return { required, check: { door: `provider: ${code}`, ok: false } };
  }
}
