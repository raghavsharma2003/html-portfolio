import { createHash, createHmac } from "node:crypto";

export const REPLICA_STORAGE_BUCKET = process.env.REPLICA_STORAGE_BUCKET || "vyakti-replica-private";
// This is a logical locator namespace, not necessarily a Supabase bucket.
// Existing plain bucket values remain Supabase locators. New Azure writes use
// `azureblob:<account>:<container>` so every stored row routes deterministically.
export const REPLICA_STORAGE_WRITE_BUCKET = process.env.REPLICA_STORAGE_WRITE_BUCKET || REPLICA_STORAGE_BUCKET;
// One to two hour source recordings routinely cross 256 MiB when they arrive
// as lossless WAV. Originals are uploaded directly to Storage and processed
// from a bounded disk stream, so the bucket ceiling must not reintroduce the
// old in-memory limit at the storage boundary. Derived artifacts stay on their
// much smaller, separate ceiling below.
const MAX_BUCKET_BYTES = 1_073_741_824;
const MAX_DERIVED_OBJECT_BYTES = 67_108_864;
const AZURE_BLOB_VERSION = "2026-04-06";
const AZURE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const STORAGE_ERASURE_CONCURRENCY = 16;
const STORAGE_ERASURE_PAGE_SIZE = 1_000;
const MAX_STORAGE_ERASURE_PASSES = 100;
let configPromise;

export class ReplicaStorageError extends Error {
  constructor(code, status = 503, detail = "") {
    super(code);
    this.name = "ReplicaStorageError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const segments = (value) => String(value).split("/").map(encodeURIComponent).join("/");

const SUPABASE_BUCKET = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const AZURE_ACCOUNT = /^[a-z0-9]{3,24}$/;
const AZURE_CONTAINER = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export function replicaStorageBucketDescriptor(storageBucket) {
  const value = String(storageBucket || "").trim();
  if (SUPABASE_BUCKET.test(value)) {
    return Object.freeze({ storageBucket: value, provider: "supabase", bucket: value });
  }
  if (value.startsWith("azureblob:")) {
    const parts = value.split(":");
    if (parts.length === 3 && AZURE_ACCOUNT.test(parts[1]) && AZURE_CONTAINER.test(parts[2])) {
      return Object.freeze({
        storageBucket: value,
        provider: "azure_blob",
        account: parts[1],
        container: parts[2],
      });
    }
  }
  throw new ReplicaStorageError("replica_storage_bucket_invalid", 400);
}

export function replicaStorageLocator(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReplicaStorageError("replica_storage_locator_required", 400);
  }
  const storageBucket = value.storageBucket ?? value.bucket;
  const objectPath = value.objectPath ?? value.path;
  const descriptor = replicaStorageBucketDescriptor(storageBucket);
  return Object.freeze({
    ...descriptor,
    objectPath: exactObjectPath(objectPath, options.requireDerived === true),
  });
}

async function storageCredentials() {
  // A clean checkout deliberately has no _config.js. Deployed builds generate
  // it from secrets, while local/managed runtimes normally use environment
  // variables. Lazy optional loading supports both without making offline
  // policy tests fabricate credentials.
  configPromise ||= import("./_config.js").catch(() => ({}));
  const config = await configPromise;
  const baseUrl = String(process.env.SUPABASE_URL || config.SUPABASE_URL || "").replace(/\/$/, "");
  // Biometric storage requires an explicit, separately managed service role.
  // SUPABASE_KEY is also used by auth/photo code and may legitimately be an
  // anon key, so silently treating it as privileged would blur the boundary.
  // This route fails closed until the dedicated secret is configured.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new ReplicaStorageError("private_storage_not_configured");
  return { baseUrl, key };
}

async function azureStorageCredentials(descriptor) {
  configPromise ||= import("./_config.js").catch(() => ({}));
  const config = await configPromise;
  const account = String(process.env.AZURE_REPLICA_STORAGE_ACCOUNT || config.AZURE_REPLICA_STORAGE_ACCOUNT || "").trim();
  const key = String(process.env.AZURE_REPLICA_STORAGE_ACCOUNT_KEY || config.AZURE_REPLICA_STORAGE_ACCOUNT_KEY || "").trim();
  const container = String(process.env.AZURE_REPLICA_STORAGE_CONTAINER || config.AZURE_REPLICA_STORAGE_CONTAINER || "").trim();
  const configured = [account, key, container].filter(Boolean).length;
  if (!configured) throw new ReplicaStorageError("azure_replica_storage_not_configured");
  if (configured !== 3) throw new ReplicaStorageError("azure_replica_storage_configuration_incomplete");
  if (!AZURE_ACCOUNT.test(account) || !AZURE_CONTAINER.test(container)) {
    throw new ReplicaStorageError("azure_replica_storage_name_invalid");
  }
  let decoded;
  try { decoded = Buffer.from(key, "base64"); } catch { decoded = null; }
  if (!decoded || decoded.length < 32 || decoded.toString("base64").replace(/=+$/, "") !== key.replace(/=+$/, "")) {
    throw new ReplicaStorageError("azure_replica_storage_key_invalid");
  }
  if (descriptor && (descriptor.provider !== "azure_blob" || descriptor.account !== account || descriptor.container !== container)) {
    throw new ReplicaStorageError("azure_replica_storage_locator_not_configured", 503);
  }
  return Object.freeze({ account, key, container, origin: `https://${account}.blob.core.windows.net` });
}

function azureTime(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function azureSasUrl(credentials, objectPath, permissions, options = {}) {
  const resource = options.resource === "c" ? "c" : "b";
  const path = resource === "b" ? exactObjectPath(objectPath) : "";
  const now = Number(options.now || Date.now());
  const startsAt = azureTime(now - 5 * 60 * 1000);
  const expiresAt = azureTime(now + Number(options.expiresIn || 7200) * 1000);
  const canonicalized = `/blob/${credentials.account}/${credentials.container}${path ? `/${path}` : ""}`;
  const fields = [
    permissions, startsAt, expiresAt, canonicalized,
    "", "", "https", AZURE_BLOB_VERSION, resource,
    "", "", "", "", "", "", "",
  ];
  const signature = createHmac("sha256", Buffer.from(credentials.key, "base64"))
    .update(fields.join("\n"), "utf8")
    .digest("base64");
  const query = new URLSearchParams({
    sp: permissions,
    st: startsAt,
    se: expiresAt,
    spr: "https",
    sv: AZURE_BLOB_VERSION,
    sr: resource,
    sig: signature,
  });
  const encodedPath = path ? `/${segments(path)}` : "";
  return {
    url: `${credentials.origin}/${encodeURIComponent(credentials.container)}${encodedPath}?${query}`,
    expiresAt,
  };
}

async function azureStorageFetch(objectPath, options = {}) {
  const credentials = options.credentials || await azureStorageCredentials();
  if (!credentials) throw new ReplicaStorageError("azure_replica_storage_not_configured");
  const signed = azureSasUrl(credentials, objectPath, options.permissions || "r", {
    resource: options.resource,
    expiresIn: options.expiresIn || 600,
  });
  const url = new URL(signed.url);
  for (const [name, value] of Object.entries(options.query || {})) url.searchParams.set(name, value);
  let response;
  try {
    response = await (options.fetchImpl || fetch)(url, {
      method: options.method || "GET",
      headers: { "x-ms-version": AZURE_BLOB_VERSION, ...(options.headers || {}) },
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs || 120_000)])
        : AbortSignal.timeout(options.timeoutMs || 120_000),
    });
  } catch (error) {
    throw new ReplicaStorageError("azure_replica_storage_unreachable", 503, error?.message);
  }
  return response;
}

