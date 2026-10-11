import { createAzureFoundryClaimExtractor } from "./providers/azure-foundry.js";
import { createOpenRouterClaimExtractor } from "./providers/openrouter.js";
import { assertAzureServingOrigin, isAzureOnlyServing } from "../_model-serving-policy.js";

export function createProductionClaimExtractor(env = process.env, options = {}) {
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
  const model = env.AZURE_FOUNDRY_CLAIM_MODEL;
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (endpoint && model && apiKey) {
    assertAzureServingOrigin(endpoint, env);
    const transport = options.fetchImpl || globalThis.fetch;
    const fetchImpl = isAzureOnlyServing(env) ? (url, init) => {
      assertAzureServingOrigin(url, env);
      return transport(url, { ...init, redirect: "error" });
    } : transport;
    return createAzureFoundryClaimExtractor({ endpoint, model, apiKey, fetchImpl });
  }
  const openRouterKey = env.OPENROUTER_API_KEY || env.OPENROUTER_KEY;
  const openRouterModel = env.OPENROUTER_CLAIM_MODEL;
  if (!isAzureOnlyServing(env) && openRouterKey && openRouterModel) {
    return createOpenRouterClaimExtractor({ apiKey: openRouterKey, model: openRouterModel, fetchImpl: options.fetchImpl });
  }
  throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable", status: 503 });
}
