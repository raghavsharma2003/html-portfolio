// THE SKY IS THE CLOCK — the world layer's only source of time.
//
// docs/DESIGN-WORLD.md §1: one painted world, five time states, driven by the
// REAL clock. This file is that clock's TABLE, and nothing else in the app is
// allowed to have an opinion about what time of day it is on screen.
//
// ── one clock, not a second one ──────────────────────────────────────────
//
// Every hour in this file comes from `istParts()` in timeline.ts — the same
// function T9's `renderAway`, `herNow` and `hisClock` trust. That is not a
// convenience import, it is the whole design: a world that says "night" while
// her day-shape block says "at the desk, standup done" is two clocks
// disagreeing in front of the user, and the failure is silent because each
// half looks right on its own. There is no `Date().getHours()` in this file
// and there must never be one.
//
// India has one time zone and has never observed DST, so `IST_OFFSET_MIN` is
// a definition rather than an approximation (timeline.ts states the same
// thing, at more length, and it is why this file is deterministic enough to
// pin in an eval).
//
// ── why THESE boundaries ─────────────────────────────────────────────────
//
// Bangalore sits at 12.97°N. That latitude is the entire justification for a
// FIXED table: across a whole year sunrise moves only between ~05:55 and
// ~06:30 and sunset between ~17:50 and ~18:50 — a swing of about 35 minutes,
// which is smaller than the 20-minute cross-fade on each side of a boundary
// plus the eye's own tolerance. A solar-position calculation would buy less
// accuracy than the transition window already absorbs, and would cost this
// file its purity and its determinism. If the product ever ships a second
// city at a real latitude, THAT is the evidence that reverses this: swap the
// table for a solar term, keep the state names.
//
//   night    19:40 → 04:30   (wraps midnight)
//   predawn  04:30 → 06:10
//   morning  06:10 → 16:20   the long daylight block
//   golden   16:20 → 18:10
//   dusk     18:10 → 19:40
//
// `morning` covers the whole flat daylight middle of the day, which is longer
// than the word suggests. That is deliberate and it is a SKY fact, not a
// day-part name: between mid-morning and mid-afternoon the sky does not
// change in any way a person notices, and inventing a sixth "midday" state
// would be a state nobody could tell apart from this one. The five names are
// the direction doc's five names.
//
// ── the invariant that ties this to away.ts ──────────────────────────────
//
// `away.ts` owns THE OTHER night window: NIGHT_START_HOUR=1 → NIGHT_END_HOUR=6,
// the hours whose crossing makes a gap "overnight". Those two windows answer
// different questions (what the sky looks like vs. whether he plausibly
// slept) and they must not be merged — but they must not CONTRADICT either.
// The binding rule, asserted by `evals/sky.mjs`:
//
//   every minute inside away.ts's night window resolves to a DARK sky state.
//
// So 01:00–06:00 lands in `night` ∪ `predawn` and never in a light one. A
// world that renders a bright morning sky at 05:00 while the prompt is being
// told the gap "covered the night" is the disagreement described above.
//
// ── the painting swap point (docs/DESIGN-WORLD.md, asset contract) ───────
//
// Stage 1 (today) is fully procedural. Stage 2 swaps in the owner's painted
// skies through ONE variable per state — `img` here becomes `--world-img` on
// the world root, and `world.css` already paints that layer over the
// gradient. Every `img` is "" today and the layer renders nothing; filling
// them in is a data change with no code change, which is the entire point of
// putting them in this table rather than in the stylesheet.

import { istParts } from "./timeline";

export type SkyState = "night" | "predawn" | "morning" | "golden" | "dusk";

/** Canonical order — dark through the small hours, round to dark again. */
export const SKY_STATES: readonly SkyState[] = ["night", "predawn", "morning", "golden", "dusk"];

/** Minutes of cross-fade on the LEADING side of every boundary. A state's
 *  tokens are authoritative for its whole span; this window is only how long
 *  the NEXT state's sky takes to bleed in over it, and it is why the fixed
 *  table above is accurate enough (the sun's own yearly drift is smaller). */
