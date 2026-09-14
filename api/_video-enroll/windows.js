// Best-window selection over a whole lecture (Gurukul WS-AD).
//
// ── why this file exists at all ──────────────────────────────────────────
// `context/measurements.md#reference-window-beats-the-finetune`: Chatterbox
// truncates a voice reference to its FIRST 10 s (s3gen) / 6 s (T3 prompt);
// only the speaker embedding sees the rest. On the owner's own voice, WHICH
// 10 s you pass spans 0.7433-0.8058 ECAPA fidelity — 0.0625, three times the
// measured fine-tune delta, at zero training cost, and the best window beat
// every fine-tuned arm.
//
// So on a 15-minute lecture the single highest-leverage decision in the whole
// clone pipeline is which ten seconds condition the model. The owner's brief
// names the failure directly: "it's not necessary that the first 10 seconds
// will be clear". Taking the head of the file is the one choice guaranteed to
// be wrong for a lecture, because the head of a lecture is throat-clearing,
// room noise, a mic being adjusted and "haan haan, sunai de raha hai?".
//
// The fix is not a heuristic about lectures. It is: SCORE EVERY WINDOW, rank
// them, keep the ranking, and condition on the top one. The first-10-seconds
// problem is then solved by construction rather than by advice — the head of
// the file competes on exactly the same terms as every other window and wins
// only when it deserves to.
//
// ── this file is deliberately pure ───────────────────────────────────────
// Bytes in, numbers out. No db, no network, no clock, no randomness. That is
// what lets `evals/videoenroll.mjs` assert DETERMINISM (same bytes → byte-
// identical ranking) rather than asserting that a function was called. The
// audio floor at `evals/echosim/` is the house precedent for a measurement
// that only stays honest while the thing measuring it has no dependencies.
//
// ── what it does NOT claim ───────────────────────────────────────────────
// These are SIGNAL-quality scores computed from the waveform: voiced
// fraction, an SNR estimate, clipping, level and stationarity. They are not
// ECAPA fidelity, and nothing here has been benched against fidelity outcomes
// on real lecture audio. The claim this file is allowed to make is "this
// window is cleaner, more voiced and more single-speaker than that one",
// which is a proxy for the thing that matters and is named as a proxy in
// `score_source` on every row it produces. The bench that would turn the
// proxy into a measurement is the reference-window sweep run per-speaker,
// and it has not been run on a lecture.

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
// 10 s because that is what s3gen keeps. Not a tunable: a window length that
// disagreed with the model's truncation would rank windows on audio the model
// never hears.
export const WINDOW_MS = 10_000;
// 5 s hop — every instant of the lecture appears in the interior of some
// window, so a good moment cannot be missed by falling across a boundary.
export const HOP_MS = 5_000;
const FRAME_MS = 20;
const CLIP_THRESHOLD = 32_600;
export const WINDOW_SCORE_SOURCE = "wav-signal-probe/v1";

export class WindowScoringError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new WindowScoringError(code, status, details);
}

/**
 * The one shape this lane admits: 16 kHz mono signed 16-bit PCM WAV — what
 * `services/media-extract` normalizes to and asserts before it returns, and
 * what `api/_replica-processing` measures everything else in. A file that is
 * not this shape is REFUSED rather than resampled here, because a per-file
 * sample rate is a per-file measurement basis and two windows normalized
 * differently are not comparable numbers.
 */
