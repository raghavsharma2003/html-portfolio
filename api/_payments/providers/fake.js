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

export async function createSubscription(input) {
  const seed = `${input.label || ""}:${input.ref || ""}:${input.priceInr || 0}`;
  const ref = `fake_sub_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  return { provider_subscription_ref: ref, checkout_url: `https://fake-provider.invalid/pay/${ref}`, status: "created" };
}

export async function cancelSubscription(_providerSubscriptionRef) {
  return { ok: true };
}

/** Change a subscription's seat quantity - the Suite lane's own operation,
 *  WS-R33: "adding a seat is a subscription update through the seam,
 *  prorated by the provider, never by us." No proration happens in the fake
 *  twin (nothing to prorate against, offline) - it exists to prove the CALL
 *  SHAPE and the caller's own handling of the response, `cancelSubscription`'s
 *  own scope one function up. */
export async function updateSubscriptionQuantity(_providerSubscriptionRef, quantity) {
  return { ok: true, quantity: Number(quantity) };
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

/** Test-only helper: sign a raw body the way a real provider's webhook
 *  sender would, so evals/payments/run.mjs can construct a genuinely valid
 *  signature and then, for the negative control, corrupt exactly one byte of
 *  it - never call this from production code, which only ever VERIFIES a
 *  signature somebody else made. */
export function signWebhookForTest(rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return createHmac("sha256", secret).update(body).digest("hex");
}
