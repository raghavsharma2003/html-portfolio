import { createAzureFoundryDialogueGenerator } from "./providers/azure-foundry.js";

export function createProductionDialogueGenerator() {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  const model = process.env.AZURE_FOUNDRY_DIALOGUE_MODEL;
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
  if (!endpoint || !model || !apiKey) {
    throw Object.assign(new Error("dialogue_generator_unavailable"), { code: "dialogue_generator_unavailable", status: 503 });
  }
  return createAzureFoundryDialogueGenerator({ endpoint, model, apiKey });
}
