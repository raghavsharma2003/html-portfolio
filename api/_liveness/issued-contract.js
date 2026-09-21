import { canonicalJson, sha256Hex } from '../_replica-processing/contracts.js';
import { getIssuedVoiceBank, getIssuedVoiceProfile } from '../_voice-identity/issued-contract.js';
import { IDENTITY_NONCE_V2 } from '../_voice-identity/nonce-v2.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const IDS = ['challengeId','replicaId','ownerUserId','subjectPersonId','identityCaseId',
  'primarySourceId','primarySelectionId','captureConsentId','storageConsentId','comparisonConsentId'];
const HASHES = ['identitySourceSha256','primarySourceSha256','referenceEvidenceSha256','comparisonReceiptSha256'];
const INPUT = [...IDS,...HASHES,'locale','sentenceItemId','nonce','issuedAt','expiresAt'];
export const MODERN_CAPTURE_PROFILE = Object.freeze({ id: 'modern-shared-capture/v1',
  servable: false, status: 'prerequisite-only', comparisonStatementSet: 'selected-voice-comparison/v1',
  nonceParserVersion: IDENTITY_NONCE_V2.version,
  evidenceProfileSha256: getIssuedVoiceProfile().sha256 });

export function captureContractError(part, status = 409) {
  const code = `liveness_issued_capture_${part}`;
  return Object.assign(new Error(code), { code, status, waiting_on: 'us' });
}
function exact(value, fields) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length || Reflect.ownKeys(value).some(key =>
        !fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))
    throw captureContractError('shape_invalid');
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

// Server-owned issuance proposal. A hash is not consent, issuance or proof of
// ownership. No VoiceGenome dependency: this contract precedes first enrollment.
// Existing banks remain explicitly unreviewed; reusing them does not promote them.
export function buildModernCaptureContract(input) {
  exact(input, INPUT);
  if (IDS.some(k => typeof input[k] !== 'string' || !UUID.test(input[k])) ||
      HASHES.some(k => typeof input[k] !== 'string' || !SHA.test(input[k])))
    throw captureContractError('binding_invalid');
  if (typeof input.nonce !== 'string' || !/^[0-9]( [0-9]){5}$/.test(input.nonce))
    throw captureContractError('nonce_invalid');
  for (const key of ['issuedAt','expiresAt']) {
    if (typeof input[key] !== 'string' || !Number.isFinite(Date.parse(input[key])) ||
        new Date(input[key]).toISOString() !== input[key]) throw captureContractError('time_invalid');
  }
  const lifetime = Date.parse(input.expiresAt)-Date.parse(input.issuedAt);
  if (lifetime <= 0 || lifetime > 600000) throw captureContractError('time_invalid');
  const bank = getIssuedVoiceBank(input.locale);
  const item = bank.items.find(row => row.id === input.sentenceItemId);
  if (!item) throw captureContractError('sentence_invalid');
  const phrase = `${item.text}. ${input.locale === 'hi-IN' ? 'कोड' : 'Code'} ${input.nonce}.`;
  const contract = { schema:'vyakti.modern-issued-capture.v1', ...Object.fromEntries(INPUT.filter(k=>k!=='nonce').map(k=>[k,input[k]])),
    nonceSha256:sha256Hex(input.nonce), phraseSha256:sha256Hex(phrase), bankVersion:bank.version,
    bankSha256:bank.sha256, profile:MODERN_CAPTURE_PROFILE.id,
    profileSha256:sha256Hex(canonicalJson(MODERN_CAPTURE_PROFILE)) };
  return freeze({ contract, contractSha256:sha256Hex(canonicalJson(contract)), nonce:input.nonce, phrase });
}

// expectedHash must come from independently persisted server authority, never
// envelope.contractSha256 alone. issued-authority.js persists and reloads it;
// this pure validator grants no permission and produces no identity verdict.
export function validateModernCaptureContract(envelope, expectedHash, now = Date.now()) {
  if (!envelope || !expectedHash) throw captureContractError('unavailable',503);
  exact(envelope,['contract','contractSha256','nonce','phrase']);
  exact(envelope.contract,[...INPUT.filter(k=>k!=='nonce'),'schema','nonceSha256','phraseSha256',
    'bankVersion','bankSha256','profile','profileSha256']);
  if (typeof expectedHash !== 'string' || !SHA.test(expectedHash) || envelope.contractSha256 !== expectedHash)
    throw captureContractError('commitment_mismatch');
  const rebuilt = buildModernCaptureContract({...Object.fromEntries(INPUT.filter(k=>k!=='nonce').map(k=>[k,envelope.contract[k]])),nonce:envelope.nonce});
  if (rebuilt.contractSha256 !== expectedHash || envelope.phrase !== rebuilt.phrase ||
      Object.keys(rebuilt.contract).some(k=>rebuilt.contract[k] !== envelope.contract[k]))
    throw captureContractError('commitment_mismatch');
  if (!Number.isFinite(now) || Date.parse(rebuilt.contract.issuedAt)>now || Date.parse(rebuilt.contract.expiresAt)<=now)
    throw captureContractError('expired');
  return rebuilt;
}

export function bindModernCaptureLease(issued, lease) {
  const c=issued.contract;
  if (!lease || ['challengeId','replicaId','ownerUserId'].some(k=>lease[k]!==c[k]) ||
      lease.phrase!==issued.phrase || lease.phraseHash!==c.phraseSha256 ||
      lease.identityReference?.sha256!==c.identitySourceSha256 ||
      !UUID.test(lease.sourceId || '') || lease.source?.kind!=='video' ||
      !['video/webm','video/mp4'].includes(lease.source.mime) || !SHA.test(lease.source.sha256 || '') ||
      !Number.isSafeInteger(lease.source.byteSize) || lease.source.byteSize<1 || lease.source.byteSize>33554432)
    throw captureContractError('lease_mismatch');
  return issued;
}
