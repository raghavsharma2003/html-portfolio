import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../src/canonical.js";
import {
  cleanupExpiredLivenessSessions,
  createLivenessSession,
  deleteLivenessSession,
  getLivenessResult,
  resumeLivenessSession,
} from "../src/liveness.js";
import { openSession } from "../src/seal.js";

const NOW = new Date("2026-08-24T10:00:00.000Z");
const IMAGE = Buffer.alloc(2_048, 0x8a);
const SHA = sha256(IMAGE);
const SESSION_ID = "40000000-0000-4000-8000-000000000004";
const LINK_ID = "50000000-0000-4000-8000-000000000005";
const SEAL_KEY = Buffer.alloc(32, 22);

function config() {
  return Object.freeze({
    protocol: "vyakti-azure-identity-broker/v1",
    version: "identity-2026.08.24+1",
    hmacKey: Buffer.alloc(32, 1),
    sourceOrigin: "https://project.supabase.co",
    face: Object.freeze({
      endpoint: "https://vyakti-face.cognitiveservices.azure.com",
      key: "face-key",
      apiVersion: "v1.2",
    }),
    liveness: Object.freeze({
      enabled: true,
      erasureEnabled: true,
      protocol: "vyakti-azure-liveness-session-broker/v1",
      modelVersion: "2025-05-20",
      verifyThreshold: 0.9,
      sessionTtlSeconds: 300,
      sealKey: SEAL_KEY,
      returnUrl: "https://vyakti.example/studio?liveness=return",
      quickLinkEndpoint: "https://liveness.face.azure.com/api/quicklink",
      quickLinkOrigin: "https://liveness.face.azure.com",
      cleanupApiVersion: "v1.2-preview.1",
    }),
    limits: Object.freeze({
      mediaBytes: 8 * 1_024 * 1_024,
      providerBytes: 1_048_576,
      mediaDeadlineMs: 2_000,
      providerDeadlineMs: 2_000,
    }),
  });
}

function createPayload() {
  return {
    protocol: "vyakti-azure-liveness-session-broker/v1",
    request_id: "10000000-0000-4000-8000-000000000001:1",
    challenge_id: "10000000-0000-4000-8000-000000000001",
    replica_id: "20000000-0000-4000-8000-000000000002",
    device_correlation_id: "30000000-0000-4000-8000-000000000003",
    verifier_version: "identity-2026.08.24+1",
    identity_reference: {
      url: "https://project.supabase.co/storage/v1/object/sign/replica-private/id?token=opaque",
      expires_at: "2026-08-24T10:02:00.000Z",
      sha256: SHA,
      byte_size: IMAGE.length,
      mime: "image/jpeg",
    },
  };
}

function boundPayload(sessionHandle) {
  return {
    protocol: "vyakti-azure-liveness-session-broker/v1",
    request_id: "10000000-0000-4000-8000-000000000001:1",
    challenge_id: "10000000-0000-4000-8000-000000000001",
    replica_id: "20000000-0000-4000-8000-000000000002",
    verifier_version: "identity-2026.08.24+1",
    session_handle: sessionHandle,
  };
}

function sessionProviders(options = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://project.supabase.co/")) {
      return new Response(IMAGE, { headers: { "content-type": "image/jpeg", "content-length": String(IMAGE.length) } });
    }
    if (url.endsWith("/detectLivenessWithVerify-sessions") && init.method === "POST") {
      const parametersPart = init.body.get("Parameters");
      const parameters = JSON.parse(await parametersPart.text());
      assert.deepEqual(parameters, {
        livenessOperationMode: "PassiveActive",
        deviceCorrelationId: "30000000-0000-4000-8000-000000000003",
        deviceCorrelationIdSetInClient: false,
        enableSessionImage: false,
        authTokenTimeToLiveInSeconds: 300,
        livenessModelVersion: "2025-05-20",
        returnVerifyImageHash: true,
        verifyConfidenceThreshold: 0.9,
      });
      assert.equal(init.body.get("VerifyImage").size, IMAGE.length);
      return Response.json({
        sessionId: SESSION_ID,
        authToken: "private-session-authorization-token-value",
        status: "NotStarted",
        modelVersion: options.modelVersion || "2025-05-20",
        results: { verifyReferences: [{ referenceType: "image", qualityForRecognition: "high" }], attempts: [] },
      });
    }
    if (url === "https://liveness.face.azure.com/api/quicklink") {
      assert.equal(init.headers.Authorization, "Bearer private-session-authorization-token-value");
      if (options.quickLinkFailure) return Response.json({ error: "down" }, { status: 503 });
      return Response.json({ url: `/?s=${LINK_ID}` });
    }
    if (url.endsWith(`/detectLivenessWithVerify-sessions/${SESSION_ID}`) && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  return { calls, fetchImpl };
}

