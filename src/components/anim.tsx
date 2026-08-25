// OUR OWN GLYPHS — the animated set, and the still one that stands in for it.
//
// ── what this file is ──────────────────────────────────────────────────────
//
// Eight small pieces of authored artwork live at `public/anim/`, each as a PAIR:
// an animated `.webp` and a still `.svg` drawn from the same shapes. This module
// is the only thing that knows those paths, the only thing that decides which
// half of a pair to paint, and the only thing that decides what to do when
// neither loads.
//
// ── THE PAIR IS THE REDUCED-MOTION MECHANISM, AND IT HAS TO BE ─────────────
//
// docs/DESIGN-STANDARDS.md's mechanised rule is "@keyframes implies a
// prefers-reduced-motion answer". An animated WebP has no keyframes CSS can
// reach: `animation: none` does nothing to it, and there is no property that
// pauses it. The only honest answer is to not request the moving file at all,
// which is why `useReducedMotion` is consulted BEFORE the `src` is chosen
// rather than after. Reduced motion gets the still drawing of the same thing,
// which is "gentler, never absent" as the standard states it.
//
// ── WHAT IS STORED IS THE EMOJI, NEVER A PATH ─────────────────────────────
//
// `Message.reaction` holds the emoji CHARACTER, exactly as it always has, and
// so does everything downstream of it: the sync payload, the transcript, her
// prompt. This file is a display layer over that character and nothing else.
// If a future edit ever writes an asset path into a message, reactions stop
// syncing between devices and stop reaching her at all, and nothing would look
// wrong on screen. `evals/assetwire/run.mjs` asserts the storage side of this
// rather than trusting the paragraph.
//
// ── THE THIRD FALLBACK ────────────────────────────────────────────────────
//
// webp, then svg, then the emoji itself. The last one is not decoration: a
// reaction that fails to paint is a message whose reaction has silently
// vanished, and the platform emoji has always been able to draw it.

import { useEffect, useState, type CSSProperties } from "react";

/** Every pair under `public/anim/`. The name IS the filename stem. */
export type AnimName =
  | "react-heart"
  | "react-laugh"
  | "react-wow"
  | "react-sad"
  | "react-thanks"
  | "react-up"
  | "bloom"
  | "eyes"
  | "clapper"
  | "avatar-default";

/**
 * Which names actually have a moving half. `clapper` and `avatar-default` are
 * still drawings with no `.webp` beside them, so asking for motion on those is
 * a 404 rather than a nicety, and this set is what stops it being asked for.
 */
const MOVING: ReadonlySet<AnimName> = new Set<AnimName>([
  "react-heart",
  "react-laugh",
  "react-wow",
  "react-sad",
  "react-thanks",
  "react-up",
  "bloom",
  "eyes",
]);

/**
 * Same-origin, always. `public/anim/` is copied into `dist/` by vite and into
 * the APK's asset root by `cap sync`, so this path resolves on the web and on
 * the phone without the remote base `PhotoCard` needs for `/moments/` (those
 * are deliberately not bundled; these are).
 */
export const animMotion = (n: AnimName) => `/anim/${n}.webp`;
export const animStill = (n: AnimName) => `/anim/${n}.svg`;
export const hasMotion = (n: AnimName) => MOVING.has(n);

/**
 * WhatsApp's six, mapped to our six. Keyed by the stored CHARACTER, which is
 * what makes this a lookup rather than a translation: a message whose reaction
 * is not one of these six simply misses and renders as the emoji, which is
 * exactly what an unknown reaction should do.
 */
export const REACTION_ART: Readonly<Record<string, AnimName>> = {
  "❤️": "react-heart",
  "😂": "react-laugh",
  "😮": "react-wow",
  "😢": "react-sad",
  "🙏": "react-thanks",
  "👍": "react-up",
};

const query = "(prefers-reduced-motion: reduce)";

const readReduced = () => {
  try {
    return window.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
};

/**
 * Live, not read-once. The rest of the app reads this preference at the moment
 * it starts an animation, which is fine for something that runs and finishes.
 * These images run forever, so a person who turns the setting ON while a
 * thread is open would otherwise keep every glyph moving until they navigated
 * away, which is the exact complaint the setting exists to answer.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReduced);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia?.(query) ?? null;
    } catch {
      mq = null;
    }
    if (!mq) return;
    const live = mq;
    const on = () => setReduced(live.matches);
    on();
    live.addEventListener?.("change", on);
    return () => live.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

interface GlyphProps {
  name: AnimName;
  /** painted box, in CSS px. Square by construction: every pair is 1:1. */
  size: number;
  /** the accessible name, or "" for artwork a neighbouring label already says */
  alt: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * One glyph, at one size, in whichever half of its pair this device should see.
 *
 * `key` is bound to the chosen src so that flipping the OS setting REPLACES the
 * element rather than mutating its `src`: a WebP that has already begun
 * decoding keeps animating through an attribute change in some engines, which
 * would make the reduced-motion branch look like it worked and not work.
 */
export function AnimGlyph({ name, size, alt, className, style }: GlyphProps) {
  const reduced = useReducedMotion();
  const [fellBack, setFellBack] = useState(false);
  const moving = !reduced && hasMotion(name) && !fellBack;
  const src = moving ? animMotion(name) : animStill(name);
  return (
    <img
      key={src}
      className={className}
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      style={style}
      onError={() => setFellBack(true)}
    />
  );
}

interface ReactionProps {
  /** the STORED value: an emoji character, never a path */
  emoji: string;
  size: number;
  className?: string;
}

/**
 * A reaction as artwork, with the character underneath it the whole way down.
 *
 * Renders the emoji itself for anything outside our six, and for the case where
 * both halves of the pair failed to load. The caller keeps passing and storing
 * `emoji`; nothing here ever reaches the message.
 */
export function ReactionGlyph({ emoji, size, className }: ReactionProps) {
  const name = REACTION_ART[emoji];
  const reduced = useReducedMotion();
  // 0: the moving half. 1: the still half. 2: the emoji, which cannot fail.
  const [stage, setStage] = useState(0);
  if (!name || stage > 1) return <span className={className}>{emoji}</span>;
  const moving = !reduced && stage === 0;
  const src = moving ? animMotion(name) : animStill(name);
  return (
    <img
      key={src}
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      onError={() => setStage(moving ? 1 : 2)}
    />
  );
}
