import {
  constants as cryptoConstants,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  DISCLOSURE_OPTIONS,
  commonTargetRms,
  normaliseAndPad,
  opaqueId,
  opaqueReport,
  parseWav,
  pcmStats,
  seededRandom,
  shuffled,
  tonePcm,
  validateSheet,
  wrapWav,
} from "../voice-listening-benchmark/lib.mjs";
import {
  findDisclosureCut,
  samples as pcmSamples,
  toPcm,
  trimPlausible,
} from "../earbench/audio.mjs";
import {
  ARM_SPECS,
  MATCHED_PACK_CONTRACT,
  PROTECTION_PATHS,
  SAMPLE_RATE,
  SCORE_AXES,
  canonical,
  isVendorArm,
  sha256,
} from "./contract.mjs";

export const STUDIO_BUNDLE_CONTRACT = "vyakti-owner-voice-studio-bundle/v1";
export const STUDIO_REPORT_ATTESTATION_CONTRACT = "vyakti-studio-report-attestation/v1";
export const STUDIO_REPORT_SIGNATURE_ALGORITHM = "RSASSA-PKCS1-v1_5";
export const STUDIO_REPORT_SIGNATURE_HASH = "SHA-256";
const MAX_STUDIO_BUNDLE_BYTES = 20 * 1024 * 1024;
const MAX_STUDIO_ANSWER_BYTES = 1024 * 1024;
const OPAQUE_AUDIO_ID = /^[0-9a-f]{24}$/;
const STUDIO_FORBIDDEN = [
  "chatterbox", "qwen", "voxcpm", "indicf5", "zonos", "elevenlabs", "sarvam", "bulbul",
  "modelcommitment", "consentreceipt", "runsecret", "sourceitemid", "armcategory",
  "clonestheowner", '"correct"',
];

export function pathsFor(home) {
  const root = resolve(home);
  return Object.freeze({
    home: root,
    runId: root.split(/[\\/]/).filter(Boolean).at(-1),
    private: join(root, "private"),
    plan: join(root, "private", "plan.json"),
    reference: join(root, "private", "reference.wav"),
    referenceText: join(root, "private", "reference-transcript.txt"),
    ledger: join(root, "private", "spend-ledger.json"),
    outputs: join(root, "private", "outputs"),
    receipts: join(root, "private", "receipts"),
    key: join(root, "private", "sealed-key.json"),
    studioReportSigningKey: join(root, "private", "studio-report-signing-key.pem"),
    served: join(root, "served"),
    stimuli: join(root, "served", "stimuli"),
    answers: join(root, "answers"),
    reports: join(root, "reports"),
  });
}

function studioReportSigner(paths) {
  if (!existsSync(paths.studioReportSigningKey)) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 0x10001,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(paths.studioReportSigningKey, privateKey, { mode: 0o600, flag: "wx" });
  }
  const privatePem = readFileSync(paths.studioReportSigningKey);
  if (!privatePem.length || privatePem.length > 16 * 1024) throw new Error("matched_pack_studio_signing_key_invalid");
  let privateKey;
  try { privateKey = createPrivateKey(privatePem); }
  catch { throw new Error("matched_pack_studio_signing_key_invalid"); }
  if (privateKey.asymmetricKeyType !== "rsa" || Number(privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error("matched_pack_studio_signing_key_invalid");
  }
  const publicSpki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const publicKeySha256 = sha256(publicSpki);
  return Object.freeze({
    privateKey,
    publicManifest: Object.freeze({
      contract: STUDIO_REPORT_ATTESTATION_CONTRACT,
      algorithm: STUDIO_REPORT_SIGNATURE_ALGORITHM,
      hash: STUDIO_REPORT_SIGNATURE_HASH,
      keyId: publicKeySha256,
      publicKeySha256,
      publicKeySpkiBase64: publicSpki.toString("base64"),
    }),
  });
}

function signStudioReport(report, signer) {
  const signature = cryptoSign("sha256", Buffer.from(canonical(report)), {
    key: signer.privateKey,
    padding: cryptoConstants.RSA_PKCS1_PADDING,
  });
  return Object.freeze({
    ...report,
    attestation: Object.freeze({
      contract: STUDIO_REPORT_ATTESTATION_CONTRACT,
      algorithm: STUDIO_REPORT_SIGNATURE_ALGORITHM,
      hash: STUDIO_REPORT_SIGNATURE_HASH,
      keyId: signer.publicManifest.keyId,
      signatureBase64: signature.toString("base64"),
    }),
  });
}

