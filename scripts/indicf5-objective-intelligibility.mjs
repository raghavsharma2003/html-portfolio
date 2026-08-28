#!/usr/bin/env node
// Private, bounded ASR diagnostic for an already-sealed IndicF5 pack.
//
// This is not a perceptual test. It never plays audio and it never identifies
// the sealed synthesis arm in anything under blind/. The private key is read
// only to bind each opaque WAV to its frozen benchmark prompt.

import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createSarvamSyncProvider } from "../api/_asr/providers/sarvam-sync.js";
import {
  HINGLISH_ALIAS_LEXICON_VERSION,
  RAW_TRANSCRIPT_METRIC,
  SCRIPT_AWARE_TRANSCRIPT_METRIC,
  scoreHinglishTranscriptPair,
  tokenizeBenchmarkText,
} from "../evals/speech/hinglish-script-score.mjs";

const PACK_CONTRACT = "vyakti-indicf5-blind-pack/v1";
const OUTPUT_CONTRACT = "vyakti-objective-intelligibility/v1";
const PROVIDER = "sarvam-sync";
const LANGUAGE_HINT = "hi-IN";
const MAX_ITEMS = 6;
const MAX_ITEM_MS = 30_000;
const BILLING_QUANTUM_SECONDS = 15;
// This is a deliberately high audit reservation, not a statement of Sarvam's
// bill. The repository's researched rates conflict, so actual billing remains
// null. At USD 1/minute and 15-second rounding, all six clips still fit below
// the operator-supplied hard stop.
const CONSERVATIVE_USD_PER_MINUTE = 1;

const argv = process.argv.slice(2);
const packArg = argv.find((value) => !value.startsWith("--"));
const maxUsdArg = argv.find((value) => value.startsWith("--max-usd="));
const providerArg = argv.find((value) => value.startsWith("--provider="));
const priorFailedQuantaArg = argv.find((value) => value.startsWith("--prior-failed-quanta="));
const maxUsd = Number(maxUsdArg?.slice("--max-usd=".length));
const requestedProvider = String(providerArg?.slice("--provider=".length) || PROVIDER);
const priorFailedQuanta = Number(priorFailedQuantaArg?.slice("--prior-failed-quanta=".length) || 0);
if (process.env.INDICF5_OBJECTIVE_INTELLIGIBILITY_RUN !== "1") {
  throw new Error("objective_intelligibility_run_guard_required");
}
if (!packArg) throw new Error("objective_intelligibility_pack_required");
if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 2) {
  throw new Error("objective_intelligibility_max_usd_must_be_at_most_2");
}
if (!Number.isInteger(priorFailedQuanta) || priorFailedQuanta < 0 || priorFailedQuanta > 1) {
  throw new Error("objective_intelligibility_prior_failed_quanta_invalid");
}
if (!new Set(["sarvam-sync", "azure-speech-short"]).has(requestedProvider)) {
  throw new Error("objective_intelligibility_provider_unsupported");
}
const apiKey = String((requestedProvider === "sarvam-sync"
  ? process.env.SARVAM_API_KEY
  : process.env.AZURE_SPEECH_KEY) || "");
if (!apiKey) throw new Error(`${requestedProvider.replaceAll("-", "_")}_key_required`);

