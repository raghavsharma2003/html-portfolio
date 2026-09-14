import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFeedbackDatasetDefinition, buildOwnedFeedbackDataset, readOwnedFeedbackDatasetReview, FEEDBACK_DATASET_REVIEW_SQL, FEEDBACK_DATASET_BUILD_SQL, FEEDBACK_DATASET_SCHEMA } from "../../api/_replica-feedback-dataset.js";
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
      ratings_hash: (id % 15).toString(16).repeat(64), prompt_hash: ((id + 3) % 15).toString(16).repeat(64), learner_input_sha256: ((id + 4) % 15).toString(16).repeat(64), response_hash: ((id + 1) % 15).toString(16).repeat(64),
      correction_hash: ((id + 2) % 15).toString(16).repeat(64), source_generation_id: null,
    });
    id += 1;
  }
  for (let positive = 0; positive < 12; positive++) {
    rows.push({
      feedback_id: uuid(id), turn_id: uuid(20_000 + id), session_id: sessionId, revision: 1,
      profile_version: 7, calibration_version: 3,
      ratings: { wording: "exact", behavior: "exact", relationship: "exact", memory: "exact", delivery: "exact" },
      ratings_hash: (id % 15).toString(16).repeat(64), prompt_hash: ((id + 3) % 15).toString(16).repeat(64), learner_input_sha256: ((id + 4) % 15).toString(16).repeat(64), response_hash: ((id + 1) % 15).toString(16).repeat(64),
      correction_hash: null, source_generation_id: null,
    });
    id += 1;
  }
}
// A superseded row for the same turn must disappear from the source set.
rows.push({ ...rows[0], feedback_id: uuid(id++), revision: 2, ratings_hash: "e".repeat(64) });

