import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {buildModernCaptureContract,validateModernCaptureContract,bindModernCaptureLease} from '../../api/_liveness/issued-contract.js';
import {createAzureSharedCaptureComposer,createModernSharedAudioLivenessVerifier} from '../../api/_liveness/azure-shared-audio.js';
import {configuredLivenessVerifier} from '../../api/_liveness/registry.js';
import {createAzureCompositeLivenessVerifier} from '../../api/_liveness/providers/azure-composite.js';
import {modernCaptureReadiness} from '../../api/_liveness/capture-readiness.js';
import {runLivenessVerificationSweep} from '../../api/_replica-liveness-verification.js';
import {getIssuedVoiceProfile} from '../../api/_voice-identity/issued-contract.js';
import {createAzureSpeechShortProvider} from '../../api/_asr/providers/azure-speech-short.js';
import {canonicalJson,sha256Hex} from '../../api/_replica-processing/contracts.js';

// Synthetic fixtures only. Actual production adapters, request signatures,
// WAV conversion and worker are used with injected transport/authority.
globalThis.fetch=async()=>{throw new Error('outbound_fetch_forbidden');};
let n=0;const test=async(name,fn)=>{await fn();console.log(`ok ${++n} - ${name}`);};
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-09-08T00:00:00.000Z'), capture=Buffer.from('synthetic opaque video fixture; not decoded by a model');
const revisions=getIssuedVoiceProfile().speaker.expected_candidate_revisions;
const ref={source_id:id(6),source_sha256:'c'.repeat(64),model_revisions:{...revisions},embeddings:[
 {family:'speechbrain-ecapa-voxceleb',vector:Array(192).fill(.01)},
 {family:'speechbrain-xvector-voxceleb',vector:Array(512).fill(.02)}]};
const input={challengeId:id(1),replicaId:id(2),ownerUserId:id(3),subjectPersonId:id(4),identityCaseId:id(5),
 primarySourceId:id(6),primarySelectionId:id(7),captureConsentId:id(8),storageConsentId:id(9),comparisonConsentId:id(10),
 identitySourceSha256:'b'.repeat(64),primarySourceSha256:'c'.repeat(64),referenceEvidenceSha256:sha256Hex(canonicalJson(ref)),
 comparisonReceiptSha256:'d'.repeat(64),locale:'hi-IN',sentenceItemId:'item-1',nonce:'1 2 3 4 5 6',
 issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+599000).toISOString()};
function setup(locale='hi-IN') {
 const envelope=buildModernCaptureContract({...input,locale});
 const lease={challengeId:id(1),replicaId:id(2),ownerUserId:id(3),sourceId:id(11),phrase:envelope.phrase,
  phraseHash:envelope.contract.phraseSha256,attempt:1,leaseToken:'test-lease-token-at-least-thirty-two-characters',
  source:{kind:'video',mime:'video/webm',sha256:sha256Hex(capture),byteSize:capture.length,storageBucket:'private-fixture',objectPath:'fixture.webm'},
  identityReference:{sha256:input.identitySourceSha256}};
 return {envelope,lease,authority:{envelope,expectedHash:envelope.contractSha256,reference:structuredClone(ref)}};
}
function wav() {
 const b=Buffer.alloc(44+2400*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
 b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);
 b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4800,40);
 for(let i=0;i<2400;i++)b.writeInt16LE(i%2?2000:-2000,44+i*2);return b;
}
const secret=Buffer.alloc(32,19),sign=(...p)=>createHmac('sha256',secret).update(p.join('\n')).digest('base64url');
const env={VYAKTI_MODEL_SERVING:'azure_only',AZURE_VOICE_EVIDENCE_ORIGIN:'https://evidence.test.azurecontainerapps.io',
 AZURE_VOICE_EVIDENCE_HMAC_SECRET:secret.toString('base64url'),AZURE_SPEECH_ENDPOINT:'https://speech-test.cognitiveservices.azure.com',AZURE_SPEECH_KEY:'synthetic-test-key'};
