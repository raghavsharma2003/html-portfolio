import { randomUUID } from "node:crypto";
import { clientIntentId, replicaId } from "./_replica.js";
import { REPLICA_STORAGE_WRITE_BUCKET } from "./_replica-storage.js";
import { primarySelectionQuery } from "./_replica-primary-selection.js";
import {comparisonAuthoritySql} from './_replica-processing/comparison.js';

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

export function sourceUploadInput(value, options = {}) {
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
  if (!new Set(["memory", "identity_document", "mirror_window", "context_item", "identity_challenge", "correction", "interview",...(options.comparisonPreparation===true?['comparison_reference']:[])]).has(purpose)) fail("unsupported source purpose");
  if(purpose==='comparison_reference'&&(!['audio','video'].includes(kind)||input.contains_third_parties||byteSize>33554432||!input.upload_intent_id))fail('comparison_source_ineligible');
  const uploadIntentId = input.upload_intent_id == null || input.upload_intent_id === ""
    ? null
    : clientIntentId(input.upload_intent_id, "valid_upload_intent_id_required");
  const languageHint = input.language_hint == null || input.language_hint === ""
    ? null
    : String(input.language_hint).trim().toLowerCase();
  if (languageHint && !new Set(["en", "hi", "hi-latn"]).has(languageHint)) {
    fail("source_language_hint_invalid");
  }
  if (uploadIntentId && purpose === "memory" && new Set(["audio", "video"]).has(kind) && !languageHint) {
    fail("source_language_hint_required");
  }
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
      : purpose === "mirror_window" ? "derived" : "upload";
  // WS-R4. A correction is the owner's better answer to a review card. It is
  // typed or dictated, so it is text or audio and nothing else, and it names
  // only the owner — a correction that declares third parties would put someone
  // else's words into the material this AI answers from.
  if (purpose === "correction") {
    if (!new Set(["text", "audio"]).has(kind)) fail("a correction must be text or audio");
    if (input.contains_third_parties) fail("a correction must contain only the owner");
  }
  let mirrorSessionId = null;
  let mirrorSeq = null;
  if (purpose === "mirror_window") {
    mirrorSessionId = String(input.mirror_session_id || "").trim();
    mirrorSeq = Number(input.mirror_seq);
    if (!UUID.test(mirrorSessionId)) fail("mirror session id required");
    if (!Number.isSafeInteger(mirrorSeq) || mirrorSeq < 1) fail("mirror window sequence required");
    if (kind !== "audio" || mime !== "audio/wav") fail("mirror window must be WAV audio");
    if (input.contains_third_parties) fail("mirror window must contain only the owner");
  }
  return {
    kind,
    mime,
    byteSize,
    sha256,
    containsThirdParties: input.contains_third_parties,
    captureMode,
    purpose,
    uploadIntentId,
    languageHint,
    mirrorSessionId,
    mirrorSeq,
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
    // WS-R4. Named on the wire so a studio can tell a lecture from a correction
    // without inferring it from the mime type.
    purpose: row.purpose || "memory",
    mime: row.mime,
    byte_size: Number(row.byte_size),
    state: row.state,
    contains_third_parties: Boolean(row.contains_third_parties),
    voice_role: row.voice_role === "primary" ? "primary" : "supporting",
    upload_intent_id: row.upload_intent_id || null,
    language_hint: row.language_hint || null,
    rejection_code: row.rejection_code || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SOURCE_RETURNING = `source_id, replica_id, owner_user_id, kind, capture_mode, purpose, storage_bucket,
  object_path, mime, byte_size, sha256, state, contains_third_parties, upload_intent_id,
  language_hint, provenance, rejection_code, upload_authorization_expires_at, created_at, updated_at`;
const SOURCE_SELECT = `s.source_id, s.replica_id, s.owner_user_id, s.kind, s.capture_mode, s.purpose, s.storage_bucket,
  s.object_path, s.mime, s.byte_size, s.sha256, s.state, s.contains_third_parties, s.upload_intent_id,
  s.language_hint, s.provenance, s.rejection_code, s.upload_authorization_expires_at, s.created_at, s.updated_at`;

// Reserve the entire lifetime of a direct-to-provider upload grant before the
// grant is minted. If capability construction or the HTTP response is lost,
// erasure still has a durable not-after fence and waits safely. The grant is
// usable for two hours; a separate ninety-minute quiescence interval covers
// the shipped 8 MiB Azure block's official 80-minute service ceiling plus a
// ten-minute acknowledgement margin. This is the legitimate shipped-write
// contract, not revocation of a capability deliberately copied out of the
// client: using such a capability later is a new owner-side resubmission and
// is outside the deletion receipt's provider-revocation claim.
export async function reserveOwnedSourceUploadAuthorization(db, ownerUserId, id, source, options = {}) {
  const horizonMs = Math.max(60_000, Math.min(220 * 60 * 1000,
    Number(options.horizonMs || 210 * 60 * 1000)));
  const rows = await db(
    `update vy_replica_source s
        set upload_authorization_expires_at=greatest(
              coalesce(s.upload_authorization_expires_at,'-infinity'::timestamptz),
              now()+($4::bigint*interval '1 millisecond')
            ),updated_at=now()
      where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id=$3::uuid
        and s.state='pending_upload'
      returning ${SOURCE_RETURNING}`,
    [replicaId(id), ownerUserId, replicaId(source), horizonMs],
  );
  return rows[0] || null;
}

export function assertUploadWithinSourceFence(source, upload) {
  const fence = Date.parse(String(source?.upload_authorization_expires_at || ""));
  const issued = Date.parse(String(upload?.expires_at || ""));
  if (!Number.isFinite(fence) || !Number.isFinite(issued) || issued > fence) {
    throw Object.assign(new Error("signed_upload_exceeds_source_fence"), {
      code: "signed_upload_exceeds_source_fence",
      status: 503,
    });
  }
  return upload;
}

export async function createPendingSource(db, ownerUserId, id, value, options = {}) {
  const rid = replicaId(id);
  const input = sourceUploadInput(value, options);
  const sourceId = options.sourceId || randomUUID();
  if (!UUID.test(sourceId)) fail("source id generator returned an invalid UUID", 500);
  const path = privateObjectPath(ownerUserId, rid, sourceId);
  const provenance = JSON.stringify({
    declaration: "client_sha256",
    sha256_status: "pending_server_verification",
    filename_retained: false,
    purpose: input.purpose,
    ...(input.mirrorSessionId ? {
      mirror_session_id: input.mirrorSessionId,
      mirror_seq: input.mirrorSeq,
    } : {}),
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
     ), mirror_binding as (
       select 1 from owned where $12 <> 'derived'
       union all
       select 1 from vy_mirror_session ms join owned o on o.replica_id=ms.replica_id
        where $12 = 'derived' and ms.session_id=$13::uuid and ms.owner_user_id=$2::uuid
          and ms.state='open' and $14::int > 0
     ), inserted as (
       insert into vy_replica_source
         (source_id, replica_id, owner_user_id, consent_id, kind, capture_mode,
          storage_bucket, object_path, mime, byte_size, sha256,
           contains_third_parties, provenance, upload_intent_id, language_hint,
           purpose, upload_authorization_expires_at)
       select $3::uuid, owned.replica_id, $2::uuid, capture.consent_id, $4, $12,
              $5, $6, $7, $8::int8, $9, $10::bool, $11::jsonb, $16::uuid, $17, $15::text, null
         from owned cross join capture cross join storage_ok cross join pending_budget cross join mirror_binding
       on conflict (owner_user_id, replica_id, upload_intent_id)
         where upload_intent_id is not null do nothing
       returning ${SOURCE_RETURNING},false intent_replayed
      ), replay as (
        select ${SOURCE_SELECT},true intent_replayed
          from vy_replica_source s cross join owned cross join capture cross join storage_ok cross join mirror_binding
         where $16::uuid is not null and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
           and s.upload_intent_id=$16::uuid and not exists (select 1 from inserted)
         limit 1
      ), recovered as (
        -- A finalized source is an observation of the already-committed
        -- action, not a new capture or storage grant. This branch never
        -- returns pending_upload, so it can never mint a new upload
        -- capability after either consent has expired.
        select ${SOURCE_SELECT},true intent_replayed
          from vy_replica_source s cross join owned
         where $16::uuid is not null and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
           and s.upload_intent_id=$16::uuid and s.state<>'pending_upload'
           and not exists (select 1 from inserted) and not exists (select 1 from replay)
         limit 1
      ), resolved as (
        select * from inserted
        union all
        select * from replay
        union all
        select * from recovered
      ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'source.create_upload', 'source', source_id::text,
              (select policy_version from owned), 'allowed',
              jsonb_build_object('kind', kind, 'byte_size', byte_size,
                                 'contains_third_parties', contains_third_parties,
                                 'capture_mode', capture_mode, 'purpose', $15::text)
         from inserted
     )
     select * from resolved`,
    [rid, ownerUserId, sourceId, input.kind, REPLICA_STORAGE_WRITE_BUCKET, path, input.mime,
      input.byteSize, input.sha256, input.containsThirdParties, provenance, input.captureMode,
      input.mirrorSessionId, input.mirrorSeq, input.purpose, input.uploadIntentId, input.languageHint],
  );
  const row = rows[0] || null;
  if (row?.intent_replayed) {
    const exact = row.kind === input.kind && row.capture_mode === input.captureMode && row.mime === input.mime
      && Number(row.byte_size) === input.byteSize && row.sha256 === input.sha256
      && Boolean(row.contains_third_parties) === input.containsThirdParties
      && (row.provenance?.purpose || "memory") === input.purpose
      && (row.language_hint || null) === input.languageHint;
    if (!exact) fail("upload_intent_conflict", 409);
  }
  return row;
}

export async function getPendingSource(db, ownerUserId, id, source) {
  const sid = replicaId(source);
  const rows = await db(
    `select ${SOURCE_SELECT},
            case when vr.source_id is not null then 'primary' else 'supporting' end voice_role
       from vy_replica_source s
       left join vy_replica_voice_reference vr on vr.source_id=s.source_id
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
    `select ${SOURCE_SELECT},
            case when vr.source_id is not null then 'primary' else 'supporting' end voice_role
       from vy_replica_source s
       left join vy_replica_voice_reference vr on vr.source_id=s.source_id
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid and s.source_id = $3::uuid
      limit 1`,
    [replicaId(id), ownerUserId, replicaId(source)],
  );
  return rows[0] || null;
}

export async function getOwnedSourceByUploadIntent(db, ownerUserId, id, uploadIntent) {
  const rows = await db(
    `select ${SOURCE_SELECT},
            case when vr.source_id is not null then 'primary' else 'supporting' end voice_role
       from vy_replica_source s
       left join vy_replica_voice_reference vr on vr.source_id=s.source_id
      where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.upload_intent_id=$3::uuid
      limit 1`,
    [replicaId(id), ownerUserId, clientIntentId(uploadIntent, "valid_upload_intent_id_required")],
  );
  return rows[0] || null;
}

export async function listOwnedSources(db, ownerUserId, id) {
  const rows = await db(
    `select ${SOURCE_SELECT},
            case when vr.source_id is not null then 'primary' else 'supporting' end voice_role
       from vy_replica_source s
       left join vy_replica_voice_reference vr on vr.source_id=s.source_id
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid
        and not (s.capture_mode = 'derived' and s.provenance->>'purpose' = 'mirror_window')
        and not (s.provenance->>'purpose' = 'context_item')
        and s.purpose<>'comparison_reference'
      order by s.created_at desc limit 200`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientSource);
}

export const OWNED_SOURCES_OVERVIEW_SQL = `select s.source_id,s.kind,s.capture_mode,s.purpose,s.duration_ms,s.state,s.contains_third_parties,
       s.rejection_code,s.created_at,s.provenance,
       ci.item_id,ci.kind item_kind,ci.source_name,ci.source_url,ci.status item_state,
       ci.refusal_reason,ci.routed_to,ci.mine_skip_reason,
       coalesce(yielded.claims_approved,0)::integer claims_approved,
       coalesce(yielded.claims_proposed,0)::integer claims_proposed
  from vy_replica_source s
  left join vy_context_item ci
    on ci.source_id=s.source_id and ci.replica_id=s.replica_id and ci.owner_user_id=s.owner_user_id
  left join lateral (
    select count(*) filter (where c.status='approved') claims_approved,
           count(*) filter (where c.status='proposed') claims_proposed
      from vy_replica_claim c
     where c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
       and s.source_id=any(c.source_ids)
  ) yielded on true
 where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.state<>'deleting'
   and (
     s.purpose in ('memory','context_item','interview','mirror_window')
     or (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
   )
 order by s.created_at desc,s.source_id desc limit 200`;

function overviewKind(row) {
  if (row.purpose === "context_item" && row.item_kind === "link") return "link";
  if (row.purpose === "context_item") return "file";
  if (row.capture_mode === "derived" || row.purpose === "interview" || row.purpose === "mirror_window" ||
      row.provenance?.purpose === "mirror_window") return "call";
  return row.kind === "audio" || row.kind === "video" ? "recording" : "file";
}

export function clientSourceOverview(row) {
  const kind = overviewKind(row);
  const contextItem = row.purpose === "context_item" && row.item_id;
  const state = String(contextItem ? row.item_state : row.state || "");
  const stateDetailCode = contextItem
    ? row.refusal_reason || row.routed_to || row.mine_skip_reason || ""
    : row.rejection_code || "";
  const displayName = contextItem
    ? String(row.source_name || row.source_url || "").slice(0, 200)
    : "";
  return Object.freeze({
    source_id: row.source_id,
    context_item_id: contextItem ? row.item_id : null,
    kind,
    display_name: displayName,
    state,
    state_detail_code: String(stateDetailCode).slice(0, 120),
    contains_third_parties: Boolean(row.contains_third_parties),
    created_at: row.created_at,
    yield: Object.freeze({
      claims_approved: Number(row.claims_approved || 0),
      claims_proposed: Number(row.claims_proposed || 0),
      voice_seconds: kind === "recording" || kind === "call"
        ? Math.max(0, Math.round(Number(row.duration_ms || 0) / 1000))
        : 0,
    }),
  });
}

export async function listOwnedSourcesOverview(db, ownerUserId, id) {
  const rows = await db(OWNED_SOURCES_OVERVIEW_SQL, [replicaId(id), ownerUserId]);
  return rows.map(clientSourceOverview);
}

export async function setOwnedPrimaryVoiceSource(db, ownerUserId, id, source) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const rows = await primarySelectionQuery(db,
    `with target as materialized (
       select s.* from vy_replica_source s
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id=$3::uuid
          and s.kind in ('audio','video') and s.capture_mode in ('upload','import','derived')
          and s.purpose<>'comparison_reference'
          and s.state in ('quarantined','processing','ready') and s.contains_third_parties=false
          and not (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
        limit 1
        for update of s nowait
     ), owned as materialized (
       select r.replica_id from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and exists (select 1 from target)
        for update of r nowait
     ), epoch as (
       update vy_replica r set primary_selection_id=gen_random_uuid()
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and exists (select 1 from owned)
       returning r.replica_id
     ), selected as (
       insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id,selected_at)
       select replica_id,owner_user_id,source_id,now() from target
        where exists (select 1 from epoch)
       on conflict (replica_id) do update
         set owner_user_id=excluded.owner_user_id,source_id=excluded.source_id,selected_at=excluded.selected_at
       returning source_id
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'source.primary_voice.select','source',t.source_id::text,
              (select policy_version from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid),
              'allowed',jsonb_build_object('voice_role','primary')
         from target t join selected x on x.source_id=t.source_id
     )
     select ${SOURCE_RETURNING},'primary'::text voice_role from target`,
    [rid, ownerUserId, sid],
  );
  return rows[0] || null;
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
       update vy_replica_source s
          set state = $4, rejection_code = $5, updated_at = now(),
              provenance = provenance || $6::jsonb
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
          and state = 'pending_upload'
          and (s.purpose<>'comparison_reference' or ${comparisonAuthoritySql('s')})
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
         (replica_id, owner_user_id, source_id, step, state, comparison_preparation_id)
       select replica_id, owner_user_id, source_id, 'integrity', 'queued',
         case when purpose='comparison_reference' then (select cp.preparation_id from vy_replica_comparison_preparation cp
          where cp.source_id=updated.source_id and cp.replica_id=updated.replica_id and cp.owner_user_id=updated.owner_user_id) else null end
         from updated where state = 'quarantined' and capture_mode = 'upload'
       on conflict (source_id, step, revision) do nothing
     )
     select * from updated`,
    [rid, ownerUserId, sid, state, verdict.code, facts],
  );
  return rows[0] || null;
}

/** Finalize a server-written Context Locker source without putting a PDF or
 * image into the audio/video processing DAG. `writeImmutableReplicaSource`
 * already re-read and hashed the private object; this transaction rechecks the
 * live source permissions and binds that measured digest before setting ready. */
export async function finalizeOwnedContextSource(db, ownerUserId, id, source, objectInfo) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const pending = await getPendingSource(db, ownerUserId, rid, sid);
  // SOURCE_SELECT intentionally omits provenance. The SQL predicate below is
  // the authority for purpose; this check only handles a missing owned row.
  if (!pending) return null;
  const digest = String(objectInfo?.sha256 || "").toLowerCase();
  const verdict = verifyStoredObject(pending, objectInfo);
  const ok = verdict.ok && SHA256.test(digest) && digest === pending.sha256;
  const code = ok ? "" : (verdict.code || "sha256_mismatch");
  const rows = await db(
    `with owned as (
       select r.replica_id,r.policy_version from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and not exists (
            select 1 from unnest(array['capture','storage']::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c
                where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
                  and c.scope=required.scope and c.policy_version=r.policy_version
                  and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
             )
          )
     ), updated as (
       update vy_replica_source s
          set state=$4,rejection_code=$5,
              provenance=provenance||jsonb_build_object(
                'sha256_status',case when $4='ready' then 'server_verified' else 'verification_failed' end,
                'storage_object_id',$6::text
              ),updated_at=now()
         from owned o
        where s.source_id=$3::uuid and s.replica_id=o.replica_id and s.owner_user_id=$2::uuid
          and s.state='pending_upload' and s.provenance->>'purpose'='context_item'
          and s.sha256=$7
       returning ${SOURCE_SELECT}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'context_source.finalize','source',source_id::text,
              (select policy_version from owned),case when state='ready' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code',$5,'sha256_verified',state='ready') from updated
     ) select * from updated`,
    [rid, ownerUserId, sid, ok ? "ready" : "rejected", code,
      String(objectInfo?.objectId || "").slice(0, 256), digest],
  );
  return rows[0] || null;
}

/** Remove a context source only before any provider authority has existed.
 * Once storage has been authorized, callers must mark deleting and let the
 * standard authority-aware prefix eraser retain the manifest until absence is
 * proven. */
export async function discardUnboundContextSource(db, ownerUserId, id, source) {
  const rows = await db(
    `delete from vy_replica_source s
      where s.source_id=$3::uuid and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
        and s.provenance->>'purpose'='context_item'
        and s.state='pending_upload' and s.upload_authorization_expires_at is null
        and not exists (
          select 1 from vy_replica_source_storage_writer sw
           where sw.source_id=s.source_id and sw.replica_id=s.replica_id
             and sw.owner_user_id=s.owner_user_id
        )
        and not exists (select 1 from vy_context_item i where i.source_id=s.source_id)
        and not exists (select 1 from vy_replica_processing_evidence e where e.source_id=s.source_id)
        and not exists (select 1 from vy_replica_claim c where s.source_id=any(c.source_ids))
      returning s.source_id`,
    [replicaId(id), ownerUserId, replicaId(source)],
  );
  return Boolean(rows[0]);
}

export async function markOwnedSourceDeleting(db, ownerUserId, id, source) {
  const rid = replicaId(id);
  const sid = replicaId(source);
  const rows = await primarySelectionQuery(db,
    `with selection_snapshot as materialized (
       select primary_selection_id from vy_replica
        where replica_id=$1::uuid and owner_user_id=$2::uuid
     ), source_lock as materialized (
       select s.source_id from vy_replica_source s
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id=$3::uuid
        for update of s nowait
     ), owned as materialized (
       select r.replica_id,r.primary_selection_id=ss.primary_selection_id snapshot_current
         from vy_replica r cross join selection_snapshot ss
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and exists (select 1 from source_lock)
        for update of r nowait
     ), target as (
       update vy_replica_source
          set state = 'deleting',
              provenance = provenance || jsonb_build_object(
                'erasure_requested_at',coalesce(provenance->'erasure_requested_at',to_jsonb(now()))
              ),
              updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
          and exists (select 1 from owned where snapshot_current)
        returning ${SOURCE_RETURNING}
     ), private_text_erased as (
       delete from vy_private_text_rehearsal h using target t
       where h.replica_id=t.replica_id and h.owner_user_id=$2::uuid and h.source_id=t.source_id
     ), comparison_preparations_revoked as (
       update vy_replica_comparison_preparation cp set state='revoked',completed_receipt=null,completed_receipt_sha256=null,updated_at=now()
       where cp.replica_id=$1::uuid and cp.owner_user_id=$2::uuid and cp.source_id=$3::uuid and exists(select 1 from target)
     ), processing_jobs as (
       update vy_replica_processing_job j
          set state='failed',failure_code='source_erased',lease_token_hash='',
              leased_at=null,lease_expires_at=null,updated_at=now()
        where j.replica_id=$1::uuid and j.owner_user_id=$2::uuid and j.source_id=$3::uuid
          and j.state in ('queued','retry','blocked') and exists (select 1 from target)
       returning j.job_id
     ), affected_genomes as materialized (
       select g.version
         from vy_replica_voice_genome g join target t on t.replica_id=g.replica_id
        where (g.definition#>'{references,source_ids}') ? t.source_id::text
     ), affected_profiles as materialized (
       select p.version
         from vy_replica_profile p join target t on t.replica_id=p.replica_id
        where jsonb_path_exists(
          p.definition,'$.domains.*[*].source_ids[*] ? (@ == $source)',
          jsonb_build_object('source',to_jsonb(t.source_id::text))
        )
     ), invalidated as (
       update vy_replica_claim set status = 'superseded', updated_at = now()
        where replica_id = $1::uuid and $3 = any(source_ids)
          and status in ('proposed','approved') and exists (select 1 from target)
     ), voice_reference as (
       delete from vy_replica_voice_reference vr
        where vr.replica_id=$1::uuid and vr.owner_user_id=$2::uuid and vr.source_id=$3::uuid
          and exists (select 1 from target)
       returning vr.replica_id
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
       -- One replica UPDATE for the disjoint and overlapping invalidations.
       update vy_replica r
          set age_verified_at=case when exists (select 1 from identity_cases) then null else r.age_verified_at end,
              identity_verified_at=case when exists (select 1 from identity_cases)
                or exists (select 1 from liveness_challenges) then null else r.identity_verified_at end,
              liveness_verified_at=case when exists (select 1 from identity_cases)
                or exists (select 1 from liveness_challenges) then null else r.liveness_verified_at end,
              identity_expires_at=case when exists (select 1 from identity_cases)
                or exists (select 1 from liveness_challenges) then null else r.identity_expires_at end,
              private_text_epoch=r.private_text_epoch+1,
              primary_selection_id=case when exists (select 1 from voice_reference)
                then gen_random_uuid() else r.primary_selection_id end,
              lifecycle=case when r.lifecycle in ('revoked','purging') then r.lifecycle else 'enrolling' end,
              updated_at=now()
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and exists (select 1 from target)
       returning case when exists (select 1 from identity_cases) then r.subject_person_id end subject_person_id
     ), identity_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='biometric' and c.revoked_at is null
          and exists (select 1 from identity_cases)
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), genomes as (
       update vy_replica_voice_genome g set status = 'retired'
         from affected_genomes affected
        where g.replica_id = $1::uuid and g.version=affected.version and g.status <> 'retired'
     ), profiles as (
       update vy_replica_profile p set status = 'retired'
         from affected_profiles affected
        where p.replica_id = $1::uuid and p.version=affected.version and p.status <> 'retired'
     ), voices as (
       update vy_replica_voice_profile vp set status = 'deleting', updated_at = now()
         from affected_genomes affected
        where vp.replica_id = $1::uuid and vp.genome_version=affected.version and vp.status <> 'deleting'
       returning vp.voice_profile_id
     ), runtime_capabilities as (
       update vy_replica_runtime_capability c set state='revoked',revoked_at=coalesce(revoked_at,now())
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.state in ('active','paused')
          and (exists (select 1 from affected_genomes affected where affected.version=c.genome_version)
            or exists (select 1 from affected_profiles affected where affected.version=c.profile_version)
            or exists (select 1 from voices affected where affected.voice_profile_id=c.voice_profile_id))
       returning c.capability_id
     ), runtime_sessions as (
       update vy_replica_runtime_session s set state='revoked',ended_at=coalesce(ended_at,now()),updated_at=now()
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.state='active'
          and exists (select 1 from runtime_capabilities affected where affected.capability_id=s.capability_id)
     ), open_generations as (
       update vy_replica_generation g set state='aborted',failure_code='source_erased',updated_at=now()
        where g.replica_id=$1::uuid and g.owner_user_id=$2::uuid and g.state in ('authorized','streaming')
          and (exists (select 1 from affected_genomes affected where affected.version=g.genome_version)
            or exists (select 1 from affected_profiles affected where affected.version=g.profile_version)
            or exists (
              select 1 from vy_replica_processing_artifact a
               where a.artifact_id=g.preview_artifact_id and a.source_id=$3::uuid
                 and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
            ))
     ), provider_consents as (
       update vy_replica_provider_consent set state = 'revoked',
              revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid and source_id = $3::uuid
          and state <> 'revoked' and exists (select 1 from target)
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'source.delete.request', 'source', source_id::text,
              (select policy_version from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid),
              'allowed', jsonb_build_object('derived_models_invalidated', true)
         from target
     )
     select coalesce((select jsonb_agg(t) from target t),'[]'::jsonb) primary_selection_rows,
            exists (select 1 from owned where not snapshot_current) primary_selection_snapshot_stale`,
    [rid, ownerUserId, sid],
  );
  return rows[0] || null;
}
