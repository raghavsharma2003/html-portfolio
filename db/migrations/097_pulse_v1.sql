-- Migration 097 - Pulse v1: k-anonymous label combinations (WS-R35).
--
-- Pulse v0 (migration 080, WS-R17) floors every SINGLE-topic bucket at
-- n>=5. That floor is not enough on its own: two single-label buckets can
-- each individually clear five and still intersect in one person - the
-- plan's own worked example, "5 asked about visas" and "5 asked about
-- divorce" and "1 asked about both" names who that one person is, even
-- though neither of the two published fives is itself a violation of
-- anything v0 checks. This migration does not touch v0's tables (a Room
-- with real v0 rows, however unlikely per context/STATE.md's own accounting,
-- must not have its history rewritten by a later migration); it adds what
-- v0 does not have.
--
-- ── two additions to v0's existing taxonomy table ──────────────────────────
--
-- `vy_room_pulse_topic`'s ORIGINAL bounds (1-60 characters, 8 per Room) were
-- v0's own placeholder numbers, enforced only in application code
-- (`PULSE_MAX_TOPICS`) with a single length CHECK as the only DB-level
-- backstop. This migration makes both bounds real per the plan's Phase 2
-- text ("Labels are bounded: at most 12 active labels per Room, each 2 to 32
-- characters") and makes the COUNT bound structural rather than app-only, by
-- the cheapest form that does not require a trigger or a function (both
-- banned for migrations, 009's law): a `slot` column whose own CHECK bounds
-- it to 1..12, paired with a UNIQUE index on (room_id, slot) - a room can
-- never hold two rows claiming the same slot, and no slot value outside
-- 1..12 may exist, so by construction a room can never hold more than 12
-- rows carrying a slot at all. Postgres unique indexes treat NULL as
-- distinct from NULL, so a room's pre-v1 rows (no slot assigned) are
-- ungoverned by this cap until `api/_pulse.js#setTopics` next rewrites that
-- room's list, which is the only writer of this column and always assigns a
-- fresh 1..N on every call, see that file's header.
--
-- Both new CHECKs are added `not valid`: a CHECK constraint (unlike a
-- foreign key) still applies to every INSERT/UPDATE from the moment it is
-- added even when NOT VALID, but NOT VALID skips validating rows that
-- already exist, so this migration cannot fail to apply because of a row
-- written before it - the one thing this session cannot verify by querying
-- the live database itself (context/rejected.md#offline-mocks-cannot-type-
-- check-sql`'s sibling risk: an unverifiable constraint must not be allowed
-- to block its own migration). If the live table does turn out to hold a
-- violating row, a follow-up `validate constraint` is the main loop's call,
-- not this migration's.
alter table vy_room_pulse_topic
  drop constraint if exists vy_room_pulse_topic_label_v1_len_check;
alter table vy_room_pulse_topic
  add constraint vy_room_pulse_topic_label_v1_len_check
  check (length(label) between 2 and 32) not valid;

alter table vy_room_pulse_topic add column if not exists slot smallint;

alter table vy_room_pulse_topic
  drop constraint if exists vy_room_pulse_topic_slot_check;
alter table vy_room_pulse_topic
  add constraint vy_room_pulse_topic_slot_check
  check (slot is null or slot between 1 and 12) not valid;

-- Bare (non-partial) unique index: multiple NULLs coexist freely (pre-v1
-- rows, or a room mid-rewrite between the "clear every slot" and "assign
-- fresh slots" statements `setTopics` now issues, see that file), but two
-- rows in the SAME room can never both claim slot 3.
create unique index if not exists vy_room_pulse_topic_slot_ix
  on vy_room_pulse_topic (room_id, slot);

-- ── the week header: one row per Room per ISO week, carrying the ONE number
--    law 1 permits about what got held back ─────────────────────────────────
--
-- `suppressed` is a COUNT of candidate label-sets this week's publish
-- refused, never which ones and never their labels - `api/_pulse.js`'s
-- `computeComboSnapshot` is the only writer, and its header states exactly
-- how that count is produced. Separate table from the bucket rows below
-- (rather than a column bolted onto v0's `vy_room_pulse_snapshot`, which
-- this migration does not touch) because a week can be COMPUTED with zero
-- publishable buckets and the header must still exist to report that the
-- computation ran and how many candidates it turned away - the same "an
-- honest empty state is still a written row" reasoning `vy_sweep_run`
-- (migration 084) already uses for its own heartbeat.
create table if not exists vy_room_pulse_week (
  week_id     uuid primary key,
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  week_start  date not null,
  suppressed  integer not null default 0 check (suppressed >= 0),
  computed_at timestamptz not null default now()
);

create unique index if not exists vy_room_pulse_week_ix
  on vy_room_pulse_week (room_id, week_start);

create index if not exists vy_room_pulse_week_owner_read_ix
  on vy_room_pulse_week (room_id, week_start desc);

-- ── the combo bucket: a COUNT over a SET of 1-3 labels ─────────────────────
--
-- `labels` carries the label TEXT itself, captured at publish time - never a
-- `topic_id` foreign key - so that renaming a label in `vy_room_pulse_topic`
-- (a normal, expected creator action) can never rewrite what an already-
-- published week is understood to have meant. This is the one place v1
-- diverges from v0's own shape on purpose: v0's `vy_room_pulse_snapshot`
-- joins `topic_id` back to `vy_room_pulse_topic.label` at READ time
-- (`readPulse`), so a v0 bucket's displayed label silently follows a later
-- rename; that was an acceptable simplification for a single-label bucket a
-- creator wrote and can still recognise, and this migration does not change
-- it retroactively, but a k-anonymity SUPPRESSION decision is exactly the
-- kind of fact that must never be reinterpreted after the fact, so v1 does
-- not repeat the choice.
--
-- `array_length(labels,1)` returns NULL (not 0) for an empty array, and a
-- CHECK that evaluates to NULL is treated by Postgres as PASSING, not
-- failing - `coalesce(...,0)` closes that hole explicitly rather than
-- relying on `not null`/`<> '{}'` reading correctly to every future editor.
--
-- No `person_id` column exists here, the same structural argument v0's own
-- header makes for `vy_room_pulse_snapshot`: the schema itself is the proof
-- a bucket cannot be traced to a follower, one layer below `evals/room-leak`'s
-- runtime proof of the same claim, and `evals/pulse/run.mjs`'s own static
-- column-list scan of every INSERT this migration's tables accept.
create table if not exists vy_room_pulse_combo (
  combo_id       uuid primary key,
  week_id        uuid not null references vy_room_pulse_week(week_id) on delete cascade,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  week_start     date not null,
  labels         text[] not null check (coalesce(array_length(labels, 1), 0) between 1 and 3),
  follower_count integer not null check (follower_count >= 5),
  computed_at    timestamptz not null default now()
);

-- One row per (room, week, exact label set) - `computeComboSnapshot` clears
-- the week's existing combo rows before it re-publishes (recomputed, never
-- patched, v0's own law 1 restated), so this is a correctness backstop
-- against two concurrent sweeps of the same room/week, not the mechanism
-- itself. Array equality is exact and order-sensitive in Postgres, so the
-- writer is responsible for always inserting a SORTED array
-- (`api/_pulse.js`'s `normalizeLabelSet`) or the same set typed in two
-- orders would count as two different rows.
create unique index if not exists vy_room_pulse_combo_ix
  on vy_room_pulse_combo (room_id, week_start, labels);

create index if not exists vy_room_pulse_combo_owner_read_ix
  on vy_room_pulse_combo (room_id, week_start desc);

-- Added at the merge (2026-09-04): the live table held zero rows when 097
-- was applied, so both `not valid` CHECKs were validated in the same
-- sitting and now bind every row; validating an already-valid constraint
-- is a no-op, so this stays idempotent.
alter table vy_room_pulse_topic validate constraint vy_room_pulse_topic_label_v1_len_check;
alter table vy_room_pulse_topic validate constraint vy_room_pulse_topic_slot_check;
