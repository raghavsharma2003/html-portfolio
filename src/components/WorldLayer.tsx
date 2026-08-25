// THE WORLD — the atmospheric ground under home, both call screens, and (next)
// onboarding and the story surface.
//
// docs/DESIGN-WORLD.md §1-2. STAGE 2: the owner's five painted skies are the
// ground now, swapped in through the one variable stage 1 reserved for them
// (`--world-img`, from `sky.ts`'s `img` field). The layered CSS sky, the CSS
// starfield, the real-phase crescent and the drawn Indian skyline are all
// still here and all still correct — they are the FALLBACK.
//
// ── THE ANTI-FIGHT RULE, which is this file's law ────────────────────────
//
// `context/decisions.md#sky-is-the-clock` wrote its own reversal condition:
// "the paintings arrive and the procedural layer fights them — then procedural
// becomes the fallback, never both at once."
//
// They fight. Every painting has a moon in it, stars in it, clouds in it and a
// city along its bottom edge; the procedural set drawn on top of that is a
// second moon in the same sky and a flat black skyline standing in front of a
// painted one. So:
//
//   painted   → the painting, the scrim, and the new drifting cloud plates.
//               NO procedural stars, NO procedural moon, NO procedural cloud
//               blobs, NO city silhouette — not hidden with CSS, NOT RENDERED.
//               "Exactly zero procedural moon nodes" is a thing the browser
//               battery can count, and `display: none` is not countable.
//   unpainted → the complete stage-1 sky, unchanged, exactly as gated.
//
// Never both, and never neither: `.world-sky`'s four-stop gradient is under
// everything in every case, so the failure mode of a 404 is a plainer sky
// rather than a black rectangle. The check is a real load of the real file
// (see `usePainting`) rather than a build-time assumption, because the one
// thing that must not happen is the celestials being withheld from a sky that
// then never arrives.
//
// The cloud PLATES are the deliberate exception and the reason is the opposite
// of the rule: they duplicate nothing in the stills (they are the owner's own
// loose cloud PNGs, painted in the same palette) and they add the one thing a
// still cannot have. They are the only procedural element that survives a
// painting.
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
import { skyNow, imgPath, tokensFor, NIGHT_ROOM_STATE, type SkyFrame } from "../engine/sky";
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

// ── does this state's painting actually exist? ────────────────────────────
//
// The whole anti-fight rule hangs off this one boolean, so it is answered by
// LOADING THE FILE, never by assuming the token table is honest about the
// filesystem. A wrong `true` is a sky with no moon, no stars and no city — the
// blank the direction doc forbids by name.
//
// Optimistic, and deliberately: it starts `true`, so the first paint shows the
// gradient with the painting arriving over it and no celestial ever flashes in
// and vanishes. A failure demotes to `false` and the full procedural sky
// appears. The reverse default (start procedural, promote on load) shows every
// user a moon that disappears a beat later, on every cold start, forever.
//
// Answers are cached per URL at module scope so crossing a boundary five times
// a day, or remounting between home and a call, re-decides nothing.
const paintCache = new Map<string, boolean>();

function useOrientationWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(orientation: landscape)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(orientation: landscape)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * True while the painting at `src` is believed loadable. The crop matters:
 * `world.css` picks the wide file in landscape, so probing the portrait one
 * there would answer a question nobody asked.
 */
