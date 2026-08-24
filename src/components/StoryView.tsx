// Full-screen story viewer — Instagram mechanics: segmented progress bars,
// auto-advance ~5s, tap right/left thirds for next/prev, press-and-hold to
// pause, swipe-down or ✕ to close, relative timestamp, ⋯ opens the account
// sheet. Dark immersive chrome; the image is the whole screen.
//
// The segment clock IS the progress animation: a compositor transform that
// reports its own end, instead of a 50ms interval driving twenty React
// renders a second through a layout property.

import { useEffect, useRef, useState } from "react";
import { type Story, storySrc, storyAge, markStorySeen } from "../engine/storyCatalog";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";
import { CloseIcon, MoreIcon, ArrowUpIcon } from "./icons";
import { AnimGlyph } from "./anim";
import gateArt from "../assets/empty/story-gate.svg";
// task #134 — see bodyPortal.tsx. This viewer has TWO call sites: App.tsx
// mounts it as a sibling of `.chat-wrap` (never trapped), Chat.tsx mounts it
// as a CHILD of `.chat` (trapped under `.home-back`, isolation: isolate).
// Portalling here, in the one component, fixes both uniformly rather than
// leaving the fix dependent on which call site happens to be used —
// PhotoViewer.tsx's header names this exact file as the same defect,
// deliberately left for this workstream to pick up.
import toBody from "./bodyPortal";

const SEGMENT_MS = 5200;

// THE HIGHLIGHT LABEL IS GONE, and its absence is the point.
//
// This used to translate storyAge()'s "2d"/"13d" into "yesterday" / "tuesday"
// / "9 Aug", because her newest authored batch never expired and a live ring
// over a fortnight-old picture reads as something rotting. That workaround is
// gone from storyCatalog: she has a story POOL now, matched to her clock, and
// the one on the ring was posted earlier TODAY — always. So every label this
// screen can produce is minutes or hours, and the branches that dressed up an
// old one were about to become a lie about a fresh one.
const ageLabel = (s: Story) => storyAge(s);

// rubber-band: the further past the edge, the less it follows
const band = (d: number, dim: number, c = 0.55) => (d * dim * c) / (dim + c * Math.abs(d));

interface Props {
  stories: Story[];
  onClose: () => void;
  onProfile: () => void;
  // soft gate: stories beyond the 2nd OFFER sign-in (never require it —
  // "continue watching" always works). No-op while ≤2 stories exist.
  signedIn?: boolean;
  onSignIn?: () => void;
  /** Instagram's story reply: the text goes to the chat, quoting the story. */
  onReply?: (text: string, story: Story) => void;
}

