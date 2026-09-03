// ReadinessPanel — the one screen a creator reads before they publish.
// Vyakti Rooms v1, WS-R3.
//
//   Readiness 61
//   Knows your material 88   Sounds like you 71   Thinks like you 52
//   Knows what not to say 94   Up to date 79
//   Publishing is locked. Weakest: thinks like you.  [one action]
//
// ── THE THING THIS COMPONENT REFUSES TO DO ───────────────────────────────
//
// COMPUTE ANYTHING. Not an average, not a rounding, not a zero where a null
// arrived. The server decides what is measured; this file decides how it looks.
// The moment a client fills a gap with a plausible default, DESIGN-LAW §1 is
// gone and nobody can tell from the screen, which is `plausible-return-hides-
// a-dead-pipeline` rendered at 42px.
//
// So a part with `value: null` renders the words "Not measured yet" and its own
// reason. It never renders 0, it never renders a dash where a number goes, and
// it never renders a bar at 0%. There is no progress bar on this screen at all:
// `activity-is-a-read-not-a-progress-bar` is the same law one surface over.
//
// ── WHY THE HEADLINE CAN BE A SENTENCE ───────────────────────────────────
//
// When any part is unmeasured there IS no overall, so the biggest thing on the
// screen is a sentence rather than a number. That looks unfinished and it is
// correct: the honest answer to "how ready is my AI" when two of five
// instruments do not exist is not a number, it is which two. The word for an
// incomplete AI here is "apprentice", never "broken".
//
// ── THE ONE ACTION ───────────────────────────────────────────────────────
//
// Exactly one, chosen by the server from a fixed table, always the weakest
// part's own. Every entry in that table points at a control that exists on a
// step of this wizard, which is why the button takes `onGoStep` as well as an
// anchor: a button that scrolled to nothing would be the same defect as a
// progress bar that moves on a timer.
//
// ── FEEL (DESIGN-LAW §2) ─────────────────────────────────────────────────
//
// Press feedback is a CSS `:active` transform, so it fires on pointer-down
// without taking `onClick`'s semantics away from a keyboard. Only transform
// and opacity animate. The per-part disclosure is a native `<details>`, which
// is interruptible for free and which `jumpTo` already knows how to open.
import { useCallback, useEffect, useState } from "react";
import "./readiness.css";
import { ReplicaApiError } from "./replicaApi";
import { readReadiness, type Readiness, type ReadinessAction, type ReadinessPart } from "./readinessApi";
import type { StepId } from "./wizardModel";
import { jumpTo } from "./WizardRail";

/** Short, plain, and each one says what a low score would MEAN. Kept here
 *  rather than on the wire because it is copy, and copy belongs where the copy
 *  gate can read it (scripts/check-copy.mjs scopes src/studio, not api/). */
const PART_HELP: Record<string, string> = {
  knows_your_material: "Whether it can answer from what you gave us.",
  sounds_like_you: "Whether your voice comes back as yours.",
  thinks_like_you: "Whether you keep its answers or correct them.",
  knows_what_not_to_say: "The lines you have told it never to cross.",
  up_to_date: "Whether what it knows is still true.",
};

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

function shortDate(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : DATE.format(at);
}

/** The measured/unmeasured mark. A word, never a bare colour: DESIGN-SYSTEM §5
 *  rule 2, and here it is the difference between "we measured this and it is
 *  low" and "nobody has measured this", which is the whole screen. */
function partState(part: ReadinessPart, floor: number): "measured" | "low" | "unmeasured" {
  if (!part.measured || part.value === null) return "unmeasured";
  return part.value < floor ? "low" : "measured";
}

