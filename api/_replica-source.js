import { randomUUID } from "node:crypto";
import { replicaId } from "./_replica.js";
import { REPLICA_STORAGE_BUCKET } from "./_replica-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const SOURCE_POLICY = Object.freeze({
  audio: {
    maxBytes: 268_435_456,
    mimes: new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac", "audio/x-flac"]),
  },
  video: {
    maxBytes: 536_870_912,
    mimes: new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]),
  },
  image: {
    maxBytes: 26_214_400,
    mimes: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  },
  text: {
    maxBytes: 10_485_760,
    mimes: new Set(["text/plain", "application/json"]),
  },
  document: {
    maxBytes: 52_428_800,
    mimes: new Set([
      "application/pdf",
      "application/json",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  },
  chat_archive: {
    maxBytes: 104_857_600,
    mimes: new Set(["application/zip", "application/json", "text/plain", "application/octet-stream"]),
  },
});

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function sourceUploadInput(value) {
  const input = value && typeof value === "object" ? value : {};
  const kind = String(input.kind || "").trim();
  const policy = SOURCE_POLICY[kind];
  if (!policy) fail("unsupported source kind");
  const mime = String(input.mime || "").split(";", 1)[0].trim().toLowerCase();
  if (!policy.mimes.has(mime)) fail("unsupported source MIME type");
  const byteSize = Number(input.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > policy.maxBytes) {
    fail(`source byte_size must be between 1 and ${policy.maxBytes}`);
  }
  const sha256 = String(input.sha256 || "").trim().toLowerCase();
  if (!SHA256.test(sha256)) fail("lowercase SHA-256 is required");
  if (typeof input.contains_third_parties !== "boolean") fail("contains_third_parties declaration required");
  return { kind, mime, byteSize, sha256, containsThirdParties: input.contains_third_parties };
}

export function privateObjectPath(ownerUserId, replica, source) {
  const ids = [ownerUserId, replica, source].map((id) => String(id || "").trim());
  if (ids.some((id) => !UUID.test(id))) fail("private object path requires server UUIDs");
  return `${ids[0]}/${ids[1]}/${ids[2]}/original`;
}

