// The incumbent strict Azure configuration semantics, shared by preflight and
// dispatch. A custom environment is an isolated configuration, never permission
// to inherit deployment credentials from the ignored server config.
import { AZURE_ENDPOINT, AZURE_KEY } from "./_config.js";
import { assertAzureServingOrigin } from "./_model-serving-policy.js";

export function strictConsolidationConfig(env = process.env) {
  const endpoint = env.AZURE_ENDPOINT || (env === process.env ? AZURE_ENDPOINT : "");
  const key = env.AZURE_API_KEY || (env === process.env ? AZURE_KEY : "");
  if (!endpoint || !key) throw Object.assign(new Error("consolidate_azure_unconfigured"), { code: "consolidate_azure_unconfigured", status: 503 });
  const url = `${endpoint}/chat/completions`;
  assertAzureServingOrigin(url, env);
  return { url, key };
}
