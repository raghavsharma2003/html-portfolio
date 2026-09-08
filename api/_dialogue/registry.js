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

// Private comparisons require the observed dated response model. Ordinary
// conversations keep their existing adapter contract.
export function createProductionComparisonGenerator() {
  const {AZURE_FOUNDRY_ENDPOINT:endpoint,AZURE_FOUNDRY_DIALOGUE_MODEL:model,AZURE_FOUNDRY_API_KEY:apiKey,
    AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL:expected_response_model,AZURE_CORRECTION_BASE_MODEL_COMMITMENT:baseline_snapshot_hash}=process.env;
  if(!expected_response_model||!baseline_snapshot_hash)throw Object.assign(Error('comparison_provider_revision_required'),{status:503});
  return createAzureFoundryDialogueGenerator({endpoint,model,apiKey,revisionBinding:{expected_response_model,baseline_snapshot_hash}});
}
