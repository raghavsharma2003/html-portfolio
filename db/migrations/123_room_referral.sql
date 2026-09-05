-- Migration 123 - follower referrals (WS-R86). A follower can bring a
-- friend with a personal link; the creator learns only that referrals
-- happen, in counts under the floor; the follower is never named to
-- anyone, ever, including to the platform's own operators reading this
-- table directly.
--
-- Two changes, one migration:
--
-- (a) `vy_room_referral(referral_id, room_id, referrer_hash, created_at)` --
-- a room-aggregate table, NO PERSON COLUMN AT ALL, not even an FK-less
-- follower_id the way `vy_room_follower_reply_flag` carries one. Checked
-- against scripts/relcheck.mjs's own PERSON_COLUMNS list before this
-- migration was written (person_id, device_id, user_id, auth_user_id,
-- subject_person_id, speaker_person_id, granted_by, granted_to,
-- owner_user_id, redeemed_by_user_id): this table carries none of them --
-- `vy_room_arrival`'s own precedent (migration 102's own header) restated
-- for a referral instead of an arrival channel.
--
-- `referrer_hash` is a salted sha256 of the referring follower's own
-- person id and the Room -- `api/_rate-limit.js`'s own `RATE_SALT` salt
-- shape (WS-R26, migration 089), restated here WITHOUT that module's
-- daily rotation: a referral link has to keep working, and keep comparing
-- equal to itself, for as long as the follower who minted it keeps
-- sharing it -- not just for one UTC day the way an abuse-limit counter
-- does. The CHECK below is a second, structural layer behind a value
-- `api/_room-surface.js`'s own hex-shape allowlist already validated
-- before it ever reached SQL (`resolveArrivalVia`'s own precedent, this
-- migration's header restated for a hash instead of an enum) -- a caller
-- cannot smuggle anything but 64 lowercase hex characters into this
-- column no matter what reaches this statement.
--
-- Real FK CASCADE from `vy_room`, and `api/_replica-full-erasure.js` also
-- deletes this table by name, child before parent alongside its
-- room-aggregate siblings (`vy_room_arrival`, `vy_room_taste_turn`) --
-- "relying on a cascade means relying on an FK nobody re-checks," 071's
-- own words, restated again.
create table if not exists vy_room_referral (
  referral_id   uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  referrer_hash text not null check (referrer_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now()
);

-- The Room Studio's own "Friends brought this week" read (api/_funnel.js's
-- `friendsBroughtThisWeek`) is scoped to ONE room over a rolling window --
-- this index is that query's own access path, `vy_room_arrival`'s own
-- `via_day` index restated for `(room_id, created_at)` instead of
-- `(via, day)`.
create index if not exists vy_room_referral_room_created_ix
  on vy_room_referral (room_id, created_at);

-- (b) `vy_room_arrival.via` admits 'friend' alongside the six values
-- migration 121 already named -- the referral link's own arrival channel.
-- `api/_room-surface.js`'s `ROOM_ARRIVAL_VIA` is widened in the SAME
-- commit as this file (this workstream's own law 1: "never one without
-- the other" -- WS-R78's own law, migration 121's own header, restated a
-- second time: an unrecognised `via` value is silently refused by the
-- CHECK, never a thrown error, so a JS allowlist and a SQL CHECK that
-- disagree mean a real count silently stays at zero rather than failing
-- loudly).
--
-- The constraint name is the one migration 113 gave it, read back from
-- db/schema.sql (that migration's own comment already names it as read
-- back from the live catalog at its own merge) rather than re-derived
-- here -- migration 121's own precedent, restated a second time.
--
-- WS-R85 (migration 122, the share kit) may add its OWN values to this
-- SAME constraint in the same wave. This statement is written against
-- what this workstream's own tree carries at the time this file was
-- written (share, direct, embed, search, install, poster); the main loop
-- reconciles the union of both workstreams' added values at the merge,
-- reading the live constraint back one more time before either lands, per
-- this workstream's own brief.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster', 'friend'));
