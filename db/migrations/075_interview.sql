-- Migration 075 — the interview: the Mirror Call re-pointed at the gaps in the
-- archive.
--
-- Contract: docs/gurukul/MIRROR-CALL-SPEC.md plus WS-R5. An archive is a
-- monologue; the interview is the only lane in this platform where the AI
-- decides what to ASK, and therefore the only source of how the person talks in
-- a conversation rather than in a lecture.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by 009/051/059/060
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint takes
-- exactly one statement per request, there is no transaction across statements,
-- and an apply interrupted halfway must be recoverable by running this file
-- again. NO DO blocks and no functions: db/migrations/apply.mjs's splitter is
-- deliberately small and does not handle them. Constraints therefore use the
-- drop-then-add idempotent pair.
--
-- ── AN INTERVIEW IS A MODE OF A MIRROR CALL, NOT A SECOND CALL ────────────
-- `vy_interview_session.mirror_session_id` is NOT NULL and unique. There is no
-- interview without a Mirror Call underneath it, which means there is no second
-- transport, no second consent freeze, no second window table and no second
-- reply lane. `mirror-call-reply-is-the-one-door` is the rule and this column is
-- how the schema states it: the interview cannot exist detached from the session
-- whose consent scopes were frozen at start.
--
-- ── WHY `gaps` IS A COLUMN AND NOT A RECOMPUTE ────────────────────────────
-- The gap list is derived (api/_interview-gaps.js is a pure function over rows
-- that keep changing) and it is FROZEN onto the session at open. Recomputing it
-- mid-call would mean the interview's fourth question came from a different
-- ranking than its first, and the owner would have no way to know. It is the
-- same argument 059 makes for `consent_scopes`: what was true at start is a fact
-- the row has to carry, because the world moves underneath a twenty-minute call.
--
-- It is also the only record of WHY each question was asked. A stored answer
-- whose question nobody can reconstruct is an answer to nothing.
--
-- ── WHY AN ANSWER POINTS AT A SOURCE AND NOT AT A TRANSCRIPT ──────────────
-- `mirror-reference-accumulation-was-inert` (context/rejected.md, 2026-08-26) is
-- the entry this table was designed against. Interview answers GROW THE SOURCE
-- SET. They do not change the voice: Chatterbox's `prepare_conditionals()`
-- conditions on at most ten seconds and `vy_mirror_conditioning` is the only
-- table synthesis reads. So an answer row is a pointer to a
-- `vy_replica_source` with `purpose='interview'`, transcribed by the ordinary
-- DAG and mined by the ordinary claim lane, and NOTHING here writes a sheet, a
-- persona or a reference selection. A table that implied otherwise would be the
-- same defect with a fidelity meter attached.
--
-- ── WHY `source_id` IS NULLABLE ───────────────────────────────────────────
-- An answer whose audio we lost is a state this platform must be able to
-- REPORT. The alternative is deleting the row, and then "the owner answered and
-- we dropped it" is indistinguishable from "the owner never answered" — 059's
-- `asr_state = 'dropped'` argument, transferred. The count of null-source
-- answers is what the studio renders as an honest loss.

-- ── the source purpose ───────────────────────────────────────────────────
--
-- WHY vy_replica_source NEEDS A `purpose` AT ALL. `capture_mode` says HOW a
-- source arrived (upload, import, live challenge). It does not say what the
-- source IS FOR, and retrieval needs that: interview audio is the only material
-- in the archive where the person is in a conversation rather than delivering
-- one, and `api/_person-model.js` has to be able to prefer it for register
-- without inferring the fact from a filename.
--
-- Defaulted rather than backfilled. Every existing row is 'memory' because that
-- is what every existing row is, and a default is the honest statement for a
-- column whose value nobody measured on the old rows.
alter table vy_replica_source add column if not exists purpose text not null default 'memory';

alter table vy_replica_source drop constraint if exists vy_replica_source_purpose_check;

-- A closed set. 'identity_document' already exists as a capture_mode and is
-- repeated here because the two axes are independent: an identity document is a
-- purpose AND a capture mode, and collapsing them would make a future non-upload
-- identity capture unrepresentable.
alter table vy_replica_source add constraint vy_replica_source_purpose_check
  check (purpose in ('memory','identity_document','correction','interview'));

-- The person-model builder's read path: this owner's interview sources.
create index if not exists vy_replica_source_purpose_ix
  on vy_replica_source (replica_id, owner_user_id, purpose);

