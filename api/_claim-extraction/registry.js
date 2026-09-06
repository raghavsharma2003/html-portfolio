import { createAzureFoundryClaimExtractor } from "./providers/azure-foundry.js";
import { createOpenRouterClaimExtractor } from "./providers/openrouter.js";

export function createProductionClaimExtractor(env = process.env) {
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
  const model = env.AZURE_FOUNDRY_CLAIM_MODEL;
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (endpoint && model && apiKey) {
    return createAzureFoundryClaimExtractor({ endpoint, model, apiKey });
  }
  const openRouterKey = env.OPENROUTER_API_KEY || env.OPENROUTER_KEY;
  const openRouterModel = env.OPENROUTER_CLAIM_MODEL;
  if (openRouterKey && openRouterModel) {
    return createOpenRouterClaimExtractor({ apiKey: openRouterKey, model: openRouterModel });
  }
  throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable", status: 503 });
}
