import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url)),base='684441e14dcbb0fac904fea3c8d104412848ab98';
const oldBytes=readFileSync(new URL('./fixtures/CloneExperience.before.tsx.txt',import.meta.url));
const old=oldBytes.toString('utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(oldBytes),'b7fb64ac4965ba7af81ec4acff5cc9c7f42b052a0cb1f6d3f3297c0c7b5ddb8e','canonical historical caller fixture changed');
const names=['src/studio/CloneExperience.tsx','src/studio/CloneVerificationJourney.tsx','src/studio/clone-verification-journey.css'];
const hashes=Object.fromEntries(names.map(p=>[p,sha(readFileSync(join(root,p)))]));
const current=readFileSync(join(root,names[0]),'utf8');
assert(!old.includes('exitLabel="Back to knowledge"'));assert(current.includes('onExit={() => { setEnrichView("menu"); chooseRoom("enrich"); }} exitLabel="Back to knowledge"'));
const normalize=s=>s.replaceAll('\r\n','\n');
// The historical caller remains immutable. Permit only the separately reviewed
// owner identity plumbing added for comparison preparation, not arbitrary drift.
const ownerPlumbing=[
 ['  ownerUserId?: string;\n',''],
 ['    accountScope, ownerUserId, workspaceReadState','    accountScope, workspaceReadState'],
 ['<CloneVerificationJourney ownerUserId={ownerUserId} token=','<CloneVerificationJourney token='],
];
let navigationBaseline=normalize(current);
for(const [before,after]of ownerPlumbing){assert.equal(navigationBaseline.split(before).length-1,1,'exact reviewed owner plumbing occurs once');navigationBaseline=navigationBaseline.replace(before,after);}
assert.equal(navigationBaseline.replace(' onExit={() => { setEnrichView("menu"); chooseRoom("enrich"); }} exitLabel="Back to knowledge"',''),normalize(old),'actual caller has only navigation and reviewed owner plumbing deltas');
if(process.argv.includes('--source-only')){console.log(JSON.stringify({sourceOnly:true,hashes,oldHash:sha(old),callerDeltas:['knowledge-navigation','reviewed-owner-identity-plumbing']}));process.exit(0);}
const {build}=await import('vite');
const {chromium}=await import('playwright');
const {statements}=await import('../first-use-private-flow/fixture.mjs');
const out=join(root,'scratchpad/verification-knowledge',String(Date.now()));mkdirSync(out,{recursive:true});
let server,browser;const errors=[],requests=[],checks=[],unexpectedRoutes=[];
try{
 const built=await build({root,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:true,rolldownOptions:{input:join(root,'evals/verification-knowledge/host.tsx'),output:{entryFileNames:'probe.js',chunkFileNames:'[name]-[hash].js',assetFileNames:'[name]-[hash][extname]'}}},plugins:[{name:'retained-old-caller',resolveId(id){if(id==='virtual:journey-before')return '\0old-journey.tsx';},load(id){if(id==='\0old-journey.tsx')return old.replace(/(from\s*|import\s*|import\()(["'])(\.\/[^"']+)\2/g,(_m,p,q,s)=>p+q+join(root,'src/studio',s).replaceAll('\\','/')+q);}}]});
 const assets=new Map(built.output.map(i=>['/'+i.fileName,i.type==='chunk'?i.code:i.source]));
 const rid='10000000-0000-4000-8000-000000000001';
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname.startsWith('/api/')){let body='';for await(const c of req)body+=c;requests.push({path:url.pathname,method:req.method,body});
   if(req.method!=='GET')return send(500,{error:'fixture_no_mutation'});
   if(url.pathname==='/api/replica-activity')return send(200,{replica_id:rid,generated_at:'2026-09-01',jobs:[],lanes:[],in_flight:false,next_poll_ms:null});
   if(url.pathname==='/api/replica-text-rehearsal')return send(200,{readiness:{replica_id:rid,state:'unavailable',can_ask:false,blockers:[{code:'private_text_encryption_unavailable',responsibility:'platform'}],drafts:[],context_items:[],selected:null,statement_set:'private-text-rehearsal/v1',grant_scope:'private_text_rehearsal',statements}});
   if(url.pathname==='/api/replica-text-publication')return send(200,{readiness:{replica_id:rid,state:'unavailable',can_publish:false,blockers:[{code:'text_publication_platform_unavailable',responsibility:'platform'}],drafts:[],context_items:[],selected:null,statement_set:'account-material-publication/v1',statements:[],publications:[]}});
   unexpectedRoutes.push(url.pathname);return send(500,{error:'unexpected_fixture_route'});
  }
  if(assets.has(url.pathname)){res.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'application/octet-stream'});return res.end(assets.get(url.pathname));}
  if(url.pathname.startsWith('/fonts/')){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@layer reset,tokens,base,components,responsive;</style>'+[...assets.keys()].filter(k=>k.endsWith('.css')).map(k=>`<link rel="stylesheet" href="${k}">`).join('')+'</head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
 for(const width of [396,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const check=async(name,fn)=>{await fn();checks.push({width,name});console.log('ok '+checks.length+' - '+width+' '+name);};
  const open=async(scenario,extra='')=>{await page.goto(`${origin}/?replica=${rid}&step=meet&view=voice&lang=hi&case=${scenario}${extra}`);await page.waitForFunction(()=>window.journeyProbe?.builds.length===1);await page.locator('.cvj-shell').waitFor();};
  const exit=()=>page.getByRole('button',{name:'Back to knowledge',exact:true});
  const state=()=>page.evaluate(()=>({saga:localStorage.getItem('vyakti:experience:voice-saga:v1:10000000-0000-4000-8000-000000000001'),builds:window.journeyProbe.builds,mutations:window.journeyProbe.mutations,auth:window.journeyProbe.authErrors}));
  await check('old actual caller traps pending verification without knowledge navigation',async()=>{await open('pending','&old=1');assert.equal(await exit().count(),0);assert.equal(await page.getByRole('navigation',{name:'Clone rooms'}).count(),0);assert.equal(await page.locator('.cvj-shell').getAttribute('data-stage'),'source_processing');});
  for(const scenario of ['pending','unavailable']){
   await open(scenario);const before=await state(),expected=scenario==='pending'?'source_processing':'liveness';
   if(scenario==='unavailable')await page.getByText('Live verification is unavailable',{exact:true}).waitFor();
   await check(scenario+' visible keyboard navigation preserves exact source/intent/locale without mutation',async()=>{const box=await exit().boundingBox();assert(box&&box.height>=44&&box.y>=0&&box.y+box.height<=900);await exit().focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Add more of you.'}).waitFor();assert.equal(new URL(page.url()).searchParams.get('replica'),rid);assert.equal(new URL(page.url()).searchParams.get('lang'),'hi');assert.equal(new URL(page.url()).searchParams.get('view'),'enrich');assert.deepEqual(await state(),before);await page.waitForFunction(()=>document.activeElement?.textContent==='Add more of you.');});
   if(scenario==='pending'){
    await check('existing private test stays unavailable with no ask or publication dispatched',async()=>{await page.getByRole('button',{name:/Test a private draft/}).click();await page.getByRole('heading',{name:'Test your private draft.'}).waitFor();await page.getByText('Waiting on us:',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);assert(await page.getByRole('button',{name:'Ask privately',exact:true}).isDisabled());await page.getByRole('button',{name:'Back to your workspace',exact:true}).click();await page.getByRole('heading',{name:'Add more of you.'}).waitFor();assert.deepEqual(await state(),before);});
    await check('existing share review remains blocked and explicit; no automatic publish',async()=>{await page.getByRole('button',{name:/Share your knowledge/}).click();await page.getByRole('heading',{name:'Share your knowledge',exact:true}).waitFor();await page.getByText('Sharing is waiting on our platform.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Publish link',exact:true}).count(),0);await page.getByRole('button',{name:'Back to knowledge',exact:true}).click();await page.getByRole('heading',{name:'Add more of you.'}).waitFor();assert.deepEqual(await state(),before);});
   }
   await check(scenario+' return and reload resume unchanged verification, with no reset or fabricated readiness',async()=>{await page.getByRole('button',{name:'Back to voice',exact:true}).click();await page.locator('.cvj-shell').waitFor();assert.equal(await page.locator('.cvj-shell').getAttribute('data-stage'),expected);assert.deepEqual(await state(),before);const params=new URL(page.url());params.searchParams.set('reload','1');await page.goto(params.href);await page.waitForFunction(()=>window.journeyProbe?.builds.length===1);await page.locator('.cvj-shell').waitFor();assert.equal(await page.locator('.cvj-shell').getAttribute('data-stage'),expected);assert.deepEqual(await state(),before);assert.equal(await page.getByRole('navigation',{name:'Clone rooms'}).count(),0);if(scenario==='unavailable')await page.getByText('Live verification is unavailable',{exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,`${scenario}-${width}.png`)});});
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRoutes,[]);assert(requests.every(r=>r.method==='GET'));writeFileSync(join(out,'result.json'),JSON.stringify({base,hashes,checks,passed:checks.length,errors,requests,real_auth:false,provider_calls:0},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,artifact:join(out,'result.json')}));
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
