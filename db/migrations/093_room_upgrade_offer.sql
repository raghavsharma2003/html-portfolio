-- Migration 093 - the upgrade moment's own ledger (WS-R30).
--
-- The Phase 2 gate needs three numbers: paid conversion >= 12%, week-six
-- retention >= 35%, three creators renewing unasked. Week-six exists
-- (migration 077, WS-R12). Nothing measures conversion, because nothing ever
-- recorded that an upgrade offer was SHOWN - the only signal that existed was
-- `vy_room_subscription`, which only ever has a row once a follower already
-- said yes. A conversion RATE needs a denominator, and this table is it: one
-- row per time a follower is shown the offer, so "shown, started, paid" can
-- be counted rather than guessed.
--
-- ── PERSON lane, both ways ──────────────────────────────────────────────
--
-- Carries BOTH `person_id` (the manifest's own key, api/memory.js's
-- PERSON_TABLES) and `follower_id references vy_room_follower(follower_id)
-- on delete cascade` - the same shape `vy_room_subscription` (migration 078)
-- already has, for the identical reason: a whole-account wipe finds this row
-- directly by person_id with no join, and the Room's own "forget me" still
-- has a real FK to lean on if a future edit ever forgets the explicit
-- statement (`api/_room-surface.js`'s own child-before-parent rule, WS-R27,
-- means the explicit delete must still run BEFORE `vy_room_follower`'s row
-- goes, so the count in the forget receipt is real rather than a phantom
-- zero left by the cascade running first).
--
-- ── content-free ────────────────────────────────────────────────────────
--
-- `reason` and `outcome` are both closed enums, not text a person typed.
-- Nothing on this row is anything a follower said.
--
-- ── the 14-day cooldown lives on the WRITE, not on a read-then-check ──────
--
-- `api/_phase-gate.js`'s `recordOffer` is one INSERT ... SELECT ... WHERE
-- NOT EXISTS statement scoped to `follower_id` and a 14-day window on
-- `shown_at` - the same "the check is the write" shape migration 089's
-- `vy_public_rate` upsert already uses (WS-R26), so two racing requests can
-- never both insert a row inside the same 14-day window. No unique
-- constraint enforces this at the schema level on purpose: the window is
-- relative to `now()`, not a fixed bucket, so a unique index cannot express
-- it, and the WHERE NOT EXISTS predicate is what carries the guarantee.
--
-- ── the outcome pairing ─────────────────────────────────────────────────
--
-- `outcome`/`outcome_at` are set together or not at all - the same shape
-- `vy_replica_drift_report`'s `alerted_at` pairing (migration 076) already
-- states for a different pair of columns.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, explicit ::type casts on
-- every bound parameter.
create table if not exists vy_room_upgrade_offer (
  offer_id    uuid primary key,
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  person_id   uuid not null,
  follower_id uuid not null references vy_room_follower(follower_id) on delete cascade,
  shown_at    timestamptz not null default now(),
  reason      text not null check (reason in ('session_worked', 'cap_reached')),
  outcome     text check (outcome in ('dismissed', 'started', 'paid')),
  outcome_at  timestamptz,
  constraint vy_room_upgrade_offer_outcome_pairs check ((outcome is null) = (outcome_at is null))
);
-- The workstream brief's own index, and the shape both `recordOffer`'s
-- 14-day NOT EXISTS check and `markOfferOutcome`'s "most recent open offer"
-- lookup actually run against.
create index if not exists vy_room_upgrade_offer_follower_ix
  on vy_room_upgrade_offer (follower_id, shown_at desc);
-- `conversionReport`'s own funnel read: shown/started/paid, per reason, over
-- a trailing window - scoped to one room, never grouped across rooms.
create index if not exists vy_room_upgrade_offer_room_shown_ix
  on vy_room_upgrade_offer (room_id, shown_at desc);
