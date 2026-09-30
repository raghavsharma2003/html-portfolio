import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { validateDocumentDescriptor, fetchVerifiedDocument } from "../src/media.js";
import { sha256 } from "../src/canonical.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = Object.freeze({
  VYAKTI_PRIVATE_SOURCE_ORIGIN: "https://fixtureaccount.blob.core.windows.net",
  VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER: "private-documents",
  VYAKTI_BROKER_HMAC_KEY_B64: KEY, VERIFIER_VERSION: "identity-test-v1",
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://fixture.cognitiveservices.azure.com",
  AZURE_DOCUMENT_INTELLIGENCE_KEY: "synthetic", AZURE_FACE_ENDPOINT: "https://fixture.cognitiveservices.azure.com",
  AZURE_FACE_KEY: "synthetic", AZURE_DOCUMENT_REVIEW_ENDPOINT: "https://fixture.azurewebsites.net",
  AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64: KEY, AZURE_DOCUMENT_REVIEW_VERSION: "review-test-v1",
});
const CONFIG = loadConfig(ENV);
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PATH = "10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000003/original";

// Exercise the actual signer and HEAD caller with synthetic credentials only.
// Eliminate all host-env/config access before evaluating the source module.
const storageFile = new URL("../../../api/_replica-storage.js", import.meta.url);
let storageSource = await readFile(storageFile, "utf8");
const configImport = 'import("./_config.js").catch(() => ({}))';
assert.ok(storageSource.includes(configImport));
storageSource = storageSource.replaceAll(configImport, `Promise.resolve(${JSON.stringify({
  AZURE_REPLICA_STORAGE_ACCOUNT: "fixtureaccount", AZURE_REPLICA_STORAGE_CONTAINER: "private-documents",
  AZURE_REPLICA_STORAGE_ACCOUNT_KEY: KEY,
})})`).replaceAll("process.env", "({})");
const storage = await import(`data:text/javascript;base64,${Buffer.from(storageSource).toString("base64")}`);
let headCalls = 0;
const signed = await storage.createSignedReplicaRead({
  storageBucket: "azureblob:fixtureaccount:private-documents", objectPath: PATH,
}, { expiresIn: 120, fetchImpl: async (_url, init) => {
  headCalls++;
  assert.equal(init.method, "HEAD");
  return new Response(null, { headers: { "content-length": String(BYTES.length), "content-type": "image/jpeg", etag: '"fixture"' } });
} });
const NOW = Date.parse(signed.expires_at) - 120_000;
const INPUT = Object.freeze({ url: signed.url, expires_at: signed.expires_at, sha256: sha256(BYTES), byte_size: BYTES.length, mime: "image/jpeg" });
function changeUrl(change) { const url = new URL(INPUT.url); change(url); return { ...INPUT, url: url.toString() }; }
function rejected(input, code, validate = validateDocumentDescriptor) {
  assert.throws(() => validate(input, CONFIG, NOW), (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, code); // Never propagate the URL/capability into errors.
    return true;
  });
}

test("actual createSignedReplicaRead output passes exact Azure transport and keeps liveness disabled", async () => {
  assert.equal(headCalls, 1);
  assert.equal(CONFIG.sourceProvider, "azure_blob");
  assert.equal(CONFIG.liveness.enabled, false);
  assert.equal(CONFIG.liveness.erasureEnabled, false);
  const descriptor = validateDocumentDescriptor(INPUT, CONFIG, NOW);
  let calls = 0;
  const result = await fetchVerifiedDocument(descriptor, CONFIG, { fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, INPUT.url);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(BYTES, { headers: { "content-type": "image/jpeg", "content-length": String(BYTES.length) } });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, BYTES);
});

for (const [name, patch, code] of [
  ["missing container", { VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER: "" }, "source_container_required"],
  ...["ab", "a--b", "Uppercase", "a/b", "$root", "private-documents\n"].map((value) => ["container " + JSON.stringify(value), { VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER: value }, "source_container_invalid"]),
  ["origin newline", { VYAKTI_PRIVATE_SOURCE_ORIGIN: ENV.VYAKTI_PRIVATE_SOURCE_ORIGIN + "\n" }, "source_origin_required"],
  ...["https://fixtureaccount.blob.core.windows.net.evil.test", "https://fixtureaccount.dfs.core.windows.net", "https://fixtureaccount.blob.core.windows.net:444", "https://user@fixtureaccount.blob.core.windows.net", "https://fixtureaccount.blob.core.windows.net/private-documents"].map((value, i) => ["origin " + i, { VYAKTI_PRIVATE_SOURCE_ORIGIN: value }, "source_origin_required"]),
]) test(`Azure config rejects ${name}`, () => assert.throws(() => loadConfig({ ...ENV, ...patch }), (e) => e.code === code));