async function createSession(providers = sessionProviders()) {
  const result = await createLivenessSession(createPayload(), config(), {
    fetchImpl: providers.fetchImpl,
    now: NOW,
    nonce: Buffer.alloc(12, 4),
  });
  return { providers, result };
}

test("official liveness-with-verify session is pinned, short-lived, image-bound and exchanged for a one-time Azure link", async () => {
  const { result } = await createSession();
  assert.equal(result.reference_sha256, SHA);
  assert.equal(result.session_expires_at, "2026-08-24T10:05:00.000Z");
  assert.equal(result.model_version, "2025-05-20");
  const link = new URL(result.quick_link_url);
  assert.equal(link.origin, "https://liveness.face.azure.com");
  assert.equal(link.searchParams.get("s"), LINK_ID);
  assert.equal(link.searchParams.get("callbackUrl"), "https://vyakti.example/studio?liveness=return");
  const sealed = openSession(result.session_handle, SEAL_KEY);
  assert.equal(sealed.sessionId, SESSION_ID);
  assert.equal(sealed.referenceSha256, SHA);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(SESSION_ID), false);
  assert.equal(serialized.includes("authorization-token"), false);
  assert.equal(serialized.includes("opaque"), false);
});

test("an encrypted provider authorization can reissue a lost one-time link without creating another Face session", async () => {
  const { result: session } = await createSession();
  const providers = sessionProviders();
  const resumed = await resumeLivenessSession(boundPayload(session.session_handle), config(), {
    fetchImpl: providers.fetchImpl,
    now: new Date("2026-08-24T10:01:00.000Z"),
  });
  assert.equal(resumed.session_handle, session.session_handle);
  assert.equal(resumed.session_expires_at, session.session_expires_at);
  assert.equal(new URL(resumed.quick_link_url).searchParams.get("s"), LINK_ID);
  assert.equal(providers.calls.some((call) => call.url.endsWith("/detectLivenessWithVerify-sessions")), false);
  await assert.rejects(
    resumeLivenessSession(boundPayload(session.session_handle), config(), {
      fetchImpl: providers.fetchImpl,
      now: new Date("2026-08-24T10:05:00.000Z"),
    }),
    (error) => error.code === "liveness_session_resume_expired",
  );
});

test("terminal result chooses the highest attempt id and binds Azure's verify hash to the exact ID image", async () => {
  const { result: session } = await createSession();
  const digest = "b".repeat(64);
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.method, "GET");
    assert.ok(String(url).endsWith(`/detectLivenessWithVerify-sessions/${SESSION_ID}`));
    return Response.json({
      sessionId: SESSION_ID,
      authToken: "must-never-leave-service",
      status: "Succeeded",
      modelVersion: "2025-05-20",
      results: {
        verifyReferences: [{ referenceType: "image", qualityForRecognition: "high" }],
        attempts: [
          {
            attemptId: 2,
            attemptStatus: "Succeeded",
            result: { livenessDecision: "realface", digest: digest.toUpperCase(), verifyImageHash: SHA.toUpperCase() },
            verifyResult: { isIdentical: true, matchConfidence: 0.94 },
          },
          { attemptId: 1, attemptStatus: "Failed", error: { code: "FaceWithMaskDetected", message: "private detail" } },
        ],
      },
    });
  };
  const proof = await getLivenessResult(boundPayload(session.session_handle), config(), { fetchImpl, now: NOW });
  assert.deepEqual(proof, {
    request_id: "10000000-0000-4000-8000-000000000001:1",
    reference_sha256: SHA,
    provider_accepted: true,
    terminal: true,
    passed: true,
    liveness_passed: true,
    identity_match: true,
    identity_score: 0.94,
    provider_digest: digest,
    verify_image_hash: SHA,
    failure_code: "",
    model_version: "2025-05-20",
  });
  assert.equal(JSON.stringify(proof).includes("authToken"), false);
  assert.equal(JSON.stringify(proof).includes("private detail"), false);
});

