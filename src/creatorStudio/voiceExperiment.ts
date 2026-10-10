export const VOICE_STUDIO_BUNDLE_CONTRACT = "vyakti-owner-voice-studio-bundle/v1";
export const VOICE_MATCHED_PACK_CONTRACT = "vyakti-exact-text-owner-voice-pack/v1";
export const VOICE_REPORT_ATTESTATION_CONTRACT = "vyakti-studio-report-attestation/v1";
export const VOICE_REPORT_SIGNATURE_ALGORITHM = "RSASSA-PKCS1-v1_5";
export const VOICE_REPORT_SIGNATURE_HASH = "SHA-256";
export const MAX_VOICE_STUDIO_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_VOICE_STUDIO_ANSWER_BYTES = 1024 * 1024;

export type VoiceExperimentAxisId = "owner_likeness" | "naturalness" | "indian_accent" | "pronunciation";
export type VoiceExperimentDisclosure = "full" | "partial" | "absent";

export interface VoiceExperimentAxis {
  id: VoiceExperimentAxisId;
  label: string;
  low: string;
  high: string;
}

export interface VoiceExperimentRatingTrial {
  kind: "rating";
  trialId: string;
  stimulusId: string;
  language: string;
  langTag: string;
  promptText: string;
}

export interface VoiceExperimentAttentionTrial {
  kind: "attention";
  trialId: string;
  stimulusId: string;
  options: Array<{ id: string; label: string }>;
}

export type VoiceExperimentTrial = VoiceExperimentRatingTrial | VoiceExperimentAttentionTrial;

export type VoiceExperimentRatingAnswer = Partial<Record<VoiceExperimentAxisId, number>> & {
  disclosure?: VoiceExperimentDisclosure;
  note?: string;
};
export type VoiceExperimentAttentionAnswer = { choice?: string };
export type VoiceExperimentAnswer = VoiceExperimentRatingAnswer | VoiceExperimentAttentionAnswer;
export type VoiceExperimentAnswers = Record<string, VoiceExperimentAnswer>;

export interface VoiceExperimentReportKey {
  contract: typeof VOICE_REPORT_ATTESTATION_CONTRACT;
  algorithm: typeof VOICE_REPORT_SIGNATURE_ALGORITHM;
  hash: typeof VOICE_REPORT_SIGNATURE_HASH;
  keyId: string;
  publicKeySha256: string;
  publicKeySpkiBase64: string;
}

export interface VoiceExperimentReportAttestation {
  contract: typeof VOICE_REPORT_ATTESTATION_CONTRACT;
  algorithm: typeof VOICE_REPORT_SIGNATURE_ALGORITHM;
  hash: typeof VOICE_REPORT_SIGNATURE_HASH;
  keyId: string;
  signatureBase64: string;
}

export interface VoiceExperimentBundle {
  contract: typeof VOICE_STUDIO_BUNDLE_CONTRACT;
  runId: string;
  manifest: {
    contract: typeof VOICE_MATCHED_PACK_CONTRACT;
    runId: string;
    modelMapping: "sealed";
    sealedKeySha256: string;
    baseStimuli: number;
    ratingTrials: number;
    repeatTrials: number;
    attentionTrials: number;
    languages: string[];
    claim: "instrument_ready_no_human_quality_result";
    reportAttestation: VoiceExperimentReportKey;
  };
  trials: {
    contract: typeof VOICE_MATCHED_PACK_CONTRACT;
    runId: string;
    referenceId: string;
    axes: VoiceExperimentAxis[];
    disclosureOptions: Array<{ id: VoiceExperimentDisclosure; label: string }>;
    sequence: VoiceExperimentTrial[];
  };
  stimuli: Record<string, { mime: "audio/wav"; bytes: number; sha256: string; base64: string }>;
}

export interface VoiceExperimentSheet {
  contract: typeof VOICE_MATCHED_PACK_CONTRACT;
  runId: string;
  listener: "owner-studio";
  startedAt: string;
  finishedAt: string | null;
  complete: boolean;
  answers: VoiceExperimentAnswers;
}

