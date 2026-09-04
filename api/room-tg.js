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
// Always 200 once the update is AUTHENTICATED - Telegram retries on a
// non-2xx, and a 500 here would redeliver the same update forever, re-running
// every write it triggered. An unauthenticated request never reaches that
// far: the secret check below returns its own status (503 unconfigured, 401
// wrong secret) before a single byte of the body is trusted.
import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
import { verifyRoomTelegramWebhook, handleRoomTelegramUpdate } from "./_room-telegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // IP first, so an unauthenticated flood costs no database round trip.
  if (!allow(ipOf(req), "room_tg", 120)) return res.status(429).json({ error: "slow_down" });

  const auth = verifyRoomTelegramWebhook(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason });

  try {
    const out = await handleRoomTelegramUpdate(req.body || {}, { db: q });
    return res.status(200).json({ ok: true, handled: out?.ok !== false });
  } catch (e) {
    console.error("[room-tg] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true, handled: false });
  }
}
