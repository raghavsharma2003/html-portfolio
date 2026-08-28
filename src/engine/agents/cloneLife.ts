// A PUBLISHED CLONE'S OWN LIFE — WS-Q.
//
// ── the finding this file answers ────────────────────────────────────────
//
// The engine already holds an aliveness stack, and almost all of it is
// character-agnostic: `texture.ts`, `selfarc.ts`, `repeat.ts`, `away.ts`,
// `moment.ts`, `reciprocity.ts` derive everything they render from ROWS and
// TRANSCRIPTS, so a clone gets them the moment a clone's rows exist. Exactly
// one layer is bound to Meera by CONTENT rather than by shape: the answer to
// "what is this person plausibly doing right now".
//
// That layer lives in two files and neither can serve a clone:
//
//   `timeline.ts`  — WEEKDAY_SCHEDULE / WEEKEND_SCHEDULE are hardcoded notes
//                    for a 24-year-old designer in Bangalore ("at the desk,
//                    standup done, first file open"). Its prompt render was
//                    RETIRED 2026-08-23 as a dead writer and is enforced-dead
//                    by `evals/lifecycle/run.mjs` §5, so it is not a seam a
//                    clone could be added to — it is a tombstone.
//   `herNow.ts`    — STORY_ACTIVITY / SLOT_FALLBACK / SUCCESSOR are keyed to
//                    `storyCatalog.ts`'s pictures ("book open on the razai",
//                    "chai on the balcony rail"). It IS live, and it is
//                    reached only through `brain.ts` and `useCallEngine.ts`,
//                    which are Meera's client surfaces and compile with no
//                    `agent` at all.
//
// So this module is neither of those extended: it is the same QUESTION asked
// of SHEET DATA. A clone's plausible present comes from its own sheet, the way
// its register, its arc and its crisis lines already do.
//
// ── what is carried forward from herNow.ts, deliberately ─────────────────
//
// herNow.ts exists because a roll re-rolls: he called, she said she was
// reading; he called back sixty seconds later and she was setting fairy
// lights. Both answers were legal and nothing held the one she had already
// given. The fix there was a LEDGER with one row. The fix here is stronger and
// needs no ledger at all, because a clone's day is authored as SLOTS:
//
//   `cloneNowAt(shape, nowMs)` is a PURE FUNCTION of (shape, wall clock).
//   Inside one slot on one date it returns the same entry, byte for byte,
//   however many times it is called, on however many devices, with no storage
//   anywhere. A second answer is not a value this module can construct — the
//   same device inner.ts used to make a causeless mood unrepresentable.
//
// Two calls four minutes apart therefore agree BY CONSTRUCTION rather than by
// a record being consulted, which is also why there is no writer here, no
// `QueryFn`, and no module-level mutable state.
//
// ── G8, inherited verbatim from timeline.ts ──────────────────────────────
//
// A CALENDAR IS NOT A MOOD ENGINE. Every authored note a sheet supplies is a
// place, a posture or an activity, never how the clone feels about it. The
// publish-time validator (`fromSheet.ts`) runs `timeline.ts`'s own MOOD_WORDS
// check over these rows, so the rule survives its author the same way
// `auditNotes()` makes it survive Meera's.
//
// ── recited-prompt ───────────────────────────────────────────────────────
//
// Everything below that reaches a model is TELEGRAPHIC and third-person. The
// sheet stores note SHAPES ("desk, second batch's doubt sheet open"), never
// sentences, and this file never inflates one into a line. `shapelint.lintLine`
// runs over every row at publish time. Measured twice on this codebase: example
// quotes acted as a phrase bank recited 4/5 turns; taste written as polished
// English was read out verbatim twice, eight turns apart.
//
// ── LEAF RULE ────────────────────────────────────────────────────────────
//
// This file imports NOTHING. Not shapelint (which pulls in compiler.ts and
// persona.ts), not teacherTypes, not the registry. compiler.ts imports it, and
// `fromSheet.ts` → `shapelint` → `compiler` is already a live edge — one more
// hop from this file would close the cycle that broke the engine bundle once
// (`storyCatalog.ts:41-42` records the identical hazard from the other side).

/** Minutes since local midnight at which a slot ENDS. Ascending; the last slot
 *  in a shape must end at 1440, which `validateCloneLife` enforces so
 *  `slotAtMinute` is total by construction rather than by a fallback. */
export const MINUTES_IN_DAY = 1440;

/** A named stretch of a clone's ordinary day. */
export interface CloneDaySlot {
  /** stable key, telegraphic, used for the "next:" marker and for continuity */
  key: string;
  /** minutes since local midnight at which this slot ends; last must be 1440 */
  untilMin: number;
  /** one or two words naming what is ABOUT to start */
  label: string;
  /** authored, telegraphic, ACTIVITY ONLY (G8). One is chosen per (date, slot)
   *  by hash — never at random, so two readers agree with no state between. */
  notes: readonly string[];
}

