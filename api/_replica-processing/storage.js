import { assertSha256, sha256Hex } from "./contracts.js";
import {
  REPLICA_STORAGE_BUCKET,
  readPrivateReplicaObject,
  writeImmutableReplicaArtifact,
} from "../_replica-storage.js";

function fail(code) {
  throw Object.assign(new Error(code), { code, retryable: false });
}

function scopedPath(source, input) {
  if (source.storage_bucket !== REPLICA_STORAGE_BUCKET) fail("processing_storage_bucket_mismatch");
  const objectPath = String(input.object_path || "");
  const root = `${source.owner_user_id}/${source.replica_id}/${source.source_id}/`;
  if (!objectPath.startsWith(root) || objectPath.includes("://") ||
      (!objectPath.endsWith("/original") && !objectPath.includes("/derived/"))) {
    fail("processing_storage_path_out_of_scope");
  }
  return objectPath;
}

export function createReplicaProcessingStorage(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return Object.freeze({
    async resolveInput({ source, input }) {
      const objectPath = scopedPath(source, input);
      const object = await readPrivateReplicaObject(objectPath, {
        fetchImpl,
        maxBytes: options.maxBytes || 67_108_864,
        timeoutMs: options.timeoutMs || 120_000,
      });
      const expected = assertSha256(input.sha256, "processing input sha256");
      if (sha256Hex(object.body) !== expected) fail("processing_storage_integrity_mismatch");
      const declaredMime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
      if (object.mime !== declaredMime) fail("processing_storage_mime_mismatch");
      return object;
    },
    artifactStore: Object.freeze({
      async writeImmutable(input) {
        return writeImmutableReplicaArtifact(input, {
          fetchImpl,
          maxBytes: options.maxBytes || 67_108_864,
          timeoutMs: options.timeoutMs || 120_000,
        });
      },
    }),
  });
}

