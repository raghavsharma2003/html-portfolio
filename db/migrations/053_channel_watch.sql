-- Migration 053 — vy_channel_watch + vy_ingest_run: the stays-current loop.
--
-- Contract: docs/gurukul/SPEC-GURUKUL.md §8 item 3 — "Stays-current is a loop,
-- not an upload. Channel link → new-video detection → re-ingestion → PROPOSED
-- claims/sheet deltas the expert approves — never silent self-update of a live
-- persona." These two tables are the durable half of that sentence: one row
-- per watched channel, one row per video the platform has ever looked at.
--
-- Idempotent, one statement per request — 009's law, restated by 051 and 052
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint accepts
-- exactly ONE statement per body, db/migrations/apply.mjs runs them
-- individually with no transaction, so every statement below is independently
-- re-runnable and an apply interrupted halfway is recovered by running this
-- same file again, never by manual repair. NO DO blocks and no functions:
-- apply.mjs's splitter is deliberately small and does not handle them.
--
-- ── no foreign keys, same convention as 051 ───────────────────────────────
-- `replica_id`, `owner_user_id`, `watch_id` are FK-SHAPED and carry no FK
-- constraint. 009 established this for every agent-scoped table and 051
-- restated the reason: the binding is enforced by the WHERE clause, before
-- rank, and a single table whose binding were enforced in the database would
-- read as a stricter rule while actually being an inconsistent one. The
-- indexes below are what make the predicate cheap.
--
-- ── oauth_grant_ref is a uuid, and that is the whole point ────────────────
-- The brief says "a reference, NEVER a token value". A `text` column with a
-- comment saying so is a preference; a `uuid` column is a guarantee, because
-- an OAuth access or refresh token cannot be cast into one. The same
-- reasoning migration 051 gives for making the publish gate a CHECK rather
-- than a branch (`gate0-structural`: prompt instructions leaked 57-98%, the
-- SQL predicate leaked 0 of 31,122) applies one axis over: the thing being
-- prevented is a Google refresh token for a real teacher's channel sitting in
-- a table that gets selected, logged and joined. The column type prevents it.
--
-- Nullable because a channel can be WATCHED before it is AUTHORIZED — a
-- teacher pastes their channel URL in the studio, and the OAuth consent
-- screen is a second step they may never finish. A watch with no grant lists
-- nothing and is not an error; it is a to-do the studio can render.
--
-- ── one active watch per replica ──────────────────────────────────────────
-- A partial unique index rather than a plain one, so a paused or revoked
-- watch is KEPT (051's "revoked rows are kept": the row is the record of what
-- was watched and under whose grant) while a second live channel cannot be
-- attached to the same clone. Two active channels would mean two independent
-- last_seen cursors advancing against one sheet, and the first disagreement
-- between them is unresolvable after the fact.

create table if not exists vy_channel_watch (
  watch_id        uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  channel_url     text not null,
  provider        text not null default 'youtube'
                  check (provider in ('youtube')),
  -- a reference to a grant record, never a credential. See the note above.
  oauth_grant_ref uuid,
  -- '' means "never listed" — distinct from a video id, and never null, so
  -- the worker's cursor comparison has no three-valued case.
  last_seen_video_id text not null default '',
  last_checked_at timestamptz,
  status          text not null default 'active'
                  check (status in ('active','paused','revoked')),
  created_at      timestamptz not null default now()
);

create unique index if not exists vy_channel_watch_one_active_ix
  on vy_channel_watch (replica_id) where status = 'active';

create index if not exists vy_channel_watch_sweep_ix
  on vy_channel_watch (status, last_checked_at asc);

create index if not exists vy_channel_watch_owner_ix
  on vy_channel_watch (owner_user_id, replica_id);

-- ── vy_ingest_run: one row per video, forever ─────────────────────────────
--
-- The unique index on (replica_id, video_ref) is the idempotence law itself
-- rather than a performance hint. "The same video is never double-ingested"
-- is the property the eval asserts, and the worker upserts against this
-- constraint — so an implementation that forgot its cursor check would STILL
-- not produce two runs, which is the difference between a rule that is
-- enforced and a rule that is remembered. The cursor (`last_seen_video_id`)
-- is the cheap path; this index is the guarantee.
--
-- ── status='applied' is not reachable without an approver ─────────────────
-- SPEC §8's "never silent self-update of a live persona", written as a
-- predicate. A run may reach 'proposed' entirely on its own; it cannot reach
-- 'applied' unless a named human is recorded against it and a time is
-- stamped. `api/_channel-ingest.js`'s `applyIngestRunDelta` is the only
-- writer that supplies those, and the CHECK is what makes any FUTURE writer
-- that forgets them fail loudly instead of quietly publishing a clone of a
-- real, named, living person that nobody approved.
--
-- `proposed_delta` holds the drafted delta itself so the studio review UI has
-- something to render without re-running ASR: the mined phrase-bank
-- candidates (already checked against a held-out half) plus the measurements
-- behind them. It is ADDITIONS only, by design — see the header of
-- api/_channel-ingest.js for why a single new video may not propose the
-- RETIREMENT of an existing verbalism.

create table if not exists vy_ingest_run (
  run_id               uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  -- nullable: a run can also come from a direct upload, which has no watch.
  watch_id             uuid,
  video_ref            text not null,
  transcript_source    text not null
                       check (transcript_source in ('asr','captions','upload')),
  stats                jsonb not null default '{}'::jsonb,
  proposed_delta       jsonb not null default '{}'::jsonb,
  proposed_delta_count integer not null default 0
                       check (proposed_delta_count >= 0),
  status               text not null default 'fetched'
                       check (status in ('fetched','transcribed','proposed','applied','rejected','failed')),
  -- '' rather than null: a failure code is either a named code or absent, and
  -- absent is spelled the same way everywhere in this schema.
  failure_code         text not null default '',
  approved_by_user_id  uuid,
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_ingest_run_approval_gate
    check (status <> 'applied' or (approved_by_user_id is not null and decided_at is not null))
);

create unique index if not exists vy_ingest_run_video_ix
  on vy_ingest_run (replica_id, video_ref);

create index if not exists vy_ingest_run_owner_recent_ix
  on vy_ingest_run (owner_user_id, replica_id, created_at desc);

create index if not exists vy_ingest_run_review_ix
  on vy_ingest_run (replica_id, status, created_at desc);