export function usePainting(src: string): boolean {
  const [ok, setOk] = useState<boolean>(() => (src ? (paintCache.get(src) ?? true) : false));
  useEffect(() => {
    if (!src) {
      setOk(false);
      return;
    }
    const cached = paintCache.get(src);
    if (cached !== undefined) {
      setOk(cached);
      return;
    }
    let live = true;
    const im = new Image();
    const settle = (v: boolean) => {
      paintCache.set(src, v);
      if (live) setOk(v);
    };
    im.onload = () => settle(im.naturalWidth > 0);
    im.onerror = () => settle(false);
    im.src = src;
    // A cached image can be complete before the handlers are attached, in
    // which case neither ever fires and the flag would sit on its optimistic
    // default forever — right by luck rather than by measurement.
    if (im.complete) settle(im.naturalWidth > 0);
    return () => {
      live = false;
      im.onload = null;
      im.onerror = null;
    };
  }, [src]);
  return ok;
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

/** The night room's tokens, resolved once at module scope. It is a constant by
 *  construction — `NIGHT_ROOM_STATE` is a fixed state, not a clock reading —
 *  and resolving it here rather than per render is what makes that visible. */
const NIGHT = tokensFor(NIGHT_ROOM_STATE);

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
    // The SAME veil over a painting instead of a gradient, and on the two
    // light states it is a much heavier number — solved for, not chosen, from
    // the shipped jpg's own pixels (see sky.ts and check-contrast.mjs). It is
    // a separate variable rather than a replacement so a 404 does not also
    // cost the fallback its tuning: the gradient never needed this much veil
    // and putting it there would fog stage 1 to pay for stage 2's problem.
    "--world-scrim-a-painted": String(t.scrimAlphaPainted),
    "--world-ink": t.ink,
    "--world-accent": t.accent,
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
    // STAGE 2 SWAP POINT — live. Both crops are published and `world.css`
    // chooses between them with an orientation media query, so rotating a
    // tablet swaps the painting without a React render.
    "--world-img": t.img || "none",
    "--world-img-wide": t.imgWide || t.img || "none",
    // THE THREAD'S WALLPAPER, both themes' worth. Emitted together rather
    // than resolved here because the choice between them is the THEME's, and
    // the theme lives in a `data-theme` attribute plus a media query — a
    // React component that tried to resolve it would be a third copy of the
    // rule global.css already states twice, and it would be the copy that
    // does not update when the OS flips at sunset with the app open.
    // `world.css` picks with the same selector pair global.css uses.
    "--wall-scrim-light": t.wallScrimLight,
    "--wall-a-light": String(t.wallAlphaLight),
    // `wallScrimDark`/`wallAlphaDark` are deliberately NOT emitted any more.
    // The dark palette's thread is the night room now (world.css, flavour 2),
    // so nothing in the app would read them and a variable nothing reads is a
    // dead writer waiting to be "tuned" by someone expecting the screen to
    // change. They are still live in the TABLE, for the landing: site/ has no
    // theme switch, so its dark states are the only surface still painting
    // that veil, and the landing half of check-contrast.mjs measures it there.
    // …and the same veil for the person who chose SKY rather than a palette,
    // which is a CURVE rather than a number (see the long note in sky.ts: a
    // flat veil pays the city's price over the sky, and the sky is the whole
    // subject of the mode). Emitted alongside rather than instead, for the
    // reason the pair above is emitted in both flavours: the choice between
    // them belongs to a root attribute (`data-sky-choice`, stamped by
    // applyTheme) and to a selector, and a component that resolved it here
    // would be a copy of that rule that does not update when the clock crosses
    // dusk with the app open.
    "--wall-scrim-sky": t.wallScrimSky,
    "--wall-a-sky-top": String(t.wallSkyTop),
    "--wall-a-sky-mid": String(t.wallSkyMid),
    "--wall-a-sky-bot": String(t.wallSkyBot),
    "--wall-sky-s": `${(t.wallSkyS * 100).toFixed(1)}%`,
    "--wall-sky-e": `${(t.wallSkyE * 100).toFixed(1)}%`,

    // ── THE NIGHT ROOM, CONSTANT (sky.ts NIGHT_ROOM_STATE) ────────────────
    //
    // In the dark palette the thread's wallpaper is the NIGHT painting at the
    // night curve, whatever the real hour is — the owner's decision, and the
    // reasoning is in sky.ts. These are the night state's own fields, emitted
    // on every frame regardless of what the clock says, because the surface
    // that consumes them is chosen by a SELECTOR and not by this component.
    //
    // That split is deliberate and it is the constraint the brief set: the
    // dark palette is reachable two ways — `data-theme="dark"` and a
    // `prefers-color-scheme` media query with no attribute at all — so no
    // component can resolve it without becoming a third copy of a rule that
    // stops updating when the OS flips at sunset. React emits the values; CSS
    // picks. `--night-img` is a separate variable from `--world-img` for the
    // most boring reason there is: `--world-img` is written HERE, as an inline
    // style, and an inline custom property cannot be overridden by any
    // stylesheet rule. So the wallpaper's paint layer reads `--wall-img`, and
    // the selector sets that to one of these two.
    "--night-img": NIGHT.img || "none",
    "--night-img-wide": NIGHT.imgWide || NIGHT.img || "none",
    "--night-flat": NIGHT.stops[0],
    "--night-scrim": NIGHT.wallScrimSky,
    "--night-a-top": String(NIGHT.wallSkyTop),
    "--night-a-mid": String(NIGHT.wallSkyMid),
    "--night-a-bot": String(NIGHT.wallSkyBot),
    "--night-s": `${(NIGHT.wallSkyS * 100).toFixed(1)}%`,
    "--night-e": `${(NIGHT.wallSkyE * 100).toFixed(1)}%`,
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
   *
   * `band` is the top slice only, for a translucent header that shows the
   * sky through it — the one way the world was allowed to reach the thread
   * under DESIGN-WORLD §3 ("the chat stays legible-first"), and as of Phase
   * 3.2 it finally has a call site: `.chat-head`.
   *
   * `wallpaper` is the thread's ground (Phase 3.1). It is deliberately the
   * SMALLEST variant, and that is its definition rather than an optimisation:
   *
   *   A WALLPAPER IS STILL.
   *
   * Nothing in it twinkles, drifts, rises or breathes. The full world is a
   * place you look AT; the thread is a place you read IN, and every moving
   * thing behind a paragraph is a thing competing with the paragraph. So the
   * three layers that carry the picture — gradient, painting, veil — are all
   * it renders, and the celestials, the plates, the glow and the city are not
   * hidden here, they are NOT RENDERED, for the same countability reason the
   * anti-fight rule gives above.
   *
   * It is also why the wallpaper costs the windowed thread nothing: three
   * static layers in a `position: absolute` sibling OUTSIDE the scroll
   * container means the scroller moves and this does not, so a row entering
   * the viewport can never dirty it.
   */
  variant?: "full" | "band" | "wallpaper";
}

