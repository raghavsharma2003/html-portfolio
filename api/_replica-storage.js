export const REPLICA_STORAGE_BUCKET = process.env.REPLICA_STORAGE_BUCKET || "vyakti-replica-private";
const MAX_BUCKET_BYTES = 536_870_912;
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
  // Existing deployments keep the privileged server-only Storage key in
  // SUPABASE_KEY. New deployments should use the explicitly named service
  // role variable. Neither value is ever serialized to the client.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_KEY || config.SUPABASE_KEY;
  if (!baseUrl || !key) throw new ReplicaStorageError("private_storage_not_configured");
  return { baseUrl, key };
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
  return {
    method: "PUT",
    url: uploadUrl,
    headers: { "cache-control": "max-age=3600", "x-upsert": "false" },
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

export async function replicaObjectInfo(objectPath, fetchImpl = fetch) {
  const { data } = await storageRequest(
    `/object/info/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}/${segments(objectPath)}`,
    { fetchImpl },
  );
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const byteSize = Number(data?.size ?? metadata.size);
  const mime = String(data?.mimetype ?? data?.mime_type ?? metadata.mimetype ?? metadata.mimeType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!data || !Number.isSafeInteger(byteSize) || byteSize < 0 || !mime) {
    throw new ReplicaStorageError("storage_metadata_incomplete", 409);
  }
  return { objectId: String(data.id || ""), byteSize, mime };
}

export async function deleteReplicaObject(objectPath, fetchImpl = fetch) {
  await storageRequest(`/object/${encodeURIComponent(REPLICA_STORAGE_BUCKET)}`, {
    method: "DELETE",
    body: { prefixes: [objectPath] },
    fetchImpl,
  });
}