export const SKY_TRANSITION_MIN = 20;

const MIN_DAY = 1440;

/** Boundary table: the minute-of-day at which each state BEGINS, ascending
 *  from the first boundary after midnight. `night` is the wrap-around state
 *  and therefore owns everything before the first entry and after the last. */
interface Boundary {
  at: number;
  state: SkyState;
}
const BOUNDARIES: readonly Boundary[] = Object.freeze([
  { at: 4 * 60 + 30, state: "predawn" }, // 04:30
  { at: 6 * 60 + 10, state: "morning" }, // 06:10
  { at: 16 * 60 + 20, state: "golden" }, // 16:20
  { at: 18 * 60 + 10, state: "dusk" }, // 18:10
  { at: 19 * 60 + 40, state: "night" }, // 19:40
]);

/** Exported so the eval can pin every boundary to the minute rather than
 *  re-deriving them (a table re-derived by its own test tests nothing). */
export const SKY_BOUNDARIES = BOUNDARIES;

/** Star field, moon, cloud tint, city ink and the scrim that carries text.
 *  Flat values on purpose: `scripts/check-contrast.mjs` composites them, and
 *  a token it cannot parse is a floor it cannot hold. */
export interface SkyTokens {
  state: SkyState;
  /** which of the app's two palettes this sky belongs to — the "sky" theme
   *  mode resolves through exactly this field and nothing else */
  mode: "light" | "dark";
  /** 4 stops, top to bottom. The gradient is built from these in world.css
   *  via --sky-1..--sky-4, and the contrast gate composites the scrim over
   *  EVERY one of them rather than over an average that exists nowhere. */
  stops: readonly [string, string, string, string];
  /** a horizon glow blooming from the low third — the half of a real sky
   *  that a top-to-bottom gradient alone cannot say */
  glow: { color: string; alpha: number; x: number; y: number; size: number };
  stars: { count: number; opacity: number; twinkle: boolean };
  moon: { visible: boolean; opacity: number; color: string };
  cloud: { color: string; alpha: number };
  city: { ink: string; lit: string; litAlpha: number };
  /** the text carrier. `ink`/`inkDim` are what text over the sky is painted
   *  in; `scrim`+`scrimAlpha` is the veil laid under it. Together they are
   *  the only reason text on this surface is legible, so together they are
   *  what the gate measures. */
  scrim: string;
  scrimAlpha: number;
  ink: string;
  inkDim: string;
  /**
   * A floating control's fill (glass over sky) and its own alpha.
   *
   * IT GOES THE SAME WAY THE SKY DOES: dark glass on a dark sky, light glass
   * on a light one. That is the opposite of the first version, which used a
   * light glass on every sky so the FILL itself could carry 3:1 against the
   * ground — and it was wrong in a way the browser battery made obvious the
   * moment it rendered: a light card on a noon sky is a mid-grey slab, and
   * the state's own dark ink sat on it at 4.2:1. Text lives INSIDE controls,
   * so a control fill chosen to contrast with the sky is a control fill
   * chosen against the thing that does not sit on it.
   *
   * So the split is now the standard one: the fill carries the TEXT, and the
   * EDGE carries the component's discernibility. Both are gated
   * (`scripts/check-contrast.mjs`), which is what stops either half quietly
   * absorbing the other's job.
   */
  control: string;
  controlAlpha: number;
  /** the control's hairline, and what makes a glass panel findable against a
   *  sky it deliberately does not contrast with. Gated at >= 3:1 against the
   *  scrimmed sky in every state. */
  edge: string;
  edgeAlpha: number;
  /** STAGE 2. The painted sky for this state, as a CSS `url(...)`, or "" for
   *  the procedural-only build that ships today. See the header. */
  img: string;
}

