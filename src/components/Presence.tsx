// Her presence on a call. Not chrome around a face — breath, and rings that
// move with a real voice (hers or yours), read straight off the audio graph.
//
// The rAF loop writes transforms on the elements directly: driving them from
// a CSS var on the parent would recalc styles for every child every frame.

import { useEffect, useRef } from "react";
import { readLevel } from "../voice/level";

export type Phase = "idle" | "listening" | "hearing" | "thinking" | "speaking";

export default function Presence({
  phase,
  size = 244,
  children,
}: {
  phase: Phase;
  size?: number;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase; // the rAF reads the ref, never re-subscribes

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const face = el.querySelector<HTMLElement>(".pr-face");
    const rings = Array.from(el.querySelectorAll<HTMLElement>(".pr-ring"));
    if (!face) return;
    const lag = [0, 0, 0]; // per-ring follower state
    const t0 = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      const p = phaseRef.current;

      // resting respiration ~0.21Hz, plus a detuned partial so the waveform
      // never exactly repeats — the difference between animated and alive
      const breath = Math.sin(t * 1.32) * 0.55 + Math.sin(t * 0.47) * 0.45;

      // only one direction is ever live, so only one analyser is read
      const voice =
        p === "speaking" ? readLevel("her") : p === "hearing" ? readLevel("you") : 0;

      const gather = p === "thinking" ? -0.01 : 0; // attention turning inward
      const restAmp = p === "thinking" ? 0.004 : 0.007;

      face.style.transform = `scale(${(1 + breath * restAmp + voice * 0.03 + gather).toFixed(4)})`;

      rings.forEach((r, i) => {
        const k = 0.3 - i * 0.09; // outer rings trail further
        lag[i] += (voice - lag[i]) * k;
        const spread = 1 + lag[i] * (0.14 + i * 0.07) + breath * 0.006 + gather * (i + 1);
        const alpha = (p === "idle" ? 0.1 : 0.17) + lag[i] * 0.5;
        r.style.transform = `scale(${spread.toFixed(4)})`;
        r.style.opacity = Math.min(0.8, alpha).toFixed(3);
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="presence" data-phase={phase} ref={root} style={{ width: size, height: size }}>
      <i className="pr-ring" />
      <i className="pr-ring" />
      <i className="pr-ring" />
      <div className="pr-face">{children}</div>
    </div>
  );
}
