import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const out=resolve('scratchpad/comparison-preparation-client',String(Date.now()));mkdirSync(out,{recursive:true});
for(const name of ['replicaApi','comparisonReferenceApi','comparisonPreparationApi']){
 const code=ts.transpileModule(readFileSync(`src/studio/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>`from ${q}${p}.mjs${q}`);
 writeFileSync(resolve(out,name+'.mjs'),code);
}
const api=await import(pathToFileURL(resolve(out,'comparisonPreparationApi.mjs')));
const rid='10000000-0000-4000-8000-000000000001',pid='20000000-0000-4000-8000-000000000002',sid='30000000-0000-4000-8000-000000000003';
const ready={available:false,waiting_on:'us',code:'comparison_gpu_accounting_unavailable',can_upload:true,can_prepare:false};
const prep={preparation_id:pid,source_id:sid,state:'queued',expires_at:'2099-01-01T00:00:00Z',completed_receipt_sha256:null,can_voice:false};
const checks=Object.fromEntries(api.PREPARATION_KEYS.map(k=>[k,true]));
const file=new File([new Uint8Array(128)],'voice.wav',{type:'audio/wav'});
const source={source_id:sid,replica_id:rid,purpose:'comparison_reference',mime:'audio/wav'};
const upload={method:'PUT',url:'https://synthetic.blob.core.windows.net/private/file?sig=synthetic',headers:{'x-ms-blob-type':'BlockBlob'},expires_at:'2099-01-01T00:00:00Z'};
let calls=[],mutate=x=>x,putHook=null,checksPassed=0;
const original=globalThis.fetch;
globalThis.fetch=async(url,init)=>{init.signal.throwIfAborted();const body=typeof init.body==='string'?JSON.parse(init.body):null;calls.push({url,init,body});
 if(init.method==='PUT'){if(putHook)await putHook(init);return new Response(null,{status:201});}
 let data=body.op==='create_upload'?{source,upload,finalized:false}:body.op==='finalize'?{source,upload:null,finalized:true}:body.op==='readiness'?{readiness:ready}:{preparation:body.op==='withdraw'?{...prep,state:'revoked',source_id:null}:prep,readiness:ready};
 data=mutate(structuredClone(data),body);return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
async function test(name,fn){calls=[];mutate=x=>x;putHook=null;await fn();checksPassed++;console.log('PASS '+name);}
try{
 await test('honest upload-only readiness',async()=>{assert.deepEqual(await api.readPreparationReadiness('synthetic',new AbortController().signal),ready);});
 await test('actual upload client sends purpose and stable ID then PUT finalize status',async()=>{const d=await api.uploadComparisonRecording('synthetic',rid,pid,file,checks,new AbortController().signal);assert.equal(d.preparation.state,'queued');assert.equal(calls.length,4);assert.equal(calls[0].body.upload_intent_id,pid);assert.equal(calls[0].body.preparation_id,pid);assert.equal(calls[0].body.purpose,'comparison_reference');assert.deepEqual(calls[0].body.attestations,checks);assert.equal(calls[1].init.headers.Authorization,undefined);assert.equal(calls[1].init.headers['Content-Type'],'audio/wav');assert.equal(calls[2].body.source_id,sid);});
 for(const key of api.PREPARATION_KEYS)await test('unchecked '+key+' refuses before transport',async()=>{await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,file,{...checks,[key]:false},new AbortController().signal));assert.equal(calls.length,0);});
 await test('invalid file refuses before transport',async()=>{await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,new File(['x'],'x.txt',{type:'text/plain'}),checks,new AbortController().signal));assert.equal(calls.length,0);});
 await test('pre-abort refuses all transport',async()=>{const c=new AbortController();c.abort();await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,file,checks,c.signal));assert.equal(calls.length,0);});
 await test('abort during PUT prevents finalize',async()=>{const c=new AbortController();putHook=async()=>c.abort();await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,file,checks,c.signal));assert.equal(calls.length,2);});
 await test('non-Azure upload refused',async()=>{mutate=(d,b)=>b.op==='create_upload'?{...d,upload:{...upload,url:'https://example.com/file?sig=x'}}:d;await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,file,checks,new AbortController().signal));assert.equal(calls.length,1);});
 await test('cross-replica response refuses PUT',async()=>{mutate=(d,b)=>b.op==='create_upload'?{...d,source:{...source,replica_id:pid}}:d;await assert.rejects(api.uploadComparisonRecording('synthetic',rid,pid,file,checks,new AbortController().signal));assert.equal(calls.length,1);});
 await test('finalized replay does not PUT again',async()=>{mutate=(d,b)=>b.op==='create_upload'?{...d,upload:null,finalized:true}:d;await api.uploadComparisonRecording('synthetic',rid,pid,file,checks,new AbortController().signal);assert.equal(calls.length,2);assert(!calls.some(c=>c.init.method==='PUT'));});
 await test('wrong status ID refused',async()=>{mutate=d=>({...d,preparation:{...prep,preparation_id:rid}});await assert.rejects(api.preparationRequest('synthetic',rid,pid,'status',new AbortController().signal));});
 await test('prepared without receipt refused',async()=>{mutate=d=>({...d,preparation:{...prep,state:'prepared'}});await assert.rejects(api.preparationRequest('synthetic',rid,pid,'status',new AbortController().signal));});
 await test('voice permission never accepted',async()=>{mutate=d=>({...d,preparation:{...prep,can_voice:true}});await assert.rejects(api.preparationRequest('synthetic',rid,pid,'status',new AbortController().signal));});
 await test('unknown withdrawal tombstone supported',async()=>{const d=await api.preparationRequest('synthetic',rid,pid,'withdraw',new AbortController().signal);assert.equal(d.preparation.source_id,null);assert.equal(d.preparation.state,'revoked');assert.equal(calls[0].body.preparation_id,pid);});
}finally{globalThis.fetch=original;}
console.log(JSON.stringify({passed:checksPassed,scope:'Real client with synthetic fetch only. No browser, SQL, Azure or voice proof.'}));
