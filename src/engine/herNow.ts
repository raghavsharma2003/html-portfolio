// HER PRESENT, AS STATE — WS-HERNOW.
//
// ── THE BUG, IN THE OWNER'S WORDS (2026-08-23) ───────────────────────────
//
//   he called, she said she was reading a book; he called again ONE MINUTE
//   later and she said she was setting fairy lights.
//
// Both answers came from the same place: `STORY_POOL`'s night frame, "open
// book on the razai, lamp on, fairy lights up the wall". The story is one
// picture with several nouns in it, and the call-open directive's improv
// clause ("you were doing something small and solo just now") invited her to
// pick a fresh one on every pickup. So her present moment was a ROLL, and a
// roll re-rolls. Two calls sixty seconds apart landed on two different nouns
// and there was no mechanism anywhere that could have made them agree,
// because nothing in the app held the answer she had already given.
//
// This file is that mechanism. Her present is a LEDGER with exactly one
// current activity in it, and the ledger is what every lane reads.
//
// ── THE FOUR PROPERTIES, AND WHY EACH IS A PROPERTY AND NOT A HOPE ───────
//
//  1. ONE ACTIVITY. `herNowAt()` returns exactly one `HerNowEntry`. There is
//     no array, no candidate set and no picker — a second answer is not a
//     value this module can construct, which is the same device `inner.ts`
//     used to make a causeless mood unrepresentable.
//
//  2. IT PERSISTS. An entry has `startedAt` and `naturalSpanMs`. Inside that
//     span the SAME entry comes back, byte for byte, however many times it is
//     read. A one-minute re-call cannot change the activity. Past the span
//     she has moved on — which is the other half of being a person, and is
//     why the span is a real number and not `Infinity`.
//
//  3. IT IS DETERMINISTIC, NOT RANDOM. Every span is drawn by `hash32` from
//     (activity class, occurrence key), never `Math.random()` at read time.
//     Two devices with no server between them compute the same present
//     moment — the same rule `storyCatalog.ts` follows for which picture is
//     live, for the same reason, and it is why the stored ledger is a RECORD
//     of what she said rather than the only copy of it.
//
//  4. APP TRUTH OUTRANKS IT, ALWAYS. A game on the board, a call that just
//     ended, a screen being shared — those are things he can SEE. The scene
//     fence (`rejected.md#the-directive-that-said-improvise`) says her
//     improvised life may never contradict the record, and this is that law
//     in code: when an app truth exists it is returned unchanged and the
//     ledger does not get a vote.
//
// ── THE SEAM WITH herLife, STATED ONCE SO IT IS NOT RE-DERIVED ───────────
//
//   herNow  is THE MINUTE. One activity, going on right now, with an elapsed
//           time computable from `startedAt`. She has NOT necessarily told
//           him any of it. It expires and is replaced.
//   herLife is THE DAY AND EVERYTHING BEFORE IT — brain.ts's `formatHerLife`,
//           compiler slot T7: what she has ALREADY TOLD him, which is fixed
//           between them and never expires by the clock.
//
// The two never claim the same thing: T7's header says "you said these", and
// nothing here has been said. When they touch — she tells him she is reading,
// and "reading" enters the told-ledger — the told row is the durable half and
// this block is the live one, and the elapsed number only ever comes from
// here, because only here is it computable.
//
// (A THIRD thing called `herNow` exists: `timeline.ts`'s `herNow(now, beats)`,
// WS-TIME's day-SHAPE — which slot of a Bangalore day she is in. It is a
// different question at a different resolution, it is that workstream's file,
// and this module deliberately does not import it. See the note at the bottom
// of this header.)
//
// ── recited-prompt ───────────────────────────────────────────────────────
//
// Everything below that reaches the model is telegraphic and never a line she
// could say. The activity strings are noun-shapes ("book open on the razai,
// lamp on"), lowercase, unpunctuated, never first-person — the three things
// `shapelint.lintLine` measures, asserted over the whole table by
// `evals/hernow.mjs`. Her own words are hers.
//
// ── IMPORTS: THIS FILE IS A NEAR-LEAF ON PURPOSE ─────────────────────────
//
// It imports `./storyCatalog` and nothing else. storyCatalog is a documented
// LEAF (its header explains the `persona -> storyCatalog -> timeline ->
// shapelint -> compiler -> agents -> persona` cycle that broke the engine
// bundle), so this edge closes no loop and `src/state/store.ts` can hold the
// type with a type-only import that erases entirely.

