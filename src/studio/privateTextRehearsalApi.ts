import { replicaRequest } from "./replicaApi";
import type { TeacherSubject } from "../engine/agents/teacherTypes";

export const PRIVATE_TEXT_STATEMENT_SET = "private-text-rehearsal/v1" as const;
export const PRIVATE_TEXT_ATTESTATIONS = ["authorize_private_text_question", "understand_ai_text_only", "understand_private_retention_and_withdrawal"] as const;
export type PrivateTextAttestation = typeof PRIVATE_TEXT_ATTESTATIONS[number];
export interface PrivateTextSelection {
  sheet_id: string; sheet_hash: string; context_item_id: string; context_hash: string;
  source_id: string; source_hash: string; evidence_hash: string; authority_epoch: string; snapshot_hash: string;
  material: { draft: { name: string; identityWho: string; subjectDomain: TeacherSubject }; context: { source_name: string; format: string; body: string } };
}
export interface PrivateTextReadiness {
  replica_id: string; state: "ready" | "needs_input" | "unavailable" | "stopped";
  blockers: Array<{ code: string; responsibility: "owner" | "platform"; field?: string }>;
  drafts: Array<{ sheet_id: string; name: string | null; updated_at: string | null; status: string }>;
  context_items: Array<{ item_id: string; source_name: string; status: string; eligible: boolean; reason?: string }>;
  selected: PrivateTextSelection | null;
  statement_set: typeof PRIVATE_TEXT_STATEMENT_SET; statements: Array<{ id: PrivateTextAttestation; text: string }>;
  grant_scope: "private_text_rehearsal"; can_ask: boolean;
}
export type PrivateTextBillingState = "not_started" | "reserved" | "in_flight" | "settled" | "reconcile_required" | "unknown";
interface PrivateTextBoundResult {
  replica_id: string; request_id: string; state: "complete" | "pending" | "uncertain" | "blocked" | "withdrawn";
  answer?: string; consent: { consent_id: string; receipt_hash: string; statement_set: string; expires_at: string };
  source: { sheet_id: string; sheet_hash: string; context_item_id: string; source_id: string; source_hash: string; evidence_hash: string };
  billing_state: Exclude<PrivateTextBillingState, "unknown">;
  failure_code?: string; can_review_teaching?: true; can_voice: false; created_at: string;
}
export interface PrivateTextCancelledResult {
  replica_id: string; request_id: string; state: "withdrawn"; billing_state: "unknown";
  can_voice: false; created_at: string; answer?: never; consent?: never; source?: never; failure_code?: never; can_review_teaching?: never;
}
export type PrivateTextResult = PrivateTextBoundResult | PrivateTextCancelledResult;
export interface PrivateTextWithdrawal {
  replica_id: string; request_id: string; state: "withdrawn"; private_payload_erased: true; billing_state: PrivateTextBillingState;
  can_voice: false; created_at: string;
}
export interface PrivateDraftBody { name?: string; identityWho?: string; subjectDomain?: TeacherSubject; [key: string]: unknown }
export interface PrivateDraftView { draft: PrivateDraftBody | null; sheet_id: string | null; status: string; updated_at: string | null }
const requestSignal = (signal?: AbortSignal, timeout = 20000) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
const ENDPOINT = "/api/replica-text-rehearsal";
export function isPrivateTextId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) && value.length === 64;
const text = (value: unknown, max = 8000) => typeof value === "string" && value.length <= max;
const failure = () => new Error("Private text response was unavailable. Check the saved request before asking again.");
export function validatePrivateTextReadiness(value: PrivateTextReadiness, replicaId: string): PrivateTextReadiness {
  if (!value || value.replica_id !== replicaId || !["ready", "needs_input", "unavailable", "stopped"].includes(value.state)
    || !Array.isArray(value.blockers) || value.blockers.some(row => !row || !text(row.code, 160) || !["owner", "platform"].includes(row.responsibility))
    || !Array.isArray(value.drafts) || value.drafts.some(row => !row || !isPrivateTextId(row.sheet_id) || row.name !== null && !text(row.name, 500))
    || !Array.isArray(value.context_items) || value.context_items.some(row => !row || !isPrivateTextId(row.item_id) || !text(row.source_name, 1000) || typeof row.eligible !== "boolean")
    || value.statement_set !== PRIVATE_TEXT_STATEMENT_SET || value.grant_scope !== "private_text_rehearsal"
    || !Array.isArray(value.statements) || value.statements.length !== 3
    || PRIVATE_TEXT_ATTESTATIONS.some(id => value.statements.filter(row => row.id === id && text(row.text, 1500) && row.text.trim()).length !== 1)
    || typeof value.can_ask !== "boolean") throw failure();
  const selected = value.selected;
  if (selected && (!isPrivateTextId(selected.sheet_id) || !isPrivateTextId(selected.context_item_id) || !isPrivateTextId(selected.source_id)
    || ![selected.sheet_hash, selected.context_hash, selected.source_hash, selected.evidence_hash, selected.snapshot_hash].every(hash)
    || typeof selected.authority_epoch !== "string" || !/^[0-9]{1,19}$/u.test(selected.authority_epoch)
    || !selected.material || !text(selected.material.draft?.name, 500) || !text(selected.material.draft?.identityWho, 2000)
    || !["physics", "chemistry", "maths"].includes(selected.material.draft?.subjectDomain)
    || !text(selected.material.context?.source_name, 1000) || !["text", "markdown", "pdf", "docx"].includes(selected.material.context?.format) || !text(selected.material.context?.body, 8000))) throw failure();
  if (selected && (!value.drafts.some(row => row.sheet_id === selected.sheet_id)
    || !value.context_items.some(row => row.item_id === selected.context_item_id && row.eligible))) throw failure();
  if (value.can_ask && (value.state !== "ready" || value.blockers.length || !selected)) throw failure();
  return value;
}
export function validatePrivateTextResult(value: PrivateTextResult, replicaId: string, requestId: string): PrivateTextResult {
  if (value?.state === "withdrawn" && value.consent === undefined && value.source === undefined) {
    if (value.replica_id !== replicaId || value.request_id !== requestId || value.can_voice !== false
      || value.billing_state !== "unknown" || value.answer !== undefined || value.failure_code !== undefined || value.can_review_teaching !== undefined
      || !Number.isFinite(Date.parse(value.created_at))) throw failure();
    return value;
  }
  if (!value || value.replica_id !== replicaId || value.request_id !== requestId || value.can_voice !== false
    || !["complete", "pending", "uncertain", "blocked", "withdrawn"].includes(value.state)
    || value.can_review_teaching !== undefined && (value.can_review_teaching !== true || value.state !== "blocked" || value.failure_code !== "rehearsal_inputs_changed")
    || !["not_started", "reserved", "in_flight", "settled", "reconcile_required"].includes(value.billing_state)
    || (value.state === "complete" ? !text(value.answer, 4000) || !value.answer?.trim() : value.answer !== undefined)
    || !value.consent || !isPrivateTextId(value.consent.consent_id) || !hash(value.consent.receipt_hash)
    || value.consent.statement_set !== PRIVATE_TEXT_STATEMENT_SET || !Number.isFinite(Date.parse(value.consent.expires_at))
    || !value.source || !isPrivateTextId(value.source.sheet_id) || !isPrivateTextId(value.source.context_item_id)
    || !isPrivateTextId(value.source.source_id) || ![value.source.sheet_hash, value.source.source_hash, value.source.evidence_hash].every(hash)) throw failure();
  return value;
}
export function validatePrivateTextWithdrawal(value: PrivateTextWithdrawal, replicaId: string, requestId: string): PrivateTextWithdrawal {
  if (!value || value.replica_id !== replicaId || value.request_id !== requestId || value.state !== "withdrawn" || value.private_payload_erased !== true
    || value.can_voice !== false || !Number.isFinite(Date.parse(value.created_at))
    || !["not_started", "reserved", "in_flight", "settled", "reconcile_required", "unknown"].includes(value.billing_state)) throw failure();
  return value;
}
export async function readPrivateTextReadiness(token: string, replicaId: string, selection?: { sheetId: string; contextItemId: string }, signal?: AbortSignal) {
  const query = new URLSearchParams({ op: "readiness", replica_id: replicaId });
  if (selection?.sheetId) query.set("sheet_id", selection.sheetId);
  if (selection?.contextItemId) query.set("context_item_id", selection.contextItemId);
  const data = await replicaRequest<{ readiness: PrivateTextReadiness }>(token, `${ENDPOINT}?${query}`, { signal: requestSignal(signal) });
  const value = validatePrivateTextReadiness(data.readiness, replicaId);
  if (value.selected && (selection?.sheetId && value.selected.sheet_id !== selection.sheetId
    || selection?.contextItemId && value.selected.context_item_id !== selection.contextItemId)) throw failure();
  return value;
}
export async function askPrivateText(token: string, input: { replica_id: string; request_id: string; sheet_id: string; context_item_id: string; expected_snapshot_hash: string; question: string }, signal?: AbortSignal) {
  const data = await replicaRequest<{ rehearsal: PrivateTextResult }>(token, ENDPOINT, { method: "POST", signal: requestSignal(signal, 90000),
    body: JSON.stringify({ op: "ask", ...input, statement_set: PRIVATE_TEXT_STATEMENT_SET,
      attestations: Object.fromEntries(PRIVATE_TEXT_ATTESTATIONS.map(id => [id, true])) }) });
  return validatePrivateTextResult(data.rehearsal, input.replica_id, input.request_id);
}
export async function readPrivateTextResult(token: string, replicaId: string, requestId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ op: "result", replica_id: replicaId, request_id: requestId });
  const data = await replicaRequest<{ rehearsal: PrivateTextResult }>(token, `${ENDPOINT}?${query}`, { signal: requestSignal(signal) });
  return validatePrivateTextResult(data.rehearsal, replicaId, requestId);
}
export async function withdrawPrivateText(token: string, replicaId: string, requestId: string, signal?: AbortSignal) {
  const value = await replicaRequest<PrivateTextWithdrawal>(token, ENDPOINT,
    { method: "POST", signal: requestSignal(signal), body: JSON.stringify({ op: "withdraw", replica_id: replicaId, request_id: requestId }) });
  return validatePrivateTextWithdrawal(value, replicaId, requestId);
}
export async function readPrivateRehearsalDraft(token: string, replicaId: string, signal?: AbortSignal): Promise<PrivateDraftView> {
  const data = await replicaRequest<{ sheet: PrivateDraftView }>(token, `/api/teacher-sheet?replica_id=${encodeURIComponent(replicaId)}`, { signal: requestSignal(signal) });
  if (!data.sheet || (data.sheet.draft !== null && (typeof data.sheet.draft !== "object" || Array.isArray(data.sheet.draft)))
    || (data.sheet.sheet_id !== null && !isPrivateTextId(data.sheet.sheet_id))) throw new Error("The saved draft could not be read.");
  return data.sheet;
}
export async function savePrivateRehearsalDraft(token: string, replicaId: string, draft: PrivateDraftBody, signal?: AbortSignal) {
  const data = await replicaRequest<{ sheet: PrivateDraftView }>(token, "/api/teacher-sheet", { method: "POST", signal: requestSignal(signal),
    body: JSON.stringify({ op: "save_draft", replica_id: replicaId, draft }) });
  if (!data.sheet || !isPrivateTextId(data.sheet.sheet_id) || !data.sheet.draft) throw new Error("Draft save was not confirmed. Check the saved draft before trying again.");
  return data.sheet;
}
