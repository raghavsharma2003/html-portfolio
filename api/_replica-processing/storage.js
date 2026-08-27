import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertSha256, sha256Hex } from "./contracts.js";
import {
  REPLICA_STORAGE_BUCKET,
  readPrivateReplicaObject,
  streamPrivateReplicaObject,
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
  const sourceMaxBytes = options.sourceMaxBytes || options.maxBytes || 1_073_741_824;
  const bufferedMaxBytes = options.bufferedMaxBytes || options.maxBytes || 67_108_864;

  async function resolveStream({ source, input, signal }) {
    const objectPath = scopedPath(source, input);
    const object = await streamPrivateReplicaObject(objectPath, {
      fetchImpl,
      maxBytes: sourceMaxBytes,
      timeoutMs: options.timeoutMs || 300_000,
      signal,
    });
    const declaredMime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
    if (object.mime !== declaredMime) fail("processing_storage_mime_mismatch");
    return object;
  }

  return Object.freeze({
    async resolveInput({ source, input }) {
      const objectPath = scopedPath(source, input);
      const object = await readPrivateReplicaObject(objectPath, {
        fetchImpl,
        maxBytes: bufferedMaxBytes,
        timeoutMs: options.timeoutMs || 120_000,
      });
      const expected = assertSha256(input.sha256, "processing input sha256");
      if (sha256Hex(object.body) !== expected) fail("processing_storage_integrity_mismatch");
      const declaredMime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
      if (object.mime !== declaredMime) fail("processing_storage_mime_mismatch");
      return object;
    },
    resolveStream,
    async withResolvedInputFile({ source, input, signal }, fn) {
      if (typeof fn !== "function") fail("processing_storage_file_callback_required");
      const expected = assertSha256(input.sha256, "processing input sha256");
      const object = await resolveStream({ source, input, signal });
      const directory = await mkdtemp(join(options.tmpDir || tmpdir(), "replica-input-"));
      const file = join(directory, randomBytes(12).toString("hex"));
      const digest = createHash("sha256");
      let total = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.length;
          if (total > sourceMaxBytes) {
            return callback(Object.assign(new Error("replica_object_size_invalid"), {
              code: "replica_object_size_invalid", retryable: false,
            }));
          }
          digest.update(bytes);
          callback(null, bytes);
        },
      });
      try {
        const readable = object.body && typeof object.body.pipe === "function"
          ? object.body
          : Readable.from(object.body);
        await pipeline(readable, meter, createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
        const actual = digest.digest("hex");
        const expectedSize = Number(input.byte_size ?? source.byte_size ?? object.byteSize);
        if (!total || actual !== expected || (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && total !== expectedSize) ||
            (object.byteSize != null && total !== object.byteSize)) {
          fail("processing_storage_integrity_mismatch");
        }
        return await fn(Object.freeze({ path: file, byteSize: total, sha256: actual, mime: object.mime }));
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    },
    artifactStore: Object.freeze({
      async writeImmutable(input) {
        return writeImmutableReplicaArtifact(input, {
          fetchImpl,
          maxBytes: options.artifactMaxBytes || bufferedMaxBytes,
          timeoutMs: options.timeoutMs || 120_000,
        });
      },
    }),
  });
}