const urlCases = [
  ["account swap", (u) => { u.hostname = "otheraccount.blob.core.windows.net"; }],
  ["host suffix", (u) => { u.hostname += ".evil.test"; }],
  ["container swap", (u) => { u.pathname = u.pathname.replace("private-documents", "other-documents"); }],
  ["container prefix", (u) => { u.pathname = u.pathname.replace("private-documents", "private-documents-extra"); }],
  ["container listing", (u) => { u.pathname = "/private-documents/"; }],
  ["derived artifact", (u) => { u.pathname = u.pathname.replace("original", "derived/voice.wav"); }],
  ["escaped slash", (u) => { u.pathname = u.pathname.replace("/original", "%2Foriginal"); }],
  ["non UUID scope", (u) => { u.pathname = "/private-documents/owner/replica/source/original"; }],
  ["credentials", (u) => { u.username = "hidden"; }],
  ["port", (u) => { u.port = "444"; }],
  ["HTTP", (u) => { u.protocol = "http:"; }],
  ["fragment", (u) => { u.hash = "hidden"; }],
];
for (const [name, change] of urlCases) test(`document URL rejects ${name} before fetch`, () => rejected(changeUrl(change), "document_url_invalid"));
test("raw dot path normalization is rejected", () => rejected({ ...INPUT, url: INPUT.url.replace("/original", "/x/../original") }, "document_url_invalid"));
for (const [name, change] of [
  ["write permission", (q) => q.set("sp", "rw")], ["container resource", (q) => q.set("sr", "c")],
  ["HTTP capability", (q) => q.set("spr", "https,http")], ["unknown version", (q) => q.set("sv", "2099-01-01")],
  ["unsigned", (q) => q.delete("sig")], ["invalid signature", (q) => q.set("sig", "hidden")],
  ["duplicate permission", (q) => q.append("sp", "r")], ["unknown query key", (q) => q.set("comp", "list")],
  ["signature newline", (q) => q.set("sig", q.get("sig") + "\n")],
]) test(`document SAS rejects ${name}`, () => rejected(changeUrl((u) => change(u.searchParams)), "document_capability_invalid"));
for (const [name, input] of [
  ["descriptor expired", { ...INPUT, expires_at: new Date(NOW).toISOString() }],
  ["descriptor too long", { ...INPUT, expires_at: new Date(NOW + 181_000).toISOString() }],
  ["SAS expiry mismatch", changeUrl((u) => u.searchParams.set("se", new Date(NOW + 130_000).toISOString().replace(".000Z", "Z")))],
  ["future start", changeUrl((u) => u.searchParams.set("st", new Date(NOW + 10_000).toISOString().replace(".000Z", "Z")))],
  ["invalid calendar", changeUrl((u) => u.searchParams.set("st", "2026-02-30T00:00:00Z"))],
]) test(`capability rejects ${name}`, () => rejected(input, "document_capability_expiry_invalid"));

for (const [name, response, code] of [
  ["wrong bytes", () => new Response(Buffer.alloc(BYTES.length)), "document_fetch_hash_mismatch"],
  ["wrong size", () => new Response(BYTES.subarray(1)), "document_fetch_size_mismatch"],
  ["wrong MIME", () => new Response(BYTES, { headers: { "content-type": "text/html" } }), "document_fetch_mime_mismatch"],
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.test" } }), "document_fetch_unavailable"],
  ["declared oversize", () => new Response(BYTES, { headers: { "content-length": String(CONFIG.limits.mediaBytes + 1) } }), "document_fetch_too_large"],
  ["stream oversize", () => new Response(Buffer.alloc(CONFIG.limits.mediaBytes + 1)), "document_fetch_too_large"],
]) test(`document fetch rejects ${name}`, async () => {
  let calls = 0;
  await assert.rejects(fetchVerifiedDocument(validateDocumentDescriptor(INPUT, CONFIG, NOW), CONFIG, { fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(init.redirect, "error");
    return response();
  } }), (e) => e.code === code && e.message === code);
  assert.equal(calls, 1);
});
test("fetch error hides transport exception and signed URL", async () => {
  await assert.rejects(fetchVerifiedDocument(validateDocumentDescriptor(INPUT, CONFIG, NOW), CONFIG, { fetchImpl: async () => {
    throw new Error(INPUT.url);
  } }), (e) => e.message === "document_fetch_unreachable");
});
test("Supabase document path remains supported", () => {
  const config = loadConfig({ ...ENV, VYAKTI_PRIVATE_SOURCE_ORIGIN: "https://project.supabase.co" });
  assert.equal(config.sourceProvider, "supabase");
  assert.ok(validateDocumentDescriptor({ ...INPUT, url: "https://project.supabase.co/storage/v1/object/sign/private/a?token=fixture" }, config, NOW));
  assert.throws(() => validateDocumentDescriptor({ ...INPUT, url: "https://project.supabase.co/other/a?token=fixture" }, config, NOW), (e) => e.code === "document_url_invalid");
});

test("actual-source negative controls detect removed container, expiry, and hash guards", async () => {
  const file = new URL("../src/media.js", import.meta.url);
  const original = await readFile(file, "utf8");
  for (const [needle, replacement, check] of [
    ['!url.pathname.startsWith(`${prefix}/`)', "false", (m) => rejected(changeUrl((u) => { u.pathname = u.pathname.replace("private-documents", "other-documentsXX"); }), "document_url_invalid", m.validateDocumentDescriptor)],
    ["endsAt !== expiresAt", "false", (m) => rejected(changeUrl((u) => u.searchParams.set("se", new Date(NOW + 130_000).toISOString().replace(".000Z", "Z"))), "document_capability_expiry_invalid", m.validateDocumentDescriptor)],
    ["sha256(bytes) !== descriptor.expectedHash", "false", async (m) => assert.rejects(m.fetchVerifiedDocument(validateDocumentDescriptor(INPUT, CONFIG, NOW), CONFIG, { fetchImpl: async () => new Response(Buffer.alloc(BYTES.length)) }), (e) => e.code === "document_fetch_hash_mismatch")],
  ]) {
    assert.ok(original.includes(needle));
    const source = original.replace(needle, replacement).replace(/from "(\.\/[^\"]+)"/g, (_all, path) => `from ${JSON.stringify(new URL(path, file).href)}`);
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    await assert.rejects(async () => check(mutant), assert.AssertionError);
  }
});