export function prepareHome({ home, plan, referenceWav, referenceText }) {
  const paths = pathsFor(home);
  if (existsSync(paths.plan) || existsSync(paths.key)) throw new Error("matched_pack_home_already_prepared");
  if (sha256(referenceWav) !== plan.reference.sha256 || sha256(Buffer.from(referenceText)) !== plan.reference.textSha256) {
    throw new Error("matched_pack_prepare_binding_invalid");
  }
  for (const directory of [paths.private, paths.outputs, paths.receipts, paths.answers, paths.reports]) mkdirSync(directory, { recursive: true });
  writeFileSync(paths.plan, JSON.stringify(plan, null, 2));
  writeFileSync(paths.reference, referenceWav);
  writeFileSync(paths.referenceText, referenceText, { mode: 0o600 });
  writeFileSync(paths.ledger, JSON.stringify({ contract: MATCHED_PACK_CONTRACT, hardStopUsd: plan.cloudHardStopUsd, attempts: [] }, null, 2));
  return paths;
}

export function saveResult(paths, normalized) {
  const itemFile = `${normalized.itemId}.wav`;
  const receiptFile = `${normalized.itemId}.json`;
  if (existsSync(join(paths.outputs, itemFile)) || existsSync(join(paths.receipts, receiptFile))) {
    throw new Error("matched_pack_result_already_exists");
  }
  writeFileSync(join(paths.outputs, itemFile), normalized.wav);
  const receipt = { ...normalized, wav: undefined };
  writeFileSync(join(paths.receipts, receiptFile), JSON.stringify(receipt, null, 2));
}

function loadPrivateInputs(paths) {
  const plan = JSON.parse(readFileSync(paths.plan, "utf8"));
  const referenceWav = readFileSync(paths.reference);
  const referenceText = readFileSync(paths.referenceText, "utf8");
  if (plan.contract !== MATCHED_PACK_CONTRACT || sha256(referenceWav) !== plan.reference.sha256 || sha256(Buffer.from(referenceText)) !== plan.reference.textSha256) {
    throw new Error("matched_pack_private_input_invalid");
  }
  return { plan, referenceWav, referenceText };
}

function verifiedResults(paths, plan) {
  return plan.items.map((item) => {
    const receipt = JSON.parse(readFileSync(join(paths.receipts, `${item.id}.json`), "utf8"));
    const wavBytes = readFileSync(join(paths.outputs, `${item.id}.wav`));
    const wav = parseWav(wavBytes);
    // The two transports carry different proofs and the pack checks each one
    // for what it can actually have. A vendor receipt claiming an HMAC or a
    // PerTh watermark it cannot have is rejected here as well as in the
    // verifier, because a receipt on disk is what a later reader trusts.
    const vendor = isVendorArm(item.armId);
    const required = {
      contract: MATCHED_PACK_CONTRACT,
      itemId: item.id,
      armId: item.armId,
      languageId: item.languageId,
      seed: plan.seed,
      bodySha256: item.bodySha256,
      disclosureSha256: item.disclosureSha256,
      fullTextSha256: item.fullTextSha256,
      sourceSha256: plan.reference.sourceSha256,
      referenceSha256: plan.reference.sha256,
      referenceTextSha256: plan.reference.textSha256,
      consentReceiptSha256: plan.consentReceiptSha256,
      outputWavSha256: sha256(wavBytes),
      sampleRate: SAMPLE_RATE,
      channels: 1,
      encoding: "pcm_s16le",
      responseHmacVerified: !vendor,
      perthWatermarkVerified: !vendor,
      ...(vendor ? {
        transportProof: "tls_vendor_api",
        protectionPath: PROTECTION_PATHS.DELIVERY_AUDIOSEAL,
        clonesTheOwner: ARM_SPECS[item.armId].clonesTheOwner === true,
      } : {}),
    };
    for (const [key, expected] of Object.entries(required)) {
      if (receipt[key] !== expected) throw new Error(`matched_pack_saved_receipt_invalid:${key}`);
    }
    if (!/^[0-9a-f]{64}$/.test(receipt.modelCommitment) || sha256(wav.pcm) !== receipt.outputPcmSha256) {
      throw new Error("matched_pack_saved_output_invalid");
    }
    return Object.freeze({ item, receipt, wavBytes, wav });
  });
}

