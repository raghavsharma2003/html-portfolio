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

import NotifyRow from "../notify/NotifyRow";
import toBody from "./bodyPortal";
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
import type { SkyState } from "../engine/sky";
import { useSky, skyVars } from "./WorldLayer";
// WS-SOUND. `setSoundEnabled` is published from Chat on every change to
// `state.soundOn`; it is called HERE as well, at the instant of the tap, so
// that switching sound on can be confirmed BY a sound. A preview that waited
// for the next render would be a preview of the setting he just left.
import { play, setSoundEnabled } from "../sound";

// GAP 4 (WS-FELT) — closeness card copy. App chrome, never a line she says
// (same discipline ClockCard.tsx's own header states for its strings), and
// deliberately never the raw numbers underneath (owner's bar: no trust
// score, no percentages — a relationship, not a stat sheet). Built ONLY
// from bands relstate.ts already computes for the model itself
// (bandTrust/bandPacing) plus the honorific enum, so the UI can never say
// something the model's own view of the relationship disagrees with.
/**
 * The one icon this sheet draws itself.
 *
 * It lives here rather than in `icons.tsx` because it is the only icon in the
 * app with two STATES, and the two states are the whole point of the control:
 * a speaker with air coming off it, or a speaker with a line through it. An
 * icon that looked the same either way would put the entire burden of the
 * switch on the track beside it, which is exactly what the Appearance segments
 * above were doing before they got swatches.
 */
