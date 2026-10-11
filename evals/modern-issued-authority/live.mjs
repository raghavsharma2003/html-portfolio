// Opt-in injected development SQL runner. Default CLI is OFFLINE preparation.
// Root must review source pins, migration144 and synthetic fixtures before use.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {persistProcessingOutput} from '../../api/_replica-processing/repository.js';
import {issueOwnedModernChallenge,getOwnedModernComparisonDescriptor,createModernCaptureAuthorityLoader,
 MODERN_AUTHORITY_ISSUE_SQL,MODERN_AUTHORITY_LOAD_SQL,SELECTED_COMPARISON_ATTESTATIONS} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
import {decideOwnedEvidence,selectOwnedVoiceArtifact,acceptAllOwnedEvidenceForSelfTest,REFERENCE_REVIEW_EVIDENCE_SQL} from '../../api/_replica-review.js';
import {prepareModernAuthoritySqlCases,addSnapshotBarrier,withoutReferenceEpochAdvance} from './sql-cases.mjs';
import {prepareLiveFixtureSqlCases} from './live-fixture-sql.mjs';
import {makeLiveAuthorityFixture,liveAuthorityManifest,assertLiveAuthorityAbsent,seedLiveAuthority,
 attachLiveCaptureLease,countLiveAuthority,cleanupLiveAuthority,LIVE_DATABASE} from './live-fixtures.mjs';

export const REQUIRED_LIVE_PINS=Object.freeze([
 'api/_liveness/issued-authority.js','api/_liveness/issued-contract.js','api/_liveness/registry.js',
 'api/_liveness/azure-shared-audio.js','api/_liveness/capture-readiness.js','api/_replica-review.js',
 'api/_replica-liveness.js','api/_replica-liveness-verification.js','api/_replica-processing/contracts.js',
 'api/_replica-processing/repository.js','api/_replica-processing/purpose.js','api/_voice-identity/issued-contract.js',
 'db/migrations/144_modern_reference_authority_epoch.sql','evals/modern-issued-authority/fixtures.mjs',
 'evals/modern-issued-authority/sql-cases.mjs','evals/modern-issued-authority/live-fixtures.mjs',
 'evals/modern-issued-authority/live.mjs','evals/modern-issued-authority/live-fixture-sql.mjs']);
const base=new URL('../../',import.meta.url);
const safeError=e=>({code:/^[A-Za-z0-9_]{1,120}$/.test(e?.code||'')?e.code:'UNCLASSIFIED',
 assertion:/^[a-z0-9_: -]{1,100}$/.test(String(e?.message||'').split('\n')[0])?String(e.message).split('\n')[0]:null});
const outcome=p=>p.then(value=>({value}),error=>({error}));
const readRows=async(db,sql,p=[])=>{const rows=await db(sql,p);assert(Array.isArray(rows),'live_rows_required');return rows;};
async function guard(db){assert.equal((await readRows(db,'select current_database() as name'))[0]?.name,LIVE_DATABASE,'exact_development_database_required');}
async function begin(openSession){
 const s=await openSession();try{await guard(s.query.bind(s));await s.query('BEGIN');
  await s.query("set local statement_timeout='10s'");await s.query("set local lock_timeout='7s'");
  await s.query("set local idle_in_transaction_session_timeout='60s'");return s;
 }catch(e){await s.close();throw e;}
}
async function end(s){if(s){try{await s.query('ROLLBACK');}finally{await s.close();}}}
export function assertVisibleRaceQuery(visible,submitted,marker,capacity){
 assert(Number.isSafeInteger(capacity)&&capacity>Buffer.byteLength(marker),'activity_marker_capacity_required');
 assert(typeof visible==='string'&&visible.startsWith(marker),'blocked_target_marker_mismatch');
 assert(submitted.startsWith(visible),'blocked_target_sql_prefix_mismatch');
 return {activity_query_truncated:visible!==submitted,visible_query_bytes:Buffer.byteLength(visible),activity_capacity_bytes:capacity};
}
export async function closeLiveRaceSessions({holder,reader,pending}){
 const failures=[];
 const close=async session=>{if(!session)return;try{await session.query('ROLLBACK');}catch(e){failures.push(e);}
  finally{try{await session.close();}catch(e){failures.push(e);}}};
 try{await close(holder);}
 finally{try{if(pending)await pending;}catch(e){failures.push(e);}
  finally{await close(reader);}}
 if(failures.length)throw Object.assign(Error('live_race_cleanup_failed'),{code:'LIVE_RACE_CLEANUP_FAILED',cleanup_errors:failures.map(safeError)});
}
async function snapshot(db,f){const b=f.binding;return (await db(`select r.reference_authority_epoch,
 (select jsonb_agg(to_jsonb(ch) order by ch.challenge_id) from vy_replica_liveness_challenge ch where ch.replica_id=r.replica_id) challenges,
 (select jsonb_agg(to_jsonb(g) order by g.grant_id) from vy_replica_biometric_verification_grant g where g.replica_id=r.replica_id) grants,
 (select jsonb_agg(jsonb_build_object('id',s.source_id,'state',s.state,'updated_at',s.updated_at) order by s.source_id) from vy_replica_source s where s.replica_id=r.replica_id) sources
 from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid`,[b.replica_id,b.owner_user_id]))[0];}
