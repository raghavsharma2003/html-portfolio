import { createAzureFoundryClaimExtractor } from "./providers/azure-foundry.js";

export function createProductionClaimExtractor() {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const model = process.env.AZURE_FOUNDRY_CLAIM_MODEL;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
  if (!endpoint || !model || !apiKey) {
    throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable", status: 503 });
  }
  return createAzureFoundryClaimExtractor({ endpoint, model, apiKey });
}
