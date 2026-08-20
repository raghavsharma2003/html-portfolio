// Does the world actually work? A loud person must take the floor; her own
// audio must actually be audible in the mic.
import { runCall } from "./run.mjs";

const a = await runCall({
  couplingDb: -12,
  seed: 11,
  user: { startMs: 3000, durMs: 2500, level: 0.25 },
});
console.log("WITH USER  diag:", JSON.stringify(a.diag, null, 1));
console.log("states:", JSON.stringify(a.states));
console.log("gain min:", Math.min(...a.gainTrace).toFixed(3));

const b = await runCall({ couplingDb: -3, seed: 11, user: null });
console.log("NO USER -3dB diag:", JSON.stringify(b.diag));
console.log("gain min:", Math.min(...b.gainTrace).toFixed(3), "states", JSON.stringify(b.states));
