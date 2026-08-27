// Asserts an enrollment reference actually carries real energy above 8 kHz,
// so a band-limited reference wearing a full-rate label can never again reach
// the voice model silently (WS-AS, 2026-08-27).
//
// ── the incident this exists to catch ──────────────────────────────────────
// The owner's replica's enrollment reference (3455faac-4483-521d-ae20-
// a0304e00c550, 480 044 bytes, 24 kHz mono, 10.00 s) measured by FFT over its
// first seconds:
//
//    0-1000  Hz   79.61%
//  1000-4000  Hz   10.43%
//  4000-8000  Hz    9.50%
//  8000-12000 Hz    0.46%   <-- essentially empty
//
// `services/voice-evidence/app.py`'s `separate` stage (`sepformer-whamr16k`)
// runs at 16 kHz, so its Nyquist is 8 kHz; `enhance` then ran on that, and a
// later resample to 24 kHz added an EMPTY band rather than restoring one. The
// artifact was band-limited 8 kHz audio wearing a 24 kHz label after two
// aggressive neural transforms, and speaker-identity cues live substantially
// in 4-10 kHz. `check-enrollment-sample-rate.mjs` already guards that every
// site NAMES the same rate; it cannot see this, because a 16 kHz-decimated
// signal upsampled to 24 kHz still reports 24 kHz truthfully in its header.
// Only the spectrum itself shows the defect, which is why this gate computes
// one rather than reading a number out of a WAV header.
//
// ── why an FFT and not a sample-rate check ─────────────────────────────────
// `checkRatesAgree` (the sibling gate) can prove every site NAMES 24 kHz. It
// cannot prove the bytes at that rate carry real content above 8 kHz, and
// this incident is exactly a case where they did not. This module measures
// the spectrum directly: a real radix-2 FFT over a Hann-windowed prefix of
// the reference, no external library, so the gate has no dependency this repo
// does not already vendor.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Calibrated against TWO real measurements on the owner's own 822.72 s
// lecture source (48 kHz/320 kbps MP3), not a guess -- WS-AS, 2026-08-27:
//   - the BROKEN reference (sepformer-whamr16k at 16 kHz, then upsampled to
//     24 kHz): 0.00046% of energy at/above 8 kHz -- an actual hard null band,
//     floating-point-noise-floor small.
//   - the SAME diarized window cut fresh from the ORIGINAL 48 kHz source at
//     24 kHz (the fix): 0.022% -- roughly 49x higher, and this is genuine
//     lecture speech, not a studio recording, so its absolute fraction is
//     still small (voiced/vowel energy dominates raw power at any bandwidth;
//     the sibilants and fricatives that carry identity above 8 kHz are a
//     small SHARE of total energy even when fully present). An earlier
//     version of this threshold (1.5%) was a guess against clean-speech
//     intuition and would have failed the FIXED reference too -- the
//     defect this gate exists to catch is a hard NULL band, not merely "not
//     much" energy up there, and only a real measurement could show the
//     difference between the two.
// 0.003% sits above the broken reading's floor (roughly 6.5x) and comfortably
// below the fixed reading (roughly 7x under it), so it discriminates the
// actual incident without over-fitting to one recording's exact numbers.
// What would move it: a genuine full-bandwidth recording measured landing
// nearer this floor than the owner's did.
export const MIN_ENERGY_ABOVE_8KHZ_FRACTION = 0.00003;
const BAND_EDGE_HZ = 8_000;
const FFT_MAX_SAMPLES = 65_536; // power of two, ~2.7 s at 24 kHz -- plenty for a spectral shape

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` are same-length
 *  Float64Arrays whose length is a power of two. Pure, deterministic, no
 *  dependency -- the same reason this repo's audio floor (evals/echosim/)
 *  transpiles its own subject rather than reaching for an npm package. */
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("fft_length_must_be_power_of_two");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curWr - im[i + j + len / 2] * curWi;
        const vIm = re[i + j + len / 2] * curWi + im[i + j + len / 2] * curWr;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        const nextWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr;
        curWr = nextWr;
      }
    }
  }
}

/** Generic PCM16 WAV chunk walk -- deliberately independent of `windows.js`'s
 *  `readPcm16Wav`, which hard-refuses any rate but its own fixed 16 kHz. This
 *  gate has to read a reference at WHATEVER rate it actually claims, honestly,
 *  because the defect it looks for can hide behind a claimed rate that is
 *  itself correct. */
export function parsePcm16MonoWav(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("bandwidth_check_not_wav");
  }
  let offset = 12, sampleRate = null, channels = null, bitsPerSample = null, data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      sampleRate = buffer.readUInt32LE(body + 4);
      channels = buffer.readUInt16LE(body + 2);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    offset = body + size + (size % 2);
  }
  if (!sampleRate || !data) throw new Error("bandwidth_check_wav_incomplete");
  if (channels !== 1 || bitsPerSample !== 16) throw new Error("bandwidth_check_wav_not_pcm16_mono");
  const sampleCount = Math.floor(data.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate, samples };
}

/** Fraction of spectral energy at or above `bandEdgeHz`, over a Hann-windowed
 *  power-of-two prefix of `samples`. Pure: samples + rate in, a number out. */
export function energyAboveFraction(samples, sampleRate, bandEdgeHz = BAND_EDGE_HZ) {
  const n = 1 << Math.floor(Math.log2(Math.min(samples.length, FFT_MAX_SAMPLES)));
  if (n < 1024) throw new Error("bandwidth_check_too_short");
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (samples[i] / 32768) * hann;
  }
  fft(re, im);
  const hzPerBin = sampleRate / n;
  let total = 0, above = 0;
  for (let k = 1; k < n / 2; k++) { // skip DC (k=0)
    const mag = re[k] * re[k] + im[k] * im[k];
    total += mag;
    if (k * hzPerBin >= bandEdgeHz) above += mag;
  }
  return total > 0 ? above / total : 0;
}

/** The gate itself: throws a named error rather than returning a soft verdict
 *  -- "prefer an error to a believable value" applies to the CHECK too. */
export function assertEnrollmentBandwidth(wavBytes, minFraction = MIN_ENERGY_ABOVE_8KHZ_FRACTION) {
  const { sampleRate, samples } = parsePcm16MonoWav(wavBytes);
  if (sampleRate <= 2 * BAND_EDGE_HZ) {
    // Cannot even carry the band in question -- fail by construction, no FFT needed.
    throw Object.assign(new Error("enrollment_reference_nyquist_at_or_below_8khz"), { sampleRate });
  }
  const fraction = energyAboveFraction(samples, sampleRate);
  if (fraction < minFraction) {
    throw Object.assign(
      new Error(`enrollment_reference_band_limited: ${(fraction * 100).toFixed(3)}% of energy at/above 8 kHz, need >= ${(minFraction * 100).toFixed(2)}%`),
      { fraction, sampleRate },
    );
  }
  return { fraction, sampleRate };
}

// ── synthetic broadband signal + its band-limited twin ─────────────────────
// A sum of sinusoids spanning 200 Hz to 11 kHz -- real broadband content, not
// noise, so the FFT's peaks are easy to reason about by hand. The "broken"
// twin is the SAME signal with every partial at or above 8 kHz simply never
// added: spectrally, that is exactly what a 16 kHz-Nyquist decimate-then-
// upsample-to-24-kHz produces (a real empty band, not an approximation of
// one), which is the shape `sepformer-whamr16k` at 16 kHz actually left
// behind on the owner's real reference.
function syntheticSamples({ sampleRate, seconds, includeAbove8k }) {
  const n = Math.round(sampleRate * seconds);
  const samples = new Int16Array(n);
  const partials = [200, 600, 1200, 2500, 4000, 6500, 8500, 9800, 11000];
  for (let i = 0; i < n; i++) {
    let value = 0;
    for (const hz of partials) {
      if (!includeAbove8k && hz >= BAND_EDGE_HZ) continue;
      value += Math.sin((2 * Math.PI * hz * i) / sampleRate);
    }
    samples[i] = Math.max(-32000, Math.min(32000, Math.round((value / partials.length) * 28000)));
  }
  return samples;
}

/** Negative control: run BEFORE the real check, on every invocation, so a
 *  change to this file that broke its own detection fails loudly rather than
 *  starting to pass everything -- same discipline as
 *  `check-enrollment-sample-rate.mjs`'s own negative control. Two assertions,
 *  both required: the band-limited twin FAILS, and the broadband original
 *  PASSES, so the gate is proven to discriminate rather than always refusing
 *  or always accepting. */
export function runNegativeControl() {
  const sampleRate = 24_000;
  const broadband = syntheticSamples({ sampleRate, seconds: 1.5, includeAbove8k: true });
  const bandLimited = syntheticSamples({ sampleRate, seconds: 1.5, includeAbove8k: false });

  let brokeOnBandLimited = false;
  try {
    assertEnrollmentBandwidth(wavBytesFor(bandLimited, sampleRate));
  } catch (err) {
    if (err.message.startsWith("enrollment_reference_band_limited")) brokeOnBandLimited = true;
    else throw new Error(`negative control failed for the wrong reason: ${err.message}`);
  }
  if (!brokeOnBandLimited) {
    throw new Error("negative control did not fail: a band-limited 24 kHz-labelled clip (the exact shape of the real incident) passed the bandwidth gate undetected");
  }

  // Positive twin: the SAME synthesis with the 8-12 kHz partials present must
  // clear the gate, proving this is discrimination and not a check that
  // always refuses.
  const { fraction } = assertEnrollmentBandwidth(wavBytesFor(broadband, sampleRate));
  if (!(fraction >= MIN_ENERGY_ABOVE_8KHZ_FRACTION)) {
    throw new Error(`positive control failed: genuine broadband content measured ${fraction} below its own passing threshold`);
  }
}

function wavBytesFor(int16Samples, sampleRate) {
  const dataBytes = int16Samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < int16Samples.length; i++) data.writeInt16LE(int16Samples[i], i * 2);
  return Buffer.concat([header, data]);
}

// ── CLI ─────────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith("check-enrollment-bandwidth.mjs");
if (isMain) {
  try {
    runNegativeControl();
  } catch (err) {
    console.log(`  FAIL  negative control: ${err.message}`);
    process.exit(1);
  }
  console.log("  ok    negative control: a synthetic band-limited-but-24kHz-labelled clip is caught; genuine broadband content is not");

  // If a real enrollment WAV was handed to us on argv, check it too -- this is
  // what makes the gate usable ad hoc against a real fetched artifact, not
  // just self-testing. verify-release.mjs runs the negative control only,
  // since it has no live enrollment artifact to fetch offline.
  const target = process.argv[2];
  if (target) {
    try {
      const { fraction, sampleRate } = assertEnrollmentBandwidth(readFileSync(target));
      console.log(`  ok    ${target}: ${(fraction * 100).toFixed(3)}% of energy at/above 8 kHz at ${sampleRate} Hz`);
    } catch (err) {
      console.log(`  FAIL  ${target}: ${err.message}`);
      process.exit(1);
    }
  }
  process.exit(0);
}
