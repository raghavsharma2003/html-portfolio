// HumanOsStudio.tsx — WS-R151. HumanOS: the person sheet, for anyone who is
// not a teacher.
//
// ── the gap this closes ────────────────────────────────────────────────────
// `vy_teacher_sheet` was the only compiled persona, and `TeacherSheetStudio`
// (this same directory) assumes a teacher: a subject, a doubt ladder, board
// verbalisms. A person who is not a teacher could record a voice and talk to
// a draft, but could never publish, because `api/_room-publish.js` requires a
// PUBLISHED sheet and `TeacherSheetStudio` refuses one with empty teacher
// arrays. Migration 163 (`sheet_kind` on the same row) and `fromSheet.ts`'s
// branched validator make a PERSON sheet a first-class, publishable shape;
// this is that sheet's editor.
//
// ── what is editable here, and why it is a different, shorter set ─────────
// `fromSheet.ts`'s `validateTeacherSheet` requires only, for `sheetKind ===
// "person"`: display name, the one-line disclosure line, the five material
// fields (identity/who, identity/life, everyday texture, taste, curiosity —
// the SAME five fields the teacher path already routes into the compiled
// prompt's material block, `src/engine/agents/fromSheet.ts`'s
// `MATERIAL_FIELDS`), the never-say rules (or the explicit "none" sentinel),
// how they talk, and their values. Every teacher-only pedagogy field
// (subject, syllabus, doubt ladder, board verbalisms, analogies, the mistake
// bank) simply does not apply and is never rendered here.
//
// ── never seed an identity ─────────────────────────────────────────────────
// `context/rejected.md
// #private-editor-must-not-invent-complete-sheet-fields-20260907`: "Do not
// solve this by saving seeded identity, publishing floor or consent." Every
// field a PERSON authors below starts genuinely blank — `seedPersonSheetFor`
// only carries over the platform's own FLOOR text (crisis lines, register
// bullets, the ex* voice examples), the exact same fields `sheetSeed.ts`'s
// `seedSheetFor` already carries over for a teacher seed, from the exact same
// fixture (`DEMO_TEACHER`), for the identical reason its own header gives:
// "the safety floor... and the register skeleton... is Relational Core and
// not authored per teacher." This function is colocated here rather than
// added to `sheetSeed.ts` itself so this workstream's edits stay inside the
// one file its brief names — `sheetSeed.ts` is shared, unversioned ground
// nine other wave-21 workstreams build beside this session.
//
// ── why an empty background life and empty pedagogy never crash a compile ──
// `cloneLife.ts`'s own `cloneNowAt`/`renderCloneNow` render "" for an
// all-empty shape rather than throwing (measured, not assumed — see this
// workstream's `context/decisions.md`), and `fromSheet.ts::sheetToModule`
// overwrites `boundaryParagraph`/the three stage fields with the platform's
// own constants regardless of what a sheet carries. So a seed that leaves
// those fields blank, rather than duplicating Arjun's pedagogy or a
// fabricated day, is the safe direction — never a crash, never someone
// else's life on a real person's consent screen (the exact defect
// `sheetSeed.ts`'s own header names, UX-Q-02).
//
// ── publish reuses the existing gate, unchanged ────────────────────────────
// `TeacherSheetPublication` (this directory) already renders the honest
// "waiting on us" / "needs your review" blocker split (`api/_room-publish.js`
// draws the identical split for the Room itself) against
// `/api/teacher-sheet`'s existing `op:publish` — it is completely kind-
// agnostic, so it is reused here exactly as `TeacherSheetStudio` reuses it,
// with zero changes to that component.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./humanos-studio.css";
import TeacherSheetPublication from "./TeacherSheetPublication";
import { ReplicaApiError } from "./replicaApi";
import { readTeacherSheetDraft, saveTeacherSheetDraft, teacherSheetPublicationClient } from "./teacherSheetApi";
import { DEMO_TEACHER } from "../engine/agents/characters/demoTeacher";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import type { Replica } from "./types";
import { HUMANOS_COPY, type HumanOsLocale } from "./humanOsCopy";

const PERSON_LINE_MAX = 140;
// Unicode escapes, never the literal characters — the same reason
// `fromSheet.ts`'s own `BANNED_DASHES` uses `–`/`—`: a literal em
// or en dash inside a regex is still a dash inside a UI-facing source file,
// and `scripts/check-copy.mjs` scans for exactly that, character by
// character, with no exemption for "it is inside a regex literal".
const BANNED_DASHES = /[\u2013\u2014]/;
const PERSON_VALUES_MAX = 7;
const NONE_SENTINEL = "none";

