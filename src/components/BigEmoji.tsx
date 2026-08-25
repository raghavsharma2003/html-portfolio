// A message that is just one emoji renders big — and animated where that is
// possible.
//
// It used to render ONLY the remote image: a 120px box that stayed blank
// until the CDN answered, with a 2.5s timer as the fallback. On a slow link
// that is two and a half seconds of a hole in the conversation, and offline
// it was a hole with a timestamp under it. Now the platform emoji is drawn
// immediately at display size — the message is never absent — and the
// animated one crossfades in on top if and when it arrives. The visible
// state never depends on a network response.
//
// ── TWO SOURCES, AND THE NEAR ONE WINS ────────────────────────────────────
//
// Six emoji have artwork of our own (`public/anim/react-*`, the quick-reaction
// set). Those are the ones a person actually sends alone in a bubble, and for
// those this file loads OUR file instead of hotlinking Google's Noto:
//
//   - it is in the bundle, so it works on a plane and in a lift, which the
//     CDN never has;
//   - it is one fewer third party in the path of the most common case;
//   - it is the same drawing the reaction picker and the pill paint, so one
//     glyph does not have two faces in one thread.
//
// Everything else keeps the Noto path exactly as it was (CC-BY, hotlinked from
// fonts.gstatic.com, nothing bundled) — 3,000 emoji is not artwork anyone is
// going to author, and a static platform glyph for all of them would be a
// downgrade for the sake of consistency.
//
// ── REDUCED MOTION ────────────────────────────────────────────────────────
//
// Both sources are animated WebP, and an animated WebP cannot be paused by
// CSS. So reduced motion is answered by not requesting one: our six fall back
// to their own still SVG, and everything else falls back to the platform
// glyph that was already drawn underneath. Gentler, never absent.

import { useEffect, useState } from "react";
import { REACTION_ART, animMotion, animStill, useReducedMotion } from "./anim";

const cdnUrl = (emoji: string) => {
  const cps = [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join("_");
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${cps}/512.webp`;
};

export function isSingleEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || [...t].length > 2) return false;
  return /^\p{Extended_Pictographic}️?$/u.test(t);
}

const SIZE = 108;

/**
 * Which file, if any, should crossfade in on top of the platform glyph.
 * `null` means "the glyph is the whole message", which is the correct answer
 * for a reduced-motion viewer with no still drawing of this emoji.
 */
export function bigEmojiSource(glyph: string, reduced: boolean): string | null {
  const own = REACTION_ART[glyph];
  if (own) return reduced ? animStill(own) : animMotion(own);
  return reduced ? null : cdnUrl(glyph);
}

export default function BigEmoji({ emoji }: { emoji: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const glyph = emoji.trim();
  const reduced = useReducedMotion();
  const src = bigEmojiSource(glyph, reduced);

  // stop waiting after a beat: a request still in flight after 2.5s is not
  // going to land inside the moment this reaction belongs to
  useEffect(() => {
    if (loaded || broken || !src) return;
    const t = setTimeout(() => setBroken(true), 2500);
    return () => clearTimeout(t);
  }, [loaded, broken, src]);

  return (
    <span
      className="bigmoji"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={glyph}
    >
      {/* always present, always immediately: this is the message */}
      <span className="bigmoji-glyph" aria-hidden="true">
        {glyph}
      </span>
      {!broken && src && (
        <img
          key={src}
          src={src}
          alt=""
          width={SIZE}
          height={SIZE}
          draggable={false}
          aria-hidden="true"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
    </span>
  );
}
