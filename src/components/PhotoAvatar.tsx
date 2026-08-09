// Meera's real presence — a photographic avatar with subtle life:
// breathing, slow drift, a soft speaking glow. No cartoon animation.
// (The face is AI-generated — a person who doesn't exist — so it can
// ship without impersonating anyone real.)

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
        <style>{paCss}</style>
      </div>
    );
  }
  return (
    <div
      className={`pa-circle ${speaking ? "speaking" : ""} ${listening ? "listening" : ""}`}
      style={{ width: size, height: size }}
    >
      <img src={meeraPhoto} alt="" draggable={false} />
      <style>{paCss}</style>
    </div>
  );
}

const paCss = `
.pa-circle {
  position: relative;
  border-radius: 50%;
  overflow: hidden;
  background: #1a0f22;
}
.pa-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  animation: pa-breathe 5.2s ease-in-out infinite;
  transform-origin: 50% 40%;
}
.pa-circle.speaking img {
  animation: pa-speak 0.9s ease-in-out infinite;
}
.pa-cover {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0b0710;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pa-cover .pa-bgfill {
  position: absolute;
  inset: -10%;
  width: 120%;
  height: 120%;
  object-fit: cover;
  filter: blur(46px) brightness(0.5) saturate(1.1);
}
.pa-cover .pa-feed {
  position: relative;
  width: 100%;
  max-height: 78%;
  object-fit: contain;
  display: block;
  animation: pa-drift 16s ease-in-out infinite alternate;
  transform-origin: 50% 40%;
}
.pa-cover.speaking .pa-feed {
  animation: pa-drift 16s ease-in-out infinite alternate, pa-speak-soft 1.1s ease-in-out infinite;
}
.pa-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(11, 7, 16, 0.55) 100%),
    linear-gradient(to bottom, rgba(11, 7, 16, 0.35), transparent 22%, transparent 68%, rgba(11, 7, 16, 0.6));
}
@keyframes pa-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.018); }
}
@keyframes pa-drift {
  0% { transform: scale(1.0) translate(0.3%, 0); }
  100% { transform: scale(1.035) translate(-0.4%, -0.5%); }
}
@keyframes pa-speak {
  0%, 100% { transform: scale(1.01); }
  50% { transform: scale(1.028); }
}
@keyframes pa-speak-soft {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.05); }
}
`;