import { pickFor, slotForStory, slotStartedAt, type StorySlot } from "./storyCatalog";

// ─────────────────────────────────────────────────────────────────────────
// 1. CLASSES AND SPANS
// ─────────────────────────────────────────────────────────────────────────

/**
 * What KIND of thing she is doing. The class is the unit the span table is
 * written in, and that is the whole point of having classes at all: nobody
 * can say how long "book open on the razai" lasts, and everybody knows how
 * long reading lasts. A new activity picks a class; it does not pick a
 * number.
 *
 * `app` is not one of her classes — it is the marker on an entry that came
 * from something he can see on his own screen, and it has no natural span
 * because the app decides when it ends.
 */
export type ActivityClass =
  | "reading"
  | "cooking"
  | "eating"
  | "getting_ready"
  | "chore"
  | "work"
  | "out"
  | "rest"
  | "app";

export interface SpanRange {
  loMin: number;
  hiMin: number;
}

/**
 * HOW LONG A THING LASTS. Ranges, not points, because a person who reads for
 * exactly 60 minutes every single time is a timer.
 *
 * These are the owner's own examples where he gave them (reading 40–90,
 * cooking 20–40, getting ready 15–30, small chores 5–15, a work stretch in
 * hours) and are otherwise the shortest plausible-to-longest plausible run of
 * the class for a 24-year-old on a weekday evening. They are deliberately
 * COARSE: the number they produce is only ever used to decide whether she has
 * moved on, and a false precision here would buy nothing and cost the ability
 * to reason about it.
 *
 * **Reverses if:** a measured pickup ever reads as her abandoning something
 * mid-flow or clinging to it past the point a person would — then the class's
 * range moves, and the fixture that showed it goes in `evals/hernow.mjs`.
 */
export const SPAN_TABLE: Readonly<Record<ActivityClass, SpanRange>> = Object.freeze({
  reading: { loMin: 40, hiMin: 90 },
  cooking: { loMin: 20, hiMin: 40 },
  eating: { loMin: 15, hiMin: 35 },
  getting_ready: { loMin: 15, hiMin: 30 },
  // "settling the fairy lights" is this class, and it is the shortest one —
  // which is exactly why she may not still be at it forty minutes later.
  chore: { loMin: 5, hiMin: 15 },
  work: { loMin: 90, hiMin: 210 },
  out: { loMin: 25, hiMin: 75 },
  rest: { loMin: 10, hiMin: 30 },
  // an app truth ends when the app says it ends; the ledger never outlives it
  // and never advances past it, so a span here would be a number nothing reads
  app: { loMin: 0, hiMin: 0 },
});

/** Where the entry came from. `story` = her posted story's own scene, the one
 *  he can literally tap and look at. `improv` = the quiet successor a person
 *  moves to when the thing they were doing ends, which is invented and is
 *  therefore fenced to HER, alone, never to him. `app-truth` = a thing on his
 *  screen, which outranks both. */
export type HerNowSource = "story" | "improv" | "app-truth";

