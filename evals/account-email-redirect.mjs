import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { emailRedirect } from "../api/_auth-redirect.js";

const HERE = new URL("./", import.meta.url);
const api = (name) => new URL(`../api/${name}`, HERE).href;
const redirects = [
  "javascript:alert(1)",
  "https://user:pass@example.invalid/studio",
  "https://example.invalid/studio#access_token=secret",
  "http://",
];
for (const value of redirects) assert.equal(emailRedirect(value), null, `rejects ${value}`);
assert.equal(emailRedirect("https://preview.example.invalid/studio"), "https://preview.example.invalid/studio");
assert.equal(emailRedirect("http://localhost:5173/r/example?lang=hi"), "http://localhost:5173/r/example?lang=hi");

const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./_config.js" && context.parentURL?.startsWith(api(""))) {
      return { url: "data:text/javascript,export%20const%20SUPABASE_URL%3D''%3Bexport%20const%20SUPABASE_KEY%3D''%3Bexport%20const%20AZURE_ENDPOINT%3D''%3Bexport%20const%20AZURE_KEY%3D''%3Bexport%20const%20OPENROUTER_KEY%3D''%3B", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === api("_db.js")) return { format: "module", shortCircuit: true, source: "export const q=(...args)=>globalThis.__accountRedirectRateDb(...args);" };
    if (url === api("_ratelimit.js")) return { format: "module", shortCircuit: true, source: "export const allow=()=>true;export const ipOf=()=> '203.0.113.9';" };
    if (url === api("_incidents.js")) return { format: "module", shortCircuit: true, source: "export const withDoor=(_db,_door,handler)=>handler;export const recordIncident=async()=>{};export const notifyNewIncidentKinds=async()=>{};export const pruneOldIncidents=async()=>{};export const INCIDENT_KINDS=[];export const OBSERVED_DOOR_COUNT=0;export const OPTIONAL_ABSENT_DOOR_PREFIX='';" };
    return next(url, context);
  },
});

const savedUrl = process.env.SUPABASE_URL;
const savedKey = process.env.SUPABASE_KEY;
const savedFetch = globalThis.fetch;
const requests = [];
const rateCalls = [];
process.env.SUPABASE_URL = "https://auth.example.invalid";
process.env.SUPABASE_KEY = "test-key";
globalThis.__accountRedirectRateDb = async (sql, params) => {
  rateCalls.push({ sql, params });
  return [{ count: 1 }];
};
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

let handler;
try {
  handler = (await import(`${api("account.js")}?account-email-redirect=${Date.now()}`)).default;
} finally {
  hook.deregister();
}

async function route(body) {
  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method: "POST", body }, res);
  return res;
}

try {
  const redirect = "https://room.example.invalid/r/physics?lang=hi&ref=invite";
  const response = await route({ op: "send_otp", email: "OWNER@EXAMPLE.INVALID", redirect_to: redirect });
  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 1);
  const outbound = new URL(requests[0].url);
  assert.equal(outbound.origin, "https://auth.example.invalid");
  assert.equal(outbound.pathname, "/auth/v1/otp");
  assert.equal(outbound.searchParams.get("redirect_to"), redirect);
  assert.deepEqual(JSON.parse(requests[0].init.body), { email: "owner@example.invalid", create_user: true });
  assert.equal(rateCalls.length, 2);
  assert.deepEqual(rateCalls.map(({ params }) => params[0]).sort(), ["otp_send_dest", "otp_send_ip"]);

  for (const redirect_to of redirects) {
    const beforeRequests = requests.length;
    const beforeRates = rateCalls.length;
    const rejected = await route({ op: "send_otp", email: "owner@example.invalid", redirect_to });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.body.error, "valid redirect required");
    assert.equal(requests.length, beforeRequests);
    assert.equal(rateCalls.length, beforeRates);
  }
} finally {
  globalThis.fetch = savedFetch;
  delete globalThis.__accountRedirectRateDb;
  if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
  if (savedKey === undefined) delete process.env.SUPABASE_KEY; else process.env.SUPABASE_KEY = savedKey;
}

console.log("account email redirect: handler transports redirect_to in the GoTrue query, preserves the JSON body, and rejects four malformed values without a provider call");
