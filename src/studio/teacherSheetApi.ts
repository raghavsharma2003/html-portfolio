// teacherSheetApi.ts — fetch wrapper for the teacher-sheet draft, following
// the existing *Api.ts pattern (see personModelApi.ts, claimExtractionApi.ts).
//
// The endpoint (`/api/teacher-sheet`) is not built yet — WS-F (ingestion) and
// the publish-time gate in teacher-sheet-spec.md §4 own that. This wrapper
// exists so TeacherSheetStudio has somewhere real to call the moment the
// endpoint lands, and fails SOFT until then: a caller that gets a rejected
// promise here should keep editing locally rather than blocking the screen,
// exactly as PersonModelStudio already treats a rejected `readClaimExtraction`
// as "not available", not as a hard error (PersonModelStudio.tsx `load()`).
import { replicaRequest } from "./replicaApi";
import type { TeacherSheet } from "../engine/agents/teacherTypes";

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
