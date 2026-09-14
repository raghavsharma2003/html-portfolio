import {useEffect,useRef,useState} from 'react';
import {comparisonId} from './comparisonReferenceApi';
import {PREPARATION_KEYS,preparationRequest,readPreparationReadiness,uploadComparisonRecording,type Preparation,type PreparationKey,type PreparationReadiness} from './comparisonPreparationApi';

type Props={token:string;ownerUserId:string;replicaId:string;onAuthError:(e:unknown)=>void;onPrepared:(sourceId:string)=>void;onWithdrawn?:()=>void};
type Saved={id:string;withdrawing:boolean};
const statements=['This recording contains only me.','Process this recording for private voice comparison.','This does not allow training or public voice generation.'];
const stateCopy:Record<Preparation['state'],string>={authorized:'Recording permission saved. Upload may still need to finish.',queued:'Recording uploaded. Preparation is waiting on us.',running:'Preparing your private recording.',prepared:'Your recording is prepared. Choose it below to review.',revoked:'Permission withdrawn. Recording removal follows the private deletion process.',expired:'Recording permission expired.',failed:'We could not prepare this recording.',reconciliation_required:'We are checking an interrupted preparation. It cannot continue yet.'};
function recover(key:string):Saved|null{try{const p=JSON.parse(sessionStorage.getItem(key)||'null');return comparisonId(p?.id)&&typeof p.withdrawing==='boolean'?p:null;}catch{return null;}}
export default function ComparisonPreparation({token,ownerUserId,replicaId,onAuthError,onPrepared,onWithdrawn}:Props){
 const key=`vyakti:comparison-preparation:v1:${ownerUserId}:${replicaId}`;
 const [saved,setSaved]=useState<Saved|null>(()=>recover(key)),savedRef=useRef(saved),[p,setP]=useState<Preparation|null>(null),[ready,setReady]=useState<PreparationReadiness|null>(null);
 const [file,setFile]=useState<File|null>(null),[checks,setChecks]=useState<Partial<Record<PreparationKey,boolean>>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const live=useRef(false),controller=useRef(new AbortController()),working=useRef(false),notice=useRef('');
 function persist(value:Saved){sessionStorage.setItem(key,JSON.stringify(value));savedRef.current=value;setSaved(value);}
 function accept(d:{preparation:Preparation;readiness:PreparationReadiness}){if(!live.current)return;setP(d.preparation);setReady(d.readiness);if(d.preparation.state==='revoked'){if(savedRef.current?.withdrawing)persist({...savedRef.current,withdrawing:false});if(notice.current!=='revoked'){notice.current='revoked';onWithdrawn?.();}}if(d.preparation.state==='prepared'&&d.preparation.source_id&&!savedRef.current?.withdrawing&&notice.current!==d.preparation.completed_receipt_sha256){notice.current=d.preparation.completed_receipt_sha256!;onPrepared(d.preparation.source_id);}}
 async function run(action:()=>Promise<void>){if(working.current||!live.current)return;working.current=true;setBusy(true);setMessage('');try{await action();}catch(e){if(live.current){setMessage('This change is unconfirmed. Check status or withdraw this recording before starting another.');onAuthError(e);}}finally{working.current=false;if(live.current){if(controller.current.signal.aborted)controller.current=new AbortController();setBusy(false);}}}
 async function refresh(){const current=savedRef.current;if(current)accept(await preparationRequest(token,replicaId,current.id,'status',controller.current.signal));else{const value=await readPreparationReadiness(token,controller.current.signal);if(live.current)setReady(value);}}
 useEffect(()=>{live.current=true;controller.current=new AbortController();void run(refresh);return()=>{live.current=false;controller.current.abort();};},[]);
 const terminal=!!p&&['revoked','expired','failed'].includes(p.state);
 async function upload(){if(savedRef.current||!file||!ready?.can_upload||!PREPARATION_KEYS.every(k=>checks[k]))return;await run(async()=>{const pending={id:crypto.randomUUID(),withdrawing:false};persist(pending);accept(await uploadComparisonRecording(token,replicaId,pending.id,file,checks,controller.current.signal));if(live.current){setFile(null);setChecks({});}});}
 async function withdraw(){if(!savedRef.current)return;await run(async()=>{const next={...savedRef.current!,withdrawing:true};persist(next);setP(null);const d=await preparationRequest(token,replicaId,next.id,'withdraw',controller.current.signal);if(!live.current)return;if(d.preparation.state!=='revoked')throw Error('withdrawal_unconfirmed');persist({...next,withdrawing:false});accept(d);});}
 return <div className="cvj-comparison-reference" aria-label="Prepare a private recording">
  <h3>{saved?"Your comparison recording":"Add a comparison recording"}</h3>
  {!saved?<p>A recording of just you, up to one minute and 32 MB. Recording and private storage permissions must already be enabled in your permissions step.</p>:null}
  {!saved&&ready&&!ready.can_prepare?<p role="status">You can upload now. Preparation is not available yet; we need to finish our processing setup.</p>:null}
  {message?<p role="alert">{message}</p>:null}{busy?<p role="status">Checking your recording</p>:null}
  {busy?<button className="cvj-quiet" type="button" onClick={()=>controller.current.abort()}>Stop request</button>:null}
  {!saved?<><label>Audio or video<input type="file" accept="audio/*,video/*" style={{maxWidth:"100%",minWidth:0}} disabled={busy||!ready?.can_upload} onChange={e=>{setFile(e.target.files?.[0]||null);setChecks({});}}/></label>
   <fieldset disabled={busy||!ready?.can_upload}><legend>Private comparison permission</legend>{PREPARATION_KEYS.map((k,i)=><label key={k}><input type="checkbox" checked={!!checks[k]} onChange={e=>setChecks({...checks,[k]:e.target.checked})}/>{statements[i]}</label>)}</fieldset>
   <button className="cvj-primary" type="button" disabled={busy||!file||!ready?.can_upload||!PREPARATION_KEYS.every(k=>checks[k])} onClick={()=>void upload()}>Upload private recording</button></>:null}
  {saved?.withdrawing?<p>Withdrawal is unconfirmed. This recording cannot be selected here.</p>:p?<p role="status">{stateCopy[p.state]}</p>:null}
  {saved&&!terminal?<button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void withdraw()}>{saved.withdrawing?'Retry recording withdrawal':'Withdraw recording permission'}</button>:null}
  {terminal?<button className="cvj-quiet" type="button" disabled={busy} onClick={()=>{sessionStorage.removeItem(key);savedRef.current=null;setSaved(null);setP(null);setChecks({});setFile(null);notice.current='';}}>Add another recording</button>:null}
  <button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void run(refresh)}>Check recording status</button>
 </div>;
}
