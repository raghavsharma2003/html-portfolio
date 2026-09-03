// The fake provider (WS-R11) - the offline twin of razorpay.js, same
// interface, same signature ALGORITHM (HMAC-SHA256 over the raw body), zero
// network. Selected by `PAYMENTS_PROVIDER=fake`; used by evals/payments/run.mjs
// to drive api/_payments.js's real code with no live account, and safe to run
// against a staging deployment for the same reason api/_channel-secrets.js's
// backends exist as named alternatives rather than a single hardcoded vendor.
//
// Deterministic on purpose: the same (roomSlug, followerId, priceInr) always
// mints the same reference, so a retried "subscribe" request during a flaky
// network is idempotent at the PROVIDER layer too, not only at
// api/_payments.js's own database layer.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const name = "fake";

export async function createSubscription(input) {
  const seed = `${input.roomSlug || ""}:${input.followerId || ""}:${input.priceInr || 0}`;
  const ref = `fake_sub_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  return { provider_subscription_ref: ref, checkout_url: `https://fake-provider.invalid/pay/${ref}`, status: "created" };
}

export async function cancelSubscription(_providerSubscriptionRef) {
  return { ok: true };
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

/** Test-only helper: sign a raw body the way a real provider's webhook
 *  sender would, so evals/payments/run.mjs can construct a genuinely valid
 *  signature and then, for the negative control, corrupt exactly one byte of
 *  it - never call this from production code, which only ever VERIFIES a
 *  signature somebody else made. */
export function signWebhookForTest(rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return createHmac("sha256", secret).update(body).digest("hex");
}
