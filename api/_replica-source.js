import { randomUUID } from "node:crypto";
import { replicaId } from "./_replica.js";
import { REPLICA_STORAGE_WRITE_BUCKET } from "./_replica-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

const SOURCE_POLICY = Object.freeze({
  audio: {
    maxBytes: 1_073_741_824,
    mimes: new Set([
      "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
      "audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3", "audio/x-mp3",
      "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac",
      "audio/aiff", "audio/x-aiff", "audio/ogg", "audio/opus",
      "audio/flac", "audio/x-flac", "audio/webm", "audio/amr", "audio/x-ms-wma",
    ]),
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
  const purpose = String(input.purpose || "memory").trim();
  if (!new Set(["memory", "identity_document", "identity_challenge"]).has(purpose)) fail("unsupported source purpose");
  if (purpose === "identity_document") {
    const accepted = (kind === "image" && new Set(["image/jpeg", "image/png"]).has(mime)) ||
      (kind === "document" && mime === "application/pdf");
    if (!accepted) fail("identity document must be JPEG PNG or PDF");
    if (input.contains_third_parties) fail("identity document must contain only the verified subject");
  }
  // WS-R2 (migration 072). A spoken identity challenge is audio or video of
  // exactly one person reading a server-issued sentence. It is VERIFICATION
  // evidence and never enrollment material: `finalizeOwnedSource` below only
  // enqueues the eight-step DAG for capture_mode='upload', so this mode
  // cannot reach a voice genome, and `completeVoiceChallenge` queues the
  // bytes for deletion the moment a decision exists.
  if (purpose === "identity_challenge") {
    if (kind !== "audio" && kind !== "video") fail("identity challenge must be audio or video");
    if (input.contains_third_parties) fail("identity challenge must contain only the verified subject");
  }
  const captureMode = purpose === "identity_document" ? "identity_document"
    : purpose === "identity_challenge" ? "identity_challenge"
      : "upload";
  return {
    kind,
    mime,
    byteSize,
    sha256,
    containsThirdParties: input.contains_third_parties,
    captureMode,
  };
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
        where replica_id = $1::uuid and owner_user_id = $2::uuid and subject_mode = 'self'
          and lifecycle not in ('revoked','purging')
     ), capture as (
       select c.consent_id from vy_replica_consent c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2::uuid and c.scope = 'capture'
          and c.policy_version = o.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now())
        order by c.granted_at desc limit 1
     ), storage_ok as (
       select 1 from vy_replica_consent c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2::uuid and c.scope = 'storage'
          and c.policy_version = o.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now()) limit 1
     ), pending_lock as materialized (
       select pg_advisory_xact_lock(hashtextextended($2::text||':replica_pending_upload',0)) acquired
     ), pending_budget as (
       select 1 from owned cross join pending_lock
        where (select count(*) from vy_replica_source s
                where s.owner_user_id=$2::uuid and s.state='pending_upload')<8
     ), inserted as (
       insert into vy_replica_source
         (source_id, replica_id, owner_user_id, consent_id, kind, capture_mode,
          storage_bucket, object_path, mime, byte_size, sha256,
          contains_third_parties, provenance)
       select $3::uuid, owned.replica_id, $2::uuid, capture.consent_id, $4, $12,
              $5, $6, $7, $8::int8, $9, $10::bool, $11::jsonb
         from owned cross join capture cross join storage_ok cross join pending_budget
       returning ${SOURCE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'source.create_upload', 'source', source_id::text,
              (select policy_version from owned), 'allowed',
              jsonb_build_object('kind', kind, 'byte_size', byte_size,
                                 'contains_third_parties', contains_third_parties,
                                 'capture_mode', capture_mode)
         from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, sourceId, input.kind, REPLICA_STORAGE_WRITE_BUCKET, path, input.mime,
      input.byteSize, input.sha256, input.containsThirdParties, provenance, input.captureMode],
  );
  return rows[0] || null;
}

