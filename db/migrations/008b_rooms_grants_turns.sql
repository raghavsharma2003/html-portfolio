-- Migration 008b — rooms, grants, the turn log, and the retrieval hints.
-- Contract: docs/design/PROPOSAL-MULTIPARTY-V1.md §4.2.
--
-- Idempotent, additive only, one statement per request (see 001 header).
-- Index names carry the _ix suffix (tables and indexes share one namespace —
-- the measured meera_tel_session trap, db/schema.sql:189-196). No FK on
-- lineage or hint columns, so forget deletes freely. No deleted_at anywhere.

create table if not exists vy_group (
  id             bigint generated always as identity primary key,
  name           text not null default '',
  kind           text not null default 'friend_group'
                 check (kind in ('couple','family','friend_group','other')),
  -- synthetic, uuid-v5 over the Telegram chat id: keeps meera_log.device_id
  -- NOT NULL for room turns without inventing a device for a room. It is in
  -- NOBODY's vy_person_device mapping on purpose — attribution of a room turn
  -- runs through speaker_person_id (008a), never through this column.
  room_device_id uuid not null,
  tg_chat_id     bigint,                 -- Telegram binding (§6)
  read_consent_at timestamptz,           -- admin promotion observed (§6.2)
  quiet_level    text not null default 'normal'
                 check (quiet_level in ('normal','quiet','silent')),
  member_cap     smallint not null default 6,
  created_at     timestamptz not null default now()
);

create unique index if not exists vy_group_tg_chat_ix
  on vy_group (tg_chat_id) where tg_chat_id is not null;

-- Membership governs the LIVE CHANNEL, never history. The recipient set is
-- read from here; the ACL is read from vy_episode_participant. A member who
-- joins today does not thereby become a participant of last month's episodes
-- (§1 M10) — past participant sets are immutable history, which is why the
-- newcomer case needs no code path of its own.
create table if not exists vy_group_member (
  group_id    bigint not null references vy_group(id) on delete cascade,
  person_id   uuid   not null,
  tg_user_id  bigint,
  role        text   not null default '',
  quiet_level text   not null default 'normal'
              check (quiet_level in ('normal','quiet','silent')),
  linked_at   timestamptz,               -- null = seen but not onboarded (§6.4)
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,               -- null = currently active
  primary key (group_id, person_id)
);

create index if not exists vy_group_member_person_ix
  on vy_group_member (person_id) where left_at is null;

-- CPM made literal: permission is NEGOTIATED and CITED, never inferred at
-- read time. vy_grant_cited is what makes a grant that cannot point at the
-- moment consent was given unrepresentable — the same shape as
-- vy_fact_cite_or_authored, and the reason the citation law extends to every
-- new table that stores derived content.
create table if not exists vy_disclosure_grant (
  id           bigint generated always as identity primary key,
  subject_kind text not null
               check (subject_kind in ('fact','episode','phrase')),
  subject_id   bigint not null,
  granted_by   uuid not null,            -- whose information it is
  granted_to   uuid not null,            -- who may receive it
  group_id     bigint,                   -- v1: grants fire INTO a room only
  act          text not null default 'gist'
               check (act in ('gist','paraphrase','verbatim')),
  citations    bigint[] not null,        -- the episode where consent was given
  t_invalid    timestamptz,              -- revocation is belief change
  created_at   timestamptz not null default now(),
  constraint vy_grant_cited check (cardinality(citations) >= 1)
);

create index if not exists vy_grant_subject_ix
  on vy_disclosure_grant (subject_kind, subject_id) where t_invalid is null;

create index if not exists vy_grant_to_ix
  on vy_disclosure_grant (granted_to) where t_invalid is null;

create index if not exists vy_grant_cit_ix
  on vy_disclosure_grant using gin (citations);

-- Turn-level action log: silence must be an EVENT, not an absence (§1 M5).
-- Stage 1's speak/stay-quiet score is an engineering bet (§0.3, §5.3); this
-- table is what makes it measured rather than believed.
create table if not exists vy_group_turn (
  id         bigint generated always as identity primary key,
  group_id   bigint not null references vy_group(id) on delete cascade,
  episode_id bigint references vy_episode(id) on delete set null,
  log_id     bigint,
  action     text not null check (action in ('lurk','react','speak','bridge')),
  addressed  boolean not null default false,
  reason     text not null default '',   -- telegraphic, shape-linted
  at         timestamptz not null default now()
);

create index if not exists vy_group_turn_group_ix
  on vy_group_turn (group_id, at desc);

-- ── retrieval hints on the derived tables ──────────────────────────────────
--
-- group_id here is a HINT AND AN ISOLATION KEY, never the security boundary:
-- membership changes, episode-time participation cannot. Clause 4 (room
-- isolation) reads it; clauses 1 and 2 do not.
alter table vy_fact   add column if not exists group_id bigint;

alter table vy_phrase add column if not exists group_id bigint;

-- RESOLUTION (WS-MPBUILD, flagged): the §2.3 predicate writes clause 0 as
-- `not (f.disclosure_deny && $1)` over the SUBJECT row, but §4.1's DDL adds
-- disclosure_deny only to vy_episode. Rather than pick one reading, both are
-- implemented and OR'd: a row is denied if the row denies you OR any episode
-- it cites denies you. Deny is the one clause where over-blocking is
-- unambiguously the safe direction, and this makes the contract's literal
-- clause 0 compile without weakening the episode-level rule.
alter table vy_fact   add column if not exists disclosure_deny uuid[]
  not null default '{}';

alter table vy_phrase add column if not exists disclosure_deny uuid[]
  not null default '{}';

create index if not exists vy_fact_group_ix
  on vy_fact (group_id, need_p desc)
  where group_id is not null and t_invalid is null and retracted_at is null;

-- Rooms hold the ONE memory class that is shared by construction and
-- non-sensitive by construction: the inside joke (§1 M3). Its ledger is
-- per-room, and the per-person unique index (vy_phrase_ix) does not constrain
-- it, so it gets its own — which doubles as the room ledger's lookup index.
create unique index if not exists vy_phrase_group_ix
  on vy_phrase (group_id, lower(phrase)) where group_id is not null;
