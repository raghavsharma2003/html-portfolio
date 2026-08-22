// THE WORLD — the atmospheric ground under home, both call screens, and (next)
// onboarding and the story surface.
//
// docs/DESIGN-WORLD.md §1-2. Everything here is PROCEDURAL: a layered CSS sky,
// a CSS starfield, a CSS crescent whose phase is the real one, three blurred
// cloud blobs, and a city silhouette drawn as inline SVG. No image asset
// exists yet and none is required — stage 1 has to stand on its own, and the
// bar it has to clear is a competitor whose whole shell is one painted PNG.
//
// The paintings arrive later and swap in through ONE variable per state
// (`--world-img`, from `sky.ts`'s `img` field, empty today). `.world-paint`
// below already paints that layer over the gradient at full bleed, so stage 2
// is a data change in the token table and nothing else.
//
// ── the rules this file is built against ─────────────────────────────────
//
//  * NOTHING HERE ANIMATES LAYOUT. Every moving thing moves on `transform` or
//    `opacity`, which is also what `scripts/check-motion.mjs` enforces and
//    what the browser battery asserts by measuring element boxes before and
//    after a drift cycle. A sky that reflowed the home screen twice a minute
//    would be a beautiful jank generator.
//  * REDUCED MOTION IS STILL, NEVER BLANK. The direction is explicit about
//    this and it is the failure people actually ship: `animation: none` on a
//    keyframe that fades in from 0 leaves an invisible element. Every ambient
//    animation here is authored so its RESTING state is the visible one, and
//    the reduced-motion block only stops the clock.
//  * IT IS DECORATION, SO IT IS `aria-hidden`. A screen reader does not want
//    a hundred and forty stars. The one thing worth announcing — what time of
//    day the world is showing — rides on the surfaces themselves.

import { useEffect, useState } from "react";
import { skyNow, type SkyFrame } from "../engine/sky";
import "../styles/world.css";

/**
 * The current sky, kept current.
 *
 * Scheduled off `msToNext` rather than polled, for the same reason
 * `watchSky` in theme.ts is: five events a day do not need 1,440 wake-ups.
 * Capped at 30 minutes a hop so a frozen WebView (backgrounded phone, timers
 * suspended) cannot sit on a stale sky for hours after it wakes.
 */
export function useSky(): SkyFrame {
  const [frame, setFrame] = useState<SkyFrame>(() => skyNow());
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (!live) return;
      const f = skyNow();
      setFrame(f);
      // Inside a transition window the sky is actively cross-fading, so it is
      // re-read every minute; outside one it sleeps until the boundary.
      const wait = f.blend > 0 ? 60_000 : Math.min(f.msToNext, 30 * 60_000);
      timer = setTimeout(arm, Math.max(1_000, wait));
    };
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      arm();
    };
    document.addEventListener("visibilitychange", onVis);
    arm();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return frame;
}

/**
 * The per-state variables, as a style object.
 *
 * Applied to the SURFACE root (`.home`, `.call`, `.incoming`) rather than to
 * the world element, because CSS custom properties inherit downward and the
 * things that need `--world-ink` — a name, a state line, a floating control —
 * are siblings of the sky, not children of it. Every surface therefore does
 * the same two things: spread these onto its own root, and render `<WorldLayer>`
 * as its first child.
 */
/** "#1b2450" -> "27,36,80".
 *
 *  Emitted ALONGSIDE the hexes because `rgba(var(--x-rgb), var(--x-a))` works
 *  in every WebView this app ships to, and `color-mix(… calc(var(--a) *
 *  100%) …)` does not. A glass panel that silently renders opaque on an older
 *  Android is not a degradation, it is a black rectangle over the world. */