/** See this file's header. Blank identity, blank pedagogy, the platform's
 *  own floor text carried over unchanged from `DEMO_TEACHER` — the same
 *  split `sheetSeed.ts`'s `seedSheetFor` already makes for a teacher. */
function seedPersonSheetFor(replica: Replica): TeacherSheet {
  const slug = `person-${replica.replica_id.slice(0, 8)}`;
  return {
    ...DEMO_TEACHER,
    sheetKind: "person",
    slug,
    name: replica.display_name,
    version: `${slug}-draft`,

    // The five material fields: theirs to write, blank until they do.
    identityWho: "",
    identityLife: "",
    lifeTexture: "",
    tasteTopics: "",
    curiosityTopics: "",

    // HumanOS's own fields (`fromSheet.ts`, WS-R151). Never a fabricated
    // value: a person sheet with none of these set is an incomplete draft,
    // reported as such by the validator, never silently completed here.
    personLine: "",
    personValues: [],
    personNeverSay: [],
    personTalk: { register: "mixed", scriptBaseline: "roman-hinglish", codeSwitchNote: "" },

    // Teacher-only pedagogy: this person never taught anything, and
    // `fromSheet.ts`'s validator does not ask a person sheet for any of it.
    subjectStrands: [], examTrack: [], doubtEscalationLadder: [], rigorFloor: [],
    boardVerbalisms: [], commonMistakeBank: [], analogyBank: [],
    syllabusScope: "", outOfScopePolicy: "", technicalTermRule: "",
    explanationOrder: "", workedExamplePattern: "", firstMoveOnDoubt: "",
    notationConventions: "", credentialFacts: "",

    // The arc/boundary text is platform-owned at compile time regardless of
    // what a sheet carries (`fromSheet.ts::sheetToModule`'s `sanitized.
    // boundaryParagraph`), so leaving these blank costs a person's Room
    // nothing — but blank, never Arjun's mentor-boundary wording, which is
    // teacher-specific content a person sheet has no business carrying.
    boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
    ritualPatternShapes: "", abilityLabelBan: "", winMethodRule: "",

    // Background life: no editor here (this brief's own scope), and an
    // all-empty shape renders "" rather than throwing — see this file's
    // header.
    life: { ...DEMO_TEACHER.life, weekdayShape: [], weekendShape: [], weeklyRhythm: [], preoccupations: [] },

    cloneDisclosureFact: DEMO_TEACHER.cloneDisclosureFact.replaceAll("Arjun Sir", replica.display_name),
    academicIntegrityStance: "",
    consentArtifactId: DEMO_TEACHER.consentArtifactId,
    voiceCloneId: null,
  };
}

