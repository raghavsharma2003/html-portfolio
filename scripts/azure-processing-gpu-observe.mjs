// Run as a bounded CPU recovery task, never a GPU health probe. Scheduling is an
// operational binding and remains disabled until deployment review.
import {pathToFileURL} from 'node:url';
import {createNeonDb} from '../services/replica-processing-worker/db.js';
import {createProcessingGpuObserver} from '../api/_replica-processing/gpu-observer.js';
import {processingGpuPlan,releaseNaturallyIdleProcessingGpu} from '../api/_replica-processing/gpu-admission.js';
export async function observeProcessingGpuOnce({env=process.env,db,observe}={}){
 if(env.AZURE_PROCESSING_GPU_OBSERVER_ENABLED!=='1'||!env.REPLICA_EXPECTED_DATABASE)throw Error('processing_gpu_observer_disabled');
 const plan=processingGpuPlan(env,{recovery:true});
 const query=db||createNeonDb({env});
 const observation=await (observe||createProcessingGpuObserver({env}))(plan);
 if(observation.revisions.some(r=>r.replicas!==0))return {released:0,monetary_liability:'held',state:'not_naturally_idle'};
 return releaseNaturallyIdleProcessingGpu({db:query,plan,observation});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await observeProcessingGpuOnce()));}catch{console.error('processing_gpu_observation_unknown');process.exitCode=1;}
}
