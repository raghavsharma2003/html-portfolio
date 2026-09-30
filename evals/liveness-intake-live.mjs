// Protected opt-in PostgreSQL proof. Synthetic prerequisites only: no person,
// auth account, identity/liveness timestamp grant, storage object or model call.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {executeProcessingJob} from '../api/_replica-processing/worker.js';
import {createNativeMediaAdapters} from '../api/_replica-processing/providers/native-media.js';
import {commitProcessingOutput} from '../api/_replica-processing/repository.js';
import {leaseNextProcessingJob,leaseTokenHash} from '../api/_replica-processing/queue.js';
import {liveIntakeReceiptsSql} from '../api/_replica-processing/purpose.js';
import {leaseNextLivenessVerification,completeLivenessVerification,createLivenessVerdict} from '../api/_replica-liveness-verification.js';
import {REPLICA_POLICY_VERSION} from '../api/_replica.js';

export async function runLivenessIntakeSqlChecks({db,openSession,onFixtureManifest}) {
  const owner=randomUUID();
  const cases=Array.from({length:7},()=>({rid:randomUUID(),source:randomUUID(),doc:randomUUID(),identity:randomUUID(),
    challenge:randomUUID(),capture:randomUUID(),storage:randomUUID(),grant:randomUUID(),
    integrity:randomUUID(),malware_scan:randomUUID(),forbidden:randomUUID()}));
  const manifest={ownerUserIds:[owner],replicaIds:cases.map(c=>c.rid),sourceIds:cases.flatMap(c=>[c.source,c.doc]),
    identityCaseIds:cases.map(c=>c.identity),challengeIds:cases.map(c=>c.challenge),
    consentIds:cases.flatMap(c=>[c.capture,c.storage]),verificationGrantIds:cases.map(c=>c.grant),
    processingJobIds:cases.flatMap(c=>[c.integrity,c.malware_scan,c.forbidden])};
  const bytes=Buffer.from('Synthetic SQL intake fixture, not biometric media.');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const phrase='The synthetic code is 123456';
  const phraseHash=createHash('sha256').update(phrase).digest('hex');
  const token='synthetic-intake-lease-'+randomUUID();
  const checks=[];let stage='fixture-manifest',failure=null,cleanupFailure=null,verifiedTarget=false,writesStarted=false,remainingFixtureRows=null;
  const safeError=(error,at)=>({stage:at,code:/^[a-zA-Z0-9_]{2,96}$/.test(String(error?.code||''))?error.code:'UNCLASSIFIED',
    assertionName:typeof error?.message==='string'&&/^intake:[a-z0-9-]+$/.test(error.message)?error.message:null});
  // Additive exact-generated-ID fences keep global queue APIs from touching
  // unrelated development work. All production authority predicates survive.
  const scoped=(query,c,step)=>async(sql,params=[])=>{
    if(sql.includes('with candidate as (')&&sql.includes('from vy_replica_processing_job j')){
      assert(sql.includes("where s.state in ('quarantined','processing')"),'intake:processing-scope-anchor');
      sql=sql.replace("where s.state in ('quarantined','processing')",`where s.source_id='${c.source}'::uuid and j.step='${step}' and s.state in ('quarantined','processing')`);
    }
    if(sql.includes('with candidate as (')&&sql.includes('from vy_replica_liveness_challenge ch')){
      assert(sql.includes("where ((ch.state='uploaded'"),'intake:liveness-scope-anchor');
      sql=sql.replace("where ((ch.state='uploaded'",`where ch.challenge_id='${c.challenge}'::uuid and ((ch.state='uploaded'`);
    }
    return query(sql,params);
  };
  const source=c=>({source_id:c.source,replica_id:c.rid,owner_user_id:owner,kind:'video',capture_mode:'live_challenge',state:'quarantined',
    storage_bucket:'vyakti-replica-private',object_path:`${owner}/${c.rid}/${c.source}/original`,mime:'video/webm',sha256:sha,byte_size:bytes.length});
  const adapters=createNativeMediaAdapters({resolveInput:async()=>({body:bytes,mime:'video/webm'}),
    scanBytes:async()=>({safe:true}),probeBytes:async()=>{throw Error('intake:no-decoder');},clamavVersion:'clamav-synthetic-sql'});
  const output=async(c,step)=>executeProcessingJob({source:source(c),job:{job_id:c[step],source_id:c.source,replica_id:c.rid,
    owner_user_id:owner,step,revision:1,state:'leased',attempt:1},completedSteps:step==='integrity'?[]:['integrity'],adapters});
  const lease=(c,step,query=db)=>leaseNextProcessingJob(scoped(query,c,step),{token});
  const commit=(c,step,result,query=db)=>commitProcessingOutput(query,{jobId:c[step],leaseToken:token,output:result});
  const current=c=>db('select state,sha256 from vy_replica_source where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[c.source,c.rid,owner]);
  const proof=c=>db(`select ${liveIntakeReceiptsSql()} as ready from vy_replica_source s where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid`,[c.source,c.rid,owner]);
  const verifier={name:'azure_face_speech_composite',version:'synthetic-sql-v1',verify(){throw Error('intake:no-provider');}};
  const liveLease=(c,query=db)=>leaseNextLivenessVerification(scoped(query,c),verifier);
  const setup=async c=>{
    await db("insert into vy_replica(replica_id,owner_user_id,display_name,lifecycle,subject_mode,policy_version,age_verified_at) values($1::uuid,$2::uuid,'Synthetic liveness intake fixture','draft','self',$3,now())",[c.rid,owner,REPLICA_POLICY_VERSION]);
    for(const scope of ['capture','storage'])await db("insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata) values($1::uuid,$2::uuid,$3::uuid,$4,'manual_review',$5,$6,'{\"synthetic_sql_fixture\":true}'::jsonb)",[c[scope],c.rid,owner,scope,REPLICA_POLICY_VERSION,sha]);
    for(const isDoc of [false,true]){
      const sid=isDoc?c.doc:c.source;
      await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,storage_bucket,object_path,mime,byte_size,sha256,state,contains_third_parties) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'vyakti-replica-private',$7,$8,$9::bigint,$10,'quarantined',false)",[sid,c.rid,owner,c.capture,isDoc?'image':'video',isDoc?'identity_document':'live_challenge',`${owner}/${c.rid}/${sid}/original`,isDoc?'image/png':'video/webm',bytes.length,sha]);
    }
    await db("insert into vy_replica_identity_case(identity_case_id,replica_id,owner_user_id,source_id,policy_version,consent_receipt_hash,source_sha256,consented_at,state,adult_evidence,document_authentic,document_current,face_reference_ready,credential_expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$6,now(),'evidence_ready',true,true,true,true,now()+interval '1 day')",[c.identity,c.rid,owner,c.doc,REPLICA_POLICY_VERSION,sha]);
    await db("insert into vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id,phrase,phrase_hash,policy_version,state,source_id,expires_at,identity_case_id,face_session_state,face_session_provider_deleted_at,face_session_reference_sha256,face_session_model_version,face_session_result) values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'uploaded',$7::uuid,now()+interval '10 minutes',$8::uuid,'passed_deleted',now(),$9,'synthetic-face-v1',$10::jsonb)",[c.challenge,c.rid,owner,phrase,phraseHash,REPLICA_POLICY_VERSION,c.source,c.identity,sha,JSON.stringify({passed:true,liveness_passed:true,identity_match:true,identity_score:1,provider_digest:sha})]);
    await db("insert into vy_replica_biometric_verification_grant(grant_id,challenge_id,replica_id,owner_user_id,statement_set,receipt_hash,receipt_payload,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'synthetic-intake-only',$5,'{\"synthetic_sql_fixture\":true}'::jsonb,now()+interval '30 minutes')",[c.grant,c.challenge,c.rid,owner,sha]);
    for(const step of ['integrity','malware_scan'])await db("insert into vy_replica_processing_job(job_id,replica_id,owner_user_id,source_id,step,state) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'queued')",[c[step],c.rid,owner,c.source,step]);
  };
  const finish=async(c,step)=>{assert(await lease(c,step),'intake:scoped-native-lease');const result=await output(c,step);assert.equal(result.outcome,'complete');await commit(c,step,result);};
  try{
    assert.equal(typeof onFixtureManifest,'function','intake:manifest-required');await onFixtureManifest(manifest);
    stage='database-identity';assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906','intake:exact-development-database');verifiedTarget=true;
    const oldSql=(await readFile(new URL('./liveness-intake-original-commit.sql',import.meta.url),'utf8')).trim();
    stage='setup';writesStarted=true;for(const c of cases)await setup(c);
    const c=cases[0];
    // Reuse the untouched queued fixture in rollback transactions. Removing
    // only the new predicate must admit it, proving each refusal is load-bearing.
    for(const field of ['expired-challenge','equal-stale-policy']){
      stage=field;let session;
      try{
        session=await openSession();await session.query('BEGIN');
        if(field==='expired-challenge')await session.query("update vy_replica_liveness_challenge set expires_at=now()-interval '1 second' where challenge_id=$1::uuid",[c.challenge]);
        else{
          await session.query("update vy_replica set policy_version='synthetic-stale-policy' where replica_id=$1::uuid",[c.rid]);
          await session.query("update vy_replica_liveness_challenge set policy_version='synthetic-stale-policy' where challenge_id=$1::uuid",[c.challenge]);
          await session.query("update vy_replica_consent set policy_version='synthetic-stale-policy' where replica_id=$1::uuid",[c.rid]);
        }
        assert.equal(await lease(c,'integrity',session.query.bind(session)),null,'intake:expired-or-stale-authority-refused');
        const needle=field==='expired-challenge'?'and intake_ch.expires_at>now()':`and intake_r.policy_version='${REPLICA_POLICY_VERSION.replaceAll("'", "''")}'`;
        const mutant=async(sql,params)=>{assert(sql.includes(needle),'intake:authority-mutant-anchor');return session.query(sql.replace(needle,''),params);};
        assert(await lease(c,'integrity',mutant),'intake:removed-authority-guard-admits-fixture');
        checks.push(stage);
      }finally{if(session){await session.query('ROLLBACK');await session.close();}}
    }
    stage='missing-receipts';assert.equal((await proof(c))[0].ready,false);assert.equal(await liveLease(c),null);checks.push(stage);
    stage='integrity-quarantine';await finish(c,'integrity');assert.equal((await current(c))[0].state,'quarantined');assert.equal(await liveLease(c),null);checks.push(stage);
    stage='scan-before-lease';await finish(c,'malware_scan');assert.equal((await current(c))[0].state,'quarantined');assert.equal((await proof(c))[0].ready,true);
    assert.equal((await db("select job_id from vy_replica_processing_job where source_id=$1::uuid and step not in ('integrity','malware_scan')",[c.source])).length,0);
    const claimed=await liveLease(c);assert(claimed,'intake:real-lease-after-both-receipts');checks.push(stage);
    stage='settlement-rechecks-scan';await db("update vy_replica_processing_job set result=jsonb_set(result,'{verified_input_sha256}',to_jsonb($2::text)) where job_id=$1::uuid",[c.malware_scan,'b'.repeat(64)]);
    const rejected=createLivenessVerdict(claimed,claimed.source,{inputSha256:sha,recognizedText:'wrong 999999',speakerContinuityScore:0,syntheticRiskScore:1});assert.equal(rejected.passed,false);
    await assert.rejects(()=>completeLivenessVerification(db,claimed,rejected),e=>e.code==='liveness_verification_settlement_failed');checks.push(stage);
    stage='receipt-negative-controls';
    const receiptCase=cases[1];await finish(receiptCase,'integrity');await finish(receiptCase,'malware_scan');
    for(const field of ['attempt','adapter','manifest','revision','purpose','source_hash']){
      let session;try{session=await openSession();await session.query('BEGIN');
        if(field==='attempt')await session.query("update vy_replica_processing_attempt set outcome='retry' where job_id=$1::uuid",[receiptCase.malware_scan]);
        if(field==='adapter')await session.query("update vy_replica_processing_attempt set adapter_name='fake-scanner' where job_id=$1::uuid",[receiptCase.malware_scan]);
        if(field==='manifest')await session.query("update vy_replica_processing_attempt set result_manifest_hash=$2 where job_id=$1::uuid",[receiptCase.malware_scan,'c'.repeat(64)]);
        if(field==='revision')await session.query("update vy_replica_processing_job set revision=2 where job_id=$1::uuid",[receiptCase.malware_scan]);
        if(field==='purpose')await session.query("update vy_replica_processing_job set result=result-'purpose' where job_id=$1::uuid",[receiptCase.malware_scan]);
        if(field==='source_hash')await session.query("update vy_replica_source set sha256=$2 where source_id=$1::uuid",[receiptCase.source,'d'.repeat(64)]);
        assert.equal(await liveLease(receiptCase,session.query.bind(session)),null,'intake:mutant-proof-refused');
      }finally{if(session){await session.query('ROLLBACK');await session.close();}}}
    checks.push(stage);
    stage='old-dag-negative-control';const old=cases[2];assert(await lease(old,'integrity'));const oldOutput=await output(old,'integrity');
    let commitSql,commitParams;await assert.rejects(()=>commit(old,'integrity',oldOutput,async(sql,params)=>{commitSql=sql;commitParams=params;return [];}));
    await db('EXPLAIN '+commitSql,commitParams);await db('EXPLAIN '+oldSql,commitParams);
    assert((await db(oldSql,commitParams)).length);assert.equal((await current(old))[0].state,'processing');assert.equal(await liveLease(old),null);checks.push(stage);
    stage='stale-forbidden-job';const forbidden=cases[3];
    await db("insert into vy_replica_processing_job(job_id,replica_id,owner_user_id,source_id,step,state) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'media_probe','queued')",[forbidden.forbidden,forbidden.rid,owner,forbidden.source]);
    assert.equal(await lease(forbidden,'media_probe'),null);
    await db("update vy_replica_processing_job set state='leased',attempt=1,lease_token_hash=$2,lease_expires_at=now()+interval '5 minutes' where job_id=$1::uuid",[forbidden.forbidden,leaseTokenHash(token)]);
    const forbiddenOutput={...oldOutput,adapter:{family:'media-probe',name:'ffprobe-sandbox',version:'v1'},result:{...oldOutput.result,step:'media_probe',purpose:undefined,next_steps:['diarize']}};
    await assert.rejects(()=>commitProcessingOutput(db,{jobId:forbidden.forbidden,leaseToken:token,output:forbiddenOutput}),e=>e.code==='lost_processing_lease');
    assert.equal((await current(forbidden))[0].state,'quarantined');checks.push(stage);
    for(const mutant of [false,true]){
      stage=mutant?'old-source-race-negative-control':'source-deletion-overlap';const race=cases[mutant?5:4];assert(await lease(race,'integrity'));const result=await output(race,'integrity');
      let holder,writer,pending;
      try{
        holder=await openSession();writer=await openSession();await holder.query('BEGIN');await writer.query('BEGIN');
        const hp=(await holder.query('select pg_backend_pid() as pid'))[0].pid,wp=(await writer.query('select pg_backend_pid() as pid'))[0].pid;
        await holder.query("update vy_replica_source set state='deleting' where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[race.source,race.rid,owner]);
        const query=mutant?async(sql,params)=>writer.query(sql.includes('with eligible_job as materialized')?oldSql:sql,params):writer.query.bind(writer);
        pending=commit(race,'integrity',result,query).then(value=>({value}),error=>({error}));
        let witnessed=false;const deadline=Date.now()+9000;
        while(Date.now()<deadline){if((await db('select $2::integer=any(pg_blocking_pids($1::integer)) as blocked',[wp,hp]))[0]?.blocked){witnessed=true;break;}}
        assert(witnessed,'intake:source-writer-blocking-witness');await holder.query('COMMIT');const completed=await pending;
        if(mutant)assert(completed.value,'intake:old-query-commits-stale-job');else assert.equal(completed.error?.code,'lost_processing_lease','intake:new-query-refuses-stale-job');
        await writer.query('COMMIT');assert.equal((await current(race))[0].state,'deleting');checks.push(stage);
      }finally{if(holder)await holder.query('ROLLBACK').catch(()=>{});if(pending)await pending;if(writer)await writer.query('ROLLBACK').catch(()=>{});if(holder)await holder.close();if(writer)await writer.close();}
    }
    stage='uncommitted-scan-not-leaseable';const overlap=cases[6];await finish(overlap,'integrity');assert(await lease(overlap,'malware_scan'));
    let scan;try{scan=await openSession();await scan.query('BEGIN');await commit(overlap,'malware_scan',await output(overlap,'malware_scan'),scan.query.bind(scan));
      const scanPid=(await scan.query('select pg_backend_pid() as pid'))[0].pid;
      assert((await db("select exists(select 1 from pg_locks where pid=$1::integer and locktype='transactionid' and mode='ExclusiveLock' and granted) as held",[scanPid]))[0].held,'intake:uncommitted-scan-write-witness');
      assert.equal(await liveLease(overlap),null);await scan.query('COMMIT');assert(await liveLease(overlap));checks.push(stage);
    }finally{if(scan){await scan.query('ROLLBACK').catch(()=>{});await scan.close();}}
    stage='no-identity-mutation';assert.equal((await db('select replica_id from vy_replica where replica_id=any($1::uuid[]) and (identity_verified_at is not null or liveness_verified_at is not null)',[manifest.replicaIds])).length,0);
    assert.equal((await db("select consent_id from vy_replica_consent where replica_id=any($1::uuid[]) and scope not in ('capture','storage')",[manifest.replicaIds])).length,0);checks.push(stage);
  }catch(error){failure=error;Object.assign(error,{failedStage:stage,primaryFailure:safeError(error,stage)});}
  finally{
    if(verifiedTarget&&writesStarted){
      const tables=[['vy_replica_processing_attempt','job_id',manifest.processingJobIds],['vy_replica_liveness_verification_attempt','challenge_id',manifest.challengeIds],
        ['vy_replica_identity_verification_attempt','identity_case_id',manifest.identityCaseIds],['vy_replica_processing_evidence','replica_id',manifest.replicaIds],
        ['vy_replica_processing_artifact','replica_id',manifest.replicaIds],['vy_replica_processing_job','replica_id',manifest.replicaIds],
        ['vy_replica_source_storage_writer','replica_id',manifest.replicaIds],['vy_replica_biometric_verification_grant','replica_id',manifest.replicaIds],
        ['vy_replica_liveness_challenge','replica_id',manifest.replicaIds],['vy_replica_identity_case','replica_id',manifest.replicaIds],
        ['vy_replica_audit','replica_id',manifest.replicaIds],['vy_replica_source','replica_id',manifest.replicaIds],
        ['vy_replica_consent','replica_id',manifest.replicaIds],['vy_replica','replica_id',manifest.replicaIds]];
      for(const [table,key,ids] of tables){try{await db(`delete from ${table} where ${key}=any($1::uuid[])`,[ids]);}catch(error){cleanupFailure ||=safeError(error,'cleanup:'+table);}}
      remainingFixtureRows={};for(const [table,key,ids] of tables){try{remainingFixtureRows[table]=Number((await db(`select count(*)::integer n from ${table} where ${key}=any($1::uuid[])`,[ids]))[0].n);}catch(error){cleanupFailure ||=safeError(error,'recount:'+table);remainingFixtureRows[table]=null;}}
      if(Object.values(remainingFixtureRows).some(n=>n!==0))cleanupFailure ||={stage:'cleanup-count',code:'NONZERO_OR_UNKNOWN'};
    }
    if(cleanupFailure&&!failure)failure=Object.assign(Error('intake:cleanup-failed'),{code:'CLEANUP_FAILED',failedStage:stage});
    if(failure)Object.assign(failure,{cleanupFailure,remainingFixtureRows,intakeFixtureCleanupVerified:verifiedTarget&&writesStarted&&!cleanupFailure,
      failedStage:failure.failedStage||stage});
  }
  if(failure)throw failure;
  return {groups:checks.length,checks,remainingFixtureRows,intakeFixtureCleanupVerified:true,syntheticPrerequisites:true,scannerExecution:false,identityGranted:false};
}