/**
 * The five skies.
 *
 * Studied against the competitor's two good frames (a flat indigo night and
 * a rose dusk) and deliberately built one layer deeper than either: every
 * state carries a horizon GLOW that is a different hue from its zenith,
 * because that hue split is what a real sky has and a two-stop gradient does
 * not. Night is not one indigo — it is near-black at the zenith, indigo
 * through the middle, and a warm sodium-orange smear where a city meets it,
 * which is what the sky over an Indian city actually looks like at 11pm.
 */
const TOKENS: Record<SkyState, SkyTokens> = Object.freeze({
  // Deep, and warm at the bottom: the city's own sodium light bouncing off
  // the haze. The competitor's night is a single flat royal blue; the thing
  // it is missing is exactly this — a night sky is darkest overhead.
  night: Object.freeze({
    state: "night",
    mode: "dark",
    stops: ["#080a18", "#131a35", "#1e2751", "#2b2f52"] as const,
    glow: { color: "#c96a3c", alpha: 0.3, x: 50, y: 100, size: 78 },
    stars: { count: 140, opacity: 0.92, twinkle: true },
    moon: { visible: true, opacity: 0.96, color: "#fdf6e3" },
    cloud: { color: "#2f3a68", alpha: 0.5 },
    city: { ink: "#05070f", lit: "#ffca7a", litAlpha: 0.85 },
    scrim: "#05070f",
    scrimAlpha: 0.34,
    ink: "#f6f2ee",
    inkDim: "#c8c2d4",
    control: "#070a1a",
    controlAlpha: 0.55,
    edge: "#ffffff",
    edgeAlpha: 0.5,
    img: "",
  }),

  // The blue hour before sunrise: cold at the top, a thin cyan band, and the
  // first apricot at the horizon. Stars thin out rather than vanish, which is
  // what makes it read as pre-dawn and not as evening.
  predawn: Object.freeze({
    state: "predawn",
    mode: "dark",
    stops: ["#141a38", "#26305e", "#4a5586", "#8d7f96"] as const,
    glow: { color: "#f0a06a", alpha: 0.36, x: 50, y: 102, size: 70 },
    stars: { count: 52, opacity: 0.5, twinkle: true },
    moon: { visible: true, opacity: 0.62, color: "#f7f2ea" },
    cloud: { color: "#5a5f8c", alpha: 0.46 },
    city: { ink: "#0c0f1c", lit: "#ffd79a", litAlpha: 0.6 },
    scrim: "#0b0e1e",
    scrimAlpha: 0.36,
    ink: "#f7f3ef",
    inkDim: "#ded9e4",
    control: "#0b0e1e",
    controlAlpha: 0.55,
    edge: "#ffffff",
    edgeAlpha: 0.62,
    img: "",
  }),

  // Full daylight. Warm rather than the default sky-blue — the app's ground
  // is warm paper (global.css) and a cool cyan sky over it would read as a
  // second product. Haze at the horizon, because Bangalore has haze.
  morning: Object.freeze({
    state: "morning",
    mode: "light",
    stops: ["#7fb2e0", "#a8cdea", "#d6e4ef", "#f3e6d8"] as const,
    glow: { color: "#ffe7c2", alpha: 0.55, x: 50, y: 100, size: 72 },
    stars: { count: 0, opacity: 0, twinkle: false },
    moon: { visible: false, opacity: 0, color: "#ffffff" },
    cloud: { color: "#ffffff", alpha: 0.72 },
    city: { ink: "#7d8aa0", lit: "#ffffff", litAlpha: 0.12 },
    // A light sky needs a DARK scrim under light text or a LIGHT scrim under
    // dark text, and this one takes the second: the day palette's own ink on
    // a warm veil, which is what keeps the home screen feeling like paper at
    // noon instead of like a photo with a gradient on it.
    scrim: "#fbf7f2",
    scrimAlpha: 0.34,
    ink: "#1c1714",
    inkDim: "#4b423d",
    control: "#fffaf4",
    controlAlpha: 0.62,
    edge: "#1c1714",
    edgeAlpha: 0.7,
    img: "",
  }),

  // Golden hour. The one state where the horizon is BRIGHTER than the zenith
  // by a long way, which is the whole look; the top has to stay blue or the
  // screen turns into an orange wash.
  golden: Object.freeze({
    state: "golden",
    mode: "light",
    stops: ["#5f93cc", "#9fbede", "#f2c98c", "#f7a862"] as const,
    glow: { color: "#ffd08a", alpha: 0.62, x: 50, y: 101, size: 76 },
    stars: { count: 0, opacity: 0, twinkle: false },
    moon: { visible: false, opacity: 0, color: "#ffffff" },
    cloud: { color: "#ffd9b0", alpha: 0.66 },
    city: { ink: "#6f5a58", lit: "#fff1cf", litAlpha: 0.28 },
    scrim: "#fdf6ec",
    scrimAlpha: 0.34,
    ink: "#20160f",
    inkDim: "#4c3b2d",
    control: "#fffaf4",
    controlAlpha: 0.62,
    edge: "#20160f",
    edgeAlpha: 0.7,
    img: "",
  }),

  // Dusk. The competitor's best frame is its rose dusk, so this is the one
  // that had to be beaten rather than matched: rose alone is a poster, and
  // the thing that makes a real dusk is the VIOLET wedge sitting between the
  // last blue and the last rose. That third hue is the difference.
  dusk: Object.freeze({
    state: "dusk",
    mode: "dark",
    stops: ["#1b2450", "#4a3a72", "#96547e", "#d9755f"] as const,
    glow: { color: "#ff9a5c", alpha: 0.45, x: 50, y: 102, size: 74 },
    stars: { count: 34, opacity: 0.42, twinkle: true },
    moon: { visible: true, opacity: 0.5, color: "#fff6e8" },
    cloud: { color: "#7b5b7e", alpha: 0.55 },
    city: { ink: "#181322", lit: "#ffc178", litAlpha: 0.66 },
    scrim: "#150f22",
    scrimAlpha: 0.44,
    ink: "#f8f1ee",
    inkDim: "#e0d5db",
    control: "#150f22",
    controlAlpha: 0.55,
    edge: "#ffffff",
    edgeAlpha: 0.62,
    img: "",
  }),
});

