// WizardRail.tsx — the persistent three-step rail, and the Back/Next pager.
//
// The rail is the answer to the owner's defect report ("one continuous screen"):
// it is the only thing on the page that is always visible and always answers
// "where am I, what is left, and whose turn is it".
//
// EVERY STATUS HERE COMES FROM `computeWizard`. This component has no opinion
// about readiness and cannot form one: it is handed `StepView[]` and renders
// them. That is deliberate and it is the mechanical fix for the class of defect
// `UX-Q-04` names (a literal in a status position). If you find yourself adding
// a conditional here that decides whether something is done, it belongs in
// `wizardModel.ts` where an eval can reach it.
//
// A ROW IS ALWAYS CLICKABLE. Including a step that is not ready. The owner's
// stated priority is "the major thing is to interact with the agent" and a rail
// that refuses to open Meet until Feed is perfect is the wall again with a
// progress bar on it. What a not-ready step gets is an honest line at the top
// of it (`stepEntryWarning`), never a locked door.
import { useState, type ReactNode } from "react";
import { CLASS_COPY } from "./blockerClass";
import { backLabel, nextLabel, type Missing, type StepId, type StepView } from "./wizardModel";
import { BlockerNotice } from "./BlockerNotice";
import type { DisabledReason } from "./blockerClass";

/**
 * Scroll to an anchor, opening the `<details>` it lives inside first.
 *
 * Carried over verbatim from `QuickStartPath.jumpTo` because it is load-bearing
 * and non-obvious: a link to a panel inside a collapsed Advanced area silently
 * does nothing, and "the button did nothing" is the worst possible answer on a
 * screen whose whole job is telling a person what is still open.
 */
