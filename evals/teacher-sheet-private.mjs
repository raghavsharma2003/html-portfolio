// Actual owner save/read functions with scoped fixtures. No SQL execution proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadFixtureAgent } from './room/fixtures.mjs';
import {
  readOwnedTeacherSheet, saveOwnedTeacherSheetDraft, publishOwnedTeacherSheet,
  PRIVATE_TEACHER_SHEET_READ_SQL, PRIVATE_TEACHER_SHEET_SAVE_SQL,
  BOUND_TEACHER_SHEET_READ_SQL, BOUND_TEACHER_SHEET_PUBLISH_SQL,
} from '../api/_teacher-sheet-draft.js';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const replica='33333333-3333-4333-8333-333333333333';
const sibling='44444444-4444-4444-8444-444444444444';
const agent='55555555-5555-4555-8555-555555555555';
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}

function fixture({agentId=null,rows=[],lifecycle='consent_pending',beforeSave=null,beforePublish=null,mutateSql=s=>s}={}) {
  const state={owner,agentId,rows:structuredClone(rows),lifecycle,calls:[]};
  const scoped=(s)=>s.replica_id===replica && s.owner_user_id===state.owner &&
    (s.agent_id===null || s.agent_id===state.agentId);
  const legacy=(s)=>s.replica_id==null && s.owner_user_id==null &&
    state.agentId!==null && s.agent_id===state.agentId;
  const db=async(raw,params)=>{
    const sql=mutateSql(raw);state.calls.push({sql,params});
    if(raw===PRIVATE_TEACHER_SHEET_SAVE_SQL && beforeSave)beforeSave(state);
    if(raw===BOUND_TEACHER_SHEET_PUBLISH_SQL && beforePublish)beforePublish(state);
    const owned=params[0]===replica && (params[1]===state.owner || !sql.includes('r.owner_user_id = $2::uuid')) &&
      (!sql.includes("r.lifecycle not in ('revoked','purging')") || !['revoked','purging'].includes(state.lifecycle));
    if(!owned)return [];
    if(raw.includes('select r.replica_id, r.agent_id'))return [{replica_id:replica,agent_id:state.agentId}];
    if(raw===PRIVATE_TEACHER_SHEET_READ_SQL)return state.rows.filter(s=>scoped(s)||legacy(s)).slice(-1).reverse();
    if(raw===PRIVATE_TEACHER_SHEET_SAVE_SQL){
      const editable=s=>sql.includes("s.status in ('draft','validated')") ? ['draft','validated'].includes(s.status) : s.status!=='published';
      let row=state.rows.filter(s=>(scoped(s)||legacy(s))&&editable(s)).at(-1);
      if(!row){row={sheet_id:params[4],agent_id:state.agentId,replica_id:replica,owner_user_id:state.owner,created_at:'2026-09-07T00:00:00Z',consent_artifact_id:null,published_at:null};state.rows.push(row);}
      Object.assign(row,{sheet:JSON.parse(params[2]),version:params[3],status:'draft',replica_id:replica,owner_user_id:state.owner,updated_at:'2026-09-07T00:00:01Z'});
      return [structuredClone(row)];
    }
    if(raw===BOUND_TEACHER_SHEET_READ_SQL)return state.rows.filter(s=>
      state.agentId!==null && s.agent_id===state.agentId && s.status!=='revoked' &&
      (!sql.includes('s.replica_id = r.replica_id') || scoped(s)||legacy(s))).slice(-1).reverse();
    if(raw===BOUND_TEACHER_SHEET_PUBLISH_SQL){
      const allowed=s=>!sql.includes('s.replica_id = o.replica_id')||scoped(s)||legacy(s);
      const snapshot=s=>(!sql.includes('s.sheet = $4::jsonb')||isDeepStrictEqual(s.sheet,JSON.parse(params[3])))&&
        (!sql.includes('s.status = $5::text')||s.status===params[4])&&
        (!sql.includes('s.consent_artifact_id = $6::uuid')||s.consent_artifact_id===params[5])&&
        (!sql.includes('s.version = $7::text')||s.version===params[6]);
      const target=state.rows.find(s=>s.sheet_id===params[2]&&s.agent_id===state.agentId&&state.agentId!==null&&s.status!=='revoked'&&s.consent_artifact_id&&allowed(s)&&snapshot(s));
      if(!target)return [];
      for(const s of state.rows)if(s!==target&&s.agent_id===state.agentId&&s.status==='published'&&allowed(s))s.status='validated';
      target.status='published';return [structuredClone(target)];
    }
    throw new Error('Unexpected SQL in fixture');
  };
  return {db,state};
}
const row=(extra={})=>({sheet_id:'66666666-6666-4666-8666-666666666666',agent_id:agent,replica_id:null,owner_user_id:null,status:'draft',sheet:{identityWho:'Synthetic private field'},version:'v1',...extra});
const publishParams=s=>[replica,owner,s.sheet_id,JSON.stringify(s.sheet),s.status,s.consent_artifact_id,s.version];