function PartCard({ part, floor }: { part: ReadinessPart; floor: number }) {
  const state = partState(part, floor);
  const when = shortDate(part.measured_at);
  // The hover half of "n and date on hover or tap". The tap half is the
  // <details> below, so neither input device is the only way in.
  const hover = [part.method, part.n === null ? "" : `Sample: ${part.n}.`, when ? `Measured ${when}.` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <details className={`vy-readiness__part vy-readiness__part--${state}`}>
      <summary title={hover}>
        <span className="vy-readiness__part-label">{part.label}</span>
        {state === "unmeasured" ? (
          <strong className="vy-readiness__part-absent">Not measured yet</strong>
        ) : (
          <strong className="vy-readiness__part-value">{part.value}</strong>
        )}
        <span className="vy-readiness__part-help">{PART_HELP[part.id] ?? ""}</span>
      </summary>
      <div className="vy-readiness__part-body">
        <p className="vy-readiness__part-detail">{part.detail}</p>
        <dl className="vy-readiness__part-meta">
          <div>
            <dt>How</dt>
            <dd>{part.method}</dd>
          </div>
          {part.n !== null && (
            <div>
              <dt>Sample</dt>
              <dd>{part.n}</dd>
            </div>
          )}
          {when && (
            <div>
              <dt>Measured</dt>
              <dd>{when}</dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  );
}

export default function ReadinessPanel({
  token,
  replicaId,
  onAuthError,
  onGoStep,
  onReadiness,
}: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
  onGoStep: (step: StepId) => void;
  onReadiness?: (readiness: Readiness) => void;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await readReadiness(token, replicaId);
      setReadiness(next);
      onReadiness?.(next);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      // "waiting on us", named. Never a blank card, and never a zero: a failed
      // read is a platform failure and it says so rather than looking like a
      // clone that scored nothing.
      setError(cause instanceof Error ? cause.message : "We could not read your readiness just now");
    } finally {
      setLoading(false);
    }
  }, [onAuthError, onReadiness, replicaId, token]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback((action: ReadinessAction) => {
    onGoStep(action.step);
    // One frame for the step to mount before the anchor is looked for. `jumpTo`
    // returns silently on a missing target, so a race here would be a button
    // that does nothing without saying so.
    requestAnimationFrame(() => jumpTo(action.anchor, action.label));
  }, [onGoStep]);

  if (loading) {
    return (
      <section className="vy-readiness" aria-labelledby="readiness-title">
        <p className="vy-readiness__eyebrow">Readiness</p>
        <h2 id="readiness-title" className="vy-readiness__headline">Working out where your AI stands.</h2>
        <div className="vy-readiness__parts" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((slot) => <div key={slot} className="vy-readiness__skeleton" />)}
        </div>
      </section>
    );
  }

  if (error || !readiness) {
    return (
      <section className="vy-readiness" aria-labelledby="readiness-title">
        <p className="vy-readiness__eyebrow">Readiness</p>
        <h2 id="readiness-title" className="vy-readiness__headline">This one is on us.</h2>
        <p className="vy-readiness__lede" role="alert">{error || "We could not read your readiness just now"}</p>
        <button className="button secondary-button" type="button" onClick={() => void load()}>Try again</button>
      </section>
    );
  }

  const weakest = readiness.parts.find((row) => row.id === readiness.weakest_part) ?? null;
  const action = readiness.suggested_action;

  return (
    <section className="vy-readiness" aria-labelledby="readiness-title">
      <p className="vy-readiness__eyebrow">Readiness</p>
      {readiness.overall === null ? (
        <h2 id="readiness-title" className="vy-readiness__headline">
          Still an apprentice. {readiness.unmeasured_count === 1
            ? "One part has not been measured yet, so there is no score to give you."
            : `${readiness.unmeasured_count} parts have not been measured yet, so there is no score to give you.`}
        </h2>
      ) : (
        <h2 id="readiness-title" className="vy-readiness__headline">
          <span className="vy-readiness__score">{readiness.overall}</span>
          <span className="vy-readiness__score-note">
            out of 100, across the five parts below
          </span>
        </h2>
      )}

      <div className="vy-readiness__parts">
        {readiness.parts.map((part) => (
          <PartCard key={part.id} part={part} floor={readiness.floors.part} />
        ))}
      </div>

      <div className={`vy-readiness__lock ${readiness.publish_locked ? "" : "vy-readiness__lock--open"}`}>
        <div>
          <p className="vy-readiness__lock-state">
            {readiness.publish_locked ? "Publishing is locked." : "Publishing is open."}
          </p>
          <p className="vy-readiness__lock-why">
            {readiness.publish_locked
              ? weakest
                ? `Weakest: ${weakest.label.toLocaleLowerCase("en-IN")}. To publish, every part needs ${readiness.floors.part} and the whole needs ${readiness.floors.overall}.`
                : `To publish, every part needs ${readiness.floors.part} and the whole needs ${readiness.floors.overall}.`
              : "Your AI can be reached by the people you choose on the next step."}
          </p>
        </div>
        {action && (
          <button className="button primary-button vy-readiness__act" type="button" onClick={() => act(action)}>
            {action.label}
          </button>
        )}
      </div>

      {/* The trust line the old strip carried, kept because it is the one
          promise on this screen that never changes with a measurement. */}
      <p className="vy-readiness__trust">Your voice is never listed or shared.</p>
    </section>
  );
}
