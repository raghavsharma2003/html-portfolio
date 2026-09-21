import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Creator from '../../src/creatorStudio/TeacherSheetStudio';
import Studio from '../../src/studio/TeacherSheetStudio';
import OldCreator from 'virtual:old-publication-editor';
import OldLoadCreator from 'virtual:old-load-creator';
import OldLoadStudio from 'virtual:old-load-studio';
import Publication from '../../src/studio/TeacherSheetPublication';
import {teacherSheetPublicationClient as api,readTeacherSheetPublicationReview} from '../../src/creatorStudio/teacherSheetApi';
import {StudioLocaleProvider} from '../../src/creatorStudio/localeContext';
import {DEMO_TEACHER} from '../../src/engine/agents/characters/demoTeacher';
import '../../src/creatorStudio/studio.css';
const params=new URLSearchParams(location.search),initial='33333333-3333-4333-8333-333333333333';
const full={...DEMO_TEACHER,name:'Anjali',slug:'publication-fixture'};
let auth=0;const onAuth=()=>{auth++;};
function App(){
 const [replica,setReplica]=useState(initial),[draft,setDraft]=useState<any>(full),[visible,setVisible]=useState(true),[callback,setCallback]=useState(()=>onAuth);
 (window as any).publicationProbe={full,hide:()=>setVisible(false),scope:()=>setReplica('22222222-2222-4222-8222-222222222222'),edit:()=>setDraft({...full,identityWho:'Local changed identity'}),callback:()=>setCallback(()=>()=>{auth++;}),auth:()=>auth,read:()=>readTeacherSheetPublicationReview('synthetic-owner',initial)};
 const Editor=params.has('old')?OldCreator:params.has('oldLoad')?(params.has('studio')?OldLoadStudio:OldLoadCreator):params.has('studio')?Studio:Creator;
 return <StudioLocaleProvider locale={params.has('hi')?'hi':'en'}><main className="studio-shell" style={{maxWidth:1160,margin:'24px auto',padding:16}}><h1>Teaching sheet</h1>{visible&&(params.has('leaf')?<Publication token="synthetic-owner" replicaId={replica} draft={draft} api={api} onAuthError={callback}/>:<Editor token="synthetic-owner" replicaId={replica} sheetDraft={draft} sheetProvenance="draft" onAuthError={callback}/>)}</main></StudioLocaleProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
