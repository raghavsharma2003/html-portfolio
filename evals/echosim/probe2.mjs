import { runCall } from "./run.mjs";
const P = [];
globalThis.__PROBE = (x) => P.push(x);
const c = Number(process.argv[2] ?? -3);
const a = await runCall({ couplingDb: c, seed: 11, user: null });
const t0 = P[0].t;
let maxSub = 0, hits = 0, tot = 0;
for (const p of P) {
  if (!p.herSpeaking) continue;
  for (const v of p.sub) { tot++; if (v > p.thrB) hits++; if (v / Math.max(p.herNow,1e-9) > maxSub) maxSub = v / p.herNow; }
}
console.log(`coupling ${c}dB  subframes-while-she-talks=${tot} above-thrB=${hits}  max(sub/herNow)=${maxSub.toFixed(3)}`);
for (let i = 0; i < Math.min(P.length, 60); i += 3) {
  const p = P[i];
  console.log(`t=${String(Math.round(p.t-t0)).padStart(5)} her=${p.herSpeaking?1:0} herNow=${p.herNow.toFixed(3)} k=${p.kappa.toFixed(3)} thrB=${p.thrB.toFixed(4)} subMax=${Math.max(...p.sub).toFixed(4)} hard=${p.hard} soft=${p.soft} hold=${p.hold} d=${p.ducked}`);
}
