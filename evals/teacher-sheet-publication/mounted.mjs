// Mounted actual editors/publication; hosted synthetic API only. Local safe
// modes return before HTTP/browser imports or any listener is created.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHeldRequestBarrier} from './held-request.mjs';
import {runBarrierControls} from './barrier-controls.mjs';
const barrierGroups=await runBarrierControls();
if (process.argv.includes('--source-only')) {
 console.log(`${barrierGroups} fixture barrier/source groups passed; no server, browser, database or provider started`);
 process.exit(0);
}
const {build}=await import('vite');
const root=fileURLToPath(new URL('../../',import.meta.url)),art=join(root,'scratchpad/teacher-sheet-publication-mounted',String(Date.now()));
let review,mode,posts,reads,loadedSheet,draftReads,browser,server;const checks=[],errors=[],heldRequests=createHeldRequestBarrier();
const check=name=>{checks.push(name);console.log('PASS '+name);};
const old=execFileSync('git',['show','43230e5e:src/creatorStudio/TeacherSheetStudio.tsx'],{cwd:root,encoding:'utf8'});
const oldLoads=JSON.parse(readFileSync(new URL('./old-load-editors.json',import.meta.url),'utf8')).files;
try{
 const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'evals/teacher-sheet-publication/host.html')}},plugins:[{name:'old-publication-caller',resolveId(id){if(id==='virtual:old-publication-editor')return '\0old-publication-editor.tsx';if(id==='virtual:old-load-creator')return '\0old-load-creator.tsx';if(id==='virtual:old-load-studio')return '\0old-load-studio.tsx';},load(id){const lane=id==='\0old-load-studio.tsx'?'studio':'creatorStudio',source=id==='\0old-publication-editor.tsx'?old:id==='\0old-load-creator.tsx'||id==='\0old-load-studio.tsx'?oldLoads[lane]:null;if(source!==null)return source.replace(/(from\s*|import\s*|import\()(["'])(\.\.?\/[^"']+)\2/g,(_,p,q,r)=>p+q+resolve(root,'src',lane,r).replaceAll('\\','/')+q);}}]});
 const assets=new Map(built.output.map(x=>['/'+x.fileName,x.type==='chunk'?x.code:x.source]));
 if (process.argv.includes('--build-only')) {
  assert([...assets.keys()].some(path=>path.endsWith('.html')));
  console.log(`${barrierGroups} fixture barrier/source groups and actual component fixture build passed; no server or browser started`);
  process.exit(0);
 }
 if(process.env.GITHUB_ACTIONS !== 'true')throw new Error('Mounted publication eval requires GitHub-hosted CI; use --source-only or --build-only locally.');
 const {createServer}=await import('node:http');
 const {chromium}=await import('playwright');
 const {loadFixtureAgent}=await import('../room/fixtures.mjs');
 const {reviewOwnedTeacherSheetPublication}=await import('../../api/_teacher-sheet-draft.js');
 const {fixture,owner,replica,agent,row}=await import('./fixtures.mjs');
 const sheet={...(await loadFixtureAgent(root)).SHEET,slug:'publication-fixture'};
 const f=fixture({agentId:agent,rows:[row(sheet)]}),initial=await reviewOwnedTeacherSheetPublication(f.db,owner,replica);
 mkdirSync(art,{recursive:true});
 for(const [lane,source]of Object.entries(oldLoads))writeFileSync(join(art,`${lane}-old-load.tsx`),source);
 server=createServer(async(req,res)=>{const requestGeneration=heldRequests.generation,url=new URL(req.url,'http://fixture');const send=(status,data)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}};
  if(url.pathname==='/api/teacher-sheet'){
   assert.equal(req.headers.authorization,'Bearer synthetic-owner');
   if(req.method==='GET'){
    if(!url.searchParams.has('op')){draftReads.push(req.url);assert.equal(url.searchParams.get('replica_id'),replica);if(mode==='failed-load')return send(503,{error:'synthetic_load_unavailable'});const captured=structuredClone(loadedSheet);if(mode==='pending-load'){heldRequests.hold('draft-load',requestGeneration,()=>send(200,{sheet:captured}));return;}return send(200,{sheet:captured});}
    reads.push(req.url);assert.equal(url.searchParams.get('op'),'publication_review');
    if(mode==='pending-read'){const captured=structuredClone(review);heldRequests.hold('publication-read',requestGeneration,()=>send(200,captured));return;}
    send(200,review);return;
   }
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);posts.push(body);assert.equal(body.op,'publish');assert.equal(body.replica_id,replica);assert.deepEqual(body.review,initial.review);assert.equal(body.evidence,undefined);
   if(mode==='conflict'){send(409,{error:'teacher_sheet_publication_review_changed'});return;}
   if(mode==='pending-post'){const captured=structuredClone(review);heldRequests.hold('publication-post',requestGeneration,()=>{review={...captured,sheet:{...captured.sheet,status:'published',published_at:'2026-09-07T00:00:02Z'}};send(200,review);});return;}
   review={...review,sheet:{...review.sheet,status:'published',published_at:'2026-09-07T00:00:02Z'}};
   if(mode==='lost-post'){res.writeHead(200,{'content-type':'application/json'});res.end('unreadable response');return;}send(200,review);return;
  }
  const asset=assets.get(url.pathname);if(asset!==undefined){res.writeHead(200,{'content-type':extname(url.pathname)==='.html'?'text/html':extname(url.pathname)==='.css'?'text/css':'text/javascript'});res.end(asset);return;}res.writeHead(404).end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const open=async(suffix='')=>{heldRequests.assertIdle();heldRequests.reset();posts=[];reads=[];draftReads=[];review=structuredClone(initial);loadedSheet=structuredClone(initial.sheet);mode='normal';await page.goto(origin+'/evals/teacher-sheet-publication/host.html'+suffix);};
  const region=()=>page.locator('.teacher-sheet-publication');
  const inspect=async()=>{await region().getByRole('button',{name:'Review saved sheet',exact:true}).click();await region().getByRole('checkbox').waitFor();};
  const publish=async()=>{await region().getByRole('checkbox').check();await region().getByRole('button',{name:'Publish teaching sheet',exact:true}).click();};
  const load=async()=>{await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/teacher-sheet'&&!new URL(r.url()).searchParams.has('op')),page.locator('.section-heading button').click()]);};
  const holdRequest=async(kind,action)=>{const arrived=heldRequests.expect(kind);await action();const held=await arrived;assert.equal(heldRequests.size,1);assert.equal(held.kind,kind);assert.equal(held.generation,heldRequests.generation);return held;};
  const freshReview=async()=>{await page.waitForFunction(()=>{const panel=document.querySelector('.teacher-sheet-publication'),button=panel?.querySelector('button');return button?.textContent==='Review saved sheet'&&!button.disabled&&!panel.querySelector('input[type="checkbox"]')&&!panel.querySelector('a');});};
  const mutateCommitted=async mutation=>{
   const before=await page.evaluate(()=>window.publicationProbe.committed());
   await page.evaluate(name=>window.publicationProbe[name](),mutation);
   await page.waitForFunction(({before,mutation})=>{const committed=window.publicationProbe.committed();return committed.generation>before.generation&&(mutation==='hide'?!committed.visible:mutation==='scope'?committed.replica==='22222222-2222-4222-8222-222222222222':mutation==='edit'?committed.identityWho==='Local changed identity':committed.callbackChanged);},{before,mutation});
   if(mutation==='hide')await region().waitFor({state:'detached'});else await freshReview();
  };
  const releaseHeld=async held=>{
   const responsePromise=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/teacher-sheet'&&(held.kind==='publication-post'?response.request().method()==='POST':response.request().method()==='GET'&&(held.kind==='draft-load'?!url.searchParams.has('op'):url.searchParams.get('op')==='publication_review'));});
   heldRequests.release(held);const response=await responsePromise;assert.equal(await response.finished(),null);
   // Network completion is only drainage. Scope/reset proof is obtained above,
   // before release; the existing idle fence lets stale completion be observed.
   await page.waitForLoadState('networkidle');
  };
  for(const suffix of ['', '?studio=1'])for(const mutation of ['new-row','revoked','version']){
   for(const stale of [true,false]){
    await open(suffix+(stale?(suffix?'&':'?')+'oldLoad=1':''));await inspect();await publish();await region().getByText('This teaching sheet is published.',{exact:true}).waitFor();
    const before=JSON.stringify(review.sheet.draft);review=structuredClone(initial);
    if(mutation==='new-row'){review.ok=false;review.blockers=['publication_consent_unavailable'];review.sheet={...review.sheet,sheet_id:'88888888-8888-4888-8888-888888888888',consent_artifact_id:null};review.review={...review.review,sheet_id:review.sheet.sheet_id,snapshot_hash:'b'.repeat(64)};}
    if(mutation==='revoked'){review.ok=false;review.blockers=['saved_sheet_revoked'];review.sheet={...review.sheet,status:'revoked'};}
    if(mutation==='version'){review.sheet={...review.sheet,version:review.sheet.version+'-next'};review.review={...review.review,version:review.sheet.version,snapshot_hash:'c'.repeat(64)};}
    loadedSheet=structuredClone(review.sheet);assert.equal(JSON.stringify(loadedSheet.draft),before);const readCount=reads.length;await load();await page.waitForLoadState('networkidle');assert.equal(draftReads.length,1);assert.equal(reads.length,readCount);assert.equal(posts.length,1);
    if(stale){assert.equal(await region().getByText('This teaching sheet is published.',{exact:true}).count(),1);assert.equal(await region().getByRole('link').count(),1);}
    else {await region().getByRole('button',{name:'Review saved sheet',exact:true}).waitFor();assert.equal(await region().getByRole('link').count(),0);assert.equal(await region().getByRole('checkbox').count(),0);await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/teacher-sheet'&&new URL(r.url()).searchParams.get('op')==='publication_review'),region().getByRole('button',{name:'Review saved sheet',exact:true}).click()]);assert.equal(reads.length,readCount+1);assert.equal(posts.length,1);assert.equal(await region().getByText('This teaching sheet is published.',{exact:true}).count(),0);if(mutation==='version')assert.equal(await region().getByRole('checkbox').isChecked(),false);else assert.equal(await region().getByRole('checkbox').count(),0);}
   }check(`${width}/${suffix?'studio':'creator'}/${mutation}: old same-body load retains stale publication; current load requires fresh explicit review`);
  }
  for(const pendingMode of ['pending-read','pending-post']){
   await open();if(pendingMode==='pending-post')await inspect();mode=pendingMode;
   const held=await holdRequest(pendingMode==='pending-post'?'publication-post':'publication-read',()=>pendingMode==='pending-post'?publish():region().getByRole('button',{name:'Review saved sheet',exact:true}).click());
   await page.waitForFunction(()=>document.querySelector('.teacher-sheet-publication button')?.disabled===true);mode='normal';const before=reads.length;await load();await freshReview();await releaseHeld(held);assert.equal(reads.length,before);assert.equal(await region().getByRole('checkbox').count(),0);assert.equal(await region().getByRole('link').count(),0);assert.equal(posts.length,pendingMode==='pending-post'?1:0);
  }check(`${width}: loading identical draft invalidates pending publication GET and POST completion without follow-up requests`);
  for(const loadMode of ['pending-load','failed-load']){
   await open();await inspect();await publish();await region().getByText('This teaching sheet is published.',{exact:true}).waitFor();mode=loadMode;
   if(loadMode==='pending-load'){const held=await holdRequest('draft-load',()=>page.locator('.section-heading button').click());await page.waitForFunction(()=>document.querySelector('.section-heading button')?.disabled===true);assert.equal(await region().getByRole('link').count(),0);assert.equal(await region().getByRole('button').isDisabled(),true);await releaseHeld(held);}else await load();
   await freshReview();assert.equal(await region().getByRole('link').count(),0);assert.equal(reads.length,2);assert.equal(posts.length,1);
  }check(`${width}: pending or failed draft load cannot retain published continuation or dispatch another publication`);
  if(process.argv.includes('--load-only')){heldRequests.assertIdle();await context.close();continue;}
  await open('?old=1');await page.locator('#teacher-sheet-studio').waitFor();assert.equal(await region().count(),0);assert.equal(posts.length,0);check(`${width}: exact old editor has no publication caller`);
  for(const suffix of ['', '?studio=1']){
   await open(suffix);await region().waitFor();assert.equal(reads.length,0);assert.equal(posts.length,0);await inspect();assert.equal(posts.length,0);assert.equal(await region().getByRole('button',{name:'Publish teaching sheet',exact:true}).isDisabled(),true);
   assert.match(await region().innerText(),/not been checked/);await page.screenshot({path:join(art,`${width}-${suffix?'studio':'creator'}-review.png`),fullPage:true});await region().screenshot({path:join(art,`${width}-${suffix?'studio':'creator'}-panel.png`)});await publish();await region().getByText('This teaching sheet is published.',{exact:true}).waitFor();assert.equal(posts.length,1);assert.equal(reads.length,2);const href=await region().getByRole('link').getAttribute('href');assert(href.includes('replica='+replica)&&href.includes('view=share'));check(`${width}/${suffix?'studio':'creator'}: actual editor/client review -> explicit publish -> same snapshot readback`);
  }
  await open();review={...review,ok:false,blockers:['saved_sheet_binding_unavailable','publication_consent_unavailable'],sheet:{...review.sheet,consent_artifact_id:null}};await region().getByRole('button').click();await region().getByText('Waiting on us',{exact:true}).waitFor();assert.equal(await region().getByRole('checkbox').count(),0);assert.equal(await region().getByRole('link').count(),0);assert.equal(posts.length,0);check(`${width}: unbound/consent unavailable stays editable with no circular publication link`);
  await open();await inspect();await page.locator('#syllabus-scope').fill('Unsaved local change');assert.equal(await region().getByRole('checkbox').count(),0);await region().getByRole('button').click();await region().getByText('Save your changes above, then review the saved sheet again.').waitFor();assert.equal(await region().getByRole('checkbox').count(),0);assert.equal(posts.length,0);check(`${width}: local edit invalidates confirmation and cannot publish saved-different content`);
  await open('?leaf=1');await inspect();mode='lost-post';await publish();await region().getByText('Publication status is unknown. Check saved status before trying again.').waitFor();assert.equal(posts.length,1);assert.equal(await region().getByRole('checkbox').count(),0);mode='normal';await region().getByRole('button',{name:'Check saved status',exact:true}).click();await region().getByText('This teaching sheet is published.',{exact:true}).waitFor();assert.equal(posts.length,1);await page.reload();await region().getByRole('button',{name:'Review saved sheet',exact:true}).click();await region().getByText('This teaching sheet is published.',{exact:true}).waitFor();assert.equal(posts.length,1);check(`${width}: lost POST response and reload recover through explicit GET, never replay POST`);
  await open('?leaf=1');await inspect();mode='conflict';await publish();await region().getByText('Publication did not complete. Review the saved sheet again.').waitFor();assert.equal(await region().getByRole('checkbox').count(),0);assert.equal(posts.length,1);check(`${width}: concurrent saved selection conflict requires new review`);
  await open('?leaf=1');await inspect();mode='lost-post';await publish();await region().getByText('Publication status is unknown. Check saved status before trying again.').waitFor();review={...structuredClone(initial),review:{...initial.review,snapshot_hash:'a'.repeat(64)}};mode='normal';await region().getByRole('button',{name:'Check saved status',exact:true}).click();await region().getByText('The saved sheet changed. Review its current version before publishing.').waitFor();assert.equal(await region().getByRole('checkbox').isChecked(),false);assert.equal(await region().getByRole('button',{name:'Publish teaching sheet',exact:true}).isDisabled(),true);assert.equal(posts.length,1);check(`${width}: changed readback allows a fresh explicit review without claiming old completion or auto retry`);
  await open('?hi=1');await region().getByRole('button').click();await region().getByRole('checkbox').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(art,`${width}-hindi-review.png`),fullPage:true});check(`${width}: Hindi publication review fits viewport`);
  if(width===390){
   for(const mutation of ['hide','scope','edit','callback']){
    await open('?leaf=1');mode='pending-read';const held=await holdRequest('publication-read',()=>region().getByRole('button').click());await page.waitForFunction(()=>document.querySelector('.teacher-sheet-publication button')?.disabled===true);await mutateCommitted(mutation);await releaseHeld(held);assert.equal(await region().getByRole('checkbox').count(),0);assert.equal(posts.length,0);check(`pending GET ${mutation}: no stale review or publish`);
   }
   await open('?leaf=1');await inspect();mode='pending-post';const held=await holdRequest('publication-post',publish);await mutateCommitted('scope');await releaseHeld(held);assert.equal(reads.length,1);assert.equal(await region().getByText('This teaching sheet is published.',{exact:true}).count(),0);check('pending POST scope change: no old readback or state resurrection');
   for(const mutate of [r=>r.replica_id='foreign',r=>r.review.sheet_id+='\n',r=>r.consent_basis='verified_active_grant',r=>r.sheet.consent_artifact_id=null,r=>r.errors=[{}],r=>r.sheet.draft=[]]){
    await open('?leaf=1');mutate(review);const outcome=await page.evaluate(()=>window.publicationProbe.read().then(()=> 'accepted',e=>e.message));assert.equal(outcome,'teacher_sheet_publication_response_invalid');assert.equal(posts.length,0);
   }check('actual client refuses six malformed/foreign/false-authority response controls');
  }
  heldRequests.assertIdle();await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(art,'result.json'),JSON.stringify({at:new Date().toISOString(),barrierGroups,checks,errors,scope:'Mounted actual editors/client and publication control; synthetic localhost responses only. No actual DB publication, authority receipt, provider or full Studio-shell acceptance.'},null,2));console.log(`${checks.length} mounted groups and ${barrierGroups} fixture barrier/source groups passed; ${art}`);
}catch(error){mkdirSync(art,{recursive:true});writeFileSync(join(art,'failure.json'),JSON.stringify({checks,errors,error:String(error.stack||error)},null,2));throw error;}finally{await browser?.close();heldRequests.reset();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}
