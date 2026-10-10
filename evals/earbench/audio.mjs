// earbench audio — every treatment that stops a listener telling the arms apart
// by anything except the sound of the voice.
//
// ── the leak this file was written for ────────────────────────────────────
// `api/_voice/contracts.js::renderTextWithDisclosure` prepends the literal
// sentence "This is an AI-generated voice replica." to EVERY synthesis request,
// and the runtime speaks it. That is correct product behaviour and it is a
// total unblinding of any listening test: the synthetic arm announces itself,
// out loud, in the first two seconds, in every trial. No amount of filename
// hygiene survives it.
//
// So the clone arms are trimmed at the pause after the disclosure, and the REAL
// arm is put through the identical trim/normalise/pad path so that trimming
// artifacts, loudness and file length are constants of the bench rather than
// cues. Two checks stand behind the trim, because a trim that silently ate the
// first word of the sentence would corrupt the bench in the other direction:
//
//   1. arithmetic  — the removed prefix must be a plausible length for the
//                    disclosure, and what remains a plausible length for the
//                    target text. Cheap, offline, always run, FAILS CLOSED.
//   2. transcript  — the trimmed clip, sent through the ASR lane, must not
//                    contain the disclosure and must contain the target text.
//                    Strong, costs an API call, run when SARVAM_API_KEY is set.
//
// There is deliberately no third check "the operator listens to the clips",
// because on this bench the operator IS the listener and that check would
// unblind the run it was protecting. `earbench.mjs verify-trim` exists instead:
// it writes the REMOVED PREFIXES ONLY, shuffled and unlabelled, so a human can
// confirm they are all the disclosure sentence without hearing a single
// stimulus or learning which file is which.
import { createHash } from "node:crypto";

export const SAMPLE_RATE = 24_000;

/** Walks the RIFF chunk list. A fixed 44-byte offset returns ffmpeg's LIST/INFO
 * metadata as if it were audio — the defect that once produced four 6-byte
 * "reference windows" (scripts/first-clone.mjs carries the same walk). */
export function wavPcm(bytes) {
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    if (kind === "data") return bytes.subarray(cursor + 8, cursor + 8 + size);
    cursor += 8 + size + (size % 2);
  }
  throw new Error("wav_data_chunk_missing");
}

/**
 * Canonical 24 kHz mono PCM16 WAV, optionally padded to an exact byte length.
 * The padding is a trailing `JUNK` chunk, so equal file size costs zero samples
 * of audio: every player ignores it and every `ls -l` sees one number.
 * File size is a real leak — a 3.1 s clip and a 4.4 s clip are different files
 * on disk and a listener who sorts by size has the whole key.
 */
export function wrapWav(pcm, { padToBytes = 0 } = {}) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  let out = Buffer.concat([header, Buffer.from(pcm)]);
  if (padToBytes && padToBytes > out.length) {
    const padBytes = padToBytes - out.length - 8;
    if (padBytes < 0) throw new Error("earbench_pad_target_too_small");
    const junk = Buffer.alloc(8 + padBytes);
    junk.write("JUNK", 0, "ascii");
    junk.writeUInt32LE(padBytes, 4);
    out = Buffer.concat([out, junk]);
  }
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

export function samples(pcm) {
  const out = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

export function toPcm(values) {
  const out = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i += 1) {
    const clipped = Math.max(-1, Math.min(1, values[i]));
    out.writeInt16LE(Math.round(clipped * 32767), i * 2);
  }
  return out;
}

export function rms(values) {
  if (!values.length) return 0;
  let total = 0;
  for (const v of values) total += v * v;
  return Math.sqrt(total / values.length);
}

/**
 * Loudness is the cheapest arm cue there is, and a listener does not have to
 * know they are using it. Every stimulus leaves here at the same RMS, with a
 * peak guard rather than a limiter — a clip that would clip is scaled down and
 * the shortfall is REPORTED, never silently accepted, because a quieter clip is
 * exactly the leak this function exists to close.
 */
export function normalise(values, targetRms = 0.06, peakCeiling = 0.95) {
  const current = rms(values);
  if (!current) return { values, gain: 0, clipped: false, achievedRms: 0 };
  let gain = targetRms / current;
  let peak = 0;
  for (const v of values) peak = Math.max(peak, Math.abs(v));
  let clipped = false;
  if (peak * gain > peakCeiling) {
    gain = peakCeiling / peak;
    clipped = true;
  }
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] * gain;
  return { values: out, gain, clipped, achievedRms: rms(out) };
}

/** A short fade removes the click a hard cut leaves, which is itself a cue —
 * only the trimmed arm would click. Applied to every arm. */
export function fade(values, ms = 12) {
  const n = Math.min(Math.floor((ms / 1000) * SAMPLE_RATE), Math.floor(values.length / 2));
  const out = Float32Array.from(values);
  for (let i = 0; i < n; i += 1) {
    const k = i / n;
    out[i] *= k;
    out[out.length - 1 - i] *= k;
  }
  return out;
}