/** The whole table, for the eval and for the contrast gate. */
export const SKY_TOKENS = TOKENS;

export function tokensFor(state: SkyState): SkyTokens {
  return TOKENS[state];
}

// ─────────────────────────────────────────────────────────────────────────
// The resolution
// ─────────────────────────────────────────────────────────────────────────

/** Which sky owns this Bangalore minute-of-day. Total by construction:
 *  `night` is the wrap state and answers everything before the first
 *  boundary and on/after the last. */
export function stateAtMinute(minuteOfDay: number): SkyState {
  const m = ((Math.floor(minuteOfDay) % MIN_DAY) + MIN_DAY) % MIN_DAY;
  let cur: SkyState = "night";
  for (const b of BOUNDARIES) {
    if (m >= b.at) cur = b.state;
    else break;
  }
  return cur;
}

/** The next boundary strictly after this minute, in minutes-of-day, allowed
 *  to run past 1440 so the wrap-around night is one number rather than a
 *  special case at every call site. */
export function nextBoundaryAfter(minuteOfDay: number): number {
  const m = ((Math.floor(minuteOfDay) % MIN_DAY) + MIN_DAY) % MIN_DAY;
  for (const b of BOUNDARIES) if (b.at > m) return b.at;
  // past the last boundary: night runs to the first boundary of tomorrow
  return MIN_DAY + BOUNDARIES[0].at;
}

