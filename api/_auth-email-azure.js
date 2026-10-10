import { createHash, createHmac } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const fail = (code, status = 503, extra = {}) => { throw Object.assign(new Error(code), { code, status, ...extra }); };
let configPromise;

const configFile = async () => {
  configPromise ||= import("./_config.js").catch(() => ({}));
  return configPromise;
};

function exactOrigin(value, suffix) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
        || !url.hostname.endsWith(suffix)) return null;
    return url.origin;
  } catch { return null; }
}

function vercelDeploymentOrigin(value) {
  const host = String(value || "").trim().toLowerCase();
  const labels = host.split("."), deploymentLabels = labels.slice(0, -2);
  if (!host || host.length > 253 || labels.slice(-2).join(".") !== "vercel.app" || deploymentLabels.length < 1
      || deploymentLabels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return null;
  try {
    const url = new URL(`https://${host}`);
    return url.hostname === host && url.origin === `https://${host}` ? url.origin : null;
  } catch { return null; }
}

export async function authEmailAzureConfig(env = process.env) {
  const baked = await configFile();
  const get = (name) => String(env[name] || baked[name] || "").trim();
  if (!get("VYAKTI_AUTH_EMAIL_PROVIDER")) return null;
  if (get("VYAKTI_AUTH_EMAIL_PROVIDER") !== "azure_communication_email") fail("auth_email_provider_unavailable");
  const endpoint = exactOrigin(get("VYAKTI_AUTH_EMAIL_ENDPOINT"), ".communication.azure.com");
  const supabase = exactOrigin(get("SUPABASE_URL"), ".supabase.co");
  const sender = get("VYAKTI_AUTH_EMAIL_SENDER").toLowerCase();
  const accessEncoded = get("VYAKTI_AUTH_EMAIL_ACCESS_KEY_B64");
  const accessKey = Buffer.from(accessEncoded, "base64");
  const serviceRole = get("SUPABASE_SERVICE_ROLE_KEY");
  const configuredOrigins = get("VYAKTI_AUTH_EMAIL_ALLOWED_ORIGINS").split(",").map(value => value.trim()).filter(Boolean);
  const explicitOrigins = configuredOrigins.map(value => exactOrigin(value, ".vercel.app"));
  const vercelUrl = String(env.VERCEL_URL || "").trim();
  const deploymentOrigin = vercelDeploymentOrigin(vercelUrl);
  const allowedOrigins = [...new Set([...explicitOrigins, ...(deploymentOrigin ? [deploymentOrigin] : [])])];
  if (!endpoint || !supabase || !EMAIL.test(sender) || accessKey.length !== 32
      || accessKey.toString("base64").replace(/=+$/u, "") !== accessEncoded.replace(/=+$/u, "")
      || serviceRole.length < 20 || configuredOrigins.length < 1 || configuredOrigins.length > 10
      || allowedOrigins.length > 11
      || explicitOrigins.some(value => !value)
      || (vercelUrl && !deploymentOrigin)) {
    fail("auth_email_provider_unavailable");
  }
  return { endpoint, supabase, sender, accessKey, serviceRole, allowedOrigins };
}

export function approvedAuthEmailRedirect(value, config) {
  try {
    const url = new URL(String(value || ""));
    const pathAllowed = url.pathname === "/studio" || /^\/r\/[a-z0-9][a-z0-9-]{1,62}$/u.test(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !pathAllowed || url.hash
        || !config.allowedOrigins.includes(url.origin)) return null;
    return url.toString();
  } catch { return null; }
}

async function boundedJson(response, limit = 256 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) fail("auth_email_provider_response_invalid");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

export async function generateSupabaseAuthEmailLink(config, input, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${config.supabase}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: { apikey: config.serviceRole, Authorization: `Bearer ${config.serviceRole}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: input.email, redirect_to: input.redirect_url }),
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch { fail("auth_email_link_generation_uncertain", 503, { ambiguous: true }); }
  const data = await boundedJson(response);
  if (!response.ok) fail("auth_email_link_generation_failed", response.status >= 500 ? 503 : 409,
    response.status >= 500 ? { ambiguous: true } : { definitive: true });
  const action = typeof data.action_link === "string" ? data.action_link : data.properties?.action_link;
  const otp = typeof data.email_otp === "string" ? data.email_otp : data.properties?.email_otp;
  const verification = typeof data.verification_type === "string" ? data.verification_type : data.properties?.verification_type;
  const redirect = typeof data.redirect_to === "string" ? data.redirect_to : data.properties?.redirect_to;
  const user = data.user && typeof data.user === "object" ? data.user : data;
  let parsed;
  try { parsed = new URL(action); } catch { fail("auth_email_link_response_invalid"); }
  if (parsed.origin !== config.supabase || parsed.pathname !== "/auth/v1/verify"
      || !HASH.test(parsed.searchParams.get("token") || "")
      || !["magiclink", "signup"].includes(verification)
      || parsed.searchParams.get("type") !== verification
      || redirect !== input.redirect_url || parsed.searchParams.get("redirect_to") !== input.redirect_url
      || !/^\d{6}$/u.test(otp || "") || !UUID.test(String(user.id || ""))
      || String(user.email || "").toLowerCase() !== input.email) fail("auth_email_link_response_invalid");
  return { action_link: parsed.toString(), email_otp: otp, verification_type: verification, owner_user_id: String(user.id).toLowerCase() };
}

export function validateAuthEmailPayload(config, payload, request) {
  if (!payload || payload.schema !== "vyakti.auth-email-payload/v1"
      || !EMAIL.test(String(payload.email || ""))
      || createHash("sha256").update(payload.email).digest("hex") !== request.email_hash
      || !/^\d{6}$/u.test(String(payload.email_otp || ""))
      || !["magiclink", "signup"].includes(payload.verification_type)) fail("auth_email_payload_invalid");
  let action;
  try { action = new URL(payload.action_link); } catch { fail("auth_email_payload_invalid"); }
  if (action.origin !== config.supabase || action.pathname !== "/auth/v1/verify"
      || !HASH.test(action.searchParams.get("token") || "")
      || action.searchParams.get("type") !== payload.verification_type
      || action.searchParams.get("redirect_to") !== request.redirect_url) fail("auth_email_payload_invalid");
  return payload;
}

export function signAcsAuthEmailRequest({ method, url, body = "", accessKey, date }) {
  const parsed = new URL(url);
  const contentHash = createHash("sha256").update(body).digest("base64");
  const timestamp = new Date(date).toUTCString();
  const path = `${parsed.pathname}${parsed.search}`;
  const stringToSign = `${method}\n${path}\n${timestamp};${parsed.host};${contentHash}`;
  const signature = createHmac("sha256", accessKey).update(stringToSign, "utf8").digest("base64");
  return {
    "x-ms-date": timestamp,
    "x-ms-content-sha256": contentHash,
    Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  };
}

function operationUrl(config, operationId) {
  return `${config.endpoint}/emails/operations/${operationId}?api-version=2023-03-31`;
}

export function validateAcsOperationLocation(config, value, operationId) {
  try {
    const url = new URL(String(value || operationUrl(config, operationId)));
    return url.origin === config.endpoint && url.pathname === `/emails/operations/${operationId}`
      && url.searchParams.size === 1 && url.searchParams.get("api-version") === "2023-03-31" ? url.toString() : null;
  } catch { return null; }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function sendAzureAuthEmail(config, input, fetchImpl = fetch) {
  const url = `${config.endpoint}/emails:send?api-version=2023-03-31`;
  const body = JSON.stringify({
    senderAddress: config.sender,
    recipients: { to: [{ address: input.email }] },
    content: {
      subject: "Your Vyakti sign-in link",
      plainText: `Open this private sign-in link:\n${input.action_link}\n\nIf your screen asks for a six-digit code, use ${input.email_otp}.`,
      html: `<p>Open this private sign-in link:</p><p><a href="${escapeHtml(input.action_link)}">Open Vyakti</a></p><p>If your screen asks for a six-digit code, use <strong>${escapeHtml(input.email_otp)}</strong>.</p>`,
    },
    userEngagementTrackingDisabled: true,
  });
  const signed = signAcsAuthEmailRequest({ method: "POST", url, body, accessKey: config.accessKey, date: input.repeatability_first_sent });
  let response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: {
      ...signed, "Content-Type": "application/json", "Operation-Id": input.operation_id,
      "Repeatability-Request-ID": input.operation_id, "Repeatability-First-Sent": new Date(input.repeatability_first_sent).toUTCString(),
      "x-ms-client-request-id": input.operation_id,
    }, body, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch { fail("auth_email_delivery_ambiguous", 503, { ambiguous: true }); }
  if (response.status === 202 || response.status === 409) {
    const location = validateAcsOperationLocation(config, response.headers.get("operation-location"), input.operation_id);
    await response.body?.cancel();
    if (!location) fail("auth_email_provider_response_invalid");
    return { state: "pending", operation_location: location, retry_after_seconds: Number(response.headers.get("retry-after")) || null };
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    fail("auth_email_delivery_ambiguous", 503, { ambiguous: true, retryAfterSeconds: Number(response.headers.get("retry-after")) || null });
  }
  await response.body?.cancel();
  fail("auth_email_delivery_failed", 503, { definitive: true });
}

export async function readAzureAuthEmail(config, input, fetchImpl = fetch) {
  const url = validateAcsOperationLocation(config, input.operation_location, input.operation_id);
  if (!url) fail("auth_email_provider_response_invalid");
  const signed = signAcsAuthEmailRequest({ method: "GET", url, accessKey: config.accessKey, date: Date.now() });
  let response;
  try { response = await fetchImpl(url, { headers: { ...signed, "x-ms-client-request-id": input.operation_id }, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { fail("auth_email_status_unavailable", 503, { ambiguous: true }); }
  const data = await boundedJson(response);
  if (response.status === 404) return { status: "NotStarted" };
  if (response.status === 429 || response.status >= 500) fail("auth_email_status_unavailable", 503, { ambiguous: true, retryAfterSeconds: Number(response.headers.get("retry-after")) || null });
  if (!response.ok || !["NotStarted", "Running", "Succeeded", "Failed"].includes(data.status)) fail("auth_email_provider_response_invalid");
  return { status: data.status, error_code: data.status === "Failed" ? "auth_email_delivery_failed" : "" };
}
