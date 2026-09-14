import { randomUUID } from "node:crypto";
import {
  REPLICA_STORAGE_WRITE_BUCKET,
  deleteReplicaPrefixObjects,
  replicaStorageBucketDescriptor,
} from "../_replica-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// One shared application-issued authority horizon: the two-hour storage
// capability, Azure's documented 80-minute ceiling for a legitimate 8 MiB
// write, and ten minutes of clock/transport margin. This protects the shipped
// bounded uploader's in-flight writes. It is not a claim that a copied
// capability can be revoked before its own expiry.
export const CHANNEL_UPLOAD_AUTHORIZATION_MS = 210 * 60 * 1000;
export const CHANNEL_UPLOAD_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const CHANNEL_UPLOAD_PROTOCOL = "azure-block-v1";

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function extractionScope(input) {
  const ownerUserId = String(input?.ownerUserId || "").toLowerCase();
  const replicaId = String(input?.replicaId || "").toLowerCase();
  const scopeId = String(input?.scopeId || input?.watchId || "").toLowerCase();
  const scopeKind = String(input?.scopeKind || "");
  const videoId = String(input?.videoId || "");
  if (![ownerUserId, replicaId, scopeId].every((value) => UUID.test(value))) {
    fail("channel_extraction_storage_scope_invalid", 400);
  }
  if (!["channel_watch", "video_enrollment"].includes(scopeKind)) {
    fail("channel_extraction_storage_scope_invalid", 400);
  }
  if (!VIDEO_ID.test(videoId)) fail("channel_extraction_video_id_invalid", 400);
  return Object.freeze({ ownerUserId, replicaId, scopeId, scopeKind, videoId });
}

export function channelExtractionObjectPath(input) {
  const scope = extractionScope(input);
  return `${scope.ownerUserId}/${scope.replicaId}/${scope.scopeId}/${scope.videoId}/original`;
}

