// paymentsApi.ts - fetch wrapper for /api/payments, roomPublishApi.ts's own
// pattern, one file over.
import { replicaRequest } from "./replicaApi";

export interface RoomPrice {
  room_id: string;
  follower_price_inr: number;
  currency: string;
  platform_take_bp: number;
  updated_at: string | null;
}

/** WS-R36. The closed payout state machine: built -> pending_account | queued
 *  -> sent -> settled | failed. */
export type PayoutState = "built" | "pending_account" | "queued" | "sent" | "settled" | "failed";

export interface RoomPayout {
  payout_id: string;
  period_start: string;
  period_end: string;
  gross_inr: number;
  take_inr: number;
  net_inr: number;
  tds_inr: number;
  state: PayoutState;
}

/** WS-R36. `payoutStatements` list entry - the owner's own list, real rows
 *  only. */
export interface PayoutListEntry {
  payout_id: string;
  period_start: string;
  period_end: string;
  gross_inr: number;
  net_inr: number;
  state: PayoutState;
  created_at: string;
}

/** WS-R36. `payoutStatement` - the four numbers, the period, the follower
 *  subscription count, the Suite line, and the TDS disclosure sentence.
 *  Nothing per follower. */
export interface PayoutStatement {
  payout_id: string;
  period_start: string;
  period_end: string;
  currency: "INR";
  /** WS-R138. The Room(s) this payout is for - a follower charge landed
   *  in-period, or the Room currently sits in a Suite with an active
   *  subscription. Never a follower or a person. */
  rooms: Array<{ room_id: string; slug: string; display_name: string }>;
  gross_inr: number;
  take_inr: number;
  tds_inr: number;
  net_inr: number;
  suite_share_inr: number;
  suite_name: string | null;
  /** WS-R138. The free months this owner's own referral program funded
   *  this period - `reconcilePeriod`'s own platform-wide line, scoped to
   *  one owner. */
  referral_rewards: { count: number; forgone_inr: number };
  follower_subscriptions: number;
  state: PayoutState;
  provider_payout_ref: string | null;
  created_at: string;
  /** WS-R56, migration 111: when the payout status webhook moved this
   *  payout to `settled`, or (on `failed`) what the provider gave as the
   *  reason. Both null until the webhook (or `retryFailedPayout`) fires. */
  settled_at: string | null;
  failure_reason: string | null;
  tds_note: string;
}

/** WS-R36. The provider's own reference to a creator's bank account - never
 *  the bank detail itself. */
export interface PayoutAccount {
  owner_user_id: string;
  provider: string;
  fund_account_ref: string;
  verified_at: string | null;
}

export interface RoomRevenue {
  subscribers: number;
  churned_this_month: number;
  gross_this_month_inr: number;
  platform_take_this_month_inr: number;
  creator_share_this_month_inr: number;
  latest_payout: RoomPayout | null;
}

/** WS-R33. "covered_by_suite" | "free" | a plan name ("room" | "studio"). */
export interface CreatorTierStatus {
  tier: "covered_by_suite" | "free" | "room" | "studio";
  covered_by_suite: boolean;
  subscription: {
    subscription_id: string;
    plan: "room" | "studio";
    price_inr: number;
    currency: string;
    state: "created" | "authenticated" | "active" | "paused" | "cancelled" | "expired";
    // WS-R125 (migration 130): the bank-side mandate's own last word,
    // 'none' until a mandate-lifecycle webhook has ever touched it. `state`
    // above still collapses `subscription.paused` and `.halted` to the SAME
    // 'paused' value (api/_payments.js's `pausedOrHalted` header) - this is
    // what tells them apart for the studio card, api/_creator-tier.js's own
    // `clientCreatorSubscription`.
    mandate_state: "none" | "pending" | "active" | "paused" | "halted" | "cancelled" | "completed";
    provider: string;
    current_period_start: string | null;
    current_period_end: string | null;
    // WS-R37: distinct from `state` - see api/_renewals.js's own header.
    cancel_at_period_end: boolean;
  } | null;
}

