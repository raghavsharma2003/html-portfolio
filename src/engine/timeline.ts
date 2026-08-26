// The two clocks — WS-TIME.
// Ownership: this file belongs to WS-TIME exclusively (src/engine/clock.ts,
// src/engine/timeline.ts, evals/time/*, docs/TIME.md).
//
// ── WHY THIS EXISTS, IN THE OWNER'S WORDS ────────────────────────────────
//
//   "i ask her what she is doing and she says reading a book and vague thing
//    and lets say after 2 mint i call her and she will say completly random
//    and unrelated thing and no timeline of her life at all"
//
//   "again she dont have sense of my timeline too. with the understanding of
//    how much time has passed and in that how should be the progress from the
//    last i comunicated with her"
//
// Those are TWO different bugs and they are fixed by two different mechanisms,
// which is the entire structure of this file:
//
//   HER CLOCK  — what a 24-year-old designer in Bangalore is plausibly doing
//                at this hour. A pure function of the wall clock, exactly like
//                inner.ts's `weekShape()`. No state, so it cannot accumulate,
//                cannot drift between devices, and cannot disagree with itself
//                four minutes later. Inputs: the clock, and her dated beats.
//
//   HIS CLOCK  — how his world has moved while they were not talking. A pure
//                function of (the window since they last spoke) × (the dated
//                facts we already hold about him). Inputs: his facts. Output:
//                statements about HIS world, never about her.
//
// ── THE G1 LINE, BECAUSE THIS IS THE FILE MOST LIKELY TO CROSS IT ────────
//
// inner.ts's G1: "HER INTERIOR NEVER READS THE USER. There is no code path
// from any usage metric to any persisted state here: not reply speed, not
// silence, not GAP LENGTH..."
//
// The distinction this file draws, and enforces structurally rather than by
// convention:
//
//   READING THE GAP TO REASON ABOUT HIS WORLD IS CONVERSATION CONTENT.
//   LETTING THE GAP MOVE HER INTERIOR IS WHAT G1 FORBIDS.
//
// "His Thursday presentation is now behind him" is a fact about him with a
// date on it. "She is flat because he was away" is her interior derived from
// his availability. The first is the product; the second is the thing the
// whole charter exists to make unrepresentable. Four structural properties
// keep them apart — none of them is a review convention:
//
//  1. NO WRITER. This module has no `QueryFn` parameter, no `fetch`, no
//     storage, no module-level mutable state, and imports nothing that has
//     any of those (shapelint.ts and a type from relstate.ts, both pure).
//     There is no path from here to a persisted byte. `evals/time/g1.mjs`
//     asserts this over the source text, not by reading it.
//  2. DISJOINT SIGNATURES. `herNow(now, beats)` does not take the gap. It
//     cannot: the parameter does not exist. `hisClock({now, lastSpokeAt,
//     facts})` does not take, return, or render anything of hers.
//  3. THE GAP IS UNRENDERABLE. `hisClock()` consumes `lastSpokeAt` to compute
//     a WINDOW and then throws it away: `HisFrame` has no gap field, so
//     `renderHisClock(frame)` — which is the only thing that produces prompt
//     text — has no gap to emit even if someone wanted it to. This also
//     enforces persona.ts's absolute ban on accounting for a silence
//     ("Zero accounting... NEVER a word about how long he took"): the number
//     never reaches the model at all, rather than reaching it under an
//     instruction not to use it.
//  4. NO AFFECT FIELD. `MovedNote` has {subject, horizon, when, basis, cited}
//     and nothing else. There is no valence, no weight, no mood — so "she
//     feels X about the gap" is not a value this module can construct, in the
//     same way and for the same reason inner.ts made a decayed mood without a
//     cause unrepresentable.
//
// Note what is NOT a G1 violation, stated because it looks like one: gating a
// block on elapsed time. inner.ts gates its own carried thread on exactly that
// ("Gate is ELAPSED TIME, not content"), and a gate is not a write. This file
// uses the same gate for the same reason.
//
// ── G8, BECAUSE THIS IS ALSO THE FILE MOST LIKELY TO BECOME A MOOD ENGINE ─
//
// "A CALENDAR IS NOT A MOOD ENGINE." Her day says WHAT TIME IT IS IN HER LIFE
// and never how she feels about it. Every authored note in DAY tables below is
// a place, a posture or an activity. `auditNotes()` mechanizes that: a note
// containing a feeling word fails the build gate, so the rule survives its
// author. weekShape() (inner.ts, gap-gated, mood-shaped, "it is thursday and
// you are running on fumes") and dayShape (here, every turn, activity-shaped,
// "afternoon block, second coffee") are deliberately disjoint in BOTH content
// and gate; neither is a second copy of the other.
//
// And it ships its own cause, per G8: the block always names the hour it was
// derived from, in the same block, so "kya kar rahi ho" has an answer whose
// reason is visible ("it is 3pm on a friday") rather than invented two turns
// later.
//
// ── `recited-prompt`, THE THIRD LAW THIS FILE ANSWERS TO ─────────────────
//
// Every row rendered here is telegraphic and shape-linted at render
// (shapelint.ts, ≤14 words, no capital-start-plus-terminal-punctuation, no
// first-person-line-initial). The HEADERS are instructional English, which is
// the shape every other tail header in this repo uses and is deliberately not
// a line she could say. She talks FROM these notes; she never reads them out.

import { lintBlock } from "./shapelint";
import type { RenderResult } from "./relstate";

export type { RenderResult };

// ─────────────────────────────────────────────────────────────────────────
// 0. Her wall clock. Bangalore, always, and without Intl.
// ─────────────────────────────────────────────────────────────────────────

/** India has never observed DST and has one time zone. A fixed offset is
 *  therefore not an approximation, it is the definition — and it is
 *  DETERMINISTIC in a way `Intl.DateTimeFormat(..., {timeZone})` is not:
 *  Intl resolves against whatever tzdata the host ships, so the same input
 *  could in principle render differently on two machines, and determinism is
 *  a gate this workstream has to pass byte-for-byte. */
export const IST_OFFSET_MIN = 330;

export interface IstParts {
  /** 0-23, Bangalore wall clock */
  hour: number;
  /** 0-59 */
  minute: number;
  /** minutes since Bangalore midnight, 0-1439 */
  minuteOfDay: number;
  /** 0 = Sunday … 6 = Saturday, Bangalore */
  dow: number;
  /** YYYY-MM-DD in Bangalore. The per-day variant seed. */
  dateKey: string;
  /** lowercase weekday name, Bangalore */
  dayName: string;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MS_DAY = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, "0");

