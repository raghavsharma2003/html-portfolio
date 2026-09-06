// Client for POST /api/voice-preview — the "Preview my voice" panel.
//
// Separate from voicePreviewApi.ts on purpose: that one talks to the
// calibration lab, whose contract is "audio or an error". This endpoint has a
// third answer — WARMING — because the GPU runtime behind it scales to zero
// and can take about 2-8 minutes to come back (docs/gurukul/AZURE-DEPLOY-STATE.md
// §8). A client that models only two outcomes has to render the third as one
// of them, and both choices are lies: a spinner that never ends, or an error
// for something that is not broken.
import { ReplicaApiError } from "./replicaApi";

export interface VoicePanelReady {
  kind: "ready";
  audio: Blob;
  intentId: string;
  reused: boolean;
  generationId: string;
  modelCommitment: string;
  textPlanSha256: string;
  transformationCount: number;
  spokenText: string;
}

export interface VoicePanelPending {
  kind: "pending";
  state: "warming" | "processing";
  phase: string;
  stage: string;
  message: string;
  intentId: string;
  generationId: string | null;
  attempt: number;
  reused: boolean;
  startedAt: string;
  updatedAt: string;
  etaSecondsLow: number;
  etaSecondsHigh: number;
  retryAfterMs: number;
}

export interface VoicePanelFailed {
  kind: "failed";
  errorCode: string;
  intentId: string;
  generationId: string | null;
  attempt: number;
  startedAt: string;
  updatedAt: string;
}

export type VoicePanelOutcome = VoicePanelReady | VoicePanelPending | VoicePanelFailed;

export interface VoicePanelStatus {
  state: "warm" | "warming" | "cold";
  retryAfterMs: number;
  etaSecondsLow: number;
  etaSecondsHigh: number;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function serverTime(value: unknown): string {
  if (typeof value !== "string") return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function pendingFrom(data: any): VoicePanelPending {
  const state = data?.state === "processing" ? "processing" : "warming";
  const stage = typeof data?.stage === "string" && data.stage
    ? data.stage
    : typeof data?.phase === "string" && data.phase
      ? data.phase
      : state === "processing" ? "synthesizing" : "runtime_cold";
  const startedAt = serverTime(data?.started_at);
  return {
    kind: "pending",
    state,
    phase: typeof data?.phase === "string" && data.phase ? data.phase : stage,
    stage,
    message: typeof data?.message === "string" && data.message
      ? data.message
      : state === "processing"
        ? "Your protected preview is being generated."
        : "Your voice runtime is starting up. This takes about 2 to 8 minutes from cold.",
    intentId: typeof data?.intent_id === "string" ? data.intent_id : "",
    generationId: typeof data?.generation_id === "string" ? data.generation_id : null,
    attempt: nonNegativeInteger(data?.attempt),
    reused: data?.reused === true,
    startedAt,
    updatedAt: serverTime(data?.updated_at ?? startedAt),
    etaSecondsLow: positiveNumber(data?.eta_seconds_low, 120),
    etaSecondsHigh: positiveNumber(data?.eta_seconds_high, 480),
    retryAfterMs: positiveNumber(data?.retry_after_ms, 30_000),
  };
}

export async function requestVoicePanelPreview(token: string, input: {
  replicaId: string;
  genomeVersion: number;
  text: string;
  languageId: "en" | "hi";
  /** Omit for the ordinary semantic intent. A UUID means the owner explicitly
   *  asked for another take, and must be reused unchanged by every poll. */
  regenerationKey?: string;
}): Promise<VoicePanelOutcome> {
  const response = await fetch("/api/voice-preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      op: "preview",
      replica_id: input.replicaId,
      genome_version: input.genomeVersion,
      text: input.text,
      language_id: input.languageId,
      ...(input.regenerationKey ? { regeneration_key: input.regenerationKey } : {}),
    }),
    // The server answers a cold start in about 12 seconds and the warm path in
    // under 10. 90 s is generous headroom, not a cold-start budget — nothing
    // here waits out a 161 s GPU boot on an open connection any more.
    signal: AbortSignal.timeout(90_000),
  });

  if (response.status === 202) {
    return pendingFrom(await response.json().catch(() => ({})));
  }
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    if (data?.state === "error" && typeof data?.intent_id === "string" && data.intent_id) {
      return {
        kind: "failed",
        errorCode: typeof data?.error === "string" && data.error ? data.error : "voice_preview_intent_failed",
        intentId: data.intent_id,
        generationId: typeof data?.generation_id === "string" ? data.generation_id : null,
        attempt: nonNegativeInteger(data?.attempt),
        startedAt: serverTime(data?.started_at),
        updatedAt: serverTime(data?.updated_at),
      };
    }
    const raw = typeof data?.error === "string" ? data.error : "preview conflict";
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const raw = typeof data?.error === "string" ? data.error : `preview failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }

  const audio = await response.blob();
  if (audio.type !== "audio/wav" || audio.size < 45) throw new Error("Protected preview audio was invalid");
  const generationId = response.headers.get("x-vyakti-generation") || "";
  const intentId = response.headers.get("x-vyakti-preview-intent") || generationId;
  const reused = response.headers.get("x-vyakti-preview-reused") === "true";
  const disclosure = response.headers.get("x-vyakti-disclosure") || "";
  const modelCommitment = response.headers.get("x-vyakti-model-commitment") || "";
  const textPlanSha256 = response.headers.get("x-vyakti-text-plan") || "";
  const transformationCount = Number(response.headers.get("x-vyakti-text-transformations") || "0");
  let spokenText = "";
  try { spokenText = decodeURIComponent(response.headers.get("x-vyakti-spoken-text") || ""); }
  catch { throw new Error("Protected preview text plan was invalid"); }
  // The disclosure header is checked rather than displayed-and-trusted: a clip
  // that arrived without the audible-prefix scheme is not a clip this panel
  // will play, whatever the server said about it.
  if (!generationId || !intentId || disclosure !== "audible-prefix-v1" || !/^[0-9a-f]{64}$/.test(modelCommitment) ||
      !/^[0-9a-f]{64}$/.test(textPlanSha256) || !Number.isInteger(transformationCount) ||
      transformationCount < 0 || !spokenText) {
    throw new Error("Protected preview receipt was incomplete");
  }
  return { kind: "ready", audio, intentId, reused, generationId, modelCommitment, textPlanSha256, transformationCount, spokenText };
}

export async function getVoicePanelStatus(token: string): Promise<VoicePanelStatus> {
  const response = await fetch("/api/voice-preview", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ op: "status" }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string" ? data.error : `voice status failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  const state = data?.state === "warm" || data?.state === "warming" ? data.state : "cold";
  return {
    state,
    retryAfterMs: Number(data?.retry_after_ms) || 0,
    etaSecondsLow: Number(data?.eta_seconds_low) || 120,
    etaSecondsHigh: Number(data?.eta_seconds_high) || 480,
  };
}
