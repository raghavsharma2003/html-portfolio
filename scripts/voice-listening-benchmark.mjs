#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AXES,
  BENCHMARK_VERSION,
  DISCLOSURE_OPTIONS,
  buildCells,
  canonical,
  commonTargetRms,
  newRunSecret,
  normaliseAndPad,
  opaqueId,
  opaqueReport,
  parseWav,
  readJson,
  seededRandom,
  sha256,
  shuffled,
  tonePcm,
  unsealedReport,
  wrapWav,
} from "../evals/voice-listening-benchmark/lib.mjs";
import { serveListeningBenchmark } from "../evals/voice-listening-benchmark/server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HOME = join(ROOT, "scratchpad", "voice-listening-benchmark-20260828");
const PAGE = join(ROOT, "evals", "voice-listening-benchmark", "page.html");
const SOURCE = Object.freeze({
  chatterbox: join(ROOT, "scratchpad", "voice-bakeoff-20260828"),
  qwen: join(ROOT, "scratchpad", "qwen3-tts-english-20260828"),
  vox: join(ROOT, "scratchpad", "voxcpm2-20260828", "qualification-20260828"),
  ownerReference: join(ROOT, "scratchpad", "voxcpm2-20260828", "owner-reference-25s-35s.wav"),
  promptCatalog: join(ROOT, "evals", "voice-bakeoff", "prompts.v1.json"),
});

const CHATTERBOX_TEXT = Object.freeze({
  e0d727f3cf39b5d9c310dbae7a8caffa8f0051b7ebabf8fa7696a3f00404c6e4: Object.freeze({
    language: "Hinglish",
    langTag: "hi-Latn",
    text: "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai, physics, chemistry ya maths?",
  }),
  "482b58ae6762cb92a50181787ac5e7dd33665d4b76a44f72c656d68278b986c7": Object.freeze({
    language: "Hindi",
    langTag: "hi",
    text: "नमस्ते! मैं आपका अपना एआई वर्ज़न हूँ। आज क्या पढ़ना है, फ़िज़िक्स, केमिस्ट्री या मैथ्स?",
  }),
  "67db299d9861f21f332fc10fb4f916acada0f62743098624421882a7366bdd18": Object.freeze({
    language: "English",
    langTag: "en-IN",
    text: "Hello, this is my AI version. Tell me what you are stuck on today and we will work through it together.",
  }),
});

const VOX_PROMPTS = Object.freeze({
  hi: Object.freeze({
    language: "Hindi",
    langTag: "hi",
    languageId: "hi",
    disclosure: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
    text: "आज हम रासायनिक समीकरण को संतुलित करेंगे और हर चरण को ध्यान से समझेंगे।",
  }),
  hinglish: Object.freeze({
    language: "Hinglish",
    langTag: "hi",
    languageId: "hi",
    disclosure: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
    text: "आज हम chemical equation को balance करेंगे, और फिर reaction का logic समझेंगे।",
  }),
  en: Object.freeze({
    language: "English",
    langTag: "en-IN",
    languageId: "en",
    disclosure: "This is an AI-generated voice replica.",
    text: "Today we will balance the chemical equation and explain every step clearly.",
  }),
});

function fail(code) {
  throw new Error(code);
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ""));
}

function getFlags(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) continue;
    const key = args[index].slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

const [command = "help", ...rawFlags] = process.argv.slice(2);
const flags = getFlags(rawFlags);
const home = resolve(String(flags.get("home") || DEFAULT_HOME));

function pathsFor(target = home) {
  return Object.freeze({
    home: target,
    runId: target.split(/[\\/]/).filter(Boolean).at(-1),
    served: join(target, "served"),
    stimuli: join(target, "served", "stimuli"),
    private: join(target, "private"),
    key: join(target, "private", "sealed-key.json"),
    answers: join(target, "answers"),
    reports: join(target, "reports"),
  });
}

function verifyPcmHash(file, expected) {
  const bytes = readFileSync(file);
  const wav = parseWav(bytes);
  const actual = sha256(wav.pcm);
  if (actual !== expected) fail("benchmark_source_pcm_hash_mismatch");
  return Object.freeze({ bytes, wav, wavSha256: sha256(bytes), pcmSha256: actual });
}

