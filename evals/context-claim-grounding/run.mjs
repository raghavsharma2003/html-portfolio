import assert from 'node:assert/strict';
import {createContextTextEvidence,clearContextCanonicalTextEvidence,CONTEXT_TEXT_EVIDENCE_CLEAR_SQL} from '../../api/_experience-compiler/context-evidence.js';
import {validateExtractionOutput} from '../../api/_claim-extraction/contracts.js';
import {CLAIMS_SQL,DECIDE_OWNED_CLAIM_SQL,buildOwnedPersonProfile,citedEvidenceAuthoritySql,decideOwnedClaim,ownedPersonModelStatus,personProfileValiditySql} from '../../api/_person-model.js';
import {compileReplicaRuntimeCore} from '../../api/_replica-runtime.js';
import {remineContextItem} from '../../api/_context-locker.js';
import {CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL,ELIGIBLE_TRANSCRIPTS_SQL,CLAIM_EXTRACTION_OPEN_SQL,CLAIM_EXTRACTION_PERSIST_SQL,extractOwnedClaims} from '../../api/_replica-claims.js';
import {contextTextEvidenceAuthoritySql} from '../../api/_context-claim-authority.js';

const uid=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RID=uid(1),OWNER=uid(2),SOURCE=uid(3),ITEM=uid(4);
const body='In an SN1 reaction, the rate depends only on substrate concentration.';
const input={replicaId:RID,ownerUserId:OWNER,sourceId:SOURCE,itemId:ITEM,inputSha256:'a'.repeat(64),
 format:'text',extractor:'text-plain/v1',body,segments:[]};
let groups=0;
const test=async(name,run)=>{await run();console.log(`PASS ${++groups}: ${name}`);};

await test('owner-authored canonical text reaches accepted profile knowledge and the current-question core',async()=>{
 const [evidence]=createContextTextEvidence({...input,authorship:'mine'});assert.ok(evidence);assert.equal(evidence.evidence_type,'text_span');
 const quote='In an SN1 reaction, the rate depends only on substrate concentration';
 let proposed=[];
 const extractor={family:'claim-extraction',name:'offline-context-fixture',version:'1',model:'offline',async extract({batch}){
  assert.equal(batch.spans[0].evidence_id,evidence.evidence_id);assert.equal(batch.spans[0].text,body);
  const output=validateExtractionOutput({claims:[{domain:'knowledge',key:'chemistry_sn1_rate_law',
   body:'For an SN1 reaction, rate depends only on substrate concentration.',origin:'observed',confidence:0.96,sensitive:false,
   valid_from:null,valid_to:null,citations:[{evidence_id:evidence.evidence_id,start_char:body.indexOf(quote),
    end_char:body.indexOf(quote)+quote.length,quote,entailment:0.98}]}]},batch);
  return{output};
 }};
 const complete=await extractOwnedClaims(async(sql,params=[])=>{
  if(sql===ELIGIBLE_TRANSCRIPTS_SQL)return[{...evidence,text:evidence.value.text,language:evidence.value.language}];
  if(sql===CLAIM_EXTRACTION_OPEN_SQL)return[{run_id:uid(5),state:'extracting',acquired:true,proposed_count:0,rejected_count:0,attempt:1}];
  if(sql===CLAIM_EXTRACTION_PERSIST_SQL){proposed=JSON.parse(params[6]);return[{run_id:uid(5),state:'complete',proposed_count:1,rejected_count:0,attempt:1}];}
  if(sql.includes('select r.replica_id,r.lifecycle'))return[{replica_id:RID,lifecycle:'calibrating',subject_mode:'self',
   policy_version:'replica-self-v1',consent_ids:[uid(6),uid(7)],transcription_consent:true,training_consent:true}];
  if(sql.includes('from vy_replica_claim_extraction x join'))return[];
  if(sql.includes('from vy_replica_claim_extraction_queue q'))return[];
  throw Error(`unexpected SQL ${sql.slice(0,60)}`);
 },OWNER,RID,extractor);
 assert.equal(complete.state,'complete');assert.equal(proposed.length,1);
 const accepted=(claim_id,domain,key,claimBody)=>({claim_id:String(claim_id),domain,key,body:claimBody,origin:'observed',confidence:0.9,
  status:'approved',decision:'accepted',source_ids:[SOURCE],updated_at:'2026-09-09T00:00:00.000Z'});
 const review=await decideOwnedClaim(async(sql,params)=>{
  assert.equal(sql,DECIDE_OWNED_CLAIM_SQL);assert.match(sql,/for update of c/);
  assert.match(sql,/for key share of locked_evidence,locked_source/);assert.ok(sql.includes(CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL));
  assert.deepEqual(params.slice(0,5),['5',RID,OWNER,'accepted','accurate']);
  return[{decision_id:uid(8),claim_id:'5',decision:'accepted',reason_code:'accurate'}];
 },OWNER,{replica_id:RID,claim_id:'5',decision:'accepted',reason_code:'accurate'});
 const claims=[accepted(1,'identity','self_name','Asha'),accepted(2,'language','languages','English'),
  accepted(3,'delivery','turn_shape','Brief explanations'),accepted(4,'boundary','private_topics','Keep private topics out'),
  {...proposed[0],claim_id:'5',status:'approved',decision:review.decision,reason_code:review.reason_code,
   citation_previews:[{excerpt:quote,entailment:0.98}],updated_at:'2026-09-09T00:00:00.000Z'}];
 const status=await ownedPersonModelStatus(async(sql)=>{
  if(sql===CLAIMS_SQL)return claims;
  if(sql.includes('select r.replica_id,exists'))return[{replica_id:RID,training_consent:true}];
  if(sql.includes('from vy_replica_profile p join'))return[];
  throw Error(`unexpected person status SQL ${sql.slice(0,60)}`);
 },OWNER,RID);
 assert.equal(status.claims.find(row=>row.claim_id==='5').citation_previews[0].excerpt,quote);
 let profile;
 const built=await buildOwnedPersonProfile(async(sql,params=[])=>{
  if(sql===CLAIMS_SQL)return claims;
  if(sql.includes("where s.replica_id=$1::uuid")&&sql.includes("s.purpose='interview'"))return[];
  if(sql.includes('insert into vy_replica_profile')){profile=JSON.parse(params[3]);return[{replica_id:RID,version:1,status:'draft'}];}
  throw Error(`unexpected person build SQL ${sql.slice(0,60)}`);
 },OWNER,RID);
 assert.equal(built.status,'draft');
 assert.deepEqual(profile.knowledge.map(row=>row.key),['chemistry_sn1_rate_law']);
 assert.match(compileReplicaRuntimeCore(profile,{strategies:[]},'Explain the SN1 rate law'),
  /knowledge\.chemistry_sn1_rate_law: For an SN1 reaction, rate depends only on substrate concentration\./);
});

