// An explicit owner edit to one existing private compiler field. No generation.
import {canonicalJson,sha256Hex} from './_provenance/contracts.js';
import {readPrivateTextRehearsal} from './_private-text-rehearsal-store.js';
import {compilePrivateExpertRehearsal} from './_engine.gen.js';

const FIELD='explanationOrder',POLICY='replica-self-v1';
const hash=value=>sha256Hex(canonicalJson(value));
const json=value=>typeof value==='string'?JSON.parse(value):value;
function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
function uuid(value){if(typeof value!=='string'||value.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('private_refinement_id_required',400);return value.toLowerCase();}
function scope(input){return {replica_id:uuid(input?.replica_id),request_id:uuid(input?.request_id)};}
function text(value){if(typeof value!=='string'||!value.trim()||value.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))fail('private_refinement_value_invalid',400);return value;}

export const PRIVATE_REFINEMENT_REVIEW_SQL=`select r.replica_id,r.owner_user_id,r.private_text_epoch,
 h.request_id,h.source_id,h.context_item_id,h.consent_id,h.snapshot,h.snapshot_hash,
 s.sheet_id,s.sheet,s.version,s.updated_at,t.body
 from vy_private_text_rehearsal h
 join vy_replica r on r.replica_id=h.replica_id and r.owner_user_id=h.owner_user_id
 join vy_teacher_sheet s on s.sheet_id=h.sheet_id and s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id
  and (s.agent_id is null or s.agent_id=r.agent_id) and s.status='draft'
 join vy_context_item_text t on t.item_id=h.context_item_id and t.replica_id=r.replica_id and t.owner_user_id=r.owner_user_id
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.request_id=$3::uuid and h.state='complete'
 and r.subject_mode='self' and r.policy_version=$4 and r.lifecycle in ('draft','consent_pending','enrolling','calibrating','ready','active')`;

// Lock only first, then perform the direct epoch CAS. Withdrawal deliberately
// preserves the replica epoch, so its completed-request predicate needs its own
// current row lock. Ordering stays source -> replica -> request -> sheet.
export const PRIVATE_REFINEMENT_SAVE_SQL=`with source_lock as materialized (
 select src.source_id from vy_replica_source src
 where src.source_id=$8::uuid and src.replica_id=$1::uuid and src.owner_user_id=$2::uuid
 and src.state='ready' and src.sha256=$9 for update of src
), replica_lock as materialized (
 select r.replica_id from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and exists(select 1 from source_lock) for update of r
), request_lock as materialized (
 select h.request_id from vy_private_text_rehearsal h
 where h.request_id=$3::uuid and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid
 and h.state='complete' and h.sheet_id=$4::uuid and h.source_id=$8::uuid and h.snapshot_hash=$10
 and exists(select 1 from replica_lock)
 and exists(select 1 from vy_replica_consent c where c.consent_id=h.consent_id
  and c.replica_id=h.replica_id and c.owner_user_id=h.owner_user_id and c.receipt_hash=h.receipt_hash
  and c.scope='private_text_rehearsal' and c.method='account_attestation' and c.policy_version=$11
  and c.revoked_at is null and c.expires_at>now())
 for update of h
), owned as (
 update vy_replica r set private_text_epoch=r.private_text_epoch+1
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.private_text_epoch=$5::bigint
 and r.subject_mode='self' and r.policy_version=$11 and r.lifecycle in ('draft','consent_pending','enrolling','calibrating','ready','active')
 and exists(select 1 from request_lock)
 and exists(select 1 from vy_teacher_sheet s where s.sheet_id=$4::uuid and s.replica_id=r.replica_id
  and s.owner_user_id=r.owner_user_id and (s.agent_id is null or s.agent_id=r.agent_id)
  and s.status='draft' and s.sheet=$6::jsonb and s.version=$12::text)
 returning r.replica_id,r.owner_user_id,r.agent_id,r.private_text_epoch
)
 update vy_teacher_sheet s set sheet=case when $13::boolean then s.sheet-'explanationOrder'
  else jsonb_set(s.sheet,'{explanationOrder}',to_jsonb($7::text),true) end,updated_at=now()
 from owned o where s.sheet_id=$4::uuid and s.replica_id=o.replica_id and s.owner_user_id=o.owner_user_id
 and (s.agent_id is null or s.agent_id=o.agent_id) and s.status='draft' and s.sheet=$6::jsonb and s.version=$12::text
 returning s.sheet_id,s.sheet,s.version,s.updated_at,o.private_text_epoch`;