function rgbOf(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "255,255,255";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function skyVars(frame: SkyFrame): React.CSSProperties {
  const t = frame.tokens;
  const n = frame.nextTokens;
  const mp = frame.moonPhase;
  return {
    "--sky-1": t.stops[0],
    "--sky-2": t.stops[1],
    "--sky-3": t.stops[2],
    "--sky-4": t.stops[3],
    "--sky-n1": n.stops[0],
    "--sky-n2": n.stops[1],
    "--sky-n3": n.stops[2],
    "--sky-n4": n.stops[3],
    "--sky-blend": String(frame.blend),
    "--glow-c": t.glow.color,
    "--glow-a": String(t.glow.alpha),
    "--glow-x": `${t.glow.x}%`,
    "--glow-y": `${t.glow.y}%`,
    "--glow-size": `${t.glow.size}%`,
    "--star-op": String(t.stars.opacity),
    "--moon-op": String(t.moon.visible ? t.moon.opacity : 0),
    "--moon-c": t.moon.color,
    // The bite that makes a crescent: a circle the size of the moon, punched
    // out of it, offset sideways. `side` flips which way it opens, so a
    // waxing moon and a waning one are mirror images — the half of moon
    // phase people notice without being able to say why.
    "--moon-cut": `${50 + mp.side * mp.offset}%`,
    "--cloud-c": t.cloud.color,
    "--cloud-a": String(t.cloud.alpha),
    "--city-ink": t.city.ink,
    "--city-lit": t.city.lit,
    "--city-lit-a": String(t.city.litAlpha),
    "--world-scrim": t.scrim,
    "--world-scrim-rgb": rgbOf(t.scrim),
    "--world-scrim-a": String(t.scrimAlpha),
    "--world-ink": t.ink,
    "--world-ink-rgb": rgbOf(t.ink),
    "--world-ink-dim": t.inkDim,
    "--world-control": t.control,
    "--world-control-rgb": rgbOf(t.control),
    "--world-control-a": String(t.controlAlpha),
    // Which palette this sky belongs to, exposed so a surface can branch on
    // it without re-deriving the time of day.
    "--world-mode": t.mode,
    // THE PANEL'S BOUNDARY, and it is not decoration: the glass fill
    // deliberately goes the same way the sky does (dark on dark, light on
    // light) so it can carry TEXT, which means it cannot also carry the
    // component's discernibility. The edge does that, and
    // `scripts/check-contrast.mjs` holds it at >= 3:1 against the scrimmed
    // sky in all five states. A hand-picked "white at 20%" is what was here
    // first, and it is invisible at noon.
    "--world-edge": `rgba(${rgbOf(t.edge)}, ${t.edgeAlpha})`,
    // Glass is TOP-LIT: a panel whose fill is flat reads as a rectangle of
    // paint, and one that is a hair brighter along its top edge reads as a
    // pane with a light source somewhere. The gradient only ever goes UP from
    // the gated alpha, never below it, so the number the contrast gate proves
    // stays the floor for every pixel of the panel.
    "--world-glass": `linear-gradient(to bottom, rgba(${rgbOf(t.control)}, ${Math.min(
      1,
      t.controlAlpha + 0.07,
    ).toFixed(3)}), rgba(${rgbOf(t.control)}, ${t.controlAlpha}))`,
    // STAGE 2 SWAP POINT. `none` today; a `url(...)` when the paintings land,
    // and nothing else in the app changes.
    "--world-img": t.img || "none",
  } as React.CSSProperties;
}

// ── the starfield ─────────────────────────────────────────────────────────
//
// `box-shadow` rather than 140 DOM nodes or a canvas: one element, one paint,
// no layout, no rAF, and it composites. Positions come from a fixed LCG so
// the sky is the SAME sky on every device and in every screenshot — a random
// field would make the browser battery's images differ run to run and turn a
// visual diff into noise.
//
// Three layers, not one, so the twinkle can be desynchronised by giving each
// layer its own period. Twinkle is opacity on the LAYER, never on the stars:
// 140 individually animated shadows is 140 animations.
function starShadows(seed: number, n: number, w: number, h: number): string {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * w);
    // Squared distribution: stars crowd the top of the frame and thin out
    // toward the horizon, which is what haze does to a real sky and what a
    // uniform sprinkle never looks like.
    const y = Math.round(rnd() ** 1.7 * h);
    const a = (0.35 + rnd() * 0.65).toFixed(2);
    out.push(`${x}px ${y}px 0 rgba(255,255,255,${a})`);
  }
  return out.join(", ");
}

const STAR_W = 440;
const STAR_H = 720;
const STARS_A = starShadows(0x51ee, 74, STAR_W, STAR_H);
const STARS_B = starShadows(0x9a13, 48, STAR_W, STAR_H);
const STARS_C = starShadows(0x2f70, 22, STAR_W, STAR_H);