export function clientSource(row) {
  return {
    source_id: row.source_id,
    replica_id: row.replica_id,
    kind: row.kind,
    capture_mode: row.capture_mode,
    mime: row.mime,
    byte_size: Number(row.byte_size),
    state: row.state,
    contains_third_parties: Boolean(row.contains_third_parties),
    rejection_code: row.rejection_code || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SOURCE_RETURNING = `source_id, replica_id, owner_user_id, kind, capture_mode, storage_bucket,
  object_path, mime, byte_size, sha256, state, contains_third_parties,
  rejection_code, created_at, updated_at`;

export async function createPendingSource(db, ownerUserId, id, value, options = {}) {
  const rid = replicaId(id);
  const input = sourceUploadInput(value);
  const sourceId = options.sourceId || randomUUID();
  if (!UUID.test(sourceId)) fail("source id generator returned an invalid UUID", 500);
  const path = privateObjectPath(ownerUserId, rid, sourceId);
  const provenance = JSON.stringify({
    declaration: "client_sha256",
    sha256_status: "pending_server_verification",
    filename_retained: false,
  });
  const rows = await db(
    `with owned as (
       select replica_id, policy_version from vy_replica
        where replica_id = $1 and owner_user_id = $2 and subject_mode = 'self'
          and lifecycle not in ('revoked','purging')
     ), capture as (
       select c.consent_id from vy_replica_consent c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2 and c.scope = 'capture'
          and c.policy_version = o.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now())
        order by c.granted_at desc limit 1
     ), storage_ok as (
       select 1 from vy_replica_consent c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2 and c.scope = 'storage'
          and c.policy_version = o.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now()) limit 1
     ), inserted as (
       insert into vy_replica_source
         (source_id, replica_id, owner_user_id, consent_id, kind, capture_mode,
          storage_bucket, object_path, mime, byte_size, sha256,
          contains_third_parties, provenance)
       select $3, owned.replica_id, $2, capture.consent_id, $4, 'upload',
              $5, $6, $7, $8, $9, $10, $11::jsonb
         from owned cross join capture cross join storage_ok
       returning ${SOURCE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'source.create_upload', 'source', source_id::text,
              (select policy_version from owned), 'allowed',
              jsonb_build_object('kind', kind, 'byte_size', byte_size,
                                 'contains_third_parties', contains_third_parties)
         from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, sourceId, input.kind, REPLICA_STORAGE_BUCKET, path, input.mime,
      input.byteSize, input.sha256, input.containsThirdParties, provenance],
  );
  return rows[0] || null;
}

export async function getPendingSource(db, ownerUserId, id, source) {
  const sid = replicaId(source);
  const rows = await db(
    `select ${SOURCE_RETURNING} from vy_replica_source s
      where s.replica_id = $1 and s.owner_user_id = $2 and s.source_id = $3
        and s.state = 'pending_upload'
        and exists (
          select 1 from vy_replica r where r.replica_id = s.replica_id
            and r.owner_user_id = s.owner_user_id and r.lifecycle not in ('revoked','purging')
            and not exists (
              select 1 from unnest(array['capture','storage']::text[]) required(scope)
               where not exists (
                 select 1 from vy_replica_consent c
                  where c.replica_id = r.replica_id and c.owner_user_id = r.owner_user_id
                    and c.scope = required.scope and c.policy_version = r.policy_version
                    and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
               )
            )
        ) limit 1`,
    [replicaId(id), ownerUserId, sid],
  );
  return rows[0] || null;
}

export async function listOwnedSources(db, ownerUserId, id) {
  const rows = await db(
    `select ${SOURCE_RETURNING} from vy_replica_source
      where replica_id = $1 and owner_user_id = $2
      order by created_at desc limit 200`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientSource);
}

export function verifyStoredObject(source, objectInfo) {
  if (Number(source.byte_size) !== objectInfo.byteSize) return { ok: false, code: "byte_size_mismatch" };
  const expected = String(source.mime).split(";", 1)[0].trim().toLowerCase();
  if (expected !== objectInfo.mime) return { ok: false, code: "mime_mismatch" };
  return { ok: true, code: "" };
}

export async function finalizeOwnedSource(db, ownerUserId, id, source, objectInfo) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const pending = await getPendingSource(db, ownerUserId, rid, sid);
  if (!pending) return null;
  const verdict = verifyStoredObject(pending, objectInfo);
  const state = verdict.ok ? "quarantined" : "rejected";
  const facts = JSON.stringify({
    storage_metadata_verified: verdict.ok,
    sha256_status: "pending_server_verification",
  });
  const rows = await db(
    `with updated as (
       update vy_replica_source
          set state = $4, rejection_code = $5, updated_at = now(),
              provenance = provenance || $6::jsonb
        where replica_id = $1 and owner_user_id = $2 and source_id = $3
          and state = 'pending_upload'
       returning ${SOURCE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'source.finalize', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1 and owner_user_id = $2),
              case when $4 = 'quarantined' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code', $5)
         from updated
     ), queued as (
       insert into vy_replica_processing_job
         (replica_id, owner_user_id, source_id, step, state)
       select replica_id, owner_user_id, source_id, 'integrity', 'queued'
         from updated where state = 'quarantined'
       on conflict (source_id, step, revision) do nothing
     )
     select * from updated`,
    [rid, ownerUserId, sid, state, verdict.code, facts],
  );
  return rows[0] || null;
}

export async function markOwnedSourceDeleting(db, ownerUserId, id, source) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const rows = await db(
    `with target as (
       update vy_replica_source set state = 'deleting', updated_at = now()
        where replica_id = $1 and owner_user_id = $2 and source_id = $3
        returning ${SOURCE_RETURNING}
     ), invalidated as (
       update vy_replica_claim set status = 'superseded', updated_at = now()
        where replica_id = $1 and $3 = any(source_ids)
          and status in ('proposed','approved') and exists (select 1 from target)
     ), genomes as (
       update vy_replica_voice_genome set status = 'retired'
        where replica_id = $1 and status <> 'retired' and exists (select 1 from target)
     ), profiles as (
       update vy_replica_profile set status = 'retired'
        where replica_id = $1 and status <> 'retired' and exists (select 1 from target)
     ), voices as (
       update vy_replica_voice_profile set status = 'deleting', updated_at = now()
        where replica_id = $1 and status <> 'deleting' and exists (select 1 from target)
     ), replica as (
       update vy_replica set lifecycle = 'enrolling', updated_at = now()
        where replica_id = $1 and owner_user_id = $2
          and lifecycle not in ('revoked','purging') and exists (select 1 from target)
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'source.delete.request', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1 and owner_user_id = $2),
              'allowed', jsonb_build_object('derived_models_invalidated', true)
         from target
     )
     select * from target`,
    [rid, ownerUserId, sid],
  );
  return rows[0] || null;
}

export async function completeOwnedSourceDeletion(db, ownerUserId, id, source) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const rows = await db(
    `with removed as (
       delete from vy_replica_source
        where replica_id = $1 and owner_user_id = $2 and source_id = $3 and state = 'deleting'
       returning source_id
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'source.delete.complete', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1 and owner_user_id = $2),
              'allowed', '{}'::jsonb from removed
     )
     select source_id from removed`,
    [rid, ownerUserId, sid],
  );
  return Boolean(rows[0]);
}
