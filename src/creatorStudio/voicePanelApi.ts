// Client for POST /api/voice-preview — the "Preview my voice" panel.
//
// Separate from voicePreviewApi.ts on purpose: that one talks to the
// calibration lab, whose contract is "audio or an error". This endpoint has a
// third answer — WARMING — because the GPU runtime behind it scales to zero
// and can take about 2-5 minutes to come back (docs/gurukul/AZURE-DEPLOY-STATE.md
// §8). A client that models only two outcomes has to render the third as one
// of them, and both choices are lies: a spinner that never ends, or an error
// for something that is not broken.
import { ReplicaApiError } from "./replicaApi";

export interface VoicePanelReady {
  kind: "ready";
  audio: Blob;
  generationId: string;
  modelCommitment: string;
  textPlanSha256: string;
  transformationCount: number;
  spokenText: string;
}

export interface VoicePanelWarming {
  kind: "warming";
  stage: string;
  message: string;
  etaSecondsLow: number;
  etaSecondsHigh: number;
  retryAfterMs: number;
}

export type VoicePanelOutcome = VoicePanelReady | VoicePanelWarming;

export interface VoicePanelStatus {
  state: "warm" | "warming" | "cold";
  retryAfterMs: number;
  etaSecondsLow: number;
  etaSecondsHigh: number;
}

function warmingFrom(data: any): VoicePanelWarming {
  return {
    kind: "warming",
    stage: typeof data?.stage === "string" ? data.stage : "runtime_cold",
    message: typeof data?.message === "string" && data.message
      ? data.message
      : "Your voice runtime is starting up. This takes about 2 to 5 minutes from cold.",
    etaSecondsLow: Number(data?.eta_seconds_low) || 120,
    etaSecondsHigh: Number(data?.eta_seconds_high) || 300,
    retryAfterMs: Number(data?.retry_after_ms) || 30_000,
  };
}

export async function requestVoicePanelPreview(token: string, input: {
  replicaId: string;
  genomeVersion: number;
  text: string;
  languageId: "en" | "hi";
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
    }),
    // The server answers a cold start in about 12 seconds and the warm path in
    // under 10. 90 s is generous headroom, not a cold-start budget — nothing
    // here waits out a 161 s GPU boot on an open connection any more.
    signal: AbortSignal.timeout(90_000),
  });

  if (response.status === 202) {
    return warmingFrom(await response.json().catch(() => ({})));
  }
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
  const textPlanSha256 = response.headers.get("x-vyakti-text-plan") || "";
  const transformationCount = Number(response.headers.get("x-vyakti-text-transformations") || "0");
  let spokenText = "";
  try { spokenText = decodeURIComponent(response.headers.get("x-vyakti-spoken-text") || ""); }
  catch { throw new Error("Protected preview text plan was invalid"); }
  // The disclosure header is checked rather than displayed-and-trusted: a clip
  // that arrived without the audible-prefix scheme is not a clip this panel
  // will play, whatever the server said about it.
  if (!generationId || disclosure !== "audible-prefix-v1" || !/^[0-9a-f]{64}$/.test(modelCommitment) ||
      !/^[0-9a-f]{64}$/.test(textPlanSha256) || !Number.isInteger(transformationCount) ||
      transformationCount < 0 || !spokenText) {
    throw new Error("Protected preview receipt was incomplete");
  }
  return { kind: "ready", audio, generationId, modelCommitment, textPlanSha256, transformationCount, spokenText };
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
    etaSecondsHigh: Number(data?.eta_seconds_high) || 300,
  };
}
