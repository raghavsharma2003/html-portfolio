// Where finished practice sets go once a session ends — the durable list
// `MasteryMap.tsx` folds into per-topic mastery, and `PracticeActivity.tsx`
// appends to when a set closes.
//
// ── why local storage, and why this is not `state/store.ts` ───────────────
//
// WS-D is scoped to the practice hub and mastery map SCREENS on top of the
// wave-1 engine — it does not extend to wiring a practice session into
// `AppState.game` (the live-call reconciler chess/ttt/wyr already share) or
// into the compiler's activity ledger, both of which are separate, larger
// surfaces (the call lane, `activityNote()` pokes mid-call, the honesty
// allowlist) that no file in this workstream's brief names. So the record
// this file keeps is deliberately SCREEN-scoped rather than session-scoped:
// it survives reload the way `clock.ts`'s own mirror does (same idiom —
// `try/catch` around every read and write, in-memory state still runs if
// storage is absent), but it does not reach the prompt, the live lane, or her
// memory. Wiring a finished set into the relationship record proper (so she
// can bring it up unprompted, per `student-app-spec.md` §3.4) is real future
// work and is out of THIS workstream's scope on purpose.
//
// Every entry here is XP the way `milestones.ts`'s counters are: SUMMED from
// a graded record, never estimated, never decayed by time — see
// `engine/practice/mastery.ts`'s header on "no decay-by-absence".

import type { Graded, PracticeSession, PracticeSummary } from "../engine/practice/session";
import { summarize } from "../engine/practice/session";
import { xpFromGraded } from "../engine/practice/mastery";

export interface PracticeHistoryEntry {
  summary: PracticeSummary;
  /** XP earned by THIS set — `xpFromGraded`, summed once here rather than
   *  re-derived from `summary` every render, because `summary.byTopic` does
   *  not preserve enough per-attempt detail (verdict, specifically) to
   *  exclude rushed attempts the way XP must — see `mastery.ts`. */
  xp: number;
  completedAt: number;
}

const STORE_KEY = "gurukul.practice.history.v1";
const MAX_ENTRIES = 500; // generous; this is a demo bank, not a year of mocks

function read(): PracticeHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PracticeHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: readonly PracticeHistoryEntry[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full/absent — the session that just ran still showed its
     *  summary on screen; only cross-session history is lost */
  }
}

/** Every finished set, oldest first — the order `foldMastery` and any future
 *  reader wants (folding is order-independent, but "oldest first" is the one
 *  order a person reading raw history actually expects). */
export function practiceHistory(): readonly PracticeHistoryEntry[] {
  return read().sort((a, b) => a.completedAt - b.completedAt);
}

/** Only the graded fold's input — a thin projection so `MasteryMap` never has
 *  to know this file's on-disk shape. */
export function practiceSummaries(): readonly PracticeSummary[] {
  return practiceHistory().map((e) => e.summary);
}

export function totalXp(): number {
  return practiceHistory().reduce((sum, e) => sum + e.xp, 0);
}

/**
 * Record a FINISHED session. No-op on a session that is not over — an
 * in-progress set has no summary worth keeping, and `session.ts`'s own
 * `summarize()` is written against a settled `graded` list.
 *
 * `graded` is passed separately from `session` even though `session.graded`
 * exists, so a caller can pass exactly what XP should be computed over
 * without this file re-deriving it — same "the caller derives, this file
 * only stores" split `clock.ts`'s `post()` keeps from `beat()`.
 */
export function recordPracticeSession(session: PracticeSession, graded: readonly Graded[]): PracticeHistoryEntry | null {
  if (!session.over) return null;
  const entry: PracticeHistoryEntry = {
    summary: summarize(session),
    xp: xpFromGraded(graded),
    completedAt: Date.now(),
  };
  write([...read(), entry]);
  return entry;
}

/** Test/dev escape hatch — mirrors `clock.ts`'s `__resetClockForTest`. */
export function __resetPracticeHistoryForTest() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* no storage in this environment */
  }
}
