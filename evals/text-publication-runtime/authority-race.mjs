import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as store from '../../api/_text-publication-store.js';
import * as engine from '../../api/_engine.gen.js';
import {createTextPublicationVisitorHandler} from '../../api/_text-publication-runtime.js';
import {compileNeverRules} from '../../api/_never-rules.js';
import {fixture,id,owner,rid,pid,visitor,requestId,h,env} from '../text-publication-store/fixtures.mjs';
globalThis.fetch=async()=>{throw Error('unexpected_network_refused');};
const {gateReply,hasGate,honestyContextFor}=await import('../../api/_surface.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function heldRun(changeEpoch,{replayWhileHeld=false}={}){
 const f=fixture();await f.publish();const joined=await f.join(),entered=deferred(),release=deferred(),events=[];
 const req=Object.assign(new EventEmitter(),{method:'POST',body:{op:'ask',public_id:pid,request_id:requestId,session_token:joined.session_token,question:'What is the pendulum period?'},aborted:false});
 const res=Object.assign(new EventEmitter(),{writableEnded:false,status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});
 const db=async(sql,args)=>{if(sql===store.TEXT_PUBLICATION_FAIL_SQL){events.push('fail:'+args[5]);return[];}return f.db(sql,args);};
 const provider={family:'azure',name:'azure-foundry-structured-output',version:'fixture-v1',model:'synthetic',billing:{meter:'azure_foundry_tokens',max_output_tokens:700},async generate(){events.push('generate');return{output:{reply:'The period is 2 seconds.',delivery:{mode:'grounded',pace:'natural',intensity:0.3,language_hint:'en-IN',nonverbals:[]}},usage:{input_tokens:100,output_tokens:10}};}};
 const budget={foundryBudgetConfig(){},async reserveFoundrySpend(db,input){events.push('reserve');return{reservation_id:id(40),budget_id:'fixture',state:'reserved',reserved_microusd:500,request_hash:h({operation:'dialogue',request_key:input.requestKey,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})};},async beginFoundrySpend(){events.push('begin');},async settleFoundrySpend(){events.push('settle');},async markFoundrySpendUncertain(){events.push('uncertain');},async releaseFoundrySpendBeforeCall(){events.push('release');return{budget_id:'fixture'};}};
 const runtime=createTextPublicationVisitorHandler({db,requireUser:async()=>({id:visitor}),store:{...store,async completeTextPublicationRequest(...args){events.push('held-after-gate');entered.resolve();await release.promise;return store.completeTextPublicationRequest(...args);}},engine,env,budget,resolveGenerator:()=>provider,gateReply:(...args)=>{events.push('gate');return gateReply(...args);},hasGate,honestyContextFor,compileNeverRules,loadNeverRules:async(db,replica,account)=>{assert.equal(replica,rid);assert.equal(account,owner);events.push('rules');return[];}});
 const running=runtime(req,res);
 await Promise.race([entered.promise,running.then(()=>{throw Error('runtime_did_not_reach_held_completion:'+JSON.stringify(res.body));})]);
 assert(events.indexOf('rules')<events.indexOf('gate'));assert(events.indexOf('gate')<events.indexOf('held-after-gate'));
 const original=f.requests.get(requestId).dispatch_authority_epoch;assert.equal(String(original),'1');
 let replay;
 if(replayWhileHeld){
  const retryReq=Object.assign(new EventEmitter(),{method:'POST',body:{...req.body},aborted:false});
  replay=Object.assign(new EventEmitter(),{writableEnded:false,status(code){this.code=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;}});
  await runtime(retryReq,replay);assert.equal(retryReq.listenerCount('aborted'),0);
 }
 if(changeEpoch)f.row.private_text_epoch=2;
 release.resolve();await running;
 assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
 return{f,res,events,original,replay};
}
const checks=[];async function check(name,fn){await fn();checks.push(name);console.log(`ok ${checks.length} - ${name}`);}
await check('actual store/runtime/compiler/crypto/gates complete unchanged authority after held rule gate',async()=>{const{res,events}=await heldRun(false);assert.equal(res.code,201);assert.equal(res.body.request.answer,'The period is 2 seconds.');assert.equal(events.filter(x=>x==='generate').length,1);});
await check('rule epoch mutation while completion held cannot adopt fresh authority for previously gated output',async()=>{const{f,res,events,original}=await heldRun(true);assert.equal(res.code,409);assert.equal(res.body.error,'text_publication_output_authority_changed');assert.equal(f.requests.get(requestId).dispatch_authority_epoch,original);assert(!f.calls.some(c=>c.sql===store.TEXT_PUBLICATION_COMPLETE_SQL));assert(events.includes('settle'));assert(events.includes('fail:settled'));assert(!res.body.request);});
await check('fresh publication remains usable but old completed answer cannot replay after authority update',async()=>{const{f}=await heldRun(false);f.row.private_text_epoch=2;assert.equal((await store.openTextPublication(f.db,null,{public_id:pid})).can_text,true);const joined=await f.join();await assert.rejects(()=>store.readTextPublicationRequest(f.db,visitor,{public_id:pid,request_id:requestId,session_token:joined.session_token},{env}),/text_publication_output_authority_changed/);});
await check('actual second same-ID HTTP ask while first completion is held reads pending with one total reservation and dispatch',async()=>{const{res,replay,events}=await heldRun(false,{replayWhileHeld:true});assert.equal(replay.code,200);assert.equal(replay.body.request.state,'pending');assert(!replay.body.request.answer);assert.equal(res.code,201);assert.equal(events.filter(e=>e==='reserve').length,1);assert.equal(events.filter(e=>e==='generate').length,1);});
const root=new URL('../../',import.meta.url),files=['api/_text-publication-runtime.js','api/_text-publication-store.js','evals/text-publication-store/fixtures.mjs'];
const receipt={at:new Date().toISOString(),passed:checks.length,checks,method:'actual runtime/store/compiler/crypto/shared gates; held promise schedule; fixture DB does not parse SQL or prove row locks',source_hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(new URL(f,root))).digest('hex')]))};
const folder=new URL('scratchpad/text-publication-runtime/',root);mkdirSync(folder,{recursive:true});const out=new URL('authority-'+Date.now()+'.json',folder);writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');console.log(`${checks.length} held authority groups passed. Receipt: ${fileURLToPath(out)}`);