/**
 * One weekly commitment. `dow` is 0=Sunday..6=Saturday, matching
 * `Date.prototype.getUTCDay()` and `timeline.ts`'s own convention.
 *
 * Telegraphic and factual: "batch 2 doubt session, 8pm" — never "I take the
 * second batch's doubts at eight".
 */
export interface CloneWeekBeat {
  dow: number;
  what: string;
}

/**
 * The whole of a clone's background life, as DATA. Everything here comes from
 * the sheet; nothing is authored in this file, which is the property that
 * makes this module character-agnostic rather than a second Meera.
 */
export interface CloneLifeShape {
  /** Mon–Fri shape. Must be a non-empty ascending cover of the day. */
  weekdayShape: readonly CloneDaySlot[];
  /** Sat/Sun shape. Deliberately a SEPARATE, usually SHORTER cover rather than
   *  a shifted one — the work slots simply do not exist on a Sunday. */
  weekendShape: readonly CloneDaySlot[];
  /** what recurs every week, by day. Rendered only for TODAY. */
  weeklyRhythm: readonly CloneWeekBeat[];
  /** what is on this person's mind THIS PERIOD — telegraphic facts, not moods.
   *  Rotated by ISO week rather than per turn: a preoccupation that changed
   *  every message would be a mood ring, and one that never changed would be a
   *  catchphrase. */
  preoccupations: readonly string[];
  /** minutes east of UTC for this clone's local clock (IST = 330). Stored per
   *  clone rather than assumed, because a teacher in Kota and a teacher in
   *  Dubai are both plausible publishers and neither may inherit the other's
   *  midnight. */
  tzOffsetMin: number;
}

/** How close to a slot boundary counts as "about to change". Inside this window
 *  the block also names what is NEXT, so two turns straddling a boundary read
 *  as a day moving rather than as two unrelated answers. Same constant and same
 *  reason as `timeline.ts`'s TRANSITION_MIN. */
export const CLONE_TRANSITION_MIN = 25;

/** The resolved present. No `startedAt` field is stored anywhere and none is
 *  needed: `slotStartMin` and the date ARE the start, recomputable by anyone
 *  holding the same shape and the same clock. */
