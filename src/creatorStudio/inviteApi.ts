// inviteApi.ts — the client half of WS-R47's creator-issued invites
// (migration 106, `/api/invites`'s two owner ops). The *Api.ts pattern
// (see funnelApi.ts, roomPublishApi.ts).
//
// This is a REPLICA-independent capability — a creator's invite quota is per
// ACCOUNT, not per Room, the same reason `PayoutsCard` (which this file's
// call sites sit beside) takes only a token, no `replicaId`. The Share tab
// still renders it once, on whichever Room the creator has open, because
// that is where "tell a peer" belongs in the wizard.
import { replicaRequest } from "./replicaApi";

export type CreatorInviteState = "unused" | "redeemed" | "expired";

export interface CreatorInvite {
  invite_id: string;
  issued_to_contact: string;
  state: CreatorInviteState;
  expires_at: string;
  redeemed_at: string | null;
  created_at: string;
}

export interface CreatorInviteQuota {
  max: number;
  used: number;
  remaining: number;
}

export interface MyCreatorInvites {
  invites: CreatorInvite[];
  quota: CreatorInviteQuota;
}

/** The one moment a raw code exists on this client — held in memory only,
 *  never written to any storage, and gone the moment the tab or component
 *  that received it is. There is no "show it again" op, by construction
 *  (086's own law, restated by 106): the server has never stored anything
 *  but this code's hash. */
export interface IssuedCreatorInvite {
  invite: CreatorInvite;
  code: string;
}

export async function myCreatorInvites(token: string): Promise<MyCreatorInvites> {
  return replicaRequest<MyCreatorInvites>(token, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ op: "mine_list" }),
  });
}

export async function issueMyCreatorInvite(token: string, contact?: string): Promise<IssuedCreatorInvite> {
  return replicaRequest<IssuedCreatorInvite>(token, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ op: "mine_issue", contact: contact || undefined }),
  });
}