interface Props {
  frame: SkyFrame;
  /**
   * `full` is the whole world: sky, stars, moon, clouds, city.
   * `band` is the top slice only, for a translucent header that shows the
   * sky through it — the one way the world is allowed to reach the thread
   * (DESIGN-WORLD §3, "the chat stays legible-first").
   */
  variant?: "full" | "band";
}

export default function WorldLayer({ frame, variant = "full" }: Props) {
  const t = frame.tokens;
  return (
    <div className="world" data-sky={frame.state} data-variant={variant} aria-hidden="true">
      {/* 1. the sky itself, plus the NEXT sky cross-fading in over it during
             a transition window. Two stacked gradients rather than
             interpolated stops, because a browser cannot interpolate a
             four-stop gradient and faking it in JS would put a colour
             calculation on a paint path. */}
      <div className="world-sky" />
      <div className="world-sky world-sky-next" />
      {/* 2. STAGE 2. Empty today (`--world-img: none`), full-bleed when the
             paintings land. It sits above the gradient and below every
             celestial, so the procedural stars and moon keep floating OVER
             the painting exactly as the direction describes. */}
      <div className="world-paint" />
      {/* 3. the horizon glow. The half of a sky a vertical gradient cannot
             say: light does not arrive from directly above. */}
      <div className="world-glow" />

      {t.stars.count > 0 && (
        <div className="world-stars">
          <i className="ws-a" style={{ boxShadow: STARS_A }} />
          <i className="ws-b" style={{ boxShadow: STARS_B }} />
          <i className="ws-c" style={{ boxShadow: STARS_C }} />
        </div>
      )}

      {t.moon.visible && (
        <div className="world-moon">
          <i />
        </div>
      )}

      <div className="world-clouds">
        <i className="wc-1" />
        <i className="wc-2" />
        <i className="wc-3" />
      </div>

      {variant === "full" && <CitySkyline />}

      {/* the text carrier. Bottom-weighted, because that is where the
          floating content sits, and every ratio in
          `scripts/check-contrast.mjs` is computed against exactly this
          composite: scrim at its own alpha over each of the four sky stops. */}
      <div className="world-scrim" />
    </div>
  );
}

/**
 * An Indian skyline, drawn rather than photographed.
 *
 * The details that make it read as HERE rather than as generic-city clip art
 * are all small and all deliberate: black plastic water tanks on short legs on
 * almost every roof, parapet walls, a forest of little antennas, mismatched
 * block heights with no setbacks, and one cable-stayed bridge over a low
 * river band. A generic skyline is a row of glass towers, and this has none.
 *
 * `preserveAspectRatio="xMidYMax slice"` so the baseline stays pinned to the
 * bottom of whatever it is stretched across and the tanks never squash.
 */