const pack = resolve(packArg);
const blindDir = join(pack, "blind");
const privateDir = join(pack, "private");
const manifestPath = join(blindDir, "manifest.json");
const keyPath = join(privateDir, "key.json");
const outputPath = join(privateDir, "objective-intelligibility.json");
const promptPath = resolve("evals", "voice-bakeoff", "prompts.v1.json");
const qualifyPath = resolve("services", "indicf5-runtime", "qualify.mjs");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifestBytes = readFileSync(manifestPath);
const keyBytes = readFileSync(keyPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const privateKey = JSON.parse(keyBytes.toString("utf8"));
if (manifest.contract !== PACK_CONTRACT || privateKey.contract !== PACK_CONTRACT) {
  throw new Error("objective_intelligibility_pack_contract_invalid");
}
if (manifest.arm_identity !== "sealed" || privateKey.arm_identity === "sealed") {
  throw new Error("objective_intelligibility_private_binding_invalid");
}
if (!Array.isArray(manifest.items) || !Array.isArray(privateKey.items) ||
    manifest.items.length !== MAX_ITEMS || privateKey.items.length !== MAX_ITEMS) {
  throw new Error("objective_intelligibility_expected_six_items");
}

const promptDocument = readJson(promptPath);
const promptMap = new Map(promptDocument.promptSets
  .flatMap((set) => set.variants)
  .map((prompt) => [prompt.id, prompt]));
const qualifySource = readFileSync(qualifyPath, "utf8");
const disclosureLiteral = qualifySource.match(/const DISCLOSURE = ("(?:[^"\\]|\\.)*");/u)?.[1];
if (!disclosureLiteral) throw new Error("objective_intelligibility_disclosure_binding_missing");
const disclosure = JSON.parse(disclosureLiteral);

const publicById = new Map(manifest.items.map((item) => [item.id, item]));
const inputs = privateKey.items.map((privateItem) => {
  const publicItem = publicById.get(privateItem.id);
  const prompt = promptMap.get(privateItem.prompt_id);
  if (!publicItem || !prompt || prompt.locale !== "hi-IN" ||
      !["devanagari", "mixed"].includes(prompt.script)) {
    throw new Error("objective_intelligibility_item_binding_invalid");
  }
  if (sha256(Buffer.from(prompt.text)) !== publicItem.prompt_sha256) {
    throw new Error("objective_intelligibility_prompt_hash_mismatch");
  }
  const wavPath = join(blindDir, publicItem.filename);
  if (basename(wavPath) !== publicItem.filename) {
    throw new Error("objective_intelligibility_filename_invalid");
  }
  const wav = readFileSync(wavPath);
  if (sha256(wav) !== publicItem.wav_sha256) {
    throw new Error("objective_intelligibility_wav_hash_mismatch");
  }
  const durationMs = Number(publicItem.duration_ms);
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_ITEM_MS) {
    throw new Error("objective_intelligibility_item_duration_invalid");
  }
  return Object.freeze({ privateItem, publicItem, prompt, wav, durationMs });
});

const reservedBillableSeconds = priorFailedQuanta * BILLING_QUANTUM_SECONDS + inputs.reduce((sum, item) =>
  sum + Math.ceil(item.durationMs / 1000 / BILLING_QUANTUM_SECONDS) * BILLING_QUANTUM_SECONDS, 0);
const conservativeCeilingUsd = Number((reservedBillableSeconds / 60 * CONSERVATIVE_USD_PER_MINUTE).toFixed(6));
if (conservativeCeilingUsd > maxUsd) throw new Error("objective_intelligibility_spend_ceiling_exceeded");

// The pack does not exercise personal names, locations or acronyms. The only
// entity-like frozen targets are chemical symbols in the equation prompts;
// they are reported separately so a zero cannot masquerade as a names score.
const ENTITY_UNITS = new Map([
  ["h", "chemical_symbol_h"], ["एच", "chemical_symbol_h"],
  ["o", "chemical_symbol_o"], ["ओ", "chemical_symbol_o"],
]);
const NUMERAL_UNITS = new Map([
  ["0", "zero"], ["zero", "zero"], ["शून्य", "zero"],
  ["1", "one"], ["one", "one"], ["एक", "one"],
  ["2", "two"], ["two", "two"], ["टू", "two"], ["दो", "two"],
  ["3", "three"], ["three", "three"], ["थ्री", "three"], ["तीन", "three"],
  ["4", "four"], ["four", "four"], ["फोर", "four"], ["चार", "four"],
]);

