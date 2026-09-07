import { canonicalJson, sha256Hex } from '../_replica-processing/contracts.js';
import { createAzureVoiceEvidenceAdapters } from '../_replica-processing/providers/azure-voice-evidence.js';
import { createAzureSpeechShortProvider, resample24kPcm16To16kWav } from '../_asr/providers/azure-speech-short.js';
import { readPrivateReplicaObject } from '../_replica-storage.js';
import { getIssuedVoiceProfile } from '../_voice-identity/issued-contract.js';
import { matchesIssuedNonceV2 } from '../_voice-identity/nonce-v2.js';
import { fidelityScore } from '../_fidelity.js';
import { validateModernCaptureContract, bindModernCaptureLease, captureContractError } from './issued-contract.js';

const FAMILIES = {'speechbrain-ecapa-voxceleb':'speechbrain-ecapa','speechbrain-xvector-voxceleb':'speechbrain-xvector'};
const fail = part => { throw captureContractError(part,503); };
// No authority port means no permission. The registry supplies the persisted
// SQL loader when a DB is available; standalone construction still refuses.
export async function unavailableModernCaptureAuthority() { fail('unavailable'); }

function referenceSnapshot(reference, c) {
  if (!reference || sha256Hex(canonicalJson(reference))!==c.referenceEvidenceSha256 ||
      reference.source_id!==c.primarySourceId || reference.source_sha256!==c.primarySourceSha256 ||
      !Array.isArray(reference.embeddings) || reference.embeddings.length!==2) fail('reference_mismatch');
  const snapshot=JSON.parse(JSON.stringify(reference));
  if(Object.entries(getIssuedVoiceProfile().speaker.expected_candidate_revisions).some(([model,revision])=>
    snapshot.model_revisions?.[model]!==revision)) fail('reference_revision_incompatible');
  for (const [family,model] of Object.entries(FAMILIES)) {
    const rows=snapshot.embeddings.filter(row=>row.family===family);
    if (rows.length!==1 || !Array.isArray(rows[0].vector) || rows[0].vector.length<64 || rows[0].vector.length>2048 ||
        rows[0].vector.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>10) ||
        !rows[0].vector.some(n=>n!==0) || snapshot.model_revisions?.[model]!==getIssuedVoiceProfile().speaker.expected_candidate_revisions[model])
      fail('reference_revision_incompatible');
  }
  return snapshot;
}

