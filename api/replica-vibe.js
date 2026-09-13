// EmotionOS vibe — the HTTP half of WS-R153 (migration 164).
//
//   OWNER (bearer token)
//     POST {op:"get",    replica_id, limit?}              -> {vibe, history}
//     POST {op:"set",    replica_id, warmth, energy, humour, directness, formality, note?}
//     POST {op:"revert", replica_id, to_version}
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_replica-vibe.js, where a fake `db` can reach it —
// api/checkins.js's own three owner-bearer ops (design_create/list/pause)
// are the shape this door restates for a different table. The follower NEVER
// sees this door at all — no session-shaped op exists here, by construction
// (the brief's own law: "the follower never sees vibe").
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { requireUser, AuthError } from "./_auth.js";
import { bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";
import { getReplicaVibe, listReplicaVibeHistory, setReplicaVibe, revertReplicaVibe, VIBE_HISTORY_LIMIT_DEFAULT } from "./_replica-vibe.js";
import { withDoor } from "./_incidents.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_vibe_ip", 60)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  if (bodyTooLarge(body, ROOM_DOOR_BODY_CAP_BYTES)) return res.status(413).json({ error: "body_too_large" });
  const op = String(body.op || "");

  try {
    // Every op here is owner-bearer only — no follower session shape exists
    // on this door at all, per the brief's own law.
    const user = await requireUser(req);
    if (!allow(user.id, "replica_vibe_owner_user", 30)) return res.status(429).json({ error: "slow_down" });

    if (op === "get") {
      const [vibe, history] = await Promise.all([
        getReplicaVibe(q, user.id, body.replica_id),
        listReplicaVibeHistory(q, user.id, body.replica_id, body.limit ?? VIBE_HISTORY_LIMIT_DEFAULT),
      ]);
      return res.status(200).json({ vibe, history });
    }
    if (op === "set") {
      const vibe = await setReplicaVibe(q, user.id, {
        replica_id: body.replica_id,
        warmth: body.warmth, energy: body.energy, humour: body.humour,
        directness: body.directness, formality: body.formality, note: body.note,
      });
      return res.status(200).json({ vibe });
    }
    if (op === "revert") {
      const vibe = await revertReplicaVibe(q, user.id, { replica_id: body.replica_id, to_version: body.to_version });
      return res.status(200).json({ vibe });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status || 401).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_vibe_failure" : String(error.code || error.message) });
  }
}

export default withDoor(q, "replica-vibe.js", handler);