function publicTrial(trial) {
  if (trial.kind === "attention") return Object.freeze({
    kind: trial.kind,
    trialId: trial.trialId,
    stimulusId: trial.stimulusId,
    options: trial.options,
  });
  return Object.freeze({
    kind: trial.kind,
    trialId: trial.trialId,
    stimulusId: trial.stimulusId,
    language: trial.language,
    langTag: trial.langTag,
    promptText: trial.promptText,
  });
}

function safeMean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const DISCLOSURE_WINDOW = Object.freeze({ minMs: 1_100, maxMs: 6_000 });

/**
 * Cut the spoken disclosure off one candidate clip, or refuse.
 *
 * `rejected.md#disclosure-announces-the-clone` is the entry this implements:
 * every synthesised clip opens by saying "This is an AI-generated voice
 * replica", so opaque filenames and shuffled order blind nothing at all. The
 * trimmer FAILS CLOSED — no pause inside a plausible window, or an implausible
 * chars-per-second on what is left, and the seal writes nothing. A trimmer that
 * always returns something would one day eat the first syllable of the sentence
 * and do it silently.
 */
function cutDisclosure(pcm, text) {
  const values = pcmSamples(pcm);
  const cut = findDisclosureCut(values, DISCLOSURE_WINDOW);
  if (!cut) throw new Error("matched_pack_disclosure_cut_not_found");
  const body = values.subarray(cut.cutSample);
  const plausible = trimPlausible({
    cutMs: cut.cutMs,
    remainingMs: (body.length / SAMPLE_RATE) * 1000,
    text,
    window: DISCLOSURE_WINDOW,
  });
  if (!plausible.ok) throw new Error("matched_pack_disclosure_cut_implausible");
  return Object.freeze({ pcm: toPcm(body), prefixPcm: toPcm(values.subarray(0, cut.cutSample)), cutMs: cut.cutMs });
}

/**
 * @param options.trimDisclosure  Remove the spoken disclosure from every
 *   candidate before listening. Off by default so an existing sealed pack keeps
 *   its shape; on for any pack whose cells cross arms, because the disclosure
 *   is spoken by every arm and therefore tells a listener nothing about the
 *   voice while telling them everything about what they are hearing.
 */