const built = buildFeedbackDatasetDefinition(rows, [], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("dataset manifest is schema and exact Person Model calibration bound", built.definition.schema === FEEDBACK_DATASET_SCHEMA && built.definition.profile_version === 7 && built.definition.calibration_version === 3);
ok("only the latest append-only feedback revision enters the dataset", built.definition.examples.length === 192 && !built.definition.examples.some((example) => example.feedback_id === rows[0].feedback_id));
ok("whole sessions receive one immutable split with no turn leakage", built.assignments.length === 12 && built.assignments.every((assignment) => new Set(built.definition.examples.filter((example) => example.session_commitment === assignment.session_commitment).map((example) => example.split)).size === 1));
ok("initial assignment guarantees useful 70/15/15 session partitions", built.definition.stats.session_counts.train === 8 && built.definition.stats.session_counts.development === 2 && built.definition.stats.session_counts.test === 2);
ok("training readiness counts preference pairs only inside train", built.definition.stats.train_preferences === 32);
ok("positive holdout evidence is counted only outside train", built.definition.stats.holdout_positives === 48);
ok("development and test contain enough independent examples for paired statistics", built.definition.stats.split_counts.development === 32 && built.definition.stats.split_counts.test === 32);
ok("adequate multi-layer evidence is structurally ready for a candidate dataset", built.readiness.ready_for_candidate_dataset === true && built.readiness.blockers.length === 0);
ok("manifest is content-free and uses session commitments rather than session ids", !JSON.stringify(built.definition).includes(uuid(10_001)) && built.definition.examples.every((example) => /^[0-9a-f]{64}$/.test(example.session_commitment)));
ok("source-set commitment is deterministic across input order", built.source_set_hash === buildFeedbackDatasetDefinition([...rows].reverse(), [], { replica_id: RID, profile_version: 7, calibration_version: 3 }).source_set_hash);
ok("learner prompt commitment changes the reviewed source set", built.source_set_hash !== buildFeedbackDatasetDefinition(rows.map((row,index) => index === 1 ? { ...row, prompt_hash: "f".repeat(64) } : row), [], { replica_id: RID, profile_version: 7, calibration_version: 3 }).source_set_hash);
ok("current learner bytes commitment changes the reviewed source set", built.source_set_hash !== buildFeedbackDatasetDefinition(rows.map((row,index) => index === 1 ? { ...row, learner_input_sha256: "f".repeat(64) } : row), [], { replica_id: RID, profile_version: 7, calibration_version: 3 }).source_set_hash);

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

// Twelve CURRENT sessions, but only one development and one test session.
// Each holdout contains enough examples; two unrelated historical sessions
// must not supply the missing independent-session evidence.
const currentCommitments = [...new Set(built.definition.examples.map(example => example.session_commitment))];
const sparseAssignments = currentCommitments.map((session_commitment, index) => ({ session_commitment, split: index < 10 ? "train" : index === 10 ? "development" : "test" }));
const extraAssignments = [{ session_commitment: "a".repeat(64), split: "development" }, { session_commitment: "b".repeat(64), split: "test" }];
assert.ok(extraAssignments.every(assignment => !currentCommitments.includes(assignment.session_commitment)));
const sparseRows = [...rows];
for (const commitment of currentCommitments.slice(10)) {
  const example = built.definition.examples.find(example => example.session_commitment === commitment && example.kind === "positive_eval");
  const source = rows.find(row => row.feedback_id === example.feedback_id);
  for (let index = 0; index < 20; index++) sparseRows.push({ ...source, feedback_id: uuid(id++), turn_id: uuid(20_000 + id) });
}
const historical = buildFeedbackDatasetDefinition(sparseRows, [...sparseAssignments, ...extraAssignments], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("historical sessions cannot satisfy current independent holdout requirements", historical.definition.stats.sessions === 12
  && historical.definition.stats.session_counts.development === 1 && historical.definition.stats.session_counts.test === 1
  && historical.definition.stats.train_preferences >= 30 && historical.definition.stats.split_counts.development >= 20 && historical.definition.stats.split_counts.test >= 30
  && historical.readiness.blockers.includes("two_development_sessions_required") && historical.readiness.blockers.includes("two_test_sessions_required")
  && !historical.readiness.ready_for_candidate_dataset);
ok("historical split assignments remain immutable and available for returning sessions", [...sparseAssignments, ...extraAssignments].every(previous => historical.assignments.some(current => current.session_commitment === previous.session_commitment && current.split === previous.split)));
const withoutHistory = buildFeedbackDatasetDefinition(sparseRows, sparseAssignments, { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("unrelated historical assignments do not change the current dataset commitment", historical.source_set_hash === withoutHistory.source_set_hash);

const removedDevelopment = built.assignments.find(assignment => assignment.split === "development").session_commitment;
const removedTurns = new Set(built.definition.examples.filter(example => example.session_commitment === removedDevelopment).map(example => example.turn_id));
const removed = buildFeedbackDatasetDefinition(rows.filter(row => !removedTurns.has(row.turn_id)), built.assignments, { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("removing a session removes its readiness contribution without deleting its frozen split", removed.definition.stats.sessions === 11 && removed.definition.stats.session_counts.development === 1
  && removed.readiness.blockers.includes("two_development_sessions_required") && removed.assignments.some(assignment => assignment.session_commitment === removedDevelopment && assignment.split === "development"));
const returned = buildFeedbackDatasetDefinition(rows, removed.assignments, { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("returning evidence reuses its prior split and restores the same source commitment", returned.source_set_hash === built.source_set_hash);
const newVersion = buildFeedbackDatasetDefinition(rows, built.assignments, { replica_id: RID, profile_version: 8, calibration_version: 4 });
ok("a new version cannot count sessions represented only by older-version feedback", newVersion.definition.stats.examples === 0 && newVersion.definition.stats.sessions === 0
  && Object.values(newVersion.definition.stats.session_counts).every(count => count === 0) && !newVersion.readiness.ready_for_candidate_dataset);

// Execute the real implementation with just the old counting expression
// restored. The fixture must expose an incorrect ready=true, not merely check
// that a source-code string is absent.
const implementationPath = join(ROOT, "api/_replica-feedback-dataset.js");
const implementation = readFileSync(implementationPath, "utf8");
const oldCounting = implementation.replace("[...groups.keys()].filter((commitment) => assignments.get(commitment) === split)", "[...assignments.values()].filter((value) => value === split)");
assert.notEqual(oldCounting, implementation);
const absoluteImports = oldCounting.replace(/from "(\.[^"]+)"/g, (_, specifier) => `from ${JSON.stringify(new URL(specifier, pathToFileURL(implementationPath)).href)}`);
const oldModule = await import(`data:text/javascript;base64,${Buffer.from(absoluteImports).toString("base64")}`);
const falseReady = oldModule.buildFeedbackDatasetDefinition(sparseRows, [...sparseAssignments, ...extraAssignments], { replica_id: RID, profile_version: 7, calibration_version: 3 });
ok("NEGATIVE CONTROL: actual former counting incorrectly reports this dataset ready", falseReady.readiness.ready_for_candidate_dataset && falseReady.definition.stats.session_counts.development === 2 && falseReady.definition.stats.session_counts.test === 2);

const CAP = uuid(90_001);
const checkedAt = "2026-09-07T10:00:00.000Z";
const bound = buildFeedbackDatasetDefinition(rows, [], { replica_id: RID, capability_id: CAP, profile_version: 7, calibration_version: 3 });
const snapshot = (feedbackRows = rows, overrides = {}) => ({ replica_id: RID, capability_id: CAP,
  profile_version: 7, calibration_version: 3, feedback_rows: feedbackRows, assignments: [], saved_dataset: null, checked_at: checkedAt, ...overrides });
const savedReceipt = (overrides = {}) => ({ dataset_id: uuid(99_999), version: 1, capability_id: CAP,
  profile_version: 7, calibration_version: 3, source_set_hash: bound.source_set_hash, status: "draft", created_at: checkedAt, ...overrides });
async function buildFailure(feedbackRows, active = true, expectedHash = bound.source_set_hash) {
  let writes = 0;
  let failure;
  try {
    await buildOwnedFeedbackDataset(async sql => {
      if (sql === FEEDBACK_DATASET_REVIEW_SQL) return [snapshot(feedbackRows, active ? {} : { capability_id: null })];
      if (sql === FEEDBACK_DATASET_BUILD_SQL) { writes++; return []; }
      throw new Error("unexpected SQL");
    }, OWNER, RID, expectedHash);
  } catch (error) { failure = error; }
  return { failure, writes };
}
const emptyBuild = await buildFailure([]);
ok("zero eligible feedback returns an honest named error without attempting a dataset write", emptyBuild.failure?.code === "feedback_dataset_no_eligible_evidence" && emptyBuild.failure.status === 409 && emptyBuild.writes === 0
  && emptyBuild.failure.details.stats.examples === 0 && emptyBuild.failure.details.stats.sessions === 0
  && emptyBuild.failure.details.readiness.ready_for_candidate_dataset === false && emptyBuild.failure.details.readiness.blockers.length > 0);
const ineligibleBuild = await buildFailure(rows.map(row => ({ ...row, profile_version: 6 })));
ok("old-version feedback is also no eligible evidence, never a ready empty dataset", ineligibleBuild.failure?.code === "feedback_dataset_no_eligible_evidence" && ineligibleBuild.writes === 0);
const inactiveBuild = await buildFailure([], false);
ok("inactive runtime retains its distinct refusal ahead of empty evidence", inactiveBuild.failure?.code === "feedback_dataset_runtime_not_active" && inactiveBuild.writes === 0);
const racedBuild = await buildFailure(rows);
ok("feedback changing after a nonempty read retains the concurrency refusal", racedBuild.failure?.code === "feedback_dataset_changed_during_build" && racedBuild.writes === 1);

const dbCalls = [];
const stored = await buildOwnedFeedbackDataset(async (sql, params) => {
  dbCalls.push({ sql, params });
  if (sql === FEEDBACK_DATASET_REVIEW_SQL) return [snapshot()];
  if (sql === FEEDBACK_DATASET_BUILD_SQL) return [savedReceipt()];
  throw new Error(`unexpected SQL ${sql.slice(0, 100)}`);
}, OWNER, RID, bound.source_set_hash);
ok("owner build returns a draft rather than silently approving training data", stored.dataset.status === "draft" && stored.dataset.version === 1 && stored.review.dataset.status === "draft");
const mutation = dbCalls.find((call) => /insert into vy_replica_feedback_dataset/i.test(call.sql));
ok("mutation rechecks the complete latest feedback id and revision set", /full join expected e using\(feedback_id,revision\)/i.test(mutation.sql) && /feedback_dataset_changed_during_build/.test(readFileSync(join(ROOT, "api/_replica-feedback-dataset.js"), "utf8")));
ok("replica row lock serializes dataset version allocation", /for update of r/i.test(mutation.sql) && /coalesce\(max\(d\.version\),0\)\+1/i.test(mutation.sql));
ok("split registry rejects a concurrent conflicting assignment before dataset insertion", /compatible as/i.test(mutation.sql) && /where x\.split<>s\.split/i.test(mutation.sql) && /from authorized a,numbered n,unchanged,compatible/i.test(mutation.sql));
ok("same source set is idempotent and cannot allocate a second dataset", /on conflict \(replica_id,owner_user_id,profile_version,calibration_version,source_set_hash\)/i.test(mutation.sql));
ok("persisted dataset definition contains hashes and opaque ids but no reply or correction text", !/(original_reply|preferred_output|correction_text|transcript)/i.test(JSON.stringify(mutation.params[7])));

const read = (overrides = {}, evidence = rows) => readOwnedFeedbackDatasetReview(async (sql, params) => {
  assert.equal(sql, FEEDBACK_DATASET_REVIEW_SQL, "GET only uses the read statement");
  assert.equal(params[0], RID); assert.equal(params[1], OWNER);
  return [snapshot(evidence, overrides)];
}, OWNER, RID);
const current = await read();
ok("GET recomputes readiness without allocating any dataset", current.state === "ready" && current.dataset === null && current.source_set_hash === bound.source_set_hash && current.readiness.ready_for_candidate_dataset);
const emptyReview = await read({}, []);
ok("GET names empty evidence with real zero counts and no ready state", emptyReview.state === "empty" && !emptyReview.can_build && emptyReview.stats.examples === 0 && !emptyReview.readiness.ready_for_candidate_dataset);
const inactiveReview = await read({ capability_id: null, saved_dataset: savedReceipt() });
ok("inactive owner GET returns no old dataset or current authority", inactiveReview.state === "inactive" && inactiveReview.dataset === null && inactiveReview.binding === null && inactiveReview.source_set_hash === null);
await assert.rejects(() => readOwnedFeedbackDatasetReview(async () => [], OWNER, RID), error => error.code === "replica_not_found" && error.status === 404);
ok("missing and foreign owner scopes refuse without a dataset receipt", true);
const staleReview = await read({ saved_dataset: { ...savedReceipt({ source_set_hash: "a".repeat(64) }), readiness: { ready_for_candidate_dataset: true }, definition: { secret: "never exposed" } } }, rows.slice(0, 5));
ok("stored historical ready flags cannot override current evidence", staleReview.state === "stale" && !staleReview.readiness.ready_for_candidate_dataset && staleReview.changed_since_saved && staleReview.stats.sessions === 1);
ok("read/build responses exclude manifests, ratings, session ids and source text", !/(never exposed|definition|feedback_id|turn_id|ratings|session_id|correction_text|original_reply)/.test(JSON.stringify([current, staleReview, stored])));
ok("receipt preserves an already approved status without claiming a new approval", (await read({ saved_dataset: savedReceipt({ status: "approved" }) })).dataset.status === "approved");
const changedCap = await read({ capability_id: uuid(90_002) });
ok("same evidence under a new capability changes the reviewed commitment", changedCap.source_set_hash !== current.source_set_hash && changedCap.binding.capability_id !== CAP);
const changedVersion = await read({ profile_version: 8 });
ok("new current profile cannot reuse a former version's feedback or hash", changedVersion.state === "empty" && changedVersion.source_set_hash !== current.source_set_hash);
const changedCalibration = await read({ calibration_version: 4 });
ok("new calibration independently changes reviewed authority and evidence", changedCalibration.state === "empty" && changedCalibration.source_set_hash !== current.source_set_hash);
let hashlessReads = 0;
for (const hash of [undefined, null, "", bound.source_set_hash + "\n", "A".repeat(64)]) await assert.rejects(
  () => buildOwnedFeedbackDataset(async () => { hashlessReads++; return []; }, OWNER, RID, hash), error => error.code === "feedback_dataset_review_required" && error.status === 400);
ok("every build requires an exact reviewed hash before any database work", hashlessReads === 0);
const staleBuild = await buildFailure(rows, true, "a".repeat(64));
ok("a stale reviewed source set refuses before any mutation", staleBuild.failure?.code === "feedback_dataset_review_changed" && staleBuild.writes === 0);
ok("actual SQL binds current capability and locks both authority rows", /c\.capability_id=\$13::uuid/.test(mutation.sql) && /for update of r,c/.test(mutation.sql) && mutation.params[12] === CAP);
ok("race guard rechecks all classification and source commitment inputs", /l\.fingerprint is distinct from e\.fingerprint/.test(mutation.sql)
  && Object.keys(JSON.parse(mutation.params[8])[0].fingerprint).sort().join() === ["turn_id", "ratings", "ratings_hash", "prompt_hash", "learner_input_sha256", "response_hash", "correction_hash", "source_generation_id", "session_id"].sort().join());
ok("read authority does not traverse shared agent tables or infer full activation readiness", !/join vy_agent|vy_replica_readiness|vy_replica_consent/.test(FEEDBACK_DATASET_REVIEW_SQL)
  && /r\.subject_mode='self'/.test(FEEDBACK_DATASET_REVIEW_SQL) && /r\.policy_version=\$3/.test(FEEDBACK_DATASET_REVIEW_SQL));
ok("candidate evidence admits only the owner's own learner turns", /p\.auth_user_id=f\.owner_user_id/.test(FEEDBACK_DATASET_REVIEW_SQL) && /p\.person_id=t\.person_id/.test(FEEDBACK_DATASET_REVIEW_SQL) && /p\.auth_user_id=f\.owner_user_id/.test(FEEDBACK_DATASET_BUILD_SQL));

const migration = readFileSync(join(ROOT, "db/migrations/030_replica_feedback_dataset.sql"), "utf8");
ok("feedback dataset migration remains one-statement-runner safe", splitSql(migration).length === 4);
ok("dataset and split registry are composite owner bound and replica erasable", (migration.match(/foreign key \(replica_id,owner_user_id\)/gi) || []).length >= 2 && /primary key \(replica_id,owner_user_id,session_commitment\)/i.test(migration) && /vy_replica_feedback_split_owner_fk[\s\S]*on delete cascade/i.test(migration));
ok("database accepts only train development or test split labels", /split in \('train','development','test'\)/i.test(migration));
const route = readFileSync(join(ROOT, "api/replica-feedback-dataset.js"), "utf8");
ok("production dataset route is owner authenticated rate limited and build only", /requireUser/.test(route) && /allow\(user\.id/.test(route) && /buildOwnedFeedbackDataset/.test(route) && !/approve/i.test(route));

console.log(`\n${checks} feedback dataset checks passed`);
