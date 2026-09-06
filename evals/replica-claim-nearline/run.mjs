import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acknowledgeClaimExtractionEvidence,
  claimExtractionLeaseTokenHash,
  deferClaimExtractionJob,
  leaseNextClaimExtractionJob,
} from "../../api/_replica-claim-queue.js";
import { runClaimExtractionSweep } from "../../api/_replica-claim-sweep.js";
import { authorizedClaimExtractionSweep, executeClaimExtractionSweep } from "../../api/replica-claim-sweep.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const JOB = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const EVIDENCE = "40000000-0000-4000-8000-000000000004";
const TOKEN = "q".repeat(43);
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

ok("lease token commitments are deterministic hashes and never raw tokens",
  /^[0-9a-f]{64}$/.test(claimExtractionLeaseTokenHash(TOKEN)) && !claimExtractionLeaseTokenHash(TOKEN).includes(TOKEN));
assert.throws(() => claimExtractionLeaseTokenHash("short"), /strong claim extraction lease token required/);
ok("weak queue lease tokens fail closed", true);

let leaseCall;
const claimed = await leaseNextClaimExtractionJob(async (sql, params) => {
  leaseCall = { sql, params };
  return [{ job_id: JOB, replica_id: RID, owner_user_id: OWNER, attempt: 2, lease_expires_at: "2026-08-30T01:00:00Z" }];
}, { token: TOKEN, leaseMs: 120_000 });
ok("queue lease is owner and replica bound without exposing the stored hash",
  claimed.jobId === JOB && claimed.replicaId === RID && claimed.ownerUserId === OWNER && claimed.leaseToken === TOKEN && leaseCall.params[0] !== TOKEN);
ok("queue lease recovers expiration and serializes with skip locked",
  /lease_expires_at<=now\(\)/.test(leaseCall.sql) && /for update of q skip locked/i.test(leaseCall.sql) && /state='running'/i.test(leaseCall.sql));
ok("queue lease refuses replicas in revoked or purging lifecycle",
  /subject_mode='self'/.test(leaseCall.sql) && /lifecycle not in \('revoked','purging'\)/.test(leaseCall.sql));

let deferCall;
const deferred = await deferClaimExtractionJob(async (sql, params) => {
  deferCall = { sql, params };
  return [{ job_id: JOB, state: "waiting", last_error_code: params[4] }];
}, claimed, { waiting: true, delayMs: 60_000, failureCode: "training_consent_required" });
ok("readiness blockers become a named durable waiting state",
  deferred.state === "waiting" && deferCall.params[3] === "waiting" && deferCall.params[4] === "training_consent_required");
ok("defer settlement requires the live exact queue lease",
  /lease_token_hash=\$2/.test(deferCall.sql) && /state='running'/.test(deferCall.sql) && /lease_expires_at>now\(\)/.test(deferCall.sql));

let ackCall;
const acknowledged = await acknowledgeClaimExtractionEvidence(async (sql, params) => {
  ackCall = { sql, params };
  return [{ job_id: JOB, state: "complete", completed_items: 1, pending: false }];
}, { jobId: JOB, replicaId: RID, ownerUserId: OWNER, evidenceIds: [EVIDENCE], leaseToken: TOKEN });
ok("queue acknowledgement is exact owner replica evidence and lease bound",
  acknowledged.state === "complete" && ackCall.params[0] === RID && ackCall.params[1] === OWNER && ackCall.params[4][0] === EVIDENCE);
ok("only inputs of a completed cited extraction can acknowledge queue evidence",
  /vy_replica_claim_extraction_input/.test(ackCall.sql) && /r\.state='complete'/.test(ackCall.sql) && /i\.evidence_id=any\(\$5::uuid\[\]\)/.test(ackCall.sql));
ok("bounded batches continue while any queue item remains pending",
  /case when r\.pending then 'queued' else 'complete' end/.test(ackCall.sql));

function leaseSequence(rows) {
  const copy = [...rows];
  return async () => copy.shift() || null;
}

