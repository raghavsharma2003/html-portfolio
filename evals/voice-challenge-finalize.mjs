// Actual function/control-flow fixtures; these do not execute PostgreSQL.
import assert from 'node:assert/strict';
import {finalizeVoiceChallengeSource as finalize,VOICE_CHALLENGE_FINALIZE_SQL as SQL} from '../api/_replica-voice-identity.js';
const owner='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222';
const cid='33333333-3333-4333-8333-333333333333',cap='44444444-4444-4444-8444-444444444444',tr='55555555-5555-4555-8555-555555555555';
const info={byteSize:100,mime:'video/webm',expectedByteSize:100,expectedMime:'video/webm',objectId:'synthetic-object'};
let checks=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);checks++;};
await check('actual finalizer binds metadata and returns the source and client challenge',async()=>{
  const result=await finalize(async(sql,params)=>{
    assert.equal(sql,SQL);assert.deepEqual(params.slice(0,6),[rid,owner,cid,cap,'quarantined','']);
    assert.deepEqual(params.slice(8),[100,'video/webm']);
    assert.equal(JSON.parse(params[6]).sha256_status,'pending_server_verification');
    return[{source:{source_id:cap,state:'quarantined'},challenge:{challenge_id:cid,replica_id:rid,state:'captured'}}];
  },owner,rid,cid,cap,info);
  assert.equal(result.challenge.state,'captured');assert.equal(result.source.source_id,cap);
});
await check('metadata mismatch preserves original rejection behavior',async()=>{
  await finalize(async(sql,params)=>{assert.equal(params[4],'rejected');assert.equal(params[5],'byte_size_mismatch');return[];},owner,rid,cid,cap,{...info,byteSize:99});
});
await check('only PostgreSQL lock contention becomes retryable409 and preserves its cause',async()=>{
  for(const code of ['55P03','42P08','08006']){
    const original=Object.assign(new Error('synthetic'),{code});
    await assert.rejects(()=>finalize(async()=>{throw original;},owner,rid,cid,cap,info),error=>{
      if(code==='55P03')return error.code==='voice_challenge_finalize_busy'&&error.status===409&&error.retryable===true&&error.cause===original;
      return error===original;
    });
  }
});
await check('snapshot simulation catches the original readiness reads in both upload orders',async()=>{
  for(const order of [[cap,tr],[tr,cap]])for(const mutant of [false,true]){
    const state={[cap]:'pending_upload',[tr]:'pending_upload'};let result;
    for(const sid of order)result=await finalize(async(sql)=>{
      assert.equal(sql,SQL);const before={...state};state[sid]='quarantined';
      const ready=mutant?before:state;
      return[{source:{source_id:sid,state:state[sid]},challenge:{challenge_id:cid,replica_id:rid,state:ready[cap]==='quarantined'&&ready[tr]==='quarantined'?'captured':'issued'}}];
    },owner,rid,cid,sid,info);
    assert.equal(result.challenge.state,mutant?'issued':'captured');
  }
});
await check('actual source guards reject omissions and never touch identity settlement',()=>{
  const clauses=['for update of s nowait','for share of r nowait','for share of c nowait','for update of ch nowait',
    "r.lifecycle not in ('revoked','purging')",'r.policy_version=$8::text',"c.scope in ('capture','storage')",
    'c.revoked_at is null','c.expires_at>clock_timestamp()',"ch.state='issued'",'ch.expires_at>clock_timestamp()',
    'ch.captured_source_id is not distinct from previous.captured_source_id','ch.transcript_source_id is not distinct from previous.transcript_source_id',
    's.byte_size=$9::bigint and s.mime=$10::text',"s.state='pending_upload'",'union all select source_id,state from updated_source',
    'from ready_sources ready',"source_consent.consent_id=other.consent_id and source_consent.scope='capture'"];
  const guard=sql=>clauses.every(c=>sql.includes(c));assert(guard(SQL));
  for(const clause of clauses)assert(!guard(SQL.replaceAll(clause,'true')),clause);
  assert(!/identity_verified_at|liveness_verified_at|identity_expires_at|update vy_replica\s/.test(SQL));
});
console.log(`${checks} voice challenge finalizer groups passed; no SQL proof.`);
