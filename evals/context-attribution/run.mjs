// Actual component/API client and HTTP requests; synthetic loopback responses.
// No actual SQL, model, identity or source-attribution authority claim.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url)),art=join(root,'scratchpad/context-attribution',String(Date.now()));mkdirSync(art,{recursive:true});
const RID='10000000-0000-4000-8000-000000000001',OTHER='20000000-0000-4000-8000-000000000001',ITEM='30000000-0000-4000-8000-000000000001';
const item=(overrides={})=>({item_id:ITEM,kind:'file',format:'text',source_name:'My saved lesson.txt',source_url:'',byte_size:200,extracted_chars:200,extractor:'plain-text/v1',status:'extracted',refusal_reason:'',routed_to:'',mine_skip_reason:'not_owner_authored_no_style_evidence',authorship:'unknown',owner_speaker:'',consent_scope:'own_context',proposal:null,created_at:null,updated_at:null,...overrides});
const view=items=>({items,quota:{items:items.length,bytes:200,max_items:100,max_bytes:1e7},limits:{max_item_bytes:1e6,accepted_file_formats:['text','markdown','pdf','docx'],routed_elsewhere:{}}});
let rows=[item()],posts=[],gets=[],held=[],holdPost=false,holdGet=false,postMode='normal',browser,server;const checks=[],errors=[];
const until=async predicate=>{const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw Error('fixture state deadline');await new Promise(r=>setTimeout(r,10));}};
const old=execFileSync('git',['show','c56cadfe:src/studio/ContextLockerPanel.tsx'],{cwd:root,encoding:'utf8'});
try{
 const built=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:join(root,'evals/context-attribution/host.html')}},plugins:[{name:'old-component-control',resolveId(id){if(id==='virtual:old-context-locker')return '\0old-context.tsx';},load(id){if(id==='\0old-context.tsx')return old.replace(/(from\s*|import\s*|import\()(["'])(\.\/[^"']+)\2/g,(_,prefix,quote,p)=>prefix+quote+join(root,'src/studio',p).replaceAll('\\','/')+quote);}}]});
 const assets=new Map(built.output.map(x=>['/'+x.fileName,x.type==='chunk'?x.code:x.source]));
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');
  const send=(code,data)=>{if(!res.destroyed){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}};
  if(url.pathname==='/api/context-items'){
   if(req.method==='GET'){
    const rid=url.searchParams.get('replica_id');gets.push({rid,authorization:req.headers.authorization});
    const snapshot=view(rid===OTHER?[item({item_id:OTHER,source_name:'Other replica.txt'})]:structuredClone(rows));
    if(holdGet)held.push(()=>send(200,snapshot));else send(200,snapshot);return;
   }
   let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);posts.push({body,authorization:req.headers.authorization});
   assert.equal(req.method,'POST');assert.equal(body.op,'remine');assert.equal(body.replica_id,RID);assert.equal(body.item_id,ITEM);
   assert.deepEqual(Object.keys(body).sort(),['authorship','item_id','op','replica_id']);
   const finish=()=>{if(postMode==='error'){send(503,{error:'synthetic_attribution_unavailable'});return;}if(postMode==='wrong-item'){send(200,{item:item({item_id:OTHER})});return;}
    rows=rows.map(r=>r.item_id===body.item_id?{...r,authorship:body.authorship,mine_skip_reason:body.authorship==='mine'?'no_candidates_cleared_held_out':'not_owner_authored_no_style_evidence'}:r);
    send(200,{item:rows.find(r=>r.item_id===body.item_id),proposal:{ok:true,proposed:0}});
   };if(holdPost)held.push(finish);else finish();return;
  }
  const asset=assets.get(url.pathname);if(asset!==undefined){res.writeHead(200,{'content-type':extname(url.pathname)==='.html'?'text/html':extname(url.pathname)==='.css'?'text/css':'text/javascript'});res.end(asset);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  res.writeHead(404).end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});
 const reset=()=>{rows=[item()];posts=[];gets=[];held=[];holdPost=false;holdGet=false;postMode='normal';};
 const check=(name)=>{checks.push(name);console.log('PASS '+name);};
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const open=async suffix=>{reset();await page.goto(origin+'/evals/context-attribution/host.html'+(suffix||''));await page.getByText('My saved lesson.txt',{exact:true}).waitFor();};
  const my=()=>page.getByRole('button',{name:'My writing',exact:true}),reference=()=>page.getByRole('button',{name:'Reference only',exact:true});
  await open('?old=1');assert.equal(await my().count(),0);assert.equal(posts.length,0);check(width+': exact incumbent restored row has no attribution action');
  await open();await page.reload();await my().waitFor();assert.equal(posts.length,0);assert.ok(gets.length>=2);check(width+': actual reload restores choice without implicit remine');
  await my().scrollIntoViewIfNeeded();await page.screenshot({path:join(art,`${width}-choice.png`)});
  await my().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="Writing attribution"] button')?.getAttribute('aria-pressed')==='true');
  assert.equal(posts.length,1);assert.equal(posts[0].body.authorship,'mine');assert.equal(posts[0].authorization,'Bearer synthetic-a');assert.equal(rows[0].authorship,'mine');assert.equal(await my().isDisabled(),true);assert.ok(gets.length>=3);assert.equal(await page.getByText(/nothing in it repeated often enough/).count(),1);check(width+': explicit keyboard action sends actual scoped request and authoritative refresh confirms own writing');
  await reference().focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelectorAll('[aria-label="Writing attribution"] button')[1]?.getAttribute('aria-pressed')==='true');assert.equal(posts.length,2);assert.equal(posts[1].body.authorship,'not_mine');check(width+': explicit reference-only action sends no grant or source text');
  await page.screenshot({path:join(art,`${width}-reference.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);check(width+': native controls wrap without horizontal overflow');
  await open();holdPost=true;await my().click();await page.waitForFunction(()=>document.querySelector('[aria-label="Writing attribution"] button')?.disabled);await until(()=>posts.length===1);await my().evaluate(el=>{el.click();el.click();});assert.equal(posts.length,1);const beforeGet=gets.length;await page.evaluate(()=>window.attributionProbe.switchReplica());await page.getByText('Other replica.txt',{exact:true}).waitFor();const beforeEvents=await page.evaluate(()=>window.attributionProbe.events.length);const oldResponse=page.waitForResponse(r=>r.request().method()==='POST');held.splice(0).forEach(f=>f());await oldResponse;assert.equal(await page.getByText('My saved lesson.txt',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.attributionProbe.events.length),beforeEvents);assert.ok(gets.slice(beforeGet).every(r=>r.rid===OTHER));check(width+': pending double action suppressed; old replica completion cannot update or refresh new scope');
  await open();holdPost=true;await my().click();await page.waitForFunction(()=>document.querySelector('[aria-label="Writing attribution"] button')?.disabled);await page.evaluate(()=>window.attributionProbe.hide());const closedEvents=await page.evaluate(()=>window.attributionProbe.events.length);const response=page.waitForResponse(r=>r.request().method()==='POST');held.splice(0).forEach(f=>f());await response;assert.equal(await page.evaluate(()=>window.attributionProbe.events.length),closedEvents);assert.equal(await my().count(),0);check(width+': late unmounted completion has no host callbacks');
  await open();postMode='wrong-item';await my().click();await page.getByRole('alert').waitFor();assert.equal(await my().getAttribute('aria-pressed'),'false');check(width+': mismatched response never confirms attribution');
  await open();postMode='error';await my().click();await page.getByRole('alert').waitFor();assert.equal(await my().getAttribute('aria-pressed'),'false');check(width+': failed request remains unconfirmed');
  reset();holdGet=true;await page.goto(origin+'/evals/context-attribution/host.html');await until(()=>held.length>=1);rows=[item({source_name:'New token note.txt'})];holdGet=false;await page.evaluate(()=>window.attributionProbe.switchToken());await page.getByText('New token note.txt',{exact:true}).waitFor();held.splice(0).forEach(f=>f());await page.waitForLoadState('networkidle');assert.equal(await page.getByText('My saved lesson.txt',{exact:true}).count(),0);assert.equal(posts.length,0);assert.equal(gets.at(-1).authorization,'Bearer synthetic-b');check(width+': delayed old list cannot replace a new authenticated token scope');
  reset();rows=[item({format:'image'}),item({item_id:OTHER,format:'whatsapp_export'}),item({item_id:RID,status:'refused'}),item({item_id:'40000000-0000-4000-8000-000000000001',kind:'link'}),item({item_id:'50000000-0000-4000-8000-000000000001',extracted_chars:0})];await page.goto(origin+'/evals/context-attribution/host.html');await page.getByRole('heading',{name:'In your locker'}).waitFor();await page.getByRole('button',{name:'Remove',exact:true}).first().waitFor();assert.equal(await my().count(),0);assert.equal(posts.length,0);check(width+': image chat refused link and empty rows have no attribution shortcut');
  reset();rows=['text','markdown','pdf','docx'].map((format,i)=>item({item_id:`${i+3}0000000-0000-4000-8000-000000000001`,format}));await page.goto(origin+'/evals/context-attribution/host.html');await page.getByRole('button',{name:'Remove',exact:true}).first().waitFor();assert.equal(await my().count(),4);assert.equal(posts.length,0);check(width+': all four supported persisted document formats expose an explicit choice');
  await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(join(art,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,scope:'Actual mounted component and API wrapper, synthetic localhost responses. No SQL/mining/model or rehearsal eligibility authority proof.'},null,2));console.log(`${checks.length} mounted attribution groups passed; ${art}`);
}catch(e){writeFileSync(join(art,'failure.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,error:String(e.stack||e)},null,2));throw e;}finally{await browser?.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));}
