// WS-R119 (wave seventeen, third pass). A fake Telegram Bot API server —
// the ONE place `api/_room-telegram.js`'s own outbound client
// (`tgCall`/`tgSendVoice`) reaches on the network
// (`https://api.telegram.org/bot<token>/<method>`, a hard-coded constant
// with no env override, confirmed by grep). The follower rehearsal's own
// Telegram step remaps that host to THIS server's own `127.0.0.1` origin
// (`harness.mjs`'s own `setNetworkRemap`) before driving a real `/start`,
// callbacks and an ordinary message through the real `api/room-tg.js` door,
// so `sendVoice`'s own multipart body is the real bytes the real sender
// built.
//
// No multipart PARSER — this file records the raw request bytes and content-
// type header for `sendVoice`, and the JSON body for every other method, and
// answers every call with Telegram's own real response shape (`{ok:true,
// result:{message_id}}`) so the caller's own `j?.ok === true` check passes.
import { createServer } from "node:http";

/**
 * `{ url, sent, stop }` — `sent` is a live array, one entry per call:
 * `{ method, contentType, json }` for `sendMessage`/`answerCallbackQuery`/
 * `sendDocument` (JSON body), or `{ method, contentType, raw }` for
 * `sendVoice` (the RAW multipart bytes, `contentType` carrying the boundary
 * a scenario can grep `raw` against for `name="voice"`/`filename="reply.wav"`
 * without a full multipart parser).
 */
export async function startFakeTgBotApiServer() {
  const sent = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const match = /^\/bot[^/]+\/([A-Za-z]+)$/.exec(req.url || "");
    const method = match ? match[1] : "unknown";
    const contentType = String(req.headers["content-type"] || "");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (contentType.startsWith("multipart/form-data")) {
      sent.push({ method, contentType, raw });
    } else {
      let json = {};
      try { json = JSON.parse(raw.toString("utf8")); } catch { /* keep {} */ }
      sent.push({ method, contentType, json });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { message_id: sent.length, chat: { id: 0 } } }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const bound = server.address();
  return {
    url: `http://127.0.0.1:${bound.port}`,
    sent,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
