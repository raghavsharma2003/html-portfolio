import {createAzureVoiceEvidenceAdapters} from '../api/_replica-processing/providers/azure-voice-evidence.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProcessingGpuAdmission,PROCESSING_GPU_SQL,releaseNaturallyIdleProcessingGpu} from '../api/_replica-processing/gpu-admission.js';
import {GPU_WINDOW_SQL} from '../api/_gpu-allocation-budget.js';
const H='a'.repeat(64),NOW=Date.now(),owner=randomUUID(),replica=randomUUID(),sourceId=randomUUID();
const plan={kind:'azure-shared-evidence/v1',active_revision_name:'vyakti-voice-evidence--fixture',active_revision_template_sha256:H,resource_id:'/subscriptions/c60a32f6-c812-4c0e-bc42-b6431ee90b8f/resourceGroups/vyakti-voice/providers/Microsoft.App/containerapps/vyakti-voice-evidence',origin:'https://vyakti-voice-evidence.internal.purpletree-6dea69e2.centralindia.azurecontainerapps.io',revision_sha256:H,contract_sha256:H,image_sha256:H,rate_microusd_per_second:462,contingency_multiplier:2,hard_invoice_cap:false,reservation_estimate_microusd:831600,planning_allocation_seconds:900,expires_at_ms:NOW+900000};
const env={AZURE_PROCESSING_GPU_PLAN_JSON:JSON.stringify(plan),AZURE_PROCESSING_GPU_ENABLED:'1',VYAKTI_MODEL_SERVING:'azure_only',AZURE_PROCESSING_GPU_BUDGET_ID:'synthetic-processing',AZURE_PROCESSING_GPU_LIMIT_MICROUSD:'2000000'};
const src={source_id:sourceId,replica_id:replica,owner_user_id:owner,sha256:H};
let now=NOW;let valid=true,spend=138600,reserves=0,binds=0,claims=0,responses=0,closed=false,window,request,resource;const children=new Map();
async function db(q,p){
 if(q===PROCESSING_GPU_SQL.authorize)return valid&&p[1]===sourceId&&p[2]===replica&&p[3]===owner?[{source_id:sourceId}]:[];
 if(q===GPU_WINDOW_SQL.reserve){reserves++;if(spend+p[6]>p[1])return [];spend+=p[6];resource=p[2];request=p[4];window={window_id:randomUUID(),budget_id:p[0],resource_sha256:p[2],revision_sha256:p[3],request_sha256:p[4],contract_sha256:p[5],reserved_microusd:p[6],max_allocation_seconds:p[7],provider_request_sha256:p[8],accounting_basis:p[9],state:'reserved'};return [window];}
 if(q===GPU_WINDOW_SQL.existing)return window?[window]:[];
 if(q===PROCESSING_GPU_SQL.bind){binds++;assert.equal(p[8],window.window_id);if(!valid)return [];window.state='in_flight';return [{window_id:window.window_id}];}
 if(q===PROCESSING_GPU_SQL.claim){if(!valid||closed||children.has(p[9]))return [];children.set(p[9],{request:p[10],state:'claimed'});claims++;return [{window_id:window.window_id}];}
 if(q===PROCESSING_GPU_SQL.poll)return valid&&!closed&&children.get(p[9])?.request===p[10]?[{window_id:window.window_id}]:[];
 if(q===PROCESSING_GPU_SQL.response){const c=children.get(p[1]);if(!c||c.request!==p[2]||c.state!=='claimed')return [];c.state='response_received';responses++;return [{window_id:window.window_id}];}
 if(q===PROCESSING_GPU_SQL.close){closed=true;return [{window_id:window.window_id}];}
 if(q===GPU_WINDOW_SQL.uncertain){window.state='uncertain';return [window];}
 if(q===PROCESSING_GPU_SQL.due)return [{window_id:window.window_id,resource_sha256:resource}];
 if(q===PROCESSING_GPU_SQL.release){assert.equal(p[1],resource);return [...children.values()].some(c=>c.state==='claimed')?[]:[{window_id:window.window_id}];}
 throw Error('unexpected SQL');
}
const a=createProcessingGpuAdmission({db,env,clock:()=>now,observe:async p=>p});let count=0;
for(const step of ['diarize','enhance','voice_quality']){
 const f=await a.forStage({source:src,leased:{job:{job_id:randomUUID(),step,revision:1},leaseToken:'t'.repeat(40)}});await f.beforePrivateRead();assert.throws(()=>f.assertProviderOrigin('https://wrong.internal'),/origin_mismatch/);await assert.rejects(f.beforeProviderPoll(),/authority_changed/);await f.beforeProviderRequest({operation:step,requestSha256:H});await f.beforeProviderPoll();
 if(step==='diarize'){
  let privateReads=0,providerFetches=0;
  const providerEnv={AZURE_VOICE_EVIDENCE_ORIGIN:'https://wrong.internal',AZURE_VOICE_EVIDENCE_HMAC_SECRET:Buffer.alloc(32,1).toString('base64url')};
  const makeProvider=e=>createAzureVoiceEvidenceAdapters({env:e,resolveInput:async()=>{privateReads++;throw Error('unexpected_private_read');},fetchImpl:async()=>{providerFetches++;throw Error('unexpected_provider_fetch');}});
  await assert.rejects(makeProvider(providerEnv).diarize.diarize({billing:f,inputs:[]}),/origin_mismatch/);
  assert.equal(privateReads,0);assert.equal(providerFetches,0);count++;
  valid=false;
  await assert.rejects(makeProvider({...providerEnv,AZURE_VOICE_EVIDENCE_ORIGIN:plan.origin}).diarize.diarize({billing:f,inputs:[]}),/authority_changed/);
  assert.equal(privateReads,0);assert.equal(providerFetches,0);count++;
await assert.rejects(f.beforeProviderPoll(),/authority_changed/);valid=true;count++;}
 await assert.rejects(f.beforeProviderRequest({operation:step,requestSha256:H}),/child_invalid/);
 now=NOW+900001;assert.throws(()=>f.deadlineSignal(),/deadline/);await assert.rejects(f.beforeProviderPoll(),/deadline/);now=NOW;
 await f.afterProviderResponse({request_sha256:H,response_sha256:H,http_status:200});count+=4;
}
assert.equal(reserves,1);assert.equal(binds,1);assert.equal(claims,3);assert.equal(responses,3);assert.equal(spend,970200);count++;
await a.closeAll();assert.equal(window.state,'uncertain');assert.equal(spend,970200);count++;
const observation={kind:'azure-shared-evidence-observation/v1',resource_id:plan.resource_id,revision_sha256:H,image_sha256:H,observed_at_ms:NOW,revisions:[{name:'synthetic-revision',replicas:0,active:true}]};
const released=await releaseNaturallyIdleProcessingGpu({db,plan,observation,clock:()=>NOW});assert.equal(released.released,1);assert.equal(released.accounted,false);assert.equal(spend,970200);count++;
await assert.rejects(releaseNaturallyIdleProcessingGpu({db,plan,observation:{...observation,revisions:[{name:'x',replicas:1}]},clock:()=>NOW}),/natural_zero/);count++;
const disabled=createProcessingGpuAdmission({db,env:{...env,AZURE_PROCESSING_GPU_ENABLED:'0'}});await assert.rejects(disabled.forStage({source:src,leased:{job:{step:'diarize'}}}),/disabled/);count++;
const ownedLease={job:{job_id:randomUUID(),step:'diarize',revision:1},leaseToken:'t'.repeat(40)};
const otherOwner=createProcessingGpuAdmission({db,env,observe:async p=>p});
await assert.rejects(otherOwner.forStage({source:{...src,owner_user_id:randomUUID()},leased:ownedLease}),/authority_changed/);count++;
await assert.rejects(createProcessingGpuAdmission({db,env}).forStage({source:src,leased:ownedLease}),/observer_required/);count++;
await assert.rejects(createProcessingGpuAdmission({db,env:{...env,AZURE_PROCESSING_GPU_LIMIT_MICROUSD:'138600'},observe:async p=>p}).forStage({source:src,leased:ownedLease}),/budget_reservation_refused/);count++;
console.log(JSON.stringify({state:'processing_gpu_offline_pass',groups:count,reserves,binds,claims,held_micro_usd:spend,real_db_calls:0,provider_calls:0}));
