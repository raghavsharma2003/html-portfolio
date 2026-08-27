import { sha256Hex } from "./contracts.js";

export const DIARIZATION_CHUNK_MS = 14 * 60 * 1000;
export const DIARIZATION_OVERLAP_MS = 60 * 1000;
const MAX_CHUNKS = 64;

function fail(code, retryable = false) {
  throw Object.assign(new Error(code), { code, retryable });
}

function overlapMs(left, right) {
  return Math.max(0, Math.min(left.end_ms, right.end_ms) - Math.max(left.start_ms, right.start_ms));
}

/**
 * Reconcile local diarizer labels across overlapping chunks.
 *
 * Labels are joined only when the same absolute-time speech overlaps in both
 * analyses. An ambiguous or silent boundary creates a new global speaker
 * instead of guessing identity. That can split one person conservatively; it
 * can never merge a guest into the owner merely because both were locally
 * called `cluster-1`.
 */
export function reconcileDiarizationChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > MAX_CHUNKS) {
    fail("chunked_diarization_chunks_invalid");
  }
  const output = [];
  let committedThrough = -1;
  let nextSpeaker = 1;
  const allocate = () => `cluster-${nextSpeaker++}`;

  for (const [index, chunk] of chunks.entries()) {
    const startMs = Number(chunk.startMs);
    const endMs = Number(chunk.endMs);
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs ||
        !Array.isArray(chunk.segments) || !chunk.segments.length) {
      fail("chunked_diarization_chunk_invalid");
    }
    const absolute = chunk.segments.map((segment) => ({
      ...segment,
      start_ms: startMs + Number(segment.start_ms),
      end_ms: startMs + Number(segment.end_ms),
    }));
    if (absolute.some((segment) => !Number.isInteger(segment.start_ms) || !Number.isInteger(segment.end_ms) ||
        segment.start_ms < startMs || segment.end_ms <= segment.start_ms || segment.end_ms > endMs + 250)) {
      fail("chunked_diarization_span_invalid");
    }

    const localKeys = [...new Set(absolute.map((segment) => String(segment.speaker_key)))];
    const mapping = new Map();
    if (index > 0) {
      const overlapEnd = Math.min(committedThrough, endMs);
      const prior = output.filter((segment) => segment.end_ms > startMs && segment.start_ms < overlapEnd);
      const current = absolute.filter((segment) => segment.end_ms > startMs && segment.start_ms < overlapEnd);
      const scores = [];
      for (const localKey of localKeys) {
        for (const globalKey of new Set(prior.map((segment) => segment.speaker_key))) {
          let score = 0;
          for (const left of current) {
            if (left.speaker_key !== localKey) continue;
            for (const right of prior) {
              if (right.speaker_key === globalKey) score += overlapMs(left, right);
            }
          }
          if (score > 0) scores.push({ localKey, globalKey, score });
        }
      }
      const usedGlobals = new Set();
      for (const candidate of scores.sort((a, b) => b.score - a.score || a.localKey.localeCompare(b.localKey))) {
        if (mapping.has(candidate.localKey) || usedGlobals.has(candidate.globalKey)) continue;
        mapping.set(candidate.localKey, candidate.globalKey);
        usedGlobals.add(candidate.globalKey);
      }
    }
    for (const localKey of localKeys) if (!mapping.has(localKey)) mapping.set(localKey, allocate());

    const emitAfter = index === 0 ? startMs : committedThrough;
    for (const segment of absolute) {
      if (segment.end_ms <= emitAfter) continue;
      output.push(Object.freeze({
        ...segment,
        start_ms: Math.max(segment.start_ms, emitAfter),
        speaker_key: mapping.get(String(segment.speaker_key)),
      }));
    }
    committedThrough = Math.max(committedThrough, endMs);
  }
  if (!output.length || output.length > 10_000) fail("chunked_diarization_output_invalid");
  return Object.freeze(output);
}

export function createChunkedDiarizationAdapter(options = {}) {
  const delegate = options.delegate;
  const analyzeChunk = options.analyzeChunk;
  const withMaterializedAudio = options.withMaterializedAudio;
  if (!delegate?.diarize || typeof analyzeChunk !== "function" || typeof withMaterializedAudio !== "function") {
    fail("chunked_diarization_dependencies_required");
  }
  const chunkMs = Number(options.chunkMs || DIARIZATION_CHUNK_MS);
  const overlap = Number(options.overlapMs || DIARIZATION_OVERLAP_MS);
  if (!Number.isInteger(chunkMs) || chunkMs < 60_000 || chunkMs > 15 * 60 * 1000 ||
      !Number.isInteger(overlap) || overlap < 5_000 || overlap >= chunkMs / 2) {
    fail("chunked_diarization_bounds_invalid");
  }
  return Object.freeze({
    ...delegate,
    version: `${delegate.version}+overlap-chunks-v1`,
    async diarize(request) {
      if (!Array.isArray(request.inputs) || request.inputs.length !== 1) fail("chunked_diarization_input_invalid");
      const input = request.inputs[0];
      const durationMs = Number(input.duration_ms ?? request.source?.duration_ms);
      if (!Number.isInteger(durationMs) || durationMs < 1) fail("chunked_diarization_duration_required");
      if (durationMs <= chunkMs) return delegate.diarize(request);
      const chunks = [];
      await withMaterializedAudio({ source: request.source, input, signal: request.signal }, async ({ extractWindow }) => {
        let startMs = 0;
        for (let index = 0; startMs < durationMs; index++) {
          if (index >= MAX_CHUNKS) fail("chunked_diarization_too_many_chunks");
          const endMs = Math.min(durationMs, startMs + chunkMs);
          const body = await extractWindow(startMs, endMs, { rate: 16_000 });
          const chunkInput = Object.freeze({
            artifact_id: null,
            storage_bucket: input.storage_bucket || request.source?.storage_bucket,
            object_path: input.object_path,
            sha256: sha256Hex(body),
            mime: "audio/wav",
            duration_ms: endMs - startMs,
          });
          const result = await analyzeChunk({ request, input: chunkInput, body });
          chunks.push({ startMs, endMs, segments: result.segments });
          if (endMs === durationMs) break;
          startMs = endMs - overlap;
        }
      }, { signal: request.signal });
      return Object.freeze({ segments: reconcileDiarizationChunks(chunks) });
    },
  });
}
