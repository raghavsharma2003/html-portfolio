import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const files = ['src/studio/QuickVoiceCapture.tsx', 'src/studio/VoiceEnrollmentLab.tsx', 'src/creatorStudio/VoiceEnrollmentLab.tsx'];
const filter = process.argv.find(arg=>arg.startsWith('--filter='))?.slice(9);
const results = { filter, startedAt: new Date().toISOString(), scope: 'Actual components in StrictMode; synthetic device and API reads, no provider writes. Functional lifecycle only, no full-shell visual claim.', hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(join(ROOT,f))).digest('hex')])), checks: [], errors: [] };
const output = join(ROOT, 'scratchpad/capture-lifetime', String(Date.now())); mkdirSync(output, { recursive: true });
const device = `export const openPrivateWavCapture=(options)=>window.captureLifetime.open(options);`;
const api = `
export class ReplicaApiError extends Error {}
export const providerConsentStatus=async(token,replica_id)=>({replica_id,provider_consent_id:'33333333-3333-4333-8333-333333333333',state:'issued',expires_at:new Date(Date.now()+120000).toISOString(),statement:'Synthetic fixture statement',locale:'en-IN',attempt:1,statement_sha256:'a'.repeat(64)});
export const voiceProfileStatus=async()=>null;
const forbidden=()=>{window.captureLifetime.counts.apiWrites++;throw new Error('Provider mutation forbidden in fixture');};
export const putSignedUpload=forbidden,sha256File=forbidden,createProviderConsentUpload=forbidden,createVoiceProfile=forbidden,deleteVoiceProfile=forbidden,finalizeProviderConsentUpload=forbidden,issueProviderConsent=forbidden,retryProviderConsentUpload=forbidden;`;
const bundled = await build({ root:ROOT, configFile:false, logLevel:'silent', define:{'process.env.NODE_ENV':'"development"'}, build:{write:false,minify:false,rolldownOptions:{input:join(ROOT,'evals/capture-lifetime/host.tsx'),output:{entryFileNames:'probe.js'}}}, plugins:[{
  name:'capture-device-boundary', enforce:'pre',
  resolveId(id,importer){
    if (!importer || !files.some(f=>importer.replaceAll('\\','/').endsWith(f))) return;
    if (id==='./wavCapture')return '\0capture-device';
    if (['./enrollmentApi','./providerConsentApi','./replicaApi'].includes(id))return '\0capture-api';
  },
  load(id){if(id==='\0capture-device')return device;if(id==='\0capture-api')return api;},
  transform(source,id){
    if(!files.some(f=>id.replaceAll('\\','/').endsWith(f)))return;
    source=source.replaceAll('\r\n','\n');
    let next=source.replace('await capture.start();','if (new URLSearchParams(location.search).has("legacy-await")) { void capture.start(); } else { await capture.start(); }');
    assert.notEqual(next,source,'actual start await available for negative control');
    if(id.endsWith('QuickVoiceCapture.tsx')) {
      const stop='if (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current) {\n        URL.revokeObjectURL(result.url);';
      assert(next.includes(stop));
      next=next.replace(stop,'if (!new URLSearchParams(location.search).has("legacy-stop") && (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current)) {\n        URL.revokeObjectURL(result.url);');
    } else {
      const stop='if (!captureIsCurrent(attempt)) { URL.revokeObjectURL(next.url); return; }';
      assert(next.includes(stop));
      next=next.replace(stop,'if (!new URLSearchParams(location.search).has("legacy-stop") && !captureIsCurrent(attempt)) { URL.revokeObjectURL(next.url); return; }');
    }
    return {code:next,map:null};
  },
}] }).catch(error=>{results.failure=String(error.stack??error);results.finishedAt=new Date().toISOString();writeFileSync(join(output,'result.json'),JSON.stringify(results,null,2));throw error;});
const assets = new Map(bundled.output.map(a=>['/'+a.fileName,a.type==='chunk'?a.code:a.source]));
const server = createServer((req,res)=>{ if(assets.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(assets.get(req.url));}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/probe.js"></script>');} });
let browser, page;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await launchSuiteBrowser("capture-lifetime");
  page=await browser.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>results.errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.protocol==='blob:'?route.continue():route.abort();});
  const p=()=>page.evaluate(()=>({counts:{...window.captureLifetime.counts},created:[...window.captureLifetime.created],revoked:[...window.captureLifetime.revoked],unhandled:[...window.captureLifetime.unhandled]}));
  async function check(name,fn){if(filter&&!name.includes(filter))return;await fn();const state=await p();assert.equal(state.counts.apiWrites,0);assert.deepEqual(state.unhandled,[]);assert.deepEqual(results.errors,[]);results.checks.push({name,state});console.log(`ok ${results.checks.length} - ${name}`);}
  for(const lane of ['quick','modern','creator']) {
    const start=()=>page.getByRole('button',{name:lane==='quick'?'Start recording':'Record private WAV',exact:true});
    const finish=()=>page.getByRole('button',{name:lane==='quick'?'Finish and build':/^Stop recording/});
    async function open(query=''){await page.goto(`${origin}/?lane=${lane}${query}`);await page.waitForFunction(()=>window.captureLifetime?.effects>=2);await start().waitFor();await page.waitForFunction(()=>!document.querySelector('button')?.disabled);}
    async function begin(){await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===1);await page.evaluate(()=>window.captureLifetime.resolveOpen());await page.waitForFunction(()=>window.captureLifetime.counts.start===1);}
    async function recording(clean=true){await begin();await page.evaluate(()=>window.captureLifetime.resolveStart());if(lane==='quick'){await page.evaluate(clean=>{window.captureLifetime.level(clean);window.captureLifetime.advanceTime();},clean);}await finish().waitFor();}
    await check(`${lane}: late permission after unmount closes without starting`,async()=>{
      await open();await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===1);await page.evaluate(()=>{window.captureLifetime.unmount();window.captureLifetime.resolveOpen();});
      await page.waitForFunction(()=>window.captureLifetime.counts.cancel===1);assert.equal((await p()).counts.start,0);
    });
    await check(`${lane}: pending resume remains unavailable; failure closes and supports retry`,async()=>{
      await open();await begin();assert.equal(await finish().count(),0);
      await page.evaluate(()=>window.captureLifetime.rejectStart());await start().waitFor();assert(await page.getByRole('alert').innerText().then(t=>t.includes('Synthetic resume failed')));
      assert.equal((await p()).counts.cancel,1);await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===2);
      await page.evaluate(()=>window.captureLifetime.resolveOpen());await page.waitForFunction(()=>window.captureLifetime.counts.start===2);await page.evaluate(()=>window.captureLifetime.resolveStart());
      if(lane==='quick')await page.evaluate(()=>window.captureLifetime.advanceTime());await finish().waitFor();
    });
    await check(`${lane}: unmount during resume cancels and prevents late UI`,async()=>{
      await open();await begin();await page.evaluate(()=>{window.captureLifetime.unmount();window.captureLifetime.resolveStart();});await page.waitForFunction(()=>window.captureLifetime.counts.cancel===1);assert.equal(await finish().count(),0);
    });
    await check(`${lane}: late stop after unmount releases URL without use`,async()=>{
      await open();await recording();await finish().click();await page.waitForFunction(()=>window.captureLifetime.counts.stop===1);await page.evaluate(()=>{window.captureLifetime.unmount();window.captureLifetime.resolveStop();});
      await page.waitForFunction(()=>window.captureLifetime.created.length===1&&window.captureLifetime.revoked.includes(window.captureLifetime.created[0]));assert.equal((await p()).counts.use,0);
    });
    await check(`${lane}: review, retake, second capture and unmount release owned URLs once`,async()=>{
      await open();await recording(false);await finish().click();await page.evaluate(()=>window.captureLifetime.resolveStop());
      const retake=()=>page.getByRole('button',{name:lane==='quick'?'Record again':'Retake',exact:true});await retake().waitFor();await retake().click();await start().waitFor();
      assert.equal((await p()).revoked.length,1);await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===2);await page.evaluate(()=>window.captureLifetime.resolveOpen());await page.waitForFunction(()=>window.captureLifetime.counts.start===2);await page.evaluate(()=>window.captureLifetime.resolveStart());
      if(lane==='quick')await page.evaluate(()=>{window.captureLifetime.level(false);window.captureLifetime.advanceTime();});await finish().click();await page.evaluate(()=>window.captureLifetime.resolveStop());await retake().waitFor();await page.evaluate(()=>window.captureLifetime.unmount());
      const state=await p();assert.equal(state.created.length,2);assert.deepEqual(state.revoked,state.created);assert.equal(state.counts.use,0);
    });
    await check(`${lane}: removed await control announces recording before resume`,async()=>{
      await open('&legacy-await=1');await begin();if(lane==='quick')await page.evaluate(()=>window.captureLifetime.advanceTime());await finish().waitFor();
      await page.evaluate(()=>{window.captureLifetime.resolveStart();window.captureLifetime.unmount();});
    });
    await check(`${lane}: removed late-stop guard control exposes abandoned result`,async()=>{
      await open('&legacy-stop=1');await recording();await finish().click();await page.waitForFunction(()=>window.captureLifetime.counts.stop===1);await page.evaluate(()=>{window.captureLifetime.unmount();window.captureLifetime.resolveStop();});
      await page.waitForFunction(()=>window.captureLifetime.created.length===1);const state=await p();
      if(lane==='quick')assert.equal(state.counts.use,1,'old automatic callback can dispatch after unmount');else assert.equal(state.revoked.length,0,'old late result leaks its URL');
    });
    for(const outcome of ['success','error']) await check(`${lane}: stale ${outcome} cannot end a newer recording`,async()=>{
      await open();await recording();await finish().click();await page.waitForFunction(()=>window.captureLifetime.counts.stop===1);
      if(lane==='quick'){await page.evaluate(()=>window.captureLifetime.disable());await page.evaluate(()=>window.captureLifetime.disable(false));}
      else await page.evaluate(()=>window.captureLifetime.scope());
      await start().waitFor();await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===2);
      await page.evaluate(()=>window.captureLifetime.resolveOpen());await page.waitForFunction(()=>window.captureLifetime.counts.start===2);
      await page.evaluate(()=>window.captureLifetime.resolveStart());
      if(lane==='quick')await page.evaluate(()=>{window.captureLifetime.level();window.captureLifetime.advanceTime();});await finish().waitFor();
      await page.evaluate(outcome=>outcome==='success'?window.captureLifetime.resolveStop(0):window.captureLifetime.rejectStop(0),outcome);
      if(outcome==='success')await page.waitForFunction(()=>window.captureLifetime.created.length===1&&window.captureLifetime.revoked.includes(window.captureLifetime.created[0]));
      // A microtask and a real React render turn settle the rejected old promise too.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await finish().count(),1);assert.equal(await page.getByRole('alert').count(),0);assert.equal((await p()).counts.use,0);
      await page.evaluate(()=>window.captureLifetime.unmount());
    });
    for(const kind of lane==='quick'?['disabled']:['token','replica']) await check(`${lane}: ${kind} change invalidates pending permission and old completion`,async()=>{
      await open();await start().click();await page.waitForFunction(()=>window.captureLifetime.counts.open===1);
      await page.evaluate(kind=>{if(kind==='disabled')window.captureLifetime.disable();else window.captureLifetime.scope(kind==='replica');window.captureLifetime.resolveOpen();},kind);
      await page.waitForFunction(()=>window.captureLifetime.counts.cancel===1);assert.equal((await p()).counts.start,0);
      await open();await recording();await finish().click();await page.waitForFunction(()=>window.captureLifetime.counts.stop===1);
      await page.evaluate(kind=>{if(kind==='disabled')window.captureLifetime.disable();else window.captureLifetime.scope(kind==='replica');window.captureLifetime.resolveStop();},kind);
      await page.waitForFunction(()=>window.captureLifetime.created.length===1&&window.captureLifetime.revoked.includes(window.captureLifetime.created[0]));assert.equal((await p()).counts.use,0);
      assert.equal(await page.locator('audio').count(),0);
    });
  }
  results.passed=true;console.log(`PASS ${results.checks.length} mounted capture lifecycle groups; result ${output}`);
} catch(error) {results.failure=String(error.stack??error);results.failureState=await page?.evaluate(()=>({url:location.href,counts:window.captureLifetime?.counts,created:window.captureLifetime?.created,revoked:window.captureLifetime?.revoked,text:document.body.innerText})).catch(()=>null);throw error;}
finally {results.finishedAt=new Date().toISOString();writeFileSync(join(output,'result.json'),JSON.stringify(results,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));}
