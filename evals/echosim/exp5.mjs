import { runCall } from "./run.mjs";
for (const c of [-3,-6,-9,-12,-18]) {
  const K=[], L=[];
  for (const seed of [11,23,37,41,59,71,89,97]) {
    const P=[]; globalThis.__TAP=(x)=>{ if(x.herSpeaking) P.push(x); };
    await runCall({ couplingDb:c, seed, user:null });
    globalThis.__TAP=null;
    if (P.length) { K.push(P[P.length-1].kappa); L.push(P.filter(p=>p.echoLocked).length/P.length); }
  }
  const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
  console.log(`coupling ${String(c).padStart(3)}dB  true C=${Math.pow(10,c/20).toFixed(3)}  kappa_end med=${med(K).toFixed(3)}  lock rate ${(100*med(L)).toFixed(0)}%`);
}
