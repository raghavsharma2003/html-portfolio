import { randomBytes } from "node:crypto";
import { createExtractionBatch, extractionMessages, CLAIM_EXTRACTION_SCHEMA } from "./_claim-extraction/contracts.js";
import { beginFoundrySpend, markFoundrySpendUncertain, releaseFoundrySpendBeforeCall, reserveFoundrySpend, settleFoundrySpend } from "./_provider-budget.js";
import { sha256Hex } from "./_provenance/contracts.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { contextTextEvidenceAuthoritySql } from "./_context-claim-authority.js";
import { utf16CitationQuoteSql } from "./_claim-extraction/citation-coordinates.js";

// This is the complete authority for treating Context Locker text as the
// owner's claim-extraction input. Keep it identical at discovery, run opening,
// and post-provider persistence so a stale item cannot become a claim.
export const CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL = contextTextEvidenceAuthoritySql('e');

export const ELIGIBLE_TRANSCRIPTS_SQL = `with latest_speaker_decision as (
  select distinct on (d.evidence_id) d.evidence_id,d.decision
    from vy_replica_processing_evidence_decision d
   where d.replica_id=$1 and d.owner_user_id=$2
   order by d.evidence_id,d.created_at desc,d.decision_id desc
)
select e.evidence_id,e.source_id,e.span_start_ms,e.span_end_ms,e.confidence,
       e.input_sha256,e.record_hash,e.value->>'text' as text,e.value->>'language' as language
  from vy_replica_processing_evidence e
  join vy_replica_source s
    on s.source_id=e.source_id and s.replica_id=e.replica_id and s.owner_user_id=e.owner_user_id
 where e.replica_id=$1::uuid and e.owner_user_id=$2::uuid
   and e.confidence>=0.55 and length(e.value->>'text') between 1 and 8000
   and lower(e.adapter_family||' '||e.adapter_name||' '||e.adapter_version) !~ '(fake|fixture|test|mock)'
   and not exists (
     select 1 from vy_replica_claim_extraction_input xi
     join vy_replica_claim_extraction xr
       on xr.run_id=xi.run_id and xr.replica_id=xi.replica_id and xr.owner_user_id=xi.owner_user_id
      where xi.evidence_id=e.evidence_id and xi.replica_id=e.replica_id
        and xi.owner_user_id=e.owner_user_id and xr.schema_version=$3 and xr.state='complete'
   )
   and ((e.evidence_type='transcript_span'
     and s.contains_third_parties=false
     and (s.state in ('processing','ready') or (
       s.state='quarantined' and s.capture_mode='derived'
       and s.provenance->>'purpose'='mirror_window'
       and e.value#>>'{provenance,origin}'='mirror_call'
       and e.value#>>'{provenance,source_id}'=s.source_id::text
     ))
     and exists (
       select 1 from vy_replica_processing_evidence speaker
       join latest_speaker_decision d on d.evidence_id=speaker.evidence_id and d.decision='accepted'
        where speaker.replica_id=e.replica_id and speaker.owner_user_id=e.owner_user_id
          and speaker.source_id=e.source_id and speaker.evidence_type='speaker_segment'
          and coalesce((speaker.value->>'target_likelihood')::double precision,0)>=0.8
          and speaker.span_start_ms<e.span_end_ms and speaker.span_end_ms>e.span_start_ms
          and lower(speaker.adapter_family||' '||speaker.adapter_name||' '||speaker.adapter_version) !~ '(fake|fixture|test|mock)'
     )) or ${CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL})
 order by e.created_at asc,e.evidence_id asc limit 100`;

const OWNED_EXTRACTION_SQL = `select r.replica_id,r.lifecycle,r.subject_mode,r.policy_version,
  array(select distinct c.consent_id from vy_replica_consent c
    where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
      and c.scope in ('transcription','training') and c.policy_version=r.policy_version
      and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())) as consent_ids,
  exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
    and c.scope='transcription' and c.policy_version=r.policy_version and c.revoked_at is null
    and (c.expires_at is null or c.expires_at>now())) as transcription_consent,
  exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
    and c.scope='training' and c.policy_version=r.policy_version and c.revoked_at is null
    and (c.expires_at is null or c.expires_at>now())) as training_consent
from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
  and r.policy_version=$3 and r.lifecycle not in ('revoked','purging') limit 1`;

