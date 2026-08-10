// Real amplitude for the call UI. The audio graphs already exist — the live
// session's mic source and PCM playback bus, and the cascade's speech bus —
// so presence is a tap on them, never a simulation.
//
// RMS with asymmetric smoothing (fast attack, slow release) is what makes it
// read as a voice rather than a meter: speech onsets are instant, tails decay.
// Symmetric smoothing looks like a VU needle; asymmetric looks like breathing.

export type LevelSource = "her" | "you";

const nodes: Partial<Record<LevelSource, AnalyserNode>> = {};
const env: Record<LevelSource, number> = { her: 0, you: 0 };
const buf = new Uint8Array(256); // getByteTimeDomainData wants fftSize samples

export function attachAnalyser(src: LevelSource, ctx: AudioContext, from: AudioNode) {
  try {
    const a = ctx.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.6;
    from.connect(a); // an analyser needs no output connection to run
    nodes[src] = a;
  } catch {
    /* no analyser here — the UI falls back to breath only */
  }
}

export function detachAnalyser(src: LevelSource) {
  try {
    nodes[src]?.disconnect();
  } catch {
    /* already gone */
  }
  delete nodes[src];
  env[src] = 0;
}

export function readLevel(src: LevelSource): number {
  const a = nodes[src];
  if (!a) return 0;
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length); // speech sits ~0.05–0.30
  const target = Math.min(1, rms * 3.2);
  const k = target > env[src] ? 0.35 : 0.08; // attack : release
  env[src] += (target - env[src]) * k;
  return env[src];
}
