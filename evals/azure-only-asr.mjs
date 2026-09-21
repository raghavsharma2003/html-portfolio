import assert from 'node:assert/strict';
import { createLiveAsrProvider, createProductionAsrProvider } from '../api/_asr/registry.js';
import { createVoiceChallengeVerifier, configuredVoiceChallengeVerifier } from '../api/_voice-identity/verifier.js';
import { selfHostedAsrConfig } from '../api/_asr/providers/self-hosted.js';
import { openChatterboxConfig } from '../api/_voice/providers/open-chatterbox-preview.js';
import { azureVoiceEvidenceConfig } from '../api/_replica-processing/providers/azure-voice-evidence.js';
const strict = { VYAKTI_MODEL_SERVING: 'azure_only', SARVAM_API_KEY: 'fixture-not-a-real-key' };
assert.throws(() => createLiveAsrProvider(strict), { code: 'azure_live_asr_unavailable' });
assert.throws(() => createProductionAsrProvider(strict), { code: 'azure_ingestion_asr_unavailable' });
assert.throws(() => createLiveAsrProvider({ ...strict, ASR_SELF_HOSTED_ORIGIN: 'https://external.example', ASR_HMAC_SECRET: 'a'.repeat(64) }), { code: 'model_serving_origin_denied' });
assert.throws(() => createLiveAsrProvider({ ...strict, AZURE_SPEECH_ENDPOINT: 'https://external.example', AZURE_SPEECH_KEY: 'fixture' }), { code: 'model_serving_origin_denied' });
const azure = createLiveAsrProvider({ ...strict, AZURE_SPEECH_ENDPOINT: 'https://speech.cognitiveservices.azure.com', AZURE_SPEECH_KEY: 'fixture' });
assert.equal(azure.name, 'azure-speech-short');
assert.throws(() => createVoiceChallengeVerifier({ env: strict }), { code: 'azure_voice_challenge_verifier_unavailable' });
// The factory takes {env}; this explicit case proves no injected evidence or
// transcript can accidentally relabel the old verifier as Azure-compatible.
assert.throws(() => createVoiceChallengeVerifier({ env: strict, evidence: {}, asr: {} }), { code: 'azure_voice_challenge_verifier_unavailable' });
assert.equal(configuredVoiceChallengeVerifier({ env: strict }), null);
assert.ok(createLiveAsrProvider({ SARVAM_API_KEY: 'fixture-not-a-real-key' }));
for (const [factory, key] of [[selfHostedAsrConfig,'ASR_SELF_HOSTED_ORIGIN'],[openChatterboxConfig,'AZURE_OPEN_VOICE_ORIGIN'],[azureVoiceEvidenceConfig,'AZURE_VOICE_EVIDENCE_ORIGIN']]) {
  assert.throws(() => factory({ ...strict, [key]: 'https://external.example' }), { code:'model_serving_origin_denied' });
}
console.log('Azure-only ASR: provider selection, forbidden origins, legacy-verifier disablement and explicit legacy-mode construction pass. No network or audio.');
