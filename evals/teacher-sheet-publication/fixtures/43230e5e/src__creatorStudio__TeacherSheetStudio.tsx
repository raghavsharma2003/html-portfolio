// TeacherSheetStudio.tsx — the sheet review/edit step of the teacher-mode
// wizard. Mirrors PersonModelStudio's accept/reject-claims pattern: the
// teacher is reviewing and confirming a draft, not authoring one from a blank
// page, and only the fields docs/gurukul/teacher-sheet-spec.md classifies as
// `TCH` (teacher-input, cannot be mined) are actually editable here.
//
// ── scope, deliberately bounded ─────────────────────────────────────────
// Per SPEC-GURUKUL §5 WS-E and the build brief: subject + syllabus coverage,
// strictness/warmth (teacher-CONFIRMED, never inferred alone), the
// doubt-handling ladder, and boundaries (`identityLife` — TCH, never
// ingested). Everything classified `ING`/`ING?` in the spec's field table
// renders READ-ONLY here, labeled as drafted from uploads, because the
// ingestion pipeline (WS-F) does not exist yet — this screen must still be
// fully renderable today, which is why it takes a `sheetDraft` prop seeded
// with the demo teacher sheet (`characters/demoTeacher.ts`) as its default.
//
// `crisisLines`, `cloneDisclosureFact`, `academicIntegrityStance` and the
// rest of the FLOOR fields are not rendered at all — they are not this
// teacher's to see as an editable control, and DisclosurePreview is the
// dedicated, non-editable step for what a student sees of them.
import { useCallback, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { readTeacherSheetDraft, saveTeacherSheetDraft } from "./teacherSheetApi";
import { SYLLABUS } from "../engine/practice/syllabus";
import type { SubjectId } from "../engine/practice/syllabus";
import type { TeacherSheet, TeacherStrictness, TeacherWarmth } from "../engine/agents/teacherTypes";
import type { SheetProvenance } from "./sheetSeed";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

const SUBJECT_ID: Record<TeacherSheet["subjectDomain"], SubjectId> = {
  physics: "p",
  chemistry: "c",
  maths: "m",
};

type TSC = StudioCopy["teacherSheetStudio"];

function strictnessLabel(value: TeacherStrictness, c: TSC): string {
  return value === 0 ? c.strictness0 : value === 1 ? c.strictness1 : value === 2 ? c.strictness2
    : value === 3 ? c.strictness3 : c.strictness4;
}

function warmthLabel(value: TeacherWarmth, c: TSC): string {
  return value === 0 ? c.warmth0 : value === 1 ? c.warmth1 : value === 2 ? c.warmth2
    : value === 3 ? c.warmth3 : c.warmth4;
}

// The read-only ING/ING? sample: a representative subset of the spec's
// table, not all of it — the highest-signal, highest-recitation-risk fields,
// which is exactly where a teacher most needs to SEE what was drafted even
// though they cannot edit it here. Labels are resolved from `t.teacherSheetStudio`
// at render time (see `ingestedPreview` below).
const INGESTED_PREVIEW: ReadonlyArray<{ key: keyof TeacherSheet; labelKey: keyof Pick<TSC,
  "languageVoiceRuleLabel" | "sttSoundAlikesLabel" | "boardVerbalismsLabel" | "notationConventionsLabel" | "analogyBankLabel" | "commonMistakeBankLabel">;
  render: (sheet: TeacherSheet, c: TSC) => string }> = [
  { key: "languageVoiceRule", labelKey: "languageVoiceRuleLabel", render: (s) => s.languageVoiceRule },
  { key: "sttSoundAlikes", labelKey: "sttSoundAlikesLabel", render: (s) => s.sttSoundAlikes },
  { key: "boardVerbalisms", labelKey: "boardVerbalismsLabel", render: (s) => s.boardVerbalisms.join(", ") },
  { key: "notationConventions", labelKey: "notationConventionsLabel", render: (s) => s.notationConventions },
  { key: "analogyBank", labelKey: "analogyBankLabel", render: (s) => s.analogyBank.map((a) => `${a.topic} → ${a.anchor}`).join("; ") },
  { key: "commonMistakeBank", labelKey: "commonMistakeBankLabel", render: (s, c) => c.commonMistakeBankSummary.split("{n}").join(String(s.commonMistakeBank.length)) },
];

function chaptersFor(subject: TeacherSheet["subjectDomain"]) {
  const found = SYLLABUS.find((s) => s.id === SUBJECT_ID[subject]);
  return found ? found.units.map((unit) => ({ unit: unit.name, chapters: unit.chapters.map((c) => c.name) })) : [];
}

export default function TeacherSheetStudio({
  token,
  replicaId,
  sheetDraft,
  sheetProvenance,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  /** The sheet to render. Either a saved draft read back from
   *  `/api/teacher-sheet`, or a SEED built from this owner's own replica by
   *  `sheetSeed.ts`. It is never the demo teacher: rendering a fixture's name
   *  on a real teacher's consent screen is the defect UX-Q-02 names. */
  sheetDraft: TeacherSheet;
  /** Which of those two the sheet above is. Drives the provenance labels: a
   *  seed may not be captioned "drafted from your uploads", because nothing was
   *  drafted and nothing was uploaded (copy audit C17). */
  sheetProvenance: SheetProvenance;
  onAuthError: (cause: unknown) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.teacherSheetStudio;
  const [sheet, setSheet] = useState<TeacherSheet>(sheetDraft);
  const [ladderDraft, setLadderDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [serviceUnavailable, setServiceUnavailable] = useState(false);

  const units = useMemo(() => chaptersFor(sheet.subjectDomain), [sheet.subjectDomain]);
  const coveredChapters = useMemo(
    () => new Set(sheet.subjectStrands.map((strand) => strand.toLowerCase())),
    [sheet.subjectStrands],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const status = await readTeacherSheetDraft(token, replicaId);
      if (status.draft) setSheet(status.draft);
      setServiceUnavailable(false);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // Fail soft — the endpoint doesn't exist yet (WS-F). Keep editing the
      // local draft rather than blocking the screen.
      setServiceUnavailable(true);
    }
  }, [onAuthError, replicaId, token]);

  function toggleChapter(name: string) {
    const key = name.toLowerCase();
    setSheet((current) => ({
      ...current,
      subjectStrands: coveredChapters.has(key)
        ? current.subjectStrands.filter((strand) => strand.toLowerCase() !== key)
        : [...current.subjectStrands, name],
    }));
  }

  function setSubject(subjectDomain: TeacherSheet["subjectDomain"]) {
    setSheet((current) => ({ ...current, subjectDomain, subjectStrands: [] }));
  }

  function addLadderRung() {
    const rung = ladderDraft.trim();
    if (!rung) return;
    setSheet((current) => ({ ...current, doubtEscalationLadder: [...current.doubtEscalationLadder, rung] }));
    setLadderDraft("");
  }

  function removeLadderRung(index: number) {
    setSheet((current) => ({
      ...current,
      doubtEscalationLadder: current.doubtEscalationLadder.filter((_, i) => i !== index),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveTeacherSheetDraft(token, replicaId, sheet);
      setServiceUnavailable(false);
      setNotice(c.saved);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // Same soft-fail idiom: the draft is never lost, it just isn't synced.
      setServiceUnavailable(true);
      setNotice(c.savedLocalOnly);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="teacher-sheet-studio" className="teacher-sheet-studio" aria-labelledby="teacher-sheet-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="teacher-sheet-title">{c.title.split("{name}").join(sheet.name || c.titleFallbackName)}</h2>
          <p>{c.intro}</p>
        </div>
        <button className="text-button" type="button" onClick={() => void load()}>
          {c.loadSavedDraft}
        </button>
      </div>

      {/* C16 / UX-Q-06. The old panel announced "kept locally" AFTER the
          teacher had filled it in. Provenance is announced at panel open
          instead, because that is when it changes what a person decides to do
          with the next twenty minutes. */}
      {sheetProvenance === "seed" && (
        <p className="field-note" role="status">{c.provenanceSeedNotice}</p>
      )}

      {serviceUnavailable && (
        <p className="inline-error" role="status">{c.serviceUnavailableNotice}</p>
      )}

      <div className="teacher-sheet-grid">
        <article className="teacher-sheet-card">
          <h3>{c.subjectCardTitle}</h3>
          <label className="field-label" htmlFor="subject-domain">{c.subjectLabel}</label>
          <select
            id="subject-domain"
            className="field"
            value={sheet.subjectDomain}
            onChange={(event) => setSubject(event.target.value as TeacherSheet["subjectDomain"])}
          >
            <option value="physics">{c.subjectPhysics}</option>
            <option value="chemistry">{c.subjectChemistry}</option>
            <option value="maths">{c.subjectMaths}</option>
          </select>

          <label className="field-label" htmlFor="syllabus-scope">{c.scopeLabel}</label>
          <textarea
            id="syllabus-scope"
            className="field"
            rows={2}
            value={sheet.syllabusScope}
            onChange={(event) => setSheet((current) => ({ ...current, syllabusScope: event.target.value }))}
          />

          <p className="field-note">{c.chapterNote}</p>
          <div className="syllabus-coverage" role="group" aria-label={c.chapterCoverageAriaLabel}>
            {units.map((unit) => (
              <div key={unit.unit} className="syllabus-unit">
                <strong>{unit.unit}</strong>
                <div className="syllabus-chapters">
                  {unit.chapters.map((chapter) => (
                    <label key={chapter} className="model-consent-check syllabus-chapter">
                      <input
                        type="checkbox"
                        checked={coveredChapters.has(chapter.toLowerCase())}
                        onChange={() => toggleChapter(chapter)}
                      />
                      <span>{chapter}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="teacher-sheet-card">
          <h3>{c.strictnessCardTitle}</h3>
          <p className="field-note">{c.strictnessWarmthNote}</p>
          <label className="field-label" htmlFor="strictness">{c.strictnessLabel}</label>
          <select
            id="strictness"
            className="field"
            value={sheet.strictness}
            onChange={(event) => setSheet((current) => ({ ...current, strictness: Number(event.target.value) as TeacherStrictness }))}
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {strictnessLabel(value as TeacherStrictness, c)}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="warmth">{c.warmthLabel}</label>
          <select
            id="warmth"
            className="field"
            value={sheet.warmth}
            onChange={(event) => setSheet((current) => ({ ...current, warmth: Number(event.target.value) as TeacherWarmth }))}
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {warmthLabel(value as TeacherWarmth, c)}</option>
            ))}
          </select>
        </article>

        <article className="teacher-sheet-card">
          <h3>{c.ladderCardTitle}</h3>
          <p className="field-note">{c.ladderNote}</p>
          <ol className="ladder-list">
            {sheet.doubtEscalationLadder.map((rung, index) => (
              <li key={`${rung}-${index}`}>
                <span>{rung}</span>
                <button
                  type="button"
                  className="text-button"
                  aria-label={c.removeRungAriaLabel.split("{n}").join(String(index + 1))}
                  onClick={() => removeLadderRung(index)}
                >
                  {c.removeRung}
                </button>
              </li>
            ))}
          </ol>
          <div className="create-row">
            <input
              className="field"
              placeholder={c.addRungPlaceholder}
              value={ladderDraft}
              onChange={(event) => setLadderDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLadderRung(); } }}
            />
            <button className="button secondary-button" type="button" onClick={addLadderRung}>{c.addRung}</button>
          </div>
        </article>

        <article className="teacher-sheet-card">
          <h3>{c.boundariesCardTitle}</h3>
          <p className="field-note">{c.boundariesNote}</p>
          <label className="field-label" htmlFor="identity-life">{c.identityLifeLabel}</label>
          <textarea
            id="identity-life"
            className="field"
            rows={2}
            value={sheet.identityLife}
            onChange={(event) => setSheet((current) => ({ ...current, identityLife: event.target.value }))}
          />
          <div className="teacher-sheet-readonly">
            <span className="claim-meta">{c.mentorBoundaryLabel}</span>
            <p>{sheet.boundaryParagraph}</p>
          </div>
        </article>
      </div>

      <section className="teacher-sheet-ingested" aria-labelledby="ingested-title">
        <h3 id="ingested-title">
          {sheetProvenance === "draft" ? c.ingestedTitleDraft : c.ingestedTitleEmpty}
        </h3>
        <p className="field-note">
          {sheetProvenance === "draft" ? c.ingestedNoteDraft : c.ingestedNoteEmpty}
        </p>
        <div className="teacher-sheet-ingested-grid">
          {INGESTED_PREVIEW.map((item) => (
            <div key={String(item.key)} className="teacher-sheet-readonly">
              <span className="claim-meta">{c[item.labelKey]}</span>
              <p>{item.render(sheet, c)}</p>
              <small>
                {sheetProvenance === "draft" ? c.ingestedStatusDraft : c.ingestedStatusEmpty}
              </small>
            </div>
          ))}
        </div>
      </section>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
      <div className="person-model-action">
        <p>{c.publishNote}</p>
        <button className="button primary-button" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? c.saving : c.save}
        </button>
      </div>
    </section>
  );
}
