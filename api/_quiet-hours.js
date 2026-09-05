// api/_quiet-hours.js — the follower's own quiet hours, ONE fragment,
// spliced into every proactive due-select (WS-R129: "quiet hours on every
// channel"). Pure: no imports of its own, so any module — `_checkins.js`,
// `_renewals.js`, `_dormancy.js`, and whatever proactive sender is built
// next — can splice this into a template literal with no import-cycle risk,
// the same discipline `_checkins.js`'s own "re-derived rather than
// imported" helpers already name for a reason (this repo's own house style,
// `ownedRoomHandle`'s header).
//
// ── THE GAP THIS FILE DOES NOT CLOSE ────────────────────────────────────────
//
// The follower's own row carries NO timezone or quiet-hours column of its
// own (checked against db/schema.sql before writing this file — the only
// migration that ever added `quiet_from`/`quiet_to`/`timezone` is 085, and
// all three live on `vy_room_checkin`, one row per check-in SCHEDULE, not
// one row per follower). There is therefore no data source in this schema
// today for "the follower's own quiet hours" that does not already require a
// join through `vy_room_checkin` — see context/rejected.md#ws-r129-no-
// follower-level-timezone-or-quiet-hours-column for the full argument and
// what would close it (a migration adding those three columns to the
// follower's own row directly — NOT taken by this workstream: 133 belongs to
// WS-R130, and a workstream never takes a number its own brief did not
// name).
//
// Given that, "the follower's own quiet hours, on every channel" means two
// different things depending on which sender is asking:
//
//   `_checkins.js`'s own due-select already has a `vy_room_checkin` row IN
//   HAND (the very row carrying the schedule that is due) — `quietHoursOkSql`
//   below reads its three columns DIRECTLY, exactly as it already did before
//   this file existed (WS-R22, migration 085); this file only moves that
//   text to one shared place so `_renewals.js`/`_dormancy.js` can use the
//   IDENTICAL logic rather than a second hand-typed copy that could drift.
//
//   `_renewals.js`/`_dormancy.js` have no check-in row of their own — their
//   due-selects join the follower's own row and nothing check-in shaped.
//   `quietHoursOkForFollowerSql` answers "is this follower inside ANY of
//   their own ACTIVE check-in schedules' quiet windows right now" — the
//   only per-follower quiet-hours signal this schema has today. A follower
//   who has never opted into a check-in (most followers: check-ins are
//   paid-only, WS-R16's own workstream law #2) is never blocked by this
//   predicate — identical, honest, to today's behaviour for them, never a
//   new send that is silently colder or a fabricated always-block.
//
// ── THE STATIC SCAN'S OWN HOOK ───────────────────────────────────────────
//
// `QUIET_HOURS_MARKER` is a literal SQL comment embedded in every fragment
// this module builds. `evals/quiet-hours/run.mjs` drives the real due-select
// functions in `_checkins.js`/`_renewals.js`/`_dormancy.js` with a fake `db`
// that records every SQL string passed to it, then greps those strings for
// this exact marker — a sweep that forgets to splice the fragment in fails
// by name, and the suite's own negative control (a frozen copy of the
// PRE-WS-R129 renewals due-select, with no marker) proves the scan would
// have caught the historical gap this workstream's brief describes.
export const QUIET_HOURS_MARKER = "/* ws-r129-quiet-hours */";

/**
 * The row-filter predicate, direct form: TRUE ("selectable, send it") when
 * `<alias>.quiet_from` or `<alias>.quiet_to` is null (no window — the
 * shipping default, migration 085's own column default, so a follower who
 * never set one is never blocked) OR the instant bound at `$<paramIndex>`,
 * read in `<alias>.timezone`'s own wall clock, falls OUTSIDE
 * `[quiet_from, quiet_to)`. A window that wraps midnight
 * (`quiet_from > quiet_to`, e.g. 22:00 to 07:00) is handled as the
 * complement of the "does not wrap" case — `api/_checkins.js`'s own
 * `QUIET_HOURS_SQL` (WS-R22) verbatim, moved here so every caller shares one
 * copy of the exact logic rather than each retyping it.
 */
export function quietHoursOkSql(alias, paramIndex = 1) {
  const p = `$${paramIndex}`;
  return `${QUIET_HOURS_MARKER} (
    ${alias}.quiet_from is null or ${alias}.quiet_to is null or not (
      case when ${alias}.quiet_from <= ${alias}.quiet_to
        then ((${p})::timestamptz at time zone ${alias}.timezone)::time >= ${alias}.quiet_from
             and ((${p})::timestamptz at time zone ${alias}.timezone)::time < ${alias}.quiet_to
        else ((${p})::timestamptz at time zone ${alias}.timezone)::time >= ${alias}.quiet_from
             or ((${p})::timestamptz at time zone ${alias}.timezone)::time < ${alias}.quiet_to
      end
    )
  )`;
}

/**
 * The row-filter predicate, follower-proxy form: TRUE ("selectable, send
 * it") unless `<followerAlias>` (the caller's own follower-row alias,
 * exposing `follower_id`) has at least one ACTIVE `vy_room_checkin` row
 * whose own quiet window currently blocks it — the negation of `quietHoursOkSql`
 * wrapped in a `not exists`, so a follower with zero active check-ins never
 * matches the `exists` and this predicate is a no-op for them, exactly the
 * "the gap this file does not close" section above requires. Used by
 * `_renewals.js` and `_dormancy.js`, whose own due-selects have no
 * check-in row of their own to read quiet hours from directly.
 */
export function quietHoursOkForFollowerSql(followerAlias, paramIndex = 1) {
  const qc = `qh_${followerAlias}`;
  return `${QUIET_HOURS_MARKER} not exists (
    select 1 from vy_room_checkin ${qc}
     where ${qc}.follower_id = ${followerAlias}.follower_id
       and ${qc}.state = 'active'
       and not ${quietHoursOkSql(qc, paramIndex)}
  )`;
}

/**
 * Pure JS mirror of `quietHoursOkSql`, for a caller (a fake-`db` test
 * harness, or a future in-process check) that already has the three values
 * in hand and wants the identical answer with no round trip — `tz` a valid
 * IANA zone name, never validated here (every write path that accepts one
 * already validates it, `api/_checkins.js`'s `validateSchedule`).
 */
export function isQuietHoursOk(nowMs, tz, quietFrom, quietTo) {
  if (quietFrom == null || quietTo == null) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(nowMs));
  const at = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const clock = `${at.hour}:${at.minute}`;
  const wraps = quietFrom > quietTo;
  const inside = wraps ? clock >= quietFrom || clock < quietTo : clock >= quietFrom && clock < quietTo;
  return !inside;
}
