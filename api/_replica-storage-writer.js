import { createHash, randomBytes, randomUUID } from "node:crypto";

// Every server-side storage mutation is broken into requests no larger than
// 8 MiB. Azure permits up to ten minutes per MiB for a write operation, so a
// fresh ninety-minute authority covers one request's documented eighty-minute
// ceiling plus ten minutes of acknowledgement margin. The authority is
// renewed immediately before every mutating provider request, never merely at
// the start of a multi-block upload.
export const SOURCE_STORAGE_WRITE_HORIZON_MS = 90 * 60 * 1000;

const PURPOSES = new Set(["context_source", "processing_artifact", "voice_preview_result"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 409 });
}

function exactUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code);
  return id;
}

function writerTokenHash(token) {
  const value = String(token || "");
  if (value.length < 32) fail("source_storage_writer_token_invalid");
  return createHash("sha256")
    .update(`vyakti:source-storage-writer:v1:${value}`)
    .digest("hex");
}

function newWriterIdentity(options = {}) {
  const writerId = exactUuid(options.writerId || randomUUID(), "source_storage_writer_id_invalid");
  const token = String(options.token || randomBytes(32).toString("base64url"));
  writerTokenHash(token);
  return Object.freeze({ writerId, token });
}

function authority(row, identity) {
  if (!row) fail("source_storage_writer_acquire_denied");
  return Object.freeze({
    writerId: row.writer_id,
    sourceId: row.source_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    purpose: row.purpose,
    storageWriteNotAfter: row.storage_write_not_after,
    token: identity.token,
  });
}

function exactPurpose(value) {
  const purpose = String(value || "");
  if (!PURPOSES.has(purpose)) fail("source_storage_writer_purpose_invalid");
  return purpose;
}

function exactAuthority(value) {
  if (!value || typeof value !== "object") fail("source_storage_writer_authority_required");
  return Object.freeze({
    writerId: exactUuid(value.writerId, "source_storage_writer_id_invalid"),
    sourceId: exactUuid(value.sourceId, "source_storage_writer_source_invalid"),
    replicaId: exactUuid(value.replicaId, "source_storage_writer_replica_invalid"),
    ownerUserId: exactUuid(value.ownerUserId, "source_storage_writer_owner_invalid"),
    purpose: exactPurpose(value.purpose),
    tokenHash: writerTokenHash(value.token),
  });
}

function horizonMs(options = {}) {
  // Tests may ask for a longer fence, but production callers cannot shorten
  // the provider-bound minimum by passing an option.
  return Math.max(SOURCE_STORAGE_WRITE_HORIZON_MS,
    Math.min(24 * 60 * 60 * 1000, Number(options.horizonMs || SOURCE_STORAGE_WRITE_HORIZON_MS)));
}

export async function acquireContextSourceStorageWriter(db, input, options = {}) {
  const identity = newWriterIdentity(options);
  const rows = await db(
    `with writable as materialized (
       select s.source_id,s.replica_id,s.owner_user_id
         from vy_replica_source s
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
        where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
          and s.state='pending_upload' and s.provenance->>'purpose'='context_item'
          and r.lifecycle not in ('revoked','purging')
        for update of s,r
     ), inserted as (
       insert into vy_replica_source_storage_writer
         (writer_id,source_id,replica_id,owner_user_id,purpose,guard_id,guard_token_hash,
          token_hash,state,storage_write_not_after)
       select $4::uuid,source_id,replica_id,owner_user_id,'context_source',source_id,$5,$5,'active',
              now()+($6::bigint*interval '1 millisecond') from writable
       on conflict (writer_id) do nothing
       returning writer_id,source_id,replica_id,owner_user_id,purpose,storage_write_not_after
     ) select * from inserted`,
    [exactUuid(input?.sourceId, "source_storage_writer_source_invalid"),
      exactUuid(input?.replicaId, "source_storage_writer_replica_invalid"),
      exactUuid(input?.ownerUserId, "source_storage_writer_owner_invalid"),
      identity.writerId, writerTokenHash(identity.token), horizonMs(options)],
  );
  return authority(rows[0], identity);
}

export async function acquireProcessingSourceStorageWriter(db, input, options = {}) {
  const identity = newWriterIdentity(options);
  const rows = await db(
    `with writable as materialized (
       select s.source_id,s.replica_id,s.owner_user_id
         from vy_replica_processing_job j
         join vy_replica_source s on s.source_id=j.source_id and s.replica_id=j.replica_id
          and s.owner_user_id=j.owner_user_id
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
        where j.job_id=$1::uuid and j.source_id=$2::uuid and j.replica_id=$3::uuid
          and j.owner_user_id=$4::uuid and j.state='leased' and j.lease_token_hash=$5
          and j.lease_expires_at>now() and s.state in ('quarantined','processing')
          and r.lifecycle not in ('revoked','purging')
        for update of j,s,r
     ), inserted as (
       insert into vy_replica_source_storage_writer
         (writer_id,source_id,replica_id,owner_user_id,purpose,guard_id,guard_token_hash,
          token_hash,state,storage_write_not_after)
       select $6::uuid,source_id,replica_id,owner_user_id,'processing_artifact',$1::uuid,$5,$7,'active',
              now()+($8::bigint*interval '1 millisecond') from writable
       on conflict (writer_id) do nothing
       returning writer_id,source_id,replica_id,owner_user_id,purpose,storage_write_not_after
     ) select * from inserted`,
    [exactUuid(input?.jobId, "source_storage_writer_job_invalid"),
      exactUuid(input?.sourceId, "source_storage_writer_source_invalid"),
      exactUuid(input?.replicaId, "source_storage_writer_replica_invalid"),
      exactUuid(input?.ownerUserId, "source_storage_writer_owner_invalid"),
      String(input?.leaseTokenHash || ""), identity.writerId, writerTokenHash(identity.token), horizonMs(options)],
  );
  return authority(rows[0], identity);
}

