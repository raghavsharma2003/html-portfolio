import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const BENCHMARK_VERSION = "vyakti-voice-listening-benchmark/v1";
export const SAMPLE_RATE = 24_000;
export const AXES = Object.freeze([
  Object.freeze({
    id: "owner_likeness",
    label: "Owner likeness",
    low: "clearly a different person",
    high: "sounds exactly like the real owner",
  }),
  Object.freeze({
    id: "naturalness",
    label: "Naturalness and humanness",
    low: "robotic or synthetic",
    high: "ordinary human speech",
  }),
  Object.freeze({
    id: "indian_accent",
    label: "Indian accent fit for this language",
    low: "foreign or unnatural accent",
    high: "native Hindi, Hinglish, or Indian English",
  }),
  Object.freeze({
    id: "pronunciation",
    label: "Pronunciation and intelligibility",
    low: "wrong or hard to understand",
    high: "every word is correct and clear",
  }),
]);

export const DISCLOSURE_OPTIONS = Object.freeze([
  Object.freeze({ id: "full", label: "Yes, in full" }),
  Object.freeze({ id: "partial", label: "Partly or unclear" }),
  Object.freeze({ id: "absent", label: "No" }),
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function seededRandom(secret, label) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let cursor = 0;
  return () => {
    if (cursor + 4 > pool.length) {
      pool = createHmac("sha256", secret).update(`${label}\n${counter++}`).digest();
      cursor = 0;
    }
    const value = pool.readUInt32BE(cursor) / 0x1_0000_0000;
    cursor += 4;
    return value;
  };
}

export function shuffled(values, random) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

export function opaqueId(secret, ...parts) {
  return createHmac("sha256", secret).update(parts.join("\n")).digest("hex").slice(0, 24);
}

export function parseWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("benchmark_wav_container_invalid");
  }
  let cursor = 12;
  let format = null;
  let pcm = null;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error("benchmark_wav_chunk_invalid");
    if (kind === "fmt ") {
      if (size < 16) throw new Error("benchmark_wav_format_invalid");
      format = Object.freeze({
        codec: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      });
    }
    if (kind === "data") pcm = Buffer.from(bytes.subarray(start, end));
    cursor = end + (size % 2);
  }
  if (!format || !pcm || format.codec !== 1 || format.channels !== 1 || format.sampleRate !== SAMPLE_RATE || format.bitsPerSample !== 16) {
    throw new Error("benchmark_wav_format_invalid");
  }
  if (format.byteRate !== SAMPLE_RATE * 2 || format.blockAlign !== 2 || pcm.length % 2 !== 0) {
    throw new Error("benchmark_wav_geometry_invalid");
  }
  return Object.freeze({
    ...format,
    pcm,
    samples: pcm.length / 2,
    durationMs: Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000),
  });
}

export function wrapWav(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) throw new Error("benchmark_pcm_invalid");
  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVEfmt ", 8, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

