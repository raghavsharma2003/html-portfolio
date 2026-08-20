// THE HEARTBEAT MUST SURVIVE. The server ends the user's turn by HEARING the
// pause (silenceDurationMs 300). If a congested link, or the hold logic, or the
// new echo model ever let the uplink go dark for longer than that, the VAD
// clock stops and she never answers at all. Measured as the longest gap
// between consecutive mic frames reaching the socket, over a whole call.
import { runCall } from "./run.mjs";
const TURNS=[{at:0,durS:6},{at:9000,durS:6},{at:18000,durS:6}];
const rows=[];
for (const backlog of [0, 12_000, 60_000]) {
  for (const c of [-6, -12]) {
    const gaps=[], post=[];
    for (const seed of [11,23,37,41,59,71,89,97]) {
      const r = await runCall({ couplingDb:c, seed, backlog,
        user:{startMs:11000,durMs:2500,level:0.25}, herTurns:TURNS, deliverS:2.5, totalS:26 });
      let last=0, g=0;
      for (const e of r.sendLog) { if (!e.n) continue; if (e.t-last>g) g=e.t-last; last=e.t; }
      gaps.push(Math.round(g));
      // the gap that actually decides endpointing: right after the user stops
      let lastP=0, gp=0;
      for (const e of r.sendLog) {
        if (e.t < 13500 || e.t > 16000) continue;
        if (!e.n) continue;
        if (lastP && e.t-lastP>gp) gp=e.t-lastP;
        lastP=e.t;
      }
      post.push(Math.round(gp));
    }
    rows.push({backlogBytes:backlog, couplingDb:c, maxGapMs:Math.max(...gaps), maxGapAfterUserStopsMs:Math.max(...post), limitMs:300});
  }
}
console.table(rows);
