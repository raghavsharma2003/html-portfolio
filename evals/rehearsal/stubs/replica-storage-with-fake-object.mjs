// Rehearsal storage seam. Voice enrollment reads use the existing fixed
// reference fixture. Creator source writes run the production immutable
// storage code with an in-memory provider transport; ownership, source
// consent, writer renewal, digest and readback checks remain exercised.
// Unrelated exports remain real so every production handler can link.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_replica-storage.js")).href;
const REAL = await import(REAL_URL);

export const {
  REPLICA_STORAGE_BUCKET, REPLICA_STORAGE_WRITE_BUCKET, ReplicaStorageError,
  replicaStorageBucketDescriptor, replicaStorageLocator, streamPrivateReplicaObject,
  writeImmutableReplicaArtifact, createSignedReplicaUpload,
  createSignedReplicaRead, replicaObjectInfo, deleteReplicaObject, deleteReplicaObjects,
  deleteReplicaPrefixObjects, deleteReplicaSourceObjects,
} = REAL;

/** A fixed, small, non-empty reference buffer — nothing downstream reads its
 *  bytes for real (the provider fake this same wave adds ignores `stored.body`
 *  entirely and always returns its own fixed clip), so this only has to be
 *  present, never a real recording. */
export async function readPrivateReplicaObject(_locator, _options = {}) {
  return Object.freeze({
    body: Buffer.alloc(4096, 5),
    byteSize: 4096,
    mime: "audio/wav",
    objectId: "rehearsal-fake-object",
  });
}

// Only transport is fake: real bucket privacy, locator, create-only, digest,
// readback and per-write authority checks execute unchanged.
process.env.SUPABASE_URL = "https://rehearsal-storage.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "rehearsal-synthetic-service-key";
const objects = new Map();
export async function rehearsalObjectFetch(rawUrl, init = {}) {
  const url = new URL(rawUrl);
  if (url.origin !== "https://rehearsal-storage.invalid") throw new Error("rehearsal_storage_origin_denied");
  const path = decodeURIComponent(url.pathname.replace("/storage/v1", ""));
  if (path.startsWith("/bucket/")) return Response.json({ public: false, file_size_limit: 1073741824 });
  if (path.startsWith("/object/") && init.method === "POST") {
    const key = path.slice("/object/".length);
    if (init.headers["x-upsert"] !== "false") throw new Error("rehearsal_create_only_required");
    if (objects.has(key)) return new Response(null, {status:409});
    objects.set(key, { bytes: Buffer.from(init.body), mime: init.headers["Content-Type"] });
    return Response.json({ Key:key }, {status:201});
  }
  if (path.startsWith("/object/authenticated/")) {
    const value = objects.get(path.slice("/object/authenticated/".length));
    return value ? new Response(value.bytes, {headers:{"content-type":value.mime,"content-length":String(value.bytes.length),etag:'"rehearsal-immutable"'}}) : new Response(null,{status:404});
  }
  throw new Error("rehearsal_storage_operation_not_modelled");
}
export const ensurePrivateReplicaBucket = (bucket) => REAL.ensurePrivateReplicaBucket(bucket, rehearsalObjectFetch);
export const writeImmutableReplicaSource = (input, options = {}) => REAL.writeImmutableReplicaSource(input, { ...options, fetchImpl: rehearsalObjectFetch });
