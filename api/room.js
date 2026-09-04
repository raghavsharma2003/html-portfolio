// The Room's endpoint - the HTTP half of WS-R1.
//
//   POST /api/room {op:"open",   room:"<slug>"}                -> card + state
//   POST /api/room {op:"join",   room, age_18, remember}       -> session
//   POST /api/room {op:"say",    session, message, thread, transcript}
//   POST /api/room {op:"speak",  session, text}                -> paid voice (WS-R19)
//   POST /api/room {op:"history",session, thread}
//   POST /api/room {op:"thread", session, title}
//   POST /api/room {op:"locale", session, locale}         -> {locale, session}
//   POST /api/room {op:"pulse_optin",  session, thread}   -> "let this count"
//   POST /api/room {op:"pulse_revoke", session, thread}   -> turn it back off
//   POST /api/room {op:"push_subscribe",   session, endpoint, p256dh, auth}
//   POST /api/room {op:"push_unsubscribe", session, endpoint}
//   POST /api/room {op:"push_status",      session}       -> {subscribed}
//   POST /api/room {op:"citations", session}
//   POST /api/room {op:"stats",  room:"<slug>"}
//   POST /api/room {op:"export", session}
//   POST /api/room {op:"forget", session}
//
// `speak` exists only behind `ROOM_VOICE=1` (WS-R19). Unset, it 404s exactly
// like `unknown_op` - a follower asking for voice on a deployment that has
// not turned it on gets the same indistinguishable answer any other absent
// capability gets here, never a hint that the code exists but is switched
// off. Its real dependencies (`deps.synth`/`deps.protect`) are the SAME
// modules `api/voice-preview.js` already wires to the studio panel - reused,
// never forked - so with no `AZURE_OPEN_VOICE_ORIGIN` configured this op
// 503s "not configured" exactly as the panel already does, never a live GPU
// call (`api/_room-voice.js`'s header, "NO GPU WAKES").
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
  roomSpeak,
  roomSetLocale,
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
import { PulseError, setOptIn, revoke as revokePulseOptIn } from "./_pulse.js";
import { setSubscription, removeSubscription, subscriptionStatus } from "./_room-push.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { createOpenChatterboxPreviewProvider } from "./_voice/providers/open-chatterbox-preview.js";
import { createNeonVoicePreviewLedger } from "./_replica-voice-preview.js";
import { readPrivateReplicaObject } from "./_replica-storage.js";

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
      // WS-R24: a browser hint, consulted only when no follower row exists
      // yet to answer the question instead - `openRoom`'s own header.
      const opened = await openRoom(q, { slug: body.room, authUserId, locale: body.locale });
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
        // WS-R24: the exact locale the client's `open` call was just told to
        // render the join screen in, passed back rather than re-derived.
        locale: body.locale,
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

    if (op === "speak") {
      // Unset means off, everywhere, immediately - `roomSession`'s own
      // posture for its signing key, one flag over. Falling through to
      // `unknown_op` rather than a dedicated "voice is off" code: a follower
      // asking a deployment that never turned this on gets the same
      // indistinguishable answer any other absent capability gets here.
      if (String(process.env.ROOM_VOICE || "") !== "1") {
        return res.status(400).json({ error: "unknown_op" });
      }
      // The SAME real modules api/voice-preview.js wires to the studio panel
      // - constructed here, never forked, so a missing
      // AZURE_OPEN_VOICE_ORIGIN or HMAC secret fails this op exactly the way
      // it already fails the panel (caught below), and a follower's clip
      // always leaves through the identical watermark path a creator's own
      // preview does. Construction can itself throw (an absent env var), so
      // it sits INSIDE the same catch as the call below - `api/voice-
      // preview.js`'s own shape, where the whole request is one try.
      let turn;
      try {
        const provider = createOpenChatterboxPreviewProvider();
        const protection = createProductionProtectionAdapters({ db: q });
        const roomVoiceDeps = {
          db: q,
          env: process.env,
          synth: async ({ authorized, text: spoken }) => {
            const stored = await readPrivateReplicaObject(authorized.reference, {
              maxBytes: 20 * 1024 * 1024,
              timeoutMs: 30_000,
            });
            return provider.synthesizePreview({
              requestId: authorized.generation.generation_id,
              text: spoken,
              languageId: authorized.generation.preview_language_id,
              seed: authorized.previewSeed,
              reference: {
                bytes: stored.body,
                sha256: authorized.reference.sha256,
                durationMs: authorized.reference.durationMs,
                languageMode: authorized.reference.languageMode,
                languageEvidenceScope: authorized.reference.languageEvidenceScope,
              },
              style: {
                exaggeration: authorized.previewStyle.exaggeration,
                cfgWeight: authorized.previewStyle.cfg_weight,
                temperature: authorized.previewStyle.temperature,
              },
            });
          },
          protect: (input) => protectReplicaStream({
            ...input,
            adapters: Object.freeze({ ...protection, ledger: createNeonVoicePreviewLedger(q) }),
          }),
        };
        turn = await roomSpeak(roomVoiceDeps, body.session, { text: body.text });
      } catch (error) {
        if (error instanceof RoomError) throw error;
        // A configuration absence (no origin, no HMAC secret) fails closed
        // inside `createOpenChatterboxPreviewProvider`/
        // `createProductionProtectionAdapters` with a named `*_required`/
        // `*_invalid`/`*_not_configured` code - `api/voice-preview.js`'s own
        // class, reused verbatim rather than re-derived, so the two routes
        // can never disagree about what "not configured" looks like.
        const code = String(error?.code || "");
        const configAbsent =
          /_(origin|secret|key|endpoint|url)_(required|invalid)$/.test(code) ||
          /_not_configured$/.test(code);
        throw new RoomError(configAbsent ? "room_voice_not_configured" : "room_voice_failed", 503);
      }
      obsBestEffort("room.speak", { seconds: turn.voice.seconds_used });
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

    if (op === "locale") {
      // WS-R24: scope comes off the session exactly as "thread"/"pulse_optin"
      // do - there is no `person`/`room` field here for a client to set,
      // because `roomSetLocale` reads all three off the verified token.
      return res.status(200).json(await roomSetLocale(q, { session: body.session, locale: body.locale }));
    }

    if (op === "pulse_optin" || op === "pulse_revoke") {
      // Scope comes off the session exactly as "thread" does above; `thread`
      // here is optional and, when present, is checked against the caller's
      // OWN threads inside api/_pulse.js before anything is written.
      const optin = op === "pulse_optin"
        ? await setOptIn(q, { session: body.session, threadId: body.thread || null })
        : await revokePulseOptIn(q, { session: body.session, threadId: body.thread || null });
      return res.status(200).json(optin);
    }

    if (op === "push_subscribe") {
      // WS-R22. Scope comes off the session exactly as "thread"/"pulse_optin"
      // do above; the endpoint/keys are a browser's own PushSubscription,
      // never trusted for identity — only for where to send.
      const subscribed = await setSubscription(q, {
        session: body.session,
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
        userAgent: req.headers?.["user-agent"],
      });
      return res.status(200).json(subscribed);
    }

    if (op === "push_unsubscribe") {
      const removed = await removeSubscription(q, { session: body.session, endpoint: body.endpoint });
      return res.status(200).json(removed);
    }

    if (op === "push_status") {
      return res.status(200).json(await subscriptionStatus(q, { session: body.session }));
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
    if (error instanceof PulseError) {
      return res.status(error.status).json({ error: error.code });
    }
    if (error instanceof AuthError) {
      return res.status(error.status || 401).json({ error: error.code });
    }
    console.error("[room] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "room_failure" });
  }
}
