import type { TeacherSheet } from "../engine/agents/teacherTypes";

/** A private draft can be incomplete. This projection is for controls only:
 * keep the original object as editing state and save that object, never these
 * display defaults. No persona, publishing floor or authority is invented. */
export function teacherSheetEditorView(draft: Partial<TeacherSheet>) {
  return {
    ...draft,
    name: draft.name ?? "",
    syllabusScope: draft.syllabusScope ?? "",
    identityLife: draft.identityLife ?? "",
    boundaryParagraph: draft.boundaryParagraph ?? "",
    languageVoiceRule: draft.languageVoiceRule ?? "",
    sttSoundAlikes: draft.sttSoundAlikes ?? "",
    notationConventions: draft.notationConventions ?? "",
    subjectStrands: draft.subjectStrands ?? [],
    boardVerbalisms: draft.boardVerbalisms ?? [],
    analogyBank: draft.analogyBank ?? [],
    commonMistakeBank: draft.commonMistakeBank ?? [],
    doubtEscalationLadder: draft.doubtEscalationLadder ?? [],
  };
}
export type TeacherSheetEditorView = ReturnType<typeof teacherSheetEditorView>;
