-- Migration 082 - the Room on Telegram: which room a Telegram chat currently
-- means (WS-R18).
--
-- ── why this table exists at all ("prefer reuse" checked first) ───────────
--
-- A follower's IDENTITY on Telegram needs no new table: `vy_surface_identity`
-- (migration 009) already maps `(surface, surface_user_id) -> person_id`,
-- agent-independent, exactly the bridge api/tg.js already uses for Meera. And
-- a private Telegram chat's SEND ADDRESS needs no new table either - chat.id
-- equals from.id for a 1:1 bot chat (api/tg.js's own parse() comment), so the
-- surface_user_id already stored there is also the address to send to.
--
-- What is missing is neither of those. `ROOM_TELEGRAM_BOT_TOKEN` is ONE bot
-- for the whole platform (not a credentials_ref minted per creator, the way
-- `vy_clone_channel` does it for Meera's clones), so one Telegram chat can
-- reach more than one creator's Room over its lifetime - a follower may
-- `/start` creator A's slug today and creator B's slug next month, in the
-- SAME private chat. An ordinary text message carries no room reference at
-- all, so answering "which Room is THIS message for" needs a fact this
-- schema does not otherwise have: which Room this chat's deep link most
-- recently pointed at. That fact is this table, and nothing else in it.
--
-- ── one row per chat, replaced on re-`/start`, never accumulated ──────────
--
-- `unique (channel, channel_ref)` is the whole mechanism: a chat has AT MOST
-- ONE current Room, so `/start`ing a second creator's slug in the same chat
-- REPLACES the row rather than adding a second one - the same "one address,
-- one binding, upsert not insert" shape `vy_room_follower`'s own
-- `(room_id, person_id)` uniqueness already carries one column set over. This
-- is a POINTER, not a subscription list: it never accumulates history and it
-- answers exactly one question, "where do this chat's ordinary messages go
-- right now", never "every Room this person has ever joined on Telegram".
--
-- ── follower_id carries the erasure reach, on purpose ──────────────────────
--
-- `references vy_room_follower(follower_id) on delete cascade` means this row
-- cannot outlive the membership it points at: `api/_room-surface.js`'s
-- `roomForget` already deletes the follower row by name on every "leave this
-- Room" request, and the owner's own erasure job deletes it by agent_id on a
-- full replica erasure (071's own header). Neither path needs to learn this
-- table's name to reach it - the cascade is the reach, restated as 009's
-- convention rather than argued fresh: FKs enforce a PARENT relationship
-- (`room_id`, `follower_id`, both this migration's own ownership rather than
-- an agent/replica/owner binding), never the agent-scope binding itself,
-- which stays a WHERE-clause predicate everywhere it is checked.
--
-- ── the person lane, PERSON_TABLES, FATE ───────────────────────────────────
--
-- `person_id`, no `owner_user_id`: the PERSON lane exactly as `vy_room_follower_day`
-- and `vy_room_subscription` are (077, 078). Listed in api/memory.js's
-- PERSON_TABLES with `lane: "relational"` and NO `agent: true` (this table
-- carries no agent_id column, and the room-scoped "forget me" reach it
-- already has - through the follower_id cascade above - needs no help from
-- `roomScopedTables()`'s generic per-agent loop). Reached by the account-wide
-- whole wipe through that same "relational" lane, with no further code, the
-- same door `vy_room_subscription` goes through for the identical reason.
-- Gated in `activePersonTables()`/`REPLICA_PERSON_TABLES` on this migration
-- having landed, exactly as 071's and 077's own tables are: the wipe loop's
-- delete is not catch-wrapped on purpose, so a manifest ahead of its
-- migration must never turn "make it forget me" into a 500 for a
-- deploy-ordering reason. FATE verdict ("forget-only", `evals/recall/run.mjs`
-- §8): a pointer with no words in it has no term a scoped "forget priya"
-- could ever match, so only the stronger doors - the whole wipe, or the
-- Room's own forget through the cascade above - may take it.
--
-- ── one statement per request, idempotent, no DO blocks ────────────────────
-- 009's law, restated by every migration since and binding here for the same
-- reason: Neon's SQL-over-HTTP endpoint accepts exactly one statement per
-- body, so every statement below is independently re-runnable.
create table if not exists vy_room_follower_channel (
  channel_map_id uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_id      uuid not null,
  follower_id    uuid not null references vy_room_follower(follower_id) on delete cascade,
  channel        text not null,
  channel_ref    text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint vy_room_follower_channel_channel_check check (channel in ('telegram'))
);

-- THE POINTER. One current room per (channel, chat address) - a second
-- `/start` in the same chat upserts this row rather than adding a second one.
create unique index if not exists vy_room_follower_channel_ref_ix
  on vy_room_follower_channel (channel, channel_ref);

-- The follower's own reverse lookup (does this person already have a
-- Telegram pointer in this room, for the join/`/start` upsert) and the
-- cascade's own join target.
create index if not exists vy_room_follower_channel_person_ix
  on vy_room_follower_channel (person_id, channel);

create index if not exists vy_room_follower_channel_follower_ix
  on vy_room_follower_channel (follower_id);