-- ── the interview session ────────────────────────────────────────────────
create table if not exists vy_interview_session (
  session_id        uuid primary key default gen_random_uuid(),
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  -- The Mirror Call this interview IS. Not a reference to a sibling feature: a
  -- cascade delete here is correct because an interview without its call has no
  -- windows, no turns, no consent record and nothing to mean.
  mirror_session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  policy_version    text not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  -- The ranked gap list, frozen at open. An array of the objects
  -- api/_interview-gaps.js produces; see the header for why it is stored.
  gaps              jsonb not null default '[]'::jsonb,
  questions_asked   integer not null default 0 check (questions_asked >= 0),
  answers_captured  integer not null default 0 check (answers_captured >= 0),
  updated_at        timestamptz not null default now(),
  constraint vy_interview_session_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

alter table vy_interview_session drop constraint if exists vy_interview_session_gaps_shape;

-- An ARRAY, and a bounded one. A jsonb object here would be a gap list nobody
-- can rank and a 200 KB one would be a prompt-sized column on a row that is read
-- on every window of a live call.
alter table vy_interview_session add constraint vy_interview_session_gaps_shape
  check (jsonb_typeof(gaps) = 'array' and octet_length(gaps::text) <= 32768);

alter table vy_interview_session drop constraint if exists vy_interview_session_answer_gate;

-- AN ANSWER IMPLIES A QUESTION. A captured answer to a question nobody asked is
-- either a counting bug or a window filed against the wrong session, and both
-- are worse discovered later. This is 059's `applied implies accepted` shape:
-- the arithmetic the studio renders is made unrepresentable-if-wrong rather
-- than checked in JS.
alter table vy_interview_session add constraint vy_interview_session_answer_gate
  check (answers_captured <= questions_asked);

-- ONE INTERVIEW PER MIRROR CALL. Two would mine one rolling transcript into two
-- gap lists and the winner would be decided by write ordering, which is the race
-- 059's own open-session index makes unrepresentable rather than unlikely.
create unique index if not exists vy_interview_session_mirror_ix
  on vy_interview_session (mirror_session_id);

create index if not exists vy_interview_session_owner_ix
  on vy_interview_session (owner_user_id, replica_id, started_at desc);

-- ── the captured answers ─────────────────────────────────────────────────
create table if not exists vy_interview_answer (
  answer_id          uuid primary key default gen_random_uuid(),
  session_id         uuid not null references vy_interview_session(session_id) on delete cascade,
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  -- Which detector produced the question. Closed, and identical to
  -- INTERVIEW_GAP_KINDS in api/_interview-gaps.js: a kind this table admits and
  -- the module cannot produce would be a row nobody can explain.
  gap_kind           text not null
                     check (gap_kind in ('contradiction','sheet_field','thin_topic','readiness')),
  topic              text not null check (topic <> '' and length(topic) <= 120),
  -- sha256 over the question SHAPE, not over the question text. The text does
  -- not exist as a stored object anywhere in this feature (`recited-prompt`:
  -- a stored question is a line, and a line in a prompt gets recited), so the
  -- shape is what an answer can be bound to and what a later interview checks
  -- against to avoid asking the same thing twice.
  question_shape_hash text not null check (question_shape_hash ~ '^[0-9a-f]{64}$'),
  -- The captured audio, as an ordinary consented source with purpose
  -- 'interview'. NULL means the answer was given and the audio was not stored,
  -- which is a state this platform reports rather than deletes; see the header.
  source_id          uuid references vy_replica_source(source_id) on delete set null,
  -- The mirror window the answer arrived on, so an answer can be traced back to
  -- the seconds of call it came from. Nullable for the same reason source_id is.
  window_id          uuid references vy_mirror_window(window_id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint vy_interview_answer_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

-- ONE ANSWER PER QUESTION PER INTERVIEW. A second window against an already
-- answered gap refreshes nothing and must not double-count: `answers_captured`
-- is a number the studio prints, and a count that can drift past its own unique
-- rows is a number nobody can audit.
create unique index if not exists vy_interview_answer_shape_ix
  on vy_interview_answer (session_id, question_shape_hash);

create index if not exists vy_interview_answer_session_ix
  on vy_interview_answer (session_id, created_at);

create index if not exists vy_interview_answer_owner_ix
  on vy_interview_answer (owner_user_id, replica_id, created_at desc);

-- The "have we already asked this" read path, across every past interview for
-- this replica.
create index if not exists vy_interview_answer_shape_history_ix
  on vy_interview_answer (replica_id, owner_user_id, question_shape_hash);
