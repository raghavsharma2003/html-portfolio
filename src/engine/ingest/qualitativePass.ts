// The LLM qualitative pass — declared as a SEAM, wired to nothing.
//
// `ingestion-research.md` §4's recommendation is a hybrid: "(1) a cheap
// statistical pass ... feeding hard numbers into the character sheet, plus
// (2) an LLM qualitative pass over transcript chunks to fill
// judgment-requiring fields (tone, teaching style, humor register, warmth)".
// `transcriptStats.ts` is (1). This file is the DECLARATION of (2) and
// deliberately not an implementation of it.
//
// ── why a stub and not a model call ───────────────────────────────────────
// Two reasons, and the second is the one that would still hold with keys in
// hand.
//
//  1. This environment holds no model keys (`scripts/write-config.mjs --stub`
//     reports every one MISSING), so a "live" provider written here would be
//     code that has never once run — and a writer nothing exercises is
//     indistinguishable from a writer that does not work (`dead-writers`).
//  2. The qualitative fields are the ones `teacher-sheet-spec.md` §2.1 marks
//     ING? — "extraction proposes, the teacher must edit or approve before it
//     is usable" — and §3 marks TCH? on almost every row. A model proposal
//     that reached a sheet without a teacher between it and the prompt is not
//     a faster pipeline, it is an unreviewed clone of a real named person
//     talking to a minor. So the contract below carries `origin: "proposed"`
//     on every field and there is no path in it that publishes.
//
// ── the registry shape, borrowed ──────────────────────────────────────────
// `api/_claim-extraction/registry.js` is the house pattern and it is four
// lines: read the three env vars, and if any is missing throw a structured
// `{ code, status: 503 }` rather than degrading to something that answers.
// `createQualitativePass` below is the same function with the same posture —
// it FAILS rather than returning a provider that invents. The stub is a
// separate, explicitly-named export precisely so nobody can reach it by
// accident while believing they reached a model.
import type { TeacherSheet } from "../agents/teacherTypes";
import type { TranscriptTurn } from "./transcriptStats";

/** The fields a qualitative pass is permitted to propose. Enumerated, not
 *  open: a pass that could propose `crisisLines` is a pass that can edit the
 *  safety floor, and a pass that could propose `identityLife` mines a private
 *  life the consent artifact does not cover (`teacher-sheet-spec.md` §2.1,
 *  classes 1 and 2). The seam is narrowed here rather than in the caller,
 *  because the caller is the part a future workstream rewrites. */
export const QUALITATIVE_PROPOSABLE_FIELDS = [
  "subjectDomain", "subjectStrands",
  "explanationOrder", "workedExamplePattern",
  "notationConventions", "analogyBank", "commonMistakeBank",
  "tasteTopics", "curiosityTopics",
] as const;

export type QualitativeField = (typeof QUALITATIVE_PROPOSABLE_FIELDS)[number];

export interface QualitativeInput {
  /** the transcript chunks to read. Chunked by the caller — a pass does not
   *  decide how much of a teacher's corpus it sees. */
  turns: readonly TranscriptTurn[];
  /** the diarization label of the teacher, so a pass never reads a student's
   *  words as the teacher's register */
  teacherSpeaker: string;
  /** which of the permitted fields the caller actually wants proposed */
  fields: readonly QualitativeField[];
}

/** One proposal. `evidence` is the citation discipline `api/_claim-extraction`
 *  already enforces and `teacher-sheet-spec.md` §4.6 restates as a provenance
 *  row: "an extracted field with no provenance cannot publish". A proposal
 *  with an empty `evidence` array is therefore rejectable by construction,
 *  which is better than a proposal that quietly carries none. */
export interface QualitativeProposal {
  field: QualitativeField;
  value: unknown;
  /** never "confirmed", never "derived" — a model output is a PROPOSAL until a
   *  named teacher account approves it, and the type says so with one value. */
  origin: "proposed";
  /** turn indices (into `QualitativeInput.turns`) the proposal rests on */
  evidence: readonly number[];
}

export interface QualitativeResult {
  proposals: readonly QualitativeProposal[];
  /** present when the pass declined to run. Named, never silent. */
  unavailable?: string;
}

export interface QualitativePass {
  /** provider label, for the provenance row */
  readonly name: string;
  propose(input: QualitativeInput): Promise<QualitativeResult>;
}

/**
 * The stub. It returns NOTHING and says why — the shape a caller must already
 * handle, since a live provider can also decline (rate limit, budget fence,
 * an aborted request). A stub that returned plausible fields would be the
 * worst artifact in this directory: every downstream check would go green
 * against invented content.
 */
export function createStubQualitativePass(): QualitativePass {
  return {
    name: "qualitative-stub/v1",
    async propose(): Promise<QualitativeResult> {
      return { proposals: [], unavailable: "qualitative_pass_not_implemented" };
    },
  };
}

/**
 * The production selector, `api/_claim-extraction/registry.js`'s posture
 * transferred: no provider is registered, so this throws rather than falling
 * back to the stub. Falling back would be the wrong-agent failure in a
 * smaller costume — a pipeline that reports "extraction complete" having
 * extracted nothing.
 *
 * Wiring a real provider needs model keys this environment does not hold, and
 * doing it is a workstream with its own budget fence, not a line here.
 */
export function createQualitativePass(): QualitativePass {
  throw Object.assign(new Error("qualitative_pass_unavailable"), {
    code: "qualitative_pass_unavailable",
    status: 503,
  });
}

/** Type-level assertion that every proposable field is a real TeacherSheet
 *  key. A typo in the list above would otherwise be a field that silently
 *  never gets proposed — the `silent-truncation` shape, at compile time. */
type _ProposableAreSheetKeys = QualitativeField extends keyof TeacherSheet ? true : never;
const _proposableAreSheetKeys: _ProposableAreSheetKeys = true;
void _proposableAreSheetKeys;