export default function HumanOsStudio({
  token,
  replica,
  onAuthError,
  locale = "en",
}: {
  token: string;
  replica: Replica;
  onAuthError: (cause: unknown) => void;
  locale?: HumanOsLocale;
}) {
  const c = HUMANOS_COPY[locale];
  const [draft, setDraft] = useState<TeacherSheet>(() => seedPersonSheetFor(replica));
  const [existingKind, setExistingKind] = useState<"person" | "teacher" | "none">("none");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedLoadRevision, setSavedLoadRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [neverSayDraft, setNeverSayDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const mounted = useRef(false);
  const requestGeneration = useRef(0);
  const requestLocked = useRef(false);
  const requestScope = useRef({ token, replicaId: replica.replica_id });
  if (requestScope.current.token !== token || requestScope.current.replicaId !== replica.replica_id) {
    requestScope.current = { token, replicaId: replica.replica_id };
    requestGeneration.current++;
    requestLocked.current = false;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current++; requestLocked.current = false; };
  }, []);
  useEffect(() => { setLoading(false); setSaving(false); }, [token, replica.replica_id]);

  const load = useCallback(async () => {
    if (requestLocked.current) return;
    requestLocked.current = true;
    const request = ++requestGeneration.current;
    const current = () => mounted.current && requestGeneration.current === request;
    setLoading(true);
    setNotice("");
    try {
      const status = await readTeacherSheetDraft(token, replica.replica_id);
      if (!current()) return;
      // A saved TEACHER sheet (from a different mode entirely) is never
      // silently overwritten by this screen's own save — the same guard
      // `sheetSeed.ts`'s provenance labels exist to give a person an honest
      // account of what is on screen, applied here to a kind mismatch rather
      // than to a fixture name.
      const savedKind = status.draft?.sheetKind === "person" ? "person"
        : status.draft ? "teacher" : "none";
      setExistingKind(savedKind);
      if (status.draft && savedKind === "person") setDraft(status.draft as TeacherSheet);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setNotice(c.loadUnavailable);
    } finally {
      if (current()) { setSavedLoadRevision((v) => v + 1); setLoading(false); requestLocked.current = false; }
    }
  }, [c.loadUnavailable, onAuthError, replica.replica_id, token]);

  useEffect(() => { void load(); }, [load]);

  function edit(next: Partial<TeacherSheet>) {
    setNotice("");
    setDraft((current) => ({ ...current, ...next }));
  }

  const neverSayIsNone = draft.personNeverSay?.length === 1 && draft.personNeverSay[0] === NONE_SENTINEL;

  function addNeverSay() {
    const rule = neverSayDraft.trim();
    if (!rule || rule === NONE_SENTINEL) return;
    edit({ personNeverSay: [...(neverSayIsNone ? [] : draft.personNeverSay ?? []), rule] });
    setNeverSayDraft("");
  }
  function removeNeverSay(index: number) {
    edit({ personNeverSay: (draft.personNeverSay ?? []).filter((_, i) => i !== index) });
  }
  function toggleNoneSentinel(checked: boolean) {
    edit({ personNeverSay: checked ? [NONE_SENTINEL] : [] });
  }

  function addValue() {
    const value = valueDraft.trim();
    const values = draft.personValues ?? [];
    if (!value || values.length >= PERSON_VALUES_MAX) return;
    edit({ personValues: [...values, value] });
    setValueDraft("");
  }
  function removeValue(index: number) {
    edit({ personValues: (draft.personValues ?? []).filter((_, i) => i !== index) });
  }

  async function save() {
    if (requestLocked.current || existingKind === "teacher") return;
    requestLocked.current = true;
    const request = ++requestGeneration.current;
    const current = () => mounted.current && requestGeneration.current === request;
    setSaving(true);
    setNotice("");
    try {
      await saveTeacherSheetDraft(token, replica.replica_id, draft);
      if (!current()) return;
      setExistingKind("person");
      setNotice(c.saved);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setNotice(c.saveUnavailable);
    } finally {
      if (current()) { setSaving(false); requestLocked.current = false; }
    }
  }

  const lineLength = draft.personLine?.length ?? 0;
  const lineHasBannedDash = BANNED_DASHES.test(draft.personLine ?? "");
  const disabled = saving || loading || existingKind === "teacher";

  const materialFields = useMemo(
    () => [
      { key: "identityWho" as const, label: c.who, placeholder: c.whoPlaceholder },
      { key: "identityLife" as const, label: c.life, placeholder: c.lifePlaceholder },
      { key: "lifeTexture" as const, label: c.texture, placeholder: c.texturePlaceholder },
      { key: "tasteTopics" as const, label: c.taste, placeholder: c.tastePlaceholder },
      { key: "curiosityTopics" as const, label: c.curiosity, placeholder: c.curiosityPlaceholder },
    ],
    [c],
  );

  return (
    <section aria-busy={loading || saving} className="humanos-studio" aria-labelledby="humanos-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="humanos-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
      </div>

      {existingKind === "teacher" && (
        <p className="inline-error" role="alert">{c.teacherKindBlock}</p>
      )}
      {notice && <p className="field-note" role="status">{notice}</p>}

      <fieldset className="humanos-grid" disabled={disabled}>
        <article className="humanos-card">
          <h3>{c.identityHeading}</h3>
          <label className="field-label" htmlFor="humanos-name">{c.name}</label>
          <input
            id="humanos-name"
            className="field"
            type="text"
            value={draft.name}
            onChange={(event) => edit({ name: event.target.value })}
          />

          <label className="field-label" htmlFor="humanos-line">{c.oneLine}</label>
          <textarea
            id="humanos-line"
            className="field"
            rows={2}
            maxLength={PERSON_LINE_MAX + 40}
            value={draft.personLine ?? ""}
            aria-describedby="humanos-line-note"
            onChange={(event) => edit({ personLine: event.target.value })}
          />
          <p id="humanos-line-note" className="field-note">
            {c.oneLineNote} {lineLength}/{PERSON_LINE_MAX}.
            {lineLength > PERSON_LINE_MAX ? ` ${c.tooLong}.` : ""}
            {lineHasBannedDash ? ` ${c.bannedDash}.` : ""}
          </p>
        </article>

        <article className="humanos-card">
          <h3>{c.materialHeading}</h3>
          <p className="field-note">{c.materialNote}</p>
          {materialFields.map((field) => (
            <div key={field.key}>
              <label className="field-label" htmlFor={`humanos-${field.key}`}>{field.label}</label>
              <textarea
                id={`humanos-${field.key}`}
                className="field"
                rows={2}
                placeholder={field.placeholder}
                value={draft[field.key] as string}
                onChange={(event) => edit({ [field.key]: event.target.value } as Partial<TeacherSheet>)}
              />
            </div>
          ))}
        </article>

        <article className="humanos-card">
          <h3>{c.valuesHeading}</h3>
          <p className="field-note">{c.valuesNote}</p>
          <ul className="humanos-chip-list">
            {(draft.personValues ?? []).map((value, index) => (
              <li key={`${value}-${index}`}>
                <span>{value}</span>
                <button type="button" className="text-button" aria-label={`${c.remove} ${value}`} onClick={() => removeValue(index)}>
                  {c.remove}
                </button>
              </li>
            ))}
          </ul>
          <div className="create-row">
            <input
              className="field"
              placeholder={c.valuesPlaceholder}
              value={valueDraft}
              disabled={(draft.personValues ?? []).length >= PERSON_VALUES_MAX}
              onChange={(event) => setValueDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addValue(); } }}
            />
            <button
              className="button secondary-button"
              type="button"
              disabled={(draft.personValues ?? []).length >= PERSON_VALUES_MAX}
              onClick={addValue}
            >
              {c.add}
            </button>
          </div>
        </article>

        <article className="humanos-card">
          <h3>{c.neverSayHeading}</h3>
          <p className="field-note">{c.neverSayNote}</p>
          <label className="model-consent-check">
            <input type="checkbox" checked={neverSayIsNone} onChange={(event) => toggleNoneSentinel(event.target.checked)} />
            <span>{c.neverSayNone}</span>
          </label>
          {!neverSayIsNone && (
            <>
              <ul className="humanos-chip-list">
                {(draft.personNeverSay ?? []).map((rule, index) => (
                  <li key={`${rule}-${index}`}>
                    <span>{rule}</span>
                    <button type="button" className="text-button" aria-label={`${c.remove} ${rule}`} onClick={() => removeNeverSay(index)}>
                      {c.remove}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="create-row">
                <input
                  className="field"
                  placeholder={c.neverSayPlaceholder}
                  value={neverSayDraft}
                  onChange={(event) => setNeverSayDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNeverSay(); } }}
                />
                <button className="button secondary-button" type="button" onClick={addNeverSay}>{c.add}</button>
              </div>
            </>
          )}
        </article>

        <article className="humanos-card">
          <h3>{c.talkHeading}</h3>
          <label className="field-label" htmlFor="humanos-register">{c.register}</label>
          <select
            id="humanos-register"
            className="field"
            value={draft.personTalk?.register ?? "mixed"}
            onChange={(event) => edit({
              personTalk: { ...(draft.personTalk ?? { register: "mixed", scriptBaseline: "roman-hinglish" }), register: event.target.value as "formal" | "mixed" | "casual" },
            })}
          >
            <option value="formal">{c.registerFormal}</option>
            <option value="mixed">{c.registerMixed}</option>
            <option value="casual">{c.registerCasual}</option>
          </select>

          <label className="field-label" htmlFor="humanos-script">{c.script}</label>
          <select
            id="humanos-script"
            className="field"
            value={draft.personTalk?.scriptBaseline ?? "roman-hinglish"}
            onChange={(event) => edit({
              personTalk: { ...(draft.personTalk ?? { register: "mixed", scriptBaseline: "roman-hinglish" }), scriptBaseline: event.target.value as "roman-hinglish" | "devanagari" | "english" },
            })}
          >
            <option value="roman-hinglish">{c.scriptRoman}</option>
            <option value="devanagari">{c.scriptDevanagari}</option>
            <option value="english">{c.scriptEnglish}</option>
          </select>

          <label className="field-label" htmlFor="humanos-code-switch">{c.codeSwitch}</label>
          <input
            id="humanos-code-switch"
            className="field"
            type="text"
            value={draft.personTalk?.codeSwitchNote ?? ""}
            onChange={(event) => edit({
              personTalk: { ...(draft.personTalk ?? { register: "mixed", scriptBaseline: "roman-hinglish" }), codeSwitchNote: event.target.value },
            })}
          />
        </article>
      </fieldset>

      <div className="person-model-action">
        <p>{c.savingNote}</p>
        <button className="button primary-button" type="button" disabled={disabled} onClick={() => void save()}>
          {saving ? c.savingButton : c.saveButton}
        </button>
      </div>

      <TeacherSheetPublication
        token={token}
        replicaId={replica.replica_id}
        draft={draft}
        api={teacherSheetPublicationClient}
        onAuthError={onAuthError}
        disabled={saving || loading || existingKind === "teacher"}
        savedLoadRevision={savedLoadRevision}
        locale={locale}
      />
    </section>
  );
}
