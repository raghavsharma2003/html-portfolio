import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as store from '../../api/_text-publication-store.js';
import {createTextPublicationOwnerHandler,createTextPublicationVisitorHandler} from '../../api/_text-publication-runtime.js';
import {sha256Hex} from '../../api/_provenance/contracts.js';
import {fixture,id,owner,rid,pid,visitor,other,env,h} from '../text-publication-store/fixtures.mjs';
import {personFixture} from '../text-publication-store/person-fixture.mjs';
import {beginPinnedAccessPassRaceSession,runTextPublicationAccessPassRace} from './live-race.mjs';

let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('ok '+name);};
const passScope={replica_id:rid,publication_id:pid};
const mint=async(f,count=1)=>store.createTextPublicationAccessPasses(f.db,owner,{...passScope,count});
const question=(session,requestId=id(700))=>({public_id:pid,session_token:session.session_token,request_id:requestId,question:'What is the period?'});
const provider={family:'azure',name:'azure-foundry-structured-output',version:'v1',model:'fixture',prompt_hash:'a'.repeat(64)};
const reservation=requestId=>({reservation_id:id(Number(requestId.slice(-3))+800),budget_id:'access-pass-fixture',state:'reserved',reserved_microusd:500,
 request_hash:h({operation:'dialogue',request_key:'text-publication:'+requestId,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})});

await check('legacy open terms and review hash remain byte-shaped when open is explicit',async()=>{
 const implicit=fixture(),explicit=fixture(),a=await store.readTextPublicationReadiness(implicit.db,owner,implicit.selection,{env}),b=await store.readTextPublicationReadiness(explicit.db,owner,{...explicit.selection,access_mode:'open'},{env});
 assert.deepEqual(a.selected.terms,b.selected.terms);assert.equal(a.selected.review_hash,b.selected.review_hash);assert.equal('access_mode'in a.selected.terms,false);
 await implicit.publish();await explicit.publish('open');assert.deepEqual(implicit.pubs.get(pid).terms,explicit.pubs.get(pid).terms);assert.equal(implicit.pubs.get(pid).request_hash,explicit.pubs.get(pid).request_hash);
});

await check('pass mode is explicit immutable reviewed terms',async()=>{
 const f=fixture(),ready=await store.readTextPublicationReadiness(f.db,owner,{...f.selection,access_mode:'pass'},{env});
 assert.equal(ready.selected.terms.access_mode,'pass');assert.notEqual(ready.selected.review_hash,(await store.readTextPublicationReadiness(f.db,owner,f.selection,{env})).selected.review_hash);
 await f.publish('pass');const opened=await store.openTextPublication(f.db,null,{public_id:pid});assert.equal(opened.terms.access_mode,'pass');assert.equal(opened.can_text,true);
});

await check('pass publication refuses honestly when migration 173 is unavailable',async()=>{
 const f=fixture(),db=(sql,args)=>sql===store.TEXT_PUBLICATION_ACCESS_SCHEMA_SQL?Promise.resolve([{available:false}]):f.db(sql,args);
 const ready=await store.readTextPublicationReadiness(db,owner,{...f.selection,access_mode:'pass'},{env});assert.equal(ready.can_publish,false);assert.equal(ready.state,'unavailable');assert.equal(ready.blockers.find(b=>b.code==='text_publication_access_schema_unavailable')?.responsibility,'platform');
 const reviewed=await store.readTextPublicationReadiness(f.db,owner,{...f.selection,access_mode:'pass'},{env});await assert.rejects(()=>store.publishTextPublication(db,owner,{...f.selection,access_mode:'pass',publication_id:pid,expected_review_hash:reviewed.selected.review_hash,statement_set:reviewed.statement_set,attestations:Object.fromEntries(reviewed.statements.map(s=>[s.id,true]))},{env}),/access_schema_unavailable/);assert.equal(f.pubs.size,0);
});

await check('owner creates bounded one-use plaintext once and ordinary list exposes no secret or visitor',async()=>{
 const f=fixture();await f.publish('pass');const created=await mint(f,2);assert.equal(created.passes.length,2);
 for(const row of created.passes){assert.match(row.code,/^[A-Za-z0-9_-]{32}$/);assert.equal(JSON.stringify(row).includes('hash'),false);}
 const listed=await store.listTextPublicationAccessPasses(f.db,owner,passScope);assert.equal(listed.passes.length,2);
 for(const row of listed.passes){assert.equal('code'in row,false);assert.equal('code_hash'in row,false);assert.equal('visitor_user_id'in row,false);}
 assert.equal(new Set(created.passes.map(p=>p.code)).size,2);
 await assert.rejects(()=>mint(f,21),/count_invalid/);
 f.pubs.get(pid).access_pass_issued_count=99;const before=f.passes.size;await assert.rejects(()=>mint(f,2),/limit_reached/);assert.equal(f.passes.size,before);assert.equal(f.pubs.get(pid).access_pass_issued_count,99);
});

