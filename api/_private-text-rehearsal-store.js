// Owner-attested one-question rehearsal. This store never calls a model.
import { randomUUID, randomBytes } from 'node:crypto';
import { canonicalJson, sha256Hex } from './_provenance/contracts.js';
import { REPLICA_POLICY_VERSION as POLICY } from './_replica.js';
import { PROCESSING_SCHEMA_VERSION } from './_replica-processing/contracts.js';
import { verifyContextCanonicalEvidence } from './_experience-compiler/context-evidence.js';
import { privateTextKey, encryptPrivateText, decryptPrivateText } from './_private-text-rehearsal-crypto.js';
export const PRIVATE_TEXT_SCOPE='private_text_rehearsal';
export const PRIVATE_TEXT_STATEMENT_SET='private-text-rehearsal/v1';
export const PRIVATE_TEXT_STATEMENTS=Object.freeze([
 {id:'authorize_private_text_question',text:'Use this selected material to answer this one private question with AI.'},
 {id:'understand_ai_text_only',text:'This is an AI text test. It does not authorize voice, identity verification, training or publication.'},
 {id:'understand_private_retention_and_withdrawal',text:'Keep this private question and answer until I remove the test, its source or this AI. I can withdraw this permission.'},
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const isHash=value=>typeof value==='string'&&value.length===64&&HASH.test(value);
const TEXT_FORMATS=['text','pdf','docx','markdown'];
const OWNER_ERRORS=new Set(['rehearsal_authority_unavailable','rehearsal_permission_unavailable','rehearsal_inputs_changed','rehearsal_saved_draft_required','rehearsal_draft_name_required','rehearsal_draft_identityWho_required','rehearsal_draft_subjectDomain_required','rehearsal_draft_domain_unsupported','rehearsal_owner_text_context_required','rehearsal_context_too_large','rehearsal_account_attestation_required']);
const LIVE="r.subject_mode='self' and r.policy_version=$5 and r.lifecycle in ('draft','consent_pending','enrolling','calibrating','ready','active')";
const accountSql=`select distinct on(c.scope) c.consent_id,c.receipt_hash,c.scope,c.metadata from vy_replica_consent c
 where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.scope in ('capture','storage')
 and c.method='account_attestation' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.scope,c.granted_at desc,c.consent_id desc`;
const ownSheet=`(s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id and (s.agent_id is null or s.agent_id=r.agent_id))`;
function fail(code,status=409,handle){throw Object.assign(new Error(code),{code,status,...(handle?{details:{replica_id:handle.replica_id,request_id:handle.request_id}}:{})});}
function uuid(value,code='rehearsal_id_required'){const id=typeof value==='string'?value.toLowerCase():'';if(id.length!==36||!UUID.test(id))fail(code,400);return id;}
const json=value=>typeof value==='string'?JSON.parse(value):value;
const hash=value=>sha256Hex(canonicalJson(value));
const envOf=options=>options?.env||process.env;
const binding=(row,role,content_hash)=>({owner_user_id:row.owner_user_id,replica_id:row.replica_id,request_id:row.request_id,role,content_hash});
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
async function selection(db,owner,input){
 const rid=uuid(input.replica_id),sheetId=uuid(input.sheet_id),itemId=uuid(input.context_item_id);
 const row=(await db(PRIVATE_TEXT_SELECTION_SQL,[rid,owner,sheetId,itemId,POLICY]))[0];
 if(!row)fail('rehearsal_authority_unavailable');
 if(!row.sheet_id||!['draft','validated','published'].includes(row.sheet_status))fail('rehearsal_saved_draft_required');
 const draft=json(row.sheet);
 for(const field of ['name','identityWho','subjectDomain'])if(typeof draft?.[field]!=='string'||!draft[field].trim())fail('rehearsal_draft_'+field+'_required');
 if(!['physics','chemistry','maths'].includes(draft.subjectDomain))fail('rehearsal_draft_domain_unsupported');
 if(!row.item_id||!['extracted','mined'].includes(row.item_status)||row.authorship!=='mine'||!TEXT_FORMATS.includes(row.format))fail('rehearsal_owner_text_context_required');
 if(row.source_state!=='ready'||row.source_hash!==row.content_sha256||!row.source_id)fail('rehearsal_source_unavailable');
 if(typeof row.body!=='string'||!row.body.trim())fail('rehearsal_canonical_text_unavailable');
 if(row.body.length>8000)fail('rehearsal_context_too_large',413);
 const account=json(row.account_receipts)||[];
 for(const scope of ['capture','storage']){
  const receipt=account.find(c=>c.scope===scope),m=receipt&&json(receipt.metadata);
  if(!m||m.owner_user_id!==owner||m.replica_id!==rid||m.method!=='account_attestation'||m.policy_version!==POLICY||m.statement_set!=='self-replica-enrollment-v1'||!Array.isArray(m.scopes)||!m.scopes.includes(scope)||['is_self','is_adult','has_source_rights','understands_synthetic_disclosure'].some(k=>m.attestations?.[k]!==true)||hash(m)!==receipt.receipt_hash)fail('rehearsal_account_attestation_required');
 }
 const evidence=(json(row.evidence)||[]).map(reconstructEvidence);if(!evidence.length)fail('rehearsal_canonical_evidence_required');
 let end=0;for(const e of evidence){verifyContextCanonicalEvidence(e);const locator=e.value.locator;if(locator.shape!=='contiguous'||locator.start_char!==end||row.body.slice(locator.start_char,locator.end_char)!==e.value.text||locator.canonical_text_sha256!==sha256Hex(row.body))fail('rehearsal_canonical_evidence_changed');end=locator.end_char;}
 if(end!==row.body.length)fail('rehearsal_canonical_evidence_incomplete');
 const snapshot={sheet_id:sheetId,sheet_hash:hash(draft),context_item_id:itemId,context_hash:hash({body:row.body,format:row.format,authorship:row.authorship,owner_speaker:row.owner_speaker,consent_scope:row.consent_scope}),source_id:row.source_id,source_hash:row.source_hash,evidence_hash:hash(evidence.map(e=>({id:e.evidence_id,hash:e.record_hash}))),evidence_records:evidence.map(e=>({id:e.evidence_id,hash:e.record_hash})),authority_epoch:String(row.private_text_epoch),account_receipts:account.map(c=>({consent_id:c.consent_id,receipt_hash:c.receipt_hash,scope:c.scope})).sort((a,b)=>a.scope.localeCompare(b.scope))};
 const snapshotHash=hash({owner_user_id:owner,replica_id:rid,policy_version:POLICY,...snapshot});
 return {row,draft,snapshot,snapshotHash,contexts:[{itemId,sourceId:row.source_id,hash:sha256Hex(row.body),body:row.body}]};
}
export async function readPrivateTextReadiness(db,owner,input,options={}){
 const rid=uuid(input.replica_id),row=(await db(PRIVATE_TEXT_CHOICES_SQL,[rid,owner]))[0];if(!row)fail('replica_not_found',404);
 const blockers=[];let selected=null;
 if(['paused','revoked','purging'].includes(row.lifecycle))blockers.push({code:'rehearsal_stopped',responsibility:'owner'});
 try{privateTextKey(envOf(options));}catch{blockers.push({code:'rehearsal_encryption_unavailable',responsibility:'platform'});}
 if(input.sheet_id&&input.context_item_id){try{const s=await selection(db,owner,input);selected={...s.snapshot,snapshot_hash:s.snapshotHash,material:{draft:{name:s.draft.name,identityWho:s.draft.identityWho,subjectDomain:s.draft.subjectDomain},context:{source_name:s.row.source_name,format:s.row.format,body:s.row.body}}};delete selected.evidence_records;delete selected.account_receipts;}catch(e){blockers.push({code:e.code||'rehearsal_read_unavailable',responsibility:OWNER_ERRORS.has(e.code)?'owner':'platform'});}}
 else blockers.push({code:'rehearsal_select_draft_and_context',responsibility:'owner'});
 return {replica_id:rid,state:blockers.some(b=>b.code==='rehearsal_stopped')?'stopped':blockers.some(b=>b.responsibility==='platform')?'unavailable':blockers.length?'needs_input':'ready',blockers,drafts:json(row.drafts)||[],context_items:(json(row.context_items)||[]).map(i=>({...i,eligible:['extracted','mined'].includes(i.status)&&i.authorship==='mine'&&i.source_ready&&TEXT_FORMATS.includes(i.format),reason:i.authorship!=='mine'?'rehearsal_owner_text_context_required':!i.source_ready?'rehearsal_source_unavailable':null})),selected,statement_set:PRIVATE_TEXT_STATEMENT_SET,statements:PRIVATE_TEXT_STATEMENTS,grant_scope:PRIVATE_TEXT_SCOPE,can_ask:!blockers.length};
}
export const PRIVATE_TEXT_REQUEST_READ_SQL=`select h.*,c.metadata receipt_metadata,c.receipt_hash live_receipt_hash,c.expires_at,c.revoked_at,c.scope consent_scope,c.method consent_method,c.policy_version consent_policy,
 s.state spend_state from vy_private_text_rehearsal h join vy_replica r on r.replica_id=h.replica_id and r.owner_user_id=h.owner_user_id
 left join vy_replica_consent c on c.consent_id=h.consent_id and c.replica_id=h.replica_id and c.owner_user_id=h.owner_user_id
 left join vy_provider_spend s on s.reservation_id=h.reservation_id and s.budget_id=h.budget_id and s.request_hash=h.spend_request_hash
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.request_id=$3::uuid`;
async function requestRow(db,owner,input){return (await db(PRIVATE_TEXT_REQUEST_READ_SQL,[uuid(input.replica_id),owner,uuid(input.request_id)]))[0]||null;}
function wire(row,answer){
 if(row.state==='withdrawn'&&row.consent_id==null)return {replica_id:row.replica_id,request_id:row.request_id,state:'withdrawn',billing_state:'unknown',can_voice:false,created_at:row.created_at};
 const snapshot=json(row.snapshot),spend=row.spend_state==='released'?'not_started':row.spend_state;return {replica_id:row.replica_id,request_id:row.request_id,state:row.state==='admitted'||row.state==='dispatched'?'pending':row.state,consent:{consent_id:row.consent_id,receipt_hash:row.receipt_hash,statement_set:PRIVATE_TEXT_STATEMENT_SET,expires_at:row.expires_at},source:{sheet_id:row.sheet_id,sheet_hash:snapshot.sheet_hash,context_item_id:row.context_item_id,source_id:row.source_id,source_hash:snapshot.source_hash,evidence_hash:snapshot.evidence_hash},billing_state:spend||row.billing_state,failure_code:row.failure_code||undefined,can_voice:false,created_at:row.created_at,...(answer!==undefined?{answer}:{})};
}
async function currentAuthority(db,owner,row){
 const m=json(row.receipt_metadata);if(row.revoked_at||!row.expires_at||new Date(row.expires_at).getTime()<=Date.now()||row.consent_scope!==PRIVATE_TEXT_SCOPE||row.consent_method!=='account_attestation'||row.consent_policy!==POLICY||m?.statement_set!==PRIVATE_TEXT_STATEMENT_SET||m.owner_user_id!==owner||m.replica_id!==row.replica_id||m.request_id!==row.request_id||m.request_hash!==row.request_hash||m.snapshot_hash!==row.snapshot_hash||row.live_receipt_hash!==row.receipt_hash||PRIVATE_TEXT_STATEMENTS.some(s=>m.attestations?.[s.id]!==true)||hash(m)!==row.receipt_hash)fail('rehearsal_permission_unavailable',409,row);
 const s=await selection(db,owner,{replica_id:row.replica_id,sheet_id:row.sheet_id,context_item_id:row.context_item_id});if(s.snapshotHash!==row.snapshot_hash||String(s.snapshot.authority_epoch)!==String(row.authority_epoch))fail('rehearsal_inputs_changed',409,row);return s;
}
export async function readPrivateTextRehearsal(db,owner,input,options={}){
 const row=await requestRow(db,owner,input);if(!row)fail('rehearsal_not_found',404);
 if(row.state==='withdrawn'||row.state==='blocked')return wire(row);
 // A stale completed request may review current guidance, but cannot deliver its
 // old answer. Receipt and source validation above the snapshot comparison still apply.
 try{await currentAuthority(db,owner,row);}catch(e){if(OWNER_ERRORS.has(e.code))return {...wire(row),state:'blocked',failure_code:e.code,...(row.state==='complete'&&e.code==='rehearsal_inputs_changed'?{can_review_teaching:true}:{})};fail('rehearsal_read_unavailable',503,row);}
 if(row.state!=='complete')return wire(row);
 return wire(row,decryptPrivateText(json(row.answer_envelope),binding(row,'answer',row.answer_hash),envOf(options)));
}

// Source first, replica second matches the actual context producer/removal lock
// order. The direct UPDATE predicate rechecks the epoch after a concurrent
// writer; a SELECT snapshot alone would not establish that CAS.
const AUTHORITY_FENCE=`source_gate as materialized (
 select src.source_id from vy_replica_source src
 where src.source_id=$4::uuid and src.replica_id=$1::uuid and src.owner_user_id=$2::uuid
 and src.state='ready' and src.sha256=$7::jsonb->>'source_hash' for update of src
), owned as (
 update vy_replica r set private_text_epoch=r.private_text_epoch
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and ${LIVE}
 and r.private_text_epoch=$6::bigint and exists(select 1 from source_gate)
 and exists(select 1 from vy_teacher_sheet s where s.sheet_id=($7::jsonb->>'sheet_id')::uuid
   and ${ownSheet} and s.status in ('draft','validated','published') and s.sheet=$8::jsonb)
 and exists(select 1 from vy_context_item i join vy_context_item_text t on t.item_id=i.item_id
   and t.replica_id=i.replica_id and t.owner_user_id=i.owner_user_id
   where i.item_id=($7::jsonb->>'context_item_id')::uuid and i.replica_id=r.replica_id and i.owner_user_id=r.owner_user_id
   and i.source_id=$4::uuid and i.content_sha256=$7::jsonb->>'source_hash'
   and i.authorship='mine' and i.status in ('extracted','mined') and t.body=$9)
 and not exists(select 1 from jsonb_array_elements($7::jsonb->'account_receipts') a where not exists(
   select 1 from vy_replica_consent c where c.consent_id=(a->>'consent_id')::uuid
   and c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.scope=a->>'scope'
   and c.receipt_hash=a->>'receipt_hash' and c.method='account_attestation' and c.policy_version=$5
   and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())))
 and not exists(select 1 from jsonb_array_elements($7::jsonb->'evidence_records') e where not exists(
   select 1 from vy_replica_processing_evidence p where p.evidence_id=(e->>'id')::uuid
   and p.replica_id=r.replica_id and p.owner_user_id=r.owner_user_id and p.source_id=$4::uuid
   and p.record_hash=e->>'hash' and p.input_sha256=$7::jsonb->>'source_hash'))
 returning r.replica_id,r.owner_user_id
)`;
const receiptLive=`exists(select 1 from vy_replica_consent c where c.consent_id=h.consent_id
 and c.replica_id=h.replica_id and c.owner_user_id=h.owner_user_id and c.receipt_hash=h.receipt_hash
 and c.scope='private_text_rehearsal' and c.method='account_attestation' and c.policy_version=$5
 and c.revoked_at is null and c.expires_at>now())`;
function fenceArgs(owner,input,s){return [uuid(input.replica_id),owner,uuid(input.request_id),s.snapshot.source_id,POLICY,s.snapshot.authority_epoch,JSON.stringify(s.snapshot),JSON.stringify(s.draft),s.row.body];}
function questionInput(input){
 const question=typeof input.question==='string'?input.question.trim():'';
 if(!question||question.length>2000)fail('rehearsal_question_invalid',400);
 if(!isHash(input.expected_snapshot_hash))fail('rehearsal_snapshot_required',400);
 if(input.statement_set!==PRIVATE_TEXT_STATEMENT_SET||PRIVATE_TEXT_STATEMENTS.some(s=>input.attestations?.[s.id]!==true))fail('rehearsal_explicit_attestations_required',400);
 const payload={replica_id:uuid(input.replica_id),request_id:uuid(input.request_id),sheet_id:uuid(input.sheet_id),context_item_id:uuid(input.context_item_id),snapshot_hash:input.expected_snapshot_hash,question_hash:sha256Hex(question),statement_set:PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))};
 return {question,payload,requestHash:hash(payload)};
}
export const PRIVATE_TEXT_ADMIT_SQL=`with ${AUTHORITY_FENCE}, granted as (
 insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,granted_at,expires_at,metadata)
 select $10::uuid,replica_id,owner_user_id,'private_text_rehearsal','account_attestation',$5,$11,$12::timestamptz,$13::timestamptz,$14::jsonb from owned
 on conflict do nothing returning consent_id
), admitted as (
 insert into vy_private_text_rehearsal(request_id,replica_id,owner_user_id,consent_id,receipt_hash,request_hash,question_hash,
 sheet_id,context_item_id,source_id,authority_epoch,snapshot_hash,snapshot,question_envelope)
 select $3::uuid,$1::uuid,$2::uuid,g.consent_id,$11,$15,$16,($7::jsonb->>'sheet_id')::uuid,
 ($7::jsonb->>'context_item_id')::uuid,$4::uuid,$6::bigint,$17,$7::jsonb,$18::jsonb from granted g
 returning request_id
) select request_id from admitted`;
export async function admitPrivateTextRehearsal(db,owner,input,options={}){
 const q=questionInput(input),existing=await requestRow(db,owner,input);
 if(existing?.state==='withdrawn'&&existing.request_hash==null)return {created:false,request:wire(existing),compilerInput:null};
 if(existing){if(existing.request_hash!==q.requestHash)fail('rehearsal_request_conflict',409,existing);return {created:false,request:await readPrivateTextRehearsal(db,owner,input,options),compilerInput:null};}
 privateTextKey(envOf(options));
 const s=await selection(db,owner,input);if(s.snapshotHash!==input.expected_snapshot_hash)fail('rehearsal_inputs_changed',409,input);
 const now=options.now?new Date(options.now):new Date(),expires=new Date(now.getTime()+30*86400000),consentId=randomUUID();
 const metadata={receipt_format:'vyakti-consent-v1',canonicalization:'vyakti-canonical-json/v1',hash_algorithm:'sha256',statement_set:PRIVATE_TEXT_STATEMENT_SET,
 owner_user_id:owner,replica_id:q.payload.replica_id,request_id:q.payload.request_id,request_hash:q.requestHash,
 scopes:[PRIVATE_TEXT_SCOPE],method:'account_attestation',policy_version:POLICY,basis:'owner_question_attestation_v1',snapshot_hash:s.snapshotHash,
 granted_at:now.toISOString(),expires_at:expires.toISOString(),nonce:randomBytes(24).toString('hex'),attestations:q.payload.attestations};
 const questionEnvelope=encryptPrivateText(q.question,binding({owner_user_id:owner,...q.payload},'question',q.payload.question_hash),envOf(options));
 let rows;
 try{rows=await db(PRIVATE_TEXT_ADMIT_SQL,[...fenceArgs(owner,input,s),consentId,hash(metadata),now.toISOString(),expires.toISOString(),JSON.stringify(metadata),q.requestHash,q.payload.question_hash,s.snapshotHash,JSON.stringify(questionEnvelope)]);}
 catch(e){if(e.code!=='23505')fail('rehearsal_admission_uncertain',503,input);rows=[];}
 if(!rows.length){const replay=await requestRow(db,owner,input);if(replay?.state==='withdrawn'&&replay.request_hash==null)return {created:false,request:wire(replay),compilerInput:null};if(replay&&replay.request_hash===q.requestHash)return {created:false,request:await readPrivateTextRehearsal(db,owner,input,options),compilerInput:null};fail(replay?'rehearsal_request_conflict':'rehearsal_admission_blocked',409,input);}
 // Confirm the durable request before giving a caller permission to reserve.
 const confirmed=await requestRow(db,owner,input);
 if(confirmed?.state==='withdrawn'&&confirmed.request_hash==null)return {created:false,request:wire(confirmed),compilerInput:null};
 if(!confirmed||confirmed.request_hash!==q.requestHash)fail('rehearsal_admission_uncertain',503,input);
 if(confirmed.state!=='admitted')return {created:false,request:await readPrivateTextRehearsal(db,owner,input,options),compilerInput:null};
 return {created:true,request:wire(confirmed),compilerInput:{authority:{scope:PRIVATE_TEXT_SCOPE,basis:'owner_question_attestation_v1',ownerId:owner,replicaId:q.payload.replica_id,requestId:q.payload.request_id,sheetId:s.snapshot.sheet_id,sheetHash:s.snapshot.sheet_hash,receiptId:consentId},draft:s.draft,contexts:s.contexts,question:q.question}};
}
export const PRIVATE_TEXT_CLAIM_SQL=`with ${AUTHORITY_FENCE}
 update vy_private_text_rehearsal h set state='dispatched',dispatch_token_hash=$10,dispatched_at=now(),
 reservation_id=$11::uuid,budget_id=$12,spend_request_hash=$13,provider=$14::jsonb,billing_state='reserved',updated_at=now()
 from owned o where h.request_id=$3::uuid and h.replica_id=o.replica_id and h.owner_user_id=o.owner_user_id
 and h.state='admitted' and h.authority_epoch=$6::bigint and ${receiptLive}
 and exists(select 1 from vy_provider_spend p where p.reservation_id=$11::uuid and p.budget_id=$12 and p.request_hash=$13
 and p.operation='dialogue' and p.unit_kind='tokens' and p.state='reserved'
 and p.provider_family=$14::jsonb->>'family' and p.provider_name=$14::jsonb->>'name'
 and p.provider_version=$14::jsonb->>'version' and p.model=$14::jsonb->>'model')
 returning h.request_id`;