export function sealHome(home, secret = randomBytes(32), options = {}) {
  const paths = pathsFor(home);
  if (existsSync(paths.key) || existsSync(join(paths.served, "manifest.json"))) throw new Error("matched_pack_already_sealed");
  const trimDisclosure = options.trimDisclosure === true;
  const { plan, referenceWav } = loadPrivateInputs(paths);
  const results = verifiedResults(paths, plan);
  const parsedReference = parseWav(referenceWav);
  // The cut happens BEFORE the common loudness and length treatment, so every
  // served file still has one geometry and the trim cannot be heard as a
  // different file size. The owner reference has no disclosure to cut and goes
  // through the identical normalise/pad path, which is what makes the treatment
  // a constant of the bench rather than a cue.
  const cuts = new Map();
  const trimmed = results.map((row) => {
    if (!trimDisclosure) return row;
    const cut = cutDisclosure(row.wav.pcm, plan.prompts[row.item.languageId].body);
    cuts.set(row.item.id, cut);
    return {
      ...row,
      wav: {
        ...row.wav,
        pcm: cut.pcm,
        samples: cut.pcm.length / 2,
        durationMs: Math.round(cut.pcm.length / 2 * 1000 / SAMPLE_RATE),
      },
    };
  });
  const targetRms = commonTargetRms([...trimmed.map((row) => row.wav.pcm), parsedReference.pcm]);
  const targetSamples = Math.max(parsedReference.samples, ...trimmed.map((row) => row.wav.samples));
  mkdirSync(paths.stimuli, { recursive: true });
  if (trimDisclosure) {
    // The removed prefixes only, shuffled and unlabelled. This is the ONE way
    // an operator may confirm the trim by ear: on this bench the operator is
    // also the listener, so checking the stimuli would unblind the run it was
    // protecting. Same instrument as `earbench.mjs verify-trim`.
    const order = shuffled([...cuts.entries()], seededRandom(secret, "trim-check"));
    const silence = Buffer.alloc(SAMPLE_RATE * 2 * 0.6);
    writeFileSync(
      join(paths.private, "trim-check.wav"),
      wrapWav(Buffer.concat(order.flatMap(([, cut]) => [cut.prefixPcm, silence]))),
      { mode: 0o600 },
    );
  }

  const stimuli = trimmed.map(({ item, receipt, wav }) => {
    const stimulusId = opaqueId(secret, "stimulus", item.id, receipt.outputWavSha256);
    const treated = normaliseAndPad(wav.pcm, { targetRms, samples: targetSamples });
    const served = wrapWav(treated.pcm);
    writeFileSync(join(paths.stimuli, `${stimulusId}.wav`), served);
    return Object.freeze({
      id: stimulusId,
      sourceItemId: item.id,
      armId: item.armId,
      armLabel: plan.arms.find((arm) => arm.id === item.armId)?.label,
      languageId: item.languageId,
      language: plan.prompts[item.languageId].language,
      langTag: plan.prompts[item.languageId].locale,
      promptId: item.promptId,
      bodySha256: item.bodySha256,
      disclosureSha256: item.disclosureSha256,
      fullTextSha256: item.fullTextSha256,
      referenceSha256: item.referenceSha256,
      consentReceiptSha256: item.consentReceiptSha256,
      seed: item.seed,
      model: receipt.model,
      modelRevision: receipt.modelRevision,
      modelCommitment: receipt.modelCommitment,
      sourceWavSha256: receipt.outputWavSha256,
      servedWavSha256: sha256(served),
      servedPcmSha256: sha256(treated.pcm),
      sourceDurationMs: wav.durationMs,
      servedDurationMs: Math.round(targetSamples * 1000 / SAMPLE_RATE),
      gain: treated.gain,
      achievedRms: pcmStats(treated.pcm.subarray(0, wav.pcm.length)).rms,
      responseHmacVerified: receipt.responseHmacVerified,
      perthWatermarkVerified: receipt.perthWatermarkVerified,
      // Private-side labels only. None of this reaches the served tree, and the
      // seal verifier proves that separately. They exist so the unsealed report
      // can say which candidate was a clone and which was a base voice without
      // anyone having to remember.
      transport: receipt.transport || "signed_runtime",
      transportProof: receipt.transportProof || "hmac_sha256",
      protectionPath: receipt.protectionPath || PROTECTION_PATHS.RUNTIME_PERTH,
      clonesTheOwner: receipt.clonesTheOwner !== false,
      armCategory: receipt.armCategory || "voice_clone",
      disclosureTrimmedMs: cuts.get(item.id) ? Math.round(cuts.get(item.id).cutMs) : null,
    });
  });

  const referenceId = opaqueId(secret, "reference", plan.reference.sha256);
  const treatedReference = normaliseAndPad(parsedReference.pcm, { targetRms, samples: targetSamples });
  const servedReference = wrapWav(treatedReference.pcm);
  writeFileSync(join(paths.stimuli, `${referenceId}.wav`), servedReference);

  const cells = Object.values(plan.prompts).map((prompt) => Object.freeze({
    id: sha256(`${prompt.languageId}\n${prompt.bodySha256}`).slice(0, 16),
    languageId: prompt.languageId,
    bodySha256: prompt.bodySha256,
    fullTextSha256: prompt.fullTextSha256,
    stimulusIds: Object.freeze(stimuli.filter((item) => item.languageId === prompt.languageId).map((item) => item.id)),
    armIds: Object.freeze(stimuli.filter((item) => item.languageId === prompt.languageId).map((item) => item.armId)),
    comparison: "exact_text_cross_provider",
  }));
  if (cells.some((cell) => new Set(cell.armIds).size < 2)) throw new Error("matched_pack_cross_provider_cell_incomplete");

  const baseRatings = stimuli.map((stimulus) => Object.freeze({
    kind: "rating",
    trialId: opaqueId(secret, "trial", stimulus.id),
    stimulusId: stimulus.id,
    sourceStimulusId: stimulus.id,
    language: stimulus.language,
    langTag: stimulus.langTag,
    promptText: plan.prompts[stimulus.languageId].body,
  }));
  const repeatSources = Object.keys(plan.prompts).map((languageId) => shuffled(
    stimuli.filter((stimulus) => stimulus.languageId === languageId),
    seededRandom(secret, `repeat-${languageId}`),
  )[0]);
  const repeats = repeatSources.map((stimulus) => {
    const repeatStimulusId = opaqueId(secret, "repeat-stimulus", stimulus.id);
    copyFileSync(join(paths.stimuli, `${stimulus.id}.wav`), join(paths.stimuli, `${repeatStimulusId}.wav`));
    return Object.freeze({
      pairId: opaqueId(secret, "repeat-pair", stimulus.id),
      originalTrialId: baseRatings.find((trial) => trial.sourceStimulusId === stimulus.id).trialId,
      repeatTrialId: opaqueId(secret, "repeat-trial", stimulus.id),
      trial: Object.freeze({
        kind: "rating",
        trialId: opaqueId(secret, "repeat-trial", stimulus.id),
        stimulusId: repeatStimulusId,
        sourceStimulusId: stimulus.id,
        language: stimulus.language,
        langTag: stimulus.langTag,
        promptText: plan.prompts[stimulus.languageId].body,
      }),
    });
  });
  const random = seededRandom(secret, "matched-rating-order");
  let ratingSequence = [];
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const proposed = shuffled([...baseRatings, ...repeats.map((repeat) => repeat.trial)], random);
    if (repeats.every((repeat) => Math.abs(
      proposed.findIndex((trial) => trial.trialId === repeat.originalTrialId)
      - proposed.findIndex((trial) => trial.trialId === repeat.repeatTrialId),
    ) >= 3)) {
      ratingSequence = proposed;
      break;
    }
  }
  if (!ratingSequence.length) throw new Error("matched_pack_repeat_randomisation_failed");

  const catchTreated = normaliseAndPad(tonePcm(), { targetRms, samples: targetSamples });
  const catches = [0, 1].map((index) => {
    const stimulusId = opaqueId(secret, "attention-stimulus", String(index));
    writeFileSync(join(paths.stimuli, `${stimulusId}.wav`), wrapWav(catchTreated.pcm));
    return Object.freeze({
      kind: "attention",
      trialId: opaqueId(secret, "attention-trial", String(index)),
      stimulusId,
      correct: "tone",
      options: shuffled([
        { id: "tone", label: "A tone" },
        { id: "speech", label: "Speech" },
        { id: "silence", label: "Silence" },
      ], seededRandom(secret, `attention-options-${index}`)),
    });
  });
  const sequence = [...ratingSequence];
  sequence.splice(2, 0, catches[0]);
  sequence.splice(Math.min(7, sequence.length), 0, catches[1]);

  const key = {
    contract: MATCHED_PACK_CONTRACT,
    runId: paths.runId,
    createdAt: new Date().toISOString(),
    runSecret: secret.toString("hex"),
    policy: { minimumCatchRate: 1, exactTextCellsOnly: true, descriptiveMeansAreNotAQualityWin: true },
    reference: {
      ...plan.reference,
      servedId: referenceId,
      servedWavSha256: sha256(servedReference),
    },
    prompts: plan.prompts,
    stimuli,
    cells,
    sequence,
    repeats: repeats.map(({ trial, ...repeat }) => repeat),
    audioTreatment: {
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      targetRms,
      peakCeiling: 0.92,
      fadeMs: 10,
      commonDurationMs: Math.round(targetSamples * 1000 / SAMPLE_RATE),
      commonBytes: 44 + targetSamples * 2,
      disclosureTrimmed: trimDisclosure,
      disclosureTrimCheckFile: trimDisclosure ? "private/trim-check.wav" : null,
      disclosureReason: trimDisclosure
        ? "Every arm speaks the same disclosure, so it blinds nothing and unblinds the clip."
        : "Disclosure audibility is a required human rating.",
    },
  };
  const keyBytes = Buffer.from(JSON.stringify(key, null, 2));
  writeFileSync(paths.key, keyBytes, { mode: 0o600 });
  const trials = {
    contract: MATCHED_PACK_CONTRACT,
    runId: paths.runId,
    referenceId,
    axes: SCORE_AXES,
    disclosureOptions: DISCLOSURE_OPTIONS,
    sequence: sequence.map(publicTrial),
  };
  const manifest = {
    contract: MATCHED_PACK_CONTRACT,
    runId: paths.runId,
    createdAt: key.createdAt,
    modelMapping: "sealed",
    sealedKeySha256: sha256(keyBytes),
    humanListeningStatus: "not_started",
    baseStimuli: stimuli.length,
    ratingTrials: trials.sequence.filter((trial) => trial.kind === "rating").length,
    repeatTrials: repeats.length,
    attentionTrials: catches.length,
    exactTextCrossProviderCells: cells.length,
    languages: cells.map((cell) => cell.languageId),
    referenceSha256: plan.reference.sha256,
    seed: plan.seed,
    axes: SCORE_AXES.map((axis) => axis.id),
    disclosureTrimmed: trimDisclosure,
    // A COUNT, never a list. How many arms a cell holds is a property of the
    // instrument an owner should be able to see; which arms they are is the
    // thing the seal exists to hide.
    vendorArmCount: stimuli.filter((row) => row.transport === "vendor_api").length,
    claim: "instrument_ready_no_human_quality_result",
  };
  mkdirSync(paths.served, { recursive: true });
  writeFileSync(join(paths.served, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(paths.served, "trials.json"), JSON.stringify(trials, null, 2));
  copyFileSync(resolve("evals/voice-listening-benchmark/page.html"), join(paths.served, "page.html"));
  return Object.freeze({ paths, manifest, key, trials });
}

