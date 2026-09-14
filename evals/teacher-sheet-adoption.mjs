import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activateOwnedRuntime} from '../api/_replica-runtime.js';
import {PRIVATE_TEACHER_SHEET_ADOPTION_SQL as SQL,adoptActivatedPrivateTeacherSheet as adopt} from '../api/_teacher-sheet-adoption.js';

const owner='11111111-1111-4111-8111-111111111111',replica='22222222-2222-4222-8222-222222222222';
const cap='33333333-3333-4333-8333-333333333333',agent='44444444-4444-4444-8444-444444444444';
const options={replicaId:replica,ownerUserId:owner,capabilityId:cap,replicaPolicy:'replica-self-v1',runtimePolicy:'replica-runtime-v1'};
const activated={capability_id:cap,replica_id:replica,state:'active',genome_version:1,profile_version:1,calibration_version:1};
let count=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
await check('adoption is a second exact statement after real activation and leaves client shape private',async()=>{
  const calls=[];const result=await activateOwnedRuntime(async(sql,params)=>{
    calls.push({sql,params});return sql===SQL?[{adoption_status:'adopted'}]:[activated];
  },owner,replica);
  assert.equal(calls.length,2);assert(calls[0].sql.includes('created_capability as'));
  assert.equal(calls[1].sql,SQL);assert.deepEqual(calls[1].params,[replica,owner,cap,'replica-self-v1','replica-runtime-v1']);
  assert.equal(result.active,true);assert(!/sheet|agent|capability|owner/.test(JSON.stringify(result)));
});
await check('unqualified or missing runtime never reaches adoption',async()=>{
  const calls=[];const result=await activateOwnedRuntime(async(sql)=>{calls.push(sql);return[];},owner,replica);
  assert.equal(result,null);assert(!calls.includes(SQL));
});
await check('actual activation SQL types the variadic runtime policy argument before INSERT reuse',async()=>{
  const calls=[];
  assert.equal(await activateOwnedRuntime(async(sql)=>{calls.push(sql);return[];},owner,replica),null);
  const guard=sql=>sql.includes("jsonb_build_object('runtimePolicy',$6::text,'selfReplica',true)");
  assert(guard(calls[0]));
  assert(!guard(calls[0].replace("'runtimePolicy',$6::text","'runtimePolicy',$6")));
  assert.equal(calls.length,2);
});
await check('named adoption conflict preserves honest partial activation and idempotent retry',async()=>{
  let attempt=0,activationCalls=0;
  const db=async(sql)=>{if(sql===SQL)return[{adoption_status:attempt++?'already_bound':'conflict'}];activationCalls++;return[activated];};
  await assert.rejects(()=>activateOwnedRuntime(db,owner,replica),error=>error.code==='runtime_private_draft_conflict'&&error.status===409);
  assert.equal((await activateOwnedRuntime(db,owner,replica)).active,true);assert.equal(activationCalls,2);
});
await check('all successful handoff outcomes are finite and malformed authority refuses',async()=>{
  for(const status of ['adopted','already_bound','no_private_draft'])assert.equal(await adopt(async()=>[{adoption_status:status}],options),status);
  for(const rows of [[],[{}],[{adoption_status:'made_up'}]])await assert.rejects(()=>adopt(async()=>rows,options),error=>error.code==='runtime_private_draft_authority_changed');
});
await check('database failures remain distinct from scoped authority refusals',async()=>{
  const failure=Object.assign(new Error('synthetic database unavailable'),{code:'08006'});
  await assert.rejects(()=>adopt(async()=>{throw failure;},options),error=>error===failure);
  await assert.rejects(()=>activateOwnedRuntime(async(sql)=>{
    if(sql===SQL)throw failure;return[activated];
  },owner,replica),error=>error===failure);
});
await check('write changes only agent binding, never bytes, status, version or publication authority',()=>{
  assert.match(SQL,/update vy_teacher_sheet s set agent_id=c\.agent_id\s+from/);
  assert(!/insert into|delete from|set (?:sheet|status|version|consent_artifact_id|updated_at|published_at)/i.test(SQL));
  assert(SQL.includes("where s.status='draft'"));assert(SQL.includes("and s.status='draft' and s.agent_id is null"));
});
await check('exact authority and explicit ownership controls reject their source mutants',()=>{
  const clauses=["r.lifecycle='active'",'r.owner_user_id=$2::uuid','r.replica_id=$1::uuid','r.policy_version=$4','c.policy_version=$5',
    'c.capability_id=$3::uuid',"c.state='active'",'c.agent_id=o.agent_id','c.subject_person_id=o.subject_person_id',
    's.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id','for update of r','for update of c','for update of s',
    '(select count(*) from drafts)>1','d.agent_id<>c.agent_id'];
  const guard=sql=>clauses.every(clause=>sql.includes(clause));assert(guard(SQL));
  for(const clause of clauses)assert(!guard(SQL.replaceAll(clause,'true')),clause);
  assert(!SQL.includes('s.replica_id is null'));
});
await check('activation identity and measured readiness SQL remains load-bearing before adoption',async()=>{
  let activationSql='';await activateOwnedRuntime(async(sql)=>{
    if(sql===SQL)return[{adoption_status:'no_private_draft'}];activationSql=sql;return[activated];
  },owner,replica);
  for(const clause of ["person.age_tier='adult_verified'",'r.identity_expires_at>now()',"c.scope='inference'",'r.liveness_verified_at is not null',
    "x.status='pass'",'x.superseded_at is null','x.unmeasured_count=0',"having count(*) filter (where latest.verdict='pass')=$5"])
    assert(activationSql.includes(clause),clause);
});
await check('later first saves already inherit the current locked replica agent',()=>{
  const source=readFileSync(new URL('../api/_teacher-sheet-draft.js',import.meta.url),'utf8');
  assert(source.includes('for update of r'));assert(source.includes('select $5::uuid, o.agent_id, o.replica_id, o.owner_user_id'));
});
console.log(`${count} private draft adoption groups passed; no SQL or enrollment proof.`);
