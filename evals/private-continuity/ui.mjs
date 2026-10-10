// Actual private source component, synthetic authenticated HTTP. No live data.
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
const entry=join(root,'__private_continuity_fixture__.tsx');
const rid='10000000-0000-4000-8000-000000000001',tid='20000000-0000-4000-8000-000000000002';
const result=await build({root,configFile:false,logLevel:'silent',build:{write:false,rolldownOptions:{input:entry,output:{entryFileNames:'fixture.js'}}},plugins:[{
 name:'private-continuity-fixture',resolveId(id){if(id===entry)return id;},load(id){if(id===entry)return `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Sources from './src/studio/PrivateConversationSources';import '@fontsource-variable/instrument-sans';
 function Fixture(){const[token,setToken]=useState('synthetic-owner');window.fixture={setToken};return <main><h1>Earlier conversations</h1><p>Synthetic fixture. No model or owner data.</p><Sources token={token} replicaId="${rid}" turnId="${tid}"/></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;}
}]});
const assets=new Map(result.output.map(item=>['/'+item.fileName,item.type==='chunk'?item.code:item.source]));
const css=[...assets.keys()].filter(path=>path.endsWith('.css')).map(path=>'<link rel="stylesheet" href="'+path+'">').join('');
let reads=0,mode='ready',held,heldReady;
const source={turn_id:tid,created_at:'2026-09-08T01:00:00Z',question:'कल pendulum वाला उदाहरण समझाया था।',reply:'We discussed its period, not its frequency.'};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/replica-dialogue'){
  assert(['Bearer synthetic-owner','Bearer synthetic-other'].includes(req.headers.authorization));let raw='';for await(const chunk of req)raw+=chunk;
  assert.deepEqual(JSON.parse(raw),{op:'continuity_sources',replica_id:rid,turn_id:tid});reads++;
  const finish=()=>{res.writeHead(mode==='error'?503:200,{'content-type':'application/json'});res.end(JSON.stringify(mode==='error'?{error:'synthetic_unavailable'}:{sources:[source]}));};
  if(mode==='held'){held=finish;heldReady?.();}else finish();return;
 }
 if(assets.has(url.pathname)){res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(url.pathname)]||'application/octet-stream');res.end(assets.get(url.pathname));return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html>'+css+'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f8f8f5;color:#253d31;font-family:"Instrument Sans Variable",sans-serif}main{padding:24px;max-width:720px;margin:auto}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const dir=join(root,'scratchpad/private-continuity-ui',String(Date.now()));mkdirSync(dir,{recursive:true});
let browser,page,error;const checks=[],errors=[];
try{
 browser=await launchSuiteBrowser("private-continuity-ui");
 for(const width of[390,1440]){
  page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  mode='ready';reads=0;await page.goto(origin);const summary=page.locator('summary');await summary.waitFor();assert.equal(reads,0);
  await summary.focus();await page.keyboard.press('Enter');await page.getByText(source.question,{exact:false}).waitFor();assert.equal(reads,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push(`${width}: private sources fetched only on keyboard-open, no overflow`);
  await page.screenshot({path:join(dir,`${width}.png`),fullPage:true});
  await summary.click();
  // Native details toggle and React cleanup are asynchronous. Require actual
  // detachment within the existing Playwright action deadline, not just hidden text.
  await page.getByText(source.question,{exact:false}).waitFor({state:'detached'});
  assert.equal(await page.getByText(source.question,{exact:false}).count(),0);
  mode='error';await summary.click();await page.getByRole('button',{name:'Check again'}).waitFor();assert.equal(await page.getByText(source.question,{exact:false}).count(),0);checks.push(`${width}: failed refresh clears old evidence`);
  mode='ready';await page.getByRole('button',{name:'Check again'}).click();await page.getByText(source.question,{exact:false}).waitFor();
  await summary.click();mode='held';const waiting=new Promise(resolve=>{heldReady=resolve;});await summary.click();await waiting;await page.getByText('Checking private sources').waitFor();
  await page.evaluate(()=>window.fixture.setToken('synthetic-other'));mode='ready';held();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByText(source.question,{exact:false}).count(),0);checks.push(`${width}: former-account pending evidence is not displayed`);
  // A closed/hidden excerpt that remains in the DOM must still fail this gate.
  await page.evaluate(()=>{const stale=document.createElement('p');stale.hidden=true;stale.dataset.detachmentNegative='true';stale.textContent='retained private excerpt';document.body.append(stale);});
  await assert.rejects(()=>page.locator('[data-detachment-negative]').waitFor({state:'detached',timeout:100}),/Timeout/);
  await page.locator('[data-detachment-negative]').evaluate(node=>node.remove());
  checks.push(`${width}: hidden retained excerpt fails detachment negative control`);
  await page.close();page=null;
 }
 assert.deepEqual(errors,[]);
}catch(e){error=e;if(page)await page.screenshot({path:join(dir,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(dir,'result.json'),JSON.stringify({checks,errors,failure:error?.message||null,scope:'Synthetic HTTP and mounted source component; no real authority, SQL or model'},null,2));console.log(JSON.stringify({checks:checks.length,failed:!!error,artifactDir:dir}));}
if(error)throw error;