async function preview(db,f){
 const b=f.binding,d=await getOwnedModernComparisonDescriptor(db,b.owner_user_id,b.replica_id);assert(d,'live_comparison_descriptor_required');
 return {locale:'hi-IN',expected_primary_source_id:d.primary_source_id,expected_primary_selection_id:d.primary_selection_id,
  expected_primary_source_sha256:d.source_sha256,expected_comparison_snapshot_sha256:d.comparison_snapshot_sha256,
  attestations:Object.fromEntries(BIOMETRIC_VERIFICATION_ATTESTATIONS.map(k=>[k,true])),
  comparison_attestations:Object.fromEntries(SELECTED_COMPARISON_ATTESTATIONS.map(k=>[k,true]))};
}

export async function runModernIssuedAuthoritySqlChecks({db,openSession,onFixtureManifest,expectedSourceSha256,allowSyntheticSql=false}={}) {
 assert.equal(allowSyntheticSql,true,'explicit_synthetic_sql_opt_in_required');
 assert.equal(typeof db,'function','injected_database_required');assert.equal(typeof openSession,'function','injected_sessions_required');
 assert.equal(typeof onFixtureManifest,'function','durable_fixture_manifest_required');
 for(const name of REQUIRED_LIVE_PINS){assert.match(expectedSourceSha256?.[name]||'',/^[0-9a-f]{64}$/,'reviewed_source_pin_required');
  assert.equal(sha256Hex(readFileSync(new URL(name,base))),expectedSourceSha256[name],'reviewed_source_changed');}
 const fixtures=Array.from({length:3},makeLiveAuthorityFixture),seeded=[],checks=[],races=[],errors=[];
 let stage='manifest',failure,cleanupFailure,cleanup=[];
 const manifest=()=>({database:LIVE_DATABASE,fixtures:fixtures.map(liveAuthorityManifest),source_sha256:expectedSourceSha256});
 // New challenge/grant IDs are allocated by the actual production issuer. They
 // are durably added to this manifest and checked absent BEFORE its INSERT.
 const prepareIssue=async(f,input=undefined)=>{
  input ||= await preview(db,f);let captured;
  try{await issueOwnedModernChallenge(async(sql,p)=>{
   if(sql!==MODERN_AUTHORITY_ISSUE_SQL)return db(sql,p);
   captured={sql,params:p,receipt:JSON.parse(p[5]),input};const c=captured.receipt.envelope.contract;
   f.allocatedChallenges.push(c.challengeId);f.allocatedGrants.push(c.comparisonConsentId);
   await onFixtureManifest(manifest());
   const rows=await db(`select (select count(*) from vy_replica_liveness_challenge where challenge_id=$1::uuid)::int challenges,
    (select count(*) from vy_replica_biometric_verification_grant where grant_id=$2::uuid)::int grants`,[c.challengeId,c.comparisonConsentId]);
   assert.equal(rows.length,1);assert.equal(Number(rows[0].challenges),0);assert.equal(Number(rows[0].grants),0);
   throw Object.assign(Error('prepared_no_mutation'),{code:'PREPARED_ONLY'});
  },f.binding.owner_user_id,f.binding.replica_id,input);}catch(e){if(e.code!=='PREPARED_ONLY')throw e;}
  assert(captured,'actual_issue_capture_required');return captured;
 };
 const issue=async f=>{const c=await prepareIssue(f);const rows=await db(c.sql,c.params);assert.equal(rows.length,1,'actual_issue_required');return c;};
 const refusal=async(fn)=>{await assert.rejects(fn,e=>typeof e?.code==='string'&&e.code.startsWith('liveness_issued_capture_'));};
 const witness=async(readerPid,holderPid,expectedSql,marker,finished)=>{
  const until=Date.now()+4500;let found;
  while(Date.now()<until){
   const rows=await db("select pid,query,wait_event_type,pg_blocking_pids(pid) blockers,pg_size_bytes(current_setting('track_activity_query_size')) activity_capacity from pg_stat_activity where pid=$1::integer",[readerPid]);
   if(rows[0]?.blockers?.map(Number).includes(holderPid)){
    found={...rows[0],...assertVisibleRaceQuery(rows[0].query,expectedSql,marker,Number(rows[0].activity_capacity))};break;
   }
   if(finished.done)break;await new Promise(r=>setTimeout(r,35));
  }
  assert(found,'actual_blocking_pid_witness_required');return{reader_pid:readerPid,holder_pid:holderPid,sql_sha256:sha256Hex(expectedSql),wait_event_type:found.wait_event_type,
   marker,activity_query_truncated:found.activity_query_truncated,visible_query_bytes:found.visible_query_bytes,activity_capacity_bytes:found.activity_capacity_bytes};
 };
 const oldSnapshotRace=async({name,f,readerSql,readerParams,write,expectRows})=>{
  let h,r,pending;const finished={done:false};const instrumented=addSnapshotBarrier(readerSql);
  // A fixed key is safe only within these guarded fixture sessions. The key is
  // derived from the unique replica and cannot overlap another runner fixture.
  const key=BigInt('0x'+sha256Hex(f.binding.replica_id).slice(0,14)).toString();
  const marker=`/* modern-authority-race:${sha256Hex(name+f.binding.replica_id).slice(0,32)} */`;
  const submitted=marker+'\n'+instrumented.sql;
  try{h=await begin(openSession);r=await begin(openSession);
   const hp=Number((await h.query('select pg_backend_pid() pid'))[0].pid),rp=Number((await r.query('select pg_backend_pid() pid'))[0].pid);
   await h.query('select pg_advisory_xact_lock($1::bigint)',[key]);
   pending=outcome(r.query(submitted,[...readerParams,key]));pending.then(()=>{finished.done=true;});
   const evidence=await witness(rp,hp,submitted,marker,finished);
   await write(h.query.bind(h));await h.query('COMMIT');
   const result=await pending;if(result.error)throw result.error;
   assert.equal(result.value.length,expectRows,'old_snapshot_authority_result');
   races.push({name,...evidence,original_sql_sha256:instrumented.original_sha256,instrumented_sql_sha256:instrumented.sha256,returned_rows:result.value.length});checks.push(name);
  }finally{
   // Always release holder first so a failed witness cannot strand the reader.
   try{await closeLiveRaceSessions({holder:h,reader:r,pending});}catch(e){errors.push({stage:'race-session-cleanup',...safeError(e),cleanup_errors:e.cleanup_errors});throw e;}
  }
 };
 try{
  await onFixtureManifest(manifest());stage='database';await guard(db);
  // No migration is applied here. Missing144 is a hard preparation failure.
  const col=await db("select data_type from information_schema.columns where table_schema='public' and table_name='vy_replica' and column_name='reference_authority_epoch'");
  assert.equal(col[0]?.data_type,'bigint','reviewed_migration144_required');
  stage='explain';const prepared=await prepareModernAuthoritySqlCases(),fixtureSql=await prepareLiveFixtureSqlCases();
  let parser;try{parser=await begin(openSession);await parser.query('SET TRANSACTION READ ONLY');
   for(const c of prepared.cases){await parser.query('EXPLAIN '+c.sql,c.params);checks.push('explain:'+c.name);}
   for(const c of fixtureSql.cases){stage='fixture-explain:'+c.name;await parser.query('EXPLAIN '+c.sql,c.params);checks.push('fixture-explain:'+c.name);}
   await parser.query('SAVEPOINT invalid_column');await assert.rejects(()=>parser.query('EXPLAIN select missing_modern_comparison_column from vy_replica'),e=>e.code==='42703');
   await parser.query('ROLLBACK TO SAVEPOINT invalid_column');checks.push('explain:negative42703');
   for(const negative of fixtureSql.negatives){await parser.query('SAVEPOINT legacy_fixture_shape');await assert.rejects(()=>parser.query('EXPLAIN '+negative.sql,negative.params),e=>e.code===negative.expected_code);
    await parser.query('ROLLBACK TO SAVEPOINT legacy_fixture_shape');checks.push('fixture-explain:retained-negative'+negative.expected_code);}
  }finally{await end(parser);}
  stage='absence';for(const f of fixtures)await assertLiveAuthorityAbsent(db,f);
  stage='seed';for(const f of fixtures){seeded.push(f);await seedLiveAuthority(db,f,()=>onFixtureManifest(manifest()));}
  const [main,negative,concurrent]=fixtures;
  stage='first-issue';const first=await issue(main);checks.push(stage);
  const afterFirst=await snapshot(db,main);
  assert.equal(Number(afterFirst.reference_authority_epoch),main.binding.reference_authority_epoch+1);
  stage='same-preview-replay';await refusal(()=>issueOwnedModernChallenge(db,main.binding.owner_user_id,main.binding.replica_id,first.input));
  assert.deepEqual(await snapshot(db,main),afterFirst);checks.push(stage);
  stage='replacement-rollback';const replacement=await prepareIssue(main);
  for(const field of ['challengeId','comparisonConsentId']){
   let s;try{s=await begin(openSession);const p=structuredClone(replacement.params),receipt=JSON.parse(p[5]);
    receipt.envelope.contract[field]=first.receipt.envelope.contract[field];p[5]=JSON.stringify(receipt);p[6]=sha256Hex(receipt);
    await s.query('SAVEPOINT insertion_failure');await assert.rejects(()=>s.query(replacement.sql,p),e=>e.code==='23505');
    await s.query('ROLLBACK TO SAVEPOINT insertion_failure');assert.deepEqual(await snapshot(s.query.bind(s),main),afterFirst);checks.push('rollback:'+field);
   }finally{await end(s);}
  }
  stage='valid-replacement';assert.equal((await db(replacement.sql,replacement.params)).length,1);
  const afterReplacement=await snapshot(db,main);assert.equal(Number(afterReplacement.reference_authority_epoch),main.binding.reference_authority_epoch+2);
  assert.equal(afterReplacement.challenges.filter(c=>c.state==='issued').length,1);checks.push(stage);
  stage='duplicate-primary';let dup;try{dup=await begin(openSession);await dup.query('SAVEPOINT duplicate_primary');
   await assert.rejects(()=>dup.query('insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id) values($1::uuid,$2::uuid,$3::uuid)',[main.binding.replica_id,main.binding.owner_user_id,main.captureId]),e=>e.code==='23505');
   await dup.query('ROLLBACK TO SAVEPOINT duplicate_primary');checks.push(stage);
  }finally{await end(dup);}
  stage='valid-load';const lease=await attachLiveCaptureLease(db,main,replacement.receipt);
  const load=createModernCaptureAuthorityLoader({db});assert(await load(lease));checks.push(stage);
  const epoch=async q=>(await q('select reference_authority_epoch,private_text_epoch from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[main.binding.replica_id,main.binding.owner_user_id]))[0];
  stage='review-writer-epochs';let review;
  try{review=await begin(openSession);const q=review.query.bind(review),before=await epoch(q);
   assert.equal(await acceptAllOwnedEvidenceForSelfTest(q,main.binding.owner_user_id,main.binding.replica_id,{synthetic_sql_fixture:true}),0);
   assert.deepEqual(await epoch(q),before);checks.push('review:empty-batch-no-advance');
   await persistProcessingOutput(q,{outcome:'complete',artifacts:[],evidence:[main.nonReferenceRecord]});
   assert(await decideOwnedEvidence(q,main.binding.owner_user_id,{replica_id:main.binding.replica_id,evidence_id:main.nonReferenceRecord.evidence_id,decision:'accepted',reason_code:'segment_verified'}));
   assert.deepEqual(await epoch(q),before);checks.push('review:nonreference-no-advance');
   await q('delete from vy_replica_processing_evidence_decision where decision_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[main.reference_rows[0].decision_id,main.binding.replica_id,main.binding.owner_user_id]);
   assert.equal(await acceptAllOwnedEvidenceForSelfTest(q,main.binding.owner_user_id,main.binding.replica_id,{synthetic_sql_fixture:true}),1);
   const changed=await epoch(q);assert.equal(Number(changed.reference_authority_epoch),Number(before.reference_authority_epoch)+1);
   assert.equal(String(changed.private_text_epoch),String(before.private_text_epoch));checks.push('review:positive-batch-once');
  }finally{await end(review);}
  stage='review-artifact-prerequisites';try{review=await begin(openSession);const q=review.query.bind(review),before=await epoch(q),b=main.binding;
   // Existing-enrollment prerequisites are synthetic and transaction-local.
   // This does not bypass them for the new first-owner path or create a verdict.
   await q("update vy_replica set liveness_verified_at=now(),identity_expires_at=now()+interval '1 hour' where replica_id=$1::uuid and owner_user_id=$2::uuid",[b.replica_id,b.owner_user_id]);
   for(const [i,scope]of ['biometric','training'].entries())await q("insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,'manual_review',$5,$6,'{\"synthetic_sql_fixture\":true}'::jsonb,now()+interval '1 hour')",
    [main.reviewConsentIds[i],b.replica_id,b.owner_user_id,scope,b.policy_version,sha256Hex('synthetic-'+scope)]);
   stage='review-artifact-select';assert(await selectOwnedVoiceArtifact(q,b.owner_user_id,{replica_id:b.replica_id,artifact_id:b.artifact_id},{synthetic_sql_fixture:true}));
   stage='review-artifact-reference-epoch';const changed=await epoch(q);assert.equal(Number(changed.reference_authority_epoch),Number(before.reference_authority_epoch)+1);
   stage='review-artifact-private-epoch';assert.equal(String(changed.private_text_epoch),String(before.private_text_epoch));checks.push('review:artifact-once-text-epoch-unchanged');
  }finally{await end(review);}
  for(const [name,mutate]of [
   ['capture-hash',l=>{l.source.sha256='0'.repeat(64);}],['private-locator',l=>{l.source.objectPath+='-other';}],
   ['lease-token',l=>{l.leaseToken='0'.repeat(64);}],['attempt',l=>{l.attempt++;}],
   ['identity-locator',l=>{l.identityReference.objectPath+='-other';}],['face-digest',l=>{l.officialFaceProof.providerDigest='0'.repeat(64);}]
  ]){stage='load-negative:'+name;const changed=structuredClone(lease);mutate(changed);await refusal(()=>load(changed));checks.push(stage);}
  for(const [name,sql]of [['grant-revoked',"update vy_replica_biometric_verification_grant set state='revoked' where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid"],
   ['expired',"update vy_replica_liveness_challenge set expires_at=now()-interval '1 second' where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid"]]){
   stage=name;let s;try{s=await begin(openSession);await s.query(sql,[lease.challengeId,lease.replicaId,lease.ownerUserId]);
    await refusal(()=>createModernCaptureAuthorityLoader({db:s.query.bind(s)})(lease));checks.push(stage);
   }finally{await end(s);}
  }
  stage='source-contention';let holder;try{holder=await begin(openSession);
   await holder.query('select source_id from vy_replica_source where source_id=$1::uuid and replica_id=$2::uuid for update',[main.binding.primary_source_id,main.binding.replica_id]);
   await assert.rejects(()=>load(lease),e=>e.code==='liveness_issued_capture_authority_busy');checks.push(stage);
  }finally{await end(holder);}
  stage='review-contention';try{holder=await begin(openSession);
   await holder.query("select pg_advisory_xact_lock(hashtextextended($1::text || ':voice_genome_review',0))",[main.binding.replica_id]);
   await refusal(()=>load(lease));checks.push(stage);
  }finally{await end(holder);}
  const captureLoad=async(f,l)=>{let captured;await createModernCaptureAuthorityLoader({db:async(sql,p)=>{
   if(sql===MODERN_AUTHORITY_LOAD_SQL)captured={sql,params:p};return db(sql,p);
  }})(l);assert(captured);return captured;};
  const current=await captureLoad(main,lease);
  stage='review-old-snapshot-refused';await oldSnapshotRace({name:stage,f:main,readerSql:current.sql,readerParams:current.params,expectRows:0,
   write:q=>decideOwnedEvidence(q,main.binding.owner_user_id,{replica_id:main.binding.replica_id,evidence_id:main.reference_rows[0].evidence_id,decision:'rejected',reason_code:'wrong_speaker'})});
  stage='retained-no-epoch-negative';const negIssue=await issue(negative),negLease=await attachLiveCaptureLease(db,negative,negIssue.receipt);
  const old=await captureLoad(negative,negLease);
  await oldSnapshotRace({name:stage,f:negative,readerSql:old.sql,readerParams:old.params,expectRows:1,
   write:q=>decideOwnedEvidence((sql,p)=>{assert.equal(sql,REFERENCE_REVIEW_EVIDENCE_SQL);return q(withoutReferenceEpochAdvance(sql),p);},negative.binding.owner_user_id,
    {replica_id:negative.binding.replica_id,evidence_id:negative.reference_rows[0].evidence_id,decision:'rejected',reason_code:'wrong_speaker'})});
  // This visibility negative must commit its synthetic writer to release a new
  // snapshot-visible version. It is erased by exact fixture cleanup below;
  // unlike insertion-failure controls, it cannot be called a rolled-back writer.
  stage='two-issuer-old-snapshot';const a=await prepareIssue(concurrent),b=await prepareIssue(concurrent);
  await oldSnapshotRace({name:stage,f:concurrent,readerSql:b.sql,readerParams:b.params,expectRows:0,write:async q=>{
   assert.equal((await q(a.sql,a.params)).length,1,'first_issuer_required');}});
  const final=await snapshot(db,concurrent);assert.equal(Number(final.reference_authority_epoch),concurrent.binding.reference_authority_epoch+1);
  assert.equal(final.challenges.length,1);assert.equal(final.grants.length,1);
 }catch(e){failure={stage,...safeError(e)};errors.push(failure);}
 finally{
  for(const f of seeded){try{const counts=await cleanupLiveAuthority(db,f);cleanup.push({replica_id:f.binding.replica_id,counts});
   assert(Object.values(counts).every(n=>Number.isSafeInteger(n)&&n===0),'exact_fixture_cleanup_nonzero');
  }catch(e){cleanupFailure={...safeError(e)};errors.push({stage:'cleanup',...cleanupFailure});}}
 }
 const report={database:LIVE_DATABASE,passed:!failure&&!cleanupFailure,checks,races,errors,cleanup,
  fixture_manifest:manifest(),sql_execution:true,provider_calls:0,identity_acceptance:false};
 if(!report.passed)throw Object.assign(Error('modern_authority_sql_acceptance_failed'),{report});
 return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const p=await prepareModernAuthoritySqlCases();console.log(JSON.stringify({mode:'offline-check',sql_execution:false,
  query_count:p.cases.length,required_source_pins:REQUIRED_LIVE_PINS,entry:'runModernIssuedAuthoritySqlChecks',
  migration_applied:false,requires:'root reviewed injected db/openSession, expectedSourceSha256, durable onFixtureManifest, allowSyntheticSql:true'},null,2));
}
