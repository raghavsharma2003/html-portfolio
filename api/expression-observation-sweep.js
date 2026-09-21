// Bounded physical retention for the ephemeral expression ledger. Eligibility
// is always checked at read time too; this route only removes already-expired
// rows so a delayed scheduler cannot make stale observations live again.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { purgeExpiredExpressionObservations } from "./_experience-compiler/expression-observation-store.js";

export function authorizedExpressionObservationSweep(req, env = process.env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Drain several lock-safe pages under a hard batch and wall-clock bound.
 * A full final page is an observable backlog signal, not a claim that the
 * 24-hour physical-retention target was met. */
export async function drainExpiredExpressionObservations(db, options = {}) {
  const purge = options.purge || purgeExpiredExpressionObservations;
  const limit = 500;
  const maxBatches = Math.max(1, Math.min(10, Number(options.maxBatches || 10)));
  const timeBudgetMs = Math.max(250, Math.min(8_000, Number(options.timeBudgetMs || 7_500)));
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const before = options.before || new Date().toISOString();
  const started = clock();
  let batches = 0;
  let deleted = 0;
  let lastBatch = 0;
  while (batches < maxBatches && clock() - started < timeBudgetMs) {
    const ids = await purge(db, { before, limit });
    lastBatch = ids.length;
    deleted += lastBatch;
    batches += 1;
    if (lastBatch < limit) break;
  }
  return Object.freeze({
    deleted,
    batches,
    more_possible: lastBatch === limit,
    time_budget_reached: lastBatch === limit && clock() - started >= timeBudgetMs,
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorizedExpressionObservationSweep(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const result = await drainExpiredExpressionObservations(q);
    if (result.more_possible) {
      return res.status(503).json({
        error: "expression_observation_retention_backlog",
        deleted: result.deleted,
        batches: result.batches,
        more_possible: true,
      });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch {
    return res.status(500).json({ error: "expression_observation_sweep_failed" });
  }
}
