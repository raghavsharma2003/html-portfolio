// A message that is just one emoji renders big and ANIMATED — Google's Noto
// animated emoji (CC-BY), hotlinked from fonts.gstatic.com so nothing is
// bundled. If the CDN hasn't delivered within a beat (offline, blocked,
// unknown codepoint), it falls back to the plain emoji at display size.

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

export default function BigEmoji({ emoji }: { emoji: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoaded((ok) => {
        if (!ok) setBroken(true);
        return ok;
      });
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  if (broken) return <span style={{ fontSize: 76, lineHeight: 1.15 }}>{emoji.trim()}</span>;
  return (
    <img
      src={cdnUrl(emoji.trim())}
      alt={emoji}
      width={120}
      height={120}
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setBroken(true)}
      style={{ display: "block", opacity: loaded ? 1 : 0, transition: "opacity 0.2s" }}
    />
  );
}
