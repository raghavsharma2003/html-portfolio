// The studio's first screen for a brand new account when invites are
// required (WS-R23, migration 086). Vyakti's first Rooms are built one
// creator at a time, by hand, by invitation, and the server refuses a first
// workspace without a valid code (INVITES_REQUIRED=1) regardless of what this
// screen shows — this is the friendly front door, never the gate itself. An
// account that already owns a workspace never sees this screen at all
// (StudioApp.tsx's own condition), matching the server predicate exactly:
// the code is only ever needed once, for the first one.
//
// Reuses CreateReplicaCard's own markup and CSS classes (empty-card,
// eyebrow, create-form, create-row, field, field-label, field-note,
// button primary-button) rather than inventing new chrome for a screen a
// person sees exactly once.
import { useState } from "react";
import { useStudioLocale } from "./localeContext";

export function InviteGate({
  onContinue,
  busy,
  error,
  applyHref,
}: {
  onContinue: (code: string) => void;
  busy?: boolean;
  error?: string | null;
  applyHref?: string;
}) {
  const { t } = useStudioLocale();
  const c = t.inviteGate;
  const [code, setCode] = useState("");
  return (
    <section className="empty-card" aria-labelledby="invite-title">
      <div className="portrait-placeholder" aria-hidden="true">
        <div className="scan-ring" />
        <div className="portrait-core">KEY</div>
      </div>
      <div>
        <p className="eyebrow">{c.eyebrow}</p>
        <h2 id="invite-title">{c.headline}</h2>
        <p>{c.lede}</p>
        <form
          className="create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = code.trim();
            if (trimmed) onContinue(trimmed);
          }}
        >
          <label className="field-label" htmlFor="invite-code">{c.codeLabel}</label>
          <div className="create-row">
            <input
              id="invite-code"
              className="field"
              maxLength={40}
              placeholder={c.codePlaceholder}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="button primary-button" disabled={Boolean(busy) || !code.trim()}>
              {busy ? c.checking : c.continueLabel}
            </button>
          </div>
          {error && (
            <p className="field-note" role="alert">{error}</p>
          )}
          <p className="field-note">
            {c.noCodeYet} <a href={applyHref ?? "/vyakti.html#apply"}>{c.applyLink}</a>.
          </p>
        </form>
      </div>
    </section>
  );
}
