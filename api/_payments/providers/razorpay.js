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
async function ensurePlan(priceInr, secrets) {
  const r = await fetch(`${API}/plans`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(secrets.keyId, secrets.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      period: "monthly",
      interval: 1,
      item: { name: `Vyakti Room ${priceInr} INR/month`, amount: priceInr * 100, currency: "INR" },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_plan_failed"), { code: "payments_provider_plan_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  if (!body?.id) throw Object.assign(new Error("payments_provider_plan_failed"), { code: "payments_provider_plan_failed", status: 502 });
  return body.id;
}

/**
 * Create a subscription. `input`: { priceInr, roomSlug, followerId }.
 * `secrets`: { keyId, keySecret } from the channel-secret backend seam.
 * Returns { provider_subscription_ref, checkout_url, status }.
 */
export async function createSubscription(input, secrets) {
  if (!secrets?.keyId || !secrets?.keySecret) {
    throw Object.assign(new Error("payments_provider_credentials_missing"), { code: "payments_provider_credentials_missing", status: 503 });
  }
  const planId = await ensurePlan(input.priceInr, secrets);
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
      notes: { room_slug: String(input.roomSlug || ""), follower_id: String(input.followerId || "") },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw Object.assign(new Error("payments_provider_subscription_failed"), { code: "payments_provider_subscription_failed", status: 502 });
  const body = await r.json().catch(() => ({}));
  if (!body?.id) throw Object.assign(new Error("payments_provider_subscription_failed"), { code: "payments_provider_subscription_failed", status: 502 });
  return { provider_subscription_ref: body.id, checkout_url: body.short_url || null, status: body.status || "created" };
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
