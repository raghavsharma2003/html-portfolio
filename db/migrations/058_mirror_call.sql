-- Migration 058 — the Mirror Call: the calibration call where a clone learns
-- from its own human, and the five tables that make "learns on the go" mean
-- something a regulator, an owner and a negative control can all read.
--
-- Contract: docs/gurukul/MIRROR-CALL-SPEC.md. WS-X.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by 009/051/054/056
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint takes
-- exactly one statement per request, there is no transaction across statements,
-- and an apply interrupted halfway must be recoverable by running this file
-- again. NO DO blocks and no functions: db/migrations/apply.mjs's splitter is
-- deliberately small and does not handle them. Constraints therefore use the
-- drop-then-add idempotent pair.
--
-- ── THE ONE LAW THESE TABLES EXIST TO MAKE STRUCTURAL ─────────────────────
-- SPEC-GURUKUL §8 item 3: never a silent self-update of a live persona. The
-- Mirror Call does not get an exception; it makes approval AMBIENT. So the
-- shape here is deliberately NOT "a learning loop with an audit table beside
-- it". It is:
--
--   mining writes ONLY to vy_mirror_delta, and only ever in an UN-ACTIONED
--   state ('proposed' on the live rail, 'deferred' when the per-minute chip
--   budget held it back for the review queue);
--   the sheet is written by exactly ONE statement in api/_mirrorcall-store.js,
--   and that statement cannot fire unless a delta row is STILL un-actioned
--   and the owner's decision is 'accepted'.
--
-- `state` is therefore not a status column, it is the gate. A delta that was
-- never tapped has no path to vy_teacher_sheet at all — not a path that is
-- checked, a path that does not exist. `gate0-structural`
-- (docs/gurukul/safety-floor-teacher.md): a sentence in a brief is a
-- preference, a predicate on the output is a guarantee.
--
-- ── WHY A DELTA CARRIES ITS CITATIONS AS A COLUMN ────────────────────────
-- `cited_windows` is not provenance decoration. A chip that says "you say
-- 'basically' a lot" and cannot name the seconds it heard it in is a claim,
-- and the owner is being asked to approve a change to a clone of THEMSELVES
-- on the strength of it. The citation law this repo already enforces on
-- vy_fact / vy_pattern is the same law: an uncited derived row must not exist.
-- It is an int[] of window sequence numbers rather than a uuid[] because the
-- studio renders "turn 4, turn 9" and a sequence number is what a caption rail
-- can scroll to.
--
-- ── WHY THE FINE-TUNE ROW IS A QUEUE ROW AND NOT A RUN ────────────────────
-- The spec: "A fine-tune job (WS-U lane) is QUEUED at call end, never run
-- mid-call — a fine-tune takes GPU-minutes and pretending otherwise would be a
-- fake progress bar." vy_mirror_finetune_job has no lease columns, no attempt
-- counter and no worker in this repo, and that absence is the honest statement.
-- The day a runner exists it adds its own columns in its own migration; until
-- then a row here means "the owner asked for this and nothing has run it",
-- which is exactly what the studio must be able to say.
--
-- ── SELECTION, NOT ACCUMULATION (WS-Z, adoption delta A1) ─────────────────
-- `mirror-learning-is-selection-not-accumulation` (context/decisions.md,
-- 2026-08-26). Chatterbox's `prepare_conditionals()` slices the reference
-- twice before the model sees it — `DEC_COND_LEN = 10 * S3GEN_SR` (10 s for
-- S3Gen) and `ENC_COND_LEN = 6 * S3_SR` (6 s for the T3 speech prompt) — and
-- `generate()` takes ONE `audio_prompt_path`. So a growing reference pool is
-- mechanically inert: turn 40 of a call conditions on at most 10 s exactly as
-- turn 2 did, and our own 0.7753 at 71 s of reference sits seven times past
-- the truncation window.
--
-- These tables therefore do NOT model a reference SET. They model a CANDIDATE
-- POOL (`vy_mirror_window`, scored) and a SELECTION
-- (`vy_mirror_conditioning`, at most one standing row per replica). "The
-- clone got better" means a better ten seconds was chosen, and the partial
-- unique index below is what makes "the current conditioning window" a fact
-- rather than a race.

