// Export-only isolated-development SQL proof. No provider/storage/config access.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {completeSourceErasure,sourceErasureLeaseTokenHash} from '../../api/_replica-source-erasure.js';
import {CONTEXT_INGEST_RUN_INSERT_SQL,removeContextItem} from '../../api/_context-locker.js';

export async function runContextProposalErasureSqlChecks(db){
  assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
  const owner=randomUUID(),replica=randomUUID(),otherOwner=randomUUID(),otherReplica=randomUUID();
  const token='synthetic-context-erasure-'+randomUUID();
  const cases=Array.from({length:9},(_,n)=>({sourceId:randomUUID(),itemId:randomUUID(),runId:randomUUID(),owner:n===8?otherOwner:owner,replica:n===8?otherReplica:replica}));
  const sourceIds=cases.map(c=>c.sourceId),itemIds=cases.map(c=>c.itemId),runIds=cases.map(c=>c.runId);
  const statuses=['fetched','transcribed','proposed','failed','applied','rejected'];
  const checks=[];let stage='explain',failure=null;
  const lease=c=>({source:{sourceId:c.sourceId,replicaId:c.replica,ownerUserId:c.owner},leaseToken:token});
  const producerParams=c=>[c.runId,c.replica,c.owner,'context:'+c.itemId,JSON.stringify({private:'synthetic stats'}),JSON.stringify({kind:'context-sheet-candidates/v1',additions:[{fragment:'synthetic private fragment'}]}),1,c.itemId];
  const prepareErasure=c=>db("update vy_replica_source set state='deleting',erasure_lease_token_hash=$4,erasure_lease_expires_at=now()+interval '5 minutes',upload_authorization_expires_at=now()-interval '1 day' where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[c.sourceId,c.replica,c.owner,sourceErasureLeaseTokenHash(token)]);
  try{
    await completeSourceErasure(async(sql,params)=>{await db('EXPLAIN '+sql,params);return[{source_id:cases[0].sourceId}];},lease(cases[0]));
    await db('EXPLAIN '+CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(cases[0]));checks.push('exact-completion-and-producer-explain');
    stage='create-synthetic-fixtures';
    for(const [rid,uid]of[[replica,owner],[otherReplica,otherOwner]])await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic context erasure fixture','context-erasure-eval/v1')",[rid,uid]);
    for(const c of cases){
      const hash=createHash('sha256').update(c.itemId).digest('hex');
      await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state,upload_authorization_expires_at) values($1::uuid,$2::uuid,$3::uuid,'text','upload','vyakti-replica-private',$4,'text/plain',$5,'ready',now()-interval '1 day')",[c.sourceId,c.replica,c.owner,`${c.owner}/${c.replica}/${c.sourceId}/original`,hash]);
      await db("insert into vy_context_item(item_id,replica_id,owner_user_id,source_id,kind,format,source_name,content_sha256,status,authorship) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'file','text','Synthetic source name',$5,'extracted','mine')",[c.itemId,c.replica,c.owner,c.sourceId,hash]);
      await db("insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,'Synthetic private text',22)",[c.itemId,c.replica,c.owner]);
    }
    stage='source-ready-producer-and-retry';
    const control=cases[8];assert.equal((await db(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(control)))[0].run_id,control.runId);
    assert.equal((await db(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(control))).length,0);checks.push('ready-source-produces-once');
    for(let n=0;n<6;n++){
      const c=cases[n],status=statuses[n];stage='scrub-'+status;
      await db("insert into vy_ingest_run(run_id,replica_id,owner_user_id,video_ref,video_title,transcript_source,stats,proposed_delta,proposed_delta_count,status,failure_code,approved_by_user_id,decided_at) values($1::uuid,$2::uuid,$3::uuid,$4,'Synthetic private title','context_item','{\"private\":\"Synthetic private stats\"}'::jsonb,'{\"private\":\"Synthetic private proposal\"}'::jsonb,2,$5,'synthetic_original_failure',$6::uuid,$7::timestamptz)",[c.runId,c.replica,c.owner,'context:'+c.itemId,status,['applied','rejected'].includes(status)?owner:null,['applied','rejected'].includes(status)?'2026-09-07T00:00:00Z':null]);
      const before=(await db('select * from vy_ingest_run where run_id=$1::uuid',[c.runId]))[0];
      await prepareErasure(c);
      await assert.rejects(()=>completeSourceErasure(db,{...lease(c),leaseToken:token+'wrong'}),e=>e.code==='source_erasure_waiting_for_provider');
      assert.deepEqual((await db('select * from vy_ingest_run where run_id=$1::uuid',[c.runId]))[0],before);
      await completeSourceErasure(db,lease(c));
      const after=(await db('select * from vy_ingest_run where run_id=$1::uuid',[c.runId]))[0];
      assert.deepEqual(after.stats,{});assert.deepEqual(after.proposed_delta,{});assert.equal(Number(after.proposed_delta_count),0);assert.equal(after.video_title,'');assert.equal(after.failure_code,'context_source_removed');
      assert.equal(after.status,status==='applied'?'applied':'rejected');
      assert.equal(after.approved_by_user_id,owner);
      if(['applied','rejected'].includes(status))assert.equal(after.decided_at,before.decided_at);else assert(after.decided_at);
      assert.equal(after.video_ref,before.video_ref);assert.equal(after.run_id,before.run_id);
      assert.equal((await db('select item_id from vy_context_item where item_id=$1::uuid',[c.itemId])).length,0);
      assert.equal((await db('select item_id from vy_context_item_text where item_id=$1::uuid',[c.itemId])).length,0);
      await assert.rejects(()=>completeSourceErasure(db,lease(c)),e=>e.code==='source_erasure_waiting_for_provider');
      assert.deepEqual((await db('select * from vy_ingest_run where run_id=$1::uuid',[c.runId]))[0],after);
      assert.equal((await db('select proposed_delta_count from vy_ingest_run where run_id=$1::uuid',[control.runId]))[0].proposed_delta_count,1);
      checks.push('scrub-'+status+'-preserve-receipt-and-retry');
    }
    for(const [n,path]of[[6,'source-completion'],[7,'context-item-removal']]){
      const c=cases[n];stage='paused-producer-'+path;
      let resume;const gate=new Promise(resolve=>{resume=resolve;});
      const pending=(async()=>{await gate;return db(CONTEXT_INGEST_RUN_INSERT_SQL,producerParams(c));})();
      let removalError=null;
      try{
        await prepareErasure(c);
        if(path==='context-item-removal')await removeContextItem(db,c.owner,c.replica,c.itemId);
        await completeSourceErasure(db,lease(c));
      }catch(error){removalError=error;}finally{resume();}
      const refused=await pending;if(removalError)throw removalError;
      assert.equal(refused[0]?.status,'source_unavailable');
      assert.equal((await db('select run_id from vy_ingest_run where run_id=$1::uuid',[c.runId])).length,0);
      checks.push('paused-producer-cannot-recreate-after-'+path);
    }
    stage='cross-owner-control-survives';
    assert.equal((await db('select run_id from vy_ingest_run where run_id=$1::uuid',[control.runId])).length,1);
    assert.equal((await db('select item_id from vy_context_item where item_id=$1::uuid',[control.itemId])).length,1);checks.push('unrelated-owner-source-and-run-retained');
  }catch(error){failure=error;Object.assign(error,{failedStage:stage,lastCompletedCheck:checks.at(-1)||'none',assertionName:'context-proposal-erasure:'+stage});throw error;}
  finally{
    await db("delete from vy_ingest_run where video_ref=any($1::text[]) and replica_id=any($2::uuid[]) and owner_user_id=any($3::uuid[])",[itemIds.map(id=>'context:'+id),[replica,otherReplica],[owner,otherOwner]]);
    await db('delete from vy_replica_source where source_id=any($1::uuid[]) and replica_id=any($2::uuid[]) and owner_user_id=any($3::uuid[])',[sourceIds,[replica,otherReplica],[owner,otherOwner]]);
    for(const [rid,uid]of[[replica,owner],[otherReplica,otherOwner]]){
      await db('delete from vy_replica_audit where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,uid]);
      await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,uid]);
    }
    const left=(await db(`select
      (select count(*) from vy_replica where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_source where source_id=any($2::uuid[]))+
      (select count(*) from vy_context_item where item_id=any($3::uuid[]))+
      (select count(*) from vy_context_item_text where item_id=any($3::uuid[]))+
      (select count(*) from vy_ingest_run where run_id=any($4::uuid[]) or replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_audit where replica_id=any($1::uuid[])) as n`,[[replica,otherReplica],sourceIds,itemIds,runIds]))[0];
    assert.equal(Number(left?.n),0,'exact-context-erasure-fixture-cleanup');
    if(failure)Object.assign(failure,{contextErasureFixtureCleanupVerified:true,remainingFixtureRows:0});
  }
  return{passed:checks.length,checks,remainingFixtureRows:0};
}
