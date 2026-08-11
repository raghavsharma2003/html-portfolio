// A message that is just one emoji renders big — and animated where that is
// possible, using Google's Noto animated emoji (CC-BY) hotlinked from
// fonts.gstatic.com so nothing is bundled.
//
// It used to render ONLY the remote image: a 120px box that stayed blank
// until the CDN answered, with a 2.5s timer as the fallback. On a slow link
// that is two and a half seconds of a hole in the conversation, and offline
// it was a hole with a timestamp under it. Now the platform emoji is drawn
// immediately at display size — the message is never absent — and the
// animated one crossfades in on top if and when it arrives. The visible
// state never depends on a network response.

import { useEffect, useState } from "react";

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

export default function BigEmoji({ emoji }: { emoji: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const glyph = emoji.trim();

  // stop waiting after a beat: a request still in flight after 2.5s is not
  // going to land inside the moment this reaction belongs to
  useEffect(() => {
    if (loaded || broken) return;
    const t = setTimeout(() => setBroken(true), 2500);
    return () => clearTimeout(t);
  }, [loaded, broken]);

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
      {!broken && (
        <img
          src={cdnUrl(glyph)}
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
