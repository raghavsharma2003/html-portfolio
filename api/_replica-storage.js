export const REPLICA_STORAGE_BUCKET = process.env.REPLICA_STORAGE_BUCKET || "vyakti-replica-private";
// One to two hour source recordings routinely cross 256 MiB when they arrive
// as lossless WAV. Originals are uploaded directly to Storage and processed
// from a bounded disk stream, so the bucket ceiling must not reintroduce the
// old in-memory limit at the storage boundary. Derived artifacts stay on their
// much smaller, separate ceiling below.
const MAX_BUCKET_BYTES = 1_073_741_824;
const MAX_DERIVED_OBJECT_BYTES = 67_108_864;
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

async function publicStorageKey() {
  configPromise ||= import("./_config.js").catch(() => ({}));
  const config = await configPromise;
  const publicKey = String(process.env.SUPABASE_KEY || config.SUPABASE_KEY || "").trim();
  const { key: serviceKey } = await storageCredentials();
  if (!publicKey) throw new ReplicaStorageError("public_storage_key_not_configured");
  if (publicKey === String(serviceKey)) throw new ReplicaStorageError("public_storage_key_must_not_be_service_role");
  return publicKey;
}

async function storageRequest(path, { method = "GET", body, headers = {}, fetchImpl = fetch, allow = [] } = {}) {
  const { baseUrl, key } = await storageCredentials();
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/storage/v1${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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
        apikey: key,
        Authorization: `Bearer ${key}`,
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

export async function streamPrivateReplicaObject(objectPath, options = {}) {
  const path = exactObjectPath(objectPath);
  const maxBytes = Number(options.maxBytes || MAX_DERIVED_OBJECT_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BUCKET_BYTES) {
    throw new ReplicaStorageError("replica_read_limit_invalid", 500);
  }
  const response = await rawStorageFetch(
    `/object/authenticated/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(path)}`,
    { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, signal: options.signal },
  );
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* do not retain or log provider content */ }
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
  });
}

export async function readPrivateReplicaObject(objectPath, options = {}) {
  const maxBytes = Number(options.maxBytes || MAX_DERIVED_OBJECT_BYTES);
  const object = await streamPrivateReplicaObject(objectPath, options);
  const bytes = await collectStorageBody(object.body, maxBytes, "replica_object_size_invalid");
  if (object.byteSize != null && object.byteSize !== bytes.length) {
    throw new ReplicaStorageError("replica_object_size_invalid", 409);
  }
  return Object.freeze({ body: bytes, byteSize: bytes.length, mime: object.mime });
}

