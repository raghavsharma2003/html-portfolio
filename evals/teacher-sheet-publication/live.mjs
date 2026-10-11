// Opt-in root-run SQL proof. No config imports, entry invocation or provider calls.
// Synthetic persisted-column markers are fixtures, not actual consent grants.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validateTeacherSheet} from '../../api/_engine.gen.js';
import {reviewOwnedTeacherSheetPublication as review,publishOwnedTeacherSheet as publish,PRIVATE_TEACHER_SHEET_READ_SQL,BOUND_TEACHER_SHEET_READ_SQL,BOUND_TEACHER_SHEET_PUBLISH_SQL} from '../../api/_teacher-sheet-draft.js';

export async function runTeacherSheetPublicationSqlChecks(db,{sheet,recordFixtures}={}) {
 assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');
 assert(sheet&&validateTeacherSheet(sheet).ok,'valid synthetic teacher sheet required before fixture writes');
 assert.equal(typeof recordFixtures,'function','durable prewrite fixture recorder required');
 const ids={owner:randomUUID(),other:randomUUID(),agent:randomUUID(),otherAgent:randomUUID(),replica:randomUUID(),otherReplica:randomUUID(),emptyReplica:randomUUID(),sheet:randomUUID(),privateSheet:randomUUID(),otherSheet:randomUUID(),consent:randomUUID(),changedConsent:randomUUID()};
 const body={...structuredClone(sheet),slug:'publication-fixture-'+ids.agent},version=body.version;
 assert(validateTeacherSheet(body).ok);const checks=[],cleanupErrors=[],statements=[];let error=null,stage='manifest',remaining=null;
 await recordFixtures({kind:'teacher-sheet-publication-synthetic-only',at:new Date().toISOString(),database:'vyakti_expert_integration_20260906',ids,realConsentGrant:false,providerCalls:0});
 const track=async(sql,params=[])=>{statements.push({sql,params});return db(sql,params);};
 const capture=async name=>{stage=name;};
 const state=async()=> (await db('select sheet,status,consent_artifact_id,version,published_at from vy_teacher_sheet where sheet_id=$1::uuid',[ids.sheet]))[0];
 try {
  await capture('explain-exact-runtime-statements');
  const source=readFileSync(new URL('../../api/_teacher-sheet-draft.js',import.meta.url),'utf8');
  const owned=source.match(/async function ownedReplica[\s\S]*?await db\(\s*`([^`]+)`/)?.[1];assert(owned);
  for(const [sql,params]of [[owned,[ids.replica,ids.owner]],[PRIVATE_TEACHER_SHEET_READ_SQL,[ids.replica,ids.owner]],[BOUND_TEACHER_SHEET_READ_SQL,[ids.replica,ids.owner]],[BOUND_TEACHER_SHEET_PUBLISH_SQL,[ids.replica,ids.owner,ids.sheet,JSON.stringify(body),'draft',ids.consent,version]]]){await db('EXPLAIN '+sql,params);}
  checks.push('four-exact-runtime-statements-explained');
  await capture('create-manifested-fixtures');
  for(const [rid,owner]of [[ids.replica,ids.owner],[ids.otherReplica,ids.other],[ids.emptyReplica,ids.owner]])await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic publication fixture','publication-eval/v1')",[rid,owner]);
  for(const aid of [ids.agent,ids.otherAgent])await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic publication fixture')",[aid,'publication-fixture-'+aid]);
  for(const [rid,owner,aid]of [[ids.replica,ids.owner,ids.agent],[ids.otherReplica,ids.other,ids.otherAgent]])await db('update vy_replica set agent_id=$3::uuid where replica_id=$1::uuid and owner_user_id=$2::uuid',[rid,owner,aid]);
  for(const [sid,aid,rid,owner]of [[ids.sheet,ids.agent,null,null],[ids.otherSheet,ids.otherAgent,ids.otherReplica,ids.other]])await db("insert into vy_teacher_sheet(sheet_id,agent_id,replica_id,owner_user_id,version,sheet,status,consent_artifact_id,created_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,'draft',$7::uuid,'2026-09-01T00:00:00Z')",[sid,aid,rid,owner,version,JSON.stringify(body),ids.consent]);
  await capture('read-only-reviewed-owner-scope');const first=await review(track,ids.owner,ids.replica);assert.equal(first.ok,true);assert.equal(first.review.sheet_id,ids.sheet);assert.equal(first.consent_basis,'persisted_sheet_column');assert.equal((await state()).status,'draft');assert(statements.every(x=>! /\b(insert|update|delete)\b/.test(x.sql)));assert.equal(await review(track,ids.other,ids.replica),null);assert.equal(await review(track,ids.owner,ids.otherReplica),null);checks.push('owner-reviewed-read-only-scope');
  const empty=await review(track,ids.owner,ids.emptyReplica);assert.equal(empty.ok,false);assert(empty.blockers.includes('publication_binding_unavailable'));checks.push('ordinary-unbound-replica-has-honest-platform-blocker');
  await capture('newer-private-editor-and-old-caller-negative');
  await db("insert into vy_teacher_sheet(sheet_id,agent_id,replica_id,owner_user_id,version,sheet,status,created_at) values($1::uuid,null,$2::uuid,$3::uuid,'private',$4::jsonb,'draft','2026-09-02T00:00:00Z')",[ids.privateSheet,ids.replica,ids.owner,JSON.stringify({name:'Synthetic private newest'})]);
  const privateReview=await review(track,ids.owner,ids.replica);assert.equal(privateReview.review.sheet_id,ids.privateSheet);assert.equal(privateReview.ok,false);assert.equal((await publish(track,ids.owner,ids.replica,{review:privateReview.review})).ok,false);await assert.rejects(()=>publish(track,ids.owner,ids.replica,{review:first.review}),e=>e.code==='teacher_sheet_publication_review_changed');assert.equal((await state()).status,'draft');
  // Exact retained legacy caller demonstrably publishes the older bound row.
  assert.equal((await publish(track,ids.owner,ids.replica)).sheet.sheet_id,ids.sheet);assert.equal((await state()).status,'published');checks.push('actual-old-latest-bound-negative-and-reviewed-private-refusal');
  await db('delete from vy_teacher_sheet where sheet_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[ids.privateSheet,ids.replica,ids.owner]);await db("update vy_teacher_sheet set status='draft',published_at=null where sheet_id=$1::uuid",[ids.sheet]);
  await capture('changed-snapshot-before-post');
  for(const [column,value]of [['version',version+'changed'],['consent_artifact_id',ids.changedConsent],['sheet',JSON.stringify({...body,identityWho:body.identityWho+' changed'})]]){
   const key=(await review(track,ids.owner,ids.replica)).review;
   const sql=column==='version'?'update vy_teacher_sheet set version=$2 where sheet_id=$1::uuid':column==='consent_artifact_id'?'update vy_teacher_sheet set consent_artifact_id=$2::uuid where sheet_id=$1::uuid':'update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid';
   await db(sql,[ids.sheet,value]);await assert.rejects(()=>publish(track,ids.owner,ids.replica,{review:key}),e=>e.code==='teacher_sheet_publication_review_changed');assert.equal((await state()).status,'draft');await db('update vy_teacher_sheet set version=$2,consent_artifact_id=$3::uuid,sheet=$4::jsonb where sheet_id=$1::uuid',[ids.sheet,version,ids.consent,JSON.stringify(body)]);
  }checks.push('version-column-consent-and-content-changes-refused');
  await capture('column-consent-not-json-claim');await db('update vy_teacher_sheet set consent_artifact_id=null where sheet_id=$1::uuid',[ids.sheet]);const noConsent=await review(track,ids.owner,ids.replica);assert.equal(noConsent.ok,false);assert(noConsent.blockers.includes('publication_consent_unavailable'));assert.equal((await publish(track,ids.owner,ids.replica,{review:noConsent.review})).ok,false);await db('update vy_teacher_sheet set consent_artifact_id=$2::uuid where sheet_id=$1::uuid',[ids.sheet,ids.consent]);checks.push('column-consent-required');
  await capture('atomic-intervening-change');const key=(await review(track,ids.owner,ids.replica)).review;let altered=false;
  const race=async(sql,params)=>{if(sql===BOUND_TEACHER_SHEET_PUBLISH_SQL&&!altered){altered=true;await db('update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid',[ids.sheet,JSON.stringify({...body,identityWho:body.identityWho+' intervening'})]);}return track(sql,params);};
  await assert.rejects(()=>publish(race,ids.owner,ids.replica,{review:key}),e=>e.code==='teacher_sheet_publish_conflict');assert.equal((await state()).status,'draft');await db('update vy_teacher_sheet set sheet=$2::jsonb where sheet_id=$1::uuid',[ids.sheet,JSON.stringify(body)]);checks.push('actual-sql-cas-refuses-intervening-write');
  await capture('explicit-same-reviewed-publication-and-readback');const finalKey=(await review(track,ids.owner,ids.replica)).review;assert.equal((await publish(track,ids.owner,ids.replica,{review:finalKey})).sheet.status,'published');const result=await review(track,ids.owner,ids.replica);assert.deepEqual(result.review,finalKey);assert(result.sheet.published_at);const before=(await state()).published_at;const writes=statements.filter(x=>x.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL).length;assert.equal((await publish(track,ids.owner,ids.replica,{review:finalKey})).ok,true);assert.equal(statements.filter(x=>x.sql===BOUND_TEACHER_SHEET_PUBLISH_SQL).length,writes);assert.deepEqual((await state()).published_at,before);checks.push('explicit-publish-same-snapshot-readback-and-replay-no-write');
  await capture('foreign-row-and-revocation');assert.equal((await db('select status from vy_teacher_sheet where sheet_id=$1::uuid',[ids.otherSheet]))[0].status,'draft');await db("update vy_teacher_sheet set status='revoked' where sheet_id=$1::uuid",[ids.sheet]);assert.equal((await review(track,ids.owner,ids.replica)).ok,false);for(const lifecycle of ['revoked','purging']){await db('update vy_replica set lifecycle=$2 where replica_id=$1::uuid',[ids.replica,lifecycle]);assert.equal(await review(track,ids.owner,ids.replica),null);assert.equal(await publish(track,ids.owner,ids.replica,{review:finalKey}),null);}checks.push('foreign-row-preserved-sheet-revoked-and-terminal-replica-refused');
 }catch(cause){error={stage,code:cause.code||null,message:String(cause.message)};}
 finally{
  for(const [name,sql,params]of [
   ['sheets','delete from vy_teacher_sheet where sheet_id=any($1::uuid[])',[[ids.sheet,ids.privateSheet,ids.otherSheet]]],
   ['replicas','delete from vy_replica where replica_id=any($1::uuid[]) and owner_user_id=any($2::uuid[])',[[ids.replica,ids.otherReplica,ids.emptyReplica],[ids.owner,ids.other]]],
   ['agents','delete from vy_agent where agent_id=any($1::uuid[])',[[ids.agent,ids.otherAgent]]]]){try{await db(sql,params);}catch(cause){cleanupErrors.push({name,code:cause.code||null,message:String(cause.message)});}}
  try{remaining=Number((await db('select (select count(*) from vy_teacher_sheet where sheet_id=any($1::uuid[]))+(select count(*) from vy_replica where replica_id=any($2::uuid[]))+(select count(*) from vy_agent where agent_id=any($3::uuid[])) as count',[[ids.sheet,ids.privateSheet,ids.otherSheet],[ids.replica,ids.otherReplica,ids.emptyReplica],[ids.agent,ids.otherAgent]]))[0].count);}catch(cause){cleanupErrors.push({name:'remaining',message:String(cause.message)});}
 }
 return {at:new Date().toISOString(),passed:!error&&!cleanupErrors.length&&remaining===0,checks,error,cleanup:{remaining,errors:cleanupErrors},ids,sqlHashes:[...new Set(statements.map(x=>x.sql))].map(sql=>({sha256:createHash('sha256').update(sql).digest('hex'),sql})),scope:'Synthetic development persisted-state proof only; no real publication grant, customer publication, identity, provider, or parallel-overlap acceptance.'};
}
