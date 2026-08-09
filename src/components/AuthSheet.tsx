// Account sheet — Apple-grade: one clear action per screen, generous type,
// six-box OTP entry, no chrome. Google / email OTP / phone OTP; when signed
// in, shows the account + sync state and a quiet sign-out.

import { useEffect, useRef, useState } from "react";
import type { AppState } from "../state/store";
import {
  sendEmailOtp,
  verifyEmailOtp,
  sendSmsOtp,
  verifySmsOtp,
  googleSignIn,
  track,
  type AuthSession,
} from "../engine/account";

interface Props {
  state: AppState;
  onAuthed: (s: AuthSession) => void;
  onSignOut: () => void;
  onClose: () => void;
}

type Mode = "email" | "phone";
type Step = "start" | "otp";

export default function AuthSheet({ state, onAuthed, onSignOut, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("email");
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  const signedIn = Boolean(state.auth?.accessToken);

  useEffect(() => {
    if (step === "otp") boxes.current[0]?.focus();
  }, [step]);

  async function start() {
    setError("");
    setBusy(true);
    try {
      if (mode === "email") {
        await sendEmailOtp(email);
      } else {
        await sendSmsOtp(phone);
      }
      setStep("otp");
    } catch (e) {
      const msg = String((e as Error).message || "");
      setError(
        /sms|provider|not enabled|disabled/i.test(msg) && mode === "phone"
          ? "SMS sign-in isn't switched on yet — use email or Google for now"
          : msg.replace(/_/g, " "),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setError("");
    setBusy(true);
    try {
      const session =
        mode === "email" ? await verifyEmailOtp(email, code) : await verifySmsOtp(phone, code);
      track(state.deviceId, "signin_success", { method: mode }, session.userId);
      onAuthed(session);
    } catch (e) {
      setError("that code didn't match — check and try again");
      setDigits(Array(6).fill(""));
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (!clean && v !== "") return;
    const next = [...digits];
    if (clean.length > 1) {
      // paste path
      clean.slice(0, 6).split("").forEach((c, j) => (next[j] = c));
    } else {
      next[i] = clean;
    }
    setDigits(next);
    if (clean.length === 1 && i < 5) boxes.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === 6) verify(code);
  }

  return (
    <>
      <div className="sheet-veil" onClick={onClose} />
      <div className="sheet auth-sheet">
        <div className="grab" />

        {signedIn ? (
          <>
            <h3>Your account</h3>
            <div className="auth-id">
              <div className="auth-avatar">{(state.auth?.email?.[0] || "🙂").toUpperCase()}</div>
              <div>
                <div className="auth-who">{state.auth?.email || state.auth?.phone || "Signed in"}</div>
                <div className="auth-sub">Chats & memories sync to this account</div>
              </div>
            </div>
            <div style={{ height: 20 }} />
            <button className="btn-ghost" style={{ width: "100%" }} onClick={onSignOut}>
              Sign out on this device
            </button>
          </>
        ) : step === "start" ? (
          <>
            <h3>Keep her with you</h3>
            <p className="hint">
              Sign in and your chats, memories and her story about you follow you to any device.
            </p>

            <button className="auth-google" disabled={busy} onClick={() => googleSignIn().catch(() => setError("google sign-in isn't switched on yet — use email"))}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.5 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
                <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
                <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.6-4-13.5-9.6l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
              </svg>
              Continue with Google
            </button>

            <div className="auth-or"><span>or</span></div>

            <div className="auth-seg">
              <button className={mode === "email" ? "on" : ""} onClick={() => setMode("email")}>
                Email
              </button>
              <button className={mode === "phone" ? "on" : ""} onClick={() => setMode("phone")}>
                Phone
              </button>
            </div>

            {mode === "email" ? (
              <input
                className="field"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.includes("@") && start()}
              />
            ) : (
              <input
                className="field"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && phone.length > 7 && start()}
              />
            )}
            {error && <p className="auth-error">{error}</p>}
            <div style={{ height: 14 }} />
            <button
              className="btn-primary"
              disabled={busy || (mode === "email" ? !email.includes("@") : phone.replace(/\D/g, "").length < 8)}
              onClick={start}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
            <p className="auth-fine">
              New here? The code creates your account automatically. By signing
              in you agree to the{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                privacy policy & terms
              </a>
              .
            </p>
          </>
        ) : (
          <>
            <h3>Enter the code</h3>
            <p className="hint">
              Sent to {mode === "email" ? email : phone} — check {mode === "email" ? "your inbox" : "your messages"}.
            </p>
            <div className="otp-row">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  className="otp-box"
                  inputMode="numeric"
                  maxLength={6}
                  value={d}
                  disabled={busy}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                  }}
                />
              ))}
            </div>
            {error && <p className="auth-error">{error}</p>}
            <div style={{ height: 10 }} />
            <button className="btn-ghost" style={{ width: "100%" }} disabled={busy} onClick={() => start()}>
              Resend code
            </button>
            <button
              className="auth-back"
              onClick={() => {
                setStep("start");
                setDigits(Array(6).fill(""));
                setError("");
              }}
            >
              ← different {mode === "email" ? "email" : "number"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