export async function claimPrivateTextRehearsal(db,owner,input,options={}){
 privateTextKey(envOf(options));const row=await requestRow(db,owner,input);if(!row)fail('rehearsal_not_found',404);
 if(row.state!=='admitted')fail('rehearsal_dispatch_unavailable',409,row);
 const s=await currentAuthority(db,owner,row),p=input.provider,v=input.reservation;
 if(!p||['family','name','version','model'].some(k=>typeof p[k]!=='string'||!p[k])||!isHash(p.prompt_hash))fail('rehearsal_provider_invalid',500,row);
 const spendHash=hash({operation:'dialogue',request_key:`private-text-rehearsal:${row.request_id}`,provider_family:p.family,provider_name:p.name,provider_version:p.version,model:p.model});
 if(!v||v.request_hash!==spendHash||v.state!=='reserved'||typeof v.reservation_id!=='string'||v.reservation_id.length!==36||!UUID.test(v.reservation_id)||typeof v.budget_id!=='string')fail('rehearsal_reservation_invalid',503,row);
 const token=randomBytes(32).toString('hex');let rows;
 try{rows=await db(PRIVATE_TEXT_CLAIM_SQL,[...fenceArgs(owner,input,s),sha256Hex(token),v.reservation_id,v.budget_id,v.request_hash,JSON.stringify({family:p.family,name:p.name,version:p.version,model:p.model,prompt_hash:p.prompt_hash})]);}
 catch{fail('rehearsal_dispatch_uncertain',503,row);}
 if(!rows.length)fail('rehearsal_dispatch_unavailable',409,row);
 return {dispatch_token:token,request:{...wire(row),state:'pending',billing_state:'reserved'}};
}
export const PRIVATE_TEXT_COMPLETE_SQL=`with ${AUTHORITY_FENCE}
 update vy_private_text_rehearsal h set state='complete',answer_envelope=$11::jsonb,answer_hash=$12,
 raw_envelope=$13::jsonb,raw_hash=$14,gate_sidecar=$15::jsonb,billing_state=$16,updated_at=now()
 from owned o where h.request_id=$3::uuid and h.replica_id=o.replica_id and h.owner_user_id=o.owner_user_id
 and h.state='dispatched' and h.dispatch_token_hash=$10 and h.authority_epoch=$6::bigint and ${receiptLive}
 and exists(select 1 from vy_provider_spend p where p.reservation_id=h.reservation_id and p.budget_id=h.budget_id
   and p.request_hash=h.spend_request_hash and p.operation='dialogue' and p.state=$16 and p.state in ('settled','reconcile_required'))
 returning h.request_id`;