function harness({locale='hi-IN',mutatePayload,mutateAuthority,recognized,forged=false}={}) {
 const f=setup(locale),calls={authority:0,read:0,wake:0,derive:0,asr:0};const pcm=wav();
 const opts={env,now:()=>now,loadAuthority:async()=>{calls.authority++;return mutateAuthority?.(f.authority,calls,f) || f.authority;},
  resolveInput:async()=>{calls.read++;return {body:capture,mime:'video/webm',byteSize:capture.length};},
  fetchImpl:async(url,init)=>{
   url=new URL(url);assert.equal(init.redirect,'error');
   if(url.origin===env.AZURE_SPEECH_ENDPOINT){
    calls.asr++;assert.equal(url.searchParams.get('language'),locale);assert.equal(init.body.readUInt32LE(24),16000);
    assert.equal(init.body.readUInt32LE(40)/2,1600);
    return Response.json({RecognitionStatus:'Success',DisplayText:recognized ?? f.envelope.phrase});
   }
   assert.equal(url.origin,env.AZURE_VOICE_EVIDENCE_ORIGIN);
   if(url.pathname==='/healthz'){calls.wake++;return Response.json({});}
   calls.derive++;const req=JSON.parse(init.body),h=new Headers(init.headers),path='/v1/analyze';
   assert.equal(h.get('x-vyakti-signature'),sign('vyakti-voice-evidence/v1','POST',path,h.get('x-vyakti-timestamp'),h.get('x-vyakti-nonce'),sha256Hex(Buffer.from(init.body))));
   assert.equal(req.operation,'identity_audio_v1');assert.equal(req.challenge_contract_sha256,f.envelope.contractSha256);
   assert.deepEqual(Buffer.from(req.inputs[0].audio_base64,'base64'),capture);
   const parameters=getIssuedVoiceProfile().evidence.transform.parameters;
   const payload={schema:'vyakti.identity-audio.v1',challenge_contract_sha256:f.envelope.contractSha256,parent_sha256:sha256Hex(capture),
    canonical:{audio_base64:pcm.toString('base64'),sha256:sha256Hex(pcm),byte_size:pcm.length,mime:'audio/wav',
     sample_rate_hz:24000,channels:1,sample_format:'pcm_s16le',frames:2400,duration_ms:100},
    transform:{name:'capture-audio',version:'capture-to-pcm24k-v1',parameters,parameter_sha256:sha256Hex(canonicalJson(parameters)),
     decoder:{ffmpeg:'ffmpeg version synthetic-test',ffprobe:'ffprobe version synthetic-test'},input_stream_index:1},
    speaker_input_sha256:sha256Hex(pcm),embeddings:ref.embeddings.map(r=>({...r,input_key:'input-1',confidence:.5})),
    confidence:.5,measurements:{fixture:true},quality:{not_calibrated:true},model_revisions:{...revisions}};
   mutatePayload?.(payload);const body=Buffer.from(JSON.stringify(payload));
   return new Response(body,{headers:{'X-Vyakti-Response-Signature':forged?'invalid':sign('vyakti-voice-evidence/v1','response',path,h.get('x-vyakti-nonce'),'200',sha256Hex(body))}});
  }};
 return {...f,calls,opts,composer:createAzureSharedCaptureComposer(opts)};
}

