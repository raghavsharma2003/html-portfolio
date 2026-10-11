import { q } from "./_db.js";
import { authorizedProcessingSweep, runProcessingSweep } from "./_replica-processing/sweep.js";

// The cron entry point for the enrollment processing queue. Auth and wiring
// only: everything worth testing lives in `_replica-processing/sweep.js`, which
// imports no database and so can be driven by an eval on a machine that has no
// `api/_config.js`. That split is not decoration. The suite for this file has
// to be able to prove the auth refusal and the job bound offline, and a module
// that pulls in `_db.js` at import time cannot be imported offline at all.
//
// NO LONGER ON A CRON. The Azure Container Apps Job `vyakti-replica-processing`
// owns all eight steps of the audio DAG, because it is the only runtime that
// has `clamdscan` and `ffprobe` and so the only one that can serve more than
// `integrity`. Its cron entry was removed from vercel.json when that job was
// deployed and proven serving.
//
// This endpoint stays, and still answers a CRON_SECRET bearer call, as the
// manual fallback for when Azure is unavailable. Restoring the cron line is
// what makes it scheduled again.
//
// Why one owner and not two. The lease is atomic, so two schedulers can never
// run one job twice - that is not the hazard. The hazard is that this runtime
// terminally fails a tool-bound step with `malware_scanner_unavailable` and the
// container requeues it moments later because the capability is present there,
// so the pair flaps the owner's Activity screen between blocked and progressing
// for as long as both are on a schedule. See
// services/replica-processing-worker/README.md.

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