export function pcmStats(pcm) {
  if (!pcm.length) throw new Error("benchmark_pcm_empty");
  let sum = 0;
  let peak = 0;
  for (let cursor = 0; cursor < pcm.length; cursor += 2) {
    const value = pcm.readInt16LE(cursor) / 32768;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return Object.freeze({ rms: Math.sqrt(sum / (pcm.length / 2)), peak });
}

export function commonTargetRms(pcms, preferred = 0.05, peakCeiling = 0.92) {
  const ceilings = pcms.map((pcm) => {
    const { rms, peak } = pcmStats(pcm);
    if (!rms || !peak) throw new Error("benchmark_pcm_silent");
    return (rms * peakCeiling) / peak;
  });
  return Math.min(preferred, ...ceilings);
}

export function normaliseAndPad(pcm, { targetRms, samples: targetSamples, fadeMs = 10 }) {
  const stats = pcmStats(pcm);
  const gain = targetRms / stats.rms;
  if (stats.peak * gain > 0.920001) throw new Error("benchmark_normalisation_peak_invalid");
  const sourceSamples = pcm.length / 2;
  if (sourceSamples > targetSamples) throw new Error("benchmark_pad_target_short");
  const out = Buffer.alloc(targetSamples * 2);
  const fadeSamples = Math.min(Math.floor((fadeMs / 1000) * SAMPLE_RATE), Math.floor(sourceSamples / 2));
  for (let index = 0; index < sourceSamples; index += 1) {
    let envelope = 1;
    if (index < fadeSamples) envelope = index / Math.max(1, fadeSamples);
    if (index >= sourceSamples - fadeSamples) envelope = Math.min(envelope, (sourceSamples - 1 - index) / Math.max(1, fadeSamples));
    const value = Math.max(-1, Math.min(1, (pcm.readInt16LE(index * 2) / 32768) * gain * Math.max(0, envelope)));
    out.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  return Object.freeze({ pcm: out, gain, sourceSamples, achievedRms: pcmStats(out.subarray(0, pcm.length)).rms });
}

export function tonePcm({ frequency = 660, durationMs = 800, amplitude = 0.12 } = {}) {
  const count = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const out = Buffer.alloc(count * 2);
  const fade = Math.floor(0.03 * SAMPLE_RATE);
  for (let index = 0; index < count; index += 1) {
    const edge = Math.min(1, index / fade, (count - 1 - index) / fade);
    const value = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * amplitude * Math.max(0, edge);
    out.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  return out;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function buildCells(stimuli) {
  const cells = new Map();
  for (const stimulus of stimuli) {
    const identity = sha256(`${stimulus.language}\n${stimulus.textSha256}`).slice(0, 16);
    const cell = cells.get(identity) || {
      id: identity,
      language: stimulus.language,
      textSha256: stimulus.textSha256,
      stimulusIds: [],
      candidateIds: new Set(),
    };
    cell.stimulusIds.push(stimulus.id);
    cell.candidateIds.add(stimulus.candidateId);
    cells.set(identity, cell);
  }
  return [...cells.values()].map((cell) => Object.freeze({
    id: cell.id,
    language: cell.language,
    textSha256: cell.textSha256,
    stimulusIds: Object.freeze([...cell.stimulusIds]),
    candidateIds: Object.freeze([...cell.candidateIds]),
    comparison: cell.stimulusIds.length > 1 && cell.candidateIds.size > 1 ? "matched_text" : "unmatched_lane",
  }));
}

export function validateRating(value) {
  return AXES.every((axis) => Number.isInteger(value?.[axis.id]) && value[axis.id] >= 1 && value[axis.id] <= 5)
    && DISCLOSURE_OPTIONS.some((option) => option.id === value?.disclosure);
}

export function validateSheet(sheet, servedTrials, runId) {
  const trialIds = new Set(servedTrials.sequence.map((trial) => trial.trialId));
  const problems = [];
  if (sheet?.runId !== runId) problems.push("run_id_mismatch");
  if (!sheet?.complete) problems.push("sheet_incomplete");
  for (const trial of servedTrials.sequence) {
    const answer = sheet?.answers?.[trial.trialId];
    if (trial.kind === "rating" && !validateRating(answer)) problems.push(`rating_invalid:${trial.trialId}`);
    if (trial.kind === "attention" && !["tone", "speech", "silence"].includes(answer?.choice)) problems.push(`attention_invalid:${trial.trialId}`);
  }
  for (const id of Object.keys(sheet?.answers || {})) if (!trialIds.has(id)) problems.push(`unknown_trial:${id}`);
  return Object.freeze({ valid: problems.length === 0, problems });
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function opaqueReport({ key, trials, sheets }) {
  const listeners = [];
  const accepted = [];
  for (const sheet of sheets) {
    const validation = validateSheet(sheet, trials, key.runId);
    const catchTrials = key.sequence.filter((trial) => trial.kind === "attention");
    const caught = catchTrials.filter((trial) => sheet?.answers?.[trial.trialId]?.choice === trial.correct).length;
    const catchRate = catchTrials.length ? caught / catchTrials.length : 1;
    const row = Object.freeze({
      listener: String(sheet?.listener || "anonymous"),
      complete: Boolean(sheet?.complete),
      schemaValid: validation.valid,
      problems: validation.problems,
      catchCorrect: caught,
      catchTrials: catchTrials.length,
      catchRate,
      accepted: validation.valid && catchRate >= key.policy.minimumCatchRate,
    });
    listeners.push(row);
    if (row.accepted) accepted.push(sheet);
  }

  const ratings = [];
  for (const publicTrial of trials.sequence.filter((trial) => trial.kind === "rating")) {
    const rows = accepted.map((sheet) => sheet.answers[publicTrial.trialId]).filter(validateRating);
    ratings.push(Object.freeze({
      trialId: publicTrial.trialId,
      language: publicTrial.language,
      n: rows.length,
      means: Object.fromEntries(AXES.map((axis) => [axis.id, mean(rows.map((row) => row[axis.id]))])),
      disclosure: Object.fromEntries(DISCLOSURE_OPTIONS.map((option) => [option.id, rows.filter((row) => row.disclosure === option.id).length])),
    }));
  }

  const repeatDeltas = [];
  for (const repeat of key.repeats) {
    const original = key.sequence.find((trial) => trial.trialId === repeat.originalTrialId);
    const duplicate = key.sequence.find((trial) => trial.trialId === repeat.repeatTrialId);
    const perListener = accepted.flatMap((sheet) => {
      const left = sheet.answers[original.trialId];
      const right = sheet.answers[duplicate.trialId];
      if (!validateRating(left) || !validateRating(right)) return [];
      return [{
        listener: String(sheet.listener || "anonymous"),
        meanAbsoluteDelta: mean(AXES.map((axis) => Math.abs(left[axis.id] - right[axis.id]))),
        disclosureConsistent: left.disclosure === right.disclosure,
      }];
    });
    repeatDeltas.push(Object.freeze({ pairId: repeat.pairId, n: perListener.length, perListener }));
  }

  return Object.freeze({
    contract: BENCHMARK_VERSION,
    runId: key.runId,
    status: accepted.length ? "ratings_locked_arm_mapping_still_sealed" : "no_accepted_listener",
    modelMapping: "sealed",
    listeners,
    acceptedListeners: accepted.length,
    ratings,
    repeatConsistency: repeatDeltas,
    claim: "human_ratings_only_no_cross_provider_winner",
  });
}

export function unsealedReport({ key, trials, sheets }) {
  const opaque = opaqueReport({ key, trials, sheets });
  if (!opaque.acceptedListeners) throw new Error("benchmark_no_accepted_listener");
  const trialKey = new Map(key.sequence.map((trial) => [trial.trialId, trial]));
  const repeatTrialIds = new Set(key.repeats.map((repeat) => repeat.repeatTrialId));
  const byStimulus = new Map();
  for (const publicRating of opaque.ratings) {
    const privateTrial = trialKey.get(publicRating.trialId);
    if (!privateTrial || privateTrial.kind !== "rating") continue;
    // Repeats audit listener consistency. Counting them again as model evidence
    // would give two randomly selected candidates a larger n than every other
    // candidate, turning the catch mechanism into an analysis bias.
    if (repeatTrialIds.has(privateTrial.trialId)) continue;
    const list = byStimulus.get(privateTrial.sourceStimulusId) || [];
    list.push(publicRating);
    byStimulus.set(privateTrial.sourceStimulusId, list);
  }

  const stimulusRatings = key.stimuli.map((stimulus) => {
    const rows = byStimulus.get(stimulus.id) || [];
    const n = rows.reduce((total, row) => total + row.n, 0);
    const axisValues = {};
    for (const axis of AXES) {
      const weighted = rows.filter((row) => row.means[axis.id] !== null)
        .reduce((total, row) => total + row.means[axis.id] * row.n, 0);
      axisValues[axis.id] = n ? weighted / n : null;
    }
    const disclosure = Object.fromEntries(DISCLOSURE_OPTIONS.map((option) => [
      option.id,
      rows.reduce((total, row) => total + row.disclosure[option.id], 0),
    ]));
    return Object.freeze({
      candidateId: stimulus.candidateId,
      candidateLabel: stimulus.candidateLabel,
      pack: stimulus.pack,
      language: stimulus.language,
      textSha256: stimulus.textSha256,
      cellId: stimulus.cellId,
      comparison: key.cells.find((cell) => cell.id === stimulus.cellId)?.comparison || "unmatched_lane",
      n,
      means: axisValues,
      disclosure,
    });
  });

  const matchedCells = key.cells.filter((cell) => cell.comparison === "matched_text").map((cell) => Object.freeze({
    cellId: cell.id,
    language: cell.language,
    textSha256: cell.textSha256,
    comparison: "matched_text_only",
    candidates: stimulusRatings.filter((rating) => rating.cellId === cell.id),
  }));
  const unmatched = stimulusRatings.filter((rating) => rating.comparison === "unmatched_lane");

  return Object.freeze({
    ...opaque,
    status: "ratings_locked_mapping_unsealed",
    modelMapping: "unsealed_after_explicit_confirmation",
    matchedCells,
    unmatchedLanes: unmatched,
    crossProviderWinner: null,
    crossProviderWinnerReason: "No exact text cell crosses providers in this pack. Unmatched lanes cannot produce a fair winner.",
  });
}

export function newRunSecret() {
  return randomBytes(32);
}
