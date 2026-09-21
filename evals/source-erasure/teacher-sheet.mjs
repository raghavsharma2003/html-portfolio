// Actual caller SQL and source contracts only. PostgreSQL behavior is proved
// separately by the opt-in teacher-sheet-live harness, never by this fake DB.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureTeacherSheetErasureSql,runTeacherSheetErasureSqlProof} from './teacher-sheet-live.mjs';
import {completeSourceErasure} from '../../api/_replica-source-erasure.js';

globalThis.fetch=async()=>{throw Error('unexpected_network_in_erasure_eval');};
const {sql,old}=await captureTeacherSheetErasureSql();
let n=0;const check=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
await check('exact original caller SQL retains the old draft demotion as the real-DB negative control',()=>{
  assert.ok(old.includes("status=case when s.status in ('published','validated') then 'draft' else s.status end"));
  assert.ok(old.includes("join vy_teacher_sheet s on s.agent_id=r.agent_id and s.status<>'revoked'"));
  assert.notEqual(sql,old);
});
await check('changed historical sheets become nonservable without creating another owned draft',()=>{
  const effects=sql.split('), teacher_sheet_effects as (')[1].split('), provider_consent as (')[0];
  assert.ok(effects.includes("status=case when s.status in ('published','validated') then 'revoked' else s.status end"));
  assert.ok(effects.includes("published_at=case when s.status in ('published','validated','revoked') then null"));
  assert.ok(effects.includes("consent_artifact_id=case when s.status in ('published','validated','revoked') then null"));
  assert.ok(!effects.includes("then 'draft'"));assert.ok(!/delete from vy_teacher_sheet/i.test(sql));
});
await check('explicit owner/replica scope wins and revoked rows are still content erasure targets',()=>{
  const candidates=sql.split('), sheet_candidates as materialized (')[1].split('), sheet_board_rewritten')[0];
  for(const clause of ['s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id',
    '(s.agent_id is null or s.agent_id=r.agent_id)',
    '(s.replica_id is null and s.owner_user_id is null and s.agent_id=r.agent_id)'])assert.ok(candidates.includes(clause));
  assert.ok(!candidates.includes("s.status<>'revoked'"));
});
await check('unbound materializations require exact sheet ID; all five legacy predicates remain bound-only',()=>{
  let total=0;
  for(const [alias,count]of[['s',3],['c',1],['b',1]]){
    const clause=`f.applied_sheet_id=${alias}.sheet_id or (f.applied_sheet_id is null and ${alias}.agent_id is not null)`;
    assert.equal(sql.split(clause).length-1,count);total+=count;
  }
  assert.equal(total,5);
  assert.ok(!sql.includes('or f.applied_sheet_id is null)'));
});
await check('original source delta, fragment, support and completion authority clauses are retained',()=>{
  for(const clause of ["d.state='accepted' and d.applied_at is not null and d.target_field<>''",
    'w.session_id=d.session_id and w.replica_id=d.replica_id',
    'w.owner_user_id=d.owner_user_id and w.seq=any(d.cited_windows)',
    'support.target_field=d.target_field and support.fragment=d.fragment',
    'and s.erasure_lease_expires_at>now()',
    "f.fragment=btrim(item.value#>>'{}')",'f.fragment=existing.fragment']){
    assert.ok(old.includes(clause));assert.ok(sql.includes(clause));
  }
});
await check('completion still has exactly one injected SQL call and refuses a missing lease result',async()=>{
  let calls=0;
  await assert.rejects(()=>completeSourceErasure(async(statement)=>{calls++;assert.equal(statement,sql);return [];},
    {source:{sourceId:'11111111-1111-4111-8111-111111111111',replicaId:'22222222-2222-4222-8222-222222222222',ownerUserId:'33333333-3333-4333-8333-333333333333'},leaseToken:'synthetic-source-token-more-than-thirty-two-bytes'}),
    {code:'source_erasure_waiting_for_provider'});
  assert.equal(calls,1);
});
await check('dev harness refuses missing opt-in and wrong database before fixture writes',async()=>{
  let calls=0,manifest=0;
  await assert.rejects(()=>runTeacherSheetErasureSqlProof({db:async()=>{calls++;},recordFixtureIds:async()=>{manifest++;}}));assert.equal(calls,0);
  await assert.rejects(()=>runTeacherSheetErasureSqlProof({optIn:true,db:async(s)=>{calls++;assert.equal(s,'select current_database() as name');return[{name:'wrong'}];},recordFixtureIds:async()=>{manifest++;}}));
  assert.equal(calls,1);assert.equal(manifest,0);
});
await check('canonical schema permits revoked unbound sheets and one explicit private draft',async()=>{
  const schema=await readFile(new URL('../../db/schema.sql',import.meta.url),'utf8');
  assert.ok(schema.includes("status in ('draft','revoked')"));
  assert.ok(schema.includes('create unique index if not exists vy_teacher_sheet_private_draft_ix'));
  assert.ok(schema.includes("where replica_id is not null and status='draft'"));
});
console.log(`teacher sheet erasure: ${n} source/caller checks passed; no SQL execution or23505 proof`);