// Private internal experiments use the existing Azure account and SAS signer.
// Exact owner/authorization namespace; no container creation or public URL.
export async function internalVoiceStorageRequest(owner, authorization, name, options = {}) {
  if (!UUID.test(owner || "") || !UUID.test(authorization || "") ||
      !/^(?:state\.json|reference\.wav|[a-f0-9-]{36}\.wav)$/.test(name || "") ||
      !["GET", "PUT", "DELETE"].includes(options.method || "GET"))
    throw new ReplicaStorageError("internal_voice_storage_scope_invalid", 400);
  if (options.method === "PUT" && (!Buffer.isBuffer(options.body) || options.body.length > 25 * 1024 * 1024 ||
      (!options.headers?.["If-Match"] && options.headers?.["If-None-Match"] !== "*")))
    throw new ReplicaStorageError("internal_voice_storage_condition_required", 400);
  return azureStorageFetch(`${owner}/${authorization}/internal-voice/${name}`, {
    method: options.method || "GET", permissions: options.method === "PUT" ? "cw" : options.method === "DELETE" ? "d" : "r",
    body: options.body, headers: options.headers, timeoutMs: 20000,
    fetchImpl: async (url, init) => (options.fetchImpl || fetch)(url, {...init, redirect: "error"}),
  });
}

