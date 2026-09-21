-- Migration 060 — the activity trail: one table that makes "is it done?"
-- answerable, plus the three columns three lanes were missing to answer it.
--
-- Contract: the owner's ask, verbatim — "I should also see that have we
-- received the YT video and that processing done or not, and all the other
-- processing going on we should see, in a user view." WS-AF.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by
-- 009/051/054/056/058/059 and binding here for the same reason: Neon's
-- SQL-over-HTTP endpoint takes exactly one statement per request, there is no
-- transaction across statements, and an apply interrupted halfway must be
-- recoverable by running this file again. NO DO blocks and no functions:
-- db/migrations/apply.mjs's splitter is deliberately small and does not handle
-- them. Constraints therefore use the drop-then-add idempotent pair.
--
-- ── WHY A TABLE AND NOT SIX MORE COLUMNS ─────────────────────────────────
-- Every lane in this platform already has a `state` column and an `updated_at`.
-- Between them they can answer "what is this row's state RIGHT NOW", and they
-- cannot answer anything else. They cannot answer:
--
--   when did this start?          `created_at` is when the ROW was made, which
--                                 for a retried run is not when work began.
--   when did it finish?           `updated_at` moves on every touch, including
--                                 touches that are not a finish.
--   how long was it stuck?        nothing records the transition, only the
--                                 latest value of the thing that transitioned.
--   why did it fail?              `failure_code` holds the LAST code; the code
--                                 that caused the retry before it is gone.
--
-- Adding started_at/finished_at columns to six tables would answer the first
-- two and none of the rest, in six migrations, with six different spellings.
-- One append-only transition log answers all four for every lane at once, and
-- it is the shape that stays correct when a seventh lane arrives.
--
-- ── WHAT THIS TABLE DELIBERATELY DOES NOT HOLD ───────────────────────────
-- NO PERCENTAGE. There is no `progress` column and there will not be one. Of
-- the seven lanes here exactly one can compute a real fraction (the enrollment
-- DAG: completed steps over the eight steps in AUDIO_PROCESSING_DAG), and it
-- computes it from rows that already exist. A column would invite the other six
-- to fill it, and a bar that moves on a schedule rather than on work is the
-- `plausible-return-hides-a-dead-pipeline` failure rendered in paint. The state
-- vocabulary below plus a plain-language reason is what an honest lane can say.
--
-- NO FREE TEXT STATE. `state` is a CHECK over seven values, the same seven the
-- read API and the UI use, so a lane cannot invent an eighth that no surface
-- knows how to render. Mapping each lane's own vocabulary onto these seven is
-- done in api/_replica-activity.js where an eval can read it.
--
-- ── A FAILURE MUST BE NAMED, AND POSTGRES IS WHAT MAKES THAT TRUE ────────
-- `vy_replica_activity_failure_named` is 058's `vy_context_item_refusal_named`
-- argument transferred: a writer that records `failed` and forgets the reason
-- is refused by the database rather than by a code review. The owner is being
-- told their upload stopped; "it stopped" without "because the file had no
-- audio track" is not a report, it is an alarm.
--
-- ── dedupe_key, and why it is opt-in ─────────────────────────────────────
-- The log is append-only and a lane may legitimately record `running` more than
-- once (a lease renewed, a retry). But some transitions are once-only and a
-- sweep that runs twice a minute must not write two of them. A writer that
-- wants at-most-once passes a `dedupe_key`; the partial unique index below
-- makes the second write a no-op. A writer that wants every transition passes
-- '' and the index does not apply to it. Making dedupe the DEFAULT would have
-- silently collapsed exactly the retry history this table exists to keep.
--
-- ── erasure ──────────────────────────────────────────────────────────────
-- The composite FK to vy_replica is ON DELETE CASCADE, so scripts/relcheck.mjs's
-- owner-lane reach walk is satisfied by the FK graph. It is ALSO deleted by name
-- in api/_replica-full-erasure.js, on 059's precedent and for 059's reason: this
-- table names what a person uploaded and when, and two independent layers are
-- what the house rule asks for on a harm the next turn does not undo.

