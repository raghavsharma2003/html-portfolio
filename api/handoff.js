// Handoff - the HTTP half of WS-R20 (migration 083).
//
//   OWNER (bearer token)
//     POST {op:"config_get", replica_id}
//     POST {op:"config_set", replica_id, enabled, monthly_cap}
//     POST {op:"queue",      replica_id}
//     POST {op:"answer",     replica_id, handoff_id, reply_text}
//
//   FOLLOWER (room session, api/_room-surface.js's own token)
//     POST {op:"draft",     session, thread_id?, message_indexes?, note?}
//     POST {op:"send",      session, payload_text, payload_sha256, thread_id?}
//     POST {op:"withdraw",  session, handoff_id}
//     POST {op:"mine",      session}
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_handoff.js, where a fake `db` can reach it -
// api/checkins.js is the shape this copies almost verbatim.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { requireUser, AuthError } from "./_auth.js";
import { RoomError } from "./_room-surface.js";
import {
  HandoffError,
  getHandoffConfig,
  setHandoffConfig,
  handoffQueue,
  answerHandoff,
  draftHandoffPayload,
  sendHandoffRequest,
  withdrawHandoffRequest,
  myHandoffs,
} from "./_handoff.js";
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
  if (!allow(ipOf(req), "handoff_ip", 60)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    if (op === "config_get" || op === "config_set" || op === "queue" || op === "answer") {
      const user = await requireUser(req);
      if (!allow(user.id, "handoff_owner_user", 30)) return res.status(429).json({ error: "slow_down" });

      if (op === "config_get") {
        return res.status(200).json(await getHandoffConfig(q, user.id, body.replica_id));
      }
      if (op === "config_set") {
        const config = await setHandoffConfig(q, user.id, body.replica_id, {
          enabled: body.enabled === true,
          monthlyCap: body.monthly_cap,
        });
        return res.status(200).json(config);
      }
      if (op === "queue") {
        return res.status(200).json(await handoffQueue(q, user.id, body.replica_id));
      }
      const answered = await answerHandoff(q, user.id, body.replica_id, body.handoff_id, {
        replyText: body.reply_text,
      });
      return res.status(200).json(answered);
    }

    if (op === "draft") {
      const draft = await draftHandoffPayload(q, {
        session: body.session,
        threadId: body.thread_id || null,
        messageIndexes: Array.isArray(body.message_indexes) ? body.message_indexes : null,
        note: body.note ?? null,
      });
      return res.status(200).json(draft);
    }

    if (op === "send") {
      if (!allow(ipOf(req), "handoff_send_ip", 20)) return res.status(429).json({ error: "slow_down" });
      const sent = await sendHandoffRequest(q, {
        session: body.session,
        payloadText: body.payload_text,
        payloadSha256: body.payload_sha256,
        threadId: body.thread_id || null,
      });
      return res.status(200).json(sent);
    }

    if (op === "withdraw") {
      const withdrawn = await withdrawHandoffRequest(q, { session: body.session, handoffId: body.handoff_id });
      return res.status(200).json(withdrawn);
    }

    if (op === "mine") {
      return res.status(200).json({ handoffs: await myHandoffs(q, { session: body.session }) });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof HandoffError) return res.status(error.status).json({ error: error.code });
    if (error instanceof RoomError) return res.status(error.status).json({ error: error.code });
    if (error instanceof AuthError) return res.status(error.status || 401).json({ error: error.code });
    console.error("[handoff] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "handoff_failure" });
  }
}

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "handoff.js", handler);
