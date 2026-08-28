// Best-window selection for `separate` (WS-AO, 2026-08-26).
//
// ── why this exists ────────────────────────────────────────────────────────
// `separate` used to hand the GPU the WHOLE recording in one forward pass.
// Measured on the owner's real 822.72 s / 32.9 MB upload: `separator.separate_
// batch` on the full waveform fails every time with `voice_evidence_failed`,
// the evidence service's bare `except Exception` -- see
// `context/measurements.md#separate-fails-on-the-whole-recording` for the
// structural case (no named ServiceError could have produced that string; the
// replica's own restartCount stayed 0 across five consecutive attempts, which
// rules out a container-level OOM kill and is consistent with an in-process,
// catchable `torch.cuda.OutOfMemoryError`).
//
// `windowing-belongs-before-the-embedder-not-before-diarize`
// (context/decisions.md) rejected doing this before `diarize`, for a real
// reason: diarize is what tells the owner's voice from a second speaker, and a
// window taken before that exists would be a guess. That objection does not
// apply here. `diarize` is complete for this source before `separate` ever
// runs (the DAG requires it), its segments are durable evidence, and this
// module reads them rather than re-deriving anything.
//
// ── what it does ───────────────────────────────────────────────────────────
// 1. Pick the diarized speaker cluster with the most total speech. Nothing in
//    this pipeline has an enrolled anchor to name the owner for certain --
//    `services/voice-evidence/app.py`'s `_diarize` says so on every segment,
//    `target_likelihood: 0.5` -- so "most speech in a recording the owner
//    uploaded of themselves" is the same working assumption
//    `context/measurements.md` already carries for this exact file (cluster-1,
//    663.5 s of 231 segments, cluster-2 a second voice at 25.9 s). Carried
//    forward here, not invented here.
// 2. Merge that cluster's segments into contiguous runs (small gaps closed),
//    because a synthetic splice between two far-apart segments is exactly the
//    level lurch `scoreWindow` in `windows.js` penalises, and the point of a
//    10 s reference is that Chatterbox conditions on it as ONE continuous
//    breath, not a stitched collage.
// 3. Extract each run from the ORIGINAL recording via ffmpeg (never the whole
//    file at once) and hand it to `rankReferenceWindows` -- the SAME scorer
//    WS-AD built for one-link video enrollment, reused rather than
//    reimplemented, per this file's job.
// 4. Keep only the single highest-scoring ~10 s window across every run.
//
// The GPU only ever sees that one ~10 s clip. Everything upstream of it (the
// merge, the extraction, the scoring) runs on this container's CPU, on audio
// bounded to the owner's own cluster -- never the second speaker's 25.9 s, and
// never more of the recording than the DAG already proved was the owner's.

import { rankReferenceWindows, readPcm16Wav, WINDOW_MS } from "../_video-enroll/windows.js";

const MERGE_GAP_MS = 1_200;
// Defensive ceiling on total ffmpeg work, not a tuning knob. This source's own
// owner cluster (663.5 s) sits comfortably under it; a future upload with far
// more owner speech still gets scored end to end rather than truncated
// silently, up to a quarter hour of extraction.
const MAX_TOTAL_EXTRACT_MS = 900_000;
const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
// The rate the rest of this pipeline requires downstream (`probeEnrollmentWav`,
// the same value `services/voice-evidence/app.py`'s `_enhance` resamples its
// OWN output to). The full-bandwidth extraction below produces the reference
// window at THIS rate, once, from the ORIGINAL recording -- never at the 16
// kHz `SAMPLE_RATE` scoring uses.
const ENROLLMENT_SAMPLE_RATE = 24_000;

function fail(code) {
  throw Object.assign(new Error(code), { code, retryable: false });
}

/** The cluster with the most total speech, and just its segments, sorted.
 *  Also reports `allSpeakersTotalMs` and `dominantShare` -- the fraction of
 *  ALL diarized speech (every cluster) that belongs to the dominant one --
 *  which is what `shouldSkipSeparation` below reads. Diarize already knows
 *  how many speakers it found and how much each spoke; this is that
 *  information surfaced rather than re-derived. */
