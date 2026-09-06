import { canonicalJson, sha256Hex } from "../_provenance/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_ID = /^[1-9]\d{0,18}$/;
const HASH = /^[0-9a-f]{64}$/;

export const ACCEPTED_CLAIM_RELATIONAL_SCHEMA = "accepted-claim-relational-materializer/v1";

function invalid(code) {
  throw Object.assign(new Error(code), { code, status: 400 });
}

function uuid(value, code) {
  const result = String(value || "").trim().toLowerCase();
  if (!UUID.test(result)) invalid(code);
  return result;
}

function claimId(value) {
  const result = String(value || "").trim();
  if (!CLAIM_ID.test(result)) invalid("valid_claim_id_required");
  return result;
}

/** The commitment binds the reviewed claim, the exact accepting decision and
 *  the only dyad this materializer may write. The source/citation set is part
 *  of proposal_hash, produced by the cited extraction contract. */
export function acceptedClaimRelationalCommitment(input) {
  const value = {
    schema: ACCEPTED_CLAIM_RELATIONAL_SCHEMA,
    replica_id: uuid(input?.replica_id, "valid_replica_id_required"),
    owner_user_id: uuid(input?.owner_user_id, "valid_owner_user_id_required"),
    agent_id: uuid(input?.agent_id, "valid_agent_id_required"),
    subject_person_id: uuid(input?.subject_person_id, "valid_subject_person_id_required"),
    claim_id: claimId(input?.claim_id),
    proposal_hash: String(input?.proposal_hash || "").toLowerCase(),
    decision_id: uuid(input?.decision_id, "valid_decision_id_required"),
  };
  if (!HASH.test(value.proposal_hash)) invalid("valid_proposal_hash_required");
  return sha256Hex(canonicalJson(value));
}

// A claim is eligible only while its latest decision is accepted, its own
// state agrees with that decision, and every source/citation edge still
// resolves to its exact transcript evidence. Ordinary ingestion sources must
// be ready. A Mirror Call window is intentionally finalized as a quarantined
// derived source, so it is admitted only through the much narrower immutable
// mirror provenance shape that the claim extractor itself accepts.
const ELIGIBLE_CLAIM = `select c.claim_id,c.replica_id,c.owner_user_id,c.domain,c.key,c.body,c.origin,
       c.confidence,c.sensitive,c.t_valid_from,c.t_valid_to,c.proposal_hash,
       r.agent_id,r.subject_person_id,d.decision_id,d.created_at decided_at
  from vy_replica_claim c
  join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
  join lateral (
    select x.decision_id,x.decision,x.created_at
      from vy_replica_claim_decision x
     where x.claim_id=c.claim_id and x.replica_id=c.replica_id
       and x.owner_user_id=c.owner_user_id
     order by x.created_at desc,x.decision_id desc limit 1
  ) d on true
 where c.claim_id=$1::int8 and c.replica_id=$2::uuid and c.owner_user_id=$3::uuid
   and r.owner_user_id=$3::uuid and r.lifecycle not in ('revoked','purging')
   and r.agent_id is not null and r.subject_person_id is not null
   and exists (
     select 1 from vy_replica_consent consent
      where consent.replica_id=r.replica_id and consent.owner_user_id=r.owner_user_id
        and consent.scope='training' and consent.policy_version=r.policy_version
        and consent.revoked_at is null and (consent.expires_at is null or consent.expires_at>now())
   )
   and c.status='approved' and d.decision='accepted' and c.proposal_hash is not null
   and c.domain in ('event','relationship')
   and (c.t_valid_from is null or c.t_valid_from<=now())
   and (c.t_valid_to is null or c.t_valid_to>now())
   and exists (
     select 1 from vy_replica_claim_citation cc
      where cc.claim_id=c.claim_id and cc.replica_id=c.replica_id
        and cc.owner_user_id=c.owner_user_id
   )
   and not exists (
     select 1
       from unnest(c.source_ids) wanted(source_id)
       left join vy_replica_source s on s.source_id=wanted.source_id
        and s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
      where s.source_id is null or not (
        s.state='ready' or (
          s.state='quarantined' and s.capture_mode='derived'
          and s.contains_third_parties=false
          and s.provenance->>'purpose'='mirror_window'
          and exists (
            select 1 from vy_replica_claim_citation mc
            join vy_replica_processing_evidence me
              on me.evidence_id=mc.evidence_id and me.source_id=mc.source_id
             and me.replica_id=mc.replica_id and me.owner_user_id=mc.owner_user_id
             and me.evidence_type='transcript_span'
             and me.value#>>'{provenance,origin}'='mirror_call'
             and me.value#>>'{provenance,source_id}'=s.source_id::text
             and me.value#>>'{provenance,session_id}'=s.provenance->>'mirror_session_id'
           where mc.claim_id=c.claim_id and mc.replica_id=c.replica_id
             and mc.owner_user_id=c.owner_user_id and mc.source_id=s.source_id
          )
        )
      )
   )
   and not exists (
     select 1
       from vy_replica_claim_citation cc
       left join vy_replica_processing_evidence e
         on e.evidence_id=cc.evidence_id and e.source_id=cc.source_id
        and e.replica_id=cc.replica_id and e.owner_user_id=cc.owner_user_id
       left join vy_replica_source s
         on s.source_id=cc.source_id and s.replica_id=cc.replica_id
        and s.owner_user_id=cc.owner_user_id
      where cc.claim_id=c.claim_id and cc.replica_id=c.replica_id
        and cc.owner_user_id=c.owner_user_id
        and (not (cc.source_id=any(c.source_ids)) or e.evidence_id is null
          or e.evidence_type<>'transcript_span' or s.source_id is null
          or not (
            s.state='ready' or (
              s.state='quarantined' and s.capture_mode='derived'
              and s.contains_third_parties=false
              and s.provenance->>'purpose'='mirror_window'
              and e.value#>>'{provenance,origin}'='mirror_call'
              and e.value#>>'{provenance,source_id}'=s.source_id::text
              and e.value#>>'{provenance,session_id}'=s.provenance->>'mirror_session_id'
            )
          )
          or cc.end_char>length(coalesce(e.value->>'text','')))
   )`;

