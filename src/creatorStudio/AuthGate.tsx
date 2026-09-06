// AuthGate.tsx — WS-R91. The studio's sign-in screen, extracted whole from
// `StudioApp.tsx` (`PayoutsCard.tsx` etc.'s own precedent — WS-R52's own
// comment on `RoomStudio.tsx`'s sub-cards names it: "carved out ... they are
// self-contained files by their own header comments").
//
// WHY THIS MOVE, AND WHY NOW
// ---------------------------------------------------------------------------
// WS-R82 found `StudioApp.tsx`'s `AuthGate` rendering before
// `StudioLocaleProvider` ever mounts, so `/studio?lang=hi` painted zero
// Hindi before sign-in resolved (`context/rejected.md#ws-r82-studio-hi-signed-out-entry-never-shows-hindi`).
// The fix is not "read `t.` inside a function still living in a file
// `evals/studio-locale/run.mjs`'s own `TIER_2_ALLOWLIST` names as
// unconverted for an UNRELATED reason" (`StudioApp.tsx` owns
// `TEACHER_COPY`/`GENERIC_COPY`/`TEST_COPY`, `CreateReplicaCard`, and every
// lazy-mounted Tier 2 panel's wiring — none of that is in scope here, and
// none of it needs to be to fix this screen). It is to give the sign-in
// screen its own file, exactly the shape every other self-contained card in
// this directory already has, so it can become its own Tier 1 entry with
// nothing else along for the ride.
//
// `StudioLocaleProvider` mounts ABOVE this component now (`StudioApp.tsx`'s
// own `if (!session)` branch), so `useStudioLocale()` here always resolves
// to a REAL, loaded copy table — `en` immediately, `hi` once its own chunk
// has landed (`localeContext.tsx`'s own "never English in its place" law
// applies here exactly as it already does to every signed-in Tier 1 panel).
// See context/decisions.md#ws-r91-authgate-reads-locale-before-sign-in.
import { useEffect, useRef, useState } from "react";
import {
  googleSignIn,
  sendEmailOtp,
  verifyEmailOtp,
} from "./studioAuth";
import { writeStoredSession } from "./session";
import { useStudioLocale } from "./localeContext";
import { STUDIO_LANGUAGE_LABELS, STUDIO_LOCALES, withLabel, type StudioLocale } from "./copy";
import { Mark, Spinner } from "./StudioChrome";
import type { StudioSession } from "./types";

export type AuthGateVariant = "generic" | "teacher" | "test";

type AuthStep = "email" | "code";

/** `StudioShell.tsx`'s own `StudioLanguageSwitch` (WS-R52/WS-R79), the same
 *  shape one screen earlier: both words always shown in both locales
 *  (`STUDIO_LANGUAGE_LABELS`'s own reason), the current locale reading as
 *  pressed rather than disabled, and each button's own `lang` set directly
 *  from the loop variable rather than detected — the label it names is
 *  already known, never sniffed (`context/decisions.md#ws-r79-language-switch-buttons-get-their-own-lang`).
 *  A private copy rather than an import: that component lives in
 *  `StudioShell.tsx` unexported, and `AuthGate.tsx` must not import from a
 *  file that is itself Tier 2 for reasons unrelated to this screen. */
