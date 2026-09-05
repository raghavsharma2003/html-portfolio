-- Migration 106 - creator-issued invites (WS-R47).
--
-- WS-R23 (086) built the operator's front door: an operator picks who gets
-- to build an AI, one code at a time. Growth from here is B2B-of-one - a
-- creator telling a peer creator, not an operator working a list - so every
-- PUBLISHED creator now gets three invites of their own to hand out, no
-- operator in the loop.
--
-- One column, one CHECK, one index. `vy_creator_invite` itself does not
-- change shape: `issued_kind` says WHO issued a row, `issued_by_user_id`
-- still says exactly who (an operator's Supabase id, or now a creator's own
-- owner_user_id), and every other column - code_hash, expires_at,
-- redeemed_at, redeemed_by_user_id - means exactly what 086 already defined,
-- for a code from either lane. Redemption (api/_replica.js's own CTE) does
-- not look at issued_kind at all: a creator-issued code redeems exactly the
-- way an operator-issued one does, which is workstream law #3 restated -
-- "redeem is unchanged".
--
-- WHY A DEFAULT RATHER THAN A BACKFILL STATEMENT: every row `vy_creator_invite`
-- has ever held was issued by `issueInvite` (api/_invites.js), the operator
-- path, and nothing else has ever written this table. `default 'operator'`
-- is therefore not a guess papering over unknown history, it is the
-- documented fact of what this table's rows have exclusively been until this
-- migration - the same reasoning migration 073's `computed_at default now()`
-- and this repo's other additive-column migrations use throughout.
--
-- WHY THIS IS ONE STATEMENT: `add column if not exists ... check (...)` is a
-- single ALTER TABLE clause, and Postgres skips the whole clause - column,
-- default and CHECK together - when the column already exists, which is what
-- makes a bare re-run of this file a no-op rather than a duplicate-check
-- error. No DO block, no function, matching every migration before it.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one). No new table, so no new PERSON_TABLES/relcheck
-- wiring: `vy_creator_invite` is already on the owner lane (086's own
-- header), already reached by api/_replica-full-erasure.js's named delete,
-- and already inside scripts/relcheck.mjs's PERSON_COLUMNS/owner-lane walk
-- via `redeemed_by_user_id` - none of that changes shape when a row's
-- `issued_kind` is 'creator' instead of 'operator'.
alter table vy_creator_invite
  add column if not exists issued_kind text not null default 'operator'
    check (issued_kind in ('operator', 'creator'));

-- The quota predicate's own index: `issueCreatorInvite`'s WHERE clause counts
-- `(issued_by_user_id, issued_kind = 'creator')` on every issue attempt, and
-- this is the exact composite that count scans.
create index if not exists vy_creator_invite_issued_kind_ix
  on vy_creator_invite (issued_by_user_id, issued_kind);
