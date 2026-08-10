// WhatsApp-style voice-note bubble. Hers are backed by the hosted TTS
// (generated on first play, then cached); yours play the locally recorded
// clip (kept in memory for this session — the transcript persists).

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { cachedClip, saveClip } from "../voice/speech";
import type { Message } from "../state/store";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

// session-only audio for locally recorded notes
const localClips = new Map<string, Blob>();
export function registerLocalClip(msgId: string, blob: Blob) {
  localClips.set(msgId, blob);
}

const ttsCache = new Map<string, Blob>();

async function audioFor(m: Message): Promise<Blob | null> {
  if (m.from === "me") return localClips.get(m.id) ?? null;
  const key = m.id;
  if (ttsCache.has(key)) return ttsCache.get(key)!;
  // persistent cache: a replayed voice note must never be synthesized twice
  const stored = await cachedClip(`vn1:${key}`);
  if (stored) {
    ttsCache.set(key, stored);
    return stored;
  }
  try {
    const res = await fetch(`${BASE}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: m.spoken || m.text }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size < 1000) return null;
    ttsCache.set(key, blob);
    saveClip(`vn1:${key}`, blob);
    return blob;
  } catch {
    return null;
  }
}

// deterministic waveform from the message id
function bars(seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = (h ^ c.charCodeAt(0)) * 16777619;
  return Array.from({ length: 24 }, (_, i) => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return 6 + (h % 1000) / 1000 * 16 * (0.6 + 0.4 * Math.sin(i / 3));
  });
}

export default function VoiceNote({ m }: { m: Message }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false); // fetch/play failed — tap retries
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wave = useRef(bars(m.id));

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  async function toggle() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    if (!audioRef.current) {
      setLoading(true);
      const blob = await audioFor(m);
      setLoading(false);
      if (!blob) {
        setFailed(true); // visible failure — the next tap retries the fetch
        return;
      }
      const a = new Audio(URL.createObjectURL(blob));
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      a.onerror = () => {
        setPlaying(false);
        setFailed(true);
        audioRef.current = null; // decode failure — refetch on next tap
      };
      audioRef.current = a;
    }
    // only claim "playing" when playback actually starts (autoplay policy)
    audioRef.current
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        setFailed(true);
      });
  }

  const dur = m.dur ?? Math.max(2, Math.round((m.text.split(/\s+/).length / 2.6) * 1));
  const mm = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`;
  const canPlay = m.from === "her" || localClips.has(m.id);

  return (
    <div className="vnote" onClick={(e) => e.stopPropagation()}>
      <button className="vplay" onClick={toggle} disabled={!canPlay || loading} aria-label={playing ? "Pause" : "Play"}>
        {loading ? (
          <span className="vspin" />
        ) : playing ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="4" width="5" height="16" rx="1.5" />
            <rect x="14" y="4" width="5" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11-7.2c.6-.4.6-1.4 0-1.8l-11-7.2c-.7-.4-1.6.1-1.6.9Z" />
          </svg>
        )}
      </button>
      <div className="vwave">
        {wave.current.map((h, i) => (
          <i
            key={i}
            style={{ height: h, opacity: i / wave.current.length <= progress ? 1 : 0.45 }}
          />
        ))}
      </div>
      <span className="vdur">{failed ? "tap to retry" : mm}</span>
    </div>
  );
}
