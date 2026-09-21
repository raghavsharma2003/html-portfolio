-- Migration 060 — vy_mirror_turn: the clone's own half of the Mirror Call.
--
-- Contract: docs/gurukul/MIRROR-CALL-SPEC.md §"Clone speech". WS-AC.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by 009/051/059
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint takes
-- exactly one statement per request, there is no transaction across statements,
-- and an apply interrupted halfway must be recoverable by running this file
-- again. NO DO blocks and no functions: db/migrations/apply.mjs's splitter is
-- deliberately small and does not handle them. Constraints therefore use the
-- drop-then-add idempotent pair.
--
-- ── WHY THE CLONE'S TURN IS A ROW AND NOT A RESPONSE FIELD ────────────────
-- `src/studio/mirrorCallApi.ts`'s `fetchMirrorCallTurnVoice` states the rule
-- it is enforcing: asking the server for the audio of an exact server-issued
-- turn "keeps the studio unable to make the clone say anything the server did
-- not author". That rule needs somewhere for the server's authorship to live
-- between the two requests. A `turn_id` that is not a primary key is a claim;
-- a `turn_id` that is one is a fact the synthesis path can bind to.
--
-- The consequence is the invariant `api/mirror-call.js`'s `opTurnVoice` reads
-- off this table and never off the query string: the TEXT SYNTHESISED IS THE
-- TEXT IN THIS ROW. There is no code path by which a caller supplies words to
-- a cloned voice, because there is no column for them to arrive in.
--
-- ── ONE TURN PER WINDOW, AND WHY THAT IS A UNIQUE INDEX ───────────────────
-- The Mirror Call is the cascade lane (ASR -> engine -> TTS), one window at a
-- time, by the spec's own decision. A second turn for one window would mean
-- the clone answered the same thing the owner said twice, and the two would
-- disagree the moment the sheet moved between them. `vy_mirror_turn_window_ix`
-- makes the retry of a half-failed ingest idempotent rather than doubling the
-- captions.
--
-- ── WHAT `sheet_source` IS FOR, AND WHY IT MAY NOT BE DROPPED ─────────────
-- A replica with no PUBLISHED sheet still has an owner who wants to hear
-- themselves, so the reply lane falls back to the owner's DRAFT sheet. That is
-- a real product decision and it is also exactly the sort of fallback that
-- becomes invisible: the owner hears a voice, it sounds plausible, and nobody
-- can tell whether they just calibrated the clone their students will meet or
-- a draft nobody has published. So the source rides on the row and on every
-- wire payload (`plausible-return-hides-a-dead-pipeline`). There is
-- deliberately NO third value for "a generic assistant": no sheet at all means
-- no turn, and `api/_mirrorcall-reply.js` has no branch that could produce one.
--
-- ── `generation_id` IS A BINDING, NOT A FORK ─────────────────────────────
-- Synthesis goes through WS-W's admission-broker lane unchanged
-- (`api/_voice/preview-panel.js`), which authorizes through
-- `beginOwnedVoicePreview` and therefore books a `vy_replica_generation` row
-- with `purpose='voice_preview'`, `channel='studio_preview'`. That is a
-- DECLARED deviation and not an oversight: widening 019's `channel` CHECK to
-- add a `mirror_call` value would be the second way into the HMAC, watermark
-- and disclosure path, and the one rule this workstream was given is not to
-- fork that path. So the mirror-call meaning of the generation is recorded
-- HERE, on the turn that caused it, and the ledger row stays the shape 045's
-- `vy_replica_generation_preview_shape` check already guarantees.

create table if not exists vy_mirror_turn (
  turn_id            uuid primary key default gen_random_uuid(),
  session_id         uuid not null references vy_mirror_session(session_id) on delete cascade,
  window_id          uuid not null references vy_mirror_window(window_id) on delete cascade,
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  seq                integer not null check (seq > 0),
  -- The clone's words. Non-empty by CHECK: a turn with no text is not a quiet
  -- turn, it is a turn that did not happen, and the honest shape for that is
  -- no row plus a named `turn_absent_reason` on the window result.
  text               text not null check (text <> ''),
  -- What the caption said, before the synthesis cap trimmed it. Equal to
  -- length(text) whenever nothing was trimmed; larger says so out loud. The
  -- caption and the audio are the SAME string in every case — a caption that
  -- says more than the voice said is `silent-truncation` with a speaker on it.
  assembled_chars    integer not null default 0 check (assembled_chars >= 0),
  sheet_id           uuid,
  sheet_source       text not null check (sheet_source in ('published','draft')),
  agent_slug         text not null default '',
  -- Counts only, never the strings `gateReply` caught — `_obs.js`'s law, and
  -- the whole point of a gate finding is that what it caught must not travel.
  gate_applied       boolean not null default false,
  gate_findings      integer not null default 0 check (gate_findings >= 0),
  generation_id      uuid,
  voice_state        text not null default 'unspoken'
                     check (voice_state in ('unspoken','warming','spoken','refused')),
  voice_failure_code text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vy_mirror_turn_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

-- drop-then-add is the idempotent pair for a constraint (009/051/059's shape).
alter table vy_mirror_turn drop constraint if exists vy_mirror_turn_voice_reason;

-- A refusal names itself. "The clone would not speak" with no code is the
-- state an operator cannot act on and an owner cannot be told anything about.
alter table vy_mirror_turn add constraint vy_mirror_turn_voice_reason
  check (voice_state <> 'refused' or voice_failure_code <> '');

alter table vy_mirror_turn drop constraint if exists vy_mirror_turn_spoken_binding;

-- 'spoken' means a protected clip left this process for this turn, and the
-- generation row is the only evidence of that which survives the request. A
-- 'spoken' turn with no generation id would be a claim about the watermark and
-- disclosure ledger that the ledger cannot confirm.
alter table vy_mirror_turn add constraint vy_mirror_turn_spoken_binding
  check (voice_state <> 'spoken' or generation_id is not null);

create unique index if not exists vy_mirror_turn_window_ix
  on vy_mirror_turn (window_id);

create index if not exists vy_mirror_turn_session_ix
  on vy_mirror_turn (session_id, seq);

create index if not exists vy_mirror_turn_owner_ix
  on vy_mirror_turn (owner_user_id, replica_id, created_at desc);
