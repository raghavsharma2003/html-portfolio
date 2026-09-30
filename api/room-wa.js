// The Room's WhatsApp webhook - the HTTP half of WS-R29.
//
// Thin by construction, api/room-tg.js's own shape one channel over: every
// decision lives in api/_room-whatsapp.js, where a fake db and a fake fetch
// can reach it. This file is verify, dispatch, respond, and nothing else.
//
// Registered with Meta (out of band, an operator's own step, NOT run by this
// repo) as the Cloud API webhook callback for the SAME WhatsApp Business
// number `api/whatsapp.js` already names via WHATSAPP_ACCESS_TOKEN/
// WHATSAPP_PHONE_NUMBER_ID (workstream law: reuse, never invent a parallel
// credential pair). NOT PROVEN: whether Meta's own webhook subscription
// model permits routing that number's callbacks to TWO different URLs
// (this file and api/whatsapp.js) at once - if it does not, an operator must
// either merge the two doors behind one URL or register a second WABA number
// for Rooms. Left as a named open item rather than guessed at.
//
// Always 200 once the request is AUTHENTICATED - Meta retries on a non-2xx,
// and this door writes nothing a redelivery could double-write (workstream
// law #6: no conversation is ever persisted on this wire, so there is
// nothing here for a duplicate delivery to corrupt beyond sending the same
// one-line auto-reply twice, which `deps.now`-scoped `noteInbound` already
// makes an idempotent no-op for Meta's own window check).
import { allow, ipOf } from "./_ratelimit.js";
import { consume } from "./_rate-limit.js";
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { verifyRoomWhatsappWebhook, handleStatusWebhook } from "./_room-whatsapp.js";
// WS-R104. Behind ROOM_WHATSAPP_CHAT=1 only — unset, this file's own inbound
// branch is byte-for-byte what it always was (`handleStatusWebhook`'s auto
// reply, api/_room-whatsapp.js's own workstream law #6: no conversation on
// this wire). `whatsappChatEnabled` reads the SAME env var
// `api/_room-whatsapp-chat.js` itself gates every entry point on, so this
// file can never disagree with that module about whether the lane exists.
import { whatsappChatEnabled, handleRoomWhatsappChatWebhook } from "./_room-whatsapp-chat.js";

/** Raw bytes are required for the HMAC - see api/whatsapp.js's own config,
 *  reused verbatim: this webhook needs Vercel's body parser disabled. */
export const config = { api: { bodyParser: false } };

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  // IP first, so an unauthenticated flood costs no database round trip -
  // api/room-tg.js's own ordering, restated.
  if (!allow(ipOf(req), "room_wa", 120)) return res.status(429).json({ error: "slow_down" });

  // THE HMAC CHECK RUNS FIRST (WS-R26 law #5) - an unsigned flood must not
  // even count against the persistent counter below. `verifyRoomWhatsappWebhook`
  // is `api/whatsapp.js`'s own `verify()`, reused rather than re-derived, so
  // this door can never silently drift from Meta's real algorithm.
  const auth = await verifyRoomWhatsappWebhook(req);
  if (!auth.ok) return res.status(auth.respond?.status ?? 401).json({ error: auth.reason });
  if (auth.respond) {
    // The GET handshake - echo hub.challenge as plain text.
    if (auth.respond.contentType) res.setHeader?.("Content-Type", auth.respond.contentType);
    return res.status(auth.respond.status).send
      ? res.status(auth.respond.status).send(auth.respond.body)
      : res.status(auth.respond.status).json(auth.respond.body);
  }

  const gate = await consume(q, { scope: "room_wa_ip", key: ipOf(req) });
  if (!gate.ok) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return res.status(429).json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
  }

  try {
    // WS-R104: the SAME return shape either way (`{statuses, replies}`), so
    // this response body never has to know which branch answered it —
    // `handleRoomWhatsappChatWebhook`'s own header states why it was built
    // to match. `fetch: globalThis.fetch` threaded explicitly, this
    // platform's own standing convention (`api/checkins-sweep.js`'s
    // identical line) rather than a business-logic module ever assuming a
    // global.
    const out = whatsappChatEnabled(process.env)
      ? await handleRoomWhatsappChatWebhook(auth.payload, { db: q, fetch: globalThis.fetch })
      : await handleStatusWebhook(auth.payload, { db: q });
    return res.status(200).json({ ok: true, statuses: out.statuses, replies: out.replies });
  } catch (e) {
    console.error("[room-wa] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true, handled: false });
  }
}

export default withDoor(q, "room-wa.js", handler);