function extractedUnits(text, lexicon) {
  return tokenizeBenchmarkText(text).flatMap((token) => {
    const unit = lexicon.get(token);
    return unit ? [unit] : [];
  });
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function unitMetric(expectedText, observedText, lexicon, label) {
  const expected = extractedUnits(expectedText, lexicon);
  const observed = extractedUnits(observedText, lexicon);
  const errors = editDistance(expected, observed);
  return Object.freeze({
    label,
    targetUnits: expected.length,
    observedUnits: observed.length,
    errors,
    errorRate: expected.length ? errors / expected.length : null,
  });
}

function aggregate(rows, arm) {
  const wordErrors = rows.reduce((sum, row) => sum + row.metrics[arm].wordErrors, 0);
  const referenceWords = rows.reduce((sum, row) => sum + row.metrics[arm].referenceWords, 0);
  const characterErrors = rows.reduce((sum, row) => sum + row.metrics[arm].characterErrors, 0);
  const referenceCharacters = rows.reduce((sum, row) => sum + row.metrics[arm].referenceCharacters, 0);
  return Object.freeze({
    label: rows[0]?.metrics[arm].label || (arm === "raw" ? RAW_TRANSCRIPT_METRIC : SCRIPT_AWARE_TRANSCRIPT_METRIC),
    wordErrors,
    referenceWords,
    wordErrorRate: referenceWords ? wordErrors / referenceWords : null,
    characterErrors,
    referenceCharacters,
    characterErrorRate: referenceCharacters ? characterErrors / referenceCharacters : null,
  });
}

function aggregateUnits(rows, field, label) {
  const targetUnits = rows.reduce((sum, row) => sum + row[field].targetUnits, 0);
  const observedUnits = rows.reduce((sum, row) => sum + row[field].observedUnits, 0);
  const errors = rows.reduce((sum, row) => sum + row[field].errors, 0);
  return Object.freeze({ label, targetUnits, observedUnits, errors, errorRate: targetUnits ? errors / targetUnits : null });
}

const provider = requestedProvider === "sarvam-sync" ? createSarvamSyncProvider({
  apiKey,
  readAudio: async (ref) => {
    const item = inputs.find((candidate) => candidate.publicItem.wav_sha256 === ref.sha256);
    if (!item) throw new Error("objective_intelligibility_audio_binding_missing");
    return { body: item.wav, byteSize: item.wav.length };
  },
}) : null;

function pcm16MonoWav(wav, requiredRate) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("objective_intelligibility_wav_invalid");
  }
  let cursor = 12;
  let format = null;
  let pcm = null;
  while (cursor + 8 <= wav.length) {
    const id = wav.toString("ascii", cursor, cursor + 4);
    const size = wav.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (body + size > wav.length) throw new Error("objective_intelligibility_wav_invalid");
    if (id === "fmt ") format = {
      codec: wav.readUInt16LE(body), channels: wav.readUInt16LE(body + 2),
      rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14),
    };
    if (id === "data") pcm = wav.subarray(body, body + size);
    cursor = body + size + (size % 2);
  }
  if (!format || !pcm || format.codec !== 1 || format.channels !== 1 ||
      format.rate !== requiredRate || format.bits !== 16 || pcm.length % 2) {
    throw new Error("objective_intelligibility_wav_invalid");
  }
  return pcm;
}

function wrapPcm16Mono(pcm, rate) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}

