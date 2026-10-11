// Root-invoked actual isolated-development SQL proof. No provider, biometric
// measurement, real owner content, session activation API or inference call.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readOwnedDialogueHistory as read, openOwnedDialogueSession as open,
  DIALOGUE_HISTORY_SQL as READ, DIALOGUE_OPEN_SQL as OPEN, DIALOGUE_HISTORY_SPEND_SQL as SPEND } from "../api/_replica-dialogue-history.js";
import { REPLICA_POLICY_VERSION as POLICY } from "../api/_replica.js";
import { canonicalJson, sha256Hex } from "../api/_provenance/contracts.js";

export async function runDialogueHistorySqlChecks({ db, onFixtureManifest }) {
  const fixtures = Array.from({ length: 2 }, () => ({ owner: randomUUID(), rid: randomUUID(), person: randomUUID(),
    agent: randomUUID(), device: randomUUID(), voice: randomUUID(), cap: randomUUID(), source: randomUUID(),
    sessions: Array.from({ length: 3 }, () => randomUUID()), turns: Array.from({ length: 14 }, () => randomUUID()) }));
  const [a, b] = fixtures;
  const budget = "history-fixture-" + randomUUID().replaceAll("-", "");
  const delivery = { mode: "grounded", pace: "natural", intensity: 0.2, language_hint: "English", nonverbals: [] };
  const manifest = { ownerUserIds: fixtures.map(x => x.owner), replicaIds: fixtures.map(x => x.rid), personIds: fixtures.map(x => x.person),
    agentIds: fixtures.map(x => x.agent), deviceIds: fixtures.map(x => x.device), voiceProfileIds: fixtures.map(x => x.voice),
    capabilityIds: fixtures.map(x => x.cap), sourceIds: fixtures.map(x => x.source), sessionIds: fixtures.flatMap(x => x.sessions),
    turnIds: fixtures.flatMap(x => x.turns), budgetIds: [budget] };
  let stage = "manifest", verified = false, failure = null, remainingFixtureRows = null;
  const checks = [], cleanupErrors = [];
  const query = async (sql, params) => { if ([READ, OPEN, SPEND].includes(sql)) await db("EXPLAIN " + sql, params); return db(sql, params); };
  const readA = (sid) => read(query, a.owner, { replica_id: a.rid, ...(sid ? { session_id: sid } : {}) });
  const openA = sid => open(query, a.owner, { replica_id: a.rid, session_id: sid });
  const key = turnId => sha256Hex(canonicalJson({ operation: "dialogue", request_key: turnId,
    provider_family: "azure", provider_name: "synthetic", provider_version: "none", model: "none" }));
  const addTurn = async (f, index, sid, state = "complete") => {
    const logs = [];
    for (const [role, content] of [["me", `Synthetic question ${index}`], ["her", `Synthetic answer ${index}`]])
      logs.push((await db("insert into meera_log(device_id,agent_id,role,channel,kind,content) values($1::uuid,$2::uuid,$3,'chat','text',$4) returning id", [f.device, f.agent, role, content]))[0].id);
    await db(`insert into vy_replica_dialogue_turn(turn_id,session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,device_id,
      ordinal,profile_version,calibration_version,schema_version,provider_family,provider_name,provider_version,model,trace_id,
      user_log_id,assistant_log_id,prompt_hash,response_hash,delivery_plan,state)
      values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::int4,1,1,'synthetic','azure','synthetic','none','none',$10,
      $11::bigint,$12::bigint,$13,$14,$15::jsonb,$16)`, [f.turns[index], sid, f.cap, f.rid, f.owner, f.agent, f.person, f.device,
      index + 1, "synthetic-history-" + index, logs[0], state === "complete" ? logs[1] : null, "a".repeat(64), state === "complete" ? "b".repeat(64) : null,
      state === "complete" ? JSON.stringify(delivery) : null, state]);
  };
  try {
    assert.equal(typeof onFixtureManifest, "function"); await onFixtureManifest(manifest);
    stage = "exact-development-target";
    assert.equal((await db("select current_database() as name"))[0]?.name, "vyakti_expert_integration_20260906"); verified = true;
    stage = "missing-runtime-explain-and-execution";
    await assert.rejects(() => readA(), { code: "dialogue_runtime_not_active" });
    await assert.rejects(() => openA(a.sessions[0]), { code: "dialogue_session_not_authorized" }); checks.push(stage);
    stage = "synthetic-runtime-prerequisites";
    for (const f of fixtures) {
      await db("insert into vy_person(person_id,age_tier) values($1::uuid,'adult_verified')", [f.person]);
      await db("insert into vy_account_person(auth_user_id,person_id) values($1::uuid,$2::uuid)", [f.owner, f.person]);
      await db("insert into vy_person_device(device_id,person_id) values($1::uuid,$2::uuid)", [f.device, f.person]);
      await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic history SQL fixture')", [f.agent, "history-fixture-" + f.agent]);
      await db(`insert into vy_replica(replica_id,owner_user_id,subject_person_id,agent_id,display_name,policy_version,lifecycle,
        age_verified_at,identity_verified_at,liveness_verified_at,identity_expires_at)
        values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Synthetic history SQL fixture',$5,'active',now(),now(),now(),now()+interval '1 day')`,
        [f.rid, f.owner, f.person, f.agent, POLICY]);
      for (const scope of ["inference", "training"]) await db("insert into vy_replica_consent(replica_id,owner_user_id,scope,method,policy_version,receipt_hash) values($1::uuid,$2::uuid,$3,'manual_review',$4,$5)", [f.rid, f.owner, scope, POLICY, "a".repeat(64)]);
      const claim = (await db("insert into vy_replica_claim(replica_id,owner_user_id,domain,key,body,origin,confidence,status,source_ids) values($1::uuid,$2::uuid,'identity','synthetic','Synthetic SQL fixture','self_declared',1,'approved',array[$3::uuid]) returning claim_id", [f.rid, f.owner, f.source]))[0];
      await db("insert into vy_replica_claim_decision(claim_id,replica_id,owner_user_id,decision,reason_code,policy_version) values($1::bigint,$2::uuid,$3::uuid,'accepted','synthetic_sql_fixture',$4)", [claim.claim_id, f.rid, f.owner, POLICY]);
      await db("insert into vy_replica_profile(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,$3::jsonb,'approved')", [f.rid, "b".repeat(64), JSON.stringify({ provenance: { claims: [{ claim_id: String(claim.claim_id) }] } })]);
      await db("insert into vy_replica_calibration(replica_id,owner_user_id,version,profile_version,source_set_hash,definition,status) values($1::uuid,$2::uuid,1,1,$3,'{}'::jsonb,'approved')", [f.rid, f.owner, "c".repeat(64)]);
      await db("insert into vy_replica_voice_genome(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,'{}'::jsonb,'approved')", [f.rid, "d".repeat(64)]);
      await db("insert into vy_replica_voice_profile(voice_profile_id,replica_id,owner_user_id,genome_version,provider,model,provider_ref,status) values($1::uuid,$2::uuid,$3::uuid,1,'azure','synthetic-unusable',$4,'ready')", [f.voice, f.rid, f.owner, "synthetic-unusable-" + f.voice]);
      await db(`insert into vy_replica_runtime_capability(capability_id,replica_id,owner_user_id,agent_id,subject_person_id,voice_profile_id,
        genome_version,profile_version,calibration_version,qualification_hash,policy_version)
        values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,1,1,1,$7,'synthetic-not-activation')`, [f.cap, f.rid, f.owner, f.agent, f.person, f.voice, "e".repeat(64)]);
    }
    stage = "empty-read-no-session-creation"; assert.equal((await readA()).session_id, null);
    assert.equal(Number((await db("select count(*) as n from vy_replica_runtime_session where replica_id=$1::uuid", [a.rid]))[0].n), 0); checks.push(stage);
    stage = "idempotent-exact-session-open";
    assert.equal((await openA(a.sessions[0])).session_id, a.sessions[0]);
    const before = (await db("select * from vy_replica_runtime_session where session_id=$1::uuid", [a.sessions[0]]))[0];
    await Promise.all([openA(a.sessions[0]), openA(a.sessions[0])]);
    assert.deepEqual((await db("select * from vy_replica_runtime_session where session_id=$1::uuid", [a.sessions[0]]))[0], before);
    checks.push(stage);
    stage = "latest-completed-ten-in-chronological-pairs";
    for (let i = 0; i < 13; i++) await addTurn(a, i, a.sessions[0]);
    let restored = await readA();
    assert.equal(restored.session_id, a.sessions[0]); assert.equal(restored.exchanges.length, 10);
    assert.deepEqual(restored.exchanges.map(x => [x.question, x.answer.reply]), Array.from({ length: 10 }, (_, i) => [`Synthetic question ${i + 3}`, `Synthetic answer ${i + 3}`]));
    assert.equal(restored.pending, false); checks.push(stage);
    stage = "foreign-owner-replica-session-and-key-refused";
    await open(query, b.owner, { replica_id: b.rid, session_id: b.sessions[0] }); await addTurn(b, 0, b.sessions[0]);
    await assert.rejects(() => read(query, b.owner, { replica_id: a.rid }), { code: "dialogue_runtime_not_active" });
    await assert.rejects(() => readA(b.sessions[0]), { code: "dialogue_session_not_authorized" });
    await assert.rejects(() => openA(b.sessions[0]), { code: "dialogue_session_not_authorized" }); checks.push(stage);
    stage = "actual-owner-predicate-removal-negative-control";
    const mutant = READ.replace("r.owner_user_id=$2::uuid", "true"); assert.notEqual(mutant, READ);
    // Retain parameter type resolution even after removing the authorization predicate.
    const unscoped = mutant.replace("from (select 1) seed", "from (select $2::uuid) seed");
    const leaked = await db(unscoped, [a.rid, b.owner, a.sessions[0], POLICY]);
    assert.equal(leaked[0].runtime_active, true); assert.equal(leaked[0].exchanges.length, 10); checks.push(stage);
    stage = "incomplete-reply-honestly-pending";
    await addTurn(a, 13, a.sessions[0], "generating"); restored = await readA();
    assert.equal(restored.pending, true); assert.equal(restored.exchanges.length, 10);
    assert.deepEqual(restored.latest_request, { state: "generating", trace_id: "synthetic-history-13" });
    await db("update vy_replica_dialogue_turn set state='failed' where turn_id=$1::uuid", [a.turns[13]]); checks.push(stage);
    stage = "unsettled-ledger-survives-restoration";
    await db("insert into vy_provider_budget(budget_id,limit_microusd,reserved_microusd) values($1,100,1)", [budget]);
    await db(`insert into vy_provider_spend(budget_id,operation,provider_family,provider_name,provider_version,model,request_hash,unit_kind,reserved_microusd,state)
      values($1,'dialogue','azure','synthetic','none','none',$2,'tokens',1,'reconcile_required')`, [budget, key(a.turns[12])]);
    assert.equal((await readA()).billing_pending, true);
    await db("update vy_provider_spend set state='settled' where budget_id=$1", [budget]);
    assert.equal((await readA()).exchanges.at(-1).answer.billing_state, "settled"); checks.push(stage);
    stage = "new-empty-session-preserves-prior-explicit-history";
    await openA(a.sessions[1]); assert.equal((await readA()).session_id, a.sessions[1]);
    assert.deepEqual((await readA()).exchanges, []); assert.equal((await readA(a.sessions[0])).exchanges.length, 10); checks.push(stage);
    stage = "expired-ended-revoked-and-call-sessions-excluded";
    for (const state of ["ended", "revoked", "expired"]) {
      await db("update vy_replica_runtime_session set state=$2 where session_id=$1::uuid", [a.sessions[1], state]);
      await assert.rejects(() => readA(a.sessions[1]), { code: "dialogue_session_not_authorized" });
      await assert.rejects(() => openA(a.sessions[1]), { code: "dialogue_session_not_authorized" });
    }
    await db("update vy_replica_runtime_session set state='active',last_active_at=now()-interval '12 hours' where session_id=$1::uuid", [a.sessions[1]]);
    await assert.rejects(() => readA(a.sessions[1]), { code: "dialogue_session_not_authorized" });
    await db("update vy_replica_runtime_session set channel='private_call',last_active_at=now() where session_id=$1::uuid", [a.sessions[1]]);
    assert.equal((await readA()).session_id, a.sessions[0]); checks.push(stage);
    stage = "live-authority-changes-refuse-current-history";
    const changes = [
      ["update vy_replica set lifecycle='paused' where replica_id=$1::uuid", "update vy_replica set lifecycle='active' where replica_id=$1::uuid"],
      ["update vy_replica set identity_expires_at=now()-interval '1 minute' where replica_id=$1::uuid", "update vy_replica set identity_expires_at=now()+interval '1 day' where replica_id=$1::uuid"],
      ["update vy_replica_consent set revoked_at=now() where replica_id=$1::uuid and scope='inference'", "update vy_replica_consent set revoked_at=null where replica_id=$1::uuid and scope='inference'"],
      ["update vy_replica_claim set status='rejected' where replica_id=$1::uuid", "update vy_replica_claim set status='approved' where replica_id=$1::uuid"],
      ["update vy_replica_calibration set status='retired' where replica_id=$1::uuid", "update vy_replica_calibration set status='approved' where replica_id=$1::uuid"],
      ["update vy_replica_runtime_capability set state='revoked' where replica_id=$1::uuid", "update vy_replica_runtime_capability set state='active' where replica_id=$1::uuid"],
    ];
    for (const [change, restore] of changes) {
      await db(change, [a.rid]); await assert.rejects(() => readA(), { code: "dialogue_runtime_not_active" });
      await assert.rejects(() => openA(a.sessions[2]), { code: "dialogue_session_not_authorized" }); await db(restore, [a.rid]);
    }
    checks.push(stage);
    stage = "raw-log-erasure-removes-corresponding-restored-pair";
    await db("delete from meera_log where id=(select user_log_id from vy_replica_dialogue_turn where turn_id=$1::uuid)", [a.turns[12]]);
    assert(!(await readA(a.sessions[0])).exchanges.some(x => x.answer.turn_id === a.turns[12]));
    assert.equal((await read(query, b.owner, { replica_id: b.rid })).exchanges.length, 1); checks.push(stage);
  } catch (error) { failure = error; }
  finally {
    if (verified) {
      const scopes = [["vy_provider_spend", "budget_id=$1", [budget]], ["vy_provider_budget", "budget_id=$1", [budget]]];
      for (const f of fixtures) scopes.push(
        ...["vy_replica_dialogue_turn", "vy_replica_runtime_session", "vy_replica_runtime_capability", "vy_replica_voice_profile", "vy_replica_calibration"].map(table => [table, "replica_id=$1::uuid and owner_user_id=$2::uuid", [f.rid, f.owner]]),
        ...["vy_replica_profile", "vy_replica_voice_genome", "vy_replica_claim_decision", "vy_replica_claim", "vy_replica_consent", "vy_replica"].map(table => [table, "replica_id=$1::uuid", [f.rid]]),
        ["meera_log", "agent_id=$1::uuid and device_id=$2::uuid", [f.agent, f.device]],
        ["vy_person_device", "person_id=$1::uuid and device_id=$2::uuid", [f.person, f.device]],
        ["vy_account_person", "auth_user_id=$1::uuid and person_id=$2::uuid", [f.owner, f.person]],
        ["vy_agent", "agent_id=$1::uuid", [f.agent]], ["vy_person", "person_id=$1::uuid", [f.person]]);
      for (const [table, predicate, params] of scopes) try { await db(`delete from ${table} where ${predicate}`, params); } catch (error) { cleanupErrors.push({ stage: "DELETE_" + table, code: error.code }); }
      let remaining = 0;
      for (const [table, predicate, params] of scopes) try { remaining += Number((await db(`select count(*) as n from ${table} where ${predicate}`, params))[0].n); } catch (error) { cleanupErrors.push({ stage: "COUNT_" + table, code: error.code }); }
      remainingFixtureRows = cleanupErrors.length ? null : remaining;
      if (remaining !== 0) cleanupErrors.push({ stage: "NONZERO_FIXTURE_ROWS" });
    }
  }
  if (failure || cleanupErrors.length) {
    const error = failure || new Error("fixture_cleanup_incomplete");
    Object.assign(error, { failedStage: stage, primaryCode: failure?.code || null, remainingFixtureRows, cleanupErrors,
      frames: String(failure?.stack || "").split("\n").map(line => line.match(/dialogue-history-live\.mjs:\d+:\d+/)?.[0]).filter(Boolean) });
    throw error;
  }
  return { passed: checks.length, checks, remainingFixtureRows, cleanupErrors,
    limitation: "Actual synthetic SQL history/open/erasure proof; no real owner session, provider generation, identity acceptance or long-term memory." };
}
