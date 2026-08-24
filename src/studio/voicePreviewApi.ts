import { ReplicaApiError } from "./replicaApi";

export interface VoicePreviewInput {
  replicaId: string;
  genomeVersion: number;
  text: string;
  languageId: "en" | "hi";
  styleKey: "faithful" | "balanced" | "expressive";
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

export async function saveVoicePreference(token: string, input: {
  replicaId: string;
  leftGenerationId: string;
  rightGenerationId: string;
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
