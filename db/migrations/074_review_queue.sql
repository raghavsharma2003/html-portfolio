-- Migration 074 — the review queue: vy_review_card + vy_review_never_rule, and
-- the `purpose` column that makes a correction a first-class source.
--
-- Contract: WS-R4. Thirty seconds a card. One question, the answer the AI gave,
-- three buttons: Sounds right / Close, fix it / Never say this. This is where
-- fidelity is actually made, so the three decisions are three DIFFERENT writes
-- and none of them edits a derived row in place.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by 009/051/058/059
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint takes
-- exactly one statement per body, db/migrations/apply.mjs runs them
-- individually with no transaction across them, and an apply interrupted
-- halfway must be recoverable by running this file again. NO DO blocks and no
-- functions: apply.mjs's splitter is deliberately small and does not handle
-- them, so every constraint uses the drop-then-add idempotent pair.
--
-- ── no foreign keys on replica_id / owner_user_id ────────────────────────
-- Same convention as 051/053/055/057/058/061: both columns are FK-SHAPED and
-- carry no FK constraint, and the binding is enforced by the WHERE clause (009's
-- law). Because there is no cascade to inherit, BOTH tables are deleted BY NAME
-- in api/_replica-full-erasure.js — scripts/relcheck.mjs's owner-lane reach walk
-- fails the build for any owner_user_id table reachable by neither, and it would
-- have failed for these the moment they existed. They are deliberately NOT added
-- to PERSON_TABLES: api/memory.js's "WHAT IS DELIBERATELY NOT IN THE LIST ABOVE"
-- carries the argument, and relcheck's manifest check excludes owner-keyed
-- tables for exactly that reason.
--
-- ── why 'fixed' cannot exist without a correction source ─────────────────
-- 059's `vy_mirror_delta_applied_gate` is the precedent and the argument
-- transfers unchanged: a tap that did nothing must not look like a tap that
-- worked. "Close, fix it" means the owner's better answer became a CITED
-- SOURCE. If that source row is not there, the card is not fixed, and
-- `vy_review_card_fixed_gate` makes the half-landed state unrepresentable
-- rather than merely untested. The API writes the source UPSTREAM of the state
-- flip for the same reason `decideMirrorDelta` writes the sheet upstream of its
-- flip (context/decisions.md#mirror-call-approval-is-one-sql-clause).
--
-- ── why the correction is a SOURCE and never a prompt line ───────────────
-- `recited-prompt` (context/rejected.md): anything sentence-shaped in a brief
-- gets recited verbatim, measured twice, in unrelated features. The owner's
-- better answer is the single most recitable string this product can produce —
-- a whole sentence, in their own words, about a question their audience really
-- asks. So it enters the platform the way every other piece of owner material
-- enters it: as a row on vy_replica_source with `purpose='correction'`,
-- retrieved at answer time, never pasted into a persona. 059 states the same
-- rule one table over for `vy_mirror_feedback.rephrase_text`.
--
-- ── why a never-rule is a table and not a sentence ───────────────────────
-- docs/gurukul/safety-floor-teacher.md, quoting the governing measurement:
-- "prompt instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 …
-- a sentence in a brief is a preference, a predicate on the output is a
-- guarantee." "Never say this" therefore writes a ROW that the reply predicate
-- reads (api/_review-queue.js::compileNeverRules, applied inside
-- api/_surface.js::gateReply, the one door), and writes nothing anywhere near a
-- prompt.

create table if not exists vy_review_card (
  card_id              uuid primary key default gen_random_uuid(),
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  -- Where the card came from. 'question' is the pre-launch synthetic set drawn
  -- from the replica's own sources; 'claim' is a mined claim awaiting decision;
  -- 'delta' is a Mirror Call chip; 'follower_declined' is a real follower
  -- question the AI declined or answered with low confidence. The last kind is
  -- a HOOK: it is written from an event shape (api/_review-queue.js's
  -- `followerDeclinedEvent`), not from any Room code this workstream depends on.
  kind                 text not null
                       check (kind in ('question','claim','delta','follower_declined')),
  prompt_text          text not null
                       check (prompt_text <> '' and length(prompt_text) <= 500),
  -- What the AI said. '' is legal and means the AI DECLINED: a declined
  -- question is the most valuable card in the deck and refusing to store it
  -- because the answer field is empty would drop exactly those.
  answer_text          text not null default '' check (length(answer_text) <= 4000),
  -- The citations behind `answer_text`, as the studio renders them. A column
  -- rather than a key inside a blob because the citation law on this platform's
  -- other derived tables (vy_fact, vy_pattern, vy_mirror_delta) is a column too.
  source_refs          jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(source_refs) = 'array'
                          and octet_length(source_refs::text) <= 4096),
  -- What the card was generated FROM, as `<kind>:<id>`, so a claim or a delta
  -- can never produce two cards and a decision can be walked back to its
  -- origin. '' for a synthetic question, which has no upstream row.
  origin_ref           text not null default '' check (length(origin_ref) <= 128),
  -- The DEDUPE key: sha256 over (kind, normalised prompt). A unique index on
  -- (replica_id, dedupe_hash) is what makes "deduplicated" a property of the
  -- database rather than of whichever generator ran last.
  dedupe_hash          text not null check (dedupe_hash ~ '^[0-9a-f]{64}$'),
  state                text not null default 'open'
                       check (state in ('open','sounds_right','fixed','never')),
  decided_at           timestamptz,
  -- The vy_replica_source row carrying the owner's better answer. FK-shaped,
  -- not FK, for the reason the header gives.
  correction_source_id uuid,
  created_at           timestamptz not null default now()
);