function jumpTo(anchor: string) {
  const target = document.querySelector(anchor);
  if (!target) return;
  const details = target.closest("details");
  if (details && !details.open) details.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function StepDot({ state }: { state: StepView["state"] }) {
  // Never a bare colour: the word is in the row, and this is only the mark.
  // `DESIGN-SYSTEM.md` §5 rule 2.
  return <span className={`wizard-dot wizard-dot-${state}`} aria-hidden="true" />;
}

/**
 * The full rail: three rows, a promise each, and a NAMED next thing.
 *
 * What changed in WS-AJ is the last line of each row. It used to read
 * "9 waiting on you", a count with no names, which is the smallest possible
 * version of the sentence the owner's screenshot caught. It now names the one
 * thing, and it names it in the class the wizard actually computed, so a step
 * that is stuck on US does not wear an ember chip that says otherwise.
 */
export function WizardRail({
  steps,
  current,
  onGo,
}: {
  steps: StepView[];
  current: StepId;
  onGo: (step: StepId) => void;
}) {
  return (
    <nav className="wizard-rail" aria-label="Studio steps">
      <p className="rail-label">Your clone, in three steps</p>
      <ol className="wizard-steps">
        {steps.map((step) => {
          const active = step.id === current;
          const top = step.state === "done" || step.state === "stopped" ? null : step.top;
          return (
            <li key={step.id}>
              <button
                type="button"
                className={`wizard-step wizard-step-${step.state} ${active ? "current" : ""}`}
                aria-current={active ? "step" : undefined}
                onClick={() => onGo(step.id)}
              >
                <span className="wizard-step-number">{step.number}</span>
                <span className="wizard-step-copy">
                  <strong>{step.title}</strong>
                  <small>{step.promise}</small>
                  <span className="wizard-step-status">
                    <StepDot state={step.state} />
                    {step.statusLabel}
                  </span>
                  {top && (
                    <span className={`wizard-step-next wizard-step-next-${top.cls}`}>
                      <span className="wizard-step-next-class">{CLASS_COPY[top.cls].label}</span>
                      {top.label}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The phone rail: a segmented control, and one line underneath.
 *
 * SEPARATE DOM, NOT THE SAME DOM SHRUNK. The full rail's three rows carry a
 * title, a promise, a status and a next-thing each: twelve lines of type, which
 * on a 390pt screen is the entire first viewport spent before the person has
 * seen a single control. That is the owner's report ("enormous vertical waste")
 * in its most defensible-looking form, because every one of those lines is
 * individually justifiable.
 *
 * So the phone gets the same three answers in about 90px: three pills say WHERE
 * AM I and, by their dots, what state each step is in; the line underneath says
 * WHAT IS LEFT, named, for the step you are on. Nothing else. It is sticky
 * under the header because "where am I" is a question people ask again halfway
 * down a long form.
 */
export function CompactRail({
  steps,
  current,
  onGo,
}: {
  steps: StepView[];
  current: StepId;
  onGo: (step: StepId) => void;
}) {
  const here = steps.find((step) => step.id === current) ?? steps[0];
  const top = here && here.state !== "done" && here.state !== "stopped" ? here.top : null;
  return (
    <nav className="compact-rail" aria-label="Studio steps">
      <ol className="compact-rail-steps">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={`compact-step compact-step-${step.state} ${step.id === current ? "current" : ""}`}
              aria-current={step.id === current ? "step" : undefined}
              onClick={() => onGo(step.id)}
            >
              <StepDot state={step.state} />
              <span className="compact-step-title">{step.title}</span>
              {/* The status word is present for every step, not only the
                  current one, but it is only VISIBLE on the current one. A
                  screen reader still hears all three, so the rail answers
                  "what is left" without three visible status words competing
                  for a 390pt line. */}
              <span className="compact-step-status">{step.statusLabel}</span>
            </button>
          </li>
        ))}
      </ol>
      {top ? (
        <p className={`compact-rail-next compact-rail-next-${top.cls}`}>
          <span className="compact-rail-next-class">{CLASS_COPY[top.cls].label}</span>
          <span className="compact-rail-next-label">{top.label}</span>
        </p>
      ) : (
        <p className="compact-rail-next compact-rail-next-clear">
          <span className="compact-rail-next-label">
            {here?.state === "done" ? "Nothing is open on this step." : "Nothing is open on this step yet."}
          </span>
        </p>
      )}
    </nav>
  );
}

/**
 * The pager at the foot of every step.
 *
 * The Next button is never disabled. When the current step's exit condition is
 * unmet it still moves, and the line above it says what will not work yet.
 * Refusing to move would be the honest-looking version of the wall: it hides
 * the clone behind a checklist, which is the exact thing the owner rejected.
 */
export function StepPager({
  back,
  next,
  caution,
  onGo,
}: {
  back: StepId | null;
  next: StepId | null;
  /**
   * What is not ready on the step this pager is about to move to, WITH ITS
   * CLASS. It used to be a bare string, which is precisely why the sentence in
   * the owner's screenshot could not be rendered differently depending on whose
   * turn it was: a string has no class to render.
   */
  caution: DisabledReason | null;
  onGo: (step: StepId) => void;
}) {
  return (
    <section className="wizard-pager" aria-label="Move between steps">
      {/* Collapsed by default on a phone, where it is three lines of prose
          between the person and the button they came here for. The summary
          still carries the class and the headline, so nothing is hidden that a
          person needs in order to decide; what is behind the disclosure is the
          "what happens next" sentence. */}
      {caution && <BlockerNotice reason={caution} className="wizard-pager-caution" />}
      <div className="wizard-pager-actions">
        {/* The primary action is FIRST in the DOM and last in visual order on
            wide screens (`flex-direction: row-reverse` is not used; the CSS
            orders them). On a phone the column puts the primary on top, where
            a thumb is, rather than at the bottom of a stack under a secondary
            it will be pressed by accident. */}
        {next && (
          <button className="button primary-button" type="button" onClick={() => onGo(next)}>
            {nextLabel(next)}
          </button>
        )}
        {back ? (
          <button className="button secondary-button" type="button" onClick={() => onGo(back)}>
            {backLabel(back)}
          </button>
        ) : <span />}
      </div>
    </section>
  );
}

/**
 * "What is still waiting, and on whom" — the one part of the retired
 * `QuickStartPath` worth keeping, re-homed to the step that owns each item.
 *
 * The old surface had two defects this fixes by construction. It sat ABOVE the
 * panels it summarised, so a teacher read the same checklist twice; and it
 * filtered out any blocker code it lacked copy for, so an unrecognised gate
 * could hold the Activate button shut while the checklist read clear
 * (`wizardModel.unknownBlockers` now renders those instead of dropping them).
 */
function BlockerRow({ row }: { row: Missing }) {
  return (
    <li className={`wizard-blocker wizard-blocker-${row.cls}`}>
      <span className="wizard-blocker-label">{row.label}</span>
      <small>{row.note}</small>
      {row.anchor && (
        <button
          className="text-button"
          type="button"
          // Feedback on pointerdown, never on release (DESIGN-LAW §2). The
          // scroll is the feedback here, so starting it on press is the whole
          // difference between "the button responds" and "the button lags".
          onPointerDown={() => jumpTo(row.anchor)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              jumpTo(row.anchor);
            }
          }}
        >
          {row.cls === "you" ? "Go there" : "See what is happening"}
        </button>
      )}
    </li>
  );
}

export function StepBlockers({ step, compact = false }: { step: StepView; compact?: boolean }) {
  if (step.state === "done" || step.missing.length === 0) return null;
  const yours = step.missing.filter((row) => row.cls === "you");
  const ours = step.missing.filter((row) => row.cls === "us");
  // Name the top one, let the rest expand. Both halves of that are load
  // bearing: the name is what makes the panel startable, and the expansion is
  // what stops it being a wall of eleven identical rows on a phone.
  const lead = yours[0] ?? ours[0] ?? null;
  const restYours = yours.filter((row) => row !== lead);
  const restOurs = ours.filter((row) => row !== lead);
  const restCount = restYours.length + restOurs.length;

  return (
    <section className="wizard-blockers" aria-labelledby={`blockers-${step.id}`}>
      <h3 id={`blockers-${step.id}`}>What is still open on this step</h3>

      {lead && (
        <div className={`wizard-blockers-lead wizard-blockers-lead-${lead.cls}`}>
          <p className="wizard-blockers-lead-class">{CLASS_COPY[lead.cls].label}</p>
          <ul><BlockerRow row={lead} /></ul>
        </div>
      )}

      {restCount > 0 && (
        // `open` on wide screens, closed on a phone. Required-but-later stays
        // in the step and says so (`UX-Q-05`); what is collapsed here is not the
        // requirement, it is the READING of the list, which is the one thing on
        // this panel that is genuinely optional.
        <details className="wizard-blockers-rest" open={!compact}>
          <summary>
            <strong>Everything else on this step</strong>
            <span>
              {restYours.length > 0 && `${restYours.length} you can act on`}
              {restYours.length > 0 && restOurs.length > 0 && ", "}
              {restOurs.length > 0 && `${restOurs.length} on us`}
            </span>
          </summary>
          <div className="wizard-blockers-columns">
            {restYours.length > 0 && (
              <div>
                <p className="wizard-blockers-owner">{CLASS_COPY.you.label}</p>
                <ul>{restYours.map((row) => <BlockerRow key={row.code} row={row} />)}</ul>
              </div>
            )}
            {restOurs.length > 0 && (
              <div>
                {/* Never "waiting on you" for this column, and never a bare
                    count of things with no names beside it. The class label
                    comes from the one table so a second surface cannot invent
                    a softer word for the same state. */}
                <p className="wizard-blockers-owner">{CLASS_COPY.us.label}</p>
                <ul>{restOurs.map((row) => <BlockerRow key={row.code} row={row} />)}</ul>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * The collapsed home for OPTIONAL surfaces on a step.
 *
 * `UX-Q-05` is the rule this encodes: collapse what is optional, never what is
 * required-but-later. Identity and liveness used to live behind a `<details>`
 * called "Advanced"; they are mandatory gates, so they now sit in the open on
 * Meet, and what is left in here is genuinely elective (a calibration lab, a
 * blind A/B, a text dialogue lab). The summary says which it is.
 */
export function AdvancedArea({
  id,
  title,
  blurb,
  children,
}: {
  id: string;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <details className="advanced-disclosure" id={id}>
      <summary>
        <strong>{title}</strong>
        <span>{blurb}</span>
      </summary>
      <div className="advanced-disclosure-body">{children}</div>
    </details>
  );
}

/**
 * A band of panels inside a step, collapsible on a phone.
 *
 * THE RULE THIS OBEYS, AND THE ONE IT DOES NOT BREAK. `UX-Q-05` and DESIGN-LAW
 * §4 say progressive disclosure applies to what is OPTIONAL and never to what
 * is required-but-later, and that rule was learned expensively: identity and
 * liveness once lived behind a drawer called "Advanced", which taught teachers
 * that mandatory gates were optional.
 *
 * This does not break it, because what collapses here is a REGION OF ONE
 * SCREEN, not a requirement. Every band is still on its own step, still listed
 * by `StepBlockers`, still named in the rail's next-thing line, and its summary
 * states what it holds. On a 390pt screen the alternative is not "everything
 * visible", it is "everything four scrolls down", and a requirement four
 * scrolls down is hidden in the way that actually matters.
 *
 * The FIRST band of each step stays open, so every step opens onto a control
 * rather than onto a list of closed drawers. That is the "one primary action
 * visible per step" rule, expressed structurally.
 */
export function Band({
  title,
  blurb,
  children,
  collapsible,
  defaultOpen,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
  /** True on a phone. False renders the plain, always-open section. */
  collapsible: boolean;
  defaultOpen: boolean;
}) {
  if (!collapsible) {
    return (
      <section className="wizard-band">
        <header className="wizard-band-head">
          <h2>{title}</h2>
          <p>{blurb}</p>
        </header>
        <div className="wizard-band-body">{children}</div>
      </section>
    );
  }
  return (
    <details className="wizard-band wizard-band-collapsible" open={defaultOpen}>
      <summary className="wizard-band-head">
        <h2>{title}</h2>
        {/* The blurb is inside the summary and hidden by CSS while closed. It
            is the sentence that explains the band, and a person deciding
            whether to open a drawer has already decided from the title. */}
        <p>{blurb}</p>
      </summary>
      <div className="wizard-band-body">{children}</div>
    </details>
  );
}

/**
 * Page furniture that a phone cannot afford: an eyebrow, a display title and a
 * paragraph of explanation, which together were most of the owner's first
 * screen before any control appeared.
 *
 * On a wide screen all three render, because there is room and the paragraph
 * genuinely helps. On a phone the TITLE carries it and the paragraph moves
 * behind a "Why this step" affordance, which is one tap and no scroll. The
 * eyebrow ("Step 2 of 3") goes entirely: the rail directly above it already
 * says which step this is, and saying it twice in 40px is the "so much nonsense
 * written on it" the owner named.
 */
export function StepHead({ title, promise, compact }: {
  title: string;
  promise: string;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!compact) {
    return (
      <section className="step-head" aria-labelledby="step-title">
        <h2 id="step-title">{title}</h2>
        <p className="step-promise">{promise}</p>
      </section>
    );
  }
  return (
    <section className="step-head step-head-compact" aria-labelledby="step-title">
      <h2 id="step-title">{title}</h2>
      <button
        className="step-why"
        type="button"
        aria-expanded={open}
        aria-controls="step-why-body"
        onPointerDown={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        {open ? "Hide why" : "Why this step"}
      </button>
      {open && <p className="step-promise" id="step-why-body">{promise}</p>}
    </section>
  );
}
