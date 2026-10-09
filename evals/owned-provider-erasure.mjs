import assert from "node:assert/strict";
import {
  leaseNextVoiceErasure, completeVoiceErasure, retryVoiceErasure, runVoiceErasureSweep,
} from "../api/_replica-voice-erasure.js";
import {
  leaseNextFaceSessionCleanup, runFaceSessionCleanupSweep, deleteOwnedFaceSessionNow,
} from "../api/_replica-face-session.js";
import { createAzureFaceSessionBroker } from "../api/_face-session/providers/azure-quicklink.js";

// Offline scope and cancellation checks. SQL captures are for later EXPLAIN,
// not a claim that a mocked database parsed or executed these statements.
const captureOnly = process.argv.includes("--sql-capture");
const captures = [];
let checks = 0;
function ok(label) {
  checks += 1;
  if (!captureOnly) console.log(`ok ${checks} - ${label}`);
}
const JOB = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const OBJECT = "40000000-0000-4000-8000-000000000004";
const OTHER = "50000000-0000-4000-8000-000000000005";
const TOKEN = "owned-erasure-fixture-token-at-least-thirty-two-bytes";
const scope = Object.freeze({ jobId: JOB, replicaId: RID, ownerUserId: OWNER });
const voiceRow = {
  voice_profile_id: OBJECT, replica_id: RID, owner_user_id: OWNER,
  provider: "azure_personal_voice", provider_ref: "fixture-private-ref", erasure_attempts: 1,
  erasure_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
};
const faceRow = {
  challenge_id: OBJECT, replica_id: RID, owner_user_id: OWNER, face_session_attempt: 1,
  face_session_state: "expired_deleting", face_session_handle: "fixture-sealed-handle",
  face_session_reference_sha256: "a".repeat(64), state: "failed",
};
const broker = {
  name: "fixture", version: "fixture-v1", modelVersion: "fixture-model-v1",
  async delete() {},
  async cleanup() { throw Error("owned operation attempted global cleanup"); },
};
function scopedSql(name, sql, params, alias, offset) {
  assert.deepEqual(params.slice(offset), [JOB, RID, OWNER]);
  assert.ok(sql.includes(`${alias}.replica_id=$${offset + 2}::uuid`));
  assert.ok(sql.includes(`${alias}.owner_user_id=$${offset + 3}::uuid`));
  assert.ok(sql.includes(`owned_erasure.job_id=$${offset + 1}::uuid`));
  assert.ok(sql.includes(`owned_erasure.replica_id=${alias}.replica_id`));
  assert.ok(sql.includes(`owned_erasure.owner_user_id=${alias}.owner_user_id`));
  assert.ok(sql.includes("owned_erasure.state<>'complete'"));
  captures.push({ name, sql, params });
}
const noDb = async () => { throw Error("unexpected database operation"); };

for (const invalid of [null, {}, { ...scope, jobId: "bad" }, { replicaId: RID, ownerUserId: OWNER }]) {
  await assert.rejects(leaseNextVoiceErasure(noDb, { scope: invalid }), /erasure_scope_invalid/);
  await assert.rejects(leaseNextFaceSessionCleanup(noDb, broker, { scope: invalid }), /erasure_scope_invalid/);
  await assert.rejects(runVoiceErasureSweep({ db: noDb, scope: invalid }), /erasure_scope_invalid/);
  await assert.rejects(runFaceSessionCleanupSweep({ db: noDb, broker, scope: invalid }), /erasure_scope_invalid/);
}
ok("malformed explicit scopes fail before either database or provider dispatch");

const alreadyAborted = new AbortController();
alreadyAborted.abort(Error("owned request deadline"));
await assert.rejects(runVoiceErasureSweep({ db: noDb, scope, signal: alreadyAborted.signal }), /owned request deadline/);
await assert.rejects(runFaceSessionCleanupSweep({ db: noDb, broker, scope, signal: alreadyAborted.signal }), /owned request deadline/);
await assert.rejects(deleteOwnedFaceSessionNow(noDb, OWNER, RID, null, broker,
  { scope, signal: alreadyAborted.signal }), /owned request deadline/);
for (const providerTimeoutMs of [0, -1, NaN]) {
  await assert.rejects(runVoiceErasureSweep({ db: noDb, scope, providerTimeoutMs }), /erasure_provider_timeout_invalid/);
  await assert.rejects(runFaceSessionCleanupSweep({ db: noDb, broker, scope, providerTimeoutMs }), /erasure_provider_timeout_invalid/);
  await assert.rejects(deleteOwnedFaceSessionNow(noDb, OWNER, RID, null, broker,
    { scope, providerTimeoutMs }), /erasure_provider_timeout_invalid/);
}
ok("aborted requests and exhausted provider budgets cannot lease or default to another ten seconds");