// Azure's short-audio REST contract accepts 16 kHz PCM WAV. The pack is 24
// kHz, so use a deterministic, anti-aliased windowed-sinc resampler. This is
// evaluation transport only; the source WAV and sealed pack stay byte exact.
function resample24kTo16k(wav) {
  const pcm = pcm16MonoWav(wav, 24_000);
  const source = new Int16Array(pcm.length / 2);
  for (let index = 0; index < source.length; index += 1) source[index] = pcm.readInt16LE(index * 2);
  const targetLength = Math.floor(source.length * 2 / 3);
  const out = Buffer.alloc(targetLength * 2);
  const radius = 12;
  const cutoff = 0.6;
  const sinc = (value) => Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * 1.5;
    const center = Math.floor(position);
    let weighted = 0;
    let weightSum = 0;
    for (let sourceIndex = center - radius + 1; sourceIndex <= center + radius; sourceIndex += 1) {
      if (sourceIndex < 0 || sourceIndex >= source.length) continue;
      const delta = position - sourceIndex;
      if (Math.abs(delta) >= radius) continue;
      const window = 0.5 + 0.5 * Math.cos(Math.PI * delta / radius);
      const weight = cutoff * sinc(cutoff * delta) * window;
      weighted += source[sourceIndex] * weight;
      weightSum += weight;
    }
    const sample = Math.max(-32768, Math.min(32767, Math.round(weighted / (weightSum || 1))));
    out.writeInt16LE(sample, index * 2);
  }
  return wrapPcm16Mono(out, 16_000);
}

async function azureTranscribe(wav) {
  const endpoint = String(process.env.AZURE_SPEECH_ENDPOINT || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+\.cognitiveservices\.azure\.com$/i.test(endpoint)) {
    throw new Error("azure_speech_endpoint_invalid");
  }
  const audio = resample24kTo16k(wav);
  const url = new URL(`${endpoint}/stt/speech/recognition/conversation/cognitiveservices/v1`);
  url.searchParams.set("language", LANGUAGE_HINT);
  url.searchParams.set("format", "detailed");
  url.searchParams.set("profanity", "raw");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      Accept: "application/json",
    },
    body: audio,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; }
  catch { throw new Error("azure_speech_response_invalid"); }
  if (!response.ok) throw new Error(`azure_speech_http_${response.status}`);
  if (value?.RecognitionStatus !== "Success") {
    throw new Error(`azure_speech_${String(value?.RecognitionStatus || "recognition_failed").toLowerCase()}`);
  }
  const transcript = String(value?.NBest?.[0]?.Display || value?.DisplayText || "").trim();
  if (!transcript) throw new Error("azure_speech_transcript_empty");
  return transcript;
}

const results = [];
for (let index = 0; index < inputs.length; index += 1) {
  const item = inputs[index];
  const transcript = requestedProvider === "sarvam-sync"
    ? (await provider.transcribe({
      storageBucket: "vyakti-replica-private",
      storagePath: `private-eval/${item.publicItem.filename}`,
      sha256: item.publicItem.wav_sha256,
      mime: "audio/wav",
      byteSize: item.wav.length,
      durationMs: item.durationMs,
    }, LANGUAGE_HINT)).turns.map((turn) => turn.text).join(" ").trim()
    : await azureTranscribe(item.wav);
  const expectedText = `${disclosure} ${item.prompt.text}`;
  const metrics = scoreHinglishTranscriptPair(expectedText, transcript);
  results.push(Object.freeze({
    opaque_id: item.publicItem.id,
    prompt_id: item.privateItem.prompt_id,
    script: item.prompt.script,
    duration_ms: item.durationMs,
    target_text: expectedText,
    asr_transcript: transcript,
    asr_transcript_sha256: sha256(Buffer.from(transcript)),
    metrics,
    chemicalSymbolEntities: unitMetric(expectedText, transcript, ENTITY_UNITS, "chemical_symbol_entity_sequence_error/v1"),
    numerals: unitMetric(expectedText, transcript, NUMERAL_UNITS, "spoken_numeral_sequence_error/v1"),
  }));
  console.log(`ASR ${index + 1}/${inputs.length} complete`);
}

const devanagariRows = results.filter((row) => row.script === "devanagari");
const mixedRows = results.filter((row) => row.script === "mixed");
if (devanagariRows.length !== 3 || mixedRows.length !== 3) {
  throw new Error("objective_intelligibility_script_breakdown_invalid");
}

