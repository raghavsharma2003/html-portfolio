import React, {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Current from '../../src/studio/ContextLockerPanel';
import Old from 'virtual:old-context-locker';
import '../../src/studio/studio.css';
const rid='10000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000001';
const probe={events:[] as string[],switchReplica:()=>{},switchToken:()=>{},hide:()=>{}};
(window as any).attributionProbe=probe;
const count=(n:number)=>probe.events.push('count:'+n),proposals=(n:number)=>probe.events.push('proposals:'+n),auth=()=>probe.events.push('auth');
function App(){
 const [scope,setScope]=useState({replica:rid,token:'synthetic-a'}),[shown,setShown]=useState(true);
 useEffect(()=>{probe.switchReplica=()=>flushSync(()=>setScope({replica:other,token:'synthetic-b'}));probe.switchToken=()=>flushSync(()=>setScope({replica:rid,token:'synthetic-b'}));probe.hide=()=>flushSync(()=>setShown(false));},[]);
 const Panel=new URLSearchParams(location.search).has('old')?Old:Current;
 return <main className="studio-shell" style={{maxWidth:960,margin:'24px auto',padding:16}}>{shown?<Panel token={scope.token} replicaId={scope.replica} onItemCount={count} onProposals={proposals} onAuthError={auth} testEnvironment/>:<p>Panel closed</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