export interface VoiceExperimentResultCandidate {
  armLabel: string;
  model: string;
  modelRevision: string;
  n: number;
  means: Record<VoiceExperimentAxisId, number | null>;
  disclosure: Record<VoiceExperimentDisclosure, number>;
  descriptiveOverallMean: number | null;
}

export interface VoiceExperimentResult {
  contract: typeof VOICE_MATCHED_PACK_CONTRACT;
  runId: string;
  sealedKeySha256: string;
  status: "ratings_locked_mapping_unsealed";
  acceptedListeners: number;
  cells: Array<{
    languageId: string;
    comparison: "exact_text_cross_provider";
    winnerClaim: null;
    winnerReason: string;
    candidates: VoiceExperimentResultCandidate[];
  }>;
  overallWinner: null;
  overallWinnerReason: string;
  attestation: VoiceExperimentReportAttestation;
}

const AXIS_IDS: VoiceExperimentAxisId[] = ["owner_likeness", "naturalness", "indian_accent", "pronunciation"];
const DISCLOSURES: VoiceExperimentDisclosure[] = ["full", "partial", "absent"];
const OPAQUE_ID = /^[0-9a-f]{24}$/;
const HASH = /^[0-9a-f]{64}$/;
const SAFE_RUN = /^[a-z0-9][a-z0-9_-]{2,79}$/i;
const FORBIDDEN_METADATA = [
  "chatterbox", "qwen", "voxcpm", "indicf5", "zonos", "modelcommitment",
  "consentreceipt", "runsecret", "sourceitemid", '"correct"',
];

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, code: string, max = 500): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || Array.from(text).length > max) fail(code);
  return text;
}

function boundedInt(value: unknown, min: number, max: number, code: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) fail(code);
  return Number(value);
}

function decodeBase64(value: unknown, maxBytes: number, code = "voice_experiment_audio_base64_invalid"): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail(code);
  }
  let binary = "";
  try { binary = atob(value); }
  catch { fail(code); }
  if (!binary.length || binary.length > maxBytes) fail(code);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function wavGeometry(bytes: Uint8Array): string {
  if (bytes.length < 44 || new TextDecoder("ascii").decode(bytes.slice(0, 4)) !== "RIFF"
    || new TextDecoder("ascii").decode(bytes.slice(8, 12)) !== "WAVE") fail("voice_experiment_wav_invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (channels !== 1 || sampleRate !== 24_000 || bits !== 16) fail("voice_experiment_wav_geometry_invalid");
  return `${bytes.length}:${sampleRate}:${channels}:${bits}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("voice_experiment_hash_unavailable");
  const input = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function canonicalVoiceExperimentJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalVoiceExperimentJson).join(",")}]`;
  if (!value || typeof value !== "object") fail("voice_experiment_attestation_body_invalid");
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalVoiceExperimentJson(object[key])}`).join(",")}}`;
}