const summaryFor = (rows) => Object.freeze({
  n: rows.length,
  duration_ms: rows.reduce((sum, row) => sum + row.duration_ms, 0),
  raw: aggregate(rows, "raw"),
  curated_script_aware: aggregate(rows, "scriptAware"),
  chemical_symbol_entities: aggregateUnits(rows, "chemicalSymbolEntities", "chemical_symbol_entity_sequence_error/v1"),
  numerals: aggregateUnits(rows, "numerals", "spoken_numeral_sequence_error/v1"),
});

const report = {
  contract: OUTPUT_CONTRACT,
  created_at: new Date().toISOString(),
  privacy: "private_not_served",
  pack: {
    directory: basename(pack),
    contract: manifest.contract,
    manifest_sha256: sha256(manifestBytes),
    private_key_sha256: sha256(keyBytes),
    opaque_items: results.length,
    sealed_arm_identity_exposed: false,
  },
  method: {
    kind: "single_provider_asr_round_trip_diagnostic",
    provider: requestedProvider,
    asr_model: requestedProvider === "sarvam-sync" ? provider.model : "default_base_model",
    azure_region: requestedProvider === "azure-speech-short" ? String(process.env.AZURE_SPEECH_REGION || "") : null,
    language_hint: LANGUAGE_HINT,
    calls: results.length,
    retries: 0,
    prior_rejected_calls_reserved: priorFailedQuanta,
    raw_metric: RAW_TRANSCRIPT_METRIC,
    curated_metric: SCRIPT_AWARE_TRANSCRIPT_METRIC,
    curated_alias_lexicon: HINGLISH_ALIAS_LEXICON_VERSION,
    scoring_target: "mandatory_spoken_disclosure_plus_frozen_prompt",
    audio_played_by_operator: false,
  },
  budget: {
    hard_limit_usd: maxUsd,
    actual_provider_billing_usd: null,
    conservative_reservation_usd_per_minute: CONSERVATIVE_USD_PER_MINUTE,
    conservative_billing_quantum_seconds: BILLING_QUANTUM_SECONDS,
    reserved_billable_seconds: reservedBillableSeconds,
    conservative_ceiling_usd: conservativeCeilingUsd,
    caveat: "Reservation is an audit safety ceiling, not a provider bill. Repository pricing evidence conflicts.",
  },
  aggregate: summaryFor(results),
  breakdown: {
    devanagari: summaryFor(devanagariRows),
    hinglish_mixed_script: summaryFor(mixedRows),
  },
  named_entities: {
    label: "proper_name_place_acronym_error/v1",
    targetUnits: 0,
    errors: null,
    errorRate: null,
    reason: "The six-item frozen qualification subset contains no proper-name, place-name or acronym prompt.",
  },
  items: results,
  limits: [
    "ASR disagreement is a diagnostic proxy for intelligibility, not a human intelligibility score.",
    "One ASR provider and one hi-IN decoding hint were used; provider bias is not estimated.",
    "The mandatory repeated disclosure is included in every target and can lower aggregate error independently of prompt quality.",
    "The curated arm only canonicalizes the bounded reviewed alias lexicon; unmapped cross-script equivalents remain errors.",
    "Chemical-symbol and numeral metrics compare extracted target-unit sequences; they do not score acoustic realization between units.",
    "The selected six prompts do not identify proper-name, place-name or acronym accuracy.",
    "No listening, naturalness, accent, prosody, speaker-likeness or winner claim is licensed by this report.",
  ],
};

const serialized = JSON.stringify(report, null, 2) + "\n";
if (serialized.includes(apiKey)) throw new Error("objective_intelligibility_secret_leak_refused");
const temporaryPath = `${outputPath}.tmp`;
writeFileSync(temporaryPath, serialized, { mode: 0o600 });
renameSync(temporaryPath, outputPath);
console.log(`OBJECTIVE_INTELLIGIBILITY_READY ${outputPath}`);
