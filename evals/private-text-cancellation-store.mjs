import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as s from '../api/_private-text-rehearsal-store.js';
import {privateTextFixture,syntheticPrivateTextEnv} from './private-text-rehearsal-store.mjs';
import {privateTextExportRow} from '../api/_private-text-rehearsal-crypto.js';
export async function runPrivateTextCancellationChecks(){
 const f=privateTextFixture(),otherRid=randomUUID(),rows=new Map(),checks=[],calls=[];let revokeUnavailable=false;
 const input={replica_id:f.rid,request_id:randomUUID()},env=syntheticPrivateTextEnv();
 const db=async(sql,p)=>{calls.push(sql);
  if(sql===s.PRIVATE_TEXT_WITHDRAW_SQL){if(p[1]!==f.owner||![f.rid,otherRid].includes(p[0]))return [];const old=rows.get(p[2]);if(old&&(old.owner_user_id!==p[1]||old.replica_id!==p[0]))return [];
   rows.set(p[2],{...(old||{request_id:p[2],replica_id:p[0],owner_user_id:p[1],billing_state:'unknown',created_at:new Date().toISOString()}),state:'withdrawn',question_envelope:null,raw_envelope:null,answer_envelope:null});return [{request_id:p[2]}];}
  if(sql===s.PRIVATE_TEXT_CANCEL_RECEIPTS_SQL){if(revokeUnavailable)throw Error('synthetic_receipt_update_unavailable');return [];}
  if(sql===s.PRIVATE_TEXT_REQUEST_READ_SQL){const row=rows.get(p[2]);return row&&row.replica_id===p[0]&&row.owner_user_id===p[1]?[row]:[];}
  throw Error('unexpected_sql');
 };
 const cancelled=await s.withdrawPrivateTextRehearsal(db,f.owner,input);assert.equal(cancelled.billing_state,'unknown');assert.equal(cancelled.private_payload_erased,true);assert.equal(cancelled.can_voice,false);assert(cancelled.created_at);checks.push('unknown-id-durable-terminal-with-no-cost-claim');
 const read=await s.readPrivateTextRehearsal(db,f.owner,input,{env:{}});assert.equal(read.state,'withdrawn');assert(!('consent'in read));assert(!('source'in read));assert(!('answer'in read));checks.push('minimal-withdrawn-read-needs-no-fake-authority-or-key');
 const ask={...input,sheet_id:f.sheet,context_item_id:f.item,question:'Synthetic late question',expected_snapshot_hash:'a'.repeat(64),statement_set:s.PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(s.PRIVATE_TEXT_STATEMENTS.map(x=>[x.id,true]))};
 const late=await s.admitPrivateTextRehearsal(db,f.owner,ask,{env:{}});assert.equal(late.created,false);assert.equal(late.compilerInput,null);assert.equal(late.request.state,'withdrawn');assert(!calls.includes(s.PRIVATE_TEXT_ADMIT_SQL));checks.push('late-admission-never-mints-grant-or-compiler-material');
 const retry=await s.withdrawPrivateTextRehearsal(db,f.owner,input);assert.equal(retry.created_at,cancelled.created_at);assert.equal(rows.size,1);checks.push('repeated-cancellation-keeps-one-terminal-id');
 await assert.rejects(()=>s.withdrawPrivateTextRehearsal(db,randomUUID(),input),{code:'rehearsal_not_found'});await assert.rejects(()=>s.withdrawPrivateTextRehearsal(db,f.owner,{...input,replica_id:otherRid}),{code:'rehearsal_not_found'});checks.push('owner-and-replica-conflicts-cannot-overwrite-terminal-id');
 const uncertain={replica_id:f.rid,request_id:randomUUID()};revokeUnavailable=true;await assert.rejects(()=>s.withdrawPrivateTextRehearsal(db,f.owner,uncertain),{code:'rehearsal_receipt_revocation_uncertain',status:503});assert.equal((await s.readPrivateTextRehearsal(db,f.owner,uncertain,{env:{}})).state,'withdrawn');revokeUnavailable=false;assert.equal((await s.withdrawPrivateTextRehearsal(db,f.owner,uncertain)).state,'withdrawn');checks.push('receipt-update-failure-keeps-terminal-state-and-safe-retry');
 await assert.rejects(()=>s.claimPrivateTextRehearsal(db,f.owner,{...input,reservation:{},provider:{}},{env}),{code:'rehearsal_dispatch_unavailable'});await assert.rejects(()=>s.completePrivateTextRehearsal(db,f.owner,{...input,dispatch_token:'synthetic'},{env}),{code:'rehearsal_dispatch_unavailable'});checks.push('terminal-id-cannot-claim-or-complete');
 const known={replica_id:f.rid,request_id:randomUUID()};rows.set(known.request_id,{...known,owner_user_id:f.owner,state:'dispatched',consent_id:randomUUID(),receipt_hash:'a'.repeat(64),snapshot:{sheet_hash:'b'.repeat(64),source_hash:'c'.repeat(64),evidence_hash:'d'.repeat(64)},sheet_id:f.sheet,context_item_id:f.item,source_id:f.source,billing_state:'reserved',spend_state:'settled',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()});assert.equal((await s.withdrawPrivateTextRehearsal(db,f.owner,known)).billing_state,'settled');checks.push('known-current-spend-survives-cancellation-without-refund-claim');
 const exported=privateTextExportRow(rows.get(input.request_id),f.owner,{});assert.equal(exported.question,null);assert.equal(exported.answer,null);assert.equal(exported.raw,null);checks.push('owner-export-supports-payload-free-terminal-row');
 const before=calls.length;await assert.rejects(()=>s.withdrawPrivateTextRehearsal(db,f.owner,{...input,request_id:input.request_id+'\n'}),{code:'rehearsal_id_required'});assert.equal(calls.length,before);checks.push('newline-uuid-refused-before-db');
 return {passed:checks.length,checks,limitation:'Offline store control flow only; no SQL or concurrency proof.'};
}
if(process.argv[1]?.endsWith('private-text-cancellation-store.mjs'))console.log(JSON.stringify(await runPrivateTextCancellationChecks()));
