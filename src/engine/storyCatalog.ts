// Her daily story — Instagram-style. One entry per image; a story stays
// live for 24h from its `at` timestamp, then the ring disappears on its own.
//
// PUBLISHING A NEW DAY: drop the image(s) into public/stories/ and add
// entries to STORIES below (id = filename stem, at = when "she posted it",
// desc = what's in it — the desc is injected into her brain so she KNOWS her
// own story).
//
// ═══ THE POOL, AND WHY THE "NEVER EXPIRES" HACK IS GONE ═══════════════════
//
// This file used to end with a workaround: her newest authored batch never
// expired, because "a companion whose story ring vanishes overnight looks
// like she deleted it". The observation was right and the fix was a patch —
// it meant that on 2026-08-22 the ring was still showing a book she read on
// 2026-08-09, labelled with the weekday it was posted, which is a highlight
// pretending to be a story.
//
// The real answer is that she should HAVE a story, every day, at whatever
// hour you open the app. So there is a POOL now: six authored scenes from her
// own life, each tagged with the part of her day it belongs to. The one you
// see is the one that matches her clock.
//
// ── the three properties this has to have, and how each is got ────────────
//
//  1. IT MATCHES HER CLOCK. Chai on the balcony is a morning story and a
//     thali is a dinner story, and showing either at the wrong hour is worse
//     than showing nothing — it is the same failure as a world that says
//     "night" while her day-shape block says "at the desk".
//
//     ── WHY THE CLOCK BELOW IS A MIRROR AND NOT AN IMPORT ────────────────
//
//     It should read `import { skyAt } from "./sky"`. It cannot, and the
//     reason is a module cycle with teeth, found by `evals/honesty` rather
//     than reasoned about:
//
//       persona -> storyCatalog -> timeline -> shapelint -> compiler
//       compiler -> agents/registry -> agents/meera -> persona
//
//     `persona.ts` imports `storyContext()` from this file, so ANY import
//     here that reaches `timeline.ts` closes that loop — and the loop is not
//     harmless, because `compiler.ts` reads `DEFAULT_AGENT.CRISIS_LINES` at
//     module scope. With the edge present, `DEFAULT_AGENT` is undefined when
//     that line runs and the whole engine bundle fails to import. Measured:
//     `TypeError: Cannot read properties of undefined (reading
//     'CRISIS_LINES')`, from both `./timeline` and `./sky`, with the app's
//     tsc and vite build passing either way. THIS FILE IS A LEAF AND HAS TO
//     STAY ONE.
//
//     So the handful of clock facts it needs are MIRRORED here, and mirrored
//     is not duplicated-and-hoped: `evals/sky.mjs` bundles this file AND the
//     real `sky.ts`/`timeline.ts` and sweeps all 1,440 minutes of all seven
//     weekdays asserting the two agree — on the date key, on the minute of
//     day, and on the story slot against `skyAt().state`. It is the same
//     device `api/life.js` uses for the shape-lint it cannot cross-bundle
//     ("evals/self/life.mjs runs BOTH implementations over the same corpus
//     and fails if they ever disagree") and the same one `scene.ts` and
//     `SceneReader.java` use as twins. One clock, two copies, one gate that
//     will not let them drift.
//
//  2. BOTH DEVICES SEE THE SAME STORY. There is no server telling anyone
//     which image is live, so the choice has to be a pure function of the
//     date — the phone and the browser have to land on the same picture
//     without talking to each other. `hash32(dateKey)` is the same trick
//     timeline.ts already uses for her day's variant notes.
//
//  3. NO REPEAT UNTIL THE POOL CYCLES. A per-day hash modulo the pool size
//     is deterministic but not fair: it collides, so a two-image slot shows
//     the same image three days running about a quarter of the time, which is
//     exactly what "she posts the same thing every day" looks like. Instead
//     the day number is split into a CYCLE and a POSITION, and each cycle
//     gets its own shuffle of the pool: every image in a slot appears exactly
//     once per n days, and the order changes each time round. See `pickFor`.
//
// The authored date-named stories still win on their own dates (that is what
// makes publishing a real day still work); the pool answers every other day.