// Private evidence composition only. Injected authority must re-read the exact
// lease/consent/selection tuple each time; no request body may supply this port.
// Result intentionally cannot be passed to createLivenessVerdict: no recognized
// transcript, embeddings, liveness verdict or fabricated risk/continuity score.
export function createAzureSharedCaptureComposer(options = {}) {
  const loadAuthority=options.loadAuthority || unavailableModernCaptureAuthority;
  const now=options.now || Date.now;
  const azureOptions={...options,env:{...(options.env || process.env),VYAKTI_MODEL_SERVING:'azure_only'}};
  let evidence, speech;
  const adapters = () => {
    evidence ||= options.evidence || createAzureVoiceEvidenceAdapters({...azureOptions,
      resolveInput: options.resolveInput || (async ({source,signal}) => {
        const object=await readPrivateReplicaObject({storageBucket:source.storageBucket,objectPath:source.objectPath},
          {fetchImpl:options.fetchImpl,signal,maxBytes:33554432});
        return {body:object.body,mime:source.mime,byteSize:source.byteSize};
      })}).identity_audio;
    speech ||= options.speech || createAzureSpeechShortProvider(azureOptions);
    return {evidence,speech};
  };
  return Object.freeze({ async compose(lease, {signal} = {}) {
    const checkAbort=()=>{if(signal?.aborted)fail('aborted');};
    checkAbort();
    const initial=await loadAuthority(lease);
    const issued=bindModernCaptureLease(validateModernCaptureContract(initial?.envelope,initial?.expectedHash,now()),lease);
    const c=issued.contract, reference=referenceSnapshot(initial.reference,c);
    const capture={...lease.source};
    const currentScope=()=>canonicalJson({challengeId:lease.challengeId,replicaId:lease.replicaId,ownerUserId:lease.ownerUserId,
      sourceId:lease.sourceId,source:lease.source,attempt:lease.attempt,leaseToken:lease.leaseToken});
    const scope=currentScope();
    const fresh=async()=>{
      checkAbort();
      if(currentScope()!==scope) fail('lease_mismatch');
      const a=await loadAuthority(lease);
      const current=bindModernCaptureLease(validateModernCaptureContract(a?.envelope,a?.expectedHash,now()),lease);
      if(current.contractSha256!==issued.contractSha256)fail('authority_changed');
      referenceSnapshot(a.reference,c); checkAbort();
      if(currentScope()!==scope) fail('lease_mismatch');
    };
    await fresh();
    const {evidence,speech}=adapters();
    const audio=await evidence.derive({source:capture,inputs:[{mime:capture.mime,sha256:capture.sha256}],
      challengeContractSha256:issued.contractSha256,signal});
    await fresh();
    if(audio.parent_sha256!==capture.sha256 || audio.challenge_contract_sha256!==issued.contractSha256 ||
        !Buffer.isBuffer(audio.canonical?.body) || sha256Hex(audio.canonical.body)!==audio.canonical.sha256 ||
        audio.speaker_input_sha256!==audio.canonical.sha256)fail('audio_mismatch');
    const bytes=Buffer.from(audio.canonical.body), similarities=[];
    if(Object.keys(getIssuedVoiceProfile().speaker.expected_candidate_revisions).some(model=>
      audio.model_revisions?.[model]!==reference.model_revisions[model]))fail('candidate_revision_incompatible');
    for(const [family,model] of Object.entries(FAMILIES)) {
      const candidates=audio.embeddings?.filter(row=>row.family===family) || [];
      if(candidates.length!==1 || audio.model_revisions?.[model]!==reference.model_revisions[model])fail('candidate_revision_incompatible');
      const score=fidelityScore([reference.embeddings.find(row=>row.family===family).vector],[candidates[0].vector]);
      similarities.push({family,model_revision:audio.model_revisions[model],cosine:score.mean});
    }
    const asr=await speech.transcribeBytes({bytes,sha256:audio.canonical.sha256,byteSize:bytes.length,locale:c.locale});
    await fresh();
    if(sha256Hex(bytes)!==audio.canonical.sha256)fail('audio_mismatch');
    const transport=resample24kPcm16To16kWav(bytes), commitment=asr.audioCommitment;
    const expected={inputSha256:sha256Hex(bytes),inputByteSize:bytes.length,inputSampleRate:transport.source.sampleRate,
      inputFrames:transport.source.frames,transportSha256:sha256Hex(transport.bytes),transportByteSize:transport.bytes.length,
      transportSampleRate:16000,transportFrames:transport.bytes.readUInt32LE(40)/2,transform:transport.transform};
    if(!commitment || canonicalJson(commitment)!==canonicalJson(expected) || asr.languageCode!==c.locale ||
        !Array.isArray(asr.turns) || asr.turns.some(turn=>typeof turn.text!=='string'))fail('asr_binding_mismatch');
    const text=asr.turns.map(turn=>turn.text).join(' ');
    if(!text || text.length>4000)fail('asr_binding_mismatch');
    const nonceMatched=matchesIssuedNonceV2(issued.nonce,text);
    return Object.freeze({schema:'vyakti.modern-capture-measurements.v1',status:nonceMatched?'incomplete':'rejected',
      reason:nonceMatched?'composite_evidence_unavailable':'spoken_code_mismatch',servable:false,
      contractSha256:issued.contractSha256,captureSha256:capture.sha256,canonicalSha256:audio.canonical.sha256,
      asrCommitment:Object.freeze(expected),nonceMatched,speakerSimilarities:Object.freeze(similarities.map(Object.freeze)),
      missing:Object.freeze(['calibrated_visual_audio_continuity','synthetic_media_risk','same_capture_face_binding',
        'source_ownership_decision','reviewed_phrase_acceptance'])});
  }});
}

// Actual production modern registry caller. A successful partial measurement
// still throws before the legacy verdict/settlement path; no fake score filling.
export function createModernSharedAudioLivenessVerifier(verifier, options = {}) {
  const composer=options.composer || createAzureSharedCaptureComposer(options);
  return Object.freeze({name:verifier.name,version:verifier.version,async verify(lease) {
    const evidence=await composer.compose(lease);
    throw Object.assign(captureContractError('composite_evidence_unavailable',503),{evidence});
  }});
}
