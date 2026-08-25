// FULL-SCREEN, for the pictures HE sent.
//
// ── why this is not StoryView ──────────────────────────────────────────────
//
// StoryView.tsx is the other full-screen picture surface in this app and it was
// the obvious thing to reuse. It is the wrong shape, and the reasons are all in
// its own header: it is Instagram's story reader. It auto-advances on a 5.2s
// clock, it treats a tap on the right two thirds as "next", it holds to pause,
// and it ends by closing. Every one of those is correct for something she
// posted and wrong for something he sent: a picture he is looking at should
// stay on screen until he moves it, and the tap he makes to see it larger must
// not immediately count as the tap that skips it.
//
// So this shares the LANGUAGE (immersive dark ground, swipe down to dismiss,
// the app's own close glyph, the same rubber-band constant) and none of the
// mechanics. `.story-view`'s classes are deliberately not reused: a future edit
// to the story reader must not be able to change what a photo does.
//
// ── THE GESTURE RULES IT OBEYS (docs/DESIGN-STANDARDS.md) ──────────────────
//
//   * 1:1 tracking. The set follows the finger exactly while inside its range.
//   * Rubber-band at the ends. A hard stop at the first or last picture reads
//     as frozen, so past the edge the track follows at a decaying rate.
//   * Momentum projection on release, not nearest-neighbour. A flick that was
//     clearly going somewhere goes there; a slow drag past half commits.
//   * Never locked. A new grab beats the settle animation in flight, and it
//     starts from the PRESENTATION value rather than the logical one, so an
//     interrupted swipe does not jump.
//   * Bounce is not used. Nothing here is thrown; the settle is a decelerate.
//
// ── WHY IT IS PORTALLED, WHICH IS NOT A PREFERENCE ─────────────────────────
//
// `.chat` carries `isolation: isolate` (global.css, so the wallpaper cannot
// escape it), which makes the whole thread ONE stacking context at z-index auto
// inside `.chat-wrap`. `.home-back` is a sibling of `.chat` at z-index 6. So a
// full-screen surface rendered as a DESCENDANT of `.chat` is capped by its
// parent's level no matter what z-index it declares: measured here at 62, and
// the back chevron still painted on top of it.
//
// The fix is not a bigger number, it is not being inside that subtree. This
// portals to `document.body`, where `position: fixed; inset: 0` means what it
// says. Recorded because the SAME bleed applies to StoryView.tsx (z-index 60,
// same parent, not portalled) and is a real defect in the story reader today —
// left alone here on purpose, because that file belongs to another workstream
// and its own eval battery would be the thing to re-run.

/** where a full-screen surface belongs: outside every app stacking context */
const host = () => (typeof document === "undefined" ? null : document.body);

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

/** the further past the edge, the less it follows. StoryView's own constant. */
const band = (d: number, dim: number, c = 0.55) => (d * dim * c) / (dim + c * Math.abs(d));

/** how far a flick is projected, from the release velocity (px/ms) */
const PROJECT_MS = 190;

interface Props {
  urls: string[];
  /** which picture the tap was on */
  start: number;
  caption?: string;
  onClose: () => void;
}

