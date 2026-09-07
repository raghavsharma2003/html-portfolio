// Actual function controls; no database parser, provider or installed scanner proof.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {executeProcessingJob} from '../api/_replica-processing/worker.js';
import {createNativeMediaAdapters} from '../api/_replica-processing/providers/native-media.js';
import {readClamAvVerdict} from '../api/_replica-processing/native-tools.js';
import {processingCompletionReceipt,leaseNextProcessingJob,completeProcessingJob} from '../api/_replica-processing/queue.js';
import {commitProcessingOutput} from '../api/_replica-processing/repository.js';
import {liveIntakeReceiptsSql,processingPurposeSql,LIVE_INTAKE_PURPOSE} from '../api/_replica-processing/purpose.js';
import {leaseNextLivenessVerification,completeLivenessVerification,createLivenessVerdict} from '../api/_replica-liveness-verification.js';
import {REPLICA_POLICY_VERSION} from '../api/_replica.js';

const bytes=Buffer.from('Synthetic intake bytes. Not a valid biometric recording.');
const sha=createHash('sha256').update(bytes).digest('hex');
const owner=randomUUID(),replica=randomUUID(),sid=randomUUID();
const source={source_id:sid,replica_id:replica,owner_user_id:owner,kind:'video',capture_mode:'live_challenge',
  state:'quarantined',storage_bucket:'private-fixture',object_path:`${owner}/${replica}/${sid}/original`,sha256:sha,byte_size:bytes.length};
const job=step=>({job_id:randomUUID(),source_id:sid,replica_id:replica,owner_user_id:owner,step,revision:1,state:'leased',attempt:1});
const native=(scan=()=>({safe:true}),body=bytes)=>createNativeMediaAdapters({
  resolveInput:async()=>({body,mime:'video/webm'}),scanBytes:async()=>scan(),probeBytes:async()=>({duration_ms:5000,sample_rate_hz:24000,channels:1,codec:'pcm'})});
const run=(step,adapters=native(),overrides={})=>executeProcessingJob({source,job:job(step),adapters,
  completedSteps:step==='integrity'?[]:['integrity'],...overrides});
const checks=[];
const integrity=await run('integrity');
assert.equal(integrity.outcome,'complete');assert.deepEqual(integrity.result.next_steps,['malware_scan']);
assert.equal(integrity.adapter.name,'server-private-byte-verifier');assert.equal(integrity.result.purpose,LIVE_INTAKE_PURPOSE);
const clean=await run('malware_scan');assert.equal(clean.outcome,'complete');assert.deepEqual(clean.result.next_steps,[]);
assert.deepEqual(clean.artifacts,[]);assert.deepEqual(clean.evidence,[]);assert.equal(clean.adapter.name,'clamav-stream');
checks.push('actual-native-adapter-byte-intake-stops-after-scan');
const ordinary=await run('malware_scan',native(),{source:{...source,capture_mode:'upload'}});
assert.deepEqual(ordinary.result.next_steps,['media_probe']);assert(!Object.hasOwn(ordinary.result,'purpose'));
checks.push('ordinary-upload-dag-unchanged');
for(const step of ['media_probe','diarize','separate','enhance','transcribe','voice_quality']){
  let effects=0;const adapters=new Proxy({}, {get(){effects++;throw Error('adapter-access-forbidden');}});
  await assert.rejects(()=>run(step,adapters),e=>e.code==='live_challenge_processing_forbidden');assert.equal(effects,0);
}
await assert.rejects(()=>run('integrity',native(),{source:{...source,state:'processing'}}),e=>e.code==='live_challenge_processing_forbidden');
checks.push('all-forbidden-and-historically-escaped-stages-refuse-before-adapter');
const infected=await run('malware_scan',native(()=>readClamAvVerdict({exitCode:1,stdout:'stdin: Eicar FOUND',stderr:''})));
assert.equal(infected.outcome,'blocked');assert.equal(infected.failure_code,'malware_detected');
const unavailable=await run('malware_scan',native(()=>readClamAvVerdict({exitCode:2,stdout:'',stderr:'connection refused'})));
assert.notEqual(unavailable.outcome,'complete');assert.equal(unavailable.failure_code,'clamav_daemon_unavailable');
assert.throws(()=>readClamAvVerdict({exitCode:0,stdout:'',stderr:''}));
const corrupt=await run('integrity',native(undefined,Buffer.from('wrong bytes')));assert.notEqual(corrupt.outcome,'complete');
checks.push('infection-scanner-error-empty-clean-response-and-byte-mismatch-refuse');
const receipt=processingCompletionReceipt(clean.result);assert.equal(receipt.purpose,LIVE_INTAKE_PURPOSE);
assert.notEqual(receipt.manifest_hash,processingCompletionReceipt({...clean.result,purpose:undefined}).manifest_hash);
assert.throws(()=>processingCompletionReceipt({...clean.result,next_steps:['media_probe']}));
assert.throws(()=>processingCompletionReceipt({...clean.result,artifact_ids:[randomUUID()]}));
checks.push('receipt-commits-purpose-and-forbids-derived-output');

