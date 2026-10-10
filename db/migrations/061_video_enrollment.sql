-- Migration 060 — one link, one clone: the single-video enrollment lane.
--
-- The owner's ask: paste ONE link to a 15-minute lecture and get a clone from
-- it, without the first ten seconds having to be clean, for every account.
-- `api/_video-enroll.js` is the lane; this is the two tables it needs and the
-- reasons they are two.
--
-- ── why this is not a row on vy_channel_watch ────────────────────────────
-- A watch is a STANDING relationship with a channel: it has a cursor, a
-- sweep, a back-catalogue walk, and it exists to notice next week's upload.
-- A single-video enrollment is a ONE-SHOT with a result. Overloading the
-- watch row would put a null cursor and a null sweep state on every
-- enrollment and a null window score on every watch, and the sweep's
-- `where status='active'` predicate would start selecting rows that are not
-- loops. The permission artifact IS shared — `vy_channel_attestation`, WS-S's
-- table, unchanged — because a single video is still audio from a channel and
-- the thing being consented to has not changed.
--
-- ── why the windows are a separate table and not jsonb ───────────────────
-- `context/measurements.md#reference-window-beats-the-finetune`: which 10 s
-- conditions the model moves fidelity 0.0625 on the owner's own voice, three
-- times the fine-tune delta. That makes the ranking a MEASUREMENT, not a
-- detail of a run, and measurements get columns: a future sweep will want
-- `order by score desc`, `avg(snr_db)`, and "did the best window ever land in
-- the first ten seconds" across every enrollment on the platform. None of
-- those are questions a jsonb blob answers, and a number that cannot be
-- aggregated cannot be compared against a future one, which is the only thing
-- numbers are for.
--
-- Idempotent, one statement per request — 009's law. Neon's SQL-over-HTTP
-- endpoint takes exactly one statement per body and db/migrations/apply.mjs
-- runs them individually with no transaction. No DO blocks, no functions.
--
-- No foreign keys, same convention as 051/053/057: `replica_id` /
-- `owner_user_id` are FK-SHAPED and the binding is the WHERE clause.

create table if not exists vy_video_enrollment (
  enrollment_id   uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  -- The 11-character id, never a URL. `api/_video-enroll.js`'s `parseVideoUrl`
  -- reduces whatever the teacher pasted to this before anything is stored, so
  -- no row can carry a host, a redirect or a tracking parameter.
  video_id        text not null,
  -- The attested channel, denormalized from the attestation so the daily
  -- quota query and the erasure walk never have to join to it.
  channel_url     text not null,
  provider        text not null default 'youtube'
                  check (provider in ('youtube')),
  -- FK-shaped, into vy_channel_attestation. Nullable ONLY so a row refused at
  -- admission can still be recorded; the lane never inserts a working row
  -- without it.
  attestation_id  uuid,
  state           text not null default 'admitted'
                  check (state in ('admitted','extracting','scoring','transcribing','ready','refused','failed')),
  -- The named reason. A lane whose failures are all 'failed' is a lane an
  -- operator reads a log to understand; every code this column holds is one
  -- `services/media-extract` or the quota predicate produced by name —
  -- `extractor_bot_check` and `video_enroll_owner_daily_cap` are different
  -- problems with different fixes and they must not look alike on a screen.
  failure_code    text,
  duration_ms     bigint,
  audio_bytes     bigint,
  object_path     text,
  -- The chosen reference window. Stored on the parent as well as in the
  -- child table because "what is this replica speaking from" is a one-row
  -- question asked on every studio render, and answering it with a join to a
  -- ranked list ordered by score is how a hot path acquires a sort.
  selected_window_start_ms  integer,
  selected_window_length_ms integer,
  selected_window_score     numeric(6,4),
  -- Says what produced the score, on every row, forever. Today it is a WAV
  -- signal probe and NOT an ECAPA fidelity measurement; when a real scorer
  -- lands, old rows must remain readable as what they actually were rather
  -- than being silently reinterpreted (`score_source` is WS-X's rule on
  -- `mirror_call`'s conditioning score, applied here for the same reason).
  score_source    text not null default 'wav-signal-probe/v1',
  transcript_chars integer,
  -- Per-stage wall clock and outcome, appended as the lane runs. This is
  -- where `measurements.md`'s per-clone cost number comes from, and it
  -- records FAILED stages too: the cost of a bot check is a real cost, and a
  -- table that only counted successes would understate the lane exactly
  -- where it is going wrong.
  receipts        jsonb not null default '[]'::jsonb,
  -- Generated, not supplied: the day the quota counts against. A client-
  -- supplied day is a client-supplied quota reset.
  enrollment_day  date not null generated always as ((created_at at time zone 'UTC')::date) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The idempotency key AND the double-click guard. One owner enrolling the
-- same video twice in a day is a no-op that returns the existing row rather
-- than a second extraction, a second ASR bill and a second quota slot.
create unique index if not exists vy_video_enrollment_daily_ix
  on vy_video_enrollment (owner_user_id, video_id, enrollment_day);

create index if not exists vy_video_enrollment_owner_ix
  on vy_video_enrollment (replica_id, owner_user_id, created_at desc);

-- The quota query's index. It counts rows in chargeable states created today,
-- globally and per owner, in ONE statement — a partial index on the states
-- that cost money keeps that count off a sequential scan as the table grows.
create index if not exists vy_video_enrollment_quota_ix
  on vy_video_enrollment (created_at desc)
  where state in ('extracting','scoring','transcribing','ready');

create table if not exists vy_video_enrollment_window (
  window_id       uuid primary key,
  enrollment_id   uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  rank            integer not null,
  start_ms        integer not null,
  end_ms          integer not null,
  score           numeric(6,4) not null,
  voiced_fraction numeric(6,4) not null,
  snr_db          numeric(7,2) not null,
  clipping_fraction numeric(9,6) not null,
  -- NULL means "diarization did not run", and that is a different fact from
  -- 1.0 ("measured, and it is one speaker"). Defaulting the unmeasured case
  -- to perfect purity is how a window containing a student's question becomes
  -- the voice of the clone.
  speaker_purity  numeric(6,4),
  score_source    text not null default 'wav-signal-probe/v1',
  metrics         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Idempotent re-scoring: the same window of the same enrollment is one row.
create unique index if not exists vy_video_enrollment_window_ix
  on vy_video_enrollment_window (enrollment_id, start_ms);

create index if not exists vy_video_enrollment_window_rank_ix
  on vy_video_enrollment_window (enrollment_id, rank asc);

-- The erasure reach. `api/_replica-full-erasure.js` deletes by replica; this
-- index is what makes that delete a lookup rather than a scan, and its
-- existence here is the reminder that BOTH new tables are in the walk.
create index if not exists vy_video_enrollment_window_owner_ix
  on vy_video_enrollment_window (replica_id, owner_user_id);
