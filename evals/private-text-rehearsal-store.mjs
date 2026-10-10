// Offline control flow and real encryption/canonical producer checks. Not SQL proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as store from '../api/_private-text-rehearsal-store.js';
import {compilePrivateExpertRehearsal} from '../api/_engine.gen.js';
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
function longPrivateTextFixture(){
 const f=privateTextFixture();
 const prefix='Introductory mechanics material about vectors and diagrams. '.repeat(150).slice(0,8000);
 const distinct=Array.from({length:650},(_,index)=>`t${String(index).padStart(3,'0')}`).join(' ');
 const target=` ORBIT-CANARY calibration requires exactly 37 verified passes before release. The course fee is 419 rupees. Section X uses cobalt notation. ${distinct} LATE-CANARY answer is cobalt.`;
 const body=prefix+target,digest=sha256Hex(body);
 const records=createContextTextEvidence({replicaId:f.rid,ownerUserId:f.owner,sourceId:f.source,itemId:f.item,inputSha256:digest,
  body,format:'pdf',authorship:'mine',extractor:'pdf-text-layer/v1'});
 Object.assign(f,{body,records});Object.assign(f.row,{format:'pdf',source_name:'Long synthetic lesson.pdf',body,content_sha256:digest,source_hash:digest,
  evidence:records.map(r=>({...r,span_start_ms:null,span_end_ms:null,adapter_family:r.adapter.family,adapter_name:r.adapter.name,adapter_version:r.adapter.version}))});
 return f;
}
export async function runPrivateTextStoreChecks(){
 const checks=[],f=privateTextFixture(),env=syntheticPrivateTextEnv(),options={env},requests=new Map();let mutations=0;
 const input={replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item};
 const db=async(sql,p)=>{
  if(sql===store.PRIVATE_TEXT_CHOICES_SQL)return p[1]===f.owner?[{replica_id:f.rid,lifecycle:f.row.lifecycle,drafts:[],context_items:[]}]:[];
  if(sql===store.PRIVATE_TEXT_SELECTION_SQL)return p[1]===f.owner?[f.row]:[];
  if(sql===store.PRIVATE_TEXT_REQUEST_READ_SQL){const r=requests.get(p[2]);return r&&r.replica_id===p[0]&&r.owner_user_id===p[1]?[r]:[];}
  mutations++;
  if(sql===store.PRIVATE_TEXT_ADMIT_SQL){const m=JSON.parse(p[13]),snapshot=JSON.parse(p[6]);requests.set(p[2],{request_id:p[2],replica_id:p[0],owner_user_id:p[1],consent_id:p[9],receipt_hash:p[10],live_receipt_hash:p[10],request_hash:p[14],question_hash:p[15],snapshot_hash:p[16],snapshot,sheet_id:snapshot.sheet_id,context_item_id:snapshot.context_item_id,source_id:p[3],authority_epoch:p[5],receipt_metadata:m,expires_at:p[12],consent_scope:store.PRIVATE_TEXT_SCOPE,consent_method:'account_attestation',consent_policy:'replica-self-v1',state:'admitted',billing_state:'not_started',question_envelope:JSON.parse(p[17]),gate_sidecar:JSON.parse(p[18]),created_at:p[11]});return [{request_id:p[2]}];}
  throw Error('unexpected_offline_sql');
 };
 const ready=await store.readPrivateTextReadiness(db,f.owner,input,options);assert.equal(ready.can_ask,true);assert.equal(ready.selected.material.context.body,f.body);checks.push('actual-canonical-producer-readiness');
 const ask={...input,request_id:randomUUID(),expected_snapshot_hash:ready.selected.snapshot_hash,question:'What changes momentum?',statement_set:store.PRIVATE_TEXT_STATEMENT_SET,attestations:Object.fromEntries(store.PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))};
 await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,{...ask,attestations:{}},options),{code:'rehearsal_explicit_attestations_required'});assert.equal(mutations,0);checks.push('no-admission-without-all-explicit-statements');
 const admitted=await store.admitPrivateTextRehearsal(db,f.owner,ask,options);assert.equal(admitted.created,true);assert.equal(admitted.compilerInput.draft,f.row.sheet);assert.equal(admitted.compilerInput.authority.receiptId,admitted.request.consent.consent_id);assert.deepEqual(admitted.compilerInput.history,[]);checks.push('confirmed-admission-binds-compiler-and-receipt');
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
 row.spend_state='settled';
 const followup={...ask,request_id:randomUUID(),question:'Why?',parent_request_id:ask.request_id,attestations:{...ask.attestations,authorize_private_text_followup:true}};
 const continued=await store.admitPrivateTextRehearsal(db,f.owner,followup,options);assert.deepEqual(continued.compilerInput.history,[{role:'user',content:ask.question},{role:'assistant',content:text}]);checks.push('explicit-followup-loads-server-owned-settled-parent');
 const foreignReplicaParent=randomUUID();requests.set(foreignReplicaParent,{...row,request_id:foreignReplicaParent,replica_id:randomUUID()});
 await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,{...followup,request_id:randomUUID(),parent_request_id:foreignReplicaParent},options),{code:'rehearsal_parent_unavailable'});checks.push('foreign-replica-parent-cannot-bleed-history');
 const foreignOwnerParent=randomUUID();requests.set(foreignOwnerParent,{...row,request_id:foreignOwnerParent,owner_user_id:randomUUID()});
 await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,{...followup,request_id:randomUUID(),parent_request_id:foreignOwnerParent},options),{code:'rehearsal_parent_unavailable'});checks.push('foreign-owner-parent-cannot-bleed-history');
 row.state='blocked';const failedParent={...followup,request_id:randomUUID()};await assert.rejects(()=>store.admitPrivateTextRehearsal(db,f.owner,failedParent,options),{code:'rehearsal_parent_unavailable'});row.state='complete';checks.push('failed-parent-is-never-an-answer');
 assert.equal(privateTextExportRow(row,f.owner,env).answer,text);assert.throws(()=>privateTextExportRow(row,randomUUID(),env));checks.push('actual-owner-export-only');
 row.live_receipt_hash='f'.repeat(64);assert.equal((await store.readPrivateTextRehearsal(db,f.owner,ask,options)).state,'blocked');row.live_receipt_hash=row.receipt_hash;checks.push('changed-live-receipt-refuses-replay');
 row.state='withdrawn';row.question_envelope=null;row.answer_envelope=null;assert(!('answer'in await store.readPrivateTextRehearsal(down,f.owner,ask,{env:{}})));checks.push('withdrawn-metadata-recovery-needs-no-private-key');
 {
  const long=longPrivateTextFixture(),longInput={replica_id:long.rid,sheet_id:long.sheet,context_item_id:long.item};
  const longRequests=new Map();let longMutations=0;
  const longDb=async(sql,p)=>{
   if(sql===store.PRIVATE_TEXT_CHOICES_SQL)return[{replica_id:long.rid,lifecycle:long.row.lifecycle,drafts:[],context_items:[]}];
   if(sql===store.PRIVATE_TEXT_SELECTION_SQL)return p[1]===long.owner?[long.row]:[];
   if(sql===store.PRIVATE_TEXT_REQUEST_READ_SQL){const r=longRequests.get(p[2]);return r&&r.replica_id===p[0]&&r.owner_user_id===p[1]?[r]:[];}
   longMutations++;
   if(sql===store.PRIVATE_TEXT_ADMIT_SQL){const metadata=JSON.parse(p[13]),snapshot=JSON.parse(p[6]);
    const request={request_id:p[2],replica_id:p[0],owner_user_id:p[1],consent_id:p[9],receipt_hash:p[10],live_receipt_hash:p[10],request_hash:p[14],question_hash:p[15],snapshot_hash:p[16],snapshot,
     sheet_id:snapshot.sheet_id,context_item_id:snapshot.context_item_id,source_id:p[3],authority_epoch:p[5],receipt_metadata:metadata,expires_at:p[12],consent_scope:store.PRIVATE_TEXT_SCOPE,
     consent_method:'account_attestation',consent_policy:'replica-self-v1',state:'admitted',billing_state:'not_started',question_envelope:JSON.parse(p[17]),gate_sidecar:JSON.parse(p[18]),created_at:p[11]};
    longRequests.set(p[2],request);return[{request_id:p[2]}];}
   if(sql===store.PRIVATE_TEXT_CLAIM_SQL){const request=longRequests.get(p[2]);
    Object.assign(request,{state:'dispatched',dispatch_token_hash:p[9],reservation_id:p[10],budget_id:p[11],spend_request_hash:p[12],provider:JSON.parse(p[13]),billing_state:'reserved',spend_state:'reserved'});
    return[{request_id:p[2]}];}
   if(sql===store.PRIVATE_TEXT_COMPLETE_SQL){const request=longRequests.get(p[2]);
    Object.assign(request,{state:'complete',answer_envelope:JSON.parse(p[10]),answer_hash:p[11],raw_envelope:JSON.parse(p[12]),raw_hash:p[13],
     gate_sidecar:{...request.gate_sidecar,...JSON.parse(p[14])},billing_state:p[15],spend_state:p[15]});return[{request_id:p[2]}];}
   throw Error('unexpected_long_evidence_sql');
  };
  const longReady=await store.readPrivateTextReadiness(longDb,long.owner,longInput,options);
  const validEvidence=structuredClone(long.row.evidence);
  assert.equal(longReady.can_ask,true);assert.equal(longReady.selected.material.context.excerpt,true);
  assert.equal(longReady.selected.material.context.body,long.records[0].value.text);
  assert.deepEqual([longReady.selected.material.context.excerpt_start_char,longReady.selected.material.context.excerpt_end_char],[0,8000]);
  assert.equal(longReady.selected.material.context.source_chars,long.body.length);checks.push('long-source-readiness-is-an-explicit-full-authority-excerpt');

  const parentId=randomUUID(),parentAsk={...longInput,request_id:parentId,expected_snapshot_hash:longReady.selected.snapshot_hash,
   question:'What does ORBIT-CANARY calibration require?',statement_set:store.PRIVATE_TEXT_STATEMENT_SET,
   attestations:Object.fromEntries(store.PRIVATE_TEXT_STATEMENTS.map(s=>[s.id,true]))};
  const admittedLong=await store.admitPrivateTextRehearsal(longDb,long.owner,parentAsk,options);
  assert.equal(admittedLong.created,true);assert.equal(admittedLong.compilerInput.contexts.length,1);
  assert.match(admittedLong.compilerInput.contexts[0].body,/ORBIT-CANARY calibration requires exactly 37/);
  assert.equal(admittedLong.compilerInput.contexts[0].body.includes('Introductory mechanics material'),false);
  const compiledLong=compilePrivateExpertRehearsal(admittedLong.compilerInput);
  assert.match(compiledLong.system,/ORBIT-CANARY calibration requires exactly 37/);
  const parentRow=longRequests.get(parentId),selection=parentRow.snapshot.evidence_selection;
  assert.equal(selection.question_hash,parentRow.question_hash);assert.equal(parentRow.receipt_metadata.evidence_selection_hash,selection.selection_hash);
  const expectedPayload={replica_id:long.rid,request_id:parentId,sheet_id:long.sheet,context_item_id:long.item,snapshot_hash:longReady.selected.snapshot_hash,
   question_hash:sha256Hex(parentAsk.question),statement_set:store.PRIVATE_TEXT_STATEMENT_SET,attestations:parentAsk.attestations,evidence_selection_hash:selection.selection_hash};
  assert.equal(parentRow.request_hash,sha256Hex(canonicalJson(expectedPayload)));
  assert.deepEqual(store.privateTextCompilerContextsFromRequest({...parentRow,body:long.body,evidence:long.records}).contexts,admittedLong.compilerInput.contexts);
  const rehashedOffsetTamper=structuredClone(parentRow),tamperedSelection=rehashedOffsetTamper.snapshot.evidence_selection;
  const selectedLength=tamperedSelection.records[0].end_char-tamperedSelection.records[0].start_char;
  Object.assign(tamperedSelection.records[0],{start_char:0,end_char:selectedLength,body_sha256:sha256Hex(long.body.slice(0,selectedLength))});
  tamperedSelection.selection_hash=sha256Hex(canonicalJson({schema:tamperedSelection.schema,question_hash:tamperedSelection.question_hash,records:tamperedSelection.records}));
  assert.throws(()=>store.privateTextCompilerContextsFromRequest({...rehashedOffsetTamper,body:long.body,evidence:long.records}),{code:'rehearsal_evidence_selection_changed'});
  checks.push('chunk-two-fact-enters-compiler-and-durable-question-bound-snapshot');
  checks.push('rehashed-offset-tamper-cannot-misattribute-a-canonical-evidence-id');

  for(const [label,question,want] of [
   ['three-letter expert cue','What is the course fee?','fee is 419 rupees'],
   ['rare one-letter identifier','What did I choose for Section X?','Section X uses cobalt'],
   ['tail after 600 distinct tokens','What is the LATE-CANARY answer?','LATE-CANARY answer is cobalt'],
  ]){
   const requestId=randomUUID(),candidate=await store.admitPrivateTextRehearsal(longDb,long.owner,{...parentAsk,request_id:requestId,question},options);
   assert.match(candidate.compilerInput.contexts[0].body,new RegExp(want));
   checks.push(label+' selects the complete relevant chunk');
  }
  const fallbackId=randomUUID(),fallback=await store.admitPrivateTextRehearsal(longDb,long.owner,{...parentAsk,request_id:fallbackId,question:'What is that?'},options);
  assert.equal(fallback.compilerInput.contexts[0].body,long.records[0].value.text);
  assert.equal(fallback.compilerInput.contexts[0].body.includes('ORBIT-CANARY'),false);
  checks.push('generic-stopword-only question keeps deterministic first-chunk fallback');

  const isolated=structuredClone(long.row.evidence);isolated[1].source_id=randomUUID();long.row.evidence=isolated;
  const isolatedReady=await store.readPrivateTextReadiness(longDb,long.owner,longInput,options);
  assert.equal(isolatedReady.can_ask,false);assert.equal(isolatedReady.state,'unavailable');
  long.row.evidence=structuredClone(validEvidence);
  checks.push('foreign-source-evidence-cannot-enter-selection');

  const mutationFloor=longMutations;long.row.evidence=[long.row.evidence[0]];
  await assert.rejects(()=>store.admitPrivateTextRehearsal(longDb,long.owner,{...parentAsk,request_id:randomUUID()},options),{code:'rehearsal_canonical_evidence_incomplete'});
  assert.equal(longMutations,mutationFloor);long.row.evidence=structuredClone(validEvidence);
  checks.push('missing-chunk-cancels-before-durable-admission');

  const exactSnapshot=structuredClone(parentRow.snapshot);parentRow.snapshot.evidence_selection.records[0].record_hash='f'.repeat(64);
  const changed=await store.readPrivateTextRehearsal(longDb,long.owner,parentAsk,options);
  assert.equal(changed.state,'blocked');assert.equal(changed.failure_code,'rehearsal_inputs_changed');
  const provider={family:'azure-openai',name:'azure-foundry-structured-output',version:'fixture-v1',model:'fixture-model',prompt_hash:'a'.repeat(64)};
  const spendHash=sha256Hex(canonicalJson({operation:'dialogue',request_key:`private-text-rehearsal:${parentId}`,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model}));
  const reservation={reservation_id:randomUUID(),budget_id:'synthetic-long-source',request_hash:spendHash,state:'reserved'};
  const changedMutationFloor=longMutations;
  await assert.rejects(()=>store.claimPrivateTextRehearsal(longDb,long.owner,{replica_id:long.rid,request_id:parentId,provider,reservation},options),{code:'rehearsal_inputs_changed'});
  assert.equal(longMutations,changedMutationFloor);parentRow.snapshot=exactSnapshot;
  checks.push('changed-selected-chunk-blocks-current-read-and-claim');

  const claim=await store.claimPrivateTextRehearsal(longDb,long.owner,{replica_id:long.rid,request_id:parentId,provider,reservation},options);
  const exactBeforeComplete=structuredClone(parentRow.snapshot);parentRow.snapshot.evidence_selection.records[0].end_char--;
  const completeMutationFloor=longMutations;
  await assert.rejects(()=>store.completePrivateTextRehearsal(longDb,long.owner,{replica_id:long.rid,request_id:parentId,dispatch_token:claim.dispatch_token,
   answer:'It requires exactly 37 verified passes.',raw_output:{reply:'Synthetic raw'},gate:{gated:true,finding_count:0},billing_state:'settled'},options),{code:'rehearsal_inputs_changed'});
  assert.equal(longMutations,completeMutationFloor);parentRow.snapshot=exactBeforeComplete;
  const answer='It requires exactly 37 verified passes.';
  await store.completePrivateTextRehearsal(longDb,long.owner,{replica_id:long.rid,request_id:parentId,dispatch_token:claim.dispatch_token,
   answer,raw_output:{reply:'Synthetic raw'},gate:{gated:true,finding_count:0},billing_state:'settled'},options);
  checks.push('changed-selected-chunk-blocks-completion-before-write');
  const childId=randomUUID(),childAsk={...parentAsk,request_id:childId,parent_request_id:parentId,question:'Why is that?',
   attestations:{...parentAsk.attestations,authorize_private_text_followup:true}};
  const child=await store.admitPrivateTextRehearsal(longDb,long.owner,childAsk,options);
  assert.deepEqual(child.compilerInput.history,[{role:'user',content:parentAsk.question},{role:'assistant',content:answer}]);
  assert.match(child.compilerInput.contexts[0].body,/ORBIT-CANARY calibration requires exactly 37/);
  assert.notEqual(longRequests.get(childId).snapshot.evidence_selection.question_hash,selection.question_hash);
  assert.deepEqual(longRequests.get(childId).snapshot.evidence_selection.records.map(r=>r.evidence_id),selection.records.map(r=>r.evidence_id));
  checks.push('pronoun-followup-deterministically-inherits-current-parent-chunk');
 }
 f.row.evidence=[];assert.equal((await store.readPrivateTextReadiness(db,f.owner,input,options)).can_ask,false);checks.push('no-raw-text-evidence-fallback');
 return {passed:checks.length,checks,limitation:'Offline actual encryption, canonical producer and control flow; no SQL/provider/UI proof.'};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop()))console.log(JSON.stringify(await runPrivateTextStoreChecks()));
