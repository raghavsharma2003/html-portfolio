// The demo teacher's agent module — composed from the SAME Relational Core as
// Maya's and Kabir's (persona.ts builders, parameterized by sheet). Nothing
// behavioral is authored here; kabir.ts is the template and this file differs
// from it in exactly two ways, both of them stated below rather than left to
// be noticed.
//
// 1. The sheet is a TeacherSheet, so it supplies the arc overrides. That is
//    the whole delta at the prompt layer: the same core, compiled against a
//    sheet whose stage paragraphs are a mentor arc and whose boundary
//    paragraph is MENTOR BOUNDARY rather than ROMANCE BOUNDARY.
//
// 2. `register.honorificSystem` is "hi-TV" as for the incumbents, and
//    [MINOR] the T-V default runs respectful-to-the-STUDENT and never slides
//    to a diminutive (teacher-sheet-spec.md §4.6).
//
// ── WHAT THIS MODULE DOES NOT YET CARRY, said out loud ──────────────────
// Same honesty kabir.ts's v1 scope note practises, because implying coverage
// we do not have is the one thing CLAUDE.md names outright:
//
//   - WATCH_MODE_NOTE / SEARCH_DECISION / FORGET_DECISION are the core's, as
//     they are for Kabir. `buildWatchModeNote(DEMO_TEACHER)` does thread his
//     own sheet fragments through the watch note; the two decision blocks are
//     OS-dominant and still carry Maya's Hinglish exemplars. The cross-agent
//     leak guard measures exactly this, so the remaining extractions get
//     chosen by evidence.
//   - The 24 pedagogy fields on the sheet are NOT compiled into the prompt by
//     this module. teacher-sheet-spec.md §3.1 specifies where they ride
//     (shapes and the four FLOOR fields at end-of-CORE; commonMistakeBank in
//     the budgeted TAIL behind match-then-inject) and that is compiler work,
//     not sheet-layer work. Until it lands, `cloneDisclosureFact` and
//     `academicIntegrityStance` exist as data and do not reach a model — a
//     reader must not infer otherwise from a registered module.
//   - The chat lane's media protocols (photo library, meme menu, voicenote
//     moods) are Maya's catalogs, imported by persona.ts directly rather than
//     read off a sheet. A teacher module therefore inherits her photo/gif
//     library wholesale, which is wrong for this product and is NOT fixable by
//     a sheet field — the parenthetical could be overridden while the actual
//     catalog stayed hers, which would make the sheet lie about what exists.
//     Flagged for the compiler pass; not papered over here.
import {
  buildSystemPromptParts,
  buildSpeechStyle,
  buildWatchModeNote,
  SEARCH_DECISION,
  FORGET_DECISION,
} from "../persona";
import { DEMO_TEACHER } from "./characters/demoTeacher";
import type { AgentModule, DimsStage, Medium, UserProfile, VoiceEngine } from "./types";

export const demoTeacherAgent: AgentModule = {
  slug: DEMO_TEACHER.slug,
  displayName: DEMO_TEACHER.name,
  personaVersion: DEMO_TEACHER.version,

  buildSystemPromptParts: (
    user: UserProfile,
    messageCount: number,
    medium: Medium,
    dimsStage?: DimsStage,
  ) => buildSystemPromptParts(user, messageCount, medium, dimsStage, DEMO_TEACHER),
  buildSpeechStyle: (engine: VoiceEngine | "live") => buildSpeechStyle(engine, DEMO_TEACHER),

  WATCH_MODE_NOTE: buildWatchModeNote(DEMO_TEACHER),
  SEARCH_DECISION,
  FORGET_DECISION,
  CRISIS_LINES: DEMO_TEACHER.crisisLines,

  register: { script: "latin", honorificSystem: "hi-TV" },
};
