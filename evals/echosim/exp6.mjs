// The measurement that matters: a whole call, not one turn. Three of her turns,
// κ persisting across them the way it does in a real session.
//   ARM A  nobody in the room  → everything observed is self-inflicted
//   ARM B  the owner barges in during her SECOND turn (κ already locked)
import { runCall } from "./run.mjs";
const SEEDS = [11,23,37,41,59,71,89,97];
const TURNS = [{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const COUPLINGS = [-3,-6,-9,-12,-18];
const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
const rows=[];
for (const c of COUPLINGS) {
  let rel=0,duck=0,her=0,n=0; const leak=[],hard=[];
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb:c, seed, user:null, herTurns:TURNS, deliverS:2.5, totalS:26 });
    n++;
    if (r.diag.some(d=>d.event==="floor_release")) rel++;
    duck+=r.selfDuckTicks; her+=r.herTicks; leak.push(Math.round(r.uplinkSpeechTotalMs)); hard.push(r.maxHard);
  }
  let got=0; const ms=[];
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb:c, seed, user:{startMs:11000,durMs:2500,level:0.25}, herTurns:TURNS, deliverS:2.5, totalS:26 });
    const rl=r.diag.find(d=>d.event==="floor_release"&&d.t>10500);
    if (rl){got++;ms.push(Math.round(rl.t-11000));}
  }
  const row={couplingDb:c,selfRelease:`${rel}/${n}`,selfDuckPct:Math.round(100*duck/Math.max(1,her)),
    leakMsMed:med(leak),leakMsMax:Math.max(...leak),hardMax:`${Math.max(...hard)}/26`,
    bargeIn:`${got}/${SEEDS.length}`,bargeMsMed:ms.length?med(ms):null};
  rows.push(row); console.log(JSON.stringify(row));
}
console.table(rows);
