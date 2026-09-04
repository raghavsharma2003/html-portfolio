// The heartbeat every cron handler named in vercel.json runs its work
// through (WS-R21, migration 084 / `vy_sweep_run`). See that migration's
// header for the schema and the reasoning behind "write at start AND
// finish" rather than only at the end.
//
// `db` is a `q`-shaped query function ((sql, params) => rows), the same seam
// every other module in `api/` takes (`api/_drift-watch.js`, `api/_pulse.js`,
// `api/_checkins.js`'s `sweep()`) so `evals/ops/run.mjs` can drive this with
// a fake db and no network. This file never imports `./_db.js` directly for
// that reason - a handler passes its own `q` in.
import { randomUUID } from "node:crypto";

const MAX_COUNTS_BYTES = 4096; // mirrors migration 084's vy_sweep_run_counts_size CHECK

/**
 * Reduce a sweep's own return value to a content-free digest: numbers and
 * booleans, one level deep, an array collapsed to its length. Everything
 * else (a string, a nested object) is DROPPED, never stringified - a
 * dropped field is a visible gap on the board; a stringified one is a leak
 * waiting to happen the day a summary grows a field with a name or a
 * message in it (several sweeps here already carry
 * `error_details: [{room_id, message}]` - this turns that into
 * `error_details: 1`, never the id or the text).
 */
export function sanitizeCounts(result) {
  const out = {};
  if (!result || typeof result !== "object") return out;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.length;
  }
  // Belt-and-suspenders against migration 084's own byte CHECK: a sweep with
  // an unusually wide summary should lose fields, never fail the write meant
  // to make it honest. Deletion order is insertion order (Object.entries),
  // so the LAST-computed field is dropped first - immaterial to what the
  // board needs (staleness reads started_at/outcome, not any one count).
  let json = JSON.stringify(out);
  while (Buffer.byteLength(json, "utf8") > MAX_COUNTS_BYTES && Object.keys(out).length > 0) {
    delete out[Object.keys(out).pop()];
    json = JSON.stringify(out);
  }
  return out;
}

// A short, printable code - never the raw error message, which can carry
// interpolated content (a person id, a provider's own text) depending on the
// throw site. Callers that want the real message still get it: this file
// rethrows the original error unchanged, only the DATABASE ROW is reduced.
function errorCodeOf(err) {
  const named = err && (err.code || err.error_code || err.name);
  return String(named || "sweep_failed").slice(0, 200);
}

// 'ok' unless the sanitized digest itself says otherwise. This never reads
// fields off the raw result (only the already-sanitized numeric/boolean
// digest), so it cannot be the path a stray string re-enters counts through.
function classifyOutcome(counts) {
  if (counts.halted === true) return "partial";
  for (const key of ["errors", "errored", "failed"]) {
    if (typeof counts[key] === "number" && counts[key] > 0) return "partial";
  }
  return "ok";
}

async function insertStart(db, runId, sweep, startedAt) {
  await db(
    `insert into vy_sweep_run (run_id, sweep, started_at, outcome)
     values ($1, $2, $3, 'running')`,
    [runId, sweep, startedAt],
  );
}

async function finish(db, runId, outcome, counts, errorCode) {
  await db(
    `update vy_sweep_run
        set finished_at = now(), outcome = $2, counts = $3::jsonb, error_code = $4
      where run_id = $1`,
    [runId, outcome, JSON.stringify(counts), errorCode || ""],
  );
}

/**
 * Wrap one sweep invocation with a start/finish heartbeat row.
 *
 *   const summary = await withSweepRun(q, "drift-watch", () =>
 *     runDriftWatchSweep({ db: q, limit }));
 *
 * Writes `vy_sweep_run` INSERT (outcome 'running') before calling `fn`, then
 * either:
 *   - success: UPDATEs the same row to outcome 'ok'/'partial' (classifyOutcome)
 *     with a sanitized digest of `fn`'s return value, and returns that value
 *     UNCHANGED to the caller - this file never reshapes a handler's response.
 *   - throw: UPDATEs the same row to outcome 'failed' with an error_code and
 *     empty counts, THEN RETHROWS. This file never swallows an error, it only
 *     makes sure one gets recorded before it propagates - the existing
 *     per-handler catch blocks (401/500 mapping, etc.) are untouched.
 *
 * The heartbeat writes themselves are best-effort (`.catch(() => {})`): a
 * Neon hiccup on the WRITE must never turn a sweep that otherwise succeeded
 * into a 500, the same posture `api/consolidate-sweep.js`'s own lease
 * release takes.
 */
export async function withSweepRun(db, sweep, fn) {
  if (typeof db !== "function") throw new Error("withSweepRun: db required");
  if (!sweep) throw new Error("withSweepRun: sweep name required");
  const runId = randomUUID();
  await insertStart(db, runId, sweep, new Date()).catch(() => {});
  let result;
  try {
    result = await fn();
  } catch (err) {
    await finish(db, runId, "failed", {}, errorCodeOf(err)).catch(() => {});
    throw err;
  }
  const counts = sanitizeCounts(result);
  await finish(db, runId, classifyOutcome(counts), counts, "").catch(() => {});
  return result;
}
