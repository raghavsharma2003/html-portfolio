// PracticeActivity — the Gurukul practice hub AND the session runner, in one
// screen with three views: pick a set, answer it one question at a time,
// read the summary. `student-app-spec.md` §5's "Practice Hub" names three
// more sub-surfaces (Revision Queue, Mock Tests) that are explicitly out of
// this workstream's scope — WS-D's brief is the topic picker, the difficulty
// band, the question count, and the session runner itself; the queue and the
// mock cycle are separate, later work and are not stubbed here.
//
// ── the one rule this file is built around ─────────────────────────────────
//
// THIS COMPONENT COMPUTES NOTHING. Every number on screen — a mark, a
// verdict, a mastery moment — comes out of `engine/practice/session.ts` and
// `engine/practiceTalk.ts`, the same "her MOVE is code" split `ChessActivity`
// keeps by never importing `engine/chess`'s search from its own state. This
// file calls `composeSet`, `startSession`, `submit`, `grade` (via `submit`),
// `summarize`, `momentsAt` — never re-derives a mark, a verdict or a moment
// shape from a `Response` itself. If a number here is ever wrong, the fix is
// in the engine, not in this file's arithmetic, because this file has none.
//
// ── the one interaction rule ────────────────────────────────────────────
//
// A VERDICT NEVER APPEARS BEFORE COMMIT. The student answers, taps Submit,
// and only THEN does the graded result render — never a live "you're right!"
// the instant an option is tapped, which is the thing that would turn a JEE
// set into a slot machine and is precisely the shape `student-app-spec.md`
// §2.5 rejects speed bonuses for corrupting. `phase` below is the whole
// mechanism: `"answering"` shows no verdict at all, `"revealed"` shows
// exactly one (the question just committed) and nothing else, and there is no
// third state that blends them.
//
// ── why session state is local to this component ───────────────────────────
//
// `PracticeSession` does not live in `AppState.game` the way chess/ttt/wyr
// do. Wiring a practice set into that slot would also mean wiring it into
// App.tsx's always-mounted reconciler, the live-call activity ledger and
// `activityNote()` pokes mid-call — real, larger work `SPEC-GURUKUL.md`'s
// workstream table does not assign to WS-D. So a session here is `useState`,
// scoped to this component's mount, and a finished set is hard-committed to
// `gurukul/practiceStore.ts` the moment it ends — the same "durable half
// survives the ephemeral half closing" split `chessTalk.ts` keeps between
// `facts` and `record`, just kept in `localStorage` instead of the relational
// memory this workstream does not touch.

import { useCallback, useMemo, useState } from "react";
import {
  composeSet,
  currentQuestion,
  endEarly,
  momentsAt,
  skip,
  startSession,
  submit,
  summarize,
  type Graded,
  type MatrixRow,
  type PracticeMoment,
  type PracticeSession,
  type Response,
} from "../engine/practice/session";
import { attemptFact, momentFact } from "../engine/practiceTalk";
import {
  BANDS,
  SYLLABUS,
  nameFor,
  type DifficultyBand,
  type Subject,
} from "../engine/practice/syllabus";
import { DEMO_QUESTIONS, demoQuestionFor, type DemoQuestion } from "../engine/practice/demoBank";
import { recordPracticeSession } from "../gurukul/practiceStore";
import "../styles/practice.css";

interface Props {
  onExit: () => void;
}

type View = "pick" | "running" | "summary";

const BAND_LABEL: Record<DifficultyBand, string> = {
  foundation: "Foundation",
  standard: "Standard",
  advanced: "Advanced",
  pyq: "Past-paper",
};

const N_OPTIONS = [5, 8, 10] as const;

// ── the picker (the hub entry) ──────────────────────────────────────────────