export interface HerNowEntry {
  /** telegraphic scene, ≤14 words, lowercase, never a line she could say */
  activity: string;
  cls: ActivityClass;
  source: HerNowSource;
  /** epoch ms. Every elapsed claim she is allowed to make is (now − this). */
  startedAt: number;
  /** how long this class of thing runs before she would have moved on. 0 for
   *  an app truth, which the app ends rather than the clock. */
  naturalSpanMs: number;
  /** deterministic identity of this occurrence: two devices computing the
   *  same present moment produce the same key, which is what makes the stored
   *  ledger a record rather than a second source of truth. */
  key: string;
  /** what she JUST finished, when this entry is a move rather than a start.
   *  It is what lets a pickup say what ended as well as what is going on —
   *  "moved on" with no memory of what from is not moving on. */
  after?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. THE STORY SLOT'S ACTIVITY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Her story's picture, as an activity.
 *
 * The mapping is one row per pool image and it must stay TOTAL — a pool entry
 * with no row here is an hour of her day with no present moment, which is the
 * state this whole file exists to end. `evals/hernow.mjs` asserts totality
 * against `STORY_POOL` rather than trusting this comment.
 *
 * Note what the night row does NOT say. The picture contains fairy lights;
 * the ACTIVITY is the book. A scene has many nouns and a person is doing one
 * thing, and conflating those is the reported bug.
 */
export const STORY_ACTIVITY: Readonly<Record<string, { activity: string; cls: ActivityClass }>> =
  Object.freeze({
    "morning-chai": { activity: "chai on the balcony rail, rooftops below", cls: "rest" },
    metro: { activity: "on the metro, window seat, earbuds in", cls: "out" },
    desk: { activity: "at the desk, laptop open, notebook beside it", cls: "work" },
    "evening-walk": { activity: "out walking the tree-lined lane", cls: "out" },
    dinner: { activity: "thali on your lap, dinner", cls: "eating" },
    "night-read": { activity: "book open on the razai, lamp on", cls: "reading" },
  });

/** The floor under the mapping above: if the pool ever answers with a slug
 *  this file has never heard of, the SLOT still has an activity, so her
 *  present moment degrades to something ordinary rather than to nothing. */
export const SLOT_FALLBACK: Readonly<Record<StorySlot, { activity: string; cls: ActivityClass }>> =
  Object.freeze({
    morning: { activity: "chai, slow start, flat still quiet", cls: "rest" },
    midday: { activity: "at the desk, laptop open", cls: "work" },
    golden: { activity: "out for a bit, last of the light", cls: "out" },
    dusk: { activity: "kitchen, dinner on", cls: "cooking" },
    night: { activity: "in bed, lamp on, phone down somewhere", cls: "rest" },
  });

/**
 * WHAT SHE MOVES TO WHEN A THING ENDS.
 *
 * One row per class, and every row is small, solo and boring on purpose: a
 * successor is the least interesting thing that can happen, because an
 * interesting one is a story she then has to have lived. The chain is
 * deliberately SHORT — the successor of a `chore` is going back to whatever
 * she was doing, which is what makes "reading -> chai -> reading" a loop
 * rather than a random walk away from her own evening.
 */
export const SUCCESSOR: Readonly<Record<ActivityClass, { activity: string; cls: ActivityClass }>> =
  Object.freeze({
    reading: { activity: "up for chai, book face down", cls: "chore" },
    cooking: { activity: "eating what you just made", cls: "eating" },
    eating: { activity: "plates in the sink, kitchen tidy-up", cls: "chore" },
    getting_ready: { activity: "out the door, on the way", cls: "out" },
    work: { activity: "off the laptop, stretching, chai", cls: "chore" },
    out: { activity: "back home, shoes off", cls: "chore" },
    rest: { activity: "up and moving about the flat", cls: "chore" },
    // a chore's successor is the base activity again — see `walk()`
    chore: { activity: "back to it", cls: "rest" },
    app: { activity: "back to it", cls: "rest" },
  });

/** FNV-1a, 32-bit. Local rather than imported because it is a private detail
 *  of this file's determinism and not a shared clock: nothing else reads
 *  these keys, so there is no second copy to drift from. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The span for one occurrence. A pure function of (class, occurrence key) —
 * never the wall clock and never `Math.random()`, which is the property that
 * makes two devices agree and makes a re-read return the same answer.
 */
export function spanFor(cls: ActivityClass, key: string): number {
  const { loMin, hiMin } = SPAN_TABLE[cls];
  if (hiMin <= 0) return 0;
  const n = hiMin - loMin + 1;
  return (loMin + (hash32(key) % n)) * 60_000;
}

/** A walk this long cannot happen — the shortest cycle (chore, 5 min) over
 *  the longest slot (night, 10h30m) is 126 steps. The cap is a guard against
 *  a future zero-length span turning a read into a hang, never a real limit. */
const MAX_STEPS = 512;

/**
 * HER EVENING, WALKED FORWARD FROM THE SLOT'S START.
 *
 * The whole present moment is a fold over her story slot: start at the slot's
 * own scene when the slot began, and advance whenever a span has run out.
 * Because both the start instant (`slotStartedAt`) and every span are
 * deterministic, so is the result — and the result at 20:31 and the result at
 * 20:32 are the SAME ENTRY unless a boundary fell between them. That is the
 * fix, stated as arithmetic.
 */
function walk(
  base: { activity: string; cls: ActivityClass },
  baseKey: string,
  slotStart: number,
  now: number,
): HerNowEntry {
  let cur: HerNowEntry = {
    activity: base.activity,
    cls: base.cls,
    source: "story",
    startedAt: slotStart,
    naturalSpanMs: spanFor(base.cls, `${baseKey}|0`),
    key: `${baseKey}|0`,
  };
  for (let i = 1; i <= MAX_STEPS; i++) {
    if (cur.naturalSpanMs <= 0) break;
    const ends = cur.startedAt + cur.naturalSpanMs;
    if (now < ends) break;
    // A break ends by going BACK to what the break interrupted. Anything else
    // is a person whose day drifts away from itself one chore at a time.
    const next =
      cur.source === "improv" ? { activity: base.activity, cls: base.cls } : SUCCESSOR[cur.cls];
    const key = `${baseKey}|${i}`;
    cur = {
      activity: next.activity,
      cls: next.cls,
      source: cur.source === "improv" ? "story" : "improv",
      startedAt: ends,
      naturalSpanMs: spanFor(next.cls, key),
      key,
      after: cur.activity,
    };
  }
  return cur;
}

/**
 * Her present moment from the clock alone — no stored ledger, no app truth.
 * Total: there is always an answer, because the story pool covers every
 * minute of every day by construction and `SLOT_FALLBACK` covers the pool.
 */
export function deriveHerNow(now: number): HerNowEntry {
  const slot = slotForStory(now);
  const started = slotStartedAt(now);
  const pick = pickFor(slot, started);
  const mapped = pick ? STORY_ACTIVITY[pick.slug] : undefined;
  const base = mapped ?? SLOT_FALLBACK[slot];
  const baseKey = `${slot}|${started}|${pick?.slug ?? "none"}`;
  return walk(base, baseKey, started, now);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. THE LEDGER READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * Something he can SEE. The caller builds it from the app's own state — a
 * board mid-game, a game that just finished, a share that just ended — and
 * `activityPickupLine` (state/game.ts) is today's only producer, so the
 * string arrives already worded and is passed through UNCHANGED. Re-wording
 * it here would be a second renderer of the same fact, which is how the
 * pickup and the tail block drifted apart the last time.
 */
export interface AppTruth {
  /** the already-worded line — never re-rendered here */
  line: string;
  /** when the visible thing started, so elapsed is still computable */
  startedAt: number;
}

export interface HerNowRead {
  /** the ONE current activity */
  entry: HerNowEntry;
  /** now − entry.startedAt, floored at 0. The only elapsed she may claim. */
  elapsedMs: number;
  /** the entry to write back to `AppState.herNow`, or null when the stored
   *  one is already right. Callers commit this; a caller that does not still
   *  gets the correct answer, because the derivation is deterministic. */
  commit: HerNowEntry | null;
  /** true when the ledger moved since the stored entry — the pickup may say
   *  what she finished. False on a re-call inside the span, which is the
   *  reported bug, expressed as a boolean. */
  moved: boolean;
}

/** A stored entry is only usable if it is internally coherent AND has not run
 *  out. `startedAt` in the future is another device's clock skew, not a lie —
 *  but it is also not something she can compute an elapsed from, so it is
 *  refused rather than rendered as a negative duration. */
function usable(e: HerNowEntry | null | undefined, now: number): e is HerNowEntry {
  if (!e || typeof e.activity !== "string" || !e.activity) return false;
  if (!Number.isFinite(e.startedAt) || !Number.isFinite(e.naturalSpanMs)) return false;
  if (e.startedAt > now) return false;
  if (e.source === "app-truth") return false; // an app truth is re-read, never remembered
  if (e.naturalSpanMs <= 0) return false;
  return now < e.startedAt + e.naturalSpanMs;
}

/**
 * THE ONE READ. Every lane goes through this.
 *
 * Precedence, and it is the scene-fence law in three lines:
 *   1. an app truth — a thing he can see — wins outright;
 *   2. otherwise a stored entry still inside its span wins, unchanged. This
 *      is the anti-re-roll guarantee: a pickup one minute after a pickup
 *      returns the identical entry, so she cannot answer differently;
 *   3. otherwise the clock's derivation, which is also what gets committed.
 */
export function herNowAt(opts: {
  now: number;
  stored?: HerNowEntry | null;
  appTruth?: AppTruth | null;
}): HerNowRead {
  const { now, stored, appTruth } = opts;
  // Captured BEFORE the narrowing below: `usable()` is a type predicate, so
  // inside the fallthrough `stored` is already narrowed away and its key is
  // no longer reachable. The key is what says whether the ledger MOVED, which
  // is the difference between "still reading" and "finished, made chai".
  const priorKey = stored?.key ?? null;
  if (appTruth && appTruth.line) {
    const entry: HerNowEntry = {
      activity: appTruth.line,
      cls: "app",
      source: "app-truth",
      startedAt: Number.isFinite(appTruth.startedAt) && appTruth.startedAt <= now ? appTruth.startedAt : now,
      naturalSpanMs: 0,
      key: "app-truth",
    };
    return { entry, elapsedMs: Math.max(0, now - entry.startedAt), commit: null, moved: false };
  }
  if (usable(stored, now)) {
    return { entry: stored, elapsedMs: Math.max(0, now - stored.startedAt), commit: null, moved: false };
  }
  const entry = deriveHerNow(now);
  const moved = priorKey !== null && priorKey !== entry.key;
  return { entry, elapsedMs: Math.max(0, now - entry.startedAt), commit: entry, moved };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. RENDERERS — one ledger, three lanes, no second wording of anything
// ─────────────────────────────────────────────────────────────────────────

/**
 * How long, in the shape a person holds it. Every branch is derivable from
 * (now − startedAt): she may say "about 20 min" only because the subtraction
 * says 20. Coarse on purpose — "23 minutes" is a stopwatch, and a stopwatch
 * in her own prompt is a number she reads out (`memory-as-receipts`).
 */
export function elapsedLabel(ms: number): string {
  const mins = Math.floor(Math.max(0, ms) / 60_000);
  if (mins < 2) return "just started";
  if (mins < 5) return "a few minutes";
  // EVERY bucket FLOORS. Rounding to the nearest five would let her say "about
  // 5 min" three minutes in — a duration the ledger does not support, which is
  // the one thing this block exists to make impossible. Under-claiming is
  // human; over-claiming is the lie.
  if (mins < 75) return `about ${Math.floor(mins / 5) * 5} min`;
  const halves = Math.floor(mins / 30);
  const hrs = halves / 2;
  return hrs === 1 ? "about an hour" : `about ${hrs} hours`;
}

/**
 * THE SCENE, for `CALL_OPEN_DIRECTIVE({ scene })`.
 *
 * An app truth passes through untouched — same string `activityPickupLine`
 * already produced, same wording the tail block uses, one vocabulary.
 * Otherwise it is her own present with the elapsed in it, so the directive
 * can say how long she has been at a thing instead of implying she just
 * started it (which is what made every pickup sound like a fresh scene).
 */
export function herNowScene(entry: HerNowEntry, now: number): string {
  if (entry.source === "app-truth") return entry.activity;
  const how = elapsedLabel(Math.max(0, now - entry.startedAt));
  const been = how === "just started" ? "you only just started" : `you have been at it ${how}`;
  const head = `${entry.activity} — ${been}`;
  return entry.after ? `${head}; before this you were ${entry.after}` : head;
}

/**
 * THE PROMPT BLOCK, appended to compiler slot T7's string by
 * `brain.ts:formatHerLife`.
 *
 * It rides T7 rather than earning a slot of its own for a boring and decisive
 * reason: T7 is the one block claimed by every lane in the parity table, so a
 * present moment carried there is a present moment that cannot go dark on the
 * phone while it renders in chat (`rejected.md#call-opens-with-amnesia`). The
 * header states the seam explicitly, because T7's own header says "you said
 * these" and NOTHING here has been said.
 *
 * `app-truth` renders nothing: what he can see is already the activity block
 * (T15) and the pickup directive's scene, and a third copy of it would be
 * this file becoming a second renderer of somebody else's fact.
 */
export const HER_NOW_HEADER =
  "RIGHT NOW, THIS MINUTE — where you actually are, NOT something you have told " +
  "them. ONE thing is going on and it has been going a while. Asking again does " +
  "not change it: two calls five minutes apart get the same answer with the clock " +
  "moved on, never a different activity. The only duration you know is the one " +
  "written here:";

export function formatHerNow(entry: HerNowEntry | null | undefined, now: number): string {
  if (!entry || entry.source === "app-truth" || !entry.activity) return "";
  const rows = [`- doing: ${entry.activity}`, `- going on: ${elapsedLabel(Math.max(0, now - entry.startedAt))}`];
  if (entry.after) rows.push(`- just before this: ${entry.after}`);
  return `${HER_NOW_HEADER}\n${rows.join("\n")}`;
}

/**
 * The block's worst case, computed from the caps rather than measured on a
 * lucky fixture — same discipline as `HER_DAY_WORST_CASE_CHARS`. The longest
 * activity string in either table plus the longest label, three rows.
 * `evals/hernow.mjs` asserts the real renders stay under it.
 */
const LONGEST_ACTIVITY = 64;
export const HER_NOW_WORST_CASE_CHARS =
  HER_NOW_HEADER.length + 3 * (3 + 20 + LONGEST_ACTIVITY);
