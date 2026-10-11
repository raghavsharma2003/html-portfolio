import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const files=['src/studio/livenessApi.ts','src/studio/LivenessCapture.tsx','src/studio/CloneVerificationJourney.tsx','src/studio/StudioApp.tsx'];
const pins=JSON.parse(readFileSync(new URL('old-source-pins.json',import.meta.url),'utf8'));
for(const [file,hash] of Object.entries(pins.sha256_canonical_lf))assert.equal(sha(readFileSync(new URL('old-'+file+'.txt',import.meta.url),'utf8').replaceAll('\r\n','\n')),hash);
const studio=readFileSync(join(root,files[3]),'utf8'),ast=ts.createSourceFile('StudioApp.tsx',studio,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const bodies={};
function visit(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleCheckCaptureReadiness')bodies.read='const '+node.getText(ast)+';';
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleIssueChallenge')bodies.issue=node.getText(ast);
 ts.forEachChild(node,visit);
}visit(ast);assert(bodies.read&&bodies.issue);
const hostSource=readFileSync(new URL('host.tsx',import.meta.url),'utf8').replace('/* ACTUAL_STUDIO_CALLBACKS */',bodies.read+'\n'+bodies.issue);
assert.equal(ts.createSourceFile('host.tsx',hostSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length,0,'mounted host parses after actual callback insertion');
if(process.argv.includes('--prepare')){console.log(JSON.stringify({historical_fixtures:2,actual_callbacks:2,source_hashes:Object.fromEntries(files.map(f=>[f,sha(readFileSync(join(root,f)))])),no_browser:true}));process.exit(0);}
const {build}=await import('vite'),{chromium}=await import('playwright');
const out=join(root,'scratchpad/selected-reference-comparison',String(Date.now()));mkdirSync(out,{recursive:true});
const result={started_at:new Date().toISOString(),source_hashes:Object.fromEntries(files.map(f=>[f,sha(readFileSync(join(root,f)))])),historical:pins,checks:[],errors:[],scope:'Actual Journey/Capture/client with exact StudioApp callback source; synthetic localhost API and scope controls; not full Studio shell or backend/model acceptance.'};
let browser,server,page;const assets=new Map();
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',SA='20000000-0000-4000-8000-000000000001',SB='20000000-0000-4000-8000-000000000002';
const selection=(rid=A,id=SA,rev='a')=>({statement_set:'selected-voice-comparison/v1',primary_source_id:id,primary_selection_id:rid,source_sha256:(id===SA?'a':'b').repeat(64),comparison_snapshot_sha256:rev.repeat(64),source_label:null,source_created_at:id===SA?'2026-09-01T12:00:00.000Z':'2026-09-02T12:00:00.000Z',locales:['en-IN','hi-IN'],available:true,code:''});
let selections,ready,malformed,requests,hold,held,issueStatus;
function reset(){selections={[A]:selection(),[B]:selection(B,SB,'b')};ready=true;malformed=false;requests=[];hold=null;held=[];issueStatus=200;}
const until=async pred=>{const end=Date.now()+10000;while(!pred()){assert(Date.now()<end,'exact request barrier');await new Promise(r=>setTimeout(r,10));}};
try{
 const bundle=await build({root,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,rolldownOptions:{input:join(root,'evals/selected-reference-comparison/host.tsx'),output:{entryFileNames:'host.js'}}},plugins:[{name:'actual-callbacks-and-pinned-old-producer',enforce:'pre',
  resolveId(id,importer){if(id==='comparison-old-capture')return'\0old-capture';if(id==='comparison-old-api')return'\0old-api';if(importer?.startsWith('\0old-')&&id.startsWith('./')){const base=join(root,'src/studio',id.slice(2));for(const ext of ['','.ts','.tsx','.js'])if(existsSync(base+ext))return base+ext;}},
  load(id){if(id==='\0old-capture')return{code:readFileSync(new URL('old-LivenessCapture.tsx.txt',import.meta.url),'utf8'),moduleType:'tsx'};if(id==='\0old-api')return{code:readFileSync(new URL('old-livenessApi.ts.txt',import.meta.url),'utf8'),moduleType:'ts'};},
  transform(code,id){if(id.replaceAll('\\','/').endsWith('/selected-reference-comparison/host.tsx'))return{code:code.replace('/* ACTUAL_STUDIO_CALLBACKS */',bodies.read+'\n'+bodies.issue),map:null};},
 }]});
 for(const asset of bundle.output)assets.set('/'+asset.fileName,asset.type==='chunk'?asset.code:asset.source);
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(assets.get(url.pathname));return;}
  if(url.pathname!=='/api/replica-liveness'){res.setHeader('Content-Type','text/html');res.end('<style>@layer reset,tokens,base,components,responsive;</style>'+[...assets.keys()].filter(p=>p.endsWith('.css')).map(p=>`<link rel="stylesheet" href="${p}">`).join('')+'<div id="root"></div><script type="module" src="/host.js"></script>');return;}
  try{
   let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);requests.push({input,token:req.headers.authorization});
   let status=200,body;
   if(input.op==='capture_readiness')body={challenge:null,readiness:{ready,waiting_on:ready?null:'us',code:ready?'':'liveness_verifier_unavailable'},comparison:malformed?{...selections[input.replica_id],source_sha256:'bad'}:selections[input.replica_id],comparison_code:''};
   else if(input.op==='issue'){
    const c=selections[input.replica_id];status=issueStatus;
    if(!input.comparison_attestations||input.expected_primary_source_id!==c.primary_source_id||input.expected_primary_selection_id!==c.primary_selection_id||input.expected_primary_source_sha256!==c.source_sha256||input.expected_comparison_snapshot_sha256!==c.comparison_snapshot_sha256)status=422;
    body=status===200?{challenge:{challenge_id:'30000000-0000-4000-8000-000000000001',replica_id:input.replica_id,state:'issued',phrase:'Synthetic fixture phrase',attempt:1,source_id:null,issued_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),failure_code:'',face_session_state:'not_started'}}:{error:status===401?'unauthorized':'comparison_required'};
   }else{throw Error('unexpected operation');}
   const send=()=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}};
   if(hold===input.op){hold=null;held.push({send,res});return;}send();
  }catch{result.errors.push('fixture_server_failure');res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"fixture_failure"}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await launchSuiteBrowser("selectedreferencecomparison");
 const issueRequests=()=>requests.filter(r=>r.input.op==='issue');
 async function release(){assert.equal(held.length,1);const h=held.shift();h.send();await page.waitForFunction(()=>window.__fetchPending===0);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
 const chooseAll=async()=>{const boxes=page.getByRole('checkbox');for(let i=0;i<await boxes.count();i++)await boxes.nth(i).check();};
 const request=()=>page.getByRole('button',{name:'Request live phrase',exact:true});
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>result.errors.push(e.message));
  await page.addInitScript(()=>{window.__fetchSettled=0;window.__fetchPending=0;const fetch=window.fetch;window.fetch=async(...args)=>{window.__fetchPending++;try{return await fetch(...args);}finally{window.__fetchSettled++;window.__fetchPending--;}};});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const open=async old=>{await page.goto(origin+'/?'+(old?'old=1':''));await page.waitForFunction(()=>window.__comparison?.ready);};
  const pass=async name=>{assert.deepEqual(result.errors,[]);result.checks.push({width,name,read_requests:requests.filter(r=>r.input.op==='capture_readiness').length,issue_requests:issueRequests().length});console.log(`ok ${result.checks.length} - ${width} ${name}`);};
  reset();ready=false;await open();await page.getByText('Live verification is unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await request().count(),0);assert.equal(issueRequests().length,0);const text=await page.locator('body').innerText();assert(!text.includes(SA)&&!text.includes('a'.repeat(64)));await page.screenshot({path:join(out,`blocked-${width}.png`),fullPage:true});await pass('actual unavailable envelope makes no consent demand and exposes no binding identifiers');
  reset();await open();await request().waitFor();assert.equal(await page.getByRole('checkbox').count(),8);assert.equal(await page.locator('input:checked').count(),0);await page.getByLabel('Phrase language').selectOption('hi-IN');await chooseAll();await request().click();await page.getByText('Synthetic fixture phrase',{exact:true}).waitFor();assert.equal(issueRequests().length,1);const input=issueRequests()[0].input;assert.equal(input.locale,'hi-IN');assert.equal(input.expected_comparison_snapshot_sha256,'a'.repeat(64));assert.equal(Object.keys(input.attestations).length,5);assert.equal(Object.keys(input.comparison_attestations).length,3);assert(Object.values(input.comparison_attestations).every(x=>x===true));await pass('actual Journey, Studio callbacks and client submit exact selected comparison once');
  reset();await open(true);await request().waitFor();assert.equal(await page.getByRole('checkbox').count(),5);await chooseAll();await request().click();await until(()=>issueRequests().length===1);await page.waitForFunction(()=>window.__fetchSettled>=2);assert(!issueRequests()[0].input.expected_comparison_snapshot_sha256);assert(!issueRequests()[0].input.comparison_attestations);await pass('pinned historical component/client lacks mandatory selected-reference producer');
  for(const kind of ['selection','consent']){
   reset();await open();await request().waitFor();await chooseAll();selections[A]=kind==='selection'?selection(A,SB,'b'):selection(A,SA,'c');await request().click();await page.getByText('The recording or its permissions changed. Review the current selection.',{exact:true}).waitFor();assert.equal(issueRequests().length,0);assert.equal(await page.locator('input:checked').count(),0);await pass(`fresh ${kind} replacement refuses saved checks before issue`);
  }
  reset();hold='capture_readiness';await open();await until(()=>held.length===1);await page.getByRole('button',{name:'Switch replica',exact:true}).click();await request().waitFor();await release();assert.equal(await page.locator('input:checked').count(),0);await chooseAll();await request().click();await page.getByText('Synthetic fixture phrase',{exact:true}).waitFor();assert.equal(issueRequests()[0].input.replica_id,B);assert.equal(issueRequests()[0].input.expected_primary_source_id,SB);await pass('late A readiness cannot replace visible B selection');
  for(const action of ['Switch account','Refresh token','Leave verification']){
   reset();await open();await request().waitFor();await chooseAll();hold='issue';issueStatus=401;await request().click();await until(()=>held.length===1);await page.getByRole('button',{name:action,exact:true}).click();await release();assert.equal(await page.evaluate(()=>window.__comparison.authErrors),0);assert.equal(await page.getByText('Synthetic fixture phrase',{exact:true}).count(),0);await pass(`pending issue abort and late401 cannot affect ${action}`);
  }
  reset();await open();await request().waitFor();await chooseAll();selections[A]=selection(A,SA,'d');
  // Hold the fixture's scope adoption to prove the previous readiness locator
  // can succeed on the old scope. Then hold the real new HTTP readiness read.
  await page.evaluate(()=>{window.__comparison.deferReceipt=true;});hold='capture_readiness';
  const readsBefore=requests.filter(r=>r.input.op==='capture_readiness').length;
  await page.getByRole('button',{name:'Replace source permission',exact:true}).click();
  await request().waitFor();const oldChecks=await page.locator('input:checked').count();
  assert.equal(await page.locator('[data-permission-receipt]').getAttribute('data-permission-receipt'),'receipt-1');
  assert.equal(requests.filter(r=>r.input.op==='capture_readiness').length,readsBefore);
  if(process.argv.includes('--old-receipt-wait'))assert.equal(oldChecks,0,'incumbent wait matches old scope before receipt adoption');
  assert.equal(oldChecks,8);assert.throws(()=>assert.equal(oldChecks,0),'old readiness wait does not prove receipt adoption');
  await page.evaluate(()=>window.__comparison.adoptReceipt());
  await page.locator('[data-permission-receipt="receipt-2"]').waitFor();await until(()=>held.length===1);
  await request().waitFor({state:'hidden'});assert.equal(await page.locator('input:checked').count(),0,'no inherited consent while new receipt readiness is pending');
  assert.equal(issueRequests().length,0);await release();await request().waitFor();
  assert.equal(await page.locator('input:checked').count(),0);assert.equal(issueRequests().length,0);
  await pass('local permission receipt adoption clears every choice before fresh readiness resolves; old wait negative detected');
  reset();malformed=true;await open();await page.getByText('Live verification is unavailable',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(issueRequests().length,0);await pass('malformed successful descriptor is unavailable, never checked consent');
  reset();await open();await request().waitFor();await chooseAll();hold='issue';await request().click();await until(()=>held.length===1);const beforeHeaders=await page.evaluate(()=>window.__fetchSettled||0);held[0].res.writeHead(200,{'Content-Type':'application/json'});held[0].res.write('{"challenge":');await page.waitForFunction(n=>(window.__fetchSettled||0)>n,beforeHeaders);held[0].res.destroy();held=[];await page.getByRole('button',{name:'Check saved attempt',exact:true}).waitFor();assert.equal(await request().isDisabled(),true);await page.getByRole('button',{name:'Check saved attempt',exact:true}).click();await page.getByRole('button',{name:'Check saved attempt',exact:true}).waitFor({state:'hidden'});assert.equal(issueRequests().length,1);assert.equal(await page.locator('input:checked').count(),0);await pass('lost issue body requires explicit readback and never retries POST');
  await page.screenshot({path:join(out,`permission-${width}.png`),fullPage:true});await context.close();
 }
 result.passed=true;
}catch(e){result.passed=false;result.failure=String(e.stack||e);result.failure_requests=requests;try{result.failure_dom=await page?.locator('body').innerText();await page?.screenshot({path:join(out,'failure.png'),fullPage:true});}catch{}throw e;}
finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));result.finished_at=new Date().toISOString();writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({artifact:join(out,'result.json'),passed:result.passed,checks:result.checks.length}));}