// Remove the actual early guard, then run that changed source. The forbidden
// adapter is reached even though a later planner guard eventually rejects it.
const workerUrl=new URL('../api/_replica-processing/worker.js',import.meta.url);
const original=await readFile(workerUrl,'utf8');
const mutant=original.replace('  assertProcessingPurpose(source, job.step);','');assert.notEqual(mutant,original);
const absolute=mutant.replace(/from\s+(["'])(\.[^"']+)\1/g,(_,q,path)=>`from ${q}${new URL(path,workerUrl).href}${q}`);
const mutated=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
let calls=0;
await mutated.executeProcessingJob({source,job:job('media_probe'),completedSteps:['integrity','malware_scan'],adapters:{media_probe:{
  family:'media-probe',name:'ffprobe-sandbox',version:'v1',probe:async()=>{calls++;throw Object.assign(Error('intentional'),{code:'negative_control'});}}}});
assert.equal(calls,1);checks.push('actual-worker-source-guard-removal-reaches-forbidden-provider');

let queueSql,commitSql,splitSql,leaseSql,settleSql;
await leaseNextProcessingJob(async sql=>{queueSql=sql;return [];});assert(queueSql.includes(processingPurposeSql()));
assert(queueSql.includes('and intake_ch.expires_at>now()'));
assert(queueSql.includes(`and intake_r.policy_version='${REPLICA_POLICY_VERSION}'`));
await assert.rejects(()=>commitProcessingOutput(async sql=>{commitSql=sql;return [];},{jobId:randomUUID(),leaseToken:'x'.repeat(48),output:clean}));
assert(commitSql.includes(processingPurposeSql()));assert(commitSql.includes("source.capture_mode='live_challenge' then 'quarantined'"));
await assert.rejects(()=>completeProcessingJob(async sql=>{splitSql=sql;return [];},{jobId:randomUUID(),leaseToken:'x'.repeat(48),result:clean.result,adapter:clean.adapter}));
assert(splitSql.includes("s.capture_mode<>'live_challenge'"));
await leaseNextLivenessVerification(async sql=>{leaseSql=sql;return [];},{name:'azure_face_speech_composite',version:'fixture-v1',verify(){throw Error('not called');}});
const claim={challengeId:randomUUID(),replicaId:replica,ownerUserId:owner,sourceId:sid,attempt:1,leaseToken:'x'.repeat(48),
 phrase:'A code 123456',phraseHash:createHash('sha256').update('A code 123456').digest('hex'),verifierName:'azure_face_speech_composite',verifierVersion:'fixture-v1',
 identityReference:{sha256:sha},officialFaceProof:{livenessPassed:true,identityMatch:true,identityScore:1,referenceSha256:sha,providerDigest:sha,modelVersion:'fixture-v1',providerDeleted:true}};
const verdict=createLivenessVerdict(claim,{kind:'video',sha256:sha},{inputSha256:sha,recognizedText:'wrong 9999',speakerContinuityScore:0,syntheticRiskScore:1});
await assert.rejects(()=>completeLivenessVerification(async sql=>{settleSql=sql;return [];},claim,verdict));
assert(leaseSql.includes(liveIntakeReceiptsSql()));assert(settleSql.includes(liveIntakeReceiptsSql()));
assert.equal(verdict.passed,false);checks.push('actual-queue-commit-and-both-liveness-functions-include-guards-no-sql-proof');
console.log(JSON.stringify({suite:'liveness-intake',groups:checks.length,checks,sqlProof:false,scannerExecution:false}));
