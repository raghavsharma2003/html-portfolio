-- Migration 134 - the follower's own time zone and quiet hours (WS-R131).
--
-- WS-R129 (migration 085, "quiet hours on every channel") found that
-- `vy_room_follower` itself carries no timezone or quiet-hours column at
-- all - the only place this schema ever stored those three names was
-- `vy_room_checkin`, one row per check-in SCHEDULE a follower opted into,
-- never one row per follower (`context/rejected.md#ws-r129-no-follower-
-- level-timezone-or-quiet-hours-column`). WS-R129's own fix was therefore a
-- PROXY: read whichever of a follower's own ACTIVE check-in schedules most
-- recently set a real window, honest for the follower who has one, a true
-- no-op for the follower who does not (most followers - check-ins are
-- paid-only). This migration is what that entry's own "what would reverse
-- it" section named: a real, one-row-per-follower column set, set ONCE on
-- the account page, in both locales, that every new check-in schedule
-- inherits from and that the shared quiet-hours fragment now prefers over
-- the check-in proxy - which stays alive as the fallback for a follower
-- who set a window before this column existed, `context/decisions.md#ws-
-- r129-quiet-hours-follower-proxy-via-checkin-table`'s own reversal
-- condition, taken exactly as written there.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO
-- blocks, no functions - 009's law, restated by every migration since.
-- Both new columns are nullable and default to null, so an existing row is
-- unaffected the moment this migration lands, `vy_room_checkin`'s own
-- migration 085 precedent for the identical pair of columns.
--
-- ── THE TWO CHECKS ──────────────────────────────────────────────────────
--
--   vy_room_follower_quiet_hours_pairing_check   both null (no window - the
--                                                 shipping default) or both
--                                                 set - a half-set window
--                                                 has no meaning to
--                                                 `api/_quiet-hours.js`'s
--                                                 own math, exactly the
--                                                 shape `api/_checkins.js`'s
--                                                 `validateQuietWindow`
--                                                 already enforces in the
--                                                 application layer for the
--                                                 check-in table's own pair.
--   vy_room_follower_timezone_shape_check        null, or an IANA-zone-
--                                                 shaped string
--                                                 (`^[A-Za-z_]+(/[A-Za-z_+-
--                                                 ]+)*$`) - a coarse SHAPE
--                                                 check, not a lookup
--                                                 against the real zone
--                                                 database (Postgres has
--                                                 none built in this
--                                                 schema can reach), the
--                                                 same limitation
--                                                 `api/_checkins.js`'s own
--                                                 `validateSchedule`
--                                                 already lives with for
--                                                 the check-in table's
--                                                 timezone column - real
--                                                 zone validity is
--                                                 `set_quiet_hours`'s own
--                                                 job (`api/_room-
--                                                 surface.js`'s
--                                                 `isKnownTimeZone`, a
--                                                 `new Intl.DateTimeFormat`
--                                                 construction probe, NOT
--                                                 `Intl.supportedValuesOf`,
--                                                 which was tried first and
--                                                 measured to exclude
--                                                 `Asia/Kolkata` on this
--                                                 runtime's own ICU data -
--                                                 `context/rejected.md#ws-
--                                                 r131-supportedvaluesof-
--                                                 timezone-rejects-asia-
--                                                 kolkata`).
--
-- Written as `drop constraint if exists` then `add constraint` (an unnamed
-- multi-column CHECK cannot be re-added under a name Postgres would choose
-- for it, so this migration names both explicitly) - `alter table ...
-- add column` and `drop/add constraint` are each their own statement, so a
-- run interrupted between any two of these four statements is recovered by
-- running this same file again, every earlier statement already a no-op.
alter table vy_room_follower add column if not exists timezone text;
alter table vy_room_follower add column if not exists quiet_from time;
alter table vy_room_follower add column if not exists quiet_to time;

alter table vy_room_follower drop constraint if exists vy_room_follower_quiet_hours_pairing_check;
alter table vy_room_follower add constraint vy_room_follower_quiet_hours_pairing_check
  check ((quiet_from is null and quiet_to is null) or (quiet_from is not null and quiet_to is not null));

alter table vy_room_follower drop constraint if exists vy_room_follower_timezone_shape_check;
alter table vy_room_follower add constraint vy_room_follower_timezone_shape_check
  check (timezone is null or timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+)*$');
