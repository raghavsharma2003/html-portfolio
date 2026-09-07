// Actual completion statement and real mine caller, using adversarial fixtures.
// These checks establish control flow, not PostgreSQL parsing or concurrency.
import assert from 'node:assert/strict';
import {completeSourceErasure} from '../../api/_replica-source-erasure.js';
import {CONTEXT_INGEST_RUN_INSERT_SQL,CONTEXT_ITEM_REMOVE_SQL,removeContextItem,remineContextItem} from '../../api/_context-locker.js';
const owner='11111111-1111-4111-8111-111111111111',replica='22222222-2222-4222-8222-222222222222';
const source='33333333-3333-4333-8333-333333333333',item='44444444-4444-4444-8444-444444444444';
const lease={source:{sourceId:source,replicaId:replica,ownerUserId:owner},leaseToken:'synthetic-source-erasure-token-more-than-thirty-two-bytes'};
let completionSql='';await completeSourceErasure(async(sql)=>{completionSql=sql;return[{source_id:source}];},lease);
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const baseline=status=>({run_id:status,replica_id:replica,owner_user_id:owner,video_ref:'context:'+item,transcript_source:'context_item',status,stats:{private:'synthetic stats'},proposed_delta:{private:'synthetic phrase'},proposed_delta_count:2,video_title:'synthetic title',failure_code:'original',approved_by_user_id:['applied','rejected'].includes(status)?owner:null,decided_at:['applied','rejected'].includes(status)?'earlier':null});
function scrub(sql,rows){
  const guarded=(clause,value)=>!sql.includes(clause)||value;
  if(!sql.includes('update vy_ingest_run r'))return;
  for(const row of rows){
    if(!guarded('r.replica_id=i.replica_id',row.replica_id===replica)||!guarded('r.owner_user_id=i.owner_user_id',row.owner_user_id===owner))continue;
    if(!guarded("r.transcript_source='context_item'",row.transcript_source==='context_item')||!guarded("r.video_ref='context:' || i.item_id::text",row.video_ref==='context:'+item))continue;
    row.stats={};row.proposed_delta={};row.proposed_delta_count=0;row.video_title='';row.failure_code='context_source_removed';
    if(!['applied','rejected'].includes(row.status)){row.status='rejected';row.approved_by_user_id=owner;row.decided_at='now';}
  }
}
await check('completion captures exact source item tuple before the cascade',()=>{
  assert(completionSql.includes('source_context_items as materialized'));assert(completionSql.includes('i.source_id=t.source_id and i.replica_id=t.replica_id'));assert(completionSql.includes('i.owner_user_id=t.owner_user_id'));
  assert(completionSql.includes('and (select count(*) from context_ingest_runs)>=0'));
  assert(completionSql.indexOf('context_ingest_runs as')<completionSql.indexOf('delete from vy_replica_source'));
});
await check('every existing run state loses copied content and preserves completed decisions',()=>{
  for(const status of ['fetched','transcribed','proposed','failed','applied','rejected']){
    const rows=[baseline(status)];scrub(completionSql,rows);const after=rows[0];
    assert.deepEqual(after.stats,{});assert.deepEqual(after.proposed_delta,{});assert.equal(after.video_title,'');assert.equal(after.proposed_delta_count,0);
    assert.equal(after.status,status==='applied'?'applied':'rejected');assert.equal(after.decided_at,['applied','rejected'].includes(status)?'earlier':'now');
    assert.equal(after.approved_by_user_id,owner);const snapshot=structuredClone(after);scrub(completionSql,rows);assert.deepEqual(after,snapshot);
  }
});
await check('other run provenance and source handles remain untouched; mutants expose the boundary',()=>{
  for(const [field,value,clause]of [['transcript_source','captions',"r.transcript_source='context_item'"],['video_ref','context:another-item',"r.video_ref='context:' || i.item_id::text"]]){
    const untouched={...baseline('proposed'),[field]:value};const rows=[structuredClone(untouched)];scrub(completionSql,rows);assert.deepEqual(rows[0],untouched);
    scrub(completionSql.replace(clause,'true'),rows);assert.deepEqual(rows[0].proposed_delta,{},'removing actual predicate exposes unrelated erasure');
  }
});
await check('owner and replica boundaries protect other runs',()=>{
  const rows=[{...baseline('proposed'),owner_user_id:'another-owner'},{...baseline('proposed'),replica_id:'another-replica'}];const before=structuredClone(rows);scrub(completionSql,rows);assert.deepEqual(rows,before);
});
await check('scrub mirrors the existing receipt policy and adds only count audit data',()=>{
  assert(completionSql.includes("status=case when r.status in ('applied','rejected') then r.status else 'rejected' end"));
  assert(completionSql.includes("then r.approved_by_user_id else $3::uuid end"));assert(completionSql.includes('then r.decided_at else now() end'));
  assert(completionSql.includes("'context_ingest_runs_scrubbed',(select count(*) from context_ingest_runs)"));
});
await check('producer locks a current ready source and current owned item before insertion',()=>{
  const sql=CONTEXT_INGEST_RUN_INSERT_SQL;
  for(const text of ["s.state='ready'",'for update of s','for update of i',"i.status in ('extracted','mined')",'i.source_id is not distinct from original.source_id','i.item_id=$8::uuid','i.owner_user_id=$3::uuid','i.replica_id=$2::uuid',"where $4='context:' || g.item_id::text"])assert(sql.includes(text));
  assert(sql.indexOf('source_gate as')<sql.indexOf('item_gate as'));assert(sql.includes('from item_gate g'));assert(sql.includes('where not exists (select 1 from item_gate)'));
});
await check('actual re-mine paused before INSERT cannot recreate a removed source item',async()=>{
  const body=Array.from({length:14},(_,n)=>`Dekho beta, the thing about rotational motion is that torque is just force with a lever arm. Paragraph ${n} of my own notes.`).join('\n\n');
  let row={item_id:item,replica_id:replica,owner_user_id:owner,source_id:null,body,format:'text',extractor:'text/v1',status:'extracted',authorship:'mine',owner_speaker:''};
  let reached=false;let inserts=0;
  const db=async(sql)=>{
    if(sql.trimStart().startsWith('select i.item_id'))return[{...row}];
    if(sql.trimStart().startsWith('with source_gate as materialized')&&sql.includes('update vy_context_item i set authorship')){
      for(const clause of ['for update of s','private_text_epoch=r.private_text_epoch+1','i.replica_id=s.replica_id','i.owner_user_id=s.owner_user_id','i.replica_id=o.replica_id'])assert(sql.includes(clause));
      return[];
    }
    if(sql===CONTEXT_INGEST_RUN_INSERT_SQL){reached=true;row=null;return[{run_id:null,status:'source_unavailable',proposed_delta_count:0}];}
    if(sql.includes('insert into vy_ingest_run'))inserts++;
    throw new Error('unexpected-context-fixture-statement');
  };
  await assert.rejects(()=>remineContextItem(db,owner,replica,item,{authorship:'mine'}),e=>e.code==='context_source_unavailable');assert(reached);assert.equal(inserts,0);
});
await check('direct removal serializes source before item and requires a provenance-scoped tombstone',()=>{
  const sql=CONTEXT_ITEM_REMOVE_SQL;
  assert(sql.indexOf('for update of s')<sql.indexOf('for update of i'));
  for(const clause of ['on conflict (replica_id,video_ref) do update','r.owner_user_id = $3::uuid',"r.transcript_source = 'context_item'",'r.watch_id is null',
    'select t.* from target t where exists (select 1 from scrubbed_run)','i.source_id is not distinct from original.source_id'])assert(sql.includes(clause));
  for(const mutation of ['invalidated_claims','removed_evidence','source_erasure','removed_text','removed']){
    const block=sql.split(`), ${mutation} as (`)[1]?.split(/\n     \),/)[0];assert(block?.includes('authorized_target'),mutation+' cannot destroy data without a successful tombstone');
  }
});
await check('actual removal surfaces foreign provenance collision as a refusal',async()=>{
  await assert.rejects(()=>removeContextItem(async(sql,params)=>{
    assert.equal(sql,CONTEXT_ITEM_REMOVE_SQL);assert.deepEqual(params.slice(0,3),[item,replica,owner]);
    return[{item_id:item,provenance_conflict:true}];
  },owner,replica,item),error=>error.code==='context_source_provenance_conflict'&&error.status===409);
});
console.log(`${checks} context proposal erasure groups passed; no SQL proof.`);
