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
import { fetchRelState } from "../engine/memory";
import { bandTrust, bandPacing } from "../engine/relstate";
import type { RelBundleInput } from "../engine/compiler";
import {
  ChevronIcon,
  CloseIcon,
  CloudIcon,
  HeartIcon,
  MemoryIcon,
  PersonIcon,
  TrashIcon,
} from "./icons";
import { THEMES, THEME_LABEL } from "../engine/theme";

// GAP 4 (WS-FELT) — closeness card copy. App chrome, never a line she says
// (same discipline ClockCard.tsx's own header states for its strings), and
// deliberately never the raw numbers underneath (owner's bar: no trust
// score, no percentages — a relationship, not a stat sheet). Built ONLY
// from bands relstate.ts already computes for the model itself
// (bandTrust/bandPacing) plus the honorific enum, so the UI can never say
// something the model's own view of the relationship disagrees with.
const HONORIFIC_LABEL: Record<string, string> = {
  tu: "She's easy and informal with you",
  tum: "You're warming up to each other",
  aap: "Still finding your footing together",
};
const TRUST_LABEL: Record<string, string> = {
  new: "just starting to open up",
  building: "getting more comfortable with every conversation",
  steady: "settled into a steady rhythm",
  strong: "trusts you with a lot",
  deep: "deeply comfortable together",
};
const PACING_LABEL: Record<string, string> = {
  frequent: "You talk often",
  regular: "You check in regularly",
  sparse: "You catch up now and then",
  occasional: "You reconnect every so often",
};

const VIBES = [
  "someone to talk to",
  "late-night company",
  "hype-friend energy",
  "deep conversations",
  "someone who listens",
  "just curious",
];

type View = "menu" | "profile" | "clear" | "forget";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onClose: () => void;
  onAccount: () => void;
  onClearChat: () => void;
  // the inverse of remembering. Same ten-second park as onClearChat — the
  // caller does not send anything until the window closes.
  onForgetEverything: () => void;
  messageCount: number;
}