function Picker({
  onStart,
}: {
  onStart: (topicIds: readonly string[], band: DifficultyBand, n: number) => void;
}) {
  // A leaf pick is a topic id when the chapter has one, else the chapter id —
  // `syllabus.ts`'s own `masteryNodes()` shape, so a chapter with no topics
  // entered yet is still a legal, gradeable pick rather than a dead row.
  const [topicId, setTopicId] = useState<string>(SYLLABUS[0]?.units[0]?.chapters[0]?.id ?? "");
  const [band, setBand] = useState<DifficultyBand>("foundation");
  const [n, setN] = useState<number>(8);

  // Only leaves the demo bank actually has questions for are offered — a
  // picker that lets you choose a topic with nothing to grade is a dead end
  // dressed as a form.
  const available = useMemo(() => {
    const set = new Set<string>();
    for (const q of DEMO_QUESTIONS) set.add(q.topicId);
    return set;
  }, []);

  const bandCounts = useMemo(() => {
    const counts = new Map<DifficultyBand, number>();
    for (const q of DEMO_QUESTIONS) {
      if (q.topicId !== topicId) continue;
      counts.set(q.band, (counts.get(q.band) ?? 0) + 1);
    }
    return counts;
  }, [topicId]);

  const rows: { id: string; label: string; subject: Subject["name"] }[] = [];
  for (const s of SYLLABUS) {
    for (const u of s.units) {
      for (const c of u.chapters) {
        const leaves = c.topics.length ? c.topics.map((t) => t.id) : [c.id];
        for (const leaf of leaves) {
          if (!available.has(leaf)) continue;
          rows.push({ id: leaf, label: `${c.name}: ${nameFor(leaf)}`.replace(/: $/, ""), subject: s.name });
        }
      }
    }
  }

  const readyCount = bandCounts.get(band) ?? 0;

  return (
    <div className="pa-pick">
      <h2 className="pa-h2">Practice Hub</h2>
      <p className="pa-lede">Pick a topic, a difficulty band, and how many questions.</p>

      <label className="pa-field">
        <span>Topic</span>
        <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.subject}: {r.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="pa-field">
        <legend>Difficulty</legend>
        <div className="pa-chips" role="radiogroup" aria-label="Difficulty band">
          {BANDS.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={b === band}
              className="pa-chip"
              data-active={b === band}
              onClick={() => setBand(b)}
            >
              {BAND_LABEL[b]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pa-field">
        <legend>How many questions</legend>
        <div className="pa-chips" role="radiogroup" aria-label="Question count">
          {N_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              role="radio"
              aria-checked={count === n}
              className="pa-chip"
              data-active={count === n}
              onClick={() => setN(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </fieldset>

      <p className="pa-avail" aria-live="polite">
        {readyCount > 0
          ? `${Math.min(readyCount, n)} question${Math.min(readyCount, n) === 1 ? "" : "s"} ready in this band`
          : "no questions banked at this band for this topic yet, try another band"}
      </p>

      <button
        type="button"
        className="pa-start"
        disabled={readyCount === 0}
        onClick={() => onStart([topicId], band, n)}
      >
        Start set
      </button>
    </div>
  );
}

// ── answer inputs, one per format ───────────────────────────────────────────

function OptionsInput({
  demo,
  multi,
  chosen,
  onChange,
}: {
  demo: DemoQuestion;
  multi: boolean;
  chosen: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  const toggle = (id: string) => {
    if (multi) {
      onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
    } else {
      onChange([id]);
    }
  };
  return (
    <div className="pa-options" role={multi ? "group" : "radiogroup"} aria-label="Options">
      {(demo.options ?? []).map((o) => {
        const active = chosen.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={active}
            className="pa-opt"
            data-active={active}
            onClick={() => toggle(o.id)}
          >
            <span className="pa-opt-id">{o.id}</span>
            <span className="pa-opt-text">{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function ValueInput({ value, unit, onChange }: { value: string; unit?: string; onChange: (v: string) => void }) {
  return (
    <label className="pa-value">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder="your answer"
        onChange={(e) => onChange(e.target.value)}
        aria-label="Numeric answer"
      />
      {unit ? <span className="pa-unit">{unit}</span> : null}
    </label>
  );
}

function MatrixInput({
  demo,
  rows,
  onChange,
}: {
  demo: DemoQuestion;
  rows: readonly MatrixRow[];
  onChange: (next: readonly MatrixRow[]) => void;
}) {
  const byRow = new Map(rows.map((r) => [r.row, r.cols]));
  const toggle = (row: string, col: string) => {
    const cur = byRow.get(row) ?? [];
    const next = cur.includes(col) ? cur.filter((c) => c !== col) : [...cur, col];
    onChange([...rows.filter((r) => r.row !== row), { row, cols: next }]);
  };
  return (
    <div className="pa-matrix" role="group" aria-label="Matrix match">
      {(demo.matrixRows ?? []).map((r) => (
        <div className="pa-matrix-row" key={r.id}>
          <span className="pa-matrix-label">
            {r.id}. {r.text}
          </span>
          <div className="pa-matrix-cols">
            {(demo.matrixCols ?? []).map((c) => {
              const active = (byRow.get(r.id) ?? []).includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  className="pa-opt pa-opt-sm"
                  data-active={active}
                  onClick={() => toggle(r.id, c.id)}
                  title={c.text}
                >
                  {c.id}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── the verdict, AFTER commit only ──────────────────────────────────────────

const VERDICT_LABEL: Record<Graded["verdict"], string> = {
  clean_solve: "Correct, full marks",
  partial: "Partial credit",
  slip: "Not quite, a slip",
  conceptual_miss: "Missed",
  skipped: "Skipped",
  rushed: "Too fast to count as solved",
};

function VerdictCard({ g, moment }: { g: Graded; moment: PracticeMoment | null }) {
  return (
    <div className="pa-verdict" data-kind={g.verdict} role="status">
      <b>{VERDICT_LABEL[g.verdict]}</b>
      <span className="pa-marks">
        {g.marks} / {g.maxMarks} marks
      </span>
      <p className="pa-fact">{attemptFact(g)}</p>
      {moment ? <p className="pa-moment">{momentFact(moment)}</p> : null}
    </div>
  );
}

// ── the session runner ───────────────────────────────────────────────────

function Runner({
  session,
  setSession,
  onFinish,
}: {
  session: PracticeSession;
  setSession: (s: PracticeSession) => void;
  onFinish: (s: PracticeSession) => void;
}) {
  const q = currentQuestion(session);
  const demo = q ? demoQuestionFor(q.id) : null;
  const [phase, setPhase] = useState<"answering" | "revealed">("answering");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [chosenOptions, setChosenOptions] = useState<readonly string[]>([]);
  const [chosenValue, setChosenValue] = useState("");
  const [chosenMatrix, setChosenMatrix] = useState<readonly MatrixRow[]>([]);
  const [lastGraded, setLastGraded] = useState<Graded | null>(null);
  const [lastMoment, setLastMoment] = useState<PracticeMoment | null>(null);

  const resetInputs = useCallback(() => {
    setChosenOptions([]);
    setChosenValue("");
    setChosenMatrix([]);
    setStartedAt(Date.now());
    setPhase("answering");
  }, []);

  const responseFor = (): Response => {
    if (!q) return { kind: "skipped" };
    switch (q.key.format) {
      case "single_correct":
      case "multi_correct":
        return chosenOptions.length ? { kind: "options", chosen: chosenOptions } : { kind: "skipped" };
      case "integer":
      case "numerical": {
        const v = Number(chosenValue);
        return chosenValue.trim() !== "" && Number.isFinite(v) ? { kind: "value", value: v } : { kind: "skipped" };
      }
      case "matrix_match":
        return chosenMatrix.length ? { kind: "matrix", rows: chosenMatrix } : { kind: "skipped" };
    }
  };

  const commit = useCallback(() => {
    if (!q || phase !== "answering") return;
    const elapsed = Date.now() - startedAt;
    const next = submit(session, responseFor(), elapsed);
    const g = next.graded[next.graded.length - 1] ?? null;
    setSession(next);
    setLastGraded(g);
    setLastMoment(g ? (momentsAt(next, g.questionId)[0] ?? null) : null);
    setPhase("revealed");
  }, [q, phase, startedAt, session, setSession, chosenOptions, chosenValue, chosenMatrix]);

  const next = useCallback(() => {
    if (session.over) {
      onFinish(session);
      return;
    }
    resetInputs();
  }, [resetInputs, session, onFinish]);

  const doSkip = useCallback(() => {
    if (phase !== "answering") return;
    const s2 = skip(session, Date.now() - startedAt);
    const g = s2.graded[s2.graded.length - 1] ?? null;
    setSession(s2);
    setLastGraded(g);
    setLastMoment(null);
    setPhase("revealed");
  }, [phase, session, setSession, startedAt]);

  const endNow = useCallback(() => {
    const s2 = endEarly(session);
    setSession(s2);
    onFinish(s2);
  }, [session, setSession, onFinish]);

  if (!q || !demo) {
    // The set finished on the last commit — advance straight to the summary
    // rather than rendering a runner with nothing to show.
    if (session.over) onFinish(session);
    return null;
  }

  const total = session.questions.length;
  const idx = session.index + 1;

  return (
    <div className="pa-run">
      <div className="pa-progress" aria-live="polite">
        Question {Math.min(idx, total)} of {total}
        <span className="pa-band">{BAND_LABEL[q.band]}</span>
      </div>

      <p className="pa-prompt">{demo.prompt}</p>

      {phase === "answering" ? (
        <>
          {(q.key.format === "single_correct" || q.key.format === "multi_correct") && (
            <OptionsInput
              demo={demo}
              multi={q.key.format === "multi_correct"}
              chosen={chosenOptions}
              onChange={setChosenOptions}
            />
          )}
          {(q.key.format === "integer" || q.key.format === "numerical") && (
            <ValueInput value={chosenValue} unit={demo.unit} onChange={setChosenValue} />
          )}
          {q.key.format === "matrix_match" && (
            <MatrixInput demo={demo} rows={chosenMatrix} onChange={setChosenMatrix} />
          )}

          <div className="pa-actions">
            <button type="button" className="pa-secondary" onClick={doSkip}>
              Skip
            </button>
            <button type="button" className="pa-primary" onClick={commit}>
              Submit
            </button>
          </div>
        </>
      ) : (
        <>
          {lastGraded ? <VerdictCard g={lastGraded} moment={lastMoment} /> : null}
          <div className="pa-actions">
            <button type="button" className="pa-primary" onClick={next}>
              {session.over ? "See summary" : "Next question"}
            </button>
          </div>
        </>
      )}

      <button type="button" className="pa-end-early" onClick={endNow}>
        End set now
      </button>
    </div>
  );
}

// ── the summary ──────────────────────────────────────────────────────────

function Summary({ session, onDone }: { session: PracticeSession; onDone: () => void }) {
  const sum = useMemo(() => summarize(session), [session]);
  return (
    <div className="pa-summary">
      <h2 className="pa-h2">{session.endedEarly ? "Set ended early" : "Set complete"}</h2>
      <p className="pa-totals">
        {sum.clean} of {sum.total} clean solves · {sum.marks} / {sum.maxMarks} marks
      </p>

      <ul className="pa-topics">
        {sum.byTopic.map((t) => (
          <li key={t.topicId} className="pa-topic-row">
            <span>{nameFor(t.topicId) || t.topicId}</span>
            <span>
              {t.clean}/{t.attempted} clean · {t.marks}/{t.maxMarks}
            </span>
          </li>
        ))}
      </ul>

      {sum.moments.length ? (
        <div className="pa-moments">
          {sum.moments.map((m, i) => (
            <p className="pa-moment" key={i}>
              {momentFact(m)}
            </p>
          ))}
        </div>
      ) : null}

      <button type="button" className="pa-primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

// ── the screen ──────────────────────────────────────────────────────────

export default function PracticeActivity({ onExit }: Props) {
  const [view, setView] = useState<View>("pick");
  const [session, setSession] = useState<PracticeSession | null>(null);

  const start = useCallback((topicIds: readonly string[], band: DifficultyBand, n: number) => {
    const questions = composeSet(DEMO_QUESTIONS, { topicIds, band, n });
    setSession(startSession({ topicIds, band, n }, questions, Date.now()));
    setView("running");
  }, []);

  const finish = useCallback((s: PracticeSession) => {
    // The store's own guard (`!session.over`) makes this safe to call at
    // every place a set could end — early exit, the last commit, a reload
    // resuming into an already-over session — without a second finished
    // record ever being written for the same set.
    recordPracticeSession(s, s.graded);
    setView("summary");
  }, []);

  const restart = useCallback(() => {
    setSession(null);
    setView("pick");
  }, []);

  return (
    <div className="pa-screen">
      <header className="pa-head">
        <button type="button" className="pa-back" onClick={onExit} aria-label="Back">
          ‹ Back
        </button>
        <span className="pa-title">Practice</span>
      </header>
      <div className="pa-body">
        {view === "pick" && <Picker onStart={start} />}
        {view === "running" && session && <Runner session={session} setSession={setSession} onFinish={finish} />}
        {view === "summary" && session && <Summary session={session} onDone={restart} />}
      </div>
    </div>
  );
}
