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

function fail(code) {
  throw Object.assign(new Error(code), { code, retryable: false });
}

/** The cluster with the most total speech, and just its segments, sorted. */
export function ownerClusterSegments(segments) {
  const totals = new Map();
  for (const segment of segments) {
    const duration = segment.end_ms - segment.start_ms;
    totals.set(segment.speaker_key, (totals.get(segment.speaker_key) || 0) + duration);
  }
  let speakerKey = null;
  let best = -1;
  for (const [key, total] of totals) {
    if (total > best) { best = total; speakerKey = key; }
  }
  return Object.freeze({
    speakerKey,
    totalMs: Math.max(0, best),
    segments: Object.freeze(
      segments.filter((segment) => segment.speaker_key === speakerKey).sort((a, b) => a.start_ms - b.start_ms),
    ),
  });
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

/** A minimal canonical PCM16 mono WAV, same shape `windows.js` reads and the
 *  voice-evidence service accepts. Rewritten rather than sliced out of
 *  ffmpeg's header because a byte-range slice of an arbitrary WAV can land
 *  inside a non-`data` chunk; a fresh 44-byte header over the exact sample
 *  range never can. */
export function wavBytesForSamples(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
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
export async function selectOwnerReferenceWindow({ segments, withMaterializedAudio, sourceBytes }) {
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

  return withMaterializedAudio(sourceBytes, async ({ extractWindow }) => {
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

    const offsetSamples = Math.round((best.window.start_ms / 1000) * SAMPLE_RATE);
    const lengthSamples = Math.round(((best.window.end_ms - best.window.start_ms) / 1000) * SAMPLE_RATE);
    // NOT a fixed 44-byte offset: ffmpeg writing to a pipe cannot know the
    // final byte count in advance, so it emits a `data` chunk with size
    // 0xFFFFFFFF and, measured against the real binary, an INFO `LIST` chunk
    // ahead of `data` -- pushing the real payload well past 44 bytes. Reusing
    // `readPcm16Wav`'s own chunk walk (it already clamps an oversized `data`
    // declaration to what is actually present, for exactly this shape) is
    // both correct and the same reuse-not-reimplement rule the rest of this
    // module follows.
    const parsed = readPcm16Wav(best.wav);
    const slice = parsed.samples.subarray(offsetSamples * BYTES_PER_SAMPLE, (offsetSamples + lengthSamples) * BYTES_PER_SAMPLE);
    if (slice.length !== lengthSamples * BYTES_PER_SAMPLE) fail("reference_window_slice_out_of_range");

    return Object.freeze({
      wavBytes: wavBytesForSamples(slice),
      durationMs: best.window.end_ms - best.window.start_ms,
      // Where this window sits in the ORIGINAL recording, for audit -- the run
      // started at `run.start_ms` in the original timeline, and the window is
      // an offset within the run.
      originalStartMs: best.run.start_ms + best.window.start_ms,
      originalEndMs: best.run.start_ms + best.window.end_ms,
      score: best.window.score,
      speakerKey: owner.speakerKey,
      windowsConsidered: bounded.length,
      scoreSource: best.window.score_source,
    });
  });
}
