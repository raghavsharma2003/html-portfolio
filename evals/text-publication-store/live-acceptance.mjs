// Import-only acceptance runner. Root supplies a protected actual development DB.
// This file never opens a connection, creates auth users or invokes a provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256Hex,canonicalJson} from '../../api/_provenance/contracts.js';
import * as store from '../../api/_text-publication-store.js';
import {textPublicationSqlInventory} from './sql-inventory.mjs';
import {LIVE_PUBLICATION_DATABASE,LIVE_PROVIDER,makeLivePublicationFixture,liveFixtureManifest,assertLiveFixtureAbsent,seedLivePublicationFixture,cleanupLivePublicationFixture,countLivePublicationFixture,publishLiveFixture,joinLiveFixture,liveQuestionInput,admitLiveFixture,claimLiveFixture,settleLiveFixture,completeLiveFixture,liveReservation} from './live-fixtures.mjs';

export const TEXT_PUBLICATION_ACCEPTANCE_SOURCE_HASHES=Object.freeze({
 'api/_text-publication-store.js':'84f77e894e93a81ae69375ec4e96657461279617aa2819b62ebd5966283e2f22',
 'api/_text-publication-source.js':'45d0b297c47ed10633a7dd37b42d5296613880f8af46d53a046b663bff66f4b9',
 'api/_text-publication-crypto.js':'8612f7879bbdafa0621245d1b5cb48042aa7ae86a829aadd464a225684f6e665',
 'api/_engine.gen.js':'a3e263b7c33dc7936929ade9903b039505dd038a166a2b5ec4a1592453a5ba5a',
 'db/migrations/143_text_publication.sql':'d71a06bd0c96d09b4c1723ec3f100805d4e059bebacdb11ccde6e8b936da22aa',
});
const safeCode=e=>/^[A-Za-z0-9_]{2,100}$/.test(e?.code||'')?e.code:'UNCLASSIFIED_FAILURE';
const scope=f=>({replica_id:f.rid,sheet_id:f.sheet,context_item_id:f.item});
const options=f=>({env:f.env});
async function refuses(fn,pattern){let error;try{await fn();}catch(e){error=e;}assert(error,'expected_refusal');if(pattern)assert.match(String(error.code||error.message),pattern);return safeCode(error);}
export function verifyTextPublicationAcceptanceSources(){
 for(const [file,expected] of Object.entries(TEXT_PUBLICATION_ACCEPTANCE_SOURCE_HASHES))assert.equal(sha256Hex(readFileSync(new URL('../../'+file,import.meta.url))),expected,'frozen_source_changed:'+file);
 return TEXT_PUBLICATION_ACCEPTANCE_SOURCE_HASHES;
}
export async function prepareTextPublicationAcceptance(){
 verifyTextPublicationAcceptanceSources();const inventory=await textPublicationSqlInventory();assert.equal(inventory.length,17);
 const fixtures=['lifecycle','foreign','quota','expiry','terminal'].map(makeLivePublicationFixture);
 return{fixtures,inventory,manifest:{schema:'text-publication-live-acceptance/v1',database:LIVE_PUBLICATION_DATABASE,source_hashes:TEXT_PUBLICATION_ACCEPTANCE_SOURCE_HASHES,fixture_type:'synthetic relational state, not native upload/auth or real owner grant',fixtures:fixtures.map(liveFixtureManifest),SQL:inventory.map(({name,sha256})=>({name,sha256})),provider_calls:0,ledger_policy:'retain exact content-free publication/request IDs after private payload cleanup; isolated synthetic spend/budgets removed'}};
}
export async function runTextPublicationAcceptance({db,onFixtureManifest,onProgress,optIn=false}={}){
 assert.equal(optIn,true,'explicit_root_execution_clearance_required');assert.equal(typeof db,'function');assert.equal(typeof onFixtureManifest,'function');
 const prepared=await prepareTextPublicationAcceptance(),{fixtures,inventory,manifest}=prepared;
 const result={schema:'text-publication-live-acceptance-result/v1',started_at:new Date().toISOString(),state:'preflight',checks:[],SQL_explained:[],query_hashes:[],cleanup:[],cleanup_errors:[],failure:null,provider_calls:0,private_rows_remaining:null,retired_id_count:0,limitations:['Synthetic relational fixtures do not prove real auth/upload/owner UI.','Sequential SQL does not prove overlap; separate pinned-session race runner required.','Global expiry mutation is EXPLAIN-only; this runner never sweeps other owners.','No provider call, answer-quality acceptance, deployment or scheduled-trigger proof.']};
 const attempted=[];let phase='preflight',verified=false,absenceVerified=false;
 const checkpoint=async()=>{await onFixtureManifest({...manifest,attempted_fixture_labels:[...attempted],preflight_absence_verified:absenceVerified,phase});if(onProgress)await onProgress({phase,checks:result.checks.length});};
 const query=async(sql,args=[])=>{assert(verified,'database_not_verified');const hash=sha256Hex(sql);result.query_hashes.push({phase,sha256:hash});await db('EXPLAIN '+sql,args);return db(sql,args);};
 const check=async(name,fn)=>{phase=name;await checkpoint();const detail=await fn();result.checks.push({name,passed:true,...(detail?{detail}:{})});};
 try{
  await checkpoint();assert.equal((await db('select current_database() name'))[0]?.name,LIVE_PUBLICATION_DATABASE,'wrong_database');verified=true;
  for(const entry of inventory){phase='explain-'+entry.name;await checkpoint();await db('EXPLAIN '+entry.sql,entry.params);result.SQL_explained.push({name:entry.name,sha256:entry.sha256});}
  result.checks.push({name:'17 exact frozen SQL statements parse against actual schema',passed:true});
  for(const f of fixtures){phase='absence-'+f.label;await assertLiveFixtureAbsent(query,f);}absenceVerified=true;await checkpoint();
  for(const f of fixtures){attempted.push(f.label);phase='seed-'+f.label;await checkpoint();await seedLivePublicationFixture(query,f);}
  const [a,b,q,e,t]=fixtures;
  let published,session,claim;
  await check('owner source selection and explicit publication receipt',async()=>{
   const readiness=await store.readTextPublicationReadiness(query,a.owner,scope(a),options(a));assert.equal(readiness.can_publish,true);
   await refuses(()=>store.publishTextPublication(query,a.owner,{...scope(a),publication_id:a.pid,expected_review_hash:readiness.selected.review_hash,statement_set:readiness.statement_set,attestations:{}},options(a)),/attestation_required/);
   published=await publishLiveFixture(query,a);assert.equal(published.created,true);assert.equal(published.publication.can_voice,false);
   const rows=await query('select receipt,projection from vy_text_publication where publication_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[a.pid,a.rid,a.owner]);assert.equal(rows[0].receipt.scope,store.TEXT_PUBLICATION_STATEMENT_SET);assert(!JSON.stringify(rows[0].projection).includes('identityWho'));
  });
  await check('same-ID publish replay, changed payload and foreign owner refusal',async()=>{
   assert.equal((await store.publishTextPublication(query,a.owner,published.payload,options(a))).created,false);
   await refuses(()=>store.publishTextPublication(query,a.owner,{...published.payload,expected_review_hash:'0'.repeat(64)},options(a)),/request_conflict/);
   await refuses(()=>store.readOwnedTextPublication(query,b.owner,{replica_id:a.rid,publication_id:a.pid}),/not_found/);
  });
  await check('second active ID cannot silently replace existing publication',async()=>{
   await refuses(()=>store.publishTextPublication(query,a.owner,{...published.payload,publication_id:a.sparePid},options(a)));
   assert.equal((await store.readOwnedTextPublication(query,a.owner,{replica_id:a.rid,publication_id:a.pid})).state,'active');
  });
  await check('visitor attestation, foreign identity and changed disclosure refuse',async()=>{
   await refuses(()=>store.joinTextPublication(query,a.visitor,{public_id:a.pid},options(a)),/attestation_required/);
   await refuses(()=>store.joinTextPublication(query,a.visitor,{public_id:a.pid,is_adult:true,accept_ai_disclosure:true,accept_retention:true,expected_disclosure_hash:'0'.repeat(64)},options(a)),/disclosure_changed/);
   session=await joinLiveFixture(query,a);assert.equal(session.remaining_questions,20);
   await refuses(()=>store.admitTextPublicationRequest(query,a.other,liveQuestionInput(a,session),options(a)));
  });
  await check('admission, same-ID replay and changed question count once',async()=>{
   assert.equal((await admitLiveFixture(query,a,session)).created,true);assert.equal((await admitLiveFixture(query,a,session)).created,false);
   await refuses(()=>store.admitTextPublicationRequest(query,a.visitor,{...liveQuestionInput(a,session),question:'Changed payload'},options(a)),/request_conflict/);
   const row=(await query('select p.question_count total,v.question_count visitor from vy_text_publication p join vy_text_publication_visitor v using(publication_id) where p.publication_id=$1::uuid and v.visitor_user_id=$2::uuid',[a.pid,a.visitor]))[0];assert.equal(Number(row.total),1);assert.equal(Number(row.visitor),1);
  });
  await check('provider-bound claim rejects counterfeit reservation and claims once',async()=>{
   await refuses(()=>store.claimTextPublicationRequest(query,a.visitor,{...liveQuestionInput(a,session),provider:LIVE_PROVIDER,reservation:{...liveReservation(a),request_hash:'0'.repeat(64)}},options(a)),/reservation_invalid/);
   claim=await claimLiveFixture(query,a,session);assert(claim.dispatch_token);
   await refuses(()=>store.claimTextPublicationRequest(query,a.visitor,{...liveQuestionInput(a,session),provider:LIVE_PROVIDER,reservation:claim.reservation},options(a)),/dispatch_unavailable/);
  });
  await check('settled synthetic ledger, encrypted complete and scoped replay',async()=>{
   await settleLiveFixture(query,a);const complete=await completeLiveFixture(query,a,session,claim);assert.equal(complete.answer,'The period is 2 seconds.');
   const replay=await store.readTextPublicationRequest(query,a.visitor,liveQuestionInput(a,session),options(a));assert.equal(replay.answer,complete.answer);assert.equal(replay.billing_state,'settled');
   await refuses(()=>store.readTextPublicationRequest(query,a.other,liveQuestionInput(a,session),options(a)));
   const row=(await query('select question_envelope,answer_envelope,raw_envelope from vy_text_publication_request where request_id=$1::uuid and visitor_user_id=$2::uuid',[a.requests[0],a.visitor]))[0];assert(!JSON.stringify(row).includes('The period is 2 seconds.'));assert(!JSON.stringify(row).includes('What is the period'));
  });
  await check('private draft edit does not replace publication but invalidates old dispatch replay',async()=>{
   await query("update vy_teacher_sheet set sheet=jsonb_set(sheet,'{name}','\"Changed private draft\"'::jsonb) where sheet_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[a.sheet,a.rid,a.owner]);
   await query('update vy_replica set private_text_epoch=private_text_epoch+1 where replica_id=$1::uuid and owner_user_id=$2::uuid',[a.rid,a.owner]);
   const open=await store.openTextPublication(query,null,{public_id:a.pid});assert.equal(open.title,'Synthetic pendulum materials');assert.equal(open.can_text,true);
   await refuses(()=>store.readTextPublicationRequest(query,a.visitor,liveQuestionInput(a,session),options(a)),/output_authority_changed/);
  });
  await check('visitor forget erases payloads, revokes old token and preserves quota',async()=>{
   await store.forgetTextPublicationVisitor(query,a.visitor,{public_id:a.pid},options(a));
   await refuses(()=>store.readTextPublicationRequest(query,a.visitor,liveQuestionInput(a,session),options(a)));
   const row=(await query('select state,question_envelope,answer_envelope,raw_envelope from vy_text_publication_request where request_id=$1::uuid and visitor_user_id=$2::uuid',[a.requests[0],a.visitor]))[0];assert.equal(row.state,'withdrawn');assert.equal(row.question_envelope,null);assert.equal(row.answer_envelope,null);assert.equal(row.raw_envelope,null);
   session=await joinLiveFixture(query,a);assert.equal(session.remaining_questions,19);
   const spend=(await query('select state from vy_provider_spend where reservation_id=$1::uuid and budget_id=$2',[a.reservations[0],a.budgetId]))[0];assert.equal(spend.state,'settled');
  });
  await check('account conversation forget preserves allowance and terminalizes only that visitor',async()=>{
   await admitLiveFixture(query,a,session,1);const other=await joinLiveFixture(query,a,a.other);
   await store.forgetTextPublicationAccount(query,a.visitor);
   assert.equal((await joinLiveFixture(query,a)).remaining_questions,18);
   assert.equal((await store.admitTextPublicationRequest(query,a.other,{...liveQuestionInput(a,other,2)},options(a))).created,true);
  });
  await check('unpublish scrubs own materials and admissions while foreign publication stays active',async()=>{
   await publishLiveFixture(query,b);await store.unpublishTextPublication(query,a.owner,{replica_id:a.rid,publication_id:a.pid},options(a));
   const row=(await query('select state,projection,receipt from vy_text_publication where publication_id=$1::uuid and owner_user_id=$2::uuid',[a.pid,a.owner]))[0];assert.equal(row.state,'revoked');assert.equal(row.projection,null);assert.equal(row.receipt,null);
   const payloads=Number((await query('select count(*) n from vy_text_publication_request where publication_id=$1::uuid and (question_envelope is not null or answer_envelope is not null or raw_envelope is not null)',[a.pid]))[0].n);assert.equal(payloads,0);
   assert.equal((await store.openTextPublication(query,null,{public_id:b.pid})).can_text,true);
  });
  await check('unknown publication cancellation prevents later activation of same ID',async()=>{
   const readiness=await store.readTextPublicationReadiness(query,t.owner,scope(t),options(t));
   const cancelled=await store.unpublishTextPublication(query,t.owner,{replica_id:t.rid,publication_id:t.pid});assert.equal(cancelled.publication_never_created,true);
   const later=await store.publishTextPublication(query,t.owner,{...scope(t),publication_id:t.pid,expected_review_hash:readiness.selected.review_hash,statement_set:readiness.statement_set,attestations:Object.fromEntries(readiness.statements.map(s=>[s.id,true]))},options(t));
   assert.equal(later.created,false);assert.equal(later.publication.state,'revoked');assert.equal(later.publication.publication_never_created,true);
   const row=(await query('select state,receipt,projection from vy_text_publication where publication_id=$1::uuid and owner_user_id=$2::uuid',[t.pid,t.owner]))[0];assert.equal(row.state,'revoked');assert.equal(row.receipt,null);assert.equal(row.projection,null);
  });
  await check('actual visitor20 boundary refuses21 without consuming another count',async()=>{
   await publishLiveFixture(query,q);const j=await joinLiveFixture(query,q);
   await query('update vy_text_publication_visitor set question_count=19 where publication_id=$1::uuid and visitor_user_id=$2::uuid',[q.pid,q.visitor]);
   await admitLiveFixture(query,q,j);await refuses(()=>admitLiveFixture(query,q,j,1),/admission_blocked/);
   assert.equal(Number((await query('select question_count from vy_text_publication_visitor where publication_id=$1::uuid and visitor_user_id=$2::uuid',[q.pid,q.visitor]))[0].question_count),20);
  });
  await check('actual publication200 boundary refuses201 across a fresh visitor',async()=>{
   const j=await joinLiveFixture(query,q,q.other);await query('update vy_text_publication set question_count=199 where publication_id=$1::uuid and owner_user_id=$2::uuid',[q.pid,q.owner]);
   await store.admitTextPublicationRequest(query,q.other,liveQuestionInput(q,j,2),options(q));await refuses(()=>store.admitTextPublicationRequest(query,q.other,liveQuestionInput(q,j,3),options(q)),/admission_blocked/);
   assert.equal(Number((await query('select question_count from vy_text_publication where publication_id=$1::uuid',[q.pid]))[0].question_count),200);
  });
  await check('publication budget cap refuses otherwise valid reserved claim',async()=>{
   const j=await joinLiveFixture(query,q);await query('update vy_text_publication set committed_microusd=999750 where publication_id=$1::uuid and owner_user_id=$2::uuid',[q.pid,q.owner]);
   await refuses(()=>claimLiveFixture(query,q,j),/dispatch_blocked/);
   assert.equal((await query('select state from vy_text_publication_request where request_id=$1::uuid and visitor_user_id=$2::uuid',[q.requests[0],q.visitor]))[0].state,'admitted');
  });
  await check('expired publication read refuses; global sweep SQL is parser-only',async()=>{
   await publishLiveFixture(query,e);await query("update vy_text_publication set expires_at=now()-interval '1 second' where publication_id=$1::uuid and owner_user_id=$2::uuid",[e.pid,e.owner]);
   const open=await store.openTextPublication(query,null,{public_id:e.pid});assert.equal(open.can_text,false);await refuses(()=>joinLiveFixture(query,e));
  });
  await check('source cascade removes publication/request contents while claim-once IDs survive',async()=>{
   await query('delete from vy_replica_source where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[a.source,a.rid,a.owner]);
   assert.equal(Number((await query('select count(*) n from vy_text_publication where publication_id=$1::uuid',[a.pid]))[0].n),0);
   const retired=await query('select id,kind from vy_text_publication_id_ledger where id=any($1::uuid[])',[[a.pid,a.requests[0],a.requests[1],a.requests[2]]]);assert.equal(retired.length,4);
   const j=await joinLiveFixture(query,b);await refuses(()=>store.admitTextPublicationRequest(query,b.visitor,{...liveQuestionInput(b,j),request_id:a.requests[0]},options(b)),/admission_blocked/);
   assert.equal(Number((await query('select count(*) n from vy_text_publication_request where request_id=$1::uuid',[a.requests[0]]))[0].n),0);
  });
  result.state='passed';
 }catch(error){result.state='failed';result.failure={phase,code:safeCode(error)};}
 finally{
  if(verified)for(const f of fixtures.filter(f=>attempted.includes(f.label))){phase='cleanup-'+f.label;try{await checkpoint();const clean=await cleanupLivePublicationFixture(db,f);result.cleanup.push({label:f.label,...clean});}catch(error){result.cleanup_errors.push({label:f.label,code:safeCode(error)});}}
  result.private_rows_remaining=result.cleanup_errors.length?null:result.cleanup.reduce((n,c)=>n+c.private_rows_remaining,0);result.retired_id_count=result.cleanup.reduce((n,c)=>n+c.retired_id_count,0);
  if(result.cleanup_errors.length||result.private_rows_remaining!==0)result.state='cleanup_pending';result.completed_at=new Date().toISOString();
 }
 const finalManifest={...manifest,attempted_fixture_labels:[...attempted],preflight_absence_verified:absenceVerified,phase};
 return{manifest:finalManifest,manifest_canonical_sha256:sha256Hex(canonicalJson(finalManifest)),result};
}

// Root supplies the exact retained callback manifest and its canonical hash.
// No seed/publication/admission/provider route exists in this cleanup entry.
export async function resumeTextPublicationAcceptanceCleanup({db,manifest,expectedManifestHash,optIn=false}={}){
 assert.equal(optIn,true);assert.equal(typeof db,'function');assert.match(expectedManifestHash||'',/^[0-9a-f]{64}$/);
 assert.equal(sha256Hex(canonicalJson(manifest)),expectedManifestHash,'cleanup_manifest_changed');
 assert.equal(manifest?.schema,'text-publication-live-acceptance/v1');assert.equal(manifest.database,LIVE_PUBLICATION_DATABASE);assert.equal(manifest.preflight_absence_verified,true);
 assert(Array.isArray(manifest.fixtures)&&manifest.fixtures.length===5);assert(Array.isArray(manifest.attempted_fixture_labels));
 assert.equal((await db('select current_database() name'))[0]?.name,LIVE_PUBLICATION_DATABASE,'wrong_database');
 const cleanup=[];
 for(const m of manifest.fixtures.filter(m=>manifest.attempted_fixture_labels.includes(m.label))){
  const f={...m,other:m.otherVisitor,records:m.evidenceIds.map(evidence_id=>({evidence_id})),account:m.consentIds.map(consent_id=>({consent_id})),body:'cleanup-only'};
  assert.match(f.budgetId,/^synthetic-text-publication-[0-9a-f-]{36}$/);liveFixtureManifest(f);
  cleanup.push({label:f.label,...await cleanupLivePublicationFixture(db,f)});
 }
 return{state:cleanup.every(c=>c.private_rows_remaining===0)?'cleanup_complete':'cleanup_pending',cleanup,provider_calls:0,retired_id_policy:'preserved'};
}

export async function dryCheckTextPublicationAcceptance(){
 let calls=0;
 await assert.rejects(()=>runTextPublicationAcceptance({db:async()=>{calls++;},onFixtureManifest:async()=>{}}),/execution_clearance/);assert.equal(calls,0);
 const plan=await prepareTextPublicationAcceptance();assert.equal(plan.inventory.length,17);assert.equal(plan.fixtures.length,5);
 const ids=plan.manifest.fixtures.flatMap(f=>[f.owner,f.visitor,f.otherVisitor,f.rid,f.sheet,f.item,f.source,f.pid,f.sparePid,f.ruleId,f.primarySelectionId,...f.requests,...f.reservations,...f.consentIds,...f.evidenceIds]);assert.equal(new Set(ids).size,ids.length);
 assert(!JSON.stringify(plan.manifest).includes('KEK'));assert(!JSON.stringify(plan.manifest).includes('session_token'));
 let manifests=0;const wrong=await runTextPublicationAcceptance({optIn:true,onFixtureManifest:async()=>{manifests++;},db:async sql=>{calls++;assert.equal(sql,'select current_database() name');return[{name:'not_the_development_database'}];}});assert.equal(wrong.result.state,'failed');assert.equal(wrong.result.cleanup.length,0);assert.equal(calls,1);assert(manifests>0);
 const malformed={...plan.manifest,preflight_absence_verified:true,attempted_fixture_labels:[]};
 await assert.rejects(()=>resumeTextPublicationAcceptanceCleanup({optIn:true,db:async()=>{throw Error('db_must_not_run');},manifest:malformed,expectedManifestHash:'0'.repeat(64)}),/cleanup_manifest_changed/);
 const f=plan.fixtures[0],terminal=await store.publishTextPublication(async(sql,args)=>{assert.equal(sql,store.TEXT_PUBLICATION_READ_SQL);assert.deepEqual(args,[f.pid]);return[{publication_id:f.pid,replica_id:f.rid,owner_user_id:f.owner,state:'revoked',review_hash:null}];},f.owner,{...scope(f),publication_id:f.pid,expected_review_hash:'0'.repeat(64),statement_set:store.TEXT_PUBLICATION_STATEMENT_SET,attestations:Object.fromEntries(store.TEXT_PUBLICATION_STATEMENTS.map(s=>[s.id,true]))},options(f));
 assert.equal(terminal.created,false);assert.equal(terminal.publication.state,'revoked');assert.equal(terminal.publication.publication_never_created,true);
 return{passed:6,checks:['explicit opt-in before any DB','exact development guard before SQL mutation','all fixture IDs unique and predeclared','manifest excludes crypto/session credentials','cleanup rejects changed manifest before DB','actual store terminal publish replay is no-op response, never a required exception'],prepared_SQL:17,prepared_fixtures:5,SQL_executed:0,provider_calls:0};
}