function loadChatterbox() {
  const publicManifest = readJson(join(SOURCE.chatterbox, "manifest.json"));
  const privateKey = readJson(join(SOURCE.chatterbox, "keys", "sealed-key.json"));
  if (publicManifest.schemaVersion !== "vyakti-live-voice-bakeoff/v1" || privateKey.schemaVersion !== publicManifest.schemaVersion) {
    fail("benchmark_chatterbox_contract_invalid");
  }
  const conditions = privateKey.conditions.filter((condition) => condition.file);
  if (conditions.length !== publicManifest.clips.length || conditions.some((condition) => !publicManifest.clips.includes(condition.file))) {
    fail("benchmark_chatterbox_manifest_mismatch");
  }
  return conditions.map((condition) => {
    const prompt = CHATTERBOX_TEXT[condition.textSha256];
    if (!prompt || sha256(prompt.text) !== condition.textSha256 || condition.protected !== true) fail("benchmark_chatterbox_evidence_invalid");
    const file = join(SOURCE.chatterbox, "blind", condition.file);
    const audio = verifyPcmHash(file, condition.pcmSha256 || condition.outputSha256);
    const cfg = Number(condition.effectiveCfgWeight);
    const modelArm = String(condition.modelArm || "general");
    return Object.freeze({
      pack: "chatterbox_20260828",
      originalId: condition.file.replace(/\.wav$/i, ""),
      candidateId: `chatterbox:${modelArm}:cfg-${cfg}`,
      candidateLabel: `Chatterbox ${modelArm} CFG ${cfg}`,
      modelCommitment: condition.modelCommitment || "legacy_incumbent_commitment_unavailable",
      language: prompt.language,
      langTag: prompt.langTag,
      text: prompt.text,
      textSha256: condition.textSha256,
      referenceSha256: condition.referenceSha256 || privateKey.reference.sha256,
      sourceFile: file,
      sourceWavSha256: audio.wavSha256,
      sourcePcmSha256: audio.pcmSha256,
      pcm: audio.wav.pcm,
      durationMs: audio.wav.durationMs,
      protectionVerified: condition.protected === true && (condition.perthWatermarkVerified !== false),
    });
  });
}

function qwenPromptMap() {
  const catalog = readJson(SOURCE.promptCatalog);
  const variants = catalog.promptSets.flatMap((group) => group.variants || []);
  return new Map(variants.map((variant) => [variant.id, variant]));
}

function loadQwen() {
  const publicManifest = readJson(join(SOURCE.qwen, "stimuli", "manifest.json"));
  const privateKey = readJson(join(SOURCE.qwen, "private", "key.json"));
  if (publicManifest.contract !== "vyakti-qwen3-tts-blind-pack/v1" || privateKey.contract !== publicManifest.contract) {
    fail("benchmark_qwen_contract_invalid");
  }
  const promptMap = qwenPromptMap();
  const privateItems = new Map(privateKey.items.map((item) => [item.id, item]));
  return publicManifest.items.map((item) => {
    const privateItem = privateItems.get(item.id);
    const prompt = promptMap.get(privateItem?.prompt_id);
    if (!privateItem || !prompt || sha256(prompt.text) !== item.prompt_sha256 || item.perth_watermark_verified !== true) {
      fail("benchmark_qwen_evidence_invalid");
    }
    const file = join(SOURCE.qwen, "stimuli", item.filename);
    const bytes = readFileSync(file);
    const wav = parseWav(bytes);
    if (sha256(bytes) !== item.wav_sha256) fail("benchmark_qwen_wav_hash_mismatch");
    return Object.freeze({
      pack: "qwen_english_20260828",
      originalId: item.id,
      candidateId: `qwen:${privateKey.arm_identity}`,
      candidateLabel: "Qwen3-TTS 12 Hz 1.7B Base",
      modelCommitment: privateItem.model_commitment,
      language: "English",
      langTag: "en-IN",
      text: prompt.text,
      textSha256: item.prompt_sha256,
      referenceSha256: privateKey.reference_sha256,
      sourceFile: file,
      sourceWavSha256: item.wav_sha256,
      sourcePcmSha256: sha256(wav.pcm),
      pcm: wav.pcm,
      durationMs: wav.durationMs,
      protectionVerified: item.perth_watermark_verified === true,
    });
  });
}

