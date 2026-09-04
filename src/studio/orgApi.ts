// Suites v0 - the creator's side (WS-R28). `checkinsApi.ts`'s own pattern:
// owns no decision, every rule lives in api/_org.js.
import { replicaRequest } from "./replicaApi";

export interface Suite {
  org_id: string;
  name: string;
  slug: string;
  plan: "starter" | "institute";
  seat_limit: number;
  created_at: string;
}

export interface MySuite extends Suite {
  role: "admin" | "creator";
  seats_used: number;
  /** WS-R33: the coalesced cap - an active subscription's own seats, 0 once
   *  one has lapsed, or `seat_limit` when none was ever started. What the
   *  attach predicate actually enforces; never the same as `seat_limit`
   *  once a subscription exists. */
  seats_paid: number;
}

export interface SuiteSubscription {
  subscription_id: string;
  plan: "starter" | "institute";
  seats: number;
  price_per_seat_inr: number;
  currency: string;
  state: "created" | "authenticated" | "active" | "paused" | "cancelled" | "expired";
  provider: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface SuiteMember {
  owner_user_id: string;
  role: "admin" | "creator";
  added_at: string;
}

export interface SuiteRoomOverview {
  room_id: string;
  slug: string;
  display_name: string;
  published: boolean;
  followers_total: number;
  followers_paid: number;
  joined_last_7d: number;
  messages_last_24h: number;
  at_cap_this_month: number;
  revenue_this_month_inr: number;
}

export interface SuiteBoard {
  generated_at: string;
  org: Suite;
  seats_used: number;
  seats_free: number;
  rooms: SuiteRoomOverview[];
}

export interface SuiteRoomStatus {
  org_id: string;
  name: string;
  slug: string;
}

export class OrgApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function post<T>(token: string, body: Record<string, unknown>): Promise<T> {
  return replicaRequest<T>(token, "/api/org", { method: "POST", body: JSON.stringify(body) }).catch((e: any) => {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "org_failure");
    throw new OrgApiError(code, Number(e?.status || 500));
  });
}

export const createSuite = (token: string, fields: { name: string; plan?: "starter" | "institute"; seatLimit?: number }) =>
  post<{ org: Suite }>(token, { op: "create", name: fields.name, plan: fields.plan, seat_limit: fields.seatLimit }).then((r) => r.org);

export const inviteToSuite = (token: string, orgId: string) =>
  post<{ invite: Suite & { instructions: string } }>(token, { op: "invite", org_id: orgId }).then((r) => r.invite);

export const acceptSuiteInvite = (token: string, orgId: string) =>
  post<{ membership: { org_id: string; owner_user_id: string; role: string; added_at: string } }>(token, { op: "accept", org_id: orgId })
    .then((r) => r.membership);

export const attachRoomToSuite = (token: string, orgId: string, roomId: string) =>
  post<{ room: { room_id: string; org_id: string; slug: string } }>(token, { op: "attach_room", org_id: orgId, room_id: roomId }).then((r) => r.room);

export const detachRoomFromSuite = (token: string, roomId: string) =>
  post<{ room: { room_id: string; org_id: null } }>(token, { op: "detach_room", room_id: roomId }).then((r) => r.room);

export const listMySuites = (token: string) =>
  post<{ orgs: MySuite[] }>(token, { op: "list_mine" }).then((r) => r.orgs);

export const suiteBoard = (token: string, orgId: string) =>
  post<{ board: SuiteBoard }>(token, { op: "board", org_id: orgId }).then((r) => r.board);

export const suiteMembers = (token: string, orgId: string) =>
  post<{ members: SuiteMember[] }>(token, { op: "members", org_id: orgId }).then((r) => r.members);

export const roomSuite = (token: string, replicaId: string) =>
  post<{ org: SuiteRoomStatus | null }>(token, { op: "room_status", replica_id: replicaId }).then((r) => r.org);

export const suiteSubscription = (token: string, orgId: string) =>
  post<{ org_id: string; subscription: SuiteSubscription | null }>(token, { op: "subscription", org_id: orgId }).then((r) => r.subscription);

export const startSuiteSubscription = (token: string, orgId: string, plan: "starter" | "institute", seats: number) =>
  post<{ subscription: SuiteSubscription }>(token, { op: "start_subscription", org_id: orgId, plan, seats }).then((r) => r.subscription);

export const updateSuiteSeats = (token: string, orgId: string, seats: number) =>
  post<{ subscription: SuiteSubscription }>(token, { op: "update_seats", org_id: orgId, seats }).then((r) => r.subscription);
