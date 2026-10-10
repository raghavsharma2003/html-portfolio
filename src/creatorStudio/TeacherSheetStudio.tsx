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
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import "../studio/teacherSheetDisclosures.css";
import TeacherSheetPublication from "../studio/TeacherSheetPublication";
import { teacherSheetEditorView, type TeacherSheetEditorView } from "../studio/teacherSheetEditorView";
import { ReplicaApiError } from "./replicaApi";
import { readTeacherSheetDraft, saveTeacherSheetDraft, teacherSheetPublicationClient } from "./teacherSheetApi";
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
  render: (sheet: TeacherSheetEditorView, c: TSC) => string }> = [
  { key: "languageVoiceRule", labelKey: "languageVoiceRuleLabel", render: (s) => s.languageVoiceRule },
  { key: "sttSoundAlikes", labelKey: "sttSoundAlikesLabel", render: (s) => s.sttSoundAlikes },
  { key: "boardVerbalisms", labelKey: "boardVerbalismsLabel", render: (s) => s.boardVerbalisms.join(", ") },
  { key: "notationConventions", labelKey: "notationConventionsLabel", render: (s) => s.notationConventions },
  { key: "analogyBank", labelKey: "analogyBankLabel", render: (s) => s.analogyBank.map((a) => `${a.topic} → ${a.anchor}`).join("; ") },
  { key: "commonMistakeBank", labelKey: "commonMistakeBankLabel", render: (s, c) => c.commonMistakeBankSummary.split("{n}").join(String(s.commonMistakeBank.length)) },
];

