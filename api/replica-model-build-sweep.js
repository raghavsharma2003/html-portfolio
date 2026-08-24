import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { runVoiceGenomeBuildSweep } from "./_replica-model-build.js";

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
    const summary = await runVoiceGenomeBuildSweep({ db: q, maxJobs: 2 });
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    return res.status(500).json({ error: "model_build_sweep_failed" });
  }
}

export const config = { maxDuration: 60 };
