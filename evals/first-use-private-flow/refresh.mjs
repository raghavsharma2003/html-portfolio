import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {build} from 'vite';
import {chromium} from 'playwright';
import {RID,OTHER,SHEET,ITEM,SOURCE,GRANT,TOKEN,OWNER,hash,statements} from './fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const artifact=join(root,'scratchpad/first-use-refresh-settlement',String(Date.now()));mkdirSync(artifact,{recursive:true});
const fixtureSource=readFileSync(join(root,'src/creatorStudio/layoutFixture.tsx'),'utf8');
const ast=ts.createSourceFile('fixture.tsx',fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['FIXTURE_REPLICA','ROUTES','ACTIVITY_LANES','LANE_LABELS','VOICE_DRAFT_REVIEW','SCENARIOS']);
const data=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.has(d.name.text))).map(n=>n.getText(ast)).join('\n');
const context={};runInNewContext(ts.transpileModule(data+'\nglobalThis.fixture={ROUTES,FIXTURE_REPLICA};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);const base=JSON.parse(JSON.stringify(context.fixture));
const remap=(v,rid)=>JSON.parse(JSON.stringify(v).replaceAll(base.FIXTURE_REPLICA.replica_id,rid));
const replica=rid=>({...remap(base.FIXTURE_REPLICA,rid),display_name:rid===RID?'Me':'Other clone',lifecycle:'consent_pending',age_verified:false,identity_verified:false,liveness_verified:false});
const grants=rid=>['capture','transcription','storage'].map(scope=>({consent_id:GRANT,replica_id:rid,scope,method:'account_attestation',policy_version:'replica-self-v1',granted_at:'2026-09-07T00:00:00Z',expires_at:'2027-09-07T00:00:00Z',revoked_at:null}));
const note='A pendulum completes 12 oscillations in 24 seconds. Its period is 2 seconds. Keep the amplitude small.';
const NEW='10000000-0000-4000-8000-000000000003';
const oldFunctions=JSON.parse(readFileSync(join(root,'evals/first-use-private-flow/fixtures/pending-refresh-old.json'),'utf8'));
const primary=rid=>({source_id:SOURCE,replica_id:rid,kind:'audio',purpose:'memory',mime:'audio/wav',byte_size:200,sha256:hash,object_key:'synthetic.wav',voice_role:'primary',state:'processing',contains_third_parties:false,rejection_code:'',created_at:'2026-09-07T00:00:00Z',updated_at:'2026-09-07T00:00:00Z'});
let owned=[],receipts=[],draft=null,item=null,requests=[],pending=[],scenario='',saved=new Map(),currentAssets,checks=[],focus=[],errors=[],surprises=[];
const itemView=()=>({item_id:ITEM,kind:'file',format:'text',source_name:'pendulum-notes.txt',source_url:'',byte_size:note.length,extracted_chars:note.length,extractor:'plain-text/v1',status:item?.authorship==='mine'?'mined':'extracted',refusal_reason:'',routed_to:'',mine_skip_reason:item?.authorship==='mine'?'no_candidates_cleared_held_out':'authorship_unknown',authorship:item?.authorship||'unknown',owner_speaker:'',consent_scope:'own_context',proposal:null,created_at:null,updated_at:null});
const ready=(url)=>{const selected=Boolean(draft&&item?.authorship==='mine'&&url.searchParams.get('sheet_id')===SHEET&&url.searchParams.get('context_item_id')===ITEM);return {replica_id:RID,state:selected?'ready':'needs_input',blockers:selected?[]:[{code:'rehearsal_selection_required',responsibility:'owner'}],drafts:draft?[{sheet_id:SHEET,name:draft.name,status:'draft',updated_at:null}]:[],context_items:item?[{item_id:ITEM,source_name:'pendulum-notes.txt',status:'mined',eligible:item.authorship==='mine'}]:[],selected:selected?{sheet_id:SHEET,sheet_hash:hash,context_item_id:ITEM,context_hash:hash,source_id:SOURCE,source_hash:hash,evidence_hash:hash,authority_epoch:'1',snapshot_hash:hash,material:{draft:{name:draft.name,identityWho:draft.identityWho,subjectDomain:draft.subjectDomain},context:{source_name:'pendulum-notes.txt',format:'text',body:note}}}:null,statement_set:'private-text-rehearsal/v1',statements,grant_scope:'private_text_rehearsal',can_ask:selected};};
const answer=body=>({replica_id:RID,request_id:body.request_id,state:'complete',answer:'The period is 2 seconds: 24 divided by 12.',consent:{consent_id:GRANT,receipt_hash:hash,statement_set:'private-text-rehearsal/v1',expires_at:'2026-10-07T00:00:00Z'},source:{sheet_id:SHEET,sheet_hash:hash,context_item_id:ITEM,source_id:SOURCE,source_hash:hash,evidence_hash:hash},billing_state:'settled',can_voice:false,created_at:'2026-09-07T00:00:00Z'});
const hashes=Object.fromEntries(['src/studio/StudioApp.tsx','src/studio/CloneExperience.tsx','src/studio/ContextLockerPanel.tsx','src/studio/PrivateTextRehearsal.tsx','evals/first-use-private-flow/fixtures/old-studio.tsx.txt','evals/first-use-private-flow/fixtures/old-experience.tsx.txt'].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
// Verify fixture statements against actual public scopes; no model, auth or SQL dependency imports.
assert.deepEqual(statements.map(s=>s.id),['authorize_private_text_question','understand_ai_text_only','understand_private_retention_and_withdrawal']);
assert(readFileSync(join(root,'api/_replica.js'),'utf8').includes("'consent_pending'"));
assert(readFileSync(join(root,'src/studio/enrollmentApi.ts'),'utf8').includes('return data.consents;'));
if(process.argv.includes('--source-only')){console.log('3 actual-contract source checks passed; mounted controls not run');process.exit(0);}
const countCreate=()=>requests.filter(r=>r.path==='/api/replica'&&r.op==='create').length;
let server,browser;
try{
 const assets={};
 for(const variant of ['old','current']){
  const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'studio.html')}},plugins:[{name:'retained-pending-refresh-negative',enforce:'pre',load(id){if(variant!=='old'||!id.replaceAll('\\','/').endsWith('/src/studio/StudioApp.tsx'))return;let code=readFileSync(id,'utf8');const tree=ts.createSourceFile('actual.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];function visit(n){const name=ts.isVariableDeclaration(n)?n.name.getText(tree):ts.isFunctionDeclaration(n)?n.name?.text:null;if(oldFunctions.functions[name])edits.push({start:n.getStart(tree),end:n.end,text:oldFunctions.functions[name]});ts.forEachChild(n,visit);}visit(tree);assert.equal(edits.length,3);for(const e of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,e.start)+e.text+code.slice(e.end);return code;}}]});
  assets[variant]=new Map(built.output.map(i=>['/'+i.fileName,i.type==='chunk'?i.code:i.source]));
 }
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
   if(url.pathname.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},rid=body.replica_id||url.searchParams.get('replica_id')||RID,op=body.op||url.searchParams.get('op');requests.push({path:url.pathname,method:req.method,op,body,rid,auth:req.headers.authorization});
    if(url.pathname==='/api/account'&&op==='refresh'){pending.push({kind:'refresh',send:()=>send(200,{user:{id:OWNER,email:'firstuse@fixture.test'},access_token:TOKEN+'-fresh',refresh_token:TOKEN,expires_in:3600})});return;}
    assert([`Bearer ${TOKEN}`,`Bearer ${TOKEN}-fresh`].includes(req.headers.authorization));
    if(url.pathname==='/api/replica'){
     if(op==='create'){assert(scenario.startsWith('create-'));assert.equal(countCreate(),1);pending.push({kind:'operation',send:()=>{if(scenario.endsWith('-error'))return send(401,{error:'old_token_rejected'});owned=[replica(NEW),...owned];send(201,{replica:{...replica(NEW),display_name:'Old-token replica'},creation_intent_id:body.creation_intent_id,replayed:false});}});return;}
     if(url.searchParams.has('replica_id')){if(scenario.startsWith('select-')&&rid===OTHER&&req.headers.authorization===`Bearer ${TOKEN}`){pending.push({kind:'operation',send:()=>send(scenario.endsWith('-error')?401:200,scenario.endsWith('-error')?{error:'old_token_rejected'}:{replica:{...replica(rid),display_name:'Old-token replica'}})});return;}return send(200,{replica:replica(rid)});}
     if(scenario.startsWith('list-')&&req.headers.authorization===`Bearer ${TOKEN}`){pending.push({kind:'operation',send:()=>send(scenario.endsWith('-error')?401:200,scenario.endsWith('-error')?{error:'old_token_rejected'}:{replicas:owned.map(r=>({...r,display_name:'Old-token replica'}))})});return;}
     return send(200,{replicas:owned});
    }
    if(url.pathname==='/api/replica-consent'){
     if(op==='grant'){assert.deepEqual(body.scopes,['capture','transcription','storage']);assert.deepEqual(body.attestations,{is_self:true,is_adult:true,has_source_rights:true,understands_synthetic_disclosure:true});if(scenario==='grant-failure')return send(503,{error:'fixture_consent_write_unconfirmed'});if(scenario==='grant-held'||scenario==='consent-held'){pending.push({kind:'grant',send:()=>{receipts=grants(rid);send(201,{consents:receipts});}});return;}receipts=grants(rid);return send(201,{consents:receipts});}
     if(op==='list'){const snapshot=receipts.filter(r=>r.replica_id===rid);if(scenario==='consent-held'){pending.push({kind:'consent',send:()=>send(200,{consents:snapshot})});return;}if(scenario==='consent-error')return send(503,{error:'fixture_consent_read_unavailable'});return send(200,{consents:snapshot});}
    }
    if(url.pathname==='/api/replica-source'&&op==='list')return send(200,{sources:[primary(rid)]});
    if(url.pathname==='/api/replica-liveness'&&op==='status')return send(200,{challenge:null});
    if(url.pathname==='/api/replica-runtime'){if(scenario==='consent-held'){pending.push({kind:'runtime',send:()=>send(200,{status:null,blockers:['identity_incomplete']})});return;}return send(200,{status:null,blockers:['identity_incomplete']});}
    if(url.pathname==='/api/replica-review')return send(200,{review:null});
    if(url.pathname==='/api/replica-activity')return send(200,{replica_id:rid,generated_at:'2026-09-07T00:00:00Z',jobs:[],lanes:[],in_flight:false,next_poll_ms:null});
    if(url.pathname==='/api/context-items'){
     if(op==='add_files'){assert.equal(body.files.length,1);assert.equal(body.files[0].authorship,undefined);assert.equal(Buffer.from(body.files[0].content_base64,'base64').toString(),note);item={authorship:'unknown'};return send(201,{results:[{item:itemView(),ok:true,proposed:0}]});}
     if(op==='remine'){assert.equal(body.item_id,ITEM);assert.equal(body.authorship,'mine');item={authorship:'mine'};return send(200,{item:itemView(),ok:true,proposed:0});}
     if(req.method==='GET')return send(200,{items:item?[itemView()]:[],quota:{items:item?1:0,bytes:item?note.length:0,max_items:100,max_bytes:1e7},limits:{max_item_bytes:1e6,accepted_file_formats:['text','markdown','pdf','docx'],routed_elsewhere:{}}});
    }
    if(url.pathname==='/api/teacher-sheet'){
     if(op==='save_draft'){assert.deepEqual(Object.keys(body.draft).sort(),['identityWho','name','subjectDomain']);draft=body.draft;return send(200,{sheet:{draft,sheet_id:SHEET,status:'draft',updated_at:'2026-09-07T00:00:00Z'}});}
     return send(200,{sheet:draft?{draft,sheet_id:SHEET,status:'draft',updated_at:null}:{draft:null,sheet_id:null,status:null,updated_at:null}});
    }
    if(url.pathname==='/api/replica-text-rehearsal'){
     if(op==='readiness')return send(200,{readiness:ready(url)});
     if(op==='ask'){assert.equal(body.sheet_id,SHEET);assert.equal(body.context_item_id,ITEM);assert.equal(body.expected_snapshot_hash,hash);assert.deepEqual(body.attestations,Object.fromEntries(statements.map(s=>[s.id,true])));assert.equal(new URL(req.headers.referer).searchParams.get('rehearsal_request'),body.request_id);const result=answer(body);saved.set(body.request_id,result);return send(201,{rehearsal:result});}
     if(op==='result')return send(200,{rehearsal:saved.get(url.searchParams.get('request_id'))});
    }
    if(url.pathname==='/api/account'&&op==='logout')return send(200,{ok:true});
    const routes=remap(base.ROUTES,rid);if(req.method==='GET'&&Object.hasOwn(routes,url.pathname))return send(200,routes[url.pathname]);
    if(['status','list','get','funnel_mark'].includes(op))return send(200,Object.hasOwn(routes,url.pathname)?routes[url.pathname]:{});
    surprises.push(`${req.method} ${url.pathname} ${op}`);return send(409,{error:'fixture_operation_refused'});
   }
   const path=url.pathname==='/studio'?'/studio.html':url.pathname;
   if(currentAssets.has(path)){res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});return res.end(currentAssets.get(path));}res.writeHead(404);res.end('missing');
  }catch(cause){errors.push('server:'+cause.message);res.writeHead(500);res.end('{"error":"fixture_assertion"}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,...(existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
 let page;
 const count=(path,op)=>requests.filter(r=>r.path===path&&r.op===op).length;
 const waitFor=async(predicate)=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert(predicate(),'bounded HTTP barrier');};
 const release=kind=>{const selected=pending.filter(p=>p.kind===kind);assert(selected.length,`held ${kind}`);pending=pending.filter(p=>p.kind!==kind);selected.forEach(p=>p.send());};
 const snapFocus=async(label)=>focus.push({label,...await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.slice(0,100),heading:document.querySelector('.vx-main h1,.vx-main h2')?.textContent}))});
 const open=async(variant,width,mode='',returning=false)=>{if(page)await page.context().close();scenario=mode;requests=[];pending=[];owned=[replica(RID),replica(OTHER)];receipts=[...grants(RID),...grants(OTHER)];draft=null;item=null;saved=new Map();currentAssets=assets[variant];const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.stack||e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.addInitScript(({TOKEN,OWNER})=>{window.__activityReads=0;const nativeFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const activity=String(args[0]).includes('/api/replica-activity');if(activity)window.__activityReads++;try{const response=await nativeFetch(...args);if(activity){const nativeJson=response.json.bind(response);response.json=async()=>{try{return await nativeJson();}finally{window.__activityReads--;}};}return response;}catch(error){if(activity)window.__activityReads--;throw error;}};localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:OWNER,accessToken:TOKEN,refreshToken:TOKEN,expiresAt:Date.now()+3600000,email:'firstuse@fixture.test'}}));},{TOKEN,OWNER});await page.goto(origin+'/studio');assert.equal(new URL(page.url()).searchParams.get('mode'),null);await waitFor(()=>requests.filter(r=>r.path==='/api/replica'&&r.method==='GET'&&r.rid===RID).length>=2);await page.waitForLoadState('networkidle');};
 const agree=async()=>{await page.getByRole('button',{name:'Select all',exact:true}).click();await page.getByRole('button',{name:'Agree and continue',exact:true}).click();};
 const check=async(name,fn)=>{await fn();checks.push(name);console.log(`ok ${checks.length} - ${name}`);};
 const drawerSelect=async id=>{const settled=!scenario.startsWith('select-');const response=settled?page.waitForResponse(r=>new URL(r.url()).pathname==='/api/replica'&&new URL(r.url()).searchParams.get('replica_id')===id):null;await page.getByRole('button',{name:'Open your clones',exact:true}).click();await page.locator('.vx-drawer__list button').filter({hasText:id===OTHER?'Other clone':'Me'}).click();if(response){await (await response).finished();await page.waitForFunction(id=>new URL(location.href).searchParams.get('replica')===id,id);await waitFor(()=>requests.filter(r=>r.path==='/api/replica'&&r.method==='GET'&&r.rid===id).length>=2);await page.waitForLoadState('networkidle');}};
 const backgroundRefresh=async()=>{const before=count('/api/account','refresh');await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+3600000;window.dispatchEvent(new Event('focus'));});await waitFor(()=>count('/api/account','refresh')>before&&pending.some(p=>p.kind==='refresh'));await page.waitForFunction(()=>window.__activityReads===0);release('refresh');await waitFor(()=>requests.some(r=>r.path==='/api/replica-source'&&r.auth===`Bearer ${TOKEN}-fresh`));await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});};
 for(const width of [390,1440])for(const method of ['create','list','select'])for(const variant of ['old','current'])await check(`${variant} ${width}: pending ${method} settles after actual readiness refresh`,async()=>{
  for(const outcome of ['success','error']){
   await open(variant,width);
   if(method==='list'){await drawerSelect(OTHER);await page.waitForLoadState('networkidle');scenario=method+'-'+outcome;await page.goBack({waitUntil:'commit'});}
   else if(method==='select'){scenario=method+'-'+outcome;await drawerSelect(OTHER);}
   else{await page.getByRole('button',{name:'Open your clones',exact:true}).click();await page.getByRole('button',{name:'Create another clone',exact:true}).click();scenario=method+'-'+outcome;await agree();}
   await waitFor(()=>pending.some(p=>p.kind==='operation'));
   assert.equal(count('/api/account','refresh'),0,'operation really began with the old unexpired token');
   await backgroundRefresh();
   const response=page.waitForResponse(r=>r.url().includes('/api/replica')&&r.request().headers().authorization===`Bearer ${TOKEN}`&&(method==='create'?r.request().method()==='POST':r.request().method()==='GET'));
   release('operation');await (await response).finished();await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
   assert.equal(await page.getByText('Old-token replica',{exact:true}).count(),0,'old payload is never adopted');
   assert.equal(count('/api/replica-consent','grant'),0,'read recovery never grants');
   if(variant==='old'){
    if(method==='create'){const button=page.getByRole('button',{name:'Opening your private space',exact:true});await button.waitFor();assert.equal(await button.isEnabled(),false,'old creating flag remains set after promise settlement');}
    else await page.getByRole('heading',{name:'Opening your workspace.',exact:true}).waitFor();
    await snapFocus(`old-${method}-${outcome}-${width}`);
   }else{
    await page.getByRole('heading',{name:'We could not load your workspace.',exact:true}).waitFor();scenario='';const retryResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/replica'&&!new URL(r.url()).searchParams.has('replica_id')&&r.request().headers().authorization===`Bearer ${TOKEN}-fresh`);await page.getByRole('button',{name:'Try again',exact:true}).click();await (await retryResponse).finished();await page.getByRole('heading',{name:'Opening your workspace.',exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Open your clones',exact:true}).click();await page.getByRole('button',{name:'Create another clone',exact:true}).click();await page.getByRole('button',{name:'Select all',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Agree and continue',exact:true}).isEnabled(),true,'own operation busy flag cleared; explicit new action remains unsent');
    await snapFocus(`current-${method}-${outcome}-${width}`);
   }
   assert.equal(countCreate(),method==='create'?1:0);assert.equal(count('/api/replica-consent','grant'),0);assert.equal(count('/api/replica-text-rehearsal','ask'),0);assert.equal(count('/api/account','logout'),0);
  }
 });
 assert.deepEqual(errors,[]);assert.deepEqual(surprises,[]);writeFileSync(join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks,focus,hashes,errors,surprises,scope:'Actual Studio entry and readiness focus-resume caller, synthetic localhost refresh and deferred create/list/select HTTP; no real auth/DB/model',oldFunctions,completed_at:new Date().toISOString()},null,2));console.log(JSON.stringify({passed:checks.length,artifact}));
}catch(error){writeFileSync(join(artifact,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,focus,hashes,errors,surprises,requests},null,2));throw error;}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
