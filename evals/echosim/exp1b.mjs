// Longer turns = more 850ms windows for her own echo to complete a claim in.
import { runCall } from "./run.mjs";
const SEEDS = [11,23,37,41,59,71,89,97,101,113];
for (const c of [-3,-4.5,-6,-7.5,-9]) {
  let rel=0, yld=0, n=0; const hard=[], leak=[];
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb:c, seed, user:null, herDurS:20, deliverS:4, totalS:24 });
    n++;
    if (r.diag.some(d=>d.event==="floor_release")) rel++;
    if (r.diag.some(d=>d.event==="floor_yield")) yld++;
    hard.push(r.maxHard); leak.push(Math.round(r.uplinkSpeechTotalMs));
  }
  const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
  console.log(`coupling ${c} dB  self-release ${rel}/${n}  self-cutoff ${yld}/${n}  hardMax ${Math.max(...hard)}/26  leakMs med ${med(leak)}`);
}
