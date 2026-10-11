import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeVoiceErasure,
  leaseNextVoiceErasure,
  normalizeVoiceErasureFailure,
  retryVoiceErasure,
  runVoiceErasureSweep,
  voiceErasureLeaseTokenHash,
  voiceErasureRetryDelayMs,
} from "../../api/_replica-voice-erasure.js";
import { createAzurePersonalVoiceEraser } from "../../api/_voice/providers/azure-personal-voice.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const TOKEN = "one-way-lease-token-with-more-than-thirty-two-bytes";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const hash = voiceErasureLeaseTokenHash(TOKEN);
ok("lease secrets are domain-separated one-way hashes", /^[0-9a-f]{64}$/.test(hash) && !hash.includes(TOKEN));
assert.throws(() => voiceErasureLeaseTokenHash("short"), /strong voice erasure lease token/);
ok("weak lease material fails closed", true);

ok("provider retry backoff grows and caps at six hours",
  voiceErasureRetryDelayMs(1) === 30_000 && voiceErasureRetryDelayMs(2) === 60_000 &&
  voiceErasureRetryDelayMs(30) === 21_600_000);
ok("stored provider failures are finite content-free classes",
  normalizeVoiceErasureFailure({ code: "azure_personal_voice_http_429" }) === "provider_rate_limited" &&
  normalizeVoiceErasureFailure({ code: "azure_personal_voice_http_401" }) === "provider_auth_failed" &&
  normalizeVoiceErasureFailure(new Error("raw provider payload with a name")) === "provider_delete_failed");

let leaseSql = "";
let leaseParams;
const claimed = await leaseNextVoiceErasure(async (sql, params) => {
  leaseSql = sql;
  leaseParams = params;
  return [{
    voice_profile_id: PROFILE, replica_id: RID, owner_user_id: OWNER,
    provider: "azure_personal_voice", provider_ref: "server-only-ref",
    erasure_attempts: 2, erasure_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  }];
}, { token: TOKEN, leaseMs: 90_000 });
ok("one atomic query reclaims expired work and leases exactly one disabled voice",
  /for update skip locked limit 1/.test(leaseSql) && /failure_code='lease_expired'/.test(leaseSql) &&
  /status='deleting'/.test(leaseSql) && claimed.profile.attempt === 2);
ok("only the lease hash reaches durable storage while provider identity stays worker-internal",
  leaseParams[0] === hash && !leaseParams.includes(TOKEN) && claimed.profile.providerRef === "server-only-ref");

let completeSql = "";
await completeVoiceErasure(async (sql, params) => {
  completeSql = sql;
  assert.equal(params[3], hash);
  return [{ voice_profile_id: PROFILE }];
}, claimed);
ok("completion requires a live exact lease and atomically removes the provider mapping",
  /erasure_lease_expires_at>now\(\)/.test(completeSql) && /delete from vy_replica_voice_profile/.test(completeSql));
ok("dependent private generations capabilities and candidates are removed before the provider mapping",
  /delete from vy_replica_generation/.test(completeSql) && /delete from vy_replica_runtime_capability/.test(completeSql) &&
  /delete from vy_replica_candidate/.test(completeSql));
ok("completion revokes provider consent and emits only content-free reconciliation audit",
  /update vy_replica_provider_consent/.test(completeSql) && /worker','reconciler'/.test(completeSql) &&
  !completeSql.includes("provider_ref"));

let retrySql = "";
await retryVoiceErasure(async (sql, params) => {
  retrySql = sql;
  assert.equal(params[5], "provider_unreachable");
  return [{ voice_profile_id: PROFILE }];
}, claimed, { error: { code: "azure_personal_voice_unreachable" }, retryAfterMs: 60_000 });
ok("ambiguous deletion remains unusable and returns to the durable queue",
  /status='deleting'/.test(retrySql) && /erasure_next_attempt_at/.test(retrySql) &&
  /erasure_lease_token_hash=''/.test(retrySql));

const work = [
  { profile: { provider: "fake", providerRef: "success", attempt: 1 }, leaseToken: TOKEN },
  { profile: { provider: "fake", providerRef: "transient", attempt: 2 }, leaseToken: TOKEN },
];
const settled = [];
const retried = [];
const summary = await runVoiceErasureSweep({
  db: async () => [],
  maxJobs: 4,
  lease: async () => work.shift() || null,
  providerFactory: () => ({
    async deleteVoice(ref) {
      if (ref === "transient") throw Object.assign(new Error("private raw detail"), { code: "azure_personal_voice_http_503" });
    },
  }),
  complete: async (_db, lease) => settled.push(lease.profile.providerRef),
  retry: async (_db, lease, input) => retried.push({ ref: lease.profile.providerRef, code: normalizeVoiceErasureFailure(input.error) }),
});
ok("sweep drains available work without one transient failure stopping later reconciliation",
  summary.leased === 2 && summary.completed === 1 && summary.retried === 1 && settled[0] === "success");
ok("worker retry hands only normalized failure classes to persistence",
  retried.length === 1 && retried[0].code === "provider_delete_failed");

const erasureEnv = {
  AZURE_PERSONAL_VOICE_ENABLED: "false",
  AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "false",
  AZURE_PERSONAL_VOICE_ENDPOINT: "https://speech-resource.cognitiveservices.azure.com",
  AZURE_PERSONAL_VOICE_KEY: "test-secret-key-with-enough-length",
};
const providerRef = `azpv1.${Buffer.from(JSON.stringify({ voiceId: "vy-delete-me", consentId: "vyc-delete-me" })).toString("base64url")}`;
const deleteCalls = [];
const eraser = createAzurePersonalVoiceEraser({
  env: erasureEnv,
  fetchImpl: async (url, init) => {
    deleteCalls.push({ url, init });
    return new Response(null, { status: deleteCalls.length === 1 ? 404 : 204 });
  },
});
await eraser.deleteVoice(providerRef);
ok("erasure still works when new cloning and limited-access creation are disabled",
  deleteCalls.length === 2 && deleteCalls.every((call) => call.init.method === "DELETE"));
ok("Azure absence is idempotent success and both voice plus consent are removed",
  deleteCalls[0].url.includes("/personalvoices/") && deleteCalls[1].url.includes("/consents/"));

const migration = readFileSync(join(ROOT, "db/migrations/035_replica_voice_erasure.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-erasure-sweep.js"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
ok("migration remains independently idempotent under the SQL-over-HTTP splitter",
  splitSql(migration).length >= 10 && splitSql(migration).every((statement) => statement.length > 0));
ok("schema records retry lease state and an append-only provider-ref-free attempt ledger",
  migration.includes("vy_replica_voice_erasure_ready_ix") && migration.includes("vy_replica_voice_erasure_attempt") &&
  !migration.includes("provider_ref") && schema.includes("vy_replica_voice_erasure_attempt"));
ok("scheduler endpoint requires a timing-safe bearer secret and has an emergency kill switch",
  endpoint.includes("timingSafeEqual") && endpoint.includes("CRON_SECRET") && endpoint.includes("REPLICA_ERASURE_KILL"));
ok("provider erasure reconciliation is actually scheduled rather than dead code",
  vercel.crons.some((cron) => cron.path === "/api/replica-erasure-sweep"));

console.log(`\n${checks} voice erasure checks passed`);
