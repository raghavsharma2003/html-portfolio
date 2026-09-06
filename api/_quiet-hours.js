// api/_quiet-hours.js — the follower's own quiet hours, ONE fragment,
// spliced into every proactive due-select (WS-R129: "quiet hours on every
// channel"). Pure: no imports of its own, so any module — `_checkins.js`,
// `_renewals.js`, `_dormancy.js`, and whatever proactive sender is built
// next — can splice this into a template literal with no import-cycle risk,
// the same discipline `_checkins.js`'s own "re-derived rather than
// imported" helpers already name for a reason (this repo's own house style,
// `ownedRoomHandle`'s header).
//
// ── THE GAP THIS FILE USED TO NOT CLOSE, AND NOW DOES (WS-R131, migration
//    134) ────────────────────────────────────────────────────────────────
//
// Until this workstream, the follower's own row carried NO timezone or
// quiet-hours column of its own — the only migration that ever added
// `quiet_from`/`quiet_to`/`timezone` was 085, and all three lived on
// `vy_room_checkin`, one row per check-in SCHEDULE, not one row per
// follower (context/rejected.md#ws-r129-no-follower-level-timezone-or-
// quiet-hours-column). Migration 134 adds those same three names directly
// directly to the follower's own row — nullable, both-or-neither on the quiet pair,
// IANA-shaped timezone — set once on the account page
// (`api/_room-surface.js`'s `roomSetQuietHours`) and inherited by a new
// check-in schedule whose own window is left unset (`api/_checkins.js`'s
// `optIn`, its INSERT's own `coalesce`).
//
// The shared fragment for a sender with no check-in row in hand
// (`_renewals.js`/`_dormancy.js`) is therefore now TWO sources, combined in
// ONE SQL expression rather than two code paths choosing between them:
//
//   `quietHoursOkForFollowerRowSql` reads the follower's OWN row directly
//   (migration 134's three columns) and returns NULL — not TRUE — when the
//   window is unset, so a caller can `coalesce()` it with a fallback.
//
//   `quietHoursOkForFollowerSql` is that coalesce: the follower's own row
//   wins when set; otherwise it falls back to WS-R129's original proxy — "is
//   this follower inside ANY of their own ACTIVE check-in schedules' quiet
//   window right now" — for a follower who set a window on a check-in
//   before this column existed, or who has never used the account-level
//   control at all. A follower who has done neither (most followers: check-
//   ins are paid-only, WS-R16's own workstream law #2) is never blocked by
//   either half — identical, honest, to today's behaviour for them, never a
//   new send that is silently colder or a fabricated always-block.
//
// `_checkins.js`'s own due-select is UNCHANGED by this workstream: it
// already has the due `vy_room_checkin` row IN HAND, so `quietHoursOkSql`
// below keeps reading that row's own three columns directly, exactly as it
// did before this file existed (WS-R22, migration 085) — the schedule's own
// window, inherited or explicit, already lives there by the time this
// predicate runs.
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
 * WS-R131 (migration 134). The follower's OWN row, direct form — the
 * IDENTICAL wall-clock math `quietHoursOkSql` runs, over `<alias>.timezone`/
 * `quiet_from`/`quiet_to` on the follower's own row itself rather than a check-in
 * schedule. Deliberately NOT the same return shape as `quietHoursOkSql`:
 * this expression is NULL (never TRUE) when the window is unset OR the
 * timezone is missing — a defensive belt for the second case, since
 * `<alias>.timezone` feeds `at time zone` below and a null zone there must
 * never be asked to resolve to "always ok" by accident — so that
 * `quietHoursOkForFollowerSql` below can `coalesce()` this against a
 * fallback in ONE SQL expression, never a second code path in JS choosing
 * between them.
 */
export function quietHoursOkForFollowerRowSql(alias, paramIndex = 1) {
  const p = `$${paramIndex}`;
  return `${QUIET_HOURS_MARKER} (
    case when ${alias}.quiet_from is not null and ${alias}.quiet_to is not null and ${alias}.timezone is not null then not (
      case when ${alias}.quiet_from <= ${alias}.quiet_to
        then ((${p})::timestamptz at time zone ${alias}.timezone)::time >= ${alias}.quiet_from
             and ((${p})::timestamptz at time zone ${alias}.timezone)::time < ${alias}.quiet_to
        else ((${p})::timestamptz at time zone ${alias}.timezone)::time >= ${alias}.quiet_from
             or ((${p})::timestamptz at time zone ${alias}.timezone)::time < ${alias}.quiet_to
      end
    ) end
  )`;
}

/**
 * The row-filter predicate, follower-proxy form: TRUE ("selectable, send
 * it") unless `<followerAlias>` (the caller's own follower-row alias,
 * exposing `follower_id`) has at least one ACTIVE `vy_room_checkin` row
 * whose own quiet window currently blocks it — the negation of `quietHoursOkSql`
 * wrapped in a `not exists`, so a follower with zero active check-ins never
 * matches the `exists` and this predicate is a no-op for them, exactly the
 * "the gap this file does not close" section above requires.
 *
 * WS-R131 (migration 134): this is now the FALLBACK half of a `coalesce()`,
 * not the only source. `quietHoursOkForFollowerRowSql` above reads
 * `<followerAlias>`'s own row directly and wins when it has a real window
 * set; only when that expression is NULL (no row-level window at all) does
 * this proxy's own check-in lookup ever get consulted. One SQL expression,
 * coalesce-shaped, never two code paths deciding in JS which source to
 * trust — every existing caller (`_renewals.js`, `_dormancy.js`) changes
 * NOTHING about its own call site: this function's exported NAME and
 * signature are unchanged, only what it expands to.
 */
export function quietHoursOkForFollowerSql(followerAlias, paramIndex = 1) {
  const qc = `qh_${followerAlias}`;
  return `${QUIET_HOURS_MARKER} coalesce(
    ${quietHoursOkForFollowerRowSql(followerAlias, paramIndex)},
    not exists (
      select 1 from vy_room_checkin ${qc}
       where ${qc}.follower_id = ${followerAlias}.follower_id
         and ${qc}.state = 'active'
         and not ${quietHoursOkSql(qc, paramIndex)}
    )
  )`;
}

/**
 * Pure JS mirror of `quietHoursOkSql`, for a caller (a fake-`db` test
 * harness, or a future in-process check) that already has the three values
 * in hand and wants the identical answer with no round trip — `tz` a valid
 * IANA zone name, never validated here (every write path that accepts one
 * already validates it, `api/_checkins.js`'s `validateSchedule` and
 * `api/_room-surface.js`'s `roomSetQuietHours`).
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
