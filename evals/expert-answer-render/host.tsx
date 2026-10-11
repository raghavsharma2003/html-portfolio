import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ExpertAnswer from "../../src/studio/ExpertAnswer";
import retained from "./retained-grounding28-math.json";
import "../../src/studio/publication/publication.css";
import "../../src/studio/expert-experience.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";

const examples: Record<string,string> = {
  retained: retained.raw,
  hindi: String.raw`Period का मतलब एक oscillation का समय है। \(T=2.5\text{ s}\) और \(f=0.4\text{ Hz}\)। Length मापी नहीं गई।`,
  hinglish: String.raw`Checking pehle hua tha. \(18+25=43\) minutes hue. Group size source mein nahi diya gaya.`,
  literal: 'Price is $12.50, two dollars $$ and ₹200. <img src="/api/should-not-fetch" onerror="window.__mathInjected=1"> <script>window.__mathInjected=2</script> & plain <b>text</b>.',
  invalid: String.raw`Exact unsupported source: \[\frac{1}{\] and unmatched \(x+1.`,
  abuse: String.raw`\[\href{https://math-probe.invalid/href}{visit}\]
\[\includegraphics{https://math-probe.invalid/image.png}\]
\[\htmlClass{unsafe}{x}\]
\[\def\cycle{\cycle}\cycle\]`,
  deniedLink: String.raw`\[\href{https://math-probe.invalid/href}{keep this label}\]\[\url{https://math-probe.invalid/source}\]\[\includegraphics{https://math-probe.invalid/full-image.png}\]`,
  deniedAlias: String.raw`\[\def\linkalias{\href}\linkalias{https://math-probe.invalid/alias}{keep alias label}\]`,
  deniedMalformed: '\\[\\href{java'+String.fromCharCode(1)+'script:alert(1)}{keep malformed label}\\]',
  macros: String.raw`\[\gdef\privateMacro{123}\privateMacro\]
\[\privateMacro\]`,
  wide: '\\[' + Array.from({length:30},(_,i)=>String.raw`\frac{a_{${i}}+b_{${i}}}{1+c_{${i}}}`).join(' + ') + '= Z\\]',
  first: String.raw`Old scope \[a=17\]`,
  replacement: String.raw`New scope \[z=29\]`,
  ordinary: 'Only ordinary Hindi: स्रोत में length नहीं है। Hinglish: source mein nahi diya. Price $12.50.',
  many: Array.from({length:70},(_,i)=>'\\(x_{'+i+'}\\)').join('\n')+'\ncomplete tail',
  multiline: '\\[\n\\unknowncommand{one}\n  two\n\\]',
  oversized: '\\['+'x'.repeat(4097)+'\\]',
};
function Host(){
 const params=new URLSearchParams(location.search),[text,setText]=useState(examples[params.get('case')||'retained']),[visible,setVisible]=useState(true);
 const old=params.get('old')==='1',privateSurface=params.get('surface')==='private';
 return <main className="vp-page"><div className="vp-conversation">
   <h1>Answer review</h1>
   <label>Example<select aria-label="Example" defaultValue={params.get('case')||'retained'} onChange={e=>{setText(examples[e.target.value]);setVisible(true);}}>{Object.keys(examples).map(key=><option key={key} value={key}>{key}</option>)}</select></label>
   <button type="button" onClick={()=>setText(examples.replacement)}>Replace answer</button><button type="button" onClick={()=>setText(examples.invalid)}>Invalid replacement</button><button type="button" onClick={()=>setVisible(false)}>Hide answer</button><button type="button" onClick={()=>setVisible(true)}>Show answer</button>
   <section data-testid="answer-surface" className={privateSurface?'expert-exchange__answer':'vp-answer vp-answer-text'} aria-label="Answer">{visible&&(old?<p data-testid="old-answer">{text}</p>:<ExpertAnswer text={text}/>)}</section>
   <button type="button" id="after-answer">Continue</button>
 </div></main>;
}
createRoot(document.getElementById('root')!).render(<Host/>);
