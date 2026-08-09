// Meme gif bubble — resolves the search phrase to a Tenor CDN url via our
// proxy once, then persists the url on the message so it never re-resolves.

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Message } from "../state/store";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

export default function GifBubble({
  m,
  onResolved,
}: {
  m: Message;
  onResolved: (id: string, url: string) => void;
}) {
  const [url, setUrl] = useState(m.gifUrl || "");
  const [dead, setDead] = useState(false);

  useEffect(() => {
    if (url) return;
    let gone = false;
    fetch(`${BASE}/api/gif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: m.text }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (gone) return;
        if (d?.url) {
          setUrl(d.url);
          onResolved(m.id, d.url);
        } else setDead(true);
      })
      .catch(() => !gone && setDead(true));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dead)
    return (
      <div className="gif-fallback">
        🎬 <em>{m.text}</em>
      </div>
    );
  if (!url) return <div className="gif-loading" />;
  return <img src={url} alt={m.text} loading="lazy" draggable={false} onError={() => setDead(true)} />;
}
