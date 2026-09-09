import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request, IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { createWebServer, publicAsset } from '../../services/azure-web/server.mjs';
import { compileRoutes, routeRequest } from '../../services/azure-web/routing.mjs';
const root = resolve(import.meta.dirname,'../..'), config = JSON.parse(readFileSync(join(root,'vercel.json'),'utf8'));
const home = mkdtempSync(join(tmpdir(),'vyakti-azure-web33-'));
const digest = b=>createHash('sha256').update(b).digest('hex');
let checks = 0, server;
const test = async(name,fn)=>{await fn();checks++;console.log(`ok ${checks} ${name}`);};
const files = {
 'index.html':'<h1>Vyakti</h1>', 'studio.html':'<div id="studio-root"></div>', 'room.html':'<div id="room-root"></div>', 'chat.html':'<div id="root"></div>',
 'privacy.html':'Privacy', 'delete-account.html':'Delete', 'suites.html':'Suites', 'creators.html':'Creators',
 'assets/app-abcdefgh.js':'export const fixture=true;', 'assets/hindi.woff2':'synthetic-font-bytes',
 'vyakti-release.json':JSON.stringify({schema:1,product:'vyakti-clone',source_commitment:`sha256:${'a'.repeat(64)}`}),
};
const manifest = {contract:'vyakti-azure-web-artifact/v1',product:'vyakti-clone',source_commitment:`sha256:${'a'.repeat(64)}`,runtimeFiles:[],assets:Object.entries(files).map(([path,b])=>({path,sha256:digest(b),bytes:Buffer.byteLength(b)}))};
mkdirSync(join(home,'dist'));mkdirSync(join(home,'api'));
for (const [p,b] of Object.entries(files)) {mkdirSync(resolve(home,'dist',p,'..'),{recursive:true});writeFileSync(join(home,'dist',p),b);}
const names = readdirSync(join(root,'api')).filter(n=>/^[a-z][a-z0-9-]*\.js$/.test(n));
for (const name of [...names,'echo.js','native.js','raw.js','auth.js','stream.js','abort.js','throws.js']) writeFileSync(join(home,'api',name),'// Adapter fixture marker, not production API implementation.\n');
manifest.runtimeFiles=[...names,'echo.js','native.js','raw.js','auth.js','stream.js','abort.js','throws.js'].map(name=>({path:`api/${name}`,sha256:digest(readFileSync(join(home,'api',name)))}));
writeFileSync(join(home,'api/_config.js'),'private fixture must never be served');
writeFileSync(join(home,'dist/private.json'),'private fixture must never be served');
let releaseStream, streamingStarted;
let abortObserved;
const abortClosed = new Promise(resolve=>abortObserved=resolve);
const opened = new Promise(resolve=>streamingStarted=resolve);
const released = new Promise(resolve=>releaseStream=resolve);
// Exercise the Node 24.18 getter contract even on older supported Node builds.
// On newer builds retain the real native signal as an input, never discard it.
const originalSignal = Object.getOwnPropertyDescriptor(IncomingMessage.prototype, 'signal');
const platformSignals = new WeakMap();
const platformState = req => {
 let state = platformSignals.get(req);
 if (!state) {
  const controller = new AbortController(), native = originalSignal?.get?.call(req);
  // Node v24.18.1 _http_incoming.js:179-195 aborts on ordinary message
  // destruction/close too, including successful consumption of the body.
  if (!native) {
   if (req.destroyed) controller.abort();
   else req.once('close',()=>controller.abort());
  }
  state = { controller, signal: native ? AbortSignal.any([native, controller.signal]) : controller.signal };
  platformSignals.set(req, state);
 }
 return state;
};
Object.defineProperty(IncomingMessage.prototype, 'signal', { configurable: true, get() { return platformState(this).signal; } });
let deadlineReason;
let uploadAbortObserved;
const uploadAborted=new Promise(resolve=>uploadAbortObserved=resolve);
const loader = async name=>({
 config:['raw.js','native.js'].includes(name)?{api:{bodyParser:false}}:name==='echo.js'?{maxDuration:1}:{},
 default:async(req,res)=>{
  if(name==='native.js') {
   assert(req instanceof IncomingMessage);assert.equal(Object.hasOwn(req,'signal'),false);
   assert.equal(req.complete,false,'native-abort fixture holds the upload open');
   const combined=req.signal;assert.equal(req.signal,combined);assert.equal(combined.aborted,false);
   if(req.query.signalTest==='disconnect') {
    combined.addEventListener('abort',()=>uploadAbortObserved({aborted:combined.aborted,complete:req.complete}),{once:true});
    res.write('upload handler ready');return;
   }
   const reason=new Error('synthetic_native_abort');platformState(req).controller.abort(reason);
   assert.equal(combined.aborted,true);assert.equal(combined.reason,reason);
   return res.json({nativeAbort:true});
  }
  if(name==='echo.js'&&req.query.signalTest==='complete') {
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(req.complete,true);assert.equal(req.readableEnded,true);
   assert.equal(platformState(req).signal.aborted,true,'normal body consumption closes the native message');
   assert.equal(req.signal.aborted,false,'response work remains live after complete body');
   const oldCombined=AbortSignal.any([platformState(req).signal,new AbortController().signal]);
   assert.equal(oldCombined.aborted,true,'incumbent unconditional composition cancels normal requests');
   return res.json({complete:true,body:req.body});
  }
  if(name==='echo.js'&&req.query.signalTest==='deadline') {
   await new Promise(resolve=>req.signal.addEventListener('abort',()=>{deadlineReason=req.signal.reason.message;resolve();},{once:true}));return;
  }
  if(name==='throws.js')throw new Error('sensitive sentinel');
  if(name==='auth.js'&&req.headers.authorization!=='Bearer fixture')return res.status(401).json({error:'bearer_token_required'});
  if(name==='raw.js'){const chunks=[];for await(const chunk of req)chunks.push(chunk);return res.json({rawSha256:digest(Buffer.concat(chunks)),parsed:typeof req.body!=='undefined'});}
  if(name==='stream.js'){res.setHeader('Content-Type','text/event-stream');res.write('data: first\n\n');streamingStarted();await released;if(!res.destroyed)res.end('data: second\n\n');return;}
  if(name==='abort.js'){assert.equal(req.complete,true);assert.equal(req.signal.aborted,false);res.setHeader('Content-Type','text/event-stream');res.once('close',()=>abortObserved(req.signal.aborted));res.write('data: abort\n\n');return;}
  res.json({name,query:req.query,url:req.url,body:Buffer.isBuffer(req.body)?{bytes:req.body.length}:req.body,ip:req.headers['x-real-ip']});
 }
});
const call = (path,opts={})=>new Promise((resolve,reject)=>{
 const req=request({hostname:'127.0.0.1',port:server.address().port,path,method:opts.method||'GET',headers:opts.headers||{}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);});
 req.on('error',reject);if(opts.body)req.write(opts.body);req.end();
});
try {
 await test('old signal assignment fails against getter-only IncomingMessage contract',()=>{
  const req=new IncomingMessage(null);assert.throws(()=>{req.signal=new AbortController().signal;},TypeError);
 });
 server=await createWebServer({root:home,manifest,config,loadHandler:loader,bodyLimit:1024});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await test('root serves Vyakti with no development redirect',async()=>{const r=await call('/');assert.equal(r.status,200);assert.equal(r.text,files['index.html']);});
 await test('native request abort reaches stable combined signal without replacing native getter',async()=>{
  const response=await new Promise((resolve,reject)=>{
   const pending=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/native',method:'POST'},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{pending.destroy();resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()});});res.on('error',reject);
   });pending.on('error',reject);pending.setTimeout(5000,()=>pending.destroy(Error('incomplete_native_deadline')));pending.write('partial upload');
  });
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.text),{nativeAbort:true});
  assert.equal(typeof Object.getOwnPropertyDescriptor(IncomingMessage.prototype,'signal').get,'function');
 });
 await test('complete parsed body does not cancel response work, while old composition does',async()=>{
  const response=await call('/api/echo?signalTest=complete',{method:'POST',headers:{'content-type':'application/json'},body:'{"value":3}'});
  assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.text),{complete:true,body:{value:3}});
 });
 await test('real incomplete upload disconnect cancels handler work',async()=>{
  const pending=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/native?signalTest=disconnect',method:'POST'},res=>{
   res.once('data',()=>pending.destroy());res.on('error',()=>{});
  });pending.on('error',()=>{});pending.write('partial upload');
  let timer;try{assert.deepEqual(await Promise.race([uploadAborted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('upload_abort_not_observed')),5000);})]),{aborted:true,complete:false});}
  finally{clearTimeout(timer);pending.destroy();}
 });
 await test('handler deadline aborts request signal and returns explicit 504',async()=>{
  const response=await call('/api/echo?signalTest=deadline');assert.equal(response.status,504);assert.equal(deadlineReason,'handler_deadline');
 });
 await test('all current rewrites resolve including crawler conditional',async()=>{
  for(const rule of config.rewrites){const path=rule.source.replace(':slug','teacher');const headers=rule.has?{'user-agent':'WhatsApp'}:{};const r=await call(path,{headers});assert.equal(r.status,200,path);if(rule.destination.startsWith('/api/'))assert.equal(JSON.parse(r.text).name,rule.destination.split('?')[0].slice(5).replace(/\.js$/,'')+'.js');else assert.equal(r.text,files[rule.destination.slice(1)],path);}
 });
 await test('all configured headers survive matching original routes',async()=>{
  for(const rule of config.headers){const path=rule.source.replace(':slug','teacher').replace('(.*)','echo');const r=await call(path);for(const h of rule.headers)assert.equal(r.headers[h.key.toLowerCase()],h.value,`${path}:${h.key}`);}
 });
 await test('destination parameters defeat query spoofing and preserve repeats',async()=>{const r=await call('/c/alice?slug=bob&x=1&x=2');const b=JSON.parse(r.text);assert.equal(b.query.slug,'alice');assert.deepEqual(b.query.x,['1','2']);assert.equal(b.url,'/c/alice?slug=bob&x=1&x=2');});
 await test('normal Room stays SPA while bot reaches actual page handler',async()=>{assert.equal((await call('/r/a')).text,files['room.html']);assert.equal(JSON.parse((await call('/r/a',{headers:{'user-agent':'Googlebot'}})).text).name,'room-page.js');});
 await test('JSON handlers receive parsed request body',async()=>{const r=await call('/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:'{"a":3}'});assert.deepEqual(JSON.parse(r.text).body,{a:3});});
 await test('invalid and oversized JSON refuse before handler',async()=>{assert.equal((await call('/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,400);assert.equal((await call('/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({v:'a'.repeat(2048)})})).status,413);});
 await test('raw webhook bytes remain exact and unparsed',async()=>{const bytes=Buffer.from([0,255,13,10,123,34,1]);const r=await call('/api/raw',{method:'POST',headers:{'content-type':'application/json'},body:bytes});assert.deepEqual(JSON.parse(r.text),{rawSha256:digest(bytes),parsed:false});});
 await test('form and text parsing preserve expected handler shape',async()=>{const f=await call('/api/echo',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'a=x%20y'});assert.deepEqual(JSON.parse(f.text).body,{a:'x y'});const t=await call('/api/echo',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'});assert.equal(JSON.parse(t.text).body,'hello');});
 await test('handler authentication refusal is not bypassed',async()=>{assert.equal((await call('/api/auth')).status,401);assert.equal((await call('/api/auth',{headers:{authorization:'Bearer fixture'}})).status,200);});
 await test('spoofed Vercel/real-IP headers do not reach rate limiter',async()=>{const r=await call('/api/echo',{headers:{'x-real-ip':'1.2.3.4','x-vercel-forwarded-for':'2.3.4.5','x-forwarded-for':'3.4.5.6'}});assert.equal(JSON.parse(r.text).ip,'127.0.0.1');});
 await test('native streaming is observable before handler completes',async()=>{
  const first=new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/stream'},res=>{res.once('data',b=>resolve(b.toString()));res.resume();});req.on('error',reject);req.end();});await opened;assert.equal(await first,'data: first\n\n');releaseStream();
 });
 await test('client stream cancellation reaches native response close',async()=>{
  const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/abort'},res=>{res.once('data',()=>res.destroy());res.on('error',()=>{});});req.on('error',()=>{});req.end();
  let timer;try{assert.equal(await Promise.race([abortClosed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('abort_not_observed')),5000);})]),true);}finally{clearTimeout(timer);req.destroy();}
 });
 await test('static HEAD has correct length without response body',async()=>{const r=await call('/studio',{method:'HEAD'});assert.equal(r.text,'');assert.equal(Number(r.headers['content-length']),Buffer.byteLength(files['studio.html']));});
 await test('static writes refused and unknown URLs do not SPA fallback',async()=>{assert.equal((await call('/studio',{method:'POST'})).status,405);assert.equal((await call('/unknown')).status,404);assert.equal((await call('/api/unknown')).status,404);});
 await test('private files and source paths never served',async()=>{for(const p of ['/api/_config.js','/private.json','/services/azure-web/server.mjs','/context/STATE.md','/studio-layout-fixture.html'])assert.equal((await call(p)).status,404,p);});
 await test('raw and encoded traversal refused before URL normalization',async()=>{for(const p of ['/../api/_config.js','/%2e%2e/api/_config.js','/assets%2f../api/_config.js','/%252e%252e/api/_config.js','/assets\\..\\api/_config.js','/.env'])assert.equal((await call(p)).status,400,p);});
 await test('handler exception does not disclose its message',async()=>{const r=await call('/api/throws');assert.equal(r.status,500);assert(!r.text.includes('sensitive'));});
 await test('health explicitly reports artifact-only scope',async()=>{const r=await call('/readyz');assert.equal(r.status,200);assert.equal(JSON.parse(r.text).scope,'web_artifact_only');assert.equal(r.headers['cache-control'],'no-store');});
 await test('unsupported routing syntax refuses at startup',()=>{assert.throws(()=>compileRoutes({...config,rewrites:[{source:'/:slug*',destination:'/studio.html'}]}));assert.throws(()=>compileRoutes({...config,rewrites:[{source:'/x',destination:'https://example.com'}]}));});
 await test('public asset policy excludes data/config/keys/maps',()=>{for(const p of ['private.json','api/_config.js','studio-layout-fixture.html','secret.pem','owner-reference.wav','assets/x.js.map','../studio.html'])assert.equal(publicAsset(p),false,p);});
 await test('private-feature JavaScript is public code, not private user data',()=>assert.equal(publicAsset('assets/PrivateTextRehearsal-abcdefgh.js'),true));
 await test('startup rejects manifest drift',async()=>{const changed=structuredClone(manifest);changed.assets[0].sha256='b'.repeat(64);await assert.rejects(createWebServer({root:home,manifest:changed,config,loadHandler:loader}),/asset_changed/);});
 await test('startup rejects changed API source',async()=>{const changed=structuredClone(manifest);changed.runtimeFiles[0].sha256='b'.repeat(64);await assert.rejects(createWebServer({root:home,manifest:changed,config,loadHandler:loader}),/runtime_changed/);});
 await test('new uncommitted API file cannot enter route allowlist',async()=>{const p=join(home,'api/uncommitted.js');writeFileSync(p,'// fixture');try{await assert.rejects(createWebServer({root:home,manifest,config,loadHandler:loader}),/uncommitted_handler/);}finally{unlinkSync(p);}});
 await test('runtime refuses a symlinked static directory',async()=>{const dir=join(home,'dist/linked');symlinkSync(join(home,'api'),dir,process.platform==='win32'?'junction':'dir');try{const p=structuredClone(manifest);p.assets.push({path:'linked/auth.js',sha256:digest(readFileSync(join(home,'api/auth.js'))),bytes:readFileSync(join(home,'api/auth.js')).length});await assert.rejects(createWebServer({root:home,manifest:p,config,loadHandler:loader}),/private_file/);}finally{unlinkSync(dir);}});
} finally {
 releaseStream?.();if(server)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
 assert.equal(resolve(home),home);assert(home.startsWith(join(tmpdir(),'vyakti-azure-web33-')));rmSync(home,{recursive:true,force:true});
 if(originalSignal)Object.defineProperty(IncomingMessage.prototype,'signal',originalSignal);else delete IncomingMessage.prototype.signal;
}
console.log(`azure web adapter: ${checks} groups passed; native loopback fixtures only; no cloud, browser, SQL or product acceptance`);
