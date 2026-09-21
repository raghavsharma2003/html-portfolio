// Actual mounted editors and API clients. Synthetic loopback transport only.
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {observeBrowser,recordBrowserFailure} from '../browser-action-diagnostics.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {chromium} from 'playwright';
import {boundedWaitMs} from '../lib/bounded-wait.mjs'; // WS-R181: scale the fixed Playwright action timeout by machine load
const root=fileURLToPath(new URL('../../',import.meta.url)),art=join(root,'scratchpad/editor-edit-races',String(Date.now()));mkdirSync(art,{recursive:true});
const rid='10000000-0000-4000-8000-000000000001',sheetId='20000000-0000-4000-8000-000000000001';
const initial={name:'Anjali',identityWho:'Physics teacher',subjectDomain:'physics',syllabusScope:'Saved scope A',subjectStrands:['Kinematics'],doubtEscalationLadder:['First hint'],strictness:2,warmth:3,identityLife:'Teaching life',boundaryParagraph:{retain:'raw boundary'},analogyBank:[null],unknownOwnerField:{retain:['exact',null,7]}};
const old=JSON.parse(readFileSync(join(root,'evals/teacher-sheet-edit-races/old-editors.json'),'utf8'));for(const lane of ['creatorStudio','studio'])assert.equal(createHash('sha256').update(old.files[lane]).digest('hex'),old.hashes[lane]);
let raw,mode,posts,gets,pending=[],browser,server,published=false;const checks=[],errors=[];
const until=async fn=>{const end=Date.now()+8000;while(!fn()){if(Date.now()>end)throw Error('fixture request barrier timed out');await new Promise(r=>setTimeout(r,10));}};
const check=n=>{checks.push(n);console.log(`ok ${checks.length} - ${n}`);};
try{
 const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'evals/teacher-sheet-edit-races/host.html')}},plugins:[{name:'retained-exact-editors',resolveId(id){if(id==='virtual:old-race-creator')return '\0old-race-creator.tsx';if(id==='virtual:old-race-studio')return '\0old-race-studio.tsx';},load(id){const lane=id==='\0old-race-creator.tsx'?'creatorStudio':id==='\0old-race-studio.tsx'?'studio':null;if(lane)return old.files[lane].replace(/(from\s*|import\s*|import\()(["'])(\.\.?\/[^"']+)\2/g,(_,prefix,q,path)=>prefix+q+resolve(root,'src',lane,path).replaceAll('\\','/')+q);}}]});
 const assets=new Map(built.output.map(x=>['/'+x.fileName,x.type==='chunk'?x.code:x.source]));
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}};
  if(url.pathname==='/api/teacher-sheet'){
   assert(['Bearer synthetic-owner','Bearer replacement-owner-token'].includes(req.headers.authorization));
   if(req.method==='GET'){
    gets.push({url:req.url,auth:req.headers.authorization});const replica=url.searchParams.get('replica_id');assert([rid,'10000000-0000-4000-8000-000000000002'].includes(replica));
    if(url.searchParams.get('op')==='publication_review')return send(200,{replica_id:replica,ok:true,errors:[],blockers:[],consent_basis:'persisted_sheet_column',review:{sheet_id:sheetId,version:'fixture',snapshot_hash:'a'.repeat(64)},sheet:{draft:raw,sheet_id:sheetId,version:'fixture',status:published?'published':'draft',published_at:published?'2026-09-07T00:00:00Z':null,consent_artifact_id:'present'}});
    const snapshot=structuredClone(raw),finish=()=>send(200,{sheet:{draft:snapshot,status:'draft',sheet_id:sheetId,updated_at:null}});
    if(mode==='hold-load'||mode==='late-auth'){pending.push(()=>mode==='late-auth'?send(401,{error:'synthetic_old_auth_error'}):finish());return;}if(mode==='failed-load')return send(503,{error:'synthetic_load_unavailable'});return finish();
   }
   let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);assert.equal(body.op,'save_draft');assert.equal(body.replica_id,rid);posts.push(body);
   const finish=()=>{raw=structuredClone(body.draft);if(mode==='lost-save')return send(503,{error:'synthetic_saved_response_lost'});send(200,{sheet:{draft:raw,status:'draft',sheet_id:sheetId,updated_at:null}});};if(mode==='hold-save'){pending.push(finish);return;}return finish();
  }
  const asset=assets.get(url.pathname);if(asset!==undefined){res.writeHead(200,{'content-type':extname(url.pathname)==='.html'?'text/html':extname(url.pathname)==='.css'?'text/css':'text/javascript'});res.end(asset);return;}res.writeHead(404).end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await launchSuiteBrowser("teacher-sheet-edit-races");
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();await observeBrowser(context);page.setDefaultTimeout(boundedWaitMs(12000));page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const open=async(lane,legacy=false,value=initial,hi=false)=>{assert.equal(pending.length,0);raw=structuredClone(value);mode='normal';posts=[];gets=[];published=false;await page.goto(`${origin}/evals/teacher-sheet-edit-races/host.html?${lane==='studio'?'studio=1&':''}${legacy?'old=1&':''}${hi?'hi=1':''}`);await page.locator('#teacher-sheet-studio').waitFor();};
  const load=()=>page.locator('.section-heading button'),save=()=>page.locator('.person-model-action button');
  const settle=async()=>{assert.equal(pending.length,1);pending.shift()();await page.waitForFunction(()=>!document.querySelector('.section-heading button')?.disabled&&!document.querySelector('.person-model-action button')?.disabled);};
  const saveNow=async()=>{await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),save().click()]);await page.waitForFunction(()=>!document.querySelector('.person-model-action button').disabled);};
  const loadNow=async()=>{await Promise.all([page.waitForResponse(r=>r.request().method()==='GET'&&!new URL(r.url()).searchParams.has('op')),load().click()]);await page.waitForFunction(()=>!document.querySelector('.section-heading button').disabled);};
  for(const lane of ['creator','studio']){
   // Each old behavior executes in the actual preserved component before its corresponding new assertion.
   for(const legacy of [true,false]){
    await open(lane,legacy);mode='hold-load';await load().click();await until(()=>pending.length===1);await page.locator('#syllabus-scope').fill('Newer owner edit B');if(!legacy){assert(await save().isDisabled());assert.equal(await page.locator('#teacher-sheet-studio').getAttribute('aria-busy'),'true');}
    await settle();assert.equal(await page.locator('#syllabus-scope').inputValue(),legacy?'Saved scope A':'Newer owner edit B');assert.equal(posts.length,0);
    if(!legacy){await page.getByText('Your newer edits were kept. The saved draft was not loaded.',{exact:true}).waitFor();mode='normal';await saveNow();assert.deepEqual(posts[0].draft,{...initial,syllabusScope:'Newer owner edit B'});}
    check(`${width}/${lane}/${legacy?'old negative':'current'}: held GET versus scalar edit`);
   }
   const malformed={...initial,subjectStrands:'malformed chapters',doubtEscalationLadder:[null]};
   for(const legacy of [true,false]){
    await open(lane,legacy,malformed);mode='hold-load';await load().click();await until(()=>pending.length===1);await page.getByRole('button',{name:'Replace chapter list',exact:true}).click();await page.getByRole('button',{name:'Replace doubt steps',exact:true}).click();assert(await page.locator('.create-row input').evaluate(el=>el===document.activeElement));await settle();
    assert.equal(await page.getByRole('button',{name:'Replace chapter list',exact:true}).count(),legacy?1:0);assert.equal(await page.locator('.create-row input').isDisabled(),legacy);mode='normal';await saveNow();assert.deepEqual(posts[0].draft,legacy?malformed:{...malformed,subjectStrands:[],doubtEscalationLadder:[]});check(`${width}/${lane}/${legacy?'old negative':'current'}: held GET versus explicit malformed-list replacements preserves hidden raw values`);
   }
   await open(lane);mode='hold-save';await save().evaluate(el=>{el.click();el.click();});await until(()=>pending.length===1);assert.equal(posts.length,1);assert(await load().isDisabled());await page.locator('#syllabus-scope').fill('Newer edit after POST');await settle();await page.getByText('Earlier edits saved. Your newer edits still need saving.',{exact:true}).waitFor();assert.equal(raw.syllabusScope,initial.syllabusScope);assert.equal(await page.locator('#syllabus-scope').inputValue(),'Newer edit after POST');mode='normal';await saveNow();assert.equal(raw.syllabusScope,'Newer edit after POST');await page.locator('#syllabus-scope').fill('Another unsaved edit');assert.equal(await page.getByText('Sheet draft saved.',{exact:true}).count(),0);check(`${width}/${lane}: save revision notice, no duplicate POST and mutually exclusive load`);
   await open(lane);await page.locator('#syllabus-scope').fill('Committed but response lost');mode='lost-save';await saveNow();await page.getByText('Saving could not be confirmed. Your edits remain here. Load the saved draft to check.',{exact:true}).waitFor();assert.equal(posts.length,1);assert.equal(raw.syllabusScope,'Committed but response lost');mode='normal';await loadNow();assert.equal(await page.locator('#syllabus-scope').inputValue(),'Committed but response lost');assert.equal(posts.length,1);check(`${width}/${lane}: uncertain save recovered by explicit GET without retry`);
   for(const kind of ['normal','ignored','failed-load']){
    await open(lane);published=true;await page.locator('.teacher-sheet-publication button').click();await page.locator('.teacher-sheet-publication a').waitFor();const before=gets.filter(r=>r.url.includes('publication_review')).length;
    mode=kind==='failed-load'?'failed-load':'hold-load';if(kind==='failed-load')await loadNow();else{await load().click();await until(()=>pending.length===1);assert.equal(await page.locator('.teacher-sheet-publication a').count(),0);if(kind==='ignored'){await page.locator('#syllabus-scope').fill('Temporary edit');await page.locator('#syllabus-scope').fill(initial.syllabusScope);}await settle();}
    await page.locator('.teacher-sheet-publication button').waitFor();assert.equal(await page.locator('.teacher-sheet-publication a').count(),0);assert.equal(gets.filter(r=>r.url.includes('publication_review')).length,before);assert.equal(posts.length,0);check(`${width}/${lane}: ${kind} same-JSON load still invalidates publication without automatic review`);
   }
   for(const kind of ['token','replica','hide']){
    await open(lane);mode='late-auth';await load().click();await until(()=>pending.length===1);await page.locator('#syllabus-scope').fill('Current editing survives');await page.evaluate(kind=>window.editorRaceProbe[kind](),kind);pending.shift()();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>Boolean(window.editorRaceAuthError)),false);if(kind==='token')assert.equal(await page.locator('#syllabus-scope').inputValue(),'Current editing survives');if(kind==='replica')assert.equal(await page.locator('#syllabus-scope').inputValue(),initial.syllabusScope);if(kind==='hide')assert.equal(await page.locator('#teacher-sheet-studio').count(),0);check(`${width}/${lane}: late old auth error after ${kind} cannot change current editor or invoke callback`);
   }
   await open(lane);await page.locator('.teacher-sheet-ingested summary').focus();await page.keyboard.press('Space');const before=[gets.length,posts.length];await page.locator('.teacher-sheet-ingested summary').focus();await page.keyboard.press('Enter');assert.deepEqual([gets.length,posts.length],before);await page.screenshot({path:join(art,`${width}-${lane}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);check(`${width}/${lane}: native disclosure keyboard and viewport remain intact`);
  }
  await open('creator',false,initial,true);mode='hold-load';await load().click();await until(()=>pending.length===1);await page.locator('#syllabus-scope').fill('नए बदलाव');await settle();await page.getByText('आपके नए बदलाव रखे गए हैं। सहेजा हुआ ड्राफ्ट लोड नहीं किया गया।',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);check(`${width}: Hindi newer-edit status fits`);
  await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(art,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,oldHashes:old.hashes,sourceHashes:Object.fromEntries(['src/studio/TeacherSheetStudio.tsx','src/creatorStudio/TeacherSheetStudio.tsx','src/creatorStudio/copy.ts','src/creatorStudio/hiCopy.ts'].map(f=>[f,createHash('sha256').update(readFileSync(join(root,f))).digest('hex')])),scope:'Actual mounted editors, native controls and API clients; synthetic HTTP only, no full Studio shell/SQL/provider or publication permission acceptance.'},null,2));console.log(`PASS ${checks.length} groups; ${art}`);
}catch(e){await recordBrowserFailure(browser,art);writeFileSync(join(art,'failure.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,error:String(e.stack||e)},null,2));throw e;}finally{await browser?.close();for(const done of pending)done();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));}
