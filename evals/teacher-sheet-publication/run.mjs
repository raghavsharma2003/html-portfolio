// Actual review/publish functions and HTTP handler; synthetic DB, no SQL proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadFixtureAgent} from '../room/fixtures.mjs';
import {reviewOwnedTeacherSheetPublication as review,publishOwnedTeacherSheet as publish,requireTeacherSheetPublicationReview,BOUND_TEACHER_SHEET_PUBLISH_SQL} from '../../api/_teacher-sheet-draft.js';
import {runTeacherSheetPublicationSqlChecks} from './live.mjs';
import {fixture,owner,other,replica,agent,sheetId,consent,row} from './fixtures.mjs';
const sheet=(await loadFixtureAgent(fileURLToPath(new URL('../../',import.meta.url)))).SHEET;
let count=0;async function check(name,fn){await fn();console.log('PASS '+name);count++;}
const ready=()=>fixture({agentId:agent,rows:[row(structuredClone(sheet))]});
await check('read-only missing, unbound and claimed-consent drafts cannot publish',async()=>{
 for(const rows of [[],[row({...sheet,consentArtifactId:consent},{agent_id:null,consent_artifact_id:null})]]){
  const f=fixture({rows});const r=await review(f.db,owner,replica);assert.equal(r.ok,false);assert(r.blockers.includes('publication_binding_unavailable'));assert.equal(r.consent_basis,'persisted_sheet_column');assert(f.state.calls.every(c=>! /\b(update|insert|delete)\b/.test(c.sql)));
  if(r.review){assert.equal((await publish(f.db,owner,replica,{review:r.review})).ok,false);assert(!f.state.calls.some(c=>c.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL));}
 }
});
await check('eligible historical row requires actual column, content gates, and keeps missing phrase evidence unverified',async()=>{
 const f=ready(),r=await review(f.db,owner,replica);assert.equal(r.ok,true);assert.equal(r.phraseBank.verified,false);assert.equal(r.review.sheet_id,sheetId);assert(!JSON.stringify(r).includes(consent));
 for(const mutate of [s=>s.consent_artifact_id=null,s=>s.sheet.cloneDisclosureFact='',s=>s.status='revoked']){const x=ready();mutate(x.state.rows[0]);assert.equal((await review(x.db,owner,replica)).ok,false);}
});
await check('old latest-bound caller can publish older row; reviewed caller refuses newer unbound editor subject',async()=>{
 const rows=[row(structuredClone(sheet)),row({name:'Private latest'},{sheet_id:'88888888-8888-4888-8888-888888888888',agent_id:null,consent_artifact_id:null})];
 const old=fixture({agentId:agent,rows});assert.equal((await publish(old.db,owner,replica)).sheet.sheet_id,sheetId);
 const f=fixture({agentId:agent,rows}),r=await review(f.db,owner,replica);assert.equal(r.review.sheet_id,rows[1].sheet_id);assert.equal(r.ok,false);assert.equal((await publish(f.db,owner,replica,{review:r.review})).ok,false);assert(f.state.rows.every(s=>s.status==='draft'));
});
await check('same reviewed id/version/hash only; owner and latest-row changes refuse before mutation',async()=>{
 for(const mutate of [s=>s.rows[0].sheet.identityWho+=' changed',s=>s.rows[0].version+='changed',s=>s.rows[0].consent_artifact_id=other,s=>s.rows.push(row(structuredClone(sheet),{sheet_id:other})),s=>s.owner=other]){
  const f=ready(),key=(await review(f.db,owner,replica)).review;mutate(f.state);
  if(f.state.owner===other)assert.equal(await publish(f.db,owner,replica,{review:key}),null);
  else await assert.rejects(()=>publish(f.db,owner,replica,{review:key}),e=>e.code==='teacher_sheet_publication_review_changed');
  assert(!f.state.calls.some(c=>c.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL));
 }
});
await check('exact reviewed publish/readback and SQL CAS refuse intervening changes without demotion',async()=>{
 const f=ready(),key=(await review(f.db,owner,replica)).review,r=await publish(f.db,owner,replica,{review:key});assert.equal(r.ok,true);assert.equal(r.sheet.status,'published');assert.deepEqual((await review(f.db,owner,replica)).review,key);const writes=f.state.calls.filter(c=>c.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL).length;assert.equal((await publish(f.db,owner,replica,{review:key})).ok,true);assert.equal(f.state.calls.filter(c=>c.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL).length,writes);
 for(const mutate of [s=>s.rows[0].sheet.identityWho+=' race',s=>s.rows[0].status='revoked',s=>s.rows[0].consent_artifact_id=null,s=>s.owner=other]){
  const x=fixture({agentId:agent,rows:[row(structuredClone(sheet))],beforePublish:mutate}),k=(await review(x.db,owner,replica)).review;
  await assert.rejects(()=>publish(x.db,owner,replica,{review:k}),e=>e.code==='teacher_sheet_publish_conflict');assert(x.state.rows.every(s=>s.status!=='published'));
 }
});
await check('review exact key rejects absent/malformed/newline and never trusts JSON consent',()=>{
 for(const key of [undefined,null,{},[],{sheet_id:sheetId+'\n',version:'v',snapshot_hash:'a'.repeat(64)},{sheet_id:sheetId,version:'v',snapshot_hash:'a'.repeat(64)+'\n'}])assert.throws(()=>requireTeacherSheetPublicationReview(key),e=>e.code==='teacher_sheet_publication_review_required');
});
// Import the exact handler body with only boundary dependencies replaced.
let db,auth=owner;const seen=[];
// WS-R170: `consume` (api/_rate-limit.js) is a new boundary import this
// handler makes on `publish` — the persistent `teacher_sheet_publish_owner`
// gate, `evals/rate-limit/run.mjs`'s own §9 subject. Stubbed here exactly
// like `allow` immediately below it (always admit): this suite is about
// review/publish logic, not the rate limiter, which has its own suite.
globalThis.__publicationFixture={q:(...args)=>db(...args),requireUser:async()=>{if(!auth)throw Object.assign(new Error('auth_required'),{status:401,code:'auth_required'});return {id:auth};},allow:()=>true,consume:async()=>({ok:true,remaining:999,retryAfterSeconds:60}),ipOf:()=>'',obsBestEffort:()=>{},readContextProposalReview:()=>{throw Error('wrong dispatch');}};
let source=readFileSync(new URL('../../api/teacher-sheet.js',import.meta.url),'utf8');
source=source.replace(/import \{([^}]+)\} from ["'](\.\/[^"']+)["'];/g,(all,names,path)=>{
 if(['./_teacher-sheet-draft.js','./_private-teaching-refinement.js'].includes(path))return `import {${names}} from ${JSON.stringify(pathToFileURL(resolve(fileURLToPath(new URL('../../',import.meta.url)),'api',path)).href)};`;
 const cleaned=names.replace(/AuthError\s*,?/, '');return `const {${cleaned}}=globalThis.__publicationFixture;`+(names.includes('AuthError')?'class AuthError extends Error {}':'');
});
const handler=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
async function request(method,body={},query={}){const res={status(n){this.code=n;return this;},setHeader(){},json(data){return {status:this.code,body:data};},end(){return {status:this.code};}};return handler({method,body,query},res);}
await check('actual HTTP GET is read-only; missing review is 409; explicit publish and readback use authenticated owner',async()=>{
 const f=ready();db=(...args)=>{seen.push(args);return f.db(...args);};
 let r=await request('GET',{}, {op:'publication_review',replica_id:replica});assert.equal(r.status,200);assert.equal(r.body.ok,true);const key=r.body.review;
 assert(seen.every(([sql])=>! /\b(update|insert|delete)\b/.test(sql)));
 r=await request('POST',{op:'publish',replica_id:replica});assert.equal(r.status,409);assert.equal(r.body.error,'teacher_sheet_publication_review_required');
 r=await request('POST',{op:'publish',replica_id:replica,review:key});assert.equal(r.status,200);assert.equal(r.body.sheet.status,'published');
 r=await request('GET',{}, {op:'publication_review',replica_id:replica});assert.equal(r.body.sheet.status,'published');assert.deepEqual(r.body.review,key);
 auth=other;r=await request('GET',{}, {op:'publication_review',replica_id:replica});assert.equal(r.status,404);auth=owner;
});
await check('HTTP DB failure is honest failure, not an empty publishable review',async()=>{db=async()=>{throw Error('synthetic DB unavailable');};const r=await request('GET',{}, {op:'publication_review',replica_id:replica});assert.equal(r.status,500);assert.equal(r.body.error,'teacher_sheet_failure');});
await check('live harness refuses malformed input, wrong DB, and missing durable recorder before any write',async()=>{const calls=[];const db=async sql=>{calls.push(sql);return [{name:'vyakti_expert_integration_20260906'}];};await assert.rejects(()=>runTeacherSheetPublicationSqlChecks(db,{sheet:undefined,recordFixtures:async()=>{}}));await assert.rejects(()=>runTeacherSheetPublicationSqlChecks(db,{sheet}));await assert.rejects(()=>runTeacherSheetPublicationSqlChecks(async()=>[{name:'wrong_database'}],{sheet,recordFixtures:async()=>{}}));await assert.rejects(()=>runTeacherSheetPublicationSqlChecks(db,{sheet,recordFixtures:async()=>{throw Error('manifest unavailable');}}));assert(calls.every(sql=>sql==='select current_database() as name'));});
delete globalThis.__publicationFixture;
console.log(`${count} publication source/handler groups passed; no SQL execution or real publication.`);

