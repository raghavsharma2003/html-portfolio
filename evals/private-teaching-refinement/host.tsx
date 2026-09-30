import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Current from '../../src/studio/PrivateTextRehearsal';
import Old from 'virtual:old-private-result';
import OldRecovery from 'virtual:old-recovery-private-result';
import '../../src/studio/design/tokens.css';
import '../../src/studio/clone-experience.css';
const rid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const root=createRoot(document.getElementById('root')!);
function App(){const [scope,setScope]=useState({token:'synthetic-a',replica:rid,request:'60000000-0000-4000-8000-000000000001'});
 Object.assign(window,{refinementProbe:{change:(what:string)=>setScope(s=>({...s,...(what==='token'?{token:'synthetic-b'}:what==='replica'?{replica:other}:{request:'60000000-0000-4000-8000-000000000002'})})),hide:()=>root.unmount()}});
 const url=new URL(location.href);url.searchParams.set('replica',scope.replica);url.searchParams.set('rehearsal_request',scope.request);history.replaceState(null,'',url);
 const params=new URLSearchParams(location.search);
 const Panel=params.has('old')?Old:params.has('oldRecovery')?OldRecovery:Current;
 return <div className="vx-shell"><Panel key={scope.request} token={scope.token} replicaId={scope.replica} lifecycle="enrolling" onBack={()=>{}} onEditContext={()=>{}} onAuthError={()=>{}}/></div>;
}
root.render(<StrictMode><App/></StrictMode>);
