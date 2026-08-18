"use client";

/**
 * figure-shared.tsx — support module for the three research figures
 * (FigJudgeCeiling, FigOrderEvacuation, FigEnglishControl).
 *
 * Not one of the three deliverable figures itself — a small, portable kit so
 * the three components don't triple the same scroll-reveal / SVG-primitive
 * code. Drop this file in alongside the figures; nothing else here reads
 * global site state, so it works standalone (e.g. in a test harness) and
 * inside the real site with no changes.
 *
 * Design-language reference: src/components/turn-diagram.tsx (rounded card,
 * border-hairline, bg-surface, eyebrow-style mono captions) and
 * docs/website-research/brand/BRAND.md §2–3 (tokens, motion, breakpoints).
 * Site is light-only (color-scheme: light) — every color below is a
 * var(--c-*) token with a literal light-mode fallback, never a bare hex.
 */

import {
  type ReactNode,
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// ── tokens (BRAND.md §2.1 / §2.2 — fallbacks only; real values come from the
// host page's CSS custom properties) ────────────────────────────────────────
export const INK = "var(--c-bone, #0c0e0d)"; // primary text / primary data ink
export const ASH = "var(--c-ash, #50524f)"; // secondary text
export const SLATE = "var(--c-slate, #666862)"; // muted / tertiary, ticks, captions
export const HAIRLINE = "var(--c-hairline, #d7d7d0)"; // gridlines, panel borders
export const SURFACE = "var(--c-surface, #fff)"; // card background
export const EMBER = "var(--c-ember, #c83f2d)"; // the one accent — used sparingly,
// reserved for the single reference every reader must clear (the pre-registered
// bar) and for the two points the paper calls out as landing exactly on the
// degenerate prediction. Everything else stays grayscale-safe, matching the
// paper figures' own colorblind/print-safe convention (assets-manifest.md).

export const FONT_MONO =
  "var(--font-mono), ui-monospace, 'SF Mono', monospace";
export const FONT_SANS =
  "var(--font-sans), ui-sans-serif, system-ui, sans-serif";

export const EASE = "var(--ease-out-quint, cubic-bezier(.23,1,.32,1))";

// ── formatting (matches docs/paper/figures/_svgkit.mjs pct/pp helpers, so a
// reviewer can diff a rendered label against the source generator) ──────────
export const pctStr = (x: number, d = 1) => `${x.toFixed(d)}%`;
export const ppStr = (x: number, d = 1) =>
  `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}pp`;

// ── linear scale factory, identical contract to _svgkit.mjs's `scale` ───────
export const scaleLinear =
  (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
    r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

// ── reduced motion ───────────────────────────────────────────────────────────
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// ── self-contained scroll reveal ─────────────────────────────────────────────
// Mirrors src/components/reveal.tsx's IntersectionObserver contract (fires
// once, rootMargin pulled in slightly, honors reduced motion) but owns its
// own observer so the component reveals correctly even when dropped
// somewhere the site's global [data-reveal] pass isn't mounted (a test
// harness, Storybook, this task's own screenshot pass). If the site's global
// observer also touches this node later, it's an idempotent class add — no
// conflict.
export function useSelfReveal<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  revealed: boolean;
} {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setRevealed(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  return { ref, revealed };
}

// ── narrow-container hook (the mobile strategy switch) ───────────────────────
// Watches the figure's own box, not the viewport — a figure embedded in a
// narrower column should get the mobile layout even on a wide screen.
// Threshold matches the brief's 390px target with headroom for the card's
// own padding.
export function useNarrow<T extends HTMLElement>(
  breakpoint = 520,
): { ref: RefObject<T | null>; narrow: boolean } {
  const ref = useRef<T | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setNarrow(el.getBoundingClientRect().width < breakpoint);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setNarrow(entry.contentRect.width < breakpoint);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [breakpoint]);

  return { ref, narrow };
}

// ── the card chrome every figure shares (mirrors turn-diagram.tsx) ──────────
export function FigureShell({
  children,
  caption,
  revealIndex = 0,
  revealed,
  outerRef,
  ariaHidden = false,
  className = "",
}: {
  children: ReactNode;
  caption: ReactNode;
  revealIndex?: number;
  revealed: boolean;
  outerRef: RefObject<HTMLElement | null>;
  ariaHidden?: boolean;
  className?: string;
}) {
  return (
    <figure
      ref={outerRef as RefObject<HTMLElement>}
      data-reveal={revealIndex}
      aria-hidden={ariaHidden}
      className={[
        "not-prose rounded-[var(--radius-lg,0.5rem)] border border-hairline bg-surface p-5 sm:p-8",
        "transition-[opacity,transform] duration-[var(--duration-reveal,760ms)]",
        revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-[22px]",
        className,
      ].join(" ")}
      style={{ transitionTimingFunction: EASE }}
    >
      {children}
      <figcaption className="mt-6 border-t border-hairline pt-4 text-micro leading-relaxed text-slate">
        {caption}
      </figcaption>
    </figure>
  );
}

// ── visually-hidden (Tailwind's sr-only pattern, spelled out so this file has
// no dependency on Tailwind being present at all) ────────────────────────────
export const srOnlyStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <div style={srOnlyStyle}>{children}</div>;
}

// ── SVG text primitive: routes through the right family per the brief
// (Geist Mono for numeric/axis labels, Geist for prose labels) ──────────────
export function SvgText({
  x,
  y,
  children,
  size = 11,
  weight = 400,
  anchor = "start",
  fill = INK,
  mono = true,
  opacity = 1,
  italic = false,
  className,
  dataAnim,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  fill?: string;
  mono?: boolean;
  opacity?: number;
  italic?: boolean;
  className?: string;
  dataAnim?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      fontFamily={mono ? FONT_MONO : FONT_SANS}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      fill={fill}
      opacity={opacity}
      fontStyle={italic ? "italic" : "normal"}
      className={className}
      data-anim={dataAnim}
    >
      {children}
    </text>
  );
}

// ── a stable, per-instance id prefix for <pattern>/<title>/<desc> ids, so two
// copies of the same figure on one page never collide ───────────────────────
export function useFigureId(prefix: string): string {
  const id = useId().replace(/:/g, "");
  return `${prefix}-${id}`;
}

// ── hatch pattern def: the paper's own visual vocabulary for "not a real
// quantity of interest" (chance bands, noise floors, CI hatching) — carried
// over from docs/paper/figures/_svgkit.mjs `defs()` ──────────────────────────
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width={6}
        height={6}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
      >
        <rect width={6} height={6} fill={SURFACE} />
        <line x1={0} y1={0} x2={0} y2={6} stroke={HAIRLINE} strokeWidth={2.5} />
      </pattern>
    </defs>
  );
}
