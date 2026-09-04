// The Room's owner-side Pulse endpoint (WS-R17).
//
//   GET  /api/pulse?replica_id=…            this replica's Room's Pulse, or null
//   POST /api/pulse {op:"set_topics", replica_id, topics:[...]}   the topic list
//
// Thin by construction, `api/room-cohorts.js`'s own shape: cors, rate limit,
// bearer auth, one call, error shape. Every decision — the opt-in floor, the
// aggregate-only SQL, the honest empty state — lives in `api/_pulse.js`,
// where a fake `db` can reach it.
//
// READ ONLY on GET, exactly `api/room-cohorts.js`'s own reasoning: nothing
// here gates anything a follower does, so a fresh computation on every poll
// costs nothing that matters at this traffic. The WRITE this endpoint owns
// is the creator's own topic list, never a follower's anything.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { PulseError, readPulse, setTopics } from "./_pulse.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "pulse", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "pulse_user", 40)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const replicaId = req.query?.replica_id;
      if (!replicaId) return res.status(400).json({ error: "replica_id_required" });
      const result = await readPulse(q, user.id, replicaId);
      // A replica that is not the caller's answers exactly as a replica that
      // does not exist - `api/room-cohorts.js`'s own line, restated here for
      // the identical reason: ownership is decided by the SQL predicate
      // inside the read, never by a branch here.
      if (!result) return res.status(404).json({ error: "replica_not_found" });
      return res.status(200).json(result);
    }

    const body = req.body || {};
    const op = String(body.op || "");
    const replicaId = body.replica_id;

    if (op === "set_topics") {
      const topics = await setTopics(q, user.id, replicaId, body.topics);
      obsBestEffort("pulse.set_topics", { count: topics.length });
      return res.status(200).json({ topics });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof PulseError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "pulse_failure" : String(error.code || error.message),
    });
  }
}
