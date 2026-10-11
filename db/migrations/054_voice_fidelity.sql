-- Migration 054 — vy_voice_fidelity: the stored half of the "still sounds like
-- them" guarantee.
--
-- Contract: docs/gurukul/SPEC-GURUKUL.md §8.2 ("'Still sounds like them' = a
-- numeric fidelity score per clone (speaker-embedding similarity from the
-- voice-evidence stack + the blind owner-calibration pass), recomputed on every
-- voice/model update, surfaced to the expert, gating activation"), and
-- docs/VOICE-DELIVERY-HOLDOUT.md's own firewall note ("Production remains
-- locked until real automated gates measure speaker identity, ... over separate
-- test data") — this table is the speaker-identity one of those gates. The
-- scoring math is api/_fidelity.js; the embeddings come from
-- services/voice-evidence (ECAPA-TDNN, L2-normalised).
--
-- Idempotent, one statement per request — 009's law, restated by 051 and
-- binding here for the SAME reason 051 gave: this table is read by the replica
-- runtime's activation path, so it must stay recoverable by the same law the
-- agent tables were built under. NO DO blocks and no functions: apply.mjs's
-- splitter is deliberately small and does not handle them. (041-050 in the
-- replica lab do use DO blocks; they are the exception this file does not
-- follow.) Constraints therefore use the drop-then-add idempotent pair.
--
-- ── the row's key names the VOICE, completely ─────────────────────────────
-- `cache-outlives-the-voice` (context/rejected.md, 2026-08-24): the clip caches
-- were keyed by text, style and message id — never by the voice — so a voice
-- switch moved every lane that GENERATED audio and no key that REPLAYED it, and
-- installs kept serving the old voice out of a cache that was, by its own key,
-- perfectly valid. The gate was green and correct and the product was wrong.
--
-- A stored fidelity pass is the identical hazard with higher stakes: a "still
-- sounds like them" verdict whose key does not name the voice it was measured
-- on will keep covering a voice it never heard. So the key is
-- (voice_profile_ref, genome_version, voice_model_ref) and all three
-- participate in supersession:
--   * a new VoiceGenome version produces a new vy_replica_voice_profile row,
--     which has NO fidelity row — the gate fails closed with no invalidation
--     step required, which is the strongest form of this rule;
--   * a fine-tuned model landing under an existing profile changes
--     voice_model_ref, and api/_fidelity.js supersedes the standing row;
--   * a re-benched threshold set changes policy_version, and an old number is
--     recognisable as scored under old thresholds rather than silently
--     compared against new ones.
--
-- ── one standing row, enforced structurally ───────────────────────────────
-- `gate0-structural` (docs/gurukul/safety-floor-teacher.md): "A sentence in a
-- brief is a preference; a predicate on the output is a guarantee." The
-- activation query reads `superseded_at is null`; if two such rows could exist
-- for one profile, which one gates activation would depend on write ordering.
-- The partial unique index below makes that unrepresentable rather than
-- unlikely.

create table if not exists vy_voice_fidelity (
  fidelity_id       uuid primary key default gen_random_uuid(),
  replica_id        uuid not null references vy_replica(replica_id) on delete cascade,
  owner_user_id     uuid not null,
  -- FK-shaped and FK-constrained below against the owner tuple, so a fidelity
  -- row can never name a voice profile belonging to a different owner.
  voice_profile_ref uuid not null,
  -- The exact model/fine-tune the CANDIDATE audio came from. '' is legal only
  -- for the zero-shot lane, which has no per-expert model ref yet.
  voice_model_ref   text not null default '',
  genome_version    integer not null check (genome_version > 0),
  -- { mean, p10, worst, windows, references } — cosine statistics, never
  -- vectors and never audio. The shape is checked below rather than trusted.
  score             jsonb not null,
  policy_version    text not null,
  status            text not null check (status in ('pass','warn','fail')),
  computed_at       timestamptz not null default now(),
  superseded_at     timestamptz
);

alter table vy_voice_fidelity drop constraint if exists vy_voice_fidelity_profile_fk;

alter table vy_voice_fidelity add constraint vy_voice_fidelity_profile_fk
  foreign key (voice_profile_ref, replica_id, owner_user_id)
  references vy_replica_voice_profile (voice_profile_id, replica_id, owner_user_id) on delete cascade;

alter table vy_voice_fidelity drop constraint if exists vy_voice_fidelity_score_shape;

-- The score is read by the activation gate and rendered to the expert. A row
-- whose jsonb is missing a statistic would read as a pass with a blank number.
alter table vy_voice_fidelity add constraint vy_voice_fidelity_score_shape
  check (jsonb_typeof(score->'mean') = 'number'
     and jsonb_typeof(score->'p10') = 'number'
     and jsonb_typeof(score->'worst') = 'number');

-- At most ONE standing (non-superseded) row per voice profile. See the note
-- above: without this, "the fidelity row" is a race.
create unique index if not exists vy_voice_fidelity_standing_ix
  on vy_voice_fidelity (voice_profile_ref) where superseded_at is null;

-- The activation gate's read path: the standing row for one owner's profile.
create index if not exists vy_voice_fidelity_gate_ix
  on vy_voice_fidelity (replica_id, owner_user_id, voice_profile_ref, computed_at desc);

-- The expert-facing history path: every measurement for a clone, newest first,
-- superseded rows included. Superseded rows are KEPT, never deleted — the
-- history of a score moving is the only way an expert can see drift, and
-- deleting it would make every re-bench look like the first one.
create index if not exists vy_voice_fidelity_history_ix
  on vy_voice_fidelity (replica_id, computed_at desc);
