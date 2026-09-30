import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
if(process.argv.includes('--prepare')){console.log('Prepared mounted test. No browser started. Synthetic transport only.');process.exit(0);}
const root=process.cwd(),out=resolve('scratchpad/comparison-preparation-ui',String(Date.now()));mkdirSync(out,{recursive:true});
const bundle=await build({root,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,rolldownOptions:{input:resolve('evals/comparison-preparation-ui/host.tsx'),output:{entryFileNames:'host.js'}}}});
const assets=new Map(bundle.output.map(a=>['/'+a.fileName,a.type==='chunk'?a.code:a.source]));
const ready={available:false,waiting_on:'us',code:'comparison_gpu_accounting_unavailable',can_upload:true,can_prepare:false};
const sid='30000000-0000-4000-8000-000000000003',rid='10000000-0000-4000-8000-000000000001';
let requests=[],pid=null,state='queued',prepared=false;
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(assets.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.woff2')?'font/woff2':'text/css');res.end(assets.get(url.pathname));return;}
 if(url.pathname.startsWith('/api/')){let body='';for await(const chunk of req)body+=chunk;const b=JSON.parse(body);requests.push(b);res.setHeader('Content-Type','application/json');
  if(b.op==='readiness'){res.end(JSON.stringify({readiness:ready}));return;}
  if(b.op==='create_upload'){pid=b.preparation_id;res.end(JSON.stringify({source:{source_id:sid,replica_id:rid,purpose:'comparison_reference',mime:'audio/wav'},upload:{method:'PUT',url:'https://synthetic.blob.core.windows.net/private/fixture?sig=synthetic',headers:{},expires_at:'2099-01-01T00:00:00Z'},finalized:false}));return;}
  if(b.op==='finalize'){res.end(JSON.stringify({source:{source_id:sid},finalized:true}));return;}
  if(b.op==='withdraw')state='revoked';
  res.end(JSON.stringify({preparation:{preparation_id:b.preparation_id,source_id:sid,state:prepared&&state!=='revoked'?'prepared':state,expires_at:'2099-01-01T00:00:00Z',completed_receipt_sha256:prepared&&state!=='revoked'?'a'.repeat(64):null,can_voice:false},readiness:ready}));return;
 }
 res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>@layer reset,tokens,base,components,responsive;body{margin:0}</style>'+[...assets.keys()].filter(k=>k.endsWith('.css')).map(k=>`<link rel="stylesheet" href="${k}">`).join('')+'<div id="root"></div><script type="module" src="/host.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const receipt={scope:'Actual mounted component and client. Synthetic HTTP and Azure PUT transport. No real SQL, Azure, processing or voice proof.',checks:[]};
try{browser=await launchSuiteBrowser("comparison-preparation-ui");const page=await browser.newPage();await page.route('https://synthetic.blob.core.windows.net/**',r=>r.fulfill({status:201,body:''}));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText('You can upload now.',{exact:false}).waitFor();
 const button=page.getByRole('button',{name:'Upload private recording',exact:true});assert(await button.isDisabled());assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);receipt.checks.push('three unchecked statements, honest unavailable preparation');
 await page.locator('input[type=file]').setInputFiles({name:'voice.wav',mimeType:'audio/wav',buffer:Buffer.alloc(128)});
 for(const box of await page.locator('input[type=checkbox]').all())await box.check();assert(await button.isEnabled());await button.click();await page.getByText('Recording uploaded. Preparation is waiting on us.').waitFor();assert.equal(requests.filter(r=>r.op==='create_upload').length,1);assert.equal(requests.find(r=>r.op==='create_upload').upload_intent_id,pid);receipt.checks.push('explicit checked upload through create PUT finalize status');
 await page.reload();await page.getByText('Recording uploaded. Preparation is waiting on us.').waitFor();assert.equal(requests.filter(r=>r.op==='create_upload').length,1);receipt.checks.push('reload recovers exact saved ID without reupload');
 prepared=true;await page.getByRole('button',{name:'Check recording status',exact:true}).click();await page.getByText('Your recording is prepared. Choose it below to review.').waitFor();assert.deepEqual(await page.evaluate(()=>window.preparationFixture.prepared),[sid]);assert.equal(await page.getByText('You can upload now. Preparation is not available yet; we need to finish our processing setup.',{exact:true}).count(),0);await page.getByRole('heading',{name:'Your comparison recording',exact:true}).waitFor();receipt.checks.push('prepared notifies parent without choosing reference');
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:resolve(out,`prepared-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}receipt.checks.push('390 and 1440 no horizontal overflow');
 await page.getByRole('button',{name:'Withdraw recording permission',exact:true}).click();await page.getByText('Permission withdrawn.',{exact:false}).waitFor();assert.equal(requests.at(-1).preparation_id,pid);await page.getByRole('button',{name:'Add another recording',exact:true}).click();assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);receipt.checks.push('exact withdrawal and fresh unchecked permission reset');
}finally{await browser?.close();await new Promise(r=>server.close(r));writeFileSync(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2));}
console.log(JSON.stringify({...receipt,artifact:out}));
