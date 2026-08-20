import { runCall } from "./run.mjs";
const c = Number(process.argv[2] ?? -18);
const P=[]; globalThis.__TAP=(x)=>P.push(x);
await runCall({ couplingDb:c, seed:11, user:null });
const t0=P[0].t;
for (let i=0;i<Math.min(P.length,70);i++){
  const p=P[i]; if(!p.herSpeaking) continue;
  console.log(`t=${String(Math.round(p.t-t0)).padStart(5)} herMax=${p.herMax.toFixed(3)} herNow=${p.herNow.toFixed(3)} lag=${p.echoLag} k=${p.kappa.toFixed(3)} lock=${p.echoLocked?1:0} thrB=${p.thrB.toFixed(4)} echo=${p.echoTerm.toFixed(4)} subMax=${Math.max(...p.sub).toFixed(4)} hard=${p.hard} soft=${p.soft} hold=${p.hold} d=${p.ducked}`);
}