function CitySkyline() {
  return (
    <div className="world-city">
      <svg viewBox="0 0 390 140" preserveAspectRatio="xMidYMax slice" role="presentation">
        {/* the river, and the light lying on it */}
        <rect className="wr-water" x="0" y="120" width="390" height="20" />
        <g className="wr-shimmer">
          <rect x="28" y="126" width="34" height="1.4" rx="0.7" />
          <rect x="96" y="131" width="52" height="1.4" rx="0.7" />
          <rect x="188" y="124" width="28" height="1.4" rx="0.7" />
          <rect x="236" y="133" width="66" height="1.4" rx="0.7" />
          <rect x="318" y="128" width="40" height="1.4" rx="0.7" />
        </g>

        {/* the far bank: low, hazy, no detail. Depth is a value change, not a
            blur filter — a filter on a full-width element is a paint cost the
            home screen pays on every scroll. */}
        <g className="wr-far">
          <path d="M0 120V104h14v-9h11v9h18v-14h13v14h22v-7h16v7h26v-18h12v18h20v-11h15v11h24v-16h13v16h21v-8h17v8h26v-13h12v13h20v-10h14v10h26v-15h12v15h18v120z" />
        </g>

        {/* the bridge — one span, two pylons, stays. It is the single object
            in the frame with a recognisable silhouette, which is what stops
            the band reading as a texture. */}
        <g className="wr-bridge">
          <rect x="112" y="114" width="148" height="3.4" />
          <rect x="146" y="86" width="3" height="31" />
          <rect x="224" y="86" width="3" height="31" />
          <g className="wr-stay">
            <path d="M147.5 88 118 114M147.5 88l29 26M147.5 92l-20 22M147.5 92l20 22" />
            <path d="M225.5 88 196 114M225.5 88l29 26M225.5 92l-20 22M225.5 92l20 22" />
          </g>
          <g className="wr-lamp">
            <circle cx="147.5" cy="84.6" r="1.5" />
            <circle cx="225.5" cy="84.6" r="1.5" />
          </g>
        </g>

        {/* the near bank: the blocks you can see the windows in */}
        <g className="wr-near">
          <path d="M0 120V78h30v42zM34 120V60h26v60zM64 120V92h34v28zM102 120V52h24v68zM130 120V84h20v36zM258 120V66h28v54zM290 120V88h22v32zM316 120V56h26v64zM346 120V90h20v30zM370 120V72h20v48z" />
        </g>

        {/* water tanks and their legs. The one detail that makes an Indian
            rooftop an Indian rooftop. */}
        <g className="wr-tank">
          <rect x="40" y="50" width="12" height="7" rx="2" />
          <rect x="41.5" y="57" width="1.4" height="3" />
          <rect x="48.6" y="57" width="1.4" height="3" />
          <rect x="107" y="42" width="12" height="7" rx="2" />
          <rect x="108.5" y="49" width="1.4" height="3" />
          <rect x="115.6" y="49" width="1.4" height="3" />
          <rect x="264" y="56" width="12" height="7" rx="2" />
          <rect x="265.5" y="63" width="1.4" height="3" />
          <rect x="272.6" y="63" width="1.4" height="3" />
          <rect x="322" y="46" width="12" height="7" rx="2" />
          <rect x="323.5" y="53" width="1.4" height="3" />
          <rect x="330.6" y="53" width="1.4" height="3" />
        </g>

        {/* antennas and a dish or two */}
        <g className="wr-mast">
          <path d="M20 78v-9M22.6 71.5h-5.2M74 92v-7M296 88v-8M298.4 82h-4.8M356 90v-6M378 72v-11M380.6 63.6h-5.2" />
        </g>

        {/* the lit windows. Deliberately sparse and deliberately irregular:
            a full grid reads as a spreadsheet, and every real block has three
            people awake in it at 1am. */}
        <g className="wr-lit">
          <rect x="6" y="86" width="3" height="4.6" />
          <rect x="14" y="86" width="3" height="4.6" />
          <rect x="6" y="98" width="3" height="4.6" />
          <rect x="22" y="104" width="3" height="4.6" />
          <rect x="40" y="70" width="3" height="4.6" />
          <rect x="48" y="70" width="3" height="4.6" />
          <rect x="40" y="82" width="3" height="4.6" />
          <rect x="52" y="94" width="3" height="4.6" />
          <rect x="70" y="100" width="3" height="4.6" />
          <rect x="86" y="100" width="3" height="4.6" />
          <rect x="78" y="110" width="3" height="4.6" />
          <rect x="108" y="62" width="3" height="4.6" />
          <rect x="118" y="62" width="3" height="4.6" />
          <rect x="108" y="76" width="3" height="4.6" />
          <rect x="118" y="90" width="3" height="4.6" />
          <rect x="136" y="94" width="3" height="4.6" />
          <rect x="264" y="76" width="3" height="4.6" />
          <rect x="274" y="76" width="3" height="4.6" />
          <rect x="264" y="90" width="3" height="4.6" />
          <rect x="296" y="98" width="3" height="4.6" />
          <rect x="322" y="66" width="3" height="4.6" />
          <rect x="332" y="66" width="3" height="4.6" />
          <rect x="322" y="80" width="3" height="4.6" />
          <rect x="334" y="96" width="3" height="4.6" />
          <rect x="352" y="100" width="3" height="4.6" />
          <rect x="376" y="82" width="3" height="4.6" />
          <rect x="384" y="96" width="3" height="4.6" />
        </g>
      </svg>
    </div>
  );
}