export interface CloneNowEntry {
  /** yyyy-mm-dd in the clone's own local zone — the continuity key */
  dateKey: string;
  /** 0=Sun..6=Sat, local */
  dow: number;
  /** minutes since local midnight */
  minuteOfDay: number;
  slotKey: string;
  slotStartMin: number;
  slotEndMin: number;
  /** the chosen note for this (dateKey, slotKey) — stable inside the slot */
  note: string;
  /** what starts next, or "" when the boundary is not close */
  next: string;
  /** this period's preoccupation, or "" when the sheet supplies none */
  preoccupation: string;
  /** today's weekly beats, telegraphic, in sheet order */
  todayBeats: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// determinism
// ─────────────────────────────────────────────────────────────────────────

/** FNV-1a, 32-bit. Same family as `compiler.hashCore`, duplicated rather than
 *  imported for the leaf rule above: four lines of arithmetic is a cheaper
 *  price than an import edge into compiler.ts. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Local calendar parts for a clone's own offset. */
export function localParts(nowMs: number, tzOffsetMin: number): {
  dateKey: string;
  dow: number;
  minuteOfDay: number;
} {
  const shifted = new Date(nowMs + tzOffsetMin * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return {
    dateKey: `${y}-${m}-${d}`,
    dow: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Which shape applies. Sat/Sun get the weekend cover — and deliberately NOT
 *  "Friday evening counts as the weekend", for `timeline.ts`'s reason: two
 *  functions describing the same Friday is the two-sources-of-truth shape this
 *  repo keeps having to fix. */
export function shapeForDow(shape: CloneLifeShape, dow: number): readonly CloneDaySlot[] {
  const weekend = dow === 0 || dow === 6;
  const chosen = weekend ? shape.weekendShape : shape.weekdayShape;
  // A sheet that filled only one cover still answers every hour rather than
  // rendering nothing on a Sunday — falling back to the other cover is the
  // fail-open direction for a NICETY, and the validator is what stops a sheet
  // shipping with neither.
  return chosen.length ? chosen : weekend ? shape.weekdayShape : shape.weekendShape;
}

/** Total by construction when the cover is valid; clamped otherwise so a
 *  malformed sheet degrades to its last slot instead of throwing at a student. */
function slotAtMinute(
  slots: readonly CloneDaySlot[],
  minuteOfDay: number,
): { slot: CloneDaySlot; index: number; startMin: number } | null {
  if (!slots.length) return null;
  const m = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.floor(minuteOfDay)));
  let startMin = 0;
  for (let i = 0; i < slots.length; i++) {
    if (m < slots[i].untilMin) return { slot: slots[i], index: i, startMin };
    startMin = slots[i].untilMin;
  }
  const i = slots.length - 1;
  return { slot: slots[i], index: i, startMin };
}

/**
 * The clone's present, as a pure function of its shape and the wall clock.
 *
 * Returns `null` when the sheet carries no life shape at all — the
 * render-nothing default, and the reason an incumbent agent (Meera, Kabir)
 * moves ZERO bytes through this seam.
 */
export function cloneNowAt(shape: CloneLifeShape | null | undefined, nowMs: number): CloneNowEntry | null {
  if (!shape) return null;
  const { dateKey, dow, minuteOfDay } = localParts(nowMs, shape.tzOffsetMin || 0);
  const slots = shapeForDow(shape, dow);
  const hit = slotAtMinute(slots, minuteOfDay);
  if (!hit) return null;

  const notes = hit.slot.notes.filter((n) => typeof n === "string" && n.trim());
  // Keyed on (dateKey, slotKey) and NOT on the minute: a note that re-rolled
  // within its own slot would reproduce the exact defect herNow.ts was built
  // to close, one layer up.
  const note = notes.length ? notes[hash32(`${dateKey}|${hit.slot.key}`) % notes.length] : "";

  const nearBoundary = hit.slot.untilMin - minuteOfDay <= CLONE_TRANSITION_MIN;
  const nextSlot = slots[(hit.index + 1) % slots.length];
  const next = nearBoundary ? hit.slot.label || nextSlot.key : "";

  // Rotated by ISO-ish week (day number / 7), so it holds for a week and then
  // moves. A preoccupation is what someone is chewing on this fortnight, not a
  // per-turn draw and not a permanent trait.
  const preoccupations = shape.preoccupations.filter((p) => typeof p === "string" && p.trim());
  const weekIndex = Math.floor((nowMs + (shape.tzOffsetMin || 0) * 60_000) / (7 * 24 * 60 * 60_000));
  const preoccupation = preoccupations.length
    ? preoccupations[Math.abs(weekIndex) % preoccupations.length]
    : "";

  const todayBeats = shape.weeklyRhythm
    .filter((b) => b && b.dow === dow && typeof b.what === "string" && b.what.trim())
    .map((b) => b.what.trim());

  return {
    dateKey,
    dow,
    minuteOfDay,
    slotKey: hit.slot.key,
    slotStartMin: hit.startMin,
    slotEndMin: hit.slot.untilMin,
    note,
    next,
    preoccupation,
    todayBeats,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// the render — T18 `clone.now`
// ─────────────────────────────────────────────────────────────────────────

/** Header (~300) + at most four telegraphic rows. Sized so the ROW CAPS bind,
 *  never the budget: a silently dropped row would make the block disagree with
 *  itself between two turns, which is the one thing this whole layer exists to
 *  prevent. */
export const CLONE_NOW_BUDGET = 560;

/** At most this many of today's weekly beats render. Two is a day with things
 *  in it; five is a calendar read aloud. */
export const MAX_TODAY_BEATS = 2;

/**
 * Instructional English, like every other tail header in this repo — which is
 * why it is not itself a `recited-prompt` surface (the content lints run over
 * the ROWS, which are telegraphic, never over headers).
 *
 * Three jobs, each load-bearing:
 *  - what the block IS (where this person is in their own day),
 *  - what it IS NOT (a mood, an announcement, a topic to open),
 *  - the continuity rule: a day moves in order and what they said four minutes
 *    ago is still true.
 */
export const CLONE_NOW_HEADER =
  "WHERE YOU ARE IN YOUR OWN DAY (background only, never announced, never a topic you open). " +
  "Notes to talk from, never lines to say — your own words, different every time. " +
  "WHERE you are and WHAT you are doing, never how you feel about it. " +
  "A day moves in order: what you were doing a few minutes ago is still what you are doing. " +
  "Anything you have already told them about today outranks this, and their question always outranks all of it.";

/** Renders the block, or "" when there is nothing to say. Never slices: rows
 *  are dropped whole from the least load-bearing end, because "a sliced block
 *  is a lie" does not stop applying inside a block. */
export function renderCloneNow(entry: CloneNowEntry | null | undefined): string {
  if (!entry) return "";
  const rows: string[] = [];
  if (entry.note) rows.push(`- right now: ${entry.note}`);
  if (entry.next) rows.push(`- next: ${entry.next}`);
  for (const beat of entry.todayBeats.slice(0, MAX_TODAY_BEATS)) rows.push(`- today: ${beat}`);
  if (entry.preoccupation) rows.push(`- on your mind lately: ${entry.preoccupation}`);
  if (!rows.length) return "";

  let kept = rows;
  while (kept.length && CLONE_NOW_HEADER.length + 1 + kept.join("\n").length > CLONE_NOW_BUDGET) {
    kept = kept.slice(0, -1);
  }
  if (!kept.length) return "";
  return `${CLONE_NOW_HEADER}\n${kept.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// structural validation — the half a TYPE cannot hold
// ─────────────────────────────────────────────────────────────────────────

export interface CloneLifeProblem {
  field: string;
  code: string;
  detail?: string;
}

/**
 * Shape-level checks only. The CONTENT lints (shapelint, mood words) run in
 * `fromSheet.ts`, which already imports shapelint and already owns the publish
 * gate — putting them here would need an import this file may not have, and
 * two validators for one field is how one of them drifts.
 */
export function validateCloneLife(shape: unknown): readonly CloneLifeProblem[] {
  const problems: CloneLifeProblem[] = [];
  if (!shape || typeof shape !== "object") {
    return [{ field: "life", code: "clone-life-missing" }];
  }
  const s = shape as Record<string, unknown>;

  const cover = (field: string, value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      problems.push({ field, code: "day-shape-empty" });
      return;
    }
    let prev = 0;
    value.forEach((raw, i) => {
      const slot = raw as Partial<CloneDaySlot>;
      if (!slot || typeof slot.key !== "string" || !slot.key.trim()) {
        problems.push({ field, code: "slot-key-missing", detail: String(i) });
      }
      if (typeof slot.untilMin !== "number" || !Number.isInteger(slot.untilMin)) {
        problems.push({ field, code: "slot-until-not-an-integer", detail: String(i) });
        return;
      }
      // Ascending and strictly increasing, so "which slot is it" has exactly
      // one answer. A repeated boundary is a slot that can never be reached.
      if (slot.untilMin <= prev) {
        problems.push({ field, code: "slot-boundaries-not-ascending", detail: `${prev} -> ${slot.untilMin}` });
      }
      prev = slot.untilMin;
      if (!Array.isArray(slot.notes) || slot.notes.length === 0) {
        problems.push({ field, code: "slot-notes-empty", detail: String(slot.key) });
      }
      if (typeof slot.label !== "string" || !slot.label.trim()) {
        problems.push({ field, code: "slot-label-missing", detail: String(slot.key) });
      }
    });
    // The last boundary MUST be midnight. Without it `slotAtMinute` has an
    // unreachable tail of the day and the clone's evening silently becomes its
    // afternoon — a `silent-truncation` in a calendar.
    if (prev !== MINUTES_IN_DAY) {
      problems.push({ field, code: "day-shape-does-not-cover-midnight", detail: String(prev) });
    }
  };

  cover("life.weekdayShape", s.weekdayShape);
  cover("life.weekendShape", s.weekendShape);

  if (!Array.isArray(s.weeklyRhythm)) {
    problems.push({ field: "life.weeklyRhythm", code: "not-an-array" });
  } else {
    for (const raw of s.weeklyRhythm) {
      const beat = raw as Partial<CloneWeekBeat>;
      if (!beat || typeof beat.dow !== "number" || beat.dow < 0 || beat.dow > 6) {
        problems.push({ field: "life.weeklyRhythm", code: "beat-dow-out-of-range", detail: String(beat?.dow) });
      }
      if (!beat || typeof beat.what !== "string" || !beat.what.trim()) {
        problems.push({ field: "life.weeklyRhythm", code: "beat-what-empty" });
      }
    }
  }

  if (!Array.isArray(s.preoccupations) || s.preoccupations.length === 0) {
    problems.push({ field: "life.preoccupations", code: "preoccupations-empty" });
  }

  if (typeof s.tzOffsetMin !== "number" || !Number.isInteger(s.tzOffsetMin) ||
      s.tzOffsetMin < -720 || s.tzOffsetMin > 840) {
    problems.push({ field: "life.tzOffsetMin", code: "tz-offset-out-of-range", detail: String(s.tzOffsetMin) });
  }

  return problems;
}

/** Every authored row a sheet's life shape contributes, flattened, so the
 *  publish gate can run the content lints over all of them in one pass without
 *  re-deriving this traversal in three places. */
export function cloneLifeRows(shape: CloneLifeShape | null | undefined): readonly string[] {
  if (!shape) return [];
  const rows: string[] = [];
  for (const cover of [shape.weekdayShape, shape.weekendShape]) {
    for (const slot of cover || []) for (const note of slot?.notes || []) rows.push(String(note));
  }
  for (const beat of shape.weeklyRhythm || []) if (beat?.what) rows.push(String(beat.what));
  for (const p of shape.preoccupations || []) rows.push(String(p));
  return rows;
}
