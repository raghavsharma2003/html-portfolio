// The settings that did not exist.
//
// Before this sheet, two things were true and both were product bugs. Your
// name and what you came to her for were asked once during onboarding and
// then unreachable forever — she would call you by a typo for the rest of
// the relationship. And the only other control in the header was an
// unlabelled broom two taps from the call button that erased the entire
// conversation, her memory of her own life, and her carried feeling, with
// no confirmation you could read and no way back.
//
// Everything destructive now lives behind a sheet you open on purpose, is
// named in words before it happens, and — for the chat — is undoable for
// ten seconds after.

import { useEffect, useRef, useState } from "react";
import type { AppState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import {
  ChevronIcon,
  CloseIcon,
  CloudIcon,
  HeartIcon,
  PersonIcon,
  TrashIcon,
} from "./icons";

const VIBES = [
  "someone to talk to",
  "late-night company",
  "hype-friend energy",
  "deep conversations",
  "someone who listens",
  "just curious",
];

type View = "menu" | "profile" | "clear";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onClose: () => void;
  onAccount: () => void;
  onClearChat: () => void;
  messageCount: number;
}

export default function MoreSheet({
  state,
  setState,
  onClose,
  onAccount,
  onClearChat,
  messageCount,
}: Props) {
  const [view, setView] = useState<View>("menu");
  const [name, setName] = useState(state.user.name || "");
  const [vibe, setVibe] = useState<string[]>(state.user.vibe || []);
  const sheet = useRef<HTMLDivElement>(null);

  // Escape closes, and focus starts inside the sheet rather than wherever
  // the page happened to leave it — a sheet you can only leave by finding
  // the 8px of scrim above it is a trap on a tall phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (view === "menu") onClose();
        else setView("menu");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }, [view]);

  const saveProfile = () => {
    setState((s) => ({
      ...s,
      user: {
        ...s.user,
        name: name.trim() || s.user.name,
        vibe: vibe.length ? vibe : s.user.vibe,
      },
    }));
    setView("menu");
  };

  const signedIn = Boolean(state.auth?.accessToken);

  return (
    <>
      <div className="sheet-veil" onClick={onClose} />
      <div
        className="sheet"
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={view === "clear" ? "Clear this chat?" : view === "profile" ? "You" : "Settings"}
      >
        <div className="grab" />
        <button className="sheet-x" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {view === "menu" && (
          <>
            <h3>Settings</h3>
            <p className="hint">Everything about you, and about this conversation.</p>
            <div className="sheet-rows">
              <button className="srow" onClick={() => setView("profile")}>
                <span className="sicon">
                  <PersonIcon />
                </span>
                <span className="stext">
                  <span className="stitle">You</span>
                  <span className="ssub">
                    {state.user.name ? `${HER_NAME} calls you ${state.user.name}` : "Tell her your name"}
                  </span>
                </span>
                <span className="schev">
                  <ChevronIcon />
                </span>
              </button>

              <button className="srow" onClick={onAccount}>
                <span className="sicon">
                  <CloudIcon />
                </span>
                <span className="stext">
                  <span className="stitle">Account &amp; sync</span>
                  <span className="ssub">
                    {signedIn
                      ? `Synced · ${state.auth?.email || state.auth?.phone || "signed in"}`
                      : "Not signed in — this chat lives on this device only"}
                  </span>
                </span>
                <span className="schev">
                  <ChevronIcon />
                </span>
              </button>

              <button className="srow destructive" onClick={() => setView("clear")}>
                <span className="sicon">
                  <TrashIcon />
                </span>
                <span className="stext">
                  <span className="stitle">Clear this chat</span>
                  <span className="ssub">
                    {messageCount
                      ? `${messageCount} message${messageCount === 1 ? "" : "s"} · she starts over`
                      : "Nothing to clear yet"}
                  </span>
                </span>
                <span className="schev">
                  <ChevronIcon />
                </span>
              </button>
            </div>

            <div className="sheet-foot">
              <span>{HER_NAME} is an AI. She'll tell you so if you ask.</span>
              <a href="/privacy" target="_blank" rel="noreferrer">
                Privacy
              </a>
            </div>
          </>
        )}

        {view === "profile" && (
          <>
            <h3>You</h3>
            <p className="hint">
              What she calls you, and what you came here for. Change it whenever — she
              picks it up from the next message on.
            </p>
            <label htmlFor="ms-name">Your name</label>
            <input
              id="ms-name"
              className="field"
              value={name}
              maxLength={24}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveProfile()}
            />
            <label>What you're looking for</label>
            <div className="chip-row">
              {VIBES.map((v) => (
                <button
                  key={v}
                  className={`chip ${vibe.includes(v) ? "on" : ""}`}
                  aria-pressed={vibe.includes(v)}
                  onClick={() =>
                    setVibe((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
                  }
                >
                  {v}
                </button>
              ))}
            </div>
            <div style={{ height: 18 }} />
            <button className="btn-primary" onClick={saveProfile}>
              Save
            </button>
            <button className="auth-back" onClick={() => setView("menu")}>
              ← back
            </button>
          </>
        )}

        {view === "clear" && (
          <>
            <h3>Clear this chat?</h3>
            <p className="confirm-body">
              This removes <b>{messageCount} message{messageCount === 1 ? "" : "s"}</b> from every
              device you're signed in on. {HER_NAME} also forgets{" "}
              <b>what she has told you about her own days</b> and starts the conversation fresh.
              <br />
              <br />
              You'll get ten seconds to undo.
            </p>
            <div className="confirm-actions">
              <button
                className="btn-danger"
                onClick={() => {
                  onClearChat();
                  onClose();
                }}
              >
                <TrashIcon size={18} />
                <span style={{ marginLeft: 8 }}>Clear chat</span>
              </button>
              <button className="btn-ghost" style={{ width: "100%" }} onClick={() => setView("menu")}>
                Keep it
              </button>
            </div>
            <p className="auth-fine" style={{ marginTop: 16 }}>
              <HeartIcon size={13} /> Your account, and her memory of <em>you</em>, are not touched.
            </p>
          </>
        )}
      </div>
    </>
  );
}
