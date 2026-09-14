import { timingSafeEqual } from "node:crypto";
import { createProductionClaimExtractor } from "./_claim-extraction/registry.js";
import { q } from "./_db.js";
import { runClaimExtractionSweep } from "./_replica-claim-sweep.js";

export function authorizedClaimExtractionSweep(req, env = process.env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function executeClaimExtractionSweep(options = {}) {
  const timeoutMs = Math.max(5_000, Math.min(45_000, Number(options.timeoutMs || 42_000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("claim-extraction-route-deadline")), timeoutMs);
  try {
    let extractor;
    try {
      extractor = (options.createExtractor || createProductionClaimExtractor)();
    } catch (error) {
      // Configuration absence is platform-owned and must still reach the
      // durable queue settlement. Passing a fail-closed adapter lets the
      // worker lease one due item, record the named wait, and run relational
      // reconciliation instead of returning a content-free 500 forever.
      extractor = { async extract() { throw error; } };
    }
    return await (options.run || runClaimExtractionSweep)({
      db: options.db || q,
      extractor,
      maxJobs: 1,
      timeBudgetMs: Math.min(45_000, timeoutMs + 2_000),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorizedClaimExtractionSweep(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const summary = await executeClaimExtractionSweep();
    return res.status(200).json({ ok: true, ...summary });
  } catch {
    return res.status(500).json({ error: "claim_extraction_sweep_failed" });
  }
}

export const config = { maxDuration: 60 };