export class PaymentsApiError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(token: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await replicaRequest<T>(token, "/api/payments", { method: "POST", body: JSON.stringify(body) });
  } catch (e: any) {
    throw new PaymentsApiError(typeof e?.data?.error === "string" ? e.data.error : (e?.message || "payments_failure"), Number(e?.status || 500));
  }
}

export async function readRoomPayments(
  token: string,
  replicaId: string,
): Promise<{ price: RoomPrice | null; revenue: RoomRevenue; creator_tier: CreatorTierStatus } | null> {
  try {
    return await replicaRequest<{ price: RoomPrice | null; revenue: RoomRevenue; creator_tier: CreatorTierStatus }>(
      token,
      `/api/payments?replica_id=${encodeURIComponent(replicaId)}`,
    );
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function setRoomPriceInr(token: string, replicaId: string, priceInr: number): Promise<RoomPrice> {
  const data = await call<{ price: RoomPrice }>(token, { op: "set_price", replica_id: replicaId, price_inr: priceInr });
  return data.price;
}

export async function startCreatorTierSubscription(
  token: string,
  replicaId: string,
  plan: "room" | "studio",
): Promise<CreatorTierStatus["subscription"]> {
  const data = await call<{ subscription: NonNullable<CreatorTierStatus["subscription"]> }>(token, {
    op: "start_creator_subscription",
    replica_id: replicaId,
    plan,
  });
  return data.subscription;
}

/** WS-R36. Every payout for this owner, newest period first. */
export async function listPayoutStatements(token: string): Promise<PayoutListEntry[]> {
  const data = await call<{ payouts: PayoutListEntry[] }>(token, { op: "payout_statements" });
  return data.payouts;
}

/** WS-R36. One statement, the shape the download controls build the JSON and
 *  plain-text files from. */
export async function readPayoutStatement(token: string, payoutId: string): Promise<PayoutStatement> {
  const data = await call<{ statement: PayoutStatement }>(token, { op: "payout_statement", payout_id: payoutId });
  return data.statement;
}

/** WS-R138. The printable statement - `roomApi.ts`'s own
 *  `fetchRoomExportReadableHtml` shape (WS-R108), restated for this door:
 *  the server's `format: "html"` response is the printable page itself,
 *  `text/html`, never a JSON envelope `replicaRequest`/`call` above could
 *  parse, so this is the one function in this file that calls `fetch`
 *  directly and reads `response.text()`. `locale` is the studio's own
 *  current UI language - the server falls back to English on anything else,
 *  `buildPayoutStatementReadableHtml`'s own fallback. */
export async function fetchPayoutStatementReadableHtml(
  token: string,
  payoutId: string,
  locale: "en" | "hi",
): Promise<string> {
  const response = await fetch("/api/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: "payout_statement", payout_id: payoutId, format: "html", locale }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = `payments_request_failed_${response.status}`;
    try { code = String(JSON.parse(text)?.error || code); } catch { /* the error response is JSON; a non-JSON body here is unexpected but must not throw a parse error over a network error */ }
    throw new PaymentsApiError(code, response.status);
  }
  return text;
}

/** WS-R36. Register (really: verify and store) a fund account reference the
 *  owner brought back from the provider's own onboarding flow - never a bank
 *  detail typed into this platform's own form. */
export async function registerPayoutFundAccount(token: string, fundAccountRef: string): Promise<PayoutAccount> {
  const data = await call<{ account: PayoutAccount }>(token, { op: "register_fund_account", fund_account_ref: fundAccountRef });
  return data.account;
}

// WS-R37. Cancel at period end - the provider is told to stop at the end of
// the CURRENT cycle, never immediately; the returned row's own
// `cancel_at_period_end` is what the card reads back, never a client-side
// guess about what the click did.
export async function cancelCreatorTierSubscription(
  token: string,
  replicaId: string,
): Promise<CreatorTierStatus["subscription"]> {
  const data = await call<{ subscription: NonNullable<CreatorTierStatus["subscription"]> }>(token, {
    op: "cancel_creator_subscription",
    replica_id: replicaId,
  });
  return data.subscription;
}
