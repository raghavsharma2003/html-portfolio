// GET /api/room-cohorts?replica_id=… — week-six retention, the number that
// decides the company (WS-R12). Vyakti Rooms v1.
//
// Thin by construction, `api/readiness.js`'s own shape: cors, rate limit,
// bearer auth, one call, error shape. Every decision — the cohort math, the
// aggregate-only SQL, the verdict bands — lives in `api/_room-cohorts.js`,
// where a fake `db` can reach it.
//
// READ ONLY, unlike `api/readiness.js`. That module's GET also writes because
// the publish lock has to look at the same row the screen shows; nothing here
// gates anything, so there is nothing this endpoint needs the database to
// remember between polls — a fresh computation every time is the honest
// answer and costs nothing a cache would save that matters at this traffic.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { RoomCohortsError, readOwnedRoomCohorts } from "./_room-cohorts.js";

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
  if (!allow(ipOf(req), "room_cohorts", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "room_cohorts_user", 40)) return res.status(429).json({ error: "slow_down" });

    const result = await readOwnedRoomCohorts(q, user.id, req.query?.replica_id);
    // A replica that is not the caller's answers exactly as a replica that
    // does not exist - `api/readiness.js`'s own line, restated here for the
    // identical reason: ownership is decided by the SQL predicate inside the
    // read, never by a branch here.
    if (!result) return res.status(404).json({ error: "replica_not_found" });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof RoomCohortsError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "room_cohorts_failure" : String(error.code || error.message),
    });
  }
}
