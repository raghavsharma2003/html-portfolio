import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { withSweepRun } from "./_sweep-run.js";
import { runAuthEmailSweep } from "./_auth-email.js";

export const config = { maxDuration: 60 };

export function authorizedAuthEmailSweep(req, env = process.env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req?.headers?.authorization || "").replace(/^Bearer\s+/iu, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorizedAuthEmailSweep(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const result = await withSweepRun(q, "auth-email", async () => runAuthEmailSweep(q, { env: process.env, limit: 25 }));
    return res.status(200).json({ ok: true, ...result });
  } catch {
    return res.status(503).json({ error: "auth_email_sweep_failed" });
  }
}

export default withDoor(q, "auth-email-sweep.js", handler);
