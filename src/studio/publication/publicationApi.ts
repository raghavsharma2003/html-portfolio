import { replicaRequest } from "../replicaApi";

export type PublicationTerms = {
  audience: "signed_in_adult_attestation";
  publication_days: 30; retention_days: 30;
  visitor_question_limit: 20; total_question_limit: 200;
  budget_microusd: number; quota_policy: "admission_counts";
  memory: false; voice: false;
};
export type Publication = {
  public_id: string; replica_id?: string; version: 1;
  state: "active" | "revoked" | "expired" | "unavailable";
  title: string; subject_domain: string; disclosure: string; disclosure_hash: string;
  terms: PublicationTerms; created_at: string; expires_at: string;
  can_text: boolean; can_voice: false;
};
export type PublicationTombstone = {
  public_id: string; replica_id?: string; state: "revoked"; version: 1;
  publication_never_created: true; can_text: false; can_voice: false; created_at: string; expires_at: string;
};
export type PublicationProjection = {
  name: string; subjectDomain: "physics" | "chemistry" | "maths";
  syllabusScope?: string; languageTextRule?: string; technicalTermRule?: string;
  explanationOrder?: string; workedExamplePattern?: string; firstMoveOnDoubt?: string;
  notationConventions?: string; subjectStrands?: string[]; examTrack?: string[];
  doubtEscalationLadder?: string[]; rigorFloor?: string[];
  warmth?: number; strictness?: number; pacePreference?: "push" | "balanced" | "drill";
};
export type PublicationReadiness = {
  replica_id: string; state: "ready" | "needs_input" | "unavailable" | "stopped";
  blockers: { code: string; responsibility: "owner" | "platform" }[];
  drafts: { sheet_id: string; name: string; updated_at: string; status: string }[];
  context_items: { item_id: string; source_name: string; status: string; format: string;
    authorship: string; source_id: string | null; source_ready: boolean; eligible: boolean; reason: string | null }[];
  selected: null | { review_hash: string; source_name: string; projection: PublicationProjection;
    material_text: string; terms: PublicationTerms };
  statement_set: string; statements: { id: string; text: string }[];
  can_publish: boolean; publications: Publication[];
};
export type PublicationRequest = {
  public_id: string; request_id: string; state: "pending" | "complete" | "blocked" | "uncertain" | "withdrawn";
  billing_state: string; failure_code?: string; answer?: string; can_voice: false; created_at: string;
};
export type PublicationAdmission = {
  publication: Publication; session_token: string; expires_at: string; remaining_questions: number;
};
const OWNER = "/api/replica-text-publication";
const VISITOR = "/api/text-publication";
const invalid = (): never => { throw new Error("publication_response_invalid"); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function validatePublication(value: unknown, publicId?: string): Publication {
  if (!record(value)) return invalid();
  if (typeof value.public_id !== "string" || publicId && value.public_id !== publicId ||
      value.version !== 1 || !["active", "revoked", "expired", "unavailable"].includes(String(value.state)) ||
      typeof value.title !== "string" || typeof value.disclosure !== "string" || typeof value.disclosure_hash !== "string" ||
      value.can_voice !== false || typeof value.can_text !== "boolean" || !record(value.terms)) invalid();
  const terms = value.terms as Record<string, unknown>;
  if (terms.audience !== "signed_in_adult_attestation" || terms.memory !== false || terms.voice !== false ||
      terms.quota_policy !== "admission_counts" || terms.publication_days !== 30 || terms.retention_days !== 30 ||
      terms.visitor_question_limit !== 20 || terms.total_question_limit !== 200 ||
      typeof terms.budget_microusd !== "number" || !Number.isSafeInteger(terms.budget_microusd) || terms.budget_microusd <= 0) invalid();
  return value as unknown as Publication;
}
export function validatePublicationRequest(value: unknown, publicId: string, requestId: string): PublicationRequest {
  if (!record(value) || value.public_id !== publicId || value.request_id !== requestId || value.can_voice !== false ||
      !["pending", "complete", "blocked", "uncertain", "withdrawn"].includes(String(value.state)) || typeof value.billing_state !== "string" ||
      (value.state === "complete" ? typeof value.answer !== "string" || !value.answer.trim() : value.answer !== undefined)) invalid();
  return value as unknown as PublicationRequest;
}
export function validateOwnedPublication(value: unknown, publicId: string): Publication | PublicationTombstone {
  if (record(value) && value.publication_never_created === true) {
    if (value.public_id !== publicId || value.state !== "revoked" || value.version !== 1 || value.can_text !== false || value.can_voice !== false ||
        typeof value.created_at !== "string" || typeof value.expires_at !== "string" || value.terms !== undefined || value.title !== undefined || value.disclosure !== undefined) invalid();
    return value as unknown as PublicationTombstone;
  }
  return validatePublication(value, publicId);
}
const post = <T>(token: string, path: string, body: unknown, signal?: AbortSignal) =>
  replicaRequest<T>(token, path, { method: "POST", body: JSON.stringify(body), signal });

export async function publicationReadiness(token: string, replicaId: string, sheetId = "", itemId = "", signal?: AbortSignal) {
  const query = new URLSearchParams({ op: "readiness", replica_id: replicaId });
  if (sheetId) query.set("sheet_id", sheetId);
  if (itemId) query.set("context_item_id", itemId);
  const data = await replicaRequest<{ readiness: PublicationReadiness }>(token, `${OWNER}?${query}`, { signal });
  if (!data.readiness || !Array.isArray(data.readiness.drafts) || !Array.isArray(data.readiness.context_items) ||
      !Array.isArray(data.readiness.statements) || !Array.isArray(data.readiness.publications) || !Array.isArray(data.readiness.blockers))
    throw new Error("publication_response_invalid");
  if (data.readiness.replica_id !== replicaId || typeof data.readiness.can_publish !== "boolean" ||
      !data.readiness.statements.every(s => typeof s.id === "string" && typeof s.text === "string") ||
      new Set(data.readiness.statements.map(s => s.id)).size !== data.readiness.statements.length) invalid();
  data.readiness.publications.forEach(p => validatePublication(p));
  if (data.readiness.selected && (typeof data.readiness.selected.review_hash !== "string" ||
      typeof data.readiness.selected.material_text !== "string" || !record(data.readiness.selected.projection))) invalid();
  return data.readiness;
}
export const publishMaterial = (token: string, body: {
  replica_id: string; sheet_id: string; context_item_id: string; publication_id: string;
  expected_review_hash: string; statement_set: string; attestations: Record<string, boolean>;
}) => post<{ publication: Publication | PublicationTombstone }>(token, OWNER, { op: "publish", ...body }).then(data => ({ publication: validateOwnedPublication(data.publication, body.publication_id) }));
export const publicationStatus = (token: string, replicaId: string, publicationId: string, signal?: AbortSignal) =>
  replicaRequest<{ publication: Publication | PublicationTombstone }>(token, `${OWNER}?${new URLSearchParams({ op: "status", replica_id: replicaId, publication_id: publicationId })}`, { signal }).then(data => ({ publication: validateOwnedPublication(data.publication, publicationId) }));
export const unpublishMaterial = (token: string, replicaId: string, publicationId: string) =>
  post<{ publication: Publication | PublicationTombstone }>(token, OWNER, { op: "unpublish", replica_id: replicaId, publication_id: publicationId }).then(data => ({ publication: validateOwnedPublication(data.publication, publicationId) }));
export async function openPublication(publicId: string, signal?: AbortSignal): Promise<Publication> {
  const response = await fetch(`${VISITOR}?${new URLSearchParams({ op: "open", public_id: publicId })}`, {
    signal: signal || AbortSignal.timeout(20_000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data?.publication || typeof data.publication.title !== "string") throw new Error("publication_unavailable");
  return validatePublication(data.publication, publicId);
}
export const joinPublication = (token: string, publicId: string, disclosureHash: string) =>
  post<PublicationAdmission>(token, VISITOR, { op: "join", public_id: publicId, expected_disclosure_hash: disclosureHash,
    is_adult: true, accept_ai_disclosure: true, accept_retention: true }).then(data => {
      validatePublication(data.publication, publicId);
      if (typeof data.session_token !== "string" || data.session_token.length < 16 || !Number.isSafeInteger(data.remaining_questions) || data.remaining_questions < 0) invalid();
      return data;
    });
export const askPublication = (token: string, publicId: string, sessionToken: string, requestId: string, question: string) =>
  post<{ request: PublicationRequest }>(token, VISITOR, { op: "ask", public_id: publicId, session_token: sessionToken, request_id: requestId, question }, AbortSignal.timeout(90_000)).then(data => ({ request: validatePublicationRequest(data.request, publicId, requestId) }));
export const readPublicationAnswer = (token: string, publicId: string, sessionToken: string, requestId: string, signal?: AbortSignal) =>
  post<{ request: PublicationRequest }>(token, VISITOR, { op: "result", public_id: publicId, session_token: sessionToken, request_id: requestId }, signal).then(data => ({ request: validatePublicationRequest(data.request, publicId, requestId) }));
export const forgetPublication = (token: string, publicId: string) =>
  post<{ forgotten: true; private_payload_erased: true }>(token, VISITOR, { op: "forget", public_id: publicId });