await check('first join requires a valid pass and binds it to one authenticated visitor',async()=>{
 const f=fixture();await f.publish('pass');const [{code,pass_id}]= (await mint(f)).passes;
 await assert.rejects(()=>f.join(),/access_required/);await assert.rejects(()=>f.join('not-a-pass'),/access_required/);assert.equal(f.visitors.size,0);
 const joined=await f.join(code);assert(joined.session_token);assert.equal(f.passes.get(pass_id).state,'claimed');assert.equal(f.passes.get(pass_id).visitor_user_id,visitor);
 const returned=await f.join();assert(returned.session_token);assert.equal(f.passes.get(pass_id).visitor_user_id,visitor);
 await assert.rejects(()=>f.join(code,other),/access_required/);assert.equal(f.visitors.has(other),false);
});

await check('two passes isolate two visitors and do not share sessions',async()=>{
 const f=fixture();await f.publish('pass');const [a,b]=(await mint(f,2)).passes,j1=await f.join(a.code,visitor),j2=await f.join(b.code,other);
 assert.notEqual(j1.session_token,j2.session_token);assert.equal(f.passes.get(a.pass_id).visitor_user_id,visitor);assert.equal(f.passes.get(b.pass_id).visitor_user_id,other);
 await assert.rejects(()=>store.admitTextPublicationRequest(f.db,other,question(j1,id(701)),{env}),/session_invalid/);
});

await check('pass access composes with optional continuity and bound rejoin',async()=>{
 const f=personFixture({memory:true,accessMode:'pass'});await f.publish();const [{code,pass_id}]=(await store.createTextPublicationAccessPasses(f.db,owner,{...passScope,count:1})).passes;
 const first=await f.join(true,code);assert.equal(first.memory.enabled,true);assert.equal(f.visitors.get(visitor).access_pass_id,pass_id);
 const returned=await f.join(true);assert(returned.session_token);assert.equal(returned.memory.enabled,true);assert.equal(f.passes.get(pass_id).visitor_user_id,visitor);
});

await check('revoking a claimed pass invalidates join, ask, read and waiting claim before provider spend',async()=>{
 const f=fixture();await f.publish('pass');const [{code,pass_id}]=(await mint(f)).passes,joined=await f.join(code),input=question(joined,id(702));
 assert.equal((await store.admitTextPublicationRequest(f.db,visitor,input,{env})).created,true);
 const revoked=await store.revokeTextPublicationAccessPass(f.db,owner,{...passScope,pass_id});assert.equal(revoked.pass.state,'revoked');
 assert.equal((await store.revokeTextPublicationAccessPass(f.db,owner,{...passScope,pass_id})).pass.state,'revoked');
 await assert.rejects(()=>f.join(),/access_required/);await assert.rejects(()=>store.readTextPublicationRequest(f.db,visitor,input,{env}),/session_invalid|access_revoked/);
 await assert.rejects(()=>store.admitTextPublicationRequest(f.db,visitor,{...input,request_id:id(703)},{env}),/session_invalid|access_revoked/);
 await assert.rejects(()=>store.claimTextPublicationRequest(f.db,visitor,{...input,provider,reservation:reservation(input.request_id)},{env}),/session_invalid|access_revoked/);
 assert.equal(f.requests.get(input.request_id).state,'admitted');
});

await check('revocation after claim blocks completion and keeps the settled boundary explicit',async()=>{
 const f=fixture();await f.publish('pass');const [{code,pass_id}]=(await mint(f)).passes,joined=await f.join(code),input=question(joined,id(704));
 await store.admitTextPublicationRequest(f.db,visitor,input,{env});const claim=await store.claimTextPublicationRequest(f.db,visitor,{...input,provider,reservation:reservation(input.request_id)},{env});
 await store.revokeTextPublicationAccessPass(f.db,owner,{...passScope,pass_id});
 await assert.rejects(()=>store.completeTextPublicationRequest(f.db,visitor,{...input,dispatch_token:claim.dispatch_token,answer:'Two seconds.',raw_output:{reply:'Two seconds.'},gate:{gated:true,finding_count:0},billing_state:'settled'},{env}),/session_invalid|access_revoked/);
 assert.equal(f.requests.get(input.request_id).state,'dispatched');
});