export default function StoryView({ stories, onClose, onProfile, signedIn, onSignIn, onReply }: Props) {
  const [idx, setIdx] = useState(0);
  const [reply, setReply] = useState("");
  const [ready, setReady] = useState(false); // current image loaded
  const [gate, setGate] = useState(false); // sign-in offer before story #3
  const gateDismissed = useRef(false);
  // pause is one attribute on the root now, not a ref consulted 20×/sec —
  // the ref stays because the gesture handlers read it synchronously
  const [pausedUI, setPausedUI] = useState(false);
  const paused = useRef(false);
  const setPaused = (v: boolean) => {
    paused.current = v;
    setPausedUI(v);
  };
  const holdTimer = useRef(0);
  const touchY = useRef(0);
  const dragging = useRef(false);
  const startedAt = useRef(0);
  const lastTouch = useRef(0); // touch-vs-ghost-mouse discrimination
  const mountedAt = useRef(Date.now()); // the tap that OPENED us must not act
  const cur = stories[Math.min(idx, stories.length - 1)];

  // every displayed story is a seen story
  useEffect(() => {
    if (cur) markStorySeen(cur.id);
  }, [cur]);

  // a new segment starts unloaded — the bar only runs once the image is up
  useEffect(() => {
    setReady(false);
  }, [idx]);

  // On a touchscreen the whole surface is the control. On a keyboard it was
  // nothing at all: no way to advance, no way back, and no way out except
  // reaching for a mouse. Escape closes, arrows move, space holds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setPaused(!paused.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories.length, signedIn]);

  const go = (dir: 1 | -1) => {
    setIdx((i) => {
      const next = i + dir;
      if (next < 0) return 0;
      if (next >= stories.length) {
        onClose();
        return i;
      }
      // soft sign-in offer before the 3rd story — skippable, once
      if (dir === 1 && next >= 2 && !signedIn && !gateDismissed.current) {
        setPaused(true);
        setGate(true);
        return i;
      }
      return next;
    });
  };

  const dismissGate = () => {
    gateDismissed.current = true;
    setPaused(false);
    setGate(false);
    setIdx((i) => Math.min(i + 1, stories.length - 1));
  };

  // the drag is written straight onto the element — React has no business
  // re-rendering a full-screen image at finger rate
  const resetDrag = (el: HTMLElement, animated: boolean) => {
    el.style.transition = animated
      ? "transform 260ms var(--ease-out), opacity 260ms var(--ease-out)"
      : "none";
    el.style.transform = "";
    el.style.opacity = "";
  };

  if (!cur) return null;

  return toBody(
    <div
      className="story-view"
      role="dialog"
      aria-modal="true"
      aria-label={`${HER_NAME}'s story`}
      {...(pausedUI ? { "data-paused": "" } : {})}
      onTouchStart={(e) => {
        lastTouch.current = Date.now();
        touchY.current = e.touches[0].clientY;
        startedAt.current = Date.now();
        dragging.current = false;
        holdTimer.current = window.setTimeout(() => {
          setPaused(true);
        }, 180);
      }}
      onTouchMove={(e) => {
        // feedback has to be continuous DURING the gesture, not only at the
        // end — otherwise you either get nothing or you get a dismissal
        const dy = e.touches[0].clientY - touchY.current;
        if (dy <= 0) return;
        if (dy > 10) {
          dragging.current = true;
          clearTimeout(holdTimer.current);
        }
        const y = band(dy, window.innerHeight);
        const el = e.currentTarget as HTMLElement;
        el.style.transition = "none";
        el.style.transform = `translateY(${y}px) scale(${1 - y / 2600})`;
        el.style.opacity = String(Math.max(0.35, 1 - y / 900));
      }}
      onTouchEnd={(e) => {
        // one tap must be ONE action: suppress the browser's compatibility
        // mouse events that follow touchend, or every tap advances twice
        // (and with two stories, shoots straight past the end → closes)
        e.preventDefault();
        lastTouch.current = Date.now();
        clearTimeout(holdTimer.current);
        const el = e.currentTarget as HTMLElement;
        if (Date.now() - mountedAt.current < 350) {
          resetDrag(el, false);
          return; // opening tap's echo
        }
        const dy = e.changedTouches[0].clientY - touchY.current;
        const v = Math.abs(dy) / Math.max(1, Date.now() - startedAt.current); // px/ms
        // velocity, not distance: demanding 110px from someone who clearly
        // flicked the screen away is a gesture that argues instead of obeys
        if (dy > 110 || (dy > 24 && v > 0.11)) {
          onClose();
          return;
        }
        if (dragging.current) {
          dragging.current = false;
          resetDrag(el, true);
          setPaused(false);
          return; // it was a drag that didn't commit, never a tap
        }
        resetDrag(el, false);
        if (paused.current) {
          setPaused(false); // it was a hold-to-pause, not a tap
          return;
        }
        const x = e.changedTouches[0].clientX;
        go(x < window.innerWidth / 3 ? -1 : 1);
      }}
      onMouseDown={() => {
        if (Date.now() - lastTouch.current < 700) return; // ghost of a touch
        holdTimer.current = window.setTimeout(() => {
          setPaused(true);
        }, 180);
      }}
      onMouseUp={(e) => {
        if (Date.now() - lastTouch.current < 700) return; // ghost of a touch
        clearTimeout(holdTimer.current);
        if (Date.now() - mountedAt.current < 350) return; // opening tap's echo
        if (paused.current) {
          setPaused(false);
          return;
        }
        go(e.clientX < window.innerWidth / 3 ? -1 : 1);
      }}
    >
      <div className="story-bars">
        {stories.map((s, i) => (
          <div
            key={`${s.id}-${idx}`} // remount restarts the fill
            className="story-bar"
            style={{ "--seg": `${SEGMENT_MS}ms` } as React.CSSProperties}
            data-state={i < idx ? "done" : i === idx && ready ? "active" : "idle"}
            // the segment ends when the animation does, not when a clock says so
            onAnimationEnd={() => {
              if (i === idx) go(1);
            }}
          >
            <i />
          </div>
        ))}
      </div>

      <div className="story-head" onTouchEnd={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        {/* the ring she wears everywhere else. `.ring-gold` is `live` here by
            definition: you are inside her story, so the ring is the one thing
            on this screen that cannot be in any other state. */}
        <span className="ring-gold live" style={{ width: 36, height: 36, padding: 2 }} aria-hidden="true">
          <span className="ring-inner">
            <PhotoAvatar size={32} />
          </span>
        </span>
        <span className="story-name name-serif">{HER_NAME}</span>
        <span className="story-age">{ageLabel(cur)}</span>
        <span style={{ flex: 1 }} />
        {/* THE APP'S OWN ICONS, not two text dingbats. `⋯` and `✕` are
            characters: they render in whatever the platform's UI font has,
            which put a spread-out `· · ·` and a heavy serif cross next to a
            screen full of hairline-stroked SVGs — and on the Android WebView
            the ✕ box-drew. Both glyphs already exist in `icons.tsx` and are
            what every other overlay in the app closes with. */}
        <button
          className="story-btn"
          aria-label="Account"
          onClick={(e) => {
            e.stopPropagation();
            onProfile();
          }}
        >
          <MoreIcon size={20} />
        </button>
        <button
          className="story-btn"
          aria-label="Close story"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon size={17} />
        </button>
      </div>

      <img
        className="story-img"
        src={storySrc(cur)}
        alt={cur.desc || `${HER_NAME}'s story`}
        draggable={false}
        onLoad={() => setReady(true)}
        onError={() => go(1)} // a broken image never traps the viewer
      />
      {!ready && <div className="story-spin" />}
      {/* the one thing a first-time viewer cannot guess — shown once */}
      {idx === 0 && stories.length > 1 && (
        <div className="story-hint">tap the sides to move · hold to pause</div>
      )}

      {/* ── reply, Instagram-style ─────────────────────────────────────────
          Sits at the foot of the story, sends into the chat, and closes the
          viewer — which is what Instagram does and what makes it feel like a
          reply rather than a comment. Every pointer event here is stopped:
          the story advances on taps to the sides and pauses on hold, so a
          composer that let those through would skip the story he is replying
          to while he types. */}
      {onReply && !gate && (
        <form
          className="story-reply"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const t = reply.trim();
            if (!t) return;
            onReply(t, stories[idx]);
            setReply("");
            onClose();
          }}
        >
          <input
            className="story-reply-in"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`reply to ${HER_NAME}…`}
            aria-label={`Reply to this story`}
            maxLength={500}
          />
          <button
            type="submit"
            className="story-reply-send"
            aria-label="Send reply"
            disabled={!reply.trim()}
          >
            <ArrowUpIcon size={17} />
          </button>
        </form>
      )}

      {gate && (
        <div
          className="story-gate"
          onTouchEnd={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {/* The lit window: what is behind the gate, drawn rather than
              described. It sits ABOVE the line and replaces none of it. */}
          <img className="story-gate-art" src={gateArt} alt="" width={200} height={133} />
          <p>
            aur bhi hai{" "}
            <AnimGlyph name="eyes" size={22} alt="" className="story-eyes" />
          </p>
          <button
            className="btn-primary"
            style={{ width: "auto", padding: "13px 30px" }}
            onClick={() => onSignIn?.()}
          >
            Sign in to keep watching
          </button>
          <button className="story-skip" data-tel="story.skip" onClick={dismissGate}>
            baad mein, continue
          </button>
        </div>
      )}
    </div>,
  );
}
