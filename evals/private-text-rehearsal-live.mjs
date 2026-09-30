// Opt-in actual synthetic development SQL. The caller supplies the only DB.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as store from '../api/_private-text-rehearsal-store.js';
import {privateTextFixture,syntheticPrivateTextEnv} from './private-text-rehearsal-store.mjs';
import {canonicalJson,sha256Hex} from '../api/_provenance/contracts.js';
import {CONTEXT_EVIDENCE_WRITE_SQL,persistContextCanonicalEvidence,clearContextCanonicalTextEvidence} from '../api/_experience-compiler/context-evidence.js';
import {grantAccountConsent,revokeOwnedConsent} from '../api/_replica-consent.js';
export async function runPrivateTextRehearsalSqlChecks({db,onFixtureManifest}){
 const f=privateTextFixture(),foreign=randomUUID(),budget='synthetic-private-'+randomUUID(),requestIds=[],consentIds=f.account.map(c=>c.consent_id),reservationIds=[],checks=[],cleanupErrors=[];
 const options={env:syntheticPrivateTextEnv()},input={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item};
 const manifest=()=>({ownerUserIds:[f.owner,foreign],replicaIds:[f.rid],sourceIds:[f.source],contextItemIds:[f.item],sheetIds:[f.sheet],evidenceIds:f.records.map(r=>r.evidence_id),consentIds:[...consentIds],requestIds:[...requestIds],reservationIds:[...reservationIds],budgetIds:[budget],syntheticPrerequisites:true,noProviderCalls:true});
 let verified=false,stage='manifest',failure=null,remainingFixtureRows=null;
 const query=async(sql,p=[])=>{
  if(sql===store.PRIVATE_TEXT_ADMIT_SQL){if(!consentIds.includes(p[9])){consentIds.push(p[9]);await onFixtureManifest(manifest());}}
  await db('EXPLAIN '+sql,p);return db(sql,p);
 };
 const ready=()=>store.readPrivateTextReadiness(query,f.owner,input,options);
 const makeAsk=async()=>{const r=await ready();assert.equal(r.can_ask,true);const id=randomUUID();requestIds.push(id);await onFixtureManifest(manifest());return {...input,request_id:id,expected_snapshot_hash:r.selected.snapshot_hash,question:'What changes momentum?',statement_set:store.PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(store.PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))};};
 const provider={family:'azure-foundry',name:'azure-foundry-structured-output',version:'synthetic-v1',model:'synthetic-never-dispatched',prompt_hash:'a'.repeat(64)};
 const reserve=async ask=>{const id=randomUUID();reservationIds.push(id);await onFixtureManifest(manifest());const requestHash=sha256Hex(canonicalJson({operation:'dialogue',request_key:'private-text-rehearsal:'+ask.request_id.toLowerCase(),provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model}));await db(`insert into vy_provider_spend(reservation_id,budget_id,operation,provider_family,provider_name,provider_version,model,request_hash,unit_kind,reserved_microusd,state)
 values($1::uuid,$2,'dialogue',$3,$4,$5,$6,$7,'tokens',1,'reserved')`,[id,budget,provider.family,provider.name,provider.version,provider.model,requestHash]);return {reservation_id:id,budget_id:budget,request_hash:requestHash,state:'reserved'};};
 const complete=async(ask,claim)=>store.completePrivateTextRehearsal(query,f.owner,{...ask,dispatch_token:claim.dispatch_token,answer:'Synthetic gated answer; no model ran.',raw_output:{reply:'Synthetic raw fixture'},gate:{gated:true,finding_count:0},billing_state:'settled'},options);
 try{
  assert.equal(typeof onFixtureManifest,'function');await onFixtureManifest(manifest());
  stage='verify-development';assert.equal((await db('select current_database() name'))[0].name,'vyakti_expert_integration_20260906');verified=true;
  stage='synthetic-owner-context-prerequisites';
  await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version,lifecycle) values($1::uuid,$2::uuid,'Synthetic private rehearsal SQL fixture','replica-self-v1','enrolling')",[f.rid,f.owner]);
  for(const c of f.account)await db("insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,'account_attestation','replica-self-v1',$5,$6::jsonb,now()+interval '1 day')",[c.consent_id,f.rid,f.owner,c.scope,c.receipt_hash,JSON.stringify(c.metadata)]);
  await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state) values($1::uuid,$2::uuid,$3::uuid,'text','upload','synthetic-no-storage',$4,'text/plain',$5,'ready')",[f.source,f.rid,f.owner,'synthetic/'+f.source,f.row.source_hash]);
  await db("insert into vy_teacher_sheet(sheet_id,replica_id,owner_user_id,agent_id,sheet,status) values($1::uuid,$2::uuid,$3::uuid,null,$4::jsonb,'draft')",[f.sheet,f.rid,f.owner,JSON.stringify(f.row.sheet)]);
  await db("insert into vy_context_item(item_id,replica_id,owner_user_id,source_id,kind,format,source_name,content_sha256,status,authorship,extractor) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'file','text','Synthetic note.txt',$5,'extracted','mine','text-plain/v1')",[f.item,f.rid,f.owner,f.source,f.row.source_hash]);
  await db('insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,$4,$5)',[f.item,f.rid,f.owner,f.body,f.body.length]);
  stage='canonical-evidence-first-write-replay-and-hash-conflict';
  const evidenceInput={itemId:f.item,replicaId:f.rid,ownerUserId:f.owner,records:f.records};
  assert.equal((await persistContextCanonicalEvidence(query,evidenceInput)).covered,f.records.length);
  assert.equal((await persistContextCanonicalEvidence(query,evidenceInput)).covered,f.records.length);
  await db('update vy_replica_processing_evidence set record_hash=$2 where evidence_id=$1::uuid and replica_id=$3::uuid and owner_user_id=$4::uuid',[f.records[0].evidence_id,'f'.repeat(64),f.rid,f.owner]);
  await assert.rejects(()=>persistContextCanonicalEvidence(query,evidenceInput),{code:'context_evidence_persist_denied'});
  await db('update vy_replica_processing_evidence set record_hash=$2 where evidence_id=$1::uuid and replica_id=$3::uuid and owner_user_id=$4::uuid',[f.records[0].evidence_id,f.records[0].record_hash,f.rid,f.owner]);
  assert.equal((await persistContextCanonicalEvidence(query,evidenceInput)).covered,f.records.length);
  await clearContextCanonicalTextEvidence(query,evidenceInput);
  const oldCoverage=CONTEXT_EVIDENCE_WRITE_SQL.replace(/where exists \(\s*select 1 from inserted e[\s\S]*?\) or exists \(/,'where exists (');
  assert.notEqual(oldCoverage,CONTEXT_EVIDENCE_WRITE_SQL);
  await assert.rejects(()=>persistContextCanonicalEvidence((sql,p)=>query(sql===CONTEXT_EVIDENCE_WRITE_SQL?oldCoverage:sql,p),evidenceInput),{code:'context_evidence_persist_denied'});
  assert.equal(Number((await db('select count(*) n from vy_replica_processing_evidence where replica_id=$1::uuid and owner_user_id=$2::uuid',[f.rid,f.owner]))[0].n),f.records.length);
  await clearContextCanonicalTextEvidence(query,evidenceInput);
  assert.equal((await persistContextCanonicalEvidence(query,evidenceInput)).covered,f.records.length);checks.push(stage);
  await db("insert into vy_provider_budget(budget_id,limit_microusd) values($1,100)",[budget]);
  stage='ready-without-biometric-inference-training-grants';assert.equal((await ready()).can_ask,true);assert.equal(Number((await db("select count(*) n from vy_replica_consent where replica_id=$1::uuid and scope in ('biometric','training','inference')",[f.rid]))[0].n),0);checks.push(stage);
  stage='actual-changed-mutation-sql-parser';
  // EXPLAIN only for incumbent mutations whose full behavioral fixture belongs
  // to their existing suites. Capture their actual SQL/parameters, no replica
  // erasure or Mirror/review action is performed by these parser controls.
  const stop=Symbol('sql_captured');let parsed=0;
  const explainWrite=async(sql,p)=>{await db('EXPLAIN '+sql,p);parsed++;throw stop;};
  const capture=async fn=>{let caught=false;try{await fn();}catch(e){if(e!==stop)throw e;caught=true;}assert(caught);};
  const {markOwnedSourceDeleting}=await import('../api/_replica-source.js');await capture(()=>markOwnedSourceDeleting(explainWrite,f.owner,f.rid,f.source));
  const {completeSourceErasure}=await import('../api/_replica-source-erasure.js');await capture(()=>completeSourceErasure(explainWrite,{source:{sourceId:f.source,replicaId:f.rid,ownerUserId:f.owner},leaseToken:'synthetic-private-erasure-token-0001'}));
  const {requestOwnedReplicaErasure}=await import('../api/_replica.js');await capture(()=>requestOwnedReplicaErasure(explainWrite,f.owner,f.rid));
  const {completeReplicaErasure}=await import('../api/_replica-full-erasure.js');await capture(()=>completeReplicaErasure(explainWrite,{jobId:randomUUID(),replicaId:f.rid,ownerUserId:f.owner,leaseToken:'synthetic-private-erasure-token-0001'},{replicaIdHash:'a'.repeat(64),ownerUserHash:'b'.repeat(64),deletedClasses:[],backupExpiresAt:new Date(Date.now()+86400000).toISOString(),nonce:'synthetic-private-erasure-receipt',erasureRequestHash:'c'.repeat(64)}));
  await capture(()=>grantAccountConsent(explainWrite,f.owner,f.rid,{scopes:['capture','storage'],attestations:f.receipt.metadata.attestations}));
  const {decideReviewCard,neverRuleFromFlaggedReply}=await import('../api/_review-queue.js');await capture(()=>decideReviewCard(explainWrite,f.owner,{replica_id:f.rid,card_id:randomUUID(),decision:'never',pattern:'Synthetic forbidden phrase'}));
  await capture(()=>neverRuleFromFlaggedReply(async(sql,p)=>sql.includes('select f.reply_text')?[{reply_text:'Synthetic forbidden phrase'}]:explainWrite(sql,p),f.owner,{replica_id:f.rid,reply_sha256:'d'.repeat(64)},{tableApplied:async()=>true}));
  const {decideMirrorDelta}=await import('../api/_mirrorcall-store.js');await capture(()=>decideMirrorDelta(async(sql,p)=>sql.includes('update vy_replica r set private_text_epoch')?explainWrite(sql,p):[],f.owner,f.rid,randomUUID(),randomUUID(),'rejected'));
  const {remineContextItem,CONTEXT_ITEM_REMOVE_SQL}=await import('../api/_context-locker.js');await capture(()=>remineContextItem(async(sql,p)=>sql.includes('select i.item_id')?[{...f.row,status:'extracted',extractor:'text-plain/v1'}]:explainWrite(sql,p),f.owner,f.rid,f.item,{authorship:'mine'}));
  await db('EXPLAIN '+CONTEXT_ITEM_REMOVE_SQL,[f.item,f.rid,f.owner,randomUUID()]);parsed++;assert.equal(parsed,10);checks.push(stage);
  stage='uppercase-owned-admission-encrypted-and-idempotent';const originalAsk=await makeAsk(),ask={...originalAsk,...Object.fromEntries(['replica_id','request_id','sheet_id','context_item_id'].map(k=>[k,originalAsk[k].toUpperCase()]))},a=await store.admitPrivateTextRehearsal(query,f.owner,ask,options);assert.equal(a.created,true);assert.equal(a.request.request_id,originalAsk.request_id);assert.equal((await store.admitPrivateTextRehearsal(query,f.owner,originalAsk,options)).created,false);
  const saved=(await db('select * from vy_private_text_rehearsal where request_id=$1::uuid',[ask.request_id]))[0];assert(!JSON.stringify(saved).includes(ask.question));assert.equal(saved.consent_id,a.request.consent.consent_id);checks.push(stage);
  stage='cross-owner-selection-and-rebind-refused';await assert.rejects(()=>store.readPrivateTextRehearsal(query,foreign,ask,options),{code:'rehearsal_not_found'});await assert.rejects(()=>store.admitPrivateTextRehearsal(query,f.owner,{...ask,question:'Different synthetic question'},options),{code:'rehearsal_request_conflict'});checks.push(stage);
  stage='exclusive-dispatch-and-spend-binding';const reservation=await reserve(ask);await assert.rejects(()=>store.claimPrivateTextRehearsal(query,f.owner,{...ask,reservation:{...reservation,request_hash:'f'.repeat(64)},provider},options),{code:'rehearsal_reservation_invalid'});const claim=await store.claimPrivateTextRehearsal(query,f.owner,{...ask,reservation,provider},options);assert(claim.dispatch_token);await assert.rejects(()=>store.claimPrivateTextRehearsal(query,f.owner,{...ask,reservation,provider},options),{code:'rehearsal_dispatch_unavailable'});checks.push(stage);
  stage='unsettled-ledger-cannot-commit';await assert.rejects(()=>complete(ask,claim),{code:'rehearsal_commit_blocked'});await db("update vy_provider_spend set state='settled',actual_microusd=1,settled_at=now() where reservation_id=$1::uuid",[reservation.reservation_id]);const answer=await complete(ask,claim);assert.equal(answer.state,'complete');assert.equal(answer.can_voice,false);assert.equal((await store.readPrivateTextRehearsal(query,f.owner,ask,options)).answer,answer.answer);checks.push(stage);
  stage='draft-save-invalidates-current-replay';const {PRIVATE_TEACHER_SHEET_SAVE_SQL}=await import('../api/_teacher-sheet-draft.js');const changed={...f.row.sheet,identityWho:'Synthetic changed owner draft'};await query(PRIVATE_TEACHER_SHEET_SAVE_SQL,[f.rid,f.owner,JSON.stringify(changed),'',randomUUID()]);const invalid=await store.readPrivateTextRehearsal(query,f.owner,ask,options);assert.equal(invalid.state,'blocked');assert(!('answer'in invalid));checks.push(stage);
  stage='interposed-epoch-race-old-predicate-negative';const raceAsk=await makeAsk();await store.admitPrivateTextRehearsal(query,f.owner,raceAsk,options);const raceReservation=await reserve(raceAsk),raceClaim=await store.claimPrivateTextRehearsal(query,f.owner,{...raceAsk,reservation:raceReservation,provider},options);await db("update vy_provider_spend set state='settled' where reservation_id=$1::uuid",[raceReservation.reservation_id]);
  let interposed=false,captured;const raced=async(sql,p)=>{if(sql===store.PRIVATE_TEXT_COMPLETE_SQL){captured=[sql,p];interposed=true;await query(PRIVATE_TEACHER_SHEET_SAVE_SQL,[f.rid,f.owner,JSON.stringify(changed),'',randomUUID()]);}return query(sql,p);};
  await assert.rejects(()=>store.completePrivateTextRehearsal(raced,f.owner,{...raceAsk,dispatch_token:raceClaim.dispatch_token,answer:'Synthetic stale reply',raw_output:{reply:'Synthetic stale raw'},gate:{gated:true},billing_state:'settled'},options),{code:'rehearsal_commit_blocked'});assert(interposed);
  const mutant=captured[0].replace('and r.private_text_epoch=$6::bigint','');assert.notEqual(mutant,captured[0]);assert.equal((await query(mutant,captured[1])).length,1);assert.equal((await store.readPrivateTextRehearsal(query,f.owner,raceAsk,options)).state,'blocked');checks.push(stage);
  stage='canonical-clear-invalidates-admission';const clearAsk=await makeAsk();await store.admitPrivateTextRehearsal(query,f.owner,clearAsk,options);await clearContextCanonicalTextEvidence(query,{itemId:f.item,replicaId:f.rid,ownerUserId:f.owner});assert.equal((await ready()).can_ask,false);await persistContextCanonicalEvidence(query,{itemId:f.item,replicaId:f.rid,ownerUserId:f.owner,records:f.records});assert.equal((await store.readPrivateTextRehearsal(query,f.owner,clearAsk,options)).state,'blocked');checks.push(stage);
  stage='withdrawal-erases-only-request-payloads';const otherAsk=await makeAsk();await store.admitPrivateTextRehearsal(query,f.owner,otherAsk,options);assert.equal((await store.withdrawPrivateTextRehearsal(query,f.owner,ask)).private_payload_erased,true);assert.equal((await store.withdrawPrivateTextRehearsal(query,f.owner,ask)).state,'withdrawn');const erased=(await db('select question_envelope,raw_envelope,answer_envelope from vy_private_text_rehearsal where request_id=$1::uuid',[ask.request_id]))[0];assert.deepEqual(erased,{question_envelope:null,raw_envelope:null,answer_envelope:null});assert.equal((await store.readPrivateTextRehearsal(query,f.owner,ask,{env:{}})).state,'withdrawn');assert.equal((await store.readPrivateTextRehearsal(query,f.owner,otherAsk,options)).state,'pending');checks.push(stage);
  stage='capture-revocation-scrubs-all-private-payloads';await revokeOwnedConsent(query,f.owner,f.rid,['capture']);assert.equal(Number((await db('select count(*) n from vy_private_text_rehearsal where replica_id=$1::uuid and (question_envelope is not null or raw_envelope is not null or answer_envelope is not null)',[f.rid]))[0].n),0);checks.push(stage);
  stage='context-item-cascade-removes-private-request';await db('delete from vy_context_item where item_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[f.item,f.rid,f.owner]);assert.equal(Number((await db('select count(*) n from vy_private_text_rehearsal where replica_id=$1::uuid',[f.rid]))[0].n),0);checks.push(stage);
 }catch(error){failure=error;}
 finally{
  if(verified){const scopes=[...['vy_private_text_rehearsal','vy_replica_processing_evidence','vy_context_item_text','vy_context_item','vy_teacher_sheet','vy_replica_source','vy_replica_consent','vy_replica_audit','vy_replica'].map(t=>[t,'replica_id=$1::uuid and owner_user_id=$2::uuid',[f.rid,f.owner]]),['vy_provider_spend','budget_id=$1',[budget]],['vy_provider_budget','budget_id=$1',[budget]]];
   for(const [table,predicate,p] of scopes)try{await db(`delete from ${table} where ${predicate}`,p);}catch(e){cleanupErrors.push({stage:'DELETE_'+table,code:e.code});}
   let remaining=0;for(const [table,predicate,p] of scopes)try{remaining+=Number((await db(`select count(*) n from ${table} where ${predicate}`,p))[0].n);}catch(e){cleanupErrors.push({stage:'COUNT_'+table,code:e.code});}remainingFixtureRows=cleanupErrors.length?null:remaining;if(remaining)cleanupErrors.push({stage:'NONZERO_FIXTURE_ROWS'});
  }
 }
 if(failure||cleanupErrors.length){const error=failure||Error('fixture_cleanup_incomplete');Object.assign(error,{failedStage:stage,primaryCode:failure?.code||null,remainingFixtureRows,cleanupErrors,frames:String(failure?.stack||'').split('\n').map(l=>l.match(/private-text-rehearsal-live\.mjs:\d+:\d+/)?.[0]).filter(Boolean)});throw error;}
 return {passed:checks.length,checks,remainingFixtureRows,cleanupErrors,limitation:'Synthetic SQL and a deterministic interposed mutation; no overlapping transaction witness, provider call, real owner grant or UI acceptance. Synthetic provider ledger fixtures are not spend.'};
}
