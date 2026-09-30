// Synthetic relational fixtures only. No auth, storage, provider or default DB.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as store from '../../api/_text-publication-store.js';
import {canonicalJson,sha256Hex} from '../../api/_provenance/contracts.js';
import {createContextTextEvidence,persistContextCanonicalEvidence} from '../../api/_experience-compiler/context-evidence.js';

export const LIVE_PUBLICATION_DATABASE='vyakti_expert_integration_20260906';
export const LIVE_PROVIDER=Object.freeze({family:'azure',name:'azure-foundry-structured-output',version:'synthetic-sql-v1',model:'synthetic-never-called',prompt_hash:'e'.repeat(64)});
const hash=v=>sha256Hex(canonicalJson(v));
const validId=v=>typeof v==='string'&&v.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export function makeLivePublicationFixture(label){
 assert.match(label,/^[a-z0-9_-]{1,60}$/);
 const f={label,owner:randomUUID(),visitor:randomUUID(),other:randomUUID(),rid:randomUUID(),sheet:randomUUID(),item:randomUUID(),source:randomUUID(),pid:randomUUID(),sparePid:randomUUID(),primarySelectionId:randomUUID(),ruleId:randomUUID(),requests:Array.from({length:32},randomUUID),reservations:Array.from({length:32},randomUUID)};
 f.otherVisitor=f.other;f.budgetId='synthetic-text-publication-'+randomUUID();f.budget=f.budgetId;
 f.body=`Synthetic ${label}: a pendulum completes 12 oscillations in 24 seconds. Its period is 2 seconds. Group size is unspecified.`;
 f.draft={name:'Synthetic pendulum materials',identityWho:'Synthetic teacher fixture only',subjectDomain:'physics'};
 f.env={PRIVATE_TEXT_REHEARSAL_KEK_ID:'synthetic-publication-sql-fixture',PRIVATE_TEXT_REHEARSAL_KEK_B64:Buffer.alloc(32,27).toString('base64'),TEXT_PUBLICATION_BUDGET_USD:'1',CRON_SECRET:'synthetic-sql-expiry-secret-no-service'};
 f.account=['capture','storage'].map(scope=>{const metadata={owner_user_id:f.owner,replica_id:f.rid,method:'account_attestation',policy_version:'replica-self-v1',statement_set:'self-replica-enrollment-v1',scopes:[scope],attestations:{is_self:true,is_adult:true,has_source_rights:true,understands_synthetic_disclosure:true},synthetic_fixture:label};return{consent_id:randomUUID(),scope,metadata,receipt_hash:hash(metadata)};});
 f.records=createContextTextEvidence({replicaId:f.rid,ownerUserId:f.owner,sourceId:f.source,itemId:f.item,inputSha256:sha256Hex(f.body),body:f.body,format:'text',authorship:'mine'});
 return f;
}
export function liveFixtureManifest(f){
 for(const id of [f.owner,f.visitor,f.other,f.rid,f.sheet,f.item,f.source,f.pid,f.sparePid,f.primarySelectionId,f.ruleId,...f.requests,...f.reservations,...f.account.map(a=>a.consent_id)])assert(validId(id),'synthetic_uuid_required');
 return {label:f.label,owner:f.owner,visitor:f.visitor,otherVisitor:f.other,rid:f.rid,sheet:f.sheet,item:f.item,source:f.source,pid:f.pid,sparePid:f.sparePid,primarySelectionId:f.primarySelectionId,ruleId:f.ruleId,requests:f.requests,reservations:f.reservations,budgetId:f.budgetId,consentIds:f.account.map(a=>a.consent_id),evidenceIds:f.records.map(r=>r.evidence_id),body_sha256:sha256Hex(f.body),declaration:'Synthetic row fixture and capture/storage attestation only; not real auth, uploaded bytes, publication permission for serving, provider usage or voice/identity grant.'};
}
export const fixtureManifest=liveFixtureManifest;
export const LIVE_SEED_SQL=Object.freeze({
 replica:"insert into vy_replica(replica_id,owner_user_id,display_name,policy_version,lifecycle,primary_selection_id) values($1::uuid,$2::uuid,'Synthetic text publication SQL','replica-self-v1','enrolling',$3::uuid)",
 consent:"insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,'account_attestation','replica-self-v1',$5,$6::jsonb,now()+interval '1 day')",
 source:"insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state,purpose) values($1::uuid,$2::uuid,$3::uuid,'text','upload','synthetic-no-storage',$4,'text/plain',$5,'ready','context_item')",
 sheet:"insert into vy_teacher_sheet(sheet_id,replica_id,owner_user_id,agent_id,sheet,status) values($1::uuid,$2::uuid,$3::uuid,null,$4::jsonb,'draft')",
 item:"insert into vy_context_item(item_id,replica_id,owner_user_id,source_id,kind,format,source_name,content_sha256,status,authorship,extractor) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'file','text','Synthetic SQL note.txt',$5,'extracted','mine','text-plain/v1')",
 text:'insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,$4,$5)',
 budget:"insert into vy_provider_budget(budget_id,limit_microusd) values($1,1000000)",
 spend:"insert into vy_provider_spend(reservation_id,budget_id,operation,provider_family,provider_name,provider_version,model,request_hash,unit_kind,reserved_microusd,state) values($1::uuid,$2,'dialogue',$3,$4,$5,$6,$7,'tokens',500,'reserved')",
});
export async function assertLiveFixtureAbsent(db,f){
 liveFixtureManifest(f);
 const rows=await db(`select
 (select count(*) from vy_replica where replica_id=$1::uuid or owner_user_id=$2::uuid) replicas,
 (select count(*) from vy_provider_budget where budget_id=$3) budgets,
 (select count(*) from vy_text_publication_id_ledger where id=any($4::uuid[])) ids,
 (select count(*) from vy_teacher_sheet where sheet_id=$5::uuid) sheets,
 (select count(*) from vy_context_item where item_id=$6::uuid) items,
 (select count(*) from vy_replica_source where source_id=$7::uuid) sources,
 (select count(*) from vy_text_publication_request where request_id=any($8::uuid[])) requests,
 (select count(*) from vy_provider_spend where reservation_id=any($9::uuid[])) spend,
 (select count(*) from vy_replica_consent where consent_id=any($10::uuid[])) consents,
 (select count(*) from vy_replica_processing_evidence where evidence_id=any($11::uuid[])) evidence,
 (select count(*) from vy_review_never_rule where rule_id=$12::uuid) rules,
 (select count(*) from vy_replica_audit where replica_id=$1::uuid or owner_user_id=$2::uuid) audits`,[f.rid,f.owner,f.budgetId,[f.pid,f.sparePid,...f.requests],f.sheet,f.item,f.source,f.requests,f.reservations,f.account.map(a=>a.consent_id),f.records.map(e=>e.evidence_id),f.ruleId]);
 assert.equal(rows.length,1);for(const n of Object.values(rows[0]))assert.equal(Number(n),0,'fixture_preexisting_scope_refused');
}
export async function seedLivePublicationFixture(db,f){
 liveFixtureManifest(f);
 await db(LIVE_SEED_SQL.replica,[f.rid,f.owner,f.primarySelectionId]);
 for(const a of f.account)await db(LIVE_SEED_SQL.consent,[a.consent_id,f.rid,f.owner,a.scope,a.receipt_hash,JSON.stringify(a.metadata)]);
 await db(LIVE_SEED_SQL.source,[f.source,f.rid,f.owner,'synthetic-text-publication/'+f.source,sha256Hex(f.body)]);
 await db(LIVE_SEED_SQL.sheet,[f.sheet,f.rid,f.owner,JSON.stringify(f.draft)]);
 await db(LIVE_SEED_SQL.item,[f.item,f.rid,f.owner,f.source,sha256Hex(f.body)]);
 await db(LIVE_SEED_SQL.text,[f.item,f.rid,f.owner,f.body,f.body.length]);
 await persistContextCanonicalEvidence(db,{itemId:f.item,replicaId:f.rid,ownerUserId:f.owner,records:f.records});
 await db(LIVE_SEED_SQL.budget,[f.budgetId]);
}
export async function publishLiveFixture(db,f,{publicationId=f.pid}={}){
 const input={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item};
 const readiness=await store.readTextPublicationReadiness(db,f.owner,input,{env:f.env});assert.equal(readiness.can_publish,true,'fixture_not_publishable');
 const payload={...input,publication_id:publicationId,expected_review_hash:readiness.selected.review_hash,statement_set:readiness.statement_set,attestations:Object.fromEntries(readiness.statements.map(s=>[s.id,true]))};
 const result=await store.publishTextPublication(db,f.owner,payload,{env:f.env});return{...result,payload};
}
export async function joinLiveFixture(db,f,visitor=f.visitor){return store.joinTextPublication(db,visitor,{public_id:f.pid,expected_disclosure_hash:sha256Hex(store.TEXT_PUBLICATION_DISCLOSURE),is_adult:true,accept_ai_disclosure:true,accept_retention:true},{env:f.env});}
export function liveQuestionInput(f,session,index=0){assert(Number.isInteger(index)&&index>=0&&index<f.requests.length);return{public_id:f.pid,request_id:f.requests[index],session_token:typeof session==='string'?session:session.session_token,question:'What is the period of the pendulum?'};}
export async function admitLiveFixture(db,f,session,index=0){return store.admitTextPublicationRequest(db,f.visitor,liveQuestionInput(f,session,index),{env:f.env});}
export function liveReservation(f,index=0){return{reservation_id:f.reservations[index],budget_id:f.budgetId,state:'reserved',reserved_microusd:500,request_hash:hash({operation:'dialogue',request_key:'text-publication:'+f.requests[index],provider_family:LIVE_PROVIDER.family,provider_name:LIVE_PROVIDER.name,provider_version:LIVE_PROVIDER.version,model:LIVE_PROVIDER.model})};}
export async function claimLiveFixture(db,f,session,index=0){
 const reservation=liveReservation(f,index),p=LIVE_PROVIDER;
 await db(LIVE_SEED_SQL.spend,[reservation.reservation_id,f.budgetId,p.family,p.name,p.version,p.model,reservation.request_hash]);
 await db('update vy_provider_budget set reserved_microusd=reserved_microusd+500 where budget_id=$1',[f.budgetId]);
 const result=await store.claimTextPublicationRequest(db,f.visitor,{...liveQuestionInput(f,session,index),reservation,provider:p},{env:f.env});return{...result,reservation,provider:p};
}
export async function settleLiveFixture(db,f,index=0){
 await db("update vy_provider_spend set state='settled',actual_microusd=100,actual_input_units=100,actual_output_units=10,settled_at=now() where reservation_id=$1::uuid and budget_id=$2 and state='reserved'",[f.reservations[index],f.budgetId]);
 await db('update vy_provider_budget set reserved_microusd=reserved_microusd-500,spent_microusd=spent_microusd+100 where budget_id=$1 and reserved_microusd>=500',[f.budgetId]);
}
export async function completeLiveFixture(db,f,session,claim,index=0){return store.completeTextPublicationRequest(db,f.visitor,{...liveQuestionInput(f,session,index),dispatch_token:claim.dispatch_token,answer:'The period is 2 seconds.',raw_output:{reply:'The period is 2 seconds.'},gate:{gated:true,finding_count:0},billing_state:'settled'},{env:f.env});}
export async function cleanupLivePublicationFixture(db,f){
 // Content-free claim-once IDs intentionally survive; never delete retirement witnesses.
 const deletes=[
  ['vy_review_never_rule','rule_id', [f.ruleId]],
  ['vy_context_item_text','item_id',[f.item]],
  ['vy_context_item','item_id',[f.item]],
  ['vy_teacher_sheet','sheet_id',[f.sheet]],
  ['vy_replica_processing_evidence','evidence_id',f.records.map(e=>e.evidence_id)],
  ['vy_replica_source','source_id',[f.source]],
  ['vy_replica_consent','consent_id',f.account.map(a=>a.consent_id)],
 ];
 for(const [table,key,ids] of deletes)await db(`delete from ${table} where ${key}=any($1::uuid[]) and replica_id=$2::uuid and owner_user_id=$3::uuid`,[ids,f.rid,f.owner]);
 await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[f.rid,f.owner]);
 await db('delete from vy_provider_spend where reservation_id=any($1::uuid[]) and budget_id=$2',[f.reservations,f.budgetId]);
 await db('delete from vy_provider_budget where budget_id=$1',[f.budgetId]);
 return countLivePublicationFixture(db,f);
}
export async function countLivePublicationFixture(db,f){
 const tables=['vy_replica','vy_replica_source','vy_replica_consent','vy_replica_audit','vy_teacher_sheet','vy_context_item','vy_context_item_text','vy_replica_processing_evidence','vy_review_never_rule','vy_text_publication','vy_text_publication_visitor','vy_text_publication_request'];
 const counts={};for(const table of tables)counts[table]=Number((await db(`select count(*) n from ${table} where replica_id=$1::uuid and owner_user_id=$2::uuid`,[f.rid,f.owner]))[0]?.n);
 counts.vy_provider_spend=Number((await db('select count(*) n from vy_provider_spend where budget_id=$1',[f.budgetId]))[0]?.n);
 counts.vy_provider_budget=Number((await db('select count(*) n from vy_provider_budget where budget_id=$1',[f.budgetId]))[0]?.n);
 const retired=await db('select id,kind from vy_text_publication_id_ledger where id=any($1::uuid[]) order by id',[[f.pid,f.sparePid,...f.requests]]);
 for(const n of Object.values(counts))assert(Number.isSafeInteger(n)&&n>=0,'fixture_count_unconfirmed');
 return{counts,private_rows_remaining:Object.values(counts).reduce((a,b)=>a+b,0),retired_ids:retired,retired_id_count:retired.length};
}
