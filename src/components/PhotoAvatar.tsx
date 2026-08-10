// Meera's real presence — a photographic avatar with subtle life: breathing
// and a slow drift. No cartoon animation, and no speaking loop: on a call
// the Presence wrapper drives her scale from real amplitude.
// (The face is AI-generated — a person who doesn't exist — so it can
// ship without impersonating anyone real.)
//
// Styles live in global.css. They used to be a <style> tag inside this
// component, which injected a duplicate stylesheet per mounted instance.

import meeraPhoto from "../assets/meera.jpg";

interface Props {
  size?: number;
  speaking?: boolean;
  listening?: boolean;
  /** full-bleed video-call treatment instead of a circle */
  cover?: boolean;
}

export default function PhotoAvatar({ size = 280, speaking = false, listening = false, cover = false }: Props) {
  if (cover) {
    return (
      <div className={`pa-cover ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}>
        <img className="pa-bgfill" src={meeraPhoto} alt="" draggable={false} />
        <img className="pa-feed" src={meeraPhoto} alt="" draggable={false} />
        <div className="pa-vignette" />
      </div>
    );
  }
  return (
    <div
      className={`pa-circle ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}
      style={{ width: size, height: size }}
    >
      <img src={meeraPhoto} alt="" draggable={false} />
    </div>
  );
}
