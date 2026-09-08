import assert from 'node:assert/strict';
import { freshDoorsState, doorsDb } from '../room-doors/fixtures.mjs';

export async function checkRoomMemoryFixture() {
  const { ROOM_MEMORY_LOG_SQL } = await import('../../api/_room-memory-authority.js');
  const person = 'aa111111-1111-4111-8111-111111111111';
  const followerId = 'ff111111-1111-4111-8111-111111111111';
  const device = 'dd111111-1111-4111-8111-111111111111';
  function setup() {
    const state = freshDoorsState(), room = state.rooms[0];
    state.followers.push({follower_id:followerId,room_id:room.room_id,agent_id:room.agent_id,person_id:person,
      memory_epoch:2,memory_consent_at:'2026-09-01',age_attested_at:'2026-09-01'});
    return {state,params:[followerId,'2',room.agent_id,person,device,'me','नमस्ते']};
  }
  let checks = 0;
  for (const [name, mutate] of [
    ['wrong follower', x => x.params[0] = device],
    ['stale epoch', x => x.params[1] = '1'],
    ['wrong agent', x => x.params[2] = device],
    ['wrong person', x => x.params[3] = device],
    ['withdrawn consent', x => x.state.followers[0].memory_consent_at = null],
    ['missing age', x => x.state.followers[0].age_attested_at = null],
    ['unpublished room', x => x.state.rooms[0].published_at = null],
    ['paused room', x => x.state.rooms[0].paused_at = '2026-09-08'],
    ['revoked replica', x => x.state.replicas[0].lifecycle = 'revoked'],
    ['purging replica', x => x.state.replicas[0].lifecycle = 'purging'],
    ['revocation timestamp', x => x.state.replicas[0].revoked_at = '2026-09-08'],
    ['owner mismatch', x => x.state.replicas[0].owner_user_id = person],
    ['replica agent mismatch', x => x.state.replicas[0].agent_id = device],
    ['missing replica', x => x.state.replicas = []],
    ['invalid role', x => x.params[5] = 'system'],
    ['empty content', x => x.params[6] = ''],
    ['oversized content', x => x.params[6] = 'a'.repeat(4001)],
  ]) {
    const x = setup(); mutate(x);
    assert.deepEqual(await doorsDb(x.state)(ROOM_MEMORY_LOG_SQL,x.params),[],name);
    assert.equal(x.state.meeraLog.length,0,name+' cannot append a log'); checks++;
  }
  for (const role of ['me','her']) {
    const x = setup(); x.params[5] = role;
    const rows = await doorsDb(x.state)(ROOM_MEMORY_LOG_SQL,x.params);
    assert.equal(rows.length,1); assert.equal(rows[0].id,x.state.meeraLog[0].id);
    const row = x.state.meeraLog[0];
    assert.deepEqual([row.agent_id,row.device_id,row.speaker_person_id,row.role,row.content,row.room_memory_follower_id,row.room_memory_epoch],
      [x.params[2],device,person,role,'नमस्ते',followerId,2]); checks++;
  }
  const malformed = setup();
  await assert.rejects(doorsDb(malformed.state)(ROOM_MEMORY_LOG_SQL.replace('returning id','returning *'),malformed.params),/shape_mismatch/); checks++;
  const short = setup();
  await assert.rejects(doorsDb(short.state)(ROOM_MEMORY_LOG_SQL,short.params.slice(0,5)),/shape_mismatch/); checks++;
  // Retain the older direct-DM fixture contract independently of the new CTE.
  const legacy = setup();
  await doorsDb(legacy.state)('insert into meera_log(device_id,role,content,speaker_person_id,agent_id) values($1,$2,$3,$4,$5)',[device,'me','legacy',person,legacy.params[2]]);
  assert.equal(legacy.state.meeraLog[0].device_id,device); assert.equal(legacy.state.meeraLog[0].role,'me'); checks++;
  console.log(`Room memory fixture: ${checks} authority/shape/legacy controls passed`);
}