// Persist the complete upload authority before a URL capable of writing bytes
// is minted. A crash after this statement can leave a harmless future fence;
// a crash before it cannot leave a capability or an untracked object.
export async function reserveChannelExtractionUpload(db, input, options = {}) {
  if (typeof db !== "function") fail("channel_extraction_storage_db_required", 500);
  const scope = extractionScope(input);
  const storageBucket = replicaStorageBucketDescriptor(
    input?.storageBucket || REPLICA_STORAGE_WRITE_BUCKET,
  ).storageBucket;
  const objectPath = channelExtractionObjectPath(scope);
  if (input?.objectPath != null && String(input.objectPath) !== objectPath) {
    fail("channel_extraction_storage_path_mismatch", 400);
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const expiresAt = new Date(nowMs + CHANNEL_UPLOAD_AUTHORIZATION_MS).toISOString();
  const rows = await db(
    `with owned as (
       select r.replica_id from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.lifecycle not in ('revoked','purging')
          and (
            ($3='channel_watch' and exists (
              select 1 from vy_ingest_run i
               where i.replica_id=r.replica_id and i.owner_user_id=$2::uuid
                 and i.watch_id=$4::uuid and i.video_ref=$5
            ))
            or
            ($3='video_enrollment' and exists (
              select 1 from vy_video_enrollment e
               where e.replica_id=r.replica_id and e.owner_user_id=$2::uuid
                 and e.enrollment_id=$4::uuid and e.video_id=$5
            ))
          )
        for update of r
     ), reserved as (
       insert into vy_channel_extraction_object
         (extraction_object_id,replica_id,owner_user_id,scope_kind,scope_id,video_id,
          storage_bucket,object_path,upload_authorization_expires_at)
       select $9::uuid,owned.replica_id,$2::uuid,$3,$4::uuid,$5,$6,$7,$8::timestamptz
         from owned
       on conflict (replica_id,storage_bucket,object_path) do update
         set upload_authorization_expires_at=greatest(
               vy_channel_extraction_object.upload_authorization_expires_at,
               excluded.upload_authorization_expires_at
             ),
             updated_at=now()
         where vy_channel_extraction_object.owner_user_id=excluded.owner_user_id
           and vy_channel_extraction_object.scope_kind=excluded.scope_kind
           and vy_channel_extraction_object.scope_id=excluded.scope_id
           and vy_channel_extraction_object.video_id=excluded.video_id
       returning extraction_object_id,replica_id,owner_user_id,scope_kind,scope_id,video_id,
                 storage_bucket,object_path,upload_authorization_expires_at
     ), watch_fence as (
       update vy_ingest_run r set upload_authorization_expires_at=$8::timestamptz
         from reserved x where x.scope_kind='channel_watch'
          and r.replica_id=x.replica_id and r.owner_user_id=x.owner_user_id
          and r.watch_id=x.scope_id and r.video_ref=x.video_id
       returning r.run_id
     ), enrollment_fence as (
       update vy_video_enrollment e set upload_authorization_expires_at=$8::timestamptz
         from reserved x where x.scope_kind='video_enrollment'
          and e.replica_id=x.replica_id and e.owner_user_id=x.owner_user_id
          and e.enrollment_id=x.scope_id and e.video_id=x.video_id
       returning e.enrollment_id
     )
     select * from reserved
      where (
        $3='channel_watch'
        and (select count(*) from watch_fence)=1
        and (select count(*) from enrollment_fence)=0
      ) or (
        $3='video_enrollment'
        and (select count(*) from enrollment_fence)=1
        and (select count(*) from watch_fence)=0
      )`,
    [scope.replicaId, scope.ownerUserId, scope.scopeKind, scope.scopeId, scope.videoId,
      storageBucket, objectPath, expiresAt, randomUUID()],
  );
  if (!rows[0]) fail("channel_extraction_storage_authorization_refused", 409);
  return Object.freeze({
    storageBucket: rows[0].storage_bucket,
    objectPath: rows[0].object_path,
    expiresAt: new Date(rows[0].upload_authorization_expires_at).toISOString(),
  });
}

export async function issueChannelExtractionUpload(db, input, options = {}) {
  if (typeof options.ensureBucket !== "function" || typeof options.createUpload !== "function") {
    fail("channel_extraction_storage_issuer_invalid", 500);
  }
  // The extractor currently implements only bounded Azure block uploads.
  // Refuse an unsupported provider before persisting or minting any writable
  // capability; a single-PUT fallback would invalidate the erasure horizon.
  const descriptor = replicaStorageBucketDescriptor(
    input?.storageBucket || REPLICA_STORAGE_WRITE_BUCKET,
  );
  if (descriptor.provider !== "azure_blob") {
    fail("channel_extraction_upload_protocol_unsupported", 503);
  }
  const reserved = await reserveChannelExtractionUpload(db, input, options);
  await options.ensureBucket(reserved.storageBucket);
  const upload = await options.createUpload({
    storageBucket: reserved.storageBucket,
    objectPath: reserved.objectPath,
  });
  const issuedExpiry = Date.parse(upload?.expires_at);
  const resumable = upload?.resumable;
  const chunkBytes = Number(resumable?.chunk_size);
  if (!Number.isFinite(issuedExpiry) || issuedExpiry > Date.parse(reserved.expiresAt) ||
      upload?.storage_bucket !== reserved.storageBucket ||
      resumable?.protocol !== CHANNEL_UPLOAD_PROTOCOL ||
      resumable?.endpoint !== upload?.url ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 ||
      chunkBytes > CHANNEL_UPLOAD_MAX_CHUNK_BYTES) {
    fail("channel_extraction_upload_authorization_invalid", 503);
  }
  return upload;
}

export async function cleanupReplicaChannelExtractionStorage(db, lease, options = {}) {
  if (typeof db !== "function") fail("channel_extraction_storage_db_required", 500);
  const ownerUserId = String(lease?.ownerUserId || "").toLowerCase();
  const replicaId = String(lease?.replicaId || "").toLowerCase();
  if (![ownerUserId, replicaId].every((value) => UUID.test(value))) {
    fail("channel_extraction_storage_scope_invalid", 400);
  }
  const rows = await db(
    `select storage_bucket,object_path,upload_authorization_expires_at
       from vy_channel_extraction_object
      where replica_id=$1::uuid and owner_user_id=$2::uuid
      order by created_at,extraction_object_id`,
    [replicaId, ownerUserId],
  );
  const nowMs = Number(options.nowMs ?? Date.now());
  if (rows.some((row) => {
    const expiry = Date.parse(row.upload_authorization_expires_at);
    return !Number.isFinite(expiry) || expiry > nowMs;
  })) {
    fail("channel_extraction_upload_authorization_active", 409);
  }
  const history = await db(
    `select exists (
       select 1 from vy_ingest_run r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
       union all
       select 1 from vy_video_enrollment e
        where e.replica_id=$1::uuid and e.owner_user_id=$2::uuid
     ) has_channel_storage_history`,
    [replicaId, ownerUserId],
  );
  const hasHistory = history[0]?.has_channel_storage_history === true ||
    String(history[0]?.has_channel_storage_history || "").toLowerCase() === "true";
  const locators = rows.map((row) => ({
    storageBucket: row.storage_bucket,
    objectPath: row.object_path,
  }));
  const deletePrefix = options.deletePrefix || deleteReplicaPrefixObjects;
  // Always inspect the exact replica prefix. History is useful audit context,
  // but cannot prove that a pre-ledger or crash-gap object never existed.
  const storage = await deletePrefix(
    { ownerUserId, replicaId },
    locators,
    options.fetchImpl,
    { signal: options.signal },
  );
  return Object.freeze({ ledgerObjects: locators.length, hasHistory, storage });
}
