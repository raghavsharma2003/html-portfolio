// Opt-in isolated-development SQL harness. Every prerequisite below is a
// SYNTHETIC fixture, not identity, consent, fidelity or enrollment evidence.
// No real auth user, provider call, storage object or public Room is created.
// Published-state rows are synthetic preservation controls, never API publications.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {activateOwnedRuntime,ownedRuntimeStatus,RUNTIME_STATUS_SQL,RUNTIME_POLICY_VERSION,RUNTIME_QUALIFICATION_SUITES} from '../api/_replica-runtime.js';
import {REPLICA_POLICY_VERSION} from '../api/_replica.js';
import {FIDELITY_POLICY_VERSION} from '../api/_fidelity.js';
import {PRIVATE_TEACHER_SHEET_ADOPTION_SQL as ADOPT,adoptActivatedPrivateTeacherSheet as adopt} from '../api/_teacher-sheet-adoption.js';
import {PRIVATE_TEACHER_SHEET_SAVE_SQL as SAVE,PRIVATE_TEACHER_SHEET_READ_SQL as READ} from '../api/_teacher-sheet-draft.js';

// Only controlled labels and type names leave the harness. Never SQL, values,
// arbitrary server messages, or JSON fragments from a failed write.
export function withAdoptionSqlDiagnostics(query,labelForSql) {
  return async(sql,params=[])=>{
    try{return await query(sql,params);}catch(error){
      const scalarType=value=>value===null?'null':typeof value;
      const parameterTypes=params.map(value=>Array.isArray(value)?'array:'+([...new Set(value.map(scalarType))].sort().join('|')||'empty'):scalarType(value));
      const message=String(error?.message||'');
      const parameter=message.match(/^(?:could not determine data type of|inconsistent types deduced for) parameter \$(\d+)$/)?.[1];
      const typeNames='(?:text|character varying|character|uuid|integer|bigint|smallint|boolean|jsonb|json|numeric|double precision|real|unknown)';
      const detail=String(error?.detail||'');
      const typeConflict=new RegExp('^('+typeNames+') versus ('+typeNames+')$').exec(detail);
      Object.assign(error,{adoptionSqlDiagnostic:{label:labelForSql(sql),parameterTypes,
        ...(parameter?{parameterIndex:Number(parameter)}:{}),
        ...(typeConflict?{conflictingTypes:[typeConflict[1],typeConflict[2]]}:{})}});
      throw error;
    }
  };
}