await check('foreign owner cannot list, create or revoke another publication pass',async()=>{
 const f=fixture();await f.publish('pass');const [{pass_id}]=(await mint(f)).passes;
 for(const work of [()=>store.listTextPublicationAccessPasses(f.db,other,passScope),()=>store.createTextPublicationAccessPasses(f.db,other,{...passScope,count:1}),()=>store.revokeTextPublicationAccessPass(f.db,other,{...passScope,pass_id})])await assert.rejects(work,/not_found/);
});

await check('SQL keeps claim atomic and every runtime fence checks claimed access',async()=>{
 assert.match(store.TEXT_PUBLICATION_JOIN_PASS_SQL,/a\.state='available'.*a\.visitor_user_id is null/s);
 assert.match(store.TEXT_PUBLICATION_JOIN_PASS_SQL,/update vy_text_publication_access_pass a set state='claimed'/);
 assert.match(store.TEXT_PUBLICATION_ACCESS_PASS_CREATE_SQL,/set access_pass_issued_count=p\.access_pass_issued_count\+cardinality/);
 assert.match(store.TEXT_PUBLICATION_ACCESS_PASS_CREATE_SQL,/p\.access_pass_issued_count\+cardinality\(\$4::uuid\[\]\)<=\$6::integer/);
 assert.match(store.TEXT_PUBLICATION_ACCESS_PASS_REVOKE_SQL,/select \* from revoked[\s\S]*select l\.pass_id,l\.state/);
 assert.match(store.TEXT_PUBLICATION_JOIN_PASS_SQL,/on conflict\(publication_id,visitor_user_id\)/);
 assert.match(store.TEXT_PUBLICATION_CLAIM_SQL,/visitor as materialized/);assert.match(store.TEXT_PUBLICATION_COMPLETE_SQL,/visitor as materialized/);
 const struck=store.TEXT_PUBLICATION_JOIN_PASS_SQL.replace("and a.state='available' and a.visitor_user_id is null",'');assert(!/a\.state='available'.*a\.visitor_user_id is null/s.test(struck));
 for(const sql of [store.TEXT_PUBLICATION_UNPUBLISH_SQL,store.TEXT_PUBLICATION_EXPIRE_SQL]){assert.match(sql,/update vy_text_publication_access_pass a set state='revoked'/);assert.match(sql,/access_pass_id=null/);}
 assert.match(store.TEXT_PUBLICATION_ACCOUNT_FORGET_SQL,/set state='revoked',visitor_user_id=null/);assert.match(store.TEXT_PUBLICATION_ACCOUNT_FORGET_SQL,/access_pass_id=null/);
});

