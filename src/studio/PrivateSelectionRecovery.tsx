import {useEffect, useRef, useState} from 'react';
import {ReplicaApiError, replicaRequest} from './replicaApi';
import {readRememberedStudioLocale, resolveStudioLocale} from '../creatorStudio/studioLocalePreference';

type RecoveryStatus = {replica_id:string;candidate_id:null;active_capability_id:string|null;
  can_reset:boolean;reset_target_capability_id:string|null};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function parsePrivateSelectionRecovery(value:unknown,replicaId:string):RecoveryStatus{
  const row=value as RecoveryStatus;
  if(!row||typeof row!=='object'||!uuid(row.replica_id)||row.replica_id!==replicaId||row.candidate_id!==null
    ||typeof row.can_reset!=='boolean'||!(row.active_capability_id===null||uuid(row.active_capability_id))
    ||!(row.reset_target_capability_id===null||uuid(row.reset_target_capability_id))
    ||(row.can_reset&&(!row.active_capability_id||!row.reset_target_capability_id||row.active_capability_id===row.reset_target_capability_id)))
    throw new ReplicaApiError('Private recovery status could not be verified',502,{});
  return row;
}
export default function PrivateSelectionRecovery({token,replicaId,onAuthError}:{token:string;replicaId:string;onAuthError:(cause:unknown)=>void}){
  const urlLocale=typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('lang');
  const language=resolveStudioLocale({urlLocale:urlLocale==='hi'||urlLocale==='en'?urlLocale:null,replica:null,rememberedLocale:readRememberedStudioLocale()});
  const hi=language==='hi',scope=JSON.stringify([token,replicaId]),latest=useRef(scope);latest.current=scope;
  const auth=useRef(onAuthError);auth.current=onAuthError;
  const epoch=useRef(0),pending=useRef<AbortController|null>(null),uncertain=useRef<{scope:string;previous:string|null}|null>(null);
  const [view,setView]=useState<{scope:string;status:RecoveryStatus|null}>({scope,status:null});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const status=view.scope===scope?view.status:null;
  async function run(op:'status'|'reset'){
    if(pending.current||(op==='reset'&&!status?.can_reset))return;
    const controller=new AbortController(),requestScope=scope,runEpoch=++epoch.current;
    pending.current=controller;setBusy(true);setError('');
    if(op==='reset')uncertain.current={scope:requestScope,previous:status!.active_capability_id};
    const current=()=>runEpoch===epoch.current&&latest.current===requestScope;
    const timer=setTimeout(()=>controller.abort(),25_000);
    try{
      const body={op,replica_id:replicaId,...(op==='reset'?{expected_capability_id:status!.active_capability_id,target_capability_id:status!.reset_target_capability_id}:{})};
      let next=parsePrivateSelectionRecovery(await replicaRequest<unknown>(token,'/api/replica-candidate-activation',{
        method:'POST',body:JSON.stringify(body),signal:controller.signal,
      }),replicaId);
      if(op==='reset'&&current())next=parsePrivateSelectionRecovery(await replicaRequest<unknown>(token,'/api/replica-candidate-activation',{
        method:'POST',body:JSON.stringify({op:'status',replica_id:replicaId}),signal:controller.signal,
      }),replicaId);
      if(!current())return;
      setView({scope:requestScope,status:next});
      if(next.active_capability_id&&(op==='reset'||(uncertain.current?.scope===requestScope&&uncertain.current.previous!==next.active_capability_id))){
        uncertain.current=null;
        window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed',{detail:{replica_id:replicaId,capability_id:next.active_capability_id}}));
      }
    }catch(cause){
      if(!current())return;setView({scope:requestScope,status:null});
      const changed=cause instanceof ReplicaApiError&&cause.status===409&&cause.data?.error==='candidate_selection_changed';
      setError(changed?(hi?'आपका चयन बदल गया है। ताज़ा स्थिति देखें।':'Your selection changed. Check the latest status.')
        :hi?'पुष्टि नहीं हुई। आगे बढ़ने से पहले स्थिति देखें।':'Recovery is unconfirmed. Check status before continuing.');
      if(cause instanceof ReplicaApiError&&cause.status===401)auth.current(cause);
    }finally{clearTimeout(timer);if(current()){pending.current=null;setBusy(false);}}
  }
  useEffect(()=>{
    epoch.current++;pending.current?.abort();pending.current=null;uncertain.current=null;
    setView({scope,status:null});setBusy(false);setError('');void run('status');
    return()=>{epoch.current++;pending.current?.abort();pending.current=null;};
    // The authenticated scope owns requests. Never start a reset from an effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);
  return <div aria-label={hi?'निजी AI वापस चालू करें':'Recover private AI'} aria-busy={busy}>
    <div className="expert-conversation__actions" style={{display:'flex',flexWrap:'wrap',gap:8}}>
      <button type="button" style={{minHeight:44}} disabled={busy||!status?.can_reset} onClick={()=>void run('reset')}>
        {hi?'मौजूदा AI इस्तेमाल करें':'Use current AI'}</button>
      <button type="button" style={{minHeight:44}} disabled={busy} onClick={()=>void run('status')}>
        {hi?'ताज़ा स्थिति देखें':'Check recovery status'}</button>
    </div>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