// Get Container Properties does not accept a service SAS, even when that SAS
// is container-scoped with read permission; Azure documents it as an account
// SAS / Shared Key operation. The browser must never receive account-level
// authority, so this one server-only readiness check uses Shared Key directly.
// Object upload/read/delete capabilities continue to use exact-resource SAS.
async function azureContainerProperties(credentials, options = {}) {
  const url = new URL(`${credentials.origin}/${encodeURIComponent(credentials.container)}`);
  url.searchParams.set("restype", "container");
  const date = new Date(options.now || Date.now()).toUTCString();
  const canonicalHeaders = `x-ms-date:${date}\nx-ms-version:${AZURE_BLOB_VERSION}\n`;
  const canonicalResource = `/${credentials.account}/${credentials.container}\nrestype:container`;
  const stringToSign = [
    "HEAD", "", "", "", "", "", "", "", "", "", "", "",
    canonicalHeaders + canonicalResource,
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(credentials.key, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  try {
    return await (options.fetchImpl || fetch)(url, {
      method: "HEAD",
      headers: {
        Authorization: `SharedKey ${credentials.account}:${signature}`,
        "x-ms-date": date,
        "x-ms-version": AZURE_BLOB_VERSION,
      },
      signal: AbortSignal.timeout(options.timeoutMs || 30_000),
    });
  } catch (error) {
    throw new ReplicaStorageError("azure_replica_storage_unreachable", 503, error?.message);
  }
}

function azureInfoFromResponse(response) {
  const byteSize = Number(response.headers.get("content-length"));
  const mime = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || !mime || !mime.includes("/")) {
    throw new ReplicaStorageError("storage_metadata_incomplete", 409);
  }
  return Object.freeze({ objectId: String(response.headers.get("etag") || ""), byteSize, mime });
}

async function azureObjectInfo(objectPath, options = {}) {
  const response = await azureStorageFetch(objectPath, {
    credentials: options.credentials,
    method: "HEAD", permissions: "r", fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || 30_000,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new ReplicaStorageError("azure_replica_storage_read_failed", response.status >= 500 ? 503 : 409);
  return azureInfoFromResponse(response);
}

async function publicStorageKey() {
  configPromise ||= import("./_config.js").catch(() => ({}));
  const config = await configPromise;
  const publicKey = String(process.env.SUPABASE_KEY || config.SUPABASE_KEY || "").trim();
  const { key: serviceKey } = await storageCredentials();
  if (!publicKey) throw new ReplicaStorageError("public_storage_key_not_configured");
  if (publicKey === String(serviceKey)) throw new ReplicaStorageError("public_storage_key_must_not_be_service_role");
  return publicKey;
}

function privilegedStorageHeaders(key) {
  const apikey = String(key || "").trim();
  // Supabase's current secret keys are opaque API-gateway credentials, not
  // JWTs. Sending one as a Bearer token makes the downstream service try to
  // parse it as a JWT and reject it. Legacy service_role keys are JWTs and
  // still need both headers until every deployment has migrated.
  return apikey.startsWith("sb_secret_")
    ? { apikey }
    : { apikey, Authorization: `Bearer ${apikey}` };
}

async function storageRequest(path, { method = "GET", body, headers = {}, fetchImpl = fetch, allow = [], signal } = {}) {
  const { baseUrl, key } = await storageCredentials();
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/storage/v1${path}`, {
      method,
      headers: {
        ...privilegedStorageHeaders(key),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new ReplicaStorageError("private_storage_unreachable", 503, error?.message);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok && !allow.includes(response.status)) {
    const detail = data?.message || data?.error || `storage ${response.status}`;
    throw new ReplicaStorageError("private_storage_failure", response.status >= 500 ? 503 : 409, detail);
  }
  return { response, data };
}

async function collectStorageBody(body, maxBytes, code) {
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) {
    const bytes = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    if (!bytes.length || bytes.length > maxBytes) throw new ReplicaStorageError(code, 413);
    return bytes;
  }
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new ReplicaStorageError(code, 400);
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
    if (!bytes) throw new ReplicaStorageError(code, 400);
    total += bytes.length;
    if (total > maxBytes) throw new ReplicaStorageError(code, 413);
    chunks.push(bytes);
  }
  if (!total) throw new ReplicaStorageError(code, 400);
  return Buffer.concat(chunks, total);
}

function exactObjectPath(objectPath, requireDerived = false) {
  if (typeof objectPath !== "string" || !objectPath || objectPath.length > 1024 || objectPath.startsWith("/") ||
      objectPath.includes("://") || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ReplicaStorageError("replica_object_path_invalid", 400);
  }
  if (requireDerived && (!objectPath.includes("/derived/") || objectPath.endsWith("/original"))) {
    throw new ReplicaStorageError("replica_derived_path_required", 400);
  }
  return objectPath;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function replicaSourceObjectPrefix(source) {
  const ownerUserId = String(source?.ownerUserId || source?.owner_user_id || "").toLowerCase();
  const replicaId = String(source?.replicaId || source?.replica_id || "").toLowerCase();
  const sourceId = String(source?.sourceId || source?.source_id || "").toLowerCase();
  if (![ownerUserId, replicaId, sourceId].every((value) => UUID.test(value))) {
    throw new ReplicaStorageError("replica_source_scope_invalid", 400);
  }
  return `${ownerUserId}/${replicaId}/${sourceId}/`;
}

function exactSourceObjectPath(objectPath, prefix) {
  const path = exactObjectPath(objectPath);
  if (!path.startsWith(prefix) ||
      (path !== `${prefix}original` && !path.startsWith(`${prefix}derived/`))) {
    throw new ReplicaStorageError("replica_source_object_scope_invalid", 400);
  }
  return path;
}

function replicaObjectPrefix(scope) {
  const ownerUserId = String(scope?.ownerUserId || scope?.owner_user_id || "").toLowerCase();
  const replicaId = String(scope?.replicaId || scope?.replica_id || "").toLowerCase();
  if (![ownerUserId, replicaId].every((value) => UUID.test(value))) {
    throw new ReplicaStorageError("replica_storage_scope_invalid", 400);
  }
  return `${ownerUserId}/${replicaId}/`;
}

function exactReplicaObjectPath(objectPath, prefix) {
  const path = exactObjectPath(objectPath);
  if (!path.startsWith(prefix)) {
    throw new ReplicaStorageError("replica_storage_object_scope_invalid", 400);
  }
  return path;
}

async function mapBatches(values, size, task) {
  for (let offset = 0; offset < values.length; offset += size) {
    await Promise.all(values.slice(offset, offset + size).map(task));
  }
}

async function rawStorageFetch(path, options = {}) {
  const { baseUrl, key } = await storageCredentials();
  let response;
  try {
    response = await (options.fetchImpl || fetch)(`${baseUrl}/storage/v1${path}`, {
      method: options.method || "GET",
      headers: {
        ...privilegedStorageHeaders(key),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: options.body } : {}),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs || 120_000)])
        : AbortSignal.timeout(options.timeoutMs || 120_000),
    });
  } catch (error) {
    throw new ReplicaStorageError("private_storage_unreachable", 503, error?.message);
  }
  return response;
}

export async function streamPrivateReplicaObject(locatorInput, options = {}) {
  const locator = replicaStorageLocator(locatorInput);
  const path = locator.objectPath;
  const maxBytes = Number(options.maxBytes || MAX_DERIVED_OBJECT_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BUCKET_BYTES) {
    throw new ReplicaStorageError("replica_read_limit_invalid", 500);
  }
  const response = locator.provider === "azure_blob"
    ? await azureStorageFetch(path, {
      credentials: await azureStorageCredentials(locator),
      permissions: "r",
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      headers: options.expectedObjectId ? { "If-Match": String(options.expectedObjectId) } : {},
    })
    : await rawStorageFetch(
      `/object/authenticated/${encodeURIComponent(locator.bucket)}/${segments(path)}`,
      { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, signal: options.signal },
    );
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* do not retain or log provider content */ }
    if (response.status === 412) throw new ReplicaStorageError("replica_object_version_changed", 409);
    throw new ReplicaStorageError("private_storage_read_failed", response.status === 404 ? 404 : 503);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && (declared < 1 || declared > maxBytes)) {
    try { await response.body?.cancel(); } catch { /* bounded cancellation */ }
    throw new ReplicaStorageError("replica_object_size_invalid", 413);
  }
  const mime = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime || !mime.includes("/")) throw new ReplicaStorageError("replica_object_mime_invalid", 409);
  const body = response.body || Buffer.from(await response.arrayBuffer());
  return Object.freeze({
    body,
    byteSize: Number.isSafeInteger(declared) && declared >= 0 ? declared : null,
    mime,
    objectId: String(response.headers.get("etag") || ""),
  });
}

export async function readPrivateReplicaObject(locator, options = {}) {
  const maxBytes = Number(options.maxBytes || MAX_DERIVED_OBJECT_BYTES);
  const object = await streamPrivateReplicaObject(locator, options);
  const bytes = await collectStorageBody(object.body, maxBytes, "replica_object_size_invalid");
  if (object.byteSize != null && object.byteSize !== bytes.length) {
    throw new ReplicaStorageError("replica_object_size_invalid", 409);
  }
  return Object.freeze({ body: bytes, byteSize: bytes.length, mime: object.mime, objectId: object.objectId });
}

async function writeImmutableReplicaObject(input, options = {}, requireDerived = false) {
  const locator = replicaStorageLocator(input, { requireDerived });
  const objectPath = locator.objectPath;
  options.signal?.throwIfAborted();
  if (typeof options.beforeWriteRequest !== "function") {
    throw new ReplicaStorageError("source_storage_writer_authority_required", 500);
  }
  if (input.ifNoneMatch !== "*") throw new ReplicaStorageError("replica_artifact_create_only_required", 400);
  const mime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime || !mime.includes("/")) throw new ReplicaStorageError("replica_artifact_mime_invalid", 400);
  const bytes = await collectStorageBody(input.body, options.maxBytes || MAX_DERIVED_OBJECT_BYTES, "replica_artifact_size_invalid");
  options.signal?.throwIfAborted();
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedSha256 && String(input.expectedSha256).toLowerCase() !== digest) {
    throw new ReplicaStorageError("replica_artifact_digest_mismatch", 409);
  }
  let upload;
  if (locator.provider === "azure_blob") {
    const credentials = await azureStorageCredentials(locator);
    const blockIds = [];
    for (let offset = 0, index = 0; offset < bytes.length; offset += AZURE_UPLOAD_CHUNK_BYTES, index += 1) {
      options.signal?.throwIfAborted();
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + AZURE_UPLOAD_CHUNK_BYTES));
      // Include the digest in deterministic, equal-length block ids so two
      // conflicting create-only writers cannot accidentally compose a mixed
      // block list. Azure requires every id for one blob to have equal length.
      const blockId = Buffer.from(`${digest.slice(0, 32)}:${String(index).padStart(6, "0")}`, "utf8").toString("base64");
      blockIds.push(blockId);
      await options.beforeWriteRequest(Object.freeze({
        provider: "azure_blob", phase: "block", index, byteSize: chunk.length,
        storageBucket: locator.storageBucket, objectPath,
      }));
      options.signal?.throwIfAborted();
      const block = await azureStorageFetch(objectPath, {
        credentials,
        method: "PUT",
        permissions: "w",
        query: { comp: "block", blockid: blockId },
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(chunk.length) },
        body: chunk,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      if (!block.ok) {
        try { await block.body?.cancel(); } catch { /* response content is not evidence */ }
        throw new ReplicaStorageError("private_storage_write_failed", block.status >= 500 ? 503 : 409);
      }
    }
    const blockList = Buffer.from(
      `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`,
      "utf8",
    );
    await options.beforeWriteRequest(Object.freeze({
      provider: "azure_blob", phase: "commit", blockCount: blockIds.length, byteSize: bytes.length,
      storageBucket: locator.storageBucket, objectPath,
    }));
    options.signal?.throwIfAborted();
    upload = await azureStorageFetch(objectPath, {
      credentials,
      method: "PUT",
      permissions: "w",
      query: { comp: "blocklist" },
      headers: {
        "Content-Type": "application/xml",
        "Content-Length": String(blockList.length),
        "If-None-Match": "*",
        "x-ms-blob-content-type": mime,
        "x-ms-blob-cache-control": "private, max-age=31536000, immutable",
      },
      body: blockList,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  } else {
    await options.beforeWriteRequest(Object.freeze({
      provider: "supabase", phase: "object", byteSize: bytes.length,
      storageBucket: locator.storageBucket, objectPath,
    }));
    options.signal?.throwIfAborted();
    upload = await rawStorageFetch(
      `/object/${encodeURIComponent(locator.bucket)}/${segments(objectPath)}`,
      {
        method: "POST",
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable", "x-upsert": "false" },
        body: bytes,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
    );
  }
  const collision = locator.provider === "azure_blob"
    ? upload.status === 409 || upload.status === 412
    : upload.status === 400 || upload.status === 409;
  if (!upload.ok && !collision) {
    try { await upload.body?.cancel(); } catch { /* response content is not evidence */ }
    throw new ReplicaStorageError("private_storage_write_failed", upload.status >= 500 ? 503 : 409);
  }
  // Re-read through the authenticated private plane for both successful
  // uploads and create-only conflicts. Only byte-identical retries succeed.
  const stored = await readPrivateReplicaObject(locator, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes || MAX_DERIVED_OBJECT_BYTES,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  const storedDigest = createHash("sha256").update(stored.body).digest("hex");
  if (storedDigest !== digest || stored.byteSize !== bytes.length || stored.mime !== mime) {
    throw new ReplicaStorageError(upload.ok ? "replica_artifact_verification_failed" : "immutable_artifact_collision", 409);
  }
  return Object.freeze({ sha256: digest, byteSize: bytes.length, mime, objectId: stored.objectId });
}

/** Server-side, create-only write of an original source. Context Locker uses
 * this for its bounded base64 intake so an image or document that receives a
 * canonical evidence row also has real private bytes behind its source UUID. */
export async function writeImmutableReplicaSource(input, options = {}) {
  return writeImmutableReplicaObject(input, options, false);
}

export async function writeImmutableReplicaArtifact(input, options = {}) {
  return writeImmutableReplicaObject(input, options, true);
}

export async function ensurePrivateReplicaBucket(storageBucket, fetchImpl = fetch) {
  const descriptor = replicaStorageBucketDescriptor(storageBucket);
  if (descriptor.provider === "azure_blob") {
    const azure = await azureStorageCredentials(descriptor);
    const response = await azureContainerProperties(azure, { fetchImpl, timeoutMs: 30_000 });
    if (response.status === 404) throw new ReplicaStorageError("azure_replica_container_missing");
    if (!response.ok) {
      const providerCode = String(response.headers.get("x-ms-error-code") || "unknown").slice(0, 80);
      throw new ReplicaStorageError(
        "azure_replica_container_unreachable",
        response.status >= 500 ? 503 : 409,
        `${response.status}:${providerCode}`,
      );
    }
    if (response.headers.get("x-ms-blob-public-access")) {
      throw new ReplicaStorageError("replica_bucket_must_be_private");
    }
    return { bucket: descriptor.storageBucket, maxBytes: MAX_BUCKET_BYTES, provider: "azure_blob" };
  }
  let result = await storageRequest(`/bucket/${encodeURIComponent(descriptor.bucket)}`, {
    fetchImpl,
    allow: [404],
  });
  if (result.response.status === 404) {
    await storageRequest("/bucket", {
      method: "POST",
      body: {
        id: descriptor.bucket,
        name: descriptor.bucket,
        public: false,
        file_size_limit: MAX_BUCKET_BYTES,
      },
      fetchImpl,
      allow: [409],
    });
    // Creation responses are not a stable bucket descriptor. Refetch and
    // verify the actual access model even after a successful create or a
    // concurrent creator's 409.
    result = await storageRequest(`/bucket/${encodeURIComponent(descriptor.bucket)}`, { fetchImpl });
  }
  if (!result.data || result.data.public !== false) {
    throw new ReplicaStorageError("replica_bucket_must_be_private", 503);
  }
  const limit = Number(result.data.file_size_limit ?? result.data.fileSizeLimit ?? MAX_BUCKET_BYTES);
  if (Number.isFinite(limit) && limit < MAX_BUCKET_BYTES) {
    throw new ReplicaStorageError("replica_bucket_limit_too_small", 503);
  }
  return { bucket: descriptor.storageBucket, maxBytes: limit, provider: "supabase" };
}

export async function createSignedReplicaUpload(locatorInput, fetchImpl = fetch) {
  const locator = replicaStorageLocator(locatorInput);
  const objectPath = locator.objectPath;
  if (locator.provider === "azure_blob") {
    const azure = await azureStorageCredentials(locator);
    const signed = azureSasUrl(azure, objectPath, "c", { expiresIn: 2 * 60 * 60 });
    return {
      storage_bucket: locator.storageBucket,
      method: "PUT",
      url: signed.url,
      headers: {
        "cache-control": "private, max-age=3600",
        "if-none-match": "*",
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": AZURE_BLOB_VERSION,
      },
      resumable: {
        protocol: "azure-block-v1",
        endpoint: signed.url,
        headers: { "x-ms-version": AZURE_BLOB_VERSION },
        metadata: { objectName: objectPath },
        chunk_size: AZURE_UPLOAD_CHUNK_BYTES,
      },
      expires_at: signed.expiresAt,
    };
  }
  const { baseUrl } = await storageCredentials();
  const publicKey = await publicStorageKey();
  const { data } = await storageRequest(
    `/object/upload/sign/${encodeURIComponent(locator.bucket)}/${segments(objectPath)}`,
    { method: "POST", body: {}, headers: { "x-upsert": "false" }, fetchImpl },
  );
  if (typeof data?.url !== "string" || !data.url.includes("token=")) {
    throw new ReplicaStorageError("signed_upload_not_issued");
  }
  const uploadUrl = /^https?:\/\//i.test(data.url)
    ? data.url
    : `${baseUrl}/storage/v1${data.url.startsWith("/") ? "" : "/"}${data.url}`;
  const signed = new URL(uploadUrl);
  const token = signed.searchParams.get("token");
  const base = new URL(baseUrl);
  const expectedUploadPath = `/storage/v1/object/upload/sign/${encodeURIComponent(locator.bucket)}/${segments(objectPath)}`;
  if (!token || signed.protocol !== "https:" || signed.origin !== base.origin || signed.username || signed.password ||
      signed.pathname !== expectedUploadPath) {
    throw new ReplicaStorageError("signed_upload_origin_invalid");
  }
  // Supabase explicitly recommends the direct Storage hostname for TUS. Keep
  // custom/self-hosted origins on their configured host instead of guessing.
  const resumableOrigin = base.hostname.endsWith(".supabase.co")
    ? `${base.protocol}//${base.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")}`
    : base.origin;
  return {
    storage_bucket: locator.storageBucket,
    method: "PUT",
    url: uploadUrl,
    headers: { "cache-control": "max-age=3600", "x-upsert": "false" },
    resumable: {
      protocol: "tus-1.0",
      // Only the signed TUS lifecycle route validates x-signature on every
      // POST/PATCH/HEAD. The unsigned endpoint would either fail under RLS or
      // silently rely on unrelated anon insert policy.
      endpoint: `${resumableOrigin}/storage/v1/upload/resumable/sign`,
      headers: { apikey: publicKey, "x-signature": token, "x-upsert": "false" },
      metadata: {
        bucketName: locator.bucket,
        objectName: exactObjectPath(objectPath),
        cacheControl: "3600",
      },
      chunk_size: 6 * 1024 * 1024,
    },
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

export async function createSignedReplicaRead(locatorInput, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const expiresIn = Number(options.expiresIn || 300);
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 600) {
    throw new ReplicaStorageError("signed_read_expiry_invalid", 500);
  }
  const locator = replicaStorageLocator(locatorInput);
  if (locator.provider === "azure_blob") {
    const azure = await azureStorageCredentials(locator);
    const info = await azureObjectInfo(locator.objectPath, {
      credentials: azure,
      fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    if (!info) throw new ReplicaStorageError("private_storage_read_failed", 404);
    const signed = azureSasUrl(azure, locator.objectPath, "r", { expiresIn });
    return { url: signed.url, expires_at: signed.expiresAt, object_id: info.objectId };
  }
  const { baseUrl } = await storageCredentials();
  const { data } = await storageRequest(
    `/object/sign/${encodeURIComponent(locator.bucket)}/${segments(locator.objectPath)}`,
    { method: "POST", body: { expiresIn }, fetchImpl },
  );
  const raw = data?.signedURL || data?.signedUrl || data?.url;
  if (typeof raw !== "string" || !raw.includes("token=")) {
    throw new ReplicaStorageError("signed_read_not_issued");
  }
  const url = /^https?:\/\//i.test(raw)
    ? new URL(raw)
    : new URL(`${baseUrl}/storage/v1${raw.startsWith("/") ? "" : "/"}${raw}`);
  const expected = new URL(baseUrl);
  const expectedPath = `/storage/v1/object/sign/${encodeURIComponent(locator.bucket)}/${segments(locator.objectPath)}`;
  if (url.protocol !== "https:" || url.origin !== expected.origin || url.username || url.password ||
      url.pathname !== expectedPath) {
    throw new ReplicaStorageError("signed_read_origin_invalid");
  }
  return {
    url: url.toString(),
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

// Supabase's `/object/info/{bucket}/{path}` route answers HEAD-style: the
// metadata IS the response headers (content-length, content-type, etag) and the
// body is empty. Reading it as JSON only — which is what this did until
// 2026-08-26 — makes `data` null on a perfectly good object, so EVERY upload
// finalize failed closed with `storage_metadata_incomplete` and no source could
// ever leave `pending_upload`. Measured, not reasoned: the first real consented
// upload through the live signed-upload path returned HTTP 200 from storage and
// then 409 `storage_metadata_incomplete` from finalize, which is only reachable
// on a 2xx info response whose body could not be parsed. Headers are read as
// the fallback so a future storage-api that does return JSON still works.
export async function replicaObjectInfo(locatorInput, fetchImpl = fetch) {
  const locator = replicaStorageLocator(locatorInput);
  if (locator.provider === "azure_blob") {
    const info = await azureObjectInfo(locator.objectPath, {
      credentials: await azureStorageCredentials(locator),
      fetchImpl,
    });
    if (!info) throw new ReplicaStorageError("private_storage_read_failed", 404);
    return info;
  }
  const { response, data } = await storageRequest(
    `/object/info/${encodeURIComponent(locator.bucket)}/${segments(locator.objectPath)}`,
    { fetchImpl },
  );
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const headerSize = response?.headers?.get("content-length");
  const byteSize = Number(data?.size ?? metadata.size ?? headerSize);
  const mime = String(
    data?.mimetype ?? data?.mime_type ?? data?.contentType ?? data?.content_type
    ?? metadata.mimetype ?? metadata.mimeType ?? metadata.contentType
    ?? response?.headers?.get("content-type") ?? "",
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || !mime) {
    throw new ReplicaStorageError("storage_metadata_incomplete", 409);
  }
  return { objectId: String(data?.id || ""), byteSize, mime };
}

export async function deleteReplicaObject(locator, fetchImpl = fetch) {
  return deleteReplicaObjects([locator], fetchImpl);
}

function xmlText(value) {
  return String(value || "").replace(/&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
    const decimal = /^&#(\d+);$/.exec(entity);
    const codePoint = Number.parseInt(hex?.[1] || decimal?.[1] || "", hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint) : entity;
  });
}

async function listAzurePrefixObjects(descriptor, prefix, validateObjectPath, fetchImpl, signal) {
  const credentials = await azureStorageCredentials(descriptor);
  const paths = [];
  const seenMarkers = new Set();
  let marker = "";
  do {
    if (seenMarkers.has(marker)) throw new ReplicaStorageError("azure_replica_storage_list_invalid", 503);
    seenMarkers.add(marker);
    const response = await azureStorageFetch("", {
      credentials,
      method: "GET",
      permissions: "l",
      resource: "c",
      query: {
        restype: "container",
        comp: "list",
        prefix,
        maxresults: "5000",
        // Recovery features are disabled by infrastructure, but erasure must
        // fail closed if that control-plane posture ever drifts. Retained
        // versions, snapshots, soft-deleted bytes or uncommitted blocks stay
        // visible to the final empty-prefix proof.
        include: "deleted,deletedwithversions,snapshots,versions,uncommittedblobs",
        ...(marker ? { marker } : {}),
      },
      fetchImpl,
      timeoutMs: 60_000,
      signal,
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* provider content is not evidence */ }
      throw new ReplicaStorageError("azure_replica_storage_list_failed", response.status >= 500 ? 503 : 409);
    }
    const xml = await response.text();
    if (xml.length > 8 * 1024 * 1024) throw new ReplicaStorageError("azure_replica_storage_list_invalid", 503);
    for (const match of xml.matchAll(/<Blob(?:\s[^>]*)?>([\s\S]*?)<\/Blob>/g)) {
      const name = /<Name>([\s\S]*?)<\/Name>/.exec(match[1]);
      if (!name) throw new ReplicaStorageError("azure_replica_storage_list_invalid", 503);
      paths.push(validateObjectPath(xmlText(name[1]), prefix));
      // Delete this bounded exact-name page before asking the provider for
      // more. Re-listing from the prefix after the page is gone makes forward
      // progress without retaining an unbounded manifest in memory.
      if (paths.length >= STORAGE_ERASURE_PAGE_SIZE) return paths;
    }
    marker = xmlText(/<NextMarker>([\s\S]*?)<\/NextMarker>/.exec(xml)?.[1] || "");
  } while (marker);
  return paths;
}

function supabaseChildName(value) {
  const name = String(value || "");
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new ReplicaStorageError("supabase_replica_storage_list_invalid", 503);
  }
  return name;
}

async function listSupabasePrefixObjects(descriptor, prefix, validateObjectPath, fetchImpl, signal) {
  const root = prefix.slice(0, -1);
  const queue = [root];
  const queued = new Set(queue);
  const paths = [];
  while (queue.length) {
    const folder = queue.shift();
    for (let offset = 0; ; offset += 1000) {
      const { data } = await storageRequest(`/object/list/${encodeURIComponent(descriptor.bucket)}`, {
        method: "POST",
        body: { prefix: folder, limit: 1000, offset, sortBy: { column: "name", order: "asc" } },
        fetchImpl,
        signal,
      });
      if (!Array.isArray(data)) throw new ReplicaStorageError("supabase_replica_storage_list_invalid", 503);
      for (const entry of data) {
        const child = `${folder}/${supabaseChildName(entry?.name)}`;
        if (typeof entry?.id === "string" && entry.id) {
          paths.push(validateObjectPath(child, prefix));
          if (paths.length >= STORAGE_ERASURE_PAGE_SIZE) return paths;
        } else {
          validateObjectPath(`${child}/placeholder`, prefix);
          if (!queued.has(child)) {
            queue.push(child);
            queued.add(child);
          }
        }
      }
      if (data.length < 1000) break;
    }
  }
  return paths;
}

async function listSourceObjects(descriptor, prefix, fetchImpl, signal) {
  return descriptor.provider === "azure_blob"
    ? listAzurePrefixObjects(descriptor, prefix, exactSourceObjectPath, fetchImpl, signal)
    : listSupabasePrefixObjects(descriptor, prefix, exactSourceObjectPath, fetchImpl, signal);
}

async function listReplicaObjects(descriptor, prefix, fetchImpl, signal) {
  return descriptor.provider === "azure_blob"
    ? listAzurePrefixObjects(descriptor, prefix, exactReplicaObjectPath, fetchImpl, signal)
    : listSupabasePrefixObjects(descriptor, prefix, exactReplicaObjectPath, fetchImpl, signal);
}

async function supabaseExactObjectExists(locator, fetchImpl, signal) {
  const parts = locator.objectPath.split("/");
  const name = parts.pop();
  const prefix = parts.join("/");
  for (let offset = 0; ; offset += 1000) {
    const { data } = await storageRequest(`/object/list/${encodeURIComponent(locator.bucket)}`, {
      method: "POST",
      body: { prefix, search: name, limit: 1000, offset, sortBy: { column: "name", order: "asc" } },
      fetchImpl,
      signal,
    });
    if (!Array.isArray(data)) throw new ReplicaStorageError("supabase_replica_storage_list_invalid", 503);
    if (data.some((entry) => entry?.name === name && typeof entry?.id === "string" && entry.id)) return true;
    if (data.length < 1000) return false;
  }
}

async function replicaObjectExists(locator, fetchImpl, signal) {
  if (locator.provider === "azure_blob") {
    const response = await azureStorageFetch(locator.objectPath, {
      credentials: await azureStorageCredentials(locator),
      method: "HEAD",
      permissions: "r",
      fetchImpl,
      timeoutMs: 30_000,
      signal,
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new ReplicaStorageError("azure_replica_storage_read_failed", response.status >= 500 ? 503 : 409);
    try { await response.body?.cancel(); } catch { /* HEAD normally has no body */ }
    return true;
  }
  return supabaseExactObjectExists(locator, fetchImpl, signal);
}

async function requireReplicaObjectsAbsent(locators, fetchImpl, signal) {
  await mapBatches(locators, STORAGE_ERASURE_CONCURRENCY, async (locator) => {
    signal?.throwIfAborted();
    if (await replicaObjectExists(locator, fetchImpl, signal)) {
      throw new ReplicaStorageError("replica_storage_delete_not_confirmed", 503);
    }
  });
}

export async function deleteReplicaObjects(locatorInputs, fetchImpl = fetch, options = {}) {
  if (!Array.isArray(locatorInputs) || !locatorInputs.length || locatorInputs.length > 10_000) {
    throw new ReplicaStorageError("replica_delete_paths_invalid", 400);
  }
  const unique = new Map();
  for (const input of locatorInputs) {
    const locator = replicaStorageLocator(input);
    unique.set(`${locator.storageBucket}\n${locator.objectPath}`, locator);
  }
  const locators = [...unique.values()];
  const byBucket = new Map();
  for (const locator of locators) {
    const group = byBucket.get(locator.storageBucket) || [];
    group.push(locator);
    byBucket.set(locator.storageBucket, group);
  }
  for (const bucketLocators of byBucket.values()) {
    options.signal?.throwIfAborted();
    const descriptor = bucketLocators[0];
    if (descriptor.provider === "azure_blob") {
      const azure = await azureStorageCredentials(descriptor);
      for (let offset = 0; offset < bucketLocators.length; offset += 16) {
        const responses = await Promise.all(bucketLocators.slice(offset, offset + 16).map((locator) => azureStorageFetch(locator.objectPath, {
          credentials: azure,
          method: "DELETE",
          permissions: "d",
          headers: { "x-ms-delete-snapshots": "include" },
          fetchImpl,
          timeoutMs: 60_000,
          signal: options.signal,
        })));
        const failed = responses.find((response) => !response.ok && response.status !== 404);
        if (failed) throw new ReplicaStorageError("azure_replica_storage_delete_failed", failed.status >= 500 ? 503 : 409);
      }
      continue;
    }
    const paths = bucketLocators.map((locator) => locator.objectPath);
    // Supabase's remove endpoint accepts exact object names. Chunking prevents
    // one unusually rich source from exceeding request-body/provider limits.
    for (let offset = 0; offset < paths.length; offset += 100) {
      await storageRequest(`/object/${encodeURIComponent(descriptor.bucket)}`, {
        method: "DELETE",
        body: { prefixes: paths.slice(offset, offset + 100) },
        fetchImpl,
        signal: options.signal,
      });
    }
  }
  await requireReplicaObjectsAbsent(locators, fetchImpl, options.signal);
  return Object.freeze({ requested: locators.length, confirmedAbsent: locators.length });
}

async function deleteExactObjectBatches(locators, fetchImpl, options, deletedKeys) {
  for (let offset = 0; offset < locators.length; offset += STORAGE_ERASURE_PAGE_SIZE) {
    const batch = locators.slice(offset, offset + STORAGE_ERASURE_PAGE_SIZE);
    await deleteReplicaObjects(batch, fetchImpl, options);
    for (const locator of batch) {
      deletedKeys.add(`${locator.storageBucket}\n${locator.objectPath}`);
    }
  }
}

async function drainExactReplicaPrefix({
  manifest, descriptors, prefix, listObjects, fetchImpl, options, notEmptyCode,
}) {
  const deletedKeys = new Set();
  await deleteExactObjectBatches(manifest, fetchImpl, options, deletedKeys);
  let discovered = 0;
  const discoveredKeys = new Set();
  const maxPasses = Math.max(1, Math.min(1_000, Number(options.maxPasses || MAX_STORAGE_ERASURE_PASSES)));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let found = false;
    for (const descriptor of descriptors.values()) {
      options.signal?.throwIfAborted();
      const paths = await listObjects(descriptor, prefix, fetchImpl, options.signal);
      if (!paths.length) continue;
      found = true;
      const locators = paths.map((objectPath) => ({ ...descriptor, objectPath }));
      for (const locator of locators) {
        const key = `${locator.storageBucket}\n${locator.objectPath}`;
        if (!discoveredKeys.has(key)) {
          discoveredKeys.add(key);
          discovered += 1;
        }
      }
      await deleteExactObjectBatches(locators, fetchImpl, options, deletedKeys);
    }
    if (!found) {
      return Object.freeze({ discovered, confirmedAbsent: deletedKeys.size, providers: descriptors.size });
    }
  }
  // A writer or retained provider version is defeating monotonic cleanup.
  // Keep every SQL manifest and retry under an explicit operational code;
  // never convert a bounded-work ceiling into a successful receipt.
  throw new ReplicaStorageError(notEmptyCode, 503);
}

// A source manifest names only the currently selected artifacts. Failed or
// superseded processing attempts can still leave exact-source siblings in the
// private store. Enumerate the source namespace, delete every discovered name
// individually, then enumerate again. SQL may remove the source manifest only
// after this function proves that every configured provider is empty for this
// one owner/replica/source tuple.
export async function deleteReplicaSourceObjects(source, locatorInputs, fetchImpl = fetch, options = {}) {
  if (!Array.isArray(locatorInputs) || !locatorInputs.length) {
    throw new ReplicaStorageError("replica_delete_paths_invalid", 400);
  }
  const prefix = replicaSourceObjectPrefix(source);
  const manifest = locatorInputs.map((input) => {
    const locator = replicaStorageLocator(input);
    exactSourceObjectPath(locator.objectPath, prefix);
    return locator;
  });
  const descriptors = new Map();
  for (const locator of manifest) descriptors.set(locator.storageBucket, locator);
  for (const configuredBucket of [REPLICA_STORAGE_BUCKET, REPLICA_STORAGE_WRITE_BUCKET]) {
    const descriptor = replicaStorageBucketDescriptor(configuredBucket);
    descriptors.set(descriptor.storageBucket, descriptor);
  }

  return drainExactReplicaPrefix({
    manifest, descriptors, prefix, listObjects: listSourceObjects, fetchImpl, options,
    notEmptyCode: "replica_source_storage_not_empty",
  });
}

// Full-replica erasure must also reach objects that predate a per-source
// manifest, including channel extraction uploads. Enumerate only the exact
// owner/replica namespace, delete each discovered object by its full name,
// then prove every durable/configured provider namespace is empty. This is
// deliberately separate from deleteReplicaSourceObjects: source erasure keeps
// its narrower owner/replica/source path law unchanged.
export async function deleteReplicaPrefixObjects(scope, locatorInputs = [], fetchImpl = fetch, options = {}) {
  if (!Array.isArray(locatorInputs)) {
    throw new ReplicaStorageError("replica_delete_paths_invalid", 400);
  }
  const prefix = replicaObjectPrefix(scope);
  const manifest = locatorInputs.map((input) => {
    const locator = replicaStorageLocator(input);
    exactReplicaObjectPath(locator.objectPath, prefix);
    return locator;
  });
  const descriptors = new Map();
  for (const locator of manifest) descriptors.set(locator.storageBucket, locator);
  for (const configuredBucket of [REPLICA_STORAGE_BUCKET, REPLICA_STORAGE_WRITE_BUCKET]) {
    const descriptor = replicaStorageBucketDescriptor(configuredBucket);
    descriptors.set(descriptor.storageBucket, descriptor);
  }

  return drainExactReplicaPrefix({
    manifest, descriptors, prefix, listObjects: listReplicaObjects, fetchImpl, options,
    notEmptyCode: "replica_storage_prefix_not_empty",
  });
}