export interface SkyFrame {
  state: SkyState;
  tokens: SkyTokens;
  /** the state this one is turning into */
  next: SkyState;
  nextTokens: SkyTokens;
  /** 0 outside the transition window, rising to 1 at the boundary itself.
   *  The world layer cross-fades `nextTokens`' sky in at this opacity, which
   *  is why a boundary is a horizon changing colour rather than a cut. */
  blend: number;
  /** Bangalore minute-of-day this frame was resolved from — the CAUSE, kept
   *  on the frame the way timeline.ts keeps its stamp, so a screenshot can
   *  be traced back to a clock rather than argued about. */
  minuteOfDay: number;
  /** ms until the state changes. The theme watcher schedules on this instead
   *  of polling, so a phone left open at 19:39 is a dusk that becomes night
   *  by itself. */
  msToNext: number;
  moonPhase: MoonPhase;
}

/** The frame for a wall-clock instant. Pure: same input, same output, on
 *  every device, forever. */
export function skyAt(nowMs: number): SkyFrame {
  const t = istParts(nowMs);
  const m = t.minuteOfDay;
  const state = stateAtMinute(m);
  const endMin = nextBoundaryAfter(m);
  const nextState = stateAtMinute(endMin % MIN_DAY);
  const toEnd = endMin - m;
  const blend =
    toEnd <= SKY_TRANSITION_MIN ? clamp01((SKY_TRANSITION_MIN - toEnd) / SKY_TRANSITION_MIN) : 0;
  // IST is a whole-minute offset, so the milliseconds inside the current
  // minute are the same in Bangalore as they are in UTC. Subtracting them is
  // what makes a boundary land ON the minute instead of up to 59s late.
  const msIntoMinute = ((nowMs % 60_000) + 60_000) % 60_000;
  return {
    state,
    tokens: TOKENS[state],
    next: nextState,
    nextTokens: TOKENS[nextState],
    blend,
    minuteOfDay: m,
    msToNext: Math.max(1_000, toEnd * 60_000 - msIntoMinute),
    moonPhase: moonPhaseAt(nowMs),
  };
}

/** Which palette the "sky" theme mode resolves to right now. One field, one
 *  lookup — a second rule here (say, "dark after 8pm") would be a third clock. */
export function skyMode(nowMs: number): "light" | "dark" {
  return TOKENS[stateAtMinute(istParts(nowMs).minuteOfDay)].mode;
}

// ─────────────────────────────────────────────────────────────────────────
// The moon, because a moon that is always full is a sticker
// ─────────────────────────────────────────────────────────────────────────

export interface MoonPhase {
  /** 0 = new, 0.5 = full, → 1 = new again */
  fraction: number;
  /** fraction of the disc that is lit, 0..1 */
  lit: number;
  /**
   * How far the crescent's mask bite is offset from the disc's centre, as a
   * percentage of the disc's WIDTH.
   *
   * The mask is a circle the same size as the moon, punched out of it. At 0
   * the bite sits dead centre and nothing is left; at 100 it has slid a full
   * diameter away and the disc is whole. Everything in between is a phase.
   * `world.css` gets `50% ± offset` as the mask's centre and needs no maths
   * of its own.
   */
  offset: number;
  /** Waxing moons are lit on the right in the northern hemisphere, so the
   *  bite goes left; waning is the mirror. -1 or 1. */
  side: -1 | 1;
  /** an honest label, used for the world layer's aria description */
  label: string;
}

/** Synodic month. The reference is the new moon of 2000-01-06 18:14 UTC,
 *  which is the epoch every almanac uses; the mean synodic period is good to
 *  a few hours over a human lifetime, and a few hours of moon phase is not a
 *  visible error on a 34px CSS crescent. */
const SYNODIC_MS = 29.530588853 * 86_400_000;
const NEW_MOON_EPOCH = 947_182_440_000;

