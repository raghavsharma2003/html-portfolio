// The Room's owner-side endpoint (WS-R7) — the creator half of Vyakti Rooms.
//
//   GET  /api/room-publish?replica_id=…          this replica's Room, or null
//   POST /api/room-publish {op:"create"}         set up the Room, propose a slug
//   POST /api/room-publish {op:"rename"}         change the slug
//   POST /api/room-publish {op:"publish"}        set published_at, gate-checked
//   POST /api/room-publish {op:"pause"}          take it down, unconditionally
//   POST /api/room-publish {op:"resume"}         bring it back, gate-checked
//   POST /api/room-publish {op:"set_free_cap"}   the monthly free allowance
//   POST /api/room-publish {op:"set_paid_ceilings"} the paid tier's fair-use
//                                                    numbers (WS-R19)
//   POST /api/room-publish {op:"stats"}          real counts, never invented
//
// Thin by construction, `api/clone-channel.js`'s own shape: cors, rate limit,
// auth, dispatch, error shape. Every decision lives in `api/_room-publish.js`,
// where a fake `db` can reach it.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import {
  RoomPublishError,
  getOwnedRoom,
  createRoom,
  renameRoom,
  publishRoom,
  pauseRoom,
  resumeRoom,
  setRoomFreeCap,
  setRoomPaidCeilings,
  ownerRoomStats,
} from "./_room-publish.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  // Two buckets, IP then user, at `api/clone-channel.js`'s numbers.
  if (!allow(ipOf(req), "room_publish", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "room_publish_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const replicaId = req.query?.replica_id;
      if (!replicaId) return res.status(400).json({ error: "replica_id_required" });
      const result = await getOwnedRoom(q, user.id, replicaId);
      if (!result) return notFound(res);
      return res.status(200).json(result);
    }

    const body = req.body || {};
    const op = String(body.op || "");
    const replicaId = body.replica_id;

    if (op === "create") {
      const room = await createRoom(q, user.id, replicaId, { slug: body.slug });
      if (!room) return notFound(res);
      obsBestEffort("room_publish.create", { slug: room.slug });
      return res.status(201).json({ room });
    }

    if (op === "rename") {
      const room = await renameRoom(q, user.id, replicaId, body.slug);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.rename", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "publish") {
      const room = await publishRoom(q, user.id, replicaId);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.publish", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "pause") {
      const room = await pauseRoom(q, user.id, replicaId);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.pause", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "resume") {
      const room = await resumeRoom(q, user.id, replicaId);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.resume", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "set_free_cap") {
      const room = await setRoomFreeCap(q, user.id, replicaId, body.cap);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_free_cap", { cap: room.free_monthly_messages });
      return res.status(200).json({ room });
    }

    if (op === "set_paid_ceilings") {
      const room = await setRoomPaidCeilings(q, user.id, replicaId, {
        messages: body.messages,
        voiceSeconds: body.voice_seconds,
      });
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_paid_ceilings", {
        messages: room.paid_monthly_messages,
        voice_seconds: room.paid_monthly_voice_seconds,
      });
      return res.status(200).json({ room });
    }

    if (op === "stats") {
      const stats = await ownerRoomStats(q, user.id, replicaId);
      if (!stats) return notFound(res);
      return res.status(200).json({ stats });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof RoomPublishError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    console.error("[room-publish] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "room_publish_failure" });
  }
}
