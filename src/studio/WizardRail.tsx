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
import type { ReactNode } from "react";
import type { StepId, StepView } from "./wizardModel";

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
          const owed = step.missing.filter((row) => row.owner === "you").length;
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
                    {step.state !== "done" && step.state !== "stopped" && owed > 0 && (
                      <span className="wizard-step-owed">{owed} waiting on you</span>
                    )}
                  </span>
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
  backLabel,
  nextLabel,
  caution,
  onGo,
}: {
  back: StepId | null;
  next: StepId | null;
  backLabel: string;
  nextLabel: string;
  /** Honest note about what is not ready. Rendered above the buttons. */
  caution: string | null;
  onGo: (step: StepId) => void;
}) {
  return (
    <section className="wizard-pager" aria-label="Move between steps">
      {caution && <p className="wizard-pager-caution" role="status">{caution}</p>}
      <div className="wizard-pager-actions">
        {back ? (
          <button className="button secondary-button" type="button" onClick={() => onGo(back)}>
            Back to {backLabel}
          </button>
        ) : <span />}
        {next && (
          <button className="button primary-button" type="button" onClick={() => onGo(next)}>
            Next: {nextLabel}
          </button>
        )}
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
export function StepBlockers({ step }: { step: StepView }) {
  if (step.state === "done" || step.missing.length === 0) return null;
  const yours = step.missing.filter((row) => row.owner === "you");
  const ours = step.missing.filter((row) => row.owner === "platform");
  return (
    <section className="wizard-blockers" aria-labelledby={`blockers-${step.id}`}>
      <h3 id={`blockers-${step.id}`}>What is still open on this step</h3>
      <div className="wizard-blockers-columns">
        <div>
          <p className="wizard-blockers-owner">Waiting on you, {yours.length}</p>
          {yours.length === 0 ? (
            <p className="muted-copy">Nothing on this step is waiting on you.</p>
          ) : (
            <ul>
              {yours.map((row) => (
                <li key={row.code}>
                  <span>{row.label}</span>
                  <small>{row.note}</small>
                  {row.anchor && (
                    <button className="text-button" type="button" onClick={() => jumpTo(row.anchor)}>Go there</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="wizard-blockers-owner">Waiting on us, {ours.length}</p>
          {ours.length === 0 ? (
            <p className="muted-copy">Nothing on this step is waiting on us.</p>
          ) : (
            <ul>
              {ours.map((row) => (
                <li key={row.code}>
                  <span>{row.label}</span>
                  <small>{row.note}</small>
                  {row.anchor && (
                    <button className="text-button" type="button" onClick={() => jumpTo(row.anchor)}>See status</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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
