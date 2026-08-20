// Same affine-fit statistic, but against her PROPERLY ALIGNED envelope rather
// than the 250ms max. Pure echo must fit; a person must break the fit.
import { runCall } from "./run.mjs";
globalThis.__WANT_ALIGNED = true;
const WIN = 12;
const SEEDS = [11,23,37,41,59,71,89,97];
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:NaN;};

function fit(H, M) {
  const n = H.length;
  let sx=0, sy=0; for (let i=0;i<n;i++){sx+=H[i];sy+=M[i];}
  const mx=sx/n, my=sy/n;
  let sxx=0,syy=0,sxy=0;
  for (let i=0;i<n;i++){sxx+=(H[i]-mx)**2;syy+=(M[i]-my)**2;sxy+=(H[i]-mx)*(M[i]-my);}
  return { r2: sxx>0&&syy>0 ? (sxy*sxy)/(sxx*syy) : 0, slope: sxx>0 ? sxy/sxx : 0 };
}

for (const c of [-3,-6,-9,-12,-18]) {
  const pureR2=[], pureC=[], persR2=[], bestLags=[];
  for (const seed of SEEDS) {
    for (const [tag, user] of [["pure",null],["pers",{startMs:1200,durMs:6000,level:0.12}]]) {
      const P=[]; globalThis.__TAP=(x)=>P.push(x);
      const r = await runCall({ couplingDb:c, seed, user });
      globalThis.__TAP=null;
      const A = r.alignedByTick;
      const nL = A[0]?.length ?? 0;
      // walk windows of WIN consecutive ticks in which she is audible
      for (let end = WIN; end <= P.length && end <= A.length; end++) {
        let ok = true;
        for (let i = end-WIN; i < end; i++) if (!P[i]?.herSpeaking || P[i].herNow <= 0.02) ok = false;
        if (!ok) continue;
        const M = [];
        for (let i = end-WIN; i < end; i++) M.push(Math.max(0, P[i].rms**2 - P[i].noiseFloor**2));
        let best = { r2:-1, slope:0, L:0 };
        for (let L = 0; L < nL; L++) {
          const H = [];
          for (let i = end-WIN; i < end; i++) H.push(A[i][L]**2);
          const f = fit(H, M);
          if (f.r2 > best.r2) best = { ...f, L };
        }
        if (tag==="pure") { pureR2.push(best.r2); pureC.push(Math.sqrt(Math.max(0,best.slope))); bestLags.push(best.L*20); }
        else persR2.push(best.r2);
      }
    }
  }
  console.log(
    `coupling ${String(c).padStart(3)}dB  PURE r2 p10=${pct(pureR2,0.1).toFixed(2)} med=${pct(pureR2,0.5).toFixed(2)}  ` +
    `PERSON r2 med=${pct(persR2,0.5).toFixed(2)} p90=${pct(persR2,0.9).toFixed(2)} p99=${pct(persR2,0.99).toFixed(2)}  ` +
    `C_hat med=${pct(pureC,0.5).toFixed(3)} (true ${Math.pow(10,c/20).toFixed(3)})  lag med=${pct(bestLags,0.5)}ms  n=${pureR2.length}/${persR2.length}`);
}