await assert.rejects(runFaceSessionCleanupSweep({ db: noDb, broker, scope, providerTimeoutMs: 4_999 }),
  /erasure_provider_time_budget_exhausted/);
await assert.rejects(deleteOwnedFaceSessionNow(noDb, OWNER, RID, null, broker, { scope, providerTimeoutMs: 4_999 }),
  /erasure_provider_time_budget_exhausted/);
ok("the face transport's five-second floor cannot silently overrun a shorter remaining budget");

const voiceClaim = await leaseNextVoiceErasure(async (sql, params) => {
  scopedSql("voice-lease", sql, params, "vp", 2);
  assert.match(sql, /for update skip locked limit 1/);
  return [voiceRow];
}, { scope, token: TOKEN });
assert.deepEqual(voiceClaim.erasureScope, scope);
for (const column of ["replica_id", "owner_user_id"]) {
  await assert.rejects(leaseNextVoiceErasure(async () => [{ ...voiceRow, [column]: OTHER }],
    { scope, token: TOKEN }), /erasure_scope_mismatch/);
}
ok("voice leases bind the exact job owner and replica and reject cross-owner returned rows");

await completeVoiceErasure(async (sql, params) => {
  scopedSql("voice-complete", sql, params, "vp", 5);
  return [{ voice_profile_id: OBJECT }];
}, voiceClaim);
await retryVoiceErasure(async (sql, params) => {
  scopedSql("voice-retry", sql, params, "vp", 6);
  return [{ voice_profile_id: OBJECT }];
}, voiceClaim, { failureCode: "timeout" });
for (const settle of [completeVoiceErasure, retryVoiceErasure]) {
  await assert.rejects(settle(noDb, { ...voiceClaim, profile: { ...voiceClaim.profile, ownerUserId: OTHER } }),
    /erasure_scope_mismatch/);
  await assert.rejects(settle(noDb, { ...voiceClaim, erasureScope: null }), /erasure_scope_invalid/);
}
ok("voice completion and retries retain the exact erasure job scope");

for (const wrong of [
  { ...voiceClaim, erasureScope: undefined },
  { ...voiceClaim, erasureScope: { ...scope, jobId: OTHER } },
  { ...voiceClaim, profile: { ...voiceClaim.profile, replicaId: OTHER } },
]) {
  await assert.rejects(runVoiceErasureSweep({ db: noDb, scope, lease: async () => wrong,
    providerFactory() { throw Error("cross-scope provider dispatch"); } }), /erasure_scope_mismatch/);
}
ok("a missing or mismatched voice lease scope cannot fall back to a global provider deletion");

let voiceLeases = 0;
let voiceCompleted = false;
const voiceSummary = await runVoiceErasureSweep({ db: noDb, scope, maxJobs: 8,
  lease: async (_db, options) => { voiceLeases += 1; assert.deepEqual(options.scope, scope); return voiceClaim; },
  providerFactory: () => ({ async deleteVoice(ref, options) {
    assert.equal(ref, voiceRow.provider_ref);
    assert.ok(options.signal instanceof AbortSignal);
  } }),
  complete: async () => { voiceCompleted = true; },
});
assert.equal(voiceLeases, 1);
assert.equal(voiceSummary.completed, 1);
assert.equal(voiceCompleted, true);
ok("owned voice progress caps the stage at one provider object");

let providerActive = false;
let abortObserved = false;
const keepAlive = setTimeout(() => {}, 1_000);
try {
  const result = await runVoiceErasureSweep({ db: noDb, scope, providerTimeoutMs: 20,
    lease: async () => voiceClaim,
    providerFactory: () => ({ async deleteVoice(_ref, { signal }) {
      providerActive = true;
      try {
        await new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
          abortObserved = true;
          reject(Object.assign(Error("timeout"), { code: "provider_timeout" }));
        }, { once: true }));
      } finally { providerActive = false; }
    } }),
    retry: async () => { assert.equal(abortObserved, true); assert.equal(providerActive, false); },
    complete: async () => { throw Error("aborted provider falsely completed"); },
  });
  assert.equal(result.retried, 1);
  assert.equal(providerActive, false);
} finally { clearTimeout(keepAlive); }
ok("voice timeout awaits provider abortion before retry settlement and return");

const requestController = new AbortController();
let sharedAbortObserved = false;
await runVoiceErasureSweep({ db: noDb, scope, signal: requestController.signal,
  lease: async () => voiceClaim,
  providerFactory: () => ({ async deleteVoice(_ref, { signal }) {
    const ended = new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      sharedAbortObserved = true;
      reject(signal.reason);
    }, { once: true }));
    requestController.abort(Error("shared request deadline"));
    await ended;
  } }),
  retry: async () => assert.equal(sharedAbortObserved, true),
  complete: async () => { throw Error("shared deadline falsely completed"); },
});
ok("the voice provider observes the shared request deadline as well as its own timeout");