await test('new primary-reference contract has no first-enrollment VoiceGenome dependency',()=>{
 const f=setup();assert.deepEqual(validateModernCaptureContract(f.envelope,f.envelope.contractSha256,now),f.envelope);
 assert.ok(Object.isFrozen(f.envelope.contract));assert.equal('referenceGenomeVersion' in f.envelope.contract,false);
 assert.deepEqual(bindModernCaptureLease(f.envelope,f.lease),f.envelope);
});
for(const key of Object.keys(input).filter(k=>k!=='issuedAt'&&k!=='expiresAt'))await test(`issued commitment rejects changed ${key}`,()=>{
 const f=setup(),changed=structuredClone(f.envelope);if(key==='nonce')changed.nonce='6 5 4 3 2 1';else changed.contract[key]=key.endsWith('Id')?id(99):'changed';
 assert.throws(()=>validateModernCaptureContract(changed,f.envelope.contractSha256,now));
});
for(const [label,at] of [['expired',now+599000],['not yet issued',now-1001]])await test(label,()=>{
 const f=setup();assert.throws(()=>validateModernCaptureContract(f.envelope,f.envelope.contractSha256,at),/expired/);
});
await test('missing independent commitment and legacy receipt refuse',()=>{
 assert.throws(()=>validateModernCaptureContract(setup().envelope,null,now),/unavailable/);
 assert.throws(()=>validateModernCaptureContract({receipt_format:'vyakti-consent-v1'},'a'.repeat(64),now));
});
await test('accessors and extra properties are refused without invocation',()=>{
 let invoked=false;const changed={...input};Object.defineProperty(changed,'locale',{get(){invoked=true;return 'hi-IN';}});
 assert.throws(()=>buildModernCaptureContract(changed));assert.equal(invoked,false);
 assert.throws(()=>buildModernCaptureContract({...input,grant:true}));
});
for(const locale of ['hi-IN','en-IN'])await test(`real signed derivation and Azure STT adapter share exact audio: ${locale}`,async()=>{
 const h=harness({locale}),r=await h.composer.compose(h.lease);
 assert.equal(r.status,'incomplete');assert.equal(r.servable,false);assert.equal(r.nonceMatched,true);
 assert.equal(r.canonicalSha256,r.asrCommitment.inputSha256);assert.equal(r.speakerSimilarities.length,2);
 assert.deepEqual(h.calls,{authority:4,read:1,wake:1,derive:1,asr:1});
 assert.equal(/transcript|embedding|storageBucket|objectPath|speakerContinuityScore|syntheticRiskScore/.test(JSON.stringify(r)),false);
});
await test('wrong nonce stays rejected with real measured embeddings, never passes identity',async()=>{
 const h=harness({recognized:'Code 6 5 4 3 2 1'}),r=await h.composer.compose(h.lease);assert.equal(r.status,'rejected');assert.equal(r.nonceMatched,false);
});
for(const [name,mutate] of [
 ['capture parent',p=>p.parent_sha256='f'.repeat(64)],['issued contract',p=>p.challenge_contract_sha256='f'.repeat(64)],
 ['speaker input',p=>p.speaker_input_sha256='f'.repeat(64)],['canonical hash',p=>p.canonical.sha256='f'.repeat(64)],
 ['model revision',p=>p.model_revisions['speechbrain-ecapa']='f'.repeat(40)],['wrong geometry',p=>p.canonical.frames++],
 ['VAD revision',p=>p.model_revisions['silero-vad']='different-vad-v1'],
 ['wrong dimensions',p=>p.embeddings[0].vector=Array(193).fill(.01)]])await test(`signed wrong ${name} refuses before STT`,async()=>{
 const h=harness({mutatePayload:mutate});await assert.rejects(()=>h.composer.compose(h.lease));assert.equal(h.calls.asr,0);
});
await test('forged service signature refuses before STT',async()=>{const h=harness({forged:true});await assert.rejects(()=>h.composer.compose(h.lease));assert.equal(h.calls.asr,0);});
for(const stage of [2,3,4])await test(`fresh authority refuses at boundary ${stage}`,async()=>{
 const h=harness({mutateAuthority:(a,c)=>{if(c.authority===stage)throw Object.assign(new Error('consent_revoked'),{code:'consent_revoked'});}});
 await assert.rejects(()=>h.composer.compose(h.lease),/consent_revoked/);assert.equal(h.calls.asr,stage===4?1:0);
});
await test('changed reference evidence refuses before any media read',async()=>{
 const h=harness({mutateAuthority:a=>({...a,reference:{...a.reference,source_id:id(77)}})});
 await assert.rejects(()=>h.composer.compose(h.lease),/reference_mismatch/);assert.equal(h.calls.read,0);
});
await test('changed lease during derivation is withheld',async()=>{
 const h=harness({mutateAuthority:(a,c,f)=>{if(c.authority===2)f.lease.source.sha256='f'.repeat(64);}});
 await assert.rejects(()=>h.composer.compose(h.lease),/lease_mismatch/);assert.equal(h.calls.asr,0);assert.equal(h.calls.read,0);
});
await test('Azure-only restriction applies even without the deployment strict flag',async()=>{
 const h=harness(),composer=createAzureSharedCaptureComposer({...h.opts,env:{...env,VYAKTI_MODEL_SERVING:''},endpoint:'https://not-azure.example'});
 await assert.rejects(()=>composer.compose(h.lease),/model_serving_origin_denied/);assert.equal(h.calls.read,0);
});
for(const field of ['inputSha256','transportSha256','inputFrames','transform'])await test(`actual STT result with wrong ${field} is refused`,async()=>{
 const h=harness(),real=createAzureSpeechShortProvider(h.opts);
 const composer=createAzureSharedCaptureComposer({...h.opts,speech:{transcribeBytes:async input=>{
  const result=await real.transcribeBytes(input);return {...result,audioCommitment:{...result.audioCommitment,[field]:'swapped'}};
 }}});
 await assert.rejects(()=>composer.compose(h.lease),/asr_binding_mismatch/);assert.equal(h.calls.asr,1);
});
await test('valid reissued primary commitment after derivation is refused',async()=>{
 const h=harness({mutateAuthority:(a,c)=>{
  if(c.authority===3){const envelope=buildModernCaptureContract({...input,primarySelectionId:id(44)});return {...a,envelope,expectedHash:envelope.contractSha256};}
 }});await assert.rejects(()=>h.composer.compose(h.lease),/authority_changed/);assert.equal(h.calls.asr,0);
});
await test('expired issued authority after STT never returns evidence',async()=>{
 const h=harness();let reads=0;const composer=createAzureSharedCaptureComposer({...h.opts,now:()=>++reads>=4?now+600000:now});
 await assert.rejects(()=>composer.compose(h.lease),/expired/);assert.equal(h.calls.asr,1);
});
await test('mutated PCM during STT cannot be rebound as a new canonical source',async()=>{
 const h=harness(),real=createAzureSpeechShortProvider(h.opts);
 const composer=createAzureSharedCaptureComposer({...h.opts,speech:{transcribeBytes:async input=>{
  const result=await real.transcribeBytes(input);input.bytes[44]^=1;return result;
 }}});await assert.rejects(()=>composer.compose(h.lease),/audio_mismatch/);
});
await test('abort before authority does no work',async()=>{const h=harness();await assert.rejects(()=>h.composer.compose(h.lease,{signal:AbortSignal.abort()}),/aborted/);assert.equal(h.calls.authority,0);});
await test('production registry worker refuses missing persistence before private reads or network',async()=>{
 const verifier=configuredLivenessVerifier({env:{REPLICA_LIVENESS_VERIFIER:'azure_face_speech_composite',AZURE_COMPOSITE_LIVENESS_ENABLED:'true',
  AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED:'true',AZURE_COMPOSITE_LIVENESS_ENDPOINT:'https://composite.test.azurecontainerapps.io/v1/liveness/verify',
  AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64:Buffer.alloc(32,3).toString('base64'),AZURE_COMPOSITE_LIVENESS_VERSION:'test-v2'}});
 let completed=0,retried=0;
 const result=await runLivenessVerificationSweep({db:async()=>{throw new Error('sql_forbidden');},verifier,maxJobs:1,
  expire:async()=>0,lease:async()=>setup().lease,complete:async()=>completed++,retry:async(_db,_lease,{error})=>{assert.equal(error.code,'liveness_issued_capture_unavailable');retried++;}});
 assert.equal(completed,0);assert.equal(retried,1);assert.equal(result.passed,0);
});
await test('original registry target reaches private signing without issued authority; new wrapper prevents it',async()=>{
 let signing=0;const options={env:{REPLICA_LIVENESS_VERIFIER:'azure_face_speech_composite',AZURE_COMPOSITE_LIVENESS_ENABLED:'true',
  AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED:'true',AZURE_COMPOSITE_LIVENESS_ENDPOINT:'https://composite.test.azurecontainerapps.io/v1/liveness/verify',
  AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64:Buffer.alloc(32,3).toString('base64'),AZURE_COMPOSITE_LIVENESS_VERSION:'test-v2'},
  signRead:async()=>{signing++;throw new Error('synthetic_signing_boundary');}};
 await assert.rejects(()=>createAzureCompositeLivenessVerifier(options).verify(setup().lease),/synthetic_signing_boundary/);assert.equal(signing,2);
 signing=0;await assert.rejects(()=>configuredLivenessVerifier(options).verify(setup().lease),/issued_capture_unavailable/);assert.equal(signing,0);
});
await test('actual worker cannot settle partial measurements and never calls composite fallback',async()=>{
 const h=harness();let complete=0,retry=0,composite=0;
 const verifier=createModernSharedAudioLivenessVerifier({name:'azure_face_speech_composite',version:'test-v2',verify:async()=>composite++},{composer:h.composer});
 await runLivenessVerificationSweep({db:async()=>[],verifier,maxJobs:1,expire:async()=>0,lease:async()=>h.lease,complete:async()=>complete++,
  retry:async(_db,_lease,{error})=>{retry++;assert.equal(error.code,'liveness_issued_capture_composite_evidence_unavailable');assert.equal(error.evidence.status,'incomplete');}});
 assert.equal(complete,0);assert.equal(composite,0);assert.equal(retry,1);assert.equal(h.calls.asr,1);
});
await test('serving readiness remains unavailable with configuration flags',()=>assert.equal(modernCaptureReadiness({env}).ready,false));
console.log(`${n} modern issued capture controls passed; zero live calls, zero identity acceptance`);