const completedSummary = await runClaimExtractionSweep({
  db: async () => [], extractor: { async extract() {} }, maxJobs: 2,
  lease: leaseSequence([{ ...claimed }, null]),
  extract: async () => ({ state: "complete", input_evidence_ids: [EVIDENCE] }),
  acknowledge: async () => ({ state: "complete" }),
});
ok("automatic sweep completes a leased durable item without a turn-path caller",
  completedSummary.leased === 1 && completedSummary.completed === 1 && completedSummary.retried === 0);

let readinessDeferral;
const waitingError = Object.assign(new Error("claim_extraction_not_ready"), {
  code: "claim_extraction_not_ready",
  details: { blockers: ["reviewed_confident_subject_transcript_required"] },
});
const waitingSummary = await runClaimExtractionSweep({
  db: async () => [], extractor: { async extract() {} }, maxJobs: 1,
  lease: leaseSequence([{ ...claimed }, null]),
  extract: async () => { throw waitingError; },
  defer: async (_db, _lease, input) => { readinessDeferral = input; return {}; },
});
ok("speaker-review absence never reaches a provider and waits with an honest reason",
  waitingSummary.waiting === 1 && readinessDeferral.waiting === true
    && /reviewed_confident_subject_transcript_required/.test(readinessDeferral.failureCode));

let busyDeferral;
const busySummary = await runClaimExtractionSweep({
  db: async () => [], extractor: { async extract() {} }, maxJobs: 1,
  lease: leaseSequence([{ ...claimed }, null]),
  extract: async () => ({ state: "extracting", acquired: false, input_evidence_ids: [EVIDENCE] }),
  defer: async (_db, _lease, input) => { busyDeferral = input; return {}; },
});
ok("a concurrent extraction is retried without a second provider call",
  busySummary.busy === 1 && busyDeferral.failureCode === "claim_extraction_already_running");

let retryDeferral;
const retrySummary = await runClaimExtractionSweep({
  db: async () => [], extractor: { async extract() {} }, maxJobs: 1,
  lease: leaseSequence([{ ...claimed, attempt: 3 }, null]),
  extract: async () => { throw Object.assign(new Error("provider_down"), { code: "provider_down" }); },
  defer: async (_db, _lease, input) => { retryDeferral = input; return {}; },
});
ok("provider failure is bounded exponential retry rather than a false completion",
  retrySummary.retried === 1 && retryDeferral.waiting === false && retryDeferral.delayMs >= 120_000);

const secret = "s".repeat(32);
ok("cron sweep fails closed for missing short and wrong secrets",
  !authorizedClaimExtractionSweep({ headers: {} }, { CRON_SECRET: secret })
    && !authorizedClaimExtractionSweep({ headers: { authorization: "Bearer short" } }, { CRON_SECRET: "short" })
    && !authorizedClaimExtractionSweep({ headers: { authorization: `Bearer ${"x".repeat(32)}` } }, { CRON_SECRET: secret }));
ok("cron sweep accepts only the exact timing-safe bearer",
  authorizedClaimExtractionSweep({ headers: { authorization: `Bearer ${secret}` } }, { CRON_SECRET: secret }));
let routeSignalObserved = false;
const deadlineSummary = await executeClaimExtractionSweep({
  timeoutMs: 5_000,
  createExtractor: () => ({ extract() {} }),
  run: async ({ signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      routeSignalObserved = true;
      resolve({ deferred_before_platform_wall: true });
    }, { once: true });
  }),
});
ok("the route deadline reaches the provider path before the platform hard wall",
  routeSignalObserved && deadlineSummary.deferred_before_platform_wall === true);
let unavailableSettlement;
let unavailableReconciled = false;
const unavailableSummary = await executeClaimExtractionSweep({
  timeoutMs: 5_000,
  db: async () => [],
  createExtractor: () => { throw Object.assign(new Error("claim_extractor_unavailable"), { code: "claim_extractor_unavailable" }); },
  run: async ({ extractor }) => runClaimExtractionSweep({
    db: async () => [],
    extractor,
    maxJobs: 1,
    lease: leaseSequence([{ ...claimed }, null]),
    extract: async (_db, _owner, _replica, activeExtractor) => activeExtractor.extract(),
    defer: async (_db, _lease, input) => { unavailableSettlement = input; return {}; },
    reconcile: async () => { unavailableReconciled = true; return { scanned: 0, materialized: 0, retracted: 0, deferred: 0 }; },
  }),
});
ok("missing provider configuration becomes a durable platform wait and does not starve reconciliation",
  unavailableSummary.waiting === 1 && unavailableSettlement?.waiting === true
    && unavailableSettlement?.failureCode === "claim_extractor_unavailable" && unavailableReconciled);