await test('unknown or other-person authorship creates no eligible canonical text',()=>{
 assert.deepEqual(createContextTextEvidence({...input,authorship:'unknown'}),[]);
 assert.deepEqual(createContextTextEvidence({...input,authorship:'not_mine'}),[]);
});

await test('erased context authority after extraction refuses every proposed claim',async()=>{
 const [evidence]=createContextTextEvidence({...input,authorship:'mine'});let calls=0;
 const quote='In an SN1 reaction, the rate depends only on substrate concentration';
 const extractor={family:'claim-extraction',name:'offline-context-fixture',version:'1',model:'offline',async extract({batch}){
  calls++;return{output:validateExtractionOutput({claims:[{domain:'knowledge',key:'chemistry_sn1_rate_law',
   body:'For an SN1 reaction, rate depends only on substrate concentration.',origin:'observed',confidence:0.96,sensitive:false,
   valid_from:null,valid_to:null,citations:[{evidence_id:evidence.evidence_id,start_char:0,end_char:quote.length,quote,entailment:0.98}]}]},batch)};
 }};
 await assert.rejects(()=>extractOwnedClaims(async(sql)=>{
  if(sql===ELIGIBLE_TRANSCRIPTS_SQL)return[{...evidence,text:evidence.value.text,language:evidence.value.language}];
  if(sql===CLAIM_EXTRACTION_OPEN_SQL)return[{run_id:uid(5),state:'extracting',acquired:true}];
  if(sql===CLAIM_EXTRACTION_PERSIST_SQL)return[];
  if(sql.includes('select r.replica_id,r.lifecycle'))return[{replica_id:RID,lifecycle:'calibrating',subject_mode:'self',
   policy_version:'replica-self-v1',consent_ids:[uid(6),uid(7)],transcription_consent:true,training_consent:true}];
  if(sql.includes('from vy_replica_claim_extraction x join')||sql.includes('from vy_replica_claim_extraction_queue q')
   ||sql.includes('update vy_replica_claim_extraction'))return[];
  throw Error(`unexpected SQL ${sql.slice(0,60)}`);
 },OWNER,RID,extractor),/claim_extraction_persist_denied/);
 assert.equal(calls,1);
});

