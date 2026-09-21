// teacherSheetApi.ts — fetch wrapper for the teacher-sheet draft, following
// the existing *Api.ts pattern (see personModelApi.ts, claimExtractionApi.ts).
//
// The endpoint (`/api/teacher-sheet`) LANDED with WS-F: GET reads the owner's
// own sheet, PUT and `{op:"save_draft"}` both save it, `{op:"publish"}` runs
// teacher-sheet-spec.md §4's gate and fails closed. The soft-failure posture
// below stays regardless, and is not vestigial: a caller that gets a rejected
// promise here should keep editing locally rather than blocking the screen,
// exactly as PersonModelStudio already treats a rejected `readClaimExtraction`
// as "not available", not as a hard error (PersonModelStudio.tsx `load()`).
// The endpoint existing does not make the network reliable.
import { replicaRequest } from "./replicaApi";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import type { SheetValidationError } from "../engine/agents/fromSheet";

export interface TeacherSheetDraftStatus {
  draft: TeacherSheet | null;
  updated_at: string | null;
  sheet_id?: string | null;
  status?: "draft" | "validated" | "published" | "revoked";
  version?: string;
  published_at?: string | null;
  consent_artifact_id?: "present" | null;
}

export interface TeacherSheetPublicationKey { sheet_id: string; version: string; snapshot_hash: string }
export interface TeacherSheetPublicationReview extends TeacherSheetPublishResult {
  replica_id: string;
  review: TeacherSheetPublicationKey | null;
  consent_basis: "persisted_sheet_column";
}

export async function readTeacherSheetPublicationReview(token: string, replicaId: string): Promise<TeacherSheetPublicationReview> {
  const data = await replicaRequest<TeacherSheetPublicationReview>(token,
    `/api/teacher-sheet?op=publication_review&replica_id=${encodeURIComponent(replicaId)}`);
  if (!data || data.replica_id !== replicaId || typeof data.ok !== "boolean" ||
      !Array.isArray(data.errors) || !data.errors.every(value => value && typeof value.field === "string" && typeof value.code === "string") || !Array.isArray(data.blockers) ||
      !data.blockers.every(value => typeof value === "string") ||
      data.consent_basis !== "persisted_sheet_column" || !data.sheet ||
      (data.sheet.draft !== null && (!data.sheet.draft || typeof data.sheet.draft !== "object" || Array.isArray(data.sheet.draft))) ||
      !["draft","validated","published","revoked"].includes(data.sheet.status || "") ||
      (data.review !== null && (!data.review || typeof data.review.sheet_id !== "string" ||
        data.review.sheet_id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.review.sheet_id) ||
        typeof data.review.version !== "string" || typeof data.review.snapshot_hash !== "string" ||
        data.review.snapshot_hash.length !== 64 || !/^[0-9a-f]{64}$/.test(data.review.snapshot_hash) ||
        data.review.sheet_id !== data.sheet.sheet_id || data.review.version !== data.sheet.version)) ||
      (data.ok && (!data.review || !data.sheet.draft || data.sheet.consent_artifact_id !== "present" || data.errors.length || data.blockers.length))) {
    throw new Error("teacher_sheet_publication_response_invalid");
  }
  return data;
}