export default function PhotoViewer({ urls, start, caption, onClose }: Props) {
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, start), urls.length - 1));
  const track = useRef<HTMLDivElement>(null);
  const idxRef = useRef(idx);
  idxRef.current = idx;

  const drag = useRef({ x: 0, y: 0, dx: 0, dy: 0, at: 0, axis: "" as "" | "x" | "y", live: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIdx((i) => Math.min(urls.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, urls.length]);

  // THE TRACK'S POSITION IS WRITTEN, NEVER DECLARED. A CSS rule keyed on the
  // index would fight the inline transform the drag writes: clearing the inline
  // value to hand control back would snap to the OLD index for one frame and
  // then slide, which is the visible jump the standards call out. One writer,
  // and the animated hop and the finger both go through it.
  const place = (i: number, animated: boolean) => {
    const el = track.current;
    if (!el) return;
    el.style.transition = animated ? "transform 260ms var(--ease-out)" : "none";
    el.style.transform = `translateX(${-i * 100}%)`;
    el.style.opacity = "";
  };
  const first = useRef(true);
  useLayoutEffect(() => {
    place(idx, !first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  /** settle the track onto a page, animated, from wherever the finger left it */
  const settle = (to: number) => {
    if (to === idxRef.current) place(to, true); // a drag that did not commit
    else setIdx(to); // the layout effect above animates it
  };

  const root = host();
  if (!root) return null;

  return createPortal(
    <div
      className="pview"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${idx + 1} of ${urls.length}`}
      onTouchStart={(e) => {
        const t = e.touches[0];
        // a new grab always beats the settle in flight, and it starts from what
        // is ON SCREEN rather than from the value the settle was heading for
        const el = track.current;
        if (el) el.style.transition = "none";
        drag.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, at: Date.now(), axis: "", live: true };
      }}
      onTouchMove={(e) => {
        const d = drag.current;
        if (!d.live) return;
        const t = e.touches[0];
        d.dx = t.clientX - d.x;
        d.dy = t.clientY - d.y;
        if (!d.axis) {
          if (Math.abs(d.dx) > 10 && Math.abs(d.dx) > Math.abs(d.dy)) d.axis = "x";
          else if (Math.abs(d.dy) > 10) d.axis = "y";
          else return;
        }
        const el = track.current;
        if (!el) return;
        // the page the track is parked on. Every transform below is written
        // relative to it, because the track holds every picture side by side
        // and "here" is one viewport width per index.
        const home = `translateX(${-idxRef.current * 100}%)`;
        if (d.axis === "y") {
          if (d.dy <= 0) return;
          const y = band(d.dy, window.innerHeight);
          el.style.transform = `${home} translateY(${y}px) scale(${1 - y / 2600})`;
          el.style.opacity = String(Math.max(0.35, 1 - y / 900));
          return;
        }
        // horizontal: 1:1 inside the set, rubber-banded past either end
        const w = window.innerWidth || 1;
        const atStart = idxRef.current === 0 && d.dx > 0;
        const atEnd = idxRef.current === urls.length - 1 && d.dx < 0;
        const dx = atStart || atEnd ? band(d.dx / w, w) : d.dx;
        el.style.transform = `${home} translateX(${dx}px)`;
      }}
      onTouchEnd={() => {
        const d = drag.current;
        d.live = false;
        const el = track.current;
        if (!el) return;
        if (!d.axis) return; // a tap, not a drag: nothing moved, nothing settles
        const dt = Math.max(1, Date.now() - d.at);
        if (d.axis === "y") {
          const v = d.dy / dt;
          // velocity, not distance: a clear flick away should not be argued
          // with over the last thirty pixels (StoryView's own rule)
          if (d.dy > 110 || (d.dy > 24 && v > 0.11)) {
            onClose();
            return;
          }
          el.style.transition = "transform 260ms var(--ease-out), opacity 260ms var(--ease-out)";
          el.style.transform = `translateX(${-idxRef.current * 100}%)`;
          el.style.opacity = "";
          return;
        }
        // momentum projection: where was this going, not where did it stop
        const v = d.dx / dt;
        const projected = d.dx + v * PROJECT_MS;
        const w = window.innerWidth || 1;
        const step = projected < -w * 0.28 ? 1 : projected > w * 0.28 ? -1 : 0;
        settle(Math.min(urls.length - 1, Math.max(0, idxRef.current + step)));
      }}
    >
      <button className="pview-x" data-tel="viewer.close" onClick={onClose} aria-label="Close photo">
        <CloseIcon size={17} />
      </button>
      {urls.length > 1 && (
        <div className="pview-count" data-tel="viewer.count">
          {idx + 1} of {urls.length}
        </div>
      )}

      <div className="pview-track" ref={track}>
        {urls.map((u, i) => (
          <div className="pview-page" key={`${i}-${u.slice(-24)}`}>
            <img src={u} alt="" draggable={false} />
          </div>
        ))}
      </div>

      {caption && <div className="pview-cap">{caption}</div>}

      {urls.length > 1 && (
        <div className="pview-dots" aria-hidden="true">
          {urls.map((_, i) => (
            <i key={i} data-on={i === idx ? "" : undefined} />
          ))}
        </div>
      )}
    </div>,
    root,
  );
}
