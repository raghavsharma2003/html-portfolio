// Deterministic speech-like signal. Not a vocoder — what the arbiter actually
// reads is the 20ms RMS envelope, its syllabic variance and its gaps, so those
// are what this reproduces: ~4.5Hz syllables, word gaps, phrase gaps, a voiced
// harmonic stack with jitter and fricative bursts.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * @param sr sample rate
 * @param dur seconds
 * @param opts.level target peak-20ms RMS of voiced syllables
 * @param opts.f0 base pitch
 * @param opts.seed
 * @param opts.gapEvery syllables per word gap
 */
export function speech(sr, dur, opts = {}) {
  const { level = 0.25, f0 = 190, seed = 7, phraseGaps = true } = opts;
  const R = rng(seed);
  const n = Math.round(sr * dur);
  const out = new Float32Array(n);
  // build the envelope in 1ms steps
  const steps = Math.ceil(dur * 1000);
  const env = new Float32Array(steps);
  const voiced = new Uint8Array(steps);
  let i = 0;
  let syl = 0;
  while (i < steps) {
    // one syllable: 120-220ms, raised-cosine
    const len = Math.round(120 + R() * 100);
    const amp = 0.62 + R() * 0.38;
    const fric = R() < 0.28;
    for (let k = 0; k < len && i + k < steps; k++) {
      const x = k / len;
      env[i + k] = amp * Math.pow(Math.sin(Math.PI * x), 0.7);
      voiced[i + k] = fric && x < 0.28 ? 0 : 1;
    }
    i += len;
    syl++;
    // a real gap between words, and now and then a phrase gap
    let gap = 30 + Math.round(R() * 60);
    if (phraseGaps && syl % 6 === 0) gap = 260 + Math.round(R() * 220);
    else if (syl % 3 === 0) gap = 110 + Math.round(R() * 90);
    i += gap;
  }
  let ph = 0;
  for (let s = 0; s < n; s++) {
    const t = s / sr;
    const e = env[Math.min(steps - 1, Math.floor(t * 1000))];
    if (e <= 0) continue;
    const v = voiced[Math.min(steps - 1, Math.floor(t * 1000))];
    const f = f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 1.7 * t) + 0.01 * (R() - 0.5));
    ph += (2 * Math.PI * f) / sr;
    let x = 0;
    if (v) {
      // harmonic stack, -6dB/octave
      x = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph) + 0.25 * Math.sin(4 * ph);
      x /= 2.08;
    } else {
      x = (R() * 2 - 1) * 0.8; // fricative
    }
    out[s] = x * e;
  }
  // normalise so the loudest 20ms block equals `level`
  const fr = Math.round(sr * 0.02);
  let peak = 0;
  for (let f = 0; f + fr <= n; f += fr) {
    let a = 0;
    for (let k = f; k < f + fr; k++) a += out[k] * out[k];
    const r = Math.sqrt(a / fr);
    if (r > peak) peak = r;
  }
  if (peak > 0) {
    const g = level / peak;
    for (let s = 0; s < n; s++) out[s] *= g;
  }
  return out;
}

export function noise(sr, dur, rms, seed = 3) {
  const R = rng(seed);
  const n = Math.round(sr * dur);
  const o = new Float32Array(n);
  let lp = 0;
  for (let s = 0; s < n; s++) {
    const w = R() * 2 - 1;
    lp = lp * 0.85 + w * 0.15; // pinkish
    o[s] = lp;
  }
  let a = 0;
  for (const v of o) a += v * v;
  const cur = Math.sqrt(a / n) || 1;
  const g = rms / cur;
  for (let s = 0; s < n; s++) o[s] *= g;
  return o;
}

export const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
export const lin = (d) => Math.pow(10, d / 20);
