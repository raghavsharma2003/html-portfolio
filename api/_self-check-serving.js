import { azureSurfaceReplyConfig } from "./_azure-surface-reply.js";

const FAILURE_CODES = new Set([
  "model_serving_provider_denied", "azure_reply_endpoint_required",
  "azure_reply_endpoint_invalid", "azure_reply_model_required",
  "azure_reply_auth_required", "provider_budget_id_invalid",
  "provider_budget_limit_required", "provider_input_rate_required",
  "provider_output_rate_required", "neon_url_missing",
  "dialogue_azure_rate_model_mismatch", "dialogue_azure_expected_model_required",
]);

// This is shared-reply configuration readiness, not a private-dialogue,
// encryption, auth, storage or remote-provider health check. No I/O occurs.
export function selfCheckServing(env = process.env) {
  const required = [
    "NEON_URL",
    "AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_API_KEY",
    "AZURE_FOUNDRY_DIALOGUE_MODEL", "AZURE_REPLICA_APP_BUDGET_USD",
    "AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS", "AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS",
  ];
  if (String(env.AZURE_FOUNDRY_DIALOGUE_MODEL || "").trim() === "gpt-5.6-terra") {
    required.push("AZURE_FOUNDRY_DIALOGUE_RATE_MODEL", "AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL",
      "AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS", "AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS");
  }
  try {
    azureSurfaceReplyConfig(env);
    if (!String(env.NEON_URL || "").trim()) throw Object.assign(new Error("neon_url_missing"), { code: "neon_url_missing" });
    return { required, check: { door: "provider: azure_foundry_shared_reply configuration", ok: true } };
  } catch (error) {
    // Do not forward arbitrary exception messages, codes or configuration data.
    const code = FAILURE_CODES.has(error?.code) ? error.code : "azure_reply_config_invalid";
    return { required, check: { door: `provider: ${code}`, ok: false } };
  }
}
