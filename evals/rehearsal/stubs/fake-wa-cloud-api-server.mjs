// WS-R119 (wave seventeen, third pass). A fake WhatsApp Cloud API server —
// the ONE place `api/_room-whatsapp.js::sendSessionMessage` actually reaches
// on the network (`CLOUD_API = "https://graph.facebook.com/v21.0"`, a
// hard-coded constant with no env override, confirmed by grep). The follower
// rehearsal's own WhatsApp step remaps that host to THIS server's own
// `127.0.0.1` origin (`harness.mjs`'s own `setNetworkRemap`) before driving
// a real join through the real `api/room-wa.js` door, so every outbound
// button card and reply this rehearsal asserts on is the byte-for-byte body
// the real sender built, never a hand-typed stand-in for it.
//
// Answers every `POST /<version>/<phone-number-id>/messages` with Meta's own
// real response shape (`{messaging_product, contacts, messages:[{id}]}`, a
// 200) so `sendSessionMessage`'s own `res.ok` check passes — never a fake
// that only proves the CALLER never noticed a failure.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * `{ url, sent, stop }` — `sent` is a live array, pushed to for every POST
 * this server receives, each entry `{ path, headers, body }` with `body`
 * already JSON-parsed (the Cloud API's own wire format, never multipart).
 */
export async function startFakeWaCloudApiServer() {
  const sent = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try { body = JSON.parse(raw); } catch { /* keep {} — a malformed body still records a call */ }
    sent.push({ path: req.url, headers: { ...req.headers }, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      messaging_product: "whatsapp",
      contacts: [{ input: String(body?.to || ""), wa_id: String(body?.to || "") }],
      messages: [{ id: `wamid.rehearsal.${randomUUID()}` }],
    }));
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
