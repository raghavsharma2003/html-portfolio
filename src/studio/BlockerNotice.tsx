// BlockerNotice.tsx — the reason that must sit next to a disabled control.
//
// THE DEFECT, VERBATIM FROM THE OWNER'S PHONE
// ---------------------------------------------------------------------------
// "Preview my voice" rendered DISABLED with no visible reason attached to it.
// A disabled control with no adjacent reason is a dead end that looks like a
// bug: the only recovery available to a person is to guess, and the guess they
// make is that the product is broken, which on that screen was half true and
// unsayable.
//
// So there is one component for it and it cannot be built wrong:
//
//   - it takes a `DisabledReason`, which cannot be constructed without naming
//     its class (`blockerClass.ts`),
//   - it renders that class as a WORD, never only as a colour
//     (DESIGN-SYSTEM §5 rule 2), and
//   - `<DisabledAction>` puts it physically adjacent to the control, in the
//     same box, so it cannot drift below a fold in a later layout change. On a
//     390pt screen "adjacent" and "in the same element" are the same
//     requirement, because anything else is a scroll away.
//
// It renders NOTHING when there is no reason. A control that is enabled owes no
// explanation, and a permanently-present empty box is furniture.
import type { ReactNode } from "react";
import type { DisabledReason } from "./blockerClass";
import { useStudioLocale } from "./localeContext";

/**
 * The reason on its own. `role="status"` rather than `alert`: this is a
 * standing condition, not an event, and an alert would interrupt a screen
 * reader mid-sentence every time a poll re-rendered the panel.
 *
 * WS-R52: the two-word badge (`t.classLabels`) reads from the creator's own
 * chrome locale via context, not from `blockerClass.ts`'s own `CLASS_COPY`
 * -- that table stays English on purpose (copy.ts's own header explains
 * why: `evals/studiowizard.mjs` checks it against English-only regexes).
 * `reason.headline`/`reason.next` are untouched: those ARE the honesty-gated
 * prose the class label sits next to, and this workstream does not move it.
 */
export function BlockerNotice({ reason, className = "" }: {
  reason: DisabledReason | null;
  className?: string;
}) {
  const { t } = useStudioLocale();
  if (!reason) return null;
  return (
    <p className={`blocker-notice blocker-notice-${reason.kind} ${className}`.trim()} role="status">
      <span className="blocker-notice-class">{t.classLabels[reason.kind]}</span>
      <span className="blocker-notice-headline">{reason.headline}</span>
      <span className="blocker-notice-next">{reason.next}</span>
    </p>
  );
}

/**
 * A control plus the reason it cannot be used, as one object.
 *
 * The children are the control. The reason goes UNDER it rather than over it
 * on purpose: a person scanning a form reads the button first, decides they
 * want it, finds it dead, and looks immediately below. Putting the reason above
 * makes them read it before they care, which is how explanatory text gets
 * skipped and then reported as missing.
 */
export function DisabledAction({ reason, children }: {
  reason: DisabledReason | null;
  children: ReactNode;
}) {
  return (
    <div className={`disabled-action ${reason ? `disabled-action-${reason.kind}` : "disabled-action-open"}`}>
      {children}
      <BlockerNotice reason={reason} />
    </div>
  );
}