alter table vy_review_card drop constraint if exists vy_review_card_decided_gate;

-- A decided card carries the moment it was decided, and an open one does not
-- pretend to. "When did I say that" is the first question an owner asks of a
-- decision they no longer agree with.
alter table vy_review_card add constraint vy_review_card_decided_gate
  check ((state = 'open') = (decided_at is null));

alter table vy_review_card drop constraint if exists vy_review_card_fixed_gate;

-- THE NEGATIVE CONTROL WRITTEN AS A CONSTRAINT. A 'fixed' card without the
-- correction source it claims to have cannot exist, whatever a future statement
-- tries to do; and a correction source cannot be attached to a card in any
-- other state, which stops a correction being recorded against a card the owner
-- actually approved. 059's `vy_mirror_delta_applied_gate`, one table over.
alter table vy_review_card add constraint vy_review_card_fixed_gate
  check ((state = 'fixed') = (correction_source_id is not null));

create unique index if not exists vy_review_card_dedupe_ix
  on vy_review_card (replica_id, dedupe_hash);

create index if not exists vy_review_card_open_ix
  on vy_review_card (owner_user_id, replica_id, created_at)
  where state = 'open';

create index if not exists vy_review_card_owner_ix
  on vy_review_card (owner_user_id, replica_id, created_at desc);

-- ── "Never say this" ─────────────────────────────────────────────────────
--
-- One row per thing this AI must never say, in the owner's own terms. `pattern`
-- is matched case-insensitively against the assembled reply by
-- api/_review-queue.js::compileNeverRules and enforced inside
-- api/_surface.js::gateReply. It is NEVER rendered into a prompt: a list of
-- forbidden sentences in a brief is a phrase bank pointed at the exact strings
-- it forbids (`recited-prompt`).
--
-- `revoked_at` rather than DELETE, because "I un-forbade this on the 3rd" is a
-- question an owner is entitled to be able to answer.
create table if not exists vy_review_never_rule (
  rule_id       uuid primary key default gen_random_uuid(),
  replica_id    uuid not null,
  owner_user_id uuid not null,
  pattern       text not null check (pattern <> '' and length(pattern) <= 200),
  reason        text not null default '' check (length(reason) <= 500),
  -- The card that produced this rule, when one did. FK-shaped, not FK.
  card_id       uuid,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

create index if not exists vy_review_never_rule_active_ix
  on vy_review_never_rule (replica_id, owner_user_id, created_at)
  where revoked_at is null;

create unique index if not exists vy_review_never_rule_pattern_ix
  on vy_review_never_rule (replica_id, lower(pattern))
  where revoked_at is null;

-- ── a correction is a source with a purpose ──────────────────────────────
--
-- vy_replica_source already carries `capture_mode`, which says HOW bytes
-- arrived (uploaded, imported, derived, captured live). It does not say WHY
-- they exist, and a correction needs both: it arrives through the ordinary
-- signed upload (`capture_mode='upload'`, so the existing DAG transcribes a
-- dictated one without a second pipeline) and it exists because an owner
-- corrected an answer. Defaulting to 'memory' leaves every source ever written
-- byte-for-byte as it was.
alter table vy_replica_source
  add column if not exists purpose text not null default 'memory';

alter table vy_replica_source
  drop constraint if exists vy_replica_source_purpose_check;

alter table vy_replica_source
  add constraint vy_replica_source_purpose_check
    check (purpose in ('memory','identity_document','correction'));

create index if not exists vy_replica_source_correction_ix
  on vy_replica_source (replica_id, owner_user_id, created_at desc)
  where purpose = 'correction';
