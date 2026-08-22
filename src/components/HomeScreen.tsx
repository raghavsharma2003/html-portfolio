// HOME — the hangout, not a list. docs/DESIGN-WORLD.md §2.
//
// The competitor's one genuinely good idea is that the app is a PLACE, and
// this is that place: her presence, the last thing you two said, and the
// things you can do together, floating in a sky that knows what time it is.
//
// ── what makes this better than the frames it was measured against ───────
//
//  1. THE CARDS ARE REAL. Theirs open a YouTube link and a web page. Every
//     card here opens something this app actually built — a chess engine that
//     talks, a would-you-rather deck, a tic tac toe with bounded imperfection,
//     her story, the Us page. So the cards say what is IN them ("she plays and
//     talks while you do") rather than what they are called.
//  2. THE AIR IS THE PRODUCT. Every surface they spend on a banner ad or a
//     "watch an ad for 15 minutes of chat" nag, this spends on nothing at all.
//     Emptiness where a competitor has ads is the premium signal, and it is
//     free.
//  3. IT NEVER TRAPS. Their home is reached by backing out of the chat; ours
//     is the ground the chat sits on, and every route out of every surface
//     lands here. That is a product rule, not a layout one, and it is why the
//     chat gets an explicit way home rather than a browser back button.
//
// ── what this file is NOT allowed to do ──────────────────────────────────
//
// It owns no activity logic and forks no handler. Every card calls back into
// the props App already wired for the games sheet, the story and the Us page;
// the GamesHub sheet stays exactly where it was for in-chat access. A second
// path that opens chess slightly differently is the shape this repo keeps
// having to un-write.

import { useEffect, useRef, useState } from "react";
import type { AppState } from "../state/store";
import { HER_NAME } from "../engine/persona";
import { herNow } from "../engine/timeline";
import { activeStories, hasUnseenStory } from "../engine/storyCatalog";
import PhotoAvatar from "./PhotoAvatar";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import { ChessIcon, ForkIcon, GridIcon } from "./GamesHub";
import { PhoneIcon, SettingsIcon, VideoIcon, HeartIcon, ChevronIcon } from "./icons";
import { tap, ImpactStyle } from "../native/haptics";
import "../styles/home.css";

export interface HomeCard {
  id: string;
  title: string;
  /** one line, app-voiced, never a line she would say */
  blurb: string;
  icon: React.ReactNode;
  onOpen: () => void;
}

interface Props {
  state: AppState;
  /** opens the thread — the pill, the avatar and the chat button all use it */
  onOpenChat: () => void;
  onCall: () => void;
  onGames: (id: string) => void;
  onStory: () => void;
  onUs: () => void;
  onProfile: () => void;
}

