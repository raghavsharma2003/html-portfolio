import {useEffect,useRef,useState} from 'react';
import {ReplicaApiError,replicaRequest} from './replicaApi';
import CandidateMaterializeAction from './CandidateMaterializeAction';
type Job={job_id:string;replica_id:string;dataset_id:string;state:string;candidate_id:string|null;active_changed:false};
const states:Record<string,string>={
 preparing:'Preparing your private candidate',running:'Learning from the corrections you saved',
 response_recorded:'Checking the candidate',accounting_pending:'We are checking usage before continuing',
 draft:'Private candidate saved. Comparison and approval are still needed.',
 abstained:'These corrections did not support a clear behavior change.',
 failed:'We could not finish this candidate. Your current AI is unchanged.',
 unknown:'We could not confirm completion. Check status before continuing.',
 retired:'This candidate is no longer available.',
};
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function parseCorrectionCandidate(value:unknown,replicaId:string,datasetId:string):Job|null{
 if(value===null)return null;
 const job=value as Job;
 if(!job||!uuid(job.job_id)||job.replica_id!==replicaId||job.dataset_id!==datasetId||!Object.hasOwn(states,job.state)
   ||job.active_changed!==false||(job.state==='draft'?!uuid(job.candidate_id):job.candidate_id!==null))
   throw new ReplicaApiError('Candidate status could not be verified',502,{});
 return job;
}
export default function CorrectionCandidateAction({token,replicaId,datasetId,sourceSetHash,eligible,onAuthError}:{
 token:string;replicaId:string;datasetId:string;sourceSetHash:string;eligible:boolean;onAuthError:(error:unknown)=>void;
}){
 const [job,setJob]=useState<Job|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const epoch=useRef(0),locked=useRef(false),callbacks=useRef(onAuthError);callbacks.current=onAuthError;
 const scope=`${token}:${replicaId}:${datasetId}:${sourceSetHash}`,latestScope=useRef(scope);latestScope.current=scope;
 const [displayScope,setDisplayScope]=useState(scope);
 async function action(build=false){
  if(locked.current||(build&&(!eligible||!checked||displayScope!==scope||job)))return;
  const run=++epoch.current,actionScope=scope;locked.current=true;setBusy(build?'build':'read');setError('');
  const current=()=>run===epoch.current&&latestScope.current===actionScope;
  try{
   const result=await replicaRequest<{job:unknown}>(token,build?'/api/replica-correction-candidate':
    `/api/replica-correction-candidate?replica_id=${encodeURIComponent(replicaId)}&dataset_id=${encodeURIComponent(datasetId)}`,
    build?{method:'POST',body:JSON.stringify({replica_id:replicaId,dataset_id:datasetId,expected_source_set_hash:sourceSetHash}),signal:AbortSignal.timeout(90_000)}:
    {signal:AbortSignal.timeout(20_000)});
   const saved=parseCorrectionCandidate(result.job,replicaId,datasetId);
   if(!current())return;
   if(build&&!saved)throw new Error('Candidate start was not confirmed');
   setJob(saved);setChecked(true);setDisplayScope(actionScope);
  }catch(cause){
   if(!current())return;setChecked(false);
   if(cause instanceof ReplicaApiError&&cause.status===401)callbacks.current(cause);
   setError(build?'Starting the candidate could not be confirmed. Check its status.':'We could not read candidate status. Check again.');
  }finally{if(current()){locked.current=false;setBusy('');}}
 }
 useEffect(()=>{
  epoch.current++;locked.current=false;setJob(null);setChecked(false);setBusy('');setError('');setDisplayScope(scope);
  void action();return()=>{epoch.current++;locked.current=false;};
 // Identity and dataset scope own this request; callback identity does not.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope]);
 const visible=displayScope===scope?job:null;
 return <div className="feedback-dataset__candidate">
  <p role="status" aria-live="polite">{visible?states[visible.state]:busy==='build'?'Preparing your private candidate':
   checked?'Create a private candidate from this correction set. Your current AI stays unchanged.':'Checking candidate status'}</p>
  <div className="feedback-dataset__actions">
   {checked&&displayScope===scope&&!visible&&<button type="button" disabled={Boolean(busy)||!eligible} onClick={()=>void action(true)}>Create private candidate</button>}
   <button type="button" disabled={Boolean(busy)} onClick={()=>void action()}>Check candidate status</button>
  </div>
  {error&&<p className="feedback-dataset__error" role="alert">{error}</p>}
  {checked&&visible?.state==='draft'&&visible.candidate_id&&<CandidateMaterializeAction
   key={`${scope}:${visible.candidate_id}`} token={token} replicaId={replicaId} datasetId={datasetId}
   candidateId={visible.candidate_id} sourceSetHash={sourceSetHash} onAuthError={onAuthError}/>} 
 </div>;
}
