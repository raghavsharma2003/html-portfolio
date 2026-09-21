// Check-ins — the creator's side. `roomCohortsApi.ts`'s own pattern one file
// over: owns no decision, every rule lives in api/_checkins.js.
import { replicaRequest } from "./replicaApi";

export interface CheckinDesign {
  design_id: string;
  title: string;
  prompt_shape: string;
  cadence_hint: string;
  state: "active" | "paused";
  created_at: string;
  updated_at: string;
}

export class CheckinsApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function post<T>(token: string, body: Record<string, unknown>): Promise<T> {
  return replicaRequest<T>(token, "/api/checkins", { method: "POST", body: JSON.stringify(body) }).catch((e: any) => {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "checkins_failure");
    throw new CheckinsApiError(code, Number(e?.status || 500));
  });
}

export const createCheckinDesign = (
  token: string,
  replicaId: string,
  fields: { title: string; promptShape: string; cadenceHint: string },
) =>
  post<CheckinDesign>(token, {
    op: "design_create",
    replica_id: replicaId,
    title: fields.title,
    prompt_shape: fields.promptShape,
    cadence_hint: fields.cadenceHint,
  });

export const listCheckinDesigns = (token: string, replicaId: string) =>
  post<{ designs: CheckinDesign[] }>(token, { op: "design_list", replica_id: replicaId }).then((r) => r.designs);

export const setCheckinDesignState = (token: string, replicaId: string, designId: string, state: "active" | "paused") =>
  post<CheckinDesign>(token, { op: "design_pause", replica_id: replicaId, design_id: designId, state });
