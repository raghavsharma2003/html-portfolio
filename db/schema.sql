-- Meera's database (Neon Postgres, reached over SQL-over-HTTP by api/_db.js).
--
-- Every one of these tables was created ad hoc from a throwaway script, which
-- meant the schema existed in exactly one place: the running database. Nothing
-- in the repo described it, so a fresh deploy could not rebuild it and nobody
-- reviewing a query could check it against anything. This file is that record,
-- transcribed from the live database rather than from memory, so it matches
-- what is actually running.
--
-- It is idempotent — safe to run against the live database or an empty one.
--
--   node -e "const {q}=await import('./api/_db.js'); ..."  (see scratchpad)
--
-- DEVICE ID IS THE IDENTITY. Every user-scoped table is keyed by device_id and
-- every statement that touches user data filters on it. That is what makes
-- "you can only ever delete your own rows" true by construction rather than by
-- remembering to check.

-- Her audit trail: what actually happened during a call, in order. Written
-- fail-soft (api/diag.js returns 200 even when the insert fails) because
-- diagnostics must never break the product — which is why it is worth probing
-- deliberately, since nothing else will ever report it broken.
create table if not exists meera_diag (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  session_id text,
  scope      text,
  event      text not null,
  t_ms       integer,
  detail     jsonb,
  at         timestamptz not null default now()
);
create index if not exists meera_diag_at on meera_diag (at desc);
create index if not exists meera_diag_event on meera_diag (event, at desc);
create index if not exists meera_diag_session on meera_diag (session_id, t_ms);

-- The permanent conversation log. `channel` separates call turns from chat
-- turns, which is what lets "forget this call" mean only the call.
create table if not exists meera_log (
  id        bigint generated always as identity primary key,
  device_id uuid not null,
  role      text not null,
  channel   text not null default 'chat',
  kind      text not null default 'text',
  content   text not null,
  at        timestamptz not null default now()
);
create index if not exists meera_log_device_at on meera_log (device_id, at desc);

-- Graph memory: what she knows about their world. `feel` holds THEIR OWN words
-- for how something felt, never her inference, so she can never tell someone
-- how they felt about something they never told her.
create table if not exists meera_nodes (
  id            bigint generated always as identity primary key,
  device_id     uuid not null,
  kind          text not null,
  name          text not null,
  summary       text not null default '',
  salience      real not null default 1.0,
  mentions      integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_recalled timestamptz,
  feel          text not null default ''
);
create index if not exists meera_nodes_device_name on meera_nodes (device_id, name);
create index if not exists meera_nodes_device_salience
  on meera_nodes (device_id, salience desc, updated_at desc);

create table if not exists meera_edges (
  id         bigint generated always as identity primary key,
  device_id  uuid not null,
  src        bigint not null,
  dst        bigint not null,
  relation   text not null,
  weight     real not null default 1.0,
  created_at timestamptz not null default now()
);
create index if not exists meera_edges_device on meera_edges (device_id, src, dst);

-- The one thing a forget does NOT delete: the word itself.
--
-- The extractor reads the last ~16 turns off the CLIENT, not off meera_log, so
-- a thing deleted last turn is still sitting in the transcript on their screen,
-- ready to be learned again on the next pass. Deleting rows and stopping there
-- buys exactly one turn of forgetting. This table is what makes it stick: the
-- extractor filters against it BEFORE the upsert, checking name AND summary,
-- because a term filtered out of the name walks back in through the summary.
--
-- It is not a tombstone. The memory row is genuinely gone — there is no
-- deleted_at anywhere in this schema, so there is nothing for recall to filter
-- and no way for a later change to get the filtering wrong. This table holds
-- the term and nothing else, is never read by recall, never enters a prompt,
-- and is itself deleted by a full wipe.
create table if not exists meera_forget (
  id        bigint generated always as identity primary key,
  device_id uuid not null,
  term      text not null,
  at        timestamptz not null default now()
);
create unique index if not exists meera_forget_device_term on meera_forget (device_id, lower(term));
create index if not exists meera_forget_device_at on meera_forget (device_id, at desc);

-- Synced app state, per signed-in account.
create table if not exists meera_state (
  user_id    uuid primary key,
  state      jsonb not null,
  device_id  uuid,
  updated_at timestamptz not null default now()
);

