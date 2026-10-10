const PCM_FORMAT = 1;
const EXPECTED_SAMPLE_RATE = 24_000;
const EXPECTED_CHANNELS = 1;
const EXPECTED_BITS_PER_SAMPLE = 16;
const EXPECTED_BLOCK_ALIGN = 2;
const EXPECTED_BYTE_RATE = 48_000;
const MAX_DURATION_DRIFT_MS = 2;

function reject(code) {
  throw Object.assign(new Error(code), { code, status: 409 });
}

function tag(bytes, offset) {
  return bytes.toString("ascii", offset, offset + 4);
}

function boundedChunk(bytes, offset, size) {
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end < offset || end > bytes.length) reject("wav_chunk_truncated");
  return end;
}

// Strictly probes the one enrollment format Vyakti owns end to end. This is
// intentionally not a general media decoder: the browser recorder and every
// approved enhancement adapter must emit canonical 24 kHz mono PCM16 WAV.
export function probeEnrollmentWav(value, options = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 44 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE")
    reject("wav_container_invalid");
  const riffBytes = bytes.readUInt32LE(4) + 8;
  if (riffBytes !== bytes.length) reject("wav_container_length_mismatch");

  let format = null;
  let dataOffset = -1;
  let dataBytes = -1;
  let cursor = 12;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) reject("wav_chunk_truncated");
    const kind = tag(bytes, cursor);
    const size = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = boundedChunk(bytes, start, size);
    if (kind === "fmt ") {
      if (format || size < 16) reject("wav_format_invalid");
      format = Object.freeze({
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      });
    } else if (kind === "data") {
      if (dataOffset >= 0 || size === 0) reject("wav_data_invalid");
      dataOffset = start;
      dataBytes = size;
    }
    cursor = end + (size % 2);
    if (cursor > bytes.length) reject("wav_chunk_padding_invalid");
  }
  if (cursor !== bytes.length || !format || dataOffset < 0) reject("wav_structure_invalid");
  if (format.encoding !== PCM_FORMAT || format.channels !== EXPECTED_CHANNELS ||
      format.sampleRate !== EXPECTED_SAMPLE_RATE || format.byteRate !== EXPECTED_BYTE_RATE ||
      format.blockAlign !== EXPECTED_BLOCK_ALIGN || format.bitsPerSample !== EXPECTED_BITS_PER_SAMPLE) {
    reject("wav_format_unsupported");
  }
  if (dataBytes % format.blockAlign !== 0) reject("wav_frame_alignment_invalid");

  const frames = dataBytes / format.blockAlign;
  const durationMs = Math.round(frames * 1000 / format.sampleRate);
  const expectedDurationMs = Number(options.expectedDurationMs);
  if (Number.isFinite(expectedDurationMs) &&
      Math.abs(durationMs - expectedDurationMs) > MAX_DURATION_DRIFT_MS) {
    reject("wav_duration_mismatch");
  }

  let sumSquares = 0;
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  let active = 0;
  for (let offset = dataOffset; offset < dataOffset + dataBytes; offset += 2) {
    const sample = bytes.readInt16LE(offset);
    const magnitude = Math.abs(sample);
    const normalized = sample / 32_768;
    sum += sample;
    sumSquares += normalized * normalized;
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= 32_760) clipped += 1;
    if (magnitude >= 96) active += 1;
  }
  const rms = Math.sqrt(sumSquares / frames);
  const dcOffset = Math.abs(sum / frames) / 32_768;
  const clippedRatio = clipped / frames;
  const activeRatio = active / frames;
  if (rms < 0.001 || peak < 256 || activeRatio < 0.01) reject("wav_signal_missing");
  if (dcOffset > 0.1) reject("wav_dc_offset_excessive");
  if (clippedRatio > 0.1) reject("wav_clipping_excessive");

  return Object.freeze({
    encoding: "pcm_s16le",
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    frames,
    dataBytes,
    durationMs,
    peak: peak / 32_768,
    rms,
    activeRatio,
    clippedRatio,
    dcOffset,
  });
}