/** Materialize one accepted cited claim into the existing RelationalOS store.
 *
 * Relationship claims become relationship facts. Other eligible fact domains
 * become user facts. No relation-state movement can be inferred from the
 * current claim shape because it has no typed dim/from/to/direction fields, so
 * this deliberately writes no vy_rel_event and never writes vy_rel_state.
 */
export async function materializeAcceptedClaimToRelationalOs(db, ownerUserId, input) {
  if (typeof db !== "function") invalid("materialization_database_required");
  const replicaId = uuid(input?.replica_id, "valid_replica_id_required");
  const ownerId = uuid(ownerUserId, "valid_owner_user_id_required");
  const id = claimId(input?.claim_id);

  const candidates = await db(ELIGIBLE_CLAIM, [id, replicaId, ownerId]);
  const candidate = candidates[0];
  if (!candidate) return null;

  const commitment = acceptedClaimRelationalCommitment({
    replica_id: candidate.replica_id,
    owner_user_id: candidate.owner_user_id,
    agent_id: candidate.agent_id,
    subject_person_id: candidate.subject_person_id,
    claim_id: candidate.claim_id,
    proposal_hash: candidate.proposal_hash,
    decision_id: candidate.decision_id,
  });
  // Keep the immutable proposal hash visible in the otherwise content-free
  // marker so source erasure can reach every derivative before it deletes the
  // claim row. The suffix binds the first exact acceptance and dyad, while the
  // proposal prefix remains the idempotence key if an API retry appended a
  // second equivalent acceptance decision.
  const markerPrefix = `replica_claim:${candidate.proposal_hash}:`;
  const marker = `${markerPrefix}${commitment}`;

  // Re-run every eligibility predicate under the write transaction and bind
  // it to the exact proposal and decision observed above. If review or source
  // lineage changes between the read and this statement, nothing is written.
  const rows = await db(
    `with eligible as materialized (
       ${ELIGIBLE_CLAIM}
       and c.proposal_hash=$4 and d.decision_id=$5::uuid
       for update of r
     ), locked as materialized (
       select pg_advisory_xact_lock(hashtextextended($7,0)) from eligible
     ), existing_episode as materialized (
       select e.id
         from eligible c cross join locked l
         join vy_episode e on e.agent_id=c.agent_id and e.person_id=c.subject_person_id
          and e.boundary_reason like $7 and e.group_id is null
        order by e.id limit 1
     ), inserted_episode as (
       insert into vy_episode
         (agent_id,person_id,channel,participation,started_at,ended_at,boundary_reason,
          summary,importance,provisional,disclosure_scope)
       select c.agent_id,c.subject_person_id,'watch','user',c.decided_at,c.decided_at,$6,
              c.body,greatest(0.1,c.confidence),false,'participants_1to1'
         from eligible c cross join locked l
        where not exists (select 1 from existing_episode)
       returning id
     ), anchor as materialized (
       select id,false created from existing_episode
       union all
       select id,true created from inserted_episode
    ), scoped_episode as (
      update vy_episode e
         set disclosure_scope='participants_1to1'
        from anchor a,eligible c
       where e.id=a.id and e.agent_id=c.agent_id and e.person_id=c.subject_person_id
         and e.boundary_reason like $7
       returning e.id
    ), participant as (
      insert into vy_episode_participant (episode_id,person_id,role)
      select a.id,c.subject_person_id,'participant'
        from anchor a cross join eligible c cross join scoped_episode s
       where s.id=a.id
      on conflict (episode_id,person_id) do nothing
      returning episode_id
    ), restored_fact as (
       update vy_fact f
          set retracted_at=null,t_invalid=null
         from anchor a,eligible c
        where f.agent_id=c.agent_id and f.person_id=c.subject_person_id
          and f.citations=array[a.id]::bigint[] and f.retracted_at is not null
       returning f.id
     ), inserted_fact as (
       insert into vy_fact
         (agent_id,person_id,kind,name,body,provenance,confidence,citations,sensitive,
          provisional,valid_from,valid_to)
       select c.agent_id,c.subject_person_id,
              case when c.domain='relationship' then 'relationship' else 'user' end,
              c.key,c.body,
              case when c.origin='self_declared' then 'user_said'
                   when c.origin='inferred' then 'derived' else 'extracted' end,
              c.confidence,array[a.id]::bigint[],c.sensitive,false,c.t_valid_from,c.t_valid_to
         from eligible c cross join anchor a
        where exists (select 1 from scoped_episode s where s.id=a.id)
          and not exists (
          select 1 from vy_fact f where f.agent_id=c.agent_id
            and f.person_id=c.subject_person_id and f.citations=array[a.id]::bigint[]
        )
       returning id
     )
     select a.id episode_id,
            coalesce((select id from inserted_fact limit 1),(select id from restored_fact limit 1),(
              select f.id from vy_fact f join eligible c
                on f.agent_id=c.agent_id and f.person_id=c.subject_person_id
               where f.citations=array[a.id]::bigint[] order by f.id limit 1
            )) fact_id,a.created
       from anchor a`,
    [id, replicaId, ownerId, candidate.proposal_hash, candidate.decision_id, marker, `${markerPrefix}%`],
  );
  if (!rows[0]?.episode_id || !rows[0]?.fact_id) return null;
  return Object.freeze({
    replica_id: replicaId,
    claim_id: id,
    agent_id: String(candidate.agent_id).toLowerCase(),
    subject_person_id: String(candidate.subject_person_id).toLowerCase(),
    episode_id: String(rows[0].episode_id),
    fact_id: String(rows[0].fact_id),
    content_commitment: commitment,
    created: Boolean(rows[0].created),
  });
}

