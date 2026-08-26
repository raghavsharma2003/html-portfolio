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

const SUBJECT_ID: Record<TeacherSheet["subjectDomain"], SubjectId> = {
  physics: "p",
  chemistry: "c",
  maths: "m",
};

const STRICTNESS_LABELS: Record<TeacherStrictness, string> = {
  0: "Never names it — reframes every miss as nearly right",
  1: "Gentle — softens most corrections",
  2: "Direct about the answer, easy about the person",
  3: "Names a wrong step plainly, in the same breath it's met",
  4: "No cushioning — the sharpest read of a mistake",
};

const WARMTH_LABELS: Record<TeacherWarmth, string> = {
  0: "All business — no encouragement beyond the correction itself",
  1: "Occasional, and only for a real specific win",
  2: "Steady encouragement, always tied to something they did",
  3: "Warm by default, still specific",
  4: "Highest encouragement density this sheet allows",
};

// The read-only ING/ING? sample: a representative subset of the spec's
// table, not all of it — the highest-signal, highest-recitation-risk fields,
// which is exactly where a teacher most needs to SEE what was drafted even
// though they cannot edit it here.
const INGESTED_PREVIEW: ReadonlyArray<{ key: keyof TeacherSheet; label: string; render: (sheet: TeacherSheet) => string }> = [
  { key: "languageVoiceRule", label: "Language / voice ratio", render: (s) => s.languageVoiceRule },
  { key: "sttSoundAlikes", label: "STT sound-alike pairs", render: (s) => s.sttSoundAlikes },
  { key: "boardVerbalisms", label: "Board verbalisms (catchphrase field)", render: (s) => s.boardVerbalisms.join(", ") },
  { key: "notationConventions", label: "Notation conventions", render: (s) => s.notationConventions },
  { key: "analogyBank", label: "Signature analogies", render: (s) => s.analogyBank.map((a) => `${a.topic} → ${a.anchor}`).join("; ") },
  { key: "commonMistakeBank", label: "Common mistake bank", render: (s) => `${s.commonMistakeBank.length} rows, strand-scoped` },
];

function chaptersFor(subject: TeacherSheet["subjectDomain"]) {
  const found = SYLLABUS.find((s) => s.id === SUBJECT_ID[subject]);
  return found ? found.units.map((unit) => ({ unit: unit.name, chapters: unit.chapters.map((c) => c.name) })) : [];
}

export default function TeacherSheetStudio({
  token,
  replicaId,
  sheetDraft,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  /** Storybook-style default so this screen renders fully before WS-F ships:
   *  pass the demo teacher sheet (`DEMO_TEACHER`) until a real draft exists. */
  sheetDraft: TeacherSheet;
  onAuthError: (cause: unknown) => void;
}) {
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
      setNotice("Sheet draft saved.");
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // Same soft-fail idiom: the draft is never lost, it just isn't synced.
      setServiceUnavailable(true);
      setNotice("Kept locally — the sheet service isn't connected yet.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="teacher-sheet-studio" className="teacher-sheet-studio" aria-labelledby="teacher-sheet-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Teacher clone · Sheet review</p>
          <h2 id="teacher-sheet-title">Review and confirm how {sheet.name || "this teacher"} teaches</h2>
          <p>
            Only what a teacher must decide is editable here. Everything drafted from your uploads renders read-only
            below — confirm or correct it in the claims step once ingestion is connected.
          </p>
        </div>
        <button className="text-button" type="button" onClick={() => void load()}>
          Load saved draft
        </button>
      </div>

      {serviceUnavailable && (
        <p className="inline-error" role="status">
          The teacher-sheet service isn't available yet — this draft is being kept in this screen only.
        </p>
      )}

      <div className="teacher-sheet-grid">
        <article className="teacher-sheet-card">
          <h3>Subject &amp; syllabus coverage</h3>
          <label className="field-label" htmlFor="subject-domain">Subject this clone answers in</label>
          <select
            id="subject-domain"
            className="field"
            value={sheet.subjectDomain}
            onChange={(event) => setSubject(event.target.value as TeacherSheet["subjectDomain"])}
          >
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
            onChange={(event) => setSheet((current) => ({ ...current, syllabusScope: event.target.value }))}
          />

          <p className="field-note">
            Chapter coverage — check every chapter this clone should teach. A physics teacher's clone answering
            organic chemistry is a misrepresentation of them.
          </p>
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
            Teacher-confirmed, never inferred alone — an over-read here is a real harm to a 16-year-old
            (teacher-sheet-spec.md §3).
          </p>
          <label className="field-label" htmlFor="strictness">Strictness — how bluntly a wrong answer is named</label>
          <select
            id="strictness"
            className="field"
            value={sheet.strictness}
            onChange={(event) => setSheet((current) => ({ ...current, strictness: Number(event.target.value) as TeacherStrictness }))}
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value} — {STRICTNESS_LABELS[value as TeacherStrictness]}</option>
            ))}
          </select>

          <label className="field-label" htmlFor="warmth">Warmth — encouragement density, independent of strictness</label>
          <select
            id="warmth"
            className="field"
            value={sheet.warmth}
            onChange={(event) => setSheet((current) => ({ ...current, warmth: Number(event.target.value) as TeacherWarmth }))}
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>{value} — {WARMTH_LABELS[value as TeacherWarmth]}</option>
            ))}
          </select>
        </article>

        <article className="teacher-sheet-card">
          <h3>Doubt-handling ladder</h3>
          <p className="field-note">
            The ordered hint rungs given before any full solution — this is the academic-integrity spine. A full
            solution is never the first response.
          </p>
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
              onChange={(event) => setLadderDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLadderRung(); } }}
            />
            <button className="button secondary-button" type="button" onClick={addLadderRung}>Add rung</button>
          </div>
        </article>

        <article className="teacher-sheet-card">
          <h3>Boundaries</h3>
          <p className="field-note">
            <code>identityLife</code> is teacher-authored, never ingested — a teacher's private life is not consented
            training material even when it appears in your own uploaded videos.
          </p>
          <label className="field-label" htmlFor="identity-life">Teaching life, in one breath</label>
          <textarea
            id="identity-life"
            className="field"
            rows={2}
            value={sheet.identityLife}
            onChange={(event) => setSheet((current) => ({ ...current, identityLife: event.target.value }))}
          />
          <div className="teacher-sheet-readonly">
            <span className="claim-meta">Mentor boundary · not editable here</span>
            <p>{sheet.boundaryParagraph}</p>
          </div>
        </article>
      </div>

      <section className="teacher-sheet-ingested" aria-labelledby="ingested-title">
        <h3 id="ingested-title">Drafted from your uploads</h3>
        <p className="field-note">
          Read-only until the ingestion pipeline is connected. Review or correct each one in the claims step —
          nothing here can be edited from this screen.
        </p>
        <div className="teacher-sheet-ingested-grid">
          {INGESTED_PREVIEW.map((item) => (
            <div key={String(item.key)} className="teacher-sheet-readonly">
              <span className="claim-meta">{item.label}</span>
              <p>{item.render(sheet)}</p>
              <small>Drafted from your uploads — review in the claims step</small>
            </div>
          ))}
        </div>
      </section>

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
      <div className="person-model-action">
        <p>Saving here never publishes a clone. Publish runs the full floor and consent gate separately.</p>
        <button className="button primary-button" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save sheet draft"}
        </button>
      </div>
    </section>
  );
}
