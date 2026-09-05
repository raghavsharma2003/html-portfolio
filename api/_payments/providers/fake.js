// The fake provider (WS-R11, widened WS-R33) - the offline twin of
// razorpay.js, same interface, same signature ALGORITHM (HMAC-SHA256 over
// the raw body), zero network. Selected by `PAYMENTS_PROVIDER=fake`; used by
// evals/payments/run.mjs and evals/org-billing/run.mjs to drive
// api/_payments.js's real code with no live account, and safe to run against
// a staging deployment for the same reason api/_channel-secrets.js's
// backends exist as named alternatives rather than a single hardcoded vendor.
//
// `input` is a GENERIC subscription-for-anything shape: `{priceInr, label,
// ref}`. `label` names what this subscription is FOR (a Room's own slug, a
// Suite's own slug, a creator tier's plan name) and `ref` names WHO it is
// for (a follower id, an org id, a replica id) - WS-R33's own widening of
// WS-R11's original `{priceInr, roomSlug, followerId}` shape, one seam for
// every lane rather than a second provider client per lane (the workstream
// brief's own law 1).
//
// Deterministic on purpose: the same (label, ref, priceInr) always mints the
// same reference, so a retried "subscribe" request during a flaky network is
// idempotent at the PROVIDER layer too, not only at api/_payments.js's own
// database layer.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const name = "fake";

/** WS-R73's own in-memory twin state: which payment method a given fake
 *  subscription ref was authorised with. Real Razorpay Checkout is where a
 *  customer actually picks card, UPI Autopay or Emandate - a step this
 *  platform's own `createSubscription` never sees (razorpay.js's own WS-R69
 *  addendum, finding 1) - so the fake twin cannot derive a method from its
 *  own deterministic ref the way it derives the ref itself. Defaults to
 *  `'card'` when nothing was ever set: every eval written before this
 *  workstream calls `updateOrgSeats` expecting the provider update to
 *  succeed, and `'card'` is the one method that update was ever built to
 *  reach - see `setFakeSubscriptionMethod` below for how a test asks for
 *  the other two. */
const FAKE_SUBSCRIPTION_METHODS = new Map();

export async function createSubscription(input) {
  const seed = `${input.label || ""}:${input.ref || ""}:${input.priceInr || 0}`;
  const ref = `fake_sub_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  return { provider_subscription_ref: ref, checkout_url: `https://fake-provider.invalid/pay/${ref}`, status: "created" };
}

/**
 * Read back a subscription's own payment method (WS-R73) - the fake twin of
 * razorpay.js's own `getSubscription`, which reads the SAME field off a real
 * `GET /v1/subscriptions/:id` response. `api/_payments.js`'s `updateOrgSeats`
 * calls this BEFORE `updateSubscriptionQuantity` below, exactly the order the
 * real provider forces (a UPI or Emandate subscription refuses the PATCH
 * outright, so asking first is the only way to give a named refusal instead
 * of a raw provider error).
 */
export async function getSubscription(providerSubscriptionRef) {
  return { payment_method: FAKE_SUBSCRIPTION_METHODS.get(String(providerSubscriptionRef)) || "card" };
}

/**
 * Test-only (WS-R73): make a fake subscription ref report a specific payment
 * method the next time `getSubscription` reads it - `signWebhookForTest`'s
 * own precedent one function down for what "test-only" means in this file.
 * Never called from `api/_payments.js` itself.
 */
export function setFakeSubscriptionMethod(providerSubscriptionRef, method) {
  FAKE_SUBSCRIPTION_METHODS.set(String(providerSubscriptionRef), String(method));
}

/** `opts.atCycleEnd` (WS-R37) - default false is byte-identical to this
 *  function's original, single-argument behaviour (no prior caller exists
 *  anywhere in this tree, confirmed by grep before this widening), so this
 *  is a pure addition rather than a behaviour change for anything already
 *  shipped. `secrets` is accepted, and ignored, only so the fake and real
 *  twins share one call shape at every call site (`updateSubscriptionQuantity`'s
 *  own precedent one function up). */
export async function cancelSubscription(_providerSubscriptionRef, opts = {}, _secrets) {
  return { ok: true, cancel_at_cycle_end: Boolean(opts.atCycleEnd) };
}