export function moonPhaseAt(nowMs: number): MoonPhase {
  const raw = ((nowMs - NEW_MOON_EPOCH) % SYNODIC_MS + SYNODIC_MS) % SYNODIC_MS;
  const fraction = raw / SYNODIC_MS;
  // Illuminated fraction of the disc, 0 at new and 1 at full.
  const lit = (1 - Math.cos(fraction * 2 * Math.PI)) / 2;
  // NEVER a fully new moon. An invisible celestial body is indistinguishable
  // from a bug — someone would open the app on the wrong night, find no moon
  // in a sky that has one every other night, and file it. The crescent floors
  // at a thin sliver, which is a two-day-old moon and is honest enough for a
  // 46px ornament.
  const shown = 0.08 + lit * 0.92;
  return {
    fraction,
    lit,
    offset: shown * 100,
    side: fraction < 0.5 ? -1 : 1,
    label: labelFor(fraction, lit),
  };
}

function labelFor(fraction: number, lit: number): string {
  const waxing = fraction < 0.5;
  if (lit > 0.96) return "full moon";
  if (lit < 0.04) return "new moon";
  if (lit > 0.46 && lit < 0.54) return waxing ? "first quarter moon" : "last quarter moon";
  if (lit > 0.54) return waxing ? "waxing gibbous moon" : "waning gibbous moon";
  return waxing ? "waxing crescent moon" : "waning crescent moon";
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ─────────────────────────────────────────────────────────────────────────
// The test seam
// ─────────────────────────────────────────────────────────────────────────
//
// Same shape and same reason as `configureClock()` in clock.ts: the five sky
// states are verified by SIMULATING time, never by waiting for it, and a
// screenshot battery that waited for 04:30 IST would be a battery nobody
// runs. Production never calls this — App.tsx calls it only when an explicit
// `?sky=` parameter is present, which is a thing no shipped link contains.
//
// It is deliberately NOT a second clock: it moves the ONE clock, so
// everything downstream (including `istParts`) sees the same instant.

let nowFn: () => number = () => Date.now();

export function configureSky(opts: { now?: () => number }): void {
  if (opts.now) nowFn = opts.now;
}

/** The frame for "now", whatever the seam says now is. */
export function skyNow(): SkyFrame {
  return skyAt(nowFn());
}

/** Test-only: put the clock back. */
export function __resetSkyForTest(): void {
  nowFn = () => Date.now();
}

/**
 * A `?sky=` value to a wall-clock instant, or null.
 *
 * Accepts a STATE NAME ("dusk") or an IST time ("04:45"). A state name
 * resolves to the middle of that state's span, which is the frame a
 * screenshot wants: away from both transition windows, so the picture is of
 * the state itself rather than of a cross-fade. Exported (rather than parsed
 * at the call site) so the browser battery and the app agree by construction.
 */
export function parseSkySeed(value: string | null | undefined, base = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(v);
  let minute: number | null = null;
  if (hm) {
    const h = Number(hm[1]);
    const mm = Number(hm[2]);
    if (h > 23 || mm > 59) return null;
    minute = h * 60 + mm;
  } else if ((SKY_STATES as readonly string[]).includes(v)) {
    minute = midpointOf(v as SkyState);
  }
  if (minute === null) return null;
  // Bangalore-midnight of the day `base` falls in, plus the minute asked for.
  const shifted = base + 330 * 60_000;
  const midnight = Math.floor(shifted / 86_400_000) * 86_400_000 - 330 * 60_000;
  return midnight + minute * 60_000;
}

/** The middle of a state's span, in minutes. `night` wraps, so it is measured
 *  across midnight and folded back into the day. */
export function midpointOf(state: SkyState): number {
  if (state === "night") {
    const start = BOUNDARIES[BOUNDARIES.length - 1].at; // 19:40
    const end = BOUNDARIES[0].at + MIN_DAY; // 04:30 tomorrow
    return Math.floor((start + end) / 2) % MIN_DAY;
  }
  const i = BOUNDARIES.findIndex((b) => b.state === state);
  const start = BOUNDARIES[i].at;
  const end = i + 1 < BOUNDARIES.length ? BOUNDARIES[i + 1].at : MIN_DAY;
  return Math.floor((start + end) / 2);
}