function chaptersFor(subject: TeacherSheet["subjectDomain"] | undefined) {
  if (!subject) return [];
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
  sheetDraft: Partial<TeacherSheet>;
  /** Which of those two the sheet above is. Drives the provenance labels: a
   *  seed may not be captioned "drafted from your uploads", because nothing was
   *  drafted and nothing was uploaded (copy audit C17). */
  sheetProvenance: SheetProvenance;
  onAuthError: (cause: unknown) => void;
}) {
  const { t, locale } = useStudioLocale();
  const c = t.teacherSheetStudio;
  const [draft, setDraft] = useState<Partial<TeacherSheet>>(sheetDraft);
  const editRevision = useRef(0);
  const requestGeneration = useRef(0);
  const requestLocked = useRef(false);
  const mounted = useRef(false);
  const requestScope = useRef({ token, replicaId });
  if (requestScope.current.token !== token || requestScope.current.replicaId !== replicaId) {
    requestScope.current = { token, replicaId };
    requestGeneration.current++;
    requestLocked.current = false;
  }
  function editDraft(next: SetStateAction<Partial<TeacherSheet>>) {
    // Every explicit edit wins over an older saved-load snapshot, even when
    // React batches the editing state update with the response.
    editRevision.current++;
    setNotice("");
    setDraft(next);
  }
  const editor = useRef<HTMLElement>(null);
  const sheet = useMemo(() => teacherSheetEditorView(draft), [draft]);
  const [ladderDraft, setLadderDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedLoadRevision, setSavedLoadRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [serviceUnavailable, setServiceUnavailable] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current++; requestLocked.current = false; };
  }, []);
  useEffect(() => { setLoading(false); setSaving(false); }, [token, replicaId]);

  const units = useMemo(() => chaptersFor(sheet.subjectDomain), [sheet.subjectDomain]);
  const coveredChapters = useMemo(
    () => new Set(sheet.subjectStrands.map((strand) => strand.toLowerCase())),
    [sheet.subjectStrands],
  );

  const load = useCallback(async () => {
    if (requestLocked.current) return;
    requestLocked.current = true;
    const request = ++requestGeneration.current;
    const revision = editRevision.current;
    const current = () => mounted.current && requestGeneration.current === request;
    setSavedLoadRevision(value => value + 1);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const status = await readTeacherSheetDraft(token, replicaId);
      if (!current()) return;
      if (editRevision.current !== revision) setNotice(c.loadKeptNewerEdits);
      else if (status.draft) setDraft(status.draft);
      setServiceUnavailable(false);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setServiceUnavailable(true);
    } finally {
      if (current()) {
        // Identical, ignored and failed loads all invalidate saved publication.
        setSavedLoadRevision(value => value + 1);
        setLoading(false);
        requestLocked.current = false;
      }
    }
  }, [onAuthError, replicaId, token, c.loadKeptNewerEdits]);

  function toggleChapter(name: string) {
    const key = name.toLowerCase();
    editDraft(current => {
      const view = teacherSheetEditorView(current);
      if (view.invalidFields.has("subjectStrands")) return current;
      return {...current, subjectStrands: view.subjectStrands.some(strand => strand.toLowerCase() === key)
        ? view.subjectStrands.filter(strand => strand.toLowerCase() !== key) : [...view.subjectStrands, name]};
    });
  }

  function setSubject(subjectDomain: TeacherSheet["subjectDomain"]) {
    editDraft(current => ({...current, subjectDomain,
      ...(teacherSheetEditorView(current).invalidFields.has("subjectStrands") ? {} : {subjectStrands: []})}));
  }

  function addLadderRung() {
    const rung = ladderDraft.trim();
    if (!rung || sheet.invalidFields.has("doubtEscalationLadder")) return;
    editDraft(current => {
      const view = teacherSheetEditorView(current);
      return view.invalidFields.has("doubtEscalationLadder") ? current : {...current, doubtEscalationLadder: [...view.doubtEscalationLadder, rung]};
    });
    setLadderDraft("");
  }

  function removeLadderRung(index: number) {
    editDraft(current => {
      const view = teacherSheetEditorView(current);
      return view.invalidFields.has("doubtEscalationLadder") ? current : {...current, doubtEscalationLadder: view.doubtEscalationLadder.filter((_, i) => i !== index)};
    });
  }

  function replaceList(field: "subjectStrands" | "doubtEscalationLadder") {
    // This explicit action replaces only the local field. Focus synchronously
    // after its controls become usable, before any later user interaction.
    flushSync(() => editDraft(current => ({...current, [field]: []})));
    const target = field === "subjectStrands" ? editor.current?.querySelector<HTMLInputElement>(".syllabus-chapters input:not(:disabled)") || editor.current?.querySelector<HTMLSelectElement>("#subject-domain") : editor.current?.querySelector<HTMLInputElement>(".create-row input");
    target?.focus();
  }

  async function save() {
    if (requestLocked.current) return;
    requestLocked.current = true;
    const request = ++requestGeneration.current;
    const revision = editRevision.current;
    const current = () => mounted.current && requestGeneration.current === request;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveTeacherSheetDraft(token, replicaId, draft);
      if (!current()) return;
      setServiceUnavailable(false);
      setNotice(editRevision.current === revision ? c.saved : c.savedEarlierEdits);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // A transport failure cannot establish whether the write committed.
      setNotice(c.saveUnconfirmed);
    } finally {
      if (current()) { setSaving(false); requestLocked.current = false; }
    }
  }

  return (
    <section ref={editor} id="teacher-sheet-studio" aria-busy={loading || saving} className="teacher-sheet-studio" aria-labelledby="teacher-sheet-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="teacher-sheet-title">{c.title.split("{name}").join(sheet.name || c.titleFallbackName)}</h2>
          <p>{c.intro}</p>
        </div>
        <button className="text-button" type="button" disabled={loading || saving} onClick={() => void load()}>
          {loading ? c.loadingSavedDraft : c.loadSavedDraft}
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

      {sheet.invalidFields.size > 0 ? <p className="field-note draft-invalid-notice" role="status">{c.invalidSavedFieldsNotice}</p> : null}
      {sheet.invalidFields.has("name") ? <p className="field-note">{c.invalidSavedName}</p> : null}
      <div className="teacher-sheet-grid">
        <article className="teacher-sheet-card">
          <h3>{c.subjectCardTitle}</h3>
          <label className="field-label" htmlFor="subject-domain">{c.subjectLabel}</label>
          <select
            id="subject-domain"
            className="field"
            value={sheet.subjectDomain ?? ""}
            aria-invalid={sheet.invalidFields.has("subjectDomain")}
            onChange={(event) => setSubject(event.target.value as TeacherSheet["subjectDomain"])}
          >
            <option value="" disabled>{sheet.invalidFields.has("subjectDomain") ? c.invalidSavedValue : locale === "hi" ? "अभी तय नहीं" : "Not set"}</option>
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
            aria-invalid={sheet.invalidFields.has("syllabusScope")}
            onChange={(event) => editDraft((current) => ({ ...current, syllabusScope: event.target.value }))}
          />
          {sheet.invalidFields.has("syllabusScope") ? <p className="field-note">{c.invalidSavedValue}</p> : null}

          <p className="field-note">{c.chapterNote}</p>
          {sheet.invalidFields.has("subjectStrands") ? <div className="draft-invalid-list"><p className="field-note">{c.replaceListNote}</p><button type="button" className="text-button" onClick={() => replaceList("subjectStrands")}>{c.replaceChapterList}</button></div> : null}
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
                        disabled={sheet.invalidFields.has("subjectStrands")}
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
            value={sheet.strictness ?? ""}
            aria-invalid={sheet.invalidFields.has("strictness")}
            onChange={(event) => editDraft((current) => ({ ...current, strictness: Number(event.target.value) as TeacherStrictness }))}
          >
            <option value="" disabled>{sheet.invalidFields.has("strictness") ? c.invalidSavedValue : locale === "hi" ? "अभी तय नहीं" : "Not set"}</option>
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {strictnessLabel(value as TeacherStrictness, c)}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="warmth">{c.warmthLabel}</label>
          <select
            id="warmth"
            className="field"
            value={sheet.warmth ?? ""}
            aria-invalid={sheet.invalidFields.has("warmth")}
            onChange={(event) => editDraft((current) => ({ ...current, warmth: Number(event.target.value) as TeacherWarmth }))}
          >
            <option value="" disabled>{sheet.invalidFields.has("warmth") ? c.invalidSavedValue : locale === "hi" ? "अभी तय नहीं" : "Not set"}</option>
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {warmthLabel(value as TeacherWarmth, c)}</option>
            ))}
          </select>
        </article>

        <article className="teacher-sheet-card">
          <h3>{c.ladderCardTitle}</h3>
          <p className="field-note">{c.ladderNote}</p>
          {sheet.invalidFields.has("doubtEscalationLadder") ? <div className="draft-invalid-list"><p className="field-note">{c.replaceListNote}</p><button type="button" className="text-button" onClick={() => replaceList("doubtEscalationLadder")}>{c.replaceDoubtSteps}</button></div> : null}
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
              disabled={sheet.invalidFields.has("doubtEscalationLadder")}
              onChange={(event) => setLadderDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLadderRung(); } }}
            />
            <button className="button secondary-button" type="button" disabled={sheet.invalidFields.has("doubtEscalationLadder")} onClick={addLadderRung}>{c.addRung}</button>
          </div>
        </article>

        <article className="teacher-sheet-card">
          <h3>{c.boundariesCardTitle}</h3>
          <label className="field-label" htmlFor="identity-life">{c.identityLifeLabel}</label>
          <textarea
            id="identity-life"
            className="field"
            rows={2}
            value={sheet.identityLife}
            aria-invalid={sheet.invalidFields.has("identityLife")}
            onChange={(event) => editDraft((current) => ({ ...current, identityLife: event.target.value }))}
          />
          {sheet.invalidFields.has("identityLife") ? <p className="field-note">{c.invalidSavedValue}</p> : null}
          <details className="teacher-sheet-disclosure teacher-sheet-boundary" open={sheet.invalidFields.has("boundaryParagraph") || undefined}>
            <summary>{c.mentorBoundaryLabel}{sheet.invalidFields.has("boundaryParagraph") ? <span className="disclosure-review">{c.invalidSavedValue}</span> : null}</summary>
          <p className="field-note">{c.boundariesNote}</p>
          <div className="teacher-sheet-readonly">
            <p>{sheet.invalidFields.has("boundaryParagraph") ? c.invalidSavedValue : sheet.boundaryParagraph}</p>
          </div>
          </details>
        </article>
      </div>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
      <div className="person-model-action">
        <p>{c.publishNote}</p>
        <button className="button primary-button" type="button" disabled={saving || loading} onClick={() => void save()}>
          {saving ? c.saving : c.save}
        </button>
      </div>

      <details className="teacher-sheet-disclosure teacher-sheet-ingested" open={INGESTED_PREVIEW.some(item => sheet.invalidFields.has(item.key)) || undefined}>
        <summary>{c.draftDetailsLabel}{sheetProvenance === "seed" ? <span className="disclosure-note">{c.ingestedTitleEmpty}</span> : null}{INGESTED_PREVIEW.some(item => sheet.invalidFields.has(item.key)) ? <span className="disclosure-review">{c.invalidSavedValue}</span> : null}</summary>
        <p className="field-note">
          {sheetProvenance === "draft" ? c.ingestedNoteDraft : c.ingestedNoteEmpty}
        </p>
        <div className="teacher-sheet-ingested-grid">
          {INGESTED_PREVIEW.map((item) => (
            <div key={String(item.key)} className="teacher-sheet-readonly">
              <span className="claim-meta">{c[item.labelKey]}</span>
              <p>{sheet.invalidFields.has(item.key) ? c.invalidSavedValue : item.render(sheet, c)}</p>
              {!sheet.invalidFields.has(item.key) ? <small>
                {sheetProvenance === "draft" ? c.ingestedStatusDraft : c.ingestedStatusEmpty}
              </small> : null}
            </div>
          ))}
        </div>
      </details>

      <TeacherSheetPublication token={token} replicaId={replicaId} draft={draft} api={teacherSheetPublicationClient} onAuthError={onAuthError} disabled={saving || loading} savedLoadRevision={savedLoadRevision} locale={locale} />
    </section>
  );
}
