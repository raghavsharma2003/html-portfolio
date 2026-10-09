import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import * as store from '../../api/_text-publication-store.js';
import * as incumbentEngine from '../../api/_engine.gen.js';
import {createTextPublicationVisitorHandler} from '../../api/_text-publication-runtime.js';
import {gateReply,hasGate,honestyContextFor} from '../../api/_surface.js';
import {compileNeverRules} from '../../api/_never-rules.js';
import {canonicalJson,sha256Hex} from '../../api/_provenance/contracts.js';
import {fixture,id,owner,rid,pid,visitor,requestId,other,h,env} from './fixtures.mjs';
import {personDraft,personFixture,personPublicationSqlInventory} from './person-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const compileModule=async source=>{const built=await build({stdin:{contents:source,loader:'ts',resolveDir:root+'src/engine'},bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));};
const current=await build({entryPoints:[root+'src/engine/publishedMaterialAssistant.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {compilePublishedMaterialAssistant:compile}=await import('data:text/javascript;base64,'+Buffer.from(current.outputFiles[0].contents).toString('base64'));
const prior=await compileModule(execFileSync('git',['show','HEAD:src/engine/publishedMaterialAssistant.ts'],{cwd:root,encoding:'utf8'}));
globalThis.fetch=()=>{throw Error('external_network_forbidden');};
let passed=0;const check=async(name,run)=>{await run();passed++;console.log('ok '+name);};
const inputFor=async f=>{await f.publish();const j=await f.join();const input={public_id:pid,session_token:j.session_token,request_id:requestId,question:'What is the period, and where was this measured?'};return {input,admitted:await store.admitTextPublicationRequest(f.db,visitor,input,{env})};};

await check('person profile has explicit reviewed projection and consent without a teaching subject or voice',async()=>{
 const f=personFixture();delete f.row.sheet.subjectDomain;const r=await f.readiness();assert.equal(r.can_publish,true);assert.equal(r.statement_set,store.PERSON_PUBLICATION_STATEMENT_SET);
 assert(r.statements[0].text.includes('every profile field'));assert.equal(r.selected.projection.sheetKind,'person');assert.equal(r.selected.projection.subjectDomain,undefined);
 assert(!JSON.stringify(r.selected.projection).includes('UNRELEASED'));assert.equal(r.selected.terms.voice,false);assert.equal(r.drafts[0].sheet_kind,'person');
});
await check('legacy teacher permission cannot publish personal fields even with current review hash',async()=>{
 const f=personFixture(),r=await f.readiness();await assert.rejects(()=>store.publishTextPublication(f.db,owner,{...f.selection,publication_id:pid,expected_review_hash:r.selected.review_hash,statement_set:store.TEXT_PUBLICATION_STATEMENT_SET,attestations:Object.fromEntries(r.statements.map(s=>[s.id,true]))},{env}),/attestation_required/);assert.equal(f.pubs.size,0);
});
await check('person publish, open, visitor join and admission reach dedicated compiler authority',async()=>{
 const f=personFixture(),{admitted}=await inputFor(f),p=await store.openTextPublication(f.db,null,{public_id:pid});assert.equal(p.can_text,true);assert.equal(p.subject_domain,null);assert.equal(p.can_voice,false);
 assert.equal(f.pubs.get(pid).receipt.scope,store.PERSON_PUBLICATION_STATEMENT_SET);assert.equal(admitted.compilerInput.authority.basis,'account_person_material_publication/v1');
 const c=compile(admitted.compilerInput);assert(c.system.includes('REVIEWED ACCOUNT PERSON JSON'));assert(c.system.includes('Independent ceramic artist'));assert(c.system.includes('No promises about firing results'));assert(c.system.includes('roman-hinglish'));
 assert(c.system.includes('Missing or conflicting support'));assert(c.system.includes('unsupported parts explicitly unresolved'));assert(c.system.includes(f.row.body));assert(!c.system.includes('UNRELEASED'));assert(!c.system.includes('permanent mentor'));assert(!c.system.includes('TEACHER'));assert.deepEqual(c.privateMemoryRecord,[]);
 assert.throws(()=>prior.compilePublishedMaterialAssistant(admitted.compilerInput),/compiler_invalid/);
});
await check('teacher prompt bytes are identical for old memory-off and continuity profiles',async()=>{
 const f=fixture(),{admitted}=await inputFor(f),a=admitted.compilerInput;assert.equal(compile(a).system,prior.compilePublishedMaterialAssistant(a).system);
 const v2={...a,authority:{...a.authority,basis:'account_material_publication/v2'},privateContinuity:{enabled:false,memoryEpoch:'0',policyHash:'a'.repeat(64),exchanges:[]}};
 assert.equal(compile(v2).system,prior.compilePublishedMaterialAssistant(v2).system);
});
await check('reviewed person publication is immutable across private edits and refuses changed public source',async()=>{
 const f=personFixture();await f.publish();f.row.sheet.identityLife='NEW_PRIVATE_LIFE';f.row.sheet.sheetKind='teacher';
 const j=await f.join(),a=await store.admitTextPublicationRequest(f.db,visitor,{public_id:pid,session_token:j.session_token,request_id:requestId,question:'Who is this?'},{env});assert(!compile(a.compilerInput).system.includes('NEW_PRIVATE_LIFE'));
 f.row.body+=' changed';assert.equal((await store.openTextPublication(f.db,null,{public_id:pid})).can_text,false);
});
await check('stale review, wrong receipt kind, unknown kind and private grant never authorize sharing',async()=>{
 const f=personFixture(),r=await f.readiness();f.row.sheet.identityWho='Changed';await assert.rejects(()=>store.publishTextPublication(f.db,owner,{...f.selection,publication_id:pid,expected_review_hash:r.selected.review_hash,statement_set:r.statement_set,attestations:Object.fromEntries(r.statements.map(s=>[s.id,true]))},{env}),/review_changed/);
 await f.publish();const p=f.pubs.get(pid);p.receipt.scope=store.TEXT_PUBLICATION_STATEMENT_SET;p.receipt_hash=h(p.receipt);assert.equal((await store.openTextPublication(f.db,null,{public_id:pid})).can_text,false);
 const unknown=personFixture();unknown.row.sheet.sheetKind='other';assert.equal((await unknown.readiness()).can_publish,false);
 const g=personFixture(),{admitted}=await inputFor(g);assert.throws(()=>compile({...admitted.compilerInput,authority:{...admitted.compilerInput.authority,basis:'owner_question_attestation_v1'}}));
});
await check('person compiler rejects unreleased fields, malformed style, added teacher authority and cross-profile basis',async()=>{
 const f=personFixture(),{admitted}=await inputFor(f),input=admitted.compilerInput;
 for(const patch of [{subjectDomain:'physics'},{credentialFacts:'leak'},{personValues:[null]},{personTalk:{register:'casual',scriptBaseline:'english',privateNotes:'leak'}},{personTalk:{register:'invented',scriptBaseline:'english'}},{sheetKind:'teacher'},{identityWho:''}])assert.throws(()=>compile({...input,projection:{...input.projection,...patch}}),/compiler_invalid/);
 assert.throws(()=>compile({...input,authority:{...input.authority,basis:'account_material_publication/v1'}}),/compiler_invalid/);
 assert.throws(()=>compile({...input,privateContinuity:{enabled:true,exchanges:[]}}),/compiler_invalid/);
});
await check('person optional continuity uses existing memory contract and explicit separate review',async()=>{
 const f=personFixture({memory:true}),r=await f.readiness();assert.equal(r.statement_set,store.PERSON_PUBLICATION_V2_STATEMENT_SET);await f.publish();assert.equal(f.pubs.get(pid).version,2);
 const j=await f.join(true),a=await store.admitTextPublicationRequest(f.db,visitor,{public_id:pid,session_token:j.session_token,request_id:requestId,question:'Hello'},{env});
 assert.equal(a.compilerInput.authority.basis,'account_person_material_publication/v2');assert.equal(a.compilerInput.privateContinuity.enabled,true);assert(compile(a.compilerInput).system.includes('PRIVATE VISITOR CONTINUITY JSON'));
 await assert.rejects(()=>store.admitTextPublicationRequest(f.db,other,{public_id:pid,session_token:j.session_token,request_id:id(31),question:'Hello'},{env}),/session_invalid/);
});
await check('actual visitor runtime dispatches once, settles and returns grounded partial synthetic answer',async()=>{
 const f=personFixture();await f.publish();const j=await f.join();let dispatched=0,settled=0;
 const provider={family:'azure',name:'azure-foundry-structured-output',version:'fixture-v1',model:'fixture'};
 const reservation={reservation_id:id(91),budget_id:'fixture',state:'reserved',reserved_microusd:500,request_hash:h({operation:'dialogue',request_key:'text-publication:'+requestId,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})};
 const answer='The period is 2 seconds. The material does not say where it was measured.';
 const handler=createTextPublicationVisitorHandler({db:f.db,store,engine:{...incumbentEngine,compilePublishedMaterialAssistant:compile},env,requireUser:async()=>({id:visitor}),gateReply,hasGate,honestyContextFor,compileNeverRules,loadNeverRules:async()=>[],
  resolveGenerator:async()=>({...provider,billing:{meter:'azure_foundry_tokens'},generate:async({prompt})=>{dispatched++;assert.equal(prompt.schema,'account_person_material_publication/v1');assert(prompt.messages[0].content.includes('unsupported parts explicitly unresolved'));return {output:{reply:answer,delivery:{mode:'grounded',pace:'natural',intensity:0.3,language_hint:'en',nonverbals:[]}},usage:{input_tokens:100,output_tokens:24}};}}),
  budget:{foundryBudgetConfig(){},reserveFoundrySpend:async()=>reservation,beginFoundrySpend:async()=>{},settleFoundrySpend:async()=>{settled++;},releaseFoundrySpendBeforeCall:async()=>{throw Error('unexpected release');},markFoundrySpendUncertain:async()=>{}}});
 const req=Object.assign(new EventEmitter(),{method:'POST',body:{op:'ask',public_id:pid,session_token:j.session_token,request_id:requestId,question:'What is the period and where was it measured?'}});
 const response=()=>Object.assign(new EventEmitter(),{status(n){this.code=n;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});const res=response();
 await handler(req,res);assert.equal(res.code,201);assert.equal(res.body.request.answer,answer);assert.equal(dispatched,1);assert.equal(settled,1);assert.equal(res.body.request.can_voice,false);
 const again=response();await handler(req,again);assert.equal(again.code,200);assert.equal(dispatched,1);
});
await check('projection is allowlisted and whole-field bounded consistently before review',()=>{
 const d=personDraft();for(const patch of [{name:''},{identityWho:''},{personLine:'x'.repeat(141)},{personValues:Array(8).fill('x')},{personNeverSay:Array(25).fill('x')},{identityLife:'x'.repeat(4001)},{personTalk:{register:'casual',scriptBaseline:'english',codeSwitchNote:123}}])assert.throws(()=>store.publicationProjection({...d,...patch}),/projection_invalid/);
 const p=store.publicationProjection(d);assert.equal(p.subjectDomain,undefined);assert.equal(p.privateNotes,undefined);assert.equal(p.credentialFacts,undefined);
});
const out=root+'scratchpad/person-publication-oct9';mkdirSync(out,{recursive:true});
const inventory=await personPublicationSqlInventory();writeFileSync(out+'/sql-inventory.json',JSON.stringify(inventory,null,2));
writeFileSync(out+'/receipt.json',JSON.stringify({passed,source_sha256:sha256Hex(canonicalJson({store:store.TEXT_PUBLICATION_PUBLISH_SQL})),scope:'offline real store, compiler and visitor runtime with explicit SQL and provider stubs; no SQL execution or model quality claim',real_provider_calls:0},null,2));
console.log(JSON.stringify({passed,sql_inventory:out+'/sql-inventory.json',scope:'offline JS/crypto/compiler/runtime; actual PostgreSQL and Azure behavior unverified',provider_calls:0}));