export async function completePrivateTextRehearsal(db,owner,input,options={}){
 const row=await requestRow(db,owner,input);if(!row)fail('rehearsal_not_found',404);
 if(row.state!=='dispatched'||sha256Hex(String(input.dispatch_token||''))!==row.dispatch_token_hash)fail('rehearsal_dispatch_unavailable',409,row);
 const s=await currentAuthority(db,owner,row),answer=input.answer,raw=typeof input.raw_output==='string'?input.raw_output:JSON.stringify(input.raw_output);
 if(typeof answer!=='string'||!answer.trim()||answer.length>4000||typeof raw!=='string'||raw.length>32000)fail('rehearsal_output_invalid',500,row);
 if(!['settled','reconcile_required'].includes(input.billing_state))fail('rehearsal_billing_unresolved',503,row);
 const ah=sha256Hex(answer),rh=sha256Hex(raw);
 // The sidecar is deliberately content-free. Raw model output is encrypted.
 const gate={version:'private-text-gate/v1',gated:input.gate?.gated===true,finding_count:Number.isInteger(input.gate?.finding_count)&&input.gate.finding_count>=0?input.gate.finding_count:0};
 if(!gate.gated)fail('rehearsal_output_gate_required',500,row);
 let rows;try{rows=await db(PRIVATE_TEXT_COMPLETE_SQL,[...fenceArgs(owner,input,s),row.dispatch_token_hash,JSON.stringify(encryptPrivateText(answer,binding(row,'answer',ah),envOf(options))),ah,JSON.stringify(encryptPrivateText(raw,binding(row,'raw',rh),envOf(options))),rh,JSON.stringify(gate),input.billing_state]);}catch{fail('rehearsal_commit_uncertain',503,row);}
 if(!rows.length)fail('rehearsal_commit_blocked',409,row);
 return readPrivateTextRehearsal(db,owner,input,options);
}
export const PRIVATE_TEXT_FAIL_SQL=`update vy_private_text_rehearsal h set state=$5,billing_state=$6,failure_code=$7,updated_at=now()
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.request_id=$3::uuid
 and ((h.state='admitted' and $4::text is null) or (h.state='dispatched' and h.dispatch_token_hash=$4))
 returning h.request_id`;