-- ── the session ───────────────────────────────────────────────────────────
--
-- Bound to (replica_id, owner_user_id) by FK, so a session naming a replica the
-- caller does not own is not merely refused by a WHERE clause — it cannot be
-- inserted. The state machine is two live states and one terminal pair:
-- 'open' -> 'ended' on the owner ending the call, 'open' -> 'aborted' when the
-- replica is revoked underneath it.
create table if not exists vy_mirror_session (
  session_id        uuid primary key default gen_random_uuid(),
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  state             text not null default 'open'
                    check (state in ('open','ended','aborted')),
  policy_version    text not null,
  -- Which consent scopes were live AT START, frozen into the row. A scope
  -- revoked mid-call must not retroactively legitimise a window already
  -- admitted, and a scope granted mid-call must not silently widen a session
  -- the owner opened under narrower terms. Both directions need the record.
  consent_scopes    text[] not null default '{}'::text[],
  -- Whether call audio may enter the CANDIDATE POOL at all, decided once at
  -- start from the scopes above. FALSE is the normal answer today (the
  -- modelling scope needs live verification), and a session that reports it
  -- honestly is the difference between "no candidates" and "candidates we
  -- lost".
  reference_consent boolean not null default false,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  updated_at        timestamptz not null default now(),
  constraint vy_mirror_session_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

-- At most ONE open session per replica. Two concurrent Mirror Calls on one
-- clone would mine two rolling transcripts into one sheet and the winner would
-- be decided by write ordering — the same race vy_voice_fidelity's standing
-- index makes unrepresentable rather than unlikely.
create unique index if not exists vy_mirror_session_open_ix
  on vy_mirror_session (replica_id) where state = 'open';

create index if not exists vy_mirror_session_owner_ix
  on vy_mirror_session (owner_user_id, replica_id, started_at desc);

-- ── the ingested owner-turn windows ──────────────────────────────────────
--
-- `asr_state` has THREE values and 'dropped' is the load-bearing one. The spec:
-- "If ASR lags or a window drops, the chip stream says so; a quiet learning
-- loop that dropped its input looks identical to a clone with nothing to
-- learn." A dropped window is a ROW, kept, counted, and reported in the
-- coverage arithmetic — never an absent row, which is indistinguishable from
-- a window nobody sent.
create table if not exists vy_mirror_window (
  window_id         uuid primary key default gen_random_uuid(),
  session_id        uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  -- Monotonic within a session; the studio's caption rail scrolls to it and a
  -- delta cites it. Not a timestamp: two windows can share a millisecond.
  seq               integer not null check (seq > 0),
  -- The consented private object this window's audio was uploaded to, through
  -- the ordinary vy_replica_source lane. NULL means the window carried no
  -- audio reference (transcript-only ingest), which is legal and is why
  -- reference growth is counted off `reference_admitted` and not off rows.
  source_id         uuid references vy_replica_source(source_id) on delete set null,
  duration_ms       integer not null check (duration_ms > 0 and duration_ms <= 30000),
  -- 'sync' is the only lane a live chip stream can use: Sarvam's synchronous
  -- endpoint refuses audio over 30 s (measured 2026-08-26) and the batch lane
  -- took 137 s on a 71 s file. The CHECK above is that 30 s cap as a
  -- constraint, so a longer window cannot be stored as if it had been mined.
  lane              text not null default 'sync' check (lane in ('sync')),
  asr_state         text not null default 'pending'
                    check (asr_state in ('pending','transcribed','dropped')),
  -- Why it dropped, when it dropped. '' on every other state.
  failure_code      text not null default '',
  -- PII-scrubbed before storage (WS-Z A4, the WeClone/Presidio stage). The
  -- raw ASR string is never written: a Mirror Call mines a live transcript and
  -- a phone number spoken aloud would otherwise reach a jsonb column, a chip
  -- and eventually a prompt.
  transcript        text not null default '',
  asr_provider      text not null default '',
  asr_model         text not null default '',
  -- ── the candidate pool (WS-Z A1) ────────────────────────────────────────
  -- `reference_admitted` names membership of the CANDIDATE POOL, not of a
  -- reference set that conditions anything. Only the row selected in
  -- vy_mirror_conditioning conditions synthesis, and only ten seconds of it.
  reference_admitted boolean not null default false,
  admission_reason  text not null default '',
  -- How much of this window can ever condition S3Gen: min(duration, 10 s).
  -- Stored rather than derived so the selection query does not have to know
  -- the truncation constant, and so the day the constant moves the old rows
  -- still say what they were selected under.
  conditioning_ms   integer not null default 0 check (conditioning_ms >= 0 and conditioning_ms <= 10000),
  -- ── own-voice admission (WS-Z A3) ───────────────────────────────────────
  -- Both a quality predicate (recursive-training collapse if the clone's own
  -- output re-enters the pool) and a CONSENT one (a second person audible on
  -- the owner's side consented to nothing).
  --   owner_verified  ECAPA cosine to the enrolled profile cleared the floor
  --   clone_overlap   the window overlaps an interval the clone was speaking
  --   foreign_speaker measured, and it is not the owner
  --   unverified      no measurement — FAILS admission, see the CHECK below
  own_voice_state   text not null default 'unverified'
                    check (own_voice_state in ('owner_verified','clone_overlap','foreign_speaker','unverified')),
  -- ECAPA cosine to the owner's enrolled voice profile. NULL means nobody
  -- measured it, which is not the same as zero and must never be read as one.
  owner_similarity  real check (owner_similarity is null or (owner_similarity >= -1 and owner_similarity <= 1)),
  -- The conditioning-quality score this window was ranked on, and where it
  -- came from. NULL score = unscored = INELIGIBLE for selection.
  quality_score     real check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  score_source      text not null default '' check (score_source in ('','wav_probe','voice_evidence')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vy_mirror_window_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

alter table vy_mirror_window drop constraint if exists vy_mirror_window_dropped_reason;

-- A dropped window must name why. A drop with an empty failure_code renders in
-- the studio as a silent gap, which is the exact shape the honesty rule above
-- exists to forbid.
alter table vy_mirror_window add constraint vy_mirror_window_dropped_reason
  check (asr_state <> 'dropped' or failure_code <> '');

alter table vy_mirror_window drop constraint if exists vy_mirror_window_admission_reason;

-- Admission is likewise never silent in either direction: an admitted window
-- names the consent it rode in on, a withheld one names what was missing.
alter table vy_mirror_window add constraint vy_mirror_window_admission_reason
  check (admission_reason <> '');

alter table vy_mirror_window drop constraint if exists vy_mirror_window_own_voice_gate;

-- WS-Z A3, made structural. An admitted candidate is one whose speaker was
-- MEASURED to be the owner. 'unverified' cannot be admitted — the fail-closed
-- direction, because the failure of getting this wrong is the clone's own
-- output training the clone (model collapse) or a non-consenting third party's
-- voice entering a biometric pool. A predicate on the output is a guarantee;
-- a branch in JS is a preference.
alter table vy_mirror_window add constraint vy_mirror_window_own_voice_gate
  check (not reference_admitted or own_voice_state = 'owner_verified');

alter table vy_mirror_window drop constraint if exists vy_mirror_window_score_source;

-- A score without a source is a number nobody can audit; a source without a
-- score is a claim to have measured something that is not there.
alter table vy_mirror_window add constraint vy_mirror_window_score_source
  check ((quality_score is null) = (score_source = ''));

create unique index if not exists vy_mirror_window_seq_ix
  on vy_mirror_window (session_id, seq);

create index if not exists vy_mirror_window_session_ix
  on vy_mirror_window (session_id, created_at);

create index if not exists vy_mirror_window_owner_ix
  on vy_mirror_window (owner_user_id, replica_id, created_at desc);

-- The selection query's read path: this replica's scored, admitted candidates,
-- best first.
create index if not exists vy_mirror_window_candidate_ix
  on vy_mirror_window (replica_id, owner_user_id, quality_score desc)
  where reference_admitted and quality_score is not null;

-- ── the selected conditioning window (WS-Z A1) ───────────────────────────
--
-- THE CLONE'S VOICE CHANGES HERE AND NOWHERE ELSE. A new row means the next
-- synthesised turn conditions on different audio; no new row means it does
-- not, whatever else grew. That is the fact `vy_mirror_conditioning` exists to
-- make legible, because the fidelity METER moves with the pool (ECAPA pools
-- every window) while SYNTHESIS moves only with this table — and one number
-- showing motion the clone cannot have had is the `disclosure-announces-the-
-- clone` family of defect (WS-Z A2).
--
-- Superseded rows are KEPT. The history of which ten seconds was chosen is the
-- only way to attribute a fidelity change to a selection, and deleting it would
-- make every re-selection look like the first one — 054's argument, transferred.
create table if not exists vy_mirror_conditioning (
  selection_id      uuid primary key default gen_random_uuid(),
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  -- The window whose first `conditioning_ms` the next turn conditions on.
  window_id         uuid not null references vy_mirror_window(window_id) on delete cascade,
  -- The session that produced it, so a selection can be traced to a call.
  session_id        uuid not null references vy_mirror_session(session_id) on delete cascade,
  score             real not null check (score >= 0 and score <= 1),
  conditioning_ms   integer not null check (conditioning_ms > 0 and conditioning_ms <= 10000),
  -- Which scorer ranked it. A selection made under one scorer must be
  -- recognisable as such when a better scorer lands, rather than silently
  -- compared against numbers from a different scale — 054's `policy_version`
  -- argument, transferred.
  score_source      text not null check (score_source in ('wav_probe','voice_evidence')),
  selected_at       timestamptz not null default now(),
  superseded_at     timestamptz,
  constraint vy_mirror_conditioning_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

-- AT MOST ONE STANDING SELECTION PER REPLICA. Without this, "what does the
-- next turn condition on" depends on write ordering — and the whole point of
-- the table is that the answer is a fact.
create unique index if not exists vy_mirror_conditioning_standing_ix
  on vy_mirror_conditioning (replica_id) where superseded_at is null;

create index if not exists vy_mirror_conditioning_history_ix
  on vy_mirror_conditioning (replica_id, selected_at desc);

create index if not exists vy_mirror_conditioning_owner_ix
  on vy_mirror_conditioning (owner_user_id, replica_id, selected_at desc);

-- ── the proposed deltas ──────────────────────────────────────────────────
--
-- `fragment` is at most three words by construction upstream
-- (PHRASE_BANK_MAX_WORDS in src/engine/ingest/transcriptStats.ts) and the
-- CHECK below re-states the half of that rule this table can see: no terminal
-- punctuation. `recited-prompt` is the law — anything sentence-shaped in a
-- prompt gets recited — and boardVerbalisms is the one mined field that ends up
-- spoken by a clone of a real named person. The guard is duplicated in JS
-- (api/_mirrorcall.js) and here for `_teachersheet.js`'s three-copies reason:
-- the JS copy catches the mine, this copy catches a future writer.
create table if not exists vy_mirror_delta (
  delta_id          uuid primary key default gen_random_uuid(),
  session_id        uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  kind              text not null
                    check (kind in ('phrase_habit','slang_habit','filler_advisory',
                                    'laughter_advisory','stretch_advisory','code_switch_advisory',
                                    'feedback_note')),
  -- ── WS-Z A4: mined-from-BEHAVIOUR and accepted-from-JUDGEMENT are separate
  --    columns, never averaged ────────────────────────────────────────────
  -- The Mirror Call's sycophancy hazard is specific: the owner is judging a
  -- clone of THEMSELVES, so a 👍 rewards "sounds like me as I would like to
  -- sound" rather than "sounds like me". The statistical miner reads what was
  -- actually SAID and is the only thing in the loop pulling the other way.
  -- Keeping the two signals in one column would average that divergence into
  -- invisibility; keeping them apart makes it a number someone can look at.
  origin            text not null default 'mined' check (origin in ('mined','judgement')),
  -- ── WS-Z A4/A5: the evidence count rides on the chip ─────────────────────
  -- Stylometry's measured floor is 2,000–5,000 running words and samples under
  -- 3,000 words produced over 60% false attribution. One 30-minute Mirror Call
  -- yields roughly 1,800–2,300 owner words — below every published floor. So a
  -- chip is a HYPOTHESIS with its n attached, and `occurrences` /
  -- `corpus_tokens` are columns rather than jsonb keys precisely so a studio
  -- cannot render the claim without the number, and so "n=1 in 400 words"
  -- and "n=9 across three calls" are orderable rather than equally confident.
  occurrences       integer not null default 0 check (occurrences >= 0),
  corpus_tokens     integer not null default 0 check (corpus_tokens >= 0),
  -- The measured fragment, lowercased and whitespace-collapsed exactly as
  -- transcriptStats counted it. '' only for advisory kinds that measure a
  -- RATIO rather than a fragment.
  fragment          text not null default '',
  -- The TeacherSheet field an accepted delta writes. '' means ADVISORY: the
  -- chip records a measurement and writes no field, ever. Only the two
  -- phrase-bank fields are writable — see api/_mirrorcall.js's header for why
  -- the prose register bullets are not.
  target_field      text not null default ''
                    check (target_field in ('','boardVerbalisms','exSlangRepeat')),
  -- { count, per1k, tokens } — counts and ratios, never prose.
  evidence          jsonb not null default '{}'::jsonb,
  -- The chip's CITATION, as the studio renders it: { turn_id, quote,
  -- occurrences }. A column rather than a key inside `evidence` because the UI
  -- contract (src/studio/mirrorCallApi.ts) refuses a chip without one at the
  -- door, and because the citation law on this platform's other derived tables
  -- (vy_fact, vy_pattern) is a column too. `quote` is the owner's own words,
  -- already PII-scrubbed at the window seam, and it is NEVER what gets written
  -- to a sheet — only `fragment` is.
  citation          jsonb not null default '{}'::jsonb,
  -- The window sequence numbers this delta was measured in. Never empty for a
  -- mined delta; the CHECK below is the citation law on this table.
  cited_windows     integer[] not null default '{}'::integer[],
  state             text not null default 'proposed'
                    check (state in ('proposed','deferred','accepted','rejected')),
  -- Set only when the sheet write actually landed. A delta can be 'accepted'
  -- and unapplied (the draft moved underneath the decision) and the studio must
  -- be able to tell those apart — "accepted" is the owner's act, "applied" is
  -- the platform's, and collapsing them is how a tap that did nothing looks
  -- like a tap that worked.
  applied_at        timestamptz,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vy_mirror_delta_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_cited;

-- The citation law. A delta with a writable target and no cited window is a
-- change to a real person's clone that cannot say what it heard.
alter table vy_mirror_delta add constraint vy_mirror_delta_cited
  check (target_field = '' or cardinality(cited_windows) >= 1);

alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_fragment_shape;

-- The recited-prompt guard, structural half. A writable delta carries a
-- fragment, and that fragment is not sentence-shaped.
alter table vy_mirror_delta add constraint vy_mirror_delta_fragment_shape
  check (target_field = ''
     or (fragment <> '' and fragment !~ '[.!?]' and length(fragment) <= 64));

alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_applied_gate;

-- APPLIED IMPLIES ACCEPTED. This is the negative control written as a
-- constraint: a row that touched the sheet without the owner's tap cannot
-- exist, whatever a future statement tries to do.
alter table vy_mirror_delta add constraint vy_mirror_delta_applied_gate
  check (applied_at is null or state = 'accepted');

alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_origin_evidence;

-- WS-Z A4. A MINED chip is a claim about behaviour and must carry the count it
-- was measured on; a JUDGEMENT chip is the owner asserting something and has no
-- occurrence count to carry. A mined chip with occurrences = 0 would be a
-- statistical claim with no statistic behind it.
alter table vy_mirror_delta add constraint vy_mirror_delta_origin_evidence
  check (origin <> 'mined' or (occurrences >= 1 and corpus_tokens >= 1));

alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_judgement_advisory;

-- A judgement never writes a sheet field. §4.4's sycophancy loop closes the
-- moment the owner's approval of their own clone can edit the clone directly;
-- judgement enters the sheet only by being SAID in a later window and mined
-- like everything else.
alter table vy_mirror_delta add constraint vy_mirror_delta_judgement_advisory
  check (origin <> 'judgement' or target_field = '');

-- One chip per habit per call. Re-mining the same fragment as the transcript
-- grows must refresh the evidence on the STILL-PROPOSED row, never spawn a
-- second chip and never resurrect a rejected one — which is what the
-- `on conflict ... where state = 'proposed'` clause in the store rests on.
create unique index if not exists vy_mirror_delta_habit_ix
  on vy_mirror_delta (session_id, kind, fragment);

create index if not exists vy_mirror_delta_open_ix
  on vy_mirror_delta (session_id, state, created_at);

create index if not exists vy_mirror_delta_owner_ix
  on vy_mirror_delta (owner_user_id, replica_id, created_at desc);

-- ── explicit owner feedback on a clone turn ──────────────────────────────
--
-- Bound to the turn it judged. `turn_ref` is the studio's own id for the clone
-- turn (a generation id or a caption-rail index) and is TEXT rather than uuid
-- on purpose: the call surface owns turn identity, this table only has to be
-- able to point at one, and a uuid column would force the studio to mint uuids
-- for rail positions it does not otherwise name.
create table if not exists vy_mirror_feedback (
  feedback_id       uuid primary key default gen_random_uuid(),
  session_id        uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  turn_ref          text not null check (turn_ref <> '' and length(turn_ref) <= 128),
  verdict           text not null check (verdict in ('up','down','rephrase')),
  -- The owner's own words for "I'd say it like this". Stored as EVIDENCE, and
  -- it is deliberately NOT a delta target: a whole sentence the owner typed is
  -- the single most recitable thing that could enter a prompt, and it enters
  -- the sheet only through the same three-word phrase-bank mine everything
  -- else does.
  rephrase_text     text not null default '' check (length(rephrase_text) <= 2000),
  created_at        timestamptz not null default now(),
  constraint vy_mirror_feedback_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

alter table vy_mirror_feedback drop constraint if exists vy_mirror_feedback_rephrase_present;

-- A 'rephrase' verdict without the rephrasing is a thumbs-down wearing a
-- different label, and would train nothing.
alter table vy_mirror_feedback add constraint vy_mirror_feedback_rephrase_present
  check (verdict <> 'rephrase' or rephrase_text <> '');

create unique index if not exists vy_mirror_feedback_turn_ix
  on vy_mirror_feedback (session_id, turn_ref);

create index if not exists vy_mirror_feedback_owner_ix
  on vy_mirror_feedback (owner_user_id, replica_id, created_at desc);

-- ── the fine-tune queue row ──────────────────────────────────────────────
--
-- One row per ended session at most, and only when the session actually
-- accumulated consented reference audio. A queue row for a call that admitted
-- zero windows would ask a GPU to fine-tune on nothing.
create table if not exists vy_mirror_finetune_job (
  job_id            uuid primary key default gen_random_uuid(),
  session_id        uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  -- 'queued' is the ONLY state this migration knows. Nothing in this repo
  -- leases, runs or completes one. See the header.
  state             text not null default 'queued' check (state in ('queued','cancelled')),
  -- ── WS-Z A6: one adapter per expert, never a sequence on a shared base ──
  -- "Sequential fine-tuning of a model for new speakers can lead to poor
  -- performance of older speakers … catastrophic forgetting", degrading a
  -- multi-speaker TTS into "a single-speaker TTS for the newly adapted
  -- speaker" (arXiv:2103.14512, read at search-summary tier). The remedy the
  -- literature names is adapter-based tuning, which is also `ROADMAP-100X.md`'s
  -- existing per-expert LoRA decision arrived at from a different direction.
  -- A one-value CHECK is how this queue refuses to describe any other lane: a
  -- shared-base sequential job cannot be enqueued because there is no value
  -- for it. Widening this enum is the moment that decision is being reversed,
  -- and it should be visible in a diff.
  lane              text not null default 'per_expert_adapter'
                    check (lane in ('per_expert_adapter')),
  reference_windows integer not null default 0 check (reference_windows >= 0),
  reference_ms      integer not null default 0 check (reference_ms >= 0),
  requested_at      timestamptz not null default now(),
  constraint vy_mirror_finetune_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);

create unique index if not exists vy_mirror_finetune_session_ix
  on vy_mirror_finetune_job (session_id);

create index if not exists vy_mirror_finetune_queue_ix
  on vy_mirror_finetune_job (state, requested_at) where state = 'queued';

create index if not exists vy_mirror_finetune_owner_ix
  on vy_mirror_finetune_job (owner_user_id, replica_id, requested_at desc);
