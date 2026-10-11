import { q } from "./_db.js";
import {
  authorizedPipelineWatchdog,
  inspectReplicaPipeline,
  publicPipelineWatchdogReport,
} from "./_replica-pipeline-watchdog.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }
  if (!authorizedPipelineWatchdog(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const report = await inspectReplicaPipeline(q);
    const body = publicPipelineWatchdogReport(report);
    if (!report.ok) {
      // One content-free line makes a Vercel 5xx alert actionable without
      // placing any tenant, job, object or recording identifier in logs.
      console.error(JSON.stringify({ error: "replica_pipeline_stalled", ...body }));
      return res.status(503).json({ error: "replica_pipeline_stalled", ...body });
    }
    return res.status(200).json(body);
  } catch {
    console.error(JSON.stringify({ error: "replica_pipeline_watchdog_failed" }));
    return res.status(503).json({ error: "replica_pipeline_watchdog_failed" });
  }
}
