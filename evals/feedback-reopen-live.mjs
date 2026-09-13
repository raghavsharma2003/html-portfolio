// Opt-in synthetic development SQL and exact encrypted revision checks. No model calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CURRENT_TURN_FEEDBACK_SQL as READ, readOwnedTurnFeedback as read, recordOwnedTurnFeedback as write } from "../api/_replica-feedback.js";
import { REPLICA_POLICY_VERSION as POLICY } from "../api/_replica.js";
export async function runFeedbackReopenSqlChecks({ db, openSession, onFixtureManifest }) {
  const owner=randomUUID(),foreignOwner=randomUUID(),rid=randomUUID(),inactive=randomUUID(),person=randomUUID(),device=randomUUID(),agent=randomUUID(),voice=randomUUID(),cap=randomUUID(),session=randomUUID(),turn=randomUUID();
  const feedback=[],sessions=new Set(),checks=[];
  const env={REPLICA_FEEDBACK_KEK_ID:"synthetic-reopen-key",REPLICA_FEEDBACK_KEK_B64:Buffer.alloc(32,43).toString("base64")};
  const manifest=()=>({ownerUserIds:[owner,foreignOwner],replicaIds:[rid,inactive],personIds:[person],deviceIds:[device],agentIds:[agent],voiceProfileIds:[voice],capabilityIds:[cap],sessionIds:[session],turnIds:[turn],feedbackIds:[...feedback],syntheticPrerequisites:true});
  let stage="manifest",failure=null,cleanupFailure=null,verified=false,writesStarted=false,remainingFixtureRows=null;
  const diagnostic=error=>({stage,code:typeof error?.code==="string"&&/^[A-Za-z0-9_]{2,80}$/.test(error.code)?error.code:"UNCLASSIFIED"});
  const query=async(sql,params=[])=>{
    if(sql.includes("insert into vy_replica_turn_feedback")) {
      if(!feedback.includes(params[3])) {feedback.push(params[3]);await onFixtureManifest(manifest());}
      await db("EXPLAIN "+sql,params);
    }
    return db(sql,params);
  };
  const input={replica_id:rid,turn_id:turn};
  const current=()=>read(query,owner,input,env);
  const save=(revision,extra={})=>write(query,owner,{...input,ratings:{wording:"off"},expected_revision:revision,...extra},env);
  try {
    assert.equal(typeof onFixtureManifest,"function"); await onFixtureManifest(manifest());
    stage="verify-development-database";assert.equal((await db("select current_database() as name"))[0]?.name,"vyakti_expert_integration_20260906");verified=true;
    await db("EXPLAIN "+READ,[rid,owner,turn,POLICY]);
    stage="synthetic-prerequisites";writesStarted=true;
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
    const log = (await db("insert into meera_log(device_id,agent_id,role,channel,kind,content) values($1::uuid,$2::uuid,'him','chat','text','Synthetic SQL fixture, not model output') returning id", [device, agent]))[0].id;
    await db(`insert into vy_replica_dialogue_turn(turn_id,session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,device_id,ordinal,
      profile_version,calibration_version,schema_version,provider_family,provider_name,provider_version,model,trace_id,user_log_id,prompt_hash,response_hash,state)
      values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,1,1,1,'synthetic','azure','synthetic','none','none','synthetic-correction-fixture',$9::bigint,$10,$11,'complete')`,
      [turn, session, cap, rid, owner, agent, person, device, log, "a".repeat(64), "b".repeat(64)]);
    stage="owned-empty-and-foreign-scope";
    assert.equal((await current()).feedback,null);
    for(const [actor,scope] of [[foreignOwner,input],[owner,{...input,replica_id:inactive}],[owner,{...input,turn_id:randomUUID()}]]) await assert.rejects(()=>read(query,actor,scope,env),e=>e.code==="feedback_turn_not_available");checks.push(stage);
    stage="encrypted-current-and-rating-only-retention";
    await save(0,{correction:"Synthetic owner wording, never model output."});
    const first=await current();assert.equal(first.feedback.revision,1);assert(first.correction);
    await save(1,{ratings:{wording:"close",memory:"off"}});
    const second=await current();assert.equal(second.correction,first.correction);assert.equal(second.feedback.revision,2);
    const envelopes=await db("select encode(ciphertext,'base64') as bytes from vy_replica_turn_exemplar where replica_id=$1::uuid and owner_user_id=$2::uuid",[rid,owner]);assert.equal(envelopes.length,2);assert.notEqual(envelopes[0].bytes,envelopes[1].bytes);checks.push(stage);
    stage="stale-omitted-and-explicit-clear-contract";
    await assert.rejects(()=>save(1,{correction:"Stale synthetic wording"}),e=>e.code==="feedback_revision_conflict");
    await assert.rejects(()=>write(query,owner,{...input,ratings:{wording:"off"}},env),e=>e.code==="feedback_revision_conflict");
    await assert.rejects(()=>save(2,{correction:""}),e=>e.code==="feedback_explicit_clear_required");
    await save(2,{clear_correction:true});assert.equal((await current()).correction,"");
    assert.equal(Number((await db("select count(*) as n from vy_replica_turn_exemplar where replica_id=$1::uuid and owner_user_id=$2::uuid",[rid,owner]))[0].n),2);checks.push(stage);
    stage="actual-old-writer-rating-only-negative";
    await save(3,{correction:"Synthetic correction to retain"});
    // blob from commit cff35f0484a1b3c13ce0c96d933083dff870ab1e, moved to a
    // committed fixture (context/rejected.md#ci-shallow-checkout-starved-
    // the-history-reading-suites).
    const oldSource=readFileSync(new URL("feedback-reopen-live/fixtures/cff35f0/api___replica-feedback.js",new URL("./",import.meta.url)),"utf8").replace(/from "(\.\/[^"]+)"/g,(_,path)=>'from "'+new URL("../api/"+path.slice(2),import.meta.url).href+'"');
    const old=await import("data:text/javascript;base64,"+Buffer.from(oldSource).toString("base64"));
    await old.recordOwnedTurnFeedback(query,owner,{...input,ratings:{wording:"close"},expected_revision:0},env);
    assert.equal((await current()).feedback.revision,5);assert.equal((await current()).correction,"");checks.push(stage);
    stage="sql-cas-snapshot-and-mutation-negative";
    await save(5,{correction:"Current synthetic correction"});
    const staleRows=await db(READ,[rid,owner,turn,POLICY]);
    await save(6,{correction:"Newer synthetic correction"});
    let reads=0;
    const staleDb=(sql,params)=>sql===READ&&reads++===0?Promise.resolve(staleRows):query(sql,params);
    await assert.rejects(()=>write(staleDb,owner,{...input,ratings:{wording:"off"},expected_revision:6},env),e=>e.code==="feedback_revision_conflict");
    assert.equal((await current()).correction,"Newer synthetic correction");
    reads=0;let mutated=false;
    const mutantDb=(sql,params)=>{if(sql===READ&&reads++===0)return Promise.resolve(staleRows);if(sql.includes("insert into vy_replica_turn_feedback")){assert(sql.includes("and coalesce(p.revision,0)=$20::integer"));sql=sql.replace("and coalesce(p.revision,0)=$20::integer","and $20::integer >= 0");mutated=true;}return query(sql,params);};
    await write(mutantDb,owner,{...input,ratings:{wording:"off"},expected_revision:6},env);
    assert(mutated);assert.equal((await current()).correction,"Current synthetic correction");checks.push(stage);
    stage="independent-overlapping-revision-conflict";
    assert.equal(typeof openSession,"function");
    const a=await openSession(),b=await openSession();sessions.add(a);sessions.add(b);
    const revision=(await current()).feedback.revision;
    await a.query("set statement_timeout='15000'");await b.query("set statement_timeout='15000'");
    const prepared=[];let release, timer;const both=new Promise((resolve,reject)=>{release=resolve;timer=setTimeout(()=>reject(Object.assign(new Error("synthetic_barrier_timeout"),{code:"SYNTHETIC_BARRIER_TIMEOUT"})),15000);});
    const participant=connection=>write(async(sql,params)=>{
      if(sql.includes("insert into vy_replica_turn_feedback")){feedback.push(params[3]);await onFixtureManifest(manifest());prepared.push(params[3]);if(prepared.length===2)release();await both;}
      return connection.query(sql,params);
    },owner,{...input,ratings:{wording:"close"},expected_revision:revision},env);
    let outcomes;try{outcomes=await Promise.allSettled([participant(a),participant(b)]);}finally{clearTimeout(timer);}
    assert.equal(outcomes.filter(v=>v.status==="fulfilled").length,1);assert.equal(outcomes.filter(v=>v.status==="rejected"&&v.reason.code==="feedback_revision_conflict").length,1);
    assert.equal((await current()).feedback.revision,revision+1);checks.push(stage);
    stage="inactive-capability-and-stopped-owner-refuse";
    await db("update vy_replica_runtime_capability set state='revoked' where capability_id=$1::uuid and owner_user_id=$2::uuid",[cap,owner]);await assert.rejects(()=>current(),e=>e.code==="feedback_turn_not_available");
    await db("update vy_replica_runtime_capability set state='active' where capability_id=$1::uuid and owner_user_id=$2::uuid",[cap,owner]);
    await db("update vy_replica set lifecycle='paused' where replica_id=$1::uuid and owner_user_id=$2::uuid",[rid,owner]);await assert.rejects(()=>current(),e=>e.code==="feedback_turn_not_available");checks.push(stage);
    stage="actual-turn-erasure-cascades-all-revisions";
    await db("delete from vy_replica_dialogue_turn where turn_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[turn,rid,owner]);
    for(const table of ["vy_replica_turn_feedback","vy_replica_turn_exemplar"])assert.equal(Number((await db(`select count(*) as n from ${table} where replica_id=$1::uuid and owner_user_id=$2::uuid`,[rid,owner]))[0].n),0);checks.push(stage);
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
  return {passed:checks.length,checks,remainingFixtureRows,cleanupErrors:[],limitation:"Synthetic encrypted feedback and independent SQL connections; no owner, model, activation or training effectiveness proof."};
}
