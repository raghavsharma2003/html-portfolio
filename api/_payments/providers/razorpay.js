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
 * quantity, prorating the current cycle on their side - NOT VERIFIED, named
 * rather than implied per this file's own header: no fresh doc fetch was
 * performed for this endpoint in this session (unlike every endpoint above,
 * each pinned with the date it was read), and nothing here has ever made a
 * real request. Shaped from the same PATCH-a-running-subscription convention
 * `cancelSubscription` above already uses for `/cancel`.
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

export async function cancelSubscription(providerSubscriptionRef, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const r = await fetch(`${API}/subscriptions/${encodeURIComponent(providerSubscriptionRef)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cancel_at_cycle_end: 0 }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_cancel_failed"), { code: "payments_provider_cancel_failed", status: 502 });
  return { ok: true };
}

/**
 * Verify a fund account reference (WS-R36). RazorpayX is a SEPARATE product
 * from the Subscriptions API every function above talks to - it is the
 * payouts side of the same Razorpay account, with its own Fund Accounts and
 * Payouts APIs. NOT VERIFIED, named per this file's own header: no fresh doc
 * fetch was performed for the exact response shape below, unlike every
 * dated endpoint above it, and nothing here has ever made a real request.
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
 * Send a payout (WS-R36). RazorpayX Payouts API, NOT VERIFIED per this
 * file's own header (no fresh doc fetch performed this session):
 *   POST https://api.razorpay.com/v1/payouts
 *     { account_number, fund_account_id, amount (paise), currency: "INR",
 *       mode: "IMPS", purpose: "payout", queue_if_low_balance: true,
 *       reference_id }
 *     -> { id: "pout_...", status: "queued" | "processing" | ... }
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
      reference_id: String(input.ref || ""),
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
