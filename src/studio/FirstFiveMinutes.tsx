// FirstFiveMinutes.tsx — WS-R164 (wave twenty-two).
//
// "The first five minutes" as one flow with a clock on it, per the brief's
// own three named transitions: landing to sign-in (site/vyakti.html's own
// primary action, `context/decisions.md#ws-r164-hero-cta-goes-straight-to-
// sign-in`, measured in `evals/first-five-minutes/run.mjs` rather than
// rendered here), sign-in to first source, first source to Meet. The last
// two are what this small rail names, inside the shell a real person
// actually uses (`CloneExperience.tsx`).
//
// WHY NOT `WizardRail.tsx`. That component is real, well built, and unused
// by any real person: `StudioApp.tsx` renders it ONLY behind
// `STUDIO_SELF_TEST_UI` (an internal test flag), and mounts `CloneExperience`
// directly, with no rail at all, for everyone else. Its own `computeWizard`
// gates on `identityVerified`/`livenessVerified`/a teacher sheet — the
// TEACHER activation pipeline, not the honest gate WS-R158 found for a
// personal reply (a real voice build's own promotion, `context/rejected.md
// #ws-r158-meet-does-not-open-automatically-without-the-full-build-
// promotion-pipeline`). Reusing it here would either inherit gates that do
// not apply to a person's own first reply, or fork its `wizardModel.ts`
// dependency — this file is deliberately small and free-standing instead:
// two steps, no blockers list, no `<details>`.
//
// SILENT THE MOMENT IT IS NOT USEFUL. `reachedMeet` mirrors
// `CloneExperience.tsx`'s own `showRooms` so this rail steps out of the way
// through the SAME boolean the real gate uses, rather than a second one this
// file would have to keep in sync by hand as WS-R161 widens what `showRooms`
// means. `PlatformWorkBanner` (`WizardRail.tsx`) documents the same posture
// for the same reason: furniture that outlives its own purpose is a design
// defect, not a feature.
import { useStudioLocale } from "./localeContext";
import "./first-five-minutes.css";

export type FirstFiveMinutesStep = "firstSource" | "meetWait";

/**
 * Pure, so `evals/first-five-minutes/run.mjs` can assert every transition
 * offline without a browser. `hasFirstSource` restates
 * `wizardModel.ts#feedDone`'s own predicate (a source OR a context item,
 * never neither, `WizardInput.sourceCount`/`contextItemCount`) rather than
 * importing it, since that module also carries the teacher-only fields this
 * file has no use for.
 */
export function firstFiveMinutesStep(input: {
  hasFirstSource: boolean;
  reachedMeet: boolean;
  collecting?: boolean;
}): FirstFiveMinutesStep | null {
  if (input.reachedMeet) return null;
  return input.hasFirstSource && !input.collecting ? "meetWait" : "firstSource";
}

export function FirstFiveMinutesRail({ step }: { step: FirstFiveMinutesStep }) {
  const { locale, t } = useStudioLocale();
  const copy = t.firstFiveMinutes;
  const firstSourceDone = step === "meetWait";
  return (
    // `lang={locale}`, not a document-level effect — `DeployStudio.tsx`'s
    // own established convention and its own reason restated: this rail is
    // one subtree inside a shell that is still English-only elsewhere
    // (`context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`),
    // so tagging only this subtree is the honest scope. Found by
    // `scripts/check-accessibility.mjs`'s own `lang-devanagari-untagged`
    // check on the FIRST real run of the `waiting` target this workstream
    // added, fixed at its cause rather than suppressed.
    <nav className="ffm-rail" aria-label={copy.railLabel} lang={locale}>
      <ol className="ffm-steps">
        <li className="ffm-step ffm-step-done">
          <span className="ffm-dot" aria-hidden="true" />
          <span className="ffm-step-copy">
            <strong>{copy.signInTitle}</strong>
            <span className="visually-hidden">{copy.stepDoneLabel}</span>
          </span>
        </li>
        <li
          className={`ffm-step${step === "firstSource" ? " is-current" : ""}${firstSourceDone ? " ffm-step-done" : ""}`}
          aria-current={step === "firstSource" ? "step" : undefined}
        >
          <span className="ffm-dot" aria-hidden="true" />
          <span className="ffm-step-copy">
            <strong>{copy.firstSourceTitle}</strong>
            {step === "firstSource" ? (
              <span className="visually-hidden">{copy.firstSourceHint}</span>
            ) : (
              <span className="visually-hidden">{copy.stepDoneLabel}</span>
            )}
          </span>
        </li>
        <li className={`ffm-step${step === "meetWait" ? " is-current" : ""}`} aria-current={step === "meetWait" ? "step" : undefined}>
          <span className="ffm-dot" aria-hidden="true" />
          <span className="ffm-step-copy">
            <strong>{copy.meetTitle}</strong>
            {step === "meetWait" ? <span className="visually-hidden">{copy.meetHint}</span> : null}
          </span>
        </li>
      </ol>
      <p className="ffm-hint" aria-hidden="true">{step === "firstSource" ? copy.firstSourceHint : copy.meetHint}</p>
    </nav>
  );
}
