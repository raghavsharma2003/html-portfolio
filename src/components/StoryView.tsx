// Full-screen story viewer — Instagram mechanics: segmented progress bars,
// auto-advance ~5s, tap right/left thirds for next/prev, press-and-hold to
// pause, swipe-down or ✕ to close, relative timestamp, ⋯ opens the account
// sheet. Dark immersive chrome; the image is the whole screen.

import { useEffect, useRef, useState } from "react";
import { type Story, storySrc, storyAge, markStorySeen } from "../engine/storyCatalog";
import { HER_NAME } from "../engine/persona";
import PhotoAvatar from "./PhotoAvatar";

const SEGMENT_MS = 5200;

interface Props {
  stories: Story[];
  onClose: () => void;
  onProfile: () => void;
  // soft gate: stories beyond the 2nd OFFER sign-in (never require it —
  // "continue watching" always works). No-op while ≤2 stories exist.
  signedIn?: boolean;
  onSignIn?: () => void;
}

export default function StoryView({ stories, onClose, onProfile, signedIn, onSignIn }: Props) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 within current segment
  const [ready, setReady] = useState(false); // current image loaded
  const [gate, setGate] = useState(false); // sign-in offer before story #3
  const gateDismissed = useRef(false);
  const paused = useRef(false);
  const holdTimer = useRef(0);
  const touchY = useRef(0);
  const lastTouch = useRef(0); // touch-vs-ghost-mouse discrimination
  const mountedAt = useRef(Date.now()); // the tap that OPENED us must not act
  const cur = stories[Math.min(idx, stories.length - 1)];

  // every displayed story is a seen story
  useEffect(() => {
    if (cur) markStorySeen(cur.id);
  }, [cur]);

  // segment clock — advances while not paused and the image is up
  useEffect(() => {
    setProgress(0);
    setReady(false);
    let last = performance.now();
    let acc = 0;
    const iv = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (paused.current || !readyRef.current) return;
      acc += dt;
      if (acc >= SEGMENT_MS) {
        clearInterval(iv);
        setIdx((i) => {
          if (i + 1 >= stories.length) {
            onClose();
            return i;
          }
          return i + 1;
        });
      } else {
        setProgress(acc / SEGMENT_MS);
      }
    }, 50);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // ready flag needs a ref for the interval closure
  const readyRef = useRef(false);
  readyRef.current = ready;

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
        paused.current = true;
        setGate(true);
        return i;
      }
      return next;
    });
  };

  const dismissGate = () => {
    gateDismissed.current = true;
    paused.current = false;
    setGate(false);
    setIdx((i) => Math.min(i + 1, stories.length - 1));
  };

  if (!cur) return null;

  return (
    <div
      className="story-view"
      onTouchStart={(e) => {
        lastTouch.current = Date.now();
        touchY.current = e.touches[0].clientY;
        holdTimer.current = window.setTimeout(() => {
          paused.current = true;
        }, 180);
      }}
      onTouchEnd={(e) => {
        // one tap must be ONE action: suppress the browser's compatibility
        // mouse events that follow touchend, or every tap advances twice
        // (and with two stories, shoots straight past the end → closes)
        e.preventDefault();
        lastTouch.current = Date.now();
        clearTimeout(holdTimer.current);
        if (Date.now() - mountedAt.current < 350) return; // opening tap's echo
        const dy = e.changedTouches[0].clientY - touchY.current;
        if (dy > 70) {
          onClose(); // swipe down closes, like insta
          return;
        }
        if (paused.current) {
          paused.current = false; // it was a hold-to-pause, not a tap
          return;
        }
        const x = e.changedTouches[0].clientX;
        go(x < window.innerWidth / 3 ? -1 : 1);
      }}
      onMouseDown={() => {
        if (Date.now() - lastTouch.current < 700) return; // ghost of a touch
        holdTimer.current = window.setTimeout(() => {
          paused.current = true;
        }, 180);
      }}
      onMouseUp={(e) => {
        if (Date.now() - lastTouch.current < 700) return; // ghost of a touch
        clearTimeout(holdTimer.current);
        if (Date.now() - mountedAt.current < 350) return; // opening tap's echo
        if (paused.current) {
          paused.current = false;
          return;
        }
        go(e.clientX < window.innerWidth / 3 ? -1 : 1);
      }}
    >
      <div className="story-bars">
        {stories.map((s, i) => (
          <div key={s.id} className="story-bar">
            <i
              style={{
                width: i < idx ? "100%" : i === idx ? `${progress * 100}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      <div className="story-head" onTouchEnd={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        <PhotoAvatar size={34} />
        <span className="story-name">{HER_NAME}</span>
        <span className="story-age">{storyAge(cur)}</span>
        <span style={{ flex: 1 }} />
        <button
          className="story-btn"
          aria-label="Account"
          onClick={(e) => {
            e.stopPropagation();
            onProfile();
          }}
        >
          ⋯
        </button>
        <button
          className="story-btn"
          aria-label="Close story"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>
      </div>

      <img
        className="story-img"
        src={storySrc(cur)}
        alt=""
        draggable={false}
        onLoad={() => setReady(true)}
        onError={() => go(1)} // a broken image never traps the viewer
      />
      {!ready && <div className="story-spin" />}

      {gate && (
        <div
          className="story-gate"
          onTouchEnd={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <p>aur bhi hai 👀</p>
          <button
            className="btn-primary"
            style={{ width: "auto", padding: "13px 30px" }}
            onClick={() => onSignIn?.()}
          >
            Sign in to keep watching
          </button>
          <button className="story-skip" onClick={dismissGate}>
            baad mein — continue
          </button>
        </div>
      )}
    </div>
  );
}
