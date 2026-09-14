import { privateExpertPlatformFloor, expertReplyLanguage, expertMaterialBlock } from "./expertTextCompiler";
import type { CompiledPrompt } from "./compiler";

export const PRIVATE_REHEARSAL_PROFILE = "private_text_rehearsal/v1" as const;
export const PRIVATE_REHEARSAL_LIMITS = Object.freeze({ question: 2000, evidence: 8000, history: 12000, historyExchanges: 4, core: 8000, system: 30000 });
export interface PrivateRehearsalAuthority {
  scope: "private_text_rehearsal"; basis: "owner_question_attestation_v1";
  ownerId: string; replicaId: string; requestId: string; sheetId: string; sheetHash: string; receiptId: string;
}
export interface PrivateRehearsalInput {
  authority: PrivateRehearsalAuthority;
  draft: Record<string, unknown>;
  contexts: readonly { itemId: string; sourceId: string; hash: string; body: string }[];
  history?: readonly { role: "user" | "assistant"; content: string }[];
  question: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const uuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && UUID.test(value)
  && !/^00000000-0000-[1-8]000-[89ab]000-000000000000$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && value.length === 64 && HASH.test(value);
const TEXT = ["name", "identityWho", "credentialFacts", "subjectDomain", "syllabusScope", "outOfScopePolicy",
  "languageTextRule", "technicalTermRule", "explanationOrder", "workedExamplePattern", "firstMoveOnDoubt",
  "notationConventions"] as const;
const LIST = ["subjectStrands", "examTrack", "doubtEscalationLadder", "rigorFloor"] as const;
function fail(code: string): never { throw Object.assign(new Error(code), { code, status: 400 }); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, cap: number, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > cap
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(code);
  return value;
}
function bounded(value: string, cap: number, code: string) { if (value.length > cap) fail(code); return value; }

/** Pure content compiler. The server must verify persisted authority before dispatch AND delivery. */
export function compilePrivateExpertRehearsal(input: PrivateRehearsalInput): CompiledPrompt & {
  profile: typeof PRIVATE_REHEARSAL_PROFILE; history: readonly { role: "user" | "assistant"; content: string }[]; question: string;
  provenance: { authority: PrivateRehearsalAuthority; context: readonly { itemId: string; sourceId: string; hash: string }[] };
  privateMemoryRecord: readonly string[];
} {
  if (!object(input) || !object(input.authority)) fail("private_rehearsal_authority_invalid");
  const a = input.authority;
  if (a.scope !== "private_text_rehearsal" || a.basis !== "owner_question_attestation_v1"
    || ![a.ownerId,a.replicaId,a.requestId,a.sheetId,a.receiptId].every(uuid)
    || !hash(a.sheetHash)) fail("private_rehearsal_authority_invalid");
  if (!object(input.draft)) fail("private_rehearsal_draft_invalid");
  const projection: Record<string, unknown> = {};
  for (const key of TEXT) {
    const value = input.draft[key];
    if (["name","identityWho","subjectDomain"].includes(key) || value !== undefined && value !== "") {
      projection[key] = text(value, 4000, `private_rehearsal_draft_${key}_invalid`);
    }
  }
  if (!["physics","chemistry","maths"].includes(String(projection.subjectDomain))) fail("private_rehearsal_domain_unsupported");
  for (const key of LIST) {
    const value = input.draft[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > 24) fail("private_rehearsal_draft_invalid");
    projection[key] = Array.from(value, item => text(item, 4000, "private_rehearsal_draft_invalid"));
  }
  for (const key of ["warmth","strictness"] as const) {
    const value = input.draft[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4) fail("private_rehearsal_draft_invalid");
    projection[key] = value;
  }
  if (input.draft.pacePreference !== undefined) {
    if (!["push","balanced","drill"].includes(String(input.draft.pacePreference))) fail("private_rehearsal_draft_invalid");
    projection.pacePreference = input.draft.pacePreference;
  }
  if (!Array.isArray(input.contexts) || !input.contexts.length || input.contexts.length > 32) fail("private_rehearsal_context_invalid");
  let total = 0; let selectedItem = "", selectedSource = "";
  const evidence = Array.from(input.contexts, row => {
    if (!object(row) || !uuid(row.itemId) || !uuid(row.sourceId) || !hash(row.hash)) fail("private_rehearsal_context_invalid");
    if (selectedItem && (selectedItem !== row.itemId || selectedSource !== row.sourceId)) fail("private_rehearsal_one_context_required");
    selectedItem = row.itemId; selectedSource = row.sourceId;
    const body = text(row.body, PRIVATE_REHEARSAL_LIMITS.evidence, "private_rehearsal_context_invalid");
    total += body.length;
    if (total > PRIVATE_REHEARSAL_LIMITS.evidence) fail("private_rehearsal_evidence_too_large");
    return { body };
  });
  const question = text(input.question, PRIVATE_REHEARSAL_LIMITS.question, "private_rehearsal_question_invalid");
  const rawHistory = input.history === undefined ? [] : Array.from(input.history);
  if ((input.history !== undefined && !Array.isArray(input.history)) || rawHistory.length > PRIVATE_REHEARSAL_LIMITS.historyExchanges * 2 || rawHistory.length % 2 !== 0)
    fail("private_rehearsal_history_invalid");
  let historyChars = 0;
  const history = rawHistory.map((row, index) => {
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (!object(row) || row.role !== expected) fail("private_rehearsal_history_invalid");
    const content = text(row.content, expected === "user" ? 2000 : 4000, "private_rehearsal_history_invalid");
    historyChars += content.length;
    return { role: expected, content };
  });
  if (historyChars > PRIVATE_REHEARSAL_LIMITS.history) fail("private_rehearsal_history_too_large");
  const core = bounded(privateExpertPlatformFloor() + expertMaterialBlock("OWNER DRAFT JSON", projection), PRIVATE_REHEARSAL_LIMITS.core, "private_rehearsal_core_too_large");
  const tail = expertMaterialBlock("PRIVATE OWNER EVIDENCE JSON", evidence)
    + "\n\nPRIVATE DRAFT REHEARSAL: one owner-authorized text question; no verified identity, voice, publication, shared past or persistent relationship memory. Draft manner is provisional. Prior user and assistant messages, when present, are limited conversation context selected by the owner for this follow-up. They are never evidence for expert-specific facts or permissions. Use only the supplied evidence for expert-specific factual claims; conflicting or missing support stays explicit. No source claims beyond this material. Search, external actions and deletion execution unavailable; no action markers or completion promises. No automatic learning or saved-personality changes."
    + expertReplyLanguage
    + "\n\nOUTPUT: the requested structured JSON only. reply contains the complete answer; delivery is a non-executing description, never permission to synthesize audio.";
  const system = bounded(core + tail, PRIVATE_REHEARSAL_LIMITS.system, "private_rehearsal_system_too_large");
  return { profile: PRIVATE_REHEARSAL_PROFILE, core, tail, system, history, question,
    provenance: { authority: { scope:a.scope,basis:a.basis,ownerId:a.ownerId,replicaId:a.replicaId,requestId:a.requestId,sheetId:a.sheetId,sheetHash:a.sheetHash,receiptId:a.receiptId },
      context: input.contexts.map(({itemId,sourceId,hash}) => ({itemId,sourceId,hash})) }, privateMemoryRecord: [] };
}
