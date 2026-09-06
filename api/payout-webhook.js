// The payout PROVIDER's status webhook (WS-R56, migration 111).
//
//   POST /api/payout-webhook   { event, payload:{ payout: { entity } } }
//
// RazorpayX tells us a payout it already accepted was later processed
// (settled) or failed (rejected, or reversed by the receiving bank). No
// bearer token: a webhook has no user session, only a signature - the same
// posture api/payments-webhook.js already carries one file over, restated
// for a payout instead of a subscription. Every decision - verify, then
// parse, then apply - lives in `applyPayoutWebhook` (api/_payments.js),
// where a fake `db` and a fake provider can reach it. This file's own job
// is the same three lines api/payments-webhook.js's own header names: read
// the RAW bytes, hand them down unread, and never re-serialize what a
// signature was computed over.
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { PaymentsError, applyPayoutWebhook } from "./_payments.js";

/** Vercel parses request bodies by default, which would destroy the exact
 *  bytes the provider signed - api/payments-webhook.js's own reason,
 *  restated for this door. */
export const config = { api: { bodyParser: false } };

/** api/payments-webhook.js's own `rawBodyOf`, copied rather than imported:
 *  each webhook surface owns its raw-body reader so a bug in one can never
 *  change what another surface trusts as "the bytes that were signed" -
 *  that file's own comment, restated verbatim for the identical reason. */
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

async function handler(req, res) {
  cors(res);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Generous and IP-only, api/payments-webhook.js's own rate: the
  // provider's own delivery IPs, not a person, and a webhook that gets
  // throttled just gets retried later per its own policy.
  if (!allow(ipOf(req), "payments_webhook", 240)) return res.status(429).json({ error: "slow_down" });

  try {
    const rawBody = await rawBodyOf(req);
    if (!rawBody) return res.status(400).json({ error: "payout_webhook_body_unavailable" });

    const result = await applyPayoutWebhook(q, { rawBody, headers: req.headers || {} }, { ip: ipOf(req) });
    obsBestEffort("payments.payout_webhook", {
      applied: result.applied,
      replay: result.replay,
      kind: result.kind,
      state: result.state ?? null,
    });
    // Law 2: "an event for an unknown ref is logged as a content-free
    // count, never an error to the caller (200, so the provider stops
    // retrying)." A replay, an unknown ref, and an ignored event kind all
    // reach this SAME 200 - only the observability line above distinguishes
    // them, never the HTTP response the provider sees.
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof PaymentsError) {
      console.error("[payout-webhook] refused:", error.code);
      // api/payments-webhook.js's own one exception to its otherwise-flat
      // error shape: the rate-limit code alone carries a Retry-After header.
      if (error.code === "rate_limited" && error.details?.retry_after_seconds) {
        res.setHeader("Retry-After", String(error.details.retry_after_seconds));
        return res.status(error.status).json({
          error: error.code,
          retry_after_seconds: error.details.retry_after_seconds,
        });
      }
      return res.status(error.status).json({ error: error.code });
    }
    console.error("[payout-webhook] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "payout_webhook_failure" });
  }
}

export default withDoor(q, "payout-webhook.js", handler);
