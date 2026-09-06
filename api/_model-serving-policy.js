// Portable model-serving policy. This is a provider boundary, not a network
// sandbox, and must not be applied to erasure of historical vendor objects.
const AZURE_HOST = /^(?:[a-z0-9-]+\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com|api\.cognitive\.microsoft\.com|azurewebsites\.net)|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.azurecontainerapps\.io|[a-z0-9-]+\.(?:stt|tts)\.speech\.microsoft\.com)$/i;

function denied(code) {
  throw Object.assign(new Error(code), { code, status: 503 });
}

export function isAzureOnlyServing(env = process.env) {
  return env?.VYAKTI_MODEL_SERVING === "azure_only";
}

// Paths and query parameters belong to each Azure API contract. This checks
// the transport origin only, without exposing the supplied URL in errors.
export function assertAzureServingOrigin(value, env = process.env) {
  if (!isAzureOnlyServing(env)) return;
  let url;
  try { url = new URL(String(value || "")); }
  catch { denied("model_serving_origin_denied"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.hash || !AZURE_HOST.test(url.hostname)) denied("model_serving_origin_denied");
  return url;
}

export function resolveReplyServingProvider(env = process.env) {
  const requested = String(env?.VYAKTI_REPLY_PROVIDER || "");
  if (isAzureOnlyServing(env)) {
    if (requested && requested !== "azure_foundry") denied("model_serving_provider_denied");
    return "azure_foundry";
  }
  return requested || "openrouter";
}