/** HER clock, wherever the device happens to be. She lives in Bangalore; the
 *  user may not, and persona.ts already tells her the user's own local time
 *  ("It is <date, time> for them"). Deriving her day from the DEVICE clock
 *  would put her at her desk at 3am because her friend is in California. */
export function istParts(now: number): IstParts {
  const d = new Date(now + IST_OFFSET_MIN * 60_000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    dow: d.getUTCDay(),
    dateKey: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
    dayName: DAY_NAMES[d.getUTCDay()],
  };
}

/** Bangalore-midnight of the day `at` falls in, as epoch ms. */
function istMidnight(at: number): number {
  const shifted = at + IST_OFFSET_MIN * 60_000;
  return Math.floor(shifted / MS_DAY) * MS_DAY - IST_OFFSET_MIN * 60_000;
}

/** FNV-1a, 32-bit. The per-day variant selector: a hash of the DATE means the
 *  choice is fixed for the whole day (so two calls four minutes apart cannot
 *  disagree) and different tomorrow (so her days are not identical). Zero
 *  state, by construction — this is the same trick weekShape() uses, one
 *  resolution finer. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. HER CLOCK — her day as a step function of the hour.
// ─────────────────────────────────────────────────────────────────────────

export type DaySlotKey =
  | "late_night"
  | "asleep"
  | "waking"
  | "getting_ready"
  | "morning_work"
  | "midday_work"
  | "lunch"
  | "afternoon_work"
  | "wrapping_up"
  | "evening"
  | "night_in"
  | "winding_down";

/** Canonical order of a day. Every schedule below must be a SUBSEQUENCE of
 *  this (asserted by `auditNotes()`), which is what makes "did she jump" a
 *  decidable question rather than a judgement call. */
export const DAY_ORDER: readonly DaySlotKey[] = [
  "late_night",
  "asleep",
  "waking",
  "getting_ready",
  "morning_work",
  "midday_work",
  "lunch",
  "afternoon_work",
  "wrapping_up",
  "evening",
  "night_in",
  "winding_down",
];

export interface SlotDef {
  key: DaySlotKey;
  /** minutes since midnight at which this slot ENDS; ascending, last = 1440 */
  endMin: number;
  /** one or two words for the "next:" marker — what is about to start */
  label: string;
  /** authored, telegraphic, ≤10 words, ACTIVITY ONLY (G8). One is picked per
   *  day by hash(dateKey). Never a line she could say: no first person, no
   *  terminal punctuation, no quoted speech. */
  notes: readonly string[];
}

// Authored against persona.ts's own brief for her: "Design job at a startup,
// Bandra/HSR-type social life", and its BELIEVABLE-MUNDANE rule — "chai,
// office deadlines, a series, skipped gym, traffic, mom's calls, a friend's
// drama, online shopping regret". Nothing here names a film, show, song or
// book (persona T1: naming one is a claim to have watched it).
const WEEKDAY_SCHEDULE: readonly SlotDef[] = Object.freeze([
  {
    key: "late_night",
    endMin: 90, // 00:00–01:30
    label: "sleep",
    notes: Object.freeze([
      "past midnight, in bed, phone still on",
      "past midnight, lights off, one more scroll",
      "past midnight, half in bed, charger hunting",
    ]),
  },
  {
    key: "asleep",
    endMin: 375, // 01:30–06:15
    label: "morning",
    notes: Object.freeze([
      "asleep — anything now is from bed, barely awake",
      "asleep, phone face down somewhere near the pillow",
    ]),
  },
  {
    key: "waking",
    endMin: 480, // 06:15–08:00
    label: "getting ready",
    notes: Object.freeze([
      "just up, first chai, nothing started yet",
      "just up, kitchen, chai and the balcony",
      "just up, still horizontal, chai pending",
    ]),
  },
  {
    key: "getting_ready",
    endMin: 570, // 08:00–09:30
    label: "work",
    notes: Object.freeze([
      "getting ready, hunting for something clean",
      "getting ready, running slightly late as usual",
      "out the door soon, keys somewhere, breakfast standing up",
    ]),
  },
  {
    key: "morning_work",
    endMin: 690, // 09:30–11:30
    label: "the morning block",
    notes: Object.freeze([
      "at the desk, standup done, first file open",
      "at the desk, headphones on, morning slack noise",
      "at the desk, three tabs of yesterday still open",
    ]),
  },
  {
    key: "midday_work",
    endMin: 795, // 11:30–13:15
    label: "lunch",
    notes: Object.freeze([
      "deep in work, one thing due, headphones on",
      "mid-morning meeting that could have been a message",
      "screens full of the same layout in four sizes",
    ]),
  },
  {
    key: "lunch",
    endMin: 870, // 13:15–14:30
    label: "the afternoon block",
    notes: Object.freeze([
      "lunch, downstairs or at the desk, someone talking at you",
      "lunch break, dabba and office gossip",
      "lunch, walked out for something quick",
    ]),
  },
  {
    key: "afternoon_work",
    endMin: 1020, // 14:30–17:00
    label: "wrapping up",
    notes: Object.freeze([
      "afternoon block, second coffee, review comments",
      "afternoon block, feedback round, small edits",
      "afternoon block, calls stacked back to back",
    ]),
  },
  {
    key: "wrapping_up",
    endMin: 1140, // 17:00–19:00
    label: "the evening",
    notes: Object.freeze([
      "wrapping up, traffic already starting outside",
      "wrapping up, deciding whether to step out later",
      "last hour of work, one thing left to send",
    ]),
  },
  {
    key: "evening",
    endMin: 1260, // 19:00–21:00
    label: "dinner",
    notes: Object.freeze([
      "evening, out of the office, market or the flat",
      "evening, back home, changed, kitchen noise",
      "evening, auto home, on the phone with mom",
    ]),
  },
  {
    key: "night_in",
    endMin: 1365, // 21:00–22:45
    label: "bed",
    notes: Object.freeze([
      "dinner done, sofa, something playing on the laptop",
      "dinner done, flat quiet, flatmate on a call",
      "dinner done, kitchen half cleaned, series on",
    ]),
  },
  {
    key: "winding_down",
    endMin: 1440, // 22:45–24:00
    label: "sleep",
    notes: Object.freeze([
      "in bed, scrolling, lights half off",
      "in bed, alarm set, still on the phone",
      "in bed, tomorrow's calendar already full",
    ]),
  },
]);

