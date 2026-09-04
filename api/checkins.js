// Check-ins - the HTTP half of WS-R16.
//
//   OWNER (bearer token)
//     POST {op:"design_create", replica_id, title, prompt_shape, cadence_hint}
//     POST {op:"design_list",   replica_id}
//     POST {op:"design_pause",  replica_id, design_id, state}
//
//   FOLLOWER (room session, `api/_room-surface.js`'s own token)
//     POST {op:"designs",  session}
//     POST {op:"opt_in",   session, design_id, days_of_week, local_time, timezone}
//     POST {op:"stop",     session, checkin_id}
//     POST {op:"list_mine",session}
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_checkins.js, where a fake `db` can reach it -
// api/room-cohorts.js and api/room.js are the two shapes this combines.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { requireUser, AuthError } from "./_auth.js";
import { RoomError } from "./_room-surface.js";
import {
  CheckinsError,
  createDesign,
  listDesigns,
  pauseDesign,
  listRoomCheckinDesigns,
  optIn,
  stop,
  listMine,
} from "./_checkins.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "checkins_ip", 60)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    if (op === "design_create" || op === "design_list" || op === "design_pause") {
      const user = await requireUser(req);
      if (!allow(user.id, "checkins_owner_user", 30)) return res.status(429).json({ error: "slow_down" });
      if (op === "design_create") {
        const design = await createDesign(q, user.id, body.replica_id, {
          title: body.title,
          promptShape: body.prompt_shape,
          cadenceHint: body.cadence_hint,
        });
        return res.status(200).json(design);
      }
      if (op === "design_list") {
        const designs = await listDesigns(q, user.id, body.replica_id);
        if (designs === null) return res.status(404).json({ error: "room_not_found" });
        return res.status(200).json({ designs });
      }
      const paused = await pauseDesign(q, user.id, body.replica_id, body.design_id, { state: body.state });
      return res.status(200).json(paused);
    }

    if (op === "designs") {
      return res.status(200).json({ designs: await listRoomCheckinDesigns(q, { session: body.session }) });
    }

    if (op === "opt_in") {
      const created = await optIn(q, {
        session: body.session,
        designId: body.design_id,
        daysOfWeek: body.days_of_week,
        localTime: body.local_time,
        timezone: body.timezone,
      });
      return res.status(200).json(created);
    }

    if (op === "stop") {
      if (!allow(ipOf(req), "checkins_stop_ip", 20)) return res.status(429).json({ error: "slow_down" });
      const stopped = await stop(q, { session: body.session, checkinId: body.checkin_id });
      return res.status(200).json(stopped);
    }

    if (op === "list_mine") {
      return res.status(200).json({ checkins: await listMine(q, { session: body.session }) });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof CheckinsError) return res.status(error.status).json({ error: error.code });
    if (error instanceof RoomError) return res.status(error.status).json({ error: error.code });
    if (error instanceof AuthError) return res.status(error.status || 401).json({ error: error.code });
    console.error("[checkins] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "checkins_failure" });
  }
}