let lateProviderDispatch = false;
for (const kind of ["voice", "face"]) {
  const controller = new AbortController();
  const lease = async () => { controller.abort(Error("deadline after lease")); return kind === "voice" ? voiceClaim : {
    leaseToken: TOKEN, challengeId: OBJECT, replicaId: RID, ownerUserId: OWNER,
    faceSessionAttempt: 1, faceSessionState: "expired_deleting", sessionHandle: "fixture-sealed-handle", erasureScope: scope,
  }; };
  if (kind === "voice") {
    await runVoiceErasureSweep({ db: noDb, scope, signal: controller.signal, lease,
      providerFactory: () => { lateProviderDispatch = true; throw Error("late dispatch"); }, retry: async () => {},
    });
  } else {
    await runFaceSessionCleanupSweep({ db: async () => [{ challenge_id: OBJECT }], scope, signal: controller.signal, lease,
      broker: { ...broker, async delete() { lateProviderDispatch = true; } },
    });
  }
}
assert.equal(lateProviderDispatch, false);
ok("a deadline that expires while leasing is checked again before provider dispatch");

const unsupported = await runVoiceErasureSweep({ db: noDb, scope,
  lease: async () => ({ ...voiceClaim, profile: { ...voiceClaim.profile, provider: "local_open_voice" } }),
  complete: async () => { throw Error("unsupported local voice falsely completed"); },
  retry: async (_db, _claim, { error }) => assert.match(error.message, /voice_provider_unavailable/),
});
assert.equal(unsupported.retried, 1);
ok("unsupported local voice erasure stays pending without a CPU or GPU provider call");

const oldFetch = globalThis.fetch;
const erasureEnv = {
  AZURE_PERSONAL_VOICE_ENDPOINT: "https://fixture.cognitiveservices.azure.com",
  AZURE_PERSONAL_VOICE_KEY: "fixture-key-long-enough-for-erasure",
};
const previousEnv = Object.fromEntries(Object.keys(erasureEnv).map((key) => [key, process.env[key]]));
let responseBodiesClosed = 0;
try {
  Object.assign(process.env, erasureEnv);
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "DELETE");
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(new ReadableStream({ async cancel() { responseBodiesClosed += 1; } }), { status: 200 });
  };
  const ref = `azpv1.${Buffer.from(JSON.stringify({ voiceId: "vy-owned-fixture", consentId: "vyc-owned-fixture" })).toString("base64url")}`;
  await runVoiceErasureSweep({ db: noDb, scope,
    lease: async () => ({ ...voiceClaim, profile: { ...voiceClaim.profile, providerRef: ref } }),
    complete: async () => assert.equal(responseBodiesClosed, 2),
    retry: async (_db, _claim, { error }) => { throw error; },
  });
  assert.equal(responseBodiesClosed, 2);
} finally {
  globalThis.fetch = oldFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
ok("the production voice eraser path awaits both unused response body cancellations");

const faceClaim = await leaseNextFaceSessionCleanup(async (sql, params) => {
  scopedSql("face-lease", sql, params, "ch", 2);
  assert.match(sql, /limit 1 for update of ch skip locked/);
  return [faceRow];
}, broker, { scope, leaseToken: TOKEN });
assert.deepEqual(faceClaim.erasureScope, scope);
await assert.rejects(leaseNextFaceSessionCleanup(async () => [{ ...faceRow, owner_user_id: OTHER }],
  broker, { scope }), /erasure_scope_mismatch/);
ok("face cleanup leases require the exact job and reject cross-owner returned rows");

let faceDeletes = 0;
let faceLeases = 0;
const faceSummary = await runFaceSessionCleanupSweep({ scope, maxJobs: 8, providerTimeoutMs: 50_000,
  db: async (sql, params) => {
    scopedSql("face-complete", sql, params, "ch", 7);
    return [{ ...faceRow, face_session_state: "expired_deleted", face_session_handle: "" }];
  },
  lease: async (_db, _broker, options) => { faceLeases += 1; assert.deepEqual(options.scope, scope); return faceClaim; },
  broker: { ...broker, async delete(claim, options) {
    faceDeletes += 1;
    assert.equal(claim, faceClaim);
    assert.equal(options.timeoutMs, 10_000);
  } },
});
assert.equal(faceLeases, 1);
assert.equal(faceDeletes, 1);
assert.equal(faceSummary.deleted, 1);
assert.equal(faceSummary.providerCleanupSkipped, true);
assert.equal(faceSummary.ambiguousReconciled, 0);
ok("owned face progress deletes one exact session within its timeout and skips all global cleanup");

const faceEnv = {
  AZURE_FACE_SESSION_BROKER_ENABLED: "true",
  AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED: "true",
  AZURE_FACE_DEDICATED_RESOURCE: "true",
  AZURE_FACE_SESSION_BROKER_ORIGIN: "https://fixture.azurecontainerapps.io",
  AZURE_FACE_SESSION_BROKER_HMAC_KEY_B64: Buffer.alloc(32, 31).toString("base64"),
  AZURE_FACE_DEVICE_CORRELATION_HMAC_KEY_B64: Buffer.alloc(32, 32).toString("base64"),
  AZURE_FACE_SESSION_BROKER_VERSION: "identity-2026.08.24+1",
  AZURE_FACE_LIVENESS_MODEL_VERSION: "2025-05-20",
};
for (const stalledAt of ["headers", "body"]) {
  const controller = new AbortController();
  let active = false;
  let aborted = false;
  let calls = 0;
  const realBroker = createAzureFaceSessionBroker({ env: faceEnv, fetchImpl: async (url, { signal }) => {
    calls += 1;
    assert.ok(url.endsWith("/v1/liveness/delete"));
    active = true;
    const reason = new DOMException(`fixture face ${stalledAt} deadline`, "TimeoutError");
    if (stalledAt === "headers") {
      const pending = new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        active = false; aborted = true; reject(signal.reason);
      }, { once: true }));
      setTimeout(() => controller.abort(reason), 5);
      return pending;
    }
    const response = new Response(new ReadableStream({ start(body) {
      signal.addEventListener("abort", () => {
        active = false; aborted = true; body.error(signal.reason);
      }, { once: true });
    } }));
    setTimeout(() => controller.abort(reason), 5);
    return response;
  } });
  const result = await runFaceSessionCleanupSweep({ scope, signal: controller.signal, broker: realBroker,
    lease: async () => faceClaim,
    db: async (_sql, params) => {
      assert.equal(active, false);
      assert.equal(aborted, true);
      assert.equal(params[5], "azure_face_session_unreachable");
      return [{ challenge_id: OBJECT }];
    },
  });
  assert.equal(result.retried, 1);
  assert.equal(calls, 1);
  assert.equal(active, false);
}
ok("the real face adapter awaits shared-deadline aborts at both headers and body before retry settlement");

