// GET|POST /api/self-check — WS-R76 (migration 120). The deployment's own
// morning report on itself: env presence by name, whether the database
// answers, whether every migration family the tree ships is applied, and
// whether every other cron has run recently enough.
//
// Cron auth mirrors api/checkins-sweep.js and the rest of this family: a
// constant-time comparison against CRON_SECRET, which Vercel itself sends
// as `Authorization: Bearer $CRON_SECRET` when the env var is configured
// (https://vercel.com/docs/cron-jobs). No secret configured means no path
// in, ever.
//
// Thin by construction: auth and dispatch live here, every decision lives
// in api/_self-check.js where evals/self-check/run.mjs can reach it with a
// fake db and a fake env.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { runSelfCheck, recordSelfCheckIncidents, recordOptionalAbsentIncidents, sendSelfCheckTelegramAlert } from "./_self-check.js";
import { withSweepRun } from "./_sweep-run.js";

// A handful of information_schema reads and, at most, a few dozen incident
// upserts on a bad morning — well under the default, the same headroom
// api/drift-watch-sweep.js's own pure-SQL sweep takes.
export const config = { maxDuration: 60 };

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
    // WS-R21: the ops board's own heartbeat (migration 084), every sweep's
    // own call shape. The summary returned to `withSweepRun` carries only
    // numbers and a boolean — `sanitizeCounts` (api/_sweep-run.js) keeps
    // those, the same content-free digest every other sweep row already
    // gets; the failing checks' own NAMES never go through this path at
    // all, they go through `recordSelfCheckIncidents` below, one
    // `vy_incident` row per finding, `kind: "self_check"`.
    const summary = await withSweepRun(q, "self-check", async () => {
      const now = Date.now();
      const result = await runSelfCheck({ db: q, env: process.env, now });
      await recordSelfCheckIncidents(q, result);
      // WS-R102, workstream law 2: the SAME morning tick also writes one
      // content-free incident row per absent OPTIONAL_ENV name (never a
      // failing check - see api/_self-check.js's own header on why this is
      // a separate write from the one above).
      await recordOptionalAbsentIncidents(q, result);
      // WS-R98, workstream law #2: the failure path's own Telegram alert,
      // best-effort, beside this cron's own incident-recording step above -
      // `api/checkins-sweep.js`'s own `fetch: globalThis.fetch` line,
      // restated.
      const telegram = await sendSelfCheckTelegramAlert(q, result, { env: process.env, fetch: globalThis.fetch, now });
      return {
        checked: result.checked, passed: result.passed, failed: result.failed, ok: result.ok,
        telegramSent: telegram.telegramSent,
      };
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    return res.status(500).json({ error: "self_check_failed" });
  }
}