create table if not exists meera_events (
  id        bigint generated always as identity primary key,
  device_id uuid,
  user_id   uuid,
  event     text not null,
  props     jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index if not exists meera_events_at on meera_events (at desc);
create index if not exists meera_events_event_at on meera_events (event, at desc);

-- Her recognition index, rebuilt daily by .github/workflows/culture.yml. Not
-- user data — one row per day, shared by everyone.
create table if not exists meera_culture (
  day   date primary key,
  items jsonb not null default '[]'::jsonb,
  dated jsonb not null default '[]'::jsonb,
  meta  jsonb not null default '{}'::jsonb,
  at    timestamptz not null default now()
);

-- ── Supabase storage (a separate database; recorded here so the whole picture
--    lives in one file) ───────────────────────────────────────────────────────
--
-- Photos live in the `meera-photos` bucket under `${device}/${epochMs}-rand.jpg`.
-- The timestamp travels in the filename, which is what lets a windowed forget
-- honour its own window instead of falling back to all-or-nothing.
--
-- The bucket had anon policies for INSERT and SELECT but none for DELETE, so
-- every delete returned 200 with an empty array and removed nothing: forgetting
-- cleared the rows describing a photo and left the photo in storage. Applied as
-- migration meera_photos_anon_delete:
--
--   create policy meera_photos_anon_delete on storage.objects for delete
--     to anon using (bucket_id = 'meera-photos');
--
-- Scoped to this bucket. The anon key is held server-side by api/memory.js and
-- does not appear in the shipped client bundle (verified: it contains no JWT of
-- any kind), so this grants deletion to our proxy and not to users.

-- ── Session telemetry (docs/TELEMETRY.md is the contract) ───────────────────
--
-- Everything a session did, fine-grained enough to reconstruct it second by
-- second. Distinct from meera_diag, which is the call-path audit trail and
-- stays as it is: this table is the whole app run, and diag events feed the
-- same sink under `call.*`.
--
-- ORDER BY t_ms, NOT BY at. `at` is client wall clock and jumps — NTP steps,
-- timezone changes, a phone that slept for two hours. `t_ms` is a monotonic
-- offset from session start (performance.now), so it is the only field a
-- timeline can be reconstructed on. Both are stored; the index leads with
-- t_ms for exactly this reason.
--
-- `event` is deliberately unconstrained text. No enum, no check, no allowlist:
-- an unknown event must be stored, because the event nobody thought to
-- register is the one an incident turns out to be about.
--
-- device_id is text (not uuid) to match meera_diag: telemetry starts before
-- the device id is known to be well-formed, and a malformed id must still
-- produce a stored row rather than an error. It is still the delete key —
-- api/memory.js opForget purges this table on the same terms it purges
-- meera_log, which is what keeps `forget` from being a lie (rule 3). The one
-- content-bearing field is compose.draft's `text` in props, which exists
-- nowhere else; nothing else here copies what was said, it references
-- meera_log by msg_id in props instead (rule 2).
create table if not exists meera_tel (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  user_id    uuid,
  session_id text not null,
  seq        integer,
  area       text not null,
  event      text not null,
  t_ms       integer,
  props      jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
-- NOT named meera_tel_session, which is what docs/TELEMETRY.md specs and what
-- was measured to break: indexes and tables share one namespace in Postgres,
-- so the index claims the name first and the `create table if not exists
-- meera_tel_session` below then finds a relation of that name and SKIPS —
-- with a NOTICE, not an error. Verified against the live database on a throw-
-- away schema: after running the file as specced, meera_tel_session existed
-- only as an index and every rollup query failed at runtime, long after the
-- schema apply had reported success.
create index if not exists meera_tel_session_tms on meera_tel (session_id, t_ms);
create index if not exists meera_tel_device_at on meera_tel (device_id, at desc);
create index if not exists meera_tel_event_at on meera_tel (event, at desc);
create index if not exists meera_tel_area_at on meera_tel (area, at desc);

-- One row per app run, rolled up at ingest so `--list` never scans the event
-- table. `events` is incremented by the same statement that inserts the
-- events, so the two cannot disagree; started_at/ended_at use least/greatest
-- because batches arrive out of order (an offline drain lands after the live
-- traffic it preceded).
create table if not exists meera_tel_session (
  session_id  text primary key,
  device_id   text not null,
  user_id     uuid,
  surface     text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  events      integer not null default 0,
  platform    text,
  app_version text,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists meera_tel_session_device on meera_tel_session (device_id, started_at desc);

-- Web lookup cache, keyed by the normalised query.
create table if not exists meera_search_cache (
  k     text primary key,
  facts text not null,
  klass text not null default 'general',
  at    timestamptz not null default now()
);
create index if not exists meera_search_cache_at on meera_search_cache (at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Vyakti relational store (SPEC.md §2) — applied to the live database
-- 2026-08-13 as migrations 001–005, verified object-by-object via pg_class.
-- Per-migration files live in db/migrations/ (apply with
-- `node db/migrations/apply.mjs`; person backfill:
-- `node db/migrations/backfill_001_person.mjs`). The DDL below is the same
-- statements, kept here so this file remains the one honest record.
--
-- Rules this block encodes (SPEC §2.1):
--   - additive only; nothing existing dropped or reshaped
--   - person over device: vy_person maps devices to a person; new tables key
--     on person_id; person_id := device_id until a device is linked
--   - citations are a column with a CHECK — unwritable without them; lineage
--     (superseded_by) is a bare bigint, no FK, so forget deletes freely
--   - no deleted_at anywhere: forget is hard delete (api/memory.js §9.1
--     cascade); invalidation is belief change (t_invalid + superseded_by)
--   - every new index carries _ix (tables and indexes share one namespace —
--     the meera_tel_session incident above)
-- The user-data table manifest that forget's whole-wipe, api/export.js and
-- scripts/relcheck.mjs all iterate is PERSON_TABLES in api/memory.js — one
-- source of truth, asserted against this schema by relcheck.
--
-- NEON ARRAY TRAP (measured here 2026-08-13): the SQL-HTTP driver returns an
-- EMPTY Postgres array as [""] (one empty-string element). Anything reading
-- an array column through api/_db.js q() must normalize that shape (see
-- fixRow in api/export.js) or an empty citations array round-trips corrupt.
create extension if not exists pgcrypto;

create table if not exists vy_person (
  person_id  uuid primary key default gen_random_uuid(),
  age_tier   text not null default 'unverified'
             check (age_tier in ('unverified','adult_verified','minor')),
  created_at timestamptz not null default now()
);

create table if not exists vy_person_device (
  device_id uuid primary key,
  person_id uuid not null references vy_person(person_id) on delete cascade,
  linked_at timestamptz not null default now()
);

create index if not exists vy_person_device_person_ix
  on vy_person_device (person_id);

create table if not exists vy_episode (
  id              bigint generated always as identity primary key,
  person_id       uuid not null,
  device_id       uuid,                 -- provenance for legacy forget scopes
  channel         text not null default 'chat'
                  check (channel in ('chat','call','watch','voicenote')),
  participation   text not null default 'user'
                  check (participation in ('we','user','meera')),
                  -- WE/I typing: greenfield, ours (ZifaMem killed as precedent)
  started_at      timestamptz not null,
  ended_at        timestamptz,
  boundary_reason text not null default 'gap',
                  -- gap|channel|topic|affect|goal|session|backfill
  log_from        bigint,               -- meera_log id span: citation anchor
  log_to          bigint,               --   AND the forget-intersection key
  summary         text not null default '',   -- TELEGRAPHIC, shape-linted
  affect_tags     jsonb not null default '[]'::jsonb,
        -- [{tag,intensity,source:'text'|'voice_v0',extractor,confidence}]
        -- symbolic labels only; user-own-words entries carry
        -- extractor='user-own-words', confidence=1.0 (the only 1.0 source)
  boundary_salience real not null default 0.0, -- EST channel, ours, flagged
  importance      real not null default 1.0,   -- anchored comparison, never
                                               -- raw LLM self-rating
  tier            smallint not null default 0, -- 0 raw, 1 weekly, 2 era
  safety_hold     boolean not null default false, -- never decay-eligible
  provisional     boolean not null default false, -- in-turn tier (§4.1)
  superseded_by   bigint,               -- compaction chain (bare bigint)
  created_at      timestamptz not null default now(),
  last_recalled   timestamptz,
  recall_count    integer not null default 0
);

create index if not exists vy_episode_person_ix
  on vy_episode (person_id, started_at desc);

create index if not exists vy_episode_part_ix
  on vy_episode (person_id, participation, importance desc);

create index if not exists vy_episode_logspan_ix
  on vy_episode (person_id, log_from, log_to);

-- Watch lane: claims and reactions are SEPARATE OBJECTS (vision-fab law;
-- a later-corrected visual claim must not delete a genuine emotional beat).
create table if not exists vy_visual_assertion (
  id                 bigint generated always as identity primary key,
  episode_id         bigint not null references vy_episode(id) on delete cascade,
  person_id          uuid not null,
  claim              text not null,     -- telegraphic
  extractor_model    text not null,     -- REQUIRED (vision-fab)
  confidence         real not null,     -- REQUIRED
  declared_illegible boolean not null default false,
  created_at         timestamptz not null default now()
);

create table if not exists vy_shared_moment (
  id           bigint generated always as identity primary key,
  episode_id   bigint not null references vy_episode(id) on delete cascade,
  person_id    uuid not null,
  assertion_id bigint references vy_visual_assertion(id) on delete set null,
  reaction     text not null,   -- her in-the-moment reaction; survives
                                -- correction of the claim it reacted to
  at           timestamptz not null default now()
);

-- FACTS: bi-temporal-confined (§0.3), citation-mandatory, lineage un-FK'd.
create table if not exists vy_fact (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  kind          text not null check (kind in
                ('user','world','self_in_relation','relationship','india','meera')),
  name          text not null default '',
  body          text not null,          -- telegraphic note, never a line
  feel          text not null default '',  -- THEIR OWN words only (lifted law)
  provenance    text not null
                check (provenance in ('user_said','extracted','derived',
                                      'authored','legacy')),
  confidence    real not null default 0.8,
  citations     bigint[] not null default '{}',   -- vy_episode ids
  t_valid       timestamptz,            -- null = unknown/always
  t_invalid     timestamptz,            -- null = still believed
  superseded_by bigint,                 -- bare bigint, no FK (forget law)
  correction_surfaced boolean not null default false,   -- §10-Q3a
  sensitive     boolean not null default false,
  time_bound    boolean not null default false,  -- staleNote mechanism kept
  need_p        real not null default 1.0,       -- ACT-R retrieval priority
  provisional   boolean not null default false,  -- in-turn tier (§4.1)
  retracted_at  timestamptz,            -- integrity-sweep retraction only
  created_at    timestamptz not null default now(),
  -- THE CITATION LAW, as a constraint the DB refuses to violate:
  constraint vy_fact_cite_or_authored
    check (provenance in ('authored','legacy') or cardinality(citations) >= 1)
);

create index if not exists vy_fact_person_ix
  on vy_fact (person_id, kind, need_p desc)
  where t_invalid is null and retracted_at is null;

create index if not exists vy_fact_cit_ix on vy_fact using gin (citations);

-- meera_log gains one nullable additive column (§2.3): the back-pointer from
-- ground truth to the episode that covers it. Additive; nothing existing
-- changes shape.
alter table meera_log add column if not exists episode_id bigint;

create index if not exists meera_log_episode_ix
  on meera_log (episode_id) where episode_id is not null;


-- Every rel-state movement is a cited event; the snapshot is a cache
-- REBUILT BY REPLAY after any forget (fixes B's flagship hole, per D).
create table if not exists vy_rel_event (
  id         bigint generated always as identity primary key,
  person_id  uuid not null,
  dim        text not null,
             -- honorific|trust|rupture|repair|ritual|code_switch|pacing
  from_v     text,
  to_v       text not null,
  direction  text not null check (direction in ('advance','regress','reset','init')),
  note       text not null default '',   -- telegraphic why, never a line
  citations  bigint[] not null,
  at         timestamptz not null default now(),
  constraint vy_rel_event_cited check (cardinality(citations) >= 1)
);

create index if not exists vy_rel_event_person_ix on vy_rel_event (person_id, at desc);

create index if not exists vy_rel_event_cit_ix on vy_rel_event using gin (citations);

create table if not exists vy_rel_state (      -- materialized snapshot (cache)
  person_id     uuid primary key,
  honorific     text not null default 'tum'
                check (honorific in ('tu','tum','aap')),
  cs_ratio      real,
  cs_on_stress  text not null default 'unknown'
                check (cs_on_stress in ('retreat_l2','intensify_l1','unknown')),
  trust         real not null default 0.3,     -- ±0.05/day rate limit IN CODE
  rupture_open  boolean not null default false,
  repair_state  text not null default 'none'
                check (repair_state in ('none','open','repairing','repaired')),
  ritual_density real not null default 0,      -- derived, SQL only
  pacing_gap_s  integer,                       -- derived, SQL only
  snapshot_ver  integer not null default 0,    -- bumps ONLY at consolidation
  updated_at    timestamptz not null default now()
);

-- Dyadic if-then patterns (Baldwin). Promotion is a stored threshold,
-- never an LLM score (importance-inflation made unrepresentable).
create table if not exists vy_pattern (
  id               bigint generated always as identity primary key,
  person_id        uuid not null,
  moment           text not null,
        -- conflict|vulnerable|silence|teasing|stress|planning|celebration|boredom
  if_shape         text not null,   -- telegraphic, shape-linted
  then_note        text not null,   -- telegraphic guidance, never a line
  self_in_relation text not null default '',
        -- Bowlby IWM: who SHE is in this moment with THIS person — a COLUMN
        -- of the pattern, so it cannot exist without interaction evidence
  citations        bigint[] not null,
  support_count    integer not null default 0,
  distinct_days    integer not null default 0,
  prompt_eligible  boolean generated always as
                   (support_count >= 3 and distinct_days >= 2) stored,
  times_contradicted integer not null default 0,
  t_invalid        timestamptz,
  last_used        timestamptz,
  created_at       timestamptz not null default now(),
  constraint vy_pattern_needs_two check (cardinality(citations) >= 2)
             -- one instance is an anecdote (Generative-Agents failure)
);

create index if not exists vy_pattern_person_ix
  on vy_pattern (person_id, moment) where t_invalid is null;

create index if not exists vy_pattern_cit_ix on vy_pattern using gin (citations);

-- Shared-language ledger. THE one class where verbatim storage is the
-- point: it is THEIR line, not a line written for her (argued recited-
-- prompt exception, from D).
create table if not exists vy_phrase (
  id             bigint generated always as identity primary key,
  person_id      uuid not null,
  phrase         text not null,
  gloss          text not null default '',
  feel           text not null default '',   -- own words only
  origin_episode bigint,                     -- coining episode (edge, no FK)
  coined_at      timestamptz not null default now(),
  last_used      timestamptz,
  uses           integer not null default 1
);

create unique index if not exists vy_phrase_ix
  on vy_phrase (person_id, lower(phrase));

-- India tables ALL carry citations (fixes C's waived-law flaw).
create table if not exists vy_kin (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  name         text not null,
  relation     text not null,        -- chachi/mausi/bua role-labeled
  fictive      boolean not null default false,
  address_term text not null default '',
  citations    bigint[] not null,
  updated_at   timestamptz not null default now(),
  constraint vy_kin_cited check (cardinality(citations) >= 1)
);

create unique index if not exists vy_kin_ix on vy_kin (person_id, lower(name));

create index if not exists vy_kin_cit_ix on vy_kin using gin (citations);

create table if not exists vy_ritual (
  person_id  uuid not null,
  key        text not null,           -- khana_khaya|good_morning|match_checkin
  last_at    timestamptz,             -- freshness = data, not prompt pleading
  count      integer not null default 0,
  cold_last  boolean not null default false,  -- reception read, cited event
  citations  bigint[] not null default '{}',  -- establishing episodes
  primary key (person_id, key)
);

create table if not exists vy_currency (
  person_id uuid not null,
  topic     text not null,
  kind      text not null,            -- cricket|food|place|film|festival
  last_used timestamptz,              -- 14-day reuse exclusion (freshness)
  uses      integer not null default 0,
  citations bigint[] not null default '{}',
  primary key (person_id, topic)
);

create table if not exists vy_india_profile (
  person_id        uuid primary key,
  mother_tongue    text,
  home_region      text,
  religion         jsonb,             -- OPT-IN ONLY; DPDP-sensitive
  family_structure jsonb,
  dietary          text,
  sensitive_consent jsonb not null default '{}'::jsonb,  -- per-field receipts
  updated_at       timestamptz not null default now()
);

-- Embeddings: halfvec + person-filtered EXACT SCAN (§0.3). No HNSW.
create extension if not exists vector;

create table if not exists vy_embedding (
  owner_kind text not null check (owner_kind in ('episode','fact','pattern')),
  owner_id   bigint not null,
  person_id  uuid not null,
  v          halfvec(1536) not null,  -- text-embedding-3-small: deployed on
                                      -- Azure, unwired — this wires it and
                                      -- closes `semantic-recall`
  at         timestamptz not null default now(),
  primary key (owner_kind, owner_id)
);

create index if not exists vy_embedding_person_ix
  on vy_embedding (person_id, owner_kind);

-- Derivation audit (B): the FTC 6(b) record and the consolidation
-- bookkeeping are the same table.
create table if not exists vy_derivation (
  id           bigint generated always as identity primary key,
  person_id    uuid not null,
  model        text not null,
  prompt_hash  text not null,
  input_from   bigint not null,       -- meera_log id span the run may cite
  input_to     bigint not null,       -- episodes must map inside this window
  wrote        jsonb not null,        -- [{table,id}]
  audit_status text not null default 'unaudited'
               check (audit_status in ('unaudited','entailed','refuted')),
  at           timestamptz not null default now()
);


create table if not exists vy_model (
  model             text primary key,
  provider          text not null,
  billing           text not null check (billing in ('credits','cash','user')),
  card_risk         boolean not null default false,  -- credits-partner trap
  prefix_cache      boolean not null,                -- cache-9x as data
  residency         text not null default 'us',      -- DPDP anticipation
  max_tokens_mode   text not null,                   -- visible_only|total
  effort_map        jsonb not null default '{}'::jsonb,  -- measured inversion
  adapter           jsonb not null default '{}'::jsonb,
  adapter_derived_at timestamptz,
  gate              text not null default 'untested'
                    check (gate in ('untested','failed','passed'))
);

create table if not exists vy_gate_run (   -- append-only audit (FTC 6(b))
  id      bigint generated always as identity primary key,
  model   text not null,
  battery text not null,                   -- D0..D6 | adapter-derivation
  n       integer not null,
  result  jsonb not null,
  passed  boolean not null,
  at      timestamptz not null default now()
);

create table if not exists vy_session (    -- session clock substrate
  session_id     text primary key,
  person_id      uuid not null,
  started_at     timestamptz not null default now(),
  last_activity  timestamptz not null default now(),
  continuous_ms  bigint not null default 0,   -- resets on 30-min gaps
  disclosures    integer not null default 0,
  last_disclosure_at timestamptz
);
-- 006: vy_taste_candidate — the owner-review taste nomination queue.
--
-- WS-RELSTATE shipped this as a lazily-created table inside api/taste-queue.js
-- (it owned no migration file), which left two gaps this migration closes:
-- the DDL was unreviewed, and — the one that actually matters — a person's
-- PENDING TASTE CANDIDATES WERE NOT SWEPT BY FORGET, because forget's scope is
-- the PERSON_TABLES manifest and a lazily-created table is in no manifest.
-- A taste candidate quotes their patterns back at them; deletion that skips it
-- is deletion in name only. Folded into PERSON_TABLES in the same commit.
--
-- Idempotent, additive, mirrors the runtime DDL byte-for-byte in effect.
create table if not exists vy_taste_candidate (
  id            bigint generated always as identity primary key,
  person_id     uuid not null,
  take          text not null,
  keys          text[] not null default '{}',
  source        text not null check (source in ('pattern','fact')),
  source_id     bigint not null,
  citations     bigint[] not null,
  support_count integer not null default 0,
  span_days     real not null default 0,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint vy_taste_candidate_cited check (cardinality(citations) >= 1),
  constraint vy_taste_candidate_source_once unique (source, source_id)
);
create index if not exists vy_taste_candidate_status_ix
  on vy_taste_candidate (status, created_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 008a/008b/008c: multiparty v1 — the shared-memory companion.
--
-- Contract: docs/design/PROPOSAL-MULTIPARTY-V1.md §4 (accepted,
-- context/decisions.md `multiparty-v1-design`). Per-migration files live in
-- db/migrations/008{a,b,c}_*.sql; the DDL below is the same statements, kept
-- here so this file remains the one honest record.
--
-- STATUS: written and proven against the real engine in a fixture namespace
-- (evals/mp/gate0.mjs and evals/mp/withdraw.mjs build the wsmpb_test_*
-- namespace from these exact files and tear it down), NOT YET APPLIED to the
-- live database — the owner deploys migrations, not a workstream.
-- scripts/relcheck.mjs detects that and says which checks it skipped.
--
-- Rules this block encodes, beyond the ones the vy_ block above already lists:
--   - DISCLOSURE IS A RETRIEVAL PROPERTY. Every privacy rule in v1 is a WHERE
--     clause in api/_disclosure.js, never a sentence in a prompt: a model
--     asked to decline while holding the answer leaks at 9-90%
--     (context/measurements.md#disclosure-leak-rates), and a row that was
--     never retrieved cannot.
--   - THE ACL OF A DERIVED ROW IS THE PARTICIPANT SET OF THE EPISODES IT
--     CITES. Not a permissions table, not a flag anyone sets — a join, and
--     therefore unforgeable by a generated-text step.
--   - FORGET WITHDRAWS WHAT WE HOLD TOGETHER. Dropping a participant row
--     stops the content surfacing to that person on the next retrieval, with
--     no derived-row cascade; the closure hard-deletes only when the last
--     participant leaves (api/memory.js withdrawSharedRows).
--   - NO PERSON ROW, NO PERSISTENCE. An unlinked room member's messages are
--     never written anywhere, which enforces `adult-default` structurally
--     rather than by policy.
--   - meera_log.speaker_person_id is UNBACKFILLABLE and therefore lands
--     BEFORE any ingestion code: a room message written without it is
--     permanently unattributable and can never be row-level forgotten.

-- ── 008a: speaker attribution and participants ─────────────────────────────
alter table meera_log add column if not exists speaker_person_id uuid;
alter table meera_log add column if not exists group_id bigint;
create index if not exists meera_log_speaker_ix
  on meera_log (speaker_person_id, id);
create index if not exists meera_log_group_ix
  on meera_log (group_id, id) where group_id is not null;

-- person_id stays the primary/reporting owner for 1:1 episodes and is NULL for
-- room episodes: PERSON_TABLES' `key` selects the exclusive (1:1) rows, and a
-- room episode carrying one member's person_id would be hard-deleted out from
-- under its co-participants by that member's whole-wipe.
alter table vy_episode alter column person_id drop not null;
alter table vy_episode add column if not exists group_id bigint;
alter table vy_episode add column if not exists disclosure_scope text
  not null default 'participants'
  check (disclosure_scope in ('participants','participants_1to1','private'));
alter table vy_episode add column if not exists disclosure_deny uuid[]
  not null default '{}';
alter table vy_episode drop constraint if exists vy_episode_participation_check;
alter table vy_episode add constraint vy_episode_participation_check
  check (participation in ('we','user','meera','group'));

-- A JOIN TABLE, not an array column: the filter must be index-backed in both
-- directions (who was at this episode / which episodes was this person at),
-- `on delete cascade` is not expressible on a bare array, and participant
-- withdrawal is a row delete.
create table if not exists vy_episode_participant (
  episode_id bigint not null references vy_episode(id) on delete cascade,
  person_id  uuid   not null,
  role       text   not null default 'participant'
             check (role in ('participant','addressed','silent_present')),
  primary key (episode_id, person_id)
);
create index if not exists vy_episode_participant_person_ix
  on vy_episode_participant (person_id, episode_id);

-- backfill: every existing 1:1 episode gets exactly one participant row, and
-- is marked as a DM scope so it can never render into a room without a grant
insert into vy_episode_participant (episode_id, person_id)
  select id, person_id from vy_episode where person_id is not null
  on conflict do nothing;
update vy_episode set disclosure_scope = 'participants_1to1'
 where person_id is not null and group_id is null
   and disclosure_scope = 'participants';

-- ── 008b: rooms, grants, turn log, retrieval hints ─────────────────────────
create table if not exists vy_group (
  id             bigint generated always as identity primary key,
  name           text not null default '',
  kind           text not null default 'friend_group'
                 check (kind in ('couple','family','friend_group','other')),
  room_device_id uuid not null,          -- synthetic; keeps meera_log NOT NULL
  tg_chat_id     bigint,                 -- Telegram binding
  read_consent_at timestamptz,           -- admin promotion observed = read consent
  quiet_level    text not null default 'normal'
                 check (quiet_level in ('normal','quiet','silent')),
  member_cap     smallint not null default 6,
  created_at     timestamptz not null default now()
);
create unique index if not exists vy_group_tg_chat_ix
  on vy_group (tg_chat_id) where tg_chat_id is not null;

-- membership governs the LIVE CHANNEL, never history
create table if not exists vy_group_member (
  group_id    bigint not null references vy_group(id) on delete cascade,
  person_id   uuid   not null,
  tg_user_id  bigint,
  role        text   not null default '',
  quiet_level text   not null default 'normal'
              check (quiet_level in ('normal','quiet','silent')),
  linked_at   timestamptz,               -- null = seen but not onboarded
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,               -- null = currently active
  primary key (group_id, person_id)
);
create index if not exists vy_group_member_person_ix
  on vy_group_member (person_id) where left_at is null;

-- CPM made literal: permission is NEGOTIATED and CITED, never inferred at read
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

-- silence must be an EVENT, not an absence
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

-- retrieval hints and the room-isolation key (NEVER the security boundary —
-- membership changes, episode-time participation cannot)
alter table vy_fact   add column if not exists group_id bigint;
alter table vy_phrase add column if not exists group_id bigint;
alter table vy_fact   add column if not exists disclosure_deny uuid[]
  not null default '{}';
alter table vy_phrase add column if not exists disclosure_deny uuid[]
  not null default '{}';
create index if not exists vy_fact_group_ix
  on vy_fact (group_id, need_p desc)
  where group_id is not null and t_invalid is null and retracted_at is null;
create unique index if not exists vy_phrase_group_ix
  on vy_phrase (group_id, lower(phrase)) where group_id is not null;

-- ── 008c: Telegram identity and the paying unit ────────────────────────────
create table if not exists vy_tg_person (
  tg_user_id bigint primary key,
  person_id  uuid   not null,
  username   text   not null default '',
  linked_at  timestamptz not null default now()
);
create index if not exists vy_tg_person_person_ix on vy_tg_person (person_id);

-- gates ROOM ingestion and ROOM replies only, never anyone's 1:1 relationship
create table if not exists vy_group_entitlement (
  group_id      bigint not null references vy_group(id) on delete cascade,
  paid_by       uuid   not null,          -- a member, not the room
  provider      text   not null default 'tg_stars',
  charge_id     text   not null default '',
  period_start  timestamptz not null default now(),
  period_end    timestamptz not null,
  primary key (group_id, period_start)
);
create index if not exists vy_group_entitlement_active_ix
  on vy_group_entitlement (group_id, period_end desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 009: the agent layer — one relational OS, many AI people.
--
-- Contract: docs/SPEC-AGENT-LAYER.md §2 (what is agent-scoped), §4 (surface
-- identity), §6 (shape and safety). The migration file is
-- db/migrations/009_agents.sql; the DDL below is the same 117 statements,
-- kept here so this file remains the one honest record.
--
-- STATUS: APPLIED to the live database 2026-08-18 (117 statements, then a
-- second apply of the same file — 117/117 ok — to prove idempotency).
--
-- Rules this block encodes, beyond the ones the blocks above already list:
--   - PERSON IS SHARED, AGENT SCOPES THE RELATIONSHIP, SURFACE SCOPES
--     NOTHING. The relationship lives at (agent × person); vy_person,
--     vy_person_device and vy_surface_identity are person-intrinsic and carry
--     no agent_id, because identity resolution is agent-independent — the
--     same human, whoever they are talking to.
--   - AGENT ISOLATION IS STRUCTURAL (Law E1). What Meera learned about you is
--     unreachable to another agent by a WHERE clause, never by a prompt
--     instruction — everything behavioural measured 9-90% residual leakage
--     (context/measurements.md#disclosure-leak-rates).
--   - vy_kin and vy_india_profile are agent-scoped DESPITE looking
--     person-intrinsic. "My mausi is called Bua at home" was told to someone;
--     filing it person-global means agent two knows your dietary rules on
--     turn one having never asked.
--
-- THE FIXED CONSTANT — mirrored, not imported, and CI-asserted equal by
-- scripts/verify-agent-id.mjs (the OPERATIONAL_CORE_CAP pattern). If you
-- change it here you must change db/migrations/009_agents.sql and
-- src/engine/agents/registry.ts in the same commit:
--
--     MEERA_AGENT_ID = 'a0000000-0000-4000-8000-000000000001'
--
-- SPEC §6's illustrative string ('...-00000000meer') is not valid hex and
-- cannot be stored in a uuid column. This is the v4-shaped replacement.
--
-- TWO THINGS HERE ARE TEMPORARY AND BOTH DIE IN MIGRATION 010:
--   1. the agent_id column DEFAULT, which is what keeps every un-migrated
--      call site writing Meera's rows exactly as it does today (§6);
--   2. the *_person_compat_ix unique indexes on the OLD primary keys. A PK is
--      also the ON CONFLICT arbiter, and ten live upsert sites name the old
--      key explicitly (api/memory.js:535,:1503; api/consolidate.js:726,:820,
--      :1055,:1085; src/engine/relstate.ts:599; src/engine/india.ts:154,:199,
--      :341). Seven are .catch()-swallowed, so without the shim the failure is
--      not an error anyone sees — it is `relstate-zero-rows` a second time,
--      writers silently not writing. api/memory.js:1503 is NOT swallowed and
--      sits in the forget cascade, so it would break G-E5 outright.
--      Verified live after apply: all four old-key arbiters still resolve.
--      These indexes must NOT survive into a two-agent world — they forbid two
--      agents holding rel_state for the same person — which is why their
--      removal is tied to the same migration that migrates the call sites.

create table if not exists vy_agent (
  agent_id        uuid primary key,
  slug            text not null unique,
  display_name    text not null,
  persona_version text not null default '',   -- owned by the persona module
  register        jsonb not null default '{}'::jsonb,   -- §3 AgentModule.register
  status          text not null default 'active'
                  check (status in ('active','paused','retired')),
  created_at      timestamptz not null default now()
);
insert into vy_agent (agent_id, slug, display_name, register, status)
values (
  'a0000000-0000-4000-8000-000000000001',
  'meera',
  'Meera',
  '{"script":"latin","honorificSystem":"hi-TV"}'::jsonb,
  'active'
)
on conflict (agent_id) do nothing;

-- §4: NO agent_id, on purpose. The agent enters at retrieval, not at
-- identification. vy_tg_person stays in place and stays authoritative for the
-- code that still reads it; this backfill is additive and idempotent.
create table if not exists vy_surface_identity (
  surface         text not null,     -- 'telegram'|'discord'|'whatsapp'|'web'
  surface_user_id text not null,
  person_id       uuid not null,
  handle          text not null default '',
  linked_at       timestamptz not null default now(),
  primary key (surface, surface_user_id)
);
create index if not exists vy_surface_identity_person_ix
  on vy_surface_identity (person_id);
insert into vy_surface_identity (surface, surface_user_id, person_id, handle, linked_at)
  select 'telegram', tg_user_id::text, person_id, username, linked_at
    from vy_tg_person
  on conflict do nothing;

-- ── agent_id on every agent-scoped table (§2) ──────────────────────────────
--
-- Per table, in this order: add column / SET DEFAULT / backfill / SET NOT NULL
-- / index. §6 sketches the middle two the other way round; this order is the
-- race-free one. There are no transactions here, so with the §6 order a live
-- INSERT landing between the backfill and the default writes a fresh NULL and
-- the SET NOT NULL then fails against production traffic. With the default in
-- first, no new NULL can appear and the backfill is monotone.
--
-- Index names carry _ix rather than §6's `<t>_agent_person` sketch: tables and
-- indexes share one namespace (the meera_tel_session incident, line 189 above).
alter table vy_episode add column if not exists agent_id uuid;
alter table vy_episode alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_episode set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_episode alter column agent_id set not null;
create index if not exists vy_episode_agent_person_ix on vy_episode (agent_id, person_id);

alter table vy_fact add column if not exists agent_id uuid;
alter table vy_fact alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_fact set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_fact alter column agent_id set not null;
create index if not exists vy_fact_agent_person_ix on vy_fact (agent_id, person_id);

alter table vy_rel_state add column if not exists agent_id uuid;
alter table vy_rel_state alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_rel_state set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_rel_state alter column agent_id set not null;
create index if not exists vy_rel_state_agent_person_ix on vy_rel_state (agent_id, person_id);

alter table vy_rel_event add column if not exists agent_id uuid;
alter table vy_rel_event alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_rel_event set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_rel_event alter column agent_id set not null;
create index if not exists vy_rel_event_agent_person_ix on vy_rel_event (agent_id, person_id);

alter table vy_pattern add column if not exists agent_id uuid;
alter table vy_pattern alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_pattern set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_pattern alter column agent_id set not null;
create index if not exists vy_pattern_agent_person_ix on vy_pattern (agent_id, person_id);

alter table vy_phrase add column if not exists agent_id uuid;
alter table vy_phrase alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_phrase set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_phrase alter column agent_id set not null;
create index if not exists vy_phrase_agent_person_ix on vy_phrase (agent_id, person_id);

alter table vy_ritual add column if not exists agent_id uuid;
alter table vy_ritual alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_ritual set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_ritual alter column agent_id set not null;
create index if not exists vy_ritual_agent_person_ix on vy_ritual (agent_id, person_id);

alter table vy_currency add column if not exists agent_id uuid;
alter table vy_currency alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_currency set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_currency alter column agent_id set not null;
create index if not exists vy_currency_agent_person_ix on vy_currency (agent_id, person_id);

alter table vy_kin add column if not exists agent_id uuid;
alter table vy_kin alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_kin set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_kin alter column agent_id set not null;
create index if not exists vy_kin_agent_person_ix on vy_kin (agent_id, person_id);

alter table vy_india_profile add column if not exists agent_id uuid;
alter table vy_india_profile alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_india_profile set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_india_profile alter column agent_id set not null;
create index if not exists vy_india_profile_agent_person_ix on vy_india_profile (agent_id, person_id);

alter table vy_taste_candidate add column if not exists agent_id uuid;
alter table vy_taste_candidate alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_taste_candidate set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_taste_candidate alter column agent_id set not null;
create index if not exists vy_taste_candidate_agent_person_ix on vy_taste_candidate (agent_id, person_id);

alter table vy_shared_moment add column if not exists agent_id uuid;
alter table vy_shared_moment alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_shared_moment set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_shared_moment alter column agent_id set not null;
create index if not exists vy_shared_moment_agent_person_ix on vy_shared_moment (agent_id, person_id);

alter table vy_visual_assertion add column if not exists agent_id uuid;
alter table vy_visual_assertion alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_visual_assertion set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_visual_assertion alter column agent_id set not null;
create index if not exists vy_visual_assertion_agent_person_ix on vy_visual_assertion (agent_id, person_id);

alter table vy_embedding add column if not exists agent_id uuid;
alter table vy_embedding alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_embedding set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_embedding alter column agent_id set not null;
create index if not exists vy_embedding_agent_person_ix on vy_embedding (agent_id, person_id);

alter table vy_derivation add column if not exists agent_id uuid;
alter table vy_derivation alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_derivation set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_derivation alter column agent_id set not null;
create index if not exists vy_derivation_agent_person_ix on vy_derivation (agent_id, person_id);

alter table vy_session add column if not exists agent_id uuid;
alter table vy_session alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_session set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_session alter column agent_id set not null;
create index if not exists vy_session_agent_person_ix on vy_session (agent_id, person_id);

alter table vy_group_member add column if not exists agent_id uuid;
alter table vy_group_member alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group_member set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group_member alter column agent_id set not null;
create index if not exists vy_group_member_agent_person_ix on vy_group_member (agent_id, person_id);

-- The last three agent-scoped tables carry no person_id column, so their index
-- pairs agent_id with the column the table is actually read by.
alter table vy_group add column if not exists agent_id uuid;
alter table vy_group alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group alter column agent_id set not null;
create index if not exists vy_group_agent_ix on vy_group (agent_id, id);

alter table vy_group_turn add column if not exists agent_id uuid;
alter table vy_group_turn alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_group_turn set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_group_turn alter column agent_id set not null;
create index if not exists vy_group_turn_agent_ix on vy_group_turn (agent_id, group_id);

alter table vy_disclosure_grant add column if not exists agent_id uuid;
alter table vy_disclosure_grant alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update vy_disclosure_grant set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table vy_disclosure_grant alter column agent_id set not null;
create index if not exists vy_disclosure_grant_agent_ix on vy_disclosure_grant (agent_id, granted_to);

-- ── composite primary keys (§6) ────────────────────────────────────────────
--
-- The one non-additive act in 009, safe ONLY because these four tables hold
-- zero rows — MEASURED immediately before apply (2026-08-18: 0/0/0/0), not
-- assumed, and re-measured after (still 0/0/0/0, nothing lost). Against a
-- database where any is non-zero this must become a copy-through-temp.
--
-- drop-then-add is the idempotent pair (the shape 008a uses for its check
-- constraint): re-running drops the constraint it just added and adds it back.
-- Each pair is followed by the compat unique index on the OLD key — see the
-- section header for why, and for the migration-010 removal it is tied to.
alter table vy_rel_state drop constraint if exists vy_rel_state_pkey;
alter table vy_rel_state add constraint vy_rel_state_pkey primary key (agent_id, person_id);
create unique index if not exists vy_rel_state_person_compat_ix on vy_rel_state (person_id);

alter table vy_ritual drop constraint if exists vy_ritual_pkey;
alter table vy_ritual add constraint vy_ritual_pkey primary key (agent_id, person_id, key);
create unique index if not exists vy_ritual_person_compat_ix on vy_ritual (person_id, key);

alter table vy_currency drop constraint if exists vy_currency_pkey;
alter table vy_currency add constraint vy_currency_pkey primary key (agent_id, person_id, topic);
create unique index if not exists vy_currency_person_compat_ix on vy_currency (person_id, topic);

alter table vy_india_profile drop constraint if exists vy_india_profile_pkey;
alter table vy_india_profile add constraint vy_india_profile_pkey primary key (agent_id, person_id);
create unique index if not exists vy_india_profile_person_compat_ix on vy_india_profile (person_id);

-- Migration 018 -- hard agent ownership for the raw RelationalOS substrate.
-- Existing rows belong to Meera. Defaults preserve rolling-deploy compatibility
-- for historical utilities; production writers name agent_id explicitly.

alter table meera_log add column if not exists agent_id uuid;
alter table meera_log alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_log set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_log alter column agent_id set not null;
create index if not exists meera_log_agent_device_ix on meera_log (agent_id, device_id, id);
create index if not exists meera_log_agent_pending_ix on meera_log (agent_id, device_id, id) where episode_id is null;

alter table meera_nodes add column if not exists agent_id uuid;
alter table meera_nodes alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_nodes set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_nodes alter column agent_id set not null;
create index if not exists meera_nodes_agent_device_name_ix on meera_nodes (agent_id, device_id, name);
create index if not exists meera_nodes_agent_device_salience_ix on meera_nodes (agent_id, device_id, salience desc, updated_at desc);

alter table meera_edges add column if not exists agent_id uuid;
alter table meera_edges alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_edges set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_edges alter column agent_id set not null;
create index if not exists meera_edges_agent_device_ix on meera_edges (agent_id, device_id, src, dst);

alter table meera_forget add column if not exists agent_id uuid;
alter table meera_forget alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_forget set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_forget alter column agent_id set not null;
drop index if exists meera_forget_device_term;
create unique index if not exists meera_forget_agent_device_term_ix on meera_forget (agent_id, device_id, lower(term));
create index if not exists meera_forget_agent_device_at_ix on meera_forget (agent_id, device_id, at desc);

create table if not exists meera_consolidate_lease (
  agent_id  uuid not null default 'a0000000-0000-4000-8000-000000000001'::uuid,
  person_id uuid not null,
  leased_at timestamptz not null default now(),
  leased_by text not null default '',
  run_id    text,
  primary key (agent_id, person_id)
);
alter table meera_consolidate_lease add column if not exists agent_id uuid;
alter table meera_consolidate_lease alter column agent_id set default 'a0000000-0000-4000-8000-000000000001'::uuid;
update meera_consolidate_lease set agent_id = 'a0000000-0000-4000-8000-000000000001'::uuid where agent_id is null;
alter table meera_consolidate_lease alter column agent_id set not null;
alter table meera_consolidate_lease drop constraint if exists meera_consolidate_lease_pkey;
alter table meera_consolidate_lease add constraint meera_consolidate_lease_pkey primary key (agent_id, person_id);
create index if not exists meera_consolidate_lease_expiry_ix on meera_consolidate_lease (leased_at);

-- Migration 033 - provider-specific voice-talent consent evidence.
alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','upload','import','derived'));

create table if not exists vy_replica_provider_consent (
  provider_consent_id uuid primary key,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  provider            text not null check (provider = 'azure_personal_voice'),
  policy_version      text not null,
  provider_policy_version text not null,
  template_version    text not null,
  locale              text not null check (locale = 'en-US'),
  statement_sha256    text not null check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  state               text not null default 'issued'
                      check (state in ('issued','uploaded','accepted','revoked','expired','failed')),
  source_id           uuid,
  attempt             integer not null check (attempt between 1 and 5),
  algorithm           text not null check (algorithm = 'AES-256-GCM'),
  key_id              text not null,
  nonce               bytea not null,
  ciphertext          bytea not null,
  auth_tag             bytea not null,
  wrapped_dek         bytea not null,
  wrap_nonce          bytea not null,
  wrap_auth_tag       bytea not null,
  aad_sha256          text not null check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  failure_code        text not null default '',
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,
  uploaded_at         timestamptz,
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  updated_at          timestamptz not null default now(),
  constraint vy_replica_provider_consent_crypto_shape check (
    octet_length(nonce) = 12 and octet_length(auth_tag) = 16 and octet_length(ciphertext) > 0
    and octet_length(wrapped_dek) = 32 and octet_length(wrap_nonce) = 12
    and octet_length(wrap_auth_tag) = 16
  ),
  constraint vy_replica_provider_consent_owner_identity
    unique (provider_consent_id, replica_id, owner_user_id),
  constraint vy_replica_provider_consent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_provider_consent_source_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete restrict
);

create index if not exists vy_replica_provider_consent_owner_ix
  on vy_replica_provider_consent (owner_user_id, replica_id, issued_at desc);

create unique index if not exists vy_replica_provider_consent_live_ix
  on vy_replica_provider_consent (replica_id, provider)
  where state in ('issued','uploaded');

-- Migration 034 - tenant-bound, commitment-bound provider voice enrollment.
alter table vy_replica_voice_profile add column if not exists owner_user_id uuid;
update vy_replica_voice_profile vp set owner_user_id = r.owner_user_id
  from vy_replica r where r.replica_id = vp.replica_id and vp.owner_user_id is null;
alter table vy_replica_voice_profile alter column owner_user_id set not null;
alter table vy_replica_voice_profile add column if not exists provider_consent_id uuid;
alter table vy_replica_voice_profile add column if not exists enrollment_commitment text not null default '';

do $replica_voice_profile_owner_fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'vy_replica_voice_profile_owner_fk'
    and conrelid = 'vy_replica_voice_profile'::regclass) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_owner_fk
      foreign key (replica_id, owner_user_id)
      references vy_replica(replica_id, owner_user_id) on delete cascade;
  end if;
end;
$replica_voice_profile_owner_fk$;

do $replica_voice_profile_genome_fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'vy_replica_voice_profile_genome_fk'
    and conrelid = 'vy_replica_voice_profile'::regclass) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_genome_fk
      foreign key (replica_id, genome_version)
      references vy_replica_voice_genome(replica_id, version) on delete restrict;
  end if;
end;
$replica_voice_profile_genome_fk$;

do $replica_voice_profile_consent_fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'vy_replica_voice_profile_consent_fk'
    and conrelid = 'vy_replica_voice_profile'::regclass) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_consent_fk
      foreign key (provider_consent_id, replica_id, owner_user_id)
      references vy_replica_provider_consent(provider_consent_id, replica_id, owner_user_id)
      on delete restrict;
  end if;
end;
$replica_voice_profile_consent_fk$;

do $replica_voice_profile_commitment_check$
begin
  if not exists (select 1 from pg_constraint where conname = 'vy_replica_voice_profile_commitment_check'
    and conrelid = 'vy_replica_voice_profile'::regclass) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_commitment_check
      check (enrollment_commitment = '' or enrollment_commitment ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_voice_profile_commitment_check$;

create unique index if not exists vy_replica_voice_profile_owner_tuple_ix
  on vy_replica_voice_profile (voice_profile_id, replica_id, owner_user_id);
create unique index if not exists vy_replica_voice_enrollment_commitment_ix
  on vy_replica_voice_profile (replica_id, provider, enrollment_commitment)
  where enrollment_commitment <> '';
create unique index if not exists vy_replica_voice_one_live_ix
  on vy_replica_voice_profile (replica_id, genome_version, provider)
  where status in ('creating','ready');

-- Migration 035 - crash-safe, retryable provider voice erasure.
alter table vy_replica_voice_profile
  add column if not exists erasure_attempts integer not null default 0;
alter table vy_replica_voice_profile
  add column if not exists erasure_next_attempt_at timestamptz not null default now();
alter table vy_replica_voice_profile
  add column if not exists erasure_lease_token_hash text not null default '';
alter table vy_replica_voice_profile
  add column if not exists erasure_leased_at timestamptz;
alter table vy_replica_voice_profile
  add column if not exists erasure_lease_expires_at timestamptz;
alter table vy_replica_voice_profile
  add column if not exists erasure_last_error_code text not null default '';

do $replica_voice_erasure_attempts_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_erasure_attempts_check'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_erasure_attempts_check
      check (erasure_attempts >= 0);
  end if;
end;
$replica_voice_erasure_attempts_check$;

do $replica_voice_erasure_lease_hash_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_erasure_lease_hash_check'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_erasure_lease_hash_check
      check (erasure_lease_token_hash = '' or erasure_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_voice_erasure_lease_hash_check$;

create index if not exists vy_replica_voice_erasure_ready_ix
  on vy_replica_voice_profile (erasure_next_attempt_at, updated_at)
  where status = 'deleting';

create table if not exists vy_replica_voice_erasure_attempt (
  voice_profile_id uuid not null,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  attempt          integer not null check (attempt > 0),
  outcome          text not null check (outcome in ('running','retry','complete')),
  failure_code     text not null default '',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  primary key (voice_profile_id, attempt),
  constraint vy_replica_voice_erasure_attempt_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_voice_erasure_attempt_owner_ix
  on vy_replica_voice_erasure_attempt (owner_user_id, replica_id, started_at desc);

-- Migration 036 - crash-safe raw and derived source erasure.
alter table vy_replica_source
  add column if not exists erasure_attempts integer not null default 0;
alter table vy_replica_source
  add column if not exists erasure_next_attempt_at timestamptz not null default now();
alter table vy_replica_source
  add column if not exists erasure_lease_token_hash text not null default '';
alter table vy_replica_source
  add column if not exists erasure_leased_at timestamptz;
alter table vy_replica_source
  add column if not exists erasure_lease_expires_at timestamptz;
alter table vy_replica_source
  add column if not exists erasure_last_error_code text not null default '';

do $replica_source_erasure_constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_source_erasure_attempts_check'
      and conrelid='vy_replica_source'::regclass
  ) then
    alter table vy_replica_source add constraint vy_replica_source_erasure_attempts_check
      check (erasure_attempts >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_source_erasure_lease_hash_check'
      and conrelid='vy_replica_source'::regclass
  ) then
    alter table vy_replica_source add constraint vy_replica_source_erasure_lease_hash_check
      check (erasure_lease_token_hash='' or erasure_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_source_erasure_constraints$;

create index if not exists vy_replica_source_erasure_ready_ix
  on vy_replica_source (erasure_next_attempt_at,updated_at)
  where state='deleting';

create table if not exists vy_replica_source_erasure_attempt (
  source_id       uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  attempt         integer not null check (attempt > 0),
  object_count    integer not null check (object_count > 0),
  outcome         text not null check (outcome in ('running','retry','complete')),
  failure_code    text not null default '',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  primary key (source_id,attempt),
  constraint vy_replica_source_erasure_attempt_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_source_erasure_attempt_owner_ix
  on vy_replica_source_erasure_attempt (owner_user_id,replica_id,started_at desc);

-- Migration 037 - crash-safe full replica purge and unlinkable receipt.
alter table vy_replica_erasure_job
  add column if not exists next_attempt_at timestamptz not null default now();
alter table vy_replica_erasure_job
  add column if not exists lease_token_hash text not null default '';
alter table vy_replica_erasure_job
  add column if not exists leased_at timestamptz;
alter table vy_replica_erasure_job
  add column if not exists lease_expires_at timestamptz;

do $replica_full_erasure_lease_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_full_erasure_lease_hash_check'
      and conrelid='vy_replica_erasure_job'::regclass
  ) then
    alter table vy_replica_erasure_job add constraint vy_replica_full_erasure_lease_hash_check
      check (lease_token_hash='' or lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_full_erasure_lease_check$;

drop index if exists vy_replica_erasure_pending_ix;
create index if not exists vy_replica_erasure_pending_ix
  on vy_replica_erasure_job (next_attempt_at,requested_at)
  where state in ('pending','running','blocked');

create table if not exists vy_replica_erasure_attempt (
  job_id        uuid not null references vy_replica_erasure_job(job_id) on delete cascade,
  attempt       integer not null check (attempt > 0),
  outcome       text not null check (outcome in ('running','retry','complete')),
  failure_code  text not null default '',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  primary key (job_id,attempt)
);

alter table vy_replica_deletion_receipt
  add column if not exists receipt_version text not null default 'replica-erasure-receipt/v1';
alter table vy_replica_deletion_receipt
  add column if not exists receipt_nonce text not null default '';

do $replica_deletion_receipt_nonce_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_deletion_receipt_nonce_check'
      and conrelid='vy_replica_deletion_receipt'::regclass
  ) then
    alter table vy_replica_deletion_receipt add constraint vy_replica_deletion_receipt_nonce_check
      check (receipt_nonce='' or receipt_nonce ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_deletion_receipt_nonce_check$;

create unique index if not exists vy_replica_deletion_receipt_replica_hash_ix
  on vy_replica_deletion_receipt (replica_id_hash);

-- Migration 038 - capability-based owner erasure status after unlinking.
alter table vy_replica_deletion_receipt
  add column if not exists erasure_request_hash text not null default '';

do $replica_deletion_request_hash_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_deletion_request_hash_check'
      and conrelid='vy_replica_deletion_receipt'::regclass
  ) then
    alter table vy_replica_deletion_receipt add constraint vy_replica_deletion_request_hash_check
      check (erasure_request_hash='' or erasure_request_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_deletion_request_hash_check$;

create unique index if not exists vy_replica_deletion_request_hash_ix
  on vy_replica_deletion_receipt (erasure_request_hash)
  where erasure_request_hash<>'';

-- Migration 039 - crash-safe, content-free liveness verification ledger.
alter table vy_replica_liveness_challenge add column if not exists verification_attempt integer not null default 0;
alter table vy_replica_liveness_challenge add column if not exists verification_next_attempt_at timestamptz not null default now();
alter table vy_replica_liveness_challenge add column if not exists verification_lease_token_hash text not null default '';
alter table vy_replica_liveness_challenge add column if not exists verification_leased_at timestamptz;
alter table vy_replica_liveness_challenge add column if not exists verification_lease_expires_at timestamptz;

do $replica_liveness_verification_checks$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_liveness_verification_attempt_check'
    and conrelid='vy_replica_liveness_challenge'::regclass) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_verification_attempt_check
      check (verification_attempt >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_liveness_verification_lease_check'
    and conrelid='vy_replica_liveness_challenge'::regclass) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_verification_lease_check
      check (verification_lease_token_hash='' or verification_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_liveness_verification_checks$;

create unique index if not exists vy_replica_liveness_owner_tuple_ix
  on vy_replica_liveness_challenge (challenge_id,replica_id,owner_user_id);
create index if not exists vy_replica_liveness_verification_ready_ix
  on vy_replica_liveness_challenge (verification_next_attempt_at,updated_at)
  where state in ('uploaded','verifying');

create table if not exists vy_replica_liveness_verification_attempt (
  challenge_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  attempt integer not null check (attempt > 0),
  verifier text not null,
  verifier_version text not null,
  outcome text not null check (outcome in ('running','retry','passed','failed')),
  failure_code text not null default '',
  result jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (challenge_id,attempt),
  constraint vy_replica_liveness_attempt_owner_fk foreign key (challenge_id,replica_id,owner_user_id)
    references vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_liveness_attempt_result_check check (jsonb_typeof(result)='object')
);
create index if not exists vy_replica_liveness_attempt_owner_ix
  on vy_replica_liveness_verification_attempt (owner_user_id,replica_id,started_at desc);

-- Migration 040: consented identity evidence and liveness binding.
alter table vy_replica add column if not exists identity_expires_at timestamptz;
alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','identity_document','upload','import','derived'));
create table if not exists vy_replica_identity_case (
  identity_case_id uuid primary key default gen_random_uuid(),
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_id uuid,
  policy_version text not null,
  consent_receipt_hash text not null check (consent_receipt_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'submitted'
    check (state in ('submitted','verifying','evidence_ready','verified','expired','failed','revoked')),
  attempt integer not null default 0 check (attempt >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token_hash text not null default '' check (lease_token_hash='' or lease_token_hash ~ '^[0-9a-f]{64}$'),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  verifier text not null default '',
  verifier_version text not null default '',
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  adult_evidence boolean not null default false,
  document_authentic boolean not null default false,
  document_current boolean not null default false,
  face_reference_ready boolean not null default false,
  credential_expires_at timestamptz,
  evidence_digest text not null default '' check (evidence_digest='' or evidence_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  failure_code text not null default '',
  consented_at timestamptz not null,
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_case_id,replica_id,owner_user_id),
  foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete restrict
);
create index if not exists vy_replica_identity_case_owner_ix
  on vy_replica_identity_case (owner_user_id,replica_id,created_at desc);
create unique index if not exists vy_replica_identity_case_live_ix
  on vy_replica_identity_case (replica_id) where state in ('submitted','verifying','evidence_ready','verified');
create index if not exists vy_replica_identity_case_ready_ix
  on vy_replica_identity_case (next_attempt_at,updated_at) where state in ('submitted','verifying');

create table if not exists vy_replica_identity_verification_attempt (
  identity_case_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  attempt integer not null check (attempt > 0),
  verifier text not null,
  verifier_version text not null,
  outcome text not null check (outcome in ('running','retry','evidence_ready','failed')),
  failure_code text not null default '',
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (identity_case_id,attempt),
  foreign key (identity_case_id,replica_id,owner_user_id)
    references vy_replica_identity_case(identity_case_id,replica_id,owner_user_id) on delete cascade
);
create index if not exists vy_replica_identity_attempt_owner_ix
  on vy_replica_identity_verification_attempt (owner_user_id,replica_id,started_at desc);

alter table vy_replica_liveness_challenge add column if not exists identity_case_id uuid;
do $replica_liveness_identity_fk$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_liveness_identity_case_fk'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_identity_case_fk
      foreign key (identity_case_id,replica_id,owner_user_id)
      references vy_replica_identity_case(identity_case_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_liveness_identity_fk$;

-- Migration 041 - purpose-limited biometric verification consent and official
-- Azure Face liveness-with-verify session lifecycle. Provider session handles
-- are AES-GCM sealed by the broker; one-time quick links are never durably persisted.

create table if not exists vy_replica_biometric_verification_grant (
  grant_id          uuid primary key default gen_random_uuid(),
  challenge_id      uuid not null,
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  statement_set      text not null,
  receipt_hash       text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  receipt_payload    jsonb not null check (jsonb_typeof(receipt_payload)='object'),
  state              text not null default 'active'
                     check (state in ('active','consumed','revoked','expired')),
  granted_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  constraint vy_replica_biometric_grant_challenge_unique unique (challenge_id),
  constraint vy_replica_biometric_grant_owner_fk
    foreign key (challenge_id,replica_id,owner_user_id)
    references vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_biometric_grant_time_check check (expires_at>granted_at)
);

alter table vy_replica_biometric_verification_grant
  add column if not exists receipt_payload jsonb not null default '{}'::jsonb;
update vy_replica_biometric_verification_grant
   set state='revoked',revoked_at=coalesce(revoked_at,now())
 where receipt_payload='{}'::jsonb and state='active';
alter table vy_replica_biometric_verification_grant
  alter column receipt_payload drop default;

create index if not exists vy_replica_biometric_grant_active_ix
  on vy_replica_biometric_verification_grant (owner_user_id,replica_id,expires_at)
  where state='active';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_state text not null default 'not_started';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_attempt integer not null default 0;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_handle text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_handle_hash text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_reference_sha256 text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_model_version text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_result jsonb not null default '{}'::jsonb;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_expires_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_issued_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_terminal_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_provider_deleted_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_lease_token_hash text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists face_session_leased_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists face_session_lease_expires_at timestamptz;

do $replica_face_session_checks$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_biometric_grant_receipt_payload_check'
      and conrelid='vy_replica_biometric_verification_grant'::regclass
  ) then
    alter table vy_replica_biometric_verification_grant
      add constraint vy_replica_biometric_grant_receipt_payload_check
      check (jsonb_typeof(receipt_payload)='object' and (receipt_payload<>'{}'::jsonb or state='revoked'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_state_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_state_check
      check (face_session_state in (
        'not_started','issuing','ready','polling',
        'passed_deleting','failed_deleting','expired_deleting',
        'passed_deleted','failed_deleted','expired_deleted'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_attempt_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_attempt_check
      check (face_session_attempt>=0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_hash_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_hash_check
      check (
        (face_session_handle_hash='' or face_session_handle_hash ~ '^[0-9a-f]{64}$') and
        (face_session_reference_sha256='' or face_session_reference_sha256 ~ '^[0-9a-f]{64}$') and
        (face_session_lease_token_hash='' or face_session_lease_token_hash ~ '^[0-9a-f]{64}$')
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_result_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_result_check
      check (jsonb_typeof(face_session_result)='object');
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_face_session_handle_lifecycle_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_face_session_handle_lifecycle_check
      check (
        (face_session_state in ('not_started','issuing') and face_session_handle='') or
        (face_session_state in ('ready','polling','passed_deleting','failed_deleting','expired_deleting')
          and face_session_handle<>'' and face_session_handle_hash~'^[0-9a-f]{64}$'
          and face_session_reference_sha256~'^[0-9a-f]{64}$' and face_session_model_version<>''
          and face_session_expires_at is not null and face_session_provider_deleted_at is null) or
        (face_session_state in ('passed_deleted','failed_deleted','expired_deleted')
          and face_session_handle='' and face_session_provider_deleted_at is not null)
      );
  end if;
end;
$replica_face_session_checks$;

create index if not exists vy_replica_face_session_cleanup_ix
  on vy_replica_liveness_challenge (face_session_lease_expires_at,updated_at)
  where face_session_state in (
    'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
  );

create index if not exists vy_replica_liveness_identity_case_ix
  on vy_replica_liveness_challenge (identity_case_id) where identity_case_id is not null;

-- Migration 042 - crash-recoverable VoiceGenome build leases.
alter table vy_replica_model_build
  add column if not exists lease_token_hash text not null default '';
alter table vy_replica_model_build
  add column if not exists leased_at timestamptz;
alter table vy_replica_model_build
  add column if not exists lease_expires_at timestamptz;
alter table vy_replica_model_build
  add column if not exists built_at timestamptz;

update vy_replica_model_build
   set state = 'retry', failure_code = 'migration_recovered_unleased_build',
       next_attempt_at = now(), updated_at = now()
 where state in ('leased','building') and lease_expires_at is null;

do $replica_model_build_lease_shape$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_model_build_lease_shape'
       and conrelid = 'vy_replica_model_build'::regclass
  ) then
    alter table vy_replica_model_build
      add constraint vy_replica_model_build_lease_shape check (
        (lease_token_hash = '' and leased_at is null and lease_expires_at is null)
        or
        (lease_token_hash ~ '^[0-9a-f]{64}$' and leased_at is not null and lease_expires_at > leased_at)
      );
  end if;
end;
$replica_model_build_lease_shape$;

create index if not exists vy_replica_model_build_lease_ix
  on vy_replica_model_build (lease_expires_at)
  where state in ('leased','building');

-- Migration 043 - content-free external C2PA sidecars.
create table if not exists vy_replica_c2pa_manifest (
  generation_id    uuid primary key,
  standard         text not null check (standard = 'c2pa-2.4'),
  manifest_sha256  text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_bytes   bytea not null,
  signer_key_id    text not null,
  created_at       timestamptz not null default now(),
  constraint vy_replica_c2pa_manifest_size check (
    octet_length(manifest_bytes) between 64 and 1048576
  )
);
create index if not exists vy_replica_c2pa_manifest_created_ix
  on vy_replica_c2pa_manifest (created_at desc);

create table if not exists vy_replica_generation_receipt_envelope (
  generation_id      uuid primary key,
  envelope_sha256    text not null check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_canonical bytea not null,
  created_at         timestamptz not null default now(),
  constraint vy_replica_receipt_envelope_size check (
    octet_length(envelope_canonical) between 128 and 16384
  )
);
create index if not exists vy_replica_receipt_envelope_created_ix
  on vy_replica_generation_receipt_envelope (created_at desc);

-- Migration 044 - append-only owner selection of private voice candidates.
create unique index if not exists vy_replica_artifact_owner_short_tuple_ix
  on vy_replica_processing_artifact (artifact_id,replica_id,owner_user_id);
create table if not exists vy_replica_processing_artifact_decision (
  decision_id       bigint generated always as identity primary key,
  artifact_id       uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  decision          text not null check (decision in ('selected','rejected','superseded')),
  reason_code       text not null check (reason_code in (
                      'owner_voice_match','wrong_speaker','identity_changed','noisy_or_distorted','better_candidate'
                    )),
  reviewer_user_id  uuid not null,
  created_at        timestamptz not null default now(),
  constraint vy_replica_artifact_decision_owner_check check (reviewer_user_id=owner_user_id),
  constraint vy_replica_artifact_decision_artifact_owner_fk
    foreign key (artifact_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete cascade
);
create index if not exists vy_replica_artifact_decision_latest_ix
  on vy_replica_processing_artifact_decision (artifact_id,created_at desc,decision_id desc);
create index if not exists vy_replica_artifact_decision_owner_ix
  on vy_replica_processing_artifact_decision (owner_user_id,replica_id,created_at desc);

-- Migration 045 - protected owner-only VoiceGenome preview corridor.
alter table vy_replica_generation alter column voice_profile_id drop not null;
alter table vy_replica_generation alter column profile_version drop not null;
alter table vy_replica_generation alter column calibration_version drop not null;
alter table vy_replica_generation add column if not exists preview_artifact_id uuid;
alter table vy_replica_generation add column if not exists preview_model text not null default '';
alter table vy_replica_generation add column if not exists preview_model_commitment text not null default '';

alter table vy_replica_generation drop constraint if exists vy_replica_generation_purpose_check;
alter table vy_replica_generation add constraint vy_replica_generation_purpose_check
  check (purpose in ('voice_preview','calibration','private_conversation'));

do $replica_voice_preview_constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_generation_preview_artifact_fk'
      and conrelid='vy_replica_generation'::regclass
  ) then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_artifact_fk
      foreign key (preview_artifact_id,replica_id,owner_user_id)
      references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_generation_preview_shape'
      and conrelid='vy_replica_generation'::regclass
  ) then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_shape check (
      (
        purpose='voice_preview' and channel='studio_preview' and dialogue_turn_id is null
        and voice_profile_id is null and profile_version is null and calibration_version is null
        and preview_artifact_id is not null and preview_model<>''
        and preview_model_commitment~'^[0-9a-f]{64}$'
      ) or (
        purpose in ('calibration','private_conversation')
        and voice_profile_id is not null and profile_version is not null and calibration_version is not null
        and preview_artifact_id is null and preview_model='' and preview_model_commitment=''
      )
    );
  end if;
end;
$replica_voice_preview_constraints$;

create index if not exists vy_replica_generation_preview_open_ix
  on vy_replica_generation (owner_user_id,replica_id,authorized_at)
  where purpose='voice_preview' and state in ('authorized','streaming');