export default function HomeScreen({
  state,
  onOpenChat,
  onCall,
  onGames,
  onStory,
  onUs,
  onProfile,
}: Props) {
  const sky = useSky();

  // HER PRESENCE LINE, and it is the same fact the model is given.
  //
  // `herNow()` is T9's own function: it is what tells her where she is in her
  // day, and rendering it here means the home screen and her next message
  // cannot disagree about whether she is asleep. Inventing a second line
  // ("Meera is online!") would be a second source of truth about her, which is
  // the exact class of bug docs/TIME.md was written to end.
  //
  // Re-read on a timer rather than once per mount: a phone left open across
  // 06:15 must not still say she is asleep. Ten minutes is well inside the
  // shortest slot and costs six wake-ups an hour.
  const [dayNote, setDayNote] = useState(() => herNow(Date.now()).note);
  useEffect(() => {
    const iv = setInterval(() => setDayNote(herNow(Date.now()).note), 10 * 60_000);
    return () => clearInterval(iv);
  }, []);

  const storyLive = activeStories().length > 0;
  const storyUnseen = storyLive && hasUnseenStory();

  // The last thing either of you said, as a pill that opens the thread.
  // `channel === "call"` turns are spoken words the thread itself hides, so
  // they are hidden here too — a pill quoting something that is nowhere in
  // the chat you are about to open is a broken promise.
  const last = [...state.messages].reverse().find((m) => m.channel !== "call" && m.text?.trim());

  const cards: HomeCard[] = [
    {
      id: "chess",
      title: "chess",
      blurb: "a real board, both sides. she plays and talks while you do",
      icon: <ChessIcon />,
      onOpen: () => onGames("chess"),
    },
    {
      id: "would-you-rather",
      title: "would you rather",
      blurb: "two bad options and an argument about them",
      icon: <ForkIcon />,
      onOpen: () => onGames("would-you-rather"),
    },
    {
      id: "tic-tac-toe",
      title: "tic tac toe",
      blurb: "thirty seconds, no thinking required",
      icon: <GridIcon />,
      onOpen: () => onGames("tic-tac-toe"),
    },
    {
      id: "watch",
      title: "watch together",
      blurb: "call her, share your screen, she watches it with you",
      icon: <VideoIcon size={22} />,
      onOpen: onCall,
    },
    {
      id: "story",
      title: "her story",
      blurb: storyUnseen ? "something new from today" : "what she has been up to",
      icon: <StoryIcon />,
      onOpen: onStory,
    },
    {
      id: "us",
      title: "us",
      blurb: "everything the two of you have built so far",
      icon: <HeartIcon size={22} />,
      onOpen: onUs,
    },
  ];

  // ── PARALLAX ────────────────────────────────────────────────────────────
  // The world moves a fraction of what the content does, which is the entire
  // illusion of depth. Written to a CSS variable from a rAF-throttled scroll
  // listener and consumed by `transform` only: a `top` here would relayout
  // the sky on every frame of every scroll, which is the single most
  // expensive mistake this effect could make.
  const scroller = useRef<HTMLDivElement>(null);
  const rootEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const root = rootEl.current;
    if (!el || !root) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const write = () => {
      raf = 0;
      root.style.setProperty("--par", String(el.scrollTop));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(write);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home" ref={rootEl} style={skyVars(sky)} data-sky={sky.state}>
      <WorldLayer frame={sky} />

      <div className="home-scroll" ref={scroller}>
        <div className="home-top">
          <button
            className="home-gear"
            data-tel="home.settings"
            onClick={onProfile}
            aria-label="Settings and account"
          >
            <SettingsIcon size={19} />
          </button>
        </div>

        {/* ── her presence ───────────────────────────────────────────────
            The gold ring is the competitor's one piece of real craft and it
            is worth taking: a warm metallic edge is what makes a photo read
            as a person rather than as an asset. Ours is the app's own ember
            accent rather than a generic gold, and it doubles as the story
            ring — unseen story, the ring is live; no story, it is quiet. */}
        <div className="home-her">
          <button
            className={`hh-face ${storyUnseen ? "live" : storyLive ? "seen" : ""}`}
            data-tel="home.avatar"
            onClick={storyLive ? onStory : onOpenChat}
            aria-label={storyLive ? `View ${HER_NAME}'s story` : `Open your chat with ${HER_NAME}`}
          >
            <span className="hh-inner">
              <PhotoAvatar size={112} />
            </span>
          </button>
          <h1 className="hh-name">{HER_NAME.toLowerCase()}</h1>
          <p className="hh-line">{dayNote}</p>
        </div>

        {/* ── the last exchange ──────────────────────────────────────────
            One tap back into the conversation, quoting the real last line.
            Before there is one it says so plainly rather than showing an
            empty shell: a first-run screen that looks like a broken
            returning-user screen is the worst first run there is. */}
        <button className="home-pill" data-tel="home.open_chat" onClick={onOpenChat}>
          <span className="hp-face" aria-hidden="true">
            <PhotoAvatar size={34} />
          </span>
          <span className="hp-text">
            {last ? (
              <>
                <em>{last.from === "her" ? HER_NAME.toLowerCase() : "you"}</em>
                <b>{previewOf(last.text, last.kind)}</b>
              </>
            ) : (
              <>
                <em>no messages yet</em>
                <b>say hi to her</b>
              </>
            )}
          </span>
          <span className="hp-go" aria-hidden="true">
            <ChevronIcon size={16} />
          </span>
        </button>

        {/* ── the things you do together ─────────────────────────────────
            Glass cards floating in the world, each drifting on its own
            period so the group never pulses as one. The stagger is CSS and
            per-index; the drift is transform-only and a few pixels; the
            press is the app's own squash spring (--sq-x/--sq-y). */}
        <div className="home-cards">
          {cards.map((c, i) => (
            <button
              key={c.id}
              className="hcard"
              style={{ "--i": i } as React.CSSProperties}
              data-tel={`home.card.${c.id}`}
              // Feedback on pointerdown, navigation on click: the press is
              // felt while the finger is still down, and a scroll that
              // started on this card does not open anything.
              onPointerDown={() => tap(ImpactStyle.Light)}
              onClick={c.onOpen}
              aria-label={`${c.title}. ${c.blurb}`}
            >
              {/* TWO ELEMENTS, ONE CARD, and the split is mechanical rather
                  than decorative: a CSS `animation` on `transform` beats any
                  normal `transform` declaration for as long as it runs, so a
                  card that drifts on its own transform can never also squash
                  under a finger. The outer element drifts; the inner one is
                  where the press lives. */}
              <span className="hc-in">
                <span className="hc-ic" aria-hidden="true">
                  {c.icon}
                </span>
                <span className="hc-tx">
                  <b>{c.title}</b>
                  <em>{c.blurb}</em>
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* AD-FREE IS A DESIGN FEATURE (DESIGN-WORLD §6). This is the exact
            spot the competitor puts a subscription banner on every screen.
            It stays air, and the only thing at the bottom of the page is the
            one sentence about what she is — the same sentence the settings
            sheet ends with, in the same voice. */}
        <p className="home-foot">{HER_NAME} is an AI. She'll tell you so if you ask.</p>
      </div>

      {/* ── the dock ───────────────────────────────────────────────────────
          Two things, both of them verbs, both of them hers. It floats over
          the world rather than sitting in a bar, and it never scrolls away:
          the two things you came to do are always one thumb-reach from the
          bottom of the screen. */}
      <div className="home-dock">
        <button className="hd-btn primary" data-tel="home.chat" onClick={onOpenChat}>
          <ChatIcon />
          <span>chat</span>
        </button>
        <button
          className="hd-btn"
          data-tel="home.call"
          onClick={onCall}
          aria-label={`Call ${HER_NAME}`}
        >
          <PhoneIcon size={21} />
        </button>
      </div>
    </div>
  );
}

/** Message kinds that have no text of their own get named instead of quoted —
 *  a preview reading "" is a pill that looks broken. */
function previewOf(text: string, kind: string): string {
  if (kind === "voice") return "voice note";
  if (kind === "gif") return "sent a gif";
  if (kind === "photo") return text?.trim() || "sent a photo";
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > 46 ? t.slice(0, 45).replace(/\s+\S*$/, "") + "…" : t;
}

const StoryIcon = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.6" strokeDasharray="3.4 2.6" />
    <circle cx="12" cy="12" r="3.4" />
  </svg>
);

const ChatIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20.5 11.7c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.6-.34L4.5 20.2l1.2-3.5A6.9 6.9 0 0 1 3.5 11.7c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z" />
  </svg>
);
