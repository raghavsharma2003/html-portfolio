import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'vite';
import {chromium} from 'playwright';
import ts from 'typescript';
import {boundedWaitMs} from '../lib/bounded-wait.mjs'; // WS-R181: scale the fixed Playwright action timeout by machine load
const root=fileURLToPath(new URL('../../',import.meta.url));
const base='da3ac2aeac29571ae45a4507d947b1cf603cf9c1';
const sourceBase='ab50c782303c9a6f8825ee9ce25e505b7421795e';
const current=readFileSync(join(root,'src/studio/CloneExperience.tsx'),'utf8').replaceAll('\r\n','\n');
// blobs from commits `base` and `sourceBase`, moved to committed fixtures
// (context/rejected.md#ci-shallow-checkout-starved-the-history-reading-suites).
const old=readFileSync(join(root,`evals/primary-intent-recovery/fixtures/${base.slice(0,8)}/src__studio__CloneExperience.tsx`),'utf8');
const incumbent=readFileSync(join(root,`evals/primary-intent-recovery/fixtures/${sourceBase.slice(0,8)}/src__studio__CloneExperience.tsx`),'utf8');
// The fixture mounts both actual full components, including the real saga poll effect.
if(process.argv.includes('--verify-base-recorder')) assert.equal(current.slice(current.indexOf('function ResonanceRecorder('),current.indexOf('function Agreement(')),incumbent.slice(incumbent.indexOf('function ResonanceRecorder('),incumbent.indexOf('function Agreement(')),'recorder bytes stay unchanged from the candidate base');
const caller=readFileSync(join(root,'src/studio/StudioApp.tsx'),'utf8').replaceAll('\r\n','\n');
const actualCaller=caller.slice(caller.indexOf('const handleReadVoiceReissue'),caller.indexOf('async function handleRequestVoiceBuild'));
for(const name of ['refreshForRequest(session)','readReplica(fresh.accessToken, selectedId)','listSources(fresh.accessToken, selectedId)','listEnrollmentConsent(fresh.accessToken, selectedId)','selectedIdRef.current !== selectedId'])assert(actualCaller.includes(name),name);
assert(caller.includes('onReadVoiceReissue={handleReadVoiceReissue}'));
const callbackSource=actualCaller.slice(actualCaller.indexOf('async () =>'),actualCaller.lastIndexOf(', [session'));
const callbackJs=ts.transpileModule('const handler='+callbackSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const observed=[];
const dependencies={session:{accessToken:'expired'},selectedId:'owned-replica',selectedIdRef:{current:'owned-replica'},refreshForRequest:async()=>{observed.push('refresh');return {accessToken:'fresh'};},readReplica:async(token,id)=>{observed.push(['replica',token,id]);return {replica_id:id};},listSources:async(token,id)=>{observed.push(['sources',token,id]);return [];},listEnrollmentConsent:async(token,id)=>{observed.push(['consents',token,id]);return [];}};
const actualFreshRead=new Function(...Object.keys(dependencies),callbackJs+';return handler;')(...Object.values(dependencies));
assert.equal((await actualFreshRead()).replica.replica_id,'owned-replica');
assert.deepEqual(observed,['refresh',['replica','fresh','owned-replica'],['sources','fresh','owned-replica'],['consents','fresh','owned-replica']]);
dependencies.selectedIdRef.current='another-replica';await assert.rejects(actualFreshRead(),/selected clone changed/);
const rejectedRead=new Function(...Object.keys(dependencies),callbackJs+';return handler;')(...Object.values({...dependencies,listEnrollmentConsent:async()=>{throw new Error('consent_read_failed');}}));
await assert.rejects(rejectedRead(),/consent_read_failed/);

if(process.argv.includes('--source-only')) { console.log('3 actual StudioApp caller controls passed' + (process.argv.includes('--verify-base-recorder') ? '; base recorder preservation passed' : '')); process.exit(0); }
const buildResult=await build({root,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:false,rolldownOptions:{input:join(root,'evals/primary-intent-recovery/host.tsx'),output:{entryFileNames:'probe.js',chunkFileNames:'[name].js',assetFileNames:'[name][extname]'}}},plugins:[{name:'exact-old-experience',resolveId(id){if(id==='virtual:legacy-experience')return '\0legacy-experience.tsx';},load(id){if(id==='\0legacy-experience.tsx')return old.replace(/(from\s*|import\s*|import\()(["'])(\.\/[^"']+)\2/g,(_all,prefix,quote,path)=>prefix+quote+join(root,'src/studio',path).replaceAll('\\','/')+quote);}}]});
const outputs=new Map(buildResult.output.map(item=>['/'+item.fileName,item.type==='chunk'?item.code:item.source]));
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(outputs.has(path)){res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(outputs.get(path));}else if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('{}');}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/probe.js"></script>');}});
let browser;let checks=0;const results=[];const runtimeErrors=[];
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await launchSuiteBrowser("primary-intent-recovery");
 const page=await browser.newPage();page.setDefaultTimeout(boundedWaitMs(12000));page.on('pageerror',error=>runtimeErrors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const action=()=>page.getByRole('button',{name:'Use this recording',exact:true});
 const calls=()=>page.evaluate(()=>window.recoveryProbe.calls);
 const open=async(name='changed',extra='')=>{await page.goto(`${origin}/?case=${name}${extra}`);await page.waitForFunction(()=>window.recoveryProbe?.calls.length>0);await page.getByRole('button',{name:'Record again',exact:true}).first().waitFor();};
 const check=async(name,fn)=>{await fn();results.push(name);console.log(`ok ${++checks} - ${name}`);};
 await check('actual base component lacks same-source recovery',async()=>{await open('changed','&legacy=1');assert.equal(await action().count(),0);assert.equal((await calls()).length,1);});
 for(const name of ['changed','missing'])await check(`${name}: explicit action persists new UUID before same-source POST`,async()=>{
  await open(name);assert.equal((await calls()).length,1);await action().click();await page.waitForFunction(()=>window.recoveryProbe.calls.some(c=>c.buildIntentId!==window.recoveryProbe.calls[0].buildIntentId));const requests=await calls();assert.equal(requests.length,2);assert.notEqual(requests[1].buildIntentId,requests[0].buildIntentId);assert.equal(requests[1].candidateSourceId,requests[0].candidateSourceId);assert.equal(requests[1].persisted.buildIntentId,requests[1].buildIntentId);assert.equal(requests[1].persisted.uploadIntentId,requests[0].persisted.uploadIntentId);
 });
 await check('generic failure keeps established retake action only',async()=>{await open('generic');assert.equal(await action().count(),0);});
 await check('missing fresh-read caller is explicitly unavailable',async()=>{await open('unavailable');assert(await action().isDisabled());assert.match(await page.locator('body').innerText(),/unavailable here/);assert.equal((await calls()).length,1);});
 for(const name of ['deleted','rejected','third-party','foreign','consent','read-failed'])await check(`${name}: no new request or lost saga`,async()=>{await open(name);await action().click();await page.waitForFunction(()=>window.recoveryProbe.reads===1);await page.getByRole('alert').filter({hasText:/not available|Fresh recording check/}).first().waitFor();assert.equal((await calls()).length,1);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vyakti:experience:voice-saga:v1:10000000-0000-4000-8000-000000000001')).buildIntentId),'50000000-0000-4000-8000-000000000005');});
 await check('storage write failure sends no new request',async()=>{await open();await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('storage blocked');};});await action().click();await page.getByText(/browser could not save/).waitFor();assert.equal((await calls()).length,1);});
 for(const change of ['scope','deleted','consent','unmount'])await check(`pending read ${change}: no new request`,async()=>{await open('pending-'+change);await action().click();await page.waitForFunction(()=>window.recoveryProbe.reads===1);await page.evaluate(change=>{if(change==='unmount')window.recoveryProbe.unmount();else window.recoveryProbe.change(change);},change);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>setTimeout(done,0))));/* the change must be COMMITTED before the read resolves: React schedules an out-of-event state update on its own task, and resolving in the very next round trip raced it (flaky on Linux Chromium, 2026-09-13) */await page.evaluate(()=>window.recoveryProbe.resolve());await page.waitForTimeout(80);assert((await calls()).every(c=>c.buildIntentId==='50000000-0000-4000-8000-000000000005'));});
 await check('cross-tab changed durable intent is not overwritten',async()=>{await open('pending-storage');await action().click();await page.waitForFunction(()=>window.recoveryProbe.reads===1);await page.evaluate(()=>{const key='vyakti:experience:voice-saga:v1:10000000-0000-4000-8000-000000000001';const saga=JSON.parse(localStorage.getItem(key));saga.buildIntentId='60000000-0000-4000-8000-000000000006';localStorage.setItem(key,JSON.stringify(saga));window.recoveryProbe.resolve();});await page.getByText(/changed in another tab/).waitFor();assert.equal((await calls()).length,1);});
 await check('uncertain POST and reload reuse one newly confirmed UUID',async()=>{await open('ambiguous');await action().click();await page.waitForFunction(()=>window.recoveryProbe.calls.length===2);const next=(await calls())[1];await page.goto(`${origin}/?case=ambiguous&reload=1`);await page.waitForFunction(()=>window.recoveryProbe?.calls.length===1);assert.equal((await calls())[0].buildIntentId,next.buildIntentId);assert.equal((await calls())[0].persisted.buildIntentId,next.buildIntentId);assert.equal(await action().count(),0);});
 assert.deepEqual(runtimeErrors,[]);console.log(`${checks} mounted recovery groups passed; actual StudioApp fresh-read caller controls passed`);
 const out=join(root,'scratchpad/primary-intent-recovery');mkdirSync(out,{recursive:true});writeFileSync(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),base,checks,results,runtimeErrors},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