/** WS-R73: a plain counter, incremented on every real call, so an eval can
 *  prove a refusal happened BEFORE the provider was ever reached rather than
 *  merely that the local database was not written - `evals/org-billing`'s own
 *  §3 comment ("the fake provider never exposes a call counter of its own")
 *  named exactly this gap; this is the first caller that needs the provider
 *  itself to refuse a request UPI/Emandate would refuse, so the counter is
 *  the only way to prove the PATCH itself never fired. */
let updateSubscriptionQuantityCalls = 0;

/** Change a subscription's seat quantity - the Suite lane's own operation,
 *  WS-R33: "adding a seat is a subscription update through the seam,
 *  prorated by the provider, never by us." No proration happens in the fake
 *  twin (nothing to prorate against, offline) - it exists to prove the CALL
 *  SHAPE and the caller's own handling of the response, `cancelSubscription`'s
 *  own scope one function up. */
export async function updateSubscriptionQuantity(_providerSubscriptionRef, quantity) {
  updateSubscriptionQuantityCalls += 1;
  return { ok: true, quantity: Number(quantity) };
}

/** Test-only (WS-R73): read and reset the counter above - never called from
 *  `api/_payments.js` itself, `setFakeSubscriptionMethod`'s own precedent for
 *  what "test-only" means in this file. */
export function updateSubscriptionQuantityCallCountForTest() {
  return updateSubscriptionQuantityCalls;
}
export function resetUpdateSubscriptionQuantityCallCountForTest() {
  updateSubscriptionQuantityCalls = 0;
}

/** Byte-identical algorithm to razorpay.js's, so a suite proving "a bad
 *  signature is refused" here proves the same code path the real provider
 *  would exercise, not a separate weaker copy of it. */
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

/**
 * Verify a fund account reference (WS-R36). Deterministic: any non-empty ref
 * verifies, the same "just works" posture `createSubscription` above already
 * has - what is proven with this twin is the CALL SHAPE and the caller's own
 * handling of the response, never a real bank detail (this platform never
 * sends one; see razorpay.js's own header).
 */
export async function registerFundAccount(fundAccountRef) {
  return { verified: Boolean(String(fundAccountRef || "").trim()) };
}

/**
 * Send a payout to an already-registered fund account. Deterministic
 * `provider_payout_ref` from `(fundAccountRef, ref, amountInr)`, zero
 * network - `createSubscription`'s own determinism restated for money
 * leaving instead of a mandate starting.
 */
