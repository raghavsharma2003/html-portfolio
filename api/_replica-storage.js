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

async function storageRequest(path, { method = "GET", body, headers = {}, fetchImpl = fetch, allow = [] } = {}) {
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
      signal: AbortSignal.timeout(10_000),
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

export async function writeImmutableReplicaArtifact(input, options = {}) {
  const locator = replicaStorageLocator(input, { requireDerived: true });
  const objectPath = locator.objectPath;
  if (input.ifNoneMatch !== "*") throw new ReplicaStorageError("replica_artifact_create_only_required", 400);
  const mime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime || !mime.includes("/")) throw new ReplicaStorageError("replica_artifact_mime_invalid", 400);
  const bytes = await collectStorageBody(input.body, options.maxBytes || MAX_DERIVED_OBJECT_BYTES, "replica_artifact_size_invalid");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedSha256 && String(input.expectedSha256).toLowerCase() !== digest) {
    throw new ReplicaStorageError("replica_artifact_digest_mismatch", 409);
  }
  const upload = locator.provider === "azure_blob"
    ? await azureStorageFetch(objectPath, {
      credentials: await azureStorageCredentials(locator),
      method: "PUT",
      permissions: "w",
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=31536000, immutable",
        "If-None-Match": "*",
        "x-ms-blob-type": "BlockBlob",
      },
      body: bytes,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    })
    : await rawStorageFetch(
      `/object/${encodeURIComponent(locator.bucket)}/${segments(objectPath)}`,
      {
        method: "POST",
        headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable", "x-upsert": "false" },
        body: bytes,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      },
    );
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
  });
  const storedDigest = createHash("sha256").update(stored.body).digest("hex");
  if (storedDigest !== digest || stored.byteSize !== bytes.length || stored.mime !== mime) {
    throw new ReplicaStorageError(upload.ok ? "replica_artifact_verification_failed" : "immutable_artifact_collision", 409);
  }
  return Object.freeze({ sha256: digest, byteSize: bytes.length, mime });
}

export async function ensurePrivateReplicaBucket(storageBucket, fetchImpl = fetch) {
  const descriptor = replicaStorageBucketDescriptor(storageBucket);
  if (descriptor.provider === "azure_blob") {
    const azure = await azureStorageCredentials(descriptor);
    const response = await azureStorageFetch("", {
      credentials: azure,
      resource: "c",
      permissions: "r",
      method: "HEAD",
      query: { restype: "container" },
      fetchImpl,
      timeoutMs: 30_000,
    });
    if (response.status === 404) throw new ReplicaStorageError("azure_replica_container_missing");
    if (!response.ok) throw new ReplicaStorageError("azure_replica_container_unreachable");
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
      endpoint: `${resumableOrigin}/storage/v1/upload/resumable`,
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

export async function deleteReplicaObjects(locatorInputs, fetchImpl = fetch) {
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
      });
    }
  }
}
