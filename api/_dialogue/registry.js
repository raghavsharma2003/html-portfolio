import { createAzureFoundryDialogueGenerator } from "./providers/azure-foundry.js";
import { azureSurfaceReply, azureSurfaceReplyConfig } from "../_azure-surface-reply.js";

export function createProductionDialogueGenerator(options = {}) {
  const env = options.env || process.env;
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
  const model = env.AZURE_FOUNDRY_DIALOGUE_MODEL;
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (!endpoint || !model || !apiKey) {
    throw Object.assign(new Error("dialogue_generator_unavailable"), { code: "dialogue_generator_unavailable", status: 503 });
  }
  return createAzureFoundryDialogueGenerator({ endpoint, model, apiKey, env, fetchImpl: options.fetchImpl });
}

/**
 * Room uses the same production registry and Foundry deployment Meet uses,
 * while retaining its established raw-text parser and delivery contract.
 * Configuration is validated at construction, before quota admission or I/O.
 */
export function createProductionRoomReplyGenerator(options = {}) {
  const env = options.env || process.env;
  const config = azureSurfaceReplyConfig(env);
  return Object.freeze({
    family: "dialogue",
    name: "azure-foundry-room-reply",
    version: `room-raw-v1:${config.model}`,
    model: config.model,
    async generate({ compiled, turns, signal }) {
      return azureSurfaceReply({
        compiled,
        turns,
        signal,
        env,
        db: options.db,
        fetchImpl: options.fetchImpl,
        requestKey: options.requestKey,
      });
    },
  });
}

// Private comparisons require the observed dated response model. Ordinary
// conversations keep their existing adapter contract.
export function createProductionComparisonGenerator() {
  const {AZURE_FOUNDRY_ENDPOINT:endpoint,AZURE_FOUNDRY_DIALOGUE_MODEL:model,AZURE_FOUNDRY_API_KEY:apiKey,
    AZURE_FOUNDRY_EXPECTED_RESPONSE_MODEL:expected_response_model,AZURE_CORRECTION_BASE_MODEL_COMMITMENT:baseline_snapshot_hash}=process.env;
  if(!expected_response_model||!baseline_snapshot_hash)throw Object.assign(Error('comparison_provider_revision_required'),{status:503});
  return createAzureFoundryDialogueGenerator({endpoint,model,apiKey,revisionBinding:{expected_response_model,baseline_snapshot_hash}});
}
