import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendEmailOtp, verifyEmailOtp } from "../studioAuth";
import type { StudioSession } from "../types";

const COPY = {
  en: { title: "Continue with email", email: "Email", send: "Send a code", sending: "Sending code", code: "6-digit code", sent: "Check your email", verify: "Continue", verifying: "Checking code", change: "Use another email", sendError: "We couldn't send a code. Please try again.", verifyError: "We couldn't verify this code. Check it and try again." },
  hi: { title: "ईमेल से आगे बढ़ें", email: "ईमेल", send: "कोड भेजें", sending: "कोड भेज रहे हैं", code: "6 अंकों का कोड", sent: "अपना ईमेल देखें", verify: "आगे बढ़ें", verifying: "कोड जाँच रहे हैं", change: "दूसरा ईमेल इस्तेमाल करें", sendError: "कोड नहीं भेज पाए। फिर से कोशिश करें।", verifyError: "कोड की पुष्टि नहीं हुई। जाँचकर फिर से कोशिश करें।" },
};

/** Uses the existing account API. No account creation, clone grant or visitor admission is implied. */
export default function PublicationSignIn({ locale, onAuthed }: {
  locale: "en" | "hi";
  onAuthed: (session: StudioSession) => void;
}) {
  const c = COPY[locale];
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"send" | "verify" | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const revision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; revision.current++; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    const attempt = ++revision.current;
    const active = () => mounted.current && revision.current === attempt;
    setBusy(true); setError(null);
    try {
      if (step === "email") {
        await sendEmailOtp(email.trim());
        if (active()) { setCode(""); setStep("code"); }
      } else {
        const session = await verifyEmailOtp(email.trim(), code.trim());
        if (!session.userId || !session.accessToken || !session.refreshToken) throw new Error("invalid sign-in response");
        if (active()) onAuthed(session);
      }
    } catch {
      if (active()) setError(step === "email" ? "send" : "verify");
    } finally {
      if (active()) { locked.current = false; setBusy(false); }
    }
  }

  return <form className="vp-auth" onSubmit={submit} aria-busy={busy}>
    <h2>{step === "email" ? c.title : c.sent}</h2>
    {step === "email" ? <label>{c.email}
      <input type="email" autoComplete="email" required maxLength={254} value={email}
        disabled={busy} onChange={event => { setEmail(event.target.value); setError(null); }} />
    </label> : <>
      <p className="vp-muted">{email}</p>
      <label>{c.code}<input type="text" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy}
        onChange={event => { setCode(event.target.value.replace(/[^0-9]/g, "")); setError(null); }} /></label>
    </>}
    {error && <p className="vp-error" role="alert">{error === "send" ? c.sendError : c.verifyError}</p>}
    <button type="submit" className="vp-primary" disabled={busy}>
      {step === "email" ? busy ? c.sending : c.send : busy ? c.verifying : c.verify}
    </button>
    {step === "code" && <button type="button" className="vp-text-button" disabled={busy}
      onClick={() => { revision.current++; setStep("email"); setCode(""); setError(null); }}>{c.change}</button>}
  </form>;
}