export default function WorldLayer({ frame, variant = "full" }: Props) {
  const t = frame.tokens;
  const still = variant === "wallpaper";
  const wide = useOrientationWide();
  // The crop the stylesheet is actually going to ask for, so the probe and the
  // paint agree by construction rather than by both happening to be right.
  const src = imgPath(wide ? t.imgWide || t.img : t.img);
  const painted = usePainting(src);
  return (
    <div
      className="world"
      data-sky={frame.state}
      data-variant={variant}
      // THE ANTI-FIGHT FLAG. Read by world.css (which veil alpha, whether the
      // plates drift) and asserted by the browser battery, which counts
      // procedural moon nodes and expects exactly zero beside it.
      data-painted={painted ? "true" : "false"}
      aria-hidden="true"
    >
      {/* 1. the sky itself, plus the NEXT sky cross-fading in over it during
             a transition window. Two stacked gradients rather than
             interpolated stops, because a browser cannot interpolate a
             four-stop gradient and faking it in JS would put a colour
             calculation on a paint path.

             It stays under the painting in BOTH cases. That is what makes a
             404 a plainer sky instead of a black rectangle, and it is why the
             fallback needs no "blank sky" special case anywhere. */}
      <div className="world-sky" />
      <div className="world-sky world-sky-next" />
      {/* 2. STAGE 2, live: the owner's painting, full bleed, portrait or wide
             by orientation. */}
      <div className="world-paint" />
      {/* 3. the horizon glow. The half of a sky a vertical gradient cannot
             say: light does not arrive from directly above. Procedural-only —
             a painted sky already has its own light source and a second one
             laid over it is the same fight as a second moon. */}
      {!painted && !still && <div className="world-glow" />}

      {/* ── the procedural celestials: FALLBACK ONLY ───────────────────────
          Not `display: none` when painted — not rendered. The rule the
          battery checks is "exactly zero procedural moon nodes over a
          painting", and a hidden node is still a node. */}
      {!painted && !still && t.stars.count > 0 && (
        <div className="world-stars">
          <i className="ws-a" style={{ boxShadow: STARS_A }} />
          <i className="ws-b" style={{ boxShadow: STARS_B }} />
          <i className="ws-c" style={{ boxShadow: STARS_C }} />
        </div>
      )}

      {!painted && !still && t.moon.visible && (
        <div className="world-moon">
          <i />
        </div>
      )}

      {!painted && !still && (
        <div className="world-clouds">
          <i className="wc-1" />
          <i className="wc-2" />
          <i className="wc-3" />
        </div>
      )}

      {/* ── the plates: the one thing that survives a painting ─────────────
          The owner's two loose cloud PNGs, painted in the same palette as the
          skies, drifting on long unequal periods at two different rates so
          the pair reads as depth rather than as a texture sliding past. They
          duplicate nothing in the stills — the stills' own clouds are fixed
          in the paint — and they are the only reason a still sky is not a
          wallpaper. Transform only, 150s and 210s, hidden under reduced
          motion (a slow parallax is exactly the thing that setting is for).

          `band` never gets them: a cloud crossing a 38px header strip is an
          artefact, which is the same reason the procedural blobs were already
          excluded from that variant. */}
      {painted && variant === "full" && (
        <div className="world-plates">
          <i className="wp-a" />
          <i className="wp-b" />
        </div>
      )}

      {!painted && variant === "full" && <CitySkyline />}

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