export async function acquireVoicePreviewSourceStorageWriter(db, ownerUserId, started, options = {}) {
  const identity = newWriterIdentity(options);
  const rows = await db(
    `with writable as materialized (
       select s.source_id,s.replica_id,s.owner_user_id
         from vy_replica_voice_preview_intent i
         join vy_replica_processing_artifact a on a.artifact_id=i.preview_artifact_id
          and a.replica_id=i.replica_id and a.owner_user_id=i.owner_user_id
         join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
          and s.owner_user_id=a.owner_user_id
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
         join vy_replica_generation g on g.generation_id=i.generation_id and g.replica_id=i.replica_id
          and g.owner_user_id=i.owner_user_id
        where i.intent_id=$1::uuid and i.generation_id=$2::uuid and i.replica_id=$3::uuid
          and i.owner_user_id=$4::uuid and i.attempt=$5::int4 and i.state='synthesizing'
          and i.lease_token_hash=$6 and i.lease_expires_at>now()
          and s.source_id=$7::uuid and s.state='ready'
          and g.preview_intent_id=i.intent_id and g.preview_intent_attempt=i.attempt
          and g.state in ('streaming','sealed') and r.lifecycle not in ('revoked','purging')
        for update of i,s,r,g
     ), inserted as (
       insert into vy_replica_source_storage_writer
         (writer_id,source_id,replica_id,owner_user_id,purpose,guard_id,guard_token_hash,
          token_hash,state,storage_write_not_after)
       select $8::uuid,source_id,replica_id,owner_user_id,'voice_preview_result',$1::uuid,$6,$9,'active',
              now()+($10::bigint*interval '1 millisecond') from writable
       on conflict (writer_id) do nothing
       returning writer_id,source_id,replica_id,owner_user_id,purpose,storage_write_not_after
     ) select * from inserted`,
    [exactUuid(started?.intent?.intentId, "source_storage_writer_intent_invalid"),
      exactUuid(started?.generation?.generation_id, "source_storage_writer_generation_invalid"),
      exactUuid(started?.generation?.replica_id, "source_storage_writer_replica_invalid"),
      exactUuid(ownerUserId, "source_storage_writer_owner_invalid"), Number(started?.intent?.attempt),
      String(started?.intent?.leaseTokenHash || ""),
      exactUuid(started?.reference?.sourceId, "source_storage_writer_source_invalid"),
      identity.writerId, writerTokenHash(identity.token), horizonMs(options)],
  );
  return authority(rows[0], identity);
}

export async function renewSourceStorageWriter(db, value, options = {}) {
  const writer = exactAuthority(value);
  const rows = await db(
    `with writable as materialized (
       select s.source_id
         from vy_replica_source_storage_writer w
         join vy_replica_source s on s.source_id=w.source_id and s.replica_id=w.replica_id
          and s.owner_user_id=w.owner_user_id
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
        where w.writer_id=$1::uuid and w.source_id=$2::uuid and w.replica_id=$3::uuid
          and w.owner_user_id=$4::uuid and w.purpose=$5 and w.token_hash=$6 and w.state='active'
          and s.state<>'deleting' and r.lifecycle not in ('revoked','purging')
          and (
            (w.purpose='context_source' and s.state='pending_upload' and w.guard_id=s.source_id)
            or (w.purpose='processing_artifact' and s.state in ('quarantined','processing') and exists (
              select 1 from vy_replica_processing_job j
               where j.job_id=w.guard_id and j.source_id=w.source_id and j.replica_id=w.replica_id
                 and j.owner_user_id=w.owner_user_id and j.state='leased'
                 and j.lease_token_hash=w.guard_token_hash and j.lease_expires_at>now()
            ))
            or (w.purpose='voice_preview_result' and s.state='ready' and exists (
              select 1 from vy_replica_voice_preview_intent i
               where i.intent_id=w.guard_id and i.replica_id=w.replica_id
                 and i.owner_user_id=w.owner_user_id and i.state='synthesizing'
                 and i.lease_token_hash=w.guard_token_hash and i.lease_expires_at>now()
            ))
          )
        for update of w,s,r
     )
     update vy_replica_source_storage_writer w
        set storage_write_not_after=greatest(
              w.storage_write_not_after,
              now()+($7::bigint*interval '1 millisecond')
            ),updated_at=now()
       from writable x where w.writer_id=$1::uuid and w.source_id=x.source_id
     returning w.writer_id,w.source_id,w.replica_id,w.owner_user_id,w.purpose,w.storage_write_not_after`,
    [writer.writerId, writer.sourceId, writer.replicaId, writer.ownerUserId,
      writer.purpose, writer.tokenHash, horizonMs(options)],
  );
  if (!rows[0]) fail("source_storage_writer_renew_denied");
  return Object.freeze({ ...value, storageWriteNotAfter: rows[0].storage_write_not_after });
}

export async function releaseSourceStorageWriter(db, value) {
  const writer = exactAuthority(value);
  const rows = await db(
    `update vy_replica_source_storage_writer w
        set state='released',released_at=now(),updated_at=now()
      where w.writer_id=$1::uuid and w.source_id=$2::uuid and w.replica_id=$3::uuid
        and w.owner_user_id=$4::uuid and w.purpose=$5 and w.token_hash=$6 and w.state='active'
      returning w.writer_id`,
    [writer.writerId, writer.sourceId, writer.replicaId, writer.ownerUserId,
      writer.purpose, writer.tokenHash],
  );
  return rows.length === 1;
}
