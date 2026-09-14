-- Migration 071 - the Room: the follower's side of a published replica.
--
-- Contract: Vyakti Rooms v1. A creator publishes; a follower arrives from a
-- bio link at /r/<slug> and is in a conversation within one screen. Every
-- follower gets a PRIVATE, CONTINUING relationship with the creator's AI: it
-- remembers them, and it never reveals them to anyone.
--
-- ── what this migration is NOT ────────────────────────────────────────────
--
-- It is not a tenancy boundary and it is not a second memory. docs/SURFACES.md
-- §0 is unchanged by every column below: a surface is a TRANSPORT, it scopes
-- nothing. Migration 009 already states where the scoping lives - the PERSON is
-- shared across surfaces (vy_surface_identity has no agent_id and must never
-- gain one), the AGENT scopes the relationship (api/_agentscope.js's scalar
-- equality), and the surface scopes nothing at all. So there is no `agent_id`
-- on any table here that means "which tenant"; `agent_id` here is the same
-- retrieval binding every other agent-scoped table carries, so that a
-- follower's rows are found by the agent they belong to and by nothing else.
--
-- vy_room_follower is therefore NOT the follower's memory. Their memory is
-- vy_episode / vy_fact / meera_log, keyed on their person_id and their
-- agent_id, exactly as a DM's is. This table holds the MEMBERSHIP: who joined,
-- when they attested to being an adult, whether they answered the memory
-- question, and how many messages of this month's free allowance they have
-- spent. Nothing anybody said is in any column of any table below, and nothing
-- ever may be - migration 012's content law, and it binds hardest on the two
-- rows a regulator would ask about.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
--
-- 009's law, restated by 051/053/055/064 and binding here for the same reason:
-- Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per body,
-- db/migrations/apply.mjs runs them individually with no transaction, so every
-- statement below is independently re-runnable and an apply interrupted
-- halfway is recovered by running this same file again.
--
-- ── no foreign keys on agent_id / replica_id / owner_user_id ──────────────
--
-- 009's convention, restated by 051/053/055. The binding is enforced by the
-- WHERE clause, before rank; a single table whose binding were enforced in the
-- database would read as a stricter rule while actually being an inconsistent
-- one. `room_id` DOES carry a foreign key with ON DELETE CASCADE, and the
-- difference is the point: a room is not an agent binding, it is this
-- migration's own parent row, and a follower of a room that no longer exists
-- is not a follower of anything.
--
-- ── the erasure lanes, decided here rather than discovered later ──────────
--
--   vy_room            OWNER lane. It carries owner_user_id and no person
--                      column, so scripts/relcheck.mjs's reach walk requires it
--                      to be deleted by name in api/_replica-full-erasure.js,
--                      and it is. It is deliberately absent from PERSON_TABLES:
--                      a manifest loop deleting a creator's room on a
--                      FOLLOWER's forget request would take the room away from
--                      everyone else in it.
--   vy_room_follower   PERSON lane. Keyed person_id, no owner_user_id, in
--   vy_room_thread     PERSON_TABLES with `agent: true`. A follower's whole
--                      wipe takes their membership and their thread names,
--                      because both are records of them. Gated in
--                      activePersonTables() on this migration having landed,
--                      exactly as meera_consent is gated on 016 - the wipe
--                      loop's delete is not catch-wrapped on purpose, so a
--                      manifest ahead of its migration turns "make it forget
--                      me" into a 500 for a deploy-ordering reason.
--
-- Both directions are covered and they are covered by different mechanisms,
-- which is the house rule for a harm the next turn does not undo: the creator's
-- erasure job deletes follower and thread rows by agent_id (they are the
-- creator's room's rows too), and the follower's own wipe deletes them by
-- person_id.

