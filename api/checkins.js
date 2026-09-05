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
//     POST {op:"telegram_status", session} -> {connected, checkins_enabled, stopped}  (WS-R34)
//     POST {op:"telegram_set",    session, enabled} -> {checkins_enabled}
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
  telegramCheckinsStatus,
  setTelegramCheckins,
} from "./_checkins.js";
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
      // `push_public_key` rides along on the SAME round trip the panel
      // already makes on mount, rather than a second request — server-driven
      // and always in sync with the deployment's own `ROOM_PUSH_VAPID_
      // PUBLIC` (WS-R22): unset means null, and the client's whole "Allow
      // check-ins on this phone" control renders nothing for a null key
      // (workstream law #3, "the Room hides the enable control"). The
      // PUBLIC VAPID key is not a secret — it is the value every subscriber's
      // browser is handed to mint a subscription against — so this is a
      // plain read, not a config leak.
      const designs = await listRoomCheckinDesigns(q, { session: body.session });
      const pushPublicKey = String(process.env.ROOM_PUSH_VAPID_PUBLIC || "") || null;
      return res.status(200).json({ designs, push_public_key: pushPublicKey });
    }

    if (op === "opt_in") {
      const created = await optIn(q, {
        session: body.session,
        designId: body.design_id,
        daysOfWeek: body.days_of_week,
        localTime: body.local_time,
        timezone: body.timezone,
        quietFrom: body.quiet_from ?? null,
        quietTo: body.quiet_to ?? null,
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

    // WS-R34 (migration 096): the Room panel's own control for check-ins
    // over Telegram - `connected:false` (no Telegram pointer) is not an
    // error, so the panel simply renders nothing.
    if (op === "telegram_status") {
      return res.status(200).json(await telegramCheckinsStatus(q, { session: body.session }));
    }
    if (op === "telegram_set") {
      return res.status(200).json(await setTelegramCheckins(q, { session: body.session, enabled: body.enabled }));
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

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "checkins.js", handler);