function loadVox() {
  const key = readJson(join(SOURCE.vox, "key.json"));
  if (key.schemaVersion !== "vyakti-voxcpm2-blind-key/v1") fail("benchmark_vox_contract_invalid");
  return key.items.map((item) => {
    const prompt = VOX_PROMPTS[item.promptId];
    const receipt = readJson(join(SOURCE.vox, "receipts", item.receipt));
    if (!prompt || receipt.blind_id !== item.blindId || receipt.response_signature_verified !== true || receipt.perth_watermark_verified !== true) {
      fail("benchmark_vox_evidence_invalid");
    }
    const rendered = `${prompt.disclosure} ${prompt.text}`;
    if (sha256(rendered) !== receipt.text_sha256 || receipt.language_id !== prompt.languageId) fail("benchmark_vox_text_binding_invalid");
    const file = join(SOURCE.vox, "blind", item.wav);
    const audio = verifyPcmHash(file, receipt.output_sha256);
    return Object.freeze({
      pack: "voxcpm2_20260828",
      originalId: item.blindId,
      candidateId: `vox:${receipt.model}:${receipt.model_revision}`,
      candidateLabel: "VoxCPM2",
      modelCommitment: receipt.model_commitment,
      language: prompt.language,
      langTag: prompt.langTag,
      text: prompt.text,
      textSha256: sha256(prompt.text),
      referenceSha256: receipt.reference_sha256,
      sourceFile: file,
      sourceWavSha256: audio.wavSha256,
      sourcePcmSha256: audio.pcmSha256,
      pcm: audio.wav.pcm,
      durationMs: audio.wav.durationMs,
      protectionVerified: receipt.response_signature_verified === true && receipt.perth_watermark_verified === true,
    });
  });
}

function loadIndicF5(packRoot) {
  const publicManifest = readJson(join(packRoot, "blind", "manifest.json"));
  const privateKey = readJson(join(packRoot, "private", "key.json"));
  const expectedRevision = "ba85abedf18dc479a447eaa0eccbd76ab78a47d5";
  const boundFields = [
    "contract",
    "created_at",
    "human_listening_status",
    "disclosure_present",
    "evaluation_only",
    "reference_sha256",
    "reference_duration_ms",
    "reference_offset_ms",
    "reference_rms",
    "reference_clipped_samples",
    "reference_text_sha256",
    "reference_transcript_evidence_scope",
  ];
  if (
    publicManifest.contract !== "vyakti-indicf5-blind-pack/v1" ||
    privateKey.contract !== publicManifest.contract ||
    publicManifest.arm_identity !== "sealed" ||
    privateKey.arm_identity !== "ai4bharat-indicf5" ||
    boundFields.some((field) => canonical(publicManifest[field]) !== canonical(privateKey[field])) ||
    publicManifest.human_listening_status !== "not_started" ||
    publicManifest.disclosure_present !== true ||
    publicManifest.evaluation_only !== true ||
    !isSha256(publicManifest.reference_sha256) ||
    !isSha256(publicManifest.reference_text_sha256) ||
    publicManifest.canary?.perth_watermark_verified !== true ||
    canonical(publicManifest.canary) !== canonical(privateKey.canary)
  ) {
    fail("benchmark_indicf5_contract_invalid");
  }
  if (!Array.isArray(publicManifest.items) || !Array.isArray(privateKey.items) || publicManifest.items.length !== 6 || privateKey.items.length !== 6) {
    fail("benchmark_indicf5_item_count_invalid");
  }
  const promptMap = qwenPromptMap();
  const privateItems = new Map(privateKey.items.map((item) => [item.id, item]));
  const publicIds = publicManifest.items.map((item) => item.id);
  const privateIds = privateKey.items.map((item) => item.id);
  const expectedWavs = publicManifest.items.map((item) => item.filename).sort();
  const actualWavs = readdirSync(join(packRoot, "blind")).filter((file) => /\.wav$/i.test(file)).sort();
  if (
    new Set(publicIds).size !== publicIds.length ||
    new Set(privateIds).size !== privateIds.length ||
    [...publicIds].sort().join("\n") !== [...privateIds].sort().join("\n") ||
    expectedWavs.join("\n") !== actualWavs.join("\n")
  ) {
    fail("benchmark_indicf5_item_set_invalid");
  }
  let modelCommitment;
  let consentReceipt;
  return publicManifest.items.map((item) => {
    const privateItem = privateItems.get(item.id);
    const prompt = promptMap.get(privateItem?.prompt_id);
    if (
      !privateItem ||
      !prompt ||
      item.filename !== `${item.id}.wav` ||
      sha256(prompt.text) !== item.prompt_sha256 ||
      !isSha256(item.prompt_sha256) ||
      !isSha256(item.wav_sha256) ||
      item.perth_watermark_verified !== true ||
      item.sample_rate !== 24_000 ||
      privateItem.model !== "ai4bharat-indicf5" ||
      privateItem.model_revision !== expectedRevision ||
      !isSha256(privateItem.model_commitment) ||
      !isSha256(privateItem.reference_sha256) ||
      !isSha256(privateItem.reference_text_sha256) ||
      !isSha256(privateItem.consent_receipt_sha256) ||
      !Number.isFinite(privateItem.perth_score) ||
      privateItem.perth_score < 0.99 ||
      privateItem.perth_score > 1
    ) {
      fail("benchmark_indicf5_evidence_invalid");
    }
    modelCommitment ??= privateItem.model_commitment;
    consentReceipt ??= privateItem.consent_receipt_sha256;
    if (
      privateItem.reference_sha256 !== publicManifest.reference_sha256 ||
      privateItem.reference_text_sha256 !== publicManifest.reference_text_sha256 ||
      privateItem.model_commitment !== modelCommitment ||
      privateItem.consent_receipt_sha256 !== consentReceipt
    ) {
      fail("benchmark_indicf5_binding_invalid");
    }
    const file = join(packRoot, "blind", item.filename);
    const bytes = readFileSync(file);
    const wav = parseWav(bytes);
    if (sha256(bytes) !== item.wav_sha256 || wav.durationMs !== item.duration_ms) fail("benchmark_indicf5_wav_hash_mismatch");
    const hinglish = prompt.script === "mixed";
    return Object.freeze({
      pack: "indicf5_20260828",
      originalId: item.id,
      candidateId: `indicf5:${privateKey.arm_identity}:${privateItem.model_revision}`,
      candidateLabel: "AI4Bharat IndicF5",
      modelCommitment: privateItem.model_commitment,
      language: hinglish ? "Hinglish" : "Hindi",
      langTag: "hi",
      text: prompt.text,
      textSha256: item.prompt_sha256,
      referenceSha256: privateItem.reference_sha256,
      sourceFile: file,
      sourceWavSha256: item.wav_sha256,
      sourcePcmSha256: sha256(wav.pcm),
      pcm: wav.pcm,
      durationMs: wav.durationMs,
      protectionVerified: item.perth_watermark_verified === true,
    });
  });
}

