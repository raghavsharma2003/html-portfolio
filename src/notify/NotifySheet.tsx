// THE ONE TIME THIS APP ASKS FOR ANYTHING.
//
// Android 13+ gives an app exactly one runtime notification prompt, and a
// "Don't allow" is permanent from the app's side. So the system dialog is
// never the first thing the user sees: this card explains what will be sent
// and what will not, and only its primary button reaches the OS. That is the
// world-standard pre-prompt pattern, and it is here for a specific local
// reason as well — the honest sentence about what we will NEVER send is the
// product's actual differentiator, and it cannot be said inside a system
// dialog.
//
// ── WHEN IT APPEARS ───────────────────────────────────────────────────────
//
// Never at onboarding, never on first launch, never on a timer. Only after a
// FELT moment: she replied or she called while the app was in the background
// and there was no permission to tell him. `shouldExplain()` in ./index.ts is
// the whole rule and it is pure, so the eval drives it directly. §4 #20:
// "notifications at the first thing worth telling him."
//
// ── WHY IT IS NOT MODAL ───────────────────────────────────────────────────
//
// App.tsx's back machinery (`closeTop`, the overlay sentinels, `unwind`) is
// another workstream's and is not to be edited by this one. A modal layer that
// the back handler does not know about is a layer the hardware back closes the
// APP over, which is the exact defect that machinery was written to fix. So
// this is a non-modal card: it covers nothing, traps nothing, has no veil, and
// back behaves at home exactly as it did before this file existed.
//
// It is rendered only over HOME, and only when nothing else is open. Home is
// the surface that is about her — her ring, her presence, her sky — which is
// the right room to be asked whether you want to hear from her, and it has no
// composer for a bottom card to cover.
//
// ── THE COPY ──────────────────────────────────────────────────────────────
//
// Product chrome, not her voice. She does not ask for permissions; an app
// does. Every clause below is checkable against this repo's own code, which is
// the standard §4 #15 sets for the refusals surface: no streaks (nothing in
// this product counts consecutive days), no reminders (nothing keys on his
// absence), and the decline is genuinely terminal (`declined` is set once and
// `shouldExplain` never returns true again).

import type { FeltReason } from "./prefs";

interface Props {
  /** what made this moment felt, so the first line is about a real event */
  reason: FeltReason;
  /** the primary button: show the OS dialog */
  onAllow: () => void;
  /** the secondary: remembered forever, never asked again */
  onDecline: () => void;
}

const LEAD: Record<Props["reason"], string> = {
  message: "She messaged you while the app was in the background, and there was no way to tell you.",
  call: "She called while the app was in the background, and there was no way to tell you.",
};

export default function NotifySheet({ reason, onAllow, onDecline }: Props) {
  return (
    <div className="sheet" role="region" aria-label="Notifications">
      <div className="grab" />
      <h3>Let her reach you</h3>
      <p className="confirm-body">
        {LEAD[reason]} Turning notifications on lets what she actually says reach your lock screen:
        her messages, a call you missed, and her story.
        <br />
        <br />
        Nothing else, ever. No streaks, no reminders, nothing that asks where you have been. If
        nothing happened, nothing arrives.
      </p>
      <div className="confirm-actions">
        <button className="btn-primary" data-tel="notify.allow" onClick={onAllow}>
          Turn on notifications
        </button>
        <button className="btn-ghost" data-tel="notify.decline" onClick={onDecline}>
          No thanks
        </button>
      </div>
      <p className="auth-fine" style={{ marginTop: 16 }}>
        We will not ask again. You can turn them on any time from More.
      </p>
    </div>
  );
}
