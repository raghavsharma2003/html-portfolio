// GET /api/readiness?replica_id=… — the one creator screen, computed and
// snapshotted. Vyakti Rooms v1, WS-R3.
//
// Thin by construction: cors, rate limit, auth, one call, error shape. Every
// decision lives in api/_readiness.js where an eval can reach it with a fake
// db — `dead-writers`, and the plainer fact that this environment has no
// database, so logic in a handler is logic no eval will ever run.
//
// READ ONLY at the HTTP layer, and yet it WRITES. That is deliberate and it is
// the one thing about this endpoint worth reading twice: the publish lock is a
// SQL predicate on the LATEST readiness snapshot, evaluated inside the runtime
// activation statement and the channel connect statement. A GET that computed
// a fresh screen and stored nothing would show a creator a passing score while
// two gates a floor below kept reading a stale failing row, and the creator
// would be told the product was broken. The screen and the lock have to be
// looking at the same row, so reading the screen is what mints it.
//
// The write is idempotent on the inputs: api/_readiness.js's insert is guarded
// against the newest snapshot's own `inputs_hash`, so a poll that changes
// nothing writes nothing and the history stays a record of changes.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { ReadinessError, readOwnedReadiness } from "./_readiness.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "readiness", 40)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "readiness_user", 80)) return res.status(429).json({ error: "slow_down" });

    const readiness = await readOwnedReadiness(q, user.id, req.query?.replica_id);
    // A replica that is not the caller's answers exactly as a replica that does
    // not exist. Ownership is decided by the SQL predicate inside the read,
    // never by a branch here.
    if (!readiness) return res.status(404).json({ error: "replica_not_found" });
    return res.status(200).json({ readiness });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReadinessError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "readiness_failure" : String(error.code || error.message),
    });
  }
}