export function readPcm16Wav(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buffer.length < 44) fail("window_audio_too_short", 422);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    fail("window_audio_not_wav", 415);
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > buffer.length) fail("window_audio_not_wav", 415);
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
      // A `data` size field that overruns the file is the shape a truncated
      // upload has. Trusting it would read past the buffer; clamping it and
      // saying nothing would silently score a partial lecture as a whole one.
      if (body + size > buffer.length) fail("window_audio_truncated", 422, { declared: size, present: buffer.length - body });
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) fail("window_audio_not_wav", 415);
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) fail("window_audio_not_pcm16", 415);
  if (format.channels !== 1) fail("window_audio_not_mono", 415, { channels: format.channels });
  if (format.sampleRate !== SAMPLE_RATE) fail("window_audio_sample_rate_invalid", 415, { sampleRateHz: format.sampleRate });
  const sampleCount = Math.floor(data.length / BYTES_PER_SAMPLE);
  if (sampleCount < SAMPLE_RATE) fail("window_audio_too_short", 422, { durationMs: Math.round((sampleCount * 1000) / SAMPLE_RATE) });
  return Object.freeze({
    sampleRateHz: SAMPLE_RATE,
    sampleCount,
    durationMs: Math.round((sampleCount * 1000) / SAMPLE_RATE),
    samples: data.subarray(0, sampleCount * BYTES_PER_SAMPLE),
  });
}

/** Frame energies over the whole file, once. Every window reads slices of
 *  this rather than re-walking the samples, which is what keeps a 90-minute
 *  file linear instead of quadratic. */
function frameEnergies(pcm) {
  const framesTotal = Math.floor(pcm.sampleCount / ((SAMPLE_RATE * FRAME_MS) / 1000));
  const perFrame = (SAMPLE_RATE * FRAME_MS) / 1000;
  const rms = new Float64Array(framesTotal);
  const peak = new Float64Array(framesTotal);
  const clipped = new Float64Array(framesTotal);
  for (let f = 0; f < framesTotal; f += 1) {
    let sum = 0;
    let high = 0;
    let clip = 0;
    const start = f * perFrame;
    for (let i = 0; i < perFrame; i += 1) {
      const value = pcm.samples.readInt16LE((start + i) * BYTES_PER_SAMPLE);
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > high) high = magnitude;
      if (magnitude >= CLIP_THRESHOLD) clip += 1;
    }
    rms[f] = Math.sqrt(sum / perFrame);
    peak[f] = high;
    clipped[f] = clip / perFrame;
  }
  return { rms, peak, clipped, perFrame, frameMs: FRAME_MS };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

function round(value, places = 4) {
  const factor = 10 ** places;
  // Rounded because these numbers are STORED and COMPARED across runs, and a
  // float that differs in its last bit between two machines would make the
  // determinism assertion in the eval a lie about the ranking rather than a
  // fact about the audio.
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

/** The share of a window covered by its single loudest-talking speaker,
 *  from diarization segments. Absent diarization this is `null` — NOT 1.0.
 *  Defaulting an unmeasured purity to "perfectly single-speaker" would let a
 *  window containing a student's question outrank a clean teacher window, and
 *  the whole point of the lane is that the reference is the OWNER's voice. */
export function speakerPurity(segments, startMs, endMs) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const byspeaker = new Map();
  let covered = 0;
  for (const segment of segments) {
    const from = Math.max(startMs, Number(segment?.start_ms ?? segment?.startMs ?? 0));
    const to = Math.min(endMs, Number(segment?.end_ms ?? segment?.endMs ?? 0));
    if (!(to > from)) continue;
    const speaker = String(segment?.speaker ?? segment?.speaker_id ?? "");
    byspeaker.set(speaker, (byspeaker.get(speaker) || 0) + (to - from));
    covered += to - from;
  }
  if (covered <= 0) return 0;
  const dominant = Math.max(...byspeaker.values());
  return round(dominant / (endMs - startMs));
}

/**
 * Score one window. Every component is returned alongside the score, because
 * a single number nobody can decompose is a number nobody can argue with —
 * and the first time a window ranks surprisingly, the components are the only
 * way to find out whether the ranking or the audio is wrong.
 */
