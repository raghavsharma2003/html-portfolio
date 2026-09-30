// Injected interactive PostgreSQL proof. No credentials, provider calls or config imports.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {CONTEXT_INGEST_RUN_INSERT_SQL,CONTEXT_ITEM_REMOVE_SQL,removeContextItem} from '../../api/_context-locker.js';

// Restore the old UPDATE-only scrub mechanism, retaining the improved lock
// order so the negative control isolates snapshot visibility, not deadlock.
const UPDATE_ONLY_MUTANT=CONTEXT_ITEM_REMOVE_SQL.replace(
  /\), scrubbed_run as \([\s\S]*?\), authorized_target as materialized \([\s\S]*?\), invalidated_claims as \(/,
  `), scrubbed_run as (
     update vy_ingest_run r set stats='{}'::jsonb,proposed_delta='{}'::jsonb,
       proposed_delta_count=0,video_title='',failure_code='context_source_removed'
     from target t where r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
       and r.transcript_source='context_item' and r.video_ref='context:' || t.item_id::text
     returning r.run_id
   ), authorized_target as materialized (
     select t.* from target t where $4::uuid is not null
   ), invalidated_claims as (`);

export async function runContextProposalOverlapSqlChecks({db,openSession}) {
  assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
  assert.notEqual(UPDATE_ONLY_MUTANT,CONTEXT_ITEM_REMOVE_SQL);
  const owner=randomUUID(),otherOwner=randomUUID(),replica=randomUUID();
  const cases=[];const checks=[];let stage='setup',failure=null;
  const fixture=async(sourceBacked)=>{
    const c={item:randomUUID(),source:sourceBacked?randomUUID():null,run:randomUUID(),tombstone:randomUUID()};cases.push(c);
    const sha=createHash('sha256').update(c.item).digest('hex');
    if(c.source)await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state) values($1::uuid,$2::uuid,$3::uuid,'text','upload','vyakti-replica-private',$4,'text/plain',$5,'ready')",[c.source,replica,owner,`${owner}/${replica}/${c.source}/original`,sha]);
    await db("insert into vy_context_item(item_id,replica_id,owner_user_id,source_id,kind,format,source_name,content_sha256,status,authorship) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'file','text','Synthetic overlap fixture',$5,'extracted','mine')",[c.item,replica,owner,c.source,sha]);
    await db("insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,'Synthetic private text',22)",[c.item,replica,owner]);
    return c;
  };
  const producerParams=c=>[c.run,replica,owner,'context:'+c.item,'{"private":"synthetic stats"}','{"private":"synthetic quotation"}',1,c.item];
  const removeParams=c=>[c.item,replica,owner,c.tombstone];
  const readRun=c=>db('select * from vy_ingest_run where replica_id=$1::uuid and video_ref=$2',[replica,'context:'+c.item]);
  const scrubbed=row=>{assert(row);assert.deepEqual(row.stats,{});assert.deepEqual(row.proposed_delta,{});assert.equal(Number(row.proposed_delta_count),0);assert.equal(row.video_title,'');assert.equal(row.failure_code,'context_source_removed');};
  try{
    await db('EXPLAIN '+CONTEXT_ITEM_REMOVE_SQL,[randomUUID(),replica,owner,randomUUID()]);
    await db('EXPLAIN '+UPDATE_ONLY_MUTANT,[randomUUID(),replica,owner,randomUUID()]);
    checks.push('actual-removal-and-update-only-mutant-explain');
    await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic overlap fixture','context-overlap-eval/v1')",[replica,owner]);
    for(const sourceBacked of [true,false])for(const mutant of [false,true]){
      stage=(sourceBacked?'canonical':'source-less')+(mutant?'-update-only-negative-control':'-actual-overlap');
      const c=await fixture(sourceBacked);let producer,remover,pending;
      try{
        producer=await openSession();remover=await openSession();
        await producer.query('BEGIN');await remover.query('BEGIN');
        const producerPid=Number((await producer.query('select pg_backend_pid() as pid'))[0].pid);
        const removerPid=Number((await remover.query('select pg_backend_pid() as pid'))[0].pid);
        assert.equal((await producer.query(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(c)))[0]?.run_id,c.run);
        // Keep the producer uncommitted, then prove the removal statement is
        // actually waiting on this transaction before allowing its COMMIT.
        pending=remover.query(mutant?UPDATE_ONLY_MUTANT:CONTEXT_ITEM_REMOVE_SQL,removeParams(c)).then(rows=>({rows}),error=>({error}));
        const deadline=Date.now()+10000;let witnessed=false;
        while(Date.now()<deadline){
          const row=(await db('select $2::integer=any(pg_blocking_pids($1::integer)) as blocked',[removerPid,producerPid]))[0];
          if(row?.blocked===true){witnessed=true;break;}
        }
        assert(witnessed,'removal-blocked-on-tested-producer-before-commit');
        await producer.query('COMMIT');
        const result=await pending;if(result.error)throw result.error;
        assert(result.rows.some(row=>row.item_id===c.item&&!row.provenance_conflict),'removal-completed');
        await remover.query('COMMIT');
        const row=(await readRun(c))[0];assert.equal(row?.run_id,c.run);
        if(mutant){assert.equal(row.proposed_delta.private,'synthetic quotation','old-update-retains-quotation-after-item-delete');}
        else{scrubbed(row);assert.equal(row.status,'rejected');assert.equal(row.approved_by_user_id,owner);}
        assert.equal((await db('select item_id from vy_context_item where item_id=$1::uuid',[c.item])).length,0);
        checks.push(stage+'-blocking-witness');
      }finally{
        // Roll back the producer first to unblock any pending removal on failure.
        if(producer)await producer.query('ROLLBACK').catch(()=>{});
        if(pending)await pending;
        if(remover)await remover.query('ROLLBACK').catch(()=>{});
        if(producer)await producer.close();if(remover)await remover.close();
      }
    }
    for(const sourceBacked of [true,false]){
      stage=(sourceBacked?'canonical':'source-less')+'-empty-tombstone';const c=await fixture(sourceBacked);
      assert((await removeContextItem(db,owner,replica,c.item))?.removed);const row=(await readRun(c))[0];scrubbed(row);
      assert.equal(row.status,'rejected');assert.equal(row.approved_by_user_id,owner);
      assert.equal(await removeContextItem(db,owner,replica,c.item),null);
      assert.deepEqual((await readRun(c))[0],row);checks.push(stage+'-retry');
    }
    for(const status of ['fetched','transcribed','proposed','failed','applied','rejected']){
      stage='direct-receipt-'+status;const c=await fixture(false);
      await db(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(c));
      await db("update vy_ingest_run set status=$2,video_title='Synthetic title',approved_by_user_id=$3::uuid,decided_at='2026-09-07T00:00:00Z' where run_id=$1::uuid",[c.run,status,owner]);
      const before=(await readRun(c))[0];assert((await removeContextItem(db,owner,replica,c.item))?.removed);
      const after=(await readRun(c))[0];scrubbed(after);assert.equal(after.run_id,c.run);
      assert.equal(after.status,status==='applied'?'applied':'rejected');
      if(['applied','rejected'].includes(status)){assert.deepEqual(after.decided_at,before.decided_at);assert.equal(after.approved_by_user_id,before.approved_by_user_id);}
      checks.push(stage);
    }
    for(const field of ['owner_user_id','transcript_source','watch_id']){
      stage='foreign-collision-'+field;const c=await fixture(true);
      // The live owner FK refuses a forged owner; the API also refuses a
      // different authenticated owner. Transcript/watch collisions remain
      // possible within one owner and must not authorize destruction.
      const value=field==='owner_user_id'?otherOwner:field==='transcript_source'?'upload':randomUUID();
      await db(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(c));
      if(field==='owner_user_id'){
        const before=(await readRun(c))[0];
        await assert.rejects(()=>db('update vy_ingest_run set owner_user_id=$2::uuid where run_id=$1::uuid',[c.run,value]),error=>error.code==='23503'||String(error.message).includes('23503'));
        assert.equal(await removeContextItem(db,otherOwner,replica,c.item),null);
        assert.deepEqual((await readRun(c))[0],before);checks.push(stage+'-fk-and-api-refusal');continue;
      }
      await db(`update vy_ingest_run set ${field}=$2${field==='transcript_source'?'':'::uuid'} where run_id=$1::uuid`,[c.run,value]);
      const before=(await readRun(c))[0];
      await assert.rejects(()=>removeContextItem(db,owner,replica,c.item),error=>error.code==='context_source_provenance_conflict');
      assert.deepEqual((await readRun(c))[0],before);
      assert.equal((await db('select item_id from vy_context_item where item_id=$1::uuid',[c.item])).length,1);
      assert.equal((await db('select item_id from vy_context_item_text where item_id=$1::uuid',[c.item])).length,1);
      assert.equal((await db('select state from vy_replica_source where source_id=$1::uuid',[c.source]))[0]?.state,'ready');checks.push(stage+'-no-destruction');
    }
  }catch(error){failure=error;Object.assign(error,{failedStage:stage,lastCompletedCheck:checks.at(-1)||'none',assertionName:'context-proposal-overlap:'+stage});throw error;}
  finally{
    await db('delete from vy_ingest_run where replica_id=$1::uuid and video_ref=any($2::text[])',[replica,cases.map(c=>'context:'+c.item)]);
    await db('delete from vy_context_item where replica_id=$1::uuid and owner_user_id=$2::uuid',[replica,owner]);
    await db('delete from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid',[replica,owner]);
    await db('delete from vy_replica_audit where replica_id=$1::uuid and owner_user_id=$2::uuid',[replica,owner]);
    await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[replica,owner]);
    const row=(await db(`select
      (select count(*) from vy_replica where replica_id=$1::uuid)+
      (select count(*) from vy_replica_source where replica_id=$1::uuid)+
      (select count(*) from vy_context_item where replica_id=$1::uuid)+
      (select count(*) from vy_context_item_text where replica_id=$1::uuid)+
      (select count(*) from vy_ingest_run where replica_id=$1::uuid)+
      (select count(*) from vy_replica_audit where replica_id=$1::uuid) as n`,[replica]))[0];
    assert.equal(Number(row?.n),0,'exact-overlap-fixture-cleanup');
    if(failure)Object.assign(failure,{contextErasureFixtureCleanupVerified:true,remainingFixtureRows:0});
  }
  return{passed:checks.length,checks,remainingFixtureRows:0};
}