function loadSourcesFromRecordedPacks(sourcePacks) {
  const sources = [];
  for (const pack of sourcePacks) {
    if (pack.id === "chatterbox_20260828") sources.push(...loadChatterbox());
    else if (pack.id === "qwen_english_20260828") sources.push(...loadQwen());
    else if (pack.id === "voxcpm2_20260828") sources.push(...loadVox());
    else if (pack.id === "indicf5_20260828") sources.push(...loadIndicF5(resolve(ROOT, pack.source)));
    else fail("benchmark_recorded_source_pack_unknown");
  }
  return sources;
}

function materialise(paths, secret, sourceStimuli, reference, sourcePackRoots) {
  const runId = paths.runId;
  const allPcm = [...sourceStimuli.map((stimulus) => stimulus.pcm), reference.wav.pcm];
  const targetRms = commonTargetRms(allPcm);
  const targetSamples = Math.max(...allPcm.map((pcm) => pcm.length / 2));
  const transformed = [];

  for (const source of sourceStimuli) {
    const id = opaqueId(secret, "stimulus", source.pack, source.originalId);
    const treated = normaliseAndPad(source.pcm, { targetRms, samples: targetSamples });
    const bytes = wrapWav(treated.pcm);
    writeFileSync(join(paths.stimuli, `${id}.wav`), bytes);
    transformed.push(Object.freeze({
      ...source,
      pcm: undefined,
      id,
      servedWavSha256: sha256(bytes),
      servedPcmSha256: sha256(treated.pcm),
      servedBytes: bytes.length,
      servedDurationMs: Math.round((targetSamples / 24_000) * 1000),
      gain: treated.gain,
      achievedRms: treated.achievedRms,
    }));
  }

  const referenceId = opaqueId(secret, "reference", reference.sha256);
  const treatedReference = normaliseAndPad(reference.wav.pcm, { targetRms, samples: targetSamples });
  const referenceBytes = wrapWav(treatedReference.pcm);
  writeFileSync(join(paths.stimuli, `${referenceId}.wav`), referenceBytes);

  const cells = buildCells(transformed);
  const cellByStimulus = new Map(cells.flatMap((cell) => cell.stimulusIds.map((id) => [id, cell.id])));
  const stimuli = transformed.map((stimulus) => Object.freeze({ ...stimulus, cellId: cellByStimulus.get(stimulus.id) }));

  const random = seededRandom(secret, "rating-order");
  const repeatSources = shuffled(stimuli, random).reduce((picked, stimulus) => {
    if (picked.length >= 2) return picked;
    if (!picked.some((entry) => entry.language === stimulus.language)) picked.push(stimulus);
    return picked;
  }, []);
  if (repeatSources.length !== 2) fail("benchmark_repeat_selection_invalid");

  const baseRatings = stimuli.map((stimulus) => ({
    kind: "rating",
    trialId: opaqueId(secret, "trial", stimulus.id),
    stimulusId: stimulus.id,
    sourceStimulusId: stimulus.id,
    language: stimulus.language,
    langTag: stimulus.langTag,
    promptText: stimulus.text,
  }));
  const repeats = repeatSources.map((stimulus, index) => {
    const repeatStimulusId = opaqueId(secret, "repeat-stimulus", stimulus.id, String(index));
    copyFileSync(join(paths.stimuli, `${stimulus.id}.wav`), join(paths.stimuli, `${repeatStimulusId}.wav`));
    return {
      pairId: opaqueId(secret, "repeat-pair", stimulus.id),
      originalTrialId: baseRatings.find((trial) => trial.sourceStimulusId === stimulus.id).trialId,
      repeatTrialId: opaqueId(secret, "repeat-trial", stimulus.id),
      trial: {
        kind: "rating",
        trialId: opaqueId(secret, "repeat-trial", stimulus.id),
        stimulusId: repeatStimulusId,
        sourceStimulusId: stimulus.id,
        language: stimulus.language,
        langTag: stimulus.langTag,
        promptText: stimulus.text,
      },
    };
  });

  let ratingSequence = [];
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const candidate = shuffled([...baseRatings, ...repeats.map((repeat) => repeat.trial)], random);
    const separated = repeats.every((repeat) => {
      const first = candidate.findIndex((trial) => trial.trialId === repeat.originalTrialId);
      const second = candidate.findIndex((trial) => trial.trialId === repeat.repeatTrialId);
      return Math.abs(first - second) >= 4;
    });
    if (separated) {
      ratingSequence = candidate;
      break;
    }
  }
  if (!ratingSequence.length) fail("benchmark_repeat_randomisation_failed");

  const catchPcm = tonePcm();
  const catchTreated = normaliseAndPad(catchPcm, { targetRms, samples: targetSamples });
  const catches = [0, 1].map((index) => {
    const stimulusId = opaqueId(secret, "attention-stimulus", String(index));
    writeFileSync(join(paths.stimuli, `${stimulusId}.wav`), wrapWav(catchTreated.pcm));
    return {
      kind: "attention",
      trialId: opaqueId(secret, "attention-trial", String(index)),
      stimulusId,
      correct: "tone",
      options: shuffled([
        { id: "tone", label: "A tone" },
        { id: "speech", label: "Speech" },
        { id: "silence", label: "Silence" },
      ], seededRandom(secret, `attention-options-${index}`)),
    };
  });
  const sequence = [...ratingSequence];
  sequence.splice(3, 0, catches[0]);
  sequence.splice(Math.min(13, sequence.length), 0, catches[1]);

  const privateSequence = sequence.map((trial) => Object.freeze({ ...trial }));
  const publicSequence = sequence.map((trial) => trial.kind === "attention"
    ? Object.freeze({ kind: trial.kind, trialId: trial.trialId, stimulusId: trial.stimulusId, options: trial.options })
    : Object.freeze({
      kind: trial.kind,
      trialId: trial.trialId,
      stimulusId: trial.stimulusId,
      language: trial.language,
      langTag: trial.langTag,
      promptText: trial.promptText,
    }));

  const key = {
    contract: BENCHMARK_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    claim: "listening_instrument_no_quality_result",
    runSecret: secret.toString("hex"),
    policy: { minimumCatchRate: 1, unmatchedLanesCannotRankAcrossProviders: true },
    reference: {
      sourceFile: reference.file,
      sourceWavSha256: reference.sha256,
      servedId: referenceId,
      servedWavSha256: sha256(referenceBytes),
      sourceDurationMs: reference.wav.durationMs,
    },
    audioTreatment: {
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
      targetRms,
      peakCeiling: 0.92,
      fadeMs: 10,
      commonDurationMs: Math.round((targetSamples / 24_000) * 1000),
      commonBytes: 44 + targetSamples * 2,
      disclosureTrimmed: false,
      disclosureReason: "Disclosure audibility is a required human rating.",
    },
    sourcePacks: [...sourcePackRoots].map(([id, path]) => ({
      id,
      source: relative(ROOT, path),
      count: sourceStimuli.filter((entry) => entry.pack === id).length,
    })),
    stimuli,
    cells,
    sequence: privateSequence,
    repeats: repeats.map(({ trial, ...repeat }) => repeat),
  };
  const trials = {
    contract: BENCHMARK_VERSION,
    runId,
    referenceId,
    axes: AXES,
    disclosureOptions: DISCLOSURE_OPTIONS,
    sequence: publicSequence,
  };
  return { key, trials, cells, referenceId, referenceBytes };
}