await check('fresh read is empty and creates no storage or identity',async()=>{
  const {db,state}=fixture();assert.equal((await readOwnedTeacherSheet(db,owner,replica)).draft,null);assert.equal(state.rows.length,0);
  assert(state.calls.every(c=>! /\b(insert|update|delete)\b/i.test(c.sql)));
});
await check('explicit unbound save retains exact incomplete body and validation errors',async()=>{
  const {db,state}=fixture();const body={boardVerbalisms:['dekho']};
  const saved=await saveOwnedTeacherSheetDraft(db,owner,replica,body);
  assert.deepEqual(saved.sheet.draft,body);assert.equal(saved.ok,false);assert(saved.errors.length>0);
  assert.equal(state.rows[0].agent_id,null);assert.equal(state.agentId,null);assert.equal(state.lifecycle,'consent_pending');
  assert.deepEqual((await readOwnedTeacherSheet(db,owner,replica)).draft,body);
  assert(!state.calls.some(c=>/insert into vy_agent|update vy_replica|set status = 'published'/.test(c.sql)));
});
await check('repeated explicit save reuses the same private draft',async()=>{
  const {db,state}=fixture();const a=await saveOwnedTeacherSheetDraft(db,owner,replica,{});
  const b=await saveOwnedTeacherSheetDraft(db,owner,replica,{exSlangRepeat:'("achha")'});
  assert.equal(a.sheet.sheet_id,b.sheet.sheet_id);assert.equal(state.rows.length,1);
});
await check('foreign owner and unknown replica cannot read or save',async()=>{
  const {db,state}=fixture();for(const [uid,rid]of[[other,replica],[owner,sibling]]){
    assert.equal(await readOwnedTeacherSheet(db,uid,rid),null);assert.equal(await saveOwnedTeacherSheetDraft(db,uid,rid,{}),null);
  }assert.equal(state.rows.length,0);
});
await check('revoked and purging replicas refuse reads and saves',async()=>{
  for(const lifecycle of ['revoked','purging']){const {db,state}=fixture({lifecycle});assert.equal(await readOwnedTeacherSheet(db,owner,replica),null);assert.equal(await saveOwnedTeacherSheetDraft(db,owner,replica,{}),null);assert.equal(state.rows.length,0);}
});
await check('revocation or ownership change between pre-read and write refuses the write',async()=>{
  for(const beforeSave of [s=>{s.lifecycle='purging';},s=>{s.owner=other;}]){
    const {db,state}=fixture({beforeSave});await assert.rejects(()=>saveOwnedTeacherSheetDraft(db,owner,replica,{}),e=>e.code==='teacher_sheet_write_failed');assert.equal(state.rows.length,0);
  }
});
await check('legacy bound draft remains readable and saves into its existing row',async()=>{
  const {db,state}=fixture({agentId:agent,rows:[row()]});assert.equal((await readOwnedTeacherSheet(db,owner,replica)).draft.identityWho,'Synthetic private field');
  const saved=await saveOwnedTeacherSheetDraft(db,owner,replica,{identityWho:'Explicit edit'});
  assert.equal(saved.sheet.sheet_id,row().sheet_id);assert.equal(state.rows[0].agent_id,agent);assert.equal(state.rows[0].replica_id,replica);
});
await check('published and revoked bytes remain unchanged when a new draft is saved',async()=>{
  for(const status of ['published','revoked']){const original=row({status});const {db,state}=fixture({agentId:agent,rows:[original]});
    const saved=await saveOwnedTeacherSheetDraft(db,owner,replica,{});assert.notEqual(saved.sheet.sheet_id,original.sheet_id);assert.deepEqual(state.rows[0],original);
  }
});
await check('explicit other-replica ownership cannot fall through a shared agent',async()=>{
  const {db,state}=fixture({agentId:agent,rows:[row({replica_id:sibling,owner_user_id:owner})]});
  assert.equal((await readOwnedTeacherSheet(db,owner,replica)).draft,null);await saveOwnedTeacherSheetDraft(db,owner,replica,{});assert.equal(state.rows[0].replica_id,sibling);assert.equal(state.rows.length,2);
});
await check('unbound save does not make the existing publication path reachable',async()=>{
  const {db,state}=fixture();await saveOwnedTeacherSheetDraft(db,owner,replica,{});
  await assert.rejects(()=>publishOwnedTeacherSheet(db,owner,replica),e=>e.code==='teacher_sheet_not_found');assert.equal(state.rows[0].status,'draft');
});
await check('shared agent never authorizes another explicit replica draft for publication',async()=>{
  const foreign=row({replica_id:sibling,owner_user_id:owner,consent_artifact_id:'synthetic-consent-fixture'});
  const {db,state}=fixture({agentId:agent,rows:[foreign]});
  await assert.rejects(()=>publishOwnedTeacherSheet(db,owner,replica),e=>e.code==='teacher_sheet_not_found');
  assert.deepEqual(await db(BOUND_TEACHER_SHEET_PUBLISH_SQL,publishParams(foreign)),[]);
  assert.deepEqual(state.rows,[foreign]);
});
await check('publish mutation cannot demote a foreign replica publication or use revoked target',async()=>{
  const foreign=row({sheet_id:'77777777-7777-4777-8777-777777777777',status:'published',replica_id:sibling,owner_user_id:owner});
  const own=row({replica_id:replica,owner_user_id:owner,status:'revoked',consent_artifact_id:'synthetic-consent-fixture'});
  const {db,state}=fixture({agentId:agent,rows:[foreign,own]});
  assert.deepEqual(await db(BOUND_TEACHER_SHEET_PUBLISH_SQL,publishParams(own)),[]);assert.deepEqual(state.rows,[foreign,own]);
  const ownDraft={...own,status:'draft'};const eligible=fixture({agentId:agent,rows:[foreign,ownDraft]});
  await eligible.db(BOUND_TEACHER_SHEET_PUBLISH_SQL,publishParams(ownDraft));assert.equal(eligible.state.rows[0].status,'published');
});
await check('removing actual publication ownership guards exposes the shared-agent negative control',async()=>{
  const foreign=row({replica_id:sibling,owner_user_id:owner,consent_artifact_id:'synthetic-consent-fixture'});
  const readMutant=fixture({agentId:agent,rows:[foreign],mutateSql:sql=>sql===BOUND_TEACHER_SHEET_READ_SQL?sql.replace('s.replica_id = r.replica_id','true'):sql});
  const leaked=await publishOwnedTeacherSheet(readMutant.db,owner,replica);assert.equal(leaked.sheet.sheet_id,foreign.sheet_id,'reader mutant exposes foreign draft instead of 404');
  const writeMutant=fixture({agentId:agent,rows:[foreign],mutateSql:sql=>sql===BOUND_TEACHER_SHEET_PUBLISH_SQL?sql.replaceAll('s.replica_id = o.replica_id','true'):sql});
  assert.equal((await writeMutant.db(BOUND_TEACHER_SHEET_PUBLISH_SQL,publishParams(foreign)))[0].status,'published');
  assert.equal((BOUND_TEACHER_SHEET_PUBLISH_SQL.match(/s\.replica_id = o\.replica_id/g)||[]).length,3,'target, demotion and publication independently carry scope');
  assert(BOUND_TEACHER_SHEET_PUBLISH_SQL.includes('and exists (select 1 from target)'));
});
await check('actual publish rejects same-row content, status, consent or version changes without demotion',async()=>{
  const {SHEET}=await loadFixtureAgent(fileURLToPath(new URL('..',import.meta.url)));
  const accepted=row({replica_id:replica,owner_user_id:owner,sheet:SHEET,consent_artifact_id:'88888888-8888-4888-8888-888888888888'});
  const previous=row({sheet_id:'77777777-7777-4777-8777-777777777777',status:'published',replica_id:replica,owner_user_id:owner});
  for(const [property,value]of [['sheet',{...SHEET,crisisLines:''}],['status','validated'],['consent_artifact_id','99999999-9999-4999-8999-999999999999'],['version','concurrent-version']]){
    const {db,state}=fixture({agentId:agent,rows:[previous,accepted],beforePublish:s=>{s.rows[1][property]=value;}});
    await assert.rejects(()=>publishOwnedTeacherSheet(db,owner,replica),e=>e.code==='teacher_sheet_publish_conflict');
    assert.equal(state.rows[0].status,'published');assert.notEqual(state.rows[1].status,'published');
  }
  const safe=fixture({agentId:agent,rows:[previous,accepted]});assert.equal((await publishOwnedTeacherSheet(safe.db,owner,replica)).ok,true);
  const mutant=fixture({agentId:agent,rows:[previous,accepted],beforePublish:s=>{s.rows[1].sheet={...SHEET,crisisLines:''};},mutateSql:sql=>sql===BOUND_TEACHER_SHEET_PUBLISH_SQL?sql.replaceAll('s.sheet = $4::jsonb','true'):sql});
  assert.equal((await publishOwnedTeacherSheet(mutant.db,owner,replica)).ok,true,'removing actual content CAS must expose unchecked bytes');
  for(const clause of ['s.sheet = $4::jsonb','s.status = $5::text','s.consent_artifact_id = $6::uuid','s.version = $7::text'])assert.equal(BOUND_TEACHER_SHEET_PUBLISH_SQL.split(clause).length-1,2,'target and write both bind '+clause);
});
await check('actual write predicates have adversarial control-flow consequences',async()=>{
  for(const [guard,beforeSave]of [["and r.lifecycle not in ('revoked','purging')",s=>{s.lifecycle='purging';}],['and r.owner_user_id = $2::uuid',s=>{s.owner=other;}]]){
    const {db,state}=fixture({beforeSave,mutateSql:sql=>sql===PRIVATE_TEACHER_SHEET_SAVE_SQL?sql.replace(guard,''):sql});
    await saveOwnedTeacherSheetDraft(db,owner,replica,{});assert.equal(state.rows.length,1,'mutant must expose a refused write');
  }
});
await check('migration is mirrored and closes public, owner and first-save boundaries',async()=>{
  const migration=readFileSync(new URL('../db/migrations/139_private_teacher_sheet_draft.sql',import.meta.url),'utf8');
  const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');assert(schema.includes(migration.trim()));
  assert(migration.includes("status in ('draft','revoked')"));assert(migration.includes('references vy_replica(replica_id,owner_user_id) on delete cascade'));
  assert(migration.includes("where replica_id is not null and status='draft'"));
  assert(PRIVATE_TEACHER_SHEET_SAVE_SQL.includes("on conflict (replica_id) where replica_id is not null and status = 'draft'"));
  assert(!migration.includes('insert into vy_agent'));
});
console.log(`${passed} private TeacherSheet fixture groups passed; no SQL proof.`);
