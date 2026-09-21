// Post-call owner-speaker attestation for Mirror Call claim extraction.
//
// This is a narrow human-annotation fallback for the memory lane. It does not
// certify biometric identity, admit a voice reference, or change synthesis.
// The only durable result is canonical `speaker_segment` evidence over the
// owner's transcribed microphone windows and an accepted evidence decision.
// Claim proposals still go through the ordinary owner-review gate.
import {
  PROCESSING_SCHEMA_VERSION,
  canonicalJson,
  sha256Hex,
  stableUuid,
} from "./_replica-processing/contracts.js";
import { mirrorUuid, MirrorCallError } from "./_mirrorcall.js";

export const MIRROR_OWNER_SPEAKER_ATTESTATION = "mirror-owner-speaker-attestation/v1";
export const MIRROR_OWNER_SPEAKER_CHOICES = Object.freeze(["only_me", "not_sure_or_other_people"]);
const REQUIRED_SCOPES = Object.freeze(["capture", "storage", "transcription", "training"]);

function fail(code, status = 409) {
  throw new MirrorCallError(code, status);
}

function evidenceForWindow(window, ownerUserId, replicaId, sessionId, decision = "accepted") {
  const adapter = Object.freeze({
    family: "human_annotation",
    name: "owner_speaker_attestation",
    version: "v1",
  });
  const value = Object.freeze({
    speaker_key: "owner_attested_only_speaker",
    target_likelihood: 1,
    overlap: false,
    epistemic_status: "attested",
    statement_set: MIRROR_OWNER_SPEAKER_ATTESTATION,
    provenance: Object.freeze({
      origin: "mirror_call_owner_attestation",
      session_id: sessionId,
      window_id: String(window.window_id),
      source_id: String(window.source_id),
      seq: Number(window.seq),
      excludes_clone_playback: true,
    }),
  });
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    replica_id: replicaId,
    owner_user_id: ownerUserId,
    source_id: String(window.source_id),
    artifact_id: null,
    created_by_job_id: null,
    evidence_type: "speaker_segment",
    span: { start_ms: 0, end_ms: Number(window.duration_ms) },
    confidence: 1,
    value,
    input_sha256: String(window.input_sha256),
    adapter,
  };
  const recordHash = sha256Hex(canonicalJson(basis));
  const evidenceId = stableUuid(`evidence:${recordHash}`);
  return Object.freeze({
    ...basis,
    evidence_id: evidenceId,
    record_hash: recordHash,
    // One decision id per owner/evidence makes the post-call choice terminal.
    // Opposite choices from two tabs race on the same PK; the winner is
    // durable and the loser fails the valid-decision check instead of becoming
    // a contradictory second "latest" row.
    decision_id: stableUuid(`${MIRROR_OWNER_SPEAKER_ATTESTATION}:decision:${ownerUserId}:${evidenceId}`),
  });
}

export function createMirrorOwnerSpeakerEvidence(windows, input) {
  const ownerUserId = mirrorUuid(input?.ownerUserId, "mirror_owner_id_invalid");
  const replicaId = mirrorUuid(input?.replicaId, "mirror_replica_id_invalid");
  const sessionId = mirrorUuid(input?.sessionId, "mirror_session_id_invalid");
  if (!Array.isArray(windows) || !windows.length) return Object.freeze([]);
  const decision = input?.decision === "rejected" ? "rejected" : "accepted";
  return Object.freeze(windows.map((window) => evidenceForWindow(
    window,
    ownerUserId,
    replicaId,
    sessionId,
    decision,
  )));
}

/**
 * Read immutable post-call inputs before building deterministic evidence.
 * The mutating statement below repeats every ownership, provenance and consent
 * predicate, so this read cannot authorize a write by itself.
 */