function build() {
  const paths = pathsFor();
  if (existsSync(paths.key) || existsSync(join(paths.served, "manifest.json"))) fail("benchmark_home_already_contains_a_run");
  for (const directory of [paths.served, paths.stimuli, paths.private, paths.answers, paths.reports]) mkdirSync(directory, { recursive: true });

  const indicPack = flags.get("indicf5-pack") ? resolve(String(flags.get("indicf5-pack"))) : null;
  const sourcePackRoots = new Map([
    ["chatterbox_20260828", SOURCE.chatterbox],
    ["qwen_english_20260828", SOURCE.qwen],
    ["voxcpm2_20260828", SOURCE.vox],
  ]);
  const sourceStimuli = [...loadChatterbox(), ...loadQwen(), ...loadVox()];
  if (indicPack) {
    sourceStimuli.push(...loadIndicF5(indicPack));
    sourcePackRoots.set("indicf5_20260828", indicPack);
  }
  const expectedSourceCount = indicPack ? 21 : 15;
  if (sourceStimuli.length !== expectedSourceCount || sourceStimuli.some((stimulus) => !stimulus.protectionVerified)) fail("benchmark_source_count_or_protection_invalid");
  const referenceBytes = readFileSync(SOURCE.ownerReference);
  const reference = { file: SOURCE.ownerReference, sha256: sha256(referenceBytes), wav: parseWav(referenceBytes) };
  const voxKey = readJson(join(SOURCE.vox, "key.json"));
  if (reference.sha256 !== voxKey.referenceSha256) fail("benchmark_owner_reference_hash_mismatch");

  const secret = newRunSecret();
  const built = materialise(paths, secret, sourceStimuli, reference, sourcePackRoots);
  const keyBytes = Buffer.from(JSON.stringify(built.key, null, 2));
  writeFileSync(paths.key, keyBytes);
  const keySha256 = sha256(keyBytes);

  const matched = built.cells.filter((cell) => cell.comparison === "matched_text");
  const unmatched = built.cells.filter((cell) => cell.comparison === "unmatched_lane");
  const crossProviderMatched = matched.filter((cell) => new Set(
    built.key.stimuli.filter((stimulus) => stimulus.cellId === cell.id).map((stimulus) => stimulus.pack),
  ).size > 1);
  const manifest = {
    contract: BENCHMARK_VERSION,
    runId: paths.runId,
    createdAt: built.key.createdAt,
    modelMapping: "sealed",
    sealedKeySha256: keySha256,
    humanListeningStatus: "not_started",
    baseStimuli: sourceStimuli.length,
    ratingTrials: built.trials.sequence.filter((trial) => trial.kind === "rating").length,
    repeatTrials: built.key.repeats.length,
    attentionTrials: built.trials.sequence.filter((trial) => trial.kind === "attention").length,
    matchedTextCells: matched.length,
    unmatchedLanes: unmatched.length,
    crossProviderMatchedCells: crossProviderMatched.length,
    comparisonPolicy: "Only exact language and text hash cells may be compared. Unmatched lanes remain separate.",
    axes: AXES.map((axis) => axis.id),
    disclosureRating: true,
    claim: "instrument_ready_no_human_quality_result",
  };
  writeFileSync(join(paths.served, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(paths.served, "trials.json"), JSON.stringify(built.trials, null, 2));
  copyFileSync(PAGE, join(paths.served, "page.html"));

  console.log(`benchmark ready: ${sourceStimuli.length} source clips, ${manifest.ratingTrials} rating screens, ${manifest.attentionTrials} attention checks`);
  console.log(`comparison plan: ${manifest.matchedTextCells} exact matched-text cell, ${manifest.unmatchedLanes} unmatched lanes, ${manifest.crossProviderMatchedCells} cross-provider matched cells`);
  console.log(`served tree: ${paths.served}`);
  console.log(`sealed key SHA-256: ${keySha256}`);
  console.log("no human rating or model winner exists yet");
  console.log("next: node scripts/voice-listening-benchmark.mjs listen");
}

function readSheets(paths) {
  if (!existsSync(paths.answers)) return [];
  return readdirSync(paths.answers).filter((file) => file.endsWith(".json")).map((file) => readJson(join(paths.answers, file)));
}

function score() {
  const paths = pathsFor();
  const key = readJson(paths.key);
  const trials = readJson(join(paths.served, "trials.json"));
  const report = opaqueReport({ key, trials, sheets: readSheets(paths) });
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(join(paths.reports, "opaque-report.json"), JSON.stringify(report, null, 2));
  console.log(`accepted listeners: ${report.acceptedListeners}`);
  for (const listener of report.listeners) {
    console.log(`${listener.listener}: catch ${listener.catchCorrect}/${listener.catchTrials}, ${listener.accepted ? "accepted" : "not accepted"}`);
  }
  console.log("model mapping remains sealed; no cross-provider winner is reported");
}

function unseal() {
  if (flags.get("confirm-ratings-locked") !== true) fail("benchmark_unseal_requires_confirm_ratings_locked");
  const paths = pathsFor();
  const keyBytes = readFileSync(paths.key);
  const key = JSON.parse(keyBytes.toString("utf8"));
  const manifest = readJson(join(paths.served, "manifest.json"));
  if (sha256(keyBytes) !== manifest.sealedKeySha256) fail("benchmark_sealed_key_hash_mismatch");
  const trials = readJson(join(paths.served, "trials.json"));
  const report = unsealedReport({ key, trials, sheets: readSheets(paths) });
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(join(paths.reports, "unsealed-report.json"), JSON.stringify(report, null, 2));
  console.log(`unsealed report written for ${report.acceptedListeners} accepted listener(s)`);
  console.log("cross-provider winner: none, because no exact text cell crosses providers");
}

async function verify() {
  const paths = pathsFor();
  const keyBytes = readFileSync(paths.key);
  const key = JSON.parse(keyBytes.toString("utf8"));
  const manifestBytes = readFileSync(join(paths.served, "manifest.json"));
  const trialsBytes = readFileSync(join(paths.served, "trials.json"));
  const pageBytes = readFileSync(join(paths.served, "page.html"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const trials = JSON.parse(trialsBytes.toString("utf8"));

  if (key.contract !== BENCHMARK_VERSION || manifest.contract !== BENCHMARK_VERSION || trials.contract !== BENCHMARK_VERSION) {
    fail("benchmark_verify_contract_mismatch");
  }
  if (sha256(keyBytes) !== manifest.sealedKeySha256) fail("benchmark_verify_seal_mismatch");
  if (key.runId !== manifest.runId || key.runId !== trials.runId || key.runId !== paths.runId) fail("benchmark_verify_run_mismatch");

  const servedText = Buffer.concat([manifestBytes, trialsBytes, pageBytes]).toString("utf8");
  const forbidden = new Set([
    "chatterbox", "qwen", "voxcpm", "candidateId", "candidateLabel", "modelCommitment",
    "sourceStimulusId", "runSecret", '"correct"', "sourceFile", "originalId",
    ...key.stimuli.flatMap((stimulus) => [stimulus.originalId, stimulus.candidateId, stimulus.candidateLabel, stimulus.modelCommitment]),
  ]);
  for (const value of forbidden) {
    if (value && servedText.toLowerCase().includes(String(value).toLowerCase())) fail("benchmark_verify_served_mapping_leak");
  }

  const expectedIds = new Set([trials.referenceId, ...trials.sequence.map((trial) => trial.stimulusId)]);
  const files = readdirSync(paths.stimuli).filter((file) => file.endsWith(".wav"));
  if (files.length !== expectedIds.size || files.some((file) => !expectedIds.has(file.replace(/\.wav$/i, "")))) {
    fail("benchmark_verify_stimulus_set_mismatch");
  }
  const geometries = files.map((file) => {
    const bytes = readFileSync(join(paths.stimuli, file));
    const wav = parseWav(bytes);
    return `${bytes.length}:${wav.samples}:${wav.sampleRate}:${wav.channels}:${wav.bitsPerSample}`;
  });
  if (new Set(geometries).size !== 1) fail("benchmark_verify_audio_geometry_leak");

  const privateTrials = new Map(key.sequence.map((trial) => [trial.trialId, trial]));
  if (privateTrials.size !== key.sequence.length || trials.sequence.length !== key.sequence.length) fail("benchmark_verify_trial_id_invalid");
  for (const publicTrial of trials.sequence) {
    const privateTrial = privateTrials.get(publicTrial.trialId);
    if (!privateTrial || privateTrial.stimulusId !== publicTrial.stimulusId || privateTrial.kind !== publicTrial.kind) fail("benchmark_verify_trial_binding_invalid");
    if (publicTrial.kind === "attention" && Object.hasOwn(publicTrial, "correct")) fail("benchmark_verify_attention_key_leaked");
  }
  for (const repeat of key.repeats) {
    const original = privateTrials.get(repeat.originalTrialId);
    const duplicate = privateTrials.get(repeat.repeatTrialId);
    if (!original || !duplicate || original.stimulusId === duplicate.stimulusId || original.sourceStimulusId !== duplicate.sourceStimulusId) {
      fail("benchmark_verify_repeat_binding_invalid");
    }
    const first = readFileSync(join(paths.stimuli, `${original.stimulusId}.wav`));
    const second = readFileSync(join(paths.stimuli, `${duplicate.stimulusId}.wav`));
    if (sha256(first) !== sha256(second)) fail("benchmark_verify_repeat_audio_mismatch");
  }

  const recalculatedCells = buildCells(key.stimuli);
  if (canonical(recalculatedCells) !== canonical(key.cells)) fail("benchmark_verify_cell_plan_drift");
  const matched = key.cells.filter((cell) => cell.comparison === "matched_text");
  const unmatched = key.cells.filter((cell) => cell.comparison === "unmatched_lane");
  const crossProviderMatched = matched.filter((cell) => new Set(
    key.stimuli.filter((stimulus) => stimulus.cellId === cell.id).map((stimulus) => stimulus.pack),
  ).size > 1);
  if (manifest.matchedTextCells !== matched.length || manifest.unmatchedLanes !== unmatched.length || manifest.crossProviderMatchedCells !== crossProviderMatched.length) {
    fail("benchmark_verify_comparison_plan_invalid");
  }

  const sources = loadSourcesFromRecordedPacks(key.sourcePacks);
  if (sources.length !== key.stimuli.length) fail("benchmark_verify_source_count_drift");
  const sourceBindings = new Map(sources.map((source) => [`${source.pack}:${source.originalId}`, source]));
  for (const stimulus of key.stimuli) {
    const source = sourceBindings.get(`${stimulus.pack}:${stimulus.originalId}`);
    if (!source || source.sourceWavSha256 !== stimulus.sourceWavSha256 || source.sourcePcmSha256 !== stimulus.sourcePcmSha256) {
      fail("benchmark_verify_source_binding_drift");
    }
  }

  const server = await serveListeningBenchmark(paths, 0);
  const port = server.address().port;
  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);
  try {
    if ((await get("/")).status !== 200 || (await get("/manifest.json")).status !== 200 || (await get("/trials.json")).status !== 200) {
      fail("benchmark_verify_server_public_route_failed");
    }
    if ((await get(`/stimuli/${files[0]}`)).status !== 200) fail("benchmark_verify_server_audio_failed");
    for (const path of ["/private/sealed-key.json", "/answers", "/../private/sealed-key.json", "/stimuli/%2e%2e%2f%2e%2e%2fprivate%2fsealed-key.json"]) {
      if ((await get(path)).status !== 404) fail("benchmark_verify_private_route_reachable");
    }
  } finally {
    server.close();
  }

  console.log("voice listening benchmark integrity: 18/18 checks passed");
  console.log(`actual pack: ${key.stimuli.length} source clips, ${files.length} equal-geometry served WAVs, ${matched.length} exact matched-text cell(s)`);
  console.log("arm mapping remains sealed and no quality score has been created");
}

async function listen() {
  const paths = pathsFor();
  if (!existsSync(paths.key)) fail("benchmark_run_not_built");
  const port = Number(flags.get("port") || 8791);
  const server = await serveListeningBenchmark(paths, port, { onSaved: (file) => console.log(`saved ${relative(ROOT, file)}`) });
  const address = server.address();
  console.log(`open http://127.0.0.1:${address.port}/`);
  console.log("the private key is not served; stop with Ctrl+C after the ratings are locked");
}

function usage() {
  console.log("voice-listening-benchmark");
  console.log("  build [--home path] [--indicf5-pack path]");
  console.log("  listen [--home path] [--port 8791]");
  console.log("  score [--home path]");
  console.log("  verify [--home path]");
  console.log("  unseal --confirm-ratings-locked [--home path]");
}

try {
  if (command === "build") build();
  else if (command === "listen") await listen();
  else if (command === "score") score();
  else if (command === "verify") await verify();
  else if (command === "unseal") unseal();
  else usage();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
