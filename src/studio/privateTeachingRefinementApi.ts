import { replicaRequest } from "./replicaApi";
import { isPrivateTextId } from "./privateTextRehearsalApi";

interface PrivateRefinementBase {
  replica_id: string; request_id: string; sheet_id: string; sheet_hash: string;
  sheet_version: string; private_text_epoch: string; updated_at: string | null; can_save: boolean;
  blocker?: "private_refinement_review_changed"; saved?: true;
}
export type PrivateTeachingRefinement = PrivateRefinementBase & { field: "explanationOrder"; value: string | null };
export type PrivatePersonRefinement = PrivateRefinementBase & { sheet_kind: "person"; field: "personTalk";
  value: { register: "formal" | "mixed" | "casual"; scriptBaseline: "roman-hinglish" | "devanagari" | "english" } | null };
export type PrivateDraftRefinement = PrivateTeachingRefinement | PrivatePersonRefinement;
export type PrivateTeachingChange = { value: string; clear?: never } | { clear: true; value?: never };
export type PrivatePersonChange = { register: "formal" | "mixed" | "casual"; script_baseline: "roman-hinglish" | "devanagari" | "english" };
export type PrivateDraftChange = PrivateTeachingChange | PrivatePersonChange;
const hash = (value: unknown) => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/u.test(value);
const epoch = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/u.test(value) && BigInt(value) <= 9223372036854775807n;
const wellFormed = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export const validPrivateTeachingValue = (value: string) => Boolean(value.trim()) && value.length <= 4000 && wellFormed(value);
export const validPrivatePersonChange = (value: Partial<PrivatePersonChange>): value is PrivatePersonChange =>
  ["formal", "mixed", "casual"].includes(String(value.register)) && ["roman-hinglish", "devanagari", "english"].includes(String(value.script_baseline));
const unavailable = () => new Error("The saved guidance could not be confirmed. Check it before saving again.");
export function validatePrivateTeachingRefinement(value: PrivateDraftRefinement, replicaId: string, requestId: string, sheetId: string): PrivateDraftRefinement {
  if (!value || value.replica_id !== replicaId || value.request_id !== requestId || value.sheet_id !== sheetId
    || ![value.replica_id, value.request_id, value.sheet_id].every(isPrivateTextId) || !hash(value.sheet_hash)
    || !epoch(value.private_text_epoch)
    || typeof value.sheet_version !== "string" || value.sheet_version.length > 1000
    || value.updated_at !== null && !Number.isFinite(Date.parse(value.updated_at))
    || typeof value.can_save !== "boolean" || !value.can_save && value.blocker !== "private_refinement_review_changed") throw unavailable();
  if (value.field === "explanationOrder") {
    if (Object.hasOwn(value, "sheet_kind")
      || value.value !== null && (typeof value.value !== "string" || value.value.length > 4000 || !wellFormed(value.value))) throw unavailable();
  } else if (value.field === "personTalk") {
    if ((value as PrivatePersonRefinement).sheet_kind !== "person" || value.value !== null
      && (!value.value || typeof value.value !== "object" || !["formal", "mixed", "casual"].includes(String(value.value.register))
        || !["roman-hinglish", "devanagari", "english"].includes(String(value.value.scriptBaseline)))) throw unavailable();
  } else throw unavailable();
  return value;
}
const signalFor = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20000)]);
export async function readPrivateTeachingRefinement(token: string, replicaId: string, requestId: string, sheetId: string, signal: AbortSignal) {
  const query = new URLSearchParams({op: "private_refinement", replica_id: replicaId, request_id: requestId});
  const data = await replicaRequest<{refinement: PrivateDraftRefinement}>(token, `/api/teacher-sheet?${query}`, {signal: signalFor(signal)});
  return validatePrivateTeachingRefinement(data.refinement, replicaId, requestId, sheetId);
}
export async function savePrivateTeachingRefinement(token: string, basis: PrivateDraftRefinement, change: PrivateDraftChange, signal: AbortSignal) {
  const person = basis.field === "personTalk";
  if (!basis.can_save || (person ? !validPrivatePersonChange(change as PrivatePersonChange)
    : ((change as PrivateTeachingChange).clear === true ? Object.hasOwn(change, "value") : !validPrivateTeachingValue((change as { value: string }).value)))) throw unavailable();
  const data = await replicaRequest<{refinement: PrivateDraftRefinement}>(token, "/api/teacher-sheet", {
    method: "POST", signal: signalFor(signal), body: JSON.stringify({op: "private_refinement", replica_id: basis.replica_id,
      request_id: basis.request_id, sheet_id: basis.sheet_id, expected_sheet_hash: basis.sheet_hash,
      expected_private_text_epoch: basis.private_text_epoch, field: basis.field, ...change}),
  });
  const next = validatePrivateTeachingRefinement(data.refinement, basis.replica_id, basis.request_id, basis.sheet_id);
  if (next.saved !== true || next.can_save || next.sheet_hash === basis.sheet_hash
    || BigInt(next.private_text_epoch) !== BigInt(basis.private_text_epoch) + 1n
    || next.field !== basis.field) throw unavailable();
  if (person) {
    const expected = change as PrivatePersonChange;
    if (next.field !== "personTalk" || next.value === null || next.value.register !== expected.register
      || next.value.scriptBaseline !== expected.script_baseline) throw unavailable();
  } else {
    const expected = change as PrivateTeachingChange;
    if (next.field !== "explanationOrder" || next.value !== (expected.clear === true ? null : expected.value)) throw unavailable();
  }
  return next;
}
