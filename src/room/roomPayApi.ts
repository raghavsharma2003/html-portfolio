// The Room's money, follower side. src/room/roomApi.ts's own *Api.ts
// pattern, one endpoint over (/api/room-pay rather than /api/room) because
// api/room-pay.js is its own thin handler over api/_payments.js - a
// different decision module gets a different wire, docs/SURFACES.md's own
// rule for why api/room.js and api/_room.js never merged.
//
// Owns NO decision. `startSubscription` turns "subscribe" into a POST and an
// error code into a typed error; every honest state (no provider configured,
// price not set, mandate pending, active) is rendered from what the server
// actually said, never guessed at here.

export class RoomPayApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface RoomSubscriptionState {
  subscription_id: string;
  provider: string;
  state: "created" | "authenticated" | "active" | "paused" | "cancelled" | "expired";
  current_period_start?: string | null;
  current_period_end?: string | null;
  // WS-R37: set once the follower asks the provider to stop at the end of
  // this period - distinct from `state`, which keeps meaning only what the
  // provider has confirmed, so this flag is what the panel reads to say
  // "will not renew" while access itself keeps working until period_end.
  cancel_at_period_end?: boolean;
}

export interface RoomSubscribeResult {
  subscription_id: string;
  provider: string;
  provider_subscription_ref: string;
  checkout_url: string | null;
  state: RoomSubscriptionState["state"];
}

export interface RoomPaymentStatus {
  tier: "free" | "paid";
  // WS-R37: the room's CURRENT price, null when the creator has never set
  // one - the same honest-null `api/_payments.js`'s `getRoomPrice` already
  // returns, restated on this response so the subscription panel can state
  // "renews on X for Y" without a second endpoint.
  price_inr: number | null;
  currency: string | null;
  subscription: RoomSubscriptionState | null;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/room-pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RoomPayApiError(String(data?.error || `room_pay_request_failed_${response.status}`), response.status);
  }
  return data as T;
}

export const startSubscription = (session: string) =>
  post<RoomSubscribeResult>({ op: "subscribe", session });

export const paymentStatus = (session: string) =>
  post<RoomPaymentStatus>({ op: "status", session });

// WS-R37. "Cancel is a first-class op": the provider is told to stop at the
// end of the CURRENT period, never immediately - the returned row's own
// `cancel_at_period_end` is what the panel reads back to confirm it, never
// a client-side guess about what the click did.
export const cancelSubscription = (session: string) =>
  post<{ subscription: RoomSubscriptionState }>({ op: "cancel", session });
