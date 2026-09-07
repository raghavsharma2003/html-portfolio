import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Recorder from 'virtual:recorder-component';

const counts={open:0,start:0,stop:0,cancel:0,proceed:0};
let permission:(value:unknown)=>void;
let completion:(value:unknown)=>void;
const revoked:string[]=[];
const created:string[]=[];
const media:any[]=[];
const originalCreate=URL.createObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=originalCreate(blob);created.push(url);return url;};
(window as any).Audio=function(){const sample={duration:13,onloadedmetadata:null,onerror:null,preload:'',src:'',removeAttribute(){},load(){}};media.push(sample);return sample;};
const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
const originalRevoke=URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL=url=>{revoked.push(url);originalRevoke(url);};
const probe={counts,revoked,created,media,effects:0,
  finishMedia:(index:number)=>media[index].onloadedmetadata?.(),
  onLevel:null as null|((level:number,peak:number)=>void),
  open:async(options:any)=>{counts.open++;probe.onLevel=options.onLevel;return new Promise(resolve=>{permission=resolve;});},
  resolveOpen:()=>permission({start(){counts.start++;probe.onLevel?.(.5,.2);},stop(){counts.stop++;return new Promise(resolve=>completion=resolve);},async cancel(){counts.cancel++;}}),
  resolveStop:()=>completion({file:new File(['fixture'],'fixture.wav',{type:'audio/wav'}),url:'blob:recorder-result',durationMs:13000}),
  advanceTime:()=>{offset+=13000;},
  unmount:()=>{},
};
(window as any).recorderProbe=probe;
function Host(){const[show,setShow]=useState(true);probe.unmount=()=>flushSync(()=>setShow(false));useEffect(()=>{probe.effects++;},[]);return show?<Recorder onProceed={()=>{counts.proceed++;}}/>:<p>Recorder closed</p>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Host/></React.StrictMode>);
