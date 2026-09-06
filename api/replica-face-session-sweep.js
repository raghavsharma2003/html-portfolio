import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { configuredFaceSessionErasureBroker } from "./_face-session/registry.js";
import { runFaceSessionCleanupSweep } from "./_replica-face-session.js";
import { withSweepRun } from "./_sweep-run.js";

export const config = { maxDuration: 120 };

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
    // WS-R21: the ops board's heartbeat (migration 084).
    const summary = await withSweepRun(q, "replica-face-session", async () => {
      const broker = configuredFaceSessionErasureBroker();
      if (!broker) return { disabled: true };
      return runFaceSessionCleanupSweep({ db: q, broker, maxJobs: 2, timeBudgetMs: 100_000 });
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "face_session_sweep_failed" : error.code || error.message });
  }
}
