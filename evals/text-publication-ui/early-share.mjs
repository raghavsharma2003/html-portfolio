import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
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
import {RID,SHEET,ITEM,SOURCE,GRANT,TOKEN,OWNER} from '../first-use-private-flow/fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const digest=s=>createHash('sha256').update(s).digest('hex');
const oldPath=join(root,'evals/text-publication-ui/early-share-old-clone.tsx.txt');
const oldSource=readFileSync(oldPath,'utf8');
assert.equal(digest(oldSource),'bb88a25d53210b1d9666b8db118c4b70fd4b70b1c1aac89e0dd373f6a1cf0674');
const statementSet='account-material-publication/v1';
const statements=[
 {id:'authorize_public_material',text:'Let signed-in adults receive AI text answers using this reviewed material and these teaching choices.'},
 {id:'confirm_material_rights',text:'I created this material and have permission to publish its contents. I reviewed it for private information.'},
 {id:'accept_public_ai_disclosure',text:'This publishes AI text from my account materials. It does not verify my identity or authorize voice, training or private relationship memory.'},
 {id:'accept_publication_terms',text:'I accept the displayed audience, term, question limits and budget. Visitors may copy answers. I can stop this link and erase stored content.'},
];
const terms={audience:'signed_in_adult_attestation',publication_days:30,retention_days:30,visitor_question_limit:20,total_question_limit:200,budget_microusd:100000,quota_policy:'admission_counts',memory:false,voice:false};
const fixtureSource=readFileSync(join(root,'src/creatorStudio/layoutFixture.tsx'),'utf8');
const ast=ts.createSourceFile('fixture.tsx',fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['FIXTURE_REPLICA','ROUTES','ACTIVITY_LANES','LANE_LABELS','VOICE_DRAFT_REVIEW','SCENARIOS']);
const declarations=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.has(d.name.text))).map(n=>n.getText(ast)).join('\n');
const context={};runInNewContext(ts.transpileModule(declarations+'\nglobalThis.fixture={ROUTES,FIXTURE_REPLICA};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const base=JSON.parse(JSON.stringify(context.fixture));
const remap=v=>JSON.parse(JSON.stringify(v).replaceAll(base.FIXTURE_REPLICA.replica_id,RID));
const profile={name:'Synthetic Physics Teacher',identityWho:'A synthetic teacher fixture.',subjectDomain:'physics',explanationOrder:'Known facts, then calculation'};
const note='Twelve oscillations take 24 seconds. The period is 2 seconds.';
const sourcePaths=['src/studio/main.tsx','src/studio/CloneExperience.tsx','src/studio/ExpertSharePanel.tsx','src/studio/publication/MaterialSharePanel.tsx','src/studio/publication/publicationApi.ts'];
const hashes=Object.fromEntries(sourcePaths.map(p=>[p,digest(readFileSync(join(root,p)))]));
for(const p of sourcePaths.filter(p=>p.endsWith('.tsx'))){const parsed=ts.createSourceFile(p,readFileSync(join(root,p),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(parsed.parseDiagnostics.length,0,p);}
const backend=join(root,'api/_text-publication-store.js');
if(existsSync(backend)){const source=readFileSync(backend,'utf8');for(const s of statements)assert(source.includes(`id:'${s.id}',text:'${s.text}'`),s.id);}
if(process.argv.includes('--source-only')){console.log(JSON.stringify({sourceOnly:true,hashes,oldHash:digest(oldSource),backendStatementSourceChecked:existsSync(backend),browserRun:false}));process.exit(0);}

const out=join(root,'scratchpad/text-publication-early-share',String(Date.now()));mkdirSync(out,{recursive:true});
let server,browser,page,currentAssets,lifecycle='consent_pending',hasConsent=true,holdReadiness=false,heldReadiness=[];
let requests=[],errors=[],surprises=[],checks=[],focus=[];
const replica=()=>({...remap(base.FIXTURE_REPLICA),display_name:'Synthetic Physics Teacher',lifecycle,age_verified:false,identity_verified:false,liveness_verified:false});
const grants=()=>hasConsent?['capture','transcription','storage'].map(scope=>({consent_id:GRANT,replica_id:RID,scope,method:'account_attestation',policy_version:'replica-self-v1',granted_at:'2026-09-07T00:00:00Z',expires_at:'2027-09-07T00:00:00Z',revoked_at:null})):[];
const item={item_id:ITEM,kind:'file',format:'text',source_name:'synthetic-pendulum.txt',source_url:'',byte_size:note.length,extracted_chars:note.length,extractor:'plain-text/v1',status:'mined',refusal_reason:'',routed_to:'',mine_skip_reason:'no_candidates_cleared_held_out',authorship:'mine',owner_speaker:'',consent_scope:'own_context',proposal:null,created_at:null,updated_at:null};
const readiness=url=>{const selected=url.searchParams.get('sheet_id')===SHEET&&url.searchParams.get('context_item_id')===ITEM;
 const permitted=hasConsent&&['draft','consent_pending','enrolling','calibrating','ready','active'].includes(lifecycle);
 return {replica_id:RID,state:!permitted?'unavailable':selected?'ready':'needs_input',blockers:!permitted?[{code:'text_publication_authority_unavailable',responsibility:'platform'}]:selected?[]:[{code:'text_publication_selection_required',responsibility:'owner'}],drafts:[{sheet_id:SHEET,name:profile.name,status:'draft',updated_at:'2026-09-07T00:00:00Z'}],context_items:[{item_id:ITEM,source_name:item.source_name,status:'mined',format:'text',authorship:'mine',source_id:SOURCE,source_ready:true,eligible:true,reason:null}],selected:permitted&&selected?{review_hash:'b'.repeat(64),source_name:item.source_name,projection:{name:profile.name,subjectDomain:profile.subjectDomain,explanationOrder:profile.explanationOrder},material_text:note,terms}:null,statement_set:statementSet,statements,can_publish:permitted&&selected,publications:[]};};
try{
 const assets={};
 for(const variant of ['old','current']){
  const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'studio.html')}},plugins:[{name:'retained-early-share-old-caller',enforce:'pre',load(id){if(variant==='old'&&id.replaceAll('\\','/').endsWith('/src/studio/CloneExperience.tsx'))return oldSource;}}]});
  assets[variant]=new Map(built.output.map(i=>['/'+i.fileName,i.type==='chunk'?i.code:i.source]));
 }
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
   if(url.pathname.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},op=body.op||url.searchParams.get('op');
    requests.push({path:url.pathname,method:req.method,op});assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);
    if(url.pathname==='/api/replica')return send(200,url.searchParams.has('replica_id')?{replica:replica()}:{replicas:[replica()]});
    if(url.pathname==='/api/replica-consent'&&op==='list')return send(200,{consents:grants()});
    if(url.pathname==='/api/replica-source'&&op==='list')return send(200,{sources:[]});
    if(url.pathname==='/api/replica-liveness'&&op==='status')return send(200,{challenge:null});
    if(url.pathname==='/api/replica-runtime')return send(200,{status:null,blockers:['identity_incomplete']});
    if(url.pathname==='/api/replica-review')return send(200,{review:null});
    if(url.pathname==='/api/replica-text-publication'&&op==='readiness'){
     const response={readiness:readiness(url)};
     if(holdReadiness){heldReadiness.push(()=>send(200,response));return;}
     return send(200,response);
    }
    if(url.pathname==='/api/context-items'&&req.method==='GET')return send(200,{items:[item],quota:{items:1,bytes:note.length,max_items:100,max_bytes:1e7},limits:{max_item_bytes:1e6,accepted_file_formats:['text','markdown','pdf','docx'],routed_elsewhere:{}}});
    if(url.pathname==='/api/teacher-sheet'&&req.method==='GET')return send(200,{sheet:{draft:profile,sheet_id:SHEET,status:'draft',updated_at:'2026-09-07T00:00:00Z'}});
    const routes=remap(base.ROUTES);
    if(req.method==='GET'&&Object.hasOwn(routes,url.pathname))return send(200,routes[url.pathname]);
    if(['status','list','get','funnel_mark'].includes(op))return send(200,Object.hasOwn(routes,url.pathname)?routes[url.pathname]:{});
    surprises.push(`${req.method} ${url.pathname} ${op}`);return send(409,{error:'fixture_operation_refused'});
   }
   const path=url.pathname==='/studio'?'/studio.html':url.pathname;
   if(currentAssets.has(path)){res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});return res.end(currentAssets.get(path));}
   res.writeHead(404);res.end('missing');
  }catch(error){errors.push('server:'+error.message);res.writeHead(500);res.end('{"error":"fixture_assertion"}');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await launchSuiteBrowser("text-publication-early-share-ui");
 const snap=async name=>focus.push({name,...await page.evaluate(()=>({activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id,activeText:document.activeElement?.textContent?.slice(0,120),heading:document.querySelector('.vx-main h1,.vx-main h2')?.textContent}))});
 const open=async(variant,width,{state='consent_pending',consent=true,view=''}={})=>{
  if(page)await page.context().close();currentAssets=assets[variant];lifecycle=state;hasConsent=consent;requests=[];holdReadiness=false;heldReadiness=[];
  const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});page=await ctx.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.addInitScript(({TOKEN,OWNER})=>{localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:OWNER,accessToken:TOKEN,refreshToken:TOKEN,expiresAt:Date.now()+3600000,email:'early-share@fixture.test'}}));},{TOKEN,OWNER});
  await page.goto(origin+'/studio'+(view?'?'+new URLSearchParams({replica:RID,view}):''));
 };
 const noMutation=()=>{assert.equal(requests.filter(r=>r.method==='POST'&&!['status','list','get','funnel_mark'].includes(r.op)).length,0,JSON.stringify(requests));};
 const noVoiceRooms=async()=>{assert.equal(await page.getByRole('navigation',{name:'Clone rooms'}).count(),0);assert.equal(await page.getByRole('heading',{name:'Talk with Synthetic Physics Teacher.'}).count(),0);};
 const check=async(name,run)=>{await run();assert.deepEqual(errors,[]);assert.deepEqual(surprises,[]);checks.push(name);console.log(`ok ${checks.length} - ${name}`);};
 for(const width of [390,1440]){
  await check(`${width} old actual caller: Knowledge has no text Share action`,async()=>{
   await open('old',width);await page.getByRole('button',{name:'Add knowledge first',exact:true}).click();await page.getByRole('heading',{name:'Add more of you.',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:/Share your knowledge/}).count(),0);noMutation();
  });
  await check(`${width} old actual caller: requested Share returns to recorder`,async()=>{
   await open('old',width,{view:'share'});await page.getByRole('button',{name:'Add knowledge first',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Share your knowledge',exact:true}).count(),0);noMutation();
  });
  await check(`${width} actual default shell: Knowledge to Share and back without voice`,async()=>{
   await open('current',width);await page.getByRole('button',{name:'Add knowledge first',exact:true}).click();await page.getByRole('button',{name:/Share your knowledge/}).click();
   await page.getByRole('heading',{name:'Share your knowledge',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'share');await page.waitForFunction(()=>document.activeElement===document.querySelector('.vx-expert-share h1'));await snap(`share-from-menu-${width}`);await noVoiceRooms();
   await page.getByRole('button',{name:'Back to knowledge',exact:true}).click();await page.getByRole('heading',{name:'Add more of you.',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.id==='knowledge-menu-title');await snap(`back-to-menu-${width}`);noMutation();
  });
  await check(`${width} Files to Share retains source and returns to Files`,async()=>{
   await page.getByRole('button',{name:/Files, images, links/}).click();await page.getByRole('heading',{name:'Bring your context',exact:true}).waitFor();
   await page.getByRole('button',{name:'Review text sharing',exact:true}).click();await page.getByRole('heading',{name:'Share your knowledge',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement===document.querySelector('.vx-expert-share h1'));await snap(`share-from-files-${width}`);
   await page.getByRole('button',{name:'Back to knowledge',exact:true}).click();await page.getByRole('heading',{name:'Bring your context',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.id==='context-locker-title');await snap(`back-to-files-${width}`);
   await page.getByText(item.source_name,{exact:true}).first().waitFor();noMutation();await noVoiceRooms();
  });
  await check(`${width} early lifecycle real four statement review grants no implicit publication`,async()=>{
   await page.getByRole('button',{name:'Review text sharing',exact:true}).click();await page.getByLabel('Teaching profile').selectOption(SHEET);await page.getByRole('combobox',{name:/^Material/}).selectOption(ITEM);
   await page.getByRole('heading',{name:'Review what you will share',exact:true}).waitFor();const publish=page.getByRole('button',{name:'Publish link',exact:true});assert(await publish.isDisabled());
   for(let i=0;i<statements.length;i++){await page.getByLabel(statements[i].text,{exact:true}).check();assert.equal(await publish.isEnabled(),i===statements.length-1);}
   assert.equal(lifecycle,'consent_pending');await noVoiceRooms();noMutation();await page.screenshot({path:join(out,`early-share-${width}.png`),fullPage:true});
  });
  await check(`${width} delayed readiness never steals focus after explicit navigation`,async()=>{
   await open('current',width);holdReadiness=true;await page.getByRole('button',{name:'Add knowledge first',exact:true}).click();await page.getByRole('button',{name:/Share your knowledge/}).click();
   await page.waitForFunction(()=>document.activeElement===document.querySelector('.vx-expert-share h1'));
   await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'Back to knowledge',exact:true}).evaluate(el=>el===document.activeElement),true);
   const deadline=Date.now()+5000;while(!heldReadiness.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert(heldReadiness.length,'actual readiness HTTP held');
   holdReadiness=false;heldReadiness.splice(0).forEach(send=>send());await page.getByLabel('Teaching profile').waitFor();
   assert.equal(await page.getByRole('button',{name:'Back to knowledge',exact:true}).evaluate(el=>el===document.activeElement),true);await snap(`readiness-does-not-steal-${width}`);noMutation();
  });
  await check(`${width} unverified voice and call routes remain behind recorder`,async()=>{
   for(const view of ['voice','call']){await open('current',width,{view});await page.getByRole('button',{name:'Add knowledge first',exact:true}).waitFor();await noVoiceRooms();noMutation();}
  });
  await check(`${width} stopped lifecycle readiness cannot publish`,async()=>{
   await open('current',width,{view:'share',state:'paused'});await page.getByRole('heading',{name:'Share your knowledge',exact:true}).waitFor();await page.getByText('Sharing is waiting on our platform. Your material stays private.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Publish link',exact:true}).count(),0);await noVoiceRooms();noMutation();
  });
  await check(`${width} absent account consent retains agreement gate`,async()=>{
   await open('current',width,{view:'share',consent:false});await page.getByRole('button',{name:'Agree and continue',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Share your knowledge',exact:true}).count(),0);noMutation();
  });
 }
 writeFileSync(join(out,'result.json'),JSON.stringify({completed_at:new Date().toISOString(),passed:checks.length,checks,focus,hashes,oldHash:digest(oldSource),errors,surprises,scope:'Actual default Studio entry and CloneExperience using synthetic localhost HTTP; no SQL, real auth, models, uploads, or identity verification. Actual menu/Share/Files focus and delayed-readiness non-theft asserted without manually focusing destination controls.'},null,2));
 console.log(JSON.stringify({passed:checks.length,out}));
}catch(error){
 const dom=page&&!page.isClosed()?await Promise.race([page.evaluate(()=>({text:document.querySelector('.vx-main')?.textContent?.slice(0,6000),labels:[...document.querySelectorAll('label')].map(l=>l.textContent),url:location.href})).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve({diagnostic:'timeout'}),3000))]):null;
 writeFileSync(join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),message:error.message,stack:error.stack,checks,focus,hashes,errors,surprises,requests,dom},null,2));throw error;
}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
