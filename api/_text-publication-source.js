// Canonical account-material reader. Adapted from private rehearsal source
// validation; it neither consumes nor creates a private-question grant.
import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {REPLICA_POLICY_VERSION as POLICY} from './_replica.js';
import {PROCESSING_SCHEMA_VERSION} from './_replica-processing/contracts.js';
import {verifyContextCanonicalEvidence} from './_experience-compiler/context-evidence.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_FORMATS=['text','pdf','docx','markdown'];
const LIVE="r.subject_mode='self' and r.policy_version=$5 and r.lifecycle in ('draft','consent_pending','enrolling','calibrating','ready','active')";
const accountSql=`select distinct on(c.scope) c.consent_id,c.receipt_hash,c.scope,c.metadata from vy_replica_consent c
 where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.scope in ('capture','storage')
 and c.method='account_attestation' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.scope,c.granted_at desc,c.consent_id desc`;
const ownSheet=`(s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id and (s.agent_id is null or s.agent_id=r.agent_id))`;
function fail(code,status=409,handle){throw Object.assign(new Error(code),{code,status,...(handle?{details:{replica_id:handle.replica_id,request_id:handle.request_id}}:{})});}
function uuid(value,code='text_publication_id_required'){const id=typeof value==='string'?value.toLowerCase():'';if(id.length!==36||!UUID.test(id))fail(code,400);return id;}
const json=value=>typeof value==='string'?JSON.parse(value):value;
const hash=value=>sha256Hex(canonicalJson(value));
export const PRIVATE_TEXT_SELECTION_SQL=`select r.replica_id,r.owner_user_id,r.lifecycle,r.subject_mode,r.policy_version,r.private_text_epoch,
 s.sheet_id,s.sheet,s.status sheet_status,s.updated_at sheet_updated_at,
 i.item_id,i.source_id,i.format,i.status item_status,i.source_name,i.authorship,i.owner_speaker,i.consent_scope,i.content_sha256,
 t.body,src.sha256 source_hash,src.state source_state,
 coalesce((select jsonb_agg(a) from (${accountSql}) a),'[]'::jsonb) account_receipts,
 coalesce((select jsonb_agg(e order by (e.value#>>'{locator,start_char}')::integer,e.evidence_id)
   from vy_replica_processing_evidence e where e.replica_id=r.replica_id and e.owner_user_id=r.owner_user_id
   and e.source_id=i.source_id and e.input_sha256=i.content_sha256 and e.evidence_type='text_span'
   and e.value#>>'{provenance,origin}'='context_locker' and e.value#>>'{provenance,context_item_id}'=i.item_id::text),'[]'::jsonb) evidence
 from vy_replica r
 left join vy_teacher_sheet s on s.sheet_id=$3::uuid and ${ownSheet}
 left join vy_context_item i on i.item_id=$4::uuid and i.replica_id=r.replica_id and i.owner_user_id=r.owner_user_id
 left join vy_context_item_text t on t.item_id=i.item_id and t.replica_id=r.replica_id and t.owner_user_id=r.owner_user_id
 left join vy_replica_source src on src.source_id=i.source_id and src.replica_id=r.replica_id and src.owner_user_id=r.owner_user_id
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and ${LIVE}`;
export const PRIVATE_TEXT_CHOICES_SQL=`select r.replica_id,r.lifecycle,
 coalesce((select jsonb_agg(d order by d.updated_at desc,d.sheet_id) from
 (select s.sheet_id,s.sheet->>'name' name,s.updated_at,s.status from vy_teacher_sheet s
 where ${ownSheet} and s.status in ('draft','validated','published')) d),'[]'::jsonb) drafts,
 coalesce((select jsonb_agg(x order by x.created_at desc,x.item_id) from
 (select i.item_id,i.source_name,i.status,i.format,i.authorship,i.source_id,i.created_at,
 exists(select 1 from vy_replica_source s where s.source_id=i.source_id and s.replica_id=i.replica_id and s.owner_user_id=i.owner_user_id and s.state='ready' and s.sha256=i.content_sha256) source_ready
 from vy_context_item i where i.replica_id=r.replica_id and i.owner_user_id=r.owner_user_id) x),'[]'::jsonb) context_items
 from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid`;
