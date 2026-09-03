// The scheduled half of Pulse (WS-R17) — every PUBLISHED Room, the most
// recently CLOSED ISO week, recomputed. `api/drift-watch-sweep.js`'s own
// shape.
//
// Cron auth mirrors that file and the rest of the */N-minute and hourly
// family: a constant-time comparison against CRON_SECRET, which Vercel
// itself sends as `Authorization: Bearer $CRON_SECRET` when the env var is
// configured (https://vercel.com/docs/cron-jobs). No secret configured means
// no path in, ever - never open by accident.
//
// Weekly, not every five minutes: a Pulse bucket answers "what did people
// ask about this week", and recomputing it more often than the window it
// measures buys nothing a creator would notice.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { runPulseSweep } from "./_pulse.js";

export const config = { maxDuration: 60 };

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    const summary = await runPulseSweep({ db: q, limit });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "pulse_sweep_failed" : error.code || error.message });
  }
}