function wire(row,canSave){const sheet=json(row.sheet);return {replica_id:row.replica_id,request_id:row.request_id,sheet_id:row.sheet_id,
 sheet_hash:hash(sheet),sheet_version:row.version,private_text_epoch:String(row.private_text_epoch),field:FIELD,
 value:sheet[FIELD]===undefined?null:sheet[FIELD],updated_at:row.updated_at,can_save:canSave,
 ...(canSave?{}:{blocker:'private_refinement_review_changed'})};}

async function review(db,owner,input,options){
 const scoped=scope(input);
 // Reuses the actual receipt, current source/evidence and encrypted answer
 // checks. No answer bytes enter the field-review response or logs.
 const result=await readPrivateTextRehearsal(db,owner,scoped,options);
 let rows;try{rows=await db(PRIVATE_REFINEMENT_REVIEW_SQL,[scoped.replica_id,owner,scoped.request_id,POLICY]);}catch{fail('private_refinement_review_unavailable',503);}
 const row=rows[0];if(!row)fail('private_refinement_completed_draft_required');
 const sheet=json(row.sheet),snapshot=json(row.snapshot);
 if(sheet[FIELD]!==undefined&&typeof sheet[FIELD]!=='string')fail('private_refinement_field_unavailable',503);
 const canSave=result.state==='complete'&&result.source?.sheet_id===row.sheet_id&&result.source?.sheet_hash===hash(sheet)
  &&snapshot.sheet_hash===hash(sheet)&&String(snapshot.authority_epoch)===String(row.private_text_epoch);
 return {row,scoped,wire:wire(row,canSave)};
}
export async function readPrivateTeachingRefinement(db,owner,input,options={}){return (await review(db,owner,input,options)).wire;}
export async function savePrivateTeachingRefinement(db,owner,input,options={}){
 scope(input);if(input.field!==FIELD)fail('private_refinement_field_unsupported',400);
 const clear=input.clear===true;if(('clear'in input&&!clear)||(clear&&'value'in input))fail('private_refinement_value_invalid',400);
 const value=clear?null:text(input.value);
 const sheetId=uuid(input.sheet_id);if(typeof input.expected_sheet_hash!=='string'||input.expected_sheet_hash.length!==64||!/^[0-9a-f]{64}$/.test(input.expected_sheet_hash))fail('private_refinement_hash_required',400);
 if(typeof input.expected_private_text_epoch!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(input.expected_private_text_epoch)||BigInt(input.expected_private_text_epoch)>9223372036854775806n)fail('private_refinement_epoch_required',400);
 const basis=await review(db,owner,input,options),{row}=basis;
 if(!basis.wire.can_save||sheetId!==row.sheet_id||input.expected_sheet_hash!==basis.wire.sheet_hash||input.expected_private_text_epoch!==basis.wire.private_text_epoch)fail('private_refinement_conflict');
 const previous=json(row.sheet),next={...previous};if(clear){if(previous[FIELD]===undefined)fail('private_refinement_no_change',400);delete next[FIELD];}
 else{if(previous[FIELD]===value)fail('private_refinement_no_change',400);next[FIELD]=value;}
 // Validate the real private compiler's field/core bounds without generating a
 // turn or calling a model. This fixed validation question is never persisted.
 compilePrivateExpertRehearsal({authority:{scope:'private_text_rehearsal',basis:'owner_question_attestation_v1',ownerId:owner,replicaId:row.replica_id,
  requestId:row.request_id,sheetId:row.sheet_id,sheetHash:hash(next),receiptId:row.consent_id},draft:next,
  contexts:[{itemId:row.context_item_id,sourceId:row.source_id,hash:sha256Hex(row.body),body:row.body}],question:'Validate this explicit private draft edit.'});
 let rows;try{rows=await db(PRIVATE_REFINEMENT_SAVE_SQL,[row.replica_id,owner,row.request_id,row.sheet_id,row.private_text_epoch,
  JSON.stringify(previous),value,row.source_id,json(row.snapshot).source_hash,row.snapshot_hash,POLICY,row.version,clear]);}catch{fail('private_refinement_save_uncertain',503);}
 const saved=rows[0];if(!saved)fail('private_refinement_conflict');
 if(hash(json(saved.sheet))!==hash(next)||String(saved.private_text_epoch)!==String(BigInt(row.private_text_epoch)+1n))fail('private_refinement_save_uncertain',503);
 return {...wire({...row,...saved},false),saved:true};
}
