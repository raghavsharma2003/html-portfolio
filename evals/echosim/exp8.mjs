// The documented behaviours the bar exists to protect. Lowering the bar in her
// pauses must not have let the room in.
import { runCall } from "./run.mjs";
const SEEDS=[11,23,37,41,59,71,89,97];
const TURNS=[{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const cases = [
  ["haan backchannel 450ms",   {startMs:11000,durMs:450,level:0.25}, 0.0025, false],
  ["haan backchannel 450ms lo",{startMs:11000,durMs:450,level:0.15}, 0.0025, false],
  ["distant TV 0.12, 5s",      {startMs:11000,durMs:5000,level:0.12},0.0025, false],
  ["distant TV 0.08, 5s",      {startMs:11000,durMs:5000,level:0.08},0.0025, false],
  ["real talker 0.25, 2.5s",   {startMs:11000,durMs:2500,level:0.25},0.0025, true],
  ["quiet talker 0.10, 3s",    {startMs:11000,durMs:3000,level:0.10},0.0025, true],
  ["talker in a noisy room",   {startMs:11000,durMs:2500,level:0.25},0.010,  true],
];
for (const c of [-6,-12]) {
  for (const [name,user,room,want] of cases) {
    let got=0;
    for (const seed of SEEDS) {
      const r = await runCall({couplingDb:c,seed,user,roomRms:room,herTurns:TURNS,deliverS:2.5,totalS:26});
      if (r.diag.some(d=>d.event==="floor_release"&&d.t>10500)) got++;
    }
    const ok = want ? got>=7 : got===0;
    console.log(`${String(c).padStart(3)}dB ${name.padEnd(26)} released ${got}/8  want ${want?"yes":"NO"}  ${ok?"ok":"** REGRESSION **"}`);
  }
}
