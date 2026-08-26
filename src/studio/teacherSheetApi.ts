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
  draft: TeacherSheet,
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
): Promise<TeacherSheetPublishResult> {
  return replicaRequest<TeacherSheetPublishResult>(token, "/api/teacher-sheet", {
    method: "POST",
    body: JSON.stringify({ op: "publish", replica_id: replicaId, evidence }),
  });
}
