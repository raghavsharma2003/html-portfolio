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
//
// WS-R101 adds the door's first `op`-shaped body: `POST {op:"measure_now",
// replica_id}` runs a recall run (`api/_recall-run.js::runRecallMeasurement`)
// and stores the result readiness now reads on the NEXT `GET`. It does not
// return a fresh readiness screen itself — the write and the read stay two
// requests, exactly as `POST /api/review-queue` writing a decision and
// `GET /api/readiness` re-reading afterwards already do — so this handler's
// own error shape never has to merge two different failure vocabularies.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { readOwnedReadiness } from "./_readiness.js";
import { runRecallMeasurement } from "./_recall-run.js";
// WS-R120: the door battery's derivation (evals/room-doors/run.mjs §0/§20)
// now finds this door once it is admitted to EXPECTED_DOORS (superseding
// WS-R101's own exclusion, context/decisions.md#ws-r120-readiness-js-joins-
// the-door-battery), and its §20 body-size law applies uniformly to every
// admitted POST door — this file had never called the shared gate. Every
// other owner-bearer POST door with a small JSON body (ops.js, pulse.js,
// invites.js) already does exactly this, in exactly this position (after
// auth, before the op is read).
import { bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

async function handleGet(req, res, user) {
  if (!allow(user.id, "readiness_user", 80)) return res.status(429).json({ error: "slow_down" });
  const readiness = await readOwnedReadiness(q, user.id, req.query?.replica_id);
  // A replica that is not the caller's answers exactly as a replica that does
  // not exist. Ownership is decided by the SQL predicate inside the read,
  // never by a branch here.
  if (!readiness) return res.status(404).json({ error: "replica_not_found" });
  return res.status(200).json({ readiness });
}

async function handleMeasureNow(req, res, user) {
  // Its own, tighter user-scoped bucket: the SQL rate predicate inside
  // `runRecallMeasurement` is the real limiter (one run per replica per
  // hour), this is only the cheap outer wall the GET side already has one
  // of, `readiness_user`'s own precedent one scope over.
  if (!allow(user.id, "readiness_measure_now", 10)) return res.status(429).json({ error: "slow_down" });
  const body = req.body || {};
  // WS-R89: the one shared cap every POST door checks first (see the import
  // above for why this door had never had it).
  if (bodyTooLarge(body, ROOM_DOOR_BODY_CAP_BYTES)) return res.status(413).json({ error: "body_too_large" });
  const result = await runRecallMeasurement(q, user.id, body.replica_id);
  return res.status(200).json({ recall_run: result });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "readiness", 40)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (req.method === "GET") return await handleGet(req, res, user);
    const op = String(req.body?.op || "");
    if (op === "measure_now") return await handleMeasureNow(req, res, user);
    return res.status(400).json({ error: "readiness_op_unknown" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "readiness_failure" : String(error.code || error.message),
      // `recall_set_too_small`'s own `{found, min}` (api/_recall-run.js) rides
      // here rather than in a second field only that one error needs — every
      // other named error on this door carries no `details` and the client
      // treats an absent key as absent, never as a fabricated 0.
      ...(status !== 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
