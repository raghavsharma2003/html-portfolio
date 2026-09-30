import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { runVoiceGenomeBuildSweep } from "./_replica-model-build.js";
import { withSweepRun } from "./_sweep-run.js";
import { reconcileSelfTestVoiceGenomes } from "./_replica-processing/self-test.js";
import { reconcileVoiceBuildIntents } from "./_replica-build-intent.js";

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
    const recovery = await reconcileSelfTestVoiceGenomes(q, { env: process.env });
    const build_intents = await reconcileVoiceBuildIntents(q, { limit: 12 });
    const summary = await withSweepRun(q, "replica-model-build", () => runVoiceGenomeBuildSweep({ db: q, maxJobs: 2 }));
    return res.status(200).json({ ok: true, recovery, build_intents, ...summary });
  } catch {
    return res.status(500).json({ error: "model_build_sweep_failed" });
  }
}

export const config = { maxDuration: 60 };
