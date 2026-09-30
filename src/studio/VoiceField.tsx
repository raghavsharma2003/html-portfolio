import { memo, useMemo } from "react";
import { useReducedMotion } from "framer-motion";

const RAY_COUNT = 96;

type VoiceFieldProps = {
  active?: boolean;
  calm?: boolean;
  history?: number[];
  level?: number;
};

function bounded(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function quietContour(index: number) {
  const primary = (Math.sin(index * 1.37) + 1) * 0.5;
  const secondary = (Math.sin(index * 0.41 + 1.2) + 1) * 0.5;
  return 0.1 + primary * 0.055 + secondary * 0.035;
}

function VoiceField({ active = false, calm = false, history, level = 0.08 }: VoiceFieldProps) {
  const reduceMotion = Boolean(useReducedMotion());
  const rays = useMemo(() => Array.from({ length: RAY_COUNT }, (_, index) => {
    const sourceIndex = history?.length
      ? Math.min(history.length - 1, Math.floor((index / RAY_COUNT) * history.length))
      : -1;
    const measured = sourceIndex >= 0 ? bounded(history?.[sourceIndex] ?? 0) : bounded(level);
    const energy = active && !reduceMotion
      ? Math.max(0.08, Math.sqrt(Math.max(measured, level * 0.22)))
      : calm
        ? quietContour(index) * 0.72
        : quietContour(index);
    const innerRadius = 29.4;
    const rayLength = 4.2 + energy * 15.8;
    return {
      angle: index * (360 / RAY_COUNT),
      opacity: active && !reduceMotion ? 0.42 + energy * 0.58 : calm ? 0.28 : 0.42,
      y1: 50 - innerRadius,
      y2: 50 - innerRadius - rayLength,
      spectral: index % 11 === 0 || index % 17 === 0,
    };
  }), [active, calm, history, level, reduceMotion]);

  return (
    <div className={`vx-voice-field${active && !reduceMotion ? " is-live" : ""}${calm || reduceMotion ? " is-calm" : ""}`} aria-hidden="true">
      <span className="vx-voice-field__caustic" />
      <span className="vx-voice-field__plate">
        <svg className="vx-voice-field__dial" viewBox="0 0 100 100" focusable="false">
          <circle className="vx-voice-field__outer" cx="50" cy="50" r="47" />
          <circle className="vx-voice-field__track" cx="50" cy="50" r="42.7" />
          <circle className="vx-voice-field__track is-inner" cx="50" cy="50" r="29.2" />
          <g className="vx-voice-field__rays">
            {rays.map((ray, index) => (
              <line
                className={ray.spectral ? "is-spectral" : undefined}
                key={index}
                x1="50"
                x2="50"
                y1={ray.y1}
                y2={ray.y2}
                opacity={ray.opacity}
                transform={`rotate(${ray.angle} 50 50)`}
              />
            ))}
          </g>
          <g className="vx-voice-field__ticks">
            {Array.from({ length: 48 }, (_, index) => (
              <line
                key={index}
                x1="50"
                x2="50"
                y1={index % 12 === 0 ? "4.7" : "5.4"}
                y2="7.3"
                transform={`rotate(${index * 7.5} 50 50)`}
              />
            ))}
          </g>
          <circle className="vx-voice-field__lens" cx="50" cy="50" r="24.2" />
          <circle className="vx-voice-field__core-line" cx="50" cy="50" r="20.8" />
        </svg>
      </span>
      <span className="vx-voice-field__axis is-top" />
      <span className="vx-voice-field__axis is-bottom" />
    </div>
  );
}

export default memo(VoiceField);