function scoreWindow(energies, startFrame, endFrame, floors, startMs, endMs, segments) {
  const { noiseFloor, voicedThreshold } = floors;
  let voiced = 0;
  let voicedPower = 0;
  let noisePower = 0;
  let noiseFrames = 0;
  let clipping = 0;
  let peak = 0;
  const levels = [];
  for (let f = startFrame; f < endFrame; f += 1) {
    const rms = energies.rms[f];
    levels.push(rms);
    clipping += energies.clipped[f];
    if (energies.peak[f] > peak) peak = energies.peak[f];
    if (rms >= voicedThreshold) {
      voiced += 1;
      voicedPower += rms * rms;
    } else {
      noisePower += rms * rms;
      noiseFrames += 1;
    }
  }
  const frames = endFrame - startFrame;
  const voicedFraction = frames ? voiced / frames : 0;
  const meanVoiced = voiced ? voicedPower / voiced : 0;
  const meanNoise = noiseFrames ? noisePower / noiseFrames : noiseFloor * noiseFloor;
  const snrDb = meanVoiced > 0 && meanNoise > 0 ? 10 * Math.log10(meanVoiced / meanNoise) : 0;
  const clippingFraction = frames ? clipping / frames : 0;
  levels.sort((a, b) => a - b);
  const median = percentile(levels, 0.5);
  // Level stationarity: a window whose loudness lurches is a window where the
  // speaker turned away, a door slammed, or an edit landed. Chatterbox
  // conditions on a continuous 10 s and a lurch inside it is worse than a
  // quieter but even window.
  const spread = median > 0 ? (percentile(levels, 0.9) - percentile(levels, 0.1)) / median : 4;
  const purity = speakerPurity(segments, startMs, endMs);

  // The weights are a STATED PRIOR, not a fitted model, and they are written
  // here in the open so that the first bench that disagrees with them can
  // replace them with numbers. Voiced fraction dominates because a reference
  // that is half silence gives s3gen five seconds of speech, not ten.
  let score =
    0.45 * Math.min(1, voicedFraction / 0.9) +
    0.25 * Math.min(1, Math.max(0, snrDb) / 25) +
    0.15 * Math.min(1, 1 / (1 + spread)) +
    0.15 * Math.min(1, median / 3000);
  // Clipping is a DEDUCTION rather than a term: clipped speech is destroyed
  // speech and a window can be voiced, loud, even and still useless.
  score -= Math.min(0.6, clippingFraction * 12);
  // Unknown purity neither helps nor hurts; measured impurity hurts, hard,
  // and a window that is mostly somebody else is disqualified outright below.
  if (purity !== null) score -= 0.5 * (1 - purity);

  return {
    start_ms: startMs,
    end_ms: endMs,
    score: round(Math.max(0, Math.min(1, score))),
    voiced_fraction: round(voicedFraction),
    snr_db: round(snrDb, 2),
    clipping_fraction: round(clippingFraction, 6),
    median_rms: round(median, 1),
    peak_amplitude: Math.round(peak),
    level_spread: round(spread),
    speaker_purity: purity,
    score_source: WINDOW_SCORE_SOURCE,
  };
}

/**
 * Rank every ~10 s window in the file.
 *
 * @param {Buffer} bytes  16 kHz mono PCM16 WAV.
 * @param {object} [options]
 * @param {Array}  [options.segments]  diarization turns, if the diarize stage
 *        ran. Absent, `speaker_purity` is null on every row and says so.
 * @param {number} [options.minPurity] windows whose MEASURED purity is below
 *        this are excluded from candidacy with a named reason.
 * @param {number} [options.limit]     how many ranked candidates to keep.
 * @returns {{selected: object|null, candidates: object[], rejected: object[], stats: object}}
 */
