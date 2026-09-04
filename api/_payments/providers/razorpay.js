// The Razorpay provider (WS-R11) - one of two twins behind api/_payments.js's
// seam (see fake.js, its offline sibling, and api/_channel-secrets.js's
// header for the posture both copy: the default backend REFUSES, and that is
// the feature).
//
// ── NOT VERIFIED, NAMED RATHER THAN IMPLIED ────────────────────────────────
// No Razorpay account exists in this environment. Nothing below has ever made
// a real HTTP request or received a real webhook. What is proven offline
// (evals/payments/run.mjs) is the SHAPE of every request this file would
// send, the signature algorithm against locally-generated HMACs, and every
// caller in api/_payments.js treating this module exactly like fake.js -
// never a round trip, api/_channel-secrets.js's own words for its Key Vault
// backend, restated here for the identical reason.
//
// ── ENDPOINTS, PINNED WITH THE DATE THEY WERE READ (2026-09-03) ───────────
// Razorpay Subscriptions API, docs.razorpay.com, fetched 2026-09-03:
//   POST https://api.razorpay.com/v1/plans
//     { period: "monthly", interval: 1, item: { name, amount (paise), currency: "INR" } }
//     -> { id: "plan_...", ... }  (a plan is reused across subscriptions at
//     the same price; api/_payments.js keys one plan per exact rupee amount
//     in the 299-599 band rather than one per room, so two creators who both
//     charge 399 share a plan the way two rooms with the same free cap would
//     share nothing today but could)
//   POST https://api.razorpay.com/v1/subscriptions
//     { plan_id, customer_notify: 1, total_count, quantity: 1, notes: {...} }
//     -> { id: "sub_...", status: "created", short_url: "https://rzp.io/i/..." }
//     UPI Autopay collects the mandate at this short_url (or the Checkout
//     modal, out of scope here - this file only ever needs the id and the
//     url, never the browser-facing flow). RBI's Digital Payments E-mandate
//     Framework, 2026 (effective 2026-04-21, per the framework's own text,
//     read 2026-09-03): recurring debits up to Rs 15,000 per transaction need
//     no additional-factor authentication once the mandate itself is
//     AFA-registered. Every Room price in the 299-599 band is two orders of
//     magnitude under that ceiling, so one AFA at signup covers every future
//     month's auto-charge - noted here because it is WHY a monthly UPI
//     Autopay mandate is the right primitive for this product's price band
//     rather than a per-message wallet debit.
//   GET  https://api.razorpay.com/v1/subscriptions/:id
//   POST https://api.razorpay.com/v1/subscriptions/:id/cancel
//     { cancel_at_cycle_end: 0 }
//   Subscription states (Subscriptions States, fetched 2026-09-03): created ->
//   authenticated (the customer completed the mandate) -> active (the billing
//   cycle starts); pending/halted are the provider's own retry ladder for a
//   failed auto-charge and fold back to active on a successful retry or a
//   fresh mandate, never becoming a state vy_room_subscription itself holds -
//   api/_payments.js's applyProviderEvent maps both to 'active' with no
//   period change, deliberately narrower than the provider's own five extra
//   states. cancelled is terminal. completed (end_date reached) and expired
//   (mandate never authenticated by start_at) both map to this table's
//   'cancelled' - api/_room-surface.js's cap predicate only ever asks
//   `tier <> 'free'`, so a fifth terminal spelling would be a distinction the
//   product never reads.
// Webhooks (Subscriptions Webhook Events, fetched 2026-09-03):
//   subscription.authenticated, subscription.activated, subscription.charged,
//   subscription.completed, subscription.cancelled, subscription.paused,
//   subscription.resumed, subscription.pending, subscription.halted, and the
//   payment-level payment.failed. All ten are the exhaustive `kind` CHECK on
//   vy_payment_event (migration 078) - an event this platform did not ask for
//   can never become a row.
// Signature (Webhooks / Validate and test, fetched 2026-09-03): header
//   `X-Razorpay-Signature`, HMAC-SHA256 over the RAW request body (never a
//   re-serialization - api/discord.js's own rule for its Ed25519 signature,
//   restated here for HMAC) with the webhook secret as the key.
import { createHmac, timingSafeEqual } from "node:crypto";

export const name = "razorpay";

const API = "https://api.razorpay.com/v1";

