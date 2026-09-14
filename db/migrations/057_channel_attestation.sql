-- Migration 057 — vy_channel_attestation: the teacher says, on the record,
-- "this channel is mine", and extraction is impossible without that row.
--
-- Contract: docs/gurukul/safety-floor-teacher.md §2 — "the teacher owns the
-- likeness", and the consent artifact is "a signed row" carrying a named
-- principal, a scope, a term and revocation semantics. This table is that
-- artifact for ONE narrow scope: permission to extract audio from a specific
-- YouTube channel the teacher attests they own or control.
--
-- ── why a new table and not a new scope on vy_replica_consent ─────────────
-- `api/_replica-consent.js` was read first, as the brief requires, and it is
-- the right SHAPE and the wrong KEY. Its rows are (replica_id, owner_user_id,
-- scope) — a scope is a verb the owner permits, and the table has no place to
-- put the OBJECT of that verb. The permission being recorded here is not
-- "extraction is allowed"; it is "extraction is allowed FROM THIS CHANNEL",
-- and a channel URL living in `metadata jsonb` is not a key: it cannot be
-- uniquely indexed per-channel, it cannot be joined against
-- `vy_channel_watch.channel_url` in a WHERE clause, and a predicate that has
-- to reach into jsonb to find the thing it is gating is a predicate one
-- careless `->>'channel_url'` typo away from gating nothing. The measurement
-- that decides this is the same one everything else in this lane cites
-- (`gate0-structural`: prompt instructions leaked 57-98%, the SQL predicate
-- leaked 0 of 31,122) — the object of the permission has to be a COLUMN.
--
-- What IS reused is the discipline, not the storage: the receipt is built by
-- `makeChannelAttestationReceipt` in api/_channel-watch.js using the same
-- canonical-JSON-then-sha256 construction as `makeConsentReceipt`, the same
-- `statement_set` naming, the same `granted_at`/`expires_at`/`revoked_at`
-- triple, and the same rule that revoked rows are KEPT rather than deleted
-- (051's "the row is the record of what was watched and under whose grant").
--
-- Idempotent, one statement per request — 009's law, restated by 051/052/053
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint accepts
-- exactly ONE statement per body and db/migrations/apply.mjs runs them
-- individually with no transaction. No DO blocks, no functions.
--
-- ── no foreign keys, same convention as 051/053 ──────────────────────────
-- `replica_id` / `owner_user_id` are FK-SHAPED and carry no FK constraint.
-- The binding is enforced by the WHERE clause; a single table enforcing it in
-- the database would read as a stricter rule while actually being an
-- inconsistent one.
--
-- ── the term is bounded and the default is one year ──────────────────────
-- `expires_at` is NOT NULL. An attestation with no end date is a permission
-- that outlives every reason anybody had for granting it, and this one
-- authorizes reading a real named person's published teaching. The gate in
-- api/_channel-watch.js reads `revoked_at is null and expires_at > now()`, so
-- a lapsed attestation stops extraction with no sweep, no cron and no
-- cleanup job — the predicate simply stops matching.

create table if not exists vy_channel_attestation (
  attestation_id  uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  -- the OBJECT of the permission, as a column. See the header.
  channel_url     text not null,
  provider        text not null default 'youtube'
                  check (provider in ('youtube')),
  statement_set   text not null default 'channel-ownership-attestation/v1',
  policy_version  text not null,
  -- sha256 of the canonical receipt. A CHECK rather than a comment, for the
  -- same reason 053 made `oauth_grant_ref` a uuid: a column that can only
  -- hold a digest cannot be quietly repurposed to hold something else.
  receipt_hash    text not null
                  check (receipt_hash ~ '^[0-9a-f]{64}$'),
  -- the attested statements themselves, so the row is self-describing when
  -- somebody reads it two years from now with none of this context.
  attestations    jsonb not null default '{}'::jsonb,
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- One LIVE attestation per (replica, channel). A revoked or superseded one is
-- kept — it is the record of what was permitted and when — while a second
-- live attestation for the same channel cannot exist, so "is this channel
-- attested?" has exactly one answer.
create unique index if not exists vy_channel_attestation_live_ix
  on vy_channel_attestation (replica_id, channel_url) where revoked_at is null;

create index if not exists vy_channel_attestation_owner_ix
  on vy_channel_attestation (owner_user_id, replica_id);

-- ── the watch carries the attestation it was created under ───────────────
--
-- The extraction predicate could be written as a join on `channel_url` alone,
-- and it would be correct today. This column makes it correct after somebody
-- edits it: a watch row records WHICH attestation authorized it, so a watch
-- created under an attestation that was later revoked and re-granted is
-- distinguishable from one created under the live one. Nullable, because
-- migration 053's rows predate this column and a NULL there means "created
-- before attestations existed" — which the gate in api/_channel-watch.js
-- treats as UNATTESTED, i.e. it fails closed rather than grandfathering.
alter table vy_channel_watch
  add column if not exists attestation_id uuid;

create index if not exists vy_channel_watch_attestation_ix
  on vy_channel_watch (attestation_id);

-- ── the back catalogue: a second cursor, walking the other way ────────────
--
-- Migration 053's `last_seen_video_id` is a FORWARD cursor: it answers "what
-- is new since we last looked", and the worker deliberately bounds a
-- first-ever sweep to the newest slice because "stay current" is
-- forward-looking. That is still right, and it means the thing a teacher
-- actually has most of — years of uploaded lectures — was unreachable.
--
-- A back-catalogue import is a different operation with a different cursor,
-- so it gets one rather than overloading the first. `backfill_after_video_id`
-- walks OLDEST-FIRST and records the last video successfully ingested; a tick
-- resumes exactly after it. Two cursors moving in opposite directions over
-- one channel never disagree, because they can never both be advanced by the
-- same video: the unique index on (replica_id, video_ref) makes a video the
-- other cursor already reached a no-op.
--
-- `backfill_state` is the switch and it is a CHECK-constrained enum rather
-- than a boolean because 'done' and 'idle' are different facts: idle means
-- the teacher never asked, done means the catalogue was drained. A UI that
-- could not tell them apart would offer "import my back catalogue" forever.
alter table vy_channel_watch
  add column if not exists backfill_after_video_id text not null default '';

alter table vy_channel_watch
  add column if not exists backfill_state text not null default 'idle';

-- drop-if-exists then add: Postgres has no `add constraint if not exists`, so
-- 008a_speaker_participants.sql's pair is the house spelling for an
-- idempotent constraint. Kept separate from the `add column` above because
-- an inline CHECK would be re-added on the second pass of an interrupted
-- apply and fail.
alter table vy_channel_watch
  drop constraint if exists vy_channel_watch_backfill_state_check;

alter table vy_channel_watch
  add constraint vy_channel_watch_backfill_state_check
  check (backfill_state in ('idle','running','done'));

create index if not exists vy_channel_watch_backfill_ix
  on vy_channel_watch (backfill_state, last_checked_at asc) where backfill_state = 'running';
