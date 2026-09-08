// The incumbent strict Azure configuration semantics, shared by preflight and
// dispatch. A custom environment is an isolated configuration, never permission
// to inherit deployment credentials from the ignored server config.
import { AZURE_ENDPOINT, AZURE_KEY } from "./_config.js";
import { assertAzureServingOrigin, isAzureOnlyServing } from "./_model-serving-policy.js";

export function strictConsolidationConfig(env = process.env) {
  const endpoint = env.AZURE_ENDPOINT || (env === process.env ? AZURE_ENDPOINT : "");
  const key = env.AZURE_API_KEY || (env === process.env ? AZURE_KEY : "");
  if (!endpoint || !key) throw Object.assign(new Error("consolidate_azure_unconfigured"), { code: "consolidate_azure_unconfigured", status: 503 });
  const url = `${endpoint}/chat/completions`;
  assertAzureServingOrigin(url, env);
  return { url, key };
}

// Room memory is a separately admitted dev lane. Deployment model names and
// response revisions must be chosen explicitly; never inherit the legacy Grok.
export function strictRoomConsolidationConfig(env = process.env) {
  if (!isAzureOnlyServing(env)) throw new Error('room_memory_azure_only_required');
  if (env.CONSOLIDATE_ROOM_DEV !== '1') throw new Error('room_memory_dev_disabled');
  const model = String(env.AZURE_FOUNDRY_ROOM_MEMORY_MODEL || '').trim();
  const expectedModel = String(env.AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL || '').trim();
  const key = env.AZURE_FOUNDRY_API_KEY;
  if (!model || !expectedModel || !key || !env.AZURE_REPLICA_BUDGET_ID)
    throw new Error('room_memory_foundry_binding_required');
  const origin = assertAzureServingOrigin(env.AZURE_FOUNDRY_ENDPOINT, env);
  if (origin.pathname !== '/' || origin.search) throw new Error('room_memory_foundry_origin_required');
  // Match the strict-schema canary80 transport exactly. The legacy Foundry
  // inference route is not evidence for OpenAI v1 structured-output support.
  const mappedEnv = {...env, AZURE_ENDPOINT: `${origin.origin}/openai/v1`, AZURE_API_KEY: key};
  const {url} = strictConsolidationConfig(mappedEnv);
  return {model, expectedModel, env:mappedEnv, url, requestUrl:url};
}
