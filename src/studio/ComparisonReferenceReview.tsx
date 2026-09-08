import ComparisonPreparation from "./ComparisonPreparation";
import {useEffect,useRef,useState} from "react";
import {comparisonId,COMPARISON_USE_KEYS,getComparisonAudio,getComparisonOptions,getComparisonReference,writeComparisonReference,
 type ComparisonOptions,type ComparisonReference,type ComparisonUseKey} from "./comparisonReferenceApi";

type Props={token:string;ownerUserId:string;replicaId:string;expectedSourceId:string;onAuthError:(error:unknown)=>void;onSelectionChanged?:()=>void};
type Saved={id:string;withdrawing:boolean};
const keyFor=(owner:string,rid:string)=>`vyakti:comparison-reference:v1:${owner}:${rid}`;
function readSaved(key:string):Saved|null{try{const d=JSON.parse(sessionStorage.getItem(key)||"null");return comparisonId(d?.id)&&typeof d.withdrawing==="boolean"?d:null;}catch{return null;}}

// The parent keys this component by account, token and current source scope.
// Storage holds only a scoped opaque request handle and cancellation state.
export default function ComparisonReferenceReview({token,ownerUserId,replicaId,expectedSourceId,onAuthError,onSelectionChanged}:Props){
 const storageKey=keyFor(ownerUserId,replicaId),live=useRef(true),controller=useRef(new AbortController());
 const [saved,setSaved]=useState<Saved|null>(()=>readSaved(storageKey));
 const savedRef=useRef(saved),[options,setOptions]=useState<ComparisonOptions|null>(null),[reference,setReference]=useState<ComparisonReference|null>(null);
 const [selected,setSelected]=useState(""),[checks,setChecks]=useState<Partial<Record<ComparisonUseKey,boolean>>>({});
 const [preparationOpen,setPreparationOpen]=useState(false);
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [audio,setAudio]=useState<string|null>(null),audioRef=useRef<string|null>(null),working=useRef(false),generation=useRef(0),operation=useRef(0);
 const current=(ticket=generation.current)=>live.current&&ticket===generation.current&&!controller.current.signal.aborted;
 const clearAudio=()=>{if(audioRef.current)URL.revokeObjectURL(audioRef.current);audioRef.current=null;setAudio(null);setConfirmed(false);};
 function persist(next:Saved|null){if(next)sessionStorage.setItem(storageKey,JSON.stringify(next));else sessionStorage.removeItem(storageKey);savedRef.current=next;setSaved(next);}
 async function run(work:()=>Promise<void>,uncertain=false){
  if(working.current||!current())return;working.current=true;const ticket=generation.current,op=++operation.current;setBusy(true);setMessage("");
  try{await work();}catch(error){if(current(ticket)){setMessage(uncertain?"The change is unconfirmed. Check its saved status before continuing.":"This could not be checked. Try again.");onAuthError(error);}}
  finally{if(operation.current===op)working.current=false;if(current(ticket)&&operation.current===op)setBusy(false);}
 }
 async function refresh(){
  const ticket=generation.current;const pending=savedRef.current;
  if(pending){const value=await getComparisonReference(token,replicaId,pending.id,controller.current.signal);if(!current(ticket))return;setReference(value);if(value.state==="revoked"){persist({...pending,withdrawing:false});clearAudio();}if(!value.can_audition)clearAudio();}
  else{const value=await getComparisonOptions(token,replicaId,controller.current.signal);if(!current(ticket))return;setOptions(value);setSelected("");setChecks({});if(value.current_reference){persist({id:value.current_reference.reference_id,withdrawing:false});setReference(value.current_reference);}}
  if(current(ticket))onSelectionChanged?.();
 }
 useEffect(()=>{live.current=true;controller.current=new AbortController();void run(refresh);return()=>{live.current=false;generation.current++;operation.current++;working.current=false;controller.current.abort();if(audioRef.current)URL.revokeObjectURL(audioRef.current);};},[]);
 useEffect(()=>{if(!reference?.expires_at||["expired","revoked"].includes(reference.state))return;const ticket=generation.current;
  const expire=()=>{if(current(ticket)){clearAudio();setReference(value=>value?{...value,state:"expired",can_audition:false,can_confirm:false}:value);}};
  const remaining=Date.parse(reference.expires_at)-Date.now();if(remaining<=0){expire();return;}const timer=window.setTimeout(expire,Math.min(remaining,2147483647));return()=>window.clearTimeout(timer);
 },[reference?.expires_at,reference?.state]);
 const matchesSource=(o:{purpose?:string;source_id?:string})=>o.purpose==="comparison_reference"||o.source_id===expectedSourceId;
 const option=options?.options.find(o=>o.artifact_id===selected&&matchesSource(o));
 const terminal=reference?.state==="revoked"||reference?.state==="expired";
 async function authorize(){
  if(!option||savedRef.current||!COMPARISON_USE_KEYS.every(k=>checks[k]))return;
  await run(async()=>{const ticket=generation.current;
   const pending={id:crypto.randomUUID(),withdrawing:false};persist(pending);
   await writeComparisonReference(token,replicaId,pending.id,{op:"authorize",artifact_id:option.artifact_id,expected_snapshot_hash:option.snapshot_hash,
    attestations:Object.fromEntries(COMPARISON_USE_KEYS.map(k=>[k,true])) as Record<ComparisonUseKey,true>},controller.current.signal);
   if(current(ticket))await refresh();
  },true);
 }
 async function audition(){if(!saved||saved.withdrawing||!reference?.can_audition)return;await run(async()=>{const ticket=generation.current;
  clearAudio();const blob=await getComparisonAudio(token,replicaId,saved.id,controller.current.signal);if(!current(ticket))return;
  const value=await getComparisonReference(token,replicaId,saved.id,controller.current.signal);if(!current(ticket))return;
  setReference(value);if(!value.can_audition||!matchesSource(value))throw Error("comparison_changed");
  const url=URL.createObjectURL(blob);audioRef.current=url;setAudio(url);
 });}
 async function confirm(){if(!saved||saved.withdrawing||!confirmed||!reference?.can_confirm||!reference.snapshot_hash||!matchesSource(reference))return;
  await run(async()=>{const ticket=generation.current;const value=await writeComparisonReference(token,replicaId,saved.id,{op:"confirm",expected_snapshot_hash:reference.snapshot_hash!,confirm_this_is_my_voice:true},controller.current.signal);
   if(!current(ticket))return;setReference(value);clearAudio();if(value.state==="selected")onSelectionChanged?.();setMessage(value.state==="selected"?"Saved for private comparison.":"Check the saved status before continuing.");},true);
 }
 async function withdraw(){if(!saved)return;await run(async()=>{const ticket=generation.current;
  persist({...saved,withdrawing:true});clearAudio();setReference(null);
  const value=await writeComparisonReference(token,replicaId,saved.id,{op:"withdraw"},controller.current.signal);if(!current(ticket))return;
  setReference(value);if(value.state!=="revoked")throw Error("withdraw_unconfirmed");persist({...saved,withdrawing:false});onSelectionChanged?.();
 },true);}
 async function startAgain(){if(!terminal)return;await run(async()=>{persist(null);setReference(null);clearAudio();await refresh();});}
 return <section className="cvj-comparison-reference" aria-labelledby="comparison-reference-title">
  <details onToggle={event=>setPreparationOpen(event.currentTarget.open)}><summary>Add a comparison recording</summary>{preparationOpen?<ComparisonPreparation key={JSON.stringify([ownerUserId,token,replicaId])} token={token} ownerUserId={ownerUserId} replicaId={replicaId} onAuthError={onAuthError} onPrepared={()=>{void run(refresh);}} onWithdrawn={()=>{onSelectionChanged?.();void run(refresh);}}/>:null}</details>
  <h2 id="comparison-reference-title">Your comparison recording</h2>
  <p>Choose a prepared version of your recording for private comparison.</p>
  {message?<p role="status">{message}</p>:null}
  {busy?<p role="status">Checking your private choice</p>:null}
  {!saved&&options?.state==="unavailable"&&!options.next_cursor?<p>No compatible prepared recording is available yet.</p>:null}
  {!saved&&options?.next_cursor?<button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void run(async()=>{const ticket=generation.current;const next=await getComparisonOptions(token,replicaId,controller.current.signal,options.next_cursor);if(!current(ticket))return;const combined=[...options.options,...next.options];setOptions({...next,options:combined,state:combined.length?"available":"unavailable"});})}>Check more prepared versions</button>:null}
  {!saved&&options?.state==="available"?<>
   <label>Prepared version<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setChecks({});clearAudio();}}>
    <option value="">Choose a version</option>{options.options.filter(matchesSource).map((o,i)=><option key={o.artifact_id} value={o.artifact_id}>Version {i+1}, {new Date(o.source_created_at).toLocaleDateString()}{o.duration_ms?`, ${Math.round(o.duration_ms/1000)} seconds`:""}</option>)}
   </select></label>
   {option?<fieldset disabled={busy}><legend>Allow private comparison</legend>
    <label><input type="checkbox" checked={!!checks.use_existing_voice_evidence} onChange={e=>setChecks({...checks,use_existing_voice_evidence:e.target.checked})}/>Use this recording’s existing voice evidence for private comparison.</label>
    <label><input type="checkbox" checked={!!checks.comparison_only} onChange={e=>setChecks({...checks,comparison_only:e.target.checked})}/>This does not allow voice generation or training.</label>
    <label><input type="checkbox" checked={!!checks.understand_reference_withdrawal} onChange={e=>setChecks({...checks,understand_reference_withdrawal:e.target.checked})}/>Keep this choice for up to one day. I can withdraw it.</label>
   </fieldset>:null}
   <button className="cvj-primary" type="button" disabled={busy||!option||!COMPARISON_USE_KEYS.every(k=>checks[k])} onClick={()=>void authorize()}>Allow and review recording</button>
  </>:null}
  {saved?<>
   {reference?.source_created_at?<p>Recording from {new Date(reference.source_created_at).toLocaleDateString()}{reference.duration_ms?`, ${Math.round(reference.duration_ms/1000)} seconds`:""}.</p>:null}
   {reference?.state==="selected"&&!saved.withdrawing?<p>Your comparison choice is saved. Live verification stays separate.</p>:null}
   {reference?.changed?<p>The recording or its permission changed. Withdraw this choice before reviewing another.</p>:null}
   {terminal?<p>{reference?.state==="revoked"?"This comparison permission is withdrawn.":"This comparison permission expired."}</p>:null}
   {saved.withdrawing?<p>Withdrawal is unconfirmed. This page will not use the recording while it is being checked.</p>:null}
   {!saved.withdrawing&&reference?.can_audition&&matchesSource(reference)?<button className="cvj-primary" type="button" disabled={busy} onClick={()=>void audition()}>Open private recording</button>:null}
   {audio&&!saved.withdrawing?<div><audio controls preload="metadata" src={audio} aria-label="Private comparison recording" onError={()=>{clearAudio();setMessage("This recording could not be played. Check its saved status.");}}/>
    {reference?.can_confirm?<><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I listened to this version and confirm this is my voice.</label>
     <button className="cvj-primary" type="button" disabled={busy||!confirmed} onClick={()=>void confirm()}>Use for private comparison</button></>:null}</div>:null}
   {!terminal?<button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void withdraw()}>{saved.withdrawing?"Retry withdrawal":"Withdraw this choice"}</button>:<button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void startAgain()}>Review a new choice</button>}
  </>:null}
  <button className="cvj-quiet" type="button" disabled={busy} onClick={()=>void run(refresh)}>{saved?"Check saved status":"Check prepared evidence"}</button>
 </section>;
}
