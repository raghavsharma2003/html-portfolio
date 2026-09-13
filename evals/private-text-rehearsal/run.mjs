import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {build} from 'vite';
import {chromium} from 'playwright';
import {boundedWaitMs} from '../lib/bounded-wait.mjs'; // WS-R181: scale the fixed Playwright action timeout by machine load
const root=fileURLToPath(new URL('../../',import.meta.url));
const RID='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000002';
const SHEET='20000000-0000-4000-8000-000000000001',ITEM='30000000-0000-4000-8000-000000000001',SOURCE='40000000-0000-4000-8000-000000000001',GRANT='50000000-0000-4000-8000-000000000001';
const TOKEN='private-text-fixture-token',OWNER='60000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const statements=[{id:'authorize_private_text_question',text:'I authorize this private text question using my selected draft and source.'},{id:'understand_ai_text_only',text:'I understand this is AI text only, without voice or public activation.'},{id:'understand_private_retention_and_withdrawal',text:'I understand this private test remains until removed; I can withdraw it.'}];
let draft={name:'Synthetic Physics Teacher',identityWho:'A physics teacher who explains using everyday examples',subjectDomain:'physics',teachingStyle:'short visual explanations'};
let scenario='ready', pending=[], requests=[], saved=new Map(), checks=[], surprises=[], publishedBefore=null, activeSheet=SHEET, draftStatus='draft';
const cancellation=(replica_id,request_id)=>({replica_id,request_id,state:'withdrawn',billing_state:'unknown',can_voice:false,created_at:'2026-09-07T00:00:00Z'});
const readiness=(rid=RID)=>({replica_id:rid,state:scenario==='unavailable'?'unavailable':scenario==='incomplete'?'needs_input':'ready',blockers:scenario==='unavailable'?[{code:'private_text_key_unavailable',responsibility:'platform'}]:scenario==='incomplete'?[{code:'draft_required_fields_missing',responsibility:'owner',field:'identityWho'}]:[],drafts:[{sheet_id:activeSheet,name:draft.name||'',updated_at:'2026-09-07T00:00:00Z',status:draftStatus}],context_items:[{item_id:ITEM,source_name:'pendulum-notes.txt',status:'extracted',eligible:true}],selected:scenario==='incomplete'?null:{sheet_id:activeSheet,sheet_hash:hash,context_item_id:ITEM,context_hash:hash,source_id:SOURCE,source_hash:hash,evidence_hash:hash,authority_epoch:"1",snapshot_hash:hash,material:{draft:{name:draft.name,identityWho:draft.identityWho,subjectDomain:draft.subjectDomain},context:{source_name:'pendulum-notes.txt',format:'text',body:'A pendulum completes 12 oscillations in 24 seconds. Its period is 2 seconds. Keep the amplitude small.'}}},statement_set:'private-text-rehearsal/v1',statements,grant_scope:'private_text_rehearsal',can_ask:!['unavailable','incomplete'].includes(scenario)});
const answer=(body,state='complete')=>({replica_id:body.replica_id,request_id:body.request_id,state,...(state==='complete'?{answer:'The period is 2 seconds: 24 seconds divided by 12 oscillations.'}:{}),consent:{consent_id:GRANT,receipt_hash:hash,statement_set:'private-text-rehearsal/v1',expires_at:'2026-10-07T00:00:00Z'},source:{sheet_id:SHEET,sheet_hash:hash,context_item_id:ITEM,source_id:SOURCE,source_hash:hash,evidence_hash:hash},billing_state:state==='uncertain'?'reconcile_required':'settled',can_voice:false,created_at:'2026-09-07T00:00:00Z'});
// Actual public client validators, with only the imported HTTP dependency replaced.
const apiSource=readFileSync(join(root,'src/studio/privateTextRehearsalApi.ts'),'utf8').replace('import { replicaRequest } from "./replicaApi";','const replicaRequest = async () => { throw new Error("network forbidden"); };');
const apiJs=ts.transpileModule(apiSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const api=await import('data:text/javascript;base64,'+Buffer.from(apiJs).toString('base64'));
assert.equal(api.validatePrivateTextReadiness(readiness(),RID).can_ask,true);
for(const mutate of [v=>v.replica_id=OTHER,v=>v.statements.pop(),v=>v.selected.material.context.body='x'.repeat(8001),v=>v.selected.snapshot_hash='bad',v=>v.blockers.push({code:'no',responsibility:'platform'})]){const value=structuredClone(readiness());mutate(value);assert.throws(()=>api.validatePrivateTextReadiness(value,RID));}
for(const mutate of [v=>v.can_voice=true,v=>v.request_id=ITEM,v=>v.answer='x'.repeat(4001),v=>v.state='blocked']){const value=answer({replica_id:RID,request_id:GRANT});mutate(value);assert.throws(()=>api.validatePrivateTextResult(value,RID,GRANT));}
const panelSource=readFileSync(join(root,'src/studio/PrivateTextRehearsal.tsx'),'utf8');
const panelAst=ts.createSourceFile('panel.tsx',panelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const persistenceFunctions=panelAst.statements.filter(node=>ts.isFunctionDeclaration(node)&&['savedRequest','persistRequest'].includes(node.name?.text)).map(node=>node.getText(panelAst)).join('\n');
const persistenceCode=ts.transpileModule('const REQUEST_PARAM="rehearsal_request";'+persistenceFunctions+';globalThis.persist=persistRequest;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const navigation={location:{pathname:'/studio',search:'?replica='+RID+'&lang=hi',hash:''},URLSearchParams,isPrivateTextId:api.isPrivateTextId,history:{state:null,replaceState(_state,_title,url){navigation.location.search=new URL(url,'http://fixture').search;}}};
runInNewContext(persistenceCode,navigation);navigation.persist(RID,GRANT);assert.equal(new URLSearchParams(navigation.location.search).get('rehearsal_request'),GRANT);assert.equal(new URLSearchParams(navigation.location.search).get('lang'),'hi');
navigation.history.replaceState=()=>{throw new Error('history unavailable');};assert.throws(()=>navigation.persist(RID,null),/No question was sent/);assert.equal(new URLSearchParams(navigation.location.search).get('rehearsal_request'),GRANT);
const partialChoices={...readiness(),drafts:[{sheet_id:SHEET,name:null,status:'draft',updated_at:null}],selected:null,state:'needs_input',can_ask:false,blockers:[{code:'rehearsal_draft_name_required',responsibility:'owner'}]};assert.equal(api.validatePrivateTextReadiness(partialChoices,RID).drafts[0].name,null);
console.log('11 pure public-response controls and2actual navigation persistence controls passed');
const cancelled=cancellation(RID,GRANT);
assert.equal(api.validatePrivateTextResult(cancelled,RID,GRANT).billing_state,'unknown');
for(const mutate of [v=>v.state='complete',v=>v.billing_state='not_started',v=>v.created_at='invalid',v=>v.answer='hidden output',v=>v.consent=answer({replica_id:RID,request_id:GRANT}).consent,v=>v.replica_id=OTHER]){const value=structuredClone(cancelled);mutate(value);assert.throws(()=>api.validatePrivateTextResult(value,RID,GRANT));}
for(const billing_state of ['unknown','reconcile_required'])assert.equal(api.validatePrivateTextWithdrawal({...cancelled,private_payload_erased:true,billing_state},RID,GRANT).billing_state,billing_state);
for(const mutate of [v=>delete v.billing_state,v=>v.private_payload_erased=false,v=>v.request_id=OTHER,v=>v.can_voice=true,v=>v.created_at='invalid']){const value={...cancelled,private_payload_erased:true};mutate(value);assert.throws(()=>api.validatePrivateTextWithdrawal(value,RID,GRANT));}
console.log('14 cancellation and preserved-billing response controls passed');
const priorApiSource=readFileSync(join(root,'evals/private-text-rehearsal/fixtures/prior-api.ts.txt'),'utf8').replace('import { replicaRequest } from "./replicaApi";','const replicaRequest = async () => { throw new Error("network forbidden"); };');
const priorApiJs=ts.transpileModule(priorApiSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const priorApi=await import('data:text/javascript;base64,'+Buffer.from(priorApiJs).toString('base64'));
assert.throws(()=>priorApi.validatePrivateTextResult(cancelled,RID,GRANT));
console.log('Retained client negative refuses the actual minimal cancellation envelope');
if(process.argv.includes('--source-only'))process.exit(0);
const fixtureSource=readFileSync(join(root,'src/creatorStudio/layoutFixture.tsx'),'utf8');
const ast=ts.createSourceFile('fixture.tsx',fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),names=new Set(['FIXTURE_REPLICA','ROUTES','ACTIVITY_LANES','LANE_LABELS','VOICE_DRAFT_REVIEW','SCENARIOS']);
const declarations=ast.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.has(d.name.text)));
const dataCode=ts.transpileModule(declarations.map(node=>node.getText(ast)).join('\n')+'\nglobalThis.fixture={ROUTES,FIXTURE_REPLICA};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const context={};runInNewContext(dataCode,context);const base=JSON.parse(JSON.stringify(context.fixture));
const remap=(value,rid)=>JSON.parse(JSON.stringify(value).replaceAll(base.FIXTURE_REPLICA.replica_id,rid));
const replica=rid=>({...remap(base.FIXTURE_REPLICA,rid),display_name:rid===RID?'Synthetic Physics Teacher':'Other Synthetic Teacher',lifecycle:'enrolling',age_verified:false,identity_verified:false,liveness_verified:false});
const grants=rid=>['capture','transcription','storage'].map(scope=>({consent_id:GRANT,replica_id:rid,scope,method:'account_attestation',policy_version:'replica-self-v1',granted_at:'2026-09-07T00:00:00Z',expires_at:'2027-09-07T00:00:00Z',revoked_at:null}));
const priorPanel=readFileSync(join(root,'evals/private-text-rehearsal/fixtures/prior-panel.tsx.txt'),'utf8');
// blob from commit da3ac2aeac29571ae45a4507d947b1cf603cf9c1, moved to a
// committed fixture (context/rejected.md#ci-shallow-checkout-starved-the-
// history-reading-suites).
const old=readFileSync(join(root,'evals/private-text-rehearsal/fixtures/da3ac2ae/src__studio__CloneExperience.tsx'),'utf8');
const artifact=join(root,'scratchpad/private-text-ui',String(Date.now()));mkdirSync(artifact,{recursive:true});
let browser,server;const errors=[];
try{
 const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:{studio:join(root,'studio.html'),scope:join(root,'evals/private-text-rehearsal/scope.html'),legacy:join(root,'evals/private-text-rehearsal/legacy.html')}}},plugins:[{name:'retained-base-component',resolveId(id){if(id==='virtual:prior-private-panel')return '\0prior-private-panel.tsx';if(id==='virtual:legacy-experience')return '\0legacy-experience.tsx';},load(id){if(id==='\0prior-private-panel.tsx')return priorPanel.replace(/(from\s*|import\s*|import\()(["'])(\.\/[^"']+)\2/g,(_all,prefix,quote,path)=>prefix+quote+join(root,'src/studio',path).replaceAll('\\','/')+quote);if(id==='\0legacy-experience.tsx')return old.replace(/(from\s*|import\s*|import\()(["'])(\.\/[^"']+)\2/g,(_all,prefix,quote,path)=>prefix+quote+join(root,'src/studio',path).replaceAll('\\','/')+quote);}}]});
 const assets=new Map(built.output.map(item=>['/'+item.fileName,item.type==='chunk'?item.code:item.source]));
 writeFileSync(join(artifact,'build.json'),JSON.stringify(built.output.map(item=>({file:item.fileName,sha256:createHash('sha256').update(item.type==='chunk'?item.code:item.source).digest('hex')})),null,2));
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},rid=url.searchParams.get('replica_id')||body.replica_id||RID,op=url.searchParams.get('op')||body.op;
   requests.push({path:url.pathname,op,method:req.method,body,auth:req.headers.authorization,referrer:req.headers.referer});
   if(url.pathname==='/api/replica-activity'&&req.headers.authorization==='Bearer offline')return send(200,remap(base.ROUTES['/api/replica-activity'],RID));
   if(![`Bearer ${TOKEN}`,'Bearer replacement-fixture-token'].includes(req.headers.authorization)){surprises.push('unexpected auth');return send(401,{error:'fixture_auth_required'});}
   if(url.pathname==='/api/replica-text-rehearsal'){
    if(op==='readiness'){const value={readiness:readiness(rid)};if(!url.searchParams.get('sheet_id')||!url.searchParams.get('context_item_id')){value.readiness.selected=null;value.readiness.can_ask=false;value.readiness.state='needs_input';value.readiness.blockers.push({code:'rehearsal_selection_required',responsibility:'owner'});}if(scenario==='late-readiness'){pending.push(()=>send(200,value));return;}return send(200,value);}
    if(op==='ask'){
     assert.equal(new URL(req.headers.referer).searchParams.get('rehearsal_request'),body.request_id,'opaque handle persisted before actual POST');
     assert.equal(body.statement_set,'private-text-rehearsal/v1');assert.deepEqual(body.attestations,Object.fromEntries(statements.map(s=>[s.id,true])));assert.equal(body.expected_snapshot_hash,hash);assert.equal(body.sheet_id,SHEET);assert.equal(body.context_item_id,ITEM);
     if(scenario==='before-admission')return send(503,{error:'rehearsal_admission_uncertain'});
     if(saved.get(body.request_id)?.state==='withdrawn')return send(200,{rehearsal:saved.get(body.request_id)});
     const result=answer(body,scenario==='uncertain'?'uncertain':'complete');saved.set(body.request_id,result);
     if(scenario==='late-ask'){pending.push(()=>send(201,{rehearsal:result}));return;}
     if(scenario==='uncertain')return send(503,{error:'rehearsal_provider_uncertain',request_id:body.request_id});
     return send(201,{rehearsal:result});
    }
    if(op==='result'){if(req.headers.authorization==='Bearer replacement-fixture-token')return send(404,{error:'rehearsal_not_found'});const result=saved.get(url.searchParams.get('request_id'));if(scenario==='late-result'){pending.push(()=>send(200,{rehearsal:result}));return;}return result?send(200,{rehearsal:result}):send(404,{error:'rehearsal_not_found'});}
    if(op==='withdraw'){
     const result=saved.get(body.request_id)||cancellation(rid,body.request_id);delete result.answer;result.state='withdrawn';saved.set(body.request_id,result);
     const value={replica_id:rid,request_id:body.request_id,state:'withdrawn',private_payload_erased:true,billing_state:result.billing_state,can_voice:false,created_at:result.created_at};
     if(scenario==='withdraw-lost')return send(503,{error:'rehearsal_withdrawal_unconfirmed'});
     if(scenario==='late-withdraw'){pending.push(()=>send(200,value));return;}
     return send(200,value);
    }
   }
   if(url.pathname==='/api/teacher-sheet'){if(op==='save_draft'){if(draftStatus==='published'){publishedBefore=structuredClone(draft);activeSheet='20000000-0000-4000-8000-000000000002';}draft=body.draft;draftStatus='draft';scenario='ready';}return send(200,{sheet:{draft,sheet_id:activeSheet,status:draftStatus,updated_at:'2026-09-07T00:00:00Z'}});}
   if(url.pathname==='/api/replica')return send(200,{replicas:[replica(RID),replica(OTHER)],replica:replica(rid)});
   if(url.pathname==='/api/replica-consent'&&op==='list')return send(200,{consents:grants(rid)});
   if(url.pathname==='/api/replica-source'&&op==='list')return send(200,{sources:[]});
   if(url.pathname==='/api/replica-liveness'&&op==='status')return send(200,{challenge:null});
   if(url.pathname==='/api/replica-runtime')return send(200,{status:null,blockers:['identity_incomplete']});
   if(url.pathname==='/api/replica-review')return send(200,{review:null});
   if(url.pathname==='/api/account'&&op==='logout')return send(200,{ok:true});
   const routes=remap(base.ROUTES,rid);
   if(req.method==='GET'&&Object.hasOwn(routes,url.pathname))return send(200,routes[url.pathname]);
   if(['status','list','get','funnel_mark'].includes(op))return send(200,Object.hasOwn(routes,url.pathname)?routes[url.pathname]:{});
   surprises.push(`${req.method} ${url.pathname} ${op}`);return send(409,{error:'fixture_operation_refused'});
  }
  const path=assets.has(url.pathname)?url.pathname:url.pathname==='/studio'?'/studio.html':url.pathname;
  if(assets.has(path)){res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});return res.end(assets.get(path));}
  const publicPath=resolve(root,'public','.'+url.pathname);if(publicPath.startsWith(resolve(root,'public')+'\\')&&existsSync(publicPath)){res.end(readFileSync(publicPath));return;}res.writeHead(404);res.end('missing');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await launchSuiteBrowser("private-text-rehearsal-ui");
 const page=await browser.newPage();page.setDefaultTimeout(boundedWaitMs(15000));page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.addInitScript(({TOKEN,OWNER})=>{localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:OWNER,accessToken:TOKEN,refreshToken:TOKEN,expiresAt:Date.now()+3600000,email:'private@fixture.test'}}));localStorage.setItem('vyakti.studio.mode.v1','replica');},{TOKEN,OWNER});
 const waitPending=async()=>{const end=Date.now()+5000;while(!pending.length&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));assert(pending.length,'bounded delayed request barrier');};
 const askCount=()=>requests.filter(r=>r.path==='/api/replica-text-rehearsal'&&r.op==='ask').length;
 const fill=async()=>{await page.locator('#ptr-question').fill('What is the period of this pendulum?');for(const box of await page.locator('.ptr-attestation input').all())await box.check();};
 // WS-R166 moved this menu row's own strings into the studio copy registry
 // (src/studio/copy.ts's EN_CLONE_EXPERIENCE_SHELL.rooms.enrich.testDraftTitle,
 // src/studio/hiCopy.ts's matching HI block); `open()` below always requests
 // `lang=hi`, so the REAL registry-driven button now renders the Hindi
 // string, not the English literal this suite was written against before the
 // conversion existed. The English text itself did not change (byte
 // identical to the pre-conversion default); the suite accepts either
 // locale's real string rather than pinning a language the fixture does not
 // actually request English for
 // (context/rejected.md#frozen-file-merge-controls-break-on-the-next-change).
 const testDraftButton=()=>page.getByRole('button',{name:/Test a private draft|एक निजी ड्राफ्ट टेस्ट करें/});
 const open=async(name='ready',full=false,extra='')=>{scenario=name;activeSheet=SHEET;draftStatus=name==='published'?'published':'draft';pending=[];requests=[];await page.goto(`${origin}${full?'/studio':'/evals/private-text-rehearsal/scope.html'}?mode=replica&replica=${RID}&view=${full?'enrich':'rehearsal'}&lang=hi${extra}`);if(full){await testDraftButton().waitFor();await testDraftButton().click();}await page.locator('#ptr-title').waitFor();if(!name.startsWith('late')&&name!=='incomplete'&&!extra.includes('rehearsal_request=')){await page.locator('.ptr-fields select').nth(0).selectOption(SHEET);await page.locator('.ptr-fields select').nth(1).locator(`option[value="${ITEM}"]`).waitFor({state:'attached'});await page.locator('.ptr-fields select').nth(1).selectOption(ITEM);await page.getByText('Review source: pendulum-notes.txt').waitFor();}};
 const check=async(name,fn)=>{await fn();checks.push(name);console.log(`ok ${checks.length} - ${name}`);};
 for(const width of [390,1440])await check(`actual modern entry ${width}: pre-identity draft, explicit ask, result and withdrawal`,async()=>{
  await page.setViewportSize({width,height:900});await open('ready',true);assert.equal(await page.locator('.vx-shell').count(),1);assert.equal(new URL(page.url()).searchParams.get('replica'),RID);assert.equal(new URL(page.url()).searchParams.get('lang'),'hi');
  assert(await page.getByRole('button',{name:'Ask privately',exact:true}).isDisabled());assert.equal(await page.locator('.ptr-attestation input:checked').count(),0);assert.equal(askCount(),0);
  await page.getByRole('button',{name:'Edit draft details'}).click();await page.getByLabel('Your name',{exact:true}).fill('Synthetic Physics Teacher Revised');await page.getByRole('button',{name:'Save private draft'}).click();await page.getByText('Review source: pendulum-notes.txt').waitFor();assert.equal(draft.teachingStyle,'short visual explanations');assert(!Object.hasOwn(draft,'consentArtifactId'));assert(!Object.hasOwn(draft,'agentId'));
  await fill();await page.screenshot({path:join(artifact,`ready-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Ask privately',exact:true}).click();await page.getByText('The period is 2 seconds:',{exact:false}).waitFor();assert.equal(askCount(),1);const id=new URL(page.url()).searchParams.get('rehearsal_request');assert(api.isPrivateTextId(id));assert(!page.url().includes('pendulum'));
  const stored=await page.evaluate(()=>Object.entries(localStorage).concat(Object.entries(sessionStorage)).map(([,value])=>value).join('\n'));assert(!stored.includes('What is the period'));assert(!stored.includes('The period is 2 seconds'));
  await page.screenshot({path:join(artifact,`answer-${width}.png`),fullPage:true});await page.reload();await page.getByText('The period is 2 seconds:',{exact:false}).waitFor();assert.equal(askCount(),1);
  await page.getByRole('button',{name:'Remove this private test'}).click();await page.getByRole('heading',{name:'Private test removed.'}).waitFor();assert.equal(await page.locator('.ptr-answer').count(),0);assert.equal(saved.get(id).answer,undefined);
 });
 await check('incomplete private draft saves only owner-entered required fields',async()=>{draft={name:"",identityWho:"",teachingStyle:"preserved owner manner"};await open('incomplete');assert(await page.getByRole('button',{name:'Ask privately',exact:true}).isDisabled());await page.getByRole('button',{name:'Edit draft details'}).click();await page.getByLabel('Your name',{exact:true}).fill('Synthetic Physics Teacher');await page.getByLabel('Who you are',{exact:true}).fill('A physics teacher using practical examples');await page.locator('.ptr-editor select[name=subjectDomain]').selectOption('physics');await page.getByRole('button',{name:'Save private draft'}).click();await page.locator('.ptr-fields select').nth(1).locator(`option[value="${ITEM}"]`).waitFor({state:'attached'});await page.locator('.ptr-fields select').nth(1).selectOption(ITEM);await page.getByText('Review source: pendulum-notes.txt').waitFor();assert.deepEqual(Object.keys(draft).sort(),['identityWho','name','subjectDomain','teachingStyle']);assert.equal(askCount(),0);});
 await check('source editor uses the actual owned Context Locker with exact clone and locale',async()=>{await open('ready',true);await page.getByRole('button',{name:'Add or edit source material'}).click();await page.locator('#context-locker-title').waitFor();assert.equal(new URL(page.url()).searchParams.get('replica'),RID);assert.equal(new URL(page.url()).searchParams.get('lang'),'hi');assert.equal(askCount(),0);});
 await check('actual old component exposes no pre-identity private text entry',async()=>{await page.goto(`${origin}/evals/private-text-rehearsal/legacy.html?legacy=1&view=enrich`);await page.getByRole('heading',{name:'Add more of you.'}).waitFor();assert.equal(await page.getByRole('button',{name:/Test a private draft/}).count(),0);});
 await check('platform readiness refusal cannot be checked into consent',async()=>{await open('unavailable');assert.match(await page.locator('.ptr-blockers').innerText(),/Waiting on us/);assert(await page.getByRole('button',{name:'Ask privately',exact:true}).isDisabled());assert(await page.locator('.ptr-attestation input').first().isDisabled());assert.equal(askCount(),0);});
 await check('changing a question clears all three explicit attestations',async()=>{await open();await fill();await page.locator('#ptr-question').fill('A different question');assert.equal(await page.locator('.ptr-attestation input:checked').count(),0);assert(await page.getByRole('button',{name:'Ask privately',exact:true}).isDisabled());});
 for(const kind of ['token','replica','stopped','unmount'])await check(`late ask after ${kind} never restores old answer`,async()=>{await open();await fill();scenario='late-ask';await page.getByRole('button',{name:'Ask privately',exact:true}).click();await page.waitForFunction(()=>new URL(location.href).searchParams.has('rehearsal_request'));await waitPending();await page.evaluate(kind=>kind==='unmount'?window.privateTextProbe.unmount():window.privateTextProbe.change(kind),kind);scenario='ready';pending.splice(0).forEach(release=>release());await page.waitForTimeout(100);assert.equal(await page.locator('.ptr-answer').count(),0);assert.equal(askCount(),1);});
 await check('uncertain POST survives reload by GET with zero automatic paid retries',async()=>{await open();await fill();scenario='uncertain';await page.getByRole('button',{name:'Ask privately',exact:true}).click();await page.getByText(/request may have started/).waitFor();assert.equal(askCount(),1);await page.reload();await page.getByText(/does not cancel incurred usage/).waitFor();assert.equal(askCount(),1);assert.equal(await page.getByRole('button',{name:'Prepare another question'}).count(),0);});
 await check('late original read cannot resurrect output after withdrawal',async()=>{const id='70000000-0000-4000-8000-000000000001';saved.set(id,answer({replica_id:RID,request_id:id}));await open('late-result',false,`&rehearsal_request=${id}`);await waitPending();await page.getByRole('button',{name:'Remove this private test'}).click();await page.getByRole('heading',{name:'Private test removed.'}).waitFor();pending.splice(0).forEach(release=>release());await page.waitForTimeout(80);assert.equal(await page.locator('.ptr-answer').count(),0);});
 await check('paused saved handle permits only owner-scoped withdrawal',async()=>{const id='70000000-0000-4000-8000-000000000002';saved.set(id,answer({replica_id:RID,request_id:id}));requests=[];scenario='ready';await page.goto(`${origin}/evals/private-text-rehearsal/scope.html?replica=${RID}&lifecycle=paused&rehearsal_request=${id}`);await page.getByRole('button',{name:'Remove saved test',exact:true}).click();await page.getByText(/saved test's private payload has been removed/).waitFor();assert.deepEqual(requests.filter(row=>row.path==='/api/replica-text-rehearsal').map(row=>row.op),['withdraw']);assert.equal(saved.get(id).answer,undefined);assert.equal(await page.locator('.ptr-answer').count(),0);});
 await check('pre-admission lost response requires confirmed cancellation before a fresh explicit ask',async()=>{
  await page.setViewportSize({width:390,height:900});await open();await fill();scenario='before-admission';await page.getByRole('button',{name:'Ask privately',exact:true}).click();await page.getByText(/request may have started/).waitFor();
  const oldId=new URL(page.url()).searchParams.get('rehearsal_request');assert(!saved.has(oldId));assert.equal(askCount(),1);
  await page.getByRole('button',{name:'Check saved result'}).click();await page.getByRole('button',{name:'Cancel this request',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Prepare another question'}).count(),0);
  await page.getByRole('button',{name:'Cancel this request',exact:true}).click();await page.getByRole('heading',{name:'Private test removed.'}).waitFor();assert.equal(saved.get(oldId).billing_state,'unknown');await page.getByText(/does not cancel incurred usage/).waitFor();
  await page.reload();await page.getByRole('button',{name:'Prepare another question'}).waitFor();assert.equal(askCount(),1);assert.equal(await page.locator('.ptr-answer').count(),0);
  await page.screenshot({path:join(artifact,'cancelled-390.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Prepare another question'}).click();assert.equal(askCount(),1);scenario='ready';await page.locator('.ptr-fields select').nth(0).selectOption(SHEET);await page.locator('.ptr-fields select').nth(1).selectOption(ITEM);await page.getByText('Review source: pendulum-notes.txt').waitFor();await fill();await page.getByRole('button',{name:'Ask privately',exact:true}).click();await page.locator('.ptr-answer').waitFor();assert.equal(askCount(),2);assert.notEqual(new URL(page.url()).searchParams.get('rehearsal_request'),oldId);
 });
 await check('uncertain cancellation keeps the handle until GET confirms minimal terminal state',async()=>{
  const id='70000000-0000-4000-8000-000000000010';await open('ready',false,`&rehearsal_request=${id}`);await page.getByRole('button',{name:'Cancel this request'}).waitFor();scenario='withdraw-lost';await page.getByRole('button',{name:'Cancel this request'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Prepare another question'}).count(),0);assert.equal(new URL(page.url()).searchParams.get('rehearsal_request'),id);
  await page.getByRole('button',{name:'Check saved result'}).click();await page.getByRole('button',{name:'Prepare another question'}).waitFor();assert.equal(askCount(),0);
 });
 await check('known uncertain usage survives withdrawal and reload without blocking an explicit new question',async()=>{
  const id='70000000-0000-4000-8000-000000000011';saved.set(id,answer({replica_id:RID,request_id:id},'uncertain'));await open('ready',false,`&rehearsal_request=${id}`);await page.getByText(/does not cancel incurred usage/).waitFor();await page.getByRole('button',{name:'Remove this private test'}).click();await page.getByRole('button',{name:'Prepare another question'}).waitFor();assert.equal(saved.get(id).billing_state,'reconcile_required');await page.reload();await page.getByRole('button',{name:'Prepare another question'}).waitFor();await page.getByText(/does not cancel incurred usage/).waitFor();assert.equal(askCount(),0);
 });
 await check('late cancellation after replica change does not restore prior request or usage',async()=>{
  const id='70000000-0000-4000-8000-000000000012';await open('ready',false,`&rehearsal_request=${id}`);await page.getByRole('button',{name:'Cancel this request'}).waitFor();scenario='late-withdraw';await page.getByRole('button',{name:'Cancel this request'}).click();await waitPending();await page.evaluate(()=>window.privateTextProbe.change('replica'));scenario='ready';pending.splice(0).forEach(release=>release());await page.locator('.ptr-fields').waitFor();assert.equal(await page.getByRole('heading',{name:'Private test removed.'}).count(),0);assert.equal(await page.getByText(/does not cancel incurred usage/).count(),0);assert.equal(askCount(),0);
 });
 await check('retained panel cannot resume a minimal cancelled result or edit a published-only sheet',async()=>{
  const id='70000000-0000-4000-8000-000000000013';saved.set(id,cancellation(RID,id));await open('ready',false,`&priorPanel=1&rehearsal_request=${id}`);await page.getByRole('heading',{name:'Private test removed.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Prepare another question'}).count(),0);
  await open('published',false,'&priorPanel=1');await page.getByRole('button',{name:'Edit draft details'}).click();await page.getByText(/Open its existing draft editor/).waitFor();assert.equal(await page.locator('.ptr-editor').count(),0);assert.equal(requests.filter(row=>row.op==='save_draft').length,0);
 });
 await check('published-only sheet creates an explicit private successor preserving loaded fields',async()=>{
  await page.setViewportSize({width:1440,height:900});draft={name:'Published teacher',identityWho:'A chemistry teacher',subjectDomain:'chemistry',teachingStyle:'Preserved owner manner',notationConventions:'Keep units visible',consentArtifactId:GRANT};const original=structuredClone(draft);await open('published');await page.getByRole('button',{name:'Edit draft details'}).click();await page.getByRole('heading',{name:'Create a private draft from this sheet'}).waitFor();await page.getByLabel('Your name',{exact:true}).fill('Private successor');await page.getByRole('button',{name:'Save private draft'}).click();await page.getByText('Review source: pendulum-notes.txt').waitFor();assert.deepEqual(publishedBefore,original);assert.equal(draft.notationConventions,original.notationConventions);assert.equal(draft.teachingStyle,original.teachingStyle);assert.equal(draft.name,'Private successor');assert.notEqual(activeSheet,SHEET);assert.equal(await page.locator('.ptr-fields select').nth(0).inputValue(),activeSheet);assert.deepEqual(requests.filter(row=>row.method==='POST').map(row=>row.op),['save_draft']);assert.equal(askCount(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(surprises,[]);
 writeFileSync(join(artifact,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,clientControls:25,persistenceControls:2,retainedClientNegative:1,errors,surprises,scope:'Actual built modern entry and actual panel; synthetic HTTP only; no DB/model/provider/identity grants. Cancellation persistence/serialization and successor SQL require separate actual-store proof.'},null,2));
 console.log(`PASS ${checks.length} mounted groups; artifact ${artifact}`);
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