export function ownerClusterSegments(segments) {
  const totals = new Map();
  let allSpeakersTotalMs = 0;
  for (const segment of segments) {
    const duration = segment.end_ms - segment.start_ms;
    totals.set(segment.speaker_key, (totals.get(segment.speaker_key) || 0) + duration);
    allSpeakersTotalMs += duration;
  }
  let speakerKey = null;
  let best = -1;
  for (const [key, total] of totals) {
    if (total > best) { best = total; speakerKey = key; }
  }
  const totalMs = Math.max(0, best);
  return Object.freeze({
    speakerKey,
    totalMs,
    allSpeakersTotalMs,
    clusterCount: totals.size,
    dominantShare: allSpeakersTotalMs > 0 ? totalMs / allSpeakersTotalMs : 0,
    segments: Object.freeze(
      segments.filter((segment) => segment.speaker_key === speakerKey).sort((a, b) => a.start_ms - b.start_ms),
    ),
  });
}

// How much of ALL diarized speech the dominant cluster must hold before
// `separate`'s neural separation (`sepformer-whamr16k`) is skipped rather than
// run.
//
// ── why this exists ────────────────────────────────────────────────────────
// The owner's complaint ("this ... is not even 0.05% similar ... it's all
// fucked") traced to a real cause: `sepformer-whamr16k` runs at 16 kHz, so its
// Nyquist is 8 kHz, and it ran on EVERY recording -- including this one, a
// single-speaker lecture with a 25.9 s second voice out of 689.4 s diarized
// (dominantShare 0.9624). Separation exists to pull apart OVERLAPPING
// speakers; spending the whole 8-12 kHz band, where speaker-identity cues live
// (measurements.md#enrollment-reference-band-limited-at-8khz), to solve a
// problem a single-speaker recording does not have is a bad trade every time
// it happens, not just on this file.
//
// ── why 0.90 and not some other number ────────────────────────────────────
// Diarize's own cluster threshold (`VOICE_EVIDENCE_CLUSTER_COSINE_THRESHOLD`,
// 0.68) already decides when two voiced spans are "different speakers"; this
// module does not re-decide that. 0.90 asks a coarser question on TOP of that
// clustering: even granting diarize found a second cluster, is it big enough
// to matter? Below 0.90 dominant share, the non-dominant clusters sum to more
// than a tenth of all diarized speech -- e.g. two co-teachers trading a
// lecture, or a Q&A segment -- and separation is doing real work by removing
// bytes an enrollment reference should never have contained in the first
// place. At or above it, everything else is stray cross-talk, a "haan boliye"
// from off-mic, or diarize's own clustering noise, and running a bandwidth-
// destroying model to remove single-digit seconds of that is not a defensible
// trade against losing 4-10 kHz on the owner's OWN, dominant voice.
//
// ── what would reverse it ─────────────────────────────────────────────────
// A measured case where a recording just above 0.90 dominant share still has
// audible bleed-through in its selected window's reference audio -- that would
// argue the threshold is too low. Nothing in this session found one; the only
// real recording measured (the owner's) sits at 0.9624, well clear of it
// either way, and the negative control below feeds the OLD code path a window
// that had actually gone through separation, to prove the new gate would have
// caught the regression this file fixes.
export const SEPARATION_DOMINANT_SHARE_THRESHOLD = 0.90;

/** Should `separate`'s neural model run at all for this cluster split? */
export function shouldSkipSeparation(owner) {
  return owner.dominantShare >= SEPARATION_DOMINANT_SHARE_THRESHOLD;
}

/** Adjacent-in-time segments of the SAME cluster, closed into runs. A run is a
 *  span ffmpeg extracts in one continuous cut -- never a splice of two. */