const SoundIcon = ({ on, size = 19 }: { on: boolean; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11 5.5 6.6 9H3.8v6h2.8L11 18.5V5.5Z" />
    {on ? (
      <>
        <path d="M14.8 9.4a3.6 3.6 0 0 1 0 5.2" />
        <path d="M17.4 6.9a7.2 7.2 0 0 1 0 10.2" />
      </>
    ) : (
      <path d="M15.2 9.8 20 14.6M20 9.8l-4.8 4.8" />
    )}
  </svg>
);

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

// ── THE CHOICE CONFIRMS ITSELF (WS-SKYFELT, owner defect) ─────────────────
//
// Half of "I selected Sky and no change" is a picture problem (the wallpaper
// veil, see sky.ts) and half of it is a WORDS problem. The static paragraph
// under the segmented control described the mode in general — "warm through
// the day, deep after dusk" — which is exactly the sentence a person cannot
// use at 11:27 in the morning, because it does not tell them whether the tap
// they just made did anything or which half of it they are looking at.
//
// So when Sky is the live choice the line stops explaining and starts
// REPORTING: what the sky over her city is doing this minute, which of the two
// palettes that resolves to, and when it turns over. That is the confirmation
// the tap owed them, and it costs nothing but a lookup.
//
// Built from the ONE clock, and from the same field the palette resolves
// through. `useSky()` is `skyNow()` and `frame.tokens.mode` is the single
// field `skyMode()` reads, so this line and the screen it describes cannot
// disagree — a second derivation here would be a second clock, which is the
// failure sky.ts's own header exists to prevent.
//
// Lowercase, one sentence pair, no em-dash (gated by check-copy.mjs).
const SKY_NOW_LINE: Record<SkyState, string> = {
  night: "night in bangalore, so she's in dark. light again at dawn.",
  predawn: "pre-dawn in bangalore, so she's in dark. light at sunrise.",
  morning: "morning in bangalore, so she's in light. dark after dusk.",
  golden: "golden hour in bangalore, so she's in light. dark after dusk.",
  dusk: "dusk in bangalore, so she's in dark. light again at dawn.",
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

  // PRESENTATION ONLY. The "Sky" segment does not describe the sky mode in
  // words, it SHOWS the sky that mode is following right now — the swatch is
  // the live four-stop gradient from the same table the world layer paints
  // from. That is the most honest depiction available of what choosing it
  // does, and it is why this hook is here rather than a static picture of a
  // sunset. It cannot reach any handler: `skyVars` writes CSS variables.
  const sky = useSky();

  return toBody(
    <>
      <div className="sheet-veil" onClick={onClose} />
      <div
        className="sheet"
        ref={sheet}
        style={skyVars(sky)}
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
            {/* APPLE-TERSE (owner, 2026-08-23: "many places there is too much
                text we don't want that. we want apple like design"). The
                subtitle under this title said "Everything about you, and about
                this conversation", which is a restatement of the word
                Settings. A headline that needs a gloss is a headline that is
                wrong; this one is not. */}
            <h3>Settings</h3>
            {relBundle && (
              <div className="rel-card" aria-label="Relationship depth">
                <span className="rel-card-title">Where things stand</span>
                <span className="rel-card-body">
                  {HONORIFIC_LABEL[relBundle.relState.honorific] ?? HONORIFIC_LABEL.tum}, and she's{" "}
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

                IT SHOWS WHAT IT MEANS. Four outlined pills reading "Sky",
                "Auto", "Light", "Dark" were four identical shapes carrying
                four words, which put the entire burden of the choice on the
                paragraph underneath — a person had to READ their way to a
                setting whose whole subject is what the screen looks like. So
                every segment now carries a swatch of the thing it does: Sky is
                the LIVE gradient from the sky table (the sky it is following,
                at this minute), Auto is a light half and a dark half, and
                Light and Dark are the two grounds themselves.

                The swatches are deliberately hard-coded rather than tokenised
                — see the note in global.css. A depiction of the light theme
                has to look light while the dark theme is active, which is the
                one place in this stylesheet where a raw value is the correct
                answer and a token is the bug.

                The wiring is untouched: same THEMES order, same values, same
                `state.theme ?? "system"` resolution (undefined = system), same
                setState, same data-tel, same radiogroup semantics. */}
            <label>Appearance</label>
            <div className="seg" role="radiogroup" aria-label="Appearance">
              {THEMES.map((t) => {
                const on = (state.theme ?? "system") === t;
                return (
                  <button
                    key={t}
                    className={`seg-opt ${on ? "on" : ""}`}
                    data-mode={t}
                    role="radio"
                    aria-checked={on}
                    data-tel={`more.theme.${t}`}
                    onClick={() => setState((cur) => ({ ...cur, theme: t }))}
                  >
                    <span className="seg-swatch" aria-hidden="true" />
                    <span className="seg-label">{THEME_LABEL[t]}</span>
                  </button>
                );
              })}
            </div>
            {/* ONE LINE, and it changes job depending on what is selected.
                "Light" and "Dark" explain themselves; Sky and Auto are both
                "it changes on its own", so the static line names WHAT decides
                and stops. The owner's read of the old four-line paragraph was
                the same as his read of every other paragraph in this sheet:
                too much text.

                When Sky is live the line stops describing the mode and
                reports it — the state over her city right now and the palette
                that resolves to. That sentence is the whole answer to "I
                selected Sky and no change", because it is the one thing on
                screen that is different the instant the tap lands, at any hour
                of the day. It is the copy half of the fix; the wallpaper is
                the other half. */}
            <p className="hint" data-tel="more.theme_hint">
              {(state.theme ?? "system") === "sky"
                ? SKY_NOW_LINE[sky.state as SkyState]
                : `Sky follows the sky over ${HER_NAME}'s city. Auto follows your phone.`}
            </p>

            {/* SOUNDS.
                One switch, and it sits under Appearance rather than in a
                submenu for the same reason the theme picker does: it is a
                setting someone reaches for in a physical situation ("I am in
                a meeting"), and a setting you reach for in that state should
                be one tap away.

                It is a `switch` and not a row that navigates, so it carries a
                real track instead of a chevron: a chevron promises a place you
                go. The subtitle is the one place in this sheet that can say
                what the sound layer IS, and it says the two cues that account
                for almost all of it. Nothing about volume, because there is no
                volume to set.

                TURNING IT ON PREVIEWS ITSELF. `setSoundEnabled` is published
                before the state write so the cue below is not swallowed by the
                gate it is about to open, and the cue is `receive` because
                hearing HER arrival is the honest answer to "what will this
                sound like". Turning it off previews nothing, obviously. */}
            <button
              type="button"
              className="srow sound-row"
              role="switch"
              aria-checked={state.soundOn !== false}
              data-tel="more.sound"
              onClick={() => {
                const next = state.soundOn === false;
                setSoundEnabled(next);
                setState((cur) => ({ ...cur, soundOn: next }));
                if (next) play("receive");
              }}
            >
              <span className="sicon" aria-hidden="true">
                <SoundIcon on={state.soundOn !== false} />
              </span>
              <span className="stext">
                <span className="stitle">Sounds</span>
                <span className="ssub">
                  {state.soundOn !== false
                    ? "A quiet tap when you send, and when she answers"
                    : "Off. Nothing but calls."}
                </span>
              </span>
              <span className="sswitch" aria-hidden="true">
                <span className="sknob" />
              </span>
            </button>
            <NotifyRow state={state} setState={setState} />

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
                      : "Not signed in. On this device only"}
                  </span>
                </span>
                <span className="schev">
                  <ChevronIcon />
                </span>
              </button>
            </div>

            {/* The two irreversible acts live in their OWN ruled group, below a
                visible break, with danger-tinted icon tiles and no chevrons: a
                chevron promises navigation, and neither of these is a place you
                go — they are things you DO. The audit caught them dressed as
                ordinary rows (same pink tile, same gray chevron as "You").

                THE BREAK IS NOW A ZONE RATHER THAN A HAIRLINE. A 0.5px rule
                above two rows that are otherwise shaped exactly like "You" and
                "Account & sync" is a distinction only someone already looking
                for it can see, and the owner's screenshot is what that reads
                like in practice: a wall of identical rows where the last two
                happen to be red. The group is an inset, tinted, outlined
                container now, with a label that names what the two of them
                have in common. Nothing about either handler moved. */}
            <label className="danger-label">Permanent</label>
            <div className="sheet-rows danger">
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
                  <span className="ssub">Everything she knows about you, deleted</span>
                </span>
              </button>
            </div>

            <div className="sheet-foot">
              <span>{HER_NAME} is an AI. She'll tell you so if you ask.</span>
              <a href="https://meera-silk.vercel.app/privacy" target="_blank" rel="noreferrer">
                Privacy
              </a>
            </div>
          </>
        )}

        {view === "profile" && (
          <>
            <h3>You</h3>
            {/* APPLE-TERSE. Two sentences that said "you can change this" about
                a screen made entirely of editable fields. One line, and it
                keeps the only fact the fields do not state themselves: when
                the change lands. */}
            <p className="hint">She picks up changes from your next message on.</p>
            <div className="sheet-rows">
              <button
                className="srow"
                data-tel="more.knows"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent("meera:knows"));
                }}
              >
                <span className="sicon">
                  <MemoryIcon />
                </span>
                <span className="stext">
                  <span className="stitle">What she remembers</span>
                  <span className="ssub">Read it, fix it, drop anything</span>
                </span>
                <span className="schev">
                  <ChevronIcon />
                </span>
              </button>
            </div>
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
              <ChevronIcon size={16} />
              back
            </button>
          </>
        )}

        {view === "clear" && (
          <>
            <h3>Clear this chat?</h3>
            {/* APPLE-TERSE (owner, 2026-08-23). One line, and it still names
                both halves of what goes: the messages, and her side of the
                conversation.

                THE UNDO PROMISE LEFT THE SHEET ON PURPOSE. "You'll get ten
                seconds to undo" was the app narrating a thing it is about to
                do anyway — the undo toast appears the moment this button is
                pressed and IS the promise, so saying it here first is a
                paragraph spent on something the next screen shows. Nothing
                about the ten seconds changed; only the pre-announcement. */}
            <p className="confirm-body">
              Removes <b>{messageCount} message{messageCount === 1 ? "" : "s"}</b> everywhere
              you're signed in. {HER_NAME} starts over.
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
              <HeartIcon size={13} /> Her memory of <em>you</em> stays.
            </p>
          </>
        )}

        {view === "forget" && (
          <>
            <h3>Make her forget you?</h3>
            {/* APPLE-TERSE, WITH A FLOOR. This is a privacy-charter surface,
                so compression is allowed to take the ENUMERATION ("the people,
                the places, the plans, the running jokes") and is not allowed
                to take a fact. Two load-bearing facts survive, one per line,
                and they are the two a person would sue over not being told:
                the deletion covers everything she knows about your life AND
                the record of every message and call, and it is permanent.

                The undo pre-narration goes for the reason it goes on the
                clear sheet — the toast is the promise. "This cannot be undone"
                is a different sentence and it stays: it is about the act, not
                about the ten seconds. */}
            <p className="confirm-body">
              {HER_NAME} deletes <b>everything she knows about your life</b>, and{" "}
              <b>every message and call</b> you two have had.
              <br />
              <br />
              This cannot be undone.
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
              <HeartIcon size={13} /> To drop one thing instead, just tell her "yeh bhool ja".
            </p>
          </>
        )}
      </div>
    </>,
  );
}
