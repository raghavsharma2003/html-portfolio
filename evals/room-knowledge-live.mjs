// Explicit isolated-development invocation only. Real SQL, synthetic public text.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readPublicRoomKnowledge,assertPublicRoomKnowledgeCurrent,PUBLIC_ROOM_KNOWLEDGE_SQL} from '../api/_room-knowledge.js';

export async function runPublicKnowledgeSqlChecks(db) {
  assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
  const owner=randomUUID(),otherOwner=randomUUID();
  const scopes=Array.from({length:3},(_,i)=>({roomId:randomUUID(),replicaId:randomUUID(),ownerUserId:i===2?otherOwner:owner,agentId:randomUUID()}));
  const [scope]=scopes;
  const items=Array.from({length:5},()=>randomUUID());
  const checks=[];
  const unavailable=()=>error=>error.code==='room_knowledge_unavailable';
  try {
    await db('EXPLAIN '+PUBLIC_ROOM_KNOWLEDGE_SQL,[scope.roomId,scope.replicaId,scope.ownerUserId,scope.agentId]);
    checks.push('actual-reader-explain');
    for(const s of scopes){
      await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic public knowledge fixture')",[s.agentId,'qa-'+s.agentId]);
      await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic public knowledge fixture','public-qa-eval/v1')",[s.replicaId,s.ownerUserId]);
      await db("insert into vy_room(room_id,slug,replica_id,agent_id,owner_user_id,published_at) values($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,now())",[s.roomId,'qa-'+s.roomId,s.replicaId,s.agentId,s.ownerUserId]);
    }
    assert.equal((await readPublicRoomKnowledge(db,scope)).sources.length,0);
    checks.push('eligible-empty');
    for(let i=4;i>=0;i--)await db('insert into vy_room_showcase(id,room_id,question,answer,position) values($1::uuid,$2::uuid,$3,$4,$5::int4)',[items[i],scope.roomId,'Synthetic question '+(i+1),'Synthetic public answer '+(i+1),i+1]);
    const snapshot=await readPublicRoomKnowledge(db,scope);
    assert.deepEqual(snapshot.sources.map(s=>s.id),items);
    assert.equal((await assertPublicRoomKnowledgeCurrent(db,scope,snapshot)).setSha256,snapshot.setSha256);
    checks.push('five-ordered-and-current');
    for(const field of ['roomId','replicaId','ownerUserId','agentId']){
      const wrong={...scope,[field]:scopes[2][field]};
      await assert.rejects(()=>readPublicRoomKnowledge(db,wrong),unavailable());
      checks.push('foreign-'+field);
    }
    assert.equal((await readPublicRoomKnowledge(db,scopes[1])).sources.length,0);
    checks.push('same-owner-other-room-empty');
    assert.equal((await readPublicRoomKnowledge(db,scopes[2])).sources.length,0);
    checks.push('other-owner-room-empty');
    await db('update vy_room set paused_at=now() where room_id=$1::uuid and owner_user_id=$2::uuid',[scope.roomId,owner]);
    await assert.rejects(()=>assertPublicRoomKnowledgeCurrent(db,scope,snapshot),unavailable());
    checks.push('pause-before-delivery');
    await db('update vy_room set paused_at=null,published_at=null where room_id=$1::uuid and owner_user_id=$2::uuid',[scope.roomId,owner]);
    await assert.rejects(()=>readPublicRoomKnowledge(db,scope),unavailable());
    checks.push('unpublished');
    await db('update vy_room set published_at=now() where room_id=$1::uuid and owner_user_id=$2::uuid',[scope.roomId,owner]);
    await db('update vy_room_showcase set removed_at=now() where room_id=$1::uuid and id=$2::uuid',[scope.roomId,items[0]]);
    assert.equal((await readPublicRoomKnowledge(db,scope)).sources.length,4);
    await assert.rejects(()=>assertPublicRoomKnowledgeCurrent(db,scope,snapshot),e=>e.code==='room_knowledge_changed');
    checks.push('removed-source');
    await db("update vy_room_showcase set removed_at=null,answer='Changed synthetic public answer' where room_id=$1::uuid and id=$2::uuid",[scope.roomId,items[0]]);
    await assert.rejects(()=>assertPublicRoomKnowledgeCurrent(db,scope,snapshot),e=>e.code==='room_knowledge_changed');
    checks.push('edited-source');
  } finally {
    for(const s of scopes){
      await db('delete from vy_room where room_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and agent_id=$4::uuid',[s.roomId,s.replicaId,s.ownerUserId,s.agentId]);
      await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[s.replicaId,s.ownerUserId]);
      await db('delete from vy_agent where agent_id=$1::uuid and slug=$2',[s.agentId,'qa-'+s.agentId]);
    }
    const rooms=scopes.map(s=>s.roomId),replicas=scopes.map(s=>s.replicaId),agents=scopes.map(s=>s.agentId);
    const remaining=(await db(`select
      (select count(*) from vy_room where room_id=any($1::uuid[]))+
      (select count(*) from vy_room_showcase where room_id=any($1::uuid[]))+
      (select count(*) from vy_replica where replica_id=any($2::uuid[]))+
      (select count(*) from vy_agent where agent_id=any($3::uuid[])) as n`,[rooms,replicas,agents]))[0];
    assert.equal(Number(remaining?.n),0,'exact generated fixture cleanup');
  }
  return {passed:checks.length,checks,remainingFixtureRows:0};
}
