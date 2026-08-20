// EXPERIMENT 1 — what her own voice does to the floor arbiter, as a function
// of speaker→mic coupling.
//
// ARM A (nobody there): every event is by definition self-inflicted.
//   selfRelease  she took the floor from herself
//   selfDuck%    fraction of her own speaking time spent audibly ducked
//   leakMs       milliseconds of REAL audio (her own echo) that reached the
//                server as if it were the user speaking. This is the one that
//                makes her answer herself.
//   hard/soft    the closest the candidate ever got to the claim threshold
// ARM B (the owner barges in at +3s): must not regress.
import { runCall } from "./run.mjs";

const SEEDS = [11, 23, 37, 41, 59, 71, 89, 97];
const COUPLINGS = [-3, -6, -9, -12, -18];
const CLAIM_NEED = 26; // 550ms / 21.33ms
const SOFT_NEED = 52; // 1100ms / 21.33ms

const out = [];
for (const c of COUPLINGS) {
  const A = { selfRelease: 0, duck: 0, herTicks: 0, leak: [], hard: [], soft: [], n: 0 };
  for (const seed of SEEDS) {
    const r = await runCall({ couplingDb: c, seed, user: null });
    A.n++;
    if (r.diag.some((d) => d.event === "floor_release")) A.selfRelease++;
    A.duck += r.selfDuckTicks;
    A.herTicks += r.herTicks;
    A.leak.push(Math.round(r.uplinkSpeechTotalMs));
    A.hard.push(r.maxHard);
    A.soft.push(r.maxSoft);
  }
  const B = { got: 0, releaseMs: [], n: 0 };
  for (const seed of SEEDS) {
    const r = await runCall({
      couplingDb: c,
      seed,
      user: { startMs: 3000, durMs: 2500, level: 0.25 },
    });
    B.n++;
    const rel = r.diag.find((d) => d.event === "floor_release");
    if (rel) {
      B.got++;
      B.releaseMs.push(Math.round(rel.t - 3000));
    }
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const row = {
    couplingDb: c,
    selfRelease: `${A.selfRelease}/${A.n}`,
    selfDuckPct: Math.round((100 * A.duck) / Math.max(1, A.herTicks)),
    leakMsMed: med(A.leak),
    leakMsMax: Math.max(...A.leak),
    hardMax: `${Math.max(...A.hard)}/${CLAIM_NEED}`,
    softMax: `${Math.max(...A.soft)}/${SOFT_NEED}`,
    bargeIn: `${B.got}/${B.n}`,
    bargeMsMed: B.releaseMs.length ? med(B.releaseMs) : null,
  };
  out.push(row);
  console.log(JSON.stringify(row));
}
console.table(out);
