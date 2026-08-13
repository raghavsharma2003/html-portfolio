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