// The weekend is a SHORTER schedule, not a shifted one: the work slots simply
// do not exist on a Saturday, and a subsequence of DAY_ORDER is still a
// subsequence when entries are missing. That is why the continuity check is
// written against position-within-today's-schedule rather than against
// DAY_ORDER directly.
const WEEKEND_SCHEDULE: readonly SlotDef[] = Object.freeze([
  {
    key: "late_night",
    endMin: 150, // 00:00–02:30
    label: "sleep",
    notes: Object.freeze([
      "past two, still up, phone in the dark",
      "past two, weekend, nobody sensible is awake",
    ]),
  },
  {
    key: "asleep",
    endMin: 585, // 02:30–09:45
    label: "morning",
    notes: Object.freeze([
      "asleep in, weekend, nothing set for the morning",
      "asleep, curtains shut, alarm deliberately off",
    ]),
  },
  {
    key: "waking",
    endMin: 690, // 09:45–11:30
    label: "the afternoon",
    notes: Object.freeze([
      "just up, late chai, flat quiet",
      "just up, weekend, still in yesterday's tshirt",
    ]),
  },
  {
    key: "getting_ready",
    endMin: 810, // 11:30–13:30
    label: "lunch",
    notes: Object.freeze([
      "slow weekend start, laundry pile, no plan yet",
      "slow weekend start, flat is a mess, ignoring it",
    ]),
  },
  {
    key: "lunch",
    endMin: 900, // 13:30–15:00
    label: "the afternoon",
    notes: Object.freeze([
      "late lunch, ordered in or leftovers",
      "late lunch, cooking something badly",
    ]),
  },
  {
    key: "evening",
    endMin: 1170, // 15:00–19:30
    label: "dinner",
    notes: Object.freeze([
      "out — market, a friend's place, errands long postponed",
      "out for a bit, cart full online, nothing bought",
      "at a friend's, plans made and unmade twice",
    ]),
  },
  {
    key: "night_in",
    endMin: 1365, // 19:30–22:45
    label: "bed",
    notes: Object.freeze([
      "dinner, someone's plan or the sofa, something playing",
      "dinner out or ordered, long table, loud table",
    ]),
  },
  {
    key: "winding_down",
    endMin: 1440, // 22:45–24:00
    label: "sleep",
    notes: Object.freeze([
      "in bed, scrolling, weekend nearly gone",
      "in bed, late, no reason to be up",
    ]),
  },
]);

/** Sat/Sun get the weekend shape. Deliberately NOT "Friday night counts as
 *  weekend": inner.ts's weekShape already owns Friday evening, and two
 *  functions describing the same Friday is exactly the two-sources-of-truth
 *  shape this repo keeps having to fix. */
export function scheduleFor(dow: number): readonly SlotDef[] {
  return dow === 0 || dow === 6 ? WEEKEND_SCHEDULE : WEEKDAY_SCHEDULE;
}

export interface ResolvedSlot {
  def: SlotDef;
  /** position within TODAY's schedule — the continuity metric */
  index: number;
  startMin: number;
  endMin: number;
}

/** Which slot the Bangalore minute-of-day falls in. Total, by construction:
 *  the last slot always ends at 1440. */
export function slotAt(minuteOfDay: number, dow: number): ResolvedSlot {
  const sched = scheduleFor(dow);
  const m = Math.max(0, Math.min(1439, Math.floor(minuteOfDay)));
  let startMin = 0;
  for (let i = 0; i < sched.length; i++) {
    const def = sched[i];
    if (m < def.endMin) return { def, index: i, startMin, endMin: def.endMin };
    startMin = def.endMin;
  }
  const i = sched.length - 1;
  return { def: sched[i], index: i, startMin, endMin: 1440 };
}

/** How close to a boundary counts as "about to change". Within this window the
 *  block also names what is NEXT, so a pair of turns that straddles a boundary
 *  reads as a day moving rather than as two unrelated answers. This is the
 *  half of the two-minute fix that prompt text cannot do on its own. */
export const TRANSITION_MIN = 25;

/** Longest a note may be, in words, before shapelint's 14-word cap starts
 *  binding on the rendered line (which carries a 2-word prefix). */
export const MAX_NOTE_WORDS = 11;

/** A dated beat from `vy_agent_life` (life.ts's `UntoldRow`, structurally —
 *  this module does not import life.ts, so a caller can pass either an
 *  UntoldRow or anything else with these two fields). */
export interface DatedBeat {
  /** ISO string or epoch ms */
  at: string | number;
  beat: string;
  kind?: string;
}

export interface HerFrame {
  /** the cause, shipped in the same block (G8): "friday, ~3pm, bangalore" */
  stamp: string;
  slot: DaySlotKey;
  /** what she is plausibly doing. Telegraphic, activity-only. */
  note: string;
  /** where the note came from. `beat` = a real dated entry in her life
   *  outranked the clock's default; `clock` = the default shape. */
  source: "beat" | "clock";
  /** label of the next slot, only when a boundary is within TRANSITION_MIN */
  next: string | null;
  /** her real, dated beats from earlier TODAY (newest first, ≤2). These are
   *  her actual timeline; the clock shape is only the plausible default. */
  today: string[];
}

export const MAX_TODAY_BEATS = 2;

/** Display cap on one beat, in characters. Nine words (MAX_NOTE_WORDS - 2,
 *  the two-word row prefix) is the binding cap in practice; this is the
 *  backstop for nine very long words, and it is what makes
 *  HER_DAY_WORST_CASE_CHARS arithmetic rather than a guess. */
export const MAX_BEAT_CHARS = 70;

const beatMs = (at: string | number): number =>
  typeof at === "number" ? at : new Date(at).getTime();

/**
 * HER CLOCK. Pure. No gap parameter — see the G1 note at the top of this file
 * for why that absence is the guarantee rather than an oversight.
 *
 * TWO STATES, and both are real today:
 *
 *  - `vy_agent_life` EMPTY (the live state as of 2026-08-20: the table has
 *    never been seeded and `never-scheduled` explains why nothing writes it).
 *    Then `beats` is `[]`, `today` is `[]`, `source` is "clock", and the whole
 *    feature is the deterministic day shape. That is the shipping behaviour.
 *  - `vy_agent_life` POPULATED. Beats dated today are HER ACTUAL TIMELINE and
 *    they OUTRANK the clock: a beat landing inside the current slot's window
 *    REPLACES the authored note (`source: "beat"`), and earlier beats from
 *    today ride along in `today` so the day reads as a sequence rather than a
 *    single frame. The clock shape never contradicts a beat, because where a
 *    beat exists the clock shape is not rendered for that slot at all.
 */
