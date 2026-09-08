import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import ts from 'typescript';
import {chromium} from 'playwright';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const cacheBase=join(ROOT,'scratchpad');mkdirSync(cacheBase,{recursive:true});
const cacheDir=mkdtempSync(join(cacheBase,'capture-readiness-vite-'));
const actual=readFileSync(new URL('../../src/studio/LivenessCapture.tsx',import.meta.url),'utf8');
const variants={current:actual};
const call='await requireFreshCaptureReadiness(operation);';assert.equal(actual.split(call).length,3);
variants['old-media']=actual.replace(call,'/* old media caller: no readiness read */');
const last=actual.lastIndexOf(call);variants['old-start']=actual.slice(0,last)+'/* old recording caller: no readiness read */'+actual.slice(last+call.length);
variants['old-race']=actual
 .replace('return mountedRef.current && captureGenerationRef.current === operation;', 'return true;')
 .replace('if (!captureOperationCurrent(operation) || !scope.consentActive || !captureEligible(scope.challenge)) {', 'if (false) {');
assert.notEqual(variants['old-race'],actual);
const server=await createServer({configFile:false,root:ROOT,cacheDir,optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},server:{host:'127.0.0.1',port:0},plugins:[{
 name:'bounded-capture-component',
 resolveId(id){if(id.startsWith('virtual:modern-capture-'))return id;},
 async load(id){if(!id.startsWith('virtual:modern-capture-'))return;
  const source=variants[id.slice('virtual:modern-capture-'.length)];assert(source,'known mutation only');
  return ts.transpileModule(source.replace('"./enrollmentApi"','"/src/studio/enrollmentApi"'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 },
 configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/capture-probe')return next();res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/evals/modern-capture-readiness/component.tsx"></script>');});},
}]});
let browser;let checks=0;
try{
 await server.listen();const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
 const page=await browser.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('component page error:',e.message);});
 await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 async function open(query=''){await page.goto(base+'/capture-probe?'+query);await page.waitForFunction(()=>window.captureProbe?.calls.readiness>0);}
 const getCalls=()=>page.evaluate(()=>({...window.captureProbe.calls}));
 const mode=value=>page.evaluate(v=>window.captureProbe.setMode(v),value);
 const camera=()=>page.getByRole('button',{name:'Allow camera and microphone'});
 const start=()=>page.getByRole('button',{name:'Start recording'});
 async function check(name,fn){await fn();console.log(`ok ${++checks} - ${name}`);}
 for(const state of ['blocked','pending','error'])await check(`${state} restored challenge cannot request devices`,async()=>{
  await open('mode='+state);assert(await camera().isDisabled());assert.equal((await getCalls()).media,0);
  await page.getByRole('button',{name:'Cancel and erase this attempt'}).click();assert.equal((await getCalls()).cancel,1);
 });
 await check('unavailable challenge hides new capture choices and issuance',async()=>{
  await open('mode=blocked&empty=1');await page.getByText('Live verification is unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox').count(),0);
  assert.equal(await page.getByRole('button',{name:'Request live phrase'}).count(),0);assert.equal((await getCalls()).issue,0);
 });
 await check('complete attestations cannot bypass a fresh unavailable challenge',async()=>{
  await open('mode=ready&empty=1');const issue=page.getByRole('button',{name:'Request live phrase'});await issue.waitFor();
  const boxes=await page.getByRole('checkbox').all();assert.equal(boxes.length,8);for(const box of boxes)await box.check();
  assert(await issue.isEnabled());await mode('blocked');await issue.click();
  await page.getByText('The recording or its permissions changed. Review the current selection.',{exact:true}).waitFor();
  assert.equal((await getCalls()).issue,0);assert.equal((await getCalls()).media,0);
 });
 await check('blocked new face check stays disabled while existing face poll remains usable',async()=>{
  await open('mode=blocked&face=not_started');assert(await page.getByRole('button',{name:'Open official face check'}).isDisabled());
  await open('mode=blocked&face=ready');await page.getByRole('button',{name:'I finished, check the result'}).click();assert.equal((await getCalls()).poll,1);
 });
 for(const state of ['blocked','error'])await check(`fresh ${state} before media prevents collection`,async()=>{
  await open('mode=ready');await camera().waitFor();await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);
  await mode(state);await camera().click();await page.getByText(state==='error'?'Fixture readiness read failed':'Live verification is unavailable. The complete verifier must be available before you record.',{exact:true}).waitFor();
  assert.equal((await getCalls()).media,0);
 });
 await check('fresh refusal after permission stops tracks and never starts recorder',async()=>{
  await open('mode=ready');await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);await camera().click();await start().waitFor();
  await mode('blocked');await start().click();await page.getByText('Live verification is unavailable. The complete verifier must be available before you record.',{exact:true}).waitFor();
  const c=await getCalls();assert.equal(c.media,1);assert.equal(c.start,0);assert(c.stopped>0);
 });
 for(const mutation of [{state:'expired'},{challenge_id:'foreign'},{expires_at:'2000-01-01T00:00:00Z'},{expires_at:'not-a-date'},{face_session_state:'not_started'}])await check('fresh challenge authority change refuses devices '+JSON.stringify(mutation),async()=>{
  await open('mode=ready');await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);
  await page.evaluate(v=>window.captureProbe.setFresh(v),mutation);await camera().click();await page.getByText('This capture is no longer authorized. Refresh the live challenge status.',{exact:true}).waitFor();assert.equal((await getCalls()).media,0);
 });
 await check('ready fixture retains actual permission then recorder ordering',async()=>{
  await open('mode=ready');await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);await camera().click();await start().click();await page.waitForFunction(()=>window.captureProbe.calls.start===1);
  const c=await getCalls();assert.equal(c.media,1);assert.equal(c.readiness,3);
 });
 await check('old media caller negative control collects despite fresh refusal',async()=>{
  await open('mode=ready&variant=old-media');await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);await mode('blocked');await camera().click();await start().waitFor();assert.equal((await getCalls()).media,1);
 });
 await check('old recorder caller negative control records despite fresh refusal',async()=>{
  await open('mode=ready&variant=old-start');await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);await camera().click();await start().waitFor();await mode('blocked');await start().click();await page.waitForFunction(()=>window.captureProbe.calls.start===1);
 });
 async function readyPage(variant='current'){
  await open('mode=ready&variant='+variant);await page.waitForFunction(()=>!document.querySelector('.permission-button').disabled);
 }
 async function pendingRead(){await mode('deferred');await camera().click();await page.waitForFunction(()=>window.captureProbe.calls.readiness===2);}
 async function resolveRead(){await page.evaluate(async()=>{window.captureProbe.releaseRead();await new Promise(r=>setTimeout(r,0));});}
 await check('unmount during readiness read prevents any device request',async()=>{
  await readyPage();await pendingRead();await page.evaluate(()=>window.captureProbe.unmount());await resolveRead();
  const c=await getCalls();assert.equal(c.media,0);assert.equal(c.constructed,0);assert.equal(await page.locator('#root').innerHTML(),'');
 });
 for(const local of [{state:'failed'},{state:'expired'},{expires_at:'not-a-date'},{face_session_state:'failed_deleted'}])await check('same-ID local authority change during read refuses '+JSON.stringify(local),async()=>{
  await readyPage();await pendingRead();await page.evaluate(v=>window.captureProbe.setLocal(v),local);await resolveRead();
  assert.equal((await getCalls()).media,0);assert.equal((await getCalls()).constructed,0);
 });
 await check('consent withdrawal during readiness read prevents devices',async()=>{
  await readyPage();await pendingRead();await page.evaluate(()=>window.captureProbe.revokeConsent());await resolveRead();assert.equal((await getCalls()).media,0);
 });
 await check('callback/session scope change invalidates pending old read',async()=>{
  await readyPage();await pendingRead();await mode('ready');await page.evaluate(()=>window.captureProbe.changeCallback());await resolveRead();assert.equal((await getCalls()).media,0);
 });
 for(const transition of ['unmount','revokeConsent','changeCallback'])await check('late permission result closes all tracks after '+transition,async()=>{
  await readyPage();await page.evaluate(()=>window.captureProbe.deferMedia());await camera().click();await page.waitForFunction(()=>window.captureProbe.calls.media===1);
  await page.evaluate(method=>window.captureProbe[method](),transition);
  await page.evaluate(async()=>{window.captureProbe.releaseMedia();await new Promise(r=>setTimeout(r,0));});
  const c=await getCalls();assert.equal(c.stopped,2);assert.equal(c.constructed,0);assert.equal(c.start,0);
  if(transition==='unmount')assert.equal(await page.locator('#root').innerHTML(),'');
  else assert.equal(await start().count(),0);
 });
 await check('unmount during recorder readiness read stops existing tracks and never constructs recorder',async()=>{
  await readyPage();await camera().click();await start().waitFor();await mode('deferred');await start().click();await page.waitForFunction(()=>window.captureProbe.calls.readiness===3);
  await page.evaluate(()=>window.captureProbe.unmount());await resolveRead();const c=await getCalls();assert.equal(c.stopped,2);assert.equal(c.constructed,0);
 });
 await check('old lifecycle negative control requests devices after unmount',async()=>{
  await readyPage('old-race');await pendingRead();await page.evaluate(()=>window.captureProbe.unmount());await resolveRead();assert.equal((await getCalls()).media,1);
 });
 await check('old permission-completion negative control leaves late stream running',async()=>{
  await readyPage('old-race');await page.evaluate(()=>window.captureProbe.deferMedia());await camera().click();await page.waitForFunction(()=>window.captureProbe.calls.media===1);
  await page.evaluate(()=>window.captureProbe.unmount());await page.evaluate(async()=>{window.captureProbe.releaseMedia();await new Promise(r=>setTimeout(r,0));});
  const c=await getCalls();assert.equal(c.stopped,0);assert.equal(c.constructed,0);
 });
 assert.deepEqual(errors,[]);console.log(`${checks} actual mounted component groups; synthetic device stubs, no provider/media upload`);
}finally{
 await browser?.close();await server.close();
 // Only this invocation's verified scratch cache may be removed.
 assert.equal(dirname(realpathSync(cacheDir)),realpathSync(cacheBase));
 rmSync(cacheDir,{recursive:true,force:true});
}
