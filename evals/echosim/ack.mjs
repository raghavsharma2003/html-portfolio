// Serve her REAL clips to the simulated /api/speech, and give the harness a
// scenario in which the listening sound actually fires.
//
// The trigger needs ≥2500ms of talking of which ≥1200ms is voice, ending in a
// gap — so the barge-in user of exp6/exp8 (2500ms) is right at the edge. These
// scenarios use a 3200ms user turn so the sound fires deterministically, and
// then measure the SAME quantities exp6/exp8/endpoint measure.
import fs from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ACKV2 = path.join(HERE, "..", "ackv2");

/** Install the WAV server. `flavour` picks which generated set is served. */
export function serveAckWavs(flavour = "aoede") {
  const map = new Map([
    ["Hmm.", `${flavour}-hmm.wav`],
    ["Haan...", `${flavour}-haan.wav`],
    ["Acha...", `${flavour}-acha.wav`],
    ["Mmhm.", `${flavour}-mmhm.wav`],
  ]);
  globalThis.__ACKWAV = (text) => {
    const f = map.get(text);
    if (!f) return null;
    const p = path.join(ACKV2, f);
    if (!fs.existsSync(p)) return null;
    const b = fs.readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
}
