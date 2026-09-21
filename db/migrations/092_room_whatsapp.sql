-- Migration 092 - check-ins over WhatsApp utility templates (WS-R29).
--
-- api/whatsapp.js is Meera's Cloud API surface: NOT WIRED, HMAC-verified,
-- refuses a free-form send outside Meta's 24-hour customer-service window.
-- This workstream reuses its two verified primitives (the HMAC check, the
-- Cloud API request shape) for the Room's own narrower need: a paid
-- follower's check-in, delivered as an approved UTILITY TEMPLATE, never a
-- free-form message and never gated by the 24-hour window (a template is the
-- one message class Meta permits outside it, which is the whole reason this
-- channel exists for a proactive check-in at all).
--
-- ONE TABLE. A follower opts in with a phone number, SEPARATELY from the
-- Room's OTP sign-in phone (a follower may sign in with one number and want
-- check-ins on a different WhatsApp-registered one, and conflating the two
-- would silently text a number the follower never consented to receive on).
-- Primary key is `follower_id`: one WhatsApp destination per follower, ever -
-- opting in again replaces the row (phone number, consent timestamp, state)
-- rather than growing a second one, the same "at most one current thing"
-- shape `vy_room_follower_channel`'s `on conflict (channel, channel_ref)`
-- uses one migration over, applied here to `follower_id` instead because a
-- follower's WhatsApp destination, unlike a Telegram chat id, is something
-- THEY provide and may change their mind about.
--
-- `state` carries the revoke-on-failure law (workstream law #4, `api/
-- _room-push.js`'s own precedent for a push endpoint that starts bouncing):
-- 'active' sends; 'stopped' is the follower's own choice (never sent again
-- until they opt in fresh); 'failed' is what a 4xx from Meta naming an
-- invalid number sets, with `last_failure_code` carrying Meta's own error
-- code so a follower's "why did this stop" has a real answer rather than a
-- guess. No column here ever holds a word anyone said - `phone_e164` is a
-- destination, not content, the same distinction `vy_room_push_subscription`
-- draws for an `endpoint` URL.
--
-- PERSON lane (api/memory.js's PERSON_TABLES, gated on this migration having
-- landed exactly like every other WS-R16-and-later Room table): `follower_id
-- references vy_room_follower(follower_id) on delete cascade` (so a
-- follower's own forget or a whole-account wipe removes this row even if
-- neither ever names it by SQL text) AND an explicit, COUNTED delete in
-- `api/_room-surface.js`'s `roomForget` - `vy_room_push_subscription`'s own
-- WS-R27 lesson, restated: a row reached ONLY by cascade is a row deleted
-- but never counted, and a receipt that under-counts is a receipt that
-- lies about how much less than the true amount happened.
--
-- `room_id` carries a real FK CASCADE (071's convention: a child row for a
-- Room that no longer exists is not a child row for anything); no FK on
-- `person_id` (009's standing rule, restated by every migration since - the
-- PERSON is the WHERE-clause binding, never a foreign key).
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, explicit ::type casts on
-- every bound parameter this migration's own callers use.
create table if not exists vy_room_follower_whatsapp (
  follower_id     uuid primary key references vy_room_follower(follower_id) on delete cascade,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  phone_e164      text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  consented_at    timestamptz not null default now(),
  state           text not null default 'active' check (state in ('active', 'stopped', 'failed')),
  last_failure_code text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- The sweep's own read: which follower(s) in this Room currently have an
-- active WhatsApp destination. Leading on room_id+person_id so it serves the
-- same lookup shape `vy_room_checkin`'s own scope index does, one table over.
create index if not exists vy_room_follower_whatsapp_scope_ix
  on vy_room_follower_whatsapp (room_id, person_id);

-- Added at the merge (2026-09-04): the inbound webhook resolves a follower
-- by the number Meta hands back (`replyWithRoomLink`), and an EXPLAIN on the
-- live database planned that lookup as a sequential scan. One row per
-- opted-in follower, so the index is small; without it every inbound
-- message would walk the table.
create index if not exists vy_room_follower_whatsapp_phone_ix
  on vy_room_follower_whatsapp (phone_e164);