-- ── the room ──────────────────────────────────────────────────────────────
--
-- One per published replica, and the slug is its PUBLIC ADDRESS. `slug` is
-- deliberately its own column rather than a join to vy_agent.slug: an agent
-- slug is an internal routing key that api/_clonechannel.js compares as text,
-- and a public address is a thing a creator prints on a card. They are equal
-- today for every row this platform creates; making them the same COLUMN would
-- mean a creator could never change one without changing the other.
--
-- `free_monthly_messages` is the free cap, per room, as DATA. Free followers
-- get 20 messages a month. It is a column rather than a constant because the
-- number is a product decision that will move, and a product decision that
-- lives in a deployed constant moves by deploy.
--
-- `published_at` / `paused_at` are the two halves of "may this room answer".
-- Both are timestamps rather than a status enum so the row records WHEN, and
-- the read predicate is `published_at is not null and paused_at is null` -
-- evaluated in the WHERE clause, never after, for api/_disclosure.js's reason:
-- a disqualified row that reaches JS can still be logged, partially rendered,
-- or escape through a branch added later.
create table if not exists vy_room (
  room_id               uuid primary key,
  slug                  text not null,
  replica_id            uuid not null,
  agent_id              uuid not null,
  owner_user_id         uuid not null,
  display_name          text not null default '',
  free_monthly_messages integer not null default 20
                        check (free_monthly_messages >= 0 and free_monthly_messages <= 100000),
  published_at          timestamptz,
  paused_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- THE ADDRESS IS UNIQUE, and it is a uniqueness LAW rather than a lookup hint -
-- 055's `vy_clone_channel_route_ix` argument, one surface over. Without it two
-- rooms can claim /r/anjali and the answer to "whose room is this" depends on
-- write ordering, which means a follower arriving from one creator's bio link
-- reaches a different creator's AI and every log line looks healthy. Lowercased
-- because a URL path segment is compared case-insensitively by every human who
-- types one.
create unique index if not exists vy_room_slug_ix on vy_room (lower(slug));

-- At most one room per replica. Two public addresses for one AI is not a
-- feature anybody asked for and it makes "which room is this creator's"
-- unanswerable, which is the same defect the index above closes from the other
-- side.
create unique index if not exists vy_room_replica_ix on vy_room (replica_id);

-- What the erasure job and the creator's own studio read: this owner's rooms.
create index if not exists vy_room_owner_ix on vy_room (owner_user_id, replica_id);

-- The reverse direction, for the agent-keyed cascade in the erasure job.
create index if not exists vy_room_agent_ix on vy_room (agent_id);

-- ── the follower ──────────────────────────────────────────────────────────
--
-- `person_id` is the SHARED person (009): the same human is the same person
-- here, in a DM, and on Telegram. `agent_id` is the retrieval binding, mirrored
-- onto this row so every read of it carries the same scalar equality every
-- other agent-scoped table carries, and so a follower row can never be found
-- through the wrong creator's agent.
--
-- ── the two consent moments, and why they are timestamps ──────────────────
--
--   age_attested_at    the 18+ attestation. NULL means not attested, which
--                      means the join never completed, which means api/room.js
--                      refuses `say`. Attestation is not verification and this
--                      column does not pretend otherwise; what it is, is the
--                      record that we asked and what they answered, on our
--                      clock.
--   memory_consent_at  the DPDP §6 answer to the memory question, unbundled,
--                      asked once, in plain words. NULL means no consent, and
--                      no consent means the `say` path writes NO memory - not
--                      "writes it and filters later". A withdrawal sets this
--                      back to NULL and appends a `granted=false` row to
--                      meera_consent, which is 016's design exactly: the ledger
--                      is the append-only EVIDENCE and this column is the gate.
--
-- Neither column can hold anything anybody said, and there must never be one
-- that can. 016's content law: this is the ledger of a decision ABOUT memory,
-- and a text column on it would make the refusal path the one path that files
-- new content about a person.
--
-- ── the free cap, as two columns a SQL predicate can settle ───────────────
--
-- `month_key` is 'YYYY-MM' in UTC and `month_message_count` is the count inside
-- it. Two columns rather than one, and a text month rather than a rolling
-- window, for one reason: the cap has to be enforceable in ONE conditional
-- UPDATE that both rolls the month over and increments, so that two tabs
-- sending at once cannot both read 19 and both write 20. A client-side counter,
-- or a SELECT-then-UPDATE, is the same defect the repo has already paid for
-- under `gate0-structural`: a rule that is a preference rather than a
-- guarantee.
create table if not exists vy_room_follower (
  follower_id         uuid primary key,
  room_id             uuid not null references vy_room(room_id) on delete cascade,
  person_id           uuid not null,
  agent_id            uuid not null,
  joined_at           timestamptz not null default now(),
  age_attested_at     timestamptz,
  memory_consent_at   timestamptz,
  tier                text not null default 'free' check (tier in ('free','paid')),
  month_key           text not null default '',
  month_message_count integer not null default 0 check (month_message_count >= 0),
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ONE membership per person per room. This is what makes the conditional
-- increment below a single-row update, and what stops a second `join` minting a
-- second allowance for the same human.
create unique index if not exists vy_room_follower_person_ix
  on vy_room_follower (room_id, person_id);

-- The follower's own reads (history, export, forget) are keyed here, and the
-- agent binding is in the index because it is in every predicate.
create index if not exists vy_room_follower_scope_ix
  on vy_room_follower (person_id, agent_id);

-- What the creator's "n people talked today" count reads, and the ONLY shape of
-- room statistic v1 has. Anything finer is out of scope, deliberately: a
-- creator learning WHICH follower was here today is the reveal this product
-- exists to refuse.
create index if not exists vy_room_follower_room_seen_ix
  on vy_room_follower (room_id, last_seen_at desc);

-- ── the follower's threads ────────────────────────────────────────────────
--
-- A follower names their own topics ("training", "nutrition", whatever they
-- call it). The thread is THEIRS: it carries their person_id, it is never
-- visible to another follower, and the creator never sees one. `title` is the
-- only text column in this migration and it holds a name the follower typed for
-- their own use, which is why it is capped hard and why nothing else about a
-- conversation is stored here.
create table if not exists vy_room_thread (
  thread_id       uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  agent_id        uuid not null,
  title           text not null default '' check (length(title) <= 80),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  archived_at     timestamptz
);

-- The rail's read: this follower's threads in this room, newest activity first.
-- The person binding is FIRST in the index because it is first in the predicate
-- and because an index that let a scan start at (room_id) alone is an index
-- that makes the cheap query the wrong one.
create index if not exists vy_room_thread_scope_ix
  on vy_room_thread (person_id, room_id, last_message_at desc);

-- A follower cannot have two threads of the same name in one room; renaming
-- one onto another's name is a rename that would silently split their history
-- across two rails. Partial, so an archived thread's name is reusable.
create unique index if not exists vy_room_thread_title_ix
  on vy_room_thread (room_id, person_id, lower(title))
  where archived_at is null and title <> '';