function truth(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function cleanCode(value) {
  return String(value?.code || value?.message || "claim_extraction_failed").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
}

function extractionLeaseHash(token) {
  const value = String(token || "");
  if (value.length < 32) throw new Error("strong claim extraction lease token required");
  return sha256Hex(`replica-claim-extraction-run-lease:v1:${value}`);
}

function extractionReadiness(owned, rows) {
  const blockers = [];
  if (!truth(owned?.transcription_consent)) blockers.push("transcription_consent_required");
  if (!truth(owned?.training_consent)) blockers.push("training_consent_required");
  if (!rows.length) blockers.push("reviewed_confident_subject_evidence_required");
  return { ready: blockers.length === 0, blockers, eligible_spans: rows.length };
}

function boundedRows(rows) {
  const selected = [];
  let characters = 0;
  for (const row of rows) {
    const size = String(row.text || "").length;
    if (!size || size > 8_000 || characters + size > 24_000 || selected.length >= 40) break;
    selected.push(row);
    characters += size;
  }
  return selected;
}

async function extractionState(db, ownerUserId, id) {
  const rid = replicaId(id);
  const [ownedRows, transcripts, runs, queueRows] = await Promise.all([
    db(OWNED_EXTRACTION_SQL, [rid, ownerUserId, REPLICA_POLICY_VERSION]),
    db(ELIGIBLE_TRANSCRIPTS_SQL, [rid, ownerUserId, CLAIM_EXTRACTION_SCHEMA]),
    db(`select x.run_id,x.state,x.proposed_count,x.rejected_count,x.attempt,x.failure_code,x.created_at,x.completed_at
          from vy_replica_claim_extraction x join vy_replica r on r.replica_id=x.replica_id and r.owner_user_id=$2::uuid
         where x.replica_id=$1::uuid and x.owner_user_id=$2::uuid order by x.created_at desc limit 20`, [rid, ownerUserId]),
    db(`select q.job_id,q.state,q.attempt,q.next_attempt_at,q.last_error_code,q.updated_at,q.completed_at,
               count(i.evidence_id) filter (where i.state='pending')::int pending_items,
               count(i.evidence_id) filter (where i.state='complete')::int complete_items
          from vy_replica_claim_extraction_queue q
          left join vy_replica_claim_extraction_queue_item i
            on i.job_id=q.job_id and i.replica_id=q.replica_id and i.owner_user_id=q.owner_user_id
         where q.replica_id=$1::uuid and q.owner_user_id=$2::uuid
         group by q.job_id limit 1`, [rid, ownerUserId]),
  ]);
  const owned = ownedRows[0];
  if (!owned) return null;
  const selected = boundedRows(transcripts);
  return { rid, owned, rows: selected, readiness: extractionReadiness(owned, selected), runs, queue: queueRows[0] || null };
}

export async function ownedClaimExtractionStatus(db, ownerUserId, id) {
  const state = await extractionState(db, ownerUserId, id);
  if (!state) return null;
  const queue = state.queue;
  return {
    replica_id: state.rid,
    readiness: state.readiness,
    nearline: {
      queued: queue?.state === "queued" || queue?.state === "running",
      state: queue?.state || (state.readiness.ready ? "ready_for_manual_extraction" : "waiting_for_readiness"),
      pending_items: Number(queue?.pending_items || 0),
      complete_items: Number(queue?.complete_items || 0),
      next_attempt_at: queue?.next_attempt_at || null,
      last_error_code: queue?.last_error_code || "",
      automatic_sweep: { route: "/api/replica-claim-sweep" },
      owner_action: { route: "/api/replica-claims", op: "extract" },
    },
    runs: state.runs.map((row) => ({
      run_id: row.run_id,
      state: row.state,
      proposed_count: Number(row.proposed_count),
      rejected_count: Number(row.rejected_count),
      attempt: Number(row.attempt),
      failure_code: row.failure_code,
      created_at: row.created_at,
      completed_at: row.completed_at,
    })),
  };
}

export const CLAIM_EXTRACTION_OPEN_SQL = `with authorized as (${OWNED_EXTRACTION_SQL}), claimed as (
     insert into vy_replica_claim_extraction
       (replica_id,owner_user_id,schema_version,provider_family,provider_name,provider_version,model,input_set_hash,
        consent_ids,state,lease_token_hash,leased_at,lease_expires_at)
     select replica_id,$2::uuid,$4,$5,$6,$7,$8,$9,$10::uuid[],'extracting',$11,now(),
            now()+($12::integer*interval '1 millisecond') from authorized
      where transcription_consent=true and training_consent=true and cardinality(consent_ids)>=2
     on conflict (replica_id,owner_user_id,schema_version,provider_name,provider_version,model,input_set_hash)
       do update set state='extracting',attempt=vy_replica_claim_extraction.attempt+1,
                     failure_code='',completed_at=null,lease_token_hash=$11,
                     leased_at=now(),lease_expires_at=now()+($12::integer*interval '1 millisecond'),updated_at=now()
         where vy_replica_claim_extraction.state<>'complete' and (
           vy_replica_claim_extraction.state<>'extracting'
           or vy_replica_claim_extraction.lease_expires_at is null
           or vy_replica_claim_extraction.lease_expires_at<=now()
         )
     returning run_id,state,proposed_count,rejected_count,attempt,created_at,completed_at,true acquired
     ), selected as materialized (
       select * from claimed
       union all
       select x.run_id,x.state,x.proposed_count,x.rejected_count,x.attempt,x.created_at,x.completed_at,false acquired
         from vy_replica_claim_extraction x join authorized a on a.replica_id=x.replica_id
        where x.owner_user_id=$2::uuid and x.schema_version=$4 and x.provider_name=$6
          and x.provider_version=$7 and x.model=$8 and x.input_set_hash=$9
          and not exists (select 1 from claimed) limit 1
     ), desired_inputs as materialized (
       select (item->>'evidence_id')::uuid evidence_id,(item->>'source_id')::uuid source_id,
              item->>'input_sha256' input_sha256,item->>'record_hash' record_hash
         from jsonb_array_elements($13::jsonb) item
     ), inserted_inputs as (
       insert into vy_replica_claim_extraction_input
         (run_id,replica_id,owner_user_id,evidence_id,source_id)
       select s.run_id,$1::uuid,$2::uuid,d.evidence_id,d.source_id
         from selected s cross join desired_inputs d
         join vy_replica_processing_evidence e
           on e.evidence_id=d.evidence_id and e.replica_id=$1::uuid and e.owner_user_id=$2::uuid
          and e.source_id=d.source_id
          and e.input_sha256=d.input_sha256 and e.record_hash=d.record_hash
          and (e.evidence_type='transcript_span' or ${CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL})
       on conflict do nothing returning run_id,evidence_id,source_id
     ), valid_inputs as materialized (
       select count(*)::int total from desired_inputs d cross join selected s
        where exists (
          select 1 from vy_replica_claim_extraction_input i
          join vy_replica_processing_evidence e
            on e.evidence_id=i.evidence_id and e.replica_id=i.replica_id and e.owner_user_id=i.owner_user_id
           and e.source_id=i.source_id and e.input_sha256=d.input_sha256 and e.record_hash=d.record_hash
           and (e.evidence_type='transcript_span' or ${CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL})
           where i.run_id=s.run_id and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
             and i.evidence_id=d.evidence_id and i.source_id=d.source_id
        ) or exists (
          select 1 from inserted_inputs i
           where i.run_id=s.run_id and i.evidence_id=d.evidence_id and i.source_id=d.source_id
        )
     ) select * from selected
        where (select count(*) from desired_inputs)=(select total from valid_inputs)`;

async function openRun(db, ownerUserId, state, extractor, batch, leaseToken) {
  const consentIds = Array.isArray(state.owned.consent_ids) ? state.owned.consent_ids : [];
  const inputs = state.rows.map((row) => ({
    evidence_id: row.evidence_id,
    source_id: row.source_id,
    input_sha256: row.input_sha256,
    record_hash: row.record_hash,
  }));
  const rows = await db(
    CLAIM_EXTRACTION_OPEN_SQL,
    [state.rid, ownerUserId, REPLICA_POLICY_VERSION, CLAIM_EXTRACTION_SCHEMA, extractor.family, extractor.name,
      extractor.version, extractor.model, batch.input_set_hash, consentIds, extractionLeaseHash(leaseToken), 5 * 60_000,
      JSON.stringify(inputs)],
  );
  return rows[0] || null;
}

export const CLAIM_EXTRACTION_PERSIST_SQL = `with authorized as (${OWNED_EXTRACTION_SQL}), active_run as materialized (
       select x.run_id,x.replica_id,x.owner_user_id from vy_replica_claim_extraction x join authorized a
         on a.replica_id=x.replica_id
        where x.run_id=$4::uuid and x.owner_user_id=$2::uuid and x.input_set_hash=$5 and x.state='extracting'
          and x.lease_token_hash=$6 and x.lease_expires_at>now()
          and a.transcription_consent=true and a.training_consent=true
     ), latest_speaker_decision as materialized (
       select distinct on (d.evidence_id) d.evidence_id,d.decision
         from vy_replica_processing_evidence_decision d join active_run r
           on r.replica_id=d.replica_id and r.owner_user_id=d.owner_user_id
        order by d.evidence_id,d.created_at desc,d.decision_id desc
     ), proposal_rows as materialized (
       select p.domain,p.key,p.body,p.origin,p.confidence,p.sensitive,p.t_valid_from,p.t_valid_to,
              array(select source_id::uuid from jsonb_array_elements_text(p.source_ids) as source_ids(source_id)) as source_ids,
              p.proposal_hash,p.citations
         from active_run r cross join lateral jsonb_to_recordset($7::jsonb) as p(
         domain text,key text,body text,origin text,confidence double precision,sensitive boolean,
         t_valid_from timestamptz,t_valid_to timestamptz,source_ids jsonb,proposal_hash text,citations jsonb
       )
     ), proposed_citations as materialized (
       select p.proposal_hash,
              (cite->>'evidence_id')::uuid as evidence_id,(cite->>'source_id')::uuid as source_id,
              (cite->>'start_char')::integer as start_char,(cite->>'end_char')::integer as end_char,
              cite->>'quote_hash' as quote_hash,(cite->>'entailment')::double precision as entailment
         from proposal_rows p cross join lateral jsonb_array_elements(p.citations) cite
     ), valid_citations as materialized (
       select x.*
         from proposed_citations x cross join active_run r
         join vy_replica_claim_extraction_input i
           on i.run_id=r.run_id and i.replica_id=r.replica_id and i.owner_user_id=r.owner_user_id
          and i.evidence_id=x.evidence_id and i.source_id=x.source_id
         join vy_replica_processing_evidence e
           on e.evidence_id=x.evidence_id and e.replica_id=r.replica_id and e.owner_user_id=r.owner_user_id
          and e.source_id=x.source_id
         join vy_replica_source s
           on s.source_id=e.source_id and s.replica_id=e.replica_id and s.owner_user_id=e.owner_user_id
         cross join lateral (
           select ${utf16CitationQuoteSql("e.value->>'text'", "x.start_char", "x.end_char")} citation_quote
         ) resolved
        where x.start_char>=0 and x.end_char>x.start_char
          and resolved.citation_quote is not null
          and encode(digest(convert_to(resolved.citation_quote,'UTF8'),'sha256'),'hex')=x.quote_hash
          and lower(e.adapter_family||' '||e.adapter_name||' '||e.adapter_version) !~ '(fake|fixture|test|mock)'
          and ((e.evidence_type='transcript_span'
            and s.contains_third_parties=false
            and (s.state in ('processing','ready') or (
              s.state='quarantined' and s.capture_mode='derived'
              and s.provenance->>'purpose'='mirror_window'
              and e.value#>>'{provenance,origin}'='mirror_call'
              and e.value#>>'{provenance,source_id}'=s.source_id::text
            ))
            and exists (
              select 1 from vy_replica_processing_evidence speaker
              join latest_speaker_decision sd
                on sd.evidence_id=speaker.evidence_id and sd.decision='accepted'
               where speaker.replica_id=e.replica_id and speaker.owner_user_id=e.owner_user_id
                 and speaker.source_id=e.source_id and speaker.evidence_type='speaker_segment'
                 and coalesce((speaker.value->>'target_likelihood')::double precision,0)>=0.8
                 and speaker.span_start_ms<e.span_end_ms and speaker.span_end_ms>e.span_start_ms
                 and lower(speaker.adapter_family||' '||speaker.adapter_name||' '||speaker.adapter_version) !~ '(fake|fixture|test|mock)'
            )) or ${CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL})
     ), authorization_guard as materialized (
       select 1 ok where
         (select count(*) from proposal_rows)=$8::int4
         and (select count(*) from proposed_citations)=$10::int4
         and (select count(*) from valid_citations)=$10::int4
         and not exists (
           select 1 from proposal_rows p where not exists (
             select 1 from valid_citations v where v.proposal_hash=p.proposal_hash
           )
         )
         and not exists (
           select 1 from proposal_rows p cross join lateral unnest(p.source_ids) wanted(source_id)
            where not exists (
              select 1 from valid_citations v
               where v.proposal_hash=p.proposal_hash and v.source_id=wanted.source_id
            )
         )
         and not exists (
           select 1 from valid_citations v join proposal_rows p on p.proposal_hash=v.proposal_hash
            where not (v.source_id=any(p.source_ids))
         )
     ), inserted_claims as (
       insert into vy_replica_claim
         (replica_id,owner_user_id,domain,key,body,origin,confidence,status,source_ids,sensitive,
          t_valid_from,t_valid_to,proposal_hash,extractor_run_id)
       select r.replica_id,r.owner_user_id,p.domain,p.key,p.body,p.origin,p.confidence,'proposed',p.source_ids,p.sensitive,
              p.t_valid_from,p.t_valid_to,p.proposal_hash,r.run_id
         from active_run r cross join proposal_rows p cross join authorization_guard g
       on conflict (replica_id,owner_user_id,proposal_hash) where proposal_hash is not null do nothing
       returning claim_id,replica_id,owner_user_id,proposal_hash
     ), claim_rows as (
       select * from inserted_claims
       union all
       select c.claim_id,c.replica_id,c.owner_user_id,c.proposal_hash from vy_replica_claim c
       join active_run r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
       join proposal_rows p on p.proposal_hash=c.proposal_hash
       cross join authorization_guard g
     ), citation_rows as materialized (
       select c.claim_id,c.replica_id,c.owner_user_id,
              v.evidence_id,v.source_id,v.start_char,v.end_char,v.quote_hash,v.entailment
         from valid_citations v join claim_rows c on c.proposal_hash=v.proposal_hash
     ), inserted_citations as (
       insert into vy_replica_claim_citation
         (claim_id,replica_id,owner_user_id,evidence_id,source_id,start_char,end_char,quote_hash,entailment)
       select x.claim_id,x.replica_id,x.owner_user_id,x.evidence_id,x.source_id,x.start_char,x.end_char,x.quote_hash,x.entailment
         from citation_rows x
       on conflict do nothing
       returning claim_id,evidence_id,start_char,end_char
     ), covered_citations as (
       select claim_id,evidence_id,start_char,end_char from inserted_citations
       union
       select stored.claim_id,stored.evidence_id,stored.start_char,stored.end_char
         from vy_replica_claim_citation stored join citation_rows wanted
           on wanted.claim_id=stored.claim_id and wanted.evidence_id=stored.evidence_id
          and wanted.start_char=stored.start_char and wanted.end_char=stored.end_char
     ), finished as (
       update vy_replica_claim_extraction x set state='complete',proposed_count=$8::int4,rejected_count=$9::int4,
              failure_code='',completed_at=now(),lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
         from active_run r where x.run_id=r.run_id and (select count(*) from covered_citations)=$10
       returning x.run_id,x.state,x.proposed_count,x.rejected_count,x.attempt,x.created_at,x.completed_at
     ), completed_queue_items as (
       update vy_replica_claim_extraction_queue_item i
          set state='complete',completed_at=coalesce(i.completed_at,now())
         from finished f join vy_replica_claim_extraction_input x on x.run_id=f.run_id
        where i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
          and i.evidence_id=x.evidence_id and i.state='pending'
       returning i.job_id,i.evidence_id
     ), touched_queue as materialized (
       select distinct job_id from completed_queue_items
     ), remaining_queue as materialized (
       select t.job_id,exists (
         select 1 from vy_replica_claim_extraction_queue_item i
          where i.job_id=t.job_id and i.state='pending' and not exists (
            select 1 from completed_queue_items c
             where c.job_id=i.job_id and c.evidence_id=i.evidence_id
          )
       ) pending from touched_queue t
     ), settled_queue as (
       update vy_replica_claim_extraction_queue q
          set state=case when r.pending then 'queued' else 'complete' end,
              next_attempt_at=case when r.pending then now() else q.next_attempt_at end,
              last_error_code='',completed_at=case when r.pending then null else now() end,updated_at=now()
         from remaining_queue r where q.job_id=r.job_id and q.state<>'running'
       returning q.job_id
     ) select * from finished`;

async function persistProposals(db, ownerUserId, state, run, batch, result, leaseToken) {
  const payload = result.proposals.map((proposal) => ({ ...proposal, citations: proposal.citations }));
  const rows = await db(
    CLAIM_EXTRACTION_PERSIST_SQL,
    [state.rid, ownerUserId, REPLICA_POLICY_VERSION, run.run_id, batch.input_set_hash, extractionLeaseHash(leaseToken),
      JSON.stringify(payload), payload.length, result.rejected.length,
      payload.reduce((sum, proposal) => sum + proposal.citations.length, 0)],
  );
  return rows[0] || null;
}

async function failRun(db, ownerUserId, runId, failureCode, leaseToken) {
  if (!runId) return;
  await db(`update vy_replica_claim_extraction
               set state='failed',failure_code=$3,lease_token_hash='',leased_at=null,lease_expires_at=null,updated_at=now()
             where run_id=$1::uuid and owner_user_id=$2::uuid and state<>'complete'
               and lease_token_hash=$4`, [runId, ownerUserId, failureCode, extractionLeaseHash(leaseToken)]).catch(() => []);
}

export async function extractOwnedClaims(db, ownerUserId, id, extractor, signal) {
  if (!extractor || typeof extractor.extract !== "function" || !extractor.family || !extractor.name || !extractor.version || !extractor.model)
    throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable", status: 503 });
  const state = await extractionState(db, ownerUserId, id);
  if (!state) return null;
  if (!state.readiness.ready) throw Object.assign(new Error("claim_extraction_not_ready"), { code: "claim_extraction_not_ready", status: 409, details: state.readiness });
  const batch = createExtractionBatch(state.rows);
  const leaseToken = randomBytes(32).toString("base64url");
  const run = await openRun(db, ownerUserId, state, extractor, batch, leaseToken);
  if (!run) throw Object.assign(new Error("claim_extraction_authorization_changed"), { code: "claim_extraction_authorization_changed", status: 409 });
  const evidenceIds = state.rows.map((row) => row.evidence_id);
  if (run.state === "complete" || !truth(run.acquired)) return { ...run, input_evidence_ids: evidenceIds };
  let reservation = null;
  let providerStarted = false;
  try {
    reservation = await reserveFoundrySpend(db, {
      operation: "claim_extraction",
      requestKey: run.run_id,
      adapter: extractor,
      messages: extractionMessages(batch),
    });
    if (reservation) {
      try { await beginFoundrySpend(db, reservation); }
      catch (error) {
        await releaseFoundrySpendBeforeCall(db, reservation, error).catch(() => null);
        throw error;
      }
      providerStarted = true;
    }
    const extracted = await extractor.extract({ batch, signal });
    if (!extracted?.output) throw new Error("claim_extractor_output_missing");
    const completed = await persistProposals(db, ownerUserId, state, run, batch, extracted.output, leaseToken);
    if (!completed) throw new Error("claim_extraction_persist_denied");
    if (reservation) {
      try { await settleFoundrySpend(db, reservation, extracted.usage); }
      catch (error) {
        await markFoundrySpendUncertain(db, reservation, error);
        return { ...completed, input_evidence_ids: evidenceIds, billing_state: "reconcile_required" };
      }
    }
    return { ...completed, input_evidence_ids: evidenceIds };
  } catch (error) {
    if (providerStarted) await markFoundrySpendUncertain(db, reservation, error);
    await failRun(db, ownerUserId, run.run_id, cleanCode(error), leaseToken);
    throw error;
  }
}

// A named, deterministic nearline entry point. It deliberately shares the
// content-addressed run and citation transaction above. There is no separate
// queue table or process-local promise that could pretend work survived a
// serverless invocation.
export async function sweepOwnedClaims(db, ownerUserId, id, extractor, signal) {
  return extractOwnedClaims(db, ownerUserId, id, extractor, signal);
}

export { OWNED_EXTRACTION_SQL };
