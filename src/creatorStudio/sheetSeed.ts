// sheetSeed.ts — a teaching sheet for a teacher who has not got one yet.
//
// THE BUG THIS EXISTS TO KILL (UX-Q-02 / PRODUCT-JOURNEY BREAK 16)
// ---------------------------------------------------------------------------
// `StudioApp` used to pass `DEMO_TEACHER` straight into three surfaces:
// `TeacherSheetStudio` (as the draft), `DisclosurePreview` (as the sheet), and
// `ChannelsStudio` (as the slug). `DEMO_TEACHER` is Arjun Sir, a fictional JEE
// physics teacher. So a chemistry teacher named someone else opened the screen
// whose entire job is making consent INFORMED and read:
//
//     "You're talking with an AI clone of Arjun Sir"
//
// and the embed snippet they were invited to copy addressed
// `teacher-demo-arjun`. That is not a rough edge. It is a consent-grade defect:
// the one screen in the product that shows a person exactly what they are
// agreeing to publish showed them somebody else's clone.
//
// WHAT THIS MODULE DOES, AND WHAT IT REFUSES TO DO
// ---------------------------------------------------------------------------
// It builds a seed sheet carrying the OWNER'S OWN name and a slug derived from
// their own replica, with every mined field blanked. It keeps only the fields
// that are the same for every clone in the product regardless of who owns it:
// the safety floor (crisis lines, the disclosure fact, the integrity stance,
// the escalation route) and the register skeleton, which is Relational Core and
// not authored per teacher.
//
// It does NOT keep Arjun's pedagogy, analogies, catchphrases, mistake bank or
// subject. Those are the fields a teacher would read as "this is what we
// learned about you", and shipping a fixture in that slot is the false
// provenance claim in C17. Blank and labelled is honest; populated and wrong is
// not, and "it is only a placeholder" is exactly the argument that put a
// fictional teacher's name on a consent screen in the first place.
//
// `sheetProvenance` travels with the sheet so the panels can say which one they
// are rendering. A seed is never presented as a draft.
import type { Replica } from "./types";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import { DEMO_TEACHER } from "../engine/agents/characters/demoTeacher";

export type SheetProvenance = "draft" | "seed";

/**
 * A public slug derived from the replica, not from the demo.
 *
 * Deliberately prefixed and id-derived rather than name-derived: two teachers
 * called the same thing must not collide, and a slug is an address a student
 * ends up holding. It is a LOCAL preview value only. The published slug is
 * whatever `/api/teacher-sheet`'s publish gate mints, and this one never
 * reaches the server.
 */
export function previewSlug(replica: Replica): string {
  return `teacher-${replica.replica_id.slice(0, 8)}`;
}

/**
 * The seed sheet for a replica with no saved draft.
 *
 * Every field below that is left as `DEMO_TEACHER`'s is a FLOOR field: the same
 * text for every published clone, not editable by a teacher, and gated by
 * `evals/persona-invariants.mjs` and the per-module safety floor. Everything a
 * teacher would recognise as theirs is emptied.
 */
export function seedSheetFor(replica: Replica): TeacherSheet {
  return {
    ...DEMO_TEACHER,
    slug: previewSlug(replica),
    name: replica.display_name,
    version: `${previewSlug(replica)}-draft`,

    // Identity: theirs to write, and blank until they do.
    identityWho: "",
    identityLife: "",

    // Subject and syllabus: TCH fields, chosen on the sheet screen.
    subjectStrands: [],
    syllabusScope: "",
    examTrack: [],
    doubtEscalationLadder: [],

    // Everything the ingestion lane is supposed to draft. Empty means "we have
    // not learned this yet", which is true, and which the panel now says.
    languageVoiceRule: "",
    sttSoundAlikes: "",
    boardVerbalisms: [],
    notationConventions: "",
    analogyBank: [],
    commonMistakeBank: [],

    // FLOOR FIELDS THAT STILL CARRY A NAME. `cloneDisclosureFact` is identical
    // for every clone in structure but interpolates whose clone it is, and the
    // fixture's copy names Arjun three times. Substituting the real owner is
    // the same operation `cloneDisclosureCard` performs at runtime; leaving it
    // would put the demo teacher back on the disclosure surface by the back
    // door, which is the exact defect this module exists to close.
    cloneDisclosureFact: DEMO_TEACHER.cloneDisclosureFact.replaceAll("Arjun Sir", replica.display_name),
    // Credentials are claims about a real person. A seed has none.
    credentialFacts: "",

    // The background life is Arjun's, invented for a fictional teacher. A real
    // teacher's draft may not carry a fabricated day. Blank covers degrade
    // rather than throw (`cloneLife.shapeForDow`) and the sheet validator
    // refuses to publish on them, which is the correct direction to fail.
    life: {
      ...DEMO_TEACHER.life,
      weekdayShape: [],
      weekendShape: [],
      weeklyRhythm: [],
      preoccupations: [],
    },

    // A published clone must carry a real consent artifact. A seed has none and
    // says so with the same nil shape `DEMO_TEACHER` uses, so publish fails
    // closed here for exactly the reason it fails closed there.
    consentArtifactId: DEMO_TEACHER.consentArtifactId,
    voiceCloneId: null,
  };
}

/**
 * True when the sheet on screen is a real saved draft rather than a seed.
 *
 * Exported as a function rather than inlined so the eval and the UI agree on
 * one definition of "this teacher has confirmed something".
 */
export function isPersistedDraft(provenance: SheetProvenance): boolean {
  return provenance === "draft";
}
