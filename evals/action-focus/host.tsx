import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Locker from '../../src/studio/ContextLockerPanel';
import Private from '../../src/studio/PrivateTextRehearsal';
import OldLocker from 'virtual:old-locker';
import OldPrivate from 'virtual:old-private';
import '../../src/creatorStudio/studio.css';
const query=new URLSearchParams(location.search),old=query.has('old'),locker=query.has('locker');
const auth=()=>{(window as any).focusProbeAuth=true;};
function App(){const [token,setToken]=useState('synthetic-owner'),[rid,setRid]=useState('10000000-0000-4000-8000-000000000001'),[visible,setVisible]=useState(true);(window as any).focusProbe={token:()=>setToken('replacement-owner'),replica:()=>setRid('10000000-0000-4000-8000-000000000002'),hide:()=>setVisible(false)};const C=old?OldLocker:Locker,P=old?OldPrivate:Private;return <main className="studio-shell" style={{maxWidth:1160,margin:'24px auto',padding:'90px 16px 16px'}}><div style={{position:'fixed',top:0,left:0,right:0,height:64,zIndex:2,background:'#f8f8f5',display:'flex',alignItems:'center',gap:12}}><label>Other work<input id="other-work" style={{width:120}}/></label><button id="other-control">Other action</button></div>{visible?(locker?<C token={token} replicaId={rid} onAuthError={auth} onTestSource={()=>{(window as any).focusProbeTest=true;}}/>:<P token={token} replicaId={rid} lifecycle="enrolling" onAuthError={auth} onBack={()=>{}} onEditContext={()=>{}}/>):null}</main>}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