await test('one exact context authority guards discovery, run opening and post-provider persistence',()=>{
 for(const [sql,count] of [[ELIGIBLE_TRANSCRIPTS_SQL,1],[CLAIM_EXTRACTION_OPEN_SQL,2],[CLAIM_EXTRACTION_PERSIST_SQL,1]])
  assert.equal(sql.split(CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL).length-1,count);
 for(const fragment of ["context_source.state='ready'","context_source.contains_third_parties=false",
  "context_source.purpose='context_item'","context_source.provenance->>'purpose'='context_item'","context_item.status in ('extracted','mined')",
  "context_item.format<>'whatsapp_export'","context_item.authorship='mine'","context_item.consent_scope='own_context'",
  'context_item.content_sha256=context_source.sha256',"e.value#>>'{provenance,context_item_id}'=context_item.item_id::text",
  "e.value#>>'{locator,canonical_text_sha256}'="]){assert.ok(CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL.includes(fragment),fragment);}
 assert.match(ELIGIBLE_TRANSCRIPTS_SQL,/e\.evidence_type='transcript_span'[\s\S]+speaker\.evidence_type='speaker_segment'/);
 assert.match(CLAIM_EXTRACTION_PERSIST_SQL,/e\.evidence_type='transcript_span'[\s\S]+speaker\.evidence_type='speaker_segment'/);
 assert.match(CLAIM_EXTRACTION_PERSIST_SQL,/regexp_split_to_table[\s\S]+resolved\.citation_quote is not null[\s\S]+x\.quote_hash/);
 assert.ok(CLAIMS_SQL.includes(CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL));
 assert.match(CLAIMS_SQL,/resolved\.citation_quote is not null[\s\S]+cc\.quote_hash/);
 const validity=personProfileValiditySql('p','r');
 assert.match(validity,/profile_citation/);assert.match(validity,/profile_evidence/);
 assert.ok(validity.includes(contextTextEvidenceAuthoritySql('profile_evidence')));
});

await test('missing canonical authority metadata is invalid at acceptance and current serving',()=>{
 const acceptanceAuthority=`(${citedEvidenceAuthoritySql('e','s')}) is not true`;
 const servingAuthority=`(${citedEvidenceAuthoritySql('profile_evidence','profile_source')}) is not true`;
 assert.ok(DECIDE_OWNED_CLAIM_SQL.includes(acceptanceAuthority));
 assert.ok(personProfileValiditySql('p','r').includes(servingAuthority));
 for(const field of ['epistemic_status','observation_target','protected_trait_inference','inner_state_inference']){
  assert.ok(acceptanceAuthority.includes(field));assert.ok(servingAuthority.includes(field));
 }
});

await test('context erasure supersedes derived claims and removes the exact text evidence',async()=>{
 let called;const result=await clearContextCanonicalTextEvidence(async(sql,params)=>{called={sql,params};return[{removed:1}];},
  {itemId:ITEM,replicaId:RID,ownerUserId:OWNER});
 assert.equal(result.removed,1);assert.equal(called.sql,CONTEXT_TEXT_EVIDENCE_CLEAR_SQL);assert.deepEqual(called.params,[ITEM,RID,OWNER]);
 assert.match(called.sql,/update vy_replica_claim c set status='superseded'/);
 assert.match(called.sql,/c\.status in \('proposed','approved'\)/);
 assert.match(called.sql,/delete from vy_replica_processing_evidence e/);
});

await test('re-attribution refuses its mutation when stale evidence cannot be cleared first',async()=>{
 let attributionWrites=0;
 await assert.rejects(()=>remineContextItem(async(sql)=>{
  if(sql.includes('select i.item_id, i.replica_id'))return[{item_id:ITEM,replica_id:RID,owner_user_id:OWNER,
   source_id:SOURCE,content_sha256:'a'.repeat(64),format:'text',status:'extracted',extractor:'text-plain/v1',
   authorship:'mine',owner_speaker:'',body}];
  if(sql===CONTEXT_TEXT_EVIDENCE_CLEAR_SQL)throw Error('synthetic_clear_refused');
  if(sql.includes('update vy_context_item i set authorship'))attributionWrites++;
  return[];
 },OWNER,RID,ITEM,{authorship:'not_mine'}),/synthetic_clear_refused/);
 assert.equal(attributionWrites,0);
});

console.log(`${groups} context claim grounding groups passed; production functions and source contracts, no SQL or provider calls.`);