export function verifySealedHome(home) {
  const paths = pathsFor(home);
  const keyBytes = readFileSync(paths.key);
  const key = JSON.parse(keyBytes.toString("utf8"));
  const manifestBytes = readFileSync(join(paths.served, "manifest.json"));
  const trialsBytes = readFileSync(join(paths.served, "trials.json"));
  const pageBytes = readFileSync(join(paths.served, "page.html"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const trials = JSON.parse(trialsBytes.toString("utf8"));
  if ([key, manifest, trials].some((value) => value.contract !== MATCHED_PACK_CONTRACT)) throw new Error("matched_pack_contract_drift");
  if (sha256(keyBytes) !== manifest.sealedKeySha256) throw new Error("matched_pack_seal_hash_invalid");
  if (key.runId !== manifest.runId || key.runId !== trials.runId || key.runId !== paths.runId) throw new Error("matched_pack_run_id_invalid");
  const servedText = Buffer.concat([manifestBytes, trialsBytes, pageBytes]).toString("utf8").toLowerCase();
  const forbidden = ["chatterbox", "qwen", "voxcpm", "indicf5", "zonos", "elevenlabs", "sarvam", "bulbul",
    "modelcommitment", "consentreceipt", "runsecret", "sourceitemid", "armcategory", "clonestheowner", '"correct"'];
  if (forbidden.some((value) => servedText.includes(value))) throw new Error("matched_pack_served_mapping_leak");
  const expectedIds = new Set([trials.referenceId, ...trials.sequence.map((trial) => trial.stimulusId)]);
  const files = readdirSync(paths.stimuli).filter((file) => file.endsWith(".wav"));
  if (files.length !== expectedIds.size || files.some((file) => !expectedIds.has(file.slice(0, -4)))) throw new Error("matched_pack_stimulus_set_invalid");
  const geometry = new Set(files.map((file) => {
    const bytes = readFileSync(join(paths.stimuli, file));
    const wav = parseWav(bytes);
    return `${bytes.length}:${wav.samples}:${wav.sampleRate}:${wav.channels}:${wav.bitsPerSample}`;
  }));
  if (geometry.size !== 1) throw new Error("matched_pack_geometry_leak");
  const privateTrials = new Map(key.sequence.map((trial) => [trial.trialId, trial]));
  for (const trial of trials.sequence) {
    const privateTrial = privateTrials.get(trial.trialId);
    if (!privateTrial || privateTrial.stimulusId !== trial.stimulusId || privateTrial.kind !== trial.kind) throw new Error("matched_pack_trial_binding_invalid");
    if (trial.kind === "attention" && Object.hasOwn(trial, "correct")) throw new Error("matched_pack_attention_key_leak");
  }
  for (const repeat of key.repeats) {
    const first = privateTrials.get(repeat.originalTrialId);
    const second = privateTrials.get(repeat.repeatTrialId);
    if (!first || !second || first.sourceStimulusId !== second.sourceStimulusId || first.stimulusId === second.stimulusId) throw new Error("matched_pack_repeat_binding_invalid");
    if (sha256(readFileSync(join(paths.stimuli, `${first.stimulusId}.wav`))) !== sha256(readFileSync(join(paths.stimuli, `${second.stimulusId}.wav`)))) {
      throw new Error("matched_pack_repeat_audio_invalid");
    }
  }
  for (const cell of key.cells) {
    const rows = key.stimuli.filter((stimulus) => stimulus.languageId === cell.languageId);
    if (new Set(rows.map((row) => row.armId)).size < 2 || new Set(rows.map((row) => row.bodySha256)).size !== 1
      || new Set(rows.map((row) => row.fullTextSha256)).size !== 1 || new Set(rows.map((row) => row.referenceSha256)).size !== 1
      || new Set(rows.map((row) => row.consentReceiptSha256)).size !== 1 || new Set(rows.map((row) => row.seed)).size !== 1) {
      throw new Error("matched_pack_exact_cell_invalid");
    }
  }
  verifiedResults(paths, JSON.parse(readFileSync(paths.plan, "utf8")));
  return Object.freeze({
    checks: 18,
    stimuli: key.stimuli.length,
    ratingTrials: trials.sequence.filter((trial) => trial.kind === "rating").length,
    cells: key.cells.length,
    commonGeometry: [...geometry][0],
  });
}

/**
 * Build the one-file owner Studio import from the already-sealed public tree.
 * No private receipt, answer key, arm or model label enters this file. The
 * private key is read only by verifySealedHome, which proves the served tree
 * still binds to it before export.
 */
export function exportStudioBundle(home, outputFile) {
  const verified = verifySealedHome(home);
  const paths = pathsFor(home);
  const signer = studioReportSigner(paths);
  const manifest = {
    ...JSON.parse(readFileSync(join(paths.served, "manifest.json"), "utf8")),
    reportAttestation: signer.publicManifest,
  };
  const trials = JSON.parse(readFileSync(join(paths.served, "trials.json"), "utf8"));
  const ids = [...new Set([trials.referenceId, ...trials.sequence.map((trial) => trial.stimulusId)])];
  if (ids.some((id) => !OPAQUE_AUDIO_ID.test(id))) throw new Error("matched_pack_studio_audio_id_invalid");
  const stimuli = Object.fromEntries(ids.map((id) => {
    const bytes = readFileSync(join(paths.stimuli, `${id}.wav`));
    parseWav(bytes);
    return [id, {
      mime: "audio/wav",
      bytes: bytes.length,
      sha256: sha256(bytes),
      base64: bytes.toString("base64"),
    }];
  }));
  const bundle = {
    contract: STUDIO_BUNDLE_CONTRACT,
    runId: paths.runId,
    manifest,
    trials,
    stimuli,
  };
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.length > MAX_STUDIO_BUNDLE_BYTES) throw new Error("matched_pack_studio_bundle_too_large");
  // Scan only listener-facing JSON metadata. Base64 audio is opaque binary and
  // inevitably contains short coincidental letter sequences such as "qwen".
  const publicMetadata = JSON.stringify({ manifest, trials }).toLowerCase();
  if (STUDIO_FORBIDDEN.some((value) => publicMetadata.includes(value))) throw new Error("matched_pack_studio_mapping_leak");
  writeFileSync(resolve(outputFile), bytes);
  return Object.freeze({
    file: resolve(outputFile),
    bytes: bytes.length,
    sha256: sha256(bytes),
    stimuli: ids.length,
    ratingTrials: verified.ratingTrials,
  });
}

/**
 * Admit a Studio-exported answer sheet only after the existing private catch
 * keys accept it. The browser never receives those keys. A conflicting file
 * is refused so a later import cannot silently replace locked human evidence.
 */
export function importStudioAnswerSheet(home, inputFile) {
  verifySealedHome(home);
  const paths = pathsFor(home);
  const bytes = readFileSync(resolve(inputFile));
  if (!bytes.length || bytes.length > MAX_STUDIO_ANSWER_BYTES) throw new Error("matched_pack_studio_answers_size_invalid");
  let sheet;
  try { sheet = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("matched_pack_studio_answers_json_invalid"); }
  const key = JSON.parse(readFileSync(paths.key, "utf8"));
  const trials = JSON.parse(readFileSync(join(paths.served, "trials.json"), "utf8"));
  if (sheet?.contract !== MATCHED_PACK_CONTRACT || !validateSheet(sheet, trials, paths.runId).valid) {
    throw new Error("matched_pack_studio_answers_invalid");
  }
  const report = opaqueReport({ key, trials, sheets: [sheet] });
  if (report.acceptedListeners !== 1) throw new Error("matched_pack_studio_answers_not_accepted");
  const listener = String(sheet.listener || "owner-studio").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "owner-studio";
  const normalized = Buffer.from(JSON.stringify({ ...sheet, listener, runId: paths.runId, complete: true }, null, 2));
  mkdirSync(paths.answers, { recursive: true });
  const target = join(paths.answers, `${listener}.json`);
  if (existsSync(target) && !readFileSync(target).equals(normalized)) throw new Error("matched_pack_studio_answers_conflict");
  writeFileSync(target, normalized);
  return Object.freeze({ listener, file: target, accepted: true });
}

function readSheets(paths) {
  return readdirSync(paths.answers).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(join(paths.answers, file), "utf8")));
}

