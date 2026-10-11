// Opt-in function only: root supplies its isolated-development db binding.
// This module never imports configuration, applies a migration or runs itself.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadFixtureAgent} from './room/fixtures.mjs';
import {
  readOwnedTeacherSheet,saveOwnedTeacherSheetDraft,publishOwnedTeacherSheet,
  PRIVATE_TEACHER_SHEET_READ_SQL,PRIVATE_TEACHER_SHEET_SAVE_SQL,
  BOUND_TEACHER_SHEET_READ_SQL,BOUND_TEACHER_SHEET_PUBLISH_SQL,
} from '../api/_teacher-sheet-draft.js';

export async function runPrivateTeacherSheetSqlChecks(db) {
  assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
  const owner=randomUUID(),other=randomUUID(),agent=randomUUID(),otherAgent=randomUUID();
  const agents=[agent,otherAgent];
  const replicas=Array.from({length:6},()=>randomUUID());
  const [fresh,parallel,bound,revoked,race,otherBound]=replicas;
  const legacyId=randomUUID(),revokedSheetId=randomUUID(),previousPublishedId=randomUUID();
  const checks=[];
  const body={boardVerbalisms:['dekho'],exSlangRepeat:'("achha")'};
  const rowsFor=rid=>db('select * from vy_teacher_sheet where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,owner]);
  const constraintFailure=e=>/23503|23514|23505/.test(String(e.message));
  let failure=null;
  let stage='runtime-statements-explain';
  const enter=name=>{stage=name;};
  try {
    await db('EXPLAIN '+PRIVATE_TEACHER_SHEET_READ_SQL,[fresh,owner]);
    await db('EXPLAIN '+PRIVATE_TEACHER_SHEET_SAVE_SQL,[fresh,owner,JSON.stringify(body),'',randomUUID()]);
    await db('EXPLAIN '+BOUND_TEACHER_SHEET_READ_SQL,[fresh,owner]);
    await db('EXPLAIN '+BOUND_TEACHER_SHEET_PUBLISH_SQL,[fresh,owner,randomUUID(),JSON.stringify(body),'draft',randomUUID(),'']);
    checks.push('exact-runtime-read-and-save-explain');
    enter('create-replica-fixtures');
    for(const rid of replicas)await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic private draft fixture','private-draft-eval/v1')",[rid,owner]);
    enter('fresh-empty-read');
    assert.equal((await readOwnedTeacherSheet(db,owner,fresh)).draft,null);
    assert.equal((await rowsFor(fresh)).length,0);checks.push('fresh-read-does-not-create');
    enter('explicit-unbound-save');
    const saved=await saveOwnedTeacherSheetDraft(db,owner,fresh,body);
    assert.deepEqual(saved.sheet.draft,body);assert.equal(saved.ok,false);assert(saved.errors.length>0);
    let stored=(await rowsFor(fresh))[0];assert.equal(stored.agent_id,null);assert.equal(stored.status,'draft');assert.equal(stored.consent_artifact_id,null);
    assert.equal((await db('select agent_id from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[fresh,owner]))[0].agent_id,null);
    assert.deepEqual((await readOwnedTeacherSheet(db,owner,fresh)).draft,body);checks.push('explicit-unbound-private-save-and-read');
    enter('replay-same-draft');
    const repeat=await saveOwnedTeacherSheetDraft(db,owner,fresh,body);assert.equal(repeat.sheet.sheet_id,saved.sheet.sheet_id);assert.equal((await rowsFor(fresh)).length,1);checks.push('replay-same-row');
    enter('owner-and-replica-isolation');
    assert.equal(await readOwnedTeacherSheet(db,other,fresh),null);assert.equal(await saveOwnedTeacherSheetDraft(db,other,fresh,{}),null);
    assert.equal((await readOwnedTeacherSheet(db,owner,otherBound)).draft,null);checks.push('owner-and-replica-isolation');
    enter('unbound-publication-refusal');
    await assert.rejects(()=>publishOwnedTeacherSheet(db,owner,fresh),e=>e.code==='teacher_sheet_not_found');
    const publicSource=readFileSync(new URL('../api/_teachersheet.js',import.meta.url),'utf8');
    const publicSql=publicSource.match(/`(select s\.sheet_id[\s\S]*?from vy_teacher_sheet s[\s\S]*?limit 1)`/)?.[1];
    assert(publicSql,'actual public reader statement found');assert.equal((await db(publicSql,['private-draft-'+agent])).length,0);
    for(const status of ['validated','published'])await assert.rejects(()=>db('update vy_teacher_sheet set status=$2 where sheet_id=$1::uuid',[saved.sheet.sheet_id,status]),constraintFailure);
    checks.push('unbound-publication-and-schema-refusal');
    enter('owner-shape-constraint-refusal');
    await assert.rejects(()=>db('update vy_teacher_sheet set owner_user_id=$2::uuid where sheet_id=$1::uuid',[saved.sheet.sheet_id,other]),constraintFailure);
    await assert.rejects(()=>db('update vy_teacher_sheet set owner_user_id=null where sheet_id=$1::uuid',[saved.sheet.sheet_id]),constraintFailure);checks.push('composite-owner-and-null-pair-constraints');
    enter('concurrent-first-saves');
    // Drain every in-flight writer before cleanup, even if one fails.
    const concurrentResults=await Promise.allSettled(Array.from({length:8},()=>saveOwnedTeacherSheetDraft(db,owner,parallel,body)));
    for(const result of concurrentResults)if(result.status==='rejected')throw result.reason;
    const concurrent=concurrentResults.map(result=>result.value);
    assert.equal(new Set(concurrent.map(x=>x.sheet.sheet_id)).size,1);assert.equal((await rowsFor(parallel)).length,1);checks.push('eight-concurrent-first-saves-one-draft');
    enter('create-distinct-agent-bindings');
    for(const id of agents)await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic private draft fixture')",[id,'private-draft-'+id]);
    for(const [rid,id]of [[bound,agent],[otherBound,otherAgent]])await db('update vy_replica set agent_id=$2::uuid where replica_id=$1::uuid and owner_user_id=$3::uuid',[rid,id,owner]);
    enter('shared-agent-uniqueness-refusal');
    // The real schema has UNIQUE(agent_id) on vy_replica. Shared-agent fixture
    // defenses are hypothetical corruption/schema-regression controls, not a
    // reachable production state. Assert that actual constraint explicitly.
    await assert.rejects(()=>db('update vy_replica set agent_id=$2::uuid where replica_id=$1::uuid and owner_user_id=$3::uuid',[otherBound,agent,owner]),e=>(e.code==='23505'||/23505/.test(String(e.message)))&&(e.constraint==='vy_replica_agent_id_key'||String(e.message).includes('vy_replica_agent_id_key')));
    assert.equal((await db('select agent_id from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[otherBound,owner]))[0].agent_id,otherAgent);
    checks.push('real-schema-refuses-shared-agent-binding');
    enter('legacy-bound-read-and-save');
    await db("insert into vy_teacher_sheet(sheet_id,agent_id,version,sheet,status) values($1::uuid,$2::uuid,'legacy','{\"identityWho\":\"Synthetic legacy private field\"}'::jsonb,'draft')",[legacyId,agent]);
    assert.equal((await readOwnedTeacherSheet(db,owner,bound)).sheet_id,legacyId);
    assert.equal((await saveOwnedTeacherSheetDraft(db,owner,bound,body)).sheet.sheet_id,legacyId);assert.equal((await rowsFor(bound))[0].agent_id,agent);checks.push('legacy-bound-draft-preserved-and-owned');
    enter('distinct-agent-publication-refusal');
    assert.equal((await readOwnedTeacherSheet(db,owner,otherBound)).draft,null);
    await assert.rejects(()=>publishOwnedTeacherSheet(db,owner,otherBound),e=>e.code==='teacher_sheet_not_found');
    // A synthetic marker exercises the actual SQL owner boundary even if the
    // publication target has a non-null consent column. No publication occurs.
    const syntheticConsent=randomUUID();
    await db('update vy_teacher_sheet set consent_artifact_id=$2::uuid where sheet_id=$1::uuid',[legacyId,syntheticConsent]);
    assert.equal((await db(BOUND_TEACHER_SHEET_PUBLISH_SQL,[otherBound,owner,legacyId,JSON.stringify(body),'draft',syntheticConsent,''])).length,0);
    assert.equal((await rowsFor(bound))[0].status,'draft');
    await db('update vy_teacher_sheet set consent_artifact_id=null where sheet_id=$1::uuid',[legacyId]);
    checks.push('distinct-agent-publication-reader-and-write-refused');
    enter('distinct-agent-draft-isolation');
    await saveOwnedTeacherSheetDraft(db,owner,otherBound,{identityWho:'Separate explicit private field'});assert.deepEqual((await readOwnedTeacherSheet(db,owner,bound)).draft,body);checks.push('distinct-agent-draft-isolation');
    enter('prepare-validated-snapshot-fixture');
    // Existing public state is synthetic and belongs only to this generated
    // fixture agent. Every attempted publication below must fail before demotion.
    const {SHEET}=await loadFixtureAgent(fileURLToPath(new URL('..',import.meta.url)));
    await db("insert into vy_teacher_sheet(sheet_id,agent_id,replica_id,owner_user_id,sheet,status,consent_artifact_id,published_at,created_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'{}'::jsonb,'published',$5::uuid,now(),now()-interval '1 day')",[previousPublishedId,agent,bound,owner,syntheticConsent]);
    for(const field of ['sheet','status','consent_artifact_id','version']){
      enter('validated-snapshot-'+field+'-change-refusal');
      await db("update vy_teacher_sheet set sheet=$2::jsonb,status='draft',consent_artifact_id=$3::uuid,version=$4 where sheet_id=$1::uuid",[legacyId,JSON.stringify(SHEET),syntheticConsent,SHEET.version]);
      let publishRows=null;
      const changeBeforePublish=async(sql,params)=>{
        if(sql===BOUND_TEACHER_SHEET_PUBLISH_SQL){
          if(field==='sheet')await db('update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid',[legacyId,JSON.stringify({...SHEET,crisisLines:''})]);
          if(field==='status')await db("update vy_teacher_sheet set status='validated' where sheet_id=$1::uuid",[legacyId]);
          if(field==='consent_artifact_id')await db('update vy_teacher_sheet set consent_artifact_id=$2::uuid where sheet_id=$1::uuid',[legacyId,randomUUID()]);
          if(field==='version')await db("update vy_teacher_sheet set version='concurrent-fixture-version' where sheet_id=$1::uuid",[legacyId]);
          const result=await db(sql,params);publishRows=result.length;return result;
        }
        return db(sql,params);
      };
      await assert.rejects(()=>publishOwnedTeacherSheet(changeBeforePublish,owner,bound),e=>e.code==='teacher_sheet_publish_conflict');
      assert.equal(publishRows,0);
      assert.equal((await db('select status from vy_teacher_sheet where sheet_id=$1::uuid',[previousPublishedId]))[0].status,'published');
      checks.push('validated-snapshot-'+field+'-change-refused-without-demotion');
    }
    await db('delete from vy_teacher_sheet where sheet_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[previousPublishedId,bound,owner]);
    enter('revoked-sheet-remains-revoked');
    await db("insert into vy_teacher_sheet(sheet_id,replica_id,owner_user_id,sheet,status) values($1::uuid,$2::uuid,$3::uuid,'{\"identityWho\":\"Revoked private draft\"}'::jsonb,'revoked')",[revokedSheetId,revoked,owner]);
    const replacement=await saveOwnedTeacherSheetDraft(db,owner,revoked,{});assert.notEqual(replacement.sheet.sheet_id,revokedSheetId);
    assert.equal((await db('select status from vy_teacher_sheet where sheet_id=$1::uuid',[revokedSheetId]))[0].status,'revoked');checks.push('revoked-sheet-never-resurrected');
    enter('replica-revocation-refusal');
    for(const lifecycle of ['revoked','purging']){
      await db('update vy_replica set lifecycle=$3 where replica_id=$1::uuid and owner_user_id=$2::uuid',[revoked,owner,lifecycle]);
      assert.equal(await readOwnedTeacherSheet(db,owner,revoked),null);assert.equal(await saveOwnedTeacherSheetDraft(db,owner,revoked,{}),null);
    }checks.push('replica-revocation-and-purging-refuse');
    enter('revocation-between-read-and-write');
    let interposed=false;
    const revokeBeforeWrite=async(sql,params)=>{
      if(sql===PRIVATE_TEACHER_SHEET_SAVE_SQL&&!interposed){interposed=true;await db("update vy_replica set lifecycle='purging' where replica_id=$1::uuid and owner_user_id=$2::uuid",[race,owner]);}
      return db(sql,params);
    };
    await assert.rejects(()=>saveOwnedTeacherSheetDraft(revokeBeforeWrite,owner,race,body),e=>e.code==='teacher_sheet_write_failed');assert.equal((await rowsFor(race)).length,0);checks.push('revocation-between-read-and-write');
    enter('unbound-draft-erasure-cascade');
    await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[fresh,owner]);assert.equal((await rowsFor(fresh)).length,0);checks.push('unbound-draft-erasure-cascade');
  } catch(error) {
    Object.assign(error,{
      failedStage:stage,
      lastCompletedCheck:checks.at(-1)||'none',
      assertionName:error?.code==='ERR_ASSERTION'?'private-draft-assertion:'+stage:'private-draft-operation:'+stage,
    });
    failure=error;
    throw error;
  } finally {
    // Exact generated fixture scope only; never owner-wide or blanket deletes.
    await db('delete from vy_teacher_sheet where (replica_id=any($1::uuid[]) and owner_user_id=$2::uuid) or (sheet_id=any($3::uuid[]) and agent_id=$4::uuid)',[replicas,owner,[legacyId],agent]);
    for(const rid of replicas)await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,owner]);
    for(const id of agents)await db('delete from vy_agent where agent_id=$1::uuid and slug=$2',[id,'private-draft-'+id]);
    const remaining=(await db(`select
      (select count(*) from vy_teacher_sheet where replica_id=any($1::uuid[]) or sheet_id=any($3::uuid[]))+
      (select count(*) from vy_replica where replica_id=any($1::uuid[]))+
      (select count(*) from vy_agent where agent_id=any($2::uuid[])) as n`,[replicas,agents,[legacyId,revokedSheetId,previousPublishedId]]))[0];
    assert.equal(Number(remaining?.n),0,'exact generated fixture cleanup');
    if(failure)Object.assign(failure,{privateDraftFixtureCleanupVerified:true,privateDraftFixtureRows:0});
  }
  return {passed:checks.length,checks,remainingFixtureRows:0};
}