export async function runTeacherSheetAdoptionSqlChecks({db,openSession,onFixtureManifest}) {
  const owner=randomUUID(),otherOwner=randomUUID(),person=randomUUID(),foreignAgent=randomUUID();
  const cases=Array.from({length:4},()=>({rid:randomUUID(),voice:randomUUID(),source:randomUUID(),sheet:randomUUID()}));
  const replicas=cases.map(c=>c.rid),extraSheets=Array.from({length:3},()=>randomUUID()),agents=[foreignAgent];const checks=[];
  const body={identityWho:'Synthetic private authoring fixture',boardVerbalisms:['dekho']};
  const saveParams=c=>[c.rid,owner,JSON.stringify(body),'synthetic-authoring-v1',c.sheet];
  const sheet=c=>db('select * from vy_teacher_sheet where sheet_id=$1::uuid',[c.sheet]);
  const binding=c=>db('select agent_id from vy_replica where replica_id=$1::uuid',[c.rid]);
  const options=(c,cap)=>({replicaId:c.rid,ownerUserId:owner,capabilityId:cap,replicaPolicy:REPLICA_POLICY_VERSION,runtimePolicy:RUNTIME_POLICY_VERSION});
  let stage='fixture-manifest',failure=null,cleanupFailure=null,activationSql,activationParams;
  db=withAdoptionSqlDiagnostics(db,sql=>{
    const explain=sql.startsWith('EXPLAIN '),statement=explain?sql.slice(8):sql;
    const label=statement===activationSql?'runtime_activation':statement===RUNTIME_STATUS_SQL?'runtime_status':statement===ADOPT?'private_draft_adoption':'fixture_or_control';
    return (explain?'explain:':'execute:')+label;
  });
  let targetVerified=false,writesStarted=false,remainingFixtureRows=null,cleanupStage='not_started';
  const manifest=()=>({ownerUserIds:[owner,otherOwner],personIds:[person],replicaIds:[...replicas],
    voiceProfileIds:cases.map(c=>c.voice),sourceIds:cases.map(c=>c.source),
    sheetIds:[...cases.map(c=>c.sheet),...extraSheets],agentIds:[...new Set(agents)]});
  const diagnostic=(error,at)=>({code:typeof error?.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(error.code)?error.code:'UNCLASSIFIED',
    stage:at,assertionName:'private-draft-adoption:'+at,
    ...(error?.observedOutcome?{observedOutcome:error.observedOutcome,observedErrorCode:error.observedErrorCode,
      observedErrorConstraint:error.observedErrorConstraint,expectedErrorCode:error.expectedErrorCode}:{}),
    ...(error?.adoptionSqlDiagnostic?{sql:error.adoptionSqlDiagnostic}:{}),
    frames:String(error?.stack||'').split('\n').map(line=>line.match(/teacher-sheet-adoption-live\.mjs:\d+:\d+/)?.[0]).filter(Boolean)});
  const enter=name=>{stage=name;};
  const expectRefusal=async(operation,expectedCode)=>{
    let observedError=null,result;
    try{result=await operation();}catch(error){observedError=error;}
    if(observedError?.code===expectedCode)return;
    const observedErrorCode=typeof observedError?.code==='string'&&/^[A-Za-z0-9_]{2,64}$/.test(observedError.code)?observedError.code:null;
    const observedOutcome=observedError?'rejected':result===null?'returned_null':'returned_value';
    const error=new assert.AssertionError({message:'expected exact scoped refusal',expected:expectedCode,actual:observedErrorCode||observedOutcome,operator:'strictEqual'});
    Object.assign(error,{observedOutcome,observedErrorCode,
      observedErrorConstraint:typeof observedError?.constraint==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(observedError.constraint)?observedError.constraint:null,
      expectedErrorCode:expectedCode});
    if(observedError){error.cause=observedError;error.adoptionSqlDiagnostic=observedError.adoptionSqlDiagnostic;}
    throw error;
  };
  try{
    assert.equal(typeof onFixtureManifest,'function','fixture-manifest-callback-required');
    // A callback must persist this ID-only manifest before any fixture writes.
    // Runtime-generated agent IDs are added before cleanup removes their replicas.
    await onFixtureManifest(manifest());
    enter('verify-database-target');
    assert.equal((await db('select current_database() as name'))[0]?.name,'vyakti_expert_integration_20260906','exact-development-database-required');
    targetVerified=true;
    enter('capture-actual-statements');
    await activateOwnedRuntime(async(sql,params)=>{
      if(sql===ADOPT)return[{adoption_status:'no_private_draft'}];
      activationSql=sql;activationParams=params;
      return[{capability_id:randomUUID(),replica_id:cases[0].rid,state:'active',profile_version:1,genome_version:1,calibration_version:1}];
    },owner,cases[0].rid);
    const params=c=>[c.rid,...activationParams.slice(1)];
    // Tempting but incorrect implementation: copy the adoption write into
    // activation's same statement. Its old snapshot misses the first save.
    const sameStatementMutant=activationSql.replace(
      '     )\n     select capability_id,replica_id,state,genome_version,profile_version,calibration_version,activated_at',
      `     ), same_statement_adoption as (
         update vy_teacher_sheet s set agent_id=c.agent_id from created_capability c
          where s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
            and s.status='draft' and s.agent_id is null returning s.sheet_id
       )
     select capability_id,replica_id,state,genome_version,profile_version,calibration_version,activated_at`);
    assert.notEqual(sameStatementMutant,activationSql);
    await db('EXPLAIN '+activationSql,params(cases[0]));
    await db('EXPLAIN '+sameStatementMutant,params(cases[0]));
    await db('EXPLAIN '+ADOPT,[cases[0].rid,owner,randomUUID(),REPLICA_POLICY_VERSION,RUNTIME_POLICY_VERSION]);
    enter('explain-runtime-status-fallback');
    await ownedRuntimeStatus(async(sql,params)=>{await db('EXPLAIN '+sql,params);return[];},owner,cases[0].rid);
    checks.push('actual-activation-adoption-and-single-statement-mutant-explain');
    // EXPLAIN passed on the original uncast variadic argument while actual
    // extended-query execution failed with 42P08. Execute both versions on
    // an absent, generated owner/replica scope before inserting any fixtures.
    enter('execute-missing-scope-activation');
    assert.equal((await db('select replica_id from vy_replica where replica_id=$1::uuid',[cases[0].rid])).length,0);
    assert.equal(await activateOwnedRuntime(db,owner,cases[0].rid),null);
    enter('execute-uncast-activation-negative-control');
    const uncastMutant=activationSql.replace("jsonb_build_object('runtimePolicy',$6::text,","jsonb_build_object('runtimePolicy',$6,");
    assert.notEqual(uncastMutant,activationSql);
    await expectRefusal(()=>db(uncastMutant,params(cases[0])),'42P08');
    checks.push('actual-missing-scope-activation-and-uncast-42P08-negative-control');
    enter('create-synthetic-prerequisites');
    writesStarted=true;
    await db("insert into vy_person(person_id,age_tier) values($1::uuid,'adult_verified')",[person]);
    await db('insert into vy_account_person(auth_user_id,person_id) values($1::uuid,$2::uuid)',[owner,person]);
    for(const c of cases){
      await db("insert into vy_replica(replica_id,owner_user_id,subject_person_id,display_name,policy_version,lifecycle,age_verified_at,identity_verified_at,liveness_verified_at,identity_expires_at) values($1::uuid,$2::uuid,$3::uuid,'Synthetic SQL adoption fixture',$4,'ready',now(),now(),now(),now()+interval '1 day')",[c.rid,owner,person,REPLICA_POLICY_VERSION]);
      for(const scope of ['inference','training'])await db("insert into vy_replica_consent(replica_id,owner_user_id,scope,method,policy_version,receipt_hash) values($1::uuid,$2::uuid,$3,'manual_review',$4,$5)",[c.rid,owner,scope,REPLICA_POLICY_VERSION,'a'.repeat(64)]);
      const claim=(await db("insert into vy_replica_claim(replica_id,owner_user_id,domain,key,body,origin,confidence,status,source_ids) values($1::uuid,$2::uuid,'identity','synthetic','Synthetic SQL fixture','self_declared',1,'approved',array[$3::uuid]) returning claim_id",[c.rid,owner,c.source]))[0];
      await db("insert into vy_replica_claim_decision(claim_id,replica_id,owner_user_id,decision,reason_code,policy_version) values($1::bigint,$2::uuid,$3::uuid,'accepted','synthetic_sql_fixture',$4)",[claim.claim_id,c.rid,owner,REPLICA_POLICY_VERSION]);
      await db("insert into vy_replica_profile(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,$3::jsonb,'approved')",[c.rid,'b'.repeat(64),JSON.stringify({provenance:{claims:[{claim_id:String(claim.claim_id)}]}})]);
      await db("insert into vy_replica_calibration(replica_id,owner_user_id,version,profile_version,source_set_hash,definition,status) values($1::uuid,$2::uuid,1,1,$3,'{}'::jsonb,'approved')",[c.rid,owner,'c'.repeat(64)]);
      await db("insert into vy_replica_voice_genome(replica_id,version,source_set_hash,definition,status) values($1::uuid,1,$2,'{}'::jsonb,'approved')",[c.rid,'d'.repeat(64)]);
      // Provider label satisfies the SQL shape only. No adapter or provider is
      // called; this synthetic handle cannot be used for actual synthesis.
      await db("insert into vy_replica_voice_profile(voice_profile_id,replica_id,owner_user_id,genome_version,provider,model,provider_ref,status) values($1::uuid,$2::uuid,$3::uuid,1,'azure','synthetic-sql-fixture',$4,'ready')",[c.voice,c.rid,owner,'synthetic-unusable-'+c.voice]);
      await db("insert into vy_voice_fidelity(replica_id,owner_user_id,voice_profile_ref,genome_version,score,policy_version,status) values($1::uuid,$2::uuid,$3::uuid,1,'{\"mean\":1,\"p10\":1,\"worst\":1}'::jsonb,$4,'pass')",[c.rid,owner,c.voice,FIDELITY_POLICY_VERSION]);
      await db("insert into vy_replica_readiness(replica_id,owner_user_id,overall,min_part,unmeasured_count,inputs_hash) values($1::uuid,$2::uuid,100,100,0,$3)",[c.rid,owner,'e'.repeat(64)]);
      for(const suite of RUNTIME_QUALIFICATION_SUITES)await db("insert into vy_replica_eval_run(replica_id,profile_version,calibration_version,genome_version,suite,candidate,corpus_hash,metrics,verdict) values($1::uuid,1,1,1,$2,$3,$4,'{}'::jsonb,'pass')",[c.rid,suite,c.voice,'f'.repeat(64)]);
    }
    const c=cases[0];await db(SAVE,saveParams(c));
    enter('activation-gates-still-refuse');
    const before=(await sheet(c))[0];
    for(const lifecycle of ['revoked','purging']){
      enter('activation-refuses-'+lifecycle);
      await db('update vy_replica set lifecycle=$2 where replica_id=$1::uuid',[c.rid,lifecycle]);
      await expectRefusal(()=>activateOwnedRuntime(db,owner,c.rid),'runtime_not_qualified');
      assert.deepEqual((await sheet(c))[0],before);
    }
    await db("update vy_replica set lifecycle='ready',identity_expires_at=now()-interval '1 hour' where replica_id=$1::uuid",[c.rid]);
    enter('activation-refuses-expired-identity');
    await expectRefusal(()=>activateOwnedRuntime(db,owner,c.rid),'runtime_not_qualified');
    await db("update vy_replica set identity_expires_at=now()+interval '1 day' where replica_id=$1::uuid",[c.rid]);
    await db("update vy_replica_consent set revoked_at=now() where replica_id=$1::uuid and scope='inference'",[c.rid]);
    enter('activation-refuses-revoked-inference-consent');
    await expectRefusal(()=>activateOwnedRuntime(db,owner,c.rid),'runtime_not_qualified');
    await db("update vy_replica_consent set revoked_at=null where replica_id=$1::uuid and scope='inference'",[c.rid]);
    assert.deepEqual((await sheet(c))[0],before);assert.equal((await binding(c))[0].agent_id,null);checks.push('revoked-purging-expired-identity-and-consent-refuse-without-adoption');
    enter('actual-activation-adopts-private-draft');
    assert.equal((await activateOwnedRuntime(db,owner,c.rid)).active,true);
    const bound=(await sheet(c))[0];assert(bound.agent_id);assert.deepEqual({...bound,agent_id:null},before);
    const privateRead=(await db(READ,[c.rid,owner]))[0];assert.equal(privateRead?.sheet_id,c.sheet);assert.equal(privateRead.agent_id,bound.agent_id);
    const capability=(await db("select capability_id from vy_replica_runtime_capability where replica_id=$1::uuid and state='active'",[c.rid]))[0].capability_id;
    assert.equal(await adopt(db,options(c,capability)),'already_bound');assert.deepEqual((await sheet(c))[0],bound);
    assert.equal((await activateOwnedRuntime(db,owner,c.rid)).active,true);assert.deepEqual((await sheet(c))[0],bound);checks.push('actual-activation-preserves-all-draft-fields-and-retries');
    enter('paused-and-revoked-capabilities-refuse-adoption');
    await db('update vy_teacher_sheet set agent_id=null where sheet_id=$1::uuid',[c.sheet]);
    for(const state of ['paused','revoked']){
      await db('update vy_replica_runtime_capability set state=$2 where capability_id=$1::uuid',[capability,state]);
      await assert.rejects(()=>adopt(db,options(c,capability)),error=>error.code==='runtime_private_draft_authority_changed');
      assert.deepEqual((await sheet(c))[0],{...bound,agent_id:null});
    }
    await db("update vy_replica_runtime_capability set state='active' where capability_id=$1::uuid",[capability]);
    await adopt(db,options(c,capability));assert.deepEqual((await sheet(c))[0],bound);checks.push('paused-revoked-capabilities-never-adopt');
    enter('owner-capability-and-binding-conflicts');
    await assert.rejects(()=>adopt(db,{...options(c,capability),ownerUserId:otherOwner}),error=>error.code==='runtime_private_draft_authority_changed');
    await assert.rejects(()=>adopt(db,{...options(c,capability),capabilityId:randomUUID()}),error=>error.code==='runtime_private_draft_authority_changed');
    await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic foreign adoption agent')",[foreignAgent,'synthetic-adoption-'+foreignAgent]);
    await db('update vy_teacher_sheet set agent_id=$2::uuid where sheet_id=$1::uuid',[c.sheet,foreignAgent]);
    const conflict=(await sheet(c))[0];await assert.rejects(()=>activateOwnedRuntime(db,owner,c.rid),error=>error.code==='runtime_private_draft_conflict');
    assert.deepEqual((await sheet(c))[0],conflict);await db('update vy_teacher_sheet set agent_id=$2::uuid where sheet_id=$1::uuid',[c.sheet,bound.agent_id]);
    checks.push('exact-owner-capability-and-foreign-draft-agent-refusal');
    enter('legacy-and-published-rows-untouched');
    for(const [index,status] of ['draft','published','revoked'].entries()){
      const id=extraSheets[index];
      await db("insert into vy_teacher_sheet(sheet_id,agent_id,sheet,status,consent_artifact_id,published_at) values($1::uuid,$2::uuid,'{\"legacy\":true}'::jsonb,$3,$4::uuid,now())",[id,bound.agent_id,status,randomUUID()]);
    }
    const historical=await db('select * from vy_teacher_sheet where sheet_id=any($1::uuid[]) order by sheet_id',[extraSheets]);
    await activateOwnedRuntime(db,owner,c.rid);
    assert.deepEqual(await db('select * from vy_teacher_sheet where sheet_id=any($1::uuid[]) order by sheet_id',[extraSheets]),historical);checks.push('legacy-and-published-versions-unchanged');
    enter('duplicate-explicit-draft-schema-refusal');
    await assert.rejects(()=>db("insert into vy_teacher_sheet(sheet_id,replica_id,owner_user_id,sheet,status) values($1::uuid,$2::uuid,$3::uuid,'{}'::jsonb,'draft')",[randomUUID(),c.rid,owner]),error=>error.code==='23505'||String(error.message).includes('23505'));
    checks.push('actual-schema-refuses-duplicate-explicit-drafts');

    const overlap=async(first,second,observe)=>{
      let a,b,pending,overlapFailure=null;const transactionCleanupFailures=[];
      try{
        a=await openSession();b=await openSession();await a.query('BEGIN');await b.query('BEGIN');
        const aPid=Number((await a.query('select pg_backend_pid() as pid'))[0].pid),bPid=Number((await b.query('select pg_backend_pid() as pid'))[0].pid);
        await first(a.query.bind(a));pending=second(b.query.bind(b)).then(result=>({result}),error=>({error}));
        let witnessed=false;const deadline=Date.now()+10000;
        while(Date.now()<deadline){if((await db('select $2::integer=any(pg_blocking_pids($1::integer)) as blocked',[bPid,aPid]))[0]?.blocked===true){witnessed=true;break;}}
        assert(witnessed,'second-transaction-blocked-on-first-before-commit');await a.query('COMMIT');
        const result=await pending;if(result.error)throw result.error;await b.query('COMMIT');await observe(result.result);
      }catch(error){overlapFailure=error;}
      const settle=async(name,fn)=>{try{await fn();}catch(error){transactionCleanupFailures.push(diagnostic(error,name));}};
      if(a)await settle('first-transaction-rollback',()=>a.query('ROLLBACK'));
      if(pending)await pending;
      if(b)await settle('second-transaction-rollback',()=>b.query('ROLLBACK'));
      if(a)await settle('first-session-close',()=>a.close());
      if(b)await settle('second-session-close',()=>b.close());
      if(overlapFailure||transactionCleanupFailures.length){
        const error=overlapFailure||Object.assign(new Error('synthetic transaction cleanup failed'),{code:'TRANSACTION_CLEANUP_FAILED'});
        Object.assign(error,{transactionCleanupFailures});throw error;
      }
    };
    enter('single-statement-old-snapshot-negative-control');
    const old=cases[1];await overlap(q=>q(SAVE,saveParams(old)),q=>q(sameStatementMutant,params(old)),async()=>{
      assert((await binding(old))[0].agent_id);assert.equal((await sheet(old))[0].agent_id,null,'single-statement-misses-newly-committed-first-draft');
      await activateOwnedRuntime(db,owner,old.rid);assert.equal((await sheet(old))[0].agent_id,(await binding(old))[0].agent_id);
    });checks.push('witnessed-old-snapshot-miss-and-real-retry-adoption');
    enter('actual-first-save-before-activation-overlap');
    const actual=cases[2];await overlap(q=>q(SAVE,saveParams(actual)),q=>activateOwnedRuntime(q,owner,actual.rid),async result=>{
      assert.equal(result.active,true);assert.equal((await sheet(actual))[0].agent_id,(await binding(actual))[0].agent_id);
    });checks.push('witnessed-first-save-before-actual-activation-adopts');
    enter('actual-activation-before-first-save-overlap');
    const later=cases[3];await overlap(q=>activateOwnedRuntime(q,owner,later.rid),q=>q(SAVE,saveParams(later)),async()=>{
      assert.equal((await sheet(later))[0].agent_id,(await binding(later))[0].agent_id);assert((await sheet(later))[0].agent_id);
    });checks.push('witnessed-later-first-save-inherits-activated-agent');
    enter('revocation-between-activation-and-adoption');
    const stored=(await sheet(later))[0];await db('update vy_teacher_sheet set agent_id=null where sheet_id=$1::uuid',[later.sheet]);
    await assert.rejects(()=>activateOwnedRuntime(async(sql,p)=>{
      if(sql===ADOPT)await db("update vy_replica set lifecycle='revoked' where replica_id=$1::uuid",[later.rid]);
      return db(sql,p);
    },owner,later.rid),error=>error.code==='runtime_private_draft_authority_changed');
    assert.deepEqual((await sheet(later))[0],{...stored,agent_id:null});checks.push('revocation-between-statements-refuses-private-handoff');
  }catch(error){failure=error;}
  // Cleanup has its own guarded error path. It must never replace the primary
  // assertion or lose the stage that explains the initial failure.
  if(targetVerified)try{
    cleanupStage='discover-runtime-agents';
    const rows=await db('select agent_id from vy_replica where replica_id=any($1::uuid[])',[replicas]);agents.push(...rows.map(r=>r.agent_id).filter(Boolean));
    cleanupStage='persist-final-fixture-manifest';await onFixtureManifest(manifest());
    cleanupStage='remove-private-sheets';
    await db('delete from vy_teacher_sheet where replica_id=any($1::uuid[]) or sheet_id=any($2::uuid[])',[replicas,extraSheets]);
    cleanupStage='remove-runtime-capabilities';
    await db('delete from vy_replica_runtime_capability where replica_id=any($1::uuid[])',[replicas]);
    cleanupStage='remove-evaluation-rows';
    await db('delete from vy_replica_eval_run where replica_id=any($1::uuid[])',[replicas]);
    cleanupStage='remove-calibrations';
    await db('delete from vy_replica_calibration where replica_id=any($1::uuid[])',[replicas]);
    cleanupStage='remove-voice-profiles';
    await db('delete from vy_replica_voice_profile where replica_id=any($1::uuid[])',[replicas]);
    cleanupStage='remove-readiness-snapshots';
    // Migration 073 deliberately has no replica FK. Replica deletion alone
    // cannot remove these owner-scoped snapshots.
    await db('delete from vy_replica_readiness where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid',[replicas,owner]);
    cleanupStage='remove-replicas';
    await db('delete from vy_replica where replica_id=any($1::uuid[]) and owner_user_id=$2::uuid',[replicas,owner]);
    cleanupStage='remove-account-person';
    await db('delete from vy_account_person where auth_user_id=$1::uuid and person_id=$2::uuid',[owner,person]);
    cleanupStage='remove-person';
    await db('delete from vy_person where person_id=$1::uuid',[person]);
    cleanupStage='remove-agents';
    await db('delete from vy_agent where agent_id=any($1::uuid[])',[agents]);
    cleanupStage='verify-exact-zero-fixtures';
    const tables=['vy_replica','vy_replica_runtime_capability','vy_replica_profile','vy_replica_calibration','vy_replica_voice_genome','vy_replica_voice_profile','vy_replica_eval_run','vy_replica_readiness','vy_voice_fidelity','vy_replica_claim','vy_replica_claim_decision','vy_replica_consent'];
    let remaining=0;for(const table of tables)remaining+=Number((await db(`select count(*) as n from ${table} where replica_id=any($1::uuid[])`,[replicas]))[0].n);
    remaining+=Number((await db('select count(*) as n from vy_teacher_sheet where replica_id=any($1::uuid[]) or sheet_id=any($2::uuid[])',[replicas,extraSheets]))[0].n);
    remaining+=Number((await db('select count(*) as n from vy_agent where agent_id=any($1::uuid[])',[agents]))[0].n);
    remaining+=Number((await db('select count(*) as n from vy_person where person_id=$1::uuid',[person]))[0].n);
    remaining+=Number((await db('select count(*) as n from vy_account_person where auth_user_id=$1::uuid',[owner]))[0].n);
    remainingFixtureRows=Number.isFinite(remaining)?remaining:null;
    assert.equal(remaining,0,'exact-adoption-fixture-cleanup');
    cleanupStage='verified';
  }catch(error){cleanupFailure=error;}
  if(failure||cleanupFailure){
    const error=failure||cleanupFailure;
    const failedStage=failure?stage:'cleanup:'+cleanupStage;
    Object.assign(error,{failedStage,lastCompletedCheck:checks.at(-1)||'none',assertionName:'private-draft-adoption:'+failedStage,
      primaryFailure:failure?diagnostic(failure,stage):null,
      cleanupFailure:cleanupFailure?diagnostic(cleanupFailure,cleanupStage):null,
      fixtureWritesStarted:writesStarted,targetVerified,
      adoptionFixtureCleanupVerified:cleanupStage==='verified',remainingFixtureRows});
    throw error;
  }
  return{passed:checks.length,checks,remainingFixtureRows:0,prerequisiteEvidence:'synthetic SQL fixtures only'};
}
