-- Migration 013 — the room binding stops being Telegram-shaped.
-- Task #78. Contract: docs/SURFACES.md §0 and §4, SPEC-AGENT-LAYER §4 (Law E3).
--
-- APPLIED to production 2026-08-22 (see "the live verification" below).
-- Promoted from db/migrations/drafts/DRAFT-013-surface-room-binding.sql, which
-- is where it was parked precisely because `db/migrations/apply.mjs` applies
-- EVERY `*.sql` in its own directory (`readdirSync(DIR)`, non-recursive, no
-- allowlist) — a draft beside its siblings is a draft that gets applied.
--
-- The number was checked rather than trusted: the ticket says "migration 010",
-- and 010/011/012 have all shipped, so 013 was the free slot on the day this
-- landed. Renumbering a migration that has already run is the one thing this
-- directory cannot survive.
--
-- ── the debt this pays ────────────────────────────────────────────────────
--
-- `vy_group.tg_chat_id` is a bigint with a unique index, so:
--   - a non-numeric chat key CANNOT be stored. `roomByChatKey()` returned null
--     for one and the room lane refused fail-closed with a named reason. That
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
-- splitter is deliberately small). Nothing here drops a column and nothing
-- here is destructive.
--
-- ── the live verification, recorded because a backfill is a decision ──────
--
-- The draft held the backfill back on purpose: it asserts a FACT about
-- existing rows — that every room carrying a tg_chat_id really is a Telegram
-- room — and that assertion belongs to whoever applies the file, not to
-- whoever drafted it. Checked against production immediately before applying,
-- 2026-08-22:
--
--   select (select count(*)::int from vy_group)        as groups,          -- 0
--          (select count(*)::int from vy_group_member) as members,         -- 0
--          (select count(*)::int from vy_group
--             where tg_chat_id is null)                as groups_null_tg,  -- 0
--          (select count(*)::int from vy_group_member
--             where tg_user_id is null)                as members_null_tg; -- 0
--
-- Both tables hold ZERO rows (the Telegram bot has never run against
-- production — TELEGRAM_BOT_TOKEN is deliberately empty). So the assumption
-- holds vacuously, and the backfill below is a verified no-op TODAY: it
-- matched 0 rows on the apply. It is included rather than left as a follow-up
-- because it is the statement that makes this file complete for a replay — a
-- namespace built from these migrations, or a row written by an older code
-- path before the new one deploys, is repaired by re-running this file. It
-- cannot ever misfire on a row the new code wrote: the new writer always sets
-- `surface`, and every backfill statement is guarded by `surface is null`.
--
-- What is still NOT here, and why each is deliberate:
--   NOT NULL on the new columns — belongs to the follow-up, after the read
--     path has been on the new columns long enough to be believed. A NOT NULL
--     added before the writer is deployed turns the next room creation into an
--     error.
--   DROP COLUMN tg_chat_id / tg_user_id — same follow-up, later. A drop before
--     the read path moves turns every existing room into "unknown room" and
--     she goes silent in all of them. The retirement condition is written down
--     in docs/SURFACES.md §4 rather than left to be re-derived.
--   A `check (surface in (...))` — refused on purpose: the surface list is
--     `api/*.js` adapters, and a CHECK here would mean adding a fifth surface
--     requires a migration, which is precisely "do not teach the engine your
--     surface" one layer down. The set of surfaces is not a database fact.

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
-- read path has moved, as its own statement, in the follow-up.

-- The uniqueness that replaces vy_group_tg_chat_ix. Partial, so rows that have
-- not been adopted yet do not collide on (null, null).
create unique index if not exists vy_group_surface_chat_ix
  on vy_group (surface, surface_chat_id)
  where surface is not null and surface_chat_id is not null;

-- The old index STAYS until tg_chat_id is dropped. Two unique indexes during
-- the transition is correct: a Telegram room must not gain a second row under
-- the new key while the old one still points at it.

-- ── vy_group_member: the member's address becomes (surface, user id) ───────
--
-- Today a non-Telegram member was written with a NULL tg_user_id and
-- identified through vy_surface_identity — which is where identity belongs, so
-- this pair is NOT an identity key. It is the surface-local address of a
-- member, used for roster display and for the one thing identity cannot
-- answer: "which account in THIS room is this person". person_id stays the
-- primary key half.
alter table vy_group_member add column if not exists surface text;
alter table vy_group_member add column if not exists surface_user_id text;

-- Not unique. The same human may legitimately appear once per surface in one
-- room (linked on Telegram, present on Discord), and the primary key
-- (group_id, person_id) is what makes them one member. An index for the lookup
-- direction, nothing more.
create index if not exists vy_group_member_surface_ix
  on vy_group_member (surface, surface_user_id)
  where surface is not null and surface_user_id is not null;

-- ── the backfill, verified above and idempotent by construction ────────────
--
-- `and surface is null` is what makes each of these safe to re-run and
-- impossible to misfire on a row the new writer created. On the production
-- apply both matched 0 rows.

update vy_group
   set surface = 'telegram',
       surface_chat_id = tg_chat_id::text
 where tg_chat_id is not null and surface is null;

update vy_group_member
   set surface = 'telegram',
       surface_user_id = tg_user_id::text
 where tg_user_id is not null and surface is null;
