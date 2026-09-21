import type { TeacherAnalogy, TeacherSheet, TeacherStrictness, TeacherSubject } from "../engine/agents/teacherTypes";

/** A private draft can be incomplete. This projection is for controls only:
 * keep the original object as editing state and save that object, never these
 * display defaults. No persona, publishing floor or authority is invented. */
export function teacherSheetEditorView(draft: Partial<TeacherSheet>) {
  const invalidFields = new Set<keyof TeacherSheet>();
  function field<T>(key: keyof TeacherSheet, accepts: (value: unknown) => value is T, empty: T): T {
    const value: unknown = draft[key];
    if (value === undefined) return empty;
    if (accepts(value)) return value;
    invalidFields.add(key);
    return empty;
  }
  const text = (value: unknown): value is string => typeof value === "string";
  const strings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(text);
  const level = (value: unknown): value is TeacherStrictness | undefined => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
  const subject = (value: unknown): value is TeacherSubject | undefined => value === "physics" || value === "chemistry" || value === "maths";
  const analogies = (value: unknown): value is readonly TeacherAnalogy[] => Array.isArray(value) && value.every(row => row && typeof row === "object" && !Array.isArray(row) && text(row.topic) && text(row.anchor));
  return {
    ...draft,
    name: field("name", text, ""),
    subjectDomain: field("subjectDomain", subject, undefined),
    strictness: field("strictness", level, undefined),
    warmth: field("warmth", level, undefined),
    syllabusScope: field("syllabusScope", text, ""),
    identityLife: field("identityLife", text, ""),
    boundaryParagraph: field("boundaryParagraph", text, ""),
    languageVoiceRule: field("languageVoiceRule", text, ""),
    sttSoundAlikes: field("sttSoundAlikes", text, ""),
    notationConventions: field("notationConventions", text, ""),
    subjectStrands: field("subjectStrands", strings, []),
    boardVerbalisms: field("boardVerbalisms", strings, []),
    analogyBank: field("analogyBank", analogies, []),
    commonMistakeBank: field("commonMistakeBank", strings, []),
    doubtEscalationLadder: field("doubtEscalationLadder", strings, []),
    invalidFields,
  };
}
export type TeacherSheetEditorView = ReturnType<typeof teacherSheetEditorView>;