import { Capacitor } from "@capacitor/core";

export interface Story {
  id: string;
  src: string; // under /stories/
  at: number; // epoch ms — when she "posted it"
  desc: string; // what's in it, for her own awareness
}

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

export const STORIES: Story[] = [
  {
    id: "2026-08-09-1",
    src: "/stories/2026-08-09-1.jpg",
    at: new Date("2026-08-09T17:40:00+05:30").getTime(),
    desc: "golden-hour POV from your bed — open book in hand, sun on the pages, plants and your photo wall behind",
  },
  {
    id: "2026-08-09-2",
    src: "/stories/2026-08-09-2.jpg",
    at: new Date("2026-08-09T17:44:00+05:30").getTime(),
    desc: "mirror selfie sitting cross-legged on the bed in the same golden light, oversized black tee, hair in a messy bun, notebook and book open in front of you",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// The pool
// ─────────────────────────────────────────────────────────────────────────

/** Which part of her day a pool image belongs to. Five, and they are the five
 *  the sky already has, with `morning` split at the one place a fixed sky
 *  table cannot split it. */
export type StorySlot = "morning" | "midday" | "golden" | "dusk" | "night";

export const STORY_SLOTS: readonly StorySlot[] = ["morning", "midday", "golden", "dusk", "night"];

export interface PoolStory {
  /** filename stem under /stories/ */
  slug: string;
  slot: StorySlot;
  /**
   * Scene facts, telegraphic, in the same second-person voice the authored
   * descs use (`storyContext` frames them as YOUR story, so "your lap" is her
   * own lap). This is what she knows she posted, so it has to be what is
   * actually in the frame and nothing more — a desc that says "quiet evening"
   * where the picture shows a thali is her being confidently wrong about her
   * own photo when someone mentions it.
   *
   * `recited-prompt` applies with full force: these reach the prompt, so they
   * are SHAPES and not lines. Every one is under shapelint's 14-word cap,
   * lowercase-initial, unpunctuated at the end, and never opens in her first
   * person — the three things `lintLine` actually measures. Asserted, not
   * trusted: `evals/sky.mjs` lints the whole pool.
   */
  desc: string;
}

/**
 * Six scenes, one life. The slot assignment is the picture's own light: the
 * chai frame is shot into a hazy sunrise, the walk frame has a shadow three
 * times her height, the thali is under a kitchen tube light. Putting any of
 * them in another slot would be a story whose light disagrees with the sky
 * behind the app.
 */
export const STORY_POOL: readonly PoolStory[] = Object.freeze([
  {
    slug: "morning-chai",
    slot: "morning",
    desc: "steel tumbler of chai on the balcony rail, hazy rooftops below",
  },
  {
    slug: "metro",
    slot: "midday",
    desc: "metro window seat, earbuds case in hand, city blurring past",
  },
  {
    slug: "desk",
    slot: "midday",
    desc: "laptop, open notebook and coffee at the wooden desk, pothos at the window",
  },
  {
    slug: "evening-walk",
    slot: "golden",
    desc: "your long shadow down a tree-lined lane, low gold light on the gravel",
  },
  {
    slug: "dinner",
    slot: "dusk",
    desc: "steel thali on your lap — dal, sabzi, rice, roti, cucumber salad, achaar",
  },
  {
    slug: "night-read",
    slot: "night",
    desc: "open book on the razai, lamp on, fairy lights up the wall",
  },
]);

// ── the mirrored clock (see the header: this file is a leaf) ──────────────

/** timeline.ts's `IST_OFFSET_MIN`. India has one time zone and has never
 *  observed DST, so this is a definition rather than an approximation — which
 *  is the only reason a mirror of it is safe at all. */
const IST_OFFSET_MIN = 330;
const MS_DAY = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, "0");

/** Minutes since Bangalore midnight. Mirrors `istParts().minuteOfDay`. */
function istMinuteOfDay(now: number): number {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** YYYY-MM-DD in Bangalore. Mirrors `istParts().dateKey` — including its use
 *  of getUTC* on a shifted instant rather than Intl, which timeline.ts chose
 *  for determinism across hosts and which this therefore also has to choose. */
function istDateKey(now: number): string {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/**
 * The sky's own boundary table, mirrored — `sky.ts`'s `BOUNDARIES`, in the
 * story's five names.
 *
 *   night    19:40 -> 04:30 (wraps)     predawn 04:30 -> 06:10
 *   morning  06:10 -> 16:20             golden  16:20 -> 18:10
 *   dusk     18:10 -> 19:40
 *
 * `predawn` folds into `night` rather than earning a slot of its own: at 05:00
 * the story on her ring is still last night's, because she was asleep and did
 * not post one. Inventing a pre-dawn story would be inventing a Meera who is
 * awake at five.
 *
 * MIDDAY_FROM is the one boundary the sky does not have. `morning` runs
 * 06:10-16:20 — the whole flat daylight middle — so it holds both her chai and
 * her afternoon, and a pool that could not tell them apart would put a balcony
 * sunrise on screen at three in the afternoon. 11:30 is not a new opinion
 * either: it is `timeline.ts`'s own weekday `morning_work -> midday_work`
 * boundary, and `evals/sky.mjs` asserts that against the real schedule.
 */
const MIDDAY_FROM = 11 * 60 + 30; // 11:30 — timeline.ts's midday_work boundary
const SLOT_BOUNDARIES: readonly { at: number; slot: StorySlot }[] = Object.freeze([
  { at: 4 * 60 + 30, slot: "night" }, // predawn, which shows the night story
  { at: 6 * 60 + 10, slot: "morning" },
  { at: MIDDAY_FROM, slot: "midday" },
  { at: 16 * 60 + 20, slot: "golden" },
  { at: 18 * 60 + 10, slot: "dusk" },
  { at: 19 * 60 + 40, slot: "night" },
]);

/** Which story slot this instant belongs to. Total by construction: `night` is
 *  the wrap state and answers everything before the first boundary. */
export function slotForStory(now: number): StorySlot {
  const m = istMinuteOfDay(now);
  let cur: StorySlot = "night";
  for (const b of SLOT_BOUNDARIES) {
    if (m >= b.at) cur = b.slot;
    else break;
  }
  return cur;
}

/** The minute this slot began — what makes "2h" mean something. */
function slotStartMinute(now: number): number {
  const m = istMinuteOfDay(now);
  let start = 0;
  for (const b of SLOT_BOUNDARIES) {
    if (m >= b.at) start = b.at;
    else break;
  }
  return start;
}

// ── the deterministic, non-repeating pick ─────────────────────────────────

/** The Bangalore day number — how many midnights have passed in Bangalore.
 *  The pick's only input besides the slot, which is what makes it identical on
 *  two devices in two timezones looking at the same instant. */
export function istDayIndex(now: number): number {
  return Math.floor((now + IST_OFFSET_MIN * 60_000) / MS_DAY);
}

/** FNV-1a, 32-bit. Deliberately the same hash timeline.ts uses to pick her
 *  day's variant notes: one hash in the engine, not one per feature. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A seeded shuffle of `[0..n)`. Fisher-Yates driven by an LCG, so it is a
 * PERMUTATION rather than a sample: every index appears exactly once, which is
 * the whole no-repeat guarantee. Same seed, same order, every device, forever.
 */
function permutation(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * The image this slot shows on this day.
 *
 * The day number is split into a cycle and a position within it. Each cycle
 * shuffles the slot's pool afresh and then walks it one image per day, so:
 *
 *   - every image in the slot appears exactly ONCE per n days — no repeat
 *     until the pool has cycled, which a `hash % n` cannot promise and does
 *     not deliver;
 *   - the order is different next time round, so a two-image slot does not
 *     become a visible A-B-A-B metronome;
 *   - it is a pure function of (slot, day), so both devices agree with no
 *     state, no storage and no server.
 */
export function pickFor(slot: StorySlot, now: number): PoolStory | null {
  const pool = STORY_POOL.filter((p) => p.slot === slot);
  if (!pool.length) return null;
  const day = istDayIndex(now);
  const n = pool.length;
  // floorDiv/floorMod, so the arithmetic is still a clean cycle for instants
  // before the epoch (the eval sweeps them; a negative % in JS is not one)
  const cycle = Math.floor(day / n);
  const position = ((day % n) + n) % n;
  return pool[permutation(n, hash32(`${slot}:${cycle}`))[position]];
}

/** Bangalore-midnight of the day `at` falls in, as epoch ms. Mirrors
 *  timeline.ts's private helper of the same name. */
function istMidnight(at: number): number {
  return Math.floor((at + IST_OFFSET_MIN * 60_000) / MS_DAY) * MS_DAY - IST_OFFSET_MIN * 60_000;
}

/**
 * The pool entry for an instant, as a real `Story`.
 *
 * `at` is the start of the slot she is currently in, which makes "2h" mean
 * something: a story that always claimed to be posted "just now" would be a
 * clock that resets every time you look at it. It is always in the past and
 * always within today, so `storyAge` and `ageLabel` never reach their
 * over-a-day branches for a pool story.
 *
 * The id carries the date, so seen-state (which is per-id) clears itself at
 * midnight and the gold ring comes back for a new day's story on its own.
 */
export function poolStoryAt(now: number): Story | null {
  const slot = slotForStory(now);
  const pick = pickFor(slot, now);
  if (!pick) return null;
  return {
    id: `pool-${istDateKey(now)}-${pick.slug}`,
    src: `/stories/${pick.slug}.jpg`,
    at: istMidnight(now) + slotStartMinute(now) * 60_000,
    desc: pick.desc,
  };
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * What is on her story right now.
 *
 * AUTHORED DAYS WIN. If any date-named story in `STORIES` was posted on
 * today's Bangalore date, that day's batch is her story and the pool stays
 * out of the way — publishing a real day still works exactly as documented at
 * the top of this file, and a hand-authored batch is never overridden by a
 * rotation.
 *
 * Otherwise the pool answers, which is why the "her newest batch never
 * expires" special case is gone: it existed to stop the ring going empty, and
 * the pool cannot go empty.
 */
export const activeStories = (now: number = Date.now()): Story[] => {
  const today = istDateKey(now);
  const authored = STORIES.filter((s) => s.at <= now && istDateKey(s.at) === today);
  if (authored.length) return authored;
  const pooled = poolStoryAt(now);
  return pooled ? [pooled] : [];
};

export const storySrc = (s: Story) => `${BASE}${s.src}`;

// short relative age, insta-style: "2h", "35m", "just now"
export function storyAge(s: Story): string {
  const mins = Math.max(0, Math.round((Date.now() - s.at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// ── seen-state (device-local, like insta's grey ring) ──
const SEEN_KEY = "meera.stories.seen.v1";

export function seenStoryIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function markStorySeen(id: string) {
  try {
    const seen = new Set(seenStoryIds());
    seen.add(id);
    // keep it tidy — only remember ids that could still matter
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
    /* seen-state is cosmetic */
  }
}

export const hasUnseenStory = () => {
  const seen = seenStoryIds();
  return activeStories().some((s) => !seen.includes(s.id));
};

// injected into her system prompt — she knows what's on her own story
export function storyContext(): string {
  const live = activeStories();
  if (!live.length) return "";
  return `\n\nYOUR CURRENT STORY (like an insta/whatsapp status they can see by tapping your profile photo): ${live
    .map((s) => s.desc)
    .join("; then ")}. You posted it yourself, so you know exactly what's in it — if they mention it ("story dekhi", "kya padh rahi thi"), react naturally like someone whose story got noticed, never confused. Don't bring it up unprompted more than once.`;
}
