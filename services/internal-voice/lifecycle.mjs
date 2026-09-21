import {fail} from './contract.mjs';
export function createInternalLifecycle(store,config,now=Date.now){
  const find=(s,id)=>{const r=Object.values(s.runs).find(r=>r.window?.window_id===id);if(!r)fail('internal_voice_window_missing');return r;};
  const mutate=(id,fn)=>store.update(s=>fn(find(s,id),s));
  const current=r=>!r.revoked_at&&r.state==='running'&&r.authorization_sha256===config.grantHash&&Date.parse(r.expires_at)>now();
  return {
    getWindow:async id=>structuredClone(find(await store.read(),id).window),
    getSupervisorLease:async()=>({...((await store.read()).supervisor),server_now:new Date(now()).toISOString()}),
    claimActivation:id=>mutate(id,r=>{if(!current(r)||r.window.state!=='open'||r.window.activation_state!=='not_started')return false;r.window.activation_state='claimed';return true;}),
    authorizeActivationDispatch:id=>mutate(id,r=>{if(!current(r)||r.window.state!=='open'||r.window.activation_state!=='claimed'||r.window.activation_dispatched_at)return false;r.window.activation_dispatched_at=new Date(now()).toISOString();return true;}),
    recordActivation:(id,v)=>mutate(id,r=>{if(r.window.activation_state!=='claimed')return false;r.window.activation_state=v;return true;}),
    revokeAdmission:id=>mutate(id,r=>{if(r.window.state==='open')r.window.state='closing';return true;}),
    claimClose:id=>mutate(id,r=>{if(r.window.state!=='closing'||r.window.deactivation_state!=='not_started')return false;r.window.state='close_claimed';r.window.deactivation_state='claimed';return true;}),
    authorizeDeactivationDispatch:id=>mutate(id,r=>{if(r.window.deactivation_state!=='claimed'||r.window.deactivation_dispatched_at)return false;r.window.deactivation_dispatched_at=new Date(now()).toISOString();return true;}),
    recordDeactivation:(id,v)=>mutate(id,r=>{if(r.window.deactivation_state!=='claimed')return false;r.window.deactivation_state=v;return true;}),
    recordObservation:(id,value)=>mutate(id,r=>{r.window.observation=value;if(value.terminal)r.window.state='terminal_observed';else if(r.window.state!=='open')r.window.state='observation_unknown';return true;}),
  };
}
