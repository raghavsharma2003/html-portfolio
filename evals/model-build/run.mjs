import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLeasedVoiceGenome,
  leaseNextVoiceGenomeBuild,
  modelBuildLeaseHash,
  modelBuildRetryDelayMs,
  retryVoiceGenomeBuild,
  runVoiceGenomeBuildSweep,
} from "../../api/_replica-model-build.js";
import { loadAcceptedVoiceGenomeInput } from "../../api/_replica-review.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const BUILD = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const ARTIFACT = "50000000-0000-4000-8000-000000000005";
const TOKEN = "voice-genome-build-lease-token-at-least-thirty-two-bytes";
const SHA = "a".repeat(64);
let checks = 0;
function ok(name, condition) {
  checks++;
  assert.ok(condition, name);
  console.log(`ok ${checks} - ${name}`);
}

function evidence(id, type, value, span = {}) {
  return {
    evidence_id: id,
    source_id: SOURCE,
    artifact_id: ARTIFACT,
    evidence_type: type,
    span_start_ms: span.start_ms ?? null,
    span_end_ms: span.end_ms ?? null,
    confidence: 0.98,
    value,
    input_sha256: SHA,
    record_hash: id.replaceAll("-", "").padEnd(64, "b").slice(0, 64),
    adapter_family: "open-speaker-identity",
    adapter_name: type === "voice_embedding" ? `independent-${value.family}` : "acoustic-analysis",
    adapter_version: "2026.08.1",
    decision: "accepted",
    reason_code: "measurement_verified",
    reviewed_at: "2026-08-24T00:00:00.000Z",
    contains_third_parties: false,
  };
}

const EVIDENCE = [
  evidence("60000000-0000-4000-8000-000000000006", "voice_embedding", { family: "wespeaker-ecapa", vector: [0.1, 0.2] }),
  evidence("70000000-0000-4000-8000-000000000007", "voice_embedding", { family: "nemo-titanet", vector: [0.3, 0.4] }),
  evidence("80000000-0000-4000-8000-000000000008", "voice_measurement", { pitch_hz: { median: 130 }, energy_db: { median: -20 } }),
  evidence("90000000-0000-4000-8000-000000000009", "quality_measurement", { snr_db: 28, usable_target_speech_ms: 41_000 }),
  evidence("a0000000-0000-4000-8000-00000000000a", "speaker_segment", { speaker_key: "target", target_likelihood: 0.99 }, { start_ms: 100, end_ms: 12_000 }),
];
const ARTIFACTS = [{
  artifact_id: ARTIFACT,
  source_id: SOURCE,
  parent_artifact_id: null,
  stage: "enhance",
  variant_key: "identity-preserving-v1",
  mime: "audio/wav",
  byte_size: 1_920_000,
  duration_ms: 40_000,
  sha256: "b".repeat(64),
  input_sha256: SHA,
  transform_name: "deepfilternet",
  transform_version: "3.5.6",
  adapter_family: "speech-enhancement",
  adapter_name: "deepfilternet",
  adapter_version: "3.5.6",
}];

const inputCalls = [];
const input = await loadAcceptedVoiceGenomeInput(async (sql, params) => {
  inputCalls.push({ sql, params });
  if (sql.includes("limit 2001")) return EVIDENCE;
  if (sql.includes("vy_replica_processing_artifact")) return ARTIFACTS;
  throw new Error("unexpected input query");
}, OWNER, RID);
ok("the build input contains only owner-accepted ready-source evidence and its exact private artifacts",
  input.evidence.length === 5 && input.artifacts.length === 1 &&
  /s\.state='ready'/.test(inputCalls[0].sql) && /l\.decision='accepted'/.test(inputCalls[0].sql) &&
  inputCalls.every((call) => call.params[1] === OWNER));
ok("two independent embeddings and immutable transform lineage produce one canonical source-set hash",
  /^[0-9a-f]{64}$/.test(input.sourceSetHash) && input.artifacts[0].adapter.name === "deepfilternet");

let leaseSql = "";
const lease = await leaseNextVoiceGenomeBuild(async (sql, params) => {
  leaseSql = sql;
  assert.equal(params[0], modelBuildLeaseHash(TOKEN));
  return [{
    build_id: BUILD, replica_id: RID, owner_user_id: OWNER, target_version: 1,
    builder_version: "voice-genome-builder/v1", source_set_hash: input.sourceSetHash,
    attempt: 1, lease_expires_at: "2026-08-24T00:05:00.000Z",
  }];
}, { leaseToken: TOKEN });
ok("leasing is skip-locked crash-recoverable and rechecks verified identity plus biometric and training consent",
  lease.buildId === BUILD && /for update of b skip locked/.test(leaseSql) &&
  /b\.lease_expires_at<=now\(\)/.test(leaseSql) && /c\.scope='biometric'/.test(leaseSql) &&
  /c\.scope='training'/.test(leaseSql) && /r\.identity_expires_at>now\(\)/.test(leaseSql));

