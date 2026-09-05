import type { Replica, ReplicaErasureStatus } from "./types";

export class ReplicaApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function replicaRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: init?.signal || AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = typeof data?.error === "string"
      ? data.error
      : typeof data?.source?.rejection_code === "string" && data.source.rejection_code
        ? `Source rejected: ${data.source.rejection_code}`
        : `request failed (${response.status})`;
    throw new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
  }
  return data as T;
}

export async function listReplicas(token: string): Promise<Replica[]> {
  const data = await replicaRequest<{ replicas: Replica[] }>(token, "/api/replica");
  return Array.isArray(data.replicas) ? data.replicas : [];
}

export async function readReplica(token: string, id: string): Promise<Replica> {
  const data = await replicaRequest<{ replica: Replica }>(
    token,
    `/api/replica?replica_id=${encodeURIComponent(id)}`,
  );
  return data.replica;
}

/**
 * `inviteCode` is optional and only ever matters the first time an account
 * creates a workspace under `INVITES_REQUIRED=1` — the server predicate
 * (WS-R23, migration 086) is what actually decides, and an account that
 * already owns a workspace is admitted with no code at all. Omitted entirely
 * rather than sent as an empty string, so a build with invites off never puts
 * an `invite_code` key on the wire.
 */
export async function createReplica(token: string, displayName: string, inviteCode?: string): Promise<Replica> {
  const data = await replicaRequest<{ replica: Replica }>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({
      op: "create",
      display_name: displayName,
      ...(inviteCode ? { invite_code: inviteCode } : {}),
    }),
  });
  return data.replica;
}

export async function revokeReplica(
  token: string,
  id: string,
): Promise<{ replica: Replica; erasure: string; erasure_request_id: string }> {
  return replicaRequest<{ replica: Replica; erasure: string; erasure_request_id: string }>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "revoke", replica_id: id }),
  });
}

/**
 * WS-R52 (migration 112). The studio's own chrome language, set through the
 * same owner-scoped op family as `revokeReplica`/`createReplica` above --
 * never a second endpoint. `api/_replica.js`'s `setOwnedReplicaLocale`
 * refuses an unrecognised value by name (`studio_locale_invalid`), so a
 * caller passing anything outside `STUDIO_LOCALES` sees a `ReplicaApiError`
 * rather than a silent no-op.
 */
export async function setReplicaLocale(token: string, id: string, locale: "en" | "hi"): Promise<Replica> {
  const data = await replicaRequest<{ replica: Replica }>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "set_locale", replica_id: id, locale }),
  });
  return data.replica;
}

/**
 * WS-R70. The creator's own export — every owner-lane table
 * `api/_creator-export.js`'s `OWNER_LANE_TABLES` names, as one JSON
 * document. No `replica_id` in the body: `ownerUserId` on the server side
 * comes only from the bearer token (`requireUser(req)`), so this call can
 * only ever return the CALLER's own data. A longer timeout than
 * `replicaRequest`'s own 20s default — a real export walks dozens of
 * tables — is passed explicitly rather than widening the shared default,
 * which every other, cheaper op on this door would then also wait on.
 */
export async function exportReplicaData(token: string): Promise<Record<string, unknown>> {
  return replicaRequest<Record<string, unknown>>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "export" }),
    signal: AbortSignal.timeout(45_000),
  });
}

export async function readErasureStatus(token: string, requestId: string): Promise<ReplicaErasureStatus> {
  const data = await replicaRequest<{ erasure: ReplicaErasureStatus }>(token, "/api/replica", {
    method: "POST",
    body: JSON.stringify({ op: "erasure_status", erasure_request_id: requestId }),
  });
  return data.erasure;
}
