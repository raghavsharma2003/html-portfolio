import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {modernCaptureReadiness,requireModernCaptureReadiness} from '../api/_liveness/capture-readiness.js';
import {isComparisonSource} from '../api/_replica-processing/comparison.js';
const route = readFileSync(new URL('../api/replica-liveness.js',import.meta.url),'utf8');
const sourceRoute = readFileSync(new URL('../api/replica-source.js',import.meta.url),'utf8');
let checks=0;
async function check(name,fn){await fn();console.log(`ok ${++checks} - ${name}`);}
async function load(source,deps){
 const ast=ts.createSourceFile('handler.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const imports=ast.statements.filter(ts.isImportDeclaration);
 const names=imports.flatMap(n=>n.importClause.namedBindings.elements.map(e=>e.name.text));
 for(const name of names)assert(name in deps,`missing explicit dependency ${name}`);
 for(const n of imports.reverse())source=source.slice(0,n.getStart(ast))+source.slice(n.end);
 const key='__modern_readiness_'+Math.random().toString(36).slice(2);globalThis[key]=deps;
 try{return(await import(`data:text/javascript;base64,${Buffer.from(`const {${names.join(',')}}=globalThis[${JSON.stringify(key)}];\n${source}`).toString('base64')}`)).default;}
 finally{delete globalThis[key];}
}
async function run(op,{text=route,ready=false,auth=true,mode='live_challenge',owned=true}={}){
 const calls=[]; const hit=(name,value)=>async()=>{calls.push(name);return value;};
 const no=()=>{throw Error('unexpected dependency');};
 class AuthError extends Error{constructor(){super('unauthorized');this.code='unauthorized';this.status=401;}}
 class ReplicaStorageError extends Error{}
 const row={source_id:'source',capture_mode:mode,state:'pending_upload',storage_bucket:'fixture',mime:'video/webm'};
 const challenge={challenge_id:'challenge',state:'issued',face_session_state:'not_started'};
 const d={q:no,requireUser:async()=>{calls.push('auth');if(!auth)throw new AuthError();return{id:'owner'};},AuthError,allow:()=>true,ipOf:()=>'',
  modernCaptureReadiness,requireModernCaptureReadiness:()=>{calls.push('readiness');if(!ready)requireModernCaptureReadiness();},
  issueOwnedModernChallenge:hit('issue',challenge),getOwnedModernComparisonDescriptor:hit('comparison',null),
  latestOwnedChallenge:hit('status',challenge),cancelOwnedChallenge:hit('cancel',challenge),
  createChallengeSource:hit('source',row),finalizeChallengeSource:hit('finalize',{challenge,source:{...row,state:'quarantined'}}),clientSource:x=>x,
  assertUploadWithinSourceFence:(_s,x)=>x,getPendingSource:hit('pending',owned?row:null),reserveOwnedSourceUploadAuthorization:hit('reserve',row),
  configuredFaceSessionBroker:()=>{calls.push('broker');return{};},configuredFaceSessionErasureBroker:no,
  deleteOwnedFaceSessionNow:no,pollOwnedFaceSession:hit('poll',challenge),startOwnedFaceSession:hit('face',{challenge,quickLinkUrl:'fixture'}),
  ReplicaStorageError,REPLICA_STORAGE_WRITE_BUCKET:'fixture',ensurePrivateReplicaBucket:hit('bucket'),createSignedReplicaUpload:hit('sign',{headers:{}}),replicaObjectInfo:hit('info',{}),
  createPendingSource:no,getOwnedSource:hit('owned',null),getOwnedSourceByUploadIntent:no,listOwnedSources:no,finalizeOwnedSource:no,markOwnedSourceDeleting:no,setOwnedPrimaryVoiceSource:no,
  applySelfTestAutoGrant:no,bootstrapSelfTestReplica:no,
  authorizeOwnedComparisonPreparation:no,requireCurrentComparisonPreparation:no,comparisonPreparationInput:no,isComparisonSource,
 };
 const handler=await load(text,d);const res={statusCode:0,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{},body:{op,replica_id:'replica',source_id:'source',purpose:'memory'}},res);return{...res,calls};
}
await check('source inventory is explicitly unavailable regardless of env or health-shaped input',()=>{
 assert.deepEqual(modernCaptureReadiness({env:{AZURE_COMPOSITE_LIVENESS_ENABLED:'true'},health:{ok:true}}),{ready:false,waiting_on:'us',code:'liveness_verifier_unavailable'});
 assert.throws(requireModernCaptureReadiness,e=>e.status===503&&e.waiting_on==='us');
 const service=readFileSync(new URL('../services/azure-verifier/src/server.js',import.meta.url),'utf8');
 assert(!service.includes('["/v1/liveness/verify"'));assert(service.includes('["/v1/liveness/session"'));
});
for(const op of ['issue','start_face','create_upload'])await check(`${op} refuses before SQL/storage/provider work`,async()=>{
 const r=await run(op);assert.equal(r.statusCode,503);assert.deepEqual(r.body,{error:'liveness_verifier_unavailable',waiting_on:'us'});assert.deepEqual(r.calls,['auth','readiness']);
});
await check('authentication precedes readiness',async()=>{const r=await run('issue',{auth:false});assert.equal(r.statusCode,401);assert.deepEqual(r.calls,['auth']);});
for(const op of ['status','cancel','poll_face'])await check(`${op} remains available while disabled`,async()=>{const r=await run(op);assert.equal(r.statusCode,200);assert(!r.calls.includes('readiness'));});
await check('owner status and bounded platform reason returned by actual readiness caller',async()=>{const r=await run('capture_readiness');assert.equal(r.statusCode,200);assert.deepEqual(r.calls,['auth','status','comparison']);assert.deepEqual(r.body.readiness,modernCaptureReadiness());assert.equal(r.body.comparison,null);assert.equal(r.body.comparison_code,'selected_reference_not_available');});
await check('already uploaded evidence can finalize while unavailable',async()=>{
 const r=await run('finalize',{mode:'upload'});assert.equal(r.statusCode,404); // fetched fixture is not a live-challenge source, and gets existing refusal
 assert.deepEqual(r.calls,['auth','pending']);
 const accepted=await run('finalize',{mode:'live_challenge'});assert.equal(accepted.statusCode,200);assert(!accepted.calls.includes('readiness'));
});
for(const op of ['issue','start_face','create_upload'])await check(`${op} old-code guard removal admits unavailable work`,async()=>{
 const old=route.replace('if (["issue", "start_face", "create_upload"].includes(body.op)) requireModernCaptureReadiness();','');
 assert.notEqual(old,route);const r=await run(op,{text:old});assert.equal(r.statusCode,201);assert(!r.calls.includes('readiness'));
 const positive=await run(op,{ready:true});assert.equal(positive.statusCode,201);
});
await check('retry uses owner-fetched capture mode, ignores claimed memory purpose, no signing',async()=>{const r=await run('retry_upload',{text:sourceRoute});assert.equal(r.statusCode,503);assert.deepEqual(r.calls,['auth','pending','readiness']);assert.equal(r.body.waiting_on,'us');});
await check('ordinary retry unchanged and foreign source cannot reach readiness or signing',async()=>{
 const normal=await run('retry_upload',{text:sourceRoute,mode:'upload'});assert.equal(normal.statusCode,200);assert.deepEqual(normal.calls,['auth','pending','bucket','reserve','sign']);
 const foreign=await run('retry_upload',{text:sourceRoute,owned:false});assert.equal(foreign.statusCode,404);assert.deepEqual(foreign.calls,['auth','pending','owned']);
});
await check('old retry guard removal signs unavailable challenge source',async()=>{const old=sourceRoute.replace('if (source.capture_mode === "live_challenge") requireModernCaptureReadiness();','');assert.notEqual(old,sourceRoute);const r=await run('retry_upload',{text:old});assert.equal(r.statusCode,200);assert(r.calls.includes('sign'));});
console.log(`${checks} modern readiness control-flow groups; no actual auth, SQL, storage or provider execution`);
