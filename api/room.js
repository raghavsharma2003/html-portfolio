// The Room's endpoint - the HTTP half of WS-R1.
//
//   POST /api/room {op:"open",   room:"<slug>"}                -> card + state
//   POST /api/room {op:"join",   room, age_18, remember}       -> session
//   POST /api/room {op:"say",    session, message, thread, transcript}
//   POST /api/room {op:"history",session, thread}
//   POST /api/room {op:"thread", session, title}
//   POST /api/room {op:"citations", session}
//   POST /api/room {op:"stats",  room:"<slug>"}
//   POST /api/room {op:"export", session}
//   POST /api/room {op:"forget", session}
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in api/_room-surface.js where a fake `db` can reach it.
// api/clone-chat.js over api/_clonechat.js is the house shape and `dead-writers`
// is the reason: the database is absent in the eval environment, so logic in a
// handler is logic no suite can run.
//
// ── WHO THIS ENDPOINT BELIEVES ───────────────────────────────────────────
//
// Two credentials, and they answer two different questions.
//
//   THE BEARER TOKEN says which human this is. It is verified against Supabase
//   (api/_auth.js) and it is the ONLY thing that may create or find a person.
//   `open` accepts it optionally, because a follower arriving from a bio link
//   is not signed in and the first screen they see must be the room rather than
//   a login wall. `join` requires it.
//
//   THE ROOM SESSION says which room, which person, and which disclosure card
//   they were shown. It is HMAC-signed by this server and was minted only after
//   a bearer token proved the person, so it stands alone for `say`, `history`
//   and `thread` exactly as the widget's does.
//
// EXPORT AND FORGET REQUIRE BOTH, and the handler asserts they name the same
// person. A session is a 12-hour credential in a browser; a stolen one buying
// turns costs a follower some of their monthly allowance, while a stolen one
// downloading their whole history or deleting it is a harm the next turn does
// not undo, and the house rule for that is two independent layers.
//
// ── CORS is `*`, and that is bounded ─────────────────────────────────────
//
// The Room is served from this origin. The wildcard is here so a creator's own
// site can link and so the same handler serves the app shell and any embed of
// it, and it is bounded the way api/clone-chat.js's is: this endpoint reads NO
// cookie and sets `Access-Control-Allow-Credentials` nowhere, so a wildcard
// origin grants exactly the ability to POST with a credential the caller
// already had.
//
// ── what a response never carries ────────────────────────────────────────
//
// The creator's consent state, their sheet, their replica id, the agent uuid,
// the provider, another follower's anything, or which of the reasons a Room is
// unreachable applies. `room_unavailable` is one code for all of them.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { AuthError, bearerToken, userFromToken } from "./_auth.js";
import {
  RoomError,
  openRoom,
  joinRoom,
  roomSay,
  followerHistory,
  createThread,
  roomCitations,
  roomStats,
  roomExport,
  roomForget,
  resolveRoom,
  personForAccount,
  readRoomSession,
} from "./_room-surface.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

/** The signed-in human, or null. Never throws for an absent token: `open` is
 *  legitimately anonymous, and a missing credential is a state rather than an
 *  error. An INVALID one is still null, which lands the caller in the signed
 *  out branch, because a token this server could not verify is not a person. */
async function optionalUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const user = await userFromToken(token);
  return user?.id ? String(user.id) : null;
}

async function requiredUser(req) {
  const id = await optionalUser(req);
  if (!id) throw new AuthError("sign_in_required");
  return id;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Two buckets, IP first so a flood costs no database round trip. The Room is
  // authenticated but `open` is not, and `open` is the op a bio link points at.
  if (!allow(ipOf(req), "room_ip", 90)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const op = String(body.op || "");

  try {
    if (op === "open") {
      const authUserId = await optionalUser(req);
      const opened = await openRoom(q, { slug: body.room, authUserId });
      obsBestEffort("room.open", { joined: opened.joined });
      return res.status(200).json(opened);
    }

    if (op === "join") {
      const authUserId = await requiredUser(req);
      if (!allow(authUserId, "room_join_user", 10)) {
        return res.status(429).json({ error: "slow_down" });
      }
      const joined = await joinRoom(q, {
        slug: body.room,
        authUserId,
        // Named for what they mean rather than for the columns they land in:
        // the client is answering two questions, not filling two fields.
        ageAttested: body.age_18 === true,
        memoryConsent: typeof body.remember === "boolean" ? body.remember : null,
      });
      // COUNTS AND DECISIONS, never conversation text - `_obs.js`'s law. The
      // memory answer is a decision and is logged as one; whose it is, is not.
      obsBestEffort("room.join", { remember: joined.follower?.remembers === true });
      return res.status(200).json(joined);
    }

    if (op === "say") {
      const turn = await roomSay(q, {
        session: body.session,
        message: body.message,
        threadId: body.thread || null,
        transcript: body.transcript,
      });
      obsBestEffort("room.say", {
        bubbles: turn.bubbles.length,
        gate_findings: turn.gate.findings,
        remembers: turn.remembers,
      });
      return res.status(200).json(turn);
    }

    if (op === "history") {
      return res.status(200).json(
        await followerHistory(q, { session: body.session, threadId: body.thread || null }),
      );
    }

    if (op === "thread") {
      // The scope comes off the SESSION, never off the body. A `person` or
      // `room` field here would be a field a client could set, which is the
      // whole defect api/_auth.js's first law names.
      const payload = readRoomSession(body.session);
      const resolved = await resolveRoom(q, payload.r);
      const created = await createThread(q, {
        roomId: resolved.room.room_id,
        personId: payload.p,
        agentId: resolved.agentId,
        title: body.title,
      });
      return res.status(200).json(created);
    }

    if (op === "citations") {
      return res.status(200).json(await roomCitations(q, { session: body.session }));
    }

    if (op === "stats") {
      return res.status(200).json(await roomStats(q, { slug: body.room }));
    }

    if (op === "export" || op === "forget") {
      const authUserId = await requiredUser(req);
      if (!allow(authUserId, `room_${op}_user`, 3)) {
        return res.status(429).json({ error: "slow_down" });
      }
      // THE SECOND LAYER. The session already names a person; this proves the
      // bearer names the SAME one, so a stolen session alone cannot download or
      // destroy a follower's history. `personForAccount` is the same bridge the
      // join used, so this comparison is against the identity that minted the
      // session rather than against a re-derivation of it.
      const payload = readRoomSession(body.session);
      const personId = await personForAccount(q, authUserId);
      if (String(personId) !== String(payload.p)) {
        return res.status(403).json({ error: "room_session_mismatch" });
      }
      const out =
        op === "export"
          ? await roomExport(q, { session: body.session })
          : await roomForget(q, { session: body.session });
      obsBestEffort(`room.${op}`, { ok: true });
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof RoomError) {
      const payload = { error: error.code };
      // The ONE error that carries a detail, because the client has to render a
      // number a follower can act on. Nothing else does: an error body from
      // below can name a table, a slug, a replica or a provider.
      if (error.code === "room_free_cap_reached" && error.details) {
        payload.messages_included = error.details.messages_included;
      }
      return res.status(error.status).json(payload);
    }
    if (error instanceof AuthError) {
      return res.status(error.status || 401).json({ error: error.code });
    }
    console.error("[room] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "room_failure" });
  }
}