await check('migration 173 is mirrored and erasure paths name the access table',async()=>{
 const migration=readFileSync(new URL('../../db/migrations/173_text_publication_access_pass.sql',import.meta.url),'utf8').trim().replace(/\r\n/g,'\n'),schema=readFileSync(new URL('../../db/schema.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 assert(schema.includes(migration.slice(migration.indexOf('create table'))));assert(migration.includes('vy_text_access_pass_claimed_visitor_ix'));assert(migration.includes('foreign key (access_pass_id,publication_id)'));
 const erasure=readFileSync(new URL('../../api/_replica-full-erasure.js',import.meta.url),'utf8'),personTables=readFileSync(new URL('../persontables.mjs',import.meta.url),'utf8');
 assert(erasure.includes('delete from vy_text_publication_access_pass'));assert(personTables.includes("'vy_text_publication_access_pass'"));assert(store.TEXT_PUBLICATION_ACCOUNT_FORGET_SQL.includes('update vy_text_publication_access_pass'));
});

await check('pass credential never appears in URL, session token, list SQL or source logging calls',async()=>{
 const client=readFileSync(new URL('../../src/studio/publication/publicationApi.ts',import.meta.url),'utf8'),runtime=readFileSync(new URL('../../api/_text-publication-runtime.js',import.meta.url),'utf8');
 assert(!/query\.set\(["']access_pass["']/.test(client));assert(!/new URLSearchParams\(\{[^}]*\baccess_pass\s*:/.test(client));assert(!/localStorage|sessionStorage/.test(client.match(/\baccess_pass\s*:[\s\S]{0,300}/)?.[0]||''));
 assert(!store.TEXT_PUBLICATION_ACCESS_PASS_LIST_SQL.includes('code_hash'));assert(!store.TEXT_PUBLICATION_ACCESS_PASS_LIST_SQL.includes('visitor_user_id'));
 assert(!/console\.(?:log|error)[^\n]*access_pass/.test(runtime));
});

await check('actual owner and visitor runtimes dispatch every access operation without changing the credential',async()=>{
 const seen=[],ownerStore={
  listTextPublicationAccessPasses:async(_db,actor,input)=>{seen.push(['list',actor,input]);return{passes:[]};},
  createTextPublicationAccessPasses:async(_db,actor,input)=>{seen.push(['create',actor,input]);return{passes:[{pass_id:id(990),state:'available',code:'A'.repeat(32)}]};},
  revokeTextPublicationAccessPass:async(_db,actor,input)=>{seen.push(['revoke',actor,input]);return{pass:{pass_id:input.pass_id,state:'revoked'}};},
 };
 const ownerRun=createTextPublicationOwnerHandler({db:()=>{},requireUser:async()=>({id:owner}),store:ownerStore,resolveGenerator:async()=>{},engine:{},hasGate:()=>false,env});
 const response=()=>({writableEnded:false,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},on(){},off(){}});
 for(const [method,input,code] of [['GET',{op:'access_passes',...passScope},200],['POST',{op:'create_access_passes',...passScope,count:1},201],['POST',{op:'revoke_access_pass',...passScope,pass_id:id(990)},200]]){const res=response();await ownerRun({method,query:method==='GET'?input:{},body:method==='POST'?input:{},on(){},off(){}},res);assert.equal(res.statusCode,code);}
 const visitorStore={joinTextPublication:async(_db,actor,input)=>{seen.push(['join',actor,input]);return{joined:true};}};
 const visitorRun=createTextPublicationVisitorHandler({db:()=>{},requireUser:async()=>({id:visitor}),store:visitorStore,resolveGenerator:()=>{},engine:{},gateReply:()=>{},hasGate:()=>false,honestyContextFor:()=>{},loadNeverRules:()=>{},compileNeverRules:()=>{},env});
 const credential='B'.repeat(32),res=response();await visitorRun({method:'POST',body:{op:'join',public_id:pid,access_pass:credential},on(){},off(){},aborted:false},res);
 assert.equal(res.statusCode,200);assert.equal(seen.at(-1)[2].access_pass,credential);assert.deepEqual(seen.map(x=>x[0]),['list','create','revoke','join']);
});

await check('live-race cleanup covers a partial seed but never an unverified preexisting fixture',async()=>{
 const db=async sql=>sql==='select current_database() name'?[{name:'vyakti_expert_integration_20260906'}]:[];
 let cleanupCalls=0;
 const partial=await runTextPublicationAccessPassRace({db,connect:async()=>{},onFixtureManifest:async()=>{},optIn:true,fixtureOps:{
  assertAbsent:async()=>{},seed:async()=>{throw Object.assign(new Error('partial_seed_fixture'),{code:'PARTIAL_SEED'});},
  cleanup:async()=>{cleanupCalls++;return{private_rows_remaining:0};},
 }});
 assert.equal(partial.failure?.code,'PARTIAL_SEED');assert.equal(cleanupCalls,1);assert.deepEqual(partial.cleanup,[{private_rows_remaining:0}]);
 const absent=await runTextPublicationAccessPassRace({db,connect:async()=>{},onFixtureManifest:async()=>{},optIn:true,fixtureOps:{
  assertAbsent:async()=>{throw Object.assign(new Error('fixture_presence_unknown'),{code:'ABSENCE_UNKNOWN'});},seed:async()=>assert.fail('seed must not run'),
  cleanup:async()=>{cleanupCalls++;return{private_rows_remaining:0};},
 }});
 assert.equal(absent.failure?.code,'ABSENCE_UNKNOWN');assert.equal(cleanupCalls,1);assert.deepEqual(absent.cleanup,[]);
});

await check('live-race captures the backend PID only after BEGIN and transaction limits',async()=>{
 const calls=[],session={db:async sql=>{calls.push(sql);return sql.startsWith('select current_database()')?[{name:'vyakti_expert_integration_20260906',pid:'4312'}]:[];}};
 await beginPinnedAccessPassRaceSession(session);
 assert.deepEqual(calls,['BEGIN',"set local statement_timeout='10s'","set local lock_timeout='7s'",'select current_database() name,pg_backend_pid() pid']);
 assert.equal(session.pid,4312);
});

console.log(JSON.stringify({passed,scope:'Actual publication store with an in-memory SQL semantic fixture. No PostgreSQL parser, provider, model, network or cloud calls.'}));
