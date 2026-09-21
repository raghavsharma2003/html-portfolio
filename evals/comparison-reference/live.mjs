// Opt-in injected development SQL only. This module has no database client,
// credentials, automatic invocation, storage, auth or provider implementation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createEvidenceRecord,createArtifactManifest,sha256Hex} from '../../api/_replica-processing/contracts.js';
import {persistProcessingOutput} from '../../api/_replica-processing/repository.js';
import * as store from '../../api/_comparison-reference.js';
import {getOwnedModernComparisonDescriptor,issueOwnedModernChallenge,MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
import {candidateFixture,bytes,attestations} from './fixtures.mjs';
import {prepareComparisonReferenceSql,prepareComparisonErasureSql,withoutComparisonConfirmationEpoch} from './sql-cases.mjs';
export const COMPARISON_DATABASE='vyakti_expert_integration_20260906';
export const COMPARISON_LIVE_TABLES=Object.freeze(['vy_replica','vy_replica_source','vy_replica_consent','vy_replica_identity_case',
 'vy_replica_voice_reference','vy_replica_processing_job','vy_replica_processing_artifact','vy_replica_processing_evidence',
 'vy_replica_processing_artifact_decision','vy_replica_processing_evidence_decision','vy_replica_comparison_reference',
 'vy_replica_liveness_challenge','vy_replica_biometric_verification_grant','vy_replica_audit']);
export function createComparisonLiveFixture(){
 const map=new Map(),remap=v=>Array.isArray(v)?v.map(remap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)])):
  typeof v==='string'&&v.length===36&&/^[0-9a-f-]+$/.test(v)?(map.has(v)?map.get(v):(map.set(v,randomUUID()),map.get(v))):v;
 const c=remap(candidateFixture());
 c.reference_rows=c.reference_rows.map(e=>{if(e.evidence_type==='voice_measurement')e.input_sha256=sha256Hex({schema_version:'voice-analysis-input-set/v1',inputs:e.value.input_set});const record=createEvidenceRecord({...e,adapter_stage:'voice_quality',span:null,adapter:{family:e.adapter_family,name:e.adapter_name,version:e.adapter_version,measure(){}}});return {...e,...record,decision_id:null};}).sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
 c.binding.evidence_pins=c.reference_rows.map(e=>({evidence_id:e.evidence_id,record_hash:e.record_hash,decision_id:null}));
 const f={c,person:randomUUID(),identitySource:randomUUID(),identityCase:randomUUID(),enhanceJob:randomUUID(),intakeJobs:[randomUUID(),randomUUID()],references:Array.from({length:4},()=>randomUUID()),challengeIds:[],grantIds:[],foreignOwner:randomUUID(),foreignReplica:randomUUID()};
 const b=c.binding;f.artifact=createArtifactManifest({artifact_id:b.artifact_id,replica_id:b.replica_id,owner_user_id:b.owner_user_id,source_id:b.primary_source_id,created_by_job_id:f.enhanceJob,stage:'enhance',variant_key:'identity-preserving',storage_bucket:'synthetic-no-storage',object_path:`${b.owner_user_id}/${b.replica_id}/${b.primary_source_id}/derived/reference-v1/enhance-${b.artifact_id}`,mime:'audio/wav',byte_size:bytes.length,duration_ms:1000,sha256:b.artifact_sha256,input_sha256:b.primary_source_sha256,transform_name:'capture-audio',transform_version:'reference-v1',parameter_hash:sha256Hex({synthetic_sql_only:true}),adapter_stage:'enhance',adapter:{family:'enhancement',name:'deepfilternet3-dual-candidate',version:'vyakti-voice-evidence-v1',enhance(){}}});return f;
}
export function comparisonLiveManifest(f){const b=f.c.binding;return {schema:'comparison-reference-live-fixture/v1',declaration:'Synthetic SQL prerequisites only; no real person, media object, auth, identity acceptance, training or provider work.',
 owner_user_id:b.owner_user_id,replica_id:b.replica_id,person_id:f.person,source_ids:[b.primary_source_id,f.identitySource],consent_ids:[b.capture_consent_id,b.storage_consent_id],identity_case_id:f.identityCase,
 job_ids:[b.job_id,f.enhanceJob,...f.intakeJobs],artifact_ids:[b.artifact_id],evidence_ids:f.c.reference_rows.map(e=>e.evidence_id),reference_ids:f.references,
 challenge_ids:f.challengeIds,grant_ids:f.grantIds,foreign_owner:f.foreignOwner,foreign_replica:f.foreignReplica,scope_tables:COMPARISON_LIVE_TABLES};}
