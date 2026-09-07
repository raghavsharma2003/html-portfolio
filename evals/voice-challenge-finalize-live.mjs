// Opt-in development SQL only. Synthetic upload manifests, no objects,
// provider calls, identity evidence, identity grants, or runtime activation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {finalizeVoiceChallengeSource as finalize,VOICE_CHALLENGE_FINALIZE_SQL as SQL,
  cancelOwnedVoiceChallenge as cancel,voiceChallengeSentenceHash} from '../api/_replica-voice-identity.js';
import {markOwnedSourceDeleting as remove} from '../api/_replica-source.js';
import {revokeOwnedConsent as revoke} from '../api/_replica-consent.js';
import {REPLICA_POLICY_VERSION as POLICY} from '../api/_replica.js';

export async function runVoiceChallengeFinalizeSqlChecks({db,openSession,onFixtureManifest}) {
  const owner=randomUUID(),foreignOwner=randomUUID(),replacementConsent=randomUUID();
  const cases=Array.from({length:19},()=>({rid:randomUUID(),cid:randomUUID(),cap:randomUUID(),tr:randomUUID(),
    captureConsent:randomUUID(),storageConsent:randomUUID()}));
  const manifest={ownerUserIds:[owner,foreignOwner],replicaIds:cases.map(c=>c.rid),challengeIds:cases.map(c=>c.cid),
    sourceIds:cases.flatMap(c=>[c.cap,c.tr]),consentIds:[...cases.flatMap(c=>[c.captureConsent,c.storageConsent]),replacementConsent]};
  const sessions=new Set(),checks=[];let stage='fixture-manifest',failure=null,cleanupFailure=null,targetVerified=false,writesStarted=false,remainingFixtureRows=null;
  const diagnostic=error=>({code:typeof error?.code==='string'&&/^[A-Za-z0-9_]{2,70}$/.test(error.code)?error.code:'UNCLASSIFIED',
    stage,frames:String(error?.stack||'').split('\n').map(s=>s.match(/voice-challenge-finalize-live\.mjs:\d+:\d+/)?.[0]).filter(Boolean)});
  const info=sid=>({byteSize:100,mime:sid===undefined?'video/webm':sid,expectedByteSize:100,expectedMime:sid===undefined?'video/webm':sid,objectId:'synthetic-no-object'});
  const run=(q,c,sid)=>finalize(q,owner,c.rid,c.cid,sid,info(sid===c.cap?'video/webm':'audio/wav'));
  const rows=c=>db('select source_id,state from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid order by source_id',[c.rid,owner]);
  const challenge=c=>db('select state,decision,failure_code from vy_replica_voice_challenge where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[c.cid,c.rid,owner]);
  const expectedPending=async c=>{assert((await rows(c)).every(s=>s.state==='pending_upload'));assert.equal((await challenge(c))[0].state,'issued');};
  const setup=async c=>{
    writesStarted=true;
    await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic finalize SQL fixture',$3)",[c.rid,owner,POLICY]);
    for(const [id,scope] of [[c.captureConsent,'capture'],[c.storageConsent,'storage']])await db(
      "insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash) values($1::uuid,$2::uuid,$3::uuid,$4,'account_attestation',$5,$6)",[id,c.rid,owner,scope,POLICY,'a'.repeat(64)]);
    for(const [id,kind,mime] of [[c.cap,'video','video/webm'],[c.tr,'audio','audio/wav']])await db(
      "insert into vy_replica_source(source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,storage_bucket,object_path,mime,byte_size,sha256) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'identity_challenge','fixture-no-object',$6,$7,100,$8)",
      [id,c.rid,owner,c.captureConsent,kind,`${owner}/${c.rid}/${id}/original`,mime,'b'.repeat(64)]);
    const sentence='Synthetic upload lifecycle. Code 0 1 2 3 4 5.';
    await db("insert into vy_replica_voice_challenge(challenge_id,replica_id,owner_user_id,sentence,sentence_hash,nonce,policy_version,challenge_policy,captured_source_id,transcript_source_id,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,$5,'0 1 2 3 4 5',$6,'voice-identity-challenge/v1',$7::uuid,$8::uuid,now()+interval '10 minutes')",[c.cid,c.rid,owner,sentence,voiceChallengeSentenceHash(sentence),POLICY,c.cap,c.tr]);
  };
  // NOWAIT cannot appear in pg_blocking_pids. A held transaction lock plus
  // actual 55P03 from the competing function is the overlap witness here.
  const overlap=async(c,first,after)=>{
    const session=await openSession();sessions.add(session);
    let primary=null;
    try{
      await session.query('BEGIN');
      const pid=(await session.query('select pg_backend_pid() as pid'))[0].pid;
      await first(session.query);
      const held=(await db("select exists(select 1 from pg_locks where pid=$1::int4 and locktype='transactionid' and mode='ExclusiveLock' and granted) as held",[pid]))[0]?.held;
      assert.equal(held,true,'competing-transaction-holds-write-lock');
      await assert.rejects(()=>run(db,c,c.tr),e=>e.code==='voice_challenge_finalize_busy'&&e.cause?.code==='55P03');
      // A failed contender must leave the transaction's preexisting source
      // states unchanged from the observer's committed snapshot.
      await expectedPending(c);
      await session.query('COMMIT');
      await after();
    }catch(error){primary=error;throw error;}
    finally{
      const cleanup=[];
      try{await session.query('ROLLBACK');}catch(error){cleanup.push(error);}
      try{await session.close();sessions.delete(session);}catch(error){cleanup.push(error);}
      if(cleanup.length){
        const error=Object.assign(new Error('overlap-session-cleanup-failed'),{code:'OVERLAP_CLEANUP_FAILED'});
        if(primary)primary.overlapCleanupFailure=diagnostic(error);else throw error;
      }
    }
  };
  try{
    assert.equal(typeof onFixtureManifest,'function','durable-manifest-required');await onFixtureManifest(manifest);
    stage='load-original-negative-control';const OLD=readFileSync(new URL('./voice-challenge-finalize-original.sql',import.meta.url),'utf8').trimEnd();
    stage='verify-database';assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906');targetVerified=true;
    stage='explain-and-empty-execute';
    await run(async(sql,params)=>{await db('EXPLAIN '+sql,params);return db(sql,params);},cases[0],cases[0].cap);
    checks.push(stage);
    for(let i=0;i<cases.length;i++){stage='setup-'+i;await setup(cases[i]);}
    for(const [index,reverse] of [[0,false],[1,true]]){
      stage=reverse?'transcript-first':'capture-first';const c=cases[index];
      const order=reverse?[c.tr,c.cap]:[c.cap,c.tr];
      assert.equal((await run(db,c,order[0])).challenge.state,'issued');
      assert.equal((await run(db,c,order[1])).challenge.state,'captured');
      assert((await rows(c)).every(s=>s.state==='quarantined'));checks.push(stage);
    }
    stage='original-query-negative-control';
    const old=cases[2];for(const sid of [old.cap,old.tr])await run((sql,params)=>db(OLD,params.slice(0,8)),old,sid);
    assert((await rows(old)).every(s=>s.state==='quarantined'));assert.equal((await challenge(old))[0].state,'issued');checks.push(stage);
    stage='metadata-rejection';const rejected=cases[3];
    const bad=await finalize(db,owner,rejected.rid,rejected.cid,rejected.cap,{...info(),byteSize:99});
    assert.equal(bad.source.state,'rejected');assert.equal(bad.challenge.state,'failed');assert.equal(bad.challenge.decision,'reject');checks.push(stage);
    const negatives=[
      ['wrong-owner',4,async()=>{},c=>finalize(db,foreignOwner,c.rid,c.cid,c.cap,info())],
      ['revoked-replica',5,c=>db("update vy_replica set lifecycle='revoked' where replica_id=$1::uuid",[c.rid])],
      ['revoked-consent',6,c=>db('update vy_replica_consent set revoked_at=now() where consent_id=$1::uuid',[c.captureConsent])],
      ['expired-challenge',7,c=>db("update vy_replica_voice_challenge set expires_at=now()-interval '1 second' where challenge_id=$1::uuid",[c.cid])],
      ['removed-companion',8,c=>db('delete from vy_replica_source where source_id=$1::uuid',[c.tr])],
      ['wrong-policy',9,c=>db("update vy_replica set policy_version='synthetic-old' where replica_id=$1::uuid",[c.rid])],
      ['changed-metadata',10,c=>db('update vy_replica_source set byte_size=101 where source_id=$1::uuid',[c.cap])],
    ];
    for(const [name,index,change,operation] of negatives){stage=name;const c=cases[index];await change(c);const before=await rows(c);assert.equal(await (operation?operation(c):run(db,c,c.cap)),null);assert.deepEqual(await rows(c),before);assert.equal((await challenge(c))[0].state,'issued');checks.push(name);}
    stage='overlap-other-upload-retry';const concurrent=cases[11];
    await overlap(concurrent,q=>run(q,concurrent,concurrent.cap),async()=>{assert.equal((await run(db,concurrent,concurrent.tr)).challenge.state,'captured');});checks.push(stage);
    stage='overlap-cancel-refuses-retry';const cancelled=cases[12];
    await overlap(cancelled,q=>cancel(q,owner,cancelled.rid,cancelled.cid),async()=>{assert.equal(await run(db,cancelled,cancelled.tr),null);assert.equal((await challenge(cancelled))[0].state,'expired');});checks.push(stage);
    stage='overlap-source-removal-refuses-retry';const removed=cases[13];
    await overlap(removed,q=>remove(q,owner,removed.rid,removed.cap),async()=>{assert.equal(await run(db,removed,removed.tr),null);assert.equal((await challenge(removed))[0].state,'expired');});checks.push(stage);
    stage='overlap-consent-revocation-refuses-retry';const revoked=cases[14];
    await overlap(revoked,q=>revoke(q,owner,revoked.rid,['capture']),async()=>{assert.equal(await run(db,revoked,revoked.tr),null);assert((await rows(revoked)).every(s=>s.state==='deleting'));});checks.push(stage);
    stage='overlap-attachment-change-refuses-retry';const changed=cases[15];
    await overlap(changed,q=>q('update vy_replica_voice_challenge set transcript_source_id=null where challenge_id=$1::uuid',[changed.cid]),async()=>{assert.equal(await run(db,changed,changed.tr),null);await expectedPending(changed);});checks.push(stage);
    stage='expired-storage-consent';const expired=cases[16];
    await db("update vy_replica_consent set expires_at=now()-interval '1 second' where consent_id=$1::uuid",[expired.storageConsent]);
    assert.equal(await run(db,expired,expired.cap),null);await expectedPending(expired);checks.push(stage);
    stage='ordinary-caller-attaches-second-source-after-first-finalize';const sequential=cases[17];
    await db('update vy_replica_voice_challenge set transcript_source_id=null where challenge_id=$1::uuid',[sequential.cid]);
    assert.equal((await run(db,sequential,sequential.cap)).challenge.state,'issued');
    await db('update vy_replica_voice_challenge set transcript_source_id=$2::uuid where challenge_id=$1::uuid',[sequential.cid,sequential.tr]);
    assert.equal((await run(db,sequential,sequential.tr)).challenge.state,'captured');checks.push(stage);
    stage='replacement-capture-consent-cannot-authorize-old-source';const staleConsent=cases[18];
    await db('update vy_replica_consent set revoked_at=now() where consent_id=$1::uuid',[staleConsent.captureConsent]);
    await db("insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash) values($1::uuid,$2::uuid,$3::uuid,'capture','account_attestation',$4,$5)",[replacementConsent,staleConsent.rid,owner,POLICY,'c'.repeat(64)]);
    assert.equal(await run(db,staleConsent,staleConsent.cap),null);await expectedPending(staleConsent);checks.push(stage);
    stage='no-identity-mutations';
    const identity=await db('select count(*) as n from vy_replica where replica_id=any($1::uuid[]) and (age_verified_at is not null or identity_verified_at is not null or liveness_verified_at is not null or identity_expires_at is not null)',[manifest.replicaIds]);assert.equal(Number(identity[0].n),0);checks.push(stage);
  }catch(error){failure=error;error.primaryFailure=diagnostic(error);}
  finally{
    const failures=await Promise.allSettled([...sessions].map(async s=>{await s.query('ROLLBACK');await s.close();}));
    try{
      const cleanupErrors=failures.filter(r=>r.status==='rejected').map(()=> 'SESSION_CLEANUP_FAILED');
      if(targetVerified){
        // Explicit table deletion is required: challenge tables have no FK.
        for(const table of ['vy_replica_voice_challenge_attempt','vy_replica_voice_challenge','vy_replica_audit','vy_replica_source','vy_replica_consent','vy_replica']){
          try{await db(`delete from ${table} where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid`,[manifest.replicaIds,owner]);}
          catch{cleanupErrors.push('DELETE_'+table);}
        }
        const tables=['vy_replica','vy_replica_source','vy_replica_consent','vy_replica_voice_challenge','vy_replica_voice_challenge_attempt','vy_replica_audit'];
        let remaining=0;for(const table of tables){
          try{remaining+=Number((await db(`select count(*) as n from ${table} where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid`,[manifest.replicaIds,owner]))[0].n);}
          catch{cleanupErrors.push('COUNT_'+table);}
        }
        remainingFixtureRows=cleanupErrors.length?null:remaining;
        if(cleanupErrors.length)throw Object.assign(new Error('fixture-cleanup-incomplete'),{code:'FIXTURE_CLEANUP_INCOMPLETE',cleanupStages:cleanupErrors});
        assert.equal(remainingFixtureRows,0,'exact-synthetic-table-cleanup');
      }
      else if(cleanupErrors.length)throw Object.assign(new Error('session-cleanup-failed'),{code:'SESSION_CLEANUP_FAILED'});
    }catch(error){cleanupFailure=diagnostic(error);if(!failure)failure=error;}
  }
  if(failure){Object.assign(failure,{failedStage:stage,targetVerified,fixtureWritesStarted:writesStarted,remainingFixtureRows,
    voiceFinalizeFixtureCleanupVerified:remainingFixtureRows===0&&!cleanupFailure,cleanupFailure});throw failure;}
  return{passed:checks.length,checks,remainingFixtureRows,voiceFinalizeFixtureCleanupVerified:true,
    limitation:'Synthetic SQL upload lifecycle and NOWAIT overlap only; no storage upload, provider, identity grant or measured identity acceptance.'};
}
