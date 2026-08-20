import { runCall } from "./run.mjs";
const SEEDS=[11,23,37,41,59,71,89,97];
const TURNS=[{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const med=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
const rel=async(cfg)=>{let g=0;for(const seed of SEEDS){const r=await runCall({...cfg,seed,herTurns:TURNS,deliverS:2.5,totalS:26});if(r.diag.some(d=>d.event==="floor_release"&&d.t>10500))g++;}return g;};
let duck=0,her=0;const leak=[];
for(const seed of SEEDS){const r=await runCall({couplingDb:-6,seed,user:null,herTurns:TURNS,deliverS:2.5,totalS:26});duck+=r.selfDuckTicks;her+=r.herTicks;leak.push(Math.round(r.uplinkSpeechTotalMs));}
console.log(JSON.stringify({tag:process.env.TAG,
  selfDuckPct_6:Math.round(100*duck/Math.max(1,her)), selfLeakMs_6:med(leak),
  talker25_6:await rel({couplingDb:-6,user:{startMs:11000,durMs:2500,level:0.25}}),
  talker25_12:await rel({couplingDb:-12,user:{startMs:11000,durMs:2500,level:0.25}}),
  quiet10_12:await rel({couplingDb:-12,user:{startMs:11000,durMs:3000,level:0.10}}),
  tv12_12:await rel({couplingDb:-12,user:{startMs:11000,durMs:5000,level:0.12}}),
  noisyroom_12:await rel({couplingDb:-12,roomRms:0.010,user:{startMs:11000,durMs:2500,level:0.25}}),
}));