const faceRetry = await runFaceSessionCleanupSweep({ scope,
  db: async (sql, params) => { scopedSql("face-retry", sql, params, "ch", 7); return [{ challenge_id: OBJECT }]; },
  lease: async () => faceClaim,
  broker: { ...broker, async delete() { throw Object.assign(Error("timeout"), { code: "face_session_timeout" }); } },
});
assert.equal(faceRetry.retried, 1);
assert.equal(faceRetry.providerCleanupSkipped, true);
ok("face provider failure releases only the same job owner and replica for durable retry");

await assert.rejects(runFaceSessionCleanupSweep({ scope, db: async () => [], lease: async () => faceClaim,
  broker: { ...broker, async delete() { throw Error("fixture provider refusal"); } },
}), /face_session_delete_settlement_lost/);
ok("a lost scoped face retry lease cannot report a settled retry");

for (const wrong of [
  { ...faceClaim, erasureScope: undefined },
  { ...faceClaim, erasureScope: { ...scope, jobId: OTHER } },
  { ...faceClaim, ownerUserId: OTHER },
]) {
  await assert.rejects(runFaceSessionCleanupSweep({ db: noDb, scope, lease: async () => wrong,
    broker: { ...broker, async delete() { throw Error("cross-scope face dispatch"); } } }), /erasure_scope_mismatch/);
}
ok("a missing or mismatched face lease scope cannot dispatch or settle provider deletion");

let immediateCalls = 0;
await deleteOwnedFaceSessionNow(async (sql, params) => {
  immediateCalls += 1;
  if (immediateCalls === 1) {
    scopedSql("face-immediate-lease", sql, params, "ch", 5);
    assert.match(sql, /limit 1 for update of ch skip locked/);
    return [faceRow];
  }
  scopedSql("face-immediate-complete", sql, params, "ch", 7);
  return [{ ...faceRow, face_session_state: "expired_deleted", face_session_handle: "" }];
}, OWNER, RID, null, { ...broker, async delete(_claim, options) { assert.equal(options.timeoutMs, 10_000); } },
{ scope, leaseToken: TOKEN });
assert.equal(immediateCalls, 2);
await assert.rejects(deleteOwnedFaceSessionNow(noDb, OTHER, RID, null, broker, { scope }), /erasure_scope_mismatch/);
ok("immediate owned face deletion leases at most one row and preserves exact settlement scope");

if (captureOnly) console.log(JSON.stringify(captures));
else console.log(`\n${checks} owned provider erasure checks passed; SQL captured but not parsed by PostgreSQL`);
