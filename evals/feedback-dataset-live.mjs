// Opt-in exact-development SQL checks. Synthetic prerequisite rows only:
// no identity/consent grants, activation function, inference or provider calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildOwnedFeedbackDataset as build, readOwnedFeedbackDatasetReview as read,
  FEEDBACK_DATASET_REVIEW_SQL as READ, FEEDBACK_DATASET_BUILD_SQL as BUILD } from "../api/_replica-feedback-dataset.js";
import { REPLICA_POLICY_VERSION as POLICY } from "../api/_replica.js";

export async function runFeedbackDatasetSqlChecks({ db, openSession, onFixtureManifest }) {
  const owner = randomUUID(), foreignOwner = randomUUID(), rid = randomUUID(), inactive = randomUUID();
  const person = randomUUID(), device = randomUUID(), agent = randomUUID(), voice = randomUUID();
  const cap = randomUUID(), session = randomUUID(), turn = randomUUID();
  const feedback = Array.from({ length: 3 }, () => randomUUID()), datasets = [];
  const manifest = () => ({ ownerUserIds: [owner, foreignOwner], replicaIds: [rid, inactive], personIds: [person],
    deviceIds: [device], agentIds: [agent], voiceProfileIds: [voice], capabilityIds: [cap], sessionIds: [session],
    turnIds: [turn], feedbackIds: [...feedback], datasetIds: [...datasets] });
  const checks = [], sessions = new Set();
  let stage = "manifest", failure = null, cleanupFailure = null, verified = false, writesStarted = false, remainingFixtureRows = null;
  const diagnostic = error => ({ stage, code: typeof error?.code === "string" && /^[A-Za-z0-9_]{2,80}$/.test(error.code) ? error.code : "UNCLASSIFIED",
    frames: String(error?.stack || "").split("\n").map(line => line.match(/feedback-dataset-live\.mjs:\d+:\d+/)?.[0]).filter(Boolean) });
  const query = async (sql, params = []) => {
    if (sql === BUILD) {
      if (!datasets.includes(params[2])) { datasets.push(params[2]); await onFixtureManifest(manifest()); }
      await db("EXPLAIN " + sql, params);
    }
    return db(sql, params);
  };
  const review = () => read(query, owner, rid);
  const countDatasets = async () => Number((await db("select count(*) as n from vy_replica_feedback_dataset where replica_id=$1::uuid and owner_user_id=$2::uuid", [rid, owner]))[0].n);
  const addFeedback = (q, index) => q(`insert into vy_replica_turn_feedback
    (feedback_id,turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash,
     revision,supersedes_id,ratings,ratings_hash,policy_version)
    values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,1,$6,$7::int4,$8::uuid,'{"wording":"exact"}'::jsonb,$9,$10)`,
    [feedback[index], turn, rid, owner, cap, "b".repeat(64), index + 1, index ? feedback[index - 1] : null, String(index + 1).repeat(64), POLICY]);
  const race = async change => {
    const current = await review();
    const connection = await openSession(); sessions.add(connection);
    let intercepted = false;
    try {
      await assert.rejects(() => build(async (sql, params) => {
        if (sql === BUILD && !intercepted) {
          intercepted = true;
          await connection.query("BEGIN");
          await change(connection.query);
          await connection.query("COMMIT");
        }
        return query(sql, params);
      }, owner, rid, current.source_set_hash), error => error.code === "feedback_dataset_changed_during_build");
      assert(intercepted, "independent writer ran between snapshot and actual mutation");
    } finally {
      await connection.query("ROLLBACK"); await connection.close(); sessions.delete(connection);
    }
  };
  try {
    assert.equal(typeof onFixtureManifest, "function"); assert.equal(typeof openSession, "function");
    await onFixtureManifest(manifest());
    stage = "verify-development-database";
    assert.equal((await db("select current_database() as name"))[0]?.name, "vyakti_expert_integration_20260906"); verified = true;
    stage = "read-explain-missing-owner";
    await db("EXPLAIN " + READ, [rid, owner, POLICY]);
    await assert.rejects(() => review(), error => error.code === "replica_not_found"); checks.push(stage);
    stage = "synthetic-prerequisites"; writesStarted = true;
    await db("insert into vy_person(person_id) values($1::uuid)", [person]);
    await db("insert into vy_person_device(device_id,person_id) values($1::uuid,$2::uuid)", [device, person]);
    await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic correction SQL fixture')", [agent, "synthetic-correction-" + agent]);
    await db("insert into vy_replica(replica_id,owner_user_id,subject_person_id,agent_id,display_name,policy_version,lifecycle) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Synthetic correction SQL fixture',$5,'active')", [rid, owner, person, agent, POLICY]);
    await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic inactive SQL fixture',$3)", [inactive, owner, POLICY]);
    for (const version of [1, 2]) {
      await db("insert into vy_replica_profile(replica_id,version,source_set_hash,definition,status) values($1::uuid,$2::int4,$3,'{}'::jsonb,'approved')", [rid, version, String(version).repeat(64)]);
      await db("insert into vy_replica_calibration(replica_id,owner_user_id,version,profile_version,source_set_hash,definition,status) values($1::uuid,$2::uuid,$3::int4,$3::int4,$4,'{}'::jsonb,'approved')", [rid, owner, version, String(version).repeat(64)]);
    }
    await db("insert into vy_replica_voice_genome(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,'{}'::jsonb,'approved')", [rid, "c".repeat(64)]);
    await db("insert into vy_replica_voice_profile(voice_profile_id,replica_id,owner_user_id,genome_version,provider,model,provider_ref,status) values($1::uuid,$2::uuid,$3::uuid,1,'azure','synthetic-no-model',$4,'ready')", [voice, rid, owner, "synthetic-unusable-" + voice]);
    await db(`insert into vy_replica_runtime_capability(capability_id,replica_id,owner_user_id,agent_id,subject_person_id,voice_profile_id,
      genome_version,profile_version,calibration_version,qualification_hash,policy_version)
      values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,1,1,1,$7,$8)`, [cap, rid, owner, agent, person, voice, "d".repeat(64), "synthetic-no-activation"]);
    await db("insert into vy_replica_runtime_session(session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,channel,trace_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'private_chat','synthetic-correction-fixture')", [session, cap, rid, owner, agent, person]);
    stage = "inactive-empty-and-foreign-get";
    assert.equal((await read(query, owner, inactive)).state, "inactive");
    const empty = await review(); assert.equal(empty.state, "empty"); assert.equal(empty.can_build, false);
    await assert.rejects(() => read(query, foreignOwner, rid), error => error.code === "replica_not_found");
    await assert.rejects(() => build(query, owner, rid, empty.source_set_hash), error => error.code === "feedback_dataset_no_eligible_evidence");
    assert.equal(await countDatasets(), 0); checks.push(stage);
    stage = "synthetic-feedback-evidence";
    const log = (await db("insert into meera_log(device_id,agent_id,role,channel,kind,content) values($1::uuid,$2::uuid,'him','chat','text','Synthetic SQL fixture, not model output') returning id", [device, agent]))[0].id;
    await db(`insert into vy_replica_dialogue_turn(turn_id,session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,device_id,ordinal,
      profile_version,calibration_version,schema_version,provider_family,provider_name,provider_version,model,trace_id,user_log_id,prompt_hash,response_hash,state)
      values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,1,1,1,'synthetic','azure','synthetic','none','none','synthetic-correction-fixture',$9::bigint,$10,$11,'complete')`,
      [turn, session, cap, rid, owner, agent, person, device, log, "a".repeat(64), "b".repeat(64)]);
    await addFeedback(db, 0);
    stage = "collecting-get-and-unreviewed-refusal";
    const current = await review(); assert.equal(current.state, "collecting"); assert.equal(current.stats.examples, 1); assert.equal(current.readiness.ready_for_candidate_dataset, false);
    await assert.rejects(() => build(query, owner, rid), error => error.code === "feedback_dataset_review_required");
    await assert.rejects(() => build(query, owner, rid, "f".repeat(64)), error => error.code === "feedback_dataset_review_changed");
    assert.equal(await countDatasets(), 0); checks.push(stage);
    stage = "actual-draft-build-and-idempotency";
    const saved = await build(query, owner, rid, current.source_set_hash);
    assert.equal(saved.dataset.status, "draft"); assert.equal(saved.review.readiness.ready_for_candidate_dataset, false);
    const retry = await build(query, owner, rid, current.source_set_hash);
    assert.equal(retry.dataset.dataset_id, saved.dataset.dataset_id); assert.equal(await countDatasets(), 1); checks.push(stage);
    stage = "persisted-ready-flag-does-not-authorize-readiness";
    await db("update vy_replica_feedback_dataset set readiness='{\"ready_for_candidate_dataset\":true,\"blockers\":[]}'::jsonb where dataset_id=$1::uuid and owner_user_id=$2::uuid", [saved.dataset.dataset_id, owner]);
    assert.equal((await review()).readiness.ready_for_candidate_dataset, false); checks.push(stage);
    stage = "independent-revision-between-review-and-insert";
    await race(q => addFeedback(q, 1)); assert.equal(await countDatasets(), 1);
    const stale = await review(); assert.equal(stale.state, "stale"); assert.equal(stale.changed_since_saved, true);
    assert.notEqual(stale.source_set_hash, current.source_set_hash); checks.push(stage);
    stage = "independent-authority-change-between-review-and-insert";
    await race(q => q("update vy_replica_runtime_capability set state='paused' where capability_id=$1::uuid and owner_user_id=$2::uuid", [cap, owner]));
    assert.equal((await review()).state, "inactive"); assert.equal(await countDatasets(), 1); checks.push(stage);
    stage = "current-version-excludes-old-session-evidence";
    await db("update vy_replica_runtime_capability set state='active',profile_version=2,calibration_version=2 where capability_id=$1::uuid and owner_user_id=$2::uuid", [cap, owner]);
    const next = await review(); assert.equal(next.state, "empty"); assert.equal(next.dataset, null);
    assert.equal(next.stats.sessions, 0); assert.deepEqual(next.stats.session_counts, { train: 0, development: 0, test: 0 }); checks.push(stage);
    stage = "removed-session-is-not-readiness-evidence";
    await db("update vy_replica_runtime_capability set profile_version=1,calibration_version=1 where capability_id=$1::uuid and owner_user_id=$2::uuid", [cap, owner]);
    await db("delete from vy_replica_runtime_session where session_id=$1::uuid and owner_user_id=$2::uuid", [session, owner]);
    const removed = await review(); assert.equal(removed.state, "empty"); assert.equal(removed.stats.sessions, 0); assert.equal(removed.readiness.ready_for_candidate_dataset, false);
    assert.equal(Number((await db("select count(*) as n from vy_replica_feedback_split where replica_id=$1::uuid and owner_user_id=$2::uuid", [rid, owner]))[0].n), 1); checks.push(stage);
    stage = "no-identity-consent-or-activation-grants";
    assert.equal(Number((await db("select count(*) as n from vy_replica_consent where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid", [[rid, inactive], owner]))[0].n), 0);
    assert.equal(Number((await db("select count(*) as n from vy_replica where replica_id=any($1::uuid[]) and (age_verified_at is not null or identity_verified_at is not null or liveness_verified_at is not null)", [[rid, inactive]]))[0].n), 0); checks.push(stage);
  } catch (error) { failure = error; error.primaryFailure = diagnostic(error); }
  finally {
    const cleanupErrors = [];
    for (const connection of sessions) {
      try { await connection.query("ROLLBACK"); } catch { cleanupErrors.push("ROLLBACK"); }
      try { await connection.close(); } catch { cleanupErrors.push("CLOSE"); }
    }
    if (verified) {
      const scoped = [
        ...["vy_replica_feedback_split", "vy_replica_feedback_dataset", "vy_replica_turn_exemplar", "vy_replica_turn_feedback", "vy_replica_dialogue_turn", "vy_replica_runtime_session", "vy_replica_runtime_capability", "vy_replica_voice_profile", "vy_replica_calibration"].map(table => [table, "replica_id=$1::uuid and owner_user_id=$2::uuid", [rid, owner]]),
        ...["vy_replica_profile", "vy_replica_voice_genome"].map(table => [table, "replica_id=$1::uuid", [rid]]),
        ["vy_replica", "replica_id=any($1::uuid[]) and owner_user_id=$2::uuid", [[rid, inactive], owner]],
        ["meera_log", "agent_id=$1::uuid and device_id=$2::uuid", [agent, device]],
        ["vy_person_device", "person_id=$1::uuid and device_id=$2::uuid", [person, device]],
        ["vy_agent", "agent_id=$1::uuid", [agent]], ["vy_person", "person_id=$1::uuid", [person]],
      ];
      for (const [table, predicate, params] of scoped) try { await db(`delete from ${table} where ${predicate}`, params); } catch { cleanupErrors.push("DELETE_" + table); }
      let remaining = 0;
      for (const [table, predicate, params] of scoped) try { remaining += Number((await db(`select count(*) as n from ${table} where ${predicate}`, params))[0].n); } catch { cleanupErrors.push("COUNT_" + table); }
      remainingFixtureRows = cleanupErrors.length ? null : remaining;
      if (remaining !== 0) cleanupErrors.push("NONZERO_FIXTURE_ROWS");
    }
    if (cleanupErrors.length) cleanupFailure = { code: "FIXTURE_CLEANUP_INCOMPLETE", stages: cleanupErrors };
  }
  if (failure || cleanupFailure) {
    const error = failure || Object.assign(new Error("fixture-cleanup-incomplete"), { code: "FIXTURE_CLEANUP_INCOMPLETE" });
    Object.assign(error, { failedStage: stage, targetVerified: verified, fixtureWritesStarted: writesStarted, remainingFixtureRows, cleanupFailure }); throw error;
  }
  return { passed: checks.length, checks, remainingFixtureRows, feedbackDatasetCleanupVerified: remainingFixtureRows === 0,
    limitation: "Synthetic SQL preparation and independent writes between review and build; no real identity, model output, quality, activation or concurrent lock guarantee." };
}