export async function sendPayout(input) {
  const seed = `${input.fundAccountRef || ""}:${input.ref || ""}:${input.amountInr || 0}`;
  const ref = `fake_payout_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  return { provider_payout_ref: ref, status: "queued" };
}

/**
 * Verify a PAYOUT status webhook (WS-R56). Byte-identical algorithm to
 * `verifyWebhookSignature` above - the workstream brief's own law 1: "the
 * fake twin signs with the same HMAC shape the payments webhook already
 * uses so the door battery's class-d cases (replay, tamper) apply
 * unchanged." `headers` is the request's own header bag (an object, not a
 * single string) because the real provider may sign a DIFFERENT header name
 * for this product than the Subscriptions webhook does - RazorpayX's own
 * header name for a payout webhook has never been confirmed against a live
 * document (see razorpay.js's own NOT VERIFIED note); this twin reads
 * `x-razorpay-signature` on the SAME assumption `parsePayoutEvent`'s own
 * envelope shape makes, named rather than silently baked in.
 */
export function verifyPayoutWebhook(rawBody, headers, secret) {
  const sig = headers?.["x-razorpay-signature"];
  return verifyWebhookSignature(rawBody, sig, secret);
}

/**
 * Parse a payout status webhook body (WS-R56) -> `{providerRef, kind, reason}`.
 * `kind` is one of `'processed' | 'failed' | 'reversed'`, or `''` for any
 * OTHER RazorpayX payout event (`payout.queued`, `payout.initiated`,
 * `payout.updated`, ...) this platform does not treat as a state
 * transition - `api/_payments.js`'s own `KIND_TO_STATE` empty-string
 * precedent, restated for a payout instead of a subscription: "log the
 * event, change nothing."  Envelope shape assumed identical in SKELETON to
 * the Subscriptions webhook's own `{event, payload:{X:{entity}}}` (razorpay.js's
 * own header cites this for `payload.subscription.entity`/
 * `payload.payment.entity`) with `payout` as the entity key - NOT VERIFIED
 * against a live RazorpayX document by this workstream (no network beyond
 * 127.0.0.1 was in scope; see ENV-MANIFEST.md's own mark for this function).
 */
export function parsePayoutEvent(json) {
  const event = String(json?.event || "");
  const entity = json?.payload?.payout?.entity || null;
  const providerRef = String(entity?.id || "");
  const reason = entity?.failure_reason
    ? String(entity.failure_reason)
    : entity?.status_details?.reason
      ? String(entity.status_details.reason)
      : null;
  let kind = "";
  if (event === "payout.processed") kind = "processed";
  else if (event === "payout.reversed") kind = "reversed";
  else if (event === "payout.failed" || event === "payout.rejected") kind = "failed";
  return { providerRef, kind, reason };
}

/** Test-only helper: sign a raw body the way a real provider's webhook
 *  sender would, so evals/payments/run.mjs can construct a genuinely valid
 *  signature and then, for the negative control, corrupt exactly one byte of
 *  it - never call this from production code, which only ever VERIFIES a
 *  signature somebody else made. */
export function signWebhookForTest(rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * A realistic UPI Autopay mandate's own event sequence (WS-R69), test-only -
 * this workstream's own law 2: "make the fake twin emit the same event
 * sequence a real mandate does... so the offline battery drives the real
 * state machine." Razorpay's own documented order
 * (razorpay.com/docs/payments/subscriptions/workflow/, fetched 2026-09-05 -
 * see razorpay.js's own WS-R69 addendum for the full citation, quoted
 * verbatim there): `authenticated` (the mandate itself, no charge lands yet)
 * -> `activated` (the AUTHENTICATION TRANSACTION lands - for the immediate
 * start this platform always uses, that is the FULL plan amount, never a
 * token registration amount) -> `charged`, once per cycle, for as long as
 * the mandate keeps collecting -> optionally `halted` at a named cycle, when
 * Razorpay's own retry ladder gives up on a failed auto-charge (never
 * `cancelled` — `api/_payments.js`'s own `KIND_TO_STATE` maps `halted` to
 * `'paused'`, a decision this platform does not make final, that file's own
 * header explains why).
 *
 * Returns `[{kind, body}]` IN FIRING ORDER, `body` a JSON string shaped
 * exactly like `api/_payments.js`'s `parseWebhookPayload` expects
 * (`payload.subscription.entity.{id,current_start,current_end}`,
 * `payload.payment.entity.amount` in paise) - ready for `applyWebhook`'s
 * `rawBody`, so a caller drives the REAL state machine through a REALISTIC
 * multi-month lifecycle rather than one hand-picked kind in isolation.
 * `haltAtCycle`, if given, REPLACES that cycle's `charged` event with a
 * `halted` one and stops the sequence there - a halt is the mandate's own
 * retry ladder exhausting itself, not a fact that repeats.
 */
export function mandateEventSequence(providerSubscriptionRef, { priceInr, cycles = 3, haltAtCycle = null, startUnix = 1_700_000_000 } = {}) {
  const ref = String(providerSubscriptionRef);
  const amountPaise = Math.round(Number(priceInr) * 100);
  const cycleSeconds = 30 * 24 * 60 * 60; // one month, near enough for a fixture's own clock
  const events = [];

  const envelope = (kind, { start = null, end = null, paymentAmount = null } = {}) => {
    const payload = { subscription: { entity: { id: ref, current_start: start, current_end: end } } };
    if (paymentAmount != null) {
      payload.payment = { entity: { id: `pay_${events.length + 1}`, amount: paymentAmount, currency: "INR", status: "captured" } };
    }
    return JSON.stringify({ event: kind, payload });
  };

  events.push({ kind: "subscription.authenticated", body: envelope("subscription.authenticated") });

  for (let cycle = 1; cycle <= cycles; cycle++) {
    const start = startUnix + (cycle - 1) * cycleSeconds;
    const end = start + cycleSeconds;
    if (haltAtCycle === cycle) {
      events.push({ kind: "subscription.halted", body: envelope("subscription.halted", { start, end }) });
      break;
    }
    const kind = cycle === 1 ? "subscription.activated" : "subscription.charged";
    events.push({ kind, body: envelope(kind, { start, end, paymentAmount: amountPaise }) });
  }

  return events;
}