export async function writeImmutableReplicaArtifact(input, options = {}) {
  if (input?.bucket !== REPLICA_STORAGE_BUCKET) throw new ReplicaStorageError("replica_artifact_bucket_invalid", 400);
  const objectPath = exactObjectPath(input.objectPath, true);
  if (input.ifNoneMatch !== "*") throw new ReplicaStorageError("replica_artifact_create_only_required", 400);
  const mime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime || !mime.includes("/")) throw new ReplicaStorageError("replica_artifact_mime_invalid", 400);
  const bytes = await collectStorageBody(input.body, options.maxBytes || MAX_DERIVED_OBJECT_BYTES, "replica_artifact_size_invalid");
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedSha256 && String(input.expectedSha256).toLowerCase() !== digest) {
    throw new ReplicaStorageError("replica_artifact_digest_mismatch", 409);
  }
  const upload = await rawStorageFetch(
    `/object/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(objectPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable", "x-upsert": "false" },
      body: bytes,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    },
  );
  if (!upload.ok && upload.status !== 400 && upload.status !== 409) {
    try { await upload.body?.cancel(); } catch { /* response content is not evidence */ }
    throw new ReplicaStorageError("private_storage_write_failed", upload.status >= 500 ? 503 : 409);
  }
  // Re-read through the authenticated private plane for both successful
  // uploads and create-only conflicts. Only byte-identical retries succeed.
  const stored = await readPrivateReplicaObject(objectPath, {
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

export async function ensurePrivateReplicaBucket(fetchImpl = fetch) {
  let result = await storageRequest(`/bucket/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}`, {
    fetchImpl,
    allow: [404],
  });
  if (result.response.status === 404) {
    await storageRequest("/bucket", {
      method: "POST",
      body: {
        id: REPLICA_STORAGE_BUCKET,
        name: REPLICA_STORAGE_BUCKET,
        public: false,
        file_size_limit: MAX_BUCKET_BYTES,
      },
      fetchImpl,
      allow: [409],
    });
    // Creation responses are not a stable bucket descriptor. Refetch and
    // verify the actual access model even after a successful create or a
    // concurrent creator's 409.
    result = await storageRequest(`/bucket/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}`, { fetchImpl });
  }
  if (!result.data || result.data.public !== false) {
    throw new ReplicaStorageError("replica_bucket_must_be_private", 503);
  }
  const limit = Number(result.data.file_size_limit ?? result.data.fileSizeLimit ?? MAX_BUCKET_BYTES);
  if (Number.isFinite(limit) && limit < MAX_BUCKET_BYTES) {
    throw new ReplicaStorageError("replica_bucket_limit_too_small", 503);
  }
  return { bucket: REPLICA_STORAGE_BUCKET, maxBytes: limit };
}

export async function createSignedReplicaUpload(objectPath, fetchImpl = fetch) {
  const { baseUrl } = await storageCredentials();
  const publicKey = await publicStorageKey();
  const { data } = await storageRequest(
    `/object/upload/sign/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(objectPath)}`,
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
  if (!token) throw new ReplicaStorageError("signed_upload_not_issued");
  const base = new URL(baseUrl);
  // Supabase explicitly recommends the direct Storage hostname for TUS. Keep
  // custom/self-hosted origins on their configured host instead of guessing.
  const resumableOrigin = base.hostname.endsWith(".supabase.co")
    ? `${base.protocol}//${base.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")}`
    : base.origin;
  return {
    method: "PUT",
    url: uploadUrl,
    headers: { "cache-control": "max-age=3600", "x-upsert": "false" },
    resumable: {
      protocol: "tus-1.0",
      endpoint: `${resumableOrigin}/storage/v1/upload/resumable`,
      headers: { apikey: publicKey, "x-signature": token, "x-upsert": "false" },
      metadata: {
        bucketName: REPLICA_STORAGE_BUCKET,
        objectName: exactObjectPath(objectPath),
        cacheControl: "3600",
      },
      chunk_size: 6 * 1024 * 1024,
    },
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

export async function createSignedReplicaRead(objectPath, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const expiresIn = Number(options.expiresIn || 300);
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 600) {
    throw new ReplicaStorageError("signed_read_expiry_invalid", 500);
  }
  const { baseUrl } = await storageCredentials();
  const { data } = await storageRequest(
    `/object/sign/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(objectPath)}`,
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
  if (url.protocol !== "https:" || url.origin !== expected.origin || url.username || url.password ||
      !url.pathname.startsWith(`/storage/v1/object/sign/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/`)) {
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
export async function replicaObjectInfo(objectPath, fetchImpl = fetch) {
  const { response, data } = await storageRequest(
    `/object/info/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(objectPath)}`,
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

export async function deleteReplicaObject(objectPath, fetchImpl = fetch) {
  return deleteReplicaObjects([objectPath], fetchImpl);
}

export async function deleteReplicaObjects(objectPaths, fetchImpl = fetch) {
  const paths = [...new Set(Array.isArray(objectPaths) ? objectPaths : [])];
  if (!paths.length || paths.length > 10_000 || paths.some((path) =>
    typeof path !== "string" || !path || path.includes("://") || path.startsWith("/")
  )) {
    throw new ReplicaStorageError("replica_delete_paths_invalid", 400);
  }
  // Supabase's remove endpoint accepts exact object names. Chunking prevents
  // one unusually rich source from exceeding request-body/provider limits.
  for (let offset = 0; offset < paths.length; offset += 100) {
    const prefixes = paths.slice(offset, offset + 100);
  await storageRequest(`/object/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}`, {
    method: "DELETE",
      body: { prefixes },
    fetchImpl,
  });
  }
}
