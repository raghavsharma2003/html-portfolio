import { q } from "./_db.js";
import { authorizedProcessingSweep, runProcessingSweep } from "./_replica-processing/sweep.js";

// The cron entry point for the enrollment processing queue. Auth and wiring
// only: everything worth testing lives in `_replica-processing/sweep.js`, which
// imports no database and so can be driven by an eval on a machine that has no
// `api/_config.js`. That split is not decoration. The suite for this file has
// to be able to prove the auth refusal and the job bound offline, and a module
// that pulls in `_db.js` at import time cannot be imported offline at all.
//
// Registered in vercel.json at `*/5 * * * *`, the same cadence as the other
// worker-advanced sweeps.

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorizedProcessingSweep(req)) return res.status(401).json({ error: "unauthorized" });
  if (["1", "true", "yes"].includes(String(process.env.REPLICA_PROCESSING_KILL || "").toLowerCase())) {
    return res.status(200).json({ ok: true, disabled: true });
  }
  try {
    const summary = await runProcessingSweep({ db: q });
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    return res.status(503).json({ error: "replica_processing_sweep_failed" });
  }
}