export function mergeRuns(segments, gapMs = MERGE_GAP_MS) {
  const runs = [];
  for (const segment of segments) {
    const last = runs[runs.length - 1];
    if (last && segment.start_ms - last.end_ms <= gapMs) {
      last.end_ms = Math.max(last.end_ms, segment.end_ms);
    } else {
      runs.push({ start_ms: segment.start_ms, end_ms: segment.end_ms });
    }
  }
  return runs;
}

/** A minimal canonical PCM16 mono WAV, same shape `windows.js` reads (at the
 *  default 16 kHz) and the voice-evidence service accepts. Rewritten rather
 *  than sliced out of ffmpeg's header because a byte-range slice of an
 *  arbitrary WAV can land inside a non-`data` chunk; a fresh 44-byte header
 *  over the exact sample range never can. `sampleRate` is a parameter now
 *  (WS-AS) rather than always the module's fixed scoring rate: this same
 *  builder also has to speak for the full-bandwidth delivery clip in test
 *  fixtures that stand in for a real ffmpeg extraction. */
export function wavBytesForSamples(samples, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/**
 * Score every candidate window across the owner's own diarized speech and
 * return the single best one, or `null` if the cluster has no run long enough
 * to host a single 10 s window (a genuinely short or fragmented upload).
 *
 * @param {object[]} segments  diarize's `speaker_segment` evidence rows for
 *   this source: `{start_ms, end_ms, speaker_key, confidence}`.
 * @param {(bytes: Buffer, fn: (tools: {extractWindow}) => Promise) => Promise}
 *   withMaterializedAudio  from `createNativeToolRunners`.
 * @param {Buffer} sourceBytes  the ORIGINAL recording, already resolved.
 */
export async function selectOwnerReferenceWindow({ segments, withMaterializedAudio, sourceBytes, sourceInput }) {
  if (!Array.isArray(segments) || !segments.length) fail("reference_window_no_diarization");
  const owner = ownerClusterSegments(segments);
  if (!owner.segments.length) fail("reference_window_no_owner_cluster");

  let runs = mergeRuns(owner.segments).filter((run) => run.end_ms - run.start_ms >= WINDOW_MS);
  if (!runs.length) {
    // Nothing reaches one full window contiguously. Report this rather than
    // padding or splicing to manufacture a candidate that was not there --
    // "prefer an error to a believable value".
    return null;
  }
  runs.sort((a, b) => (b.end_ms - b.start_ms) - (a.end_ms - a.start_ms));
  let budget = MAX_TOTAL_EXTRACT_MS;
  const bounded = [];
  for (const run of runs) {
    if (budget < WINDOW_MS) break;
    const duration = Math.min(run.end_ms - run.start_ms, budget);
    bounded.push({ start_ms: run.start_ms, end_ms: run.start_ms + duration });
    budget -= duration;
  }

  return withMaterializedAudio(sourceInput || sourceBytes, async ({ extractWindow }) => {
    let best = null;
    for (const run of bounded) {
      const wav = await extractWindow(run.start_ms, run.end_ms);
      let ranked;
      try {
        ranked = rankReferenceWindows(wav);
      } catch {
        continue; // this particular run scored no eligible window; try the next
      }
      if (!ranked.selected) continue;
      if (!best || ranked.selected.score > best.window.score) {
        best = { run, wav, window: ranked.selected, stats: ranked.stats };
      }
    }
    if (!best) return null;

    // ── WS-AS, 2026-08-27: the bandwidth fix ────────────────────────────────
    // The old code sliced these bytes straight out of `best.wav` -- the SAME
    // 16 kHz buffer `extractWindow`'s default rate produced purely so
    // `rankReferenceWindows` had the one shape it accepts. That made the
    // scoring bandwidth into the delivery bandwidth: everything above 8 kHz
    // was discarded before `separate` or `enhance` ever saw a sample, no
    // matter what those stages did afterward. Measured on the owner's real
    // enrollment reference: 79.61% of energy sat in 0-1000 Hz, 10.43% in
    // 1000-4000 Hz, 9.50% in 4000-8000 Hz, and 0.46% -- essentially empty --
    // above 8000 Hz, which is exactly the Nyquist this 16 kHz buffer imposes.
    // Speaker-identity cues live substantially in 4-10 kHz, so a reference
    // built this way was always going to make Chatterbox fall back toward its
    // own base timbre rather than the owner's.
    //
    // The fix: once the winning window's position in the ORIGINAL timeline is
    // known (`originalStartMs`/`originalEndMs`, computed below exactly as
    // before), cut THAT span again, fresh, from the same materialized
    // ORIGINAL file -- never from `best.wav` -- at `ENROLLMENT_SAMPLE_RATE`
    // (24 kHz, the rate the rest of this pipeline already requires
    // downstream, `probeEnrollmentWav`). One resample, from the true source,
    // done once. `best.wav` remains exactly what it always was: a scoring
    // artifact that never leaves this function.
    const originalStartMs = best.run.start_ms + best.window.start_ms;
    const originalEndMs = best.run.start_ms + best.window.end_ms;
    const wavBytes = await extractWindow(originalStartMs, originalEndMs, { rate: ENROLLMENT_SAMPLE_RATE });
    // Sanity check on the tool's own output, not a re-derivation of the score:
    // a full-bandwidth cut of the same span must decode to (approximately) the
    // same duration the 16 kHz scoring pass measured. A mismatch means the two
    // extractions disagreed about where the window sits, which is a bug worth
    // failing loudly on rather than shipping a reference of the wrong length.
    const fullBandwidth = readWavHeaderDurationMs(wavBytes, ENROLLMENT_SAMPLE_RATE);
    const expectedMs = best.window.end_ms - best.window.start_ms;
    if (Math.abs(fullBandwidth - expectedMs) > 200) fail("reference_window_bandwidth_extract_mismatch");

    return Object.freeze({
      wavBytes,
      durationMs: expectedMs,
      sampleRate: ENROLLMENT_SAMPLE_RATE,
      // Where this window sits in the ORIGINAL recording, for audit -- the run
      // started at `run.start_ms` in the original timeline, and the window is
      // an offset within the run.
      originalStartMs,
      originalEndMs,
      score: best.window.score,
      speakerKey: owner.speakerKey,
      windowsConsidered: bounded.length,
      scoreSource: best.window.score_source,
      // Whether `separate`'s neural model should run at all for this source --
      // see `shouldSkipSeparation`'s header for the reasoning and threshold.
      separationSkipped: shouldSkipSeparation(owner),
      dominantShare: owner.dominantShare,
      clusterCount: owner.clusterCount,
    });
  });
}

/**
 * Duration in ms read from a WAV's OWN `fmt`/`data` chunks -- deliberately
 * NOT `windows.js`'s `readPcm16Wav`, which hard-refuses any rate but its own
 * fixed 16 kHz (`window_audio_sample_rate_invalid`) because that file's job is
 * scoring windows at one comparable rate. This one has the opposite job: read
 * whatever rate the full-bandwidth extraction actually produced and report it
 * honestly, so a genuine mismatch fails loudly here instead of throwing an
 * unrelated code two modules away.
 */
function readWavHeaderDurationMs(wavBytes, expectedSampleRate) {
  const buffer = Buffer.isBuffer(wavBytes) ? wavBytes : Buffer.from(wavBytes || []);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    fail("reference_window_bandwidth_extract_not_wav");
  }
  let offset = 12;
  let sampleRate = null;
  let dataLength = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") sampleRate = buffer.readUInt32LE(body + 4);
    else if (id === "data") dataLength = Math.min(size, buffer.length - body);
    offset = body + size + (size % 2);
  }
  if (!Number.isInteger(sampleRate) || !Number.isInteger(dataLength) || sampleRate <= 0) {
    fail("reference_window_bandwidth_extract_not_wav");
  }
  if (sampleRate !== expectedSampleRate) fail("reference_window_bandwidth_extract_rate_mismatch");
  const sampleCount = Math.floor(dataLength / BYTES_PER_SAMPLE);
  return Math.round((sampleCount * 1000) / sampleRate);
}