/** Retract only the exact RelationalOS fact derived from a claim whose latest
 * owner decision is now rejected or superseded. The episode remains as an
 * immutable audit/citation anchor, but every general fact reader already
 * excludes retracted rows. Mirror recall also rechecks the live claim state,
 * so a crash between decision and this cleanup cannot keep influencing a
 * reply. */
export async function retractClaimRelationalMaterialization(db, ownerUserId, input) {
  if (typeof db !== "function") invalid("materialization_database_required");
  const replicaId = uuid(input?.replica_id, "valid_replica_id_required");
  const ownerId = uuid(ownerUserId, "valid_owner_user_id_required");
  const id = claimId(input?.claim_id);
  const rows = await db(
    `with current_claim as materialized (
       select c.claim_id,c.proposal_hash,r.agent_id,r.subject_person_id
         from vy_replica_claim c
         join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
         join lateral (
           select d.decision from vy_replica_claim_decision d
            where d.claim_id=c.claim_id and d.replica_id=c.replica_id
              and d.owner_user_id=c.owner_user_id
            order by d.created_at desc,d.decision_id desc limit 1
         ) latest on true
        where c.claim_id=$1::int8 and c.replica_id=$2::uuid and c.owner_user_id=$3::uuid
          and r.owner_user_id=$3::uuid and c.proposal_hash is not null
          and ((c.status='rejected' and latest.decision='rejected') or c.status='superseded')
          and r.agent_id is not null and r.subject_person_id is not null
     ), anchors as materialized (
       select e.id
         from current_claim c join vy_episode e
           on e.agent_id=c.agent_id and e.person_id=c.subject_person_id
          and e.boundary_reason like ('replica_claim:'||c.proposal_hash||':%')
          and e.group_id is null
     ), retracted as (
       update vy_fact f
          set retracted_at=coalesce(f.retracted_at,now()),
              t_invalid=coalesce(f.t_invalid,now())
         from current_claim c
        where f.agent_id=c.agent_id and f.person_id=c.subject_person_id
          and exists (select 1 from unnest(f.citations) cited(id) join anchors a on a.id=cited.id)
          and not exists (select 1 from unnest(f.citations) cited(id) where not exists (
            select 1 from anchors a where a.id=cited.id
          ))
       returning f.id
     ) select count(*)::int retracted_facts from retracted`,
    [id, replicaId, ownerId],
  );
  return Object.freeze({
    replica_id: replicaId,
    claim_id: id,
    retracted_facts: Number(rows[0]?.retracted_facts || 0),
  });
}

