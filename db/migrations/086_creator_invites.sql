-- Migration 086 - creator applications and invites (WS-R23).
--
-- Phase 0's runbook names an "Application" step with no coded flow, and the
-- studio otherwise lets any signed-in account create a replica. The plan for
-- the first Rooms is one creator at a time, by hand, by invitation. Two
-- tables:
--
--   vy_creator_application  the public, free, rate-limited "apply" form on
--                            site/vyakti.html. It is the PLATFORM's own lane,
--                            not a person lane: it names a PROSPECTIVE
--                            creator who has never signed in and has not
--                            consented to memory or anything else this system
--                            tracks about a person. It carries no
--                            auth_user_id, owner_user_id or person_id column
--                            of any kind, so it is (correctly, not by
--                            accident) invisible to api/memory.js's
--                            PERSON_TABLES manifest and to
--                            scripts/relcheck.mjs's person/owner coverage
--                            scan - the manifest's own header
--                            ("WHAT IS DELIBERATELY NOT IN THE LIST ABOVE")
--                            is written for exactly this shape of table.
--                            Minimal by design (name, a link to the archive,
--                            who the audience is, a contact) and deletable by
--                            NAME from an operator op (api/_apply.js's
--                            eraseApplicationsByContact), never by a person's
--                            own erasure request, because there is no person
--                            row yet for it to hang off.
--
--   vy_creator_invite       the operator-issued code that unlocks replica
--                            creation. `code_hash` is the only form of the
--                            code this table (or anything else) ever stores -
--                            the code itself is shown once, in the issue
--                            response, and never again. `redeemed_by_user_id`
--                            IS the replica owner's Supabase auth id once a
--                            code is spent, so this table is on the OWNER
--                            lane exactly as vy_room_price/vy_creator_payout
--                            are (078's own precedent): NOT in
--                            api/memory.js's PERSON_TABLES (the owner lane is
--                            deliberately excluded there, and checked instead
--                            by scripts/relcheck.mjs's FK-graph walk), and
--                            reached instead by a named delete in
--                            api/_replica-full-erasure.js keyed on
--                            owner_user_id, added in the same change as this
--                            migration. scripts/relcheck.mjs's own
--                            PERSON_COLUMNS list gains `redeemed_by_user_id`
--                            in that same change so this table is not a
--                            SECOND blind spot of the exact shape the "coverage
--                            check is only as wide as the thing it enumerates"
--                            lesson (that file's own history, meera_state and
--                            vy_disclosure_grant/vy_replica_runtime_capability)
--                            already names twice. `issued_by_user_id` (the
--                            OPERATOR who issued it, from OPS_OWNER_USER_IDS)
--                            is deliberately NOT added to that list: an
--                            operator is platform staff acting in that
--                            capacity, not a consumer of this product's own
--                            erasure pipeline, and the row is fully reachable
--                            either way once it is deleted by name (the
--                            column choice only affects which future scan
--                            would ALSO flag it, not whether it is erased).
--                            `application_id` is nullable (an operator may
--                            invite someone found off-platform) and carries no
--                            FK, on 009's WHERE-clause-binding convention
--                            restated by every migration since - an
--                            application deleted by an operator's `erase` op
--                            must never take a live invite down with it by
--                            cascade.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, explicit ::type casts on
-- every bound parameter (this migration's own tables join
-- evals/sqlcast/surface.mjs's STRICT_SURFACE list via api/_apply.js and
-- api/_invites.js, added in the same change).
--
-- WHY NO FUNCTIONAL INDEX ON lower(contact)/created_at::date, though the
-- workstream brief's own words describe the rate limit that way: Postgres
-- requires an index expression to be IMMUTABLE, and a timestamptz-to-date
-- cast is not (its result depends on the session's TimeZone setting), so
-- `create unique index ... on (lower(contact), (created_at::date))` is
-- rejected at DDL time ("functions in index expression must be marked
-- IMMUTABLE"). The lowercased contact and the UTC day are computed in JS
-- instead (`contactKey`/`dayKeyOf`, the latter api/_room-surface.js's own
-- existing helper, reused rather than reinvented) and stored as two ordinary
-- columns, so the unique index below is a genuine plain-column index with no
-- expression at all - the identical guarantee the brief asked for, reached
-- without a DDL feature this migration cannot use.
create table if not exists vy_creator_application (
  application_id uuid primary key,
  name           text not null default '' check (length(name) <= 200),
  archive_link   text not null default '' check (length(archive_link) <= 2000),
  audience       text not null default '' check (length(audience) <= 2000),
  contact        text not null check (length(contact) between 1 and 320),
  contact_key    text not null check (length(contact_key) between 1 and 320),
  applied_on     date not null,
  status         text not null default 'new' check (status in ('new','reviewing','invited','declined')),
  created_at     timestamptz not null default now()
);
-- The rate-limit predicate itself: one application per contact per day. A
-- genuine unique index over two plain columns, usable as an ON CONFLICT
-- target, so the refusal is atomic under concurrent submissions rather than
-- a check-then-insert race.
create unique index if not exists vy_creator_application_contact_day_ix
  on vy_creator_application (contact_key, applied_on);
create index if not exists vy_creator_application_created_ix
  on vy_creator_application (created_at desc);
create index if not exists vy_creator_application_status_ix
  on vy_creator_application (status, created_at desc);

create table if not exists vy_creator_invite (
  invite_id           uuid primary key,
  code_hash           text not null check (length(code_hash) = 64),
  issued_to_contact   text not null default '' check (length(issued_to_contact) <= 320),
  issued_by_user_id   uuid not null,
  application_id      uuid,
  expires_at          timestamptz not null,
  redeemed_at         timestamptz,
  redeemed_by_user_id uuid,
  created_at          timestamptz not null default now()
);
-- One code, one row: also the ON CONFLICT/lookup target the redemption
-- statement inside createSelfReplica's CTE (api/_replica.js) reads by.
create unique index if not exists vy_creator_invite_code_hash_ix
  on vy_creator_invite (code_hash);
create index if not exists vy_creator_invite_issued_ix
  on vy_creator_invite (issued_by_user_id, created_at desc);
-- Partial: most invites are never redeemed, and the only reader of this
-- index is the erasure cascade's "which invites did this owner redeem" walk,
-- which only ever wants the redeemed rows.
create index if not exists vy_creator_invite_redeemed_ix
  on vy_creator_invite (redeemed_by_user_id)
  where redeemed_by_user_id is not null;
