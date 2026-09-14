// Records exact fixture caller SQL for root EXPLAIN BEFORE any fixture writes.
// Fake return rows only advance source callbacks; they prove no SQL semantics.
import {randomUUID} from 'node:crypto';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {makeLiveAuthorityFixture,assertLiveAuthorityAbsent,seedLiveAuthority,attachLiveCaptureLease,cleanupLiveAuthority} from './live-fixtures.mjs';
export const OLD_ARTIFACT_ABSENCE_SQL='select count(*)::int n from vy_replica_processing_artifact_decision where decision_id=any($1::uuid[])';
export const OLD_ATTEMPT_COUNT_SQL='select count(*)::int n from vy_replica_processing_attempt where replica_id=$1::uuid and owner_user_id=$2::uuid';
export async function prepareLiveFixtureSqlCases(){
 const f=makeLiveAuthorityFixture(),cases=[],seen=new Set();let phase='absence';
 const record=async(sql,params=[])=>{
  const hash=sha256Hex(sql);if(!seen.has(hash)){seen.add(hash);cases.push({name:phase+':'+(cases.length+1),sql,params,sha256:hash});}
  if(sql.startsWith('select count'))return[{n:0}];
  if(sql.includes('returning decision_id::text'))return[{decision_id:'1'}];
  if(sql.includes('returning verification_lease_expires_at'))return[{verification_lease_expires_at:'2099-01-01T00:00:00.000Z'}];
  return[{}];
 };
 await assertLiveAuthorityAbsent(record,f);
 phase='seed';await seedLiveAuthority(record,f,async()=>{});
 phase='capture';await attachLiveCaptureLease(record,f,{envelope:{phrase:'Synthetic parser preparation only',contract:{challengeId:randomUUID(),phraseSha256:'a'.repeat(64)}}});
 phase='cleanup';await cleanupLiveAuthority(record,f);
 return {cases,negatives:[{sql:OLD_ARTIFACT_ABSENCE_SQL,params:[[randomUUID()]],expected_code:'42883'},{sql:OLD_ATTEMPT_COUNT_SQL,params:[f.binding.replica_id,f.binding.owner_user_id],expected_code:'42703'}],fixture_identity_scope:'Actual generated-always bigint omitted from INSERT; exact owner/replica/artifact scope declared before seed'};
}
