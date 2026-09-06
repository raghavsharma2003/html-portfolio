// WS-R119 (wave seventeen, third pass). `../loader.mjs` redirects any
// relative import ending in `_replica-storage.js` here. `readPrivateReplicaObject`
// is the ONE function `api/room-tg.js`'s own `buildRoomVoiceDeps.synth`
// closure calls directly (reading the owner's enrolled voice reference bytes
// before handing them to the provider) — real Supabase Storage over a real
// network, which this rehearsal may not reach (`ws-common.md`'s own "no
// network beyond 127.0.0.1"). Every other real export is re-exported
// unchanged, `stubs/surface-with-fake-model.mjs`'s own "re-export
// everything, override one name" shape, since `_replica-storage.js` is a
// generic-basename-free but widely reused module (replica export/erasure,
// the studio's upload panel) whose OTHER functions this rehearsal never
// calls but Node still has to LINK.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_replica-storage.js")).href;
const REAL = await import(REAL_URL);

export const {
  REPLICA_STORAGE_BUCKET, REPLICA_STORAGE_WRITE_BUCKET, ReplicaStorageError,
  replicaStorageBucketDescriptor, replicaStorageLocator, streamPrivateReplicaObject,
  writeImmutableReplicaArtifact, ensurePrivateReplicaBucket, createSignedReplicaUpload,
  createSignedReplicaRead, replicaObjectInfo, deleteReplicaObject, deleteReplicaObjects,
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
