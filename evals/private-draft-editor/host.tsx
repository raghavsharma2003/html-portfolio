import React, {Component, StrictMode, useEffect, useState, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import Creator from '../../src/creatorStudio/TeacherSheetStudio';
import Studio from '../../src/studio/TeacherSheetStudio';
import OldCreator from 'virtual:old-creator';
import OldStudio from 'virtual:old-studio';
import {readTeacherSheetDraft} from '../../src/creatorStudio/teacherSheetApi';
import {StudioLocaleProvider} from '../../src/creatorStudio/localeContext';
import {DEMO_TEACHER} from '../../src/engine/agents/characters/demoTeacher';
import {validateTeacherSheet} from '../../src/engine/agents/fromSheet';
import '../../src/creatorStudio/studio.css';
const params=new URLSearchParams(location.search),rid='10000000-0000-4000-8000-000000000001';
(window as any).editorProbe={validate:validateTeacherSheet,full:DEMO_TEACHER};
class Boundary extends Component<{children:ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return {error:e.message};}render(){return this.state.error?<p role="alert">Render failed: {this.state.error}</p>:this.props.children;}}
function App(){
 const [draft,setDraft]=useState<any>(null),[meet,setMeet]=useState(false);
 useEffect(()=>{let current=true;readTeacherSheetDraft('synthetic-owner',rid).then(s=>{if(current)setDraft(params.has('full')?DEMO_TEACHER:s.draft);});return()=>{current=false;};},[]);
 const Editor=params.has('studio')?(params.has('old')?OldStudio:Studio):(params.has('old')?OldCreator:Creator);
 return <StudioLocaleProvider locale={params.has('hi')?'hi':'en'}><main className="studio-shell" style={{maxWidth:1160,margin:'24px auto',padding:16}}><h1>Saved private draft</h1>{draft&&!meet?<button type="button" onClick={()=>setMeet(true)}>Meet it</button>:null}{meet?<Boundary><Editor token="synthetic-owner" replicaId={rid} sheetDraft={draft} sheetProvenance="draft" onAuthError={()=>{throw Error('unexpected auth error');}}/></Boundary>:null}</main></StudioLocaleProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