const migration = readReconciledMigration("db/migrations/069_replica_claim_nearline_queue.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const store = readFileSync(join(ROOT, "api/_mirrorcall-store.js"), "utf8");
const attestation = readFileSync(join(ROOT, "api/_mirrorcall-speaker-attestation.js"), "utf8");
const claims = readFileSync(join(ROOT, "api/_replica-claims.js"), "utf8");
const route = readFileSync(join(ROOT, "api/replica-claim-sweep.js"), "utf8");
const mirrorRoute = readFileSync(join(ROOT, "api/mirror-call.js"), "utf8");
const erasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

ok("migration is idempotent one-statement-runner safe", splitSql(migration).length === 11 && !/\bdo\s+\$/i.test(migration));
ok("queue contains identifiers and state but no transcript or claim body column",
  /create table if not exists vy_replica_claim_extraction_queue/.test(migration)
    && !/\b(transcript|claim_body|raw_text)\s+(text|jsonb)/i.test(migration));
ok("queue and input lineage cascade through replica evidence source and run owners",
  (migration.match(/on delete cascade/gi) || []).length >= 7
    && /vy_replica_claim_extraction_input_evidence_fk/.test(migration)
    && /vy_replica_claim_extraction_queue_item_evidence_fk/.test(migration));
ok("migration 069 is mirrored in the canonical schema", schema.includes("migration 069 - durable nearline claim extraction queue") && schema.includes("vy_replica_claim_extraction_queue_item"));
ok("canonical settlement persists transcript evidence but cannot queue it before owner-speaker review",
  /insert into vy_replica_processing_evidence/.test(store)
    && !/claim_queue_ensured/.test(store) && !/insert into vy_replica_claim_extraction_queue_item/.test(store));
ok("positive speaker attestation atomically queues only transcript evidence from its exact session",
  /claim_queue_ensured/.test(attestation)
    && /insert into vy_replica_claim_extraction_queue_item/.test(attestation)
    && /te\.evidence_type='transcript_span'/.test(attestation)
    && /provenance,session_id.*\$1::text/.test(attestation));
ok("call end reads actual queue state and names the scheduled trigger",
  /claim_extraction_job_state/.test(store) && /scheduled_nearline_sweep/.test(store)
    && !/claim_extraction_trigger', 'owner_callable_sweep'/.test(store));
ok("paid extraction excludes completed inputs and leases each content-addressed run",
  /not exists \(\s*select 1 from vy_replica_claim_extraction_input/s.test(claims)
    && /lease_token_hash=\$6/.test(claims) && /lease_expires_at>now\(\)/.test(claims));
ok("claims remain proposed until the separate owner decision authority",
  /p\.confidence,'proposed'/.test(claims) && !/status,'accepted'/.test(claims));
ok("the call turn route never imports or invokes the extraction worker",
  !/runClaimExtractionSweep|extractOwnedClaims|createProductionClaimExtractor/.test(mirrorRoute));
ok("new queue tables are explicitly named in full replica erasure",
  /delete from vy_replica_claim_extraction_queue_item/.test(erasure)
    && /delete from vy_replica_claim_extraction_queue\b/.test(erasure));
ok("a five-minute caller exists and the route uses CRON_SECRET plus the production extractor",
  vercel.crons.some((entry) => entry.path === "/api/replica-claim-sweep" && entry.schedule === "*/5 * * * *")
    && /CRON_SECRET/.test(route) && /createProductionClaimExtractor/.test(route) && /maxJobs: 1/.test(route));

console.log(`\n${checks} replica claim nearline checks passed`);
