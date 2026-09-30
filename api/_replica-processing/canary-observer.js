import {createProcessingGpuObserver} from './gpu-observer.js';
import {processingSourceScopeFromEnv} from './source-scope.js';
import {canonicalJson,sha256Hex} from '../_provenance/contracts.js';
const STOCK_SHA='16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6';
const fail=()=>{throw Object.assign(Error('processing_canary_snapshot_refused'),{code:'processing_canary_snapshot_refused',retryable:false});};
// Only this synthetic proof may use a root-coordinator ARM snapshot. Ordinary
// workers retain the live managed-identity observer, with no snapshot fallback.
export function createProcessingAdmissionObserver({env=process.env,clock=Date.now,ordinaryObserver}={}){
 if(env.VYAKTI_PROCESSING_CANARY_SNAPSHOT_ENABLED!=='1')return ordinaryObserver||createProcessingGpuObserver({env,clock});
 const scope=processingSourceScopeFromEnv(env);
 if(!scope||env.REPLICA_EXPECTED_DATABASE!=='vyakti_expert_integration_20260906'||env.VYAKTI_MODEL_SERVING!=='azure_only')fail();
 let snapshot;try{snapshot=JSON.parse(env.VYAKTI_PROCESSING_CANARY_SNAPSHOT_JSON||'null');}catch{fail();}
 return async(plan)=>{
  const age=clock()-snapshot?.observed_at_ms;
  if(snapshot?.kind!=='processing-stock-canary-metadata/v1'||snapshot.source_sha256!==STOCK_SHA
   ||snapshot.scope?.ownerUserId!==scope.ownerUserId||snapshot.scope?.replicaId!==scope.replicaId||snapshot.scope?.sourceId!==scope.sourceId
   ||snapshot.plan_sha256!==sha256Hex(canonicalJson(plan))||snapshot.resource_id!==plan.resource_id||snapshot.origin!==plan.origin
   ||snapshot.revision_sha256!==plan.revision_sha256||snapshot.image_sha256!==plan.image_sha256
   ||snapshot.active_revision_name!==plan.active_revision_name||snapshot.active_revision_template_sha256!==plan.active_revision_template_sha256
   ||!Number.isSafeInteger(snapshot.observed_at_ms)||age<0||age>120000)fail();
  return Object.freeze({...snapshot,valid_until_ms:snapshot.observed_at_ms+120000,source_sha256:STOCK_SHA});
 };
}