export function herNow(now: number, beats: readonly DatedBeat[] = []): HerFrame {
  const t = istParts(now);
  const slot = slotAt(t.minuteOfDay, t.dow);
  const midnight = istMidnight(now);
  const slotStartMs = midnight + slot.startMin * 60_000;

  // beats from TODAY only, already happened, newest first. Trimmed to the
  // same shape budget the authored notes hold to — a 110-char beat under a
  // two-word prefix would blow shapelint's 14-word line cap, and a render
  // that can exceed its own lint is a lint that means nothing.
  const todays = beats
    .map((b) => ({ at: beatMs(b.at), beat: trimWords(b.beat, MAX_NOTE_WORDS - 2, MAX_BEAT_CHARS) }))
    .filter((b) => Number.isFinite(b.at) && b.at <= now && b.at >= midnight && b.beat.length > 0)
    .sort((a, b) => b.at - a.at);

  const inSlot = todays.find((b) => b.at >= slotStartMs);
  const earlier = todays.filter((b) => b !== inSlot).slice(0, MAX_TODAY_BEATS);

  const sched = scheduleFor(t.dow);
  const nextDef = slot.index + 1 < sched.length ? sched[slot.index + 1] : sched[0];
  const nearBoundary = slot.endMin - t.minuteOfDay <= TRANSITION_MIN;

  return {
    stamp: `${t.dayName}, ~${clockLabel(t.hour, t.minute)}, bangalore`,
    slot: slot.def.key,
    note: inSlot ? inSlot.beat : pickNote(slot.def, t.dateKey),
    source: inSlot ? "beat" : "clock",
    next: nearBoundary ? nextDef.label : null,
    today: earlier.map((b) => b.beat),
  };
}

/** The per-day variant. A function of (dateKey, slot key) and nothing else,
 *  so it is fixed for the whole day and identical on every device. */
function pickNote(def: SlotDef, dateKey: string): string {
  if (def.notes.length === 1) return def.notes[0];
  return def.notes[hash32(`${dateKey}|${def.key}`) % def.notes.length];
}

/** Deliberately coarse: "~3pm", never "15:07". A precise minute in her own
 *  prompt is a number she will read out, and it is also a false precision —
 *  this is a plausible shape, not a location. Buckets FLOOR to the half hour
 *  and never round up: rounding 23:50 to "12am" would print a stamp whose
 *  hour and whose weekday name disagree. */