export async function failPrivateTextRehearsal(db,owner,input){
 const code=/^[a-z][a-z0-9_]{0,95}$/.test(input.failure_code||'')?input.failure_code:'rehearsal_failed';
 const billing=['not_started','reserved','in_flight','settled','reconcile_required'].includes(input.billing_state)?input.billing_state:'reconcile_required';
 const state=['in_flight','reconcile_required'].includes(billing)||code.includes('uncertain')?'uncertain':'blocked';
 await db(PRIVATE_TEXT_FAIL_SQL,[uuid(input.replica_id),owner,uuid(input.request_id),input.dispatch_token?sha256Hex(input.dispatch_token):null,state,billing,code]);
 const row=await requestRow(db,owner,input);if(!row)fail('rehearsal_not_found',404);return wire(row);
}
export const PRIVATE_TEXT_WITHDRAW_SQL=`with owned as (
 update vy_replica r set private_text_epoch=r.private_text_epoch
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid returning r.replica_id
)
 insert into vy_private_text_rehearsal as h(request_id,replica_id,owner_user_id,state,billing_state,failure_code)
 select $3::uuid,o.replica_id,$2::uuid,'withdrawn','unknown','rehearsal_withdrawn' from owned o where true
 on conflict(request_id) do update set state='withdrawn',question_envelope=null,raw_envelope=null,answer_envelope=null,
 gate_sidecar='{}'::jsonb,failure_code='rehearsal_withdrawn',updated_at=now()
 where h.replica_id=excluded.replica_id and h.owner_user_id=excluded.owner_user_id
 returning h.request_id`;
