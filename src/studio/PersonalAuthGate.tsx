import { useCallback, useEffect, useRef, useState } from "react";
import {
  StudioAuthError,
  googleSignIn,
  isStudioAuthDead,
  sendEmailOtp,
  verifyEmailOtp,
} from "./studioAuth";
import { restoreSession, writeStoredSession } from "./session";
import type { StudioSession } from "./types";
import ExpertEntryVisual from "./ExpertEntryVisual";
import VyaktiMark from "./VyaktiMark";
import { PersonalAuthLoading, usePersonalAuthLocale } from "./personalAuthLocale";
import type { StepId } from "./wizardModel";

type AuthStep = "email" | "code";

export type AuthResumeIntent = {
  replicaId: string | null;
  replicaName: string | null;
  step: StepId;
  email: string;
};

function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export default function PersonalAuthGate({
  onAuthed,
  testEnvironment,
  resumeIntent,
}: {
  onAuthed: (session: StudioSession) => void;
  testEnvironment: boolean;
  resumeIntent: AuthResumeIntent | null;
}) {
  const { locale, ready, failed, retry, switchLocale, t } = usePersonalAuthLocale();
  const intro = t.variant[testEnvironment ? "test" : "generic"];
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState(resumeIntent?.email || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingLink, setCheckingLink] = useState(false);
  const [error, setError] = useState<"linkNotReadyError" | "sendError" | "networkError" | "rateLimitError" | "serviceUnavailableError" | "codeMismatchError" | "googleError" | "">("");
  const codeRef = useRef<HTMLInputElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // WS-R164: focus the email field for EVERY first render of this step, not
  // only a `resumeIntent` return. Before this, a brand-new person arriving
  // straight from the landing's own primary action (never a resumeIntent,
  // `PersonalStudioEntry.tsx` always passes `resumeIntent={null}`) had to
  // tap the field before typing — one avoidable step in the first five
  // minutes, `context/decisions.md#ws-r164-first-time-email-autofocus`.
  useEffect(() => {
    if (step === "email") emailRef.current?.focus();
  }, [resumeIntent, step, ready]);

  const acceptLinkedSession = useCallback(async (showNotReady = false) => {
    setCheckingLink(true);
    try {
      const linked = await restoreSession({ reportTransientFailure: true });
      if (linked) {
        onAuthed(linked);
        return;
      }
      if (showNotReady) setError("linkNotReadyError");
    } catch (cause) {
      if (showNotReady) setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : "serviceUnavailableError" : "networkError");
    } finally {
      setCheckingLink(false);
    }
  }, [onAuthed]);

  useEffect(() => {
    if (step === "code") linkButtonRef.current?.focus();
  }, [step, ready]);

  useEffect(() => {
    if (step !== "code") return;
    const checkStorage = () => { void acceptLinkedSession(false); };
    const checkVisible = () => {
      if (document.visibilityState === "visible") void acceptLinkedSession(false);
    };
    window.addEventListener("storage", checkStorage);
    window.addEventListener("focus", checkStorage);
    document.addEventListener("visibilitychange", checkVisible);
    return () => {
      window.removeEventListener("storage", checkStorage);
      window.removeEventListener("focus", checkStorage);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, [acceptLinkedSession, step]);

  async function sendCode() {
    setError("");
    setBusy(true);
    try {
      await sendEmailOtp(email.trim(), "/studio");
      setStep("code");
    } catch (cause) {
      setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : cause.status >= 500 ? "serviceUnavailableError" : "sendError" : "networkError");
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
    } catch (cause) {
      // WS-R164: a wrong or expired code is 403 from the real door
      // (`api/account.js`'s `verify_otp` passes GoTrue's own status through
      // unchanged), not 400/401 — this used to fall through to
      // `serviceUnavailableError` ("try again shortly"), a sentence a
      // person could not act on for a code they simply mistyped. `?
      // isStudioAuthDead` is `studioAuth.ts`'s own 400/401/403 classifier,
      // already used the same way elsewhere in the studio (`StudioApp.tsx`);
      // reused here rather than re-deriving a narrower copy a second time.
      const rejectedCode = isStudioAuthDead(cause);
      setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : rejectedCode ? "codeMismatchError" : "serviceUnavailableError" : "networkError");
      if (rejectedCode) setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <PersonalAuthLoading locale={locale} failed={failed} retry={retry} switchLocale={switchLocale} testEnvironment={testEnvironment} />;

  return (
    <main className="auth-page" lang={locale} data-studio-auth-locale={locale} data-auth-theme={testEnvironment ? "test" : "general"}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="auth-brand">
        <a href="/" aria-label={t.homeAriaLabel}><VyaktiMark /></a>
        <label className="visually-hidden" htmlFor="studio-auth-language">{locale === "hi" ? "भाषा" : "Language"}</label>
        <select id="studio-auth-language" className="auth-language-select" value={locale} onChange={event => switchLocale(event.target.value === "hi" ? "hi" : "en")}>
          <option value="en" lang="en">English</option><option value="hi" lang="hi">हिन्दी</option>
        </select>
        <span className="brand-rule" />
        <span>{intro.brandTag}</span>
      </header>

      <section className="auth-intro" aria-labelledby="studio-title">
        {intro.introEyebrow && <p className="eyebrow">{intro.introEyebrow}</p>}
        <h1 id="studio-title">{intro.introTitle}</h1>
        <p>{intro.introBody}</p>
        {!testEnvironment && <ExpertEntryVisual copy={{alt: t.visualAlt, ...t.visualCaptions}} />}
        {!testEnvironment && <div className="trust-strip" aria-label={t.safeguardsAriaLabel}>
          <span><i />{t.privateByDefault}</span>
          <span><i />{t.everyClipDisclosed}</span>
          <span><i />{t.deleteAnytime}</span>
        </div>}
      </section>

      <section className="auth-card" aria-labelledby="signin-title">
        <h2 id="signin-title">{step === "email" ? (resumeIntent ? t.welcomeBackTitle : t.emailTitle) : t.inboxTitle}</h2>
        {resumeIntent && step === "email" ? (
          <div className="auth-resume-note" role="status">
            <strong>{t.resumeTitle}</strong>
            <p>
              {t.resumeBodyTemplate.replace("{name}", resumeIntent.replicaName || t.sameClone).replace("{step}", t.stepTitle[resumeIntent.step])}
            </p>
          </div>
        ) : null}
        <p className="card-copy">
          {step === "email"
            ? t.emailBody
            : t.inboxBodyTemplate.replace("{email}", email)}
        </p>

        {step === "email" ? (
          <>
            <label className="field-label" htmlFor="studio-email">{t.emailLabel}</label>
            <input
              ref={emailRef}
              id="studio-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t.emailPlaceholder} lang="en"
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
              {busy ? <><Spinner label={t.sendingAriaLabel} />{t.sending}</> : t.sendLink}
            </button>
            <div className="or"><span>{t.or}</span></div>
            <button
              className="button google-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setBusy(true);
                googleSignIn().catch(() => {
                  setError("googleError");
                  setBusy(false);
                });
              }}
            >
              <span className="google-g" aria-hidden="true">G</span>
              {t.google}
            </button>
          </>
        ) : (
          <>
            <p className="inbox-status" id="studio-inbox-help" role="status">
              {t.inboxHelp}
            </p>
            <button
              ref={linkButtonRef}
              className="button primary-button"
              type="button"
              disabled={busy || checkingLink}
              onClick={() => void acceptLinkedSession(true)}
            >
              {checkingLink ? t.checkingLink : t.openedLink}
            </button>
            <div className="or"><span>{t.optionalCodeDivider}</span></div>
            <label className="field-label" htmlFor="studio-code">{t.codeLabel}</label>
            <input
              ref={codeRef}
              id="studio-code"
              className="field code-field"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="studio-inbox-help"
              maxLength={6}
              placeholder={t.codePlaceholder}
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
              {busy ? <><Spinner label={t.verifyingAriaLabel} />{t.verifying}</> : t.verify}
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
              {t.differentEmail}
            </button>
          </>
        )}
        {error && <p className="inline-error" role="alert">{String(t[error])}</p>}
        {!testEnvironment && <p className="legal-copy">
          {t.legalNotice}
        </p>}
      </section>
    </main>
  );
}
