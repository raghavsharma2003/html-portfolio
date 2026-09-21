import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'scratchpad','text-publication-ui',String(Date.now()));mkdirSync(out,{recursive:true});
const RID='10000000-0000-4000-8000-000000000001',SID='20000000-0000-4000-8000-000000000001',IID='30000000-0000-4000-8000-000000000001',PID='40000000-0000-4000-8000-000000000001';
const visitorToken='synthetic-visitor-access-token',ownerToken='synthetic-owner-access-token';
const terms={audience:'signed_in_adult_attestation',publication_days:30,retention_days:30,visitor_question_limit:20,total_question_limit:200,budget_microusd:100000,quota_policy:'admission_counts',memory:false,voice:false};
const base={public_id:PID,version:1,state:'active',title:'Physics with Mira',subject_domain:'physics',disclosure:'AI answers from material published by this account.',disclosure_hash:'a'.repeat(64),terms,created_at:'2026-09-08T00:00:00Z',expires_at:'2026-10-08T00:00:00Z',can_text:true,can_voice:false};
let publication=null,requests=[],heldQuestion=null,lostPublish=false,lostForget=false,heldRefresh=null,holdRefresh=false,failRefresh=false,asked=new Map();
const sourcePaths=['src/studio/publication/PublicationApp.tsx','src/studio/publication/MaterialSharePanel.tsx','src/studio/publication/PublicationSignIn.tsx','src/studio/publication/publicationApi.ts','src/studio/publication/publication.css'];
const sourceHashes=Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import'@fontsource-variable/geist';import'@fontsource-variable/instrument-sans';import PublicationApp from './src/studio/publication/PublicationApp';import MaterialSharePanel from './src/studio/publication/MaterialSharePanel';const query=new URLSearchParams(location.search),owner=query.get('view')==='owner';createRoot(document.getElementById('root')).render(owner?<MaterialSharePanel token=${JSON.stringify(ownerToken)} replicaId=${JSON.stringify(RID)} onReview={()=>{}}/>:<PublicationApp publicId={query.get('publication')||''}/>);`;
const entryPath=join(out,'fixture.tsx'),bundle=join(out,'bundle');
writeFileSync(entryPath,entry.replaceAll("'./src/", "'"+root.replaceAll('\\','/')+'src/'));
await build({root,configFile:false,logLevel:'error',build:{outDir:bundle,emptyOutDir:true,lib:{entry:entryPath,name:'PublicationFixture',formats:['iife'],fileName:()=> 'fixture.js'},cssCodeSplit:false},define:{'process.env.NODE_ENV':JSON.stringify('production')}});
const js=readFileSync(join(bundle,'fixture.js')),css=readFileSync(join(bundle,readdirSync(bundle).find(p=>p.endsWith('.css'))));
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(!url.pathname.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end('<!doctype html>'+(url.searchParams.has('__fixture_legacy_charset')?'':'<meta charset="UTF-8">')+'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}body:has(.vp-owner){max-width:780px;margin:24px auto;padding:0 12px}</style><div id="root"></div><script src="/fixture.js"></script>');return;}
  let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):Object.fromEntries(url.searchParams),op=input.op;
  requests.push({path:url.pathname,op,body:input,auth:req.headers.authorization||''});
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const loseBody=()=>{res.writeHead(200,{'Content-Type':'application/json','Content-Length':'1024','Cache-Control':'no-store'});res.flushHeaders();res.write('{');setTimeout(()=>res.destroy(),25);};
  if(url.pathname==='/api/account'){
   if(op==='send_otp')return send({});
   if(op==='verify_otp')return send({user:{id:'50000000-0000-4000-8000-000000000001',email:'visitor@example.test'},access_token:visitorToken,refresh_token:'synthetic-refresh-token',expires_in:3600});
   if(op==='refresh'){if(failRefresh)return send({error:'synthetic_refresh_failure'},401);const finish=()=>send({user:{id:'50000000-0000-4000-8000-000000000001'},access_token:visitorToken,refresh_token:'synthetic-refresh-token',expires_in:3600});if(holdRefresh){heldRefresh=finish;return;}return finish();}
  }
  if(url.pathname==='/api/replica-text-publication'){
   assert.equal(req.headers.authorization,`Bearer ${ownerToken}`);
   if(op==='readiness')return send({readiness:{replica_id:RID,state:'ready',blockers:[],drafts:[{sheet_id:SID,name:'Physics profile',updated_at:base.created_at,status:'draft'}],context_items:[{item_id:IID,source_name:'pendulum.txt',status:'mined',format:'text',authorship:'mine',source_id:IID,source_ready:true,eligible:true,reason:null}],selected:input.sheet_id===SID&&input.context_item_id===IID?{review_hash:'b'.repeat(64),source_name:'pendulum.txt',projection:{name:'Physics with Mira',subjectDomain:'physics',explanationOrder:'Known facts, then calculation'},material_text:'Twelve oscillations take24seconds. The period is2seconds.',terms}:null,statement_set:'account-material-publication/v1',statements:[
 {id:'authorize_public_material',text:'Let signed-in adults receive AI text answers using this reviewed material and these teaching choices.'},
 {id:'confirm_material_rights',text:'I created this material and have permission to publish its contents. I reviewed it for private information.'},
 {id:'accept_public_ai_disclosure',text:'This publishes AI text from my account materials. It does not verify my identity or authorize voice, training or private relationship memory.'},
 {id:'accept_publication_terms',text:'I accept the displayed audience, term, question limits and budget. Visitors may copy answers. I can stop this link and erase stored content.'},
],can_publish:input.sheet_id===SID&&input.context_item_id===IID,publications:publication?[publication]:[]}});
   if(op==='publish'){publication={...base,public_id:input.publication_id};if(lostPublish){lostPublish=false;loseBody();return;}return send({publication},201);}
   if(op==='status')return publication?.public_id===input.publication_id?send({publication}):send({error:'not_found'},404);
   if(op==='unpublish'){publication={...base,public_id:input.publication_id,state:'revoked',can_text:false};return send({publication});}
  }
  if(url.pathname==='/api/text-publication'){
   if(op==='open')return publication?.public_id===input.public_id?send({publication}):send({error:'not_found'},404);
   assert.equal(req.headers.authorization,`Bearer ${visitorToken}`);
   if(op==='join'){assert.equal(input.is_adult,true);assert.equal(input.accept_ai_disclosure,true);assert.equal(input.accept_retention,true);assert.equal(input.public_id,publication.public_id);return send({publication,session_token:'synthetic-publication-session',expires_at:base.expires_at,remaining_questions:20});}
   if(op==='ask'){assert.equal(input.public_id,publication.public_id);const result={public_id:input.public_id,request_id:input.request_id,state:heldQuestion?'pending':'complete',billing_state:'settled',can_voice:false,created_at:base.created_at,...(!heldQuestion?{answer:'The period is2seconds:24divided by12.'}:{})};asked.set(input.request_id,result);return send({request:result});}
   if(op==='result')return asked.has(input.request_id)?send({request:asked.get(input.request_id)}):send({error:'not_found'},404);
   if(op==='forget'){asked.clear();if(lostForget){lostForget=false;loseBody();return;}return send({forgotten:true,private_payload_erased:true});}
  }
  send({error:'unexpected_fixture_request'},500);
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture_failure'}));console.error(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await launchSuiteBrowser("text-publication-ui");
let groups=0;const results=[];const check=(name)=>{groups++;results.push(name);console.log('ok '+groups+' - '+name);};
try{
 // Same compiled classic-script bytes in both controls. Only the document's
 // encoding declaration differs; real studio.html declares UTF-8 too.
 for(const legacy of [true,false]){
  const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/?view=owner'+(legacy?'&__fixture_legacy_charset=1':''));
  if(legacy){assert.equal(await page.evaluate(()=>document.characterSet),'windows-1252');assert(errors.some(e=>e.includes('Invalid or unexpected token')));assert.equal(await page.locator('#root').innerHTML(),'');assert.equal(requests.length,0);check('same Unicode bundle without charset fails before React and requests');}
  else{await page.getByLabel('Teaching profile').waitFor();assert.equal(await page.evaluate(()=>document.characterSet),'UTF-8');assert.deepEqual(errors,[]);check('same Unicode bundle with production UTF-8 declaration mounts owner readiness');}
  await page.close();
 }
 for(const width of [390,1440]){
  publication=null;requests=[];asked.clear();heldQuestion=null;
  const context=await browser.newContext({viewport:{width,height:900}});let page=await context.newPage();const ownerPage=page;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?view=owner');await page.getByLabel('Teaching profile').selectOption(SID);await page.getByLabel('Material').selectOption(IID);
  await page.getByRole('heading',{name:'Review what you will share'}).waitFor();assert(await page.getByRole('button',{name:'Publish link',exact:true}).isDisabled());assert.equal(requests.filter(r=>r.op==='publish').length,0);check(width+' owner review does not publish');
  await page.getByText('pendulum.txt',{exact:true}).last().click();for(const box of await page.getByRole('group',{name:'Permission to publish'}).getByRole('checkbox').all())await box.check();lostPublish=true;
  await page.getByRole('button',{name:'Publish link',exact:true}).click();await page.getByRole('button',{name:'Check status',exact:true}).waitFor();assert.equal(requests.filter(r=>r.op==='publish').length,1);check(width+' unknown publication keeps recovery');
  await page.reload();await page.getByRole('button',{name:'Check status',exact:true}).click();await page.getByLabel('Share link').waitFor();assert.equal(requests.filter(r=>r.op==='publish').length,1);check(width+' reload readback never republishes');
  await page.screenshot({path:join(out,`owner-${width}.png`),fullPage:true});
  const sharedLink=await page.getByLabel('Share link').inputValue();assert.equal(new URL(sharedLink).searchParams.get('publication'),publication.public_id);
  if(width===390){
   const callbackContext=await browser.newContext({viewport:{width,height:900}}),callbackPage=await callbackContext.newPage();
   await callbackPage.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await callbackPage.goto(sharedLink+'#access_token=fresh-callback-token&refresh_token=fresh-callback-refresh&expires_in=3600');
   await callbackPage.getByRole('heading',{name:'Before your first question'}).waitFor();
   assert.equal(await callbackPage.evaluate(()=>JSON.parse(localStorage.getItem('meera.state.v1')).auth.userId),'50000000-0000-4000-8000-000000000001');assert.equal(new URL(callbackPage.url()).hash,'');check('fresh callback without a stored account refreshes into the publication');
   await callbackContext.close();

   const raceContext=await browser.newContext({viewport:{width,height:900}}),racePage=await raceContext.newPage();
   await racePage.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await racePage.goto(origin+'/');await racePage.evaluate(()=>localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:'stale-user',accessToken:'s'.repeat(24),refreshToken:'stale-refresh',expiresAt:Date.now()+3600000}})));
   holdRefresh=true;heldRefresh=null;await racePage.goto(sharedLink+'#access_token=racing-callback-token&refresh_token=racing-callback-refresh&expires_in=3600');for(let i=0;!heldRefresh&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert(heldRefresh,'callback refresh actually held');
   await racePage.evaluate(()=>{localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:'newer-user',accessToken:'n'.repeat(24),refreshToken:'newer-refresh',expiresAt:Date.now()+3600000}}));window.dispatchEvent(new StorageEvent('storage',{key:'meera.state.v1'}));});holdRefresh=false;heldRefresh();heldRefresh=null;
   await racePage.getByRole('heading',{name:'Before your first question'}).waitFor();
   await racePage.waitForFunction(()=>JSON.parse(localStorage.getItem('meera.state.v1')).auth?.userId==='newer-user');assert.equal(await racePage.evaluate(()=>JSON.parse(localStorage.getItem('meera.state.v1')).auth.userId),'newer-user');check('held callback cannot overwrite a newer stored account');
   await raceContext.close();
  }
  const visitorContext=await browser.newContext({viewport:{width,height:900}});page=await visitorContext.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(sharedLink);await page.getByLabel('Email',{exact:true}).fill('visitor@example.test');await page.getByRole('button',{name:'Send a code',exact:true}).click();await page.getByLabel('6-digit code').fill('123456');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Before your first question'}).waitFor();assert(await page.getByRole('button',{name:'Start conversation'}).isDisabled());assert.equal(requests.filter(r=>r.op==='join').length,0);check(width+' actual OTP flow reaches explicit admission');
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Start conversation'}).click();await page.getByLabel('Your question',{exact:true}).fill('What is the period?');await page.getByRole('button',{name:'Ask',exact:true}).click();await page.getByText('The period is2seconds:24divided by12.',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.op==='ask').length,1);check(width+' visitor asks after admission');
  await page.screenshot({path:join(out,`visitor-${width}.png`),fullPage:true});
  await page.reload();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Start conversation'}).click();await page.getByRole('button',{name:'Check answer status'}).click();await page.getByText('The period is2seconds:24divided by12.',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.op==='ask').length,1);check(width+' visitor refresh reads same request without dispatch');
  lostForget=true;await page.getByText('Your conversation',{exact:true}).click();await page.getByRole('button',{name:'Delete my conversation'}).click();await page.getByRole('button',{name:'Confirm deletion'}).waitFor();assert.equal(await page.getByText('The period is2seconds:24divided by12.',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Start conversation'}).count(),0);check(width+' lost forget hides content and prevents admission');
  await page.reload();await page.getByRole('button',{name:'Confirm deletion'}).click();await page.getByText('Your questions and answers have been deleted.').waitFor();assert.equal(asked.size,0);check(width+' pending deletion survives reload and confirms without admission');
  await ownerPage.getByRole('button',{name:'Unpublish',exact:true}).click();await ownerPage.getByText('This link is private. Review again to publish a new link.').waitFor();
  await page.goto(sharedLink);await page.getByText('This conversation is no longer available.').waitFor();assert.equal(requests.filter(r=>r.op==='ask').length,1);check(width+' unpublish closes the exact shared destination');
  await page.getByText('Your conversation',{exact:true}).click();await page.getByRole('button',{name:'Delete my conversation'}).click();await page.getByText('Your questions and answers have been deleted.').waitFor();check(width+' deletion remains available on inactive publication');
  publication={...publication,state:'active',can_text:true};await page.reload();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Start conversation'}).click();
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('meera.state.v1'));state.auth.expiresAt=0;localStorage.setItem('meera.state.v1',JSON.stringify(state));});
  const startOps=requests.length;await page.getByLabel('Your question',{exact:true}).fill('Explain the period again.');await page.getByRole('button',{name:'Ask',exact:true}).click();await page.getByText('The period is2seconds:24divided by12.',{exact:true}).waitFor();const newOps=requests.slice(startOps).map(r=>r.op);assert(newOps.indexOf('refresh')>=0&&newOps.indexOf('refresh')<newOps.indexOf('ask'));check(width+' expired token refreshes before question dispatch');
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('meera.state.v1'));state.auth.expiresAt=0;localStorage.setItem('meera.state.v1',JSON.stringify(state));});
  const beforeFail=await page.evaluate(()=>JSON.stringify({...sessionStorage})),askCount=requests.filter(r=>r.op==='ask').length;failRefresh=true;
  await page.getByLabel('Your question',{exact:true}).fill('One more question.');await page.getByRole('button',{name:'Ask',exact:true}).click();await page.getByText("We couldn't refresh your sign-in. Reload to continue.",{exact:true}).waitFor();assert.equal(requests.filter(r=>r.op==='ask').length,askCount);assert.equal(await page.evaluate(()=>JSON.stringify({...sessionStorage})),beforeFail);failRefresh=false;check(width+' failed refresh creates no question receipt or dispatch');
  await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('meera.state.v1'));state.auth.expiresAt=0;localStorage.setItem('meera.state.v1',JSON.stringify(state));});
  holdRefresh=true;heldRefresh=null;await page.reload();await page.waitForFunction(()=>document.body.textContent.includes('Opening conversation'));for(let i=0;!heldRefresh&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert(heldRefresh,'refresh actually held');
  await page.evaluate(()=>{localStorage.setItem('meera.state.v1','{}');window.dispatchEvent(new StorageEvent('storage',{key:'meera.state.v1'}));});holdRefresh=false;heldRefresh();heldRefresh=null;await page.getByLabel('Email',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('meera.state.v1')).auth||null),null);check(width+' held restoration cannot undo a newer sign-out');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);check(width+' no page errors or horizontal overflow');
  await visitorContext.close();await context.close();
 }
 for(const [p,hash] of Object.entries(sourceHashes))assert.equal(createHash('sha256').update(readFileSync(join(root,p))).digest('hex'),hash,'source changed during browser proof');
 writeFileSync(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),groups,results,sourceHashes,scope:'Mounted synthetic HTTP fixture only; no real SQL/auth provider/Azure'},null,2));
 console.log(JSON.stringify({groups,out}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
