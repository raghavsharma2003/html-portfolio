import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { canonicalJson, hmac, validHmac } from "../src/canonical.js";
import { createVerifierServer } from "../src/server.js";

const KEY = Buffer.alloc(32, 9);
const CONFIG = Object.freeze({
  protocol: "vyakti-azure-identity-broker/v1",
  version: "identity-2026.08.24+1",
  hmacKey: KEY,
  limits: Object.freeze({ requestBytes: 65_536, totalDeadlineMs: 2_000, concurrency: 1 }),
});

async function withServer(run) {
  const server = createVerifierServer(CONFIG, {
    now: () => Date.parse("2026-08-24T10:00:00.000Z"),
    verify: async (payload) => ({ request_id: payload.request_id, input_sha256: "a".repeat(64), provider_accepted: true }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("broker authenticates canonical requests, signs content-free responses and rejects replay", async () => {
  await withServer(async (origin) => {
    const body = canonicalJson({ request_id: "case:1" });
    const headers = {
      "content-type": "application/json",
      "x-vyakti-protocol": CONFIG.protocol,
      "x-vyakti-signature": `sha256=${hmac(KEY, body)}`,
    };
    const accepted = await fetch(`${origin}/v1/identity/verify`, { method: "POST", headers, body });
    const acceptedBody = await accepted.text();
    assert.equal(accepted.status, 200);
    assert.equal(validHmac(KEY, acceptedBody, accepted.headers.get("x-vyakti-response-signature")), true);
    assert.deepEqual(JSON.parse(acceptedBody), {
      input_sha256: "a".repeat(64), provider_accepted: true, request_id: "case:1",
    });

    const replay = await fetch(`${origin}/v1/identity/verify`, { method: "POST", headers, body });
    const replayBody = await replay.text();
    assert.equal(replay.status, 409);
    assert.equal(validHmac(KEY, replayBody, replay.headers.get("x-vyakti-response-signature")), true);
    assert.deepEqual(JSON.parse(replayBody), { error: "request_replayed" });
  });
});

test("broker rejects a tampered body and does not expose exception text", async () => {
  await withServer(async (origin) => {
    const signed = canonicalJson({ request_id: "case:2" });
    const response = await fetch(`${origin}/v1/identity/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vyakti-protocol": CONFIG.protocol,
        "x-vyakti-signature": `sha256=${hmac(KEY, signed)}`,
      },
      body: canonicalJson({ request_id: "case:3" }),
    });
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(body), { error: "request_signature_invalid" });
    assert.equal(validHmac(KEY, body, response.headers.get("x-vyakti-response-signature")), true);
  });
});
