-- Migration 128 - the Room on WhatsApp (WS-R104). Which room a WhatsApp
-- phone number currently means, `vy_room_follower_channel`'s own pointer
-- (082, WS-R18) restated one transport over, with one deliberate
-- difference this header explains in full.
--
-- ── why this is NOT a `channel` row on the Telegram table ──────────────────
--
-- `vy_room_follower_channel.channel_ref` stores Telegram's own chat id in
-- the clear - a bot-scoped integer that identifies nothing outside this
-- platform's own bot relationship and is worthless to anyone who does not
-- already hold `ROOM_TELEGRAM_BOT_TOKEN`. A WhatsApp phone number is not
-- that: it is the same E.164 number the follower's own contacts, and any
-- other service they have ever given it to, already hold. Storing it in the
-- clear on a pointer table would put a second, INDEPENDENT copy of a
-- real-world identifier at rest for every follower who ever writes one
-- WhatsApp message to a Room, on top of `vy_room_follower_whatsapp`'s own
-- (092, WS-R29) already-necessary one - unlike that table, this one does
-- not need to dial the number back out (Meta hands this file the sender's
-- own number on every inbound webhook delivery, `phone_e164` on that table
-- exists ONLY because a check-in is a proactive send with nobody's inbound
-- message to read it off), so there is no product reason to hold it at all.
-- `phone_hash` is `sha256("room-wa-chat" || "|" || the E.164 number ||
-- "|" || RATE_SALT)` (api/_room-whatsapp-chat.js's own `phoneHash`, the
-- SAME salted-sha256 SHAPE `api/_rate-limit.js`'s `hashKey` already uses for
-- every public rate-limit key, WS-R26's own law, restated here WITHOUT that
-- function's own daily rotation - a rotating hash cannot be a lookup key
-- for a row meant to outlive one calendar day) - a hash a database
-- compromise cannot reverse without the deploy's own `RATE_SALT`, and one
-- this file never needs to reverse either, since every reply is sent back
-- to the number Meta's own webhook payload just supplied in the same
-- request (api/_room-whatsapp-chat.js's own header states this a second
-- time at the point it matters).
--
-- ── the pointer's own shape, one row per phone, replaced on re-join ────────
--
-- `phone_hash` is the PRIMARY KEY rather than a surrogate uuid with a
-- separate unique index the way 082's `channel_map_id`/`channel_ref` pair
-- is: a WhatsApp phone can mean at most one Room at a time (the identical
-- "one address, one binding" law 082's own header states), and there is no
-- second column this table would ever need to look a row up BY besides the
-- hash itself, so a surrogate key would buy nothing. `join <slug>` sent from
-- an already-bound phone REPLACES this row (an upsert on the primary key),
-- never adds a second one.
--
-- ── `locale`/`joined_at`/`stopped_at`/`stopped_code` ride on THIS row,
--    unlike 082 ───────────────────────────────────────────────────────────
--
-- 082's own pointer carries none of these - Telegram's `/hindi`/`/english`
-- write the follower row's own `locale` column instead (`roomSetLocale`),
-- and 082 needed no `stopped_at`/`stopped_code` because `unbindTelegramChannel`
-- is a hard DELETE with nothing left to inspect afterward. This table keeps
-- its own copy of all four because `phone_hash` is NOT reversible: once a
-- phone stops (or is deleted for cascade reasons), nobody could tell WHEN or
-- WHY it stopped without a surviving row to ask, and unlike Telegram there
-- is no follower-row `locale` this table could always assume is still the
-- right one to read after a WhatsApp-side stop, since a person may leave
-- this channel while remaining a follower on the web. `stopped_at`
-- non-null is this table's own "left" state (WS-R18's own `stop` law, kept
-- as a row rather than a delete for exactly the reason 082 could not afford
-- one: the row IS the only record this channel ever existed for this
-- phone) - `stopped_code` is a short, closed reason string
-- (`api/_room-whatsapp-chat.js` is the only writer and reader of its
-- values), free text is never accepted.
--
-- ── FK on room_id, cascade, allowed (097's own precedent) - NO FK on
--    person_id or follower_id, unlike 082 ─────────────────────────────────
--
-- 082 carries `follower_id references vy_room_follower(follower_id) on
-- delete cascade` and relies on that cascade for erasure reach. This table
-- does NOT: 009's own law is that `person_id`/`follower_id` are a
-- WHERE-clause binding, never a foreign key, and 082 was this project's own
-- one exception to that rule (its header says so). WS-R104's own brief
-- states the return to 009's stricter shape explicitly - erasure reach for
-- this table is instead the explicit, BY-NAME delete `roomForgetCore` (api/
-- _room-surface.js) already gives 082's own table (WS-R27's lesson: a row
-- reached only by cascade is a row deleted but never counted), so no
-- cascade is needed to make "forget me" reach this table at all. `room_id`
-- keeps its FK (with cascade) because a Room's own deletion legitimately
-- takes every pointer into it, the identical reasoning 082's `room_id`
-- column already carries.
--
-- ── PERSON_TABLES, the export manifest, the forget path, TABLE_ROLES ───────
--
-- Listed in api/memory.js's `PERSON_TABLES` with `lane: "relational"`, no
-- `agent: true` (no `agent_id` column, 082's own convention restated).
-- `api/_room-surface.js`'s `roomForgetCore` deletes it by name, room_id +
-- person_id, exactly where 082's own explicit delete already sits.
-- `ROOM_EXPORT_EXTRA` carries an entry with a shape that names state and
-- timestamps but never `phone_hash` itself - a follower's export is theirs
-- to read, but a one-way hash of their own number is not information the
-- export needs to hand back to prove anything to them (`api/_room-
-- whatsapp.js`'s `masked_phone` shape solves the analogous problem for
-- `vy_room_follower_whatsapp` by showing digits back; this table has no
-- digits to show, since it never stored any). `evals/room-leak/world.mjs`'s
-- `TABLE_ROLES` names this table's owners.
--
-- ── one statement per request, idempotent, no DO blocks (009's law) ────────
create table if not exists vy_room_follower_whatsapp_chat (
  phone_hash   text primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  follower_id  uuid not null,
  locale       text not null default 'en',
  joined_at    timestamptz not null default now(),
  stopped_at   timestamptz,
  stopped_code text,
  constraint vy_room_follower_whatsapp_chat_locale_check check (locale in ('en', 'hi')),
  constraint vy_room_follower_whatsapp_chat_hash_check check (phone_hash ~ '^[0-9a-f]{64}$')
);

-- The reverse lookup `roomForgetCore`'s/`roomExport`'s own room+person shape
-- needs (082's own `_person_ix`, restated) and the join/re-join upsert's own
-- "does this person already have a WhatsApp pointer in this room" check.
create index if not exists vy_room_follower_whatsapp_chat_person_ix
  on vy_room_follower_whatsapp_chat (person_id, room_id);

create index if not exists vy_room_follower_whatsapp_chat_follower_ix
  on vy_room_follower_whatsapp_chat (follower_id);