export function scoreHome(home) {
  const paths = pathsFor(home);
  const key = JSON.parse(readFileSync(paths.key, "utf8"));
  const trials = JSON.parse(readFileSync(join(paths.served, "trials.json"), "utf8"));
  const report = opaqueReport({ key, trials, sheets: readSheets(paths) });
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(join(paths.reports, "opaque-report.json"), JSON.stringify({
    ...report,
    contract: MATCHED_PACK_CONTRACT,
    claim: "human_ratings_only_mapping_sealed",
  }, null, 2));
  return report;
}

export function unsealHome(home) {
  const paths = pathsFor(home);
  const keyBytes = readFileSync(paths.key);
  const key = JSON.parse(keyBytes.toString("utf8"));
  const trials = JSON.parse(readFileSync(join(paths.served, "trials.json"), "utf8"));
  const opaque = opaqueReport({ key, trials, sheets: readSheets(paths) });
  if (!opaque.acceptedListeners) throw new Error("matched_pack_no_accepted_listener");
  const repeatIds = new Set(key.repeats.map((repeat) => repeat.repeatTrialId));
  const privateTrials = new Map(key.sequence.map((trial) => [trial.trialId, trial]));
  const ratingMap = new Map(opaque.ratings.map((rating) => [rating.trialId, rating]));
  const rows = key.stimuli.map((stimulus) => {
    const trial = key.sequence.find((candidate) => candidate.kind === "rating" && !repeatIds.has(candidate.trialId) && candidate.sourceStimulusId === stimulus.id);
    const rating = ratingMap.get(trial.trialId);
    return Object.freeze({
      languageId: stimulus.languageId,
      armId: stimulus.armId,
      armLabel: stimulus.armLabel,
      model: stimulus.model,
      modelRevision: stimulus.modelRevision,
      modelCommitment: stimulus.modelCommitment,
      // Carried into the report so a reader cannot compare a base voice with a
      // clone on owner likeness without seeing that is what they are doing.
      armCategory: stimulus.armCategory,
      clonesTheOwner: stimulus.clonesTheOwner,
      transport: stimulus.transport,
      protectionPath: stimulus.protectionPath,
      n: rating.n,
      means: rating.means,
      disclosure: rating.disclosure,
      descriptiveOverallMean: safeMean(SCORE_AXES.map((axis) => rating.means[axis.id]).filter((value) => value !== null)),
    });
  });
  const cells = key.cells.map((cell) => Object.freeze({
    languageId: cell.languageId,
    bodySha256: cell.bodySha256,
    fullTextSha256: cell.fullTextSha256,
    comparison: "exact_text_cross_provider",
    candidates: rows.filter((row) => row.languageId === cell.languageId).sort((a, b) => (b.descriptiveOverallMean || 0) - (a.descriptiveOverallMean || 0)),
    winnerClaim: null,
    winnerReason: "Descriptive listener means are not a statistical or production quality win.",
  }));
  const report = {
    contract: MATCHED_PACK_CONTRACT,
    runId: key.runId,
    sealedKeySha256: sha256(keyBytes),
    status: "ratings_locked_mapping_unsealed",
    acceptedListeners: opaque.acceptedListeners,
    repeatConsistency: opaque.repeatConsistency,
    cells,
    overallWinner: null,
    overallWinnerReason: "English and Hindi remain separate exact-text cells.",
  };
  const signedReport = signStudioReport(report, studioReportSigner(paths));
  const reportBytes = Buffer.from(JSON.stringify(signedReport, null, 2));
  if (reportBytes.length > MAX_STUDIO_ANSWER_BYTES) throw new Error("matched_pack_studio_report_too_large");
  mkdirSync(paths.reports, { recursive: true });
  writeFileSync(join(paths.reports, "unsealed-report.json"), reportBytes);
  return signedReport;
}
