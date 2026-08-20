// Is there a statistic that says "this mic window is HER, and only her"?
// Level alone cannot (measured previously). But her echo is a filtered copy of
// a signal we OWN, so mic POWER should be an affine function of her power:
//    mic² ≈ C²·her² + (room + anyone else)²
// A person is uncorrelated with her envelope, so they land in the INTERCEPT and
// wreck the FIT. Measure the fit's r² with and without a person.
import { runCall } from "./run.mjs";

const WIN = 12; // ticks ≈ 1.0s

function fits(P) {
  const out = [];
  const H = [], M = [];
  for (const p of P) {
    if (!p.herSpeaking || p.herNow <= 0.02) { H.length = 0; M.length = 0; continue; }
    H.push(p.herNow * p.herNow);
    M.push(Math.max(0, p.rms * p.rms - p.noiseFloor * p.noiseFloor));
    if (H.length > WIN) { H.shift(); M.shift(); }
    if (H.length < WIN) continue;
    let sx = 0, sy = 0;
    for (let i = 0; i < WIN; i++) { sx += H[i]; sy += M[i]; }
    const mx = sx / WIN, my = sy / WIN;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < WIN; i++) {
      sxx += (H[i]-mx)**2; syy += (M[i]-my)**2; sxy += (H[i]-mx)*(M[i]-my);
    }
    const r2 = sxx > 0 && syy > 0 ? (sxy*sxy)/(sxx*syy) : 0;
    out.push({ r2, slope: sxx > 0 ? sxy/sxx : 0 });
  }
  return out;
}

const SEEDS = [11,23,37,41,59,71,89,97];
const pct = (a, p) => { const s=[...a].sort((x,y)=>x-y); return s.length? s[Math.min(s.length-1,Math.floor(s.length*p))] : NaN; };

for (const c of [-3,-6,-9,-12,-18]) {
  const pure = [], withUser = [], slopePure = [];
  for (const seed of SEEDS) {
    let P = [];
    globalThis.__TAP = (x) => P.push(x);
    // pure echo
    P = []; await runCall({ couplingDb: c, seed, user: null });
    for (const f of fits(P)) { pure.push(f.r2); slopePure.push(Math.sqrt(Math.max(0,f.slope))); }
    // echo + a person talking across her whole turn
    P = []; await runCall({ couplingDb: c, seed, user: { startMs: 1200, durMs: 6000, level: 0.12 } });
    for (const f of fits(P)) withUser.push(f.r2);
  }
  console.log(
    `coupling ${String(c).padStart(3)}dB  PURE r2 p10=${pct(pure,0.1).toFixed(2)} med=${pct(pure,0.5).toFixed(2)}  ` +
    `WITH-PERSON r2 med=${pct(withUser,0.5).toFixed(2)} p90=${pct(withUser,0.9).toFixed(2)}  ` +
    `sqrt(slope) med=${pct(slopePure,0.5).toFixed(3)} (true C=${Math.pow(10,c/20).toFixed(3)})`);
}
