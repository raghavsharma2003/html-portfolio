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
import TeacherSheetPublication from "./TeacherSheetPublication";
import { teacherSheetEditorView, type TeacherSheetEditorView } from "./teacherSheetEditorView";
import { ReplicaApiError } from "./replicaApi";
import { readTeacherSheetDraft, saveTeacherSheetDraft, teacherSheetPublicationClient } from "./teacherSheetApi";
import { SYLLABUS } from "../engine/practice/syllabus";
import type { SubjectId } from "../engine/practice/syllabus";
import type { TeacherSheet, TeacherStrictness, TeacherWarmth } from "../engine/agents/teacherTypes";
import type { SheetProvenance } from "./sheetSeed";

const SUBJECT_ID: Record<TeacherSheet["subjectDomain"], SubjectId> = {
  physics: "p",
  chemistry: "c",
  maths: "m",
};

const STRICTNESS_LABELS: Record<TeacherStrictness, string> = {
  0: "Never names it, reframes every miss as nearly right",
  1: "Gentle, softens most corrections",
  2: "Direct about the answer, easy about the person",
  3: "Names a wrong step plainly, in the same breath it's met",
  4: "No cushioning, the sharpest read of a mistake",
};

const WARMTH_LABELS: Record<TeacherWarmth, string> = {
  0: "All business, no encouragement beyond the correction itself",
  1: "Occasional, and only for a real specific win",
  2: "Steady encouragement, always tied to something they did",
  3: "Warm by default, still specific",
  4: "Highest encouragement density this sheet allows",
};

