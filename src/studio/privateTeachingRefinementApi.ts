import { replicaRequest } from "./replicaApi";
import { isPrivateTextId } from "./privateTextRehearsalApi";

export interface PrivateTeachingRefinement {
  replica_id: string; request_id: string; sheet_id: string; sheet_hash: string;
  sheet_version: string; private_text_epoch: string; field: "explanationOrder";
  value: string | null; updated_at: string | null; can_save: boolean;
  blocker?: "private_refinement_review_changed"; saved?: true;
}
export type PrivateTeachingChange = { value: string; clear?: never } | { clear: true; value?: never };
const hash = (value: unknown) => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/u.test(value);
const epoch = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/u.test(value) && BigInt(value) <= 9223372036854775807n;
const wellFormed = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export const validPrivateTeachingValue = (value: string) => Boolean(value.trim()) && value.length <= 4000 && wellFormed(value);
const unavailable = () => new Error("The saved guidance could not be confirmed. Check it before saving again.");
export function validatePrivateTeachingRefinement(value: PrivateTeachingRefinement, replicaId: string, requestId: string, sheetId: string) {
  if (!value || value.replica_id !== replicaId || value.request_id !== requestId || value.sheet_id !== sheetId
    || ![value.replica_id, value.request_id, value.sheet_id].every(isPrivateTextId) || !hash(value.sheet_hash)
    || !epoch(value.private_text_epoch) || value.field !== "explanationOrder"
    || typeof value.sheet_version !== "string" || value.sheet_version.length > 1000
    || value.value !== null && (typeof value.value !== "string" || value.value.length > 4000 || !wellFormed(value.value))
    || value.updated_at !== null && !Number.isFinite(Date.parse(value.updated_at))
    || typeof value.can_save !== "boolean" || !value.can_save && value.blocker !== "private_refinement_review_changed") throw unavailable();
  return value;
}
const signalFor = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20000)]);
export async function readPrivateTeachingRefinement(token: string, replicaId: string, requestId: string, sheetId: string, signal: AbortSignal) {
  const query = new URLSearchParams({op: "private_refinement", replica_id: replicaId, request_id: requestId});
  const data = await replicaRequest<{refinement: PrivateTeachingRefinement}>(token, `/api/teacher-sheet?${query}`, {signal: signalFor(signal)});
  return validatePrivateTeachingRefinement(data.refinement, replicaId, requestId, sheetId);
}
export async function savePrivateTeachingRefinement(token: string, basis: PrivateTeachingRefinement, change: PrivateTeachingChange, signal: AbortSignal) {
  if (!basis.can_save || (change.clear === true ? Object.hasOwn(change, "value") : !validPrivateTeachingValue(change.value))) throw unavailable();
  const data = await replicaRequest<{refinement: PrivateTeachingRefinement}>(token, "/api/teacher-sheet", {
    method: "POST", signal: signalFor(signal), body: JSON.stringify({op: "private_refinement", replica_id: basis.replica_id,
      request_id: basis.request_id, sheet_id: basis.sheet_id, expected_sheet_hash: basis.sheet_hash,
      expected_private_text_epoch: basis.private_text_epoch, field: "explanationOrder", ...change}),
  });
  const next = validatePrivateTeachingRefinement(data.refinement, basis.replica_id, basis.request_id, basis.sheet_id);
  if (next.saved !== true || next.can_save || next.sheet_hash === basis.sheet_hash
    || BigInt(next.private_text_epoch) !== BigInt(basis.private_text_epoch) + 1n
    || next.value !== (change.clear === true ? null : change.value)) throw unavailable();
  return next;
}
