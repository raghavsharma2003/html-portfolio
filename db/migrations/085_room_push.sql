-- Migration 085 - web push for check-ins, the installable Room (WS-R22).
--
-- WS-R16's check-ins deliver in-app and leave WhatsApp as a recorded-intent
-- seam that never sends (`deliverers.whatsappTemplate`, migration 079). The
-- channel that needs no Meta account, no template approval and no
-- per-message fee is the browser's own push: a follower installs the Room
-- (a PWA manifest for /r/) and allows notifications; a due check-in arrives
-- as a push whose body is content-free and whose tap opens the thread where
-- the real message already sits, delivered through the one reply door as
-- before (`api/_checkins.js`'s own header - this migration adds nothing that
-- changes how a check-in is generated, only how its arrival is announced).
--
-- Two changes, and a third that rides along:
--
--   vy_room_push_subscription  a follower's own browser subscription. PERSON
--                               lane (PERSON_TABLES, "forget-only"), no
--                               `agent_id` column - migration 082's own
--                               `vy_room_follower_channel` precedent one
--                               table over: `follower_id references
--                               vy_room_follower(follower_id) on delete
--                               cascade` is what removes every subscription
--                               the moment `roomForget` deletes the follower
--                               row, so `roomForget` itself needs no new
--                               explicit statement - the cascade is the whole
--                               mechanism, `vy_room_follower_channel`'s own
--                               proof that this shape works without one.
--   vy_room_checkin_delivery   channel CHECK widened to admit 'web_push',
--                               idempotently (drop-then-add is the only way
--                               Postgres lets an unnamed CHECK be widened;
--                               008a_speaker_participants.sql is this exact
--                               dance one migration family over). The
--                               constraint name relies on Postgres's default
--                               naming for an unnamed single-column CHECK
--                               (`<table>_<column>_check`) rather than a
--                               name this repo chose - NOT independently
--                               confirmed against a live catalog in this
--                               environment (no NEON_URL); the main loop
--                               should read `vy_room_checkin_delivery`'s
--                               constraint names back before relying on this
--                               guess a second time.
--   vy_room_checkin            gains `quiet_from`/`quiet_to` (nullable
--                               `time`), the follower's own "not between"
--                               window. Both null (the default, so an
--                               existing row is unaffected) means no window.
--                               `api/_checkins.js`'s sweep reads these two
--                               columns directly in its due-select WHERE,
--                               `next_due_at`'s own law extended rather than
--                               replaced: a row inside its own quiet window
--                               is not selected until the window ends, and
--                               `computeNextDue` (pure, JS) is what keeps a
--                               freshly-advanced `next_due_at` from landing
--                               inside the window in the first place.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO blocks,
-- explicit ::uuid casts, no FK on person_id (009's convention, restated by
-- every migration since) - room_id and follower_id carry real FK CASCADE,
-- 071's/078's/082's own precedent.
create table if not exists vy_room_push_subscription (
  subscription_id uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  follower_id     uuid not null references vy_room_follower(follower_id) on delete cascade,
  -- The subscription itself. Secrets in the sense AGENTS.md means: never
  -- logged, never in an eval fixture verbatim beyond fakes (the workstream
  -- brief's own law #2) - this migration only shapes the columns; the
  -- discipline about what ever prints them lives in api/_push/webpush.js and
  -- api/_room-push.js.
  endpoint        text not null,
  p256dh          text not null,
  auth            text not null,
  user_agent_hash text not null default '',
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
-- "unique on endpoint" (workstream brief law #2): a browser mints one
-- subscription per (origin, device), so `push_subscribe` is an UPSERT on this
-- key - a follower who re-enables notifications on the same device updates
-- the same row (clearing `revoked_at`) rather than growing a duplicate.
create unique index if not exists vy_room_push_subscription_endpoint_ix
  on vy_room_push_subscription (endpoint);
create index if not exists vy_room_push_subscription_follower_ix
  on vy_room_push_subscription (follower_id);
create index if not exists vy_room_push_subscription_scope_ix
  on vy_room_push_subscription (person_id, room_id);
-- The sweep's own read shape: every ACTIVE subscription for one follower.
-- Partial on `revoked_at is null` so a revoked row (the 404/410 case, or a
-- forgotten Room whose cascade has not yet run) never costs the delivery
-- loop a row it will only skip.
create index if not exists vy_room_push_subscription_active_ix
  on vy_room_push_subscription (follower_id)
  where revoked_at is null;

alter table vy_room_checkin_delivery drop constraint if exists vy_room_checkin_delivery_channel_check;
alter table vy_room_checkin_delivery add constraint vy_room_checkin_delivery_channel_check
  check (channel in ('in_app','whatsapp_template','web_push'));

alter table vy_room_checkin add column if not exists quiet_from time;
alter table vy_room_checkin add column if not exists quiet_to time;