create table if not exists vy_replica_activity (
  event_id      uuid primary key default gen_random_uuid(),
  replica_id    uuid not null,
  owner_user_id uuid not null,
  lane          text not null
                check (lane in ('upload_processing','context_item','channel_watch',
                                'channel_video','voice_model_build','mirror_finetune','erasure')),
  job_ref       text not null,
  subject       text not null default '',
  state         text not null
                check (state in ('queued','running','waiting_on_you','done','failed','blocked','cancelled')),
  reason        text not null default '',
  dedupe_key    text not null default '',
  at            timestamptz not null default now(),
  constraint vy_replica_activity_job_ref_present check (job_ref <> ''),
  constraint vy_replica_activity_failure_named
    check (state not in ('failed','blocked') or reason <> ''),
  constraint vy_replica_activity_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

-- The read: one owner's one replica, newest first. Every column the activity
-- endpoint selects is in the table, so this index carries the whole surface.
create index if not exists vy_replica_activity_owner_ix
  on vy_replica_activity (owner_user_id, replica_id, at desc);

-- The per-job timeline: what happened to THIS job, in order. This is the index
-- that turns "when did it start" and "when did it finish" into a range scan
-- rather than a sort over the owner's whole history.
create index if not exists vy_replica_activity_job_ix
  on vy_replica_activity (replica_id, lane, job_ref, at);

-- At-most-once for the writers that ask for it. Partial, so a lane recording
-- every transition (dedupe_key = '') is unaffected.
create unique index if not exists vy_replica_activity_dedupe_ix
  on vy_replica_activity (replica_id, dedupe_key) where dedupe_key <> '';

-- ── vy_ingest_run.video_title ────────────────────────────────────────────
-- The owner's ask names this column. They asked whether we have "received the
-- YT video"; `video_ref` holds `dQw4w9WgXcQ`, and nobody recognises their own
-- lecture by its YouTube id. The title is already on the object the provider
-- hands us (api/_channel/contracts.js clamps it to 200 chars, and
-- youtube-oauth.js reads it from `snippet.title`); it was simply never
-- persisted, so the one string that makes an ingest row legible was thrown away
-- at the door. Default '' because every row that already exists predates the
-- column and inventing a title for it would be worse than an empty one, which
-- the surface renders as the video id and says so.
alter table vy_ingest_run add column if not exists video_title text not null default '';

-- ── vy_channel_watch: the sweep's own outcome ────────────────────────────
-- `plausible-return-hides-a-dead-pipeline`, live. api/_channel-ingest.js's
-- sweepWatch() catches a listing failure, calls touchWatch(), and touchWatch
-- writes `last_checked_at = now()`. So a channel that has been failing its
-- listing every tick for a week is indistinguishable, in this table, from a
-- channel that has been checked every tick and had nothing new: both show a
-- recent timestamp and no error anywhere.
--
-- This matters more here than anywhere else in the platform, because the ONE
-- failure we already predict for this lane is exactly this one:
-- `docs/gurukul/youtube-extraction-posture.md` expects
-- `channel_extract_extractor_bot_check` on the first real sweep from a
-- datacenter IP, and today it would land in the swallowed catch and the owner
-- would see a channel that says it was checked a minute ago and never ingests
-- anything.
--
-- Three columns, not a jsonb blob: the surface reads all three on every render
-- and a jsonb would make the common read the parsed one.
alter table vy_channel_watch add column if not exists last_sweep_state text not null default '';
alter table vy_channel_watch add column if not exists last_sweep_reason text not null default '';
alter table vy_channel_watch add column if not exists last_sweep_videos integer not null default 0;

alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_state_named;

alter table vy_channel_watch add constraint vy_channel_watch_sweep_state_named
  check (last_sweep_state in ('','checked','failed'));

alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_failure_named;

-- Same law as the activity table's: a sweep that failed says why, or Postgres
-- refuses the row.
alter table vy_channel_watch add constraint vy_channel_watch_sweep_failure_named
  check (last_sweep_state <> 'failed' or last_sweep_reason <> '');

alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_videos_nonneg;

alter table vy_channel_watch add constraint vy_channel_watch_sweep_videos_nonneg
  check (last_sweep_videos >= 0);
