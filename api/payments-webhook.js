// The payment provider's webhook receiver (WS-R11).
//
//   POST /api/payments-webhook   { event, payload:{ subscription, payment } }
//
// No bearer token: a webhook has no user session, only a signature. Every
// decision - verify, then parse, then apply - lives in `applyWebhook`
// (api/_payments.js), where a fake `db` and a fake provider can reach it.
// This file's own job is the same three lines api/discord.js's and
// api/whatsapp.js's webhook receivers hold to: read the RAW bytes, hand them
// down unread, and never re-serialize what a signature was computed over.
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { q } from "./_db.js";
import { PaymentsError, applyWebhook } from "./_payments.js";

/** Vercel parses request bodies by default, which would destroy the exact
 *  bytes the provider signed - api/discord.js's own reason for this export,
 *  restated for HMAC instead of Ed25519. */
export const config = { api: { bodyParser: false } };

/** api/whatsapp.js's own `rawBodyOf`, copied rather than imported: each
 *  webhook surface owns its raw-body reader so a bug in one can never change
 *  what another surface trusts as "the bytes that were signed". */
async function rawBodyOf(req) {
  if (req?.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (typeof req?.on !== "function") return null;
  if (req.readableEnded || req.complete) return null;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > 1_000_000) return null; // a webhook body this large is not ours
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function cors(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Generous and IP-only: the provider's own delivery IPs, not a person, and
  // a webhook that gets throttled just gets retried later per its own policy.
  if (!allow(ipOf(req), "payments_webhook", 240)) return res.status(429).json({ error: "slow_down" });

  try {
    const rawBody = await rawBodyOf(req);
    if (!rawBody) return res.status(400).json({ error: "payment_webhook_body_unavailable" });

    const result = await applyWebhook(q, {
      rawBody,
      signatureHeader: req.headers?.["x-razorpay-signature"],
      eventRef: req.headers?.["x-razorpay-event-id"],
    }, { ip: ipOf(req) });
    obsBestEffort("payments.webhook", { applied: result.applied, replay: result.replay, state: result.state ?? null });
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof PaymentsError) {
      console.error("[payments-webhook] refused:", error.code);
      // WS-R26: the one code that carries a Retry-After header - the
      // provider (and Telegram's own retry policy one file over) is expected
      // to try again later, honestly told how much later. Every OTHER
      // PaymentsError code keeps this handler's existing shape unchanged
      // (`error.details` was never surfaced here before this workstream, and
      // still is not for anything but this one code).
      if (error.code === "rate_limited" && error.details?.retry_after_seconds) {
        res.setHeader("Retry-After", String(error.details.retry_after_seconds));
        return res.status(error.status).json({
          error: error.code,
          retry_after_seconds: error.details.retry_after_seconds,
        });
      }
      return res.status(error.status).json({ error: error.code });
    }
    console.error("[payments-webhook] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "payments_webhook_failure" });
  }
}
