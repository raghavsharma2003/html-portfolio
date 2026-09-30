import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { allow, ipOf } from "./_ratelimit.js";
import { runVoiceErasureSweep } from "./_replica-voice-erasure.js";
import { runSourceErasureSweep } from "./_replica-source-erasure.js";
import { prepareReplicaErasures, runReplicaErasureFinalizer } from "./_replica-full-erasure.js";
import { configuredFaceSessionErasureBroker } from "./_face-session/registry.js";
import { runFaceSessionCleanupSweep } from "./_replica-face-session.js";
import { withSweepRun } from "./_sweep-run.js";

export const config = { maxDuration: 300 };

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function authorizedReplicaErasure(req, env = process.env) {
  const configured = String(env.CRON_SECRET || env.REPLICA_ERASURE_SECRET || "");
  const supplied = String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return sameSecret(configured, supplied);
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_erasure_sweep", 30)) return res.status(429).json({ error: "slow_down" });
  if (!authorizedReplicaErasure(req)) return res.status(403).json({ error: "not_authorized" });
  try {
    // WS-R21: the ops board's heartbeat (migration 084) - wraps the kill
    // switch's own short-circuit too.
    const summary = await withSweepRun(q, "replica-erasure", async () => {
      if (["1", "true", "yes"].includes(String(process.env.REPLICA_ERASURE_KILL || "").toLowerCase())) {
        return { disabled: true };
      }
      const prepared = await prepareReplicaErasures(q);
      // Broker construction can fail on missing or invalid deployment config. Keep
      // that failure inside the settled Face lane so it cannot starve unrelated
      // voice/source erasure. Final replica deletion remains Face-fenced.
      const faceWork = Promise.resolve().then(() => {
        const faceBroker = configuredFaceSessionErasureBroker();
        return faceBroker
          ? runFaceSessionCleanupSweep({ db: q, broker: faceBroker, maxJobs: 1, timeBudgetMs: 50_000 })
          : { disabled: true };
      });
      // Provider face and voice cleanup are independent and run concurrently.
      // A Face outage is reported but cannot starve source/voice erasure; the
      // final replica purge remains hard-fenced on confirmed Face deletion.
      const [faceResult, voiceResult] = await Promise.allSettled([
        faceWork,
        runVoiceErasureSweep({ db: q, maxJobs: 3, timeBudgetMs: 90_000 }),
      ]);
      const face = faceResult.status === "fulfilled" ? faceResult.value : { failed: true };
      if (voiceResult.status === "rejected") throw voiceResult.reason;
      const voice = voiceResult.value;
      const source = await runSourceErasureSweep({ db: q, maxJobs: 2, timeBudgetMs: 100_000 });
      const replica = await runReplicaErasureFinalizer({ db: q, maxJobs: 2 });
      return { prepared: prepared.length, face, voice, source, replica };
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    return res.status(503).json({ error: "replica_erasure_sweep_failed" });
  }
}

export default withDoor(q, "replica-erasure-sweep.js", handler);
