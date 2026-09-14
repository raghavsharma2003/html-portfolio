// Preparation only: these callbacks record real store SQL. No database client,
// credentials, network or automatic execution exists in this module.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import {issueOwnedModernChallenge,createModernCaptureAuthorityLoader,getOwnedModernComparisonDescriptor,
 MODERN_COMPARISON_DESCRIPTOR_SQL,MODERN_AUTHORITY_SNAPSHOT_SQL,MODERN_AUTHORITY_ISSUE_SQL,
 MODERN_AUTHORITY_RECEIPT_SQL,MODERN_AUTHORITY_LOAD_SQL,SELECTED_COMPARISON_ATTESTATIONS} from '../../api/_liveness/issued-authority.js';
import {BIOMETRIC_VERIFICATION_ATTESTATIONS} from '../../api/_replica-liveness.js';
import {selectOwnedVoiceArtifact,decideOwnedEvidence,acceptAllOwnedEvidenceForSelfTest,
 REFERENCE_REVIEW_ARTIFACT_SQL,REFERENCE_REVIEW_EVIDENCE_SQL,REFERENCE_REVIEW_BATCH_SQL} from '../../api/_replica-review.js';
import {fixture,descriptorRow,leaseFor,uid,NOW} from './fixtures.mjs';

export async function prepareModernAuthoritySqlCases() {
 const f=fixture(),cases=[];
 const capture=(name,sql,params)=>cases.push({name,sql,sha256:sha256Hex(sql),params});
 const descriptor=await getOwnedModernComparisonDescriptor(async(sql,params)=>{
  capture('comparison_descriptor',sql,params);return[descriptorRow(f)];
 },uid(2),uid(1));
 let receipt;
 await issueOwnedModernChallenge(async(sql,params)=>{
  if(sql===MODERN_AUTHORITY_SNAPSHOT_SQL){capture('authority_snapshot',sql,params);return[f];}
  if(sql!==MODERN_AUTHORITY_ISSUE_SQL)throw Error('unexpected_issue_query');
  capture('issue',sql,params);receipt=JSON.parse(params[5]);const c=receipt.envelope.contract;
  return[{challenge_id:c.challengeId,replica_id:c.replicaId,phrase:receipt.envelope.phrase,state:'issued',attempt:1,issued_at:c.issuedAt,expires_at:c.expiresAt}];
 },uid(2),uid(1),{locale:'hi-IN',expected_primary_source_id:uid(3),expected_primary_selection_id:uid(5),
  expected_primary_source_sha256:descriptor.source_sha256,expected_comparison_snapshot_sha256:descriptor.comparison_snapshot_sha256,
  attestations:Object.fromEntries(BIOMETRIC_VERIFICATION_ATTESTATIONS.map(k=>[k,true])),
  comparison_attestations:Object.fromEntries(SELECTED_COMPARISON_ATTESTATIONS.map(k=>[k,true]))});
 await createModernCaptureAuthorityLoader({now:()=>NOW,db:async(sql,params)=>{
  if(sql===MODERN_AUTHORITY_RECEIPT_SQL){capture('receipt',sql,params);return[{receipt_payload:receipt,receipt_hash:sha256Hex(receipt)}];}
  if(sql!==MODERN_AUTHORITY_LOAD_SQL)throw Error('unexpected_load_query');
  capture('authority_load',sql,params);return[{...f,binding:receipt.binding}];
 }})(leaseFor(receipt));
 for(const [name,expected,invoke] of [
  ['review_artifact',REFERENCE_REVIEW_ARTIFACT_SQL,db=>selectOwnedVoiceArtifact(db,uid(2),{replica_id:uid(1),artifact_id:uid(8)})],
  ['review_evidence',REFERENCE_REVIEW_EVIDENCE_SQL,db=>decideOwnedEvidence(db,uid(2),{replica_id:uid(1),evidence_id:f.reference_rows[0].evidence_id,decision:'rejected',reason_code:'wrong_speaker'})],
  ['review_batch',REFERENCE_REVIEW_BATCH_SQL,db=>acceptAllOwnedEvidenceForSelfTest(db,uid(2),uid(1),{self_test_mode:true})],
 ])await invoke(async(sql,params)=>{if(sql!==expected)throw Error('unexpected_review_query');capture(name,sql,params);return[{accepted:1}];});
 return {schema:'modern-issued-authority-sql-preparation/v1',execution:'not-run',database_guard:'vyakti_expert_integration_20260906',
  migration:{path:'db/migrations/144_modern_reference_authority_epoch.sql',sql:readFileSync(new URL('../../db/migrations/144_modern_reference_authority_epoch.sql',import.meta.url),'utf8')},
  fixture:f,receipt,lease:leaseFor(receipt),cases};
}

// Root may use a witnessed advisory barrier to establish an old READ COMMITTED
// statement snapshot, commit a reference writer, then release the reader before
// its source/replica locks. The target stays the actual query except this test
// barrier; every invocation must retain original and instrumented SQL hashes.
export function addSnapshotBarrier(sql) {
 const parameters=[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));
 const parameter=Math.max(...parameters)+1;
 const first='with ',gate='source_gate as materialized (';
 if(!sql.startsWith(first)||sql.split(gate).length!==2)throw Error('snapshot_barrier_target_invalid');
 const marker="order by s.source_id for update of s nowait";
 if(sql.split(marker).length!==2)throw Error('snapshot_barrier_source_gate_invalid');
 const instrumented=sql.replace(first,`with snapshot_barrier as materialized (select pg_advisory_xact_lock($${parameter}::bigint)), `)
  .replace(marker,`and (select count(*) from snapshot_barrier)=1 ${marker}`);
 return {sql:instrumented,parameter,original_sha256:sha256Hex(sql),sha256:sha256Hex(instrumented)};
}

// Retained vulnerable semantics for ROLLED-BACK synthetic negative controls:
// replacing the actual increment by a no-op reproduces the missing epoch.
export function withoutReferenceEpochAdvance(sql) {
 const target='set reference_authority_epoch=r.reference_authority_epoch+1';
 if(sql.split(target).length!==2)throw Error('epoch_negative_target_invalid');
 return sql.replace(target,'set reference_authority_epoch=r.reference_authority_epoch');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const preparation=await prepareModernAuthoritySqlCases();
 // Safe default: hashes/counts only, never execution or fixture/media content.
 console.log(JSON.stringify({execution:preparation.execution,query_count:preparation.cases.length,
  queries:preparation.cases.map(({name,sha256})=>({name,sha256})),migration_sha256:sha256Hex(preparation.migration.sql)},null,2));
}