function reconstructEvidence(e){return {schema_version:PROCESSING_SCHEMA_VERSION,replica_id:e.replica_id,owner_user_id:e.owner_user_id,source_id:e.source_id,artifact_id:e.artifact_id,created_by_job_id:e.created_by_job_id,evidence_type:e.evidence_type,span:{start_ms:e.span_start_ms,end_ms:e.span_end_ms},confidence:e.confidence,value:json(e.value),input_sha256:e.input_sha256,adapter:{family:e.adapter_family,name:e.adapter_name,version:e.adapter_version},evidence_id:e.evidence_id,record_hash:e.record_hash};}
export async function readPublicationSelection(db,owner,input,frozenProjection=null){
 const rid=uuid(input.replica_id),sheetId=uuid(input.sheet_id),itemId=uuid(input.context_item_id);
 const row=(await db(PRIVATE_TEXT_SELECTION_SQL,[rid,owner,sheetId,itemId,POLICY]))[0];
 if(!row)fail('text_publication_authority_unavailable');
 if(!frozenProjection&&(!row.sheet_id||!['draft','validated','published'].includes(row.sheet_status)))fail('text_publication_saved_draft_required');
 const draft=frozenProjection||json(row.sheet);
 for(const field of ['name','subjectDomain'])if(typeof draft?.[field]!=='string'||!draft[field].trim())fail('text_publication_draft_'+field+'_required');
 if(!['physics','chemistry','maths'].includes(draft.subjectDomain))fail('text_publication_draft_domain_unsupported');
 if(!row.item_id||!['extracted','mined'].includes(row.item_status)||row.authorship!=='mine'||!TEXT_FORMATS.includes(row.format))fail('text_publication_owner_text_context_required');
 if(row.source_state!=='ready'||row.source_hash!==row.content_sha256||!row.source_id)fail('text_publication_source_unavailable');
 if(typeof row.body!=='string'||!row.body.trim())fail('text_publication_canonical_text_unavailable');
 if(row.body.length>8000)fail('text_publication_context_too_large',413);
 const account=json(row.account_receipts)||[];
 for(const scope of ['capture','storage']){
  const receipt=account.find(c=>c.scope===scope),m=receipt&&json(receipt.metadata);
  if(!m||m.owner_user_id!==owner||m.replica_id!==rid||m.method!=='account_attestation'||m.policy_version!==POLICY||m.statement_set!=='self-replica-enrollment-v1'||!Array.isArray(m.scopes)||!m.scopes.includes(scope)||['is_self','is_adult','has_source_rights','understands_synthetic_disclosure'].some(k=>m.attestations?.[k]!==true)||hash(m)!==receipt.receipt_hash)fail('text_publication_account_attestation_required');
 }
 const evidence=(json(row.evidence)||[]).map(reconstructEvidence);if(!evidence.length)fail('text_publication_canonical_evidence_required');
 let end=0;for(const e of evidence){verifyContextCanonicalEvidence(e);const locator=e.value.locator;if(locator.shape!=='contiguous'||locator.start_char!==end||row.body.slice(locator.start_char,locator.end_char)!==e.value.text||locator.canonical_text_sha256!==sha256Hex(row.body))fail('text_publication_canonical_evidence_changed');end=locator.end_char;}
 if(end!==row.body.length)fail('text_publication_canonical_evidence_incomplete');
 const snapshot={sheet_id:sheetId,context_item_id:itemId,context_hash:hash({body:row.body,format:row.format,authorship:row.authorship,owner_speaker:row.owner_speaker,consent_scope:row.consent_scope}),source_id:row.source_id,source_hash:row.source_hash,evidence_hash:hash(evidence.map(e=>({id:e.evidence_id,hash:e.record_hash}))),evidence_records:evidence.map(e=>({id:e.evidence_id,hash:e.record_hash})),account_receipts:account.map(c=>({consent_id:c.consent_id,receipt_hash:c.receipt_hash,scope:c.scope})).sort((a,b)=>a.scope.localeCompare(b.scope))};
 const snapshotHash=hash({owner_user_id:owner,replica_id:rid,policy_version:POLICY,...snapshot});
 return {row,draft,snapshot,snapshotHash,contexts:[{itemId,sourceId:row.source_id,hash:sha256Hex(row.body),body:row.body}]};
}
