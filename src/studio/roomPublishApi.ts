// roomPublishApi.ts — fetch wrapper for `/api/room-publish`, the *Api.ts
// pattern (see channelsApi.ts, teacherSheetApi.ts).
import { replicaRequest } from "./replicaApi";

export interface OwnedRoom {
  room_id: string;
  slug: string;
  display_name: string;
  free_monthly_messages: number;
  paid_monthly_messages: number;
  paid_monthly_voice_seconds: number;
  published: boolean;
  paused: boolean;
  published_at: string | null;
  paused_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  // WS-R18. `null` means no ROOM_TELEGRAM_BOT_USERNAME is configured on this
  // deployment — the server's own honest "not connected", never a guessed
  // URL the client assembles itself.
  telegram_deep_link: string | null;
}

export interface RoomBlocker {
  code: string;
  headline: string;
  next: string;
  anchor: string;
}

export interface RoomBlockers {
  waiting_on_you: RoomBlocker[];
  waiting_on_us: RoomBlocker[];
}

export interface RoomState {
  room: OwnedRoom | null;
  reason: string | null;
  can_publish?: boolean;
  blockers?: RoomBlockers;
}

export interface RoomStats {
  followers_total: number;
  followers_active_24h: number;
  messages_this_month: number;
}

/** Thrown by every op below with the server's own code and, when the server
 *  sent one, its blocker detail — `ReplicaApiError`'s own shape, one file
 *  over, so a caller already handling that type handles this one the same
 *  way (401/403 -> re-auth, anything else -> a named reason on screen). */
export class RoomPublishApiError extends Error {
  status: number;
  code: string;
  blockers: RoomBlockers | null;

  constructor(code: string, status: number, blockers: RoomBlockers | null = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.blockers = blockers;
  }
}

async function call<T>(token: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await replicaRequest<T>(token, "/api/room-publish", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "room_publish_failure");
    const blockers = e?.data?.details && e.data.details.waiting_on_you ? (e.data.details as RoomBlockers) : null;
    throw new RoomPublishApiError(code, Number(e?.status || 500), blockers);
  }
}

export async function readOwnedRoom(token: string, replicaId: string): Promise<RoomState | null> {
  try {
    return await replicaRequest<RoomState>(
      token,
      `/api/room-publish?replica_id=${encodeURIComponent(replicaId)}`,
    );
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function createOwnedRoom(token: string, replicaId: string, slug?: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "create", replica_id: replicaId, slug });
  return data.room;
}

export async function renameOwnedRoom(token: string, replicaId: string, slug: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "rename", replica_id: replicaId, slug });
  return data.room;
}

export async function publishOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "publish", replica_id: replicaId });
  return data.room;
}

export async function pauseOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "pause", replica_id: replicaId });
  return data.room;
}

export async function resumeOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "resume", replica_id: replicaId });
  return data.room;
}

export async function setOwnedRoomFreeCap(token: string, replicaId: string, cap: number): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "set_free_cap", replica_id: replicaId, cap });
  return data.room;
}

/** Both paid ceilings in one call — `setOwnedRoomFreeCap`'s own shape. */
export async function setOwnedRoomPaidCeilings(
  token: string,
  replicaId: string,
  messages: number,
  voiceSeconds: number,
): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, {
    op: "set_paid_ceilings",
    replica_id: replicaId,
    messages,
    voice_seconds: voiceSeconds,
  });
  return data.room;
}

export async function readOwnedRoomStats(token: string, replicaId: string): Promise<RoomStats> {
  const data = await call<{ stats: RoomStats }>(token, { op: "stats", replica_id: replicaId });
  return data.stats;
}

/** The follower-facing address. Built from the browser's own origin, so a
 *  preview deployment prints a link to itself rather than a hardcoded
 *  production one nobody previewing it can reach — `channelsApi.ts`'s
 *  `embedSnippet` reasoning, one surface over. */
export function roomLink(slug: string, origin = window.location.origin): string {
  return `${origin}/r/${slug}`;
}
