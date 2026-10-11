// Import-only proof. Root supplies two dedicated PostgreSQL sessions and an
// exact dev DB. No config, provider, storage, model, auth or grant API calls.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {capturePrimarySelectionSql,LEASE_TOKEN} from './capture.mjs';
import {setOwnedPrimaryVoiceSource,markOwnedSourceDeleting} from '../../api/_replica-source.js';
import {requestOwnedVoiceGenomeBuild,advanceOwnedVoiceBuildIntent} from '../../api/_replica-build-intent.js';
import {completeSourceErasure,sourceErasureLeaseTokenHash} from '../../api/_replica-source-erasure.js';

const DATABASE='vyakti_expert_integration_20260906';
const sha=x=>createHash('sha256').update(x).digest('hex');
const busy=e=>e.code==='primary_voice_selection_busy'&&e.status===409&&e.retryable===true;
export async function runPrimarySelectionSqlProof({db,connect,recordFixtureIds,optIn}={}) {
  assert.equal(optIn,true);assert.equal(typeof db,'function');assert.equal(typeof connect,'function');
  assert.equal(typeof recordFixtureIds,'function');
  assert.equal((await db('select current_database() name'))[0]?.name,DATABASE);
  const sql=await capturePrimarySelectionSql();
  const old=JSON.parse(await readFile(new URL('./fixtures/old-promotion.json',import.meta.url),'utf8'));
  assert.equal(sha(old.sql),old.sha256);
  const owner=randomUUID(),foreign=randomUUID();
  const names=['unchanged','manual','same-source','absent','absent-aba','withdraw','direct-complete',
    'old-overwrite','overlap-old','overlap-new','legacy','replay','identity','liveness','both','lock-matrix'];
  const cases=names.map(name=>({name,replica:randomUUID(),a:randomUUID(),b:randomUUID(),c:randomUUID(),
    intent:randomUUID(),intent2:randomUUID(),build:randomUUID(),identity:randomUUID(),challenge:randomUUID()}));
  const manifest={schema:'primary-selection-cas-proof/v1',database:DATABASE,owner,foreign,cases,
    old_sha256:old.sha256,query_sha256:Object.fromEntries(Object.entries(sql).map(([k,v])=>[k,sha(v.sql)])),
    declaration:'Fixture-only persisted draft/build/identity states, no genuine consent or identity grant; no actual media or provider work. Dedicated sessions required.'};
  await recordFixtureIds(manifest);
  const checks=[],diagnostics=[],cleanup={errors:[],remaining:null};let stage='schema',failure=null;
  const sessions=[];
  const read=async c=>(await db(`select r.primary_selection_id,r.age_verified_at,r.identity_verified_at,
    r.liveness_verified_at,r.identity_expires_at,r.lifecycle,vr.source_id,vr.selected_at
    from vy_replica r left join vy_replica_voice_reference vr on vr.replica_id=r.replica_id
    and vr.owner_user_id=r.owner_user_id where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid`,[c.replica,owner]))[0];
  const args=c=>({replica_id:c.replica,build_intent_id:c.intent,candidate_source_id:c.b});
  const lease=(c,source=c.a)=>({source:{sourceId:source,replicaId:c.replica,ownerUserId:owner},leaseToken:LEASE_TOKEN});
  const set=(c,s=c.a,q=db)=>setOwnedPrimaryVoiceSource(q,owner,c.replica,s);
  const request=async(c,q=db)=>requestOwnedVoiceGenomeBuild(q,owner,args(c),{queue:async()=>{
    throw Object.assign(Error('voice_genome_not_ready'),{details:{blockers:['synthetic_fixture_only']}});
  }});
  const prepare=async c=>{
    await request(c);
    await db("update vy_replica_voice_build_intent set state='queued',build_id=$3::uuid where intent_id=$1::uuid and owner_user_id=$2::uuid",[c.intent,owner,c.build]);
  };
  const promote=(c,q=db)=>advanceOwnedVoiceBuildIntent(q,owner,args(c));
  const deleting=async c=>db("update vy_replica_source set state='deleting',erasure_lease_token_hash=$4,erasure_lease_expires_at=now()+interval '10 minutes' where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid",[c.a,c.replica,owner,sourceErasureLeaseTokenHash(LEASE_TOKEN)]);
  const session=async()=>{const s=await connect();sessions.push(s);
    assert.equal((await s.db('select current_database() name'))[0]?.name,DATABASE);
    s.pid=Number((await s.db('select pg_backend_pid() pid'))[0].pid);
    await s.db("set statement_timeout='8s'");await s.db("set lock_timeout='5s'");return s;};
  const check=label=>checks.push(label);
  try {
    const columns=await db("select table_name,column_name,is_nullable,column_default from information_schema.columns where table_schema='public' and ((table_name='vy_replica' and column_name='primary_selection_id') or (table_name='vy_replica_voice_build_intent' and column_name='expected_primary_selection_id'))");
    assert.equal(columns.length,2);assert.equal(columns.find(x=>x.table_name==='vy_replica').is_nullable,'NO');
    assert.equal(columns.find(x=>x.table_name==='vy_replica_voice_build_intent').column_default,null);
    check('migration140-present-legacy-intent-default-null');
    for(const {sql:s,params} of Object.values(sql))await db('EXPLAIN (FORMAT JSON) '+s,params);
    await db('EXPLAIN (FORMAT JSON) '+old.sql,sql.promote.params);check('five-exact-caller-queries-plus-base-promotion-explain');
    stage='fixtures';
    for(const c of cases) {
      await db("insert into vy_replica(replica_id,owner_user_id,display_name,policy_version) values($1::uuid,$2::uuid,'Synthetic primary CAS','primary-cas-fixture/v1')",[c.replica,owner]);
      for(const id of [c.a,c.b,c.c])await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256,state,contains_third_parties,upload_authorization_expires_at) values($1::uuid,$2::uuid,$3::uuid,'audio','upload','vyakti-replica-private',$4,'audio/wav',$5,'ready',false,now()-interval '1 day')",[id,c.replica,owner,`${owner}/${c.replica}/${id}/original`,sha(id)]);
      await db("insert into vy_replica_voice_genome(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,$3::jsonb,'draft')",[c.replica,sha(c.b),JSON.stringify({references:{source_ids:[c.b]}})]);
      await db("insert into vy_replica_model_build(build_id,replica_id,owner_user_id,build_kind,target_version,builder_version,source_set_hash,state) values($1::uuid,$2::uuid,$3::uuid,'voice_genome',1,'synthetic-fixture/v1',$4,'review')",[c.build,c.replica,owner,sha(c.b)]);
    }
    check('all-fixture-ids-recorded-before-writes');
    for(const c of cases.slice(0,8)) {
      stage=c.name;
      if(!c.name.startsWith('absent'))await set(c);
      const initial=await read(c);await prepare(c);
      if(c.name==='manual'||c.name==='old-overwrite')await set(c,c.c);
      if(c.name==='same-source') {await set(c,c.a);await db('update vy_replica_voice_reference set selected_at=$2::timestamptz where replica_id=$1::uuid',[c.replica,initial.selected_at]);}
      if(c.name==='absent-aba'){await set(c,c.c);await markOwnedSourceDeleting(db,owner,c.replica,c.c);}
      if(c.name==='withdraw')await markOwnedSourceDeleting(db,owner,c.replica,c.a);
      if(c.name==='direct-complete'){await deleting(c);await completeSourceErasure(db,lease(c));}
      const before=await read(c);
      if(c.name==='old-overwrite') {
        await db(old.sql,[c.replica,owner,c.intent]);assert.equal((await read(c)).source_id,c.b);
        check('old-query-executes-and-overwrites-newer-manual-selection');continue;
      }
      const result=await promote(c),after=await read(c);
      if(['unchanged','absent'].includes(c.name)) {
        assert.equal(result.state,'review');assert.equal(after.source_id,c.b);assert.notEqual(after.primary_selection_id,before.primary_selection_id);
      }else {assert.equal(result.state,'failed');assert.equal(result.last_error_code,'primary_voice_selection_changed');
        assert.equal(after.source_id,before.source_id);assert.equal(after.primary_selection_id,before.primary_selection_id);}
      check(c.name+'-actual-caller-CAS');
    }
    const s1=await session(),s2=await session();
    for(const name of ['overlap-old','overlap-new']) {
      stage=name;const c=cases.find(c=>c.name===name);await set(c);await prepare(c);
      const diagnostic={stage:name,before_transaction_pids:{setter:s1.pid,promoter:s2.pid},
        observations:[],pending:{state:'not_started'}};
      diagnostics.push(diagnostic);
      diagnostic.target=(await db(`select i.state intent_state,i.promoted_at is null not_promoted,
        b.state build_state,g.status genome_state,s.state source_state,r.lifecycle,
        (g.definition#>'{references,source_ids}') ? i.candidate_source_id::text candidate_cited,
        i.expected_primary_selection_id=r.primary_selection_id expected_epoch_matches,
        exists(select 1 from vy_replica_voice_build_intent newer where newer.replica_id=i.replica_id
          and newer.owner_user_id=i.owner_user_id and newer.state in ('waiting','queued')
          and newer.intent_id<>i.intent_id and (newer.created_at,newer.intent_id)>(i.created_at,i.intent_id)) newer_intent
        from vy_replica_voice_build_intent i join vy_replica r on r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
        join vy_replica_source s on s.source_id=i.candidate_source_id and s.replica_id=i.replica_id and s.owner_user_id=i.owner_user_id
        join vy_replica_model_build b on b.build_id=i.build_id and b.replica_id=i.replica_id and b.owner_user_id=i.owner_user_id
        join vy_replica_voice_genome g on g.replica_id=b.replica_id and g.version=b.target_version and g.source_set_hash=b.source_set_hash
        where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid`,[c.intent,owner]))[0]||null;
      assert.equal(diagnostic.target?.intent_state,'queued');assert.equal(diagnostic.target?.candidate_cited,true);
      assert.equal(diagnostic.target?.expected_epoch_matches,true);assert.equal(diagnostic.target?.newer_intent,false);
      await s1.db('BEGIN');await s2.db('BEGIN');
      // A Client connected through transaction pooling has no stable backend
      // outside BEGIN. The prior harness observed unpinned pre-BEGIN PIDs.
      const setterPid=Number((await s1.db('select pg_backend_pid() pid'))[0].pid);
      const promoterPid=Number((await s2.db('select pg_backend_pid() pid'))[0].pid);
      diagnostic.in_transaction_pids={setter:setterPid,promoter:promoterPid};
      diagnostic.pid_drift=setterPid!==s1.pid||promoterPid!==s2.pid;
      assert.notEqual(setterPid,promoterPid);
      await set(c,c.c,s1.db);
      if(name==='overlap-old') {
        // Prove the old statement really overlaps the uncommitted setter;
        // release only once PostgreSQL reports this exact blocking backend.
        const started=Date.now();diagnostic.pending={state:'pending',elapsed_ms:0};
        const pending=s2.db(old.sql,[c.replica,owner,c.intent]).then(rows=>{
          diagnostic.pending={state:'resolved',row_count:rows.length,elapsed_ms:Date.now()-started};return{rows};
        },error=>{diagnostic.pending={state:'rejected',code:String(error.code||''),
          message:String(error.message||error).slice(0,240),elapsed_ms:Date.now()-started};return{error};});
        let blocked=false;
        // No sleep establishes success. Only exact PostgreSQL blocker and
        // backend-state evidence does. Stop on an actual pending outcome;
        // never hide a timeout behind dozens of later network observations.
        for(let n=0;n<6&&Date.now()-started<3500;n++) {
          if(diagnostic.pending.state!=='pending')break;
          const states=await db(`select pid,state,wait_event_type,wait_event,
            extract(epoch from (clock_timestamp()-xact_start))*1000 transaction_age_ms,
            extract(epoch from (clock_timestamp()-query_start))*1000 query_age_ms,
            pg_blocking_pids(pid) blocking_pids
            from pg_stat_activity where pid=any($1::int[]) order by pid`,[[setterPid,promoterPid]]);
          diagnostic.observations.push({elapsed_ms:Date.now()-started,states});
          const observed=states.find(row=>Number(row.pid)===promoterPid);
          if(observed?.blocking_pids?.map(Number).includes(setterPid)){blocked=true;break;}
        }
        diagnostic.blocked_witness=blocked;
        diagnostic.observation_elapsed_ms=Date.now()-started;
        assert.equal(blocked,true,'old query must observably block on pinned setter');
        await s1.db('COMMIT');const outcome=await pending;if(outcome.error)throw outcome.error;
        await s2.db('COMMIT');assert.equal((await read(c)).source_id,c.b);
        check('old-overlap-observed-block-then-stale-overwrite');
      }else {
        await assert.rejects(promote(c,s2.db),busy);await s2.db('ROLLBACK');await s1.db('COMMIT');
        assert.equal((await read(c)).source_id,c.c);const result=await promote(c);
        assert.equal(result.last_error_code,'primary_voice_selection_changed');assert.equal((await read(c)).source_id,c.c);
        check('new-overlap-NOWAIT-then-fresh-retry-preserves-manual');
      }
    }
    stage='legacy';const legacy=cases.find(c=>c.name===stage);await set(legacy);await prepare(legacy);
    await db('update vy_replica_voice_build_intent set expected_primary_selection_id=null where intent_id=$1::uuid',[legacy.intent]);
    const legacyResult=await promote(legacy);assert.equal(legacyResult.last_error_code,'primary_selection_snapshot_missing');assert.equal((await read(legacy)).source_id,legacy.a);check('legacy-intent-named-reissue-no-inference');
    stage='replay';const replay=cases.find(c=>c.name===stage);await set(replay);await request(replay);
    const expected=(await db('select expected_primary_selection_id from vy_replica_voice_build_intent where intent_id=$1::uuid',[replay.intent]))[0];
    await set(replay,replay.c);await request(replay);
    assert.deepEqual((await db('select expected_primary_selection_id from vy_replica_voice_build_intent where intent_id=$1::uuid',[replay.intent]))[0],expected);check('actual-request-replay-keeps-original-epoch');
    assert.equal(await setOwnedPrimaryVoiceSource(db,foreign,replay.replica,replay.a),null);
    assert.equal(await advanceOwnedVoiceBuildIntent(db,foreign,args(replay)),null);check('foreign-owner-cannot-select-or-promote');
    for(const name of ['identity','liveness','both']) {
      stage=name;const c=cases.find(c=>c.name===name);await set(c);
      await db("update vy_replica set age_verified_at=now(),identity_verified_at=now(),liveness_verified_at=now(),identity_expires_at=now()+interval '1 hour',lifecycle='ready' where replica_id=$1::uuid",[c.replica]);
      if(name!=='liveness')await db("insert into vy_replica_identity_case(identity_case_id,replica_id,owner_user_id,source_id,policy_version,consent_receipt_hash,source_sha256,consented_at,state) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'fixture-only',$5,$5,now(),'submitted')",[c.identity,c.replica,owner,c.a,sha(c.a)]);
      if(name!=='identity')await db("insert into vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id,source_id,phrase,phrase_hash,policy_version,state,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'synthetic fixture',$5,'fixture-only','issued',now()+interval '1 hour')",[c.challenge,c.replica,owner,c.a,sha(c.a)]);
      const before=await read(c);await markOwnedSourceDeleting(db,owner,c.replica,c.a);const after=await read(c);
      assert.equal(after.source_id,null);assert.notEqual(after.primary_selection_id,before.primary_selection_id);
      assert.equal(after.identity_verified_at,null);assert.equal(after.liveness_verified_at,null);assert.equal(after.identity_expires_at,null);
      assert.equal(after.lifecycle,'enrolling');if(name==='liveness')assert.notEqual(after.age_verified_at,null);else assert.equal(after.age_verified_at,null);
      check(name+'-withdrawal-preserves-exact-invalidation-and-epoch');
    }
    stage='lock-matrix';const c=cases.find(c=>c.name===stage);await set(c);await prepare(c);
    for(const operation of ['set','create','promote','withdraw','complete']) {
      await s1.db('BEGIN');await s1.db('select replica_id from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid for update',[c.replica,owner]);
      try {
        if(operation==='set')await assert.rejects(set(c,c.c,s2.db),busy);
        if(operation==='create')await assert.rejects(request({...c,intent:c.intent2},s2.db),busy);
        if(operation==='promote')await assert.rejects(promote(c,s2.db),busy);
        if(operation==='withdraw')await assert.rejects(markOwnedSourceDeleting(s2.db,owner,c.replica,c.c),busy);
        if(operation==='complete') {await deleting(c);await assert.rejects(completeSourceErasure(s2.db,lease(c)),busy);}
      } finally {await s1.db('ROLLBACK');}
      check(operation+'-owner-lock-overlap-named-refusal');
    }
    // Both counterpart locks are held. PostgreSQL's first failing relation
    // (retained only as a boolean assertion) witnesses actual source-first
    // execution, rather than assuming CTE text order is execution order.
    for(const operation of ['set','create','promote','withdraw','complete']) {
      await s1.db('BEGIN');
      await s1.db('select source_id from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid for update',[c.replica,owner]);
      await s1.db('select replica_id from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid for update',[c.replica,owner]);
      const sourceFirst=e=>busy(e)&&String(e.cause?.message||'').includes('vy_replica_source');
      try {
        if(operation==='set')await assert.rejects(set(c,c.c,s2.db),sourceFirst);
        if(operation==='create')await assert.rejects(request({...c,intent:c.intent2},s2.db),sourceFirst);
        if(operation==='promote')await assert.rejects(promote(c,s2.db),sourceFirst);
        if(operation==='withdraw')await assert.rejects(markOwnedSourceDeleting(s2.db,owner,c.replica,c.c),sourceFirst);
        if(operation==='complete')await assert.rejects(completeSourceErasure(s2.db,lease(c)),sourceFirst);
      }finally{await s1.db('ROLLBACK');}
      check(operation+'-actual-first-lock-refusal-is-source');
    }
  } catch(e) {failure={stage,code:String(e.code||''),message:String(e.message||e).slice(0,300)};}
  finally {
    for(const s of sessions){
      try{await s.db('ROLLBACK');}catch(e){cleanup.errors.push('session_rollback:'+String(e.code||e.message));}
      try{await s.close();}catch(e){cleanup.errors.push('session_close:'+String(e.code||e.message));}
    }
    const ids=cases.map(c=>c.replica);
    for(const [statement,p] of [
      ['delete from vy_replica_audit where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid',[ids,owner]],
      ['delete from vy_replica where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid',[ids,owner]],
      ['delete from vy_replica_source_erasure_attempt where source_id=any($1::uuid[])',[cases.flatMap(c=>[c.a,c.b,c.c])]],
    ])try{await db(statement,p);}catch(e){cleanup.errors.push(String(e.code||e.message));}
    try{cleanup.remaining=Number((await db(`select (
      (select count(*) from vy_replica where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_source where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_voice_reference where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_voice_build_intent where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_voice_genome where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_model_build where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_identity_case where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_liveness_challenge where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_audit where replica_id=any($1::uuid[]))+
      (select count(*) from vy_replica_source_erasure_attempt where source_id=any($2::uuid[])))::int n`,[ids,cases.flatMap(c=>[c.a,c.b,c.c])]))[0].n);}catch(e){cleanup.errors.push(String(e.code||e.message));}
  }
  return{schema:manifest.schema,at:new Date().toISOString(),pass:!failure&&cleanup.remaining===0&&!cleanup.errors.length,
    checks,failure,cleanup,diagnostics,manifest};
}
