// Real Chromium CSP enforcement with the shipping uploader and local WAV decoder.
// Azure responses are intercepted. No Blob, user data or provider call is made.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { syntheticPcmWav } from '../clone-experience-qa/synthetic-wav.mjs';
import { launchSuiteBrowser } from '../rehearsal/browser.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
const origin='https://vyaktireplicamedia.blob.core.windows.net';
const policies=['/studio','/studio.html'].map(path=>({path,policy:config.headers.find(row=>row.source===path).headers.find(row=>row.key==='Content-Security-Policy').value}));
assert.equal(policies[0].policy,policies[1].policy,'both Studio entry routes must have the same media contract');
const js=await build({stdin:{resolveDir:root,loader:'ts',contents:`
  import { putSignedUpload } from './src/studio/enrollmentApi';
  window.runUpload=async(blocks=false)=>{
    const file=new File([await(await fetch('/tone.wav')).arrayBuffer()],'synthetic.wav',{type:'audio/wav'});
    const url='${origin}/csp-fixture/never-created.wav?sig=synthetic-not-a-credential';
    const upload={method:'PUT',url,headers:{'Content-Type':'audio/wav'}};
    if(blocks)upload.resumable={protocol:'azure-block-v1',endpoint:url,headers:{'x-ms-version':'2025-01-05'},chunk_size:8*1024*1024,metadata:{contentType:'audio/wav'}};
    try{await putSignedUpload(file,upload,()=>{});return 'uploaded';}catch{return 'blocked';}
  };
  window.runPlayback=async()=>{
    const audio=document.createElement('audio');audio.controls=true;document.body.append(audio);
    const url=URL.createObjectURL(await(await fetch('/tone.wav')).blob());
    return new Promise(resolve=>{
      const finish=value=>{URL.revokeObjectURL(url);audio.remove();resolve(value);};
      audio.onloadedmetadata=()=>finish(audio.duration);audio.onerror=()=>finish('blocked');
      audio.src=url;audio.load();
    });
  };
`},bundle:true,write:false,format:'iife',logLevel:'silent'});
const wav=syntheticPcmWav();
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(js.outputFiles[0].contents);}
  if(url.pathname==='/tone.wav'){res.setHeader('Content-Type','audio/wav');return res.end(wav);}
  const entry=policies.find(row=>row.path===url.pathname);
  if(!entry){res.statusCode=404;return res.end();}
  // Recreate the owner's exact old policy as a negative control, not a looser mock.
  const policy=url.searchParams.has('old')?entry.policy.replace(` https://vyaktireplicamedia.blob.core.windows.net`,'').replace(" media-src 'self' blob:;",''):entry.policy;
  res.setHeader('Content-Security-Policy',policy);res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><title>Studio media policy fixture</title><script src="/app.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;let checks=0;
try{
 browser=await launchSuiteBrowser('studio-media-policy');
 const page=await browser.newPage();let intercepted=0;
 await page.route(origin+'/**',route=>{intercepted++;return route.fulfill({status:201,headers:{'Access-Control-Allow-Origin':'*'}});});
 for(const {path}of policies){
  await page.goto(`http://127.0.0.1:${server.address().port}${path}?old=1`);
  const before=intercepted;
  assert.equal(await page.evaluate(()=>window.runUpload()),'blocked');checks++;
  assert.equal(await page.evaluate(()=>window.runPlayback()),'blocked');checks++;
  assert.equal(intercepted,before,'old CSP must stop upload before storage');checks++;
  await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
  assert.equal(await page.evaluate(()=>window.runUpload(true)),'uploaded');checks++;
  assert.equal(intercepted-before,2,'real uploader sends a block and its commit');checks++;
  assert.equal(await page.evaluate(()=>window.runPlayback()),13);checks++;
 }
 console.log(`studio-media-policy: ${checks}/${checks} real CSP controls passed; Azure intercepted, no storage writes`);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