export function frameRms(values, frameMs = 10) {
  const size = Math.floor((frameMs / 1000) * SAMPLE_RATE);
  const frames = [];
  for (let offset = 0; offset + size <= values.length; offset += size) {
    frames.push(rms(values.subarray(offset, offset + size)));
  }
  return { frames, size, frameMs };
}

/**
 * Find the pause that separates the spoken disclosure from the target text.
 *
 * Deliberately conservative and deliberately fallible: it returns null rather
 * than guessing when no pause sits inside the plausible window, and the caller
 * FAILS CLOSED on null. A trimmer that always returns something would cut the
 * first syllable of the sentence on the day the model stops pausing, and that
 * failure is silent in a way this one is not.
 */
export function findDisclosureCut(values, {
  minMs = 1_100,
  maxMs = 6_000,
  gapMs = 140,
  floorRatio = 0.08,
} = {}) {
  const { frames, frameMs } = frameRms(values);
  if (!frames.length) return null;
  const peak = Math.max(...frames);
  if (!peak) return null;
  const threshold = Math.max(peak * floorRatio, 1e-4);
  const gapFrames = Math.ceil(gapMs / frameMs);
  const minFrame = Math.floor(minMs / frameMs);
  const maxFrame = Math.ceil(maxMs / frameMs);
  let run = 0;
  for (let i = 0; i < frames.length && i <= maxFrame + gapFrames; i += 1) {
    if (frames[i] < threshold) {
      run += 1;
      const start = i - run + 1;
      if (run >= gapFrames && start >= minFrame && start <= maxFrame) {
        // Cut at the END of the silence, minus one frame of lead-in, so the
        // first phoneme of the target text keeps its onset.
        let end = i;
        while (end + 1 < frames.length && frames[end + 1] < threshold) end += 1;
        const cutFrame = Math.max(start + gapFrames - 1, end - 1);
        return {
          cutMs: cutFrame * frameMs,
          gapMs: (end - start + 1) * frameMs,
          cutSample: cutFrame * Math.floor((frameMs / 1000) * SAMPLE_RATE),
        };
      }
    } else {
      run = 0;
    }
  }
  return null;
}

/** Speech rate bounds used by the arithmetic check. Wide on purpose: this is a
 * plausibility rail against a trim that ate the sentence, not a style metric. */
export const PLAUSIBLE_CHARS_PER_SECOND = Object.freeze({ min: 5, max: 30 });

export function trimPlausible({ cutMs, remainingMs, text, window }) {
  const chars = String(text || "").trim().length;
  const perSecond = remainingMs > 0 ? chars / (remainingMs / 1000) : Infinity;
  const reasons = [];
  if (cutMs < window.minMs || cutMs > window.maxMs) reasons.push(`prefix ${Math.round(cutMs)} ms outside the disclosure window`);
  if (remainingMs < 900) reasons.push(`only ${Math.round(remainingMs)} ms left after the trim`);
  if (perSecond < PLAUSIBLE_CHARS_PER_SECOND.min) reasons.push(`${perSecond.toFixed(1)} chars/s is too slow for the text`);
  if (perSecond > PLAUSIBLE_CHARS_PER_SECOND.max) reasons.push(`${perSecond.toFixed(1)} chars/s is too fast — the trim probably ate speech`);
  return { ok: reasons.length === 0, charsPerSecond: perSecond, reasons };
}

/** Words that must not survive in a trimmed clone clip. Checked case- and
 * punctuation-insensitively against the ASR transcript when one is available. */
export const DISCLOSURE_TOKENS = Object.freeze(["ai-generated", "ai generated", "voice replica", "generated voice"]);

export function transcriptCarriesDisclosure(transcript) {
  const flat = String(transcript || "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return DISCLOSURE_TOKENS.some((token) => flat.includes(token));
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * One treatment, applied identically to every arm: optional disclosure trim,
 * loudness normalisation, edge fades. Returns the treated PCM plus everything
 * the manifest needs to prove the treatment was uniform.
 */
export function treat(pcm, { trim = false, text = "", window = { minMs: 1_100, maxMs: 6_000 }, targetRms = 0.06 } = {}) {
  const all = samples(pcm);
  let cut = null;
  let body = all;
  let prefix = null;
  if (trim) {
    cut = findDisclosureCut(all, window);
    if (!cut) return { ok: false, reason: "no pause found inside the disclosure window", cut: null };
    prefix = all.subarray(0, cut.cutSample);
    body = all.subarray(cut.cutSample);
  }
  const remainingMs = (body.length / SAMPLE_RATE) * 1000;
  const plausible = trim
    ? trimPlausible({ cutMs: cut.cutMs, remainingMs, text, window })
    : { ok: true, charsPerSecond: null, reasons: [] };
  const normalised = normalise(fade(body), targetRms);
  return {
    ok: plausible.ok,
    reason: plausible.reasons.join("; "),
    cut,
    prefixPcm: prefix ? toPcm(prefix) : null,
    pcm: toPcm(normalised.values),
    durationMs: remainingMs,
    gain: normalised.gain,
    peakLimited: normalised.clipped,
    achievedRms: normalised.achievedRms,
    charsPerSecond: plausible.charsPerSecond,
  };
}
