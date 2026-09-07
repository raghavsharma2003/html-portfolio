// Actual mounted editors/API wrapper with synthetic localhost draft responses.
// No database, private inference, full Studio shell or publication acceptance.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url)),art=join(root,'scratchpad/private-draft-editor',String(Date.now()));mkdirSync(art,{recursive:true});
const rid='10000000-0000-4000-8000-000000000001';
const minimal={name:'Anjali',identityWho:'Physics teacher',subjectDomain:'physics'};
let raw={...minimal},posts=[],gets=[],browser,server;const checks=[],errors=[];
const old=Object.fromEntries(['creatorStudio','studio'].map(l=>[l,execFileSync('git',['show',`c56cadfe:src/${l}/TeacherSheetStudio.tsx`],{cwd:root,encoding:'utf8'})]));
const check=n=>{checks.push(n);console.log('PASS '+n);};
try{
 const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'evals/private-draft-editor/host.html')}},plugins:[{name:'exact-old-editor',resolveId(id){if(id==='virtual:old-creator')return '\0old-creator.tsx';if(id==='virtual:old-studio')return '\0old-studio.tsx';},load(id){const lane=id==='\0old-creator.tsx'?'creatorStudio':id==='\0old-studio.tsx'?'studio':null;if(lane)return old[lane].replace(/(from\s*|import\s*|import\()(["'])(\.\.?\/[^"']+)\2/g,(_,p,q,r)=>p+q+resolve(root,'src',lane,r).replaceAll('\\','/')+q);}}]});
 const assets=new Map(built.output.map(x=>['/'+x.fileName,x.type==='chunk'?x.code:x.source]));
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname==='/api/teacher-sheet'){
   assert.equal(req.headers.authorization,'Bearer synthetic-owner');
   if(req.method==='GET'){assert.equal(url.searchParams.get('replica_id'),rid);gets.push(req.url);send(200,{sheet:{draft:raw,status:'draft',version:'',sheet_id:'20000000-0000-4000-8000-000000000001',updated_at:null}});return;}
   let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);assert.equal(value.op,'save_draft');assert.equal(value.replica_id,rid);posts.push(value);raw=value.draft;send(200,{ok:false,errors:[{field:'cloneDisclosureFact',code:'missing'}],sheet:{draft:raw,status:'draft',updated_at:null}});return;
  }
  const asset=assets.get(url.pathname);if(asset!==undefined){res.writeHead(200,{'content-type':extname(url.pathname)==='.html'?'text/html':extname(url.pathname)==='.css'?'text/css':'text/javascript'});res.end(asset);return;}
  res.writeHead(404).end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const open=async suffix=>{posts=[];gets=[];raw={...minimal};await page.goto(origin+'/evals/private-draft-editor/host.html'+suffix);await page.getByRole('button',{name:'Meet it',exact:true}).click();};
  for(const lane of ['creator','studio']){
   const suffix=lane==='studio'?'&studio=1':'';
   await open('?old=1'+suffix);await page.getByRole('alert').filter({hasText:'Render failed:'}).waitFor();const failure=await page.getByRole('alert').innerText();assert.match(failure,/map/);assert.equal(posts.length,0);writeFileSync(join(art,`${width}-${lane}-old.json`),JSON.stringify({failure,raw}));await page.screenshot({path:join(art,`${width}-${lane}-old.png`)});check(`${width}/${lane}: exact old editor fails on supported three-field draft`);
   await open('?current=1'+suffix);await page.locator('#teacher-sheet-studio').waitFor();assert.equal(await page.getByRole('alert').count(),0);assert.ok(gets.length>=1);assert.equal(posts.length,0);assert.equal(await page.locator('#strictness').inputValue(),'');assert.equal(await page.locator('#warmth').inputValue(),'');assert.equal(await page.locator('#syllabus-scope').inputValue(),'');assert.equal(await page.locator('.ladder-list li').count(),0);assert.equal(await page.locator('input[type="checkbox"]:checked').count(),0);check(`${width}/${lane}: actual GET -> Meet renders with no implicit values or saves`);
   if(lane==='creator')await page.screenshot({path:join(art,`${width}-usable.png`)});
   const save=page.locator('.person-model-action button');await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),save.click()]);assert.deepEqual(posts[0].draft,minimal);assert.equal(await page.evaluate(d=>window.editorProbe.validate(d).ok,posts[0].draft),false);check(`${width}/${lane}: untouched explicit save preserves exact minimal body and fails actual sheet validation`);
   const extra={...minimal,customOwnerNote:{keep:['exact']},explanationOrder:'diagram -> relation -> check',version:'private-v1'};raw=extra;await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'),page.locator('.section-heading button').click()]);await page.locator('#syllabus-scope').fill('Class 11 mechanics');await page.locator('#strictness').selectOption('2');await page.locator('.syllabus-chapters input').first().check();const rung=page.locator('.create-row input');await rung.fill('identify known quantities');await rung.press('Enter');await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),save.click()]);const saved=posts.at(-1).draft;assert.deepEqual(saved.customOwnerNote,extra.customOwnerNote);assert.equal(saved.explanationOrder,extra.explanationOrder);assert.equal(saved.version,'private-v1');assert.equal(saved.syllabusScope,'Class 11 mechanics');assert.equal(saved.strictness,2);assert.equal(saved.subjectStrands.length,1);assert.deepEqual(saved.doubtEscalationLadder,['identify known quantities']);assert.equal('warmth' in saved,false);assert.equal('cloneDisclosureFact' in saved,false);assert.equal('consentArtifactId' in saved,false);assert.equal('boardVerbalisms' in saved,false);check(`${width}/${lane}: reload and explicit edits retain unrelated fields without saving display defaults or authority`);
   raw={};await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'),page.locator('.section-heading button').click()]);await page.waitForFunction(()=>document.querySelector('#subject-domain')?.value==='');assert.equal(await page.locator('#strictness').inputValue(),'');assert.equal(await page.locator('#warmth').inputValue(),'');await save.focus();await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.keyboard.press('Enter')]);assert.deepEqual(posts.at(-1).draft,{});check(width+'/'+lane+': entirely empty draft has no selected subject or fabricated required values; native keyboard save remains empty');
   await open('?full=1'+suffix);await page.locator('#teacher-sheet-studio').waitFor();await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.locator('.person-model-action button').click()]);assert.deepEqual(posts[0].draft,await page.evaluate(()=>window.editorProbe.full));check(`${width}/${lane}: complete incumbent sheet round-trips unchanged`);
  }
  await open('?hi=1');await page.locator('#teacher-sheet-studio').waitFor();assert.equal(await page.locator('#strictness option:checked').innerText(),'अभी तय नहीं');assert.equal(await page.locator('#warmth option:checked').innerText(),'अभी तय नहीं');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(art,`${width}-hindi.png`)});check(`${width}: Hindi unset controls and responsive fit`);
  await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(art,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,scope:'Actual mounted editor/API wrappers, exact old source negative, synthetic HTTP. No full-shell, SQL or model acceptance.'},null,2));console.log(`${checks.length} groups passed; ${art}`);
}catch(e){writeFileSync(join(art,'failure.json'),JSON.stringify({checks,errors,error:String(e.stack||e)},null,2));throw e;}finally{await browser?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}
