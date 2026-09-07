// Offline control flow and real encryption/canonical producer checks. Not SQL proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as store from '../api/_private-text-rehearsal-store.js';
import {makeConsentReceipt} from '../api/_replica-consent.js';
import {createContextTextEvidence} from '../api/_experience-compiler/context-evidence.js';
import {encryptPrivateText,decryptPrivateText,privateTextExportRow} from '../api/_private-text-rehearsal-crypto.js';
import {sha256Hex,canonicalJson} from '../api/_provenance/contracts.js';
export const syntheticPrivateTextEnv=()=>({PRIVATE_TEXT_REHEARSAL_KEK_ID:'synthetic-private-test',PRIVATE_TEXT_REHEARSAL_KEK_B64:Buffer.alloc(32,53).toString('base64')});
export function privateTextFixture(){
 const owner=randomUUID(),rid=randomUUID(),sheet=randomUUID(),item=randomUUID(),source=randomUUID(),body='Synthetic owner teaching note. A force changes momentum.';
 const receipt=makeConsentReceipt({ownerUserId:owner,replica:rid,scopes:['capture','storage'],method:'account_attestation',attestations:{is_self:true,is_adult:true,has_source_rights:true,understands_synthetic_disclosure:true}});
 const records=createContextTextEvidence({replicaId:rid,ownerUserId:owner,sourceId:source,itemId:item,inputSha256:sha256Hex(body),body,format:'text',authorship:'mine',extractor:'text-plain/v1'});
 const account=['capture','storage'].map(scope=>({consent_id:randomUUID(),scope,receipt_hash:receipt.hash,metadata:receipt.metadata}));
 const row={replica_id:rid,owner_user_id:owner,lifecycle:'enrolling',subject_mode:'self',policy_version:'replica-self-v1',private_text_epoch:'0',sheet_id:sheet,sheet:{name:'Synthetic teacher',identityWho:'A synthetic physics teacher',subjectDomain:'physics'},sheet_status:'draft',item_id:item,source_id:source,format:'text',item_status:'extracted',source_name:'Synthetic note.txt',authorship:'mine',owner_speaker:'',consent_scope:'own_context',content_sha256:sha256Hex(body),body,source_hash:sha256Hex(body),source_state:'ready',account_receipts:account,evidence:records.map(r=>({...r,span_start_ms:null,span_end_ms:null,adapter_family:r.adapter.family,adapter_name:r.adapter.name,adapter_version:r.adapter.version}))};
 return {owner,rid,sheet,item,source,body,receipt,records,account,row};
}
export async function runPrivateTextStoreChecks(){
 const checks=[],f=privateTextFixture(),env=syntheticPrivateTextEnv(),options={env},requests=new Map();let mutations=0;
 const input={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item};
 const db=async(sql,p)=>{
  if(sql===store.PRIVATE_TEXT_CHOICES_SQL)return p[1]===f.owner?[{replica_id:f.rid,lifecycle:f.row.lifecycle,drafts:[],context_items:[]}]:[];
  if(sql===store.PRIVATE_TEXT_SELECTION_SQL)return p[1]===f.owner?[f.row]:[];
  if(sql===store.PRIVATE_TEXT_REQUEST_READ_SQL){const r=requests.get(p[2]);return r&&r.owner_user_id===p[1]?[r]:[];}
  mutations++;
  if(sql===store.PRIVATE_TEXT_ADMIT_SQL){const m=JSON.parse(p[13]),snapshot=JSON.parse(p[6]);requests.set(p[2],{request_id:p[2],replica_id:p[0],owner_user_id:p[1],consent_id:p[9],receipt_hash:p[10],live_receipt_hash:p[10],request_hash:p[14],question_hash:p[15],snapshot_hash:p[16],snapshot,sheet_id:snapshot.sheet_id,context_item_id:snapshot.context_item_id,source_id:p[3],authority_epoch:p[5],receipt_metadata:m,expires_at:p[12],consent_scope:store.PRIVATE_TEXT_SCOPE,consent_method:'account_attestation',consent_policy:'replica-self-v1',state:'admitted',billing_state:'not_started',question_envelope:JSON.parse(p[17]),created_at:p[11]});return [{request_id:p[2]}];}
  throw Error('unexpected_offline_sql');
 };
 const ready=await store.readPrivateTextReadiness(db,f.owner,input,options);assert.equal(ready.can_ask,true);assert.equal(ready.selected.material.context.body,f.body);checks.push('actual-canonical-producer-readiness');
 const ask={...input,request_id:randomUUID(),expected_snapshot_hash:ready.selected.snapshot_hash,question:'What changes momentum?',statement_set:store.PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(store.PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))};
 await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,{...ask,attestations:{}},options),{code:'rehearsal_explicit_attestations_required'});assert.equal(mutations,0);checks.push('no-admission-without-all-explicit-statements');
 const admitted=await store.admitPrivateTextRehearsal(db,f.owner,ask,options);assert.equal(admitted.created,true);assert.equal(admitted.compilerInput.draft,f.row.sheet);assert.equal(admitted.compilerInput.authority.receiptId,admitted.request.consent.consent_id);checks.push('confirmed-admission-binds-compiler-and-receipt');
 const replay=await store.admitPrivateTextRehearsal(db,f.owner,ask,{env:{}});assert.equal(replay.created,false);assert.equal(replay.compilerInput,null);assert.equal(mutations,1);checks.push('duplicate-admission-never-creates-dispatch-material');
 await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,{...ask,question:'A different question'},options),{code:'rehearsal_request_conflict'});checks.push('request-id-rebind-refused');
 await assert.rejects(()=>store.readPrivateTextRehearsal(db,randomUUID(),ask,options),{code:'rehearsal_not_found'});checks.push('foreign-owner-no-row');
 f.row.private_text_epoch='1';const invalid=await store.readPrivateTextRehearsal(db,f.owner,ask,options);assert.equal(invalid.state,'blocked');assert(!('answer'in invalid));checks.push('current-epoch-blocks-replay');f.row.private_text_epoch='0';
 const down=async(sql,p)=>{if(sql===store.PRIVATE_TEXT_SELECTION_SQL)throw Error('synthetic_backend_down');return db(sql,p);};
 await assert.rejects(()=>store.readPrivateTextRehearsal(down,f.owner,ask,options),{code:'rehearsal_read_unavailable',status:503});checks.push('transient-authority-read-fails-visible');
 const downReady=await store.readPrivateTextReadiness(down,f.owner,input,options);assert.equal(downReady.state,'unavailable');assert.equal(downReady.blockers[0].responsibility,'platform');checks.push('transient-readiness-is-platform-blocker');
 const row=requests.get(ask.request_id),text='Synthetic gated reply',binding={owner_user_id:f.owner,replica_id:f.rid,request_id:ask.request_id,role:'answer',content_hash:sha256Hex(text)},envelope=encryptPrivateText(text,binding,env);
 assert.equal(decryptPrivateText(envelope,binding,env),text);assert(!JSON.stringify(envelope).includes(text));checks.push('actual-aes-envelope-roundtrip-no-plaintext');
 for(const k of ['owner_user_id','replica_id','request_id','role','content_hash']){assert.throws(()=>decryptPrivateText(envelope,{...binding,[k]:k==='role'?'question':k==='content_hash'?'a'.repeat(64):randomUUID()},env));}checks.push('five-envelope-scope-tamper-controls');
 row.state='complete';row.answer_envelope=envelope;row.answer_hash=binding.content_hash;row.billing_state='settled';assert.equal((await store.readPrivateTextRehearsal(db,f.owner,ask,options)).answer,text);checks.push('current-scoped-complete-read-decrypts');
 assert.equal(privateTextExportRow(row,f.owner,env).answer,text);assert.throws(()=>privateTextExportRow(row,randomUUID(),env));checks.push('actual-owner-export-only');
 row.live_receipt_hash='f'.repeat(64);assert.equal((await store.readPrivateTextRehearsal(db,f.owner,ask,options)).state,'blocked');row.live_receipt_hash=row.receipt_hash;checks.push('changed-live-receipt-refuses-replay');
 row.state='withdrawn';row.question_envelope=null;row.answer_envelope=null;assert(!('answer'in await store.readPrivateTextRehearsal(down,f.owner,ask,{env:{}})));checks.push('withdrawn-metadata-recovery-needs-no-private-key');
 f.row.evidence=[];assert.equal((await store.readPrivateTextReadiness(db,f.owner,input,options)).can_ask,false);checks.push('no-raw-text-evidence-fallback');
 return {passed:checks.length,checks,limitation:'Offline actual encryption, canonical producer and control flow; no SQL/provider/UI proof.'};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop()))console.log(JSON.stringify(await runPrivateTextStoreChecks()));