export async function verifyVoiceExperimentReportAttestation(
  reportBody: unknown,
  rawAttestation: unknown,
  rawPublicKey: unknown,
): Promise<VoiceExperimentReportAttestation> {
  const attestation = record(rawAttestation, "voice_experiment_result_attestation_invalid");
  const publicKey = record(rawPublicKey, "voice_experiment_result_attestation_invalid");
  if (attestation.contract !== VOICE_REPORT_ATTESTATION_CONTRACT
    || attestation.algorithm !== VOICE_REPORT_SIGNATURE_ALGORITHM
    || attestation.hash !== VOICE_REPORT_SIGNATURE_HASH
    || publicKey.contract !== VOICE_REPORT_ATTESTATION_CONTRACT
    || publicKey.algorithm !== VOICE_REPORT_SIGNATURE_ALGORITHM
    || publicKey.hash !== VOICE_REPORT_SIGNATURE_HASH) fail("voice_experiment_result_attestation_invalid");
  const keyId = boundedText(attestation.keyId, "voice_experiment_result_attestation_invalid", 64);
  const publicKeySha256 = boundedText(publicKey.publicKeySha256, "voice_experiment_result_attestation_invalid", 64);
  if (!HASH.test(keyId) || keyId !== publicKey.keyId || keyId !== publicKeySha256) fail("voice_experiment_result_attestation_binding_invalid");
  const publicSpki = decodeBase64(publicKey.publicKeySpkiBase64, 1024, "voice_experiment_result_public_key_invalid");
  if (publicSpki.length < 256 || await sha256(publicSpki) !== publicKeySha256) fail("voice_experiment_result_public_key_invalid");
  const signature = decodeBase64(attestation.signatureBase64, 512, "voice_experiment_result_signature_invalid");
  let verificationKey: CryptoKey;
  try {
    verificationKey = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(publicSpki).buffer,
      { name: VOICE_REPORT_SIGNATURE_ALGORITHM, hash: VOICE_REPORT_SIGNATURE_HASH },
      false,
      ["verify"],
    );
  } catch { fail("voice_experiment_result_public_key_invalid"); }
  const verified = await crypto.subtle.verify(
    VOICE_REPORT_SIGNATURE_ALGORITHM,
    verificationKey,
    new Uint8Array(signature),
    new TextEncoder().encode(canonicalVoiceExperimentJson(reportBody)),
  ).catch(() => false);
  if (!verified) fail("voice_experiment_result_signature_invalid");
  return {
    contract: VOICE_REPORT_ATTESTATION_CONTRACT,
    algorithm: VOICE_REPORT_SIGNATURE_ALGORITHM,
    hash: VOICE_REPORT_SIGNATURE_HASH,
    keyId,
    signatureBase64: String(attestation.signatureBase64),
  };
}

export function stimulusBlob(bundle: VoiceExperimentBundle, stimulusId: string): Blob {
  const stimulus = bundle.stimuli[stimulusId];
  if (!stimulus) fail("voice_experiment_audio_missing");
  return new Blob([new Uint8Array(decodeBase64(stimulus.base64, 1024 * 1024)).buffer], { type: "audio/wav" });
}

