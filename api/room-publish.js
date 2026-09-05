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
//   POST /api/room-publish {op:"set_default_locale"} the Room's default
//                                                    CHROME language (WS-R24)
//   POST /api/room-publish {op:"set_bio"}        the directory's one-line
//                                                    bio (WS-R45)
//   POST /api/room-publish {op:"set_taste_enabled"} the three-question taste
//                                                    switch, per Room (WS-R53)
//   POST /api/room-publish {op:"set_dormancy_days"} the retention policy -
//                                                    null (off) or an integer
//                                                    days floor (WS-R75)
//   POST /api/room-publish {op:"list"}           opt in to the creator
//                                                    directory, refused
//                                                    unless published (WS-R45)
//   POST /api/room-publish {op:"unlist"}         opt out, unconditional
//                                                    (WS-R45)
//   POST /api/room-publish {op:"stats"}          real counts, never invented
//   POST /api/room-publish {op:"showcase_set"}   set one public-page Q&A slot
//                                                    (1..5), typed text or a
//                                                    source review card (WS-R66)
//   POST /api/room-publish {op:"showcase_remove"} take one showcase item down,
//                                                    unconditional (WS-R66)
//   POST /api/room-publish {op:"share_kit"}      the WhatsApp/Instagram/
//                                                    YouTube/Telegram share
//                                                    text and picture, or
//                                                    a null kit if the Room
//                                                    has never published
//                                                    (WS-R85)
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
  setRoomDefaultLocale,
  setRoomBio,
  setRoomTasteEnabled,
  setRoomDormancyDays,
  listRoom,
  unlistRoom,
  ownerRoomStats,
  setRoomShowcase,
  removeRoomShowcase,
  ownerRoomShareKit,
} from "./_room-publish.js";
import { withDoor } from "./_incidents.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

// WS-R85. `api/room-page.js`'s own `originFromRequest` — each thin handler
// in this codebase derives its own origin from the request rather than
// sharing a helper across an HTTP module boundary for two lines.
function originFromRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

async function handler(req, res) {
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

    if (op === "set_default_locale") {
      const room = await setRoomDefaultLocale(q, user.id, replicaId, body.locale);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_default_locale", { locale: room.default_locale });
      return res.status(200).json({ room });
    }

    if (op === "set_bio") {
      const room = await setRoomBio(q, user.id, replicaId, body.bio);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_bio", {});
      return res.status(200).json({ room });
    }

    if (op === "set_taste_enabled") {
      const room = await setRoomTasteEnabled(q, user.id, replicaId, body.enabled === true);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_taste_enabled", { enabled: room.taste_enabled });
      return res.status(200).json({ room });
    }

    if (op === "set_dormancy_days") {
      const room = await setRoomDormancyDays(q, user.id, replicaId, body.days ?? null);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.set_dormancy_days", { dormancy_days: room.dormancy_days });
      return res.status(200).json({ room });
    }

    if (op === "list") {
      const room = await listRoom(q, user.id, replicaId);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.list", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "unlist") {
      const room = await unlistRoom(q, user.id, replicaId);
      if (!room) return notFound(res);
      obsBestEffort("room_publish.unlist", { slug: room.slug });
      return res.status(200).json({ room });
    }

    if (op === "stats") {
      const stats = await ownerRoomStats(q, user.id, replicaId);
      if (!stats) return notFound(res);
      return res.status(200).json({ stats });
    }

    if (op === "share_kit") {
      const result = await ownerRoomShareKit(q, user.id, replicaId, { origin: originFromRequest(req) });
      if (!result) return notFound(res);
      obsBestEffort("room_publish.share_kit", { has_kit: result.kit != null });
      return res.status(200).json(result);
    }

    if (op === "showcase_set") {
      const result = await setRoomShowcase(q, user.id, replicaId, {
        position: body.position,
        question: body.question,
        answer: body.answer,
        sourceCardId: body.source_card_id,
      });
      if (!result) return notFound(res);
      obsBestEffort("room_publish.showcase_set", { position: body.position });
      return res.status(200).json({ showcase: result.showcase });
    }

    if (op === "showcase_remove") {
      const result = await removeRoomShowcase(q, user.id, replicaId, body.id);
      if (!result) return notFound(res);
      obsBestEffort("room_publish.showcase_remove", {});
      return res.status(200).json({ showcase: result.showcase });
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

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "room-publish.js", handler);
