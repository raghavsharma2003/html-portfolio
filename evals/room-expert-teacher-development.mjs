// Explicit opt-in only; called by the root's protected development wrapper.
// Synthetic persisted publication-state fixtures, NOT consent grants, real
// owner publication, model-serving authorization, or a quality experiment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ROOM_EXPERT_TEACHER_SQL, readRoomExpertTeacher, assertRoomExpertTeacherCurrent } from '../api/_room-expert-teacher.js';
import { validateTeacherSheet } from '../api/_engine.gen.js';

const DEVELOPMENT_DATABASE='vyakti_expert_integration_20260906';
export async function proveRoomExpertTeacherDevelopment({db,sheet,optIn,recordFixtureIds}) {
  if(optIn!==true || typeof db!=='function' || typeof recordFixtureIds!=='function') throw new Error('expert_teacher_dev_opt_in_required');
  if(!sheet || typeof sheet!=='object' || Array.isArray(sheet) || !validateTeacherSheet(sheet).ok) {
    throw Object.assign(new Error('expert_teacher_dev_sheet_invalid'),{code:'expert_teacher_dev_sheet_invalid'});
  }
  const database=await db('select current_database() as name',[]);
  assert.equal(database[0]?.name,DEVELOPMENT_DATABASE,'exact isolated development database required');
  const fixtures=Array.from({length:2},()=>({ownerId:randomUUID(),agentId:randomUUID(),replicaId:randomUUID(),
    roomId:randomUUID(),sheetId:randomUUID(),consentColumnId:randomUUID(),alternateConsentColumnId:randomUUID()}));
  for(const f of fixtures){
    f.sheet={...sheet,slug:'lean-proof-'+f.agentId.slice(0,8),version:'fixture-lean-v1',consentArtifactId:f.consentColumnId};
    if(!validateTeacherSheet(f.sheet).ok) throw Object.assign(new Error('expert_teacher_dev_composed_sheet_invalid'),{code:'expert_teacher_dev_composed_sheet_invalid'});
  }
  // The external wrapper must durably retain these BEFORE the first write.
  await recordFixtureIds({fixtureOnly:true,database:DEVELOPMENT_DATABASE,fixtures:fixtures.map(({sheet:ignored,...ids})=>ids)});
  const result={fixtureOnly:true,consentGrant:false,servingAuthorization:false,database:DEVELOPMENT_DATABASE,
    fixtures,checks:[],cleanup:{remaining:null,errors:[]},startedAt:new Date().toISOString()};
  const scope=f=>({roomId:f.roomId,replicaId:f.replicaId,ownerUserId:f.ownerId,agentId:f.agentId});
  const params=f=>[f.roomId,f.replicaId,f.ownerId,f.agentId];
  const [a,b]=fixtures;
  const reject=async(f,code='room_expert_teacher_unavailable')=>assert.rejects(readRoomExpertTeacher(db,scope(f)),{code});
  try {
    const plan=await db('EXPLAIN '+ROOM_EXPERT_TEACHER_SQL,params(a));
    assert.ok(plan.length);result.checks.push({name:'exact runtime SELECT EXPLAIN',planRows:plan.length});
    for(const f of fixtures){
      const slug=f.sheet.slug;
      await db('insert into vy_agent(agent_id,slug,display_name,persona_version) values($1::uuid,$2,$3,$4)',[f.agentId,slug,'Synthetic SQL fixture',f.sheet.version]);
      await db("insert into vy_replica(replica_id,owner_user_id,agent_id,display_name,lifecycle,policy_version) values($1::uuid,$2::uuid,$3::uuid,$4,'active',$5)",
        [f.replicaId,f.ownerId,f.agentId,'Synthetic SQL fixture','fixture-only-lean-expert-sql-20260907']);
      await db('insert into vy_room(room_id,slug,replica_id,agent_id,owner_user_id,published_at) values($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,now())',
        [f.roomId,slug,f.replicaId,f.agentId,f.ownerId]);
      await db("insert into vy_teacher_sheet(sheet_id,agent_id,version,sheet,status,consent_artifact_id,published_at,replica_id,owner_user_id) values($1::uuid,$2::uuid,$3,$4::jsonb,'published',$5::uuid,now(),$6::uuid,$7::uuid)",
        [f.sheetId,f.agentId,f.sheet.version,JSON.stringify(f.sheet),f.consentColumnId,f.replicaId,f.ownerId]);
    }
    for(const f of fixtures){const got=await readRoomExpertTeacher(db,scope(f));assert.equal(got.publication.sheetId,f.sheetId);assert.equal(got.publication.consentBasis,'persisted_sheet_column');}
    result.checks.push({name:'two owners: actual scoped reader returns only its own bound published state'});
    for(const field of ['roomId','replicaId','ownerUserId','agentId']){
      await assert.rejects(readRoomExpertTeacher(db,{...scope(a),[field]:scope(b)[field]}),{code:'room_expert_teacher_unavailable'});
    }
    result.checks.push({name:'wrong room, replica, owner and agent scope returns unavailable'});
    const before=await readRoomExpertTeacher(db,scope(a));
    await db('update vy_teacher_sheet set replica_id=null,owner_user_id=null where sheet_id=$1::uuid',[a.sheetId]);
    assert.equal((await readRoomExpertTeacher(db,scope(a))).publication.sheetId,a.sheetId);
    await assert.rejects(assertRoomExpertTeacherCurrent(db,scope(a),before),{code:'room_expert_teacher_changed'});
    result.checks.push({name:'legacy both-null scope readable; ownership transition invalidates snapshot'});
    await db('update vy_teacher_sheet set replica_id=$2::uuid,owner_user_id=$3::uuid where sheet_id=$1::uuid',[a.sheetId,b.replicaId,b.ownerId]);
    await reject(a);
    assert.equal((await readRoomExpertTeacher(db,scope(b))).publication.sheetId,b.sheetId);
    result.checks.push({name:'foreign explicit owner cannot inherit agent authority or displace the other owner'});
    await db('update vy_teacher_sheet set replica_id=$2::uuid,owner_user_id=$3::uuid where sheet_id=$1::uuid',[a.sheetId,a.replicaId,a.ownerId]);
    await db('update vy_room set paused_at=now() where room_id=$1::uuid',[a.roomId]);await reject(a);
    await db('update vy_room set paused_at=null where room_id=$1::uuid',[a.roomId]);
    await db("update vy_replica set lifecycle='revoked' where replica_id=$1::uuid",[a.replicaId]);await reject(a);
    await db("update vy_replica set lifecycle='active' where replica_id=$1::uuid",[a.replicaId]);
    result.checks.push({name:'paused Room and revoked replica refuse actual reads'});
    for(const status of ['validated','revoked']){
      await db('update vy_teacher_sheet set status=$2 where sheet_id=$1::uuid',[a.sheetId,status]);await reject(a);
      await db("update vy_teacher_sheet set status='published' where sheet_id=$1::uuid",[a.sheetId]);
    }
    result.checks.push({name:'demoted and revoked TeacherSheet refuse actual reads'});
    const receiptBefore=await readRoomExpertTeacher(db,scope(a));
    await db('update vy_teacher_sheet set consent_artifact_id=$2::uuid where sheet_id=$1::uuid',[a.sheetId,a.alternateConsentColumnId]);
    await reject(a,'room_expert_teacher_result_invalid');
    const alternateSheet={...a.sheet,consentArtifactId:a.alternateConsentColumnId};
    await db('update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid',[a.sheetId,JSON.stringify(alternateSheet)]);
    await assert.rejects(assertRoomExpertTeacherCurrent(db,scope(a),receiptBefore),{code:'room_expert_teacher_changed'});
    await db('update vy_teacher_sheet set consent_artifact_id=$2::uuid,sheet=$3::jsonb where sheet_id=$1::uuid',[a.sheetId,a.consentColumnId,JSON.stringify(a.sheet)]);
    result.checks.push({name:'changed receipt must match sheet JSON and invalidates retained snapshot'});
    const contentBefore=await readRoomExpertTeacher(db,scope(a));
    await db('update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid',[a.sheetId,JSON.stringify({...a.sheet,warmth:a.sheet.warmth===4?3:4})]);
    await assert.rejects(assertRoomExpertTeacherCurrent(db,scope(a),contentBefore),{code:'room_expert_teacher_changed'});
    result.checks.push({name:'same-version approved-content change invalidates retained snapshot'});
  } catch(error) {
    result.failure={code:error.code||error.name,message:error.message};
  } finally {
    // All four inserted tables are named explicitly, including agent-scoped
    // TeacherSheet and Room rows without a cascade to rely on.
    for(const f of fixtures) for(const [table,key,id] of [
      ['vy_teacher_sheet','sheet_id',f.sheetId],['vy_room','room_id',f.roomId],
      ['vy_replica','replica_id',f.replicaId],['vy_agent','agent_id',f.agentId],
    ]) {
      try { await db(`delete from ${table} where ${key}=$1::uuid`,[id]); }
      catch(error) { result.cleanup.errors.push({table,id,code:error.code||'fixture_cleanup_failed'}); }
    }
    try {
      const remaining=await db(`select
      (select count(*) from vy_teacher_sheet where sheet_id=any($1::uuid[]))+
      (select count(*) from vy_room where room_id=any($2::uuid[]))+
      (select count(*) from vy_replica where replica_id=any($3::uuid[]))+
      (select count(*) from vy_agent where agent_id=any($4::uuid[])) as remaining`,
      [fixtures.map(f=>f.sheetId),fixtures.map(f=>f.roomId),fixtures.map(f=>f.replicaId),fixtures.map(f=>f.agentId)]);
      result.cleanup.remaining=Number(remaining[0]?.remaining);
    } catch(error) { result.cleanup.errors.push({code:error.code||'fixture_cleanup_verification_failed'}); }
    if(result.cleanup.remaining!==0 || result.cleanup.errors.length) {
      result.failure??={code:'fixture_cleanup_incomplete',message:'Exact fixture cleanup requires review'};
    }
    for(const f of fixtures) delete f.sheet;
    result.finishedAt=new Date().toISOString();
  }
  result.ok=!result.failure&&result.cleanup.remaining===0;
  return result;
}
