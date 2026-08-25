-- Migration 015 — push registrations (WS-NOTIFY, the FCM slot).
--
-- NOT NEEDED UNTIL PUSH IS CONFIGURED. api/push-token.js refuses every request
-- before it reads the body when the FCM_* keys are empty, and api/_push.js
-- returns before any query, so with the shipping config no statement in this
-- file is ever executed. Apply it as step 5 of src/notify/config.ts's list, at
-- the same time as the keys.
--
-- ── WHAT A ROW IS ────────────────────────────────────────────────────────
--
-- One handle that can put text on one person's lock screen. That is closer to
-- a phone number than to a session id, and the schema is shaped accordingly.
--
-- STRICT FROM BIRTH, like migrations 011 and 012: `agent_id` is NOT NULL with
-- NO DEFAULT. 010 removed 009's transitional defaults after they exposed
-- thirteen writers that named no agent (`strict-exposed-13`). Reachability is
-- the worst possible table to discover that on — a token filed under the wrong
-- agent is another agent able to contact this person.
--
-- ── ONE ROW PER (AGENT, DEVICE), NEVER A HISTORY ─────────────────────────
--
-- The unique constraint IS the policy. A device that re-registers replaces its
-- token; there is no `created_at` chain of superseded tokens, because an old
-- token that still resolves is an old phone still buzzing, and a table that
-- accumulates them is a table whose oldest rows are its most dangerous.
--
-- ── THE FORGET PATH, AND THE GATE THAT ENFORCES IT ───────────────────────
--
-- Two independent doors, deliberately, because reachability is the one thing
-- that must not survive either:
--
--   1. the client's own teardown posts `{ revoke: true }` (src/notify/index.ts
--      `clearReachability`, called on clear-chat, on "make her forget you" and
--      on an account switch). This is the door that works while the phone is
--      in the user's hand;
--   2. api/memory.js's forget cascade, via a row in its PERSON_TABLES
--      manifest, for the case the client never comes back online to make the
--      call in (1) — a user who uninstalls and then asks for deletion.
--
-- ⚠ APPLYING THIS MIGRATION WITHOUT (2) FAILS THE ZERO-ORPHAN SWEEP, BY
-- DESIGN. scripts/relcheck.mjs enumerates every table in the schema carrying a
-- person/device/user column and fails any that is in neither PERSON_TABLES nor
-- its own EXEMPT map, because "a table that is in neither is invisible to BOTH
-- forget and export". So this table cannot exist in a database without a
-- written decision about its deletion — which is exactly the property a
-- reachability table should have. The manifest row is:
--
--     { table: "vy_push_token", key: "device_id", lane: "relational",
--       agent: true },
--
-- filed "relational" and not "person" for the reason vy_surface_identity's own
-- note in that file gives: lane "person" members are SKIPPED by the manifest
-- wipe loop and taken by explicit guarded code, and no such code exists here.
--
-- There is NO foreign key to vy_person_device, and that is a correctness
-- decision rather than an omission: "an unmapped device IS its person" (§2.1),
-- so most devices have no mapping row at all and an FK would reject the
-- registration of exactly the anonymous users this product mostly has.
--
-- A soft-delete column is deliberately absent. A flagged-inactive token is
-- still a token; the row is the artefact.
--
-- CONTENT LAW (migration 012's, restated because it binds here too): there is
-- no column in this table that can hold anything anybody said. A notification's
-- text is built at send time from src/notify/copy.ts and is never stored.

create table if not exists vy_push_token (
  agent_id    uuid not null,
  device_id   uuid not null,          -- same type as vy_person_device.device_id
  token       text not null,
  platform    text not null default 'web'
                check (platform in ('web', 'android', 'ios')),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (agent_id, device_id)
);

-- The send path's only read: "the tokens for these devices, for this agent".
-- Agent first, matching every other index migration 009 added, because the
-- agent predicate is evaluated in the WHERE before rank on every scoped table.
create index if not exists vy_push_token_agent_ix
  on vy_push_token (agent_id, device_id);

-- Stale-token cleanup deletes BY TOKEN (FCM answers 404 UNREGISTERED with the
-- token, not the device), so that lookup gets its own index rather than a scan
-- on a table whose whole point is to be small and correct.
create index if not exists vy_push_token_token_ix
  on vy_push_token (token);
