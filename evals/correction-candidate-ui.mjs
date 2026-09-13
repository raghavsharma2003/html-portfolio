// Mounted real action component with synthetic HTTP. No model/SQL/auth proof.
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const RID='10000000-0000-4000-8000-000000000001',DATASET='10000000-0000-4000-8000-000000000002';
const JOB='10000000-0000-4000-8000-000000000003',CANDIDATE='10000000-0000-4000-8000-000000000004',HASH='a'.repeat(64);
const entry=join(root,'__correction_candidate_fixture__.tsx');
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import './src/studio/design/tokens.css';import './src/studio/feedback-dataset.css';import CorrectionCandidateAction from './src/studio/CorrectionCandidateAction';
function Fixture(){const[token,setToken]=useState('fixture-a');const[eligible,setEligible]=useState(true);
return <main className="feedback-dataset"><p>Synthetic private candidate fixture</p><button onClick={()=>setToken('fixture-b')}>Switch account</button>
<button onClick={()=>setEligible(false)}>Change corrections</button><CorrectionCandidateAction token={token} replicaId="${RID}" datasetId="${DATASET}"
sourceSetHash="${HASH}" eligible={eligible} onAuthError={()=>{}}/></main>;}createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const bundle=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:true,rolldownOptions:{input:entry,output:{entryFileNames:'fixture.js'}}},
 plugins:[{name:'candidate-fixture',resolveId(id){if(id===entry)return entry;},load(id){if(id===entry)return source;}}]});
const assets=new Map(bundle.output.map(item=>['/'+item.fileName,item.type==='chunk'?item.code:item.source]));
const styles=bundle.output.filter(item=>item.fileName.endsWith('.css')).map(item=>`<link rel="stylesheet" href="/${item.fileName}">`).join('');
let stored=null,posts=[],pending=null,mode='normal';
const row=()=>({job_id:JOB,replica_id:RID,dataset_id:DATASET,state:'draft',candidate_id:CANDIDATE,active_changed:false});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/api/replica-correction-candidate'){
  const auth=req.headers.authorization;assert(['Bearer fixture-a','Bearer fixture-b'].includes(auth));
  if(req.method==='GET')return json(200,{job:auth==='Bearer fixture-b'?null:stored});
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);posts.push(body);
  assert.deepEqual(body,{replica_id:RID,dataset_id:DATASET,expected_source_set_hash:HASH});
  const finish=()=>{stored=row();if(mode==='uncertain'){res.writeHead(200,{'content-type':'application/json'});return res.end('{');}return json(200,{job:stored});};
  if(mode==='hold'){pending=finish;return;}return finish();
 }
 if(assets.has(url.pathname)){res.writeHead(200,{'content-type':extname(url.pathname)==='.css'?'text/css':'text/javascript'});return res.end(assets.get(url.pathname));}
 res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0;color:#253d31;background:#f8f8f5;font:16px system-ui}main{padding:24px;max-width:760px;margin:auto}button{min-height:44px;padding:10px 16px;max-width:100%;font:inherit}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,dir=join(root,'scratchpad/correction-candidate-ui');mkdirSync(dir,{recursive:true});
const checks=[];let browser;
try{
 browser=await launchSuiteBrowser("correction-candidate-ui");
 for(const width of [390,1440]){
  stored=null;posts=[];mode='normal';
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);const create=page.getByRole('button',{name:'Create private candidate',exact:true});await create.waitFor();
  await create.focus();assert.equal(await create.evaluate(el=>el===document.activeElement),true);
  mode='hold';await create.dblclick();assert.equal(posts.length,1);assert.equal(await create.isDisabled(),true);
  await page.getByText('Preparing your private candidate',{exact:true}).waitFor();pending();pending=null;
  await page.getByText('Private candidate saved. Comparison and approval are still needed.',{exact:true}).waitFor();
  assert.equal(await create.count(),0);assert.equal(posts.length,1);checks.push(`${width}: reviewed action, keyboard access, one pending POST, draft without activation`);
  await page.screenshot({path:join(dir,`candidate-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  stored=null;mode='uncertain';await page.reload();await create.waitFor();await create.click();
  await page.getByText('Starting the candidate could not be confirmed. Check its status.',{exact:true}).waitFor();
  assert.equal(posts.length,2);assert.equal(await create.count(),0);
  await page.getByRole('button',{name:'Check candidate status',exact:true}).click();
  await page.getByText('Private candidate saved. Comparison and approval are still needed.',{exact:true}).waitFor();
  assert.equal(posts.length,2);checks.push(`${width}: uncertain success uses explicit GET without duplicate POST`);
  stored=null;mode='hold';await page.reload();await create.waitFor();await create.click();
  await page.getByText('Preparing your private candidate',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Switch account',exact:true}).click();await create.waitFor();
  pending();pending=null;await page.getByRole('button',{name:'Check candidate status',exact:true}).click();await create.waitFor();
  assert.equal(await page.getByText('Private candidate saved. Comparison and approval are still needed.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Change corrections',exact:true}).click();assert.equal(await create.isDisabled(),true);
  assert.deepEqual(errors,[]);checks.push(`${width}: account switch rejects late response, changed corrections disable start, no runtime errors`);
  await page.close();
 }
 writeFileSync(join(dir,'result.json'),JSON.stringify({checks,scope:'synthetic mounted UI only'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){writeFileSync(join(dir,'failure.json'),JSON.stringify({checks,error:String(error.message)},null,2));throw error;}
finally{pending?.();await browser?.close();await new Promise(resolve=>server.close(resolve));}