// A fresh statement is required: an UPSERT may see a conflicting admission
// committed after its statement snapshot, while a sibling consent UPDATE
// cannot see that newly committed receipt. The terminal PK already blocks all
// dispatch/commit/replay before this metadata revocation is attempted.
export const PRIVATE_TEXT_CANCEL_RECEIPTS_SQL=`update vy_replica_consent c set revoked_at=coalesce(c.revoked_at,now())
 where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='private_text_rehearsal'
 and c.metadata->>'request_id'=$3::uuid::text
 and exists(select 1 from vy_private_text_rehearsal h where h.request_id=$3::uuid and h.replica_id=c.replica_id
   and h.owner_user_id=c.owner_user_id and h.state='withdrawn')
 returning c.consent_id`;
export async function withdrawPrivateTextRehearsal(db,owner,input){
 const params=[uuid(input.replica_id),owner,uuid(input.request_id)];let rows;
 try{rows=await db(PRIVATE_TEXT_WITHDRAW_SQL,params);}catch{fail('rehearsal_cancellation_uncertain',503,input);}
 if(!rows.length)fail('rehearsal_not_found',404);
 try{await db(PRIVATE_TEXT_CANCEL_RECEIPTS_SQL,params);}catch{fail('rehearsal_receipt_revocation_uncertain',503,input);}
 let row;try{row=await requestRow(db,owner,input);}catch{fail('rehearsal_cancellation_read_uncertain',503,input);}
 if(!row||row.state!=='withdrawn')fail('rehearsal_cancellation_read_uncertain',503,input);
 const result=wire(row);return {replica_id:result.replica_id,request_id:result.request_id,state:'withdrawn',private_payload_erased:true,billing_state:result.billing_state,can_voice:false,created_at:result.created_at};
}