export async function parseVoiceExperimentBundle(raw: string): Promise<VoiceExperimentBundle> {
  if (!raw || new TextEncoder().encode(raw).length > MAX_VOICE_STUDIO_BUNDLE_BYTES) fail("voice_experiment_bundle_size_invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { fail("voice_experiment_bundle_json_invalid"); }
  const bundle = record(parsed, "voice_experiment_bundle_invalid");
  if (bundle.contract !== VOICE_STUDIO_BUNDLE_CONTRACT) fail("voice_experiment_bundle_contract_invalid");
  const runId = boundedText(bundle.runId, "voice_experiment_run_invalid", 80);
  if (!SAFE_RUN.test(runId)) fail("voice_experiment_run_invalid");
  const manifest = record(bundle.manifest, "voice_experiment_manifest_invalid");
  const trials = record(bundle.trials, "voice_experiment_trials_invalid");
  const stimuli = record(bundle.stimuli, "voice_experiment_stimuli_invalid");
  if (manifest.contract !== VOICE_MATCHED_PACK_CONTRACT || trials.contract !== VOICE_MATCHED_PACK_CONTRACT
    || manifest.runId !== runId || trials.runId !== runId || manifest.modelMapping !== "sealed"
    || manifest.claim !== "instrument_ready_no_human_quality_result" || !HASH.test(String(manifest.sealedKeySha256 || ""))) {
    fail("voice_experiment_seal_invalid");
  }
  const rawReportKey = record(manifest.reportAttestation, "voice_experiment_report_key_invalid");
  if (rawReportKey.contract !== VOICE_REPORT_ATTESTATION_CONTRACT
    || rawReportKey.algorithm !== VOICE_REPORT_SIGNATURE_ALGORITHM
    || rawReportKey.hash !== VOICE_REPORT_SIGNATURE_HASH
    || rawReportKey.keyId !== rawReportKey.publicKeySha256
    || !HASH.test(String(rawReportKey.keyId || ""))) fail("voice_experiment_report_key_invalid");
  const publicSpki = decodeBase64(rawReportKey.publicKeySpkiBase64, 1024, "voice_experiment_report_key_invalid");
  if (publicSpki.length < 256 || await sha256(publicSpki) !== rawReportKey.publicKeySha256) fail("voice_experiment_report_key_invalid");
  const reportAttestation: VoiceExperimentReportKey = {
    contract: VOICE_REPORT_ATTESTATION_CONTRACT,
    algorithm: VOICE_REPORT_SIGNATURE_ALGORITHM,
    hash: VOICE_REPORT_SIGNATURE_HASH,
    keyId: String(rawReportKey.keyId),
    publicKeySha256: String(rawReportKey.publicKeySha256),
    publicKeySpkiBase64: String(rawReportKey.publicKeySpkiBase64),
  };
  const metadata = JSON.stringify({ manifest, trials }).toLowerCase();
  if (FORBIDDEN_METADATA.some((item) => metadata.includes(item))) fail("voice_experiment_mapping_leak");
  const referenceId = String(trials.referenceId || "");
  if (!OPAQUE_ID.test(referenceId)) fail("voice_experiment_reference_invalid");
  if (!Array.isArray(trials.axes) || trials.axes.length !== AXIS_IDS.length) fail("voice_experiment_axes_invalid");
  const axes = trials.axes.map((rawAxis) => {
    const axis = record(rawAxis, "voice_experiment_axis_invalid");
    if (!AXIS_IDS.includes(axis.id as VoiceExperimentAxisId)) fail("voice_experiment_axis_invalid");
    return {
      id: axis.id as VoiceExperimentAxisId,
      label: boundedText(axis.label, "voice_experiment_axis_invalid", 80),
      low: boundedText(axis.low, "voice_experiment_axis_invalid", 120),
      high: boundedText(axis.high, "voice_experiment_axis_invalid", 120),
    };
  });
  if (new Set(axes.map((axis) => axis.id)).size !== AXIS_IDS.length) fail("voice_experiment_axes_invalid");
  if (!Array.isArray(trials.disclosureOptions) || trials.disclosureOptions.length !== DISCLOSURES.length) fail("voice_experiment_disclosure_invalid");
  const disclosureOptions = trials.disclosureOptions.map((rawOption) => {
    const option = record(rawOption, "voice_experiment_disclosure_invalid");
    if (!DISCLOSURES.includes(option.id as VoiceExperimentDisclosure)) fail("voice_experiment_disclosure_invalid");
    return { id: option.id as VoiceExperimentDisclosure, label: boundedText(option.label, "voice_experiment_disclosure_invalid", 80) };
  });
  if (new Set(disclosureOptions.map((option) => option.id)).size !== DISCLOSURES.length) fail("voice_experiment_disclosure_invalid");
  if (!Array.isArray(trials.sequence) || trials.sequence.length < 3 || trials.sequence.length > 24) fail("voice_experiment_sequence_invalid");
  const sequence = trials.sequence.map((rawTrial) => {
    const trial = record(rawTrial, "voice_experiment_trial_invalid");
    const trialId = String(trial.trialId || "");
    const stimulusId = String(trial.stimulusId || "");
    if (!OPAQUE_ID.test(trialId) || !OPAQUE_ID.test(stimulusId)) fail("voice_experiment_trial_invalid");
    if (trial.kind === "rating") return {
      kind: "rating" as const,
      trialId,
      stimulusId,
      language: boundedText(trial.language, "voice_experiment_trial_invalid", 40),
      langTag: boundedText(trial.langTag, "voice_experiment_trial_invalid", 20),
      promptText: boundedText(trial.promptText, "voice_experiment_trial_invalid", 500),
    };
    if (trial.kind !== "attention" || !Array.isArray(trial.options) || trial.options.length < 2 || trial.options.length > 4) fail("voice_experiment_trial_invalid");
    const options = trial.options.map((rawOption) => {
      const option = record(rawOption, "voice_experiment_trial_invalid");
      return { id: boundedText(option.id, "voice_experiment_trial_invalid", 30), label: boundedText(option.label, "voice_experiment_trial_invalid", 60) };
    });
    if (new Set(options.map((option) => option.id)).size !== options.length) fail("voice_experiment_trial_invalid");
    return { kind: "attention" as const, trialId, stimulusId, options };
  });
  if (new Set(sequence.map((trial) => trial.trialId)).size !== sequence.length) fail("voice_experiment_trial_duplicate");
  const ratingCount = sequence.filter((trial) => trial.kind === "rating").length;
  const attentionCount = sequence.length - ratingCount;
  if (ratingCount !== boundedInt(manifest.ratingTrials, 1, 16, "voice_experiment_manifest_invalid")
    || attentionCount !== boundedInt(manifest.attentionTrials, 1, 4, "voice_experiment_manifest_invalid")
    || boundedInt(manifest.baseStimuli, 1, 16, "voice_experiment_manifest_invalid") +
      boundedInt(manifest.repeatTrials, 0, 4, "voice_experiment_manifest_invalid") !== ratingCount) {
    fail("voice_experiment_manifest_invalid");
  }
  const requiredIds = new Set([referenceId, ...sequence.map((trial) => trial.stimulusId)]);
  if (Object.keys(stimuli).length !== requiredIds.size || Object.keys(stimuli).some((id) => !requiredIds.has(id) || !OPAQUE_ID.test(id))) {
    fail("voice_experiment_stimulus_set_invalid");
  }
  const geometry = new Set<string>();
  const validatedStimuli: VoiceExperimentBundle["stimuli"] = {};
  for (const id of requiredIds) {
    const stimulus = record(stimuli[id], "voice_experiment_audio_invalid");
    const bytes = decodeBase64(stimulus.base64, 1024 * 1024);
    if (stimulus.mime !== "audio/wav" || stimulus.bytes !== bytes.length || !HASH.test(String(stimulus.sha256 || ""))) fail("voice_experiment_audio_invalid");
    if (await sha256(bytes) !== stimulus.sha256) fail("voice_experiment_audio_hash_invalid");
    geometry.add(wavGeometry(bytes));
    validatedStimuli[id] = { mime: "audio/wav", bytes: bytes.length, sha256: String(stimulus.sha256), base64: String(stimulus.base64) };
  }
  if (geometry.size !== 1) fail("voice_experiment_geometry_leak");
  return {
    contract: VOICE_STUDIO_BUNDLE_CONTRACT,
    runId,
    manifest: { ...(manifest as unknown as VoiceExperimentBundle["manifest"]), reportAttestation },
    trials: { contract: VOICE_MATCHED_PACK_CONTRACT, runId, referenceId, axes, disclosureOptions, sequence },
    stimuli: validatedStimuli,
  };
}

export function answerComplete(trial: VoiceExperimentTrial, answer: VoiceExperimentAnswer | undefined): boolean {
  if (!answer) return false;
  if (trial.kind === "attention") return typeof (answer as VoiceExperimentAttentionAnswer).choice === "string"
    && trial.options.some((option) => option.id === (answer as VoiceExperimentAttentionAnswer).choice);
  const rating = answer as VoiceExperimentRatingAnswer;
  return AXIS_IDS.every((id) => Number.isInteger(rating[id]) && Number(rating[id]) >= 1 && Number(rating[id]) <= 5)
    && DISCLOSURES.includes(rating.disclosure as VoiceExperimentDisclosure)
    && Array.from(rating.note || "").length <= 400;
}

export function completedTrialCount(bundle: VoiceExperimentBundle, answers: VoiceExperimentAnswers): number {
  return bundle.trials.sequence.filter((trial) => answerComplete(trial, answers[trial.trialId])).length;
}

export function buildVoiceExperimentSheet(
  bundle: VoiceExperimentBundle,
  answers: VoiceExperimentAnswers,
  startedAt: string,
  lockedAt = "",
): VoiceExperimentSheet {
  const allAnswered = completedTrialCount(bundle, answers) === bundle.trials.sequence.length;
  const complete = allAnswered && Boolean(lockedAt);
  return {
    contract: VOICE_MATCHED_PACK_CONTRACT,
    runId: bundle.runId,
    listener: "owner-studio",
    startedAt,
    finishedAt: complete ? lockedAt : null,
    complete,
    answers,
  };
}

export function parseVoiceExperimentSheet(raw: string, bundle: VoiceExperimentBundle): VoiceExperimentSheet {
  if (!raw || new TextEncoder().encode(raw).length > MAX_VOICE_STUDIO_ANSWER_BYTES) fail("voice_experiment_answers_size_invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { fail("voice_experiment_answers_json_invalid"); }
  const sheet = record(parsed, "voice_experiment_answers_invalid");
  if (sheet.contract !== VOICE_MATCHED_PACK_CONTRACT || sheet.runId !== bundle.runId || sheet.listener !== "owner-studio") fail("voice_experiment_answers_binding_invalid");
  const answers = record(sheet.answers, "voice_experiment_answers_invalid") as VoiceExperimentAnswers;
  for (const trialId of Object.keys(answers)) if (!bundle.trials.sequence.some((trial) => trial.trialId === trialId)) fail("voice_experiment_answer_trial_invalid");
  for (const trial of bundle.trials.sequence) {
    const answer = answers[trial.trialId];
    if (!answer) continue;
    if (trial.kind === "rating") {
      const value = record(answer, "voice_experiment_answer_invalid") as VoiceExperimentRatingAnswer;
      if (Object.keys(value).some((key) => ![...AXIS_IDS, "disclosure", "note"].includes(key))
        || Array.from(value.note || "").length > 400) fail("voice_experiment_answer_invalid");
    } else {
      const value = record(answer, "voice_experiment_answer_invalid");
      if (Object.keys(value).some((key) => key !== "choice")) fail("voice_experiment_answer_invalid");
    }
  }
  const startedAt = boundedText(sheet.startedAt, "voice_experiment_answers_invalid", 40);
  const allAnswered = completedTrialCount(bundle, answers) === bundle.trials.sequence.length;
  if (typeof sheet.complete !== "boolean" || (sheet.complete && !allAnswered)) fail("voice_experiment_answers_invalid");
  if (!sheet.complete && sheet.finishedAt !== null) fail("voice_experiment_answers_invalid");
  const finishedAt = sheet.complete ? boundedText(sheet.finishedAt, "voice_experiment_answers_invalid", 40) : "";
  return buildVoiceExperimentSheet(bundle, answers, startedAt, finishedAt);
}

function optionalMean(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) fail("voice_experiment_result_mean_invalid");
  return value;
}

export async function parseVoiceExperimentResult(raw: string, bundle: VoiceExperimentBundle): Promise<VoiceExperimentResult> {
  if (!raw || new TextEncoder().encode(raw).length > MAX_VOICE_STUDIO_ANSWER_BYTES) fail("voice_experiment_result_size_invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { fail("voice_experiment_result_json_invalid"); }
  const result = record(parsed, "voice_experiment_result_invalid");
  if (result.contract !== VOICE_MATCHED_PACK_CONTRACT || result.runId !== bundle.runId
    || result.sealedKeySha256 !== bundle.manifest.sealedKeySha256 || result.status !== "ratings_locked_mapping_unsealed"
    || result.overallWinner !== null || boundedInt(result.acceptedListeners, 1, 100, "voice_experiment_result_invalid") < 1
    || !Array.isArray(result.cells) || result.cells.length < 1 || result.cells.length > 8) fail("voice_experiment_result_binding_invalid");
  const { attestation: rawAttestation, ...signedBody } = result;
  const attestation = await verifyVoiceExperimentReportAttestation(signedBody, rawAttestation, bundle.manifest.reportAttestation);
  const cells = result.cells.map((rawCell) => {
    const cell = record(rawCell, "voice_experiment_result_cell_invalid");
    if (cell.comparison !== "exact_text_cross_provider" || cell.winnerClaim !== null || !Array.isArray(cell.candidates)
      || cell.candidates.length < 2 || cell.candidates.length > 8) fail("voice_experiment_result_cell_invalid");
    const candidates = cell.candidates.map((rawCandidate) => {
      const candidate = record(rawCandidate, "voice_experiment_result_candidate_invalid");
      const means = record(candidate.means, "voice_experiment_result_mean_invalid");
      const disclosure = record(candidate.disclosure, "voice_experiment_result_disclosure_invalid");
      return {
        armLabel: boundedText(candidate.armLabel, "voice_experiment_result_candidate_invalid", 100),
        model: boundedText(candidate.model, "voice_experiment_result_candidate_invalid", 100),
        modelRevision: boundedText(candidate.modelRevision, "voice_experiment_result_candidate_invalid", 100),
        n: boundedInt(candidate.n, 1, 100, "voice_experiment_result_candidate_invalid"),
        means: Object.fromEntries(AXIS_IDS.map((id) => [id, optionalMean(means[id])])) as Record<VoiceExperimentAxisId, number | null>,
        disclosure: Object.fromEntries(DISCLOSURES.map((id) => [id, boundedInt(disclosure[id], 0, 100, "voice_experiment_result_disclosure_invalid")])) as Record<VoiceExperimentDisclosure, number>,
        descriptiveOverallMean: optionalMean(candidate.descriptiveOverallMean),
      };
    });
    return {
      languageId: boundedText(cell.languageId, "voice_experiment_result_cell_invalid", 20),
      comparison: "exact_text_cross_provider" as const,
      winnerClaim: null,
      winnerReason: boundedText(cell.winnerReason, "voice_experiment_result_cell_invalid", 300),
      candidates,
    };
  });
  return {
    contract: VOICE_MATCHED_PACK_CONTRACT,
    runId: bundle.runId,
    sealedKeySha256: bundle.manifest.sealedKeySha256,
    status: "ratings_locked_mapping_unsealed",
    acceptedListeners: Number(result.acceptedListeners),
    cells,
    overallWinner: null,
    overallWinnerReason: boundedText(result.overallWinnerReason, "voice_experiment_result_invalid", 300),
    attestation,
  };
}

const DB_NAME = "vyakti-private-voice-experiments";
const STORE_NAME = "sealed-bundles";

function openBundleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("voice_experiment_storage_unavailable"));
  });
}

export async function saveVoiceExperimentBundle(replicaId: string, bundle: VoiceExperimentBundle): Promise<void> {
  const db = await openBundleDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(bundle, `${replicaId}:${bundle.runId}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("voice_experiment_storage_failed"));
  });
  db.close();
}

export async function loadVoiceExperimentBundle(replicaId: string, runId: string): Promise<VoiceExperimentBundle | null> {
  const db = await openBundleDb();
  const value = await new Promise<VoiceExperimentBundle | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(`${replicaId}:${runId}`);
    request.onsuccess = () => resolve((request.result as VoiceExperimentBundle | undefined) || null);
    request.onerror = () => reject(request.error || new Error("voice_experiment_storage_failed"));
  });
  db.close();
  return value;
}

export async function deleteVoiceExperimentBundle(replicaId: string, runId: string): Promise<void> {
  const db = await openBundleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(`${replicaId}:${runId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("voice_experiment_storage_failed"));
    });
  } finally { db.close(); }
}