/** Reconcile the small owner-decision-to-relational write gap. This is called
 * by the existing five-minute nearline sweep even when no extraction job is
 * due. It carries no claim content in its candidate query and delegates every
 * write to the same exact acceptance/rejection predicates above. */
export async function reconcileClaimRelationalMaterializations(db, options = {}) {
  if (typeof db !== "function") invalid("materialization_database_required");
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20)));
  const candidates = await db(
    `with latest as materialized (
       select distinct on (d.claim_id,d.replica_id,d.owner_user_id)
              d.claim_id,d.replica_id,d.owner_user_id,d.decision
         from vy_replica_claim_decision d
        order by d.claim_id,d.replica_id,d.owner_user_id,d.created_at desc,d.decision_id desc
     )
     select c.claim_id::text,c.replica_id,c.owner_user_id,l.decision
       from vy_replica_claim c join latest l
         on l.claim_id=c.claim_id and l.replica_id=c.replica_id and l.owner_user_id=c.owner_user_id
       join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
      where c.domain in ('event','relationship') and c.proposal_hash is not null
        and r.lifecycle not in ('revoked','purging')
        and exists (
          select 1 from vy_replica_consent consent
           where consent.replica_id=r.replica_id and consent.owner_user_id=r.owner_user_id
             and consent.scope='training' and consent.policy_version=r.policy_version
             and consent.revoked_at is null and (consent.expires_at is null or consent.expires_at>now())
        )
        and (
          (c.status='approved' and l.decision='accepted' and not exists (
            select 1 from vy_episode e join vy_fact f
              on f.agent_id=e.agent_id and f.person_id=e.person_id
             and f.citations=array[e.id]::bigint[] and f.retracted_at is null and f.t_invalid is null
             where e.agent_id=r.agent_id and e.person_id=r.subject_person_id
               and e.boundary_reason like ('replica_claim:'||c.proposal_hash||':%')
          ))
          or
          (((c.status='rejected' and l.decision='rejected') or c.status='superseded') and exists (
            select 1 from vy_episode e join vy_fact f
              on f.agent_id=e.agent_id and f.person_id=e.person_id
             and f.citations=array[e.id]::bigint[] and f.retracted_at is null
             where e.agent_id=r.agent_id and e.person_id=r.subject_person_id
               and e.boundary_reason like ('replica_claim:'||c.proposal_hash||':%')
          ))
        )
      order by c.updated_at,c.claim_id limit $1::int4`,
    [limit],
  );
  const summary = { scanned: candidates.length, materialized: 0, retracted: 0, deferred: 0 };
  for (const candidate of candidates) {
    try {
      if (candidate.decision === "accepted") {
        const result = await materializeAcceptedClaimToRelationalOs(db, candidate.owner_user_id, candidate);
        if (result) summary.materialized += 1;
        else summary.deferred += 1;
      } else {
        const result = await retractClaimRelationalMaterialization(db, candidate.owner_user_id, candidate);
        summary.retracted += Number(result.retracted_facts || 0);
      }
    } catch {
      summary.deferred += 1;
    }
  }
  return Object.freeze(summary);
}