// The read-only ING/ING? sample: a representative subset of the spec's
// table, not all of it — the highest-signal, highest-recitation-risk fields,
// which is exactly where a teacher most needs to SEE what was drafted even
// though they cannot edit it here.
const INGESTED_PREVIEW: ReadonlyArray<{ key: keyof TeacherSheet; label: string; render: (sheet: TeacherSheetEditorView) => string }> = [
  { key: "languageVoiceRule", label: "Language / voice ratio", render: (s) => s.languageVoiceRule },
  { key: "sttSoundAlikes", label: "STT sound-alike pairs", render: (s) => s.sttSoundAlikes },
  { key: "boardVerbalisms", label: "Board verbalisms (catchphrase field)", render: (s) => s.boardVerbalisms.join(", ") },
  { key: "notationConventions", label: "Notation conventions", render: (s) => s.notationConventions },
  { key: "analogyBank", label: "Signature analogies", render: (s) => s.analogyBank.map((a) => `${a.topic} → ${a.anchor}`).join("; ") },
  { key: "commonMistakeBank", label: "Common mistake bank", render: (s) => `${s.commonMistakeBank.length} rows, strand-scoped` },
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
      if (editRevision.current !== revision) setNotice("Your newer edits were kept. The saved draft was not loaded.");
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
  }, [onAuthError, replicaId, token]);

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
      setNotice(editRevision.current === revision ? "Sheet draft saved." : "Earlier edits saved. Your newer edits still need saving.");
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // A transport failure cannot establish whether the write committed.
      setNotice("Saving could not be confirmed. Your edits remain here. Load the saved draft to check.");
    } finally {
      if (current()) { setSaving(false); requestLocked.current = false; }
    }
  }

  return (
    <section ref={editor} id="teacher-sheet-studio" aria-busy={loading || saving} className="teacher-sheet-studio" aria-labelledby="teacher-sheet-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sheet review</p>
          <h2 id="teacher-sheet-title">Review and confirm how {sheet.name || "this teacher"} teaches</h2>
          <p>
            Only what you have to decide is editable here. What we drafted from your uploads is read only, and you
            correct it in the claims step.
          </p>
        </div>
        <button className="text-button" type="button" disabled={loading || saving} onClick={() => void load()}>
          {loading ? "Loading saved draft..." : "Load saved draft"}
        </button>
      </div>

      {/* C16 / UX-Q-06. The old panel announced "kept locally" AFTER the
          teacher had filled it in. Provenance is announced at panel open
          instead, because that is when it changes what a person decides to do
          with the next twenty minutes. */}
      {sheetProvenance === "seed" && (
        <p className="field-note" role="status">
          Nothing is saved for this clone yet. The fields below are blank or set to a middle default, and they carry
          your name because we will never show you somebody else's. Save when you are ready.
        </p>
      )}

      {serviceUnavailable && (
        <p className="inline-error" role="status">
          The saved draft could not be loaded. Your current edits remain here.
        </p>
      )}

      {sheet.invalidFields.size > 0 ? <p className="field-note draft-invalid-notice" role="status">{"Some saved fields cannot be displayed. They stay unchanged until you explicitly edit or replace them and save."}</p> : null}
      {sheet.invalidFields.has("name") ? <p className="field-note">{"The saved name needs review."}</p> : null}
      <div className="teacher-sheet-grid">
        <article className="teacher-sheet-card">
          <h3>Subject &amp; syllabus coverage</h3>
          <label className="field-label" htmlFor="subject-domain">Subject this clone answers in</label>
          <select
            id="subject-domain"
            className="field"
            value={sheet.subjectDomain ?? ""}
            aria-invalid={sheet.invalidFields.has("subjectDomain")}
            onChange={(event) => setSubject(event.target.value as TeacherSheet["subjectDomain"])}
          >
            <option value="" disabled>{sheet.invalidFields.has("subjectDomain") ? "Saved value needs review." : "Not set"}</option>
            <option value="physics">Physics</option>
            <option value="chemistry">Chemistry</option>
            <option value="maths">Maths</option>
          </select>

          <label className="field-label" htmlFor="syllabus-scope">Scope, and what it does not answer</label>
          <textarea
            id="syllabus-scope"
            className="field"
            rows={2}
            value={sheet.syllabusScope}
            aria-invalid={sheet.invalidFields.has("syllabusScope")}
            onChange={(event) => editDraft((current) => ({ ...current, syllabusScope: event.target.value }))}
          />
          {sheet.invalidFields.has("syllabusScope") ? <p className="field-note">{"Saved value needs review."}</p> : null}

          <p className="field-note">
            Check every chapter this clone should teach. A physics teacher's clone answering
            organic chemistry is a misrepresentation of them.
          </p>
          {sheet.invalidFields.has("subjectStrands") ? <div className="draft-invalid-list"><p className="field-note">{"This saved list cannot be displayed. Replacing it starts an empty list in this draft. Save to apply your changes."}</p><button type="button" className="text-button" onClick={() => replaceList("subjectStrands")}>{"Replace chapter list"}</button></div> : null}
          <div className="syllabus-coverage" role="group" aria-label="Chapter coverage">
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
          <h3>Strictness &amp; warmth</h3>
          <p className="field-note">
            You confirm these, we never infer them alone. An over-read here is a real harm to a 16-year-old
            (teacher-sheet-spec.md §3).
          </p>
          <label className="field-label" htmlFor="strictness">Strictness: how bluntly a wrong answer is named</label>
          <select
            id="strictness"
            className="field"
            value={sheet.strictness ?? ""}
            aria-invalid={sheet.invalidFields.has("strictness")}
            onChange={(event) => editDraft((current) => ({ ...current, strictness: Number(event.target.value) as TeacherStrictness }))}
          >
            <option value="" disabled>{sheet.invalidFields.has("strictness") ? "Saved value needs review." : "Not set"}</option>
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {STRICTNESS_LABELS[value as TeacherStrictness]}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="warmth">Warmth: encouragement density, independent of strictness</label>
          <select
            id="warmth"
            className="field"
            value={sheet.warmth ?? ""}
            aria-invalid={sheet.invalidFields.has("warmth")}
            onChange={(event) => editDraft((current) => ({ ...current, warmth: Number(event.target.value) as TeacherWarmth }))}
          >
            <option value="" disabled>{sheet.invalidFields.has("warmth") ? "Saved value needs review." : "Not set"}</option>
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value}. {WARMTH_LABELS[value as TeacherWarmth]}</option>
            ))}
          </select>
        </article>

        <article className="teacher-sheet-card">
          <h3>Doubt-handling ladder</h3>
          <p className="field-note">
            The ordered hint rungs given before any full solution. This is the academic integrity spine. A full
            solution is never the first response.
          </p>
          {sheet.invalidFields.has("doubtEscalationLadder") ? <div className="draft-invalid-list"><p className="field-note">{"This saved list cannot be displayed. Replacing it starts an empty list in this draft. Save to apply your changes."}</p><button type="button" className="text-button" onClick={() => replaceList("doubtEscalationLadder")}>{"Replace doubt steps"}</button></div> : null}
          <ol className="ladder-list">
            {sheet.doubtEscalationLadder.map((rung, index) => (
              <li key={`${rung}-${index}`}>
                <span>{rung}</span>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove rung ${index + 1}`}
                  onClick={() => removeLadderRung(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <div className="create-row">
            <input
              className="field"
              placeholder="Add the next rung"
              value={ladderDraft}
              disabled={sheet.invalidFields.has("doubtEscalationLadder")}
              onChange={(event) => setLadderDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLadderRung(); } }}
            />
            <button className="button secondary-button" type="button" disabled={sheet.invalidFields.has("doubtEscalationLadder")} onClick={addLadderRung}>Add rung</button>
          </div>
        </article>

        <article className="teacher-sheet-card">
          <h3>Boundaries</h3>
          <label className="field-label" htmlFor="identity-life">Teaching life, in one breath</label>
          <textarea
            id="identity-life"
            className="field"
            rows={2}
            value={sheet.identityLife}
            aria-invalid={sheet.invalidFields.has("identityLife")}
            onChange={(event) => editDraft((current) => ({ ...current, identityLife: event.target.value }))}
          />
          {sheet.invalidFields.has("identityLife") ? <p className="field-note">{"Saved value needs review."}</p> : null}
          <details className="teacher-sheet-disclosure teacher-sheet-boundary" open={sheet.invalidFields.has("boundaryParagraph") || undefined}>
            <summary>Mentor boundary - not editable here{sheet.invalidFields.has("boundaryParagraph") ? <span className="disclosure-review">Saved value needs review.</span> : null}</summary>
          <p className="field-note">
            <code>identityLife</code> is yours to write and is never ingested. A teacher's private life is not consented
            training material even when it appears in your own uploaded videos.
          </p>
          <div className="teacher-sheet-readonly">
            <p>{sheet.invalidFields.has("boundaryParagraph") ? "Saved value needs review." : sheet.boundaryParagraph}</p>
          </div>
          </details>
        </article>
      </div>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
      <div className="person-model-action">
        <p>Saving here never publishes a clone. Publish runs the full floor and consent gate separately.</p>
        <button className="button primary-button" type="button" disabled={saving || loading} onClick={() => void save()}>
          {saving ? "Saving…" : "Save sheet draft"}
        </button>
      </div>

      <details className="teacher-sheet-disclosure teacher-sheet-ingested" open={INGESTED_PREVIEW.some(item => sheet.invalidFields.has(item.key)) || undefined}>
        <summary>Draft details (read only){sheetProvenance === "seed" ? <span className="disclosure-note">Nothing drafted yet</span> : null}{INGESTED_PREVIEW.some(item => sheet.invalidFields.has(item.key)) ? <span className="disclosure-review">Saved value needs review.</span> : null}</summary>
        <p className="field-note">
          {sheetProvenance === "draft"
            ? "Read only here. Review or correct each one in the claims step."
            : "These fill in once your uploads are processed. Read only here either way, and corrected in the claims step."}
        </p>
        <div className="teacher-sheet-ingested-grid">
          {INGESTED_PREVIEW.map((item) => (
            <div key={String(item.key)} className="teacher-sheet-readonly">
              <span className="claim-meta">{item.label}</span>
              <p>{sheet.invalidFields.has(item.key) ? "Saved value needs review." : item.render(sheet)}</p>
              {!sheet.invalidFields.has(item.key) ? <small>
                {sheetProvenance === "draft" ? "Drafted from your uploads" : "Not learned yet"}
              </small> : null}
            </div>
          ))}
        </div>
      </details>

      <TeacherSheetPublication token={token} replicaId={replicaId} draft={draft} api={teacherSheetPublicationClient} onAuthError={onAuthError} disabled={saving || loading} savedLoadRevision={savedLoadRevision} />
    </section>
  );
}