export async function readTeacherSheetDraft(token: string, replicaId: string): Promise<TeacherSheetDraftStatus> {
  const data = await replicaRequest<{ sheet: TeacherSheetDraftStatus }>(
    token,
    `/api/teacher-sheet?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.sheet;
}

export async function saveTeacherSheetDraft(
  token: string,
  replicaId: string,
  draft: Partial<TeacherSheet>,
): Promise<TeacherSheetDraftStatus> {
  const data = await replicaRequest<{ sheet: TeacherSheetDraftStatus }>(token, "/api/teacher-sheet", {
    method: "POST",
    body: JSON.stringify({ op: "save_draft", replica_id: replicaId, draft }),
  });
  return data.sheet;
}

/** The publish gate's answer. `ok:false` is a NORMAL response — "not yet" with
 *  every reason at once, so the studio points at rows rather than making a
 *  teacher fix one per round trip. `blockers` is the consent gate (row state,
 *  not sheet content, and it fails closed); `errors` is field content; and
 *  `phraseBank` is teacher-sheet-spec.md §4.3's ≥5-occurrences verdict, whose
 *  `verified:false` with an `unverifiedReason` means NO transcript evidence
 *  was supplied — never that the check passed. Render that state; a UI that
 *  showed it as a tick would be the one place this whole rule leaks. */
export interface TeacherSheetPublishResult {
  ok: boolean;
  errors: SheetValidationError[];
  blockers: string[];
  phraseBank?: {
    verified: boolean;
    unverifiedReason?: string;
    heldOutTokens: number;
    failures: { fragment: string; occurrences: number; code?: string }[];
  };
  sheet: TeacherSheetDraftStatus;
}

/**
 * Run the publish gate. `evidence` is the teacher's own transcript corpus, and
 * it is OPTIONAL because the upload→ASR lane is WS-F's other half: without it
 * the phrase-bank rule reports `unverified`.
 *
 * Rejects with a `ReplicaApiError` carrying status 409 when the gate refuses —
 * a publish that did not publish never answers 200, so a caller checking only
 * the status code cannot come to believe it shipped a clone.
 */
export async function publishTeacherSheet(
  token: string,
  replicaId: string,
  evidence?: { transcript?: { speaker: string; text: string }[]; teacherSpeaker?: string },
  review?: TeacherSheetPublicationKey,
): Promise<TeacherSheetPublishResult> {
  return replicaRequest<TeacherSheetPublishResult>(token, "/api/teacher-sheet", {
    method: "POST",
    body: JSON.stringify({ op: "publish", replica_id: replicaId, evidence, review }),
  });
}

export const teacherSheetPublicationClient = {
  read: readTeacherSheetPublicationReview,
  publish: (token: string, replicaId: string, review: TeacherSheetPublicationKey) => publishTeacherSheet(token,replicaId,undefined,review),
};

// ─────────────────────────────────────────────────────────────────────────
// WS-R178. "Draft it from what I gave" — op:"draft_from_sources". A read,
// never a write: `api/_person-sheet-draft.js`'s pure drafter over the
// person's own accepted, cited claims. Accepting a proposal in the studio
// edits `draft` locally, exactly as typing does; saving still goes through
// `saveTeacherSheetDraft` above, unchanged.
// ─────────────────────────────────────────────────────────────────────────

export interface PersonSheetDraftCitation { excerpt: string; entailment: number }

export interface PersonSheetDraftProposal {
  id: string;
  /** a sheet field name, or "personTalk.<register|scriptBaseline|codeSwitchNote>" */
  field: string;
  value: string;
  claimIds: string[];
  citations: PersonSheetDraftCitation[];
}

export interface PersonSheetDraftGap {
  field: string;
  reason: string;
  detail?: string;
}

export interface PersonSheetDraftResult {
  replica_id: string;
  proposals: PersonSheetDraftProposal[];
  gaps: PersonSheetDraftGap[];
  accepted_claim_count: number;
}

export async function readPersonSheetDraftProposals(token: string, replicaId: string): Promise<PersonSheetDraftResult> {
  const data = await replicaRequest<PersonSheetDraftResult>(
    token,
    `/api/teacher-sheet?op=draft_from_sources&replica_id=${encodeURIComponent(replicaId)}`,
  );
  if (
    !data || data.replica_id !== replicaId ||
    !Array.isArray(data.proposals) || !data.proposals.every((p) =>
      p && typeof p.id === "string" && typeof p.field === "string" && typeof p.value === "string" &&
      Array.isArray(p.claimIds) && Array.isArray(p.citations)) ||
    !Array.isArray(data.gaps) || !data.gaps.every((g) => g && typeof g.field === "string" && typeof g.reason === "string")
  ) {
    throw new Error("person_sheet_draft_response_invalid");
  }
  return data;
}