async function recount(db,f){const m=comparisonLiveManifest(f),counts={};for(const table of COMPARISON_LIVE_TABLES){const r=await db(`select count(*)::int n from ${table} where replica_id=$1::uuid and owner_user_id=$2::uuid`,[m.replica_id,m.owner_user_id]);assert.equal(r.length,1);assert(Number.isSafeInteger(Number(r[0].n)));counts[table]=Number(r[0].n);}
 for(const [table,sql,p]of [['vy_person','select count(*)::int n from vy_person where person_id=$1::uuid',[m.person_id]],['vy_replica_processing_attempt','select count(*)::int n from vy_replica_processing_attempt where job_id=any($1::uuid[])',[m.job_ids]]]){const rows=await db(sql,p);assert.equal(rows.length,1);counts[table]=Number(rows[0].n);assert(Number.isSafeInteger(counts[table]));}return counts;}
async function seed(db,f){const b=f.c.binding;
 await db('insert into vy_person(person_id) values($1::uuid)',[f.person]);
 await db("insert into vy_replica(replica_id,owner_user_id,subject_person_id,display_name,subject_mode,lifecycle,policy_version,primary_selection_id,private_text_epoch,reference_authority_epoch) values($1::uuid,$2::uuid,$3::uuid,'Synthetic comparison selection SQL only','self','enrolling',$4,$5::uuid,$6::bigint,$7::bigint)",[b.replica_id,b.owner_user_id,f.person,b.policy_version,b.primary_selection_id,b.authority_epoch,f.c.observed_epoch]);
 for(const [scope,cid]of [['capture',b.capture_consent_id],['storage',b.storage_consent_id]])await db("insert into vy_replica_consent(consent_id,replica_id,owner_user_id,scope,method,policy_version,receipt_hash,metadata,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4,'manual_review',$5,$6,'{\"synthetic_sql_fixture\":true}'::jsonb,now()+interval '1 day')",[cid,b.replica_id,b.owner_user_id,scope,b.policy_version,sha256Hex('synthetic-'+scope)]);
 for(const [sid,kind,mode,mime,sha,state]of [[b.primary_source_id,'audio','upload','audio/wav',b.primary_source_sha256,'ready'],[f.identitySource,'image','identity_document','image/png','c'.repeat(64),'quarantined']])await db("insert into vy_replica_source(source_id,replica_id,owner_user_id,consent_id,kind,capture_mode,storage_bucket,object_path,mime,byte_size,sha256,state,contains_third_parties) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,'synthetic-no-storage',$7,$8,$9::bigint,$10,$11,false)",[sid,b.replica_id,b.owner_user_id,b.capture_consent_id,kind,mode,`${b.owner_user_id}/${b.replica_id}/${sid}/original`,mime,kind==='audio'?bytes.length:12,sha,state]);
 await db("insert into vy_replica_identity_case(identity_case_id,replica_id,owner_user_id,source_id,policy_version,consent_receipt_hash,source_sha256,consented_at,state,adult_evidence,document_authentic,document_current,face_reference_ready,credential_expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,now(),'evidence_ready',true,true,true,true,now()+interval '1 day')",[f.identityCase,b.replica_id,b.owner_user_id,f.identitySource,b.policy_version,sha256Hex('synthetic-id-consent'),'c'.repeat(64)]);
 await db('insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id) values($1::uuid,$2::uuid,$3::uuid)',[b.replica_id,b.owner_user_id,b.primary_source_id]);
 for(const [jid,step]of [[f.enhanceJob,'enhance'],[b.job_id,'voice_quality'],[f.intakeJobs[0],'integrity'],[f.intakeJobs[1],'malware_scan']]){
  const manifest=sha256Hex({synthetic:jid,step}),result={verified_input_sha256:b.primary_source_sha256,manifest_hash:manifest};
  await db("insert into vy_replica_processing_job(job_id,replica_id,owner_user_id,source_id,step,state,attempt,revision,result) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'complete',1,1,$6::jsonb)",[jid,b.replica_id,b.owner_user_id,b.primary_source_id,step,JSON.stringify(result)]);
  const adapter=step==='voice_quality'?['voice-analysis','speechbrain-independent-speaker-evidence','vyakti-voice-evidence-v2']:step==='enhance'?['enhancement','deepfilternet3-dual-candidate','vyakti-voice-evidence-v1']:step==='integrity'?['integrity','server-private-byte-verifier','sha256-v1']:['malware','clamav-stream','clamav-v1'];
  await db("insert into vy_replica_processing_attempt(job_id,attempt,outcome,adapter_family,adapter_name,adapter_version,result_manifest_hash) values($1::uuid,1,'complete',$2,$3,$4,$5)",[jid,...adapter,manifest]);
 }
 await persistProcessingOutput(db,{outcome:'complete',artifacts:[f.artifact],evidence:f.c.reference_rows});
}
export const COMPARISON_SQL_PIN_FILES=Object.freeze(['api/_comparison-preparation.js','api/_replica-processing/comparison.js','api/_replica-processing/queue.js','db/migrations/146_comparison_preparation.sql','db/migrations/147_gpu_allocation_window.sql','api/_comparison-reference.js','api/_liveness/issued-authority.js','api/_liveness/reference-evidence.js','api/_creator-export.js','api/_replica-full-erasure.js','db/schema.sql','db/migrations/145_private_comparison_reference.sql','evals/comparison-reference/live.mjs','evals/comparison-reference/fixtures.mjs','evals/comparison-reference/sql-cases.mjs']);
export async function runComparisonReferenceLive({db,onManifest,expectedSourceHashes,expectedHead,rollbackDb}={}){
 if(typeof db!=='function'||typeof onManifest!=='function'||typeof rollbackDb!=='function'||!expectedSourceHashes||COMPARISON_SQL_PIN_FILES.some(path=>!Object.hasOwn(expectedSourceHashes,path))||typeof expectedHead!=='string'||!(/^[0-9a-f]{40}$/).test(expectedHead))throw Error('comparison_live_protected_arguments_required');
 const verify=()=>{const cwd=fileURLToPath(new URL('../../',import.meta.url));assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),expectedHead);assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd,encoding:'utf8'}).trim(),'');for(const [path,expected]of Object.entries(expectedSourceHashes)){if(!/^(api|db|evals)\/[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..'))throw Error('comparison_live_pin_path_invalid');assert.equal(sha256Hex(readFileSync(new URL('../../'+path,import.meta.url))),expected,'source_pin_changed');}};verify();
 const guard=await db('select current_database() as database');assert.equal(guard[0]?.database,COMPARISON_DATABASE);
 const f=createComparisonLiveFixture(),b=f.c.binding,report={started_at:new Date().toISOString(),passed:false,groups:[],parser_queries:[],sql_errors:[],cleanup_errors:[],remaining:null,source_pins:expectedSourceHashes};let seeded=false;
 const sql=async(text,p=[])=>{try{const rows=await db(text,p);assert(Array.isArray(rows));return rows;}catch(e){report.sql_errors.push({code:e.code||'unknown',query_sha256:sha256Hex(text)});throw e;}};
 const check=async(name,work)=>{await work();report.groups.push(name);};
 try{
  const counts=await recount(sql,f);assert(Object.values(counts).every(n=>n===0));
  const conflicts=await sql('select count(*)::int n from vy_replica where replica_id=any($1::uuid[]) or owner_user_id=any($2::uuid[])',[[b.replica_id,f.foreignReplica],[b.owner_user_id,f.foreignOwner]]);assert.equal(Number(conflicts[0].n),0);
  for(const [text,p]of [
   ['select count(*)::int n from vy_replica_source where source_id=any($1::uuid[])',[[b.primary_source_id,f.identitySource]]],
   ['select count(*)::int n from vy_replica_processing_job where job_id=any($1::uuid[])',[[b.job_id,f.enhanceJob,...f.intakeJobs]]],
   ['select count(*)::int n from vy_replica_processing_evidence where evidence_id=any($1::uuid[])',[f.c.reference_rows.map(e=>e.evidence_id)]],
   ['select count(*)::int n from vy_replica_processing_artifact where artifact_id=$1::uuid',[b.artifact_id]],
   ['select count(*)::int n from vy_replica_consent where consent_id=any($1::uuid[])',[[b.capture_consent_id,b.storage_consent_id]]],
   ['select count(*)::int n from vy_replica_identity_case where identity_case_id=$1::uuid',[f.identityCase]],
   ['select count(*)::int n from vy_replica_comparison_reference where reference_id=any($1::uuid[])',[f.references]],
  ]){const rows=await sql(text,p);assert.equal(rows.length,1);assert.equal(Number(rows[0].n),0);}
  await onManifest(comparisonLiveManifest(f));seeded=true;await seed(sql,f);
  await check('synthetic prerequisites persist without ordinary evidence/artifact decisions',async()=>{const counts=await recount(sql,f);assert.equal(counts.vy_replica_processing_artifact_decision,0);assert.equal(counts.vy_replica_processing_evidence_decision,0);assert.equal(counts.vy_replica_processing_evidence,3);});
  const inventory=await prepareComparisonReferenceSql();
  await check('nine actual store/export/erasure SQL shapes EXPLAIN without ANALYZE',async()=>{for(const c of [...inventory.cases,...await prepareComparisonErasureSql()]){await sql('EXPLAIN '+c.sql,c.params);report.parser_queries.push({name:c.name,sha256:c.sha256});}});
  const options=await store.comparisonReferenceOptions(sql,b.owner_user_id,b.replica_id);assert.equal(options.options.length,1);
  const input={replica_id:b.replica_id,reference_id:f.references[0],artifact_id:b.artifact_id,expected_snapshot_hash:options.options[0].snapshot_hash,attestations:attestations()};
  await check('actual authorize and replay persist one exact use receipt',async()=>{await store.authorizeComparisonReference(sql,b.owner_user_id,input);await store.authorizeComparisonReference(sql,b.owner_user_id,input);const count=await sql('select count(*)::int n from vy_replica_comparison_reference where reference_id=$1::uuid',[input.reference_id]);assert.equal(Number(count[0].n),1);});
  await check('other owner and replica cannot read or withdraw the request',async()=>{await assert.rejects(()=>store.readComparisonReference(sql,f.foreignOwner,b.replica_id,input.reference_id),{status:404});await assert.rejects(()=>store.withdrawComparisonReference(sql,b.owner_user_id,{...input,replica_id:f.foreignReplica}),{status:404});});
  const readPrivate=async()=>({body:bytes,mime:'audio/wav'});
  await store.auditionComparisonReference(sql,b.owner_user_id,input,readPrivate);
  let confirmParams;const sentinel=Symbol('confirm_sql_capture');
  try{await store.confirmComparisonReference(async(text,p)=>{if(text===store.COMPARISON_CONFIRM_SQL){confirmParams=p;throw sentinel;}return sql(text,p);},b.owner_user_id,{...input,confirm_this_is_my_voice:true});}catch(e){if(e!==sentinel)throw e;}
  assert(confirmParams);
  await check('actual stale epoch refuses while retained typed old predicate succeeds only inside rollback',async()=>{
   await sql('update vy_replica set reference_authority_epoch=reference_authority_epoch+1 where replica_id=$1::uuid and owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]);
   assert.equal((await sql(store.COMPARISON_CONFIRM_SQL,confirmParams)).length,0);
   let negativeExecuted=false;await rollbackDb(async transaction=>{assert.equal((await transaction('select current_database() as database'))[0].database,COMPARISON_DATABASE);const rows=await transaction(withoutComparisonConfirmationEpoch(store.COMPARISON_CONFIRM_SQL),confirmParams);assert.equal(rows.length,1);negativeExecuted=true;});assert(negativeExecuted);
   assert.equal((await store.readComparisonReference(sql,b.owner_user_id,b.replica_id,input.reference_id)).state,'review');
  });
  await store.withdrawComparisonReference(sql,b.owner_user_id,input);
  const fresh=await store.comparisonReferenceOptions(sql,b.owner_user_id,b.replica_id),second={...input,reference_id:f.references[1],expected_snapshot_hash:fresh.options[0].snapshot_hash};
  await store.authorizeComparisonReference(sql,b.owner_user_id,second);await store.auditionComparisonReference(sql,b.owner_user_id,second,readPrivate);
  await check('actual explicit confirmation selects and is discoverable without a client handle',async()=>{assert.equal((await store.confirmComparisonReference(sql,b.owner_user_id,{...second,confirm_this_is_my_voice:true})).state,'selected');assert.equal((await store.comparisonReferenceOptions(sql,b.owner_user_id,b.replica_id)).current_reference.reference_id,second.reference_id);});
  await check('actual modern issuer consumes selected purpose authority without ordinary decision rows',async()=>{
   const d=await getOwnedModernComparisonDescriptor(sql,b.owner_user_id,b.replica_id),request={locale:'en-IN',expected_primary_source_id:b.primary_source_id,expected_primary_selection_id:b.primary_selection_id,expected_primary_source_sha256:b.primary_source_sha256,expected_comparison_snapshot_sha256:d.comparison_snapshot_sha256,attestations:Object.fromEntries(BIOMETRIC_VERIFICATION_ATTESTATIONS.map(k=>[k,true])),comparison_attestations:{selected_reference_is_my_voice:true,compare_this_capture_to_selected_reference:true,comparison_is_private_verification_only:true}};
   const challenge=await issueOwnedModernChallenge(async(text,p)=>{if(text===MODERN_AUTHORITY_ISSUE_SQL){const receipt=JSON.parse(p[5]);f.challengeIds.push(receipt.envelope.contract.challengeId);f.grantIds.push(receipt.envelope.contract.comparisonConsentId);await onManifest(comparisonLiveManifest(f));await sql('EXPLAIN '+text,p);report.parser_queries.push({name:'modern_issue_purpose_branch',sha256:sha256Hex(text)});}return sql(text,p);},b.owner_user_id,b.replica_id,request);assert.equal(challenge.state,'issued');
  });
  await check('withdrawal invalidates purpose authority and current modern snapshot',async()=>{await store.withdrawComparisonReference(sql,b.owner_user_id,second);assert.equal((await sql(MODERN_AUTHORITY_SNAPSHOT_SQL,[b.replica_id,b.owner_user_id,b.primary_source_id,b.primary_selection_id])).length,0);});
  await check('unknown cancellation is terminal and late authorization creates no consent',async()=>{const unknown={...input,reference_id:f.references[2]},v=await store.withdrawComparisonReference(sql,b.owner_user_id,unknown);assert.equal(v.state,'revoked');assert.equal(v.expires_at,null);const next=await store.comparisonReferenceOptions(sql,b.owner_user_id,b.replica_id);assert.equal((await store.authorizeComparisonReference(sql,b.owner_user_id,{...unknown,expected_snapshot_hash:next.options[0].snapshot_hash})).state,'revoked');});
  await check('source deletion cascades purpose payload while owner tombstones remain exact scoped',async()=>{await sql('delete from vy_replica_source where source_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid',[b.primary_source_id,b.replica_id,b.owner_user_id]);const rows=await sql('select reference_id,receipt_payload from vy_replica_comparison_reference where replica_id=$1::uuid and owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]);assert.equal(rows.length,1);assert.equal(rows[0].reference_id,f.references[2]);assert.equal(rows[0].receipt_payload,null);});
  assert.equal(report.sql_errors.length,0);report.passed=true;
 }catch(e){report.failure={code:e.code||e.name||'unknown',group_count:report.groups.length};}
 finally{if(seeded){for(const [text,p]of [['delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid',[b.replica_id,b.owner_user_id]],['delete from vy_person where person_id=$1::uuid',[f.person]]])try{await db(text,p);}catch(e){report.cleanup_errors.push({code:e.code||e.name||'unknown',query_sha256:sha256Hex(text)});}try{report.remaining=await recount(db,f);}catch(e){report.cleanup_errors.push({code:e.code||e.name||'unknown'});}}
  try{verify();}catch{report.source_drift=true;}report.finished_at=new Date().toISOString();if(report.source_drift||report.cleanup_errors.length||!report.remaining||Object.values(report.remaining).some(n=>n!==0))report.passed=false;
 }
 return report;
}
