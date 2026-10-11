// The receipt backfill sweep (WS-R103, no migration). Daily: every landed
// follower charge with no receipt gets one, through the SAME
// `issueFollowerReceipt` the webhook itself uses - `api/renewals-sweep.js`'s
// own shape (cron auth, `withSweepRun` heartbeat), one statement family
// instead of three.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { backfillReceipts } from "./_payments.js";
import { withSweepRun } from "./_sweep-run.js";

// Up to `RECEIPT_SWEEP_DEFAULT_LIMIT` (500) sequential SELECT-then-claim
// pairs, no network call, no GPU wake - `api/drift-watch-sweep.js`'s own
// pure-SQL number, restated for a bounded batch of small indexed queries
// rather than assumed.
export const config = { maxDuration: 60 };

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    // WS-R21: the ops board's heartbeat (migration 084), `api/renewals-
    // sweep.js`'s own call shape.
    const summary = await withSweepRun(q, "receipt", async () => backfillReceipts(q, { env: process.env }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "receipt_sweep_failed" : error.code || error.message });
  }
}

export default withDoor(q, "receipt-sweep.js", handler);