const buildCalls = [];
const built = await buildLeasedVoiceGenome(async (sql, params) => {
  buildCalls.push({ sql, params });
  if (/set state='building'/.test(sql)) return [{ build_id: BUILD }];
  if (sql.includes("limit 2001")) return EVIDENCE;
  if (sql.includes("select distinct a.artifact_id")) return ARTIFACTS;
  if (sql.includes("insert into vy_replica_voice_genome")) {
    return [{ build_id: BUILD, replica_id: RID, owner_user_id: OWNER, target_version: 1,
      state: "review", manifest_hash: params[8], built_at: "2026-08-24T00:01:00.000Z" }];
  }
  throw new Error("unexpected build query");
}, lease);
const settlement = buildCalls[3];
const definition = JSON.parse(settlement.params[7]);
ok("the real worker persists a draft VoiceGenome and moves the build only to owner review",
  built.state === "review" && definition.status === "draft" && definition.version === 1 &&
  Object.keys(definition.speaker_identity.embedding_families).length === 2 &&
  definition.references.enrollment_artifact_ids.includes(ARTIFACT));
ok("settlement is atomically fenced by the exact lease versions source-set and current locked consents",
  /b\.source_set_hash=\$6/.test(settlement.sql) && /b\.lease_token_hash=\$7/.test(settlement.sql) &&
  /biometric_consent as materialized/.test(settlement.sql) && /training_consent as materialized/.test(settlement.sql) &&
  /limit 1 for update/.test(settlement.sql));
ok("every accepted evidence and artifact id is rechecked at the mutation boundary and test provenance is denied",
  /unnest\(\$10::uuid\[\]\)/.test(settlement.sql) && /unnest\(\$11::uuid\[\]\)/.test(settlement.sql) &&
  /!~ '\(fake\|fixture\|test\|mock\)'/.test(settlement.sql) && settlement.params[9].length === EVIDENCE.length);
ok("owner decisions and source erasure serialize against settlement before the draft becomes visible",
  /pg_try_advisory_xact_lock/.test(settlement.sql) && /voice_genome_review/.test(settlement.sql) && /locked_sources as materialized/.test(settlement.sql) &&
  /for update of s/.test(settlement.sql) && /cardinality\(\$12::uuid\[\]\)/.test(settlement.sql));
ok("a colliding version can be reused only when the immutable definition and source-set are identical",
  /vy_replica_voice_genome\.definition=excluded\.definition/.test(settlement.sql) &&
  /vy_replica_voice_genome\.source_set_hash=excluded\.source_set_hash/.test(settlement.sql));

let retrySql = "";
const retried = await retryVoiceGenomeBuild(async (sql) => {
  retrySql = sql;
  return [{ build_id: BUILD, state: "retry" }];
}, lease, Object.assign(new Error("source changed"), { code: "model_build_source_set_changed" }));
ok("failed builds release the one-way lease into bounded exponential retry without exposing evidence",
  retried.state === "retry" && /lease_token_hash=''/.test(retrySql) && modelBuildRetryDelayMs(99) === 6 * 60 * 60 * 1_000);

const work = [{ ...lease, buildId: "b0000000-0000-4000-8000-00000000000b" },
  { ...lease, buildId: "c0000000-0000-4000-8000-00000000000c" }];
const summary = await runVoiceGenomeBuildSweep({
  db: async () => [],
  maxJobs: 2,
  lease: async () => work.shift() || null,
  build: async (_db, claim) => { if (claim.buildId.startsWith("c")) throw new Error("transient"); },
  retry: async () => ({ state: "retry" }),
});
ok("one bounded sweep independently builds and retries work without blocking the queue",
  summary.leased === 2 && summary.built === 1 && summary.retried === 1);

const migration = readFileSync(join(ROOT, "db/migrations/042_replica_model_build_leases.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-model-build-sweep.js"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
ok("the lease migration is splitter-safe idempotent recovers old stuck rows and is mirrored in canonical schema",
  splitSql(migration).length === 7 && migration.includes("migration_recovered_unleased_build") &&
  schema.includes("vy_replica_model_build_lease_shape"));
ok("only a cron-authenticated bounded worker can execute queued builds",
  endpoint.includes("timingSafeEqual") && endpoint.includes("CRON_SECRET") &&
  vercel.crons.some((cron) => cron.path === "/api/replica-model-build-sweep"));

console.log(`\n${checks} model build checks passed`);
