import assert from 'node:assert/strict';
import {prepareProviderRevisionBinding,verifyProviderRevision,assertSameReportedRevision,PROVIDER_REVISION_CONTRACT_V2} from '../api/_dialogue/provider-revision.js';
import {createAzureFoundryDialogueGenerator} from '../api/_dialogue/providers/azure-foundry.js';
import {compileDialoguePrompt} from '../api/_dialogue/contracts.js';
const config={expectedResponseModel:'gpt-4.1-mini-2025-04-14',endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com/',
 deployment:'gpt-4.1-mini',baselineSnapshotHash:'a'.repeat(64)};
const binding=prepareProviderRevisionBinding(config),usage={input_tokens:100,output_tokens:20};
const payload={model:config.expectedResponseModel,system_fingerprint:'fp_8d7b600b57'};
const first=verifyProviderRevision(payload,binding,usage);
let groups=0;
async function check(name,fn){await fn();console.log(`ok ${++groups} - ${name}`);}
await check('exact reported revision remains comparable',()=>assert.equal(assertSameReportedRevision(first,verifyProviderRevision(payload,binding,usage)),first.reported_revision_hash));
await check('missing alias or drifted model retains measured usage on refusal',()=>{
 for(const model of [undefined,'gpt-4.1-mini','gpt-4.1-mini-2026-01-01'])assert.throws(()=>verifyProviderRevision({...payload,model},binding,usage),e=>e.code==='provider_revision_response_model_mismatch'&&e.measured_usage===usage);
});
await check('missing fingerprint and self-modified receipt cannot pass',()=>{
 assert.throws(()=>verifyProviderRevision({model:payload.model},binding,usage),e=>e.code==='provider_revision_fingerprint_unavailable'&&e.measured_usage===usage);
 assert.throws(()=>assertSameReportedRevision(first,{...first,response_model:'gpt-4.1-mini'}),/provider_pair_revision_receipt_changed/);
 const changed=verifyProviderRevision({...payload,system_fingerprint:'fp_changed'},binding,usage);
 assert.throws(()=>assertSameReportedRevision(first,changed),/provider_pair_revision_mismatch/);
});
await check('exact observed endpoint deployment and configured snapshot are required',()=>{
 for(const patch of [{expectedResponseModel:'gpt-4.1-mini'},{endpoint:'https://foreign.services.ai.azure.com/'},{deployment:'other'},{baselineSnapshotHash:'alias'}])
  assert.throws(()=>prepareProviderRevisionBinding({...config,...patch}));
 assert.throws(()=>verifyProviderRevision(payload,{...binding,deployment:'changed'},usage),/provider_revision_binding_changed/);
});
const terraConfig={expectedResponseModel:'gpt-5.6-terra-2026-07-09',endpoint:config.endpoint,
 deployment:'gpt-5.6-terra',baselineSnapshotHash:'b'.repeat(64)};
const terraBinding=prepareProviderRevisionBinding(terraConfig);
await check('Terra uses a distinct receipt contract and records explicit missing fingerprint',()=>{
 assert.equal(terraBinding.schema,PROVIDER_REVISION_CONTRACT_V2);
 const absent=verifyProviderRevision({model:terraConfig.expectedResponseModel,system_fingerprint:null},terraBinding,usage);
 assert.equal(absent.fingerprint_status,'not_provided');assert.equal(absent.system_fingerprint,null);
 assert.equal(assertSameReportedRevision(absent,verifyProviderRevision({model:terraConfig.expectedResponseModel,system_fingerprint:null},terraBinding,usage)),absent.reported_revision_hash);
 for(const missing of [{model:terraConfig.expectedResponseModel},{model:terraConfig.expectedResponseModel,system_fingerprint:'invalid'}])
  assert.throws(()=>verifyProviderRevision(missing,terraBinding,usage),error=>error.code==='provider_revision_fingerprint_unavailable'&&error.measured_usage===usage);
});
await check('Terra preserves exact provided fingerprint and refuses cross-status or cross-model pairs',()=>{
 const absent=verifyProviderRevision({model:terraConfig.expectedResponseModel,system_fingerprint:null},terraBinding,usage);
 const provided=verifyProviderRevision({model:terraConfig.expectedResponseModel,system_fingerprint:'fp_terrafixture'},terraBinding,usage);
 assert.equal(provided.fingerprint_status,'provided');
 assert.throws(()=>assertSameReportedRevision(absent,provided),/provider_pair_revision_mismatch/);
 assert.throws(()=>prepareProviderRevisionBinding({...terraConfig,expectedResponseModel:config.expectedResponseModel}),/provider_revision_expected_version_required/);
 assert.throws(()=>prepareProviderRevisionBinding({...terraConfig,deployment:'arbitrary'}),/provider_revision_deployment_required/);
});
const prompt=compileDialoguePrompt({core:'Synthetic fixture',message:'Namaste'});
function response(patch={}){return{...payload,usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:'{"reply":"Namaste"}'}}],...patch};}
function adapter(make,strict=true){let calls=0;return {get calls(){return calls;},generator:createAzureFoundryDialogueGenerator({endpoint:config.endpoint,model:config.deployment,apiKey:'synthetic-not-a-real-key',
 ...(strict?{revisionBinding:{expected_response_model:config.expectedResponseModel,baseline_snapshot_hash:config.baselineSnapshotHash}}:{}),
 fetchImpl:async(_url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response(JSON.stringify(make()),{status:200,headers:{'content-type':'application/json'}});}})};}
await check('actual bound adapter exposes verified receipt with one request',async()=>{
 const a=adapter(()=>response()),result=await a.generator.generate({prompt});
 assert.equal(a.calls,1);assert.deepEqual(result.usage,usage);assert.deepEqual(result.provider_identity,first);
 assert.deepEqual(a.generator.revision_binding,binding);
});
await check('actual bound adapter mismatch and malformed output keep measured usage, never retry',async()=>{
 for(const patch of [{model:'gpt-4.1-mini'},{system_fingerprint:null},{choices:[]}]){
  const a=adapter(()=>response(patch));await assert.rejects(a.generator.generate({prompt}),error=>{
   assert.deepEqual(error.measured_usage,usage);return true;
  });assert.equal(a.calls,1);
 }
});
await check('unbound ordinary caller keeps existing response contract',async()=>{
 const a=adapter(()=>response({model:undefined,system_fingerprint:undefined}),false),result=await a.generator.generate({prompt});
 assert.equal(a.calls,1);assert.equal('provider_identity' in result,false);assert.equal('revision_binding' in a.generator,false);
});
console.log(`${groups} provider revision control groups; synthetic HTTP only, no Azure calls or immutable weights proof`);
