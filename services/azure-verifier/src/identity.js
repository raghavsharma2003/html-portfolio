import { analyzeIdentityDocument, extractIdentityFacts } from "./document-intelligence.js";
import { inspectIdentityPortrait } from "./face.js";
import { fail } from "./errors.js";
import { fetchVerifiedDocument, validateDocumentDescriptor } from "./media.js";
import { independentDocumentReview } from "./review.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedCredentialExpiry(facts, review, now) {
  if (facts.expiration && facts.expiration.getTime() <= now.getTime()) return facts.expiration.toISOString();
  const recheck = new Date(now.getTime() + (review.nonExpiring ? 180 : 365) * 86_400_000);
  const expiry = facts.expiration && facts.expiration.getTime() < recheck.getTime() ? facts.expiration : recheck;
  return expiry.toISOString();
}

export async function verifyIdentityRequest(payload, config, options = {}) {
  if (payload?.protocol !== config.protocol || payload?.verifier_version !== config.version)
    fail("identity_protocol_binding_invalid", 400);
  const requestId = String(payload?.request_id || "");
  const identityCaseId = String(payload?.identity_case_id || "");
  const replicaId = String(payload?.replica_id || "");
  const sourceId = String(payload?.source_id || "");
  if (!/^([0-9a-f-]{36}):([1-9]\d*)$/i.test(requestId) || ![identityCaseId, replicaId, sourceId].every((id) => UUID.test(id)) ||
      !requestId.startsWith(`${identityCaseId}:`) || payload?.minimum_age !== 18) fail("identity_request_invalid", 400);
  const clockValue = typeof options.now === "function" ? options.now() : options.now;
  const now = clockValue instanceof Date ? clockValue : new Date(clockValue ?? Date.now());
  if (!Number.isFinite(now.getTime())) fail("verification_clock_invalid", 500);
  const descriptor = validateDocumentDescriptor(payload.document, config, now.getTime());
  const bytes = await fetchVerifiedDocument(descriptor, config, options);
  const [analysis, portrait, review] = await Promise.all([
    analyzeIdentityDocument(bytes, descriptor.mime, config, options),
    inspectIdentityPortrait(bytes, descriptor.mime, config, options),
    independentDocumentReview({
      requestId,
      sha256: descriptor.expectedHash,
      url: descriptor.url,
      expiresAt: payload.document.expires_at,
      mime: descriptor.mime,
      byteSize: descriptor.byteSize,
    }, config, options),
  ]);
  const facts = extractIdentityFacts(analysis.analyzeResult, now);
  return Object.freeze({
    request_id: requestId,
    input_sha256: descriptor.expectedHash,
    provider_accepted: true,
    extraction_confidence: facts.extractionConfidence,
    authenticity_score: review.authenticityScore,
    portrait_confidence: portrait.portraitConfidence,
    document_authentic: review.documentAuthentic,
    document_current: review.documentCurrent && !facts.documentExpired,
    adult_evidence: facts.adultEvidence,
    face_reference_ready: portrait.faceReferenceReady,
    credential_expires_at: boundedCredentialExpiry(facts, review, now),
  });
}
