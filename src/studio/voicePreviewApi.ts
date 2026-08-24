import { ReplicaApiError } from "./replicaApi";

export interface VoicePreviewInput {
  replicaId: string;
  genomeVersion: number;
  text: string;
  languageId: "en" | "hi";
  style: { exaggeration: number; cfgWeight: number; temperature: number };
}

export interface VoicePreviewResult {
  audio: Blob;
  generationId: string;
  disclosure: string;
  modelCommitment: string;
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
      style: {
        exaggeration: input.style.exaggeration,
        cfg_weight: input.style.cfgWeight,
        temperature: input.style.temperature,
      },
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
