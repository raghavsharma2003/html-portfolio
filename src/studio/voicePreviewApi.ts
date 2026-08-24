import { ReplicaApiError } from "./replicaApi";

export interface VoicePreviewInput {
  replicaId: string;
  genomeVersion: number;
  text: string;
  languageId: "en" | "hi";
  styleKey?: "faithful" | "balanced" | "expressive";
  trialId?: string;
  trialSide?: "left" | "right";
}

export interface VoicePreviewResult {
  audio: Blob;
  generationId: string;
  disclosure: string;
  modelCommitment: string;
}

export type VoicePreferenceChoice = "left" | "right" | "tie" | "neither";
export type VoicePreferenceReason = "identity" | "accent" | "rhythm" | "emotion" | "naturalness" | "pronunciation" | "noise_or_artifact";
export interface VoicePreferenceResult {
  preference_id: string;
  choice: VoicePreferenceChoice;
  reason_codes: VoicePreferenceReason[];
  confidence: number;
  created_at: string;
  left_style_key: string;
  right_style_key: string;
}

export interface VoiceTrialResult {
  trial_id: string;
  algorithm: string;
  prompt_deck_version: string;
  expires_at: string;
  prompt: { key: string; domain: string; text: string };
  progress: {
    completed: number;
    covered_conditions: number;
    total_conditions: number;
    unique_prompts: number;
    required_prompts: number;
    converged: boolean;
  };
}

export interface VoiceDeliveryPolicy {
  policy_id: string;
  version: number;
  language_id: "en" | "hi";
  status: "draft" | "qualifying" | "qualified" | "approved" | "rejected" | "retired";
  champion_key: string;
  comparisons: number;
  prompt_families: number;
  latent_margin: number;
  source_set_hash: string;
  created_at: string;
}

export interface VoiceDeliveryStatus {
  replica_id: string;
  genome_version: number;
  language_id: "en" | "hi";
  readiness: { ready: boolean; completed: number; covered_conditions: number; total_conditions: number; unique_prompts: number; required_prompts: number };
  policies: VoiceDeliveryPolicy[];
}

export async function generateVoicePreview(token: string, input: VoicePreviewInput): Promise<VoicePreviewResult> {
  const response = await fetch("/api/replica-voice-preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      replica_id: input.replicaId,
      genome_version: input.genomeVersion,
      text: input.text,
      language_id: input.languageId,
      style_key: input.styleKey,
      trial_id: input.trialId,
      trial_side: input.trialSide,
    }),
    signal: AbortSignal.timeout(290_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const raw = typeof data?.error === "string" ? data.error : `preview failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  const audio = await response.blob();
  if (audio.type !== "audio/wav" || audio.size < 45) throw new Error("Protected preview audio was invalid");
  const generationId = response.headers.get("x-vyakti-generation") || "";
  const disclosure = response.headers.get("x-vyakti-disclosure") || "";
  const modelCommitment = response.headers.get("x-vyakti-model-commitment") || "";
  if (!generationId || disclosure !== "audible-prefix-v1" || !/^[0-9a-f]{64}$/.test(modelCommitment)) {
    throw new Error("Protected preview receipt was incomplete");
  }
  return { audio, generationId, disclosure, modelCommitment };
}

export async function issueVoiceTrial(token: string, input: {
  replicaId: string;
  genomeVersion: number;
  languageId: "en" | "hi";
}): Promise<VoiceTrialResult> {
  const response = await fetch("/api/replica-voice-trial", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      replica_id: input.replicaId,
      genome_version: input.genomeVersion,
      language_id: input.languageId,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string" ? data.error : `trial failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  const trial = data?.trial as VoiceTrialResult | undefined;
  const promptLength = Array.from(String(trial?.prompt?.text || "")).length;
  if (!trial || !/^[0-9a-f-]{36}$/i.test(String(trial.trial_id || "")) ||
      trial.algorithm !== "voice-curriculum/bt-active-v2" ||
      trial.prompt_deck_version !== "voice-calibration-deck/v1" ||
      !/^[a-z0-9_.:-]{3,96}$/.test(String(trial.prompt?.key || "")) ||
      !/^[a-z_]{3,32}$/.test(String(trial.prompt?.domain || "")) || promptLength < 1 || promptLength > 600) {
    throw new Error("Voice calibration assignment was invalid");
  }
  return trial;
}

export async function saveVoicePreference(token: string, input: {
  replicaId: string;
  leftGenerationId: string;
  rightGenerationId: string;
  trialId: string;
  choice: VoicePreferenceChoice;
  reasonCodes: VoicePreferenceReason[];
  confidence?: number;
}): Promise<VoicePreferenceResult> {
  const response = await fetch("/api/replica-voice-preference", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      replica_id: input.replicaId,
      left_generation_id: input.leftGenerationId,
      right_generation_id: input.rightGenerationId,
      trial_id: input.trialId,
      choice: input.choice,
      reason_codes: input.reasonCodes,
      confidence: input.confidence ?? 1,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string" ? data.error : `preference failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return data.preference as VoicePreferenceResult;
}

export async function getVoiceDeliveryStatus(token: string, input: {
  replicaId: string;
  genomeVersion: number;
  languageId: "en" | "hi";
}): Promise<VoiceDeliveryStatus> {
  const query = new URLSearchParams({
    replica_id: input.replicaId,
    genome_version: String(input.genomeVersion),
    language_id: input.languageId,
  });
  const response = await fetch(`/api/replica-voice-delivery-policy?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string" ? data.error : `delivery status failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return data.voice_delivery as VoiceDeliveryStatus;
}

export async function buildVoiceDeliveryPolicy(token: string, input: {
  replicaId: string;
  genomeVersion: number;
  languageId: "en" | "hi";
}): Promise<VoiceDeliveryPolicy> {
  const response = await fetch("/api/replica-voice-delivery-policy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      op: "build",
      replica_id: input.replicaId,
      genome_version: input.genomeVersion,
      language_id: input.languageId,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string" ? data.error : `delivery build failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return data.policy as VoiceDeliveryPolicy;
}
