-- DRAFT — NOT APPLIED, NOT WIRED. Task #78: replace the Telegram-shaped room
-- binding with (surface, surface_chat_id) / (surface, surface_user_id).
--
-- ── read this before renumbering or applying ──────────────────────────────
--
-- WHY IT IS IN drafts/ RATHER THAN BESIDE ITS SIBLINGS. `db/migrations/
-- apply.mjs` applies EVERY `*.sql` in its own directory — `readdirSync(DIR)`,
-- non-recursive, no allowlist. A draft sitting next to 012 would therefore be
-- applied by the next plain `node db/migrations/apply.mjs`, which is the
-- opposite of "draft". `drafts/` is invisible to that readdir. Promoting this
-- file is a one-line `git mv` up one level, at which point it becomes real and
-- must be numbered for whatever slot is free THEN.
--
-- The ticket calls this "migration 010". **010 is taken** — `010_agent_strict.
-- sql` shipped, and 011/012 after it. The next free number is 013, which is
-- what this file is named. Renumbering a migration that has already run is the
-- one thing this directory cannot survive, so the ticket's number is stale
-- rather than this file being wrong.
--
-- It is a DRAFT because applying it is only a third of the job. The other two
-- thirds are a backfill and a code change, and doing the DDL without them
-- leaves the room lane reading a column nothing writes:
--
--   1. this file (DDL, idempotent, additive — safe to apply alone)
--   2. a backfill: every existing row gets surface='telegram' and
--      surface_chat_id = tg_chat_id::text (see the note at the bottom; it is
--      NOT in this file because a backfill over live rows is a decision, not
--      a schema statement)
--   3. api/_room.js: `chatKeyToChatId` deleted, `roomByChat`/`roomByChatKey`/
--      `ensureRoomForChat`/`upsertMember` keyed on the new pair, and
--      `memberKeys()` in api/_surface.js stops writing NULL for non-Telegram
--      members. That file is WS-SURFACE's; this one is WS-AGENT-SCHEMA's.
--
-- Nothing here drops a column. `tg_chat_id` and `tg_user_id` stay, unused,
-- until the read path has been on the new columns long enough to be believed —
-- the same drain-then-delete shape `vy_tg_person` is already in, where the day
-- it goes is a delete rather than a migration.
--
-- ── the debt this pays ────────────────────────────────────────────────────
--
-- `vy_group.tg_chat_id` is a bigint with a unique index, so:
--   - a non-numeric chat key CANNOT be stored. `roomByChatKey()` returns null
--     for one and the room lane refuses fail-closed with a named reason. That
--     is correct behaviour for a wrong schema, not a working feature.
--   - two surfaces whose numeric id ranges overlap would COLLIDE on a column
--     whose name says Telegram: Discord channel 9001 and Telegram chat 9001
--     are one room. Exactly the collision `surfaceDeviceId(surface, key)`
--     already refuses to make for devices.
--
-- `vy_surface_identity` (migration 009) already made this move for people. The
-- shape below is deliberately the same one, for the same reason.
--
-- ── the rule every statement here obeys ───────────────────────────────────
--
-- Neon's SQL-over-HTTP endpoint takes ONE statement per request and
-- db/migrations/apply.mjs runs them individually with no transaction. So every
-- statement is independently re-runnable, an interrupted apply is recovered by
-- re-running this file, and there are no DO blocks or functions (apply.mjs's
-- splitter is deliberately small).

-- ── vy_group: the room's address becomes (surface, surface_chat_id) ────────

-- text, not bigint: a chat key is an OPAQUE ADDRESS. The contract already says
-- so (`chatKey` is "the ONLY thing handed to send()", never parsed), and the
-- moment it is numeric someone will do arithmetic on it or drop a leading
-- zero. Telegram's negative supergroup ids survive as text unchanged.
alter table vy_group add column if not exists surface text;
alter table vy_group add column if not exists surface_chat_id text;

-- No default and no NOT NULL in this file. A default of 'telegram' would make
-- every future row silently Telegram if the writer forgets to pass a surface,
-- which is the failure this column exists to prevent; NOT NULL comes AFTER the
-- backfill, as its own statement, in the follow-up.

-- The uniqueness that replaces vy_group_tg_chat_ix. Partial, so rows that have
-- not been backfilled yet do not collide on (null, null).
create unique index if not exists vy_group_surface_chat_ix
  on vy_group (surface, surface_chat_id)
  where surface is not null and surface_chat_id is not null;

-- The old index STAYS until tg_chat_id is dropped. Two unique indexes during
-- the transition is correct: a Telegram room must not gain a second row under
-- the new key while the old one still points at it.

-- ── vy_group_member: the member's address becomes (surface, user id) ───────
--
-- Today a non-Telegram member is written with a NULL tg_user_id and identified
-- through vy_surface_identity — which is where identity belongs, so this pair
-- is NOT an identity key. It is the surface-local address of a member, used
-- for roster display and for the one thing identity cannot answer: "which
-- account in THIS room is this person". person_id stays the primary key half.
alter table vy_group_member add column if not exists surface text;
alter table vy_group_member add column if not exists surface_user_id text;

-- Not unique. The same human may legitimately appear once per surface in one
-- room (linked on Telegram, present on Discord), and the primary key
-- (group_id, person_id) is what makes them one member. An index for the lookup
-- direction, nothing more.
create index if not exists vy_group_member_surface_ix
  on vy_group_member (surface, surface_user_id)
  where surface is not null and surface_user_id is not null;

-- ── what is NOT in this file, and why each is deliberate ──────────────────
--
-- BACKFILL. It is one statement per table and it is trivial to write:
--
--   update vy_group set surface = 'telegram',
--          surface_chat_id = tg_chat_id::text
--    where tg_chat_id is not null and surface is null;
--
--   update vy_group_member set surface = 'telegram',
--          surface_user_id = tg_user_id::text
--    where tg_user_id is not null and surface is null;
--
-- Both are idempotent (`and surface is null`) and both are safe. They are held
-- back because a backfill asserts a FACT about existing rows — that every
-- room with a tg_chat_id really is a Telegram room — and that assertion should
-- be checked against the live table by whoever applies this, not assumed by
-- whoever drafted it. Migration 009's own header makes the same distinction.
--
-- NOT NULL / DROP COLUMN. Both belong to the follow-up, after the read path
-- has moved. A NOT NULL added before the code writes the column turns the next
-- room creation into an error; a DROP before the read path moves turns every
-- existing room into "unknown room" and she goes silent in all of them.
--
-- A `check (surface in (...))`. Refused on purpose: the surface list is
-- `api/*.js` adapters, and a CHECK constraint here would mean adding a fifth
-- surface requires a migration — which is precisely the "do not teach the
-- engine your surface" rule in docs/SURFACES.md, one layer down. The set of
-- surfaces is not a database fact.
