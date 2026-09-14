-- Migration 072 - owner identity by SPEAKER VERIFICATION (WS-R2).
--
-- Why this table exists at all. Self-cloning only is a law
-- (context/decisions.md#replica-self-only), and today the only path past
-- `identity_verification_required` / `liveness_verification_required` is
-- either the Azure Document Intelligence + Face Liveness stack (migrations
-- 039-041, never deployed, two Microsoft Limited Access approvals
-- outstanding) or REPLICA_SELF_TEST_MODE, which is a FLAG and is owner-bound
-- internal testing rather than a shippable path
-- (rejected.md#single-self-test-boolean-is-a-global-footgun).
--
-- This is the third path and it uses only what already runs: the owner speaks
-- a freshly issued sentence on camera, the deployed voice-evidence service
-- embeds it (ECAPA + x-vector), Sarvam transcribes it, and the two numbers
-- together decide. The DECISION IS A ROW, and the existing gate reads the row
-- through the SAME predicate the Azure path would have satisfied
-- (`vy_replica.identity_verified_at` / `liveness_verified_at` /
-- `identity_expires_at`). No new bypass flag is added anywhere.
--
-- Idempotent, ONE STATEMENT PER REQUEST (Neon SQL-over-HTTP; see
-- 001/apply.mjs). No DO blocks: every CHECK lands as a single
-- drop-then-add `alter table`, which is migration 065's pattern and is
-- splitter-safe.
--
-- NO FOREIGN KEYS on replica_id / owner_user_id, per 009's WHERE-clause
-- binding convention (the same convention 053/055/057/058/061 follow). That
-- means there is no cascade to inherit from vy_replica, so this table is
-- deleted BY NAME in api/_replica-full-erasure.js. scripts/relcheck.mjs's
-- owner-lane reach walk fails the build if that line is ever dropped, which
-- is the point: a challenge row names a person and carries the numeric
-- verdict on their own voice, and a row of it outliving the replica is a
-- standing biometric claim about a human after the deletion receipt said the
-- replica was gone.

create table if not exists vy_replica_voice_challenge (
  challenge_id              uuid primary key default gen_random_uuid(),
  replica_id                uuid not null,
  owner_user_id             uuid not null,
  -- The sentence is server-issued and displayed on screen. It is not a secret
  -- and not biometric, and the scorer needs the exact words to compute word
  -- overlap, which a one-way hash cannot give it. vy_replica_liveness_challenge
  -- stores its `phrase` in the clear for the same reason.
  sentence                  text not null,
  sentence_hash             text not null,
  -- The spoken digits. This is the anti-replay half that does not depend on
  -- word overlap surviving transliteration: an old recording of this person
  -- cannot contain digits that were generated after it was made.
  nonce                     text not null,
  policy_version            text not null,
  challenge_policy          text not null,
  attempt                   integer not null default 1 check (attempt > 0),
  state                     text not null default 'issued'
                            check (state in ('issued','captured','verifying','verified','failed','expired')),
  decision                  text not null default ''
                            check (decision in ('','accept','review','reject')),
  similarity                double precision,
  transcript_overlap        double precision,
  reference_source_id       uuid,
  reference_genome_version  integer,
  captured_source_id        uuid,
  transcript_source_id      uuid,
  -- Content-free by contract: thresholds, the two scores, the nonce match,
  -- embedding families and sample counts. Never the transcript text, never a
  -- vector. api/_replica-voice-identity.js refuses to persist anything else.
  decision_basis            jsonb not null default '{}'::jsonb,
  failure_code              text not null default '',
  verification_attempt      integer not null default 0 check (verification_attempt >= 0),
  verification_next_attempt_at   timestamptz not null default now(),
  verification_lease_token_hash  text not null default '',
  verification_leased_at         timestamptz,
  verification_lease_expires_at  timestamptz,
  issued_at                 timestamptz not null default now(),
  expires_at                timestamptz not null,
  decided_at                timestamptz,
  updated_at                timestamptz not null default now()
);

alter table vy_replica_voice_challenge
  add column if not exists transcript_source_id uuid;

alter table vy_replica_voice_challenge
  add column if not exists reference_genome_version integer;

alter table vy_replica_voice_challenge
  add column if not exists transcript_overlap double precision;

alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_basis_check,
  add constraint vy_replica_voice_challenge_basis_check
    check (jsonb_typeof(decision_basis)='object' and octet_length(decision_basis::text)<=4096);

alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_lease_check,
  add constraint vy_replica_voice_challenge_lease_check
    check (verification_lease_token_hash='' or verification_lease_token_hash ~ '^[0-9a-f]{64}$');

alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_hash_check,
  add constraint vy_replica_voice_challenge_hash_check
    check (sentence_hash ~ '^[0-9a-f]{64}$');

-- A decided challenge must carry the decision it was decided by, and an
-- undecided one must not pretend to have one. This is the constraint that
-- stops a half-written settlement reading as a verdict.
alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_decision_check,
  add constraint vy_replica_voice_challenge_decision_check
    check ((state in ('verified','failed')) = (decision <> '' and decided_at is not null));

-- The owner-tuple index every scoped read goes through.
create unique index if not exists vy_replica_voice_challenge_owner_tuple_ix
  on vy_replica_voice_challenge (challenge_id,replica_id,owner_user_id);

create index if not exists vy_replica_voice_challenge_latest_ix
  on vy_replica_voice_challenge (replica_id,owner_user_id,issued_at desc);

-- The sweep's work queue: only rows that can actually be leased.
create index if not exists vy_replica_voice_challenge_ready_ix
  on vy_replica_voice_challenge (verification_next_attempt_at,issued_at)
  where state in ('captured','verifying');

-- The durable attempt ledger. Same shape and same reason as 039's
-- vy_replica_liveness_verification_attempt: a verdict with no attempt trail
-- cannot tell "never ran" from "ran and failed", and those are the two things
-- an operator most needs to tell apart when a gate is refusing someone.
create table if not exists vy_replica_voice_challenge_attempt (
  challenge_id      uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  attempt           integer not null check (attempt > 0),
  verifier          text not null,
  verifier_version  text not null,
  outcome           text not null check (outcome in ('running','retry','verified','failed')),
  failure_code      text not null default '',
  result            jsonb not null default '{}'::jsonb,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  primary key (challenge_id,attempt)
);

alter table vy_replica_voice_challenge_attempt
  drop constraint if exists vy_replica_voice_challenge_attempt_result_check,
  add constraint vy_replica_voice_challenge_attempt_result_check
    check (jsonb_typeof(result)='object' and octet_length(result::text)<=4096);

create index if not exists vy_replica_voice_challenge_attempt_owner_ix
  on vy_replica_voice_challenge_attempt (owner_user_id,replica_id,started_at desc);

-- The new capture mode. `identity_challenge` sources are deliberately NOT
-- 'upload': api/_replica-source.js only enqueues the eight-step enrollment DAG
-- for capture_mode='upload', so a challenge clip can never be mistaken for
-- enrollment material and can never reach a voice genome. It is verification
-- evidence, it is erased when the decision lands, and it trains nothing.
alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','identity_document',
                            'identity_challenge','upload','import','derived'));
