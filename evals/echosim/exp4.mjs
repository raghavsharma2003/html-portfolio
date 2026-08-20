// Is the affine SLOPE robust to a person? The claim under test: an interferer
// that is uncorrelated with her envelope lands in the INTERCEPT, so the slope
// still measures the coupling. If true, the "a person raises every percentile"
// objection does not apply to it — because it is not a percentile.
import { runCall } from "./run.mjs";
globalThis.__WANT_ALIGNED = true;
const WIN = 12;
const SEEDS = [11,23,37,41,59,71,89,97];
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:NaN;};
function fit(H,M){const n=H.length;let sx=0,sy=0;for(let i=0;i<n;i++){sx+=H[i];sy+=M[i];}
 const mx=sx/n,my=sy/n;let sxx=0,syy=0,sxy=0;
 for(let i=0;i<n;i++){sxx+=(H[i]-mx)**2;syy+=(M[i]-my)**2;sxy+=(H[i]-mx)*(M[i]-my);}
 return {r2:sxx>0&&syy>0?(sxy*sxy)/(sxx*syy):0,slope:sxx>0?sxy/sxx:0,icept:my-(sxx>0?sxy/sxx:0)*mx};}

for (const c of [-3,-6,-9,-12]) {
  for (const [tag,user] of [["none",null],["quiet 0.12",{startMs:1200,durMs:6000,level:0.12}],["loud 0.30",{startMs:1200,durMs:6000,level:0.30}]]) {
    const C=[], Cg=[], r2s=[];
    for (const seed of SEEDS) {
      const P=[]; globalThis.__TAP=(x)=>P.push(x);
      const r = await runCall({ couplingDb:c, seed, user });
      globalThis.__TAP=null;
      const A=r.alignedByTick, nL=A[0]?.length??0;
      for (let end=WIN; end<=Math.min(P.length,A.length); end++) {
        let ok=true; for(let i=end-WIN;i<end;i++) if(!P[i]?.herSpeaking||P[i].herNow<=0.02) ok=false;
        if(!ok) continue;
        const M=[]; for(let i=end-WIN;i<end;i++) M.push(Math.max(0,P[i].rms**2-P[i].noiseFloor**2));
        let best={r2:-1};
        for(let L=0;L<nL;L++){const H=[];for(let i=end-WIN;i<end;i++)H.push(A[i][L]**2);const f=fit(H,M);if(f.r2>best.r2)best={...f,L};}
        C.push(Math.sqrt(Math.max(0,best.slope))); r2s.push(best.r2);
        if (best.r2>=0.7) Cg.push(Math.sqrt(Math.max(0,best.slope)));
      }
    }
    console.log(`${String(c).padStart(3)}dB person=${tag.padEnd(10)} C_hat p50=${pct(C,0.5).toFixed(3)} p90=${pct(C,0.9).toFixed(3)} | gated(r2>=.7) p50=${pct(Cg,0.5).toFixed(3)} p90=${pct(Cg,0.9).toFixed(3)} n=${Cg.length}/${C.length} | true ${Math.pow(10,c/20).toFixed(3)}`);
  }
}
