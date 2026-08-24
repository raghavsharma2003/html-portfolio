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
  liveness: Object.freeze({ enabled: true, erasureEnabled: true, protocol: "vyakti-azure-liveness-session-broker/v1" }),
  limits: Object.freeze({ requestBytes: 65_536, totalDeadlineMs: 2_000, concurrency: 4 }),
});

const ISSUED_AT = "2026-08-24T10:00:00.000Z";

function envelope(payload, nonce = "1".repeat(32)) {
  return { ...payload, broker_nonce: nonce, broker_issued_at: ISSUED_AT };
}

function request(origin, path, protocol, payload) {
  const body = canonicalJson(payload);
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vyakti-protocol": protocol,
      "x-vyakti-signature": `sha256=${hmac(KEY, body)}`,
    },
    body,
  });
}

async function withServer(run, options = {}) {
  const serverConfig = options.config || CONFIG;
  const serverOptions = { ...options };
  delete serverOptions.config;
  const server = createVerifierServer(serverConfig, {
    now: () => Date.parse("2026-08-24T10:00:00.000Z"),
    verify: async (payload) => ({ request_id: payload.request_id, input_sha256: "a".repeat(64), provider_accepted: true }),
    ...serverOptions,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

test("emergency creation shutdown leaves authenticated Face cleanup available", async () => {
  const erasureOnly = Object.freeze({
    ...CONFIG,
    liveness: Object.freeze({
      enabled: false,
      erasureEnabled: true,
      protocol: CONFIG.liveness.protocol,
    }),
  });
  await withServer(async (origin) => {
    const create = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol,
      envelope({ request_id: "session:shutdown" }, "c".repeat(32)));
    assert.equal(create.status, 503);
    const cleanup = await request(origin, "/v1/liveness/cleanup", CONFIG.liveness.protocol,
      envelope({ request_id: "cleanup:shutdown" }, "d".repeat(32)));
    assert.equal(cleanup.status, 200);
    assert.deepEqual(await cleanup.json(), { request_id: "cleanup:shutdown", provider_accepted: true });
  }, {
    config: erasureOnly,
    cleanupLiveness: async (payload) => ({ request_id: payload.request_id, provider_accepted: true }),
  });
});

test("broker authenticates canonical requests, signs content-free responses and rejects replay", async () => {
  await withServer(async (origin) => {
    const body = canonicalJson(envelope({ request_id: "case:1" }));
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
    const signed = canonicalJson(envelope({ request_id: "case:2" }, "2".repeat(32)));
    const response = await fetch(`${origin}/v1/identity/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vyakti-protocol": CONFIG.protocol,
        "x-vyakti-signature": `sha256=${hmac(KEY, signed)}`,
      },
      body: canonicalJson(envelope({ request_id: "case:3" }, "3".repeat(32))),
    });
    const body = await response.text();
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(body), { error: "request_signature_invalid" });
    assert.equal(validHmac(KEY, body, response.headers.get("x-vyakti-response-signature")), true);
  });
});

test("session creation is idempotent across fresh retry envelopes", async () => {
  let creates = 0;
  await withServer(async (origin) => {
    const first = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol,
      envelope({ request_id: "session:1", replica_id: "replica:1" }, "4".repeat(32)));
    const second = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol,
      envelope({ request_id: "session:1", replica_id: "replica:1" }, "5".repeat(32)));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(creates, 1);
    assert.equal(await second.text(), await first.text());
  }, {
    createLiveness: async (payload) => {
      creates++;
      return { request_id: payload.request_id, quick_link_url: "https://liveness.face.azure.com/?s=session" };
    },
  });
});

test("session idempotency binds stable evidence semantics rather than rotating signed-read capabilities", async () => {
  let creates = 0;
  await withServer(async (origin) => {
    const stable = {
      request_id: "session:capability-rotation",
      replica_id: "replica:1",
      device_correlation_id: "device:1",
      identity_reference: { sha256: "a".repeat(64), byte_size: 2048, mime: "image/jpeg" },
    };
    const first = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol, envelope({
      ...stable,
      identity_reference: { ...stable.identity_reference, url: "https://private/one", expires_at: "2026-08-24T10:02:00.000Z" },
    }, "a".repeat(32)));
    const second = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol, envelope({
      ...stable,
      identity_reference: { ...stable.identity_reference, url: "https://private/two", expires_at: "2026-08-24T10:03:00.000Z" },
    }, "b".repeat(32)));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(creates, 1);
    assert.equal(await second.text(), await first.text());
  }, {
    createLiveness: async (payload) => {
      creates++;
      return { request_id: payload.request_id, session_expires_at: "2026-08-24T10:05:00.000Z" };
    },
  });
});

test("session idempotency key cannot be reused for different semantics", async () => {
  await withServer(async (origin) => {
    const first = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol,
      envelope({ request_id: "session:2", replica_id: "replica:1" }, "6".repeat(32)));
    const conflict = await request(origin, "/v1/liveness/session", CONFIG.liveness.protocol,
      envelope({ request_id: "session:2", replica_id: "replica:2" }, "7".repeat(32)));
    assert.equal(first.status, 200);
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "idempotency_conflict" });
  }, { createLiveness: async (payload) => ({ request_id: payload.request_id }) });
});

test("broker rejects stale signed envelopes before any provider work", async () => {
  let calls = 0;
  await withServer(async (origin) => {
    const response = await request(origin, "/v1/identity/verify", CONFIG.protocol, {
      request_id: "case:stale",
      broker_nonce: "8".repeat(32),
      broker_issued_at: "2026-08-24T09:57:59.999Z",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "request_freshness_invalid" });
    assert.equal(calls, 0);
  }, { verify: async () => { calls++; return {}; } });
});
