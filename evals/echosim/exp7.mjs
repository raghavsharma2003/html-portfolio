import { runCall } from "./run.mjs";
const SEEDS=[11,23,37,41,59,71,89,97];
const TURNS=[{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
for (const c of [-1.5,-3,-6,-9]) {
  let rel=0,duck=0,her=0; const leak=[];
  for (const seed of SEEDS){
    const r=await runCall({couplingDb:c,seed,user:null,herTurns:TURNS,deliverS:2.5,totalS:26});
    if(r.diag.some(d=>d.event==="floor_release"))rel++;
    duck+=r.selfDuckTicks;her+=r.herTicks;leak.push(Math.round(r.uplinkSpeechTotalMs));
  }
  let got=0;const ms=[];
  for (const seed of SEEDS){
    const r=await runCall({couplingDb:c,seed,user:{startMs:11000,durMs:2500,level:0.25},herTurns:TURNS,deliverS:2.5,totalS:26});
    const rl=r.diag.find(d=>d.event==="floor_release"&&d.t>10500);
    if(rl){got++;ms.push(Math.round(rl.t-11000));}
  }
  console.log(`KMAX=${process.env.KMAX} coupling ${String(c).padStart(5)}dB  selfRelease ${rel}/8  duck ${Math.round(100*duck/Math.max(1,her))}%  leak ${med(leak)}ms  barge ${got}/8 @${ms.length?med(ms):"-"}ms`);
}
