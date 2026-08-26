// channelsApi.ts — fetch wrapper for `/api/clone-channel`, following the
// existing *Api.ts pattern (see teacherSheetApi.ts, personModelApi.ts).
//
// ── the credential is write-only, on both sides of the wire ───────────────
// `connect()` is the only function here that ever holds one, and it holds it
// for the length of one request. Nothing in this module stores it, retries
// with it, or puts it in a state hook that a React devtools pane can read: the
// caller passes the string straight through and clears its own input. What
// comes back is `credential: "present" | null` and never a value — the server
// reduces it before it leaves (api/_clonechannel.js's `clientChannel`).
import { replicaRequest } from "./replicaApi";

/** Mirrors migration 055's `kind` domain. `instagram_dm` is deliberately NOT
 *  here: it is storable and not connectable, and the honest record of why is
 *  docs/gurukul/INSTAGRAM-DM-GAP.md. */
export type ChannelKind = "web_widget" | "web_embed" | "telegram" | "whatsapp";

export type ChannelStatus = "draft" | "connected" | "paused" | "revoked";

export interface CloneChannel {
  channel_id: string;
  kind: ChannelKind;
  external_ref: string;
  status: ChannelStatus;
  /** PRESENCE, never a value. See the header. */
  credential: "present" | null;
  connectable: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export async function listChannels(token: string, replicaId: string): Promise<CloneChannel[]> {
  const data = await replicaRequest<{ channels: CloneChannel[] }>(
    token,
    `/api/clone-channel?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return Array.isArray(data.channels) ? data.channels : [];
}

/** Bind an address with no credential. Web kinds connect on this alone; a
 *  third-party kind stays DRAFT until `connect()` supplies one, which is the
 *  same rule migration 055 enforces as a CHECK. */
export async function saveChannel(
  token: string,
  replicaId: string,
  kind: ChannelKind,
  externalRef: string,
): Promise<CloneChannel> {
  const data = await replicaRequest<{ channel: CloneChannel }>(token, "/api/clone-channel", {
    method: "POST",
    body: JSON.stringify({ op: "save", replica_id: replicaId, kind, external_ref: externalRef }),
  });
  return data.channel;
}

export async function connectChannel(
  token: string,
  replicaId: string,
  kind: ChannelKind,
  externalRef: string,
  credential: string,
): Promise<CloneChannel> {
  const data = await replicaRequest<{ channel: CloneChannel }>(token, "/api/clone-channel", {
    method: "POST",
    body: JSON.stringify({
      op: "connect",
      replica_id: replicaId,
      kind,
      external_ref: externalRef,
      credential,
    }),
  });
  return data.channel;
}

export async function setChannelStatus(
  token: string,
  replicaId: string,
  channelId: string,
  status: "connected" | "paused" | "revoked",
): Promise<CloneChannel> {
  const data = await replicaRequest<{ channel: CloneChannel }>(token, "/api/clone-channel", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId, channel_id: channelId, status }),
  });
  return data.channel;
}

/** The copy-paste line. Built from the browser's own origin so a teacher
 *  copying it out of a preview deployment gets that deployment's URL rather
 *  than a hardcoded production one they cannot reach yet. */
export function embedSnippet(slug: string, origin = window.location.origin): string {
  return `<script src="${origin}/embed.js" data-clone="${slug}" defer></script>`;
}
