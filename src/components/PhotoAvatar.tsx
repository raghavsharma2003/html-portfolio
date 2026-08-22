// Meera's real presence — a photographic avatar with subtle life: breathing
// and a slow drift. No cartoon animation, and no speaking loop: on a call
// the Presence wrapper drives her scale from real amplitude.
// (The face is AI-generated — a person who doesn't exist — so it can
// ship without impersonating anyone real.)
//
// Styles live in global.css. They used to be a <style> tag inside this
// component, which injected a duplicate stylesheet per mounted instance.

import meeraPhoto400 from "../assets/meera-400.jpg";
import meeraPhoto128 from "../assets/meera-128.jpg";

interface Props {
  size?: number;
  speaking?: boolean;
  listening?: boolean;
  /** full-bleed video-call treatment instead of a circle */
  cover?: boolean;
}

// The 900x900 source is only ever needed at the largest sizes this component
// is asked to paint at; everywhere smaller, a downscaled variant is plenty
// (audit docs/audit/2026-08-22-ui-perf.md, finding #6).
function variantFor(size: number): string {
  return size <= 128 ? meeraPhoto128 : meeraPhoto400;
}

export default function PhotoAvatar({ size = 280, speaking = false, listening = false, cover = false }: Props) {
  if (cover) {
    const src = variantFor(size);
    return (
      <div className={`pa-cover ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}>
        <img className="pa-bgfill" src={src} alt="" draggable={false} decoding="async" />
        <img className="pa-feed" src={src} alt="" draggable={false} decoding="async" />
        <div className="pa-vignette" />
      </div>
    );
  }
  return (
    <div
      className={`pa-circle ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}
      style={{ width: size, height: size }}
    >
      <img src={variantFor(size)} alt="" draggable={false} width={size} height={size} decoding="async" />
    </div>
  );
}
