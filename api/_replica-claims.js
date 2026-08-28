import { createExtractionBatch, extractionMessages, CLAIM_EXTRACTION_SCHEMA } from "./_claim-extraction/contracts.js";
import { beginFoundrySpend, markFoundrySpendUncertain, releaseFoundrySpendBeforeCall, reserveFoundrySpend, settleFoundrySpend } from "./_provider-budget.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

const ELIGIBLE_TRANSCRIPTS_SQL = `with latest_speaker_decision as (
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
 where e.replica_id=$1::uuid and e.owner_user_id=$2::uuid and e.evidence_type='transcript_span'
   and e.confidence>=0.55 and length(e.value->>'text') between 1 and 8000
   and s.contains_third_parties=false and s.state in ('processing','ready')
   and lower(e.adapter_family||' '||e.adapter_name||' '||e.adapter_version) !~ '(fake|fixture|test|mock)'
   and exists (
     select 1 from vy_replica_processing_evidence speaker
     join latest_speaker_decision d on d.evidence_id=speaker.evidence_id and d.decision='accepted'
      where speaker.replica_id=e.replica_id and speaker.owner_user_id=e.owner_user_id
        and speaker.source_id=e.source_id and speaker.evidence_type='speaker_segment'
        and coalesce((speaker.value->>'target_likelihood')::double precision,0)>=0.8
        and speaker.span_start_ms<e.span_end_ms and speaker.span_end_ms>e.span_start_ms
        and lower(speaker.adapter_family||' '||speaker.adapter_name||' '||speaker.adapter_version) !~ '(fake|fixture|test|mock)'
   )
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

function extractionReadiness(owned, rows) {
  const blockers = [];
  if (!truth(owned?.transcription_consent)) blockers.push("transcription_consent_required");
  if (!truth(owned?.training_consent)) blockers.push("training_consent_required");
  if (!rows.length) blockers.push("reviewed_subject_transcript_required");
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
  const [ownedRows, transcripts, runs] = await Promise.all([
    db(OWNED_EXTRACTION_SQL, [rid, ownerUserId, REPLICA_POLICY_VERSION]),
    db(ELIGIBLE_TRANSCRIPTS_SQL, [rid, ownerUserId]),
    db(`select x.run_id,x.state,x.proposed_count,x.rejected_count,x.attempt,x.failure_code,x.created_at,x.completed_at
          from vy_replica_claim_extraction x join vy_replica r on r.replica_id=x.replica_id and r.owner_user_id=$2::uuid
         where x.replica_id=$1::uuid and x.owner_user_id=$2::uuid order by x.created_at desc limit 20`, [rid, ownerUserId]),
  ]);
  const owned = ownedRows[0];
  if (!owned) return null;
  const selected = boundedRows(transcripts);
  return { rid, owned, rows: selected, readiness: extractionReadiness(owned, selected), runs };
}

export async function ownedClaimExtractionStatus(db, ownerUserId, id) {
  const state = await extractionState(db, ownerUserId, id);
  if (!state) return null;
  return {
    replica_id: state.rid,
    readiness: state.readiness,
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

async function openRun(db, ownerUserId, state, extractor, batch) {
  const consentIds = Array.isArray(state.owned.consent_ids) ? state.owned.consent_ids : [];
  const rows = await db(
    `with authorized as (${OWNED_EXTRACTION_SQL})
     insert into vy_replica_claim_extraction
       (replica_id,owner_user_id,schema_version,provider_family,provider_name,provider_version,model,input_set_hash,consent_ids,state)
     select replica_id,$2::uuid,$4,$5,$6,$7,$8,$9,$10::uuid[],'extracting' from authorized
      where transcription_consent=true and training_consent=true and cardinality(consent_ids)>=2
     on conflict (replica_id,owner_user_id,schema_version,provider_name,provider_version,model,input_set_hash)
       do update set state=case when vy_replica_claim_extraction.state='complete' then 'complete' else 'extracting' end,
                     attempt=case when vy_replica_claim_extraction.state='complete' then vy_replica_claim_extraction.attempt else vy_replica_claim_extraction.attempt+1 end,
                     failure_code=case when vy_replica_claim_extraction.state='complete' then vy_replica_claim_extraction.failure_code else '' end,
                     updated_at=now()
     returning run_id,state,proposed_count,rejected_count,attempt,created_at,completed_at`,
    [state.rid, ownerUserId, REPLICA_POLICY_VERSION, CLAIM_EXTRACTION_SCHEMA, extractor.family, extractor.name, extractor.version, extractor.model, batch.input_set_hash, consentIds],
  );
  return rows[0] || null;
}

async function persistProposals(db, ownerUserId, state, run, batch, result) {
  const payload = result.proposals.map((proposal) => ({ ...proposal, citations: proposal.citations }));
  const rows = await db(
    `with authorized as (${OWNED_EXTRACTION_SQL}), active_run as (
       select x.run_id,x.replica_id,x.owner_user_id from vy_replica_claim_extraction x join authorized a
         on a.replica_id=x.replica_id
        where x.run_id=$4::uuid and x.owner_user_id=$2::uuid and x.input_set_hash=$5 and x.state='extracting'
          and a.transcription_consent=true and a.training_consent=true
     ), proposal_rows as (
       select p.domain,p.key,p.body,p.origin,p.confidence,p.sensitive,p.t_valid_from,p.t_valid_to,
              array(select source_id::uuid from jsonb_array_elements_text(p.source_ids) as source_ids(source_id)) as source_ids,
              p.proposal_hash,p.citations
         from active_run r cross join lateral jsonb_to_recordset($6::jsonb) as p(
         domain text,key text,body text,origin text,confidence double precision,sensitive boolean,
         t_valid_from timestamptz,t_valid_to timestamptz,source_ids jsonb,proposal_hash text,citations jsonb
       )
     ), inserted_claims as (
       insert into vy_replica_claim
         (replica_id,owner_user_id,domain,key,body,origin,confidence,status,source_ids,sensitive,
          t_valid_from,t_valid_to,proposal_hash,extractor_run_id)
       select r.replica_id,r.owner_user_id,p.domain,p.key,p.body,p.origin,p.confidence,'proposed',p.source_ids,p.sensitive,
              p.t_valid_from,p.t_valid_to,p.proposal_hash,r.run_id
         from active_run r cross join proposal_rows p
       on conflict (replica_id,owner_user_id,proposal_hash) where proposal_hash is not null do nothing
       returning claim_id,replica_id,owner_user_id,proposal_hash
     ), claim_rows as (
       select * from inserted_claims
       union all
       select c.claim_id,c.replica_id,c.owner_user_id,c.proposal_hash from vy_replica_claim c
       join active_run r on r.replica_id=c.replica_id and r.owner_user_id=c.owner_user_id
       join proposal_rows p on p.proposal_hash=c.proposal_hash
     ), citation_rows as (
       select c.claim_id,c.replica_id,c.owner_user_id,
              (cite->>'evidence_id')::uuid as evidence_id,(cite->>'source_id')::uuid as source_id,
              (cite->>'start_char')::integer as start_char,(cite->>'end_char')::integer as end_char,
              cite->>'quote_hash' as quote_hash,(cite->>'entailment')::double precision as entailment
         from proposal_rows p join claim_rows c on c.proposal_hash=p.proposal_hash
         cross join lateral jsonb_array_elements(p.citations) cite
     ), inserted_citations as (
       insert into vy_replica_claim_citation
         (claim_id,replica_id,owner_user_id,evidence_id,source_id,start_char,end_char,quote_hash,entailment)
       select x.claim_id,x.replica_id,x.owner_user_id,x.evidence_id,x.source_id,x.start_char,x.end_char,x.quote_hash,x.entailment
         from citation_rows x join vy_replica_processing_evidence e
           on e.evidence_id=x.evidence_id and e.replica_id=x.replica_id and e.owner_user_id=x.owner_user_id
          and e.source_id=x.source_id and e.evidence_type='transcript_span'
        where x.end_char<=length(e.value->>'text')
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
       update vy_replica_claim_extraction x set state='complete',proposed_count=$7::int4,rejected_count=$8::int4,
              failure_code='',completed_at=now(),updated_at=now()
         from active_run r where x.run_id=r.run_id and (select count(*) from covered_citations)=$9
       returning x.run_id,x.state,x.proposed_count,x.rejected_count,x.attempt,x.created_at,x.completed_at
     ) select * from finished`,
    [state.rid, ownerUserId, REPLICA_POLICY_VERSION, run.run_id, batch.input_set_hash, JSON.stringify(payload), payload.length, result.rejected.length,
      payload.reduce((sum, proposal) => sum + proposal.citations.length, 0)],
  );
  return rows[0] || null;
}

async function failRun(db, ownerUserId, runId, failureCode) {
  if (!runId) return;
  await db(`update vy_replica_claim_extraction set state='failed',failure_code=$3,updated_at=now()
             where run_id=$1::uuid and owner_user_id=$2::uuid and state<>'complete'`, [runId, ownerUserId, failureCode]).catch(() => []);
}

export async function extractOwnedClaims(db, ownerUserId, id, extractor, signal) {
  if (!extractor || typeof extractor.extract !== "function" || !extractor.family || !extractor.name || !extractor.version || !extractor.model)
    throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable", status: 503 });
  const state = await extractionState(db, ownerUserId, id);
  if (!state) return null;
  if (!state.readiness.ready) throw Object.assign(new Error("claim_extraction_not_ready"), { code: "claim_extraction_not_ready", status: 409, details: state.readiness });
  const batch = createExtractionBatch(state.rows);
  const run = await openRun(db, ownerUserId, state, extractor, batch);
  if (!run) throw Object.assign(new Error("claim_extraction_authorization_changed"), { code: "claim_extraction_authorization_changed", status: 409 });
  if (run.state === "complete") return run;
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
    const completed = await persistProposals(db, ownerUserId, state, run, batch, extracted.output);
    if (!completed) throw new Error("claim_extraction_persist_denied");
    if (reservation) {
      try { await settleFoundrySpend(db, reservation, extracted.usage); }
      catch (error) {
        await markFoundrySpendUncertain(db, reservation, error);
        return { ...completed, billing_state: "reconcile_required" };
      }
    }
    return completed;
  } catch (error) {
    if (providerStarted) await markFoundrySpendUncertain(db, reservation, error);
    await failRun(db, ownerUserId, run.run_id, cleanCode(error));
    throw error;
  }
}

export { ELIGIBLE_TRANSCRIPTS_SQL, OWNED_EXTRACTION_SQL };
