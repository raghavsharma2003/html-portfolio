import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeedbackDatasetDefinition, buildOwnedFeedbackDataset, FEEDBACK_DATASET_SCHEMA } from "../../api/_replica-feedback-dataset.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function uuid(number) {
  return `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const rows = [];
let id = 1;
for (let session = 1; session <= 12; session++) {
  const sessionId = uuid(10_000 + session);
  for (let example = 0; example < 4; example++) {
    rows.push({
      feedback_id: uuid(id), turn_id: uuid(20_000 + id), session_id: sessionId, revision: 1,
      profile_version: 7, calibration_version: 3,
      ratings: { wording: "off", behavior: "close", relationship: "close", memory: "close", delivery: "close" },
      ratings_hash: (id % 15).toString(16).repeat(64), response_hash: ((id + 1) % 15).toString(16).repeat(64),
      correction_hash: ((id + 2) % 15).toString(16).repeat(64), source_generation_id: null,
    });
    id += 1;
  }
  for (let positive = 0; positive < 5; positive++) {
    rows.push({
      feedback_id: uuid(id), turn_id: uuid(20_000 + id), session_id: sessionId, revision: 1,
      profile_version: 7, calibration_version: 3,
      ratings: { wording: "exact", behavior: "exact", relationship: "exact", memory: "exact", delivery: "exact" },
      ratings_hash: (id % 15).toString(16).repeat(64), response_hash: ((id + 1) % 15).toString(16).repeat(64),
      correction_hash: null, source_generation_id: null,
    });
    id += 1;
  }
}
// A superseded row for the same turn must disappear from the source set.
rows.push({ ...rows[0], feedback_id: uuid(id++), revision: 2, ratings_hash: "e".repeat(64) });

const built = buildFeedbackDatasetDefinition(rows, [], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("dataset manifest is schema and exact Person Model calibration bound", built.definition.schema === FEEDBACK_DATASET_SCHEMA && built.definition.profile_version === 7 && built.definition.calibration_version === 3);
ok("only the latest append-only feedback revision enters the dataset", built.definition.examples.length === 108 && !built.definition.examples.some((example) => example.feedback_id === rows[0].feedback_id));
ok("whole sessions receive one immutable split with no turn leakage", built.assignments.length === 12 && built.assignments.every((assignment) => new Set(built.definition.examples.filter((example) => example.session_commitment === assignment.session_commitment).map((example) => example.split)).size === 1));
ok("initial assignment guarantees useful 70/15/15 session partitions", built.definition.stats.session_counts.train === 8 && built.definition.stats.session_counts.development === 2 && built.definition.stats.session_counts.test === 2);
ok("training readiness counts preference pairs only inside train", built.definition.stats.train_preferences === 32);
ok("positive holdout evidence is counted only outside train", built.definition.stats.holdout_positives === 20);
ok("adequate multi-layer evidence is structurally ready for a candidate dataset", built.readiness.ready_for_candidate_dataset === true && built.readiness.blockers.length === 0);
ok("manifest is content-free and uses session commitments rather than session ids", !JSON.stringify(built.definition).includes(uuid(10_001)) && built.definition.examples.every((example) => /^[0-9a-f]{64}$/.test(example.session_commitment)));
ok("source-set commitment is deterministic across input order", built.source_set_hash === buildFeedbackDatasetDefinition([...rows].reverse(), [], { replica_id: RID, profile_version: 7, calibration_version: 3 }).source_set_hash);

const frozen = built.assignments[0];
const rebuilt = buildFeedbackDatasetDefinition(rows, [{ ...frozen, split: "development" }], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("an existing conversation split is preserved across future rebuilds", rebuilt.assignments.find((item) => item.session_commitment === frozen.session_commitment).split === "development");

const unsafeRows = rows.map((row) => row.session_id === uuid(10_001) ? { ...row, ratings: { overall: "unsafe" }, ratings_hash: "d".repeat(64), correction_hash: null } : row);
const unsafeFresh = buildFeedbackDatasetDefinition(unsafeRows, [], { replica_id: RID, profile_version: 7, calibration_version: 3 });
const unsafeCommitment = unsafeFresh.definition.examples.find((example) => example.kind === "safety_holdout").session_commitment;
ok("a newly observed unsafe conversation is forced wholly into test", unsafeFresh.assignments.find((item) => item.session_commitment === unsafeCommitment).split === "test" && unsafeFresh.definition.examples.filter((item) => item.session_commitment === unsafeCommitment).every((item) => item.split === "test"));
const unsafeFrozen = buildFeedbackDatasetDefinition(unsafeRows, [{ session_commitment: unsafeCommitment, split: "train" }], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("an unsafe example in a previously frozen train session blocks reuse instead of leaking it into test", unsafeFrozen.readiness.blockers.includes("unsafe_session_was_previously_frozen_outside_test"));

const small = buildFeedbackDatasetDefinition(rows.slice(0, 5), [], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("small attractive-looking datasets remain blocked by explicit depth and split gates", !small.readiness.ready_for_candidate_dataset && small.readiness.blockers.includes("twelve_independent_sessions_required") && small.readiness.blockers.includes("two_test_sessions_required"));

const dbCalls = [];
const stored = await buildOwnedFeedbackDataset(async (sql, params) => {
  dbCalls.push({ sql, params });
  if (/select f\.\*,t\.session_id/i.test(sql)) return rows;
  if (/select session_commitment,split from vy_replica_feedback_split/i.test(sql)) return [];
  if (/select c\.profile_version,c\.calibration_version/i.test(sql)) return [{ profile_version: 7, calibration_version: 3 }];
  if (/insert into vy_replica_feedback_dataset/i.test(sql)) return [{ dataset_id: uuid(99_999), version: 1, profile_version: 7, calibration_version: 3, source_set_hash: built.source_set_hash, definition: built.definition, readiness: built.readiness, status: "draft", created_at: "2026-08-24T00:00:00.000Z" }];
  throw new Error(`unexpected SQL ${sql.slice(0, 100)}`);
}, OWNER, RID);
ok("owner build returns a draft rather than silently approving training data", stored.status === "draft" && stored.version === 1);
const mutation = dbCalls.find((call) => /insert into vy_replica_feedback_dataset/i.test(call.sql));
ok("mutation rechecks the complete latest feedback id and revision set", /full join expected e using\(feedback_id,revision\)/i.test(mutation.sql) && /feedback_dataset_changed_during_build/.test(readFileSync(join(ROOT, "api/_replica-feedback-dataset.js"), "utf8")));
ok("replica row lock serializes dataset version allocation", /for update of r/i.test(mutation.sql) && /coalesce\(max\(d\.version\),0\)\+1/i.test(mutation.sql));
ok("split registry rejects a concurrent conflicting assignment before dataset insertion", /compatible as/i.test(mutation.sql) && /where x\.split<>s\.split/i.test(mutation.sql) && /from authorized a,numbered n,unchanged,compatible/i.test(mutation.sql));
ok("same source set is idempotent and cannot allocate a second dataset", /on conflict \(replica_id,owner_user_id,profile_version,calibration_version,source_set_hash\)/i.test(mutation.sql));
ok("persisted dataset definition contains hashes and opaque ids but no reply or correction text", !/(original_reply|preferred_output|correction_text|transcript)/i.test(JSON.stringify(mutation.params[7])));

const migration = readFileSync(join(ROOT, "db/migrations/030_replica_feedback_dataset.sql"), "utf8");
ok("feedback dataset migration remains one-statement-runner safe", splitSql(migration).length === 4);
ok("dataset and split registry are composite owner bound and replica erasable", (migration.match(/foreign key \(replica_id,owner_user_id\)/gi) || []).length >= 2 && /primary key \(replica_id,owner_user_id,session_commitment\)/i.test(migration) && /vy_replica_feedback_split_owner_fk[\s\S]*on delete cascade/i.test(migration));
ok("database accepts only train development or test split labels", /split in \('train','development','test'\)/i.test(migration));
const route = readFileSync(join(ROOT, "api/replica-feedback-dataset.js"), "utf8");
ok("production dataset route is owner authenticated rate limited and build only", /requireUser/.test(route) && /allow\(user\.id/.test(route) && /buildOwnedFeedbackDataset/.test(route) && !/approve/i.test(route));

console.log(`\n${checks} feedback dataset checks passed`);
