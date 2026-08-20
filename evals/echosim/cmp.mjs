import { runCall } from "./run.mjs";
const TURNS=[{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const P=[]; globalThis.__TAP=(x)=>{ if(x.t>=0) P.push(x); };
const r = await runCall({couplingDb:-12,seed:11,user:{startMs:11000,durMs:3000,level:0.10},herTurns:TURNS,deliverS:2.5,totalS:26});
globalThis.__TAP=null;
const t0=P[0].t;
const rows=P.filter(p=>p.t-t0>10700 && p.t-t0<14500);
for (const p of rows) console.log(
 `t=${String(Math.round(p.t-t0)).padStart(5)} her=${p.herSpeaking?1:0} herMax=${p.herMax.toFixed(3)} herNow=${p.herNow.toFixed(3)} k=${p.kappa.toFixed(3)} echo=${p.echoTerm.toFixed(4)} thrB=${p.thrB.toFixed(4)} thrS=${p.thrS.toFixed(4)} subMax=${Math.max(...p.sub).toFixed(4)} hard=${p.hard} soft=${p.soft} hold=${p.hold}`);
console.log("release:", JSON.stringify(r.diag.filter(d=>d.t>10500).map(d=>[d.event,Math.round(d.t)])));
