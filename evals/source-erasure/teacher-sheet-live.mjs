// Export-only exact SQL proof. Root injects an isolated dev DB; no provider,
// storage, publication, consent API or config access. Importing does no writes.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {completeSourceErasure,sourceErasureLeaseTokenHash} from '../../api/_replica-source-erasure.js';
import {removeContextItem,CONTEXT_ITEM_REMOVE_SQL} from '../../api/_context-locker.js';

const TARGET='vyakti_expert_integration_20260906';
const sha=value=>createHash('sha256').update(value).digest('hex');
const removedPhrase='socho beta',removedSlang='arre';
const targetBody={boardVerbalisms:[removedPhrase,'keep units'],exSlangRepeat:'("arre", "accha")',other:'unrelated authored content'};
const draftBody={boardVerbalisms:['private draft'],exSlangRepeat:'("private")',other:'current private owner work'};
export async function captureTeacherSheetErasureSql(){
  let sql,params;
  await completeSourceErasure(async(s,p)=>{sql=s;params=p;return[{source_id:p[0]}];},{source:{sourceId:randomUUID(),replicaId:randomUUID(),ownerUserId:randomUUID()},leaseToken:'synthetic-capture-token-more-than-thirty-two-bytes'});
  const old=await readFile(new URL('./fixtures/legacy-teacher-sheet-erasure.sql',import.meta.url),'utf8');
  const provenance=JSON.parse(await readFile(new URL('./fixtures/legacy-teacher-sheet-erasure.json',import.meta.url),'utf8'));
  assert.equal(sha(old),provenance.sha256);assert.notEqual(sql,old);
  return{sql,params,old,provenance};
}
export async function runTeacherSheetErasureSqlProof({db,recordFixtureIds,optIn}={}){
  assert.equal(optIn,true,'explicit synthetic SQL proof opt-in');
  assert.equal(typeof db,'function');assert.equal(typeof recordFixtureIds,'function','durable fixture manifest callback required');
  assert.equal((await db('select current_database() as name'))[0]?.name,TARGET);
  const captured=await captureTeacherSheetErasureSql();
  const owner=randomUUID(),otherOwner=randomUUID(),otherReplica=randomUUID(),otherAgent=randomUUID();
  const cases=[
    {name:'canonical-published',status:'published',conflict:true},
    {name:'canonical-validated',status:'validated',conflict:true},
    {name:'direct-context-published',status:'published',direct:true,conflict:true},
    {name:'old-bound-revoked-leak',status:'revoked',oldLeak:true},
    {name:'bound-revoked-scrub',status:'revoked'},
    {name:'old-unbound-revoked-leak',status:'revoked',unbound:true,oldLeak:true},
    {name:'unbound-revoked-scrub',status:'revoked',unbound:true},
    {name:'unbound-draft-scrub',status:'draft',unbound:true,noOtherDraft:true},
    {name:'legacy-bound-owner',status:'validated',legacy:true,noOtherDraft:true},
    {name:'legacy-null-does-not-claim-unbound',status:'revoked',unbound:true,nullLineage:true,preserveTarget:true,noOtherDraft:true},
    {name:'explicit-foreign-owner-wins',status:'validated',foreign:true,preserveTarget:true},
  ].map(c=>({...c,owner,replica:randomUUID(),agent:randomUUID(),source:randomUUID(),item:randomUUID(),
    sheet:randomUUID(),draft:randomUUID(),session:randomUUID(),window:randomUUID(),boardDelta:randomUUID(),slangDelta:randomUUID(),
    consentColumn:randomUUID(),leaseToken:'synthetic-sheet-erasure-'+randomUUID()}));
  const manifest={schema:'teacher-sheet-erasure-fixtures/v1',database:TARGET,owner,otherOwner,otherReplica,otherAgent,
    fixtures:cases.map(({leaseToken,...c})=>c),old_sql_sha256:sha(captured.old),new_sql_sha256:sha(captured.sql),
    declaration:'Synthetic persisted states only; no actual object, publication or consent grant. Database completion is exercised without claiming physical storage erasure.'};
  await recordFixtureIds(manifest); // every generated identity is durable BEFORE first write
  const checks=[];let stage='explain',failure=null;
  const replicaIds=[...cases.map(c=>c.replica),otherReplica],agentIds=[...cases.map(c=>c.agent),otherAgent],sourceIds=cases.map(c=>c.source),sheetIds=cases.flatMap(c=>[c.sheet,c.draft]);
  const lease=c=>({source:{sourceId:c.source,replicaId:c.replica,ownerUserId:c.owner},leaseToken:c.leaseToken});
  const readSheet=async id=>(await db('select sheet_id,agent_id,replica_id,owner_user_id,sheet,status,consent_artifact_id,published_at,updated_at from vy_teacher_sheet where sheet_id=$1::uuid',[id]))[0];
  const count=async(table,key,ids)=>(await db(`select count(*)::integer as n from ${table} where ${key}=any($1::uuid[])`,[ids]))[0]?.n;
  const runOld=c=>completeSourceErasure((_sql,p)=>db(captured.old,p),lease(c));
  const cleanup={errors:[],remaining:null};
  try{
    await db('EXPLAIN '+captured.sql,captured.params);await db('EXPLAIN '+captured.old,captured.params);
    await db('EXPLAIN '+CONTEXT_ITEM_REMOVE_SQL,[cases[0].item,cases[0].replica,owner,randomUUID()]);
    checks.push('exact-new-old-and-direct-removal-sql-explain');
    const idx=(await db("select indexdef from pg_indexes where schemaname='public' and indexname='vy_teacher_sheet_private_draft_ix'"))[0]?.indexdef;
    assert.ok(idx&&/UNIQUE/i.test(idx)&&/replica_id/.test(idx)&&/draft/.test(idx),'migration139 exact private-draft index exists');
    checks.push('actual-private-draft-index-present');
    stage='fixtures';
    await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic other owner')",[otherAgent,'erasure-'+otherAgent]);
    await db("insert into vy_replica(replica_id,owner_user_id,agent_id,display_name,policy_version) values($1::uuid,$2::uuid,$3::uuid,'Synthetic other owner','sheet-erasure-eval/v1')",[otherReplica,otherOwner,otherAgent]);
    for(const c of cases){
      await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic erasure fixture')",[c.agent,'erasure-'+c.agent]);
      await db("insert into vy_replica(replica_id,owner_user_id,agent_id,display_name,policy_version) values($1::uuid,$2::uuid,$3::uuid,'Synthetic erasure fixture','sheet-erasure-eval/v1')",[c.replica,owner,c.agent]);
      await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state,upload_authorization_expires_at) values($1::uuid,$2::uuid,$3::uuid,'text','upload','vyakti-replica-private',$4,'text/plain',$5,'ready',now()-interval '1 day')",[c.source,c.replica,owner,`${owner}/${c.replica}/${c.source}/original`,sha(c.source)]);
      await db("insert into vy_teacher_sheet(sheet_id,agent_id,replica_id,owner_user_id,version,sheet,status,consent_artifact_id,published_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'synthetic/v1',$5::jsonb,$6,$7::uuid,case when $6::text='published' then now() else null end)",
        [c.sheet,c.unbound?null:c.agent,c.legacy?null:c.foreign?otherReplica:c.replica,c.legacy?null:c.foreign?otherOwner:owner,JSON.stringify(targetBody),c.status,c.consentColumn]);
      if(!c.noOtherDraft)await db("insert into vy_teacher_sheet(sheet_id,agent_id,replica_id,owner_user_id,version,sheet,status) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'private/v1',$5::jsonb,'draft')",[c.draft,c.agent,c.replica,owner,JSON.stringify(draftBody)]);
      await db("insert into vy_mirror_session(session_id,replica_id,owner_user_id,state,policy_version) values($1::uuid,$2::uuid,$3::uuid,'ended','sheet-erasure-eval/v1')",[c.session,c.replica,owner]);
      await db("insert into vy_mirror_window(window_id,session_id,replica_id,owner_user_id,seq,source_id,duration_ms,admission_reason,transcript) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,$5::uuid,1000,'synthetic_not_voice_evidence','synthetic source material')",[c.window,c.session,c.replica,owner,c.source]);
      for(const [id,kind,field,fragment]of[[c.boardDelta,'phrase_habit','boardVerbalisms',removedPhrase],[c.slangDelta,'slang_habit','exSlangRepeat',removedSlang]])
        await db("insert into vy_mirror_delta(delta_id,session_id,replica_id,owner_user_id,kind,origin,occurrences,corpus_tokens,fragment,target_field,cited_windows,state,applied_at,decided_at,applied_sheet_id) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'mined',5,100,$6,$7,array[1],'accepted',now(),now(),$8::uuid)",[id,c.session,c.replica,owner,kind,fragment,field,c.nullLineage?null:c.sheet]);
      if(c.direct){
        await db("insert into vy_context_item(item_id,replica_id,owner_user_id,source_id,kind,format,source_name,content_sha256,status,authorship) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'file','text','Synthetic direct removal',$5,'extracted','mine')",[c.item,c.replica,owner,c.source,sha(c.item)]);
        await db("insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,'Synthetic direct text',21)",[c.item,c.replica,owner]);
      }
    }
    checks.push('all-valid-synthetic-fixtures-created');
    for(const c of cases){
      stage=c.name;const before=await readSheet(c.sheet),privateBefore=c.noOtherDraft?null:await readSheet(c.draft);
      if(c.direct){const removed=await removeContextItem(async(sql,p)=>{
          assert.equal(sql,CONTEXT_ITEM_REMOVE_SQL);
          manifest.runtime_generated??=[];manifest.runtime_generated.push({kind:'context_tombstone',id:p[3],replica:c.replica});
          await recordFixtureIds(manifest);return db(sql,p);
        },owner,c.replica,c.item);assert.equal(removed.erasure,'pending');assert.equal(removed.removed,true);
        assert.equal(Number(await count('vy_context_item','item_id',[c.item])),0);assert.equal(Number(await count('vy_context_item_text','item_id',[c.item])),0);}
      await db("update vy_replica_source set state='deleting',erasure_lease_token_hash=$4,erasure_lease_expires_at=now()+interval '10 minutes',upload_authorization_expires_at=now()-interval '1 day' where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[c.source,c.replica,owner,sourceErasureLeaseTokenHash(c.leaseToken)]);
      if(c.conflict){
        let refused;try{await runOld(c);}catch(e){refused=e;}
        assert.ok(refused,'old SQL must fail in actual PostgreSQL');
        const detail=[refused.code,refused.constraint,refused.constraint_name,refused.message].join(' ');
        assert.ok(/23505/.test(detail)&&/vy_teacher_sheet_private_draft_ix/.test(detail),'exact23505/private-draft index negative control');
        assert.deepEqual(await readSheet(c.sheet),before);assert.deepEqual(await readSheet(c.draft),privateBefore);
        assert.equal(Number(await count('vy_replica_source','source_id',[c.source])),1);
        assert.equal(Number(await count('vy_mirror_delta','delta_id',[c.boardDelta,c.slangDelta])),2);
        checks.push(c.name+'-old23505-whole-statement-rollback');
      }
      if(c.oldLeak){
        await runOld(c);assert.deepEqual(await readSheet(c.sheet),before,'old revoked/unbound exclusion retains source material');
        assert.equal(Number(await count('vy_replica_source','source_id',[c.source])),0);checks.push(c.name+'-retained-content-negative-control');
      }else{
        await completeSourceErasure(db,lease(c));const after=await readSheet(c.sheet);
        if(c.preserveTarget)assert.deepEqual(after,before,'unowned or unbound legacy-null target unchanged');
        else{
          assert.deepEqual(after.sheet,{...targetBody,boardVerbalisms:['keep units'],exSlangRepeat:'("accha")'});
          assert.equal(after.status,c.status==='draft'?'draft':'revoked');
          if(c.status!=='draft'){assert.equal(after.consent_artifact_id,null);assert.equal(after.published_at,null);}
          assert.equal(after.agent_id,before.agent_id);assert.equal(after.replica_id,before.replica_id);assert.equal(after.owner_user_id,before.owner_user_id);
        }
        assert.equal(Number(await count('vy_replica_source','source_id',[c.source])),0);
        assert.equal(Number(await count('vy_mirror_delta','delta_id',[c.boardDelta,c.slangDelta])),0);
        assert.equal(Number(await count('vy_mirror_window','window_id',[c.window])),0);
        await assert.rejects(()=>completeSourceErasure(db,lease(c)),e=>e.code==='source_erasure_waiting_for_provider');
        assert.deepEqual(await readSheet(c.sheet),after);checks.push(c.name+'-new-scrub-scope-and-retry');
      }
      if(privateBefore)assert.deepEqual(await readSheet(c.draft),privateBefore,'exact current private draft untouched');
    }
  }catch(error){failure={stage,code:String(error?.code||'fixture_assertion_failed'),message:String(error?.message||'').slice(0,600)};}
  finally{
    const clean=async(name,sql,p)=>{try{await db(sql,p);}catch(e){cleanup.errors.push({name,code:String(e?.code||'cleanup_failed')});}};
    await clean('mirror_sessions','delete from vy_mirror_session where session_id=any($1::uuid[])',[cases.map(c=>c.session)]);
    await clean('context_runs','delete from vy_ingest_run where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid',[cases.map(c=>c.replica),owner]);
    await clean('context_items','delete from vy_context_item where item_id=any($1::uuid[])',[cases.map(c=>c.item)]);
    await clean('teacher_sheets','delete from vy_teacher_sheet where sheet_id=any($1::uuid[])',[sheetIds]);
    await clean('sources','delete from vy_replica_source where source_id=any($1::uuid[])',[sourceIds]);
    await clean('source_attempts','delete from vy_replica_source_erasure_attempt where source_id=any($1::uuid[])',[sourceIds]);
    await clean('audit','delete from vy_replica_audit where replica_id=any($1::uuid[])',[replicaIds]);
    await clean('replicas','delete from vy_replica where replica_id=any($1::uuid[])',[replicaIds]);
    await clean('agents','delete from vy_agent where agent_id=any($1::uuid[])',[agentIds]);
    try{
      const tables=[['vy_agent','agent_id',agentIds],['vy_replica','replica_id',replicaIds],['vy_teacher_sheet','sheet_id',sheetIds],
        ['vy_replica_source','source_id',sourceIds],['vy_replica_source_erasure_attempt','source_id',sourceIds],['vy_mirror_session','session_id',cases.map(c=>c.session)],
        ['vy_mirror_window','window_id',cases.map(c=>c.window)],['vy_mirror_delta','delta_id',cases.flatMap(c=>[c.boardDelta,c.slangDelta])],
        ['vy_context_item','item_id',cases.map(c=>c.item)],['vy_context_item_text','item_id',cases.map(c=>c.item)],['vy_ingest_run','replica_id',replicaIds],['vy_replica_audit','replica_id',replicaIds]];
      cleanup.remaining=0;for(const [table,key,ids]of tables)cleanup.remaining+=Number(await count(table,key,ids));
    }catch(e){cleanup.errors.push({name:'verify',code:String(e?.code||'cleanup_verify_failed')});}
  }
  return{ok:!failure&&cleanup.remaining===0&&!cleanup.errors.length,checks,passed:checks.length,failure,cleanup,
    old_sql_sha256:sha(captured.old),new_sql_sha256:sha(captured.sql)};
}
