import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Creator from '../../src/creatorStudio/TeacherSheetStudio';
import Studio from '../../src/studio/TeacherSheetStudio';
import OldCreator from 'virtual:old-race-creator';
import OldStudio from 'virtual:old-race-studio';
import {readTeacherSheetDraft} from '../../src/studio/teacherSheetApi';
import {StudioLocaleProvider} from '../../src/creatorStudio/localeContext';
import '../../src/creatorStudio/studio.css';
const params=new URLSearchParams(location.search),rid='10000000-0000-4000-8000-000000000001';
const Editor=params.has('old')?(params.has('studio')?OldStudio:OldCreator):params.has('studio')?Studio:Creator;
function App(){
 const [draft,setDraft]=useState<any>(null),[token,setToken]=useState('synthetic-owner'),[visible,setVisible]=useState(true),[id,setId]=useState(rid);
 useEffect(()=>{let current=true;void readTeacherSheetDraft('synthetic-owner',rid).then(s=>{if(current)setDraft(s.draft);});return()=>{current=false;};},[]);
 Object.assign(window,{editorRaceProbe:{token:()=>setToken('replacement-owner-token'),replica:()=>setId('10000000-0000-4000-8000-000000000002'),hide:()=>setVisible(false)}});
 return <StudioLocaleProvider locale={params.has('hi')?'hi':'en'}><main className="studio-shell" style={{maxWidth:1160,margin:'24px auto',padding:16}}><h1>Teaching sheet</h1>{visible&&draft&&<Editor key={id} token={token} replicaId={id} sheetDraft={draft} sheetProvenance="draft" onAuthError={onAuth}/>}</main></StudioLocaleProvider>;
}
function onAuth(){Object.assign(window,{editorRaceAuthError:true});}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
