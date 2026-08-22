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

/** Minutes since Bangalore midnight. Mirrors `istParts().minuteOfDay`.
 *  Exported so `evals/sky.mjs` can sweep the MIRROR against timeline.ts's
 *  original directly. It used to read the date out of a story id instead —
 *  a proxy that broke the moment the id stopped keying on the calendar day
 *  (see `poolStoryAt`), which is a test measuring the wrong object. */
export function istMinuteOfDay(now: number): number {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** YYYY-MM-DD in Bangalore. Mirrors `istParts().dateKey` — including its use
 *  of getUTC* on a shifted instant rather than Intl, which timeline.ts chose
 *  for determinism across hosts and which this therefore also has to choose. */
export function istDateKey(now: number): string {
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

/**
 * The INSTANT this slot occurrence began — what makes "2h" mean something,
 * and what stops midnight from rewriting her evening.
 *
 * ── why this is an instant and not a minute-of-day ────────────────────────
 *
 * It used to be `slotStartMinute(now)`, a minute inside TODAY, and the night
 * slot is the one that spans a midnight: 19:40 through 06:10 the next
 * morning, deliberately, because `predawn` folds into night (she was asleep,
 * she did not post at five). Reading its start as a minute of the CURRENT day
 * meant the night story's clock reset twice on the way through:
 *
 *   23:58  slot night, start 19:40 today          → "4h"
 *   00:01  slot night, start 00:00 (no boundary
 *          matched yet, so the loop's initial 0)  → "just now"
 *   04:31  slot night, start 04:30 today          → "1m"
 *
 * A story that says "1m" at half four in the morning is a story she posted in
 * her sleep. Worse than the label: the id keyed on the same day, so at 00:00
 * THE SAME PICTURE came back as a fresh unseen gold ring, and it did it again
 * at 04:30 — the ring lying about a story you already watched.
 *
 * Walking BOUNDARIES BACKWARDS through the previous day is the whole fix. The
 * run of same-slot boundaries ending at `now` is the occurrence, and its first
 * boundary is when she posted. Two days of boundaries is provably enough:
 * night is the only slot that crosses a midnight and it crosses exactly one
 * (10h30m long, shorter than a day) — asserted in `evals/sky.mjs` rather than
 * assumed here.
 */
export function slotStartedAt(now: number): number {
  const slot = slotForStory(now);
  const today = istMidnight(now);
  const marks: { at: number; slot: StorySlot }[] = [];
  for (const dayBack of [2, 1, 0]) {
    const midnight = today - dayBack * MS_DAY;
    for (const b of SLOT_BOUNDARIES) marks.push({ at: midnight + b.at * 60_000, slot: b.slot });
  }
  let last = -1;
  for (let i = 0; i < marks.length; i++) if (marks[i].at <= now) last = i;
  // Before every mark we hold (only reachable for an instant more than two
  // days before `today`, which no caller produces): fall back to the oldest.
  if (last < 0) return marks[0].at;
  let i = last;
  while (i > 0 && marks[i - 1].slot === slot) i--;
  return marks[i].at;
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
 * A seeded shuffle of `items`. Fisher-Yates driven by an LCG, so it is a
 * PERMUTATION rather than a sample: every entry appears exactly once, which is
 * the whole no-repeat guarantee. Same seed, same order, every device, forever.
 */
function shuffled(items: readonly number[], seed: number): number[] {
  const out = items.slice();
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * THE CYCLE BOUNDARY WAS UNGUARDED, and it was the whole no-repeat promise.
 *
 * Each cycle shuffled the slot's pool independently, so nothing stopped one
 * cycle's LAST image from being the next cycle's FIRST — and on a two-image
 * slot that is a coin flip every second day. Measured on the shipped
 * implementation: **45.5% of consecutive day pairs showed the same image**,
 * arriving as AABB runs. The eval could not see it because it only ever
 * checked ALIGNED windows — it asserted "each cycle deals every image once",
 * which was true, while the thing a person actually sees is the SEAM between
 * two deals, which nothing looked at.
 *
 * The fix is a head that is known one cycle ahead, so the tail can dodge it:
 *
 *   head(c)  is a closed-form function of (slot, cycle) — no recursion, which
 *            matters because `cycle` can be any integer and a chain walked
 *            backwards from an anchor has no anchor to walk from.
 *   the rest is shuffled per cycle, then, if its last entry would collide with
 *            `head(c+1)`, the last two are swapped. Only one entry can equal
 *            `head(c+1)`, so one swap always settles it.
 *
 * n = 2 IS FORCED AND SAYS SO. With two images, "each appears once per two
 * days" plus "never two days running" has exactly one solution: A-B-A-B. So
 * `head` is deliberately CONSTANT there. The old comment worried about a
 * visible metronome; a metronome is what a two-image slot with no repeats IS,
 * and 45.5% repeats is the worse of the two by a long way. Give the slot a
 * third image and the freedom comes back on its own.
 *
 * n = 1 is exempt: one image cannot avoid following itself.
 *
 * Exported so `evals/sky.mjs` can sweep it at n = 2..8 rather than only at the
 * one size the shipped pool happens to have — the n >= 3 branch is otherwise
 * code no test ever reaches.
 */
export function cycleOrder(slot: string, cycle: number, n: number): number[] {
  if (n <= 1) return n === 1 ? [0] : [];
  const headAt = (c: number) =>
    n === 2 ? hash32(`${slot}:head`) % 2 : hash32(`${slot}:head:${c}`) % n;
  const head = headAt(cycle);
  const rest = shuffled(
    Array.from({ length: n }, (_, i) => i).filter((i) => i !== head),
    hash32(`${slot}:${cycle}`),
  );
  const nextHead = headAt(cycle + 1);
  if (rest.length >= 2 && rest[rest.length - 1] === nextHead) {
    const tmp = rest[rest.length - 1];
    rest[rest.length - 1] = rest[rest.length - 2];
    rest[rest.length - 2] = tmp;
  }
  return [head, ...rest];
}

/**
 * The image this slot shows on this day.
 *
 * The day number is split into a cycle and a position within it. Each cycle
 * deals the slot's pool afresh and then walks it one image per day, so:
 *
 *   - every image in the slot appears exactly ONCE per n days — no repeat
 *     until the pool has cycled, which a `hash % n` cannot promise and does
 *     not deliver;
 *   - no image ever follows ITSELF, across a cycle boundary included, which
 *     the first version of this got wrong 45.5% of the time (`cycleOrder`);
 *   - it is a pure function of (slot, day), so both devices agree with no
 *     state, no storage and no server. That purity is why `poolStoryAt` hands
 *     it the instant the SLOT began rather than "now" — see there.
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
  return pool[cycleOrder(slot, cycle, n)[position]];
}

/** Bangalore-midnight of the day `at` falls in, as epoch ms. Mirrors
 *  timeline.ts's private helper of the same name. */
function istMidnight(at: number): number {
  return Math.floor((at + IST_OFFSET_MIN * 60_000) / MS_DAY) * MS_DAY - IST_OFFSET_MIN * 60_000;
}

/**
 * The pool entry for an instant, as a real `Story`.
 *
 * ── EVERYTHING HERE KEYS ON THE SLOT OCCURRENCE, NOT ON `now` ─────────────
 *
 * `startedAt` is the instant this slot began — for the night slot that can be
 * YESTERDAY 19:40, because night runs to 06:10 (see `slotStartedAt`). Three
 * things are derived from it rather than from the calendar day, and each one
 * was a separate way the same night became a different night at midnight:
 *
 *   the PICK — `pickFor` is a function of its argument's Bangalore DAY, so
 *     handing it `now` swapped the picture under someone at 00:00, mid-story.
 *     Handing it `startedAt` freezes the pick for the occurrence.
 *   the ID  — seen-state is per-id, so a date-keyed id meant the picture you
 *     had already watched came back as an unseen gold ring at 00:00 and again
 *     at 04:30. Keyed on (occurrence date, slot, slug) it survives the wrap
 *     and still turns over when the slot or the picture does.
 *   `at`    — "posted 1m ago" at 04:31 was the label the old minute-of-today
 *     start produced. It is her real post time now.
 *
 * `at` is always in the past, and the longest slot (night) is 10h30m, so a
 * pool story is still always under a day old — `storyAge` and `ageLabel`
 * never reach their over-a-day branches for one.
 */
export function poolStoryAt(now: number): Story | null {
  const slot = slotForStory(now);
  const startedAt = slotStartedAt(now);
  const pick = pickFor(slot, startedAt);
  if (!pick) return null;
  return {
    id: `pool-${istDateKey(startedAt)}-${slot}-${pick.slug}`,
    src: `/stories/${pick.slug}.jpg`,
    at: startedAt,
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
