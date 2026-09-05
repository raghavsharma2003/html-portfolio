// The Room on Telegram's webhook - the HTTP half of WS-R18.
//
// Thin by construction, `api/room.js`/`api/tg.js`'s own shape: every decision
// lives in api/_room-telegram.js, where a fake db and a fake Telegram client
// can reach it. This file is verify, dispatch, respond, and nothing else.
//
// Registered with Telegram as:
//
//   POST https://api.telegram.org/bot<ROOM_TELEGRAM_BOT_TOKEN>/setWebhook
//     url            = https://<deployment>/api/room-tg
//     secret_token   = <ROOM_TELEGRAM_WEBHOOK_SECRET>
//     allowed_updates= ["message","callback_query"]
//
// Always 200 once the update is AUTHENTICATED AND ADMITTED - Telegram retries
// on a non-2xx, and a 500 from PROCESSING here would redeliver the same
// update forever, re-running every write it triggered. An unauthenticated
// request never reaches that far: the secret check below returns its own
// status (503 unconfigured, 401 wrong secret) before a single byte of the
// body is trusted. WS-R26 adds one more pre-processing exit, deliberately
// still capable of a non-200: the persistent abuse gate below. A 429 there is
// not a processing failure being churned - it is the intended shape (an
// honest "slow down", retried later per Telegram's own policy, workstream
// law #5), and it costs no write of ours to redeliver.
import { allow, ipOf } from "./_ratelimit.js";
import { consume } from "./_rate-limit.js";
import { q } from "./_db.js";
import { verifyRoomTelegramWebhook, handleRoomTelegramUpdate } from "./_room-telegram.js";
import { bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // IP first, so an unauthenticated flood costs no database round trip.
  if (!allow(ipOf(req), "room_tg", 120)) return res.status(429).json({ error: "slow_down" });

  // WS-R26: the HMAC check runs FIRST (law 5) - an unsigned flood must not
  // even count against the persistent counter below.
  const auth = verifyRoomTelegramWebhook(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason });

  const gate = await consume(q, { scope: "room_tg_ip", key: ipOf(req) });
  if (!gate.ok) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return res.status(429).json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
  }

  // WS-R89: the one shared cap every POST door checks — this one has no
  // raw-body reader of its own (unlike the three webhook doors, which cap
  // at 1MB before `req.body` even exists), so it checks the parsed body
  // directly, same as every other door.
  if (bodyTooLarge(req.body || {}, ROOM_DOOR_BODY_CAP_BYTES)) {
    return res.status(413).json({ error: "body_too_large" });
  }

  try {
    const out = await handleRoomTelegramUpdate(req.body || {}, { db: q });
    return res.status(200).json({ ok: true, handled: out?.ok !== false });
  } catch (e) {
    console.error("[room-tg] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true, handled: false });
  }
}
