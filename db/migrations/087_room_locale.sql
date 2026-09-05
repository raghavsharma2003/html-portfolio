-- Migration 087 - the Room in Hindi (WS-R24).
--
-- India first, and the Room's chrome (the app-voiced cards, buttons, panels,
-- the disclosure line, the capped card, the check-in and Pulse and Handoff
-- panels, the Telegram commands' replies) must speak the FOLLOWER's own
-- language, never the creator's. The creator's AI keeps speaking whatever the
-- creator speaks - this migration touches nothing about that; it only gives
-- the follower's own row and the room's own row a place to keep a language
-- choice for the CHROME. v1: English and Hindi (Devanagari).
--
--   vy_room_follower.locale        the follower's OWN choice, once they have
--                                  a row at all. Set at INSERT time (the
--                                  browser's language, or the room's own
--                                  default when the browser gave nothing),
--                                  changed later only through
--                                  `api/_room-surface.js`'s `roomSetLocale`,
--                                  which is scoped off the follower's own
--                                  verified session and can never be asked to
--                                  name a different follower's row. NEVER
--                                  reset on a repeat join (api/_room-surface.js
--                                  deliberately excludes it from that
--                                  statement's own SET list) - re-attesting or
--                                  changing the memory answer must not
--                                  silently undo a language a follower already
--                                  chose.
--
--   vy_room.default_locale         the CREATOR's own choice, read only when a
--                                  follower has no row yet AND the browser
--                                  reported nothing usable
--                                  (`api/_room-surface.js`'s `openRoom`
--                                  fallback chain: follower's own locale, then
--                                  a valid browser hint, then this column).
--                                  Creator-editable exactly as
--                                  `free_monthly_messages` (071) and
--                                  `paid_monthly_messages`/
--                                  `paid_monthly_voice_seconds` (081) already
--                                  are.
--
-- Both CHECK-bounded to the two locales this product ships rather than left
-- open to any string, so a typo or a stray value from a future client build
-- fails at the database rather than silently reading as a third, unhandled
-- language somewhere downstream. Widening to a third locale means widening
-- both CHECKs here (and `src/room/copy.ts`'s `ROOM_LOCALES`,
-- `api/_room-surface.js`'s `ROOM_LOCALES`, and `scripts/check-layout.mjs`'s
-- `room:hi`-shaped target) in the same change - `evals/room-locale/run.mjs`
-- fails the build if any of the four drift apart.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, no foreign key on any
-- person/owner column (009's WHERE-clause-binding convention; neither column
-- here changes that convention - both are on tables that already carry their
-- own FK/no-FK shape from 071/081 and this migration adds no new table).
alter table vy_room_follower
  add column if not exists locale text not null default 'en';
alter table vy_room_follower
  drop constraint if exists vy_room_follower_locale_check;
alter table vy_room_follower
  add constraint vy_room_follower_locale_check check (locale in ('en', 'hi'));

alter table vy_room
  add column if not exists default_locale text not null default 'en';
alter table vy_room
  drop constraint if exists vy_room_default_locale_check;
alter table vy_room
  add constraint vy_room_default_locale_check check (default_locale in ('en', 'hi'));