export async function listMirrorOwnerSpeakerWindows(db, ownerUserId, sessionIdValue) {
  const sessionId = mirrorUuid(sessionIdValue, "mirror_session_id_invalid");
  return db(
    `select distinct w.window_id,w.session_id,w.replica_id,w.source_id,w.seq,w.duration_ms,
            src.sha256 as input_sha256
       from vy_mirror_session ms
       join vy_mirror_window w
         on w.session_id=ms.session_id and w.replica_id=ms.replica_id
        and w.owner_user_id=ms.owner_user_id
       join vy_replica_source src
         on src.source_id=w.source_id and src.replica_id=w.replica_id
        and src.owner_user_id=w.owner_user_id
      where ms.session_id=$1::uuid and ms.owner_user_id=$2::uuid and ms.state='ended'
        and w.asr_state='transcribed' and trim(w.transcript)<>''
        and w.own_voice_state in ('unverified','owner_verified')
        and src.state='quarantined' and src.capture_mode='derived'
        and src.contains_third_parties=false
        and src.provenance->>'purpose'='mirror_window'
        and src.provenance->>'mirror_session_id'=ms.session_id::text
        and src.provenance->>'mirror_seq'=w.seq::text
        and exists (
          select 1 from vy_replica_processing_evidence te
           where te.replica_id=w.replica_id and te.owner_user_id=w.owner_user_id
             and te.source_id=w.source_id and te.evidence_type='transcript_span'
             and te.value#>>'{provenance,origin}'='mirror_call'
             and te.value#>>'{provenance,session_id}'=ms.session_id::text
             and te.value#>>'{provenance,window_id}'=w.window_id::text
        )
      order by w.seq,w.window_id`,
    [sessionId, ownerUserId],
  );
}

/** A content-free status for the end receipt and its post-call question. */
export async function mirrorOwnerSpeakerAttestationStatus(db, ownerUserId, sessionIdValue) {
  const sessionId = mirrorUuid(sessionIdValue, "mirror_session_id_invalid");
  const rows = await db(
    `with owned as (
       select ms.session_id,ms.replica_id,ms.owner_user_id,r.policy_version,
              not exists (
                select 1 from unnest($3::text[]) required(scope)
                 where not exists (
                   select 1 from vy_replica_consent c
                    where c.replica_id=ms.replica_id and c.owner_user_id=ms.owner_user_id
                      and c.scope=required.scope and c.policy_version=ms.policy_version
                      and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
                 )
              ) consent_ready
         from vy_mirror_session ms join vy_replica r
           on r.replica_id=ms.replica_id and r.owner_user_id=ms.owner_user_id
        where ms.session_id=$1::uuid and ms.owner_user_id=$2::uuid and ms.state='ended'
          and ms.policy_version=r.policy_version
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
     ), latest as (
       select distinct on (d.evidence_id) d.evidence_id,d.decision
         from vy_replica_processing_evidence_decision d join owned o
           on o.replica_id=d.replica_id and o.owner_user_id=d.owner_user_id
        order by d.evidence_id,d.created_at desc,d.decision_id desc
     ), eligible as (
       select distinct w.window_id,w.source_id
         from owned o join vy_mirror_window w on w.session_id=o.session_id
         join vy_replica_source src on src.source_id=w.source_id
          and src.replica_id=o.replica_id and src.owner_user_id=o.owner_user_id
        where w.replica_id=o.replica_id and w.owner_user_id=o.owner_user_id
          and w.asr_state='transcribed' and trim(w.transcript)<>''
          and w.own_voice_state in ('unverified','owner_verified')
          and src.state='quarantined' and src.capture_mode='derived'
          and src.contains_third_parties=false
          and src.provenance->>'purpose'='mirror_window'
          and src.provenance->>'mirror_session_id'=o.session_id::text
          and src.provenance->>'mirror_seq'=w.seq::text
          and exists (
            select 1 from vy_replica_processing_evidence te
             where te.replica_id=o.replica_id and te.owner_user_id=o.owner_user_id
               and te.source_id=w.source_id and te.evidence_type='transcript_span'
               and te.value#>>'{provenance,origin}'='mirror_call'
               and te.value#>>'{provenance,session_id}'=o.session_id::text
               and te.value#>>'{provenance,window_id}'=w.window_id::text
          )
     ), decided as (
       select distinct e.source_id,l.decision
         from owned o join vy_replica_processing_evidence e
           on e.replica_id=o.replica_id and e.owner_user_id=o.owner_user_id
         join eligible x on x.source_id=e.source_id
         join latest l on l.evidence_id=e.evidence_id
        where e.evidence_type='speaker_segment' and e.adapter_family='human_annotation'
          and e.adapter_name='owner_speaker_attestation' and e.adapter_version='v1'
          and e.value->>'statement_set'=$4
          and e.value#>>'{provenance,origin}'='mirror_call_owner_attestation'
          and e.value#>>'{provenance,session_id}'=o.session_id::text
          and e.value#>>'{provenance,source_id}'=e.source_id::text
     )
     select o.session_id,o.replica_id,o.consent_ready,
            (select count(*)::int from eligible) eligible_windows,
            (select count(*)::int from decided where decision='accepted') attested_windows,
            (select count(*)::int from decided where decision='rejected') excluded_windows
       from owned o`,
    [sessionId, ownerUserId, REQUIRED_SCOPES, MIRROR_OWNER_SPEAKER_ATTESTATION],
  );
  const row = rows[0];
  if (!row) return null;
  const eligible = Number(row.eligible_windows || 0);
  const attested = Number(row.attested_windows || 0);
  const excluded = Number(row.excluded_windows || 0);
  const consentReady = row.consent_ready === true || row.consent_ready === "true";
  return Object.freeze({
    statement_set: MIRROR_OWNER_SPEAKER_ATTESTATION,
    state: eligible === 0 ? "not_available"
      : !consentReady ? "consent_required"
        : excluded === eligible ? "excluded"
          : attested === eligible ? "attested" : "needs_owner_choice",
    eligible_windows: eligible,
    attested_windows: attested,
    excluded_windows: excluded,
    consent_ready: consentReady,
  });
}

