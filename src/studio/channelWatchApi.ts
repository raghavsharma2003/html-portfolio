// channelWatchApi.ts — fetch wrapper for `/api/channel-watch`, following the
// existing *Api.ts pattern (see channelsApi.ts, teacherSheetApi.ts).
//
// ── the statements are SERVER-AUTHORED, deliberately ──────────────────────
// `ChannelWatchView.statements` comes down from the server on every GET and
// the component renders exactly that list. A consent screen whose text lives
// in the client is a consent screen that can be shortened by whoever ships
// the client, and the shortest version of this one drops the ToS statement,
// which is the single item a teacher most needs to have read.
import { replicaRequest } from "./replicaApi";

export type WatchStatus = "active" | "paused" | "revoked";
export type BackfillState = "idle" | "running" | "done";

export interface ChannelAttestation {
  attestation_id: string;
  channel_url: string;
  provider: string;
  statement_set: string;
  receipt_hash: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  live: boolean;
}

export interface ChannelWatch {
  watch_id: string;
  channel_url: string;
  provider: string;
  status: WatchStatus;
  last_seen_video_id: string;
  last_checked_at: string | null;
  /** PRESENCE, never a value — the server reduces it before it leaves. */
  attested: boolean;
  backfill_state: BackfillState;
  backfill_after_video_id: string;
  oauth_grant: "present" | null;
  created_at: string | null;
}

export interface ChannelWatchView {
  attestations: ChannelAttestation[];
  watches: ChannelWatch[];
  statements: string[];
  statement_set: string;
  /** Whether THIS deploy has an extraction service at all. The UI renders the
   *  back-catalogue offer against this rather than against a guess, so a
   *  teacher is never shown a button that 503s. */
  extraction_available: boolean;
}

export async function loadChannelWatchView(token: string, replicaId: string): Promise<ChannelWatchView> {
  return replicaRequest<ChannelWatchView>(
    token,
    `/api/channel-watch?replica_id=${encodeURIComponent(replicaId)}`,
  );
}

/** Records the ownership attestation. All statements or none — the server
 *  refuses a partial set with 409, and this function does not offer a way to
 *  send one. */
export async function attestChannel(
  token: string,
  replicaId: string,
  channelUrl: string,
  statements: string[],
): Promise<ChannelAttestation> {
  const data = await replicaRequest<{ attestation: ChannelAttestation }>(token, "/api/channel-watch", {
    method: "POST",
    body: JSON.stringify({
      op: "attest",
      replica_id: replicaId,
      channel_url: channelUrl,
      attestations: Object.fromEntries(statements.map((key) => [key, true])),
    }),
  });
  return data.attestation;
}

/** Starts the loop. Fails with `channel_attestation_required` if the channel
 *  was never attested — from a SQL predicate, not from this call. */
export async function startChannelWatch(
  token: string,
  replicaId: string,
  channelUrl: string,
): Promise<ChannelWatch> {
  const data = await replicaRequest<{ watch: ChannelWatch }>(token, "/api/channel-watch", {
    method: "POST",
    body: JSON.stringify({ op: "watch", replica_id: replicaId, channel_url: channelUrl }),
  });
  return data.watch;
}

export async function setWatchStatus(
  token: string,
  replicaId: string,
  watchId: string,
  status: WatchStatus,
): Promise<ChannelWatch> {
  const data = await replicaRequest<{ watch: ChannelWatch }>(token, "/api/channel-watch", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId, watch_id: watchId, status }),
  });
  return data.watch;
}

/** Separate from `setWatchStatus` on purpose: stopping the back-catalogue
 *  import must not also stop noticing new uploads. */
export async function setBackfill(
  token: string,
  replicaId: string,
  watchId: string,
  backfillState: "idle" | "running",
): Promise<ChannelWatch> {
  const data = await replicaRequest<{ watch: ChannelWatch }>(token, "/api/channel-watch", {
    method: "POST",
    body: JSON.stringify({ op: "backfill", replica_id: replicaId, watch_id: watchId, backfill_state: backfillState }),
  });
  return data.watch;
}

export async function revokeAttestation(
  token: string,
  replicaId: string,
  attestationId: string,
): Promise<ChannelAttestation> {
  const data = await replicaRequest<{ attestation: ChannelAttestation }>(token, "/api/channel-watch", {
    method: "POST",
    body: JSON.stringify({ op: "revoke_attestation", replica_id: replicaId, attestation_id: attestationId }),
  });
  return data.attestation;
}
