-- Migration 012 — the turn trace (docs/TRACE.md).
--
-- Two tables that make one conversational turn reconstructible after the fact:
--
--   meera_turn      the SPINE — one row per turn, upserted by whichever leg
--                   arrives first, converging regardless of arrival order
--   meera_turn_leg  the DETAIL — append-only, one row per layer of the funnel
--                   (ingress / retrieval / interior / assembly / model /
--                   egress / consolidation, and anything a future layer names)
--
-- WHY TWO TABLES AND NOT ONE. api/_db.js q() runs exactly ONE statement per
-- request and there are no transactions spanning calls, so the legs of a single
-- turn are written by different processes, out of order, and sometimes twice
-- (a client retry, an offline drain landing after the live traffic it
-- preceded). A denormalised spine that is UPSERT-ed with coalesce/least/
-- greatest converges under all three; a single wide table written by whoever
-- got there last would not. This is the same arrangement meera_tel_session
-- already uses over meera_tel, for the same measured reason.
--
-- STRICT FROM BIRTH, like migration 011. agent_id is NOT NULL with NO DEFAULT:
-- migration 010 dropped 009's transitional defaults after they exposed thirteen
-- writers that named no agent (`strict-exposed-13`), five of them inside
-- .catch() swallows. A trace writer that forgets the agent fails on day one
-- rather than filing one agent's turns under another and being found a
-- migration later.
--
-- CONTENT LAW. Neither table has a column that can hold what anybody said.
-- There is no `text`, no `prompt`, no `reply`, no `query`. Content lives in
-- meera_log and is referenced by id (in_log_id / out_log_ids); everything else
-- is a count, a byte length, a hash, a timing or an enum. See docs/TRACE.md §4
-- for the line-by-line boundary and for what this design does and does not
-- expose.
--
-- RETENTION WITHOUT A SCHEDULER. `never-scheduled` is load-bearing: no
-- scheduled job has ever run in this repo, so a retention cron is a retention
-- policy that does not exist. Pruning happens at WRITE time, in the writing
-- statement, bounded to a few hundred rows per batch — which is what
-- meera_turn_leg_at_ix and meera_turn_started_ix below exist to make cheap.
--
-- Every statement is independently idempotent and independently re-runnable:
-- Neon SQL-HTTP takes one statement per request and db/migrations/apply.mjs
-- runs them one at a time with no transaction, so an apply interrupted halfway
-- is recovered by running the file again.

-- ── meera_turn — the spine ────────────────────────────────────────────────
--
-- turn_id is TEXT and client-minted, not a generated identity. Three reasons,
-- all of them arrival-order: the client is the only party present at every leg
-- of a turn; the id must exist BEFORE the first server call so the retrieval
-- leg and the model leg can both name it; and a generated key would force a
-- read-then-write to correlate, which q()'s one-statement rule cannot do
-- atomically. Validated at the writer (api/_trace.js TURN_ID_RE) rather than by
-- a CHECK, so a malformed id is dropped with a count instead of failing a batch
-- that also carries good rows.
create table if not exists meera_turn (
  turn_id       text primary key,
  agent_id      uuid not null,
  device_id     text not null,
  person_id     uuid,
  session_id    text,
  -- NULLABLE, deliberately. "which surface" is a fact a leg either knows or
  -- does not, and a NOT NULL with a default turns "we never found out" into a
  -- confident 'web' — which is exactly the shape of `voice-v0-was-never-written`
  -- (a declared source no writer ever produced, discovered a migration later).
  -- The upsert coalesces, so the first leg that knows wins and no later,
  -- less-informed leg can erase it.
  surface       text,
  channel       text,
  lane          text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,

  -- ── references, never copies (docs/TRACE.md L2) ──
  in_msg_id     text,
  in_log_id     bigint,
  out_msg_id    text,
  out_log_ids   bigint[] not null default '{}',

  -- ── shape of the turn ──
  in_kind       text,
  in_chars      integer,
  out_bubbles   integer,
  out_chars     integer,

  -- ── assembly: the highest-value half of the record ──
  core_hash     text,
  manifest_hash text,
  core_bytes    integer,
  tail_bytes    integer,
  -- per-slot BYTE map, keyed by TAIL_MANIFEST id: {"T1":210,...,"T13":0}.
  -- compiler.ts computes these as tail.length deltas around each append, so
  -- they cannot disagree with what was actually assembled. A slot that
  -- declares itself wired and renders 0 bytes is `manifest-sourcestatus`, and
  -- this column is the only thing that can say so.
  sections      jsonb not null default '{}'::jsonb,
  dropped       jsonb not null default '[]'::jsonb,

  -- ── retrieval ──
  recall_bytes  integer,
  retrieval     jsonb not null default '{}'::jsonb,

  -- ── model ──
  model         text,
  served_by     text,
  latency_ms    integer,
  tokens_in     integer,
  tokens_out    integer,
  tokens_cached integer,
  retries       integer not null default 0,
  fallbacks     jsonb not null default '[]'::jsonb,

  -- ── derived alarms (docs/TRACE.md §5) ──
  flags         jsonb not null default '{}'::jsonb,
  legs          integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Re-runnable repair for a database that took an earlier revision of this file,
-- where surface/channel shipped NOT NULL DEFAULT and an explicit NULL in a
-- multi-row upsert bypassed the default and failed the batch. `drop not null`
-- on a column that is already nullable is a no-op, so this is idempotent like
-- everything else here.
alter table meera_turn alter column surface drop not null;
alter table meera_turn alter column channel drop not null;
alter table meera_turn alter column surface drop default;
alter table meera_turn alter column channel drop default;

create index if not exists meera_turn_agent_ix   on meera_turn (agent_id, started_at desc);
create index if not exists meera_turn_device_ix  on meera_turn (device_id, started_at desc);
create index if not exists meera_turn_person_ix  on meera_turn (person_id, started_at desc);
create index if not exists meera_turn_started_ix on meera_turn (started_at);
create index if not exists meera_turn_session_ix on meera_turn (session_id, started_at);
-- PARTIAL, deliberately. "show me every turn that tripped an invariant" is the
-- query this table exists to answer quickly, and a full index on a jsonb column
-- that is empty on the overwhelming majority of rows would be most of the table
-- for none of the benefit.
create index if not exists meera_turn_flagged_ix on meera_turn (started_at desc)
  where flags <> '{}'::jsonb;

-- ── meera_turn_leg — append-only detail ───────────────────────────────────
--
-- `leg` is FREE TEXT and unknown legs are stored, not rejected. A schema that
-- can refuse a leg name decides which future questions are answerable and it
-- always decides wrong — the leg nobody allowlisted is the one the incident
-- turns out to be about. api/telemetry.js learned this for event names; same
-- rule, same reason, one layer up.
--
-- device_id is here for exactly ONE consumer: the forget manifest in
-- api/memory.js wipes by device_id, and a detail table that could not be wiped
-- by the same key as its spine would leave a person's rows standing after their
-- own whole-wipe. Nothing reads legs by device.
create table if not exists meera_turn_leg (
  id        bigint generated always as identity primary key,
  turn_id   text not null,
  agent_id  uuid not null,
  device_id text not null,
  leg       text not null,
  seq       integer,
  t_ms      integer,
  payload   jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);

create index if not exists meera_turn_leg_turn_ix   on meera_turn_leg (turn_id, seq);
create index if not exists meera_turn_leg_at_ix     on meera_turn_leg (at);
create index if not exists meera_turn_leg_leg_ix    on meera_turn_leg (leg, at desc);
create index if not exists meera_turn_leg_device_ix on meera_turn_leg (device_id, at desc);
