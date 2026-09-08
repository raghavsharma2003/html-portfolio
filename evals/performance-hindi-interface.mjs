import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installHindiInterfaceProbe} from '../scripts/performance-hindi-interface.mjs';
let checks=0;
const test=(name,fn)=>{fn();console.log('ok '+(++checks)+' '+name);};
function fixture({locale='hi',heading='ईमेल से शुरू करें',label='ईमेल पता',hidden=false,visible=true,hasInterface=true,hasControl=true,controlVisible=true,disabled=false,readOnly=false,associated=true,hiddenHindi=false}={}) {
  const element=(text,shown=visible)=>({textContent:text,closest:()=>hidden?{}:null,checkVisibility:()=>shown});
  const control={...element('',controlVisible),tagName:'INPUT',id:'studio-email',type:'email',disabled,readOnly};
  const headingElement=element(heading),labelElement={...element(label),htmlFor:associated?'studio-email':'elsewhere',control:hasControl?control:null};
  const root={contains:value=>value===control,querySelector:selector=>selector==='#signin-title'?headingElement:labelElement};
  const doc={body:{textContent:'व्य '+heading+' '+label},querySelector:()=>hasInterface&&locale==='hi'?root:null,createTreeWalker:element=>{
    const nodes=[{nodeValue:element.textContent,parentElement:hiddenHindi?{...element,closest:()=>({})}:element}];let index=0;return {nextNode:()=>nodes[index++]||null};
  }};
  const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window={};globalThis.document=doc;
  try {installHindiInterfaceProbe();return {actual:window.__VYAKTI_HINDI_INTERFACE__(),legacy:/[\u0900-\u097f]/.test(doc.body.textContent)};} finally {globalThis.window=oldWindow;globalThis.document=oldDocument;}
}

test('visible Hindi heading and actual field label count',()=>assert.equal(fixture().actual,true));
test('logo-only Hindi with English interface is rejected and catches legacy scan',()=>{const r=fixture({heading:'Start with email',label:'Email address'});assert.equal(r.actual,false);assert.equal(r.legacy,true);});
test('Hindi heading alone cannot disguise English controls',()=>assert.equal(fixture({label:'Email address'}).actual,false));
test('Hindi label alone cannot disguise English heading',()=>assert.equal(fixture({heading:'Check your inbox'}).actual,false));
test('English locale rejected even with logo text',()=>assert.equal(fixture({locale:'en'}).actual,false));
test('loading or error screen without interface cannot count',()=>assert.equal(fixture({hasInterface:false}).actual,false));
test('hidden, inert or aria-hidden ancestor rejected',()=>assert.equal(fixture({hidden:true}).actual,false));
test('CSS visibility failure rejected',()=>assert.equal(fixture({visible:false}).actual,false));
test('missing actual input rejected',()=>assert.equal(fixture({hasControl:false}).actual,false));
test('CSS-hidden actual input rejected',()=>assert.equal(fixture({controlVisible:false}).actual,false));
test('mismatched label association rejected',()=>assert.equal(fixture({associated:false}).actual,false));
test('disabled actual input rejected',()=>assert.equal(fixture({disabled:true}).actual,false));
test('readonly actual input rejected',()=>assert.equal(fixture({readOnly:true}).actual,false));
test('hidden Hindi descendant cannot qualify visible English parent',()=>assert.equal(fixture({hiddenHindi:true}).actual,false));
test('optional code step is Hindi interface too',()=>assert.equal(fixture({heading:'अपना इनबॉक्स देखें',label:'छह अंकों का कोड'}).actual,true));
test('actual caller installs and uses probe once, unchanged budgets/runs',()=>{const s=readFileSync(new URL('../scripts/check-performance.mjs',import.meta.url),'utf8');assert.equal(s.split('await page.addInitScript(installHindiInterfaceProbe)').length,2);assert(s.includes('window.__VYAKTI_HINDI_INTERFACE__?.()'));assert(!s.includes('devanagari.test(document.body.textContent'));assert(s.includes('const RUNS = 3;'));assert(s.includes('firstHindiPaintMs - perf.firstPaintMs'));});
console.log(checks+' controls; no browser');