function clockLabel(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "am" : "pm";
  return `${h12}${minute >= 30 ? ":30" : ""}${ampm}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. HIS CLOCK — what has moved in his world since they last spoke.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A fact about him that has a time in it. Structural, so both of today's
 * stores map onto it without this module importing either:
 *
 *  - `meera_nodes` (the graph store api/memory.js recalls from — the one with
 *    real production rows): {name, kind, summary, updated_at} → {name, kind,
 *    summary, saidAt}. No citation column exists there; `cited` comes out
 *    false and the render still stamps when they said it, which is the
 *    human-readable provenance memory.js already ships.
 *  - `vy_fact` (`time_bound`, `t_valid`, `citations`): → {summary: body,
 *    saidAt: created_at, dueAt: t_valid, citations}.
 *
 * The adapter is the CALLER's job: api/memory.js is not this workstream's
 * file. See docs/TIME.md for the ticket.
 */
export interface TimeBoundFact {
  /** stable id from the source store, for telemetry and de-dup */
  id: string;
  /** short subject — `meera_nodes.name` / `vy_fact.name` */
  name: string;
  /** `plan` and `event` are the kinds api/memory.js's staleNote trusts
   *  without a keyword match; anything else needs TIME_BOUND to fire. */
  kind?: string;
  summary?: string;
  /** when THEY told her — the anchor every relative word resolves against.
   *  "thursday" said on Monday and "thursday" said on Friday are different
   *  Thursdays, and anchoring on `now` instead is the bug that makes her ask
   *  about a presentation that happened last month. */
  saidAt: number;
  /** an explicit date if the store has one (`vy_fact.t_valid`) */
  dueAt?: number | null;
  /** `vy_fact.citations` — episode ids. Empty for meera_nodes rows. */
  citations?: readonly (number | string)[];
}

export type Horizon = "behind" | "ahead" | "maybe_passed";
export type Basis = "dated" | "inferred" | "stale";

export interface MovedNote {
  id: string;
  /** ≤5 words, trimmed — the thing itself, never a sentence */
  subject: string;
  horizon: Horizon;
  /** "was thursday" / "tomorrow" / "told you 3 months ago" */
  when: string;
  basis: Basis;
  /** does the source row carry an episode citation */
  cited: boolean;
  /** resolved event time, ms, or null for `stale` */
  at: number | null;
}

/**
 * NOTE THE ABSENT FIELD. There is no `gapMs`, no `gapLabel`, no `sinceLabel`.
 * `hisClock()` consumes `lastSpokeAt` to compute a window and does not put it
 * in the result, so `renderHisClock()` — the only function here that produces
 * prompt text — structurally cannot emit it. persona.ts bans accounting for a
 * silence in the strongest terms it has; this is that ban enforced by a type
 * rather than by an instruction the model is asked to obey.
 */
export interface HisFrame {
  /** was ahead of him last time, is behind him now → ask how it went */
  moved: readonly MovedNote[];
  /** has NOT happened yet → never congratulate, never past-tense it */
  ahead: readonly MovedNote[];
  /** undated, old, time-shaped → may already have happened */
  maybePassed: readonly MovedNote[];
}

/** Below this the two turns are the same conversation and nothing has moved.
 *  Same number and same reasoning as inner.ts's GAP_ENTRY_MS: this is a
 *  RE-ENTRY block, not a per-turn one. A gate is not a write (G1). */
export const HIS_GAP_MIN_MS = 45 * 60_000;

export const MAX_MOVED = 2;
export const MAX_AHEAD = 1;
export const MAX_MAYBE = 1;

/** api/memory.js's staleNote horizon, unchanged: a dated fact older than this
 *  with no resolvable date is assumed to have passed. */
export const STALE_DAYS = 45;

/**
 * DELIBERATE DUPLICATE of api/memory.js's `TIME_BOUND`, character for
 * character. api/memory.js is a Vercel function outside the Vite build graph
 * and cannot import a TS engine file — the same constraint life.ts/api/life.js
 * and api/taste-queue.js already record. The duplication is not left to good
 * intentions: `evals/time/his.mjs` extracts BOTH literals from source and
 * fails if they ever differ by a character.
 */
export const TIME_BOUND =
  /\b(jan|feb|march|april|may|june|july|aug|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next|upcoming|soon|planning|plans?|will|shaadi|wedding|exam|interview|trip|due|deadline|weekend|birthday|\d{4}|\d{1,2}(st|nd|rd|th))\b/i;

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/** " lowercase words only, space padded " — the repo's shared whole-word
 *  matching convention (inner.ts, moment.ts, culture.ts). */
const padT = (s: string) =>
  " " +
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

/**
 * Resolve the DATE a time-bound fact points at, anchored on when it was said.
 *
 * Authored table, first match wins, deterministic — the same shape as every
 * other classifier in this repo (no model call, no runtime inference).
 *
 * ON "kal", WHICH IS AMBIGUOUS AND IS THE ONE CASE WORTH READING TWICE.
 * Hindi "kal" means both yesterday and tomorrow. This table takes the FUTURE
 * reading. That is safe in the only direction that matters here: if it really
 * meant yesterday, the resolved date is one day late and still lands in the
 * past, so the note is still "behind him" and the tense is still right. The
 * failure mode of the wrong reading is a date label off by two days, not a
 * congratulation for something that has not happened.
 */
export function resolveWhen(f: TimeBoundFact, now: number): { at: number | null; basis: Basis } | null {
  if (typeof f.dueAt === "number" && Number.isFinite(f.dueAt)) return { at: f.dueAt, basis: "dated" };

  const raw = `${f.name || ""} ${f.summary || ""}`;
  const hay = padT(raw);
  const anchor = f.saidAt;

  const rel = parseRelative(hay, raw, anchor);
  if (rel !== null) return { at: rel, basis: "inferred" };

  // no resolvable date: the existing staleNote rule, unchanged. `plan` and
  // `event` kinds are trusted without a keyword; anything else must match.
  const timeShaped = f.kind === "plan" || f.kind === "event" || TIME_BOUND.test(raw);
  if (timeShaped && now - anchor > STALE_DAYS * MS_DAY) return { at: null, basis: "stale" };
  return null;
}

function parseRelative(hay: string, raw: string, anchor: number): number | null {
  const day = (n: number) => anchor + n * MS_DAY;

  if (hay.includes(" day after tomorrow ") || hay.includes(" parso ") || hay.includes(" parson "))
    return day(2);
  if (hay.includes(" tomorrow ") || hay.includes(" kal ") || hay.includes(" tmrw ")) return day(1);
  if (
    hay.includes(" tonight ") ||
    hay.includes(" aaj raat ") ||
    hay.includes(" aaj shaam ") ||
    hay.includes(" today ") ||
    hay.includes(" aaj ")
  ) {
    // "tonight" is an evening, not a midnight: 8pm Bangalore on the day it
    // was said. The hour matters — a "tonight" said at 11pm must not resolve
    // to a moment already past by the time it is written down.
    return istMidnight(anchor) + 20 * 60 * 60_000;
  }
  if (hay.includes(" next week ") || hay.includes(" agle hafte ") || hay.includes(" agle week "))
    return day(7);
  if (hay.includes(" next month ") || hay.includes(" agle mahine ") || hay.includes(" agle month "))
    return day(30);
  if (hay.includes(" weekend ")) return nextDow(anchor, 6);

  const inN = /\bin\s+(\d{1,2})\s+(day|days|week|weeks|month|months)\b/i.exec(raw);
  if (inN) {
    const n = Number(inN[1]);
    const unit = inN[2].toLowerCase();
    const mult = unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : 1;
    return day(n * mult);
  }

  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (hay.includes(` ${DAY_NAMES[i]} `)) return nextDow(anchor, i);
  }

  // Month names, with ONE carve-out that is a real bug and not defensive
  // style: "may" is a modal verb far more often than it is a month, and
  // api/memory.js's own TIME_BOUND regex has the same hole. A bare "may" is
  // ignored; "may 14" is a date. Every other month name is unambiguous.
  //
  // ── THE SECOND CARVE-OUT (WS-O, 2026-08-26) ────────────────────────────
  // This pattern used to end each abbreviation with `[a-z]*`, meaning "the
  // three-letter prefix plus whatever follows it", so it matched the PREFIX
  // INSIDE ANY LONGER WORD. Measured over a plain word list: married→March,
  // marriage→March, marks→March, decade→December, decide→December,
  // declare→December, junior→June, novel→November, octopus→October,
  // septic→September, augment→August, aprons→April, janta→January.
  //
  // That is not a theoretical hole. `evals/recallbench`'s dyad-a carries the
  // row "younger sister, getting married in nashik in december", and the old
  // pattern read "married" as MARCH — resolving a December wedding to the
  // month the sentence was written in, five months BEHIND where it belongs.
  // It was invisible while `resolveWhen` had one consumer (hisClock, whose
  // output is a coarse label); it became visible the moment WS-O made the same
  // answer the stored `valid_to` that decides tense. In a product whose
  // students say "marks" in every third message, "marks"→March is the
  // load-bearing case.
  //
  // The alternation below admits ONLY the real completions of each month name
  // and closes with `\b`, so a month must be a whole word (or its standard
  // abbreviation, "sept." included) rather than a prefix of one. Capture group
  // 1 may now be a full name; every consumer already normalises it with
  // `.slice(0, 3)`, and the `may` carve-out below still compares the whole
  // token, which is exactly "may" either way.
  const md =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*(\d{1,2})?\b/i.exec(
      raw,
    );
  if (md && !(md[1].toLowerCase() === "may" && !md[2])) {
    const mi = MONTHS.indexOf(md[1].toLowerCase().slice(0, 3));
    const dom = md[2] ? Math.max(1, Math.min(28, Number(md[2]))) : 15;
    const a = new Date(anchor + IST_OFFSET_MIN * 60_000);
    let cand = Date.UTC(a.getUTCFullYear(), mi, dom, 12) - IST_OFFSET_MIN * 60_000;
    // a month already past when they said it means next year's one
    if (cand < anchor - 7 * MS_DAY) cand = Date.UTC(a.getUTCFullYear() + 1, mi, dom, 12) - IST_OFFSET_MIN * 60_000;
    return cand;
  }
  return null;
}

/** The next `target` weekday STRICTLY after `from`, at noon Bangalore. "on
 *  thursday" said on a Thursday means next Thursday, which is how people
 *  actually use it. */
function nextDow(from: number, target: number): number {
  const t = istParts(from);
  let delta = (target - t.dow + 7) % 7;
  if (delta === 0) delta = 7;
  return istMidnight(from) + delta * MS_DAY + 12 * 60 * 60_000;
}

function trimWords(s: string, maxWords: number, maxChars: number): string {
  const words = String(s || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let out = words.slice(0, maxWords).join(" ");
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, "");
  return out.trim();
}

/** Coarse, human, and it never names the GAP — only the event's own date.
 *  Within a week it uses the weekday, because "was thursday" is how a person
 *  refers to a thing that just happened and it is the label that makes the
 *  right question ("kaisa gaya") obvious. */
/** CALENDAR days, not 24-hour blocks. A Thursday-noon event asked about on
 *  Friday morning is 23 hours old and must read "was yesterday", not "earlier
 *  today" — the elapsed-hours version of this got the tense wrong on the very
 *  first end-to-end run of evals/time/his.mjs, which is what this comment is
 *  standing in for. Bangalore midnights, because they are her days. */
function daysBetween(a: number, b: number): number {
  return Math.round((istMidnight(b) - istMidnight(a)) / MS_DAY);
}

function pastLabel(at: number, now: number): string {
  const days = daysBetween(at, now);
  if (days <= 0) return "earlier today";
  if (days === 1) return "was yesterday";
  if (days < 7) return `was ${istParts(at).dayName}`;
  if (days < 14) return "was last week";
  if (days < 28) return `was ${Math.round(days / 7)} weeks back`;
  if (days < 45) return "was about a month back";
  return `was ${Math.max(2, Math.round(days / 30))} months back`;
}

function futureLabel(at: number, now: number): string {
  const days = daysBetween(now, at);
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `on ${istParts(at).dayName}`;
  if (days < 14) return "next week";
  if (days < 28) return `in ${Math.round(days / 7)} weeks`;
  if (days < 45) return "in about a month";
  return `in ${Math.max(2, Math.round(days / 30))} months`;
}

function toldLabel(saidAt: number, now: number): string {
  const days = daysBetween(saidAt, now);
  if (days < 45) return `told ${Math.max(1, Math.round(days / 7))} weeks back`;
  return `told ${Math.max(2, Math.round(days / 30))} months back`;
}

export interface HisClockInput {
  now: number;
  /** last message of the PREVIOUS conversation. 0/undefined = unknown, which
   *  widens the window to "everything up to now" — every dated thing they
   *  ever mentioned is then already behind them, which is true and is the
   *  right default for a first turn after a long absence. */
  lastSpokeAt?: number;
  facts: readonly TimeBoundFact[];
}

/**
 * HIS CLOCK. Pure. Consumes the gap, returns no gap (see `HisFrame`).
 *
 * The whole mechanism in one line: a fact whose date lands inside
 * (lastSpokeAt, now] was AHEAD of him the last time they spoke and is BEHIND
 * him now — so the right question is how it went, not whether he is ready.
 */
export function hisClock(input: HisClockInput): HisFrame {
  const now = input.now;
  const lastSpokeAt = Number.isFinite(input.lastSpokeAt) ? Number(input.lastSpokeAt) : 0;
  const empty: HisFrame = { moved: [], ahead: [], maybePassed: [] };

  // RE-ENTRY ONLY. Mid-conversation turns are seconds apart; nothing has
  // moved, and a block about the passage of time on a turn two minutes after
  // the last one is noise at best.
  if (now - lastSpokeAt < HIS_GAP_MIN_MS) return empty;

  const moved: MovedNote[] = [];
  const ahead: MovedNote[] = [];
  const maybePassed: MovedNote[] = [];

  for (const f of input.facts || []) {
    if (!f || !Number.isFinite(f.saidAt)) continue;
    const subject = trimWords(f.name || f.summary || "", 5, 44);
    if (subject.length < 2) continue;
    const r = resolveWhen(f, now);
    if (!r) continue;
    const cited = Array.isArray(f.citations) ? f.citations.length > 0 : false;
    const base = { id: String(f.id), subject, basis: r.basis, cited };

    if (r.at === null) {
      maybePassed.push({ ...base, horizon: "maybe_passed", when: toldLabel(f.saidAt, now), at: null });
    } else if (r.at > now) {
      ahead.push({ ...base, horizon: "ahead", when: futureLabel(r.at, now), at: r.at });
    } else if (r.at > lastSpokeAt) {
      moved.push({ ...base, horizon: "behind", when: pastLabel(r.at, now), at: r.at });
    }
    // r.at <= lastSpokeAt: it was already behind him last time they spoke.
    // Not news, and re-raising it is the "old plan announced as upcoming"
    // failure with the tense corrected but the impulse intact.
  }

  moved.sort((a, b) => (b.at || 0) - (a.at || 0));
  ahead.sort((a, b) => (a.at || 0) - (b.at || 0));

  return {
    moved: moved.slice(0, MAX_MOVED),
    ahead: ahead.slice(0, MAX_AHEAD),
    maybePassed: moved.length ? [] : maybePassed.slice(0, MAX_MAYBE),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. THE RENDERS — T14 `time.frame`. See docs/TIME.md for the slot ticket.
// ─────────────────────────────────────────────────────────────────────────
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║ RETIRED 2026-08-23 (WS-LIFECYCLE, wire-or-retire).                    ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// EVERYTHING IN THIS SECTION IS A DEAD WRITER AND IS NOW MARKED AS ONE.
// `HER_DAY_HEADER`, `HIS_CLOCK_HEADER`, `renderHerDay`, `renderHisClock`,
// `renderTimeFrame` and `timeFrame` have ZERO callers outside this file and
// `evals/time/`. There is no T14 `time.frame` row in compiler.ts's MANIFEST —
// not "unwired", not "not-yet-modeled": the slot was never adopted at all, so
// this whole layer has been rendering into nothing since the day it landed.
// That is `dead-writers`, fourth instance, and the WHOLE POINT of naming that
// family is that a block which exists and is connected to nothing produces
// false confidence: the budgets below are real, the worst-case arithmetic is
// real, the eval suite is real, and none of it has ever protected a byte that
// reached her.
//
// ── WHY RETIRED AND NOT WIRED ───────────────────────────────────────────
//
// The question asked was whether the DAY-SHAPE adds real value as herNow's
// DAY seam — i.e. whether `renderHerDay` should ride `brain.ts`'s
// `formatHerLife` next to `formatHerNow`. It does not, for two reasons, and
// the second is the decisive one:
//
//  1. THE OVERLAPPING HALF IS A SECOND ANSWER TO ONE QUESTION.
//     `right now: <slot note>` and herNow.ts's `- doing: <activity>` answer
//     "what is she doing this minute" from two different derivations. herNow
//     exists precisely because two answers to that question is the reported
//     bug ("reading a book" then "setting fairy lights", sixty seconds
//     apart), and its whole design — ONE entry, a real span, deterministic —
//     is built so a second answer is not a value the module can construct.
//     Putting a second renderer of the same fact into the SAME compiler slot
//     would hand back, in T7, the exact defect T7 was fixed to remove.
//
//  2. THE NON-OVERLAPPING HALF CANNOT BE DELIVERED AT ACCEPTABLE COST.
//     The genuinely additive parts are the clock `stamp` and `next` — herNow
//     computes successors internally and never renders one. But herNow.ts is
//     a NEAR-LEAF ON PURPOSE (see its import header): it takes `storyCatalog`
//     and nothing else, which is what lets `src/state/store.ts` hold its type
//     with an import that erases entirely. This file imports `./shapelint`,
//     which imports `./compiler` AND `./persona`. Importing timeline from
//     herNow drags the compiler and the persona into a module whose leaf-ness
//     is load-bearing for the engine bundle — the same cycle
//     (`persona -> storyCatalog -> timeline -> shapelint -> compiler ->
//     agents -> persona`) that broke it once already.
//
// So: no real value that can be delivered at a cost this repo should pay.
//
// ── WHAT REMAINS LIVE IN THIS FILE, AND IS NOT RETIRED ──────────────────
//
//   istParts()  — src/engine/away.ts, src/engine/sky.ts
//   herNow()    — src/components/HomeScreen.tsx (`dayNote`), as UI
//   scheduleFor / slotAt / the two schedules — herNow()'s own inputs
//
// The day-shape survives where a day-shape belongs: on the screen, and as the
// slot structure `storyCatalog` (and through it herNow.ts) is built on. What
// is retired is only its PROMPT RENDER.
//
// ── HOW THIS RETIREMENT IS ENFORCED, SO IT IS NOT JUST A COMMENT ────────
//
// `evals/lifecycle/run.mjs` §5 asserts that no file under `src/` imports any
// retired symbol. A tombstone nobody can violate is a retirement; a tombstone
// anybody can quietly step over is decoration, and this repo has a name for
// that too.
//
// ── WHAT WOULD REVERSE IT ───────────────────────────────────────────────
//
// The dated-fact half (`hisClock` -> `renderHisClock`: "the exam he told you
// about on Monday is behind him now") is NOT covered by anything shipping —
// T9 `renderAway` carries facts about the CLOCK and the gap, never about his
// dated commitments. If that is wanted, it comes back as a real compiler slot
// with a MANIFEST row and a column in `evals/lanes/run.mjs`'s parity table —
// never as a render function with no caller. That is the reversal condition,
// and it is deliberately a higher bar than "uncomment it".
//
// NOT DELETED, and the reason is ownership rather than doubt: `evals/time/`
// (982 lines, four suites plus a source-mutating negative control) is
// WS-TIME's, and ~340 of those lines assert against the symbols below. Ripping
// them out from this workstream would take the negative control that still
// guards the LIVE half down with them. The deletion is a WS-TIME task; the
// tombstone and the zero-importer gate are what make the retirement real in
// the meantime.

/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export const HER_DAY_BUDGET = 800;
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export const HIS_CLOCK_BUDGET = 800;
/** T14 `time.frame`. See docs/TIME.md for the coordinator ticket and the
 *  arithmetic against SPEC-SELF-LAYER §8's 2,800 remaining headroom. */
export const TIME_FRAME_BUDGET = 1_600;

/**
 * Instructional English, like every other tail header in this repo — which is
 * exactly why it is not a `recited-prompt` surface (shapelint's content rules
 * run over the ROWS, which are telegraphic k:v, not over headers).
 *
 * Three jobs, all load-bearing:
 *  - it says what the block IS (where she is in her own day),
 *  - it says what the block IS NOT (a mood, an announcement, a script),
 *  - it states the continuity rule the owner actually reported missing: what
 *    she said she was doing four minutes ago is still what she is doing.
 */
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export const HER_DAY_HEADER =
  "WHERE YOU ARE IN YOUR OWN DAY (context only, never announced, never a topic you open). " +
  "Notes to talk from, never lines to say — your own words, different every time. " +
  "WHERE you are and WHAT you are doing, never how you feel about it. " +
  "A day moves in order: what you were doing a few minutes ago is still what you are doing, " +
  "and the next thing follows it — you never jump. " +
  "Anything you already told them about today outranks this.";

/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export const HIS_CLOCK_HEADER =
  "THEIR CLOCK — WHAT HAS MOVED IN THEIR LIFE (context only, never news, never a list to get through). " +
  "Time passed for them: anything marked behind them is DONE, so it is asked about in the past — " +
  "how it went — never as if it is still coming. " +
  "Still ahead means it has NOT happened: never congratulate it, never past-tense it. " +
  "The silence itself is never a subject — no counting days, no noticing they were gone, no accounting of any kind. " +
  "At most one of these, only where it fits.";

function finish(lines: string[], header: string, budget: number): RenderResult {
  const text = lines.length ? `${header}\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
  const lint = lintBlock(lines.join("\n"));
  const violations = lint.violations.length + (text.length > budget ? 1 : 0);
  return { text, lint: { clean: violations === 0, violations } };
}

/** T14a. Always present (she is always somewhere in her day) — this is the
 *  one block in the tail that is not gated on a gap, because the bug it fixes
 *  is a MID-CONVERSATION contradiction. */
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export function renderHerDay(frame: HerFrame): RenderResult {
  const lines = [`time: ${frame.stamp}`, `right now: ${frame.note}`];
  if (frame.next) lines.push(`next: ${frame.next}`);
  for (const b of frame.today) lines.push(`earlier today: ${b}`);
  return finish(lines, HER_DAY_HEADER, HER_DAY_BUDGET);
}

/** T14b. Gap-gated inside `hisClock()`; empty on every mid-conversation turn
 *  and on every turn where nothing of his has a date that moved. */
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export function renderHisClock(frame: HisFrame): RenderResult {
  const lines: string[] = [];
  for (const n of frame.moved) lines.push(`behind them now: ${n.subject} (${n.when})`);
  for (const n of frame.ahead) lines.push(`still ahead: ${n.subject} (${n.when})`);
  for (const n of frame.maybePassed) lines.push(`may have passed: ${n.subject} (${n.when})`);
  return finish(lines, HIS_CLOCK_HEADER, HIS_CLOCK_BUDGET);
}

/** The T14 slot as one string: her day, then his clock. One slot because they
 *  are one subject and they are read together; two render functions because
 *  they have different gates and only one of them may ever see the gap. */
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export function renderTimeFrame(her: HerFrame, his: HisFrame): RenderResult {
  const a = renderHerDay(her);
  const b = renderHisClock(his);
  const text = [a.text, b.text].filter(Boolean).join("\n\n");
  const violations = a.lint.violations + b.lint.violations + (text.length > TIME_FRAME_BUDGET ? 1 : 0);
  return { text, lint: { clean: violations === 0, violations } };
}

/**
 * THE BUDGET IS NOT A HOPE. Same discipline as life.ts's
 * UNTOLD_WORST_CASE_CHARS: the longest block each render can physically
 * produce, computed from the caps rather than measured on a lucky fixture,
 * and asserted against the budget by evals/time/her.mjs. A render function
 * that can exceed its own budget makes the compiler's drop machinery the only
 * thing between a long row and a silently truncated prompt — and
 * `silent-truncation` eats the END of the tail, where the newest and most
 * safety-relevant text sits.
 */
const ROW_OVERHEAD = 3; // "\n" + "- "
const MAX_SUBJECT_CHARS = 44;
const MAX_WHEN_CHARS = 22; // "(told 12 months back)"
export const HER_DAY_WORST_CASE_CHARS =
  HER_DAY_HEADER.length +
  (ROW_OVERHEAD + 40) + // time stamp
  (ROW_OVERHEAD + 11 + MAX_BEAT_CHARS) + // right now: <beat>
  (ROW_OVERHEAD + 30) + // next: <label>
  MAX_TODAY_BEATS * (ROW_OVERHEAD + 15 + MAX_BEAT_CHARS); // earlier today: <beat>
export const HIS_CLOCK_WORST_CASE_CHARS =
  HIS_CLOCK_HEADER.length +
  MAX_MOVED * (ROW_OVERHEAD + 17 + MAX_SUBJECT_CHARS + MAX_WHEN_CHARS) +
  MAX_AHEAD * (ROW_OVERHEAD + 17 + MAX_SUBJECT_CHARS + MAX_WHEN_CHARS);

/** One call for a caller that has both halves. `beats` defaults to `[]`,
 *  which is the live state of `vy_agent_life` today. */
/** @deprecated RETIRED 2026-08-23 — see the tombstone above. */
export function timeFrame(input: {
  now: number;
  lastSpokeAt?: number;
  beats?: readonly DatedBeat[];
  facts?: readonly TimeBoundFact[];
}): { her: HerFrame; his: HisFrame; render: RenderResult } {
  const her = herNow(input.now, input.beats || []);
  const his = hisClock({ now: input.now, lastSpokeAt: input.lastSpokeAt, facts: input.facts || [] });
  return { her, his, render: renderTimeFrame(her, his) };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. THE AUDIT — G8 and `recited-prompt`, mechanized so they outlive their
//    author. `evals/time/her.mjs` fails the gate on any violation.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Feeling words. A day note containing one has stopped saying what time it is
 * and started saying how she feels, which is the exact line G8 draws and the
 * exact thing inner.ts's thread already owns. Hinglish included, because the
 * rule is about meaning and half of her vocabulary is not English.
 */
export const MOOD_WORDS: readonly string[] = Object.freeze([
  "tired", "exhausted", "drained", "sleepy", "sad", "happy", "lonely",
  "anxious", "anxiety", "upset", "annoyed", "irritated", "angry",
  "excited", "bored", "moody", "cranky", "restless", "miserable",
  "gloomy", "cheerful", "stressed", "overwhelmed", "miss", "missing", "sulking",
  "hurt", "guilty", "lazy", "unbothered", "mood", "feeling",
  "feel", "thak", "thaki", "udaas", "akela", "akeli", "gussa", "pareshan",
  "bore", "khush", "dukhi", "mann",
]);

/**
 * THE HOMOGRAPHS, and this list is the reason the ban is two lists instead of
 * one. "flat" is where she lives, "down" is which way the phone is lying,
 * "low" is a battery, "alone" is who is home, "content" is what is on a
 * screen, "calm" is what a street is. Banning the bare word produced five
 * false positives on the first run of this file's own audit — and a lint that
 * cries wolf gets worked around, which costs more than the rule was worth.
 * These are banned only in their FEELING sense, matched as phrases.
 */
export const MOOD_PHRASES: readonly string[] = Object.freeze([
  "feeling flat", "a bit flat", "feeling down", "a bit down", "feeling low",
  "a bit low", "feeling alone", "so alone", "not calm", "feeling calm",
  "mood off", "man nahi", "mann nahi",
]);

export interface AuditReport {
  clean: boolean;
  problems: string[];
  notesChecked: number;
}

/** Every authored note, checked against every rule this file claims to hold:
 *  shapelint's content rules, the ≤MAX_NOTE_WORDS cap, the mood ban (G8), and
 *  the structural claim that each schedule is a subsequence of DAY_ORDER. */
export function auditNotes(): AuditReport {
  const problems: string[] = [];
  let notesChecked = 0;

  for (const [name, sched] of [
    ["weekday", WEEKDAY_SCHEDULE],
    ["weekend", WEEKEND_SCHEDULE],
  ] as const) {
    // subsequence of DAY_ORDER
    let cursor = -1;
    for (const def of sched) {
      const idx = DAY_ORDER.indexOf(def.key);
      if (idx <= cursor) problems.push(`${name}: ${def.key} is out of DAY_ORDER`);
      cursor = idx;
    }
    // boundaries ascending and total
    let prev = 0;
    for (const def of sched) {
      if (def.endMin <= prev) problems.push(`${name}: ${def.key} endMin ${def.endMin} not ascending`);
      if (def.endMin - prev < 60)
        problems.push(`${name}: ${def.key} is shorter than an hour (${def.endMin - prev}m)`);
      prev = def.endMin;
    }
    if (prev !== 1440) problems.push(`${name}: schedule ends at ${prev}, not 1440`);

    for (const def of sched) {
      if (!def.notes.length) problems.push(`${name}/${def.key}: no notes`);
      for (const note of def.notes) {
        notesChecked++;
        const words = note.trim().split(/\s+/).filter(Boolean);
        if (words.length > MAX_NOTE_WORDS)
          problems.push(`${name}/${def.key}: ${words.length} words > ${MAX_NOTE_WORDS} — "${note}"`);
        const lint = lintBlock(note);
        for (const v of lint.violations) problems.push(`${name}/${def.key}: ${v.reasons.join("; ")} — "${note}"`);
        for (const w of moodWordsIn(note)) {
          problems.push(`${name}/${def.key}: mood word "${w}" — a calendar is not a mood engine (G8) — "${note}"`);
        }
      }
    }
  }
  return { clean: problems.length === 0, problems, notesChecked };
}

/** The same mood ban applied to RENDERED text, so a beat arriving from
 *  `vy_agent_life` cannot smuggle in what the authored table cannot. Exported
 *  because the eval runs it over every rendered block in the sweep. */
export function moodWordsIn(text: string): string[] {
  const hay = padT(text);
  return [
    ...MOOD_WORDS.filter((w) => hay.includes(` ${w} `)),
    ...MOOD_PHRASES.filter((p) => hay.includes(` ${p} `)),
  ];
}
