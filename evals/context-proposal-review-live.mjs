// Opt-in isolated-development proof; never registered in the offline runner.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readContextProposalReview,CONTEXT_PROPOSAL_REVIEW_SQL} from '../api/_context-proposal-review.js';
import {removeContextItem} from '../api/_context-locker.js';

export async function runContextProposalReviewSqlChecks(db){
  assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
  const owner=randomUUID(),foreign=randomUUID(),replica=randomUUID(),otherReplica=randomUUID(),item=randomUUID(),run=randomUUID();
  const text='चलो समझते हैं। Synthetic explanation. चलो समझते हैं।';
  const delta={kind:'context-sheet-candidates/v1',item:{item_id:item,chars:text.length},additions:[{field:'boardVerbalisms',fragment:'चलो समझते हैं',occurrences:2,citations:[{item_id:item,span:{start:0,end:text.length},speaker:'owner'}]}]};
  const checks=[];const read=(who=owner,rid=replica,iid=item)=>readContextProposalReview(db,who,rid,iid);
  const unavailable=fn=>assert.rejects(fn,e=>e.code==='context_proposal_not_available');
  try{
    await db('EXPLAIN '+CONTEXT_PROPOSAL_REVIEW_SQL,[replica,item,owner]);checks.push('actual-query-explain');
    for(const rid of [replica,otherReplica])await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic phrase review','phrase-review-eval/v1')",[rid,owner]);
    await db("insert into vy_ingest_run(run_id,replica_id,owner_user_id,video_ref,transcript_source,proposed_delta,proposed_delta_count,status) values($1::uuid,$2::uuid,$3::uuid,$4,'context_item',$5::jsonb,1,'proposed')",[run,replica,owner,'context:'+item,JSON.stringify(delta)]);
    await db("insert into vy_context_item(item_id,replica_id,owner_user_id,kind,format,source_name,content_sha256,status,authorship,run_id) values($1::uuid,$2::uuid,$3::uuid,'file','txt','Synthetic lesson.txt',$4,'mined','mine',$5::uuid)",[item,replica,owner,createHash('sha256').update(text).digest('hex'),run]);
    await db('insert into vy_context_item_text(item_id,replica_id,owner_user_id,body,chars) values($1::uuid,$2::uuid,$3::uuid,$4,$5::int4)',[item,replica,owner,text,text.length]);
    const view=await read();assert.equal(view.proposal.state,'pending');assert.equal(view.proposal.candidates[0].fragment,delta.additions[0].fragment);assert.equal(view.proposal.candidates[0].citations[0].excerpt,text);checks.push('fresh-unbound-private-phrase-read');
    await unavailable(()=>read(foreign));await unavailable(()=>read(owner,otherReplica));await unavailable(()=>read(owner,replica,randomUUID()));checks.push('foreign-owner-replica-item-refuse');
    await db('update vy_context_item set run_id=$2::uuid where item_id=$1::uuid and owner_user_id=$3::uuid',[item,randomUUID(),owner]);await unavailable(()=>read());await db('update vy_context_item set run_id=$2::uuid where item_id=$1::uuid and owner_user_id=$3::uuid',[item,run,owner]);checks.push('stale-run-pointer-refuses');
    await db("update vy_ingest_run set video_ref='wrong-synthetic-source' where run_id=$1::uuid and owner_user_id=$2::uuid",[run,owner]);await unavailable(()=>read());await db('update vy_ingest_run set video_ref=$3 where run_id=$1::uuid and owner_user_id=$2::uuid',[run,owner,'context:'+item]);checks.push('run-source-binding-refuses');
    await db("update vy_replica set lifecycle='revoked' where replica_id=$1::uuid and owner_user_id=$2::uuid",[replica,owner]);await unavailable(()=>read());await db("update vy_replica set lifecycle='draft' where replica_id=$1::uuid and owner_user_id=$2::uuid",[replica,owner]);checks.push('revoked-replica-refuses');
    await db("update vy_context_item set status='refused',refusal_reason='synthetic test' where item_id=$1::uuid and owner_user_id=$2::uuid",[item,owner]);await unavailable(()=>read());await db("update vy_context_item set status='mined',refusal_reason='' where item_id=$1::uuid and owner_user_id=$2::uuid",[item,owner]);checks.push('refused-item-refuses');
    await db('update vy_context_item_text set body=$3 where item_id=$1::uuid and owner_user_id=$2::uuid',[item,owner,'x'.repeat(text.length)]);await assert.rejects(()=>read(),e=>e.code==='context_proposal_citation_invalid');await db('update vy_context_item_text set body=$3 where item_id=$1::uuid and owner_user_id=$2::uuid',[item,owner,text]);checks.push('changed-canonical-text-refuses');
    await removeContextItem(db,owner,replica,item);await unavailable(()=>read());const receipt=(await db('select proposed_delta,proposed_delta_count,status from vy_ingest_run where run_id=$1::uuid and owner_user_id=$2::uuid',[run,owner]))[0];assert.deepEqual(receipt.proposed_delta,{});assert.equal(Number(receipt.proposed_delta_count),0);assert.equal(receipt.status,'rejected');checks.push('actual-remove-scrubs-and-read-refuses');
  }finally{
    await db('delete from vy_context_item_text where item_id=$1::uuid and owner_user_id=$2::uuid',[item,owner]);
    await db('delete from vy_context_item where item_id=$1::uuid and owner_user_id=$2::uuid',[item,owner]);
    await db('delete from vy_ingest_run where run_id=$1::uuid and owner_user_id=$2::uuid',[run,owner]);
    for(const rid of [replica,otherReplica])await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,owner]);
    const remaining=(await db(`select (select count(*) from vy_context_item where item_id=$1::uuid)+(select count(*) from vy_context_item_text where item_id=$1::uuid)+(select count(*) from vy_ingest_run where run_id=$2::uuid)+(select count(*) from vy_replica where replica_id=any($3::uuid[])) as n`,[item,run,[replica,otherReplica]]))[0];assert.equal(Number(remaining.n),0);
  }
  return {passed:checks.length,checks,remainingFixtureRows:0};
}
