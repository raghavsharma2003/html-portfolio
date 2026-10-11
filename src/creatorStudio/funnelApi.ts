// funnelApi.ts - the client half of the two studio-only funnel marks
// (WS-R25, `/api/replica` op `funnel_mark`). Every other funnel step is read
// live from a table that already knows it, server-side, with no client API
// at all; this file exists only for the two moments no table knows.
//
// FIRE-AND-FORGET: a failed mark must never block or surface an error on the
// actual wizard/publish flow it is timing, so every call site wraps this in
// `.catch(() => {})` rather than awaiting a result the user would see.
import { replicaRequest } from "./replicaApi";

export type FunnelMarkStep = "studio_opened" | "publish_clicked";

export async function markFunnelStep(token: string, replicaId: string, step: FunnelMarkStep): Promise<void> {
  await replicaRequest(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "funnel_mark", replica_id: replicaId, step }),
  });
}
