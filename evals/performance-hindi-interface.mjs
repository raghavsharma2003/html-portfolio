import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {installHindiInterfaceProbe} from '../scripts/performance-hindi-interface.mjs';
let count=0;const test=(name,fn)=>{fn();console.log(`ok ${++count} ${name}`);};
function fixture(options={},exercise){
 const saved=Object.fromEntries(['window','document','IntersectionObserver','IntersectionObserverEntry','MutationObserver'].map(k=>[k,globalThis[k]]));
 const ios=[];let mo;
 const element=(text='')=>({textContent:text,hidden:false,rendered:true,closest(){return this.hidden?{}:null;},checkVisibility(){throw Error('forbidden style read');},getBoundingClientRect(){throw Error('forbidden geometry read');}});
 const heading=element(options.heading??'ईमेल से शुरू करें'),label=element(options.label??'ईमेल पता'),control=Object.assign(element(),{id:'studio-email',tagName:'INPUT',type:'email',disabled:false,readOnly:false});label.control=control;label.htmlFor='studio-email';
 Object.assign(control,options.control||{});if(options.missing)label.control=null;if(options.badAssociation)label.htmlFor='wrong';
 const root=Object.assign(element(),{contains:n=>n===control,querySelector:s=>s==='#signin-title'?heading:label});if(options.hidden)root.hidden=true;
 const document={querySelector:()=>options.locale==='en'||options.noRoot?null:root,createTreeWalker:el=>{let used=false;return {nextNode:()=>used?null:(used=true,{nodeValue:el.textContent,parentElement:el})};}};
 class IO{constructor(callback,config){if(options.constructorFailure)throw Error('constructor failure');this.callback=callback;this.trackVisibility=!options.unsupportedProperty;this.targets=[];this.config=config;ios.push(this);}observe(n){if(options.observeFailure)throw Error('observe failure');this.targets.push(n);}disconnect(){this.disconnected=true;}deliver(override={}){this.callback(this.targets.map(target=>({target,time:10,isVisible:target.rendered,isIntersecting:true,intersectionRatio:1,...override})));}}
 class MO{constructor(callback){this.callback=callback;this.records=[];mo=this;}observe(){}disconnect(){}takeRecords(){return this.records.splice(0);}}
 globalThis.window={};globalThis.document=document;globalThis.IntersectionObserver=options.unsupported?undefined:IO;globalThis.IntersectionObserverEntry=function(){};globalThis.IntersectionObserverEntry.prototype.isVisible=true;globalThis.MutationObserver=MO;
 try{installHindiInterfaceProbe();const api={heading,label,control,root,ios,mo,read:()=>window.__VYAKTI_HINDI_INTERFACE__(),state:window.__VYAKTI_HINDI_INTERFACE_STATE__,deliver:override=>ios.at(-1)?.deliver(override),stop:()=>window.__VYAKTI_HINDI_INTERFACE_STOP__()};if(exercise)return exercise(api);api.deliver();return api.read();}finally{window.__VYAKTI_HINDI_INTERFACE_STOP__?.();Object.assign(globalThis,saved);}
}
test('renderer-observed actual heading label control succeeds',()=>assert.equal(fixture(),true));
test('no delivery cannot pass',()=>fixture({},a=>assert.equal(a.read(),false)));
test('logo/English heading does not pass',()=>assert.equal(fixture({heading:'Start with email'}),false));
test('English label does not pass',()=>assert.equal(fixture({label:'Email'}),false));
test('wrong locale does not pass',()=>assert.equal(fixture({locale:'en'}),false));
test('loading shell does not pass',()=>assert.equal(fixture({noRoot:true}),false));
test('missing control does not pass',()=>assert.equal(fixture({missing:true}),false));
test('association mismatch does not pass',()=>assert.equal(fixture({badAssociation:true}),false));
for(const key of ['disabled','readOnly'])test(`${key} control rejected`,()=>assert.equal(fixture({control:{[key]:true}}),false));
test('wrong type rejected',()=>assert.equal(fixture({control:{type:'checkbox'}}),false));
test('hidden/inert semantic ancestor rejected',()=>assert.equal(fixture({hidden:true}),false));
test('CSS-hidden heading evidence rejected',()=>fixture({},a=>{a.heading.rendered=false;a.deliver();assert.equal(a.read(),false);}));
test('CSS-hidden input evidence rejected',()=>fixture({},a=>{a.control.rendered=false;a.deliver();assert.equal(a.read(),false);}));
test('offscreen input rejected',()=>fixture({},a=>{a.deliver({isIntersecting:false,intersectionRatio:0});assert.equal(a.read(),false);}));
test('missing isVisible unavailable',()=>fixture({},a=>{a.deliver({isVisible:undefined});assert.equal(a.read(),false);assert.equal(a.state.status,'unsupported');}));
test('unsupported IO unavailable',()=>assert.equal(fixture({unsupported:true}),false));
test('unsupported trackVisibility unavailable',()=>assert.equal(fixture({unsupportedProperty:true}),false));
for(const key of ['constructorFailure','observeFailure'])test(`${key} becomes explicit unavailable`,()=>fixture({[key]:true},a=>{assert.equal(a.read(),false);assert.equal(a.state.status,'unavailable');}));
test('100ms delivery minimum is explicit',()=>fixture({},a=>assert.deepEqual(a.ios[0].config,{trackVisibility:true,delay:100,threshold:0})));
test('mutation synchronously invalidates cached success',()=>fixture({},a=>{a.deliver();assert.equal(a.read(),true);a.mo.records.push({});assert.equal(a.read(),false);assert.equal(a.state.generation,2);}));
test('old generation callback cannot resurrect success',()=>fixture({},a=>{const old=a.ios[0];a.mo.callback();old.deliver();assert.equal(a.read(),false);a.deliver();assert.equal(a.read(),true);}));
test('disable after positive invalidates even before observer callback',()=>fixture({},a=>{a.deliver();a.control.disabled=true;assert.equal(a.read(),false);}));
test('new generation needs new delivery after hide/unhide',()=>fixture({},a=>{a.deliver();a.heading.hidden=true;a.mo.callback();assert.equal(a.read(),false);a.heading.hidden=false;a.mo.callback();assert.equal(a.read(),false);a.deliver();assert.equal(a.read(),true);}));
test('stop prevents retained success and disconnects',()=>fixture({},a=>{a.deliver();a.stop();assert.equal(a.read(),false);assert.equal(a.ios[0].disconnected,true);}));
test('generation cap never passes',()=>fixture({},a=>{for(let i=0;i<257;i++)a.mo.callback();assert.equal(a.state.status,'generation-limit');assert.equal(a.read(),false);}));
test('source contains no synchronous style/geometry call',()=>{const s=readFileSync(new URL('../scripts/performance-hindi-interface.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/checkVisibility|getComputedStyle|getBoundingClientRect/);});
test('gate uses callback timestamp without subtracting observer floor',()=>{const s=readFileSync(new URL('../scripts/check-performance.mjs',import.meta.url),'utf8');assert.ok(s.includes('window.__VYAKTI_HINDI_INTERFACE_READY__ = markIfHindi'));assert.ok(s.includes('firstHindiPaintMs = performance.now()'));assert.ok(s.includes('const RUNS = 3;'));assert.ok(s.includes('perf.firstHindiPaintMs - perf.firstPaintMs'));});
console.log(`${count} controls; no browser`);
