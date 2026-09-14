// Actual store, canonical evidence and encryption; injected SQL rows, no DB proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {refinementFixture} from './private-teaching-refinement.mjs';
import {readPrivateTextRehearsal,PRIVATE_TEXT_SELECTION_SQL} from '../api/_private-text-rehearsal-store.js';
import {savePrivateTeachingRefinement,readPrivateTeachingRefinement} from '../api/_private-teaching-refinement.js';
export async function runPrivateRefinementRecoveryChecks(){
 const checks=[];const test=async(name,fn)=>{await fn();checks.push(name);};
 const read=x=>readPrivateTextRehearsal(x.db,x.f.owner,x.scope,{env:x.env});
 await test('actual-save-rotates-epoch-and-stale-complete-exposes-read-only-marker',async()=>{
  const x=await refinementFixture();assert.equal((await read(x)).can_review_teaching,undefined);
  await savePrivateTeachingRefinement(x.db,x.f.owner,x.input(),{env:x.env});
  const result=await read(x);assert.equal(result.state,'blocked');assert.equal(result.failure_code,'rehearsal_inputs_changed');assert.equal(result.can_review_teaching,true);assert(!('answer'in result));
  const current=await readPrivateTeachingRefinement(x.db,x.f.owner,x.scope,{env:x.env});assert.equal(current.can_save,false);assert.equal(current.value,x.input().value);assert.equal(x.writes().length,1);
 });
 await test('admitted-dispatched-uncertain-and-stored-blocked-never-get-marker',async()=>{
  for(const state of ['admitted','dispatched','uncertain','blocked']){const x=await refinementFixture();x.row.state=state;x.f.row.private_text_epoch='1';const result=await read(x);assert.equal(result.can_review_teaching,undefined);assert(!('answer'in result));}
 });
 await test('withdrawn-known-and-minimal-never-get-marker',async()=>{
  for(const minimal of [false,true]){const x=await refinementFixture();x.row.state='withdrawn';if(minimal)x.row.consent_id=null;x.f.row.private_text_epoch='1';const result=await read(x);assert.equal(result.state,'withdrawn');assert.equal(result.can_review_teaching,undefined);assert(!('answer'in result));}
 });
 await test('revoked-or-expired-receipt-beats-stale-completed-marker',async()=>{
  for(const key of ['revoked_at','expires_at']){const x=await refinementFixture();x.row[key]='2020-01-01T00:00:00Z';x.f.row.private_text_epoch='1';const result=await read(x);assert.equal(result.failure_code,'rehearsal_permission_unavailable');assert.equal(result.can_review_teaching,undefined);}
 });
 await test('blocked-source-and-invalid-account-or-evidence-never-get-marker',async()=>{
  for(const mutate of [x=>x.f.row.source_state='deleted',x=>x.f.row.account_receipts=[],x=>x.f.row.evidence=[],x=>x.f.row.authorship='other']){const x=await refinementFixture();mutate(x);x.f.row.private_text_epoch='1';let result;try{result=await read(x);}catch(e){assert.equal(e.code,'rehearsal_read_unavailable');assert.equal(e.status,503);continue;}assert.equal(result.state,'blocked');assert.notEqual(result.failure_code,'rehearsal_inputs_changed');assert.equal(result.can_review_teaching,undefined);}
 });
 await test('foreign-owner-replica-request-refuse-before-marker',async()=>{
  for(const key of ['owner','replica_id','request_id']){const x=await refinementFixture();x.f.row.private_text_epoch='1';await assert.rejects(()=>readPrivateTextRehearsal(x.db,key==='owner'?randomUUID():x.f.owner,{...x.scope,...(key==='owner'?{}:{[key]:randomUUID()})},{env:x.env}),{code:'rehearsal_not_found'});}
 });
 await test('unavailable-current-authority-fails-visible-without-marker',async()=>{
  const x=await refinementFixture();x.f.row.private_text_epoch='1';const db=(sql,p)=>sql===PRIVATE_TEXT_SELECTION_SQL?Promise.reject(Error('synthetic unavailable')):x.db(sql,p);await assert.rejects(()=>readPrivateTextRehearsal(db,x.f.owner,x.scope,{env:x.env}),{code:'rehearsal_read_unavailable',status:503});
 });
 return {passed:checks.length,checks,scope:'Actual store and private refinement with synthetic injected SQL. No database, auth, model or network calls.'};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop()))console.log(JSON.stringify(await runPrivateRefinementRecoveryChecks()));