test("failed provider attempts return only a normalized content-free reason", async () => {
  const { result: session } = await createSession();
  const proof = await getLivenessResult(boundPayload(session.session_handle), config(), {
    now: NOW,
    fetchImpl: async () => Response.json({
      sessionId: SESSION_ID,
      status: "Failed",
      modelVersion: "2025-05-20",
      results: {
        verifyReferences: [{ qualityForRecognition: "high" }],
        attempts: [{ attemptId: 1, attemptStatus: "Failed", error: { code: "FaceWithMaskDetected", message: "do not persist" } }],
      },
    }),
  });
  assert.equal(proof.failure_code, "face_with_mask_detected");
  assert.equal(JSON.stringify(proof).includes("do not persist"), false);
});

test("verify-image hash mismatch and a tampered sealed handle fail closed", async () => {
  const { result: session } = await createSession();
  const badResult = async () => Response.json({
    sessionId: SESSION_ID,
    status: "Succeeded",
    modelVersion: "2025-05-20",
    results: {
      verifyReferences: [{ qualityForRecognition: "high" }],
      attempts: [{
        attemptId: 1,
        attemptStatus: "Succeeded",
        result: { livenessDecision: "realface", digest: "c".repeat(64), verifyImageHash: "d".repeat(64) },
        verifyResult: { isIdentical: true, matchConfidence: 0.99 },
      }],
    },
  });
  await assert.rejects(
    getLivenessResult(boundPayload(session.session_handle), config(), { fetchImpl: badResult, now: NOW }),
    (error) => error.code === "face_liveness_evidence_binding_invalid",
  );
  const tampered = `${session.session_handle.slice(0, -1)}${session.session_handle.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(
    getLivenessResult(boundPayload(tampered), config(), { fetchImpl: badResult, now: NOW }),
    (error) => error.code === "liveness_session_handle_invalid",
  );
});

test("quick-link exchange failure and model drift trigger immediate Azure-session deletion", async () => {
  for (const providers of [sessionProviders({ quickLinkFailure: true }), sessionProviders({ modelVersion: "moving-latest" })]) {
    await assert.rejects(createLivenessSession(createPayload(), config(), {
      fetchImpl: providers.fetchImpl, now: NOW, nonce: Buffer.alloc(12, 4),
    }));
    assert.equal(providers.calls.some((call) => call.init.method === "DELETE"), true);
  }
});

test("session deletion is explicit, idempotent at the Azure boundary and returns no provider handle", async () => {
  const { result: session } = await createSession();
  const providers = sessionProviders();
  const deleted = await deleteLivenessSession(boundPayload(session.session_handle), config(), {
    fetchImpl: providers.fetchImpl, now: NOW,
  });
  assert.deepEqual(deleted, {
    request_id: "10000000-0000-4000-8000-000000000001:1",
    reference_sha256: SHA,
    provider_deleted: true,
  });
});

test("dedicated-resource cleanup enumerates bounded preview pages and deletes only expired sessions", async () => {
  const liveId = "60000000-0000-4000-8000-000000000006";
  const calls = [];
  const result = await cleanupExpiredLivenessSessions({
    protocol: "vyakti-azure-liveness-session-broker/v1",
    verifier_version: "identity-2026.08.24+1",
    request_id: "cleanup:70000000-0000-4000-8000-000000000007",
  }, config(), {
    now: NOW,
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/v1.2-preview.1/detectLivenessWithVerify/singleModal/sessions?")) {
        return Response.json([
          { id: SESSION_ID, sessionExpired: true },
          { id: liveId, sessionExpired: false },
        ]);
      }
      if (url.endsWith(`/detectLivenessWithVerify-sessions/${SESSION_ID}`) && init.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  assert.deepEqual(result, {
    request_id: "cleanup:70000000-0000-4000-8000-000000000007",
    provider_accepted: true,
    cleanup_api_version: "v1.2-preview.1",
    exhaustive: true,
    scan_started_at: NOW.toISOString(),
    sessions_scanned: 2,
    expired_sessions_deleted: 1,
  });
  assert.equal(calls.filter((call) => call.init.method === "DELETE").length, 1);
  assert.equal(calls.some((call) => call.url.endsWith(liveId) && call.init.method === "DELETE"), false);
});