export async function getPendingSource(db, ownerUserId, id, source) {
  const sid = replicaId(source);
  const rows = await db(
    `select ${SOURCE_RETURNING} from vy_replica_source s
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid and s.source_id = $3::uuid
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

export async function getOwnedSource(db, ownerUserId, id, source) {
  const rows = await db(
    `select ${SOURCE_RETURNING} from vy_replica_source
      where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
      limit 1`,
    [replicaId(id), ownerUserId, replicaId(source)],
  );
  return rows[0] || null;
}

export async function listOwnedSources(db, ownerUserId, id) {
  const rows = await db(
    `select ${SOURCE_RETURNING} from vy_replica_source
      where replica_id = $1::uuid and owner_user_id = $2::uuid
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
    storage_object_id: verdict.ok ? String(objectInfo.objectId || "").slice(0, 256) : "",
    sha256_status: "pending_server_verification",
  });
  const rows = await db(
    `with updated as (
       update vy_replica_source
          set state = $4, rejection_code = $5, updated_at = now(),
              provenance = provenance || $6::jsonb
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
          and state = 'pending_upload'
       returning ${SOURCE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'source.finalize', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid),
              case when $4 = 'quarantined' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code', $5)
         from updated
     ), queued as (
       insert into vy_replica_processing_job
         (replica_id, owner_user_id, source_id, step, state)
       select replica_id, owner_user_id, source_id, 'integrity', 'queued'
         from updated where state = 'quarantined' and capture_mode = 'upload'
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
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
        returning ${SOURCE_RETURNING}
     ), invalidated as (
       update vy_replica_claim set status = 'superseded', updated_at = now()
        where replica_id = $1::uuid and $3 = any(source_ids)
          and status in ('proposed','approved') and exists (select 1 from target)
     ), liveness_challenges as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='liveness_evidence_deleted',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.replica_id=$1 and ch.owner_user_id=$2 and ch.source_id=$3
          and exists (select 1 from target)
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.verification_attempt
     ), liveness_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='liveness_evidence_deleted',finished_at=now()
        from liveness_challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), liveness_replica as (
       update vy_replica r set identity_verified_at=null,liveness_verified_at=null,identity_expires_at=null,updated_at=now()
        where r.replica_id=$1 and r.owner_user_id=$2 and exists (select 1 from liveness_challenges)
     ), liveness_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='biometric' and c.revoked_at is null
          and exists (select 1 from liveness_challenges)
     ),
     -- WS-R2. A voice identity challenge whose evidence is being deleted
     -- while it is STILL IN FLIGHT can never be settled, so it fails now with
     -- a reason rather than being leased later and failing for a missing
     -- object. Its running attempt is closed with the same code.
     --
     -- Deliberately NOT paired with an identity revocation, unlike the
     -- liveness block above. completeVoiceChallenge queues this exact source
     -- for deletion on EVERY decision including an accept, because a
     -- verification recording that outlives its verdict is a person's face
     -- and voice kept for no purpose. Revoking identity here would therefore
     -- undo every successful challenge microseconds after it succeeded. The
     -- decision is the durable artifact; the recording is not, and that
     -- asymmetry is the whole point of deleting it.
     voice_challenges as (
       update vy_replica_voice_challenge ch set state='expired',
              failure_code='challenge_evidence_deleted',
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
          and $3::uuid in (ch.captured_source_id,ch.transcript_source_id)
          and ch.state in ('issued','captured','verifying')
          and exists (select 1 from target)
       returning ch.challenge_id,ch.verification_attempt
     ), voice_challenge_attempts as (
       update vy_replica_voice_challenge_attempt a set outcome='failed',
              failure_code='challenge_evidence_deleted',finished_at=now()
        from voice_challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), identity_cases as (
       update vy_replica_identity_case c set state='revoked',revoked_at=coalesce(revoked_at,now()),
              lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.source_id=$3 and c.state<>'revoked'
          and exists (select 1 from target)
       returning c.identity_case_id,c.replica_id,c.owner_user_id,c.source_id
     ), identity_challenges as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='identity_evidence_deleted',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        where ch.identity_case_id in (select identity_case_id from identity_cases)
          and ch.state in ('issued','uploaded','verifying')
       returning ch.challenge_id,ch.replica_id,ch.owner_user_id,ch.source_id,ch.verification_attempt
     ), identity_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='identity_evidence_deleted',finished_at=now()
        from identity_challenges ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), challenge_sources as (
       update vy_replica_source s set state='deleting',updated_at=now()
        from identity_challenges ch where ch.source_id is not null and s.source_id=ch.source_id
          and s.replica_id=ch.replica_id and s.owner_user_id=ch.owner_user_id
          and s.state in ('pending_upload','quarantined','rejected')
     ), biometric_verification_grants as (
       update vy_replica_biometric_verification_grant g set state='revoked',revoked_at=now()
        where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state='active'
          and (exists (select 1 from liveness_challenges ch where ch.challenge_id=g.challenge_id)
            or exists (select 1 from identity_challenges ch where ch.challenge_id=g.challenge_id))
     ), identity_replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,updated_at=now() where r.replica_id=$1 and r.owner_user_id=$2
          and exists (select 1 from identity_cases)
       returning r.subject_person_id
     ), identity_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='biometric' and c.revoked_at is null
          and exists (select 1 from identity_cases)
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), genomes as (
       update vy_replica_voice_genome set status = 'retired'
        where replica_id = $1::uuid and status <> 'retired' and exists (select 1 from target)
     ), profiles as (
       update vy_replica_profile set status = 'retired'
        where replica_id = $1::uuid and status <> 'retired' and exists (select 1 from target)
     ), voices as (
       update vy_replica_voice_profile set status = 'deleting', updated_at = now()
        where replica_id = $1::uuid and status <> 'deleting' and exists (select 1 from target)
     ), runtime_capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.state in ('active','paused')
          and exists (select 1 from target)
     ), runtime_sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.state='active'
          and exists (select 1 from target)
     ), open_generations as (
       update vy_replica_generation g set state='aborted',failure_code='source_erased',updated_at=now()
        where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state in ('authorized','streaming')
          and exists (select 1 from target)
     ), provider_consents as (
       update vy_replica_provider_consent set state = 'revoked',
              revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
          and state <> 'revoked' and exists (select 1 from target)
     ), replica as (
       update vy_replica set lifecycle = 'enrolling', updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid
          and lifecycle not in ('revoked','purging') and exists (select 1 from target)
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'source.delete.request', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid),
              'allowed', jsonb_build_object('derived_models_invalidated', true)
         from target
     )
     select * from target`,
    [rid, ownerUserId, sid],
  );
  return rows[0] || null;
}