export default function MoreSheet({
  state,
  setState,
  onClose,
  onAccount,
  onClearChat,
  onForgetEverything,
  messageCount,
}: Props) {
  const [view, setView] = useState<View>("menu");
  const [name, setName] = useState(state.user.name || "");
  const [vibe, setVibe] = useState<string[]>(state.user.vibe || []);
  const sheet = useRef<HTMLDivElement>(null);

  // GAP 4 (WS-FELT) — closeness card data. Fetched once per sheet open, not
  // wired to `takeRelBundle`'s consume-once cache (that one is tied to the
  // chat lane's own recall timing and may already be spent by the time
  // someone opens Settings). `null` covers "no consolidation has run yet"
  // and "request failed/timed out" identically — both render nothing,
  // which is the correct default (absence, not a placeholder stat).
  const [relBundle, setRelBundle] = useState<RelBundleInput | null>(null);
  useEffect(() => {
    let live = true;
    if (state.deviceId) fetchRelState(state.deviceId).then((b) => live && setRelBundle(b));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.deviceId]);

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
        aria-label={
          view === "clear"
            ? "Clear this chat?"
            : view === "forget"
              ? "Make her forget you?"
              : view === "profile"
                ? "You"
                : "Settings"
        }
      >
        <div className="grab" />
        <button className="sheet-x" data-tel="more.close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {view === "menu" && (
          <>
            <h3>Settings</h3>
            <p className="hint">Everything about you, and about this conversation.</p>
            {relBundle && (
              <div className="rel-card" aria-label="Relationship depth">
                <span className="rel-card-title">Where things stand</span>
                <span className="rel-card-body">
                  {HONORIFIC_LABEL[relBundle.relState.honorific] ?? HONORIFIC_LABEL.tum} — she's{" "}
                  {TRUST_LABEL[bandTrust(relBundle.relState.trust)] ?? TRUST_LABEL.building}.
                </span>
                {(() => {
                  const pacing = PACING_LABEL[bandPacing(relBundle.relState.pacing_gap_s)];
                  const hasRituals = relBundle.rituals.length > 0;
                  const hasWe = relBundle.weEpisodes.length > 0;
                  if (!pacing && !hasRituals && !hasWe) return null;
                  const bits = [
                    pacing,
                    hasRituals ? "you've built a few things you always do together" : null,
                    hasWe ? "there are things only the two of you bring up" : null,
                  ].filter(Boolean);
                  return <span className="rel-card-sub">{bits.join(" · ")}</span>;
                })()}
              </div>
            )}
            {/* APPEARANCE.
                Sits at the top of Settings, not buried in a submenu, because
                it is the one setting here that someone changes for a physical
                reason — the screen is too bright right now — and a setting you
                reach for in that state should be one tap away, not three.
                Reuses the existing chip row rather than inventing a control. */}
            <label>Appearance</label>
            <div className="chip-row" role="radiogroup" aria-label="Appearance">
              {THEMES.map((t) => {
                const on = (state.theme ?? "system") === t;
                return (
                  <button
                    key={t}
                    className={`chip ${on ? "on" : ""}`}
                    role="radio"
                    aria-checked={on}
                    data-tel={`more.theme.${t}`}
                    onClick={() => setState((cur) => ({ ...cur, theme: t }))}
                  >
                    {THEME_LABEL[t]}
                  </button>
                );
              })}
            </div>
            <p className="hint">
              Auto follows your phone, and keeps following it — including when it
              turns dark at night on its own.
            </p>

            <div className="sheet-rows">
              <button className="srow" data-tel="more.profile" onClick={() => setView("profile")}>
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

              <button className="srow" data-tel="more.account" onClick={onAccount}>
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

              <button className="srow destructive" data-tel="more.clear_chat" onClick={() => setView("clear")}>
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

              {/* The other direction, and it is deliberately the LAST row and
                  the second destructive one: clearing takes the conversation
                  and leaves what she knows; this takes what she knows. A
                  product built on her remembering you is only honest if the
                  undo for that is somewhere you can find without asking. */}
              <button className="srow destructive" data-tel="more.forget_all" onClick={() => setView("forget")}>
                <span className="sicon">
                  <MemoryIcon />
                </span>
                <span className="stext">
                  <span className="stitle">Make her forget you</span>
                  <span className="ssub">
                    Everything she's worked out about your life, deleted for good
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
            <button className="btn-primary" data-tel="more.save_profile" onClick={saveProfile}>
              Save
            </button>
            <button className="auth-back" data-tel="more.back" onClick={() => setView("menu")}>
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

        {view === "forget" && (
          <>
            <h3>Make her forget you?</h3>
            {/* Named in words, the same as the clear-chat copy, and it names
                the parts separately because they are separate things: what
                she worked out about you, and the record of you saying it. */}
            <p className="confirm-body">
              {HER_NAME} deletes <b>everything she has worked out about your life</b> — the
              people, the places, the plans, the running jokes, how things felt — and{" "}
              <b>her record of every message and call</b> you two have had. This chat goes
              with it and she starts over not knowing you.
              <br />
              <br />
              You'll get ten seconds to undo. Nothing is sent until then — but once it
              goes, it is gone, and nobody can bring it back.
            </p>
            <div className="confirm-actions">
              <button
                className="btn-danger"
                onClick={() => {
                  onForgetEverything();
                  onClose();
                }}
              >
                <TrashIcon size={18} />
                <span style={{ marginLeft: 8 }}>Forget everything</span>
              </button>
              <button className="btn-ghost" style={{ width: "100%" }} onClick={() => setView("menu")}>
                Keep it
              </button>
            </div>
            <p className="auth-fine" style={{ marginTop: 16 }}>
              <HeartIcon size={13} /> Your account stays. You can also just ask her — "yeh
              bhool ja" drops one thing without touching the rest.
            </p>
          </>
        )}
      </div>
    </>
  );
}