function AuthLanguageSwitch({
  locale,
  ariaLabel,
  onSwitch,
}: {
  locale: StudioLocale;
  ariaLabel: string;
  onSwitch: (next: StudioLocale) => void;
}) {
  return (
    <div className="studio-lang-switch" role="group" aria-label={ariaLabel}>
      {STUDIO_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="studio-lang-btn"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => onSwitch(l)}
        >
          {STUDIO_LANGUAGE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

export default function AuthGate({
  onAuthed,
  variant,
  testEnvironment,
  onSwitchLocale,
}: {
  onAuthed: (session: StudioSession) => void;
  variant: AuthGateVariant;
  testEnvironment: boolean;
  onSwitchLocale: (next: StudioLocale) => void;
}) {
  const { locale, t } = useStudioLocale();
  const authCopy = t.authGate;
  const variantCopy = authCopy.variant[variant];
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode() {
    setError("");
    setBusy(true);
    try {
      await sendEmailOtp(email.trim());
      setStep("code");
    } catch (cause) {
      // A server-returned error code is not this screen's own copy — the
      // same "SERVER-COMPUTED PROSE stays English" split `copy.ts`'s own
      // header draws for `ReadinessPanel.tsx` etc. Only the FALLBACK for a
      // non-`Error` failure (never server text) is this file's own string.
      setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : authCopy.genericSendError);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError("");
    setBusy(true);
    try {
      const session = await verifyEmailOtp(email.trim(), code.trim());
      writeStoredSession(session);
      onAuthed(session);
    } catch {
      setError(authCopy.codeMismatchError);
      setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="auth-brand">
        <a href="/" aria-label={authCopy.vyaktiHomeAriaLabel}><Mark /></a>
        <span>VYAKTI</span>
        <span className="brand-rule" />
        <span className="auth-brand-tag">{variantCopy.brandTag}</span>
        <AuthLanguageSwitch locale={locale} ariaLabel={t.shell.languageGroupLabel} onSwitch={onSwitchLocale} />
      </header>

      <section className="auth-intro" aria-labelledby="studio-title">
        {"eyebrow" in variantCopy && variantCopy.eyebrow && <p className="eyebrow">{variantCopy.eyebrow}</p>}
        <h1 id="studio-title">{variantCopy.title}</h1>
        <p>{variantCopy.body}</p>
        {!testEnvironment && <div className="trust-strip" aria-label={authCopy.safeguardsAriaLabel}>
          <span><i />{authCopy.safeguardSelfReplication}</span>
          <span><i />{authCopy.safeguardNoPublicVoiceLibrary}</span>
          <span><i />{authCopy.safeguardAuditableDeletion}</span>
        </div>}
      </section>

      <section className="auth-card" aria-labelledby="signin-title">
        <div className="secure-chip"><span className="secure-dot" />{authCopy.protectedWorkspace}</div>
        <h2 id="signin-title">{step === "email" ? authCopy.signInTitle : authCopy.checkInboxTitle}</h2>
        <p className="card-copy">
          {step === "email" ? authCopy.emailStepBody : withLabel(authCopy.codeStepBodyTemplate, email)}
        </p>

        {step === "email" ? (
          <>
            <button
              className="button google-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setBusy(true);
                googleSignIn().catch(() => {
                  setError(authCopy.googleUnavailableError);
                  setBusy(false);
                });
              }}
            >
              <span className="google-g" aria-hidden="true">G</span>
              {authCopy.continueWithGoogle}
            </button>
            <div className="or"><span>{authCopy.orUseEmail}</span></div>
            <label className="field-label" htmlFor="studio-email">{authCopy.emailLabel}</label>
            <input
              id="studio-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={authCopy.emailPlaceholder}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && email.includes("@") && !busy) void sendCode();
              }}
            />
            <button
              className="button primary-button"
              type="button"
              disabled={busy || !email.includes("@")}
              onClick={() => void sendCode()}
            >
              {busy ? <><Spinner label={authCopy.sendingCodeAriaLabel} />{authCopy.sendingCode}</> : authCopy.continueSecurely}
            </button>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="studio-code">{authCopy.codeLabel}</label>
            <input
              ref={codeRef}
              id="studio-code"
              className="field code-field"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && code.length === 6 && !busy) void verifyCode();
              }}
            />
            <button
              className="button primary-button"
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void verifyCode()}
            >
              {busy ? <><Spinner label={authCopy.verifyingAriaLabel} />{authCopy.verifying}</> : authCopy.verifyAndEnter}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              {authCopy.useDifferentEmail}
            </button>
          </>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {!testEnvironment && <p className="legal-copy">{authCopy.legalNotice}</p>}
      </section>
    </main>
  );
}