/**
 * Atomically persist deterministic human annotations, accepted decisions and
 * wake the existing nearline claim job. The statement deliberately names no
 * voice-conditioning table and never updates `vy_mirror_window`.
 */
export async function attestMirrorOwnerSpeaker(db, ownerUserId, input) {
  const sessionId = mirrorUuid(input?.session_id, "mirror_session_id_invalid");
  const choice = String(input?.choice || "");
  if (!MIRROR_OWNER_SPEAKER_CHOICES.includes(choice)) {
    fail("mirror_speaker_attestation_choice_invalid", 400);
  }
  const windows = await listMirrorOwnerSpeakerWindows(db, ownerUserId, sessionId);
  if (!windows.length) fail("mirror_speaker_attestation_no_transcribed_windows");
  const replicaId = mirrorUuid(windows[0].replica_id, "mirror_replica_id_invalid");
  const decision = choice === "only_me" ? "accepted" : "rejected";
  const reasonCode = decision === "accepted" ? "segment_verified" : "mixed_or_uncertain_speaker";
  const desired = createMirrorOwnerSpeakerEvidence(windows, {
    ownerUserId,
    replicaId,
    sessionId,
    decision,
  });
  const rows = await db(
    `with owned as materialized (
       select ms.session_id,ms.replica_id,ms.owner_user_id,ms.policy_version
         from vy_mirror_session ms join vy_replica r
           on r.replica_id=ms.replica_id and r.owner_user_id=ms.owner_user_id
        where ms.session_id=$1::uuid and ms.replica_id=$2::uuid
          and ms.owner_user_id=$3::uuid and ms.state='ended'
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and ms.policy_version=r.policy_version
          and ms.consent_scopes @> array['capture','storage','transcription']::text[]
          and not exists (
            select 1 from unnest($5::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c
                where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
                  and c.scope=required.scope and c.policy_version=r.policy_version
                  and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
             )
          )
     ), desired as materialized (
       select value item from jsonb_array_elements($4::jsonb)
     ), eligible as materialized (
       select distinct w.window_id,w.source_id,w.seq,w.duration_ms,src.sha256
         from owned o join vy_mirror_window w on w.session_id=o.session_id
         join vy_replica_source src on src.source_id=w.source_id
          and src.replica_id=o.replica_id and src.owner_user_id=o.owner_user_id
        where w.replica_id=o.replica_id and w.owner_user_id=o.owner_user_id
          and w.asr_state='transcribed' and trim(w.transcript)<>''
          and w.own_voice_state in ('unverified','owner_verified')
          and src.state='quarantined' and src.capture_mode='derived'
          and src.contains_third_parties=false
          and src.provenance->>'purpose'='mirror_window'
          and src.provenance->>'mirror_session_id'=o.session_id::text
          and src.provenance->>'mirror_seq'=w.seq::text
          and exists (
            select 1 from vy_replica_processing_evidence te
             where te.replica_id=o.replica_id and te.owner_user_id=o.owner_user_id
               and te.source_id=w.source_id and te.evidence_type='transcript_span'
               and te.value#>>'{provenance,origin}'='mirror_call'
               and te.value#>>'{provenance,session_id}'=o.session_id::text
               and te.value#>>'{provenance,window_id}'=w.window_id::text
          )
     ), bound as materialized (
       select d.item
         from desired d join eligible e
           on e.source_id=(d.item->>'source_id')::uuid
          and e.window_id=(d.item#>>'{value,provenance,window_id}')::uuid
          and e.seq=(d.item#>>'{value,provenance,seq}')::integer
          and e.duration_ms=(d.item#>>'{span,end_ms}')::integer
          and e.sha256=d.item->>'input_sha256'
         join owned o
           on o.replica_id=(d.item->>'replica_id')::uuid
          and o.owner_user_id=(d.item->>'owner_user_id')::uuid
          and o.session_id=(d.item#>>'{value,provenance,session_id}')::uuid
        where d.item->>'evidence_type'='speaker_segment'
          and (d.item#>>'{span,start_ms}')::integer=0
          and d.item#>>'{adapter,family}'='human_annotation'
          and d.item#>>'{adapter,name}'='owner_speaker_attestation'
          and d.item#>>'{adapter,version}'='v1'
          and d.item->>'confidence'='1'
          and d.item#>>'{value,target_likelihood}'='1'
          and d.item#>>'{value,overlap}'='false'
          and d.item#>>'{value,epistemic_status}'='attested'
          and d.item#>>'{value,statement_set}'=$6::text
          and d.item#>>'{value,provenance,origin}'='mirror_call_owner_attestation'
          and d.item#>>'{value,provenance,source_id}'=e.source_id::text
          and d.item#>>'{value,provenance,excludes_clone_playback}'='true'
     ), already_attested as materialized (
       select 1 ok
        where (select count(*) from desired)>0
          and (select count(*) from desired)=(select count(*) from bound)
          and (select count(*) from desired)=(select count(*) from eligible)
          and not exists (
            select 1 from desired d where not exists (
              select 1 from vy_replica_processing_evidence e
              join vy_replica_processing_evidence_decision x
                on x.evidence_id=e.evidence_id and x.replica_id=e.replica_id
               and x.owner_user_id=e.owner_user_id
               where e.evidence_id=(d.item->>'evidence_id')::uuid
                 and e.replica_id=(d.item->>'replica_id')::uuid
                 and e.owner_user_id=(d.item->>'owner_user_id')::uuid
                 and e.source_id=(d.item->>'source_id')::uuid
                 and e.record_hash=d.item->>'record_hash'
                 and x.decision_id=(d.item->>'decision_id')::uuid
                 and x.decision=$7 and x.reviewer_user_id=$3::uuid
                 and x.metadata->>'statement_set'=$6::text
            )
          )
     ), collision_free as materialized (
       select 1 ok
        where (select count(*) from desired)>0
          and (select count(*) from desired)=(select count(*) from bound)
          and (select count(*) from desired)=(select count(*) from eligible)
          and (select count(*) from desired)=(select count(*) from bound)
          and not exists (
            select 1 from desired d join vy_replica_processing_evidence e
              on e.evidence_id=(d.item->>'evidence_id')::uuid
             where e.record_hash<>d.item->>'record_hash'
                or e.replica_id<>(d.item->>'replica_id')::uuid
                or e.owner_user_id<>(d.item->>'owner_user_id')::uuid
                or e.source_id<>(d.item->>'source_id')::uuid
          )
          and not exists (
            select 1 from desired d join vy_replica_processing_evidence e
              on e.record_hash=d.item->>'record_hash'
             where e.evidence_id<>(d.item->>'evidence_id')::uuid
          )
          and not exists (
            select 1 from desired d join vy_replica_processing_evidence_decision x
              on x.decision_id=(d.item->>'decision_id')::uuid
             where x.evidence_id<>(d.item->>'evidence_id')::uuid
                or x.replica_id<>(d.item->>'replica_id')::uuid
                or x.owner_user_id<>(d.item->>'owner_user_id')::uuid
                or x.decision<>$7 or x.reviewer_user_id<>$3::uuid
          )
     ), inserted_evidence as (
       insert into vy_replica_processing_evidence
         (evidence_id,replica_id,owner_user_id,source_id,artifact_id,created_by_job_id,
          evidence_type,span_start_ms,span_end_ms,confidence,value,input_sha256,
          adapter_family,adapter_name,adapter_version,record_hash)
       select (item->>'evidence_id')::uuid,(item->>'replica_id')::uuid,
              (item->>'owner_user_id')::uuid,(item->>'source_id')::uuid,null,null,
              item->>'evidence_type',(item#>>'{span,start_ms}')::integer,
              (item#>>'{span,end_ms}')::integer,(item->>'confidence')::double precision,
              item->'value',item->>'input_sha256',item#>>'{adapter,family}',
              item#>>'{adapter,name}',item#>>'{adapter,version}',item->>'record_hash'
         from bound cross join collision_free
       on conflict (evidence_id) do nothing
       returning evidence_id
     ), valid_evidence as materialized (
       select d.item from desired d cross join collision_free
        where (d.item->>'evidence_id')::uuid in (select evidence_id from inserted_evidence)
           or exists (
          select 1 from vy_replica_processing_evidence e
           where e.evidence_id=(d.item->>'evidence_id')::uuid
             and e.replica_id=(d.item->>'replica_id')::uuid
             and e.owner_user_id=(d.item->>'owner_user_id')::uuid
             and e.source_id=(d.item->>'source_id')::uuid
             and e.record_hash=d.item->>'record_hash'
        )
     ), inserted_decisions as (
       insert into vy_replica_processing_evidence_decision
         (decision_id,evidence_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id,metadata)
       select (item->>'decision_id')::uuid,(item->>'evidence_id')::uuid,
              (item->>'replica_id')::uuid,(item->>'owner_user_id')::uuid,
              $7,$8,$3::uuid,
              jsonb_build_object('origin','mirror_call_owner_attestation',
                                 'statement_set',$6::text,'session_id',$1::text,
                                 'excludes_clone_playback',true)
         from valid_evidence
        where (select count(*) from valid_evidence)=(select count(*) from desired)
       on conflict (decision_id) do nothing
       returning decision_id,evidence_id
     ), valid_decisions as materialized (
       select d.item from desired d cross join collision_free
        where (d.item->>'decision_id')::uuid in (select decision_id from inserted_decisions)
           or exists (
          select 1 from vy_replica_processing_evidence_decision x
           where x.decision_id=(d.item->>'decision_id')::uuid
             and x.evidence_id=(d.item->>'evidence_id')::uuid
             and x.replica_id=(d.item->>'replica_id')::uuid
             and x.owner_user_id=(d.item->>'owner_user_id')::uuid
             and x.decision=$7 and x.reviewer_user_id=$3::uuid
             and x.metadata->>'statement_set'=$6::text
        )
     ), claim_queue_ensured as (
       insert into vy_replica_claim_extraction_queue (replica_id,owner_user_id,state)
       select o.replica_id,o.owner_user_id,'queued'
         from owned o
        where $7='accepted'
          and (select count(*) from valid_decisions)=(select count(*) from desired)
       on conflict (replica_id,owner_user_id) do nothing
       returning job_id,replica_id,owner_user_id
     ), claim_queue as materialized (
       select * from claim_queue_ensured
       union all
       select q.job_id,q.replica_id,q.owner_user_id
         from owned o join vy_replica_claim_extraction_queue q
           on q.replica_id=o.replica_id and q.owner_user_id=o.owner_user_id
        where $7='accepted' and not exists (select 1 from claim_queue_ensured)
     ), queued_claim_items as (
       insert into vy_replica_claim_extraction_queue_item
         (job_id,replica_id,owner_user_id,evidence_id,source_id,state)
       select q.job_id,q.replica_id,q.owner_user_id,te.evidence_id,e.source_id,'pending'
         from claim_queue q cross join eligible e
         join vy_replica_processing_evidence te
           on te.replica_id=q.replica_id and te.owner_user_id=q.owner_user_id
          and te.source_id=e.source_id and te.evidence_type='transcript_span'
          and te.value#>>'{provenance,origin}'='mirror_call'
          and te.value#>>'{provenance,session_id}'=$1::text
          and te.value#>>'{provenance,window_id}'=e.window_id::text
        where $7='accepted'
          and (select count(*) from valid_decisions)=(select count(*) from desired)
       on conflict (evidence_id) do nothing
       returning job_id,evidence_id
     ), queue_wakeup as (
       update vy_replica_claim_extraction_queue q
          set state=case when q.state='running' then 'running' else 'queued' end,
              next_attempt_at=case when q.state='running' then q.next_attempt_at else now() end,
              lease_token_hash=case when q.state='running' then q.lease_token_hash else '' end,
              leased_at=case when q.state='running' then q.leased_at else null end,
              lease_expires_at=case when q.state='running' then q.lease_expires_at else null end,
              last_error_code=case when q.state='running' then q.last_error_code else '' end,
              completed_at=null,
              updated_at=now()
        where q.job_id in (select job_id from claim_queue)
          and $7='accepted'
          and (
            exists (select 1 from queued_claim_items i where i.job_id=q.job_id)
            or exists (
              select 1 from vy_replica_claim_extraction_queue_item i
              join eligible e on e.source_id=i.source_id
               where i.job_id=q.job_id and i.state='pending'
            )
          )
       returning q.job_id,q.state,q.next_attempt_at
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $2::uuid,$3::uuid,'mirror_call.owner_speaker_attest','mirror_session',$1::text,
              o.policy_version,case when $7='accepted' then 'allowed' else 'denied' end,
              jsonb_build_object('statement_set',$6::text,'windows',(select count(*) from inserted_decisions),
                                 'speaker_decision',$7,
                                 'claim_proposals_require_owner_review',true,
                                 'voice_conditioning_changed',false)
         from owned o
        where (select count(*) from inserted_decisions)>0
     )
     select (select count(*)::int from desired) eligible_windows,
            (select count(*)::int from valid_decisions) attested_windows,
            (select count(*)::int from inserted_decisions) newly_attested_windows,
            (select job_id from queue_wakeup limit 1) claim_job_id,
            (select state from queue_wakeup limit 1) claim_job_state,
            (select next_attempt_at from queue_wakeup limit 1) next_attempt_at`,
    [sessionId, replicaId, ownerUserId, JSON.stringify(desired), REQUIRED_SCOPES,
      MIRROR_OWNER_SPEAKER_ATTESTATION, decision, reasonCode],
  );
  const row = rows[0];
  if (!row || Number(row.attested_windows || 0) !== desired.length) {
    fail("mirror_speaker_attestation_not_applied");
  }
  return Object.freeze({
    statement_set: MIRROR_OWNER_SPEAKER_ATTESTATION,
    state: decision === "accepted" ? "attested" : "excluded",
    eligible_windows: Number(row.eligible_windows || 0),
    attested_windows: Number(row.attested_windows || 0),
    newly_attested_windows: Number(row.newly_attested_windows || 0),
    consent_ready: true,
    queued: decision === "accepted" && ["queued", "running"].includes(String(row.claim_job_state || "")),
    claim_job_state: String(row.claim_job_state || ""),
    next_attempt_at: row.next_attempt_at || null,
  });
}
