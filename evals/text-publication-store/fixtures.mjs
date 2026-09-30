

import * as store from '../../api/_text-publication-store.js';
import * as source from '../../api/_text-publication-source.js';
import * as crypto from '../../api/_text-publication-crypto.js';
import {createContextTextEvidence} from '../../api/_experience-compiler/context-evidence.js';
import {canonicalJson,sha256Hex} from '../../api/_provenance/contracts.js';
import {compilePublishedMaterialAssistant,compilePrivateExpertRehearsal} from '../../api/_engine.gen.js';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),rid=id(2),sheet=id(3),item=id(4),sid=id(5),pid=id(6),visitor=id(7),requestId=id(8),other=id(9);
const h=v=>sha256Hex(canonicalJson(v)),env={PRIVATE_TEXT_REHEARSAL_KEK_ID:'offline-fixture',PRIVATE_TEXT_REHEARSAL_KEK_B64:Buffer.alloc(32,17).toString('base64'),TEXT_PUBLICATION_BUDGET_USD:'1',CRON_SECRET:'offline-expiry-secret-32-characters'};
function fixture(){
 const body='A pendulum completes 12 oscillations in 24 seconds. Its period is 2 seconds.',sha=sha256Hex(body),draft={name:'Pendulum notes',identityWho:'PRIVATE BIOGRAPHY MUST NOT LEAK',credentialFacts:'PRIVATE CREDENTIALS',subjectDomain:'physics',explanationOrder:'Count then divide'};
 const ev=createContextTextEvidence({replicaId:rid,ownerUserId:owner,sourceId:sid,itemId:item,inputSha256:sha,body,format:'text',authorship:'mine'}).map(e=>({...e,span_start_ms:e.span.start_ms,span_end_ms:e.span.end_ms,adapter_family:e.adapter.family,adapter_name:e.adapter.name,adapter_version:e.adapter.version}));
 const receipts=['capture','storage'].map((scope,i)=>{const metadata={owner_user_id:owner,replica_id:rid,method:'account_attestation',policy_version:'replica-self-v1',statement_set:'self-replica-enrollment-v1',scopes:[scope],attestations:{is_self:true,is_adult:true,has_source_rights:true,understands_synthetic_disclosure:true}};return {consent_id:id(20+i),receipt_hash:h(metadata),scope,metadata};});
 const row={replica_id:rid,owner_user_id:owner,lifecycle:'enrolling',subject_mode:'self',policy_version:'replica-self-v1',private_text_epoch:1,sheet_id:sheet,sheet:draft,sheet_status:'draft',item_id:item,source_id:sid,format:'text',item_status:'extracted',source_name:'notes.txt',authorship:'mine',owner_speaker:null,consent_scope:'owner',content_sha256:sha,body,source_hash:sha,source_state:'ready',account_receipts:receipts,evidence:ev};
 const pubs=new Map(),visitors=new Map(),requests=new Map(),calls=[];let writeFence=true;
 const db=async(sql,args)=>{
  calls.push({sql,args});
  if(sql===source.PRIVATE_TEXT_SELECTION_SQL)return [structuredClone(row)];
  if(sql===source.PRIVATE_TEXT_CHOICES_SQL)return [{replica_id:rid,lifecycle:'enrolling',drafts:[{sheet_id:sheet,name:draft.name,status:'draft',updated_at:new Date().toISOString()}],context_items:[{item_id:item,source_name:'notes.txt',status:'extracted',format:'text',authorship:'mine',source_id:sid,source_ready:true}]}];
  if(sql===store.TEXT_PUBLICATION_READ_SQL)return pubs.has(args[0])?[structuredClone(pubs.get(args[0]))]:[];
  if(sql.startsWith('select * from vy_text_publication where replica_id='))return [...pubs.values()];
  if(sql===store.TEXT_PUBLICATION_PUBLISH_SQL){if(!writeFence||pubs.has(args[7]))return [];const p={publication_id:args[7],replica_id:args[0],owner_user_id:args[1],source_id:args[2],context_item_id:item,sheet_id:sheet,version:1,epoch:0,state:'active',review_hash:args[9],request_hash:args[10],snapshot:Object.fromEntries(Object.entries(JSON.parse(args[3])).filter(([k])=>k!=='fence_epoch')),projection:JSON.parse(args[4]),receipt:JSON.parse(args[11]),receipt_hash:args[12],disclosure:args[13],disclosure_hash:args[14],terms:JSON.parse(args[15]),expires_at:args[16],created_at:new Date().toISOString(),question_count:0,committed_microusd:0};pubs.set(p.publication_id,p);return [{publication_id:p.publication_id}];}
  if(sql===store.TEXT_PUBLICATION_JOIN_SQL){if(!writeFence)return [];const v={publication_id:args[7],replica_id:rid,owner_user_id:owner,visitor_user_id:args[9],session_epoch:0,question_count:0,admission:JSON.parse(args[10]),admission_hash:args[11],expires_at:args[12]};visitors.set(v.visitor_user_id,v);return [v];}
  if(sql.startsWith('select * from vy_text_publication_visitor'))return visitors.has(args[1])?[structuredClone(visitors.get(args[1]))]:[];
  if(sql===store.TEXT_PUBLICATION_REQUEST_READ_SQL)return requests.has(args[2])&&requests.get(args[2]).visitor_user_id===args[1]?[structuredClone(requests.get(args[2]))]:[];
  if(sql===store.TEXT_PUBLICATION_AUTHORIZED_READ_SQL)return writeFence&&requests.has(args[12])?[structuredClone(requests.get(args[12]))]:[];
  if(sql===store.TEXT_PUBLICATION_ADMIT_SQL){if(!writeFence||requests.has(args[12]))return [];const r={request_id:args[12],publication_id:args[7],replica_id:rid,owner_user_id:owner,visitor_user_id:args[9],publication_epoch:args[8],session_epoch:args[10],request_hash:args[13],question_hash:args[14],question_envelope:JSON.parse(args[15]),state:'admitted',billing_state:'not_started',created_at:new Date().toISOString(),expires_at:pubs.get(pid).expires_at};requests.set(r.request_id,r);return [r];}
  if(sql===store.TEXT_PUBLICATION_CLAIM_SQL){if(!writeFence)return [];const r=requests.get(args[12]);Object.assign(r,{state:'dispatched',dispatch_authority_epoch:JSON.parse(args[3]).fence_epoch,dispatch_token_hash:args[13],reservation_id:args[14],budget_id:args[15],spend_request_hash:args[16],provider:JSON.parse(args[17]),billing_state:'reserved'});return [r];}
  if(sql===store.TEXT_PUBLICATION_COMPLETE_SQL){if(!writeFence)return [];const r=requests.get(args[12]);Object.assign(r,{state:'complete',answer_envelope:JSON.parse(args[14]),answer_hash:args[15],raw_envelope:JSON.parse(args[16]),raw_hash:args[17],gate_sidecar:JSON.parse(args[18]),billing_state:args[19]});return [r];}
  if(sql===store.TEXT_PUBLICATION_FAIL_SQL){const r=requests.get(args[2]);if(!r||r.visitor_user_id!==args[1]||!['admitted','dispatched'].includes(r.state))return [];if(r.state==='dispatched'&&r.dispatch_token_hash!==args[3]&&r.spend_state!=='released')return [];Object.assign(r,{state:args[4],billing_state:args[5],failure_code:args[6]});return [r];}
  throw Error('unexpected_fixture_SQL');
 };
 const selection={replica_id:rid,sheet_id:sheet,context_item_id:item};
 const publish=async()=>{const r=await store.readTextPublicationReadiness(db,owner,selection,{env});return store.publishTextPublication(db,owner,{...selection,publication_id:pid,expected_review_hash:r.selected.review_hash,statement_set:r.statement_set,attestations:Object.fromEntries(r.statements.map(s=>[s.id,true]))},{env});};
 const join=async()=>store.joinTextPublication(db,visitor,{public_id:pid,expected_disclosure_hash:sha256Hex(store.TEXT_PUBLICATION_DISCLOSURE),is_adult:true,accept_ai_disclosure:true,accept_retention:true},{env});
 return {db,row,pubs,visitors,requests,calls,publish,join,selection,setFence:v=>writeFence=v};
}

export {fixture,id,owner,rid,sheet,item,sid,pid,visitor,requestId,other,h,env};