function basicAuthHeader(keyId, keySecret) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;
}

/** One plan per exact rupee amount, created lazily and reused - Razorpay has
 *  no "create a subscription with an inline amount" call, only plan-then-
 *  subscribe. Never called from an offline eval; PAYMENTS_PROVIDER=fake takes
 *  that lane instead. */
async function ensurePlan(priceInr, label, secrets) {
  const r = await fetch(`${API}/plans`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: { name: `Vyakti ${label} ${priceInr} INR/month`, amount: priceInr * 100, currency: "INR" },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_plan_failed"), { code: "payments_provider_plan_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  if (!body?.id) throw Object.assign(new Error("payments_provider_plan_failed"), { code: "payments_provider_plan_failed", status: 502 });
  return body.id;
}

/**
 * Create a subscription. `input`: { priceInr, label, ref } - WS-R33's own
 * generalisation of the original `{priceInr, roomSlug, followerId}` shape
 * (see fake.js's own header): `label` names what this subscription is FOR
 * (a Room's slug, a Suite's slug, a creator tier's plan name), `ref` names
 * WHO it is for (a follower id, an org id, a replica id). `secrets`:
 * { keyId, keySecret } from the channel-secret backend seam. Returns
 * { provider_subscription_ref, checkout_url, status }.
 */
export async function createSubscription(input, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const planId = await ensurePlan(input.priceInr, String(input.label || "subscription"), secrets);
  const r = await fetch(`${API}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan_id: planId,
      customer_notify: 1,
      total_count: 120, // ten years of monthly cycles; Razorpay requires a
      // count and this provider's own contract is "unlimited within fair
      // use", so the ceiling is a long one rather than a real limit
      quantity: 1,
      notes: { label: String(input.label || ""), ref: String(input.ref || "") },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_subscription_failed"), { code: "payments_provider_subscription_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  if (!body?.id) throw Object.assign(new Error("payments_provider_subscription_failed"), { code: "payments_provider_subscription_failed", status: 502 });
  return { provider_subscription_ref: body.id, checkout_url: body.short_url || null, status: body.status || "created" };
}

/**
 * Change a subscription's seat quantity - the Suite lane's own operation
 * (WS-R33). `PATCH /v1/subscriptions/:id` accepting `{quantity}` is
 * Razorpay's documented way to change a running subscription's billed
 * quantity, prorating the current cycle on their side - STILL NOT VERIFIED
 * (WS-R41, 2026-09-04): a fresh doc fetch WAS attempted this session and did
 * not settle it. razorpay.com/docs/api/payments/subscriptions/ (the page
 * this file's other endpoints above are pinned against) is a small,
 * standalone "Plans Entity" reference page, not the operations page its own
 * URL shape suggests - every fragment (#update-a-subscription,
 * #update-subscription, #change-subscription-quantity) and every guessed
 * sibling path (razorpay.com/docs/api/payments/subscriptions/update,
 * razorpay.com/docs/us/api/payments/subscriptions) returned either that same
 * Plans Entity content or a 404, never an "Update a Subscription" operation
 * page. So the PATCH method, the `quantity`/`schedule_change_at` field names,
 * and the proration behaviour remain shaped from convention
 * (`cancelSubscription`'s own `/cancel` precedent one function up), never
 * confirmed against Razorpay's own text. Settled by whoever can reach the
 * actual operations page (the docs site is a client-routed SPA this
 * session's fetch tool could not deep-link into), or a sandbox PATCH call.
 */
export async function updateSubscriptionQuantity(providerSubscriptionRef, quantity, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const r = await fetch(`${API}/subscriptions/${encodeURIComponent(providerSubscriptionRef)}`, {
    method: "PATCH",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ quantity: Number(quantity), schedule_change_at: "now" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_seat_update_failed"), { code: "payments_provider_seat_update_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  return { ok: true, quantity: Number(body?.quantity ?? quantity) };
}

/**
 * `opts.atCycleEnd` (WS-R37) - widened from the original single-argument
 * shape, which always sent `cancel_at_cycle_end: 0` (cancel now). No caller
 * of this function exists anywhere in this tree yet (confirmed by grep
 * before this change), so `opts = {}` defaulting to `atCycleEnd: false`
 * reproduces the exact request body this function has always sent; the only
 * new behaviour is what a caller who passes `{atCycleEnd: true}` gets. The
 * Rooms plan's own law here (this workstream's brief, law 5) needs the
 * cycle-end form: "the Room or seat keeps working until period_end."
 */
export async function cancelSubscription(providerSubscriptionRef, opts = {}, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const r = await fetch(`${API}/subscriptions/${encodeURIComponent(providerSubscriptionRef)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cancel_at_cycle_end: opts.atCycleEnd ? 1 : 0 }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_cancel_failed"), { code: "payments_provider_cancel_failed", status: 502 });
  return { ok: true, cancel_at_cycle_end: Boolean(opts.atCycleEnd) };
}

/**
 * Verify a fund account reference (WS-R36). RazorpayX is a SEPARATE product
 * from the Subscriptions API every function above talks to - it is the
 * payouts side of the same Razorpay account, with its own Fund Accounts and
 * Payouts APIs. PARTIALLY VERIFIED (WS-R41, 2026-09-04): the RESPONSE SHAPE
 * below is confirmed against razorpay.com/docs/api/x/fund-accounts/, fetched
 * 2026-09-04 - its own Fund Accounts Entity sample JSON is
 * `{"id":"fa_...","contact_id":"cont_...","account_type":<a bank/VPA enum>,
 * "active":true,...}`, matching the shape this function expects field for
 * field (the account_type value itself is one more field this file never
 * inspects - it verifies `active`, nothing else, per its own header's "this
 * platform NEVER sends a bank account number or a UPI VPA"). NOT settled by that fetch: the exact operation page for "fetch a
 * fund account by id" (only the entity/schema page was reachable, the same
 * SPA-routing limit `updateSubscriptionQuantity`'s own comment names above),
 * so the `GET .../fund_accounts/:id` method+path is still convention, not a
 * quoted sentence.
 *   GET https://api.razorpay.com/v1/fund_accounts/:id
 *     -> { id, contact_id, account_type, active: boolean, ... }
 * This platform NEVER sends a bank account number or a UPI VPA to mint a
 * fund account - the id it verifies here is the only thing it is ever handed,
 * after the creator's own bank-detail exchange happened entirely on
 * Razorpay's side (a hosted onboarding link, out of scope for this file).
 */
export async function registerFundAccount(fundAccountRef, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const r = await fetch(`${API}/fund_accounts/${encodeURIComponent(fundAccountRef)}`, {
    method: "GET",
    headers: { Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret) },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) return { verified: false };
  const body = await r.json().catch(() => ({}));
  return { verified: body?.active === true };
}

/**
 * Send a payout (WS-R36). RazorpayX Payouts API, PARTIALLY VERIFIED
 * (WS-R41, 2026-09-04) against razorpay.com/docs/api/x/payouts/, fetched
 * 2026-09-04, whose own Payouts Entity sample JSON and field table confirm,
 * field for field:
 *   - `fund_account_id`, `amount` ("The payout amount, in paise"; min 100),
 *     `currency` ("INR"), `reference_id` ("max 40 characters") all match
 *     this function's request exactly.
 *   - `mode`: "the modes through which the payout is processed... NEFT,
 *     RTGS, or IMPS" - `"IMPS"` is a documented value.
 *   - `purpose`: the doc's own default classifications list is "refund",
 *     "cashback", **"payout"**, "salary", "utility bill", "vendor bill" -
 *     `"payout"` is a documented value, not an invented one.
 *   - `status_details.reason` includes `"low_balance"`, which is the
 *     documented consequence of `queue_if_low_balance: true` rather than an
 *     assumed one.
 *   POST https://api.razorpay.com/v1/payouts
 *     { account_number, fund_account_id, amount (paise), currency: "INR",
 *       mode: "IMPS", purpose: "payout", queue_if_low_balance: true,
 *       reference_id }
 *     -> { id: "pout_...", status: "queued" | "processing" | ... }
 * NOT settled by that fetch: the same SPA-routing limit named on the two
 * functions above means the exact operation page (method + path +
 * request-parameter table, as opposed to the response/entity page this
 * fetch actually reached) was never reached, so `POST /v1/payouts` and the
 * REQUEST field name `account_number` (the entity page shows only the
 * RESPONSE field `debit_account_number` for the same concept, never a
 * request-parameter table) stay convention, not a quoted sentence.
 * `account_number` is the PLATFORM's own RazorpayX current account number
 * (`secrets.accountNumber`, read from the same channel-secret blob as
 * `keyId`/`keySecret` - never a creator's own account, which this file never
 * receives at all, only a `fund_account_id` reference to it).
 */
export async function sendPayout(input, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  if (!secrets?.accountNumber) {
    throw Object.assign(new Error("payments_provider_account_number_missing"), { code: "payments_provider_account_number_missing", status: 503 });
  }
  const r = await fetch(`${API}/payouts`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_number: secrets.accountNumber,
      fund_account_id: input.fundAccountRef,
      amount: Math.round(Number(input.amountInr || 0)) * 100,
      currency: "INR",
      mode: "IMPS",
      purpose: "payout",
      queue_if_low_balance: true,
      // FINDING (WS-R41, fixed): razorpay.com/docs/api/x/payouts/, fetched
      // 2026-09-04: "reference_id... max 40 characters". Unbounded before -
      // `input.ref` today is always a uuid (36 chars) and would have passed
      // by luck, but nothing enforced the documented ceiling.
      reference_id: String(input.ref || "").slice(0, 40),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_payout_failed"), { code: "payments_provider_payout_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  if (!body?.id) throw Object.assign(new Error("payments_provider_payout_failed"), { code: "payments_provider_payout_failed", status: 502 });
  return { provider_payout_ref: body.id, status: body.status || "queued" };
}

/**
 * HMAC-SHA256 over the RAW body, constant-time compared. `rawBody` must be
 * the untouched bytes Razorpay signed - see api/payments-webhook.js's
 * `bodyParser: false`, api/discord.js's own rule for why a re-serialization
 * can never be used here.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || typeof signatureHeader !== "string" || !/^[0-9a-f]{64}$/i.test(signatureHeader)) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHeader.toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── WS-R60 verification addendum (2026-09-04) ──────────────────────────────
//
// Appended rather than edited in place, deliberately: WS-R56 is building the
// RazorpayX payout status webhook against these same shapes at the same time
// (this workstream's own brief, law 3), and an append-only diff to this file
// is the one shape of edit that merges with theirs mechanically, with no hunk
// overlap regardless of where in the file their work lands. The comments
// ABOVE this line (`updateSubscriptionQuantity`, `registerFundAccount`,
// `sendPayout`) still say "STILL NOT VERIFIED" / "PARTIALLY VERIFIED" from
// WS-R41 — that is now STALE, corrected here rather than there, and whoever
// next touches those functions directly should fold this addendum into their
// own header and delete this block rather than let two competing notes about
// the same function drift apart.
//
// ── updateSubscriptionQuantity: now VERIFIED (was: not verified) ──────────
// razorpay.com/docs/api/payments/subscriptions/update-subscription/, fetched
// 2026-09-04 (found by web search for the operation's own title rather than
// by guessing a URL slug — the exact fix WS-R41's own rejected.md entry named
// as untried): "PATCH https://api.razorpay.com/v1/subscriptions/{id}", curl
// example quoted verbatim: "curl -u <YOUR_KEY>:<YOUR_SECRET> -X PATCH
// https://api.razorpay.com/v1/subscriptions/sub_00000000000001". The request
// table names `quantity` (integer), `schedule_change_at` (`now` | `cycle_end`,
// described as "When the update applies"), plus `plan_id`, `offer_id`,
// `remaining_count`, `start_at`, `customer_notify` this file never sends. The
// function's existing `{quantity, schedule_change_at: "now"}` body matches
// exactly — no code change needed, only the mark.
//
// ── registerFundAccount: now fully VERIFIED (was: partially) ──────────────
// razorpay.com/docs/us/api/x/fund-accounts/fetch-with-id/, fetched
// 2026-09-04: "GET https://api.razorpay.com/v1/fund_accounts/{id}", curl
// example quoted verbatim: "curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] -X GET
// https://api.razorpay.com/v1/fund_accounts/fa_00000000000001" -> a full
// response sample including `"active": false`. The method+path WS-R41 could
// not reach (only the response/entity page was reachable then) is now
// confirmed too, alongside the response shape WS-R41 already had. No code
// change — this function's GET-by-id was already correct.
//
// ── sendPayout: now fully VERIFIED (was: partially) ────────────────────────
// razorpay.com/docs/api/x/payouts/create/bank-account/, fetched 2026-09-04:
// "POST https://api.razorpay.com/v1/payouts", request table naming
// `account_number` (string, required — "The account from which you want to
// make the payout... Not your contact's bank account number", confirming
// this is the PLATFORM's own account exactly as this function's existing
// comment already argued from convention), `fund_account_id`, `amount`
// (paise, min 100), `currency`, `mode` (`NEFT`|`RTGS`|`IMPS`), `purpose`
// (`refund`|`cashback`|`payout`|`salary`|`utility bill`|`vendor bill`),
// `queue_if_low_balance` (boolean, optional), `reference_id` (string,
// optional, "maximum 40 characters" — WS-R41's own fix already truncates to
// this), `narration` (string, optional, max 30 chars, this file never sends
// one). The REQUEST field name `account_number` — previously only convention,
// since WS-R41 could reach only the RESPONSE field `debit_account_number` for
// the same concept — is now confirmed as the actual request parameter name.
// No code change — this function's body was already correct.
//
// ── RazorpayX payout webhooks: event names, payload and signature ─────────
// (WS-R56's own seam — logged here, not built here; this file adds no
// webhook HANDLER, only the citations the handler needs).
//
// Event names — d6xcmfyh68wv8.cloudfront.net/docs/x/webhooks/, fetched
// 2026-09-04 (razorpay.com's own domain 404s on this exact path for a direct
// GET, the same SPA-routing failure mode WS-R41's rejected.md entry named;
// this is Razorpay's own CDN serving the identical pre-rendered content at
// the identical path — a third fetch path beyond the two the rejection
// named, not a different provider): the exhaustive list is `payout.pending`,
// `payout.rejected`, `payout.queued`, `payout.initiated`, `payout.processed`,
// `payout.updated`, `payout.reversed`, `payout.failed`. Quoted verbatim:
// "It is mandatory to subscribe to the payout.failed event if you are using
// RazorpayX APIs." `payout.processed` and `payout.reversed` are terminal:
// "Any webhook received after these should be ignored." This matches the
// three named in this workstream's brief (`payout.processed`, `payout.failed`,
// `payout.reversed`) exactly, plus five more WS-R56 may or may not need.
//
// Payload shape — d6xcmfyh68wv8.cloudfront.net/docs/webhooks/payloads/x/,
// fetched 2026-09-04, full JSON samples quoted for all three named events:
// the envelope is `{entity:"event", account_id, event, contains:["payout"],
// payload:{payout:{entity:{...}}}, created_at}` — ONE LEVEL DEEPER than the
// Subscriptions webhook envelope this file's own header already documents
// (`payload.subscription.entity` there; `payload.payout.entity` here, same
// shape of nesting, different key). The inner `payout.entity` object carries
// `id`, `entity:"payout"`, `fund_account_id`, `amount`, `currency`, `notes`,
// `fees`, `tax`, `status` (`processed`|`failed`|`reversed`, matching the
// `event` suffix), `purpose`, `utr`, `mode`, `reference_id`, `narration`,
// `batch_id`, `status_details:{description, source, reason}` (three
// distinct machine-readable reason codes were seen across the samples
// fetched, describing a payout going through, the beneficiary's account
// having been closed, and the beneficiary's bank being temporarily
// unreachable — spelled out here in plain English rather than their
// literal reason-code spelling, since evals/payouts/run.mjs's own
// negative control (WS-R36, this file's §3) scans this whole source file
// for a forbidden substring naming that account concept and must never
// find it, on the correct theory that this file must never even NAME
// such a field, let alone send one), `created_at`, `fee_type`.
//
// Signature — same cloudfront mirror, `/docs/x/webhooks/`, fetched
// 2026-09-04, quoted verbatim: "The hash signature is calculated using HMAC
// with SHA256 algorithm, your webhook secret set as the key and the webhook
// request body as the message" under the `X-Razorpay-Signature` header —
// confirmed the SAME mechanism as the Subscriptions webhook this file's
// `verifyWebhookSignature` already implements (no RazorpayX-specific
// variant), so WS-R56's payout webhook door can and should call this exact
// function rather than write a second HMAC implementation, per this file's
// own header rule for why one algorithm gets one implementation.
//
// See context/measurements.md#ws-r60-open-provider-marks-2026-09-04 for the
// full mark table and context/rejected.md for the two fetch paths WS-R41
// found closed and the two more this pass tried instead.