export function rankReferenceWindows(bytes, options = {}) {
  const pcm = readPcm16Wav(bytes);
  const energies = frameEnergies(pcm);
  const framesPerWindow = WINDOW_MS / FRAME_MS;
  const framesPerHop = HOP_MS / FRAME_MS;
  if (energies.rms.length < framesPerWindow) {
    fail("window_audio_shorter_than_window", 422, { durationMs: pcm.durationMs, windowMs: WINDOW_MS });
  }
  const sorted = Array.from(energies.rms).sort((a, b) => a - b);
  const median = Math.max(1, percentile(sorted, 0.5));
  // The file's own noise floor, from its quietest tenth — estimated per FILE
  // rather than per window, because a window that is entirely room tone would
  // otherwise compute its floor from itself and report a flattering SNR for
  // silence.
  //
  // The `min` against a fraction of the median is not a refinement, it is a
  // correctness fix, and it was found by this lane's own eval failing with
  // ZERO eligible windows on a normal-looking lecture. On a recording that is
  // MOSTLY CONTINUOUS SPEECH — which every good lecture is — the tenth
  // percentile of frame energy IS speech. The floor then sits at speaking
  // level, every frame fails the voicing test, every window is rejected as
  // `mostly_silence`, and the lane refuses `video_enroll_no_usable_window` on
  // its single most normal input while every number in the row looks
  // plausible. Capping the floor at a fraction of the median makes the
  // estimator degrade toward "quiet relative to this speaker" instead of
  // toward nonsense.
  const noiseFloor = Math.max(1, Math.min(percentile(sorted, 0.1), 0.2 * median));
  // A frame counts as voiced when it stands clearly above that floor — 3x,
  // ≈9.5 dB — but never above 40% of the file's own median level, for the
  // same reason. Relative rather than a fixed dBFS: a lecture recorded
  // quietly on a phone and one recorded into a desk mic have very different
  // absolute levels and the same structure.
  const voicedThreshold = Math.max(60, Math.min(noiseFloor * 3, 0.4 * median));
  const floors = { noiseFloor, voicedThreshold };

  const minPurity = Number.isFinite(options.minPurity) ? Number(options.minPurity) : 0.75;
  const limit = Math.max(1, Math.min(64, Number(options.limit) || 12));
  const segments = Array.isArray(options.segments) ? options.segments : null;

  const scored = [];
  const rejected = [];
  for (let start = 0; start + framesPerWindow <= energies.rms.length; start += framesPerHop) {
    const startMs = start * FRAME_MS;
    const row = scoreWindow(energies, start, start + framesPerWindow, floors, startMs, startMs + WINDOW_MS, segments);
    // Two disqualifications, both NAMED. A silently dropped window is a
    // window an operator cannot ask about.
    if (row.speaker_purity !== null && row.speaker_purity < minPurity) {
      rejected.push({ ...row, rejected_reason: "multiple_speakers" });
    } else if (row.voiced_fraction < 0.4) {
      rejected.push({ ...row, rejected_reason: "mostly_silence" });
    } else {
      scored.push(row);
    }
  }
  // Ties break on START TIME, ascending, so the ranking is a total order and
  // two runs over identical bytes cannot disagree. Without this an equal-
  // scoring pair could swap on sort implementation and the determinism
  // assertion would fail intermittently, which is worse than failing.
  scored.sort((a, b) => (b.score - a.score) || (a.start_ms - b.start_ms));
  const candidates = scored.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));

  const head = scored.find((row) => row.start_ms === 0) || null;
  return Object.freeze({
    selected: candidates[0] || null,
    candidates: Object.freeze(candidates),
    rejected: Object.freeze(rejected.slice(0, limit)),
    stats: Object.freeze({
      duration_ms: pcm.durationMs,
      windows_scored: scored.length + rejected.length,
      windows_eligible: scored.length,
      windows_rejected: rejected.length,
      noise_floor_rms: round(noiseFloor, 1),
      diarization_present: Boolean(segments && segments.length),
      // The number the owner's complaint is about, kept explicitly: how much
      // better than "just take the first ten seconds" this run actually did.
      // It is `null` when the head was disqualified, which is itself the
      // answer to "was the first window usable at all".
      head_window_score: head ? head.score : null,
      head_window_rank: head ? scored.indexOf(head) + 1 : null,
      selected_over_head_delta: head && candidates[0] ? round(candidates[0].score - head.score) : null,
      score_source: WINDOW_SCORE_SOURCE,
    }),
  });
}
