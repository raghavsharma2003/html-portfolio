import { runCall } from "./run.mjs";
const P = [];
globalThis.__PROBE = (x) => P.push(x);
const a = await runCall({ couplingDb: -12, seed: 11, user: { startMs: 3000, durMs: 2500, level: 0.25 } });
const t0 = P.length ? P[0].t : 0;
console.log("probe ticks:", P.length);
for (let i = 0; i < P.length; i += 4) {
  const p = P[i];
  console.log(
    `t=${String(Math.round(p.t - t0)).padStart(5)} rms=${p.rms.toFixed(4)} her=${p.herSpeaking?1:0} herNow=${p.herNow.toFixed(3)} thrL=${p.thrL.toFixed(4)} thrB=${p.thrB.toFixed(4)} echo=${p.echoTerm.toFixed(4)} k=${p.kappa.toFixed(3)} nf=${p.noiseFloor.toFixed(4)} open=${p.open?1:0} holding=${p.holding?1:0} hard=${p.hard} soft=${p.soft} hold=${p.hold} d=${p.ducked}`,
  );
}
