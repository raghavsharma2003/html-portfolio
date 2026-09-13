-- Meera's database (Neon Postgres, reached over SQL-over-HTTP by api/_db.js).
--
-- Every one of these tables was created ad hoc from a throwaway script, which
-- meant the schema existed in exactly one place: the running database. Nothing
-- in the repo described it, so a fresh deploy could not rebuild it and nobody
-- reviewing a query could check it against anything. This file is that record,
-- transcribed from the live database rather than from memory, so it matches
-- what is actually running.
--
-- Historical intent was an idempotent live/empty rebuild. Source mirrors and
-- table ordering are checked; PostgreSQL bootstrap/catalog proof is pending.
-- See docs/gurukul/research/LEGACY-SCHEMA58-BOOTSTRAP-PROPOSAL-20260908.md before use.
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

-- The memory-consent ledger (task #148, DPDP). See db/migrations/
-- 016_memory_consent.sql for the full reasoning; the short version is that
-- India's DPDP Act reaches full effect 2027-05-14, storing cross-session
-- personal and emotional memory needs its own specific, informed, unbundled
-- consent, and a fiduciary must be able to SHOW it was given. APPEND-ONLY: one
-- row per answer, so the table can say what consent was in force on a date
-- rather than only what it is now. NO CONTENT COLUMN, ever.
create table if not exists meera_consent (
  id        bigint generated always as identity primary key,
  device_id uuid not null,
  user_id   uuid,
  kind      text not null default 'memory',
  granted   boolean not null,
  version   integer not null default 1,
  at        timestamptz not null default now(),
  filed_at  timestamptz not null default now()
);
create index if not exists meera_consent_device_at on meera_consent (device_id, at desc);

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

-- BEGIN historical legacy mirror: 010_agent_strict.sql
-- Migration 010 — remove the training wheels. Contract: SPEC-AGENT-LAYER §2
-- (Law E1), §6 ("the default is removed in migration 010, after the agent-scope
-- predicate is proven"), and 009's own header, which ties the compat indexes'
-- removal to this file by name.
--
-- ██ NOT APPLIED. DO NOT APPLY UNTIL THE PRECONDITION BELOW HOLDS. ██
--
-- Written by WS-AGENTSCOPE alongside the predicate so that the exit from the
-- transitional state is a reviewed artifact rather than a thing someone
-- reconstructs later from a comment. It has been validated — applied twice, in
-- order, against a full-shape FIXTURE namespace by evals/agent/isolation.mjs,
-- which then proves both halves of what it buys (see "what this buys" below).
-- It has never been run against production.
--
-- Idempotent, one statement per request (see 001/008/009 headers). Neon's
-- SQL-over-HTTP endpoint accepts exactly ONE statement per body and
-- db/migrations/apply.mjs runs them individually with no transaction, so EVERY
-- statement below is independently re-runnable: `alter column ... drop default`
-- on a column that has no default is a no-op, not an error, and `drop index if
-- exists` is the same. An apply interrupted halfway is recovered by running
-- this same file again. No DO blocks and no functions.
--
-- ── what this migration does, and what it buys ─────────────────────────────
--
--   1. Drops the `agent_id` column DEFAULT on all twenty agent-scoped tables.
--      Today a writer that never heard of agents files rows under Meera and
--      nothing complains. After this, an INSERT that does not name agent_id
--      fails the NOT NULL constraint LOUDLY. That is the entire point: the
--      alternative to a loud failure is not "no failure", it is another
--      agent's memory silently filed under Meera, which is unrecoverable
--      because nothing recorded that it happened.
--
--   2. Drops the four `*_person_compat_ix` transitional UNIQUE indexes on the
--      old person-only keys.
--
--      These are not merely redundant after (1) — they make a second agent
--      IMPOSSIBLE. Measured, not reasoned: with 009's shape in place, inserting
--      a vy_rel_state row for agent A2 and a person agent A1 already knows
--      fails with
--
--        23505 duplicate key value violates unique constraint
--              "vy_rel_state_person_compat_ix"
--
--      even though the primary key is (agent_id, person_id) and the two rows
--      differ in it. Same for vy_ritual, vy_currency, vy_india_profile.
--      evals/agent/isolation.mjs asserts this failure BEFORE applying 010 and
--      asserts it is gone after, so the gate proves this file is necessary
--      rather than asserting it. 009's header states the same conclusion in
--      advance ("It must NOT survive into a two-agent world").
--
-- ── THE PRECONDITION ───────────────────────────────────────────────────────
--
-- Every ON CONFLICT site that names a PERSON-ONLY key on one of the four
-- re-keyed tables must first be migrated to name the composite key, and every
-- INSERT into an agent-scoped table must name agent_id explicitly. Dropping the
-- compat index while a site still names `(person_id)` does not raise a type
-- error — it raises `42P10 there is no unique or exclusion constraint matching
-- the ON CONFLICT specification` at RUNTIME, and seven of the ten sites 009
-- enumerated are `.catch()`-swallowed. The failure mode is therefore not an
-- error anyone sees: it is `relstate-zero-rows` a second time, writers silently
-- not writing, discovered months later.
--
-- The ten sites from 009's header, with their current state:
--
--   MIGRATED (WS-AGENTSCOPE, this wave — now name the composite key):
--     api/memory.js       rebuildRelState        on conflict (agent_id, person_id)
--                         opSeedCurrency         on conflict (agent_id, person_id, topic)
--     api/consolidate.js  refreshDerivedDims     on conflict (agent_id, person_id)
--                         deriveRelEventsForPerson
--                                                on conflict (agent_id, person_id)
--                         deriveTrustRepairForPerson (rupture/repair)
--                                                on conflict (agent_id, person_id)
--                         deriveTrustRepairForPerson (trust)
--                                                on conflict (agent_id, person_id)
--
--   MIGRATED after the original readiness note (all now name agent_id):
--     src/engine/relstate.ts       vy_rel_state      on conflict (agent_id, person_id)
--     src/engine/india.ts          vy_ritual         on conflict (agent_id, person_id, key)
--     src/engine/india.ts          vy_currency       on conflict (agent_id, person_id, topic)
--     src/engine/india.ts          vy_india_profile  on conflict (agent_id, person_id)
--
--   These QueryFn-injected client-bundle writers always name agent_id in SQL;
--   trusted production call chains pass the active agent explicitly. The
--   offline `agentstrict` gate protects this precondition before live apply.
--
--   NOT blockers, listed so nobody re-derives them as such:
--     api/clock.js:166             vy_person         — person-INTRINSIC (§2);
--                                                     no agent_id, never gains one
--     api/consolidate.js:1403      vy_phrase         — arbiter is vy_phrase's own
--                                                     (person_id, lower(phrase))
--                                                     unique index, untouched by
--                                                     009 and not dropped here
--     src/engine/india.ts:82       vy_kin            — arbiter is vy_kin_ix
--                                                     (person_id, lower(name)),
--                                                     untouched by 009
--     api/consolidate-sweep.js:196 vy_consolidate_lease — not agent-scoped
--     db/migrations/backfill_001_person.mjs:54  vy_person — person-intrinsic
--
--   Note that vy_phrase's and vy_kin's person-only unique indexes are a SECOND
--   AGENT CORRECTNESS question of their own (two agents may legitimately coin
--   the same phrase, or record the same aunt, with the same person) — but they
--   are not 010's business, because 010 does not touch them and nothing breaks
--   the day it runs. Ticketed, not folded in.
--
-- ── VERIFY THE PRECONDITION BEFORE APPLYING ────────────────────────────────
--
-- (a) The code half. From the repo root — this must print NOTHING:
--
--       grep -rn "on conflict (person_id)" \
--            --include=*.js --include=*.ts --include=*.mjs . \
--            --exclude-dir=node_modules --exclude-dir=dist \
--         | grep -v "vy_person\|vy_consolidate_lease"
--       grep -rn "on conflict (person_id, key)\|on conflict (person_id, topic)" \
--            --include=*.js --include=*.ts --include=*.mjs . \
--            --exclude-dir=node_modules --exclude-dir=dist
--
--     and `node evals/agent/isolation.mjs` must pass, whose call-site arm
--     asserts that every statement over an agent-scoped table in
--     api/memory.js and api/consolidate.js is either scoped by
--     api/_agentscope.js's predicate, an INSERT naming agent_id, or a declared
--     forget-lane exception.
--
-- (b) The schema half. Dropping a unique index is only safe if the composite
--     primary key it shadows actually exists to take over as the arbiter. This
--     must return exactly four rows, all with pk_cols = the composite key:
--
--       select c.relname as tbl,
--              (select string_agg(a.attname, ',' order by k.ord)
--                 from unnest(i.indkey) with ordinality k(attnum, ord)
--                 join pg_attribute a
--                   on a.attrelid = c.oid and a.attnum = k.attnum) as pk_cols
--         from pg_class c
--         join pg_index i on i.indrelid = c.oid and i.indisprimary
--        where c.relname in ('vy_rel_state','vy_ritual','vy_currency',
--                            'vy_india_profile')
--        order by 1;
--
--       expected:
--         vy_currency       agent_id,person_id,topic
--         vy_india_profile  agent_id,person_id
--         vy_rel_state      agent_id,person_id
--         vy_ritual         agent_id,person_id,key
--
-- (c) The data half. 009's PK swap was safe because these four tables held zero
--     rows. That is no longer the relevant question here — what matters is that
--     dropping the person-only unique index cannot orphan an arbiter, which (b)
--     settles. No row count is required.
--
-- ── after this migration ───────────────────────────────────────────────────
--
-- One known follow-on, named rather than left to be discovered:
-- api/memory.js's rebuildRelState rebuilds ONE agent's snapshot after a forget,
-- while the forget cascade itself deletes the person's rows across ALL agents
-- (§6, and G-E5 depends on it staying that way). With one agent those agree;
-- with two, a partial forget leaves the other agent's snapshot stale. The fix
-- is a loop over the agents holding rows for that person and it belongs with
-- whoever ships agent two.

-- ── 1. drop the agent_id column DEFAULT on all twenty agent-scoped tables ──
--
-- Order matches 009's, so the two files diff against each other cleanly.

alter table vy_episode alter column agent_id drop default;
alter table vy_fact alter column agent_id drop default;
alter table vy_rel_state alter column agent_id drop default;
alter table vy_rel_event alter column agent_id drop default;
alter table vy_pattern alter column agent_id drop default;
alter table vy_phrase alter column agent_id drop default;
alter table vy_ritual alter column agent_id drop default;
alter table vy_currency alter column agent_id drop default;
alter table vy_kin alter column agent_id drop default;
alter table vy_india_profile alter column agent_id drop default;
alter table vy_taste_candidate alter column agent_id drop default;
alter table vy_shared_moment alter column agent_id drop default;
alter table vy_visual_assertion alter column agent_id drop default;
alter table vy_embedding alter column agent_id drop default;
alter table vy_derivation alter column agent_id drop default;
alter table vy_session alter column agent_id drop default;
alter table vy_group_member alter column agent_id drop default;
alter table vy_group alter column agent_id drop default;
alter table vy_group_turn alter column agent_id drop default;
alter table vy_disclosure_grant alter column agent_id drop default;

-- ── 2. drop the four transitional person-only unique indexes ───────────────
--
-- 009 created these to keep the ten ON CONFLICT arbiters resolving while the
-- call sites were migrated, and said in its own header that they must not
-- survive into a two-agent world. They are the reason a second agent cannot
-- currently hold rel_state, a ritual, a currency row or an india profile for a
-- person Meera already knows — see the measured 23505 above.

drop index if exists vy_rel_state_person_compat_ix;
drop index if exists vy_ritual_person_compat_ix;
drop index if exists vy_currency_person_compat_ix;
drop index if exists vy_india_profile_person_compat_ix;

-- ── 3. widen the two person-only unique indexes that are NOT PKs ───────────
--
-- Added by the coordinator after WS-AGENTSCOPE named them as an interface
-- ticket rather than a blocker. They were right that these do not block 010;
-- they are, however, the same class of defect one level down, and leaving
-- them would make 010 a half-fix.
--
--   vy_kin_ix    unique (person_id, lower(name))
--   vy_phrase_ix unique (person_id, lower(phrase))
--
-- Neither is a primary key, so neither shows up in a PK audit — but both are
-- ON CONFLICT arbiters (src/engine/india.ts writeKin, api/consolidate.js
-- capturePhrasesForPerson), and both are person-only. The consequence is
-- exactly the one `pk-is-an-arbiter` describes: two agents cannot record the
-- same kin name or coin the same phrase with the same person, and the second
-- one fails 23505 rather than doing anything visible.
--
-- Two agents legitimately CAN know that this person's chachi is called Bua,
-- and can each coin the same phrase with them independently — those are
-- separate relationships and separate rows. The index has to say so.
--
-- Both call sites are migrated in the same change that applies this.
-- Idempotent: drop-then-create, and both tables hold zero rows.

drop index if exists vy_kin_ix;
create unique index if not exists vy_kin_ix on vy_kin (agent_id, person_id, lower(name));
drop index if exists vy_phrase_ix;
create unique index if not exists vy_phrase_ix on vy_phrase (agent_id, person_id, lower(phrase));
-- END historical legacy mirror: 010_agent_strict.sql

-- BEGIN historical legacy mirror: 011_self_layer.sql
-- Migration 011 — the self layer (docs/SPEC-SELF-LAYER.md).
--
-- Five tables for the four dimensions the audit found genuinely absent, plus
-- the told-ledger that makes the third one worth having:
--
--   vy_self_arc         growth — a biography, NOT a mood (§2)
--   vy_agent_life       her life, agent-scoped so she has ONE (§3)
--   vy_agent_life_told  who she has told what, per relationship (§3)
--   vy_rel_texture      how she talks to THIS person specifically (§6)
--   vy_observation      noticing, at one citation (§7)
--
-- STRICT FROM BIRTH. Migration 010 dropped the transitional agent_id defaults
-- that 009 introduced, after they exposed thirteen writers that named no
-- agent (five of them inside .catch() swallows — see measurements
-- `strict-exposed-13`). These tables therefore ship with agent_id NOT NULL and
-- NO DEFAULT from the first statement: a writer that forgets it fails loudly
-- on day one rather than filing another agent's memory under Meera and being
-- discovered a migration later.
--
-- Every statement is independently idempotent and independently re-runnable —
-- Neon SQL-HTTP takes exactly one statement per request and db/migrations/
-- apply.mjs runs them one at a time with no transaction, so an apply
-- interrupted halfway is recovered by running the file again.

-- ── vy_self_arc — growth (§2) ─────────────────────────────────────────────
--
-- The two CHECK constraints ARE the design, and they are what makes this not
-- a mood. inner.ts's G5 forbids accumulating a sad period: a drifting
-- affective baseline, a counter of bad days, a feeling whose cause has fallen
-- out of context so a cause gets invented for it two turns later.
--
-- An arc row cannot become that, structurally: >=3 citations spanning >=42
-- days means it cannot exist without a six-week evidence trail, and `note` is
-- required to be non-affective (a claim about how she has changed, never how
-- she feels). Compare vy_pattern's "one instance is an anecdote" constraint —
-- same mechanism, one order of magnitude slower.
--
-- agent_id is NOT person-scoped on purpose. She is one person across all her
-- relationships; how she EXPRESSES that varies per relationship, and that is
-- vy_rel_texture's job, not this one's.

create table if not exists vy_self_arc (
  id            bigint generated always as identity primary key,
  agent_id      uuid not null,
  dim           text not null,
                -- directness|patience|humour|boundaries|confidence
  note          text not null,      -- telegraphic, shape-linted, NON-affective
  from_note     text not null default '',
  citations     bigint[] not null,  -- episodes evidencing the change
  span_days     real not null default 0,
  superseded_by bigint,             -- bare bigint, no FK (forget law)
  created_at    timestamptz not null default now(),
  constraint vy_self_arc_cited check (cardinality(citations) >= 3),
  constraint vy_self_arc_slow  check (span_days >= 42)
);

create index if not exists vy_self_arc_agent_ix on vy_self_arc (agent_id, dim);

-- ── vy_agent_life — she has ONE life (§3) ─────────────────────────────────
--
-- Fixes `life-per-person` (rejected.md): her improvised self-facts are locked
-- against contradiction per LISTENER, because vy_fact.person_id scopes them —
-- so two users can be told two different versions of her flatmate and nothing
-- can notice. The repo already states the opposite principle in the taste
-- table's own header: "Meera is one person, not one person per install."
--
-- Beats are AUTHORED or owner-approved, never model-generated. G7's reasoning
-- for taste applies here one step worse: a life she improvises has dates to
-- contradict. storyCatalog.ts's STORIES becomes a seed for this table rather
-- than a parallel source of truth — two places holding her life is the
-- relstate-zero-rows shape of bug waiting to happen.

create table if not exists vy_agent_life (
  id         bigint generated always as identity primary key,
  agent_id   uuid not null,
  at         timestamptz not null,
  beat       text not null,          -- telegraphic, shape-linted
  kind       text not null default 'small'
             check (kind in ('work','family','health','social','place','small')),
  arc_key    text not null default '',   -- ties beats into a thread over weeks
  media      jsonb not null default '[]'::jsonb,
  status     text not null default 'approved'
             check (status in ('pending','approved','retired')),
  created_at timestamptz not null default now()
);

create index if not exists vy_agent_life_agent_ix on vy_agent_life (agent_id, at desc);

-- ── vy_agent_life_told — the half that makes it feel human (§3) ───────────
--
-- A friend has told you about the promotion and has NOT yet told you about
-- the fight with her sister, and she knows which is which. That asymmetry is
-- the whole feature: rendered as an ANTI-JOIN (life LEFT JOIN told), untold
-- beats only, so she never re-narrates something you already heard and can
-- say "arre I didn't tell you na" to someone who hasn't.
--
-- `error-marked-done` applies: told is an OUTCOME, never an intent. A row
-- exists only when she actually told them, in a cited episode.

create table if not exists vy_agent_life_told (
  agent_id   uuid   not null,
  life_id    bigint not null,
  person_id  uuid   not null,
  at         timestamptz not null default now(),
  episode_id bigint,                 -- where she told them (edge, no FK)
  primary key (agent_id, life_id, person_id)
);

create index if not exists vy_agent_life_told_person_ix
  on vy_agent_life_told (agent_id, person_id);

-- ── vy_rel_texture — same person, different rapport (§6) ──────────────────
--
-- Derived by COUNTING turns that already exist. No LLM call, no judgment.
--
-- Rendered as coarse bands only, never numbers — vy_rel_state's existing
-- state-leak guard (§12.5) applies unchanged: a model handed teasing 0.34
-- starts reasoning about the number; handed "high" it just talks that way.
--
-- n_turns is a GATE, not a statistic: texture is not rendered below a floor,
-- because a ratio over six turns is noise, and noise rendered as "she teases
-- him a lot" is a personality assigned at random.
--
-- `avoid` is the column with teeth — topics that went badly, cited, that she
-- does not walk into again. It must fail CLOSED: over-avoiding is a mild
-- flatness, under-avoiding re-opens a wound. Same asymmetry that decided
-- `speaker-id`.

create table if not exists vy_rel_texture (
  agent_id     uuid not null,
  person_id    uuid not null,
  teasing      real not null default 0,
  humour       real not null default 0,
  media_rate   real not null default 0,
  words_median real not null default 0,
  emoji_rate   real not null default 0,
  profanity    real not null default 0,
  nickname     text not null default '',
  avoid        text[] not null default '{}',
  avoid_cites  bigint[] not null default '{}',
  n_turns      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (agent_id, person_id)
);

-- ── vy_observation — noticing, at one citation (§7) ───────────────────────
--
-- Distinct from vy_pattern and the distinction is the point. A pattern
-- GENERALIZES ("when X, he does Y") and needs >=2 citations to write plus
-- support_count >= 3 across >= 2 days to become prompt_eligible — measured,
-- that is three calendar days and three nightly passes minimum. An
-- observation RECALLS ("he said X") and needs one citation, because the risk
-- of being wrong is misremembering a detail rather than assigning someone a
-- trait they do not have.
--
-- An observation that repeats is PROMOTED into vy_pattern by the existing
-- extractor rather than duplicated — one promotion path, so the two stores
-- cannot disagree. Rendered inside T5's existing pull-only budget: memory
-- stays reactive, and "never raise unprompted" is not being relaxed to make
-- this feel more impressive.

create table if not exists vy_observation (
  id          bigint generated always as identity primary key,
  agent_id    uuid not null,
  person_id   uuid not null,
  note        text not null,          -- telegraphic, shape-linted
  citations   bigint[] not null,
  salience    real not null default 0.5,
  times_seen  integer not null default 1,
  last_seen   timestamptz not null default now(),
  promoted_to bigint,                 -- vy_pattern id, once it generalizes
  t_invalid   timestamptz,
  created_at  timestamptz not null default now(),
  constraint vy_observation_cited check (cardinality(citations) >= 1)
);

create index if not exists vy_observation_person_ix
  on vy_observation (agent_id, person_id, last_seen desc);
-- END historical legacy mirror: 011_self_layer.sql

-- BEGIN historical legacy mirror: 012_turn_trace.sql
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
-- END historical legacy mirror: 012_turn_trace.sql

-- BEGIN historical legacy mirror: 013_surface_room_binding.sql
-- Migration 013 — the room binding stops being Telegram-shaped.
-- Task #78. Contract: docs/SURFACES.md §0 and §4, SPEC-AGENT-LAYER §4 (Law E3).
--
-- APPLIED to production 2026-08-22 (see "the live verification" below).
-- Promoted from db/migrations/drafts/DRAFT-013-surface-room-binding.sql, which
-- is where it was parked precisely because `db/migrations/apply.mjs` applies
-- EVERY `*.sql` in its own directory (`readdirSync(DIR)`, non-recursive, no
-- allowlist) — a draft beside its siblings is a draft that gets applied.
--
-- The number was checked rather than trusted: the ticket says "migration 010",
-- and 010/011/012 have all shipped, so 013 was the free slot on the day this
-- landed. Renumbering a migration that has already run is the one thing this
-- directory cannot survive.
--
-- ── the debt this pays ────────────────────────────────────────────────────
--
-- `vy_group.tg_chat_id` is a bigint with a unique index, so:
--   - a non-numeric chat key CANNOT be stored. `roomByChatKey()` returned null
--     for one and the room lane refused fail-closed with a named reason. That
--     is correct behaviour for a wrong schema, not a working feature.
--   - two surfaces whose numeric id ranges overlap would COLLIDE on a column
--     whose name says Telegram: Discord channel 9001 and Telegram chat 9001
--     are one room. Exactly the collision `surfaceDeviceId(surface, key)`
--     already refuses to make for devices.
--
-- `vy_surface_identity` (migration 009) already made this move for people. The
-- shape below is deliberately the same one, for the same reason.
--
-- ── the rule every statement here obeys ───────────────────────────────────
--
-- Neon's SQL-over-HTTP endpoint takes ONE statement per request and
-- db/migrations/apply.mjs runs them individually with no transaction. So every
-- statement is independently re-runnable, an interrupted apply is recovered by
-- re-running this file, and there are no DO blocks or functions (apply.mjs's
-- splitter is deliberately small). Nothing here drops a column and nothing
-- here is destructive.
--
-- ── the live verification, recorded because a backfill is a decision ──────
--
-- The draft held the backfill back on purpose: it asserts a FACT about
-- existing rows — that every room carrying a tg_chat_id really is a Telegram
-- room — and that assertion belongs to whoever applies the file, not to
-- whoever drafted it. Checked against production immediately before applying,
-- 2026-08-22:
--
--   select (select count(*)::int from vy_group)        as groups,          -- 0
--          (select count(*)::int from vy_group_member) as members,         -- 0
--          (select count(*)::int from vy_group
--             where tg_chat_id is null)                as groups_null_tg,  -- 0
--          (select count(*)::int from vy_group_member
--             where tg_user_id is null)                as members_null_tg; -- 0
--
-- Both tables hold ZERO rows (the Telegram bot has never run against
-- production — TELEGRAM_BOT_TOKEN is deliberately empty). So the assumption
-- holds vacuously, and the backfill below is a verified no-op TODAY: it
-- matched 0 rows on the apply. It is included rather than left as a follow-up
-- because it is the statement that makes this file complete for a replay — a
-- namespace built from these migrations, or a row written by an older code
-- path before the new one deploys, is repaired by re-running this file. It
-- cannot ever misfire on a row the new code wrote: the new writer always sets
-- `surface`, and every backfill statement is guarded by `surface is null`.
--
-- What is still NOT here, and why each is deliberate:
--   NOT NULL on the new columns — belongs to the follow-up, after the read
--     path has been on the new columns long enough to be believed. A NOT NULL
--     added before the writer is deployed turns the next room creation into an
--     error.
--   DROP COLUMN tg_chat_id / tg_user_id — same follow-up, later. A drop before
--     the read path moves turns every existing room into "unknown room" and
--     she goes silent in all of them. The retirement condition is written down
--     in docs/SURFACES.md §4 rather than left to be re-derived.
--   A `check (surface in (...))` — refused on purpose: the surface list is
--     `api/*.js` adapters, and a CHECK here would mean adding a fifth surface
--     requires a migration, which is precisely "do not teach the engine your
--     surface" one layer down. The set of surfaces is not a database fact.

-- ── vy_group: the room's address becomes (surface, surface_chat_id) ────────

-- text, not bigint: a chat key is an OPAQUE ADDRESS. The contract already says
-- so (`chatKey` is "the ONLY thing handed to send()", never parsed), and the
-- moment it is numeric someone will do arithmetic on it or drop a leading
-- zero. Telegram's negative supergroup ids survive as text unchanged.
alter table vy_group add column if not exists surface text;
alter table vy_group add column if not exists surface_chat_id text;

-- No default and no NOT NULL in this file. A default of 'telegram' would make
-- every future row silently Telegram if the writer forgets to pass a surface,
-- which is the failure this column exists to prevent; NOT NULL comes AFTER the
-- read path has moved, as its own statement, in the follow-up.

-- The uniqueness that replaces vy_group_tg_chat_ix. Partial, so rows that have
-- not been adopted yet do not collide on (null, null).
create unique index if not exists vy_group_surface_chat_ix
  on vy_group (surface, surface_chat_id)
  where surface is not null and surface_chat_id is not null;

-- The old index STAYS until tg_chat_id is dropped. Two unique indexes during
-- the transition is correct: a Telegram room must not gain a second row under
-- the new key while the old one still points at it.

-- ── vy_group_member: the member's address becomes (surface, user id) ───────
--
-- Today a non-Telegram member was written with a NULL tg_user_id and
-- identified through vy_surface_identity — which is where identity belongs, so
-- this pair is NOT an identity key. It is the surface-local address of a
-- member, used for roster display and for the one thing identity cannot
-- answer: "which account in THIS room is this person". person_id stays the
-- primary key half.
alter table vy_group_member add column if not exists surface text;
alter table vy_group_member add column if not exists surface_user_id text;

-- Not unique. The same human may legitimately appear once per surface in one
-- room (linked on Telegram, present on Discord), and the primary key
-- (group_id, person_id) is what makes them one member. An index for the lookup
-- direction, nothing more.
create index if not exists vy_group_member_surface_ix
  on vy_group_member (surface, surface_user_id)
  where surface is not null and surface_user_id is not null;

-- ── the backfill, verified above and idempotent by construction ────────────
--
-- `and surface is null` is what makes each of these safe to re-run and
-- impossible to misfire on a row the new writer created. On the production
-- apply both matched 0 rows.

update vy_group
   set surface = 'telegram',
       surface_chat_id = tg_chat_id::text
 where tg_chat_id is not null and surface is null;

update vy_group_member
   set surface = 'telegram',
       surface_user_id = tg_user_id::text
 where tg_user_id is not null and surface is null;
-- END historical legacy mirror: 013_surface_room_binding.sql

-- BEGIN historical legacy mirror: 014_kin_provisional_texture_drift.sql
-- Migration 014 — two columns the consolidation spine needs (WS-SPINE).
--
-- NOT YET APPLIED to production. This file is additive-only and every
-- statement is independently idempotent (`add column if not exists`, all with
-- defaults), so `node db/migrations/apply.mjs 014` is safe to run at any
-- time, including against a live database serving traffic — no rewrite, no
-- lock beyond the catalogue update, no backfill.
--
-- It MUST be applied BEFORE `CONSOLIDATE_SWEEP_LIVE` is turned on. Without it
-- the kin writer throws on every row (loudly — see api/consolidate.js's
-- `kin_errors`, which is deliberately not a `.catch(() => {})` swallow), and
-- the texture writer's drift columns silently do not exist.
--
-- ── 1. vy_kin.provisional ────────────────────────────────────────────────
--
-- Until now nothing had ever written a vy_kin row (measurements
-- `never-scheduled`: vy_kin 0 rows) because nothing ever CALLED
-- src/engine/india.ts's `writeKin` — `dead-writers`, exactly. The
-- consolidation pass is now that caller, which changes what this table is:
-- every row in it from here on is DERIVED from conversation by a model,
-- rather than entered by a human who knew the answer.
--
-- That distinction has to be in the data, not in a comment, because the
-- failure it guards against is asymmetric and permanent:
--
--   A WRONG MOTHER'S NAME IS WORSE THAN NO MOTHER'S NAME.
--
-- She will use a kin row. She will use it by name, in the wrong relation, for
-- months, and the person on the other end has no way to correct a belief they
-- were never told she held. `provisional = true` means "derived, never
-- confirmed by him", and it is what lets the T3 reader hedge instead of
-- asserting, and lets a later contradiction supersede without anyone ever
-- having been told a wrong thing as a certainty.
--
-- DEFAULT true, not false, and that is the whole point of the column: the
-- direction of the default decides what happens to a row written by a future
-- caller that forgets to set it. Defaulting to `false` would mean a forgotten
-- flag PROMOTES a guess to a certainty, silently. Defaulting to `true` means
-- a forgotten flag under-claims, which costs a hedge nobody notices. The
-- existing rows this could mislabel number exactly zero.
alter table vy_kin add column if not exists provisional boolean not null default true;

-- ── 2. vy_rel_texture drift — CHANGE OVER TIME, not another snapshot ─────
--
-- vy_rel_texture is upserted in place on every pass, so it holds the CURRENT
-- rapport and no memory of any other. Every other self/relational store in
-- this schema can answer "what changed": vy_rel_event carries from_v -> to_v
-- per dim so rel-state history is queryable, vy_self_arc carries from_note ->
-- note with a >=42-day span floor, both supersede rather than overwrite.
-- Texture alone could only ever say what today looks like — and "how you two
-- talk NOW" with no "compared to when" is exactly the memory-junk shape the
-- owner's directive names: a fact about the present pretending to be a story.
--
-- Rather than a history table (a row per pass per pair, which is a lot of
-- storage to answer one question), this is a single compact DERIVED line:
-- the deriver splits its existing trailing scan window into an EARLIER and a
-- RECENT half and writes a note only when a rendered band actually MOVED a
-- full bucket. No new scan, no model call, no new query — the same rows the
-- deriver already reads, counted twice instead of once.
--
-- `drift_cites` is what keeps it honest and is the reason this is two columns
-- and not one: the note may only render when it carries episode citations,
-- the same fail-closed discipline `avoid`/`avoid_cites` already use in this
-- table. An uncited claim about how someone has changed is the single easiest
-- thing in this system to hallucinate and the hardest for a user to dispute.
alter table vy_rel_texture add column if not exists drift text not null default '';
alter table vy_rel_texture add column if not exists drift_cites bigint[] not null default '{}';
-- END historical legacy mirror: 014_kin_provisional_texture_drift.sql

-- BEGIN historical legacy mirror: 015_push_tokens.sql
-- Migration 015 — push registrations (WS-NOTIFY, the FCM slot).
--
-- NOT NEEDED UNTIL PUSH IS CONFIGURED. api/push-token.js refuses every request
-- before it reads the body when the FCM_* keys are empty, and api/_push.js
-- returns before any query, so with the shipping config no statement in this
-- file is ever executed. Apply it as step 5 of src/notify/config.ts's list, at
-- the same time as the keys.
--
-- ── WHAT A ROW IS ────────────────────────────────────────────────────────
--
-- One handle that can put text on one person's lock screen. That is closer to
-- a phone number than to a session id, and the schema is shaped accordingly.
--
-- STRICT FROM BIRTH, like migrations 011 and 012: `agent_id` is NOT NULL with
-- NO DEFAULT. 010 removed 009's transitional defaults after they exposed
-- thirteen writers that named no agent (`strict-exposed-13`). Reachability is
-- the worst possible table to discover that on — a token filed under the wrong
-- agent is another agent able to contact this person.
--
-- ── ONE ROW PER (AGENT, DEVICE), NEVER A HISTORY ─────────────────────────
--
-- The unique constraint IS the policy. A device that re-registers replaces its
-- token; there is no `created_at` chain of superseded tokens, because an old
-- token that still resolves is an old phone still buzzing, and a table that
-- accumulates them is a table whose oldest rows are its most dangerous.
--
-- ── THE FORGET PATH, AND THE GATE THAT ENFORCES IT ───────────────────────
--
-- Two independent doors, deliberately, because reachability is the one thing
-- that must not survive either:
--
--   1. the client's own teardown posts `{ revoke: true }` (src/notify/index.ts
--      `clearReachability`, called on clear-chat, on "make her forget you" and
--      on an account switch). This is the door that works while the phone is
--      in the user's hand;
--   2. api/memory.js's forget cascade, via a row in its PERSON_TABLES
--      manifest, for the case the client never comes back online to make the
--      call in (1) — a user who uninstalls and then asks for deletion.
--
-- ⚠ APPLYING THIS MIGRATION WITHOUT (2) FAILS THE ZERO-ORPHAN SWEEP, BY
-- DESIGN. scripts/relcheck.mjs enumerates every table in the schema carrying a
-- person/device/user column and fails any that is in neither PERSON_TABLES nor
-- its own EXEMPT map, because "a table that is in neither is invisible to BOTH
-- forget and export". So this table cannot exist in a database without a
-- written decision about its deletion — which is exactly the property a
-- reachability table should have. The manifest row is:
--
--     { table: "vy_push_token", key: "device_id", lane: "relational",
--       agent: true },
--
-- filed "relational" and not "person" for the reason vy_surface_identity's own
-- note in that file gives: lane "person" members are SKIPPED by the manifest
-- wipe loop and taken by explicit guarded code, and no such code exists here.
--
-- There is NO foreign key to vy_person_device, and that is a correctness
-- decision rather than an omission: "an unmapped device IS its person" (§2.1),
-- so most devices have no mapping row at all and an FK would reject the
-- registration of exactly the anonymous users this product mostly has.
--
-- A soft-delete column is deliberately absent. A flagged-inactive token is
-- still a token; the row is the artefact.
--
-- CONTENT LAW (migration 012's, restated because it binds here too): there is
-- no column in this table that can hold anything anybody said. A notification's
-- text is built at send time from src/notify/copy.ts and is never stored.

create table if not exists vy_push_token (
  agent_id    uuid not null,
  device_id   uuid not null,          -- same type as vy_person_device.device_id
  token       text not null,
  platform    text not null default 'web'
                check (platform in ('web', 'android', 'ios')),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (agent_id, device_id)
);

-- The send path's only read: "the tokens for these devices, for this agent".
-- Agent first, matching every other index migration 009 added, because the
-- agent predicate is evaluated in the WHERE before rank on every scoped table.
create index if not exists vy_push_token_agent_ix
  on vy_push_token (agent_id, device_id);

-- Stale-token cleanup deletes BY TOKEN (FCM answers 404 UNREGISTERED with the
-- token, not the device), so that lookup gets its own index rather than a scan
-- on a table whose whole point is to be small and correct.
create index if not exists vy_push_token_token_ix
  on vy_push_token (token);
-- END historical legacy mirror: 015_push_tokens.sql

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

-- BEGIN historical replica mirror: 015_replica_core.sql
-- Migration 015 — the consented human-replica core.
-- Contract: docs/SPEC-REPLICA-PLATFORM.md.
--
-- This migration stores ownership, consent capabilities, private source
-- manifests, cited claims, versioned VoiceGenomes/person profiles, calibration
-- preferences, provider handles, eval verdicts and content-free audit/deletion
-- receipts. It stores NO audio/video/image bytes and NO durable public URLs.
--
-- Every statement is independently idempotent. Neon SQL-over-HTTP accepts one
-- statement per request and db/migrations/apply.mjs has no cross-call
-- transaction, so a half-applied run is recovered by running this file again.

-- Supabase auth identities are not rows in Neon. This is the one explicit,
-- server-written bridge to the person layer. Ownership is always derived from
-- a verified auth token; request-supplied user ids are never authoritative.
create table if not exists vy_account_person (
  auth_user_id uuid primary key,
  person_id    uuid not null unique references vy_person(person_id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists vy_replica (
  replica_id            uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null,
  subject_person_id     uuid references vy_person(person_id) on delete set null,
  agent_id              uuid unique references vy_agent(agent_id) on delete set null,
  display_name          text not null,
  subject_mode          text not null default 'self'
                        check (subject_mode in ('self')),
  lifecycle             text not null default 'draft'
                        check (lifecycle in (
                          'draft','consent_pending','enrolling','calibrating',
                          'ready','active','paused','revoked','purging'
                        )),
  policy_version        text not null,
  age_verified_at       timestamptz,
  identity_verified_at  timestamptz,
  liveness_verified_at  timestamptz,
  activated_at          timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vy_replica_owner_pair unique (replica_id, owner_user_id)
);

create index if not exists vy_replica_owner_ix
  on vy_replica (owner_user_id, created_at desc);

create index if not exists vy_replica_agent_ix
  on vy_replica (agent_id) where agent_id is not null;

-- Consent is an append-only capability receipt. A scope is active only when
-- the server finds an unrevoked, unexpired row under the current policy. The
-- receipt stores hashes and method metadata, never an identity document.
create table if not exists vy_replica_consent (
  consent_id         uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  scope              text not null
                     check (scope in (
                       'capture','transcription','biometric','training',
                       'inference','storage','sharing','api','telephony',
                       'model_improvement'
                     )),
  method             text not null
                     check (method in ('account_attestation','live_challenge','manual_review')),
  policy_version     text not null,
  evidence_source_id uuid,
  receipt_hash       text not null,
  granted_at         timestamptz not null default now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  constraint vy_replica_consent_receipt_hash check (length(receipt_hash) >= 32),
  constraint vy_replica_consent_owner_pair unique (consent_id, replica_id, owner_user_id),
  constraint vy_replica_consent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_consent_active_ix
  on vy_replica_consent (replica_id, scope, granted_at desc)
  where revoked_at is null;

create index if not exists vy_replica_consent_owner_ix
  on vy_replica_consent (owner_user_id, granted_at desc);

-- Original and derived artifacts share one manifest so lineage is queryable.
-- The private bucket/path is server-chosen; no public URL is persisted.
create table if not exists vy_replica_source (
  source_id              uuid primary key default gen_random_uuid(),
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  consent_id             uuid,
  parent_source_id       uuid,
  kind                   text not null
                         check (kind in ('audio','video','text','image','document','chat_archive')),
  capture_mode           text not null
                         check (capture_mode in ('live_challenge','upload','import','derived')),
  storage_bucket         text not null,
  object_path            text not null,
  mime                   text not null,
  byte_size              bigint not null default 0 check (byte_size >= 0),
  duration_ms            bigint check (duration_ms is null or duration_ms >= 0),
  sha256                 text not null,
  state                  text not null default 'pending_upload'
                         check (state in (
                           'pending_upload','uploaded','quarantined','processing',
                           'ready','rejected','deleting'
                         )),
  contains_third_parties boolean not null default false,
  transform              jsonb not null default '{}'::jsonb,
  quality                jsonb not null default '{}'::jsonb,
  provenance             jsonb not null default '{}'::jsonb,
  rejection_code         text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint vy_replica_source_hash check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_source_private_path check (object_path !~* '^(https?|data):'),
  constraint vy_replica_source_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_source_consent_fk
    foreign key (consent_id, replica_id, owner_user_id)
    references vy_replica_consent(consent_id, replica_id, owner_user_id)
);

create unique index if not exists vy_replica_source_object_ix
  on vy_replica_source (storage_bucket, object_path);

create index if not exists vy_replica_source_owner_ix
  on vy_replica_source (owner_user_id, replica_id, created_at desc);

create index if not exists vy_replica_source_parent_ix
  on vy_replica_source (parent_source_id) where parent_source_id is not null;

-- A claim is never writable without evidence. `source_ids` point to immutable
-- original/derived manifests; no FK is used because source deletion must be
-- able to invalidate/rebuild claims without FK ordering or partial failure.
create table if not exists vy_replica_claim (
  claim_id       bigint generated always as identity primary key,
  replica_id     uuid not null references vy_replica(replica_id) on delete cascade,
  domain         text not null
                 check (domain in (
                   'identity','biography','event','relationship','preference',
                   'knowledge','value','boundary','habit','language','delivery','visual'
                 )),
  key            text not null,
  body           text not null,
  origin         text not null
                 check (origin in ('self_declared','observed','imported','inferred')),
  confidence     real not null check (confidence >= 0 and confidence <= 1),
  status         text not null default 'proposed'
                 check (status in ('proposed','approved','rejected','superseded')),
  source_ids     uuid[] not null,
  sensitive      boolean not null default false,
  t_valid_from   timestamptz,
  t_valid_to     timestamptz,
  superseded_by  bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint vy_replica_claim_cited check (cardinality(source_ids) >= 1)
);

create index if not exists vy_replica_claim_active_ix
  on vy_replica_claim (replica_id, domain, key)
  where status in ('proposed','approved');

create index if not exists vy_replica_claim_source_ix
  on vy_replica_claim using gin (source_ids);

-- Provider-neutral voice identity. `definition` contains distributions and
-- accepted private source ids; it never contains provider credentials/ids.
create table if not exists vy_replica_voice_genome (
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  version          integer not null check (version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id, version),
  constraint vy_replica_genome_hash check (length(source_set_hash) >= 32)
);

-- A disposable mapping from one VoiceGenome version to an external/local
-- provider. provider_ref is server-only and never returned to clients.
create table if not exists vy_replica_voice_profile (
  voice_profile_id uuid primary key default gen_random_uuid(),
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  genome_version   integer not null check (genome_version > 0),
  provider         text not null,
  model            text not null,
  provider_ref     text not null,
  capabilities     jsonb not null default '{}'::jsonb,
  status           text not null default 'creating'
                   check (status in ('creating','ready','failed','deleting')),
  failure_code     text not null default '',
  deletion_receipt jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists vy_replica_voice_provider_ix
  on vy_replica_voice_profile (provider, provider_ref);

create index if not exists vy_replica_voice_ready_ix
  on vy_replica_voice_profile (replica_id, genome_version, provider)
  where status = 'ready';

-- Versioned structured person model. The runtime compiler renders bounded
-- views from this record; this JSON is not itself a system prompt.
create table if not exists vy_replica_profile (
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  version          integer not null check (version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id, version),
  constraint vy_replica_profile_hash check (length(source_set_hash) >= 32)
);

-- Human calibration is stored as layer-labelled preference evidence, never as
-- another sentence appended to the persona prompt.
create table if not exists vy_replica_preference (
  preference_id uuid primary key default gen_random_uuid(),
  replica_id    uuid not null references vy_replica(replica_id) on delete cascade,
  layer         text not null
                check (layer in ('voice','delivery','language','behaviour','memory','relationship','visual')),
  scenario_id   text not null,
  left_ref      jsonb not null,
  right_ref     jsonb not null,
  choice        text not null check (choice in ('left','right','tie','neither')),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists vy_replica_preference_layer_ix
  on vy_replica_preference (replica_id, layer, created_at desc);

create table if not exists vy_replica_eval_run (
  eval_id          uuid primary key default gen_random_uuid(),
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  profile_version  integer,
  genome_version   integer,
  suite            text not null,
  candidate        text not null,
  corpus_hash      text not null,
  metrics          jsonb not null,
  verdict          text not null check (verdict in ('pass','fail','inconclusive')),
  created_at       timestamptz not null default now(),
  constraint vy_replica_eval_corpus_hash check (length(corpus_hash) >= 32)
);

create index if not exists vy_replica_eval_latest_ix
  on vy_replica_eval_run (replica_id, suite, created_at desc);

-- Content-free operational ledger. Never copy prompt, memory, transcript,
-- source URL, provider secret or generated audio into this table.
create table if not exists vy_replica_audit (
  id            bigint generated always as identity primary key,
  replica_id    uuid,
  owner_user_id uuid not null,
  action        text not null,
  object_kind   text not null,
  object_id     text not null default '',
  trace_id      text not null default '',
  policy        text not null,
  outcome       text not null check (outcome in ('allowed','denied','failed')),
  facts         jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

create index if not exists vy_replica_audit_owner_ix
  on vy_replica_audit (owner_user_id, at desc);

create index if not exists vy_replica_audit_replica_ix
  on vy_replica_audit (replica_id, at desc) where replica_id is not null;

-- Revocation is synchronous; physical erasure is a retryable job. The unique
-- replica key makes enqueue idempotent and lets a sweeper recover a replica
-- that was disabled just before a serverless invocation stopped.
create table if not exists vy_replica_erasure_job (
  job_id           uuid primary key default gen_random_uuid(),
  replica_id       uuid not null unique references vy_replica(replica_id) on delete cascade,
  owner_user_id    uuid not null,
  state            text not null default 'pending'
                   check (state in ('pending','running','blocked','complete')),
  attempts         integer not null default 0 check (attempts >= 0),
  provider_status  jsonb not null default '{}'::jsonb,
  storage_status   jsonb not null default '{}'::jsonb,
  last_error_code  text not null default '',
  requested_at     timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  constraint vy_replica_erasure_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_erasure_pending_ix
  on vy_replica_erasure_job (state, requested_at)
  where state in ('pending','blocked');

-- Survives content deletion only as a non-reconstructive compliance receipt.
create table if not exists vy_replica_deletion_receipt (
  receipt_id       uuid primary key default gen_random_uuid(),
  replica_id_hash  text not null,
  owner_user_hash  text not null,
  policy_version   text not null,
  reason           text not null,
  deleted_classes  text[] not null,
  processor_status jsonb not null default '{}'::jsonb,
  backup_expires_at timestamptz,
  completed_at     timestamptz not null default now(),
  constraint vy_replica_delete_replica_hash check (length(replica_id_hash) >= 32),
  constraint vy_replica_delete_owner_hash check (length(owner_user_hash) >= 32)
);
-- END historical replica mirror: 015_replica_core.sql

-- BEGIN historical replica mirror: 016_replica_enrollment.sql
-- Migration 016 — live enrollment challenges and retryable evidence jobs.
-- One statement per apply call, every statement independently idempotent.

create table if not exists vy_replica_liveness_challenge (
  challenge_id      uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  phrase             text not null,
  phrase_hash        text not null,
  policy_version     text not null,
  state              text not null default 'issued'
                     check (state in ('issued','uploaded','verifying','passed','failed','expired')),
  source_id          uuid references vy_replica_source(source_id) on delete set null,
  attempt            integer not null default 1 check (attempt > 0 and attempt <= 10),
  verifier           text not null default '',
  verifier_result    jsonb not null default '{}'::jsonb,
  failure_code       text not null default '',
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_challenge_phrase_hash check (phrase_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_challenge_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_challenge_owner_ix
  on vy_replica_liveness_challenge (owner_user_id, replica_id, issued_at desc);

create unique index if not exists vy_replica_challenge_live_ix
  on vy_replica_liveness_challenge (replica_id)
  where state in ('issued','uploaded','verifying');

create table if not exists vy_replica_processing_job (
  job_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  source_id          uuid not null references vy_replica_source(source_id) on delete cascade,
  step               text not null
                     check (step in (
                       'integrity','malware_scan','media_probe','diarize',
                       'separate','enhance','transcribe','pii_scan',
                       'third_party_scan','extract','voice_quality','visual_quality'
                     )),
  revision           integer not null default 1 check (revision > 0),
  state              text not null default 'queued'
                     check (state in ('queued','leased','retry','blocked','complete','failed')),
  attempt            integer not null default 0 check (attempt >= 0),
  lease_token_hash   text not null default '',
  leased_at          timestamptz,
  lease_expires_at   timestamptz,
  next_attempt_at    timestamptz not null default now(),
  result             jsonb not null default '{}'::jsonb,
  failure_code       text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vy_replica_processing_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_processing_unique unique (source_id, step, revision)
);

create index if not exists vy_replica_processing_queue_ix
  on vy_replica_processing_job (state, next_attempt_at, created_at)
  where state in ('queued','retry');

create index if not exists vy_replica_processing_source_ix
  on vy_replica_processing_job (replica_id, source_id, created_at);
-- END historical replica mirror: 016_replica_enrollment.sql

-- BEGIN historical replica mirror: 017_replica_processing_manifests.sql
-- Migration 017 -- immutable preprocessing manifests, append-only evidence and
-- versioned model builds. One statement per apply call; every statement is
-- independently idempotent. Raw objects remain in vy_replica_source and are
-- never represented as preprocessing artifacts.

create table if not exists vy_replica_processing_attempt (
  job_id               uuid not null references vy_replica_processing_job(job_id) on delete cascade,
  attempt              integer not null check (attempt > 0),
  outcome              text not null
                       check (outcome in ('running','retry','blocked','complete','failed')),
  adapter_family       text not null default '',
  adapter_name         text not null default '',
  adapter_version      text not null default '',
  result_manifest_hash text not null default '',
  failure_code         text not null default '',
  facts                jsonb not null default '{}'::jsonb,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  primary key (job_id, attempt),
  constraint vy_replica_attempt_result_hash
    check (result_manifest_hash = '' or result_manifest_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_processing_attempt_outcome_ix
  on vy_replica_processing_attempt (outcome, started_at);

-- Composite parent keys make tenant/source ownership part of every child FK;
-- UUID equality alone is not an ownership boundary.
create unique index if not exists vy_replica_source_owner_tuple_ix
  on vy_replica_source (source_id, replica_id, owner_user_id);

do $replica_job_source_fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_processing_source_owner_fk'
       and conrelid = 'vy_replica_processing_job'::regclass
  ) then
    alter table vy_replica_processing_job
      add constraint vy_replica_processing_source_owner_fk
      foreign key (source_id, replica_id, owner_user_id)
      references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade;
  end if;
end;
$replica_job_source_fk$;

create unique index if not exists vy_replica_processing_job_owner_tuple_ix
  on vy_replica_processing_job (job_id, source_id, replica_id, owner_user_id);

create table if not exists vy_replica_processing_artifact (
  artifact_id          uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  source_id            uuid not null references vy_replica_source(source_id) on delete cascade,
  parent_artifact_id   uuid references vy_replica_processing_artifact(artifact_id) on delete restrict,
  created_by_job_id    uuid references vy_replica_processing_job(job_id) on delete set null,
  stage                text not null
                       check (stage in ('separate','enhance','transcribe','voice_quality')),
  variant_key          text not null,
  storage_bucket       text not null,
  object_path          text not null,
  mime                 text not null,
  byte_size            bigint not null check (byte_size > 0),
  duration_ms          integer check (duration_ms is null or duration_ms >= 0),
  sha256               text not null,
  input_sha256         text not null,
  transform_name       text not null,
  transform_version    text not null,
  parameter_hash       text not null,
  adapter_family       text not null,
  adapter_name         text not null,
  adapter_version      text not null,
  manifest             jsonb not null,
  manifest_hash        text not null,
  created_at           timestamptz not null default now(),
  constraint vy_replica_artifact_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_artifact_source_owner_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_artifact_job_owner_fk
    foreign key (created_by_job_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_job(job_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_artifact_sha check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_input_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_parameter_hash check (parameter_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_manifest_hash check (manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_derived_path
    check (object_path like owner_user_id::text || '/' || replica_id::text || '/' || source_id::text || '/derived/%'
           and object_path !~ '://'),
  constraint vy_replica_artifact_owner_tuple
    unique (artifact_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_artifact_parent_owner_fk
    foreign key (parent_artifact_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, source_id, replica_id, owner_user_id) on delete restrict,
  constraint vy_replica_artifact_variant_unique
    unique (source_id, stage, transform_version, variant_key, input_sha256)
);

create index if not exists vy_replica_processing_artifact_source_ix
  on vy_replica_processing_artifact (replica_id, source_id, stage, created_at);

create table if not exists vy_replica_processing_evidence (
  evidence_id          uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  source_id            uuid not null references vy_replica_source(source_id) on delete cascade,
  artifact_id          uuid references vy_replica_processing_artifact(artifact_id) on delete cascade,
  created_by_job_id    uuid references vy_replica_processing_job(job_id) on delete set null,
  evidence_type        text not null
                       check (evidence_type in (
                         'media_probe','speaker_segment','transcript_span','language_span',
                         'voice_embedding','voice_measurement','quality_measurement'
                       )),
  span_start_ms        integer check (span_start_ms is null or span_start_ms >= 0),
  span_end_ms          integer check (span_end_ms is null or span_end_ms >= 0),
  confidence           double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  value                jsonb not null,
  input_sha256         text not null,
  adapter_family       text not null,
  adapter_name         text not null,
  adapter_version      text not null,
  record_hash          text not null unique,
  created_at           timestamptz not null default now(),
  constraint vy_replica_evidence_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_source_owner_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_artifact_owner_fk
    foreign key (artifact_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_job_owner_fk
    foreign key (created_by_job_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_job(job_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_evidence_span
    check (span_end_ms is null or span_start_ms is not null and span_end_ms > span_start_ms),
  constraint vy_replica_evidence_input_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_evidence_record_hash check (record_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_processing_evidence_source_ix
  on vy_replica_processing_evidence (replica_id, source_id, evidence_type, created_at);

create table if not exists vy_replica_processing_evidence_decision (
  decision_id          uuid primary key default gen_random_uuid(),
  evidence_id          uuid not null references vy_replica_processing_evidence(evidence_id) on delete cascade,
  decision             text not null check (decision in ('accepted','rejected','superseded')),
  reason_code          text not null,
  reviewer_user_id     uuid not null,
  created_at           timestamptz not null default now()
);

create index if not exists vy_replica_evidence_decision_ix
  on vy_replica_processing_evidence_decision (evidence_id, created_at desc);

create table if not exists vy_replica_model_build (
  build_id             uuid primary key default gen_random_uuid(),
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  build_kind           text not null check (build_kind in ('voice_genome','person_profile')),
  target_version       integer not null check (target_version > 0),
  builder_version      text not null,
  source_set_hash      text not null,
  state                text not null default 'queued'
                       check (state in ('queued','leased','building','retry','review','approved','failed','retired')),
  attempt              integer not null default 0 check (attempt >= 0),
  manifest_hash        text not null default '',
  failure_code         text not null default '',
  next_attempt_at      timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_replica_model_build_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_model_build_source_hash check (source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_model_build_manifest_hash
    check (manifest_hash = '' or manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_model_build_unique unique (replica_id, build_kind, target_version)
);

create index if not exists vy_replica_model_build_queue_ix
  on vy_replica_model_build (state, next_attempt_at, created_at)
  where state in ('queued','retry');
-- END historical replica mirror: 017_replica_processing_manifests.sql

-- BEGIN historical replica mirror: 019_replica_generation_provenance.sql
-- Migration 019 - protected replica generation and public verification.
--
-- The operational row is tenant-bound and is erased with the replica. The
-- public receipt deliberately survives erasure, but contains only random ids,
-- commitments, hashes, algorithms and signatures. It contains no owner id,
-- replica id, prompt, transcript, memory, audio bytes, provider reference or
-- private object path.

create unique index if not exists vy_replica_voice_profile_replica_ix
  on vy_replica_voice_profile (voice_profile_id, replica_id, genome_version);

create table if not exists vy_replica_generation (
  generation_id         uuid primary key default gen_random_uuid(),
  replica_id            uuid not null,
  owner_user_id         uuid not null,
  voice_profile_id      uuid not null,
  genome_version        integer not null check (genome_version > 0),
  profile_version       integer not null check (profile_version > 0),
  channel               text not null
                        check (channel in ('studio_preview','private_chat','private_call')),
  purpose               text not null
                        check (purpose in ('calibration','private_conversation')),
  policy_version        text not null,
  trace_id              text not null,
  state                 text not null default 'authorized'
                        check (state in ('authorized','streaming','sealed','aborted','failed')),
  disclosure_scheme     text not null,
  watermark_algorithm   text not null,
  provenance_standard   text not null,
  audio_sha256          text,
  watermark_token_hash  text,
  manifest_sha256       text,
  ledger_envelope_hash  text,
  segment_count         integer not null default 0 check (segment_count >= 0),
  final_chain_sha256    text,
  failure_code          text not null default '',
  authorized_at         timestamptz not null default now(),
  streaming_at          timestamptz,
  sealed_at             timestamptz,
  updated_at            timestamptz not null default now(),
  constraint vy_replica_generation_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_generation_voice_fk
    foreign key (voice_profile_id, replica_id, genome_version)
    references vy_replica_voice_profile(voice_profile_id, replica_id, genome_version),
  constraint vy_replica_generation_genome_fk
    foreign key (replica_id, genome_version)
    references vy_replica_voice_genome(replica_id, version),
  constraint vy_replica_generation_profile_fk
    foreign key (replica_id, profile_version)
    references vy_replica_profile(replica_id, version),
  constraint vy_replica_generation_audio_hash
    check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_watermark_hash
    check (watermark_token_hash is null or watermark_token_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_manifest_hash
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_envelope_hash
    check (ledger_envelope_hash is null or ledger_envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_chain_hash
    check (final_chain_sha256 is null or final_chain_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_generation_owner_ix
  on vy_replica_generation (owner_user_id, replica_id, authorized_at desc);

create index if not exists vy_replica_generation_open_ix
  on vy_replica_generation (state, authorized_at)
  where state in ('authorized','streaming');

-- An immutable, content-free public verification receipt. There is no FK to
-- vy_replica_generation so replica erasure cannot destroy authenticity proof
-- for media that already left the service.
create table if not exists vy_replica_generation_receipt (
  generation_id          uuid primary key,
  replica_commitment     text not null,
  policy_version         text not null,
  channel                text not null
                         check (channel in ('studio_preview','private_chat','private_call')),
  disclosure_scheme      text not null,
  disclosure_text_hash   text not null,
  watermark_algorithm    text not null,
  watermark_token_hash   text not null,
  detector_policy_hash   text not null,
  provenance_standard    text not null,
  manifest_location      text not null check (manifest_location in ('embedded','external')),
  manifest_sha256        text not null,
  audio_sha256           text not null,
  segment_count          integer not null check (segment_count > 0),
  final_chain_sha256     text not null,
  envelope_sha256        text not null,
  signature_algorithm    text not null,
  signer_key_id          text not null,
  envelope_signature     text not null,
  issued_at              timestamptz not null default now(),
  constraint vy_replica_receipt_replica_hash check (replica_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_disclosure_hash check (disclosure_text_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_watermark_hash check (watermark_token_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_detector_hash check (detector_policy_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_manifest_hash check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_audio_hash check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_chain_hash check (final_chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_envelope_hash check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_signature check (length(envelope_signature) >= 32)
);

create index if not exists vy_replica_generation_receipt_issued_ix
  on vy_replica_generation_receipt (issued_at desc);

-- Each protected PCM segment is committed and signed before that segment is
-- released to a real-time consumer. These receipts remain verifiable after an
-- abort or final-manifest failure and deliberately carry no replica/owner FK.
create table if not exists vy_replica_generation_segment_receipt (
  generation_id       uuid not null,
  sequence            integer not null check (sequence >= 0),
  byte_offset         bigint not null check (byte_offset >= 0),
  byte_length         integer not null check (byte_length > 0),
  segment_sha256      text not null,
  previous_chain_sha256 text not null,
  chain_sha256        text not null,
  signature_algorithm text not null,
  signer_key_id       text not null,
  chain_signature     text not null,
  issued_at           timestamptz not null default now(),
  primary key (generation_id, sequence),
  constraint vy_replica_segment_hash check (segment_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_previous_hash check (previous_chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_chain_hash check (chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_signature check (length(chain_signature) >= 32)
);

create index if not exists vy_replica_generation_segment_issued_ix
  on vy_replica_generation_segment_receipt (issued_at desc);
-- END historical replica mirror: 019_replica_generation_provenance.sql

-- BEGIN historical replica mirror: 020_replica_review_isolation.sql
-- Migration 020 - make owner evidence decisions tenant-bound and VoiceGenome
-- queueing idempotent. Existing 017 rows are backfilled from immutable
-- evidence before the new columns become mandatory.

alter table vy_replica_processing_evidence_decision add column if not exists replica_id uuid;
alter table vy_replica_processing_evidence_decision add column if not exists owner_user_id uuid;

update vy_replica_processing_evidence_decision d
   set replica_id = e.replica_id,
       owner_user_id = e.owner_user_id
  from vy_replica_processing_evidence e
 where e.evidence_id = d.evidence_id
   and (d.replica_id is null or d.owner_user_id is null);

alter table vy_replica_processing_evidence_decision alter column replica_id set not null;
alter table vy_replica_processing_evidence_decision alter column owner_user_id set not null;

create unique index if not exists vy_replica_evidence_owner_tuple_ix
  on vy_replica_processing_evidence (evidence_id, replica_id, owner_user_id);

do $replica_evidence_decision_owner_fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_evidence_decision_owner_fk'
       and conrelid = 'vy_replica_processing_evidence_decision'::regclass
  ) then
    alter table vy_replica_processing_evidence_decision
      add constraint vy_replica_evidence_decision_owner_fk
      foreign key (evidence_id, replica_id, owner_user_id)
      references vy_replica_processing_evidence(evidence_id, replica_id, owner_user_id)
      on delete cascade;
  end if;
end;
$replica_evidence_decision_owner_fk$;

do $replica_evidence_decision_reviewer_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_evidence_decision_reviewer_check'
       and conrelid = 'vy_replica_processing_evidence_decision'::regclass
  ) then
    alter table vy_replica_processing_evidence_decision
      add constraint vy_replica_evidence_decision_reviewer_check
      check (reviewer_user_id = owner_user_id);
  end if;
end;
$replica_evidence_decision_reviewer_check$;

create index if not exists vy_replica_evidence_decision_owner_ix
  on vy_replica_processing_evidence_decision
    (replica_id, owner_user_id, evidence_id, created_at desc);

create unique index if not exists vy_replica_model_build_source_set_ix
  on vy_replica_model_build (replica_id, build_kind, source_set_hash);
-- END historical replica mirror: 020_replica_review_isolation.sql

-- BEGIN historical legacy mirror: 021_raw_agent_strict.sql
-- Migration 021 - remove the raw RelationalOS compatibility defaults left by
-- migration 018. After this point a writer that omits agent_id fails loudly
-- instead of silently filing a replica conversation under Meera.
--
-- Apply only after `node evals/run.mjs agentstrict` passes and the live 010
-- agent-isolation fixture has passed against the target database.

alter table meera_log alter column agent_id drop default;
alter table meera_nodes alter column agent_id drop default;
alter table meera_edges alter column agent_id drop default;
alter table meera_forget alter column agent_id drop default;
alter table meera_consolidate_lease alter column agent_id drop default;
-- END historical legacy mirror: 021_raw_agent_strict.sql

-- BEGIN historical legacy mirror: 022_remaining_agent_keys.sql
-- Migration 022 - remove the last person-only uniqueness arbiters in the
-- derived agent layer. A client clock id and an inferred taste source are
-- relationship data, so two agents must be able to carry the same natural key.

do $replica_session_agent_key$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'vy_session_pkey'
       and conrelid = 'vy_session'::regclass
       and pg_get_constraintdef(oid) !~* 'PRIMARY KEY \(agent_id, session_id\)'
  ) then
    alter table vy_session drop constraint vy_session_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_session_pkey'
       and conrelid = 'vy_session'::regclass
  ) then
    alter table vy_session add constraint vy_session_pkey primary key (agent_id, session_id);
  end if;
end;
$replica_session_agent_key$;

do $replica_taste_agent_key$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'vy_taste_candidate_source_once'
       and conrelid = 'vy_taste_candidate'::regclass
       and pg_get_constraintdef(oid) !~* 'UNIQUE \(agent_id, source, source_id\)'
  ) then
    alter table vy_taste_candidate drop constraint vy_taste_candidate_source_once;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_taste_candidate_source_once'
       and conrelid = 'vy_taste_candidate'::regclass
  ) then
    alter table vy_taste_candidate
      add constraint vy_taste_candidate_source_once unique (agent_id, source, source_id);
  end if;
end;
$replica_taste_agent_key$;
-- END historical legacy mirror: 022_remaining_agent_keys.sql

-- BEGIN historical replica mirror: 023_replica_runtime.sql
-- Migration 023 - immutable private-replica runtime capabilities.
--
-- A runtime capability freezes the exact agent, person profile, VoiceGenome,
-- provider voice and qualification corpus that earned activation. Runtime
-- requests bind to this row instead of asking for "latest", so a later draft,
-- failed retrain or provider swap cannot silently change a live replica.

create unique index if not exists vy_replica_agent_pair_ix
  on vy_replica (replica_id, agent_id);

create table if not exists vy_replica_runtime_capability (
  capability_id       uuid primary key default gen_random_uuid(),
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  agent_id            uuid not null,
  subject_person_id   uuid not null references vy_person(person_id),
  voice_profile_id    uuid not null,
  genome_version      integer not null check (genome_version > 0),
  profile_version     integer not null check (profile_version > 0),
  qualification_hash text not null,
  policy_version      text not null,
  state               text not null default 'active'
                      check (state in ('active','paused','revoked','superseded')),
  activated_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  constraint vy_replica_runtime_capability_hash
    check (qualification_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_runtime_capability_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_runtime_capability_agent_fk
    foreign key (replica_id, agent_id)
    references vy_replica(replica_id, agent_id) on delete cascade,
  constraint vy_replica_runtime_capability_genome_fk
    foreign key (replica_id, genome_version)
    references vy_replica_voice_genome(replica_id, version),
  constraint vy_replica_runtime_capability_voice_fk
    foreign key (voice_profile_id, replica_id, genome_version)
    references vy_replica_voice_profile(voice_profile_id, replica_id, genome_version),
  constraint vy_replica_runtime_capability_profile_fk
    foreign key (replica_id, profile_version)
    references vy_replica_profile(replica_id, version),
  constraint vy_replica_runtime_capability_identity
    unique (capability_id, replica_id, owner_user_id, agent_id, subject_person_id)
);

create unique index if not exists vy_replica_runtime_one_active_ix
  on vy_replica_runtime_capability (replica_id)
  where state = 'active';

create index if not exists vy_replica_runtime_owner_ix
  on vy_replica_runtime_capability (owner_user_id, replica_id, activated_at desc);

create table if not exists vy_replica_runtime_session (
  session_id        uuid primary key default gen_random_uuid(),
  capability_id     uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  agent_id          uuid not null,
  person_id         uuid not null,
  channel           text not null check (channel in ('private_chat','private_call')),
  state             text not null default 'active'
                    check (state in ('active','ended','revoked','expired')),
  trace_id          text not null,
  started_at        timestamptz not null default now(),
  last_active_at    timestamptz not null default now(),
  ended_at          timestamptz,
  updated_at        timestamptz not null default now(),
  constraint vy_replica_runtime_session_trace check (length(trace_id) between 8 and 96),
  constraint vy_replica_runtime_session_capability_fk
    foreign key (capability_id, replica_id, owner_user_id, agent_id, person_id)
    references vy_replica_runtime_capability(
      capability_id, replica_id, owner_user_id, agent_id, subject_person_id
    ) on delete cascade
);

create index if not exists vy_replica_runtime_session_owner_ix
  on vy_replica_runtime_session (owner_user_id, replica_id, started_at desc);

create index if not exists vy_replica_runtime_session_active_ix
  on vy_replica_runtime_session (capability_id, last_active_at)
  where state = 'active';
-- END historical replica mirror: 023_replica_runtime.sql

-- BEGIN historical replica mirror: 024_person_model.sql
-- Migration 024 - owner-reviewed claims and deterministic Person Models.

alter table vy_replica_claim
  add column if not exists owner_user_id uuid;

update vy_replica_claim c
   set owner_user_id=r.owner_user_id
  from vy_replica r
 where c.replica_id=r.replica_id and c.owner_user_id is null;

alter table vy_replica_claim
  alter column owner_user_id set not null;

create unique index if not exists vy_replica_claim_owner_pair_ix
  on vy_replica_claim (claim_id, replica_id, owner_user_id);

do $person_model_claim_owner_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_owner_fk') then
    alter table vy_replica_claim add constraint vy_replica_claim_owner_fk
      foreign key (replica_id,owner_user_id)
      references vy_replica(replica_id,owner_user_id) on delete cascade;
  end if;
end;
$person_model_claim_owner_fk$;

create table if not exists vy_replica_claim_decision (
  decision_id      uuid primary key default gen_random_uuid(),
  claim_id         bigint not null,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  decision         text not null check (decision in ('accepted','rejected','superseded')),
  reason_code      text not null,
  policy_version   text not null,
  created_at       timestamptz not null default now(),
  constraint vy_replica_claim_decision_owner_check
    check (owner_user_id is not null),
  constraint vy_replica_claim_decision_claim_fk
    foreign key (claim_id,replica_id,owner_user_id)
    references vy_replica_claim(claim_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_claim_decision_latest_ix
  on vy_replica_claim_decision (replica_id,owner_user_id,claim_id,created_at desc);

create unique index if not exists vy_replica_profile_source_set_ix
  on vy_replica_profile (replica_id,source_set_hash);

alter table vy_replica_preference
  add column if not exists owner_user_id uuid;

update vy_replica_preference p
   set owner_user_id=r.owner_user_id
  from vy_replica r
 where p.replica_id=r.replica_id and p.owner_user_id is null;

alter table vy_replica_preference
  alter column owner_user_id set not null;

do $person_model_preference_owner_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_owner_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_owner_fk
      foreign key (replica_id,owner_user_id)
      references vy_replica(replica_id,owner_user_id) on delete cascade;
  end if;
end;
$person_model_preference_owner_fk$;

create index if not exists vy_replica_preference_owner_layer_ix
  on vy_replica_preference (owner_user_id,replica_id,layer,created_at desc);
-- END historical replica mirror: 024_person_model.sql

-- BEGIN historical replica mirror: 025_replica_calibration.sql
-- Migration 025 - typed, versioned behavioral calibration.
--
-- Preferences are append-only answers to server-owned contrast pairs. A
-- calibration policy is a deterministic projection of the latest answers,
-- not a growing collection of prose appended to a prompt.

alter table vy_replica_preference add column if not exists profile_version integer;
alter table vy_replica_preference add column if not exists scenario_revision integer not null default 1;
alter table vy_replica_preference add column if not exists pair_hash text;
alter table vy_replica_preference add column if not exists revision integer not null default 1;
alter table vy_replica_preference add column if not exists supersedes_id uuid;
alter table vy_replica_preference add column if not exists confidence numeric(4,3) not null default 1.000;
alter table vy_replica_preference add column if not exists policy_version text;

create unique index if not exists vy_replica_preference_owner_identity_ix
  on vy_replica_preference (preference_id,replica_id,owner_user_id);

create unique index if not exists vy_replica_preference_pair_revision_ix
  on vy_replica_preference (replica_id,owner_user_id,pair_hash,revision)
  where pair_hash is not null;

do $replica_preference_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_profile_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_profile_fk
      foreign key (replica_id,profile_version)
      references vy_replica_profile(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_supersedes_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_supersedes_fk
      foreign key (supersedes_id,replica_id,owner_user_id)
      references vy_replica_preference(preference_id,replica_id,owner_user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_pair_hash_check') then
    alter table vy_replica_preference add constraint vy_replica_preference_pair_hash_check
      check (pair_hash is null or pair_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_revision_check') then
    alter table vy_replica_preference add constraint vy_replica_preference_revision_check
      check (revision > 0 and scenario_revision > 0 and confidence between 0 and 1 and length(note) <= 280);
  end if;
end;
$replica_preference_constraints$;

create table if not exists vy_replica_calibration (
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  version          integer not null check (version > 0),
  profile_version  integer not null check (profile_version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id,version),
  constraint vy_replica_calibration_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_calibration_profile_fk
    foreign key (replica_id,profile_version)
    references vy_replica_profile(replica_id,version),
  constraint vy_replica_calibration_source_hash
    check (source_set_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists vy_replica_calibration_source_set_ix
  on vy_replica_calibration (replica_id,owner_user_id,profile_version,source_set_hash);

create index if not exists vy_replica_calibration_owner_ix
  on vy_replica_calibration (owner_user_id,replica_id,created_at desc);

alter table vy_replica_runtime_capability add column if not exists calibration_version integer;
alter table vy_replica_eval_run add column if not exists calibration_version integer;
alter table vy_replica_generation add column if not exists calibration_version integer;

do $replica_calibration_runtime_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_runtime_calibration_fk') then
    alter table vy_replica_runtime_capability add constraint vy_replica_runtime_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_eval_calibration_fk') then
    alter table vy_replica_eval_run add constraint vy_replica_eval_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_calibration_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
end;
$replica_calibration_runtime_constraints$;
-- END historical replica mirror: 025_replica_calibration.sql

-- BEGIN historical replica mirror: 026_claim_extraction.sql
-- Migration 026 - cited, privacy-bounded claim extraction.
--
-- Extraction runs are content-free operational records. Proposed claims cite
-- immutable transcript evidence through exact character spans and quote
-- hashes; raw quotes remain in the private evidence row and never enter this
-- lineage table.

create table if not exists vy_replica_claim_extraction (
  run_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  schema_version     text not null,
  provider_family    text not null,
  provider_name      text not null,
  provider_version   text not null,
  model              text not null,
  input_set_hash     text not null,
  consent_ids        uuid[] not null,
  state              text not null default 'extracting'
                     check (state in ('extracting','complete','failed','superseded')),
  proposed_count     integer not null default 0 check (proposed_count >= 0),
  rejected_count     integer not null default 0 check (rejected_count >= 0),
  attempt            integer not null default 1 check (attempt > 0),
  failure_code       text not null default '',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_claim_extraction_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_hash
    check (input_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_claim_extraction_consent_check
    check (cardinality(consent_ids) >= 2),
  constraint vy_replica_claim_extraction_owner_tuple
    unique (run_id,replica_id,owner_user_id)
);

create unique index if not exists vy_replica_claim_extraction_input_ix
  on vy_replica_claim_extraction (replica_id,owner_user_id,schema_version,provider_name,provider_version,model,input_set_hash);

create index if not exists vy_replica_claim_extraction_owner_ix
  on vy_replica_claim_extraction (owner_user_id,replica_id,created_at desc);

alter table vy_replica_claim add column if not exists proposal_hash text;
alter table vy_replica_claim add column if not exists extractor_run_id uuid;

create unique index if not exists vy_replica_claim_proposal_ix
  on vy_replica_claim (replica_id,owner_user_id,proposal_hash)
  where proposal_hash is not null;

do $replica_claim_extractor_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_proposal_hash_check') then
    alter table vy_replica_claim add constraint vy_replica_claim_proposal_hash_check
      check (proposal_hash is null or proposal_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_extractor_run_fk') then
    alter table vy_replica_claim add constraint vy_replica_claim_extractor_run_fk
      foreign key (extractor_run_id,replica_id,owner_user_id)
      references vy_replica_claim_extraction(run_id,replica_id,owner_user_id) on delete restrict;
  end if;
end;
$replica_claim_extractor_constraints$;

create table if not exists vy_replica_claim_citation (
  claim_id          bigint not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  evidence_id       uuid not null,
  source_id         uuid not null,
  start_char        integer not null check (start_char >= 0),
  end_char          integer not null check (end_char > start_char),
  quote_hash        text not null,
  entailment        double precision not null check (entailment >= 0 and entailment <= 1),
  created_at        timestamptz not null default now(),
  primary key (claim_id,evidence_id,start_char,end_char),
  constraint vy_replica_claim_citation_quote_hash check (quote_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_claim_citation_claim_fk
    foreign key (claim_id,replica_id,owner_user_id)
    references vy_replica_claim(claim_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_citation_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_citation_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_claim_citation_source_ix
  on vy_replica_claim_citation (owner_user_id,replica_id,source_id,evidence_id);
-- END historical replica mirror: 026_claim_extraction.sql

-- BEGIN historical replica mirror: 027_replica_dialogue.sql
-- Migration 027 - private, version-bound replica dialogue.
--
-- Conversation text continues to live in the erasable raw RelationalOS log.
-- Dialogue rows bind exact runtime/model versions to those log ids and hashes;
-- they do not duplicate prompts or replies.

create unique index if not exists vy_person_device_pair_ix
  on vy_person_device (device_id,person_id);

create unique index if not exists meera_log_agent_device_tuple_ix
  on meera_log (id,agent_id,device_id);

create unique index if not exists vy_replica_runtime_session_identity_ix
  on vy_replica_runtime_session
    (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id);

alter table vy_replica_runtime_session
  add column if not exists next_turn_ordinal integer not null default 1;

create table if not exists vy_replica_dialogue_turn (
  turn_id             uuid primary key default gen_random_uuid(),
  session_id          uuid not null,
  capability_id       uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  agent_id            uuid not null,
  person_id           uuid not null,
  device_id           uuid not null,
  ordinal             integer not null check (ordinal > 0),
  profile_version     integer not null check (profile_version > 0),
  calibration_version integer not null check (calibration_version > 0),
  schema_version      text not null,
  provider_family     text not null,
  provider_name       text not null,
  provider_version    text not null,
  model               text not null,
  trace_id            text not null,
  user_log_id         bigint not null,
  assistant_log_id    bigint,
  prompt_hash         text not null,
  response_hash       text,
  delivery_plan       jsonb,
  state               text not null default 'generating'
                      check (state in ('generating','complete','failed','blocked')),
  failure_code        text not null default '',
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  constraint vy_replica_dialogue_prompt_hash check (prompt_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_dialogue_response_hash check (response_hash is null or response_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_dialogue_trace check (length(trace_id) between 8 and 96),
  constraint vy_replica_dialogue_owner_tuple unique (turn_id,replica_id,owner_user_id),
  constraint vy_replica_dialogue_session_ordinal unique (session_id,ordinal),
  constraint vy_replica_dialogue_session_fk
    foreign key (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id)
    references vy_replica_runtime_session(
      session_id,capability_id,replica_id,owner_user_id,agent_id,person_id
    ) on delete cascade,
  constraint vy_replica_dialogue_device_fk
    foreign key (device_id,person_id)
    references vy_person_device(device_id,person_id) on delete cascade,
  constraint vy_replica_dialogue_user_log_fk
    foreign key (user_log_id,agent_id,device_id)
    references meera_log(id,agent_id,device_id) on delete cascade,
  constraint vy_replica_dialogue_assistant_log_fk
    foreign key (assistant_log_id,agent_id,device_id)
    references meera_log(id,agent_id,device_id) on delete cascade
);

create index if not exists vy_replica_dialogue_owner_ix
  on vy_replica_dialogue_turn (owner_user_id,replica_id,created_at desc);

create index if not exists vy_replica_dialogue_session_ix
  on vy_replica_dialogue_turn (session_id,ordinal desc);

alter table vy_replica_generation add column if not exists dialogue_turn_id uuid;

do $replica_generation_dialogue_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_dialogue_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_dialogue_fk
      foreign key (dialogue_turn_id,replica_id,owner_user_id)
      references vy_replica_dialogue_turn(turn_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_generation_dialogue_fk$;

create index if not exists vy_replica_generation_dialogue_ix
  on vy_replica_generation (dialogue_turn_id)
  where dialogue_turn_id is not null;
-- END historical replica mirror: 027_replica_dialogue.sql

-- BEGIN historical replica mirror: 028_provider_budget.sql
-- Migration 028 - content-free, atomic paid-provider budget control.
--
-- The Azure sponsorship is finite. Reservations are charged against one
-- server-configured ceiling before a provider call; actual usage settles the
-- reservation afterwards. No prompt, transcript, reply, owner id or replica id
-- is stored in this ledger.

create table if not exists vy_provider_budget (
  budget_id           text primary key,
  currency            text not null default 'USD' check (currency='USD'),
  limit_microusd      bigint not null check (limit_microusd > 0),
  reserved_microusd   bigint not null default 0 check (reserved_microusd >= 0),
  spent_microusd      bigint not null default 0 check (spent_microusd >= 0),
  state               text not null default 'active' check (state in ('active','paused','exhausted')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vy_provider_budget_total_check check (spent_microusd + reserved_microusd <= limit_microusd)
);

create table if not exists vy_provider_spend (
  reservation_id       uuid primary key default gen_random_uuid(),
  budget_id             text not null references vy_provider_budget(budget_id) on delete restrict,
  operation             text not null check (operation in ('claim_extraction','dialogue','transcription','voice_training','synthesis','liveness','watermarking')),
  provider_family       text not null,
  provider_name         text not null,
  provider_version      text not null,
  model                  text not null,
  request_hash           text not null,
  unit_kind              text not null check (unit_kind in ('tokens','characters','audio_ms','requests')),
  reserved_input_units   bigint not null default 0 check (reserved_input_units >= 0),
  reserved_output_units  bigint not null default 0 check (reserved_output_units >= 0),
  actual_input_units     bigint check (actual_input_units is null or actual_input_units >= 0),
  actual_output_units    bigint check (actual_output_units is null or actual_output_units >= 0),
  reserved_microusd      bigint not null check (reserved_microusd > 0),
  actual_microusd        bigint check (actual_microusd is null or actual_microusd >= 0),
  state                  text not null default 'pending'
                         check (state in ('pending','reserved','in_flight','settled','released','reconcile_required')),
  failure_code           text not null default '',
  created_at             timestamptz not null default now(),
  settled_at             timestamptz,
  updated_at             timestamptz not null default now(),
  constraint vy_provider_spend_request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_provider_spend_request_unique unique (budget_id,operation,request_hash)
);

create index if not exists vy_provider_spend_state_ix
  on vy_provider_spend (budget_id,state,created_at);

create index if not exists vy_provider_spend_provider_ix
  on vy_provider_spend (provider_name,model,created_at desc);
-- END historical replica mirror: 028_provider_budget.sql

-- BEGIN historical replica mirror: 029_replica_turn_feedback.sql
-- Migration 029 - exact-version owner feedback and encrypted correction exemplars.
--
-- Ratings remain typed and content-free. Optional owner wording is encrypted
-- before persistence and is never copied into the feedback ledger.

create unique index if not exists vy_replica_dialogue_feedback_identity_ix
  on vy_replica_dialogue_turn
    (turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash);

create unique index if not exists vy_replica_generation_feedback_identity_ix
  on vy_replica_generation (generation_id,replica_id,owner_user_id,dialogue_turn_id);

create table if not exists vy_replica_turn_feedback (
  feedback_id          uuid primary key,
  turn_id              uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  capability_id        uuid not null,
  profile_version      integer not null check (profile_version > 0),
  calibration_version  integer not null check (calibration_version > 0),
  response_hash        text not null,
  source_generation_id uuid,
  revision             integer not null check (revision > 0),
  supersedes_id        uuid,
  ratings              jsonb not null check (jsonb_typeof(ratings)='object'),
  ratings_hash         text not null,
  reason_codes         text[] not null default '{}',
  correction_hash      text,
  policy_version       text not null,
  created_at           timestamptz not null default now(),
  constraint vy_replica_turn_feedback_hash check (response_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_ratings_hash check (ratings_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_correction_hash check (correction_hash is null or correction_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_reason_count check (cardinality(reason_codes) <= 8),
  constraint vy_replica_turn_feedback_revision unique (turn_id,revision),
  constraint vy_replica_turn_feedback_owner_identity unique (feedback_id,replica_id,owner_user_id),
  constraint vy_replica_turn_feedback_supersedes_fk
    foreign key (supersedes_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id),
  constraint vy_replica_turn_feedback_turn_fk
    foreign key (turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash)
    references vy_replica_dialogue_turn(
      turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash
    ) on delete cascade,
  constraint vy_replica_turn_feedback_generation_fk
    foreign key (source_generation_id,replica_id,owner_user_id,turn_id)
    references vy_replica_generation(generation_id,replica_id,owner_user_id,dialogue_turn_id)
);

create index if not exists vy_replica_turn_feedback_owner_ix
  on vy_replica_turn_feedback (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_turn_exemplar (
  feedback_id       uuid primary key,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  algorithm         text not null check (algorithm='AES-256-GCM'),
  key_id            text not null,
  nonce             bytea not null,
  ciphertext        bytea not null,
  auth_tag          bytea not null,
  wrapped_dek       bytea not null,
  wrap_nonce        bytea not null,
  wrap_auth_tag     bytea not null,
  aad_sha256        text not null,
  text_sha256       text not null,
  created_at        timestamptz not null default now(),
  constraint vy_replica_turn_exemplar_aad_hash check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_exemplar_text_hash check (text_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_exemplar_crypto_shape check (
    octet_length(nonce)=12 and octet_length(auth_tag)=16 and octet_length(ciphertext)>0
    and octet_length(wrapped_dek)=32 and octet_length(wrap_nonce)=12 and octet_length(wrap_auth_tag)=16
  ),
  constraint vy_replica_turn_exemplar_feedback_fk
    foreign key (feedback_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_turn_exemplar_owner_ix
  on vy_replica_turn_exemplar (owner_user_id,replica_id,created_at desc);
-- END historical replica mirror: 029_replica_turn_feedback.sql

-- BEGIN historical replica mirror: 030_replica_feedback_dataset.sql
-- Migration 030 - leakage-safe, content-free feedback dataset manifests.
--
-- Conversation split assignments are immutable across dataset versions so a
-- turn from one private session can never appear in both train and evaluation.

create table if not exists vy_replica_feedback_dataset (
  dataset_id          uuid primary key,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  version             integer not null check (version > 0),
  profile_version     integer not null check (profile_version > 0),
  calibration_version integer not null check (calibration_version > 0),
  schema_version      text not null,
  source_set_hash     text not null,
  definition          jsonb not null,
  readiness           jsonb not null,
  status              text not null default 'draft' check (status in ('draft','approved','retired','rejected')),
  created_at          timestamptz not null default now(),
  constraint vy_replica_feedback_dataset_hash check (source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_feedback_dataset_owner_identity unique (dataset_id,replica_id,owner_user_id),
  constraint vy_replica_feedback_dataset_version unique (replica_id,version),
  constraint vy_replica_feedback_dataset_source unique (replica_id,owner_user_id,profile_version,calibration_version,source_set_hash),
  constraint vy_replica_feedback_dataset_owner_fk
    foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_feedback_dataset_profile_fk
    foreign key (replica_id,profile_version) references vy_replica_profile(replica_id,version),
  constraint vy_replica_feedback_dataset_calibration_fk
    foreign key (replica_id,calibration_version) references vy_replica_calibration(replica_id,version)
);

create index if not exists vy_replica_feedback_dataset_owner_ix
  on vy_replica_feedback_dataset (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_feedback_split (
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  session_commitment  text not null,
  split               text not null check (split in ('train','development','test')),
  first_dataset_id    uuid not null,
  created_at          timestamptz not null default now(),
  primary key (replica_id,owner_user_id,session_commitment),
  constraint vy_replica_feedback_split_hash check (session_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_feedback_split_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_feedback_split_dataset_fk
    foreign key (first_dataset_id,replica_id,owner_user_id)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_feedback_split_dataset_ix
  on vy_replica_feedback_split (first_dataset_id,split);
-- END historical replica mirror: 030_replica_feedback_dataset.sql

-- BEGIN historical replica mirror: 031_replica_candidate_qualification.sql
-- Migration 031 - immutable candidate artifacts and paired qualification.
--
-- Qualified means eligible for explicit promotion review, never automatically
-- active. Raw prompts, replies, audio and judge notes stay outside this ledger.

create unique index if not exists vy_replica_runtime_candidate_identity_ix
  on vy_replica_runtime_capability
    (capability_id,replica_id,owner_user_id,profile_version,calibration_version);

create unique index if not exists vy_replica_feedback_dataset_candidate_identity_ix
  on vy_replica_feedback_dataset
    (dataset_id,replica_id,owner_user_id,profile_version,calibration_version);

create table if not exists vy_replica_candidate (
  candidate_id         uuid primary key,
  dataset_id           uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  base_capability_id   uuid not null,
  profile_version      integer not null check (profile_version > 0),
  calibration_version  integer not null check (calibration_version > 0),
  kind                 text not null check (kind in ('dialogue_adapter','voice_adapter','joint_adapter','prompt_policy')),
  target_layers        text[] not null,
  artifact_sha256      text not null,
  base_model_commitment text not null,
  build_manifest_hash  text not null,
  status               text not null default 'draft'
                       check (status in ('draft','evaluating','qualified','rejected','retired')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_replica_candidate_artifact_hash check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_base_hash check (base_model_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_manifest_hash check (build_manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_layers check (
    cardinality(target_layers) between 1 and 7 and
    target_layers <@ array['overall','wording','behavior','relationship','memory','delivery','voice_identity']::text[]
  ),
  constraint vy_replica_candidate_owner_identity unique (candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_artifact_unique unique (replica_id,dataset_id,artifact_sha256),
  constraint vy_replica_candidate_dataset_fk
    foreign key (dataset_id,replica_id,owner_user_id,profile_version,calibration_version)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id,profile_version,calibration_version) on delete cascade,
  constraint vy_replica_candidate_capability_fk
    foreign key (base_capability_id,replica_id,owner_user_id,profile_version,calibration_version)
    references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id,profile_version,calibration_version)
);

create index if not exists vy_replica_candidate_owner_ix
  on vy_replica_candidate (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_candidate_qualification (
  qualification_id  uuid primary key,
  candidate_id      uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  protocol_version  text not null,
  test_set_hash     text not null,
  observation_hash  text not null,
  observation_count integer not null check (observation_count > 0),
  metrics           jsonb not null,
  verdict           text not null check (verdict in ('pass','fail','inconclusive')),
  created_at        timestamptz not null default now(),
  constraint vy_replica_candidate_qualification_test_hash check (test_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_qualification_observation_hash check (observation_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_qualification_unique unique (candidate_id,protocol_version,test_set_hash,observation_hash),
  constraint vy_replica_candidate_qualification_candidate_fk
    foreign key (candidate_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_qualification_owner_ix
  on vy_replica_candidate_qualification (owner_user_id,replica_id,created_at desc);
-- END historical replica mirror: 031_replica_candidate_qualification.sql

-- BEGIN historical replica mirror: 032_replica_candidate_owner_eval.sql
-- Migration 032 - private blinded owner evaluation assignments.
--
-- Run and judgment ledgers are content-free. Context and both outputs are
-- envelope-encrypted in a separately erasable asset table. The owner sees A/B
-- positions only; candidate identity is resolved server-side after judgment.

create unique index if not exists vy_replica_candidate_eval_identity_ix
  on vy_replica_candidate (candidate_id,dataset_id,replica_id,owner_user_id);

create table if not exists vy_replica_candidate_eval_run (
  eval_run_id          uuid primary key,
  candidate_id         uuid not null,
  dataset_id           uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  protocol_version     text not null,
  run_commitment       text not null,
  dataset_source_set_hash text not null,
  required_dimensions text[] not null,
  assignment_count     integer not null check (assignment_count >= 30),
  state                text not null default 'preparing'
                       check (state in ('preparing','collecting','complete','aborted')),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  constraint vy_replica_candidate_eval_run_hash check (run_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_dataset_hash check (dataset_source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_dimensions check (
    cardinality(required_dimensions) between 1 and 7 and
    required_dimensions <@ array['overall','wording','behavior','relationship','memory','delivery','voice_identity']::text[]
  ),
  constraint vy_replica_candidate_eval_run_owner_identity
    unique (eval_run_id,candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_eval_run_commitment
    unique (candidate_id,run_commitment),
  constraint vy_replica_candidate_eval_candidate_fk
    foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_run_owner_ix
  on vy_replica_candidate_eval_run (owner_user_id,replica_id,state,created_at desc);

create table if not exists vy_replica_candidate_eval_assignment (
  assignment_id       uuid primary key,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  example_id          uuid not null,
  session_commitment  text not null,
  sequence            integer not null check (sequence > 0),
  presentation_order  text not null check (presentation_order in ('ab','ba')),
  assignment_hash     text not null,
  state               text not null default 'pending' check (state in ('pending','submitted','void')),
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  constraint vy_replica_candidate_eval_assignment_session check (session_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_assignment_hash check (assignment_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_assignment_owner_identity
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_eval_assignment_asset_binding
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id),
  constraint vy_replica_candidate_eval_assignment_judgment_binding
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash),
  constraint vy_replica_candidate_eval_assignment_sequence unique (eval_run_id,sequence),
  constraint vy_replica_candidate_eval_assignment_example unique (eval_run_id,example_id),
  constraint vy_replica_candidate_eval_assignment_hash_unique unique (eval_run_id,assignment_hash),
  constraint vy_replica_candidate_eval_assignment_run_fk
    foreign key (eval_run_id,candidate_id,replica_id,owner_user_id)
    references vy_replica_candidate_eval_run(eval_run_id,candidate_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_candidate_eval_assignment_feedback_fk
    foreign key (example_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_assignment_next_ix
  on vy_replica_candidate_eval_assignment (eval_run_id,state,sequence);

create table if not exists vy_replica_candidate_eval_asset (
  asset_id            uuid primary key,
  assignment_id       uuid not null,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  example_id          uuid not null,
  role                text not null check (role in ('context','a','b')),
  output_sha256       text not null,
  algorithm           text not null check (algorithm='AES-256-GCM'),
  key_id              text not null,
  nonce               bytea not null,
  ciphertext          bytea not null,
  auth_tag             bytea not null,
  wrapped_dek         bytea not null,
  wrap_nonce          bytea not null,
  wrap_auth_tag       bytea not null,
  aad_sha256          text not null,
  created_at          timestamptz not null default now(),
  constraint vy_replica_candidate_eval_asset_output_hash check (output_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_asset_aad_hash check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_asset_crypto_shape check (
    octet_length(nonce)=12 and octet_length(auth_tag)=16 and octet_length(ciphertext)>0
    and octet_length(wrapped_dek)=32 and octet_length(wrap_nonce)=12 and octet_length(wrap_auth_tag)=16
  ),
  constraint vy_replica_candidate_eval_asset_role unique (assignment_id,role),
  constraint vy_replica_candidate_eval_asset_assignment_fk
    foreign key (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id)
    references vy_replica_candidate_eval_assignment(assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_asset_owner_ix
  on vy_replica_candidate_eval_asset (owner_user_id,replica_id,eval_run_id);

create table if not exists vy_replica_candidate_eval_judgment (
  judgment_id         uuid primary key,
  assignment_id       uuid not null,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  dimension           text not null check (dimension in ('overall','wording','behavior','relationship','memory','delivery','voice_identity')),
  position_winner     text not null check (position_winner in ('a','b','tie')),
  assignment_hash     text not null,
  created_at          timestamptz not null default now(),
  constraint vy_replica_candidate_eval_judgment_hash check (assignment_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_judgment_once unique (assignment_id,dimension),
  constraint vy_replica_candidate_eval_judgment_assignment_fk
    foreign key (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash)
    references vy_replica_candidate_eval_assignment(assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash) on delete cascade
);

create index if not exists vy_replica_candidate_eval_judgment_owner_ix
  on vy_replica_candidate_eval_judgment (owner_user_id,replica_id,eval_run_id,created_at);
-- END historical replica mirror: 032_replica_candidate_owner_eval.sql

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

-- Migration 046 - content-free, exact-generation owner voice preferences.
alter table vy_replica_generation add column if not exists preview_language_id text not null default '';
alter table vy_replica_generation add column if not exists preview_text_hash text not null default '';
alter table vy_replica_generation add column if not exists preview_style jsonb not null default '{}'::jsonb;
alter table vy_replica_generation add column if not exists preview_seed integer not null default 0;

do $replica_voice_preference_generation_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_language_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_language_check check (preview_language_id in ('','en','hi'));
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_text_hash_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_text_hash_check check (preview_text_hash='' or preview_text_hash~'^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_style_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_style_check check (jsonb_typeof(preview_style)='object' and octet_length(preview_style::text)<=512);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_seed_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_seed_check check (preview_seed between 0 and 2147483647);
  end if;
end;
$replica_voice_preference_generation_constraints$;

create table if not exists vy_replica_voice_preference (
  preference_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  genome_version integer not null check (genome_version>0),
  preview_artifact_id uuid not null,
  left_generation_id uuid not null,
  right_generation_id uuid not null,
  pair_hash text not null,
  choice text not null check (choice in ('left','right','tie','neither')),
  reason_codes text[] not null default '{}',
  confidence numeric(4,3) not null default 1.000 check (confidence between 0 and 1),
  policy_version text not null,
  created_at timestamptz not null default now(),
  constraint vy_replica_voice_preference_distinct check (left_generation_id<>right_generation_id),
  constraint vy_replica_voice_preference_pair_hash check (pair_hash~'^[0-9a-f]{64}$'),
  constraint vy_replica_voice_preference_reasons check (cardinality(reason_codes)<=6 and reason_codes <@ array['identity','accent','rhythm','emotion','naturalness','pronunciation','noise_or_artifact']::text[]),
  constraint vy_replica_voice_preference_owner_identity unique (preference_id,replica_id,owner_user_id),
  constraint vy_replica_voice_preference_pair unique (replica_id,owner_user_id,pair_hash),
  constraint vy_replica_voice_preference_owner_fk foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_preference_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id) references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict,
  constraint vy_replica_voice_preference_left_fk foreign key (left_generation_id,replica_id,owner_user_id) references vy_replica_generation(generation_id,replica_id,owner_user_id) on delete restrict,
  constraint vy_replica_voice_preference_right_fk foreign key (right_generation_id,replica_id,owner_user_id) references vy_replica_generation(generation_id,replica_id,owner_user_id) on delete restrict
);
create index if not exists vy_replica_voice_preference_owner_ix on vy_replica_voice_preference(owner_user_id,replica_id,created_at desc);

-- Migration 047 - server-assigned adaptive voice calibration trials.
create table if not exists vy_replica_voice_trial (
  trial_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  genome_version integer not null check (genome_version>0),
  preview_artifact_id uuid not null,
  language_id text not null check (language_id in ('en','hi')),
  prompt_key text not null default 'legacy.owner_custom.v1',
  prompt_deck_version text not null default 'legacy.owner-custom/v1',
  text_hash text not null check (text_hash~'^[0-9a-f]{64}$'),
  preview_seed integer not null check (preview_seed between 1 and 2147483647),
  model_commitment text not null check (model_commitment~'^[0-9a-f]{64}$'),
  left_style_key text not null,
  right_style_key text not null,
  pair_hash text not null check (pair_hash~'^[0-9a-f]{64}$'),
  algorithm text not null check (algorithm in ('voice-curriculum/bt-active-v1','voice-curriculum/bt-active-v2','voice-delivery-owner-holdout/v1')),
  phase text not null default 'calibration',
  delivery_policy_id uuid,
  candidate_side text,
  holdout_seed_index integer,
  state text not null default 'issued' check (state in ('issued','completed','expired','cancelled')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vy_replica_voice_trial_distinct check (left_style_key<>right_style_key),
  constraint vy_replica_voice_trial_prompt_key_check check (prompt_key~'^[a-z0-9_.:-]{3,96}$'),
  constraint vy_replica_voice_trial_prompt_deck_check check (prompt_deck_version in ('legacy.owner-custom/v1','voice-calibration-deck/v1','voice-delivery-holdout-deck/v1')),
  constraint vy_replica_voice_trial_phase_shape check ((phase='calibration' and delivery_policy_id is null and candidate_side is null and holdout_seed_index is null) or (phase='holdout' and delivery_policy_id is not null and candidate_side in ('left','right') and holdout_seed_index between 0 and 1 and algorithm='voice-delivery-owner-holdout/v1' and prompt_deck_version='voice-delivery-holdout-deck/v1')),
  constraint vy_replica_voice_trial_left_style check (left_style_key in ('identity_anchor','faithful','steady_warm','balanced','warm_expressive','expressive','animated')),
  constraint vy_replica_voice_trial_right_style check (right_style_key in ('identity_anchor','faithful','steady_warm','balanced','warm_expressive','expressive','animated')),
  constraint vy_replica_voice_trial_time check (expires_at>created_at),
  constraint vy_replica_voice_trial_completion check ((state='completed' and completed_at is not null) or (state<>'completed' and completed_at is null)),
  constraint vy_replica_voice_trial_owner_identity unique (trial_id,replica_id,owner_user_id),
  constraint vy_replica_voice_trial_owner_fk foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_trial_genome_fk foreign key (replica_id,genome_version) references vy_replica_voice_genome(replica_id,version) on delete restrict,
  constraint vy_replica_voice_trial_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id) references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict
);
create index if not exists vy_replica_voice_trial_owner_ix on vy_replica_voice_trial(owner_user_id,replica_id,created_at desc);
create index if not exists vy_replica_voice_trial_expiry_ix on vy_replica_voice_trial(expires_at) where state='issued';
create index if not exists vy_replica_voice_trial_prompt_coverage_ix on vy_replica_voice_trial(owner_user_id,replica_id,genome_version,language_id,prompt_key) where state='completed';

alter table vy_replica_generation add column if not exists preview_trial_id uuid;
alter table vy_replica_generation add column if not exists preview_trial_side text;
alter table vy_replica_voice_preference add column if not exists trial_id uuid;
do $replica_voice_trial_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_trial_shape') then
    alter table vy_replica_generation add constraint vy_replica_generation_trial_shape check ((preview_trial_id is null and preview_trial_side is null) or (purpose='voice_preview' and preview_trial_id is not null and preview_trial_side in ('left','right')));
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_trial_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_trial_fk foreign key (preview_trial_id,replica_id,owner_user_id) references vy_replica_voice_trial(trial_id,replica_id,owner_user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_preference_trial_fk') then
    alter table vy_replica_voice_preference add constraint vy_replica_voice_preference_trial_fk foreign key (trial_id,replica_id,owner_user_id) references vy_replica_voice_trial(trial_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_voice_trial_constraints$;
create unique index if not exists vy_replica_generation_active_trial_side on vy_replica_generation(preview_trial_id,preview_trial_side) where preview_trial_id is not null and state in ('authorized','streaming','sealed');

-- Migration 049 - immutable Voice Delivery Genome candidates.
create table if not exists vy_replica_voice_delivery_policy (
  policy_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  genome_version integer not null check (genome_version>0),
  preview_artifact_id uuid not null,
  language_id text not null check (language_id in ('en','hi')),
  version integer not null check (version>0),
  algorithm text not null check (algorithm='voice-delivery-policy/bt-map-v1'),
  curriculum_algorithm text not null check (curriculum_algorithm='voice-curriculum/bt-active-v2'),
  prompt_deck_version text not null check (prompt_deck_version='voice-calibration-deck/v1'),
  model_commitment text not null check (model_commitment~'^[0-9a-f]{64}$'),
  source_set_hash text not null check (source_set_hash~'^[0-9a-f]{64}$'),
  definition jsonb not null,
  evidence_count integer not null check (evidence_count>=18),
  unique_prompt_count integer not null check (unique_prompt_count>=6),
  latent_margin numeric(10,6) not null check (latent_margin>=0),
  status text not null default 'draft' check (status in ('draft','qualifying','qualified','approved','rejected','retired')),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_replica_voice_delivery_definition check (jsonb_typeof(definition)='object' and octet_length(definition::text)<=65536),
  constraint vy_replica_voice_delivery_retired_shape check ((status='retired' and retired_at is not null) or (status<>'retired' and retired_at is null)),
  constraint vy_replica_voice_delivery_owner_identity unique (policy_id,replica_id,owner_user_id),
  constraint vy_replica_voice_delivery_version unique (replica_id,genome_version,language_id,version),
  constraint vy_replica_voice_delivery_source unique (replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,model_commitment,source_set_hash),
  constraint vy_replica_voice_delivery_owner_fk foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_delivery_genome_fk foreign key (replica_id,genome_version) references vy_replica_voice_genome(replica_id,version) on delete restrict,
  constraint vy_replica_voice_delivery_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id) references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict
);
create index if not exists vy_replica_voice_delivery_owner_ix on vy_replica_voice_delivery_policy(owner_user_id,replica_id,language_id,version desc);
create index if not exists vy_replica_voice_delivery_status_ix on vy_replica_voice_delivery_policy(status,updated_at);

do $replica_voice_trial_delivery_policy_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_trial_delivery_policy_fk') then
    alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_delivery_policy_fk foreign key (delivery_policy_id,replica_id,owner_user_id) references vy_replica_voice_delivery_policy(policy_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_voice_trial_delivery_policy_fk$;
create unique index if not exists vy_replica_voice_delivery_holdout_cell_ix on vy_replica_voice_trial(delivery_policy_id,prompt_key,holdout_seed_index) where phase='holdout' and state in ('issued','completed');

-- Migration 050 - owner held-out qualification, not production qualification.
create table if not exists vy_replica_voice_delivery_qualification (
  qualification_id uuid primary key,
  policy_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  protocol_version text not null check (protocol_version='voice-delivery-owner-holdout/v1'),
  prompt_deck_version text not null check (prompt_deck_version='voice-delivery-holdout-deck/v1'),
  source_set_hash text not null check (source_set_hash~'^[0-9a-f]{64}$'),
  observation_count integer not null check (observation_count=12),
  prompt_family_count integer not null check (prompt_family_count=6),
  candidate_score numeric(8,3) not null check (candidate_score between 0 and 12),
  candidate_rate numeric(8,6) not null check (candidate_rate between 0 and 1),
  wilson_lower numeric(8,6) not null check (wilson_lower between 0 and 1),
  neither_count integer not null check (neither_count between 0 and 12),
  verdict text not null check (verdict in ('owner_pass','owner_fail')),
  created_at timestamptz not null default now(),
  constraint vy_replica_voice_delivery_qualification_owner_identity unique (qualification_id,policy_id,replica_id,owner_user_id),
  constraint vy_replica_voice_delivery_qualification_source unique (policy_id,protocol_version,source_set_hash),
  constraint vy_replica_voice_delivery_qualification_policy_fk foreign key (policy_id,replica_id,owner_user_id) references vy_replica_voice_delivery_policy(policy_id,replica_id,owner_user_id) on delete cascade
);
create index if not exists vy_replica_voice_delivery_qualification_owner_ix on vy_replica_voice_delivery_qualification(owner_user_id,replica_id,created_at desc);

-- Migration 051 - DB-backed teacher sheets. agent_id is FK-shaped and carries
-- no FK constraint (009's convention for every agent-scoped table); the
-- publish gate is a CHECK because a predicate is a guarantee and a code path
-- is a preference (safety-floor-teacher.md, `gate0-structural`).
create table if not exists vy_teacher_sheet (
  sheet_id uuid primary key,
  agent_id uuid not null,
  version text not null default '',
  sheet jsonb not null,
  status text not null default 'draft' check (status in ('draft','validated','published','revoked')),
  consent_artifact_id uuid,
  created_at timestamptz not null default now(),
  -- 052: the studio draft lane's "when was my work last saved". A draft save
  -- is an UPSERT, so created_at stops moving on the first one.
  updated_at timestamptz default now(),
  published_at timestamptz,
  constraint vy_teacher_sheet_publish_gate check (status <> 'published' or (consent_artifact_id is not null and published_at is not null))
);
create index if not exists vy_teacher_sheet_agent_status_ix on vy_teacher_sheet (agent_id, status, published_at desc);
create unique index if not exists vy_teacher_sheet_one_published_ix on vy_teacher_sheet (agent_id) where status = 'published';
create index if not exists vy_teacher_sheet_agent_recent_ix on vy_teacher_sheet (agent_id, created_at desc);

-- Migration 054 - vy_voice_fidelity: the stored half of the "still sounds like
-- them" guarantee (SPEC-GURUKUL.md §8.2). Scoring math is api/_fidelity.js;
-- the ECAPA-TDNN embeddings come from services/voice-evidence. The row's key
-- names the VOICE completely - (voice_profile_ref, genome_version,
-- voice_model_ref) - because `cache-outlives-the-voice` is exactly this hazard:
-- a stored verdict whose key does not name the voice it measured keeps
-- covering a voice it never heard. Superseded rows are kept; the history of a
-- score moving is the only way an expert can see drift.
create table if not exists vy_voice_fidelity (
  fidelity_id uuid primary key default gen_random_uuid(),
  replica_id uuid not null references vy_replica(replica_id) on delete cascade,
  owner_user_id uuid not null,
  voice_profile_ref uuid not null,
  voice_model_ref text not null default '',
  genome_version integer not null check (genome_version > 0),
  score jsonb not null,
  policy_version text not null,
  status text not null check (status in ('pass','warn','fail')),
  computed_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint vy_voice_fidelity_profile_fk foreign key (voice_profile_ref, replica_id, owner_user_id) references vy_replica_voice_profile (voice_profile_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_voice_fidelity_score_shape check (jsonb_typeof(score->'mean') = 'number' and jsonb_typeof(score->'p10') = 'number' and jsonb_typeof(score->'worst') = 'number')
);
create unique index if not exists vy_voice_fidelity_standing_ix on vy_voice_fidelity (voice_profile_ref) where superseded_at is null;
create index if not exists vy_voice_fidelity_gate_ix on vy_voice_fidelity (replica_id, owner_user_id, voice_profile_ref, computed_at desc);
create index if not exists vy_voice_fidelity_history_ix on vy_voice_fidelity (replica_id, computed_at desc);
-- Migration 053 - the stays-current loop (SPEC-GURUKUL.md §8 item 3). No FKs
-- (009's convention, restated by 051). `oauth_grant_ref` is a uuid because an
-- OAuth token cannot be cast into one - the column type is the guarantee that
-- a credential never lands in a table that gets selected, logged and joined.
create table if not exists vy_channel_watch (
  watch_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  channel_url text not null,
  provider text not null default 'youtube' check (provider in ('youtube')),
  oauth_grant_ref uuid,
  last_seen_video_id text not null default '',
  last_checked_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','revoked')),
  created_at timestamptz not null default now()
);
create unique index if not exists vy_channel_watch_one_active_ix on vy_channel_watch (replica_id) where status = 'active';
create index if not exists vy_channel_watch_sweep_ix on vy_channel_watch (status, last_checked_at asc);
create index if not exists vy_channel_watch_owner_ix on vy_channel_watch (owner_user_id, replica_id);

-- One row per video, forever. The unique index below IS the idempotence law
-- ("the same video is never double-ingested"), not a performance hint. The
-- approval gate CHECK is SPEC §8's "never silent self-update of a live
-- persona" written as a predicate: 'applied' is unreachable without a named
-- approver and a decision time.
create table if not exists vy_ingest_run (
  run_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  watch_id uuid,
  video_ref text not null,
  transcript_source text not null check (transcript_source in ('asr','captions','upload')),
  stats jsonb not null default '{}'::jsonb,
  proposed_delta jsonb not null default '{}'::jsonb,
  proposed_delta_count integer not null default 0 check (proposed_delta_count >= 0),
  status text not null default 'fetched' check (status in ('fetched','transcribed','proposed','applied','rejected','failed')),
  failure_code text not null default '',
  approved_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_ingest_run_approval_gate check (status <> 'applied' or (approved_by_user_id is not null and decided_at is not null))
);
create unique index if not exists vy_ingest_run_video_ix on vy_ingest_run (replica_id, video_ref);
create index if not exists vy_ingest_run_owner_recent_ix on vy_ingest_run (owner_user_id, replica_id, created_at desc);
create index if not exists vy_ingest_run_review_ix on vy_ingest_run (replica_id, status, created_at desc);

-- ── migration 055 — vy_clone_channel: which published clone answers where ──
--
-- A surface is a TRANSPORT, never a tenant (docs/SURFACES.md §0), so this
-- table does not scope memory — it answers exactly one question: on this wire,
-- at this address, WHICH published clone replies. `api/_surface.js` used to
-- answer it with a constant (`MEERA_AGENT_ID`), which made a second clone on
-- Telegram a code change and a hundred clones a hundred of them.
--
-- `credentials_ref` is a uuid because a Telegram bot token or a Meta access
-- token cannot be cast into one — migration 053's `oauth_grant_ref` argument,
-- transferred. The value lives in api/_channel-secrets.js's backend (default
-- `none`, which refuses), never here.
--
-- The connect gate is a CHECK rather than a branch (`gate0-structural`): a
-- connected channel has an address, and a connected third-party channel also
-- has a credential reference. The partial unique index on (kind, external_ref)
-- is the routing law — without it two clones can claim one bot and the answer
-- to "who replies here" depends on write ordering.
create table if not exists vy_clone_channel (
  channel_id uuid primary key,
  agent_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  kind text not null check (kind in ('web_embed','web_widget','telegram','whatsapp','instagram_dm')),
  external_ref text not null default '',
  credentials_ref uuid,
  status text not null default 'draft' check (status in ('draft','connected','paused','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_clone_channel_connect_gate check (
    status <> 'connected'
    or (external_ref <> '' and (kind in ('web_embed','web_widget') or credentials_ref is not null))
  )
);
create unique index if not exists vy_clone_channel_route_ix on vy_clone_channel (kind, external_ref) where status = 'connected';
create unique index if not exists vy_clone_channel_one_per_kind_ix on vy_clone_channel (agent_id, kind) where status = 'connected';
create index if not exists vy_clone_channel_owner_ix on vy_clone_channel (owner_user_id, replica_id, kind);
create index if not exists vy_clone_channel_agent_ix on vy_clone_channel (agent_id, status);

-- ── migration 057 — vy_channel_attestation: "this channel is mine" ─────────
--
-- The consent artifact that gates in-house YouTube audio extraction. See
-- db/migrations/057_channel_attestation.sql for the full argument; the short
-- version is that api/_replica-consent.js has the right SHAPE (canonical
-- receipt, granted/expires/revoked, revoked rows kept) and the wrong KEY —
-- its rows are keyed by SCOPE, which is a verb, and the permission here needs
-- the OBJECT of that verb (`channel_url`) to be a column a WHERE clause can
-- name. `expires_at` is NOT NULL: a lapsed attestation stops extraction with
-- no sweep and no cleanup job, because the predicate simply stops matching.
create table if not exists vy_channel_attestation (
  attestation_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  channel_url text not null,
  provider text not null default 'youtube' check (provider in ('youtube')),
  statement_set text not null default 'channel-ownership-attestation/v1',
  policy_version text not null,
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  attestations jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists vy_channel_attestation_live_ix on vy_channel_attestation (replica_id, channel_url) where revoked_at is null;
create index if not exists vy_channel_attestation_owner_ix on vy_channel_attestation (owner_user_id, replica_id);

-- The watch records WHICH attestation authorized it. NULL means "created
-- before attestations existed", which the gate treats as UNATTESTED — it
-- fails closed rather than grandfathering.
alter table vy_channel_watch add column if not exists attestation_id uuid;
create index if not exists vy_channel_watch_attestation_ix on vy_channel_watch (attestation_id);

-- The back catalogue is a SECOND cursor walking the other way. 053's
-- `last_seen_video_id` answers "what is new"; this one answers "how far back
-- have we got", oldest-first, resumable per tick. The two can never both be
-- advanced by the same video — the unique index on (replica_id, video_ref)
-- makes the overlap a no-op.
alter table vy_channel_watch add column if not exists backfill_after_video_id text not null default '';
alter table vy_channel_watch add column if not exists backfill_state text not null default 'idle';
alter table vy_channel_watch drop constraint if exists vy_channel_watch_backfill_state_check;
alter table vy_channel_watch add constraint vy_channel_watch_backfill_state_check check (backfill_state in ('idle','running','done'));
create index if not exists vy_channel_watch_backfill_ix on vy_channel_watch (backfill_state, last_checked_at asc) where backfill_state = 'running';

-- ── migration 058 — the Context Locker (WS-AB) ────────────────────────────
--
-- The universal "bring your context" lane: an owner hands the platform files
-- and links about themselves and each one becomes an owned, consent-scoped,
-- content-hashed, quota-capped row. See db/migrations/058_context_locker.sql
-- for the full argument; the two load-bearing points are that a refusal must
-- be NAMED (the CHECK constraints below, so a future writer cannot store an
-- item as silently-ignored) and that both tables carry owner_user_id with no
-- FK, so both are deleted BY NAME in api/_replica-full-erasure.js — which is
-- what scripts/relcheck.mjs's owner-lane reach walk requires and would have
-- failed the build over.
create table if not exists vy_context_item (
  item_id         uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  kind            text not null check (kind in ('file','link')),
  format          text not null default 'unknown',
  source_name     text not null default '',
  source_url      text not null default '',
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size       bigint not null default 0 check (byte_size >= 0),
  extracted_chars integer not null default 0 check (extracted_chars >= 0),
  extractor       text not null default '',
  status          text not null default 'received'
                  check (status in ('received','extracted','mined','refused','routed')),
  refusal_reason  text not null default '',
  routed_to       text not null default '',
  mine_skip_reason text not null default '',
  authorship      text not null default 'unknown'
                  check (authorship in ('mine','not_mine','unknown')),
  owner_speaker   text not null default '',
  consent_scope   text not null default 'own_context',
  run_id          uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vy_context_item_refusal_named
    check (status <> 'refused' or refusal_reason <> ''),
  constraint vy_context_item_routing_named
    check (status <> 'routed' or routed_to <> '')
);
create unique index if not exists vy_context_item_dedup_ix on vy_context_item (replica_id, content_sha256);
create index if not exists vy_context_item_owner_ix on vy_context_item (owner_user_id, replica_id, created_at desc);
create index if not exists vy_context_item_status_ix on vy_context_item (replica_id, status, created_at desc);
create index if not exists vy_context_item_quota_ix on vy_context_item (owner_user_id) include (byte_size);

-- The extracted body a citation resolves against. Split from the row above on
-- a SIZE boundary, not a concern boundary: every list read, quota aggregate and
-- status render touches vy_context_item and none of them wants a 400 000-char
-- column coming back.
create table if not exists vy_context_item_text (
  item_id       uuid primary key,
  replica_id    uuid not null,
  owner_user_id uuid not null,
  body          text not null,
  chars         integer not null default 0 check (chars >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists vy_context_item_text_owner_ix on vy_context_item_text (owner_user_id, replica_id);

-- The review surface is NOT duplicated: a context item's proposal is a
-- vy_ingest_run row in the shape 053 already defined, so the approval gate,
-- the review read and the apply/reject ops all apply unchanged. `video_ref`
-- holds `context:<item_id>` for these rows, which makes 053's unique index on
-- (replica_id, video_ref) mean "one proposal per item".
alter table vy_ingest_run drop constraint if exists vy_ingest_run_transcript_source_check;
alter table vy_ingest_run drop constraint if exists vy_ingest_run_transcript_source_ck;
alter table vy_ingest_run add constraint vy_ingest_run_transcript_source_ck
  check (transcript_source in ('asr','captions','upload','context_item'));
-- ── migration 058 — the Mirror Call ───────────────────────────────────────
--
-- The calibration call where the clone learns from its own human, mirrored from
-- db/migrations/058_mirror_call.sql (which carries the full argument).
--
-- TWO laws these tables make structural.
--
-- 1. NEVER A SILENT SELF-UPDATE. Mining writes ONLY to vy_mirror_delta in
--    state 'proposed', and the single statement that can write a mined value
--    onto a TeacherSheet (api/_mirrorcall-store.js::decideMirrorDelta) cannot
--    fire unless that row is still UN-ACTIONED ('proposed' or 'deferred') AND
--    the owner's decision is 'accepted'. `state` is the gate, not a status column, and
--    `applied_at is null or state = 'accepted'` says so as a CHECK: a row that
--    touched the sheet without a tap cannot exist.
--
-- 2. SELECTION, NOT ACCUMULATION (`mirror-learning-is-selection-not-
--    accumulation`, 2026-08-26). Chatterbox's prepare_conditionals() truncates
--    the reference to 10 s (S3Gen) / 6 s (T3) and generate() takes ONE
--    audio_prompt_path, so a growing reference pool is mechanically inert.
--    vy_mirror_window is therefore a CANDIDATE POOL and vy_mirror_conditioning
--    is the SELECTION — at most one standing row per replica, which is what
--    makes "what does the next turn condition on" a fact rather than a race.
create table if not exists vy_mirror_session (
  session_id uuid primary key default gen_random_uuid(),
  replica_id uuid not null,
  owner_user_id uuid not null,
  state text not null default 'open' check (state in ('open','ended','aborted')),
  policy_version text not null,
  consent_scopes text[] not null default '{}'::text[],
  reference_consent boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint vy_mirror_session_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade
);
create unique index if not exists vy_mirror_session_open_ix on vy_mirror_session (replica_id) where state = 'open';
create index if not exists vy_mirror_session_owner_ix on vy_mirror_session (owner_user_id, replica_id, started_at desc);

-- `asr_state = 'dropped'` is the load-bearing value: a dropped window is a ROW,
-- kept and counted, never an absent one — an absent row is indistinguishable
-- from a window nobody sent, which is the silent-learning-loop failure the spec
-- forbids by name. duration_ms <= 30000 is Sarvam's synchronous cap, measured.
-- `transcript` is PII-scrubbed before storage. `own_voice_state` is the
-- owner-only admission predicate on the voice path, and 'unverified' FAILS
-- admission by CHECK — the fail-closed direction, because the failures it
-- guards are the clone's own output re-entering its conditioning pool and a
-- non-consenting third party's voice entering a biometric one.
create table if not exists vy_mirror_window (
  window_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id uuid not null,
  owner_user_id uuid not null,
  seq integer not null check (seq > 0),
  source_id uuid references vy_replica_source(source_id) on delete set null,
  duration_ms integer not null check (duration_ms > 0 and duration_ms <= 30000),
  lane text not null default 'sync' check (lane in ('sync')),
  asr_state text not null default 'pending' check (asr_state in ('pending','transcribed','dropped')),
  failure_code text not null default '',
  transcript text not null default '',
  asr_provider text not null default '',
  asr_model text not null default '',
  reference_admitted boolean not null default false,
  admission_reason text not null default '',
  conditioning_ms integer not null default 0 check (conditioning_ms >= 0 and conditioning_ms <= 10000),
  own_voice_state text not null default 'unverified' check (own_voice_state in ('owner_verified','clone_overlap','foreign_speaker','unverified')),
  owner_similarity real check (owner_similarity is null or (owner_similarity >= -1 and owner_similarity <= 1)),
  quality_score real check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  score_source text not null default '' check (score_source in ('','wav_probe','voice_evidence')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_mirror_window_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade,
  constraint vy_mirror_window_dropped_reason check (asr_state <> 'dropped' or failure_code <> ''),
  constraint vy_mirror_window_admission_reason check (admission_reason <> ''),
  constraint vy_mirror_window_own_voice_gate check (not reference_admitted or own_voice_state = 'owner_verified'),
  constraint vy_mirror_window_score_source check ((quality_score is null) = (score_source = ''))
);
create unique index if not exists vy_mirror_window_seq_ix on vy_mirror_window (session_id, seq);
create index if not exists vy_mirror_window_session_ix on vy_mirror_window (session_id, created_at);
create index if not exists vy_mirror_window_owner_ix on vy_mirror_window (owner_user_id, replica_id, created_at desc);
create index if not exists vy_mirror_window_candidate_ix on vy_mirror_window (replica_id, owner_user_id, quality_score desc) where reference_admitted and quality_score is not null;

-- THE CLONE'S VOICE CHANGES HERE AND NOWHERE ELSE. A new standing row means the
-- next synthesised turn conditions on different audio; no new row means it does
-- not, whatever else grew. Superseded rows are KEPT — the history of which ten
-- seconds was chosen is the only way to attribute a fidelity change to a
-- selection.
create table if not exists vy_mirror_conditioning (
  selection_id uuid primary key default gen_random_uuid(),
  replica_id uuid not null,
  owner_user_id uuid not null,
  window_id uuid not null references vy_mirror_window(window_id) on delete cascade,
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  score real not null check (score >= 0 and score <= 1),
  conditioning_ms integer not null check (conditioning_ms > 0 and conditioning_ms <= 10000),
  score_source text not null check (score_source in ('wav_probe','voice_evidence')),
  selected_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint vy_mirror_conditioning_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade
);
create unique index if not exists vy_mirror_conditioning_standing_ix on vy_mirror_conditioning (replica_id) where superseded_at is null;
create index if not exists vy_mirror_conditioning_history_ix on vy_mirror_conditioning (replica_id, selected_at desc);
create index if not exists vy_mirror_conditioning_owner_ix on vy_mirror_conditioning (owner_user_id, replica_id, selected_at desc);

-- target_field '' means ADVISORY: the chip records a measurement and writes no
-- sheet field, ever. Only the two phrase-bank fields are writable, because
-- every other mined ING field is a PROSE register bullet and a statistical pass
-- writing prose into a prompt is `recited-prompt` exactly. `origin` keeps
-- mined-from-behaviour and accepted-from-judgement in SEPARATE columns so the
-- Mirror Call's sycophancy drift (the owner judging a clone of themselves) is
-- measurable rather than silently averaged; a judgement may never write a field.
-- `occurrences` / `corpus_tokens` are columns, not jsonb keys, so a studio
-- cannot render a mined claim without the n behind it.
create table if not exists vy_mirror_delta (
  delta_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id uuid not null,
  owner_user_id uuid not null,
  kind text not null check (kind in ('phrase_habit','slang_habit','filler_advisory','laughter_advisory','stretch_advisory','code_switch_advisory','feedback_note')),
  origin text not null default 'mined' check (origin in ('mined','judgement')),
  occurrences integer not null default 0 check (occurrences >= 0),
  corpus_tokens integer not null default 0 check (corpus_tokens >= 0),
  fragment text not null default '',
  target_field text not null default '' check (target_field in ('','boardVerbalisms','exSlangRepeat')),
  evidence jsonb not null default '{}'::jsonb,
  citation jsonb not null default '{}'::jsonb,
  cited_windows integer[] not null default '{}'::integer[],
  state text not null default 'proposed' check (state in ('proposed','deferred','accepted','rejected')),
  applied_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_mirror_delta_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade,
  constraint vy_mirror_delta_cited check (target_field = '' or cardinality(cited_windows) >= 1),
  constraint vy_mirror_delta_fragment_shape check (target_field = '' or (fragment <> '' and fragment !~ '[.!?]' and length(fragment) <= 64)),
  constraint vy_mirror_delta_applied_gate check (applied_at is null or state = 'accepted'),
  constraint vy_mirror_delta_origin_evidence check (origin <> 'mined' or (occurrences >= 1 and corpus_tokens >= 1)),
  constraint vy_mirror_delta_judgement_advisory check (origin <> 'judgement' or target_field = '')
);
create unique index if not exists vy_mirror_delta_habit_ix on vy_mirror_delta (session_id, kind, fragment);
create index if not exists vy_mirror_delta_open_ix on vy_mirror_delta (session_id, state, created_at);
create index if not exists vy_mirror_delta_owner_ix on vy_mirror_delta (owner_user_id, replica_id, created_at desc);

-- Explicit owner feedback, bound to the clone turn it judged. rephrase_text is
-- EVIDENCE and deliberately not a delta target: a whole sentence the owner
-- typed is the most recitable thing that could enter a prompt.
create table if not exists vy_mirror_feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id uuid not null,
  owner_user_id uuid not null,
  turn_ref text not null check (turn_ref <> '' and length(turn_ref) <= 128),
  verdict text not null check (verdict in ('up','down','rephrase')),
  rephrase_text text not null default '' check (length(rephrase_text) <= 2000),
  created_at timestamptz not null default now(),
  constraint vy_mirror_feedback_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade,
  constraint vy_mirror_feedback_rephrase_present check (verdict <> 'rephrase' or rephrase_text <> '')
);
create unique index if not exists vy_mirror_feedback_turn_ix on vy_mirror_feedback (session_id, turn_ref);
create index if not exists vy_mirror_feedback_owner_ix on vy_mirror_feedback (owner_user_id, replica_id, created_at desc);

-- A QUEUE ROW, NOT A RUN. No lease columns, no attempt counter, and no worker
-- anywhere in this repo. That absence is the honest statement: a fine-tune
-- takes GPU-minutes and a row that implied otherwise would be a fake progress
-- bar. Inserted only when the session actually admitted candidate audio.
-- `lane` is a ONE-VALUE enum on purpose: sequential per-speaker fine-tuning on
-- a shared base collapses a multi-speaker TTS toward the newest speaker, and
-- the remedy the literature names is one adapter per expert composed at load.
-- A shared-base job cannot be enqueued because there is no value for it.
create table if not exists vy_mirror_finetune_job (
  job_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  replica_id uuid not null,
  owner_user_id uuid not null,
  state text not null default 'queued' check (state in ('queued','cancelled')),
  lane text not null default 'per_expert_adapter' check (lane in ('per_expert_adapter')),
  reference_windows integer not null default 0 check (reference_windows >= 0),
  reference_ms integer not null default 0 check (reference_ms >= 0),
  requested_at timestamptz not null default now(),
  constraint vy_mirror_finetune_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade
);
create unique index if not exists vy_mirror_finetune_session_ix on vy_mirror_finetune_job (session_id);
create index if not exists vy_mirror_finetune_queue_ix on vy_mirror_finetune_job (state, requested_at) where state = 'queued';
create index if not exists vy_mirror_finetune_owner_ix on vy_mirror_finetune_job (owner_user_id, replica_id, requested_at desc);

-- The clone's own half of a Mirror Call (migration 060, WS-AC). The turn is a
-- ROW rather than a response field because `turn_voice` synthesises the text in
-- this row and never the text in its query string — the studio cannot make the
-- clone say anything the server did not author, and that is the absence of a
-- column rather than a check. `sheet_source` says which persona answered:
-- calibrating before publishing is the normal case, so the draft sheet replies,
-- and an owner who cannot tell a published clone from a draft one cannot judge
-- either. There is deliberately no third value for a generic assistant.
create table if not exists vy_mirror_turn (
  turn_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  window_id uuid not null references vy_mirror_window(window_id) on delete cascade,
  replica_id uuid not null,
  owner_user_id uuid not null,
  seq integer not null check (seq > 0),
  text text not null check (text <> ''),
  assembled_chars integer not null default 0 check (assembled_chars >= 0),
  sheet_id uuid,
  sheet_source text not null check (sheet_source in ('published','draft')),
  agent_slug text not null default '',
  gate_applied boolean not null default false,
  gate_findings integer not null default 0 check (gate_findings >= 0),
  generation_id uuid,
  voice_state text not null default 'unspoken' check (voice_state in ('unspoken','warming','spoken','refused')),
  voice_failure_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_mirror_turn_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade,
  constraint vy_mirror_turn_voice_reason check (voice_state <> 'refused' or voice_failure_code <> ''),
  constraint vy_mirror_turn_spoken_binding check (voice_state <> 'spoken' or generation_id is not null)
);
create unique index if not exists vy_mirror_turn_window_ix on vy_mirror_turn (window_id);
create index if not exists vy_mirror_turn_session_ix on vy_mirror_turn (session_id, seq);
create index if not exists vy_mirror_turn_owner_ix on vy_mirror_turn (owner_user_id, replica_id, created_at desc);
-- ── migration 061 — one link, one clone: single-video enrollment ─────────
-- Mirrored from db/migrations/061_video_enrollment.sql. The lane is
-- api/_video-enroll.js; the reference-window ranking is the measurement
-- (context/measurements.md#reference-window-beats-the-finetune) and that is
-- why the windows are columns rather than jsonb.
create table if not exists vy_video_enrollment (
  enrollment_id   uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  -- The 11-character id, never a URL. `api/_video-enroll.js`'s `parseVideoUrl`
  -- reduces whatever the teacher pasted to this before anything is stored, so
  -- no row can carry a host, a redirect or a tracking parameter.
  video_id        text not null,
  -- The attested channel, denormalized from the attestation so the daily
  -- quota query and the erasure walk never have to join to it.
  channel_url     text not null,
  provider        text not null default 'youtube'
                  check (provider in ('youtube')),
  -- FK-shaped, into vy_channel_attestation. Nullable ONLY so a row refused at
  -- admission can still be recorded; the lane never inserts a working row
  -- without it.
  attestation_id  uuid,
  state           text not null default 'admitted'
                  check (state in ('admitted','extracting','scoring','transcribing','ready','refused','failed')),
  -- The named reason. A lane whose failures are all 'failed' is a lane an
  -- operator reads a log to understand; every code this column holds is one
  -- `services/media-extract` or the quota predicate produced by name —
  -- `extractor_bot_check` and `video_enroll_owner_daily_cap` are different
  -- problems with different fixes and they must not look alike on a screen.
  failure_code    text,
  duration_ms     bigint,
  audio_bytes     bigint,
  object_path     text,
  -- The chosen reference window. Stored on the parent as well as in the
  -- child table because "what is this replica speaking from" is a one-row
  -- question asked on every studio render, and answering it with a join to a
  -- ranked list ordered by score is how a hot path acquires a sort.
  selected_window_start_ms  integer,
  selected_window_length_ms integer,
  selected_window_score     numeric(6,4),
  -- Says what produced the score, on every row, forever. Today it is a WAV
  -- signal probe and NOT an ECAPA fidelity measurement; when a real scorer
  -- lands, old rows must remain readable as what they actually were rather
  -- than being silently reinterpreted (`score_source` is WS-X's rule on
  -- `mirror_call`'s conditioning score, applied here for the same reason).
  score_source    text not null default 'wav-signal-probe/v1',
  transcript_chars integer,
  -- Per-stage wall clock and outcome, appended as the lane runs. This is
  -- where `measurements.md`'s per-clone cost number comes from, and it
  -- records FAILED stages too: the cost of a bot check is a real cost, and a
  -- table that only counted successes would understate the lane exactly
  -- where it is going wrong.
  receipts        jsonb not null default '[]'::jsonb,
  -- Generated, not supplied: the day the quota counts against. A client-
  -- supplied day is a client-supplied quota reset.
  enrollment_day  date not null generated always as ((created_at at time zone 'UTC')::date) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The idempotency key AND the double-click guard. One owner enrolling the
-- same video twice in a day is a no-op that returns the existing row rather
-- than a second extraction, a second ASR bill and a second quota slot.
create unique index if not exists vy_video_enrollment_daily_ix
  on vy_video_enrollment (owner_user_id, video_id, enrollment_day);

create index if not exists vy_video_enrollment_owner_ix
  on vy_video_enrollment (replica_id, owner_user_id, created_at desc);

-- The quota query's index. It counts rows in chargeable states created today,
-- globally and per owner, in ONE statement — a partial index on the states
-- that cost money keeps that count off a sequential scan as the table grows.
create index if not exists vy_video_enrollment_quota_ix
  on vy_video_enrollment (created_at desc)
  where state in ('extracting','scoring','transcribing','ready');

create table if not exists vy_video_enrollment_window (
  window_id       uuid primary key,
  enrollment_id   uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  rank            integer not null,
  start_ms        integer not null,
  end_ms          integer not null,
  score           numeric(6,4) not null,
  voiced_fraction numeric(6,4) not null,
  snr_db          numeric(7,2) not null,
  clipping_fraction numeric(9,6) not null,
  -- NULL means "diarization did not run", and that is a different fact from
  -- 1.0 ("measured, and it is one speaker"). Defaulting the unmeasured case
  -- to perfect purity is how a window containing a student's question becomes
  -- the voice of the clone.
  speaker_purity  numeric(6,4),
  score_source    text not null default 'wav-signal-probe/v1',
  metrics         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Idempotent re-scoring: the same window of the same enrollment is one row.
create unique index if not exists vy_video_enrollment_window_ix
  on vy_video_enrollment_window (enrollment_id, start_ms);

create index if not exists vy_video_enrollment_window_rank_ix
  on vy_video_enrollment_window (enrollment_id, rank asc);

-- The erasure reach. `api/_replica-full-erasure.js` deletes by replica; this
-- index is what makes that delete a lookup rather than a scan, and its
-- existence here is the reminder that BOTH new tables are in the walk.
create index if not exists vy_video_enrollment_window_owner_ix
  on vy_video_enrollment_window (replica_id, owner_user_id);
-- ── migration 062 — vy_replica_activity: the one honest activity trail ─────
--
-- The owner's ask: "I should also see that have we received the YT video and
-- that processing done or not, and all the other processing going on we should
-- see, in a user view." Every lane already had a `state` column and an
-- `updated_at`; between them they answer "what is this row's state right now"
-- and nothing else. This append-only transition log answers when work started,
-- when it finished, how long it sat, and what the failure BEFORE the last one
-- was, for every lane at once.
--
-- There is no `progress` column and there will not be one. Exactly one lane in
-- this platform can compute a real fraction (the enrollment DAG: completed
-- steps over the eight in AUDIO_PROCESSING_DAG) and it computes it from rows
-- that already exist. A column here would invite the other six lanes to fill
-- it, and a bar that moves on a schedule rather than on work is
-- `plausible-return-hides-a-dead-pipeline` rendered in paint.
--
-- `state` is a CHECK over the same seven values the read API and the UI use, so
-- a lane cannot invent an eighth nothing knows how to render.
-- `vy_replica_activity_failure_named` is 058's refusal-named argument
-- transferred: a writer that records `failed` and forgets the reason is refused
-- by Postgres, not by a code review.
--
-- `dedupe_key` is OPT-IN at-most-once. A sweep that ticks twice a minute passes
-- one and the partial index makes the second write a no-op; a lane that wants
-- every transition passes '' and the index does not apply. Dedupe by default
-- would have silently collapsed the retry history this table exists to keep.
create table if not exists vy_replica_activity (
  event_id      uuid primary key default gen_random_uuid(),
  replica_id    uuid not null,
  owner_user_id uuid not null,
  lane          text not null
                check (lane in ('upload_processing','context_item','channel_watch',
                                'channel_video','voice_model_build','mirror_finetune','erasure')),
  job_ref       text not null,
  subject       text not null default '',
  state         text not null
                check (state in ('queued','running','waiting_on_you','done','failed','blocked','cancelled')),
  reason        text not null default '',
  dedupe_key    text not null default '',
  at            timestamptz not null default now(),
  constraint vy_replica_activity_job_ref_present check (job_ref <> ''),
  constraint vy_replica_activity_failure_named
    check (state not in ('failed','blocked') or reason <> ''),
  constraint vy_replica_activity_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica (replica_id, owner_user_id) on delete cascade
);
create index if not exists vy_replica_activity_owner_ix
  on vy_replica_activity (owner_user_id, replica_id, at desc);
create index if not exists vy_replica_activity_job_ix
  on vy_replica_activity (replica_id, lane, job_ref, at);
create unique index if not exists vy_replica_activity_dedupe_ix
  on vy_replica_activity (replica_id, dedupe_key) where dedupe_key <> '';

-- The owner asked whether we received "the YT video". `video_ref` holds
-- `dQw4w9WgXcQ` and nobody recognises their own lecture by its YouTube id. The
-- title is already on the object the provider hands us and was simply never
-- persisted.
alter table vy_ingest_run add column if not exists video_title text not null default '';

-- `plausible-return-hides-a-dead-pipeline`, live: sweepWatch() catches a
-- listing failure and touchWatch() writes `last_checked_at = now()`, so a
-- channel failing every tick for a week looks exactly like one checked every
-- tick with nothing new. The failure this lane already predicts
-- (`channel_extract_extractor_bot_check` from a datacenter IP) lands in exactly
-- that swallowed catch.
alter table vy_channel_watch add column if not exists last_sweep_state text not null default '';
alter table vy_channel_watch add column if not exists last_sweep_reason text not null default '';
alter table vy_channel_watch add column if not exists last_sweep_videos integer not null default 0;
alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_state_named;
alter table vy_channel_watch add constraint vy_channel_watch_sweep_state_named
  check (last_sweep_state in ('','checked','failed'));
alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_failure_named;
alter table vy_channel_watch add constraint vy_channel_watch_sweep_failure_named
  check (last_sweep_state <> 'failed' or last_sweep_reason <> '');
alter table vy_channel_watch drop constraint if exists vy_channel_watch_sweep_videos_nonneg;
alter table vy_channel_watch add constraint vy_channel_watch_sweep_videos_nonneg
  check (last_sweep_videos >= 0);

-- Migration 063 — REPLICA_SELF_TEST_MODE provenance (WS-AQ). Every table an
-- auto-grant from the self-test flag can touch gets a `metadata` jsonb column
-- so the grants are findable and revocable by one query; see
-- api/_replica-processing/self-test.js for the flag itself, default OFF.
alter table vy_replica
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table vy_replica_processing_evidence_decision
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table vy_replica_processing_artifact_decision
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists vy_replica_self_test_ix
  on vy_replica ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';
create index if not exists vy_replica_evidence_decision_self_test_ix
  on vy_replica_processing_evidence_decision ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';
create index if not exists vy_replica_artifact_decision_self_test_ix
  on vy_replica_processing_artifact_decision ((metadata ->> 'self_test_mode'))
  where metadata ->> 'self_test_mode' = 'true';

-- Migration 064 - room addresses are unique per agent. Migration 055 routes
-- each credential to one clone, so two different clones may see the same
-- opaque chat id without sharing a room or blocking one another's insert.
-- Create the replacements before dropping the global constraints so an
-- interrupted statement-by-statement migration never removes uniqueness.
create unique index if not exists vy_group_agent_surface_chat_ix
  on vy_group (agent_id, surface, surface_chat_id)
  where surface is not null and surface_chat_id is not null;
create unique index if not exists vy_group_agent_tg_chat_ix
  on vy_group (agent_id, tg_chat_id)
  where tg_chat_id is not null;
drop index if exists vy_group_surface_chat_ix;
drop index if exists vy_group_tg_chat_ix;

-- Migration 065 - the multilingual preview receipt adds the bounded text-plan
-- and language-conditioning audit to preview_style. Preserve the object-shape
-- rule while replacing migration 046's now-obsolete 512-byte ceiling.
alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_style_check,
  add constraint vy_replica_generation_preview_style_check
    check (jsonb_typeof(preview_style)='object' and octet_length(preview_style::text)<=2048);

-- Migration 072 - owner identity by SPEAKER VERIFICATION (WS-R2). The third
-- path past identity_verification_required / liveness_verification_required,
-- beside the never-deployed Azure stack (039-041) and the owner-bound
-- REPLICA_SELF_TEST_MODE flag (063). The owner speaks a freshly issued
-- sentence on camera; the deployed voice-evidence service embeds it and
-- Sarvam transcribes it; the two numbers decide. The decision is a ROW and
-- the existing gate reads it through the SAME vy_replica columns the Azure
-- path would have written. No FKs on replica_id/owner_user_id (009's
-- WHERE-clause binding), so this table is deleted BY NAME in
-- api/_replica-full-erasure.js and relcheck's owner-lane walk enforces that.
create table if not exists vy_replica_voice_challenge (
  challenge_id              uuid primary key default gen_random_uuid(),
  replica_id                uuid not null,
  owner_user_id             uuid not null,
  sentence                  text not null,
  sentence_hash             text not null,
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
alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_decision_check,
  add constraint vy_replica_voice_challenge_decision_check
    check ((state in ('verified','failed')) = (decision <> '' and decided_at is not null));
create unique index if not exists vy_replica_voice_challenge_owner_tuple_ix
  on vy_replica_voice_challenge (challenge_id,replica_id,owner_user_id);
create index if not exists vy_replica_voice_challenge_latest_ix
  on vy_replica_voice_challenge (replica_id,owner_user_id,issued_at desc);
create index if not exists vy_replica_voice_challenge_ready_ix
  on vy_replica_voice_challenge (verification_next_attempt_at,issued_at)
  where state in ('captured','verifying');
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
alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','identity_document',
                            'identity_challenge','upload','import','derived'));
-- Migration 074 - the review queue: vy_review_card + vy_review_never_rule, and
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
    check (purpose in ('memory','identity_document','correction','interview'));

create index if not exists vy_replica_source_correction_ix
  on vy_replica_source (replica_id, owner_user_id, created_at desc)
  where purpose = 'correction';
-- Migration 073 - vy_replica_readiness: the readiness snapshot behind the one
-- creator screen (one number, five parts, one action, one publish lock).
-- `parts` is the truth; `overall`, `min_part` and `unmeasured_count` are its
-- projections and exist as columns because the publish lock is a SQL predicate
-- inside two much larger statements (runtime activation, channel connect) and
-- a jsonb path expression in that position is the kind of thing a later edit
-- gets subtly wrong. A wrong lock opens. The two paired CHECKs make
-- DESIGN-LAW §1's "the overall is undefined until every part has a value"
-- unrepresentable rather than merely observed. No FK (009's convention);
-- deleted by name in api/_replica-full-erasure.js.
create table if not exists vy_replica_readiness (
  readiness_id     uuid primary key default gen_random_uuid(),
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  computed_at      timestamptz not null default now(),
  policy_version   text not null default '',
  overall          integer,
  min_part         integer,
  unmeasured_count integer not null,
  parts            jsonb not null default '{}'::jsonb,
  blockers         jsonb not null default '[]'::jsonb,
  suggested_action jsonb not null default '{}'::jsonb,
  inputs_hash      text not null,
  constraint vy_replica_readiness_unmeasured_range check (unmeasured_count >= 0 and unmeasured_count <= 5),
  constraint vy_replica_readiness_overall_range check (overall is null or (overall >= 0 and overall <= 100)),
  constraint vy_replica_readiness_min_part_range check (min_part is null or (min_part >= 0 and min_part <= 100)),
  constraint vy_replica_readiness_overall_undefined
    check ((unmeasured_count > 0 and overall is null) or (unmeasured_count = 0 and overall is not null)),
  constraint vy_replica_readiness_min_part_pairs
    check ((overall is null and min_part is null) or (overall is not null and min_part is not null)),
  constraint vy_replica_readiness_inputs_hash check (inputs_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_readiness_parts_object
    check (jsonb_typeof(parts) = 'object' and jsonb_typeof(suggested_action) = 'object'
           and jsonb_typeof(blockers) = 'array')
);
create index if not exists vy_replica_readiness_latest_ix
  on vy_replica_readiness (replica_id, owner_user_id, computed_at desc);
create index if not exists vy_replica_readiness_inputs_ix
  on vy_replica_readiness (replica_id, inputs_hash, computed_at desc);
-- Migration 075 - the interview: the Mirror Call re-pointed at the gaps in the
-- archive (WS-R5). `purpose` on vy_replica_source is what lets retrieval prefer
-- conversational material for register; the two tables below are the interview
-- itself, and every one of their rows hangs off a Mirror Call session so there
-- is no second transport, no second consent freeze and no second reply lane.
alter table vy_replica_source add column if not exists purpose text not null default 'memory';
alter table vy_replica_source drop constraint if exists vy_replica_source_purpose_check;
alter table vy_replica_source add constraint vy_replica_source_purpose_check
  check (purpose in ('memory','identity_document','correction','interview'));
create index if not exists vy_replica_source_purpose_ix
  on vy_replica_source (replica_id, owner_user_id, purpose);
create table if not exists vy_interview_session (
  session_id        uuid primary key default gen_random_uuid(),
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  mirror_session_id uuid not null references vy_mirror_session(session_id) on delete cascade,
  policy_version    text not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  gaps              jsonb not null default '[]'::jsonb,
  questions_asked   integer not null default 0 check (questions_asked >= 0),
  answers_captured  integer not null default 0 check (answers_captured >= 0),
  updated_at        timestamptz not null default now(),
  constraint vy_interview_session_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade,
  constraint vy_interview_session_gaps_shape check (jsonb_typeof(gaps) = 'array' and octet_length(gaps::text) <= 32768),
  constraint vy_interview_session_answer_gate check (answers_captured <= questions_asked)
);
create unique index if not exists vy_interview_session_mirror_ix on vy_interview_session (mirror_session_id);
create index if not exists vy_interview_session_owner_ix on vy_interview_session (owner_user_id, replica_id, started_at desc);
create table if not exists vy_interview_answer (
  answer_id          uuid primary key default gen_random_uuid(),
  session_id         uuid not null references vy_interview_session(session_id) on delete cascade,
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  gap_kind           text not null check (gap_kind in ('contradiction','sheet_field','thin_topic','readiness')),
  topic              text not null check (topic <> '' and length(topic) <= 120),
  question_shape_hash text not null check (question_shape_hash ~ '^[0-9a-f]{64}$'),
  source_id          uuid references vy_replica_source(source_id) on delete set null,
  window_id          uuid references vy_mirror_window(window_id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint vy_interview_answer_owner_fk foreign key (replica_id, owner_user_id) references vy_replica (replica_id, owner_user_id) on delete cascade
);
create unique index if not exists vy_interview_answer_shape_ix on vy_interview_answer (session_id, question_shape_hash);
create index if not exists vy_interview_answer_session_ix on vy_interview_answer (session_id, created_at);
create index if not exists vy_interview_answer_owner_ix on vy_interview_answer (owner_user_id, replica_id, created_at desc);
create index if not exists vy_interview_answer_shape_history_ix on vy_interview_answer (replica_id, owner_user_id, question_shape_hash);
-- Migration 071 - the Room: the follower's side of a published replica.
-- vy_room is the OWNER lane (deleted by name in api/_replica-full-erasure.js);
-- vy_room_follower and vy_room_thread are the PERSON lane (PERSON_TABLES,
-- gated in activePersonTables() on this migration having landed). No column in
-- any of the three can hold anything anybody said, and none ever may - 012's
-- content law, and 016's reason for restating it on a consent ledger.
create table if not exists vy_room (
  room_id               uuid primary key,
  slug                  text not null,
  replica_id            uuid not null,
  agent_id              uuid not null,
  owner_user_id         uuid not null,
  display_name          text not null default '',
  free_monthly_messages integer not null default 20
                        check (free_monthly_messages >= 0 and free_monthly_messages <= 100000),
  published_at          timestamptz,
  paused_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists vy_room_slug_ix on vy_room (lower(slug));
create unique index if not exists vy_room_replica_ix on vy_room (replica_id);
create index if not exists vy_room_owner_ix on vy_room (owner_user_id, replica_id);
create index if not exists vy_room_agent_ix on vy_room (agent_id);
create table if not exists vy_room_follower (
  follower_id         uuid primary key,
  room_id             uuid not null references vy_room(room_id) on delete cascade,
  person_id           uuid not null,
  agent_id            uuid not null,
  joined_at           timestamptz not null default now(),
  age_attested_at     timestamptz,
  memory_consent_at   timestamptz,
  tier                text not null default 'free' check (tier in ('free','paid')),
  month_key           text not null default '',
  month_message_count integer not null default 0 check (month_message_count >= 0),
  last_seen_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists vy_room_follower_person_ix
  on vy_room_follower (room_id, person_id);
create index if not exists vy_room_follower_scope_ix
  on vy_room_follower (person_id, agent_id);
create index if not exists vy_room_follower_room_seen_ix
  on vy_room_follower (room_id, last_seen_at desc);
create table if not exists vy_room_thread (
  thread_id       uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  agent_id        uuid not null,
  title           text not null default '' check (length(title) <= 80),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  archived_at     timestamptz
);
create index if not exists vy_room_thread_scope_ix
  on vy_room_thread (person_id, room_id, last_message_at desc);
create unique index if not exists vy_room_thread_title_ix
  on vy_room_thread (room_id, person_id, lower(title))
  where archived_at is null and title <> '';

-- Migration 076 - vy_replica_drift_report: the history behind "it notices
-- drift" (WS-R9). No FK on replica/owner (009's convention); deleted by name
-- in api/_replica-full-erasure.js.
create table if not exists vy_replica_drift_report (
  report_id                uuid primary key default gen_random_uuid(),
  replica_id               uuid not null,
  owner_user_id            uuid not null,
  computed_at              timestamptz not null default now(),
  state                    text not null,
  score                    double precision,
  ceiling                  double precision,
  trend                    jsonb not null default '[]'::jsonb,
  last_model_change_at     timestamptz,
  last_model_commitment    text,
  prosody_anchor_stale     boolean not null,
  inputs_hash              text not null,
  alerted_at               timestamptz,
  constraint vy_replica_drift_report_state_check
    check (state in ('steady','moved','not_measured')),
  constraint vy_replica_drift_report_measured_shape check (
    (state = 'not_measured' and (score is null or ceiling is null))
    or (state in ('steady','moved') and score is not null and ceiling is not null)
  ),
  constraint vy_replica_drift_report_score_range
    check (score is null or (score >= -1 and score <= 1)),
  constraint vy_replica_drift_report_ceiling_range
    check (ceiling is null or (ceiling > 0 and ceiling <= 1)),
  constraint vy_replica_drift_report_inputs_hash
    check (inputs_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_drift_report_commitment_hash
    check (last_model_commitment is null or last_model_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_drift_report_swap_pairs
    check ((last_model_change_at is null) = (last_model_commitment is null)),
  constraint vy_replica_drift_report_trend_array
    check (jsonb_typeof(trend) = 'array' and octet_length(trend::text) <= 8192),
  constraint vy_replica_drift_report_alert_shape
    check (alerted_at is null or state = 'moved')
);
create index if not exists vy_replica_drift_report_latest_ix
  on vy_replica_drift_report (replica_id, owner_user_id, computed_at desc);
create index if not exists vy_replica_drift_report_inputs_ix
  on vy_replica_drift_report (replica_id, inputs_hash, computed_at desc);
create index if not exists vy_replica_drift_report_alerts_ix
  on vy_replica_drift_report (owner_user_id, alerted_at desc)
  where alerted_at is not null;

-- Migration 077 - the Room's cohort day table (WS-R12): one row per
-- (room, follower, day) turns count. PERSON lane (PERSON_TABLES, gated in
-- activePersonTables() on this migration having landed). Content-free like
-- vy_room_follower/vy_room_thread: an id, a date and a count, never a word.
create table if not exists vy_room_follower_day (
  room_id   uuid not null references vy_room(room_id) on delete cascade,
  person_id uuid not null,
  day       date not null,
  turns     integer not null default 0 check (turns >= 0),
  primary key (room_id, person_id, day)
);
create index if not exists vy_room_follower_day_scope_ix
  on vy_room_follower_day (room_id, person_id, day);
-- Migration 078 - the durable ledger and provider seam for Rooms money
-- (WS-R11). No FK on owner/person (009's convention); vy_room_price and
-- vy_creator_payout deleted by name in api/_replica-full-erasure.js;
-- vy_room_subscription is in api/memory.js's PERSON_TABLES (lane
-- "relational", wipeWhere "state in ('cancelled','expired')" - a live mandate
-- survives an account wipe rather than being silently orphaned);
-- vy_payment_event is reached only by cascade (no owner/person column of its
-- own, addressed by room_id/subscription_id like a real payment ledger).
create table if not exists vy_room_price (
  price_id           uuid primary key default gen_random_uuid(),
  room_id            uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id      uuid not null,
  follower_price_inr integer not null default 299,
  currency           text not null default 'INR',
  platform_take_bp   integer not null default 2500,
  updated_at         timestamptz not null default now(),
  constraint vy_room_price_band check (follower_price_inr >= 299 and follower_price_inr <= 599),
  constraint vy_room_price_currency check (currency = 'INR'),
  constraint vy_room_price_take_bp check (platform_take_bp >= 0 and platform_take_bp <= 10000)
);
create unique index if not exists vy_room_price_room_ix on vy_room_price (room_id);
create index if not exists vy_room_price_owner_ix on vy_room_price (owner_user_id, room_id);

create table if not exists vy_room_subscription (
  subscription_id         uuid primary key default gen_random_uuid(),
  room_id                 uuid not null references vy_room(room_id) on delete cascade,
  person_id               uuid not null,
  follower_id             uuid not null references vy_room_follower(follower_id) on delete cascade,
  provider                text not null,
  provider_subscription_ref text,
  state                   text not null default 'created',
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint vy_room_subscription_provider_check check (provider in ('razorpay','fake')),
  constraint vy_room_subscription_state_check
    check (state in ('created','authenticated','active','paused','cancelled','expired'))
);
create index if not exists vy_room_subscription_room_person_ix on vy_room_subscription (room_id, person_id);
create unique index if not exists vy_room_subscription_provider_ref_ix
  on vy_room_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;
create unique index if not exists vy_room_subscription_follower_live_ix
  on vy_room_subscription (follower_id)
  where state in ('created','authenticated','active','paused');
create index if not exists vy_room_subscription_follower_ix on vy_room_subscription (follower_id, created_at desc);

-- Migration 091 - Suites v0, the B2B unit (WS-R28). See
-- db/migrations/091_org_suites.sql for the full argument; mirrored here per
-- this file's own convention. `vy_org.created_by_user_id` is deliberately
-- NOT named `owner_user_id` - the org survives a creator's own erasure even
-- as its last admin, so it must never be a table scripts/relcheck.mjs's
-- owner-lane walk asks api/_replica-full-erasure.js to justify deleting.
-- `vy_room.org_id` is ON DELETE SET NULL, not CASCADE, so a Suite going away
-- never silently deletes a Room, its followers or its revenue.
create table if not exists vy_org (
  org_id             uuid primary key default gen_random_uuid(),
  name               text not null check (length(name) > 0 and length(name) <= 120),
  slug               text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  created_by_user_id uuid not null,
  plan               text not null default 'starter' check (plan in ('starter', 'institute')),
  seat_limit         integer not null default 1 check (seat_limit >= 1 and seat_limit <= 500),
  created_at         timestamptz not null default now()
);
create unique index if not exists vy_org_slug_ix on vy_org (lower(slug));
create index if not exists vy_org_created_by_ix on vy_org (created_by_user_id);

create table if not exists vy_org_member (
  org_id        uuid not null references vy_org(org_id) on delete cascade,
  owner_user_id uuid not null,
  role          text not null check (role in ('admin', 'creator')),
  added_at      timestamptz not null default now(),
  primary key (org_id, owner_user_id)
);
create index if not exists vy_org_member_owner_ix on vy_org_member (owner_user_id);
create index if not exists vy_org_member_org_role_ix on vy_org_member (org_id, role);

alter table vy_room add column if not exists org_id uuid references vy_org(org_id) on delete set null;
create index if not exists vy_room_org_ix on vy_room (org_id) where org_id is not null;

create table if not exists vy_org_subscription (
  subscription_id            uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references vy_org(org_id) on delete cascade,
  plan                       text not null check (plan in ('starter', 'institute')),
  seats                      integer not null check (seats >= 1 and seats <= 500),
  price_per_seat_inr         integer not null check (price_per_seat_inr > 0),
  currency                   text not null default 'INR' check (currency = 'INR'),
  state                      text not null default 'created'
                             check (state in ('created', 'authenticated', 'active', 'paused', 'cancelled', 'expired')),
  provider                   text not null check (provider in ('razorpay', 'fake')),
  provider_subscription_ref  text,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create unique index if not exists vy_org_subscription_org_live_ix
  on vy_org_subscription (org_id)
  where state in ('created', 'authenticated', 'active', 'paused');
create unique index if not exists vy_org_subscription_provider_ref_ix
  on vy_org_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;
create index if not exists vy_org_subscription_org_ix on vy_org_subscription (org_id, created_at desc);

-- Migration 095 (WS-R33) widened this table with a Suite lane: room_id and
-- subscription_id (the follower lane) are now NULLABLE, and org_id/
-- org_subscription_id (the Suite lane) were added, with a CHECK making the
-- two lanes mutually exclusive - see that migration's own header.
create table if not exists vy_payment_event (
  event_id            uuid primary key default gen_random_uuid(),
  provider             text not null,
  provider_event_ref   text not null,
  room_id              uuid references vy_room(room_id) on delete cascade,
  subscription_id      uuid references vy_room_subscription(subscription_id) on delete cascade,
  org_id               uuid references vy_org(org_id) on delete set null,
  org_subscription_id  uuid references vy_org_subscription(subscription_id) on delete cascade,
  kind                 text not null,
  amount_inr           integer not null default 0,
  platform_take_inr    integer not null default 0,
  creator_share_inr    integer not null default 0,
  received_at          timestamptz not null default now(),
  signature_verified   boolean not null,
  payload_hash         text not null,
  constraint vy_payment_event_provider_check check (provider in ('razorpay','fake')),
  -- Widened by migration 133 (WS-R130) to admit 'referral_reward' - a
  -- zero-amount, platform-authored row for a granted referral reward,
  -- never a provider webhook event. See that migration's own header.
  constraint vy_payment_event_kind_check check (kind in (
    'subscription.authenticated','subscription.activated','subscription.charged',
    'subscription.completed','subscription.cancelled','subscription.paused',
    'subscription.resumed','subscription.pending','subscription.halted',
    'payment.failed','referral_reward'
  )),
  constraint vy_payment_event_amounts_nonneg
    check (amount_inr >= 0 and platform_take_inr >= 0 and creator_share_inr >= 0),
  constraint vy_payment_event_split_sums check (platform_take_inr + creator_share_inr = amount_inr),
  constraint vy_payment_event_signature_verified check (signature_verified = true),
  constraint vy_payment_event_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_payment_event_one_lane check (
    (room_id is not null and subscription_id is not null and org_id is null and org_subscription_id is null)
    or
    (room_id is null and subscription_id is null and org_id is not null and org_subscription_id is not null)
  )
);
create unique index if not exists vy_payment_event_provider_ref_ix on vy_payment_event (provider, provider_event_ref);
create index if not exists vy_payment_event_subscription_ix on vy_payment_event (subscription_id, received_at desc);
create index if not exists vy_payment_event_room_ix on vy_payment_event (room_id, received_at desc);
create index if not exists vy_payment_event_org_ix on vy_payment_event (org_id, received_at desc) where org_id is not null;

-- Migration 098 (WS-R36) widened this table: `suite_share_inr` (a term in
-- gross, see api/_payments.js's own SUITE_SEAT_SHARE_BP) and
-- `provider_payout_ref` were added, and `state` grew from a two-value
-- placeholder into the real closed set the payout leaves the platform
-- through: built -> pending_account | queued -> sent -> settled | failed.
create table if not exists vy_creator_payout (
  payout_id           uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null,
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  gross_inr           integer not null default 0,
  take_inr            integer not null default 0,
  net_inr             integer not null default 0,
  tds_inr             integer not null default 0,
  suite_share_inr     integer not null default 0,
  provider_payout_ref text,
  state               text not null default 'built',
  created_at          timestamptz not null default now(),
  -- Migration 111 (WS-R56): the payout status webhook's own trace of WHY
  -- the row left `sent`/`queued` - see that migration's own header for why
  -- this is a column, not a second table.
  settled_at          timestamptz,
  failure_reason      text,
  constraint vy_creator_payout_state_check
    check (state in ('built','pending_account','queued','sent','settled','failed')),
  constraint vy_creator_payout_amounts_nonneg
    check (gross_inr >= 0 and take_inr >= 0 and net_inr >= 0 and tds_inr >= 0 and suite_share_inr >= 0),
  constraint vy_creator_payout_sums check (gross_inr = take_inr + tds_inr + net_inr),
  constraint vy_creator_payout_period_order check (period_end > period_start),
  constraint vy_creator_payout_suite_share_bound check (suite_share_inr <= gross_inr),
  constraint vy_creator_payout_failure_reason_shape
    check (failure_reason is null or length(failure_reason) <= 500)
);
create unique index if not exists vy_creator_payout_period_ix
  on vy_creator_payout (owner_user_id, period_start, period_end);
create index if not exists vy_creator_payout_failed_ix
  on vy_creator_payout (created_at) where state = 'failed';
create index if not exists vy_creator_payout_owner_list_ix
  on vy_creator_payout (owner_user_id, period_start desc);
-- Migration 111 (WS-R56): the payout status webhook's own lookup key.
create unique index if not exists vy_creator_payout_provider_ref_ix
  on vy_creator_payout (provider_payout_ref) where provider_payout_ref is not null;

-- Migration 098 (WS-R36). The provider's own reference to a creator's bank
-- account - never the bank detail itself, see that migration's own header.
-- Owner lane, deleted by name in api/_replica-full-erasure.js on
-- vy_creator_payout's own precedent, folded into that table's existing
-- "owner_room_payments" receipt class.
create table if not exists vy_creator_payout_account (
  account_id        uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null,
  provider          text not null,
  fund_account_ref  text not null,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint vy_creator_payout_account_provider_check check (provider in ('razorpay','fake')),
  constraint vy_creator_payout_account_ref_shape
    check (length(fund_account_ref) > 0 and length(fund_account_ref) <= 200)
);
create unique index if not exists vy_creator_payout_account_owner_provider_ix
  on vy_creator_payout_account (owner_user_id, provider);

-- Migration 079 - check-ins: follower-scheduled, task-bound (WS-R16).
-- vy_room_checkin_design is the OWNER lane (deleted by name in
-- api/_replica-full-erasure.js, like vy_room_price); vy_room_checkin and
-- vy_room_checkin_delivery are the PERSON lane (PERSON_TABLES, gated in
-- activePersonTables() on this migration having landed). Content-free like
-- every Room table before it: an id, a schedule, a date, a state, never a
-- word of what was said.
create table if not exists vy_room_checkin_design (
  design_id     uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id uuid not null,
  title         text not null default '' check (length(title) <= 120),
  prompt_shape  text not null default '' check (length(prompt_shape) <= 2000),
  cadence_hint  text not null default '' check (length(cadence_hint) <= 200),
  state         text not null default 'active' check (state in ('active','paused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vy_room_checkin_design_owner_ix
  on vy_room_checkin_design (owner_user_id, room_id, created_at desc);

create table if not exists vy_room_checkin (
  checkin_id    uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  person_id     uuid not null,
  follower_id   uuid not null references vy_room_follower(follower_id) on delete cascade,
  design_id     uuid not null references vy_room_checkin_design(design_id) on delete cascade,
  days_of_week  integer[] not null default '{}',
  local_time    time not null,
  timezone      text not null,
  next_due_at   timestamptz,
  state         text not null default 'active' check (state in ('active','stopped')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vy_room_checkin_days_shape check (
    array_length(days_of_week, 1) is not null
    and array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[1,2,3,4,5,6,7]
  )
);
create index if not exists vy_room_checkin_due_ix
  on vy_room_checkin (next_due_at)
  where state = 'active';
create index if not exists vy_room_checkin_scope_ix
  on vy_room_checkin (person_id, room_id);
create unique index if not exists vy_room_checkin_follower_design_ix
  on vy_room_checkin (follower_id, design_id)
  where state = 'active';

create table if not exists vy_room_checkin_delivery (
  delivery_id  uuid primary key,
  checkin_id   uuid not null references vy_room_checkin(checkin_id) on delete cascade,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  due_at       timestamptz not null,
  delivered_at timestamptz,
  channel      text not null default 'in_app' check (channel in ('in_app','whatsapp_template')),
  state        text not null
    check (state in ('delivered','skipped_free_tier','skipped_stopped','not_configured','failed')),
  reason       text not null default '',
  created_at   timestamptz not null default now(),
  constraint vy_room_checkin_delivery_once unique (checkin_id, due_at, channel)
);
create index if not exists vy_room_checkin_delivery_scope_ix
  on vy_room_checkin_delivery (person_id, room_id, due_at desc);
create index if not exists vy_room_checkin_delivery_checkin_ix
  on vy_room_checkin_delivery (checkin_id, due_at desc);
-- Migration 080 - Pulse v0 (WS-R17): counts over the opt-in shared subgraph,
-- n>=5, never verbatim. Three lanes: vy_room_pulse_optin is PERSON (a
-- follower's own revocable toggle, content-free); vy_room_pulse_topic is
-- OWNER (creator-typed labels only, never a follower's words);
-- vy_room_pulse_snapshot is content-free and derived, with follower_count's
-- own CHECK (>=5) refusing to let a bucket below the floor exist at all.
create table if not exists vy_room_pulse_optin (
  optin_id       uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_id      uuid not null,
  thread_id      uuid references vy_room_thread(thread_id) on delete cascade,
  policy_version integer not null default 1 check (policy_version > 0),
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists vy_room_pulse_optin_scope_ix
  on vy_room_pulse_optin (room_id, person_id, coalesce(thread_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists vy_room_pulse_optin_active_ix
  on vy_room_pulse_optin (room_id, person_id)
  where revoked_at is null;
create index if not exists vy_room_pulse_optin_thread_ix
  on vy_room_pulse_optin (thread_id)
  where revoked_at is null and thread_id is not null;
create index if not exists vy_room_pulse_optin_person_ix
  on vy_room_pulse_optin (person_id, room_id);

create table if not exists vy_room_pulse_topic (
  topic_id      uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id uuid not null,
  label         text not null check (length(label) between 1 and 60),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists vy_room_pulse_topic_label_ix
  on vy_room_pulse_topic (room_id, lower(label));
create index if not exists vy_room_pulse_topic_owner_ix
  on vy_room_pulse_topic (owner_user_id, room_id);

create table if not exists vy_room_pulse_snapshot (
  snapshot_id    uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  week_start     date not null,
  topic_id       uuid not null references vy_room_pulse_topic(topic_id) on delete cascade,
  follower_count integer not null check (follower_count >= 5),
  computed_at    timestamptz not null default now()
);
create unique index if not exists vy_room_pulse_snapshot_week_ix
  on vy_room_pulse_snapshot (room_id, week_start, topic_id);
create index if not exists vy_room_pulse_snapshot_owner_read_ix
  on vy_room_pulse_snapshot (room_id, week_start desc);
-- Migration 082 - the Room on Telegram: which room a Telegram chat currently
-- means (WS-R18). See db/migrations/082_room_telegram_channel.sql for the
-- full argument; mirrored here per this file's own convention.
create table if not exists vy_room_follower_channel (
  channel_map_id uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_id      uuid not null,
  follower_id    uuid not null references vy_room_follower(follower_id) on delete cascade,
  channel        text not null,
  channel_ref    text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint vy_room_follower_channel_channel_check check (channel in ('telegram'))
);
create unique index if not exists vy_room_follower_channel_ref_ix
  on vy_room_follower_channel (channel, channel_ref);
create index if not exists vy_room_follower_channel_person_ix
  on vy_room_follower_channel (person_id, channel);
create index if not exists vy_room_follower_channel_follower_ix
  on vy_room_follower_channel (follower_id);
-- Migration 081 - the paid tier's fair-use ceilings and voice minutes
-- (WS-R19). vy_room_follower gets the paid twin of its own free-tier month
-- counter; vy_room gets the two creator-editable ceilings; vy_room_voice_usage
-- is the PERSON-lane day-count sibling of 077's vy_room_follower_day, one
-- column deeper (a real FK to vy_room_follower, 078's own precedent).
alter table vy_room_follower
  add column if not exists voice_seconds_month integer not null default 0;
alter table vy_room_follower
  drop constraint if exists vy_room_follower_voice_seconds_nonneg,
  add constraint vy_room_follower_voice_seconds_nonneg check (voice_seconds_month >= 0);
-- The voice meter's OWN rollover key, independent of `month_key` (071) - a
-- shared key lets whichever of roomSay/roomSpeak runs first in a new month
-- silently strand the other's counter unreset (context/rejected.md#ws-r19-
-- shared-month-key-cross-counter-rollover).
alter table vy_room_follower
  add column if not exists voice_month_key text not null default '';

alter table vy_room
  add column if not exists paid_monthly_messages integer not null default 500;
alter table vy_room
  drop constraint if exists vy_room_paid_monthly_messages_band,
  add constraint vy_room_paid_monthly_messages_band
  check (paid_monthly_messages >= 100 and paid_monthly_messages <= 2000);
alter table vy_room
  add column if not exists paid_monthly_voice_seconds integer not null default 1800;
alter table vy_room
  drop constraint if exists vy_room_paid_monthly_voice_seconds_band,
  add constraint vy_room_paid_monthly_voice_seconds_band
  check (paid_monthly_voice_seconds >= 0 and paid_monthly_voice_seconds <= 3600);

create table if not exists vy_room_voice_usage (
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  person_id   uuid not null,
  follower_id uuid not null references vy_room_follower(follower_id) on delete cascade,
  day         date not null,
  seconds     integer not null default 0 check (seconds >= 0),
  clips       integer not null default 0 check (clips >= 0),
  primary key (room_id, person_id, day)
);
create index if not exists vy_room_voice_usage_scope_ix
  on vy_room_voice_usage (room_id, person_id, day);
create index if not exists vy_room_voice_usage_follower_ix
  on vy_room_voice_usage (follower_id);

-- Migration 084 - the sweep heartbeat (WS-R21). No person/device/owner
-- column by construction; see that migration's own header for why it needs
-- no PERSON_TABLES entry and no relcheck exemption.
create table if not exists vy_sweep_run (
  run_id       uuid primary key,
  sweep        text not null check (length(sweep) > 0 and length(sweep) <= 80),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  outcome      text not null default 'running',
  counts       jsonb not null default '{}'::jsonb,
  error_code   text not null default ''
);
alter table vy_sweep_run drop constraint if exists vy_sweep_run_outcome_check;
alter table vy_sweep_run add constraint vy_sweep_run_outcome_check
  check (outcome in ('running', 'ok', 'partial', 'failed'));
alter table vy_sweep_run drop constraint if exists vy_sweep_run_counts_object;
alter table vy_sweep_run add constraint vy_sweep_run_counts_object
  check (jsonb_typeof(counts) = 'object');
alter table vy_sweep_run drop constraint if exists vy_sweep_run_counts_size;
alter table vy_sweep_run add constraint vy_sweep_run_counts_size
  check (octet_length(counts::text) <= 4096);
alter table vy_sweep_run drop constraint if exists vy_sweep_run_finished_matches_outcome;
alter table vy_sweep_run add constraint vy_sweep_run_finished_matches_outcome
  check (
    (outcome = 'running' and finished_at is null)
    or (outcome <> 'running' and finished_at is not null)
  );
create index if not exists vy_sweep_run_sweep_started_ix
  on vy_sweep_run (sweep, started_at desc);
-- Migration 085 - web push for check-ins, the installable Room (WS-R22).
-- vy_room_push_subscription is the PERSON lane (PERSON_TABLES, "forget-only",
-- no agent_id column - reached purely through follower_id's own FK cascade,
-- vy_room_follower_channel's precedent one migration family over, so
-- roomForget needs no new explicit statement). The channel CHECK on
-- vy_room_checkin_delivery widens to admit 'web_push'; vy_room_checkin gains
-- its own quiet-hours window.
create table if not exists vy_room_push_subscription (
  subscription_id uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  follower_id     uuid not null references vy_room_follower(follower_id) on delete cascade,
  endpoint        text not null,
  p256dh          text not null,
  auth            text not null,
  user_agent_hash text not null default '',
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
create unique index if not exists vy_room_push_subscription_endpoint_ix
  on vy_room_push_subscription (endpoint);
create index if not exists vy_room_push_subscription_follower_ix
  on vy_room_push_subscription (follower_id);
create index if not exists vy_room_push_subscription_scope_ix
  on vy_room_push_subscription (person_id, room_id);
create index if not exists vy_room_push_subscription_active_ix
  on vy_room_push_subscription (follower_id)
  where revoked_at is null;

alter table vy_room_checkin_delivery drop constraint if exists vy_room_checkin_delivery_channel_check;
alter table vy_room_checkin_delivery add constraint vy_room_checkin_delivery_channel_check
  check (channel in ('in_app','whatsapp_template','web_push'));

alter table vy_room_checkin add column if not exists quiet_from time;
alter table vy_room_checkin add column if not exists quiet_to time;
-- Migration 086 - creator applications and invites (WS-R23). See
-- db/migrations/086_creator_invites.sql for the full rationale: the public
-- application form's rate limit is a plain-column unique index rather than a
-- functional one (Postgres requires index expressions to be IMMUTABLE, and
-- timestamptz-to-date is not); vy_creator_invite is on the OWNER lane
-- (redeemed_by_user_id IS the replica owner's id once spent), not in
-- api/memory.js's PERSON_TABLES, reached instead by a named delete in
-- api/_replica-full-erasure.js and by scripts/relcheck.mjs's widened
-- PERSON_COLUMNS/owner-lane walk.
create table if not exists vy_creator_application (
  application_id uuid primary key,
  name           text not null default '' check (length(name) <= 200),
  archive_link   text not null default '' check (length(archive_link) <= 2000),
  audience       text not null default '' check (length(audience) <= 2000),
  contact        text not null check (length(contact) between 1 and 320),
  contact_key    text not null check (length(contact_key) between 1 and 320),
  applied_on     date not null,
  status         text not null default 'new' check (status in ('new','reviewing','invited','declined')),
  created_at     timestamptz not null default now()
);
create unique index if not exists vy_creator_application_contact_day_ix
  on vy_creator_application (contact_key, applied_on);
create index if not exists vy_creator_application_created_ix
  on vy_creator_application (created_at desc);
create index if not exists vy_creator_application_status_ix
  on vy_creator_application (status, created_at desc);

create table if not exists vy_creator_invite (
  invite_id           uuid primary key,
  code_hash           text not null check (length(code_hash) = 64),
  issued_to_contact   text not null default '' check (length(issued_to_contact) <= 320),
  issued_by_user_id   uuid not null,
  application_id      uuid,
  expires_at          timestamptz not null,
  redeemed_at         timestamptz,
  redeemed_by_user_id uuid,
  created_at          timestamptz not null default now()
);
create unique index if not exists vy_creator_invite_code_hash_ix
  on vy_creator_invite (code_hash);
create index if not exists vy_creator_invite_issued_ix
  on vy_creator_invite (issued_by_user_id, created_at desc);
create index if not exists vy_creator_invite_redeemed_ix
  on vy_creator_invite (redeemed_by_user_id)
  where redeemed_by_user_id is not null;
-- Migration 083 - Handoff v0 (WS-R20): a follower asks for the human. See
-- db/migrations/083_room_handoff.sql for the full argument; mirrored here
-- per this file's own convention. `vy_room_handoff` is the one PERSON-lane
-- exception to 071's "never a word" law, deliberately: the creator's read is
-- gated on a SQL predicate that recomputes payload_sha256 over payload_text
-- on every read, never a value the app asserts once and trusts thereafter.
alter table vy_room
  add column if not exists handoff_enabled boolean not null default false;
alter table vy_room
  add column if not exists handoff_monthly_cap integer not null default 5;
alter table vy_room
  drop constraint if exists vy_room_handoff_monthly_cap_band,
  add constraint vy_room_handoff_monthly_cap_band
  check (handoff_monthly_cap >= 0 and handoff_monthly_cap <= 50);

create table if not exists vy_room_handoff (
  handoff_id      uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  follower_id     uuid not null references vy_room_follower(follower_id) on delete cascade,
  thread_id       uuid references vy_room_thread(thread_id) on delete cascade,
  payload_text    text not null check (length(payload_text) between 1 and 4000),
  payload_sha256  text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version  integer not null default 1,
  state           text not null default 'drafted'
    check (state in ('drafted','sent','answered','withdrawn')),
  reply_text      text not null default '' check (length(reply_text) <= 4000),
  month_key       text not null default '',
  sent_at         timestamptz,
  answered_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vy_room_handoff_sent_shape check (
    (state in ('sent','answered','withdrawn')) = (sent_at is not null)
  ),
  constraint vy_room_handoff_answered_shape check (
    (state = 'answered') = (answered_at is not null)
  )
);
create index if not exists vy_room_handoff_queue_ix
  on vy_room_handoff (room_id, state, sent_at);
create index if not exists vy_room_handoff_person_ix
  on vy_room_handoff (person_id, room_id);
create index if not exists vy_room_handoff_cap_ix
  on vy_room_handoff (follower_id, month_key, state);

-- Migration 087 - the Room in Hindi (WS-R24). See
-- db/migrations/087_room_locale.sql for the full argument: `locale` is the
-- follower's OWN choice once they have a row (set at INSERT, changed only via
-- api/_room-surface.js's session-scoped roomSetLocale, never reset by a
-- repeat join), `default_locale` is the CREATOR's own fallback for a follower
-- with no row yet and no usable browser hint. Both CHECK-bounded to the two
-- locales this product ships.
alter table vy_room_follower
  add column if not exists locale text not null default 'en';
alter table vy_room_follower
  drop constraint if exists vy_room_follower_locale_check,
  add constraint vy_room_follower_locale_check check (locale in ('en', 'hi'));

alter table vy_room
  add column if not exists default_locale text not null default 'en';
alter table vy_room
  drop constraint if exists vy_room_default_locale_check,
  add constraint vy_room_default_locale_check check (default_locale in ('en', 'hi'));
-- Migration 088 - the creator funnel marks (WS-R25). See
-- db/migrations/088_replica_funnel.sql for the full rationale: the two
-- moments no other table knows (studio wizard mount, Publish click), never a
-- message, first write wins, deleted by name in
-- api/_replica-full-erasure.js, no foreign key on 009's owner-lane
-- convention.
create table if not exists vy_replica_funnel_mark (
  replica_id     uuid not null,
  owner_user_id  uuid not null,
  step           text not null,
  at             timestamptz not null default now(),
  primary key (replica_id, step)
);
alter table vy_replica_funnel_mark drop constraint if exists vy_replica_funnel_mark_step_check;
alter table vy_replica_funnel_mark add constraint vy_replica_funnel_mark_step_check
  check (step in ('studio_opened', 'publish_clicked'));
create index if not exists vy_replica_funnel_mark_owner_ix
  on vy_replica_funnel_mark (owner_user_id, replica_id);
-- Migration 089 - abuse limits on the public doors (WS-R26). No
-- person/device/owner column by construction - a sha256 hash of a caller's
-- key salted per day, never the raw IP or contact; see that migration's own
-- header for why it needs no PERSON_TABLES entry and no relcheck exemption.
create table if not exists vy_public_rate (
  scope        text not null check (length(scope) > 0 and length(scope) <= 64),
  key_hash     text not null check (length(key_hash) = 64),
  window_start timestamptz not null,
  count        integer not null default 0 check (count >= 0),
  updated_at   timestamptz not null default now(),
  primary key (scope, key_hash, window_start)
);
create index if not exists vy_public_rate_window_ix
  on vy_public_rate (window_start);
-- Migration 090 - the forget receipt (WS-R27): the one row that survives a
-- follower's "forget me" in a creator's Room. See
-- db/migrations/090_room_forget_receipt.sql for the full argument; mirrored
-- here per this file's own convention. No person_id column, deliberately -
-- `person_hash` is a one-way SHA-256 of (room_id, person_id, policy_version),
-- recomputed (never looked up) by the account-wide whole wipe.
create table if not exists vy_room_forget_receipt (
  receipt_id     uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_hash    text not null check (person_hash ~ '^[0-9a-f]{64}$'),
  policy_version integer not null default 1 check (policy_version > 0),
  counts         jsonb not null default '{}'::jsonb,
  issued_at      timestamptz not null default now()
);
create index if not exists vy_room_forget_receipt_room_issued_ix
  on vy_room_forget_receipt (room_id, issued_at desc);
-- Migration 095 (WS-R33). The creator tier subscription - what a creator
-- pays for capacity, owner lane (deleted by name in
-- api/_replica-full-erasure.js, never in api/memory.js's PERSON_TABLES).
create table if not exists vy_creator_subscription (
  subscription_id            uuid primary key default gen_random_uuid(),
  owner_user_id              uuid not null,
  replica_id                 uuid not null,
  plan                       text not null check (plan in ('room', 'studio')),
  price_inr                  integer not null check (price_inr > 0),
  currency                   text not null default 'INR' check (currency = 'INR'),
  state                      text not null default 'created'
                             check (state in ('created', 'authenticated', 'active', 'paused', 'cancelled', 'expired')),
  provider                   text not null check (provider in ('razorpay', 'fake')),
  provider_subscription_ref  text,
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create unique index if not exists vy_creator_subscription_replica_live_ix
  on vy_creator_subscription (replica_id)
  where state in ('created', 'authenticated', 'active', 'paused');
create unique index if not exists vy_creator_subscription_provider_ref_ix
  on vy_creator_subscription (provider, provider_subscription_ref)
  where provider_subscription_ref is not null;
create index if not exists vy_creator_subscription_owner_replica_ix
  on vy_creator_subscription (owner_user_id, replica_id, created_at desc);

-- Migration 092 - check-ins over WhatsApp utility templates (WS-R29). See
-- db/migrations/092_room_whatsapp.sql for the full argument; mirrored here
-- per this file's own convention. One row per follower (primary key
-- follower_id) - a WhatsApp destination the follower themselves provided,
-- separate from the Room's OTP sign-in phone. `state` carries the
-- revoke-on-failure law: 'failed' is set by a 4xx from Meta naming an
-- invalid number, `last_failure_code` names it, and no further sends go out
-- until the follower opts in again.
create table if not exists vy_room_follower_whatsapp (
  follower_id     uuid primary key references vy_room_follower(follower_id) on delete cascade,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  phone_e164      text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  consented_at    timestamptz not null default now(),
  state           text not null default 'active' check (state in ('active', 'stopped', 'failed')),
  last_failure_code text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists vy_room_follower_whatsapp_scope_ix
  on vy_room_follower_whatsapp (room_id, person_id);
-- Added at the merge: the inbound webhook's lookup by the number Meta hands
-- back planned as a sequential scan on the live database without this.
create index if not exists vy_room_follower_whatsapp_phone_ix
  on vy_room_follower_whatsapp (phone_e164);
-- Migration 093 - the upgrade moment's own ledger (WS-R30): one row per time
-- a follower is shown the conversion offer. See
-- db/migrations/093_room_upgrade_offer.sql for the full argument; mirrored
-- here per this file's own convention.
create table if not exists vy_room_upgrade_offer (
  offer_id    uuid primary key,
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  person_id   uuid not null,
  follower_id uuid not null references vy_room_follower(follower_id) on delete cascade,
  shown_at    timestamptz not null default now(),
  reason      text not null check (reason in ('session_worked', 'cap_reached')),
  outcome     text check (outcome in ('dismissed', 'started', 'paid')),
  outcome_at  timestamptz,
  constraint vy_room_upgrade_offer_outcome_pairs check ((outcome is null) = (outcome_at is null))
);
create index if not exists vy_room_upgrade_offer_follower_ix
  on vy_room_upgrade_offer (follower_id, shown_at desc);
create index if not exists vy_room_upgrade_offer_room_shown_ix
  on vy_room_upgrade_offer (room_id, shown_at desc);
-- Migration 094 - an index on vy_room_forget_receipt.person_hash (WS-R32).
-- See db/migrations/094_receipt_hash_index.sql for the full argument;
-- mirrored here per this file's own convention. Closes ws-r27-whole-wipe-
-- receipt-read-capped-at-10000: the account-wide whole wipe now deletes
-- `where person_hash = any($1)` against a walk of every vy_room row times
-- every receipt policy version, rather than reading the receipt table
-- itself with a `limit 10000` - this index is what makes that delete an
-- index scan.
create index if not exists vy_room_forget_receipt_person_hash_ix
  on vy_room_forget_receipt (person_hash);

-- Migration 096 - check-ins over Telegram (WS-R34). See
-- db/migrations/096_checkin_telegram.sql for the full argument; mirrored
-- here per this file's own convention. The channel CHECK widens to admit
-- 'telegram'; vy_room_follower_channel gains checkins_enabled (default-on,
-- the pointer itself is the opt-in) and stopped_code (null = sendable, set
-- on a 403/400 from Telegram).
alter table vy_room_checkin_delivery drop constraint if exists vy_room_checkin_delivery_channel_check;
alter table vy_room_checkin_delivery add constraint vy_room_checkin_delivery_channel_check
  check (channel in ('in_app','whatsapp_template','web_push','telegram'));

alter table vy_room_follower_channel add column if not exists checkins_enabled boolean not null default true;
alter table vy_room_follower_channel add column if not exists stopped_code text;

-- Migration 097 - Pulse v1 (WS-R35): k-anonymous label combinations. See
-- db/migrations/097_pulse_v1.sql for the full argument; mirrored here per
-- this file's own convention. Tightens v0's `vy_room_pulse_topic` bounds
-- (2-32 characters, structurally capped at 12 active labels per Room via a
-- 1..12 `slot` column plus a unique index) and adds two new tables:
-- `vy_room_pulse_week` (one header row per Room per week, carrying only a
-- `suppressed` count) and `vy_room_pulse_combo` (a count over a SET of 1-3
-- label TEXTS captured at publish time, never a topic_id FK, so a later
-- rename never rewrites an already-published week).
alter table vy_room_pulse_topic
  drop constraint if exists vy_room_pulse_topic_label_v1_len_check;
alter table vy_room_pulse_topic
  add constraint vy_room_pulse_topic_label_v1_len_check
  check (length(label) between 2 and 32) not valid;

alter table vy_room_pulse_topic add column if not exists slot smallint;

alter table vy_room_pulse_topic
  drop constraint if exists vy_room_pulse_topic_slot_check;
alter table vy_room_pulse_topic
  add constraint vy_room_pulse_topic_slot_check
  check (slot is null or slot between 1 and 12) not valid;

create unique index if not exists vy_room_pulse_topic_slot_ix
  on vy_room_pulse_topic (room_id, slot);
-- Validated at the merge: the live table held zero rows, so both CHECKs bind.
alter table vy_room_pulse_topic validate constraint vy_room_pulse_topic_label_v1_len_check;
alter table vy_room_pulse_topic validate constraint vy_room_pulse_topic_slot_check;

create table if not exists vy_room_pulse_week (
  week_id     uuid primary key,
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  week_start  date not null,
  suppressed  integer not null default 0 check (suppressed >= 0),
  computed_at timestamptz not null default now()
);
create unique index if not exists vy_room_pulse_week_ix
  on vy_room_pulse_week (room_id, week_start);
create index if not exists vy_room_pulse_week_owner_read_ix
  on vy_room_pulse_week (room_id, week_start desc);

create table if not exists vy_room_pulse_combo (
  combo_id       uuid primary key,
  week_id        uuid not null references vy_room_pulse_week(week_id) on delete cascade,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  week_start     date not null,
  labels         text[] not null check (coalesce(array_length(labels, 1), 0) between 1 and 3),
  follower_count integer not null check (follower_count >= 5),
  computed_at    timestamptz not null default now()
);
create unique index if not exists vy_room_pulse_combo_ix
  on vy_room_pulse_combo (room_id, week_start, labels);
create index if not exists vy_room_pulse_combo_owner_read_ix
  on vy_room_pulse_combo (room_id, week_start desc);

-- Migration 099 - the reminder ledger, and "renewed unasked" made real
-- (WS-R37). See db/migrations/099_renewal_reminder.sql for the full
-- argument; mirrored here per this file's own convention. One table, three
-- mutually exclusive subject lanes (follower/creator/org), person lane for
-- followers (PERSON_TABLES) and owner lane for creators (deleted by name in
-- api/_replica-full-erasure.js); a Suite's own rows are reached only by
-- cascade, vy_org_subscription's own 091 precedent.
create table if not exists vy_renewal_reminder (
  reminder_id    uuid not null default gen_random_uuid(),
  subject_kind   text not null check (subject_kind in ('creator', 'follower', 'org')),
  subject_id     uuid not null,
  room_id        uuid references vy_room(room_id) on delete cascade,
  person_id      uuid,
  follower_id    uuid references vy_room_follower(follower_id) on delete cascade,
  owner_user_id  uuid,
  replica_id     uuid,
  org_id         uuid references vy_org(org_id) on delete cascade,
  period_end     timestamptz not null,
  channel        text not null check (channel in ('in_app', 'web_push', 'telegram')),
  sent_at        timestamptz,
  reason         text not null default '',
  created_at     timestamptz not null default now(),
  primary key (subject_kind, subject_id, period_end, channel),
  constraint vy_renewal_reminder_one_lane check (
    (subject_kind = 'follower'
       and room_id is not null and person_id is not null and follower_id is not null
       and owner_user_id is null and replica_id is null and org_id is null)
    or
    (subject_kind = 'creator'
       and owner_user_id is not null and replica_id is not null
       and room_id is null and person_id is null and follower_id is null and org_id is null)
    or
    (subject_kind = 'org'
       and org_id is not null
       and room_id is null and person_id is null and follower_id is null
       and owner_user_id is null and replica_id is null)
  )
);
create index if not exists vy_renewal_reminder_room_person_ix
  on vy_renewal_reminder (room_id, person_id) where room_id is not null;
create index if not exists vy_renewal_reminder_owner_replica_ix
  on vy_renewal_reminder (owner_user_id, replica_id) where owner_user_id is not null;
create index if not exists vy_renewal_reminder_org_ix
  on vy_renewal_reminder (org_id) where org_id is not null;
create unique index if not exists vy_renewal_reminder_id_ix
  on vy_renewal_reminder (reminder_id);

create index if not exists vy_room_subscription_due_ix
  on vy_room_subscription (state, current_period_end) where current_period_end is not null;
create index if not exists vy_org_subscription_due_ix
  on vy_org_subscription (state, current_period_end) where current_period_end is not null;
create index if not exists vy_creator_subscription_due_ix
  on vy_creator_subscription (state, current_period_end) where current_period_end is not null;

alter table vy_room_subscription add column if not exists cancel_at_period_end boolean not null default false;
alter table vy_org_subscription add column if not exists cancel_at_period_end boolean not null default false;
alter table vy_creator_subscription add column if not exists cancel_at_period_end boolean not null default false;

-- Migration 101 - the follower's own settings page needs one column
-- (WS-R39). See db/migrations/101_room_follower_settings_reviewed.sql for
-- the full argument: nullable, no table it belongs to is new, no
-- PERSON_TABLES/erasure/relcheck change (the row it lives on is already
-- reached by roomForget's own vy_room_follower delete).
alter table vy_room_follower
  add column if not exists settings_reviewed_at timestamptz null;

-- Migration 105 - the creator directory's listing switch (WS-R45). See
-- db/migrations/105_room_listed.sql for the full argument: `listed_at` is
-- the creator's own opt-in to being found, independent of `published_at`
-- (071) and checked alongside it in the SAME predicate by every reader;
-- `one_line_bio` is the directory's third field, bounded to 140 characters.
-- No PERSON_TABLES/erasure/relcheck change: both columns are on `vy_room`,
-- already an owner-lane table deleted by name.
alter table vy_room
  add column if not exists listed_at timestamptz;
alter table vy_room
  add column if not exists one_line_bio text not null default '';
alter table vy_room
  drop constraint if exists vy_room_one_line_bio_len,
  add constraint vy_room_one_line_bio_len check (length(one_line_bio) <= 140);
create index if not exists vy_room_listed_ix
  on vy_room (listed_at desc)
  where listed_at is not null and published_at is not null;

-- Migration 106 - creator-issued invites (WS-R47). See
-- db/migrations/106_creator_issued_invites.sql for the full argument: one
-- column on the table 086 already put on the owner lane, defaulted to
-- 'operator' because every row this table has ever held was issued that way;
-- no new PERSON_TABLES/relcheck wiring needed since the table's shape (and
-- its owner-lane column, redeemed_by_user_id) does not change.
alter table vy_creator_invite
  add column if not exists issued_kind text not null default 'operator'
    check (issued_kind in ('operator', 'creator'));
create index if not exists vy_creator_invite_issued_kind_ix
  on vy_creator_invite (issued_by_user_id, issued_kind);

-- Migration 107 - Suites sell themselves (WS-R48). See
-- db/migrations/107_suites_self_serve.sql for the full argument: `intent`
-- distinguishes a Suite-first application from a creator application on the
-- SAME apply form/table rather than overloading `audience`; `org_attached_at`
-- is the honest "seats attached this week" signal `vy_room.updated_at`
-- cannot be, since publish/pause/price/detach all touch that column too.
alter table vy_creator_application
  add column if not exists intent text not null default 'creator';
alter table vy_creator_application drop constraint if exists vy_creator_application_intent_check;
alter table vy_creator_application add constraint vy_creator_application_intent_check
  check (intent in ('creator','suite'));

alter table vy_room add column if not exists org_attached_at timestamptz null;
create index if not exists vy_room_org_attached_ix
  on vy_room (org_attached_at)
  where org_attached_at is not null;
create index if not exists vy_org_created_ix
  on vy_org (created_at desc);

-- Migration 102 - counting how a Room was arrived at, without a person
-- (WS-R40, share and arrival). See db/migrations/102_room_arrival.sql for
-- the full argument: no person column, no owner_user_id, real FK CASCADE
-- from vy_room plus a delete-by-name in api/_replica-full-erasure.js, one
-- upsert per open, via decided off a closed allowlist before this table is
-- ever touched.
create table if not exists vy_room_arrival (
  room_id uuid not null references vy_room(room_id) on delete cascade,
  day     date not null,
  via     text not null check (via in ('share', 'direct', 'embed', 'search')),
  count   integer not null default 0 check (count >= 0),
  primary key (room_id, day, via)
);
create index if not exists vy_room_arrival_via_day_ix
  on vy_room_arrival (via, day);

-- Migration 104 (WS-R42). The creator-tier charge ledger, the dedicated
-- table migration 095's own header and
-- context/decisions.md#ws-r33-creator-tier-charge-has-no-ledger-row both
-- named as the reversal condition, rather than a third disjunct on
-- vy_payment_event_one_lane. Owner lane (deleted by name in
-- api/_replica-full-erasure.js, folded into the existing
-- owner_creator_tier_subscription receipt class; never in api/memory.js's
-- PERSON_TABLES), scoped by owner_user_id/replica_id, no split columns - the
-- whole amount is platform revenue. See
-- db/migrations/104_creator_charge_event.sql for the full argument.
create table if not exists vy_creator_charge_event (
  charge_id             uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null,
  replica_id              uuid not null,
  subscription_id         uuid not null references vy_creator_subscription(subscription_id) on delete cascade,
  provider                text not null check (provider in ('razorpay','fake')),
  provider_charge_ref     text not null,
  amount_inr              integer not null default 0 check (amount_inr >= 0),
  received_at             timestamptz not null default now(),
  signature_verified      boolean not null check (signature_verified = true),
  payload_hash             text not null check (payload_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists vy_creator_charge_event_provider_ref_ix
  on vy_creator_charge_event (provider, provider_charge_ref);
create index if not exists vy_creator_charge_event_owner_ix
  on vy_creator_charge_event (owner_user_id, received_at desc);
create index if not exists vy_creator_charge_event_received_ix
  on vy_creator_charge_event (received_at);

-- Migration 108 - Suite attachment HISTORY (WS-R54). See
-- db/migrations/108_room_org_attachment.sql for the full argument: money
-- must be period-true (context/decisions.md#ws-r42-reconcile-suite-lane-uses-current-attachment's
-- own reversal condition), so this table records every [attached_at,
-- detached_at) interval a Room ever held with a Suite, one open row per
-- Room at most (partial unique index), real FK CASCADE from vy_room and
-- vy_org (neither is an owner/agent/replica column - the same two columns
-- vy_room.org_id already carries a live FK to), no person column. Backfilled
-- from vy_room.org_attached_at (107) where set, else now() as a known
-- inexactness.
create table if not exists vy_room_org_attachment (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  org_id       uuid not null references vy_org(org_id) on delete cascade,
  attached_at  timestamptz not null default now(),
  detached_at  timestamptz
);
create unique index if not exists vy_room_org_attachment_open_ix
  on vy_room_org_attachment (room_id)
  where detached_at is null;
create index if not exists vy_room_org_attachment_room_ix
  on vy_room_org_attachment (room_id, attached_at desc);
create index if not exists vy_room_org_attachment_org_ix
  on vy_room_org_attachment (org_id, attached_at desc);

-- Migration 109 - the incident ledger (WS-R58). See
-- db/migrations/109_incident.sql for the full argument: content-free by
-- schema (kind CHECK-bounded to a closed list, door a bounded file name,
-- every other column a number or a timestamp), keyed unique on
-- (day, kind, door, status) so `recordIncident`'s upsert costs one row per
-- failure shape per day regardless of occurrence count, `notified_at` on
-- the row itself as the check-ins sweep's own once-per-kind-per-day
-- idempotency. Not a person table - no owner/replica/room/follower/person
-- column at all, `vy_sweep_run` (084)'s own precedent restated: invisible
-- to scripts/relcheck.mjs's PERSON_COLUMNS scan by construction, no
-- PERSON_TABLES entry, no erasure wiring.
create table if not exists vy_incident (
  incident_id  uuid primary key default gen_random_uuid(),
  day          date not null default current_date,
  kind         text not null,
  door         text not null check (length(door) > 0 and length(door) <= 100),
  status       integer not null check (status >= 0 and status < 1000),
  count        integer not null default 1 check (count > 0),
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table vy_incident drop constraint if exists vy_incident_kind_check;
alter table vy_incident add constraint vy_incident_kind_check
  check (kind in ('door_5xx', 'provider_payments', 'provider_telegram', 'provider_whatsapp', 'provider_webpush'));
create unique index if not exists vy_incident_day_kind_door_status_ix
  on vy_incident (day, kind, door, status);
create index if not exists vy_incident_day_ix
  on vy_incident (day desc);
-- Migration 110 - the taste (WS-R53). See db/migrations/110_room_taste.sql
-- for the full argument: `taste_enabled` is the creator's per-Room switch
-- (071/105 have no fitting column); `vy_room_taste_turn` is a dedicated,
-- person-free (room, day) counter for "taste turns this week" on the ops
-- board - deliberately NOT a fifth `vy_room_arrival.via` value, since that
-- column names arrival SOURCES and a taste turn is a different dimension
-- (an activity, not a source) that would make evals/room-share/run.mjs's
-- fixed four-value assertion wrong for a reason it was never told about.
alter table vy_room
  add column if not exists taste_enabled boolean not null default true;
create table if not exists vy_room_taste_turn (
  room_id uuid not null references vy_room(room_id) on delete cascade,
  day     date not null,
  count   integer not null default 0 check (count >= 0),
  primary key (room_id, day)
);
create index if not exists vy_room_taste_turn_day_ix
  on vy_room_taste_turn (day);

-- Migration 112 - the studio in Hindi (WS-R52). See
-- db/migrations/112_replica_locale.sql for the full argument: the CREATOR's
-- own chrome language, CHECK-bounded like vy_room_follower.locale and
-- vy_room.default_locale one surface over. Never the AI's own replies, never
-- the Room a follower sees.
alter table vy_replica
  add column if not exists locale text not null default 'en';
alter table vy_replica
  drop constraint if exists vy_replica_locale_check;
alter table vy_replica
  add constraint vy_replica_locale_check check (locale in ('en', 'hi'));

-- Migration 113 (main loop, WS-R59 merge): `vy_room_arrival.via` admits
-- `install` (a home-screen launch) alongside share, direct, embed and search,
-- matching api/_room-surface.js's ROOM_ARRIVAL_VIA. The inline CHECK in the
-- 102 block above is superseded by this named constraint.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install'));

-- Migration 114 - operator push subscriptions (WS-R62). See
-- db/migrations/114_operator_push_subscription.sql for the full argument:
-- closes the gap named in `context/decisions.md#ws-r58-operator-push-
-- subscription-store-does-not-exist` - the same endpoint/p256dh/auth shape
-- `vy_room_push_subscription` (085) keeps for a follower, narrowed to one
-- operator's own `owner_user_id` (no room, no person, no follower). NOT a
-- person table - an operator is an owner acting in a platform-staff
-- capacity, `vy_creator_invite.issued_by_user_id`'s own precedent (086)
-- restated - reached by the owner-lane erasure job by NAME
-- (api/_replica-full-erasure.js), never by cascade.
create table if not exists vy_operator_push_subscription (
  id          uuid primary key,
  owner_user_id uuid not null,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index if not exists vy_operator_push_subscription_owner_endpoint_ix
  on vy_operator_push_subscription (owner_user_id, endpoint);
create index if not exists vy_operator_push_subscription_active_ix
  on vy_operator_push_subscription (owner_user_id)
  where revoked_at is null;
-- Migration 115 - the creator's public page showcase (WS-R66). See
-- db/migrations/115_room_showcase.sql for the full argument: up to five
-- Q&A pairs a creator chooses to show a stranger on /c/<slug>, CREATOR
-- material only (typed, edited, or copied from a 'sounds_right' review card
-- whose kind is not 'follower_declined'), never a follower's words. No
-- person column; FK CASCADE from vy_room; the partial unique index on
-- (room_id, position) where removed_at is null is the five-slot ceiling
-- itself, not a limit the application layer merely promises to respect.
create table if not exists vy_room_showcase (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references vy_room(room_id) on delete cascade,
  question   text not null check (question <> '' and length(question) <= 200),
  answer     text not null check (answer <> '' and length(answer) <= 1200),
  position   integer not null check (position >= 1 and position <= 5),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index if not exists vy_room_showcase_position_ix
  on vy_room_showcase (room_id, position)
  where removed_at is null;
-- Added at the merge: the erasure delete by room_id seq-scanned without it.
create index if not exists vy_room_showcase_room_ix
  on vy_room_showcase (room_id);

-- Migration 116 - flag this reply (WS-R67). See
-- db/migrations/116_room_reply_flag.sql for the full argument: TWO tables,
-- one per lane. `vy_room_follower_reply_flag` is the follower's own copy
-- (person_id + follower_id, unique per follower per reply, exported and
-- forgotten with everything else theirs). `vy_room_reply_flag` is the
-- creator's - no follower_id, no person_id, no thread reference at all, so
-- it is content-free of follower identity by construction, admitted to
-- evals/room-leak/run.mjs's aggregate-only class on that basis, and reached
-- for erasure only by name, by room_id, never through api/memory.js's
-- manifest.
create table if not exists vy_room_follower_reply_flag (
  flag_id      uuid primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  follower_id  uuid not null references vy_room_follower(follower_id) on delete cascade,
  reply_sha256 text not null check (reply_sha256 ~ '^[0-9a-f]{64}$'),
  reason       text not null
               check (reason in ('wrong', 'harmful', 'not_them', 'other')),
  created_at   timestamptz not null default now()
);
create unique index if not exists vy_room_follower_reply_flag_once_ix
  on vy_room_follower_reply_flag (follower_id, reply_sha256);
create index if not exists vy_room_follower_reply_flag_person_ix
  on vy_room_follower_reply_flag (room_id, person_id, created_at desc);

create table if not exists vy_room_reply_flag (
  id           uuid primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  reply_sha256 text not null check (reply_sha256 ~ '^[0-9a-f]{64}$'),
  reply_text   text not null check (reply_text <> '' and length(reply_text) <= 4000),
  reason       text not null
               check (reason in ('wrong', 'harmful', 'not_them', 'other')),
  created_at   timestamptz not null default now()
);
create index if not exists vy_room_reply_flag_room_reply_ix
  on vy_room_reply_flag (room_id, reply_sha256, created_at desc);

-- Migration 118 - the creator's weekly push (WS-R74). See
-- db/migrations/118_creator_weekly_push.sql for the full argument. Two
-- tables: `vy_creator_push_subscription` is `vy_operator_push_subscription`'s
-- (migration 114) exact shape restated for a creator's own device instead
-- of a platform operator's; `vy_creator_weekly_push` is `vy_room_pulse_
-- week`'s (097) exact shape restated for a send ledger instead of a
-- computed Pulse snapshot, its unique (room_id, week_start) index the whole
-- "second push in the same week is refused" guarantee.
create table if not exists vy_creator_push_subscription (
  id            uuid primary key,
  owner_user_id uuid not null,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index if not exists vy_creator_push_subscription_owner_endpoint_ix
  on vy_creator_push_subscription (owner_user_id, endpoint);
create index if not exists vy_creator_push_subscription_active_ix
  on vy_creator_push_subscription (owner_user_id)
  where revoked_at is null;
-- Added at the WS-R89 merge: the endpoint-alone read in subscribeCreatorPush.
create index if not exists vy_creator_push_subscription_endpoint_active_ix
  on vy_creator_push_subscription (endpoint)
  where revoked_at is null;

create table if not exists vy_creator_weekly_push (
  push_id           uuid primary key,
  room_id           uuid not null references vy_room(room_id) on delete cascade,
  week_start        date not null,
  sent_at           timestamptz not null default now(),
  followers_count    integer not null default 0 check (followers_count >= 0),
  messages_count     integer not null default 0 check (messages_count >= 0),
  headline_included boolean not null default false
);
create unique index if not exists vy_creator_weekly_push_room_week_ix
  on vy_creator_weekly_push (room_id, week_start);
create index if not exists vy_creator_weekly_push_room_sent_ix
  on vy_creator_weekly_push (room_id, sent_at desc);
-- Migration 119 - dormancy (WS-R75). No new person table - both columns
-- ride an existing person-lane row. See the migration file's own header.
alter table vy_room add column if not exists dormancy_days integer;

alter table vy_room drop constraint if exists vy_room_dormancy_days_floor;
alter table vy_room add constraint vy_room_dormancy_days_floor
  check (dormancy_days is null or dormancy_days >= 180);

alter table vy_room_follower add column if not exists dormancy_notice_at timestamptz;

create index if not exists vy_room_follower_dormancy_due_ix
  on vy_room_follower (room_id, last_seen_at)
  where dormancy_notice_at is null;

create index if not exists vy_room_follower_dormancy_notice_ix
  on vy_room_follower (dormancy_notice_at)
  where dormancy_notice_at is not null;

-- Migration 120 - the self-check cron needs one more incident kind
-- (WS-R76). See db/migrations/120_incident_self_check.sql for the full
-- argument: the 109 block above named five kinds; this widens the same
-- named CHECK to six so `api/self-check.js` can report a failing check as
-- an incident instead of being silently refused by the constraint.
alter table vy_incident drop constraint if exists vy_incident_kind_check;
alter table vy_incident add constraint vy_incident_kind_check
  check (kind in ('door_5xx', 'provider_payments', 'provider_telegram', 'provider_whatsapp', 'provider_webpush', 'self_check'));
-- Migration 121 - the poster and the QR (WS-R78). See
-- db/migrations/121_room_arrival_via_poster.sql for the full argument:
-- vy_room_arrival.via admits 'poster' alongside the five values migration
-- 113 already named, matching api/_room-surface.js's ROOM_ARRIVAL_VIA
-- widened in the same commit. The inline CHECK in the 102 block above and
-- the named constraint from 113 are both superseded by this one.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster'));

-- Migration 122 - the share kit (WS-R85). See
-- db/migrations/122_room_arrival_via_share_kit.sql for the full argument:
-- vy_room_arrival.via admits 'whatsapp', 'instagram', 'youtube' and
-- 'telegram' alongside the six values migration 121 already named, matching
-- api/_room-surface.js's ROOM_ARRIVAL_VIA widened in the same commit. The
-- named constraint from 121 is superseded by this one.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster', 'whatsapp', 'instagram', 'youtube', 'telegram'));

-- Migration 123 (its CHECK reconciled at the merge to the union of 122's channels and 123's friend) - follower referrals (WS-R86). See
-- db/migrations/123_room_referral.sql for the full argument: a room-
-- aggregate table with no person column at all, `referrer_hash` a salted
-- sha256 (RATE_SALT's own shape, undated -- a referral link must keep
-- comparing equal to itself for as long as it is shared) of the referring
-- follower's own person id and the Room, plus `vy_room_arrival.via`
-- widened to admit 'friend' alongside the six values migration 121 named.
create table if not exists vy_room_referral (
  referral_id   uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  referrer_hash text not null check (referrer_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now()
);

create index if not exists vy_room_referral_room_created_ix
  on vy_room_referral (room_id, created_at);

alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster', 'whatsapp', 'instagram', 'youtube', 'telegram', 'friend'));

-- Migration 125 - the operator's morning digest (WS-R88). See
-- db/migrations/125_operator_digest.sql for the full argument: one row per
-- DAY (never per subscription), content-free by schema, no person column at
-- all - `vy_sweep_run` (084) and `vy_incident` (109)'s own precedent
-- restated a third time.
create table if not exists vy_operator_digest (
  digest_id  uuid primary key,
  day        date not null,
  sent_at    timestamptz not null default now(),
  counts     jsonb not null default '{}'::jsonb
);
create unique index if not exists vy_operator_digest_day_ix
  on vy_operator_digest (day);
alter table vy_operator_digest drop constraint if exists vy_operator_digest_counts_object;
alter table vy_operator_digest add constraint vy_operator_digest_counts_object
  check (jsonb_typeof(counts) = 'object');
alter table vy_operator_digest drop constraint if exists vy_operator_digest_counts_size;
alter table vy_operator_digest add constraint vy_operator_digest_counts_size
  check (octet_length(counts::text) <= 4096);
create index if not exists vy_operator_digest_day_desc_ix
  on vy_operator_digest (day desc);

-- Migration 126 - the follower's receipt (WS-R100). See
-- db/migrations/126_receipt.sql for the full argument (CGST Rule 46
-- citation, the erasure-lane reasoning): a per-financial-year counter
-- claimed atomically, one receipt per payment event, `person_id` nullable
-- so an account-wide "forget everything" can null it without deleting the
-- row (the number and the amount survive; the person does not).
create table if not exists vy_receipt_counter (
  fy   text primary key check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  next bigint not null default 1 check (next > 0)
);

create table if not exists vy_receipt (
  receipt_id       uuid primary key default gen_random_uuid(),
  receipt_no       bigint not null check (receipt_no > 0),
  payment_event_id uuid not null references vy_payment_event(event_id) on delete cascade,
  room_id          uuid not null references vy_room(room_id) on delete cascade,
  person_id        uuid,
  issued_at        timestamptz not null default now()
);
create unique index if not exists vy_receipt_payment_event_ix
  on vy_receipt (payment_event_id);
create index if not exists vy_receipt_room_person_ix
  on vy_receipt (room_id, person_id, issued_at desc);

-- Migration 127 - the recall run (WS-R101). See
-- db/migrations/127_recall_run.sql for the full argument: one row per scored
-- run over a held-out question set built from the replica's own sources,
-- answered by the real compiled agent and scored 0-100. No foreign key
-- (009's convention); `superseded_at` set in the same statement as the
-- insert, guarded by the SAME predicate that enforces one run per replica
-- per hour, so a rate-limited call disturbs nothing.
create table if not exists vy_recall_run (
  run_id         uuid primary key default gen_random_uuid(),
  replica_id     uuid not null,
  owner_user_id  uuid not null,
  score          int not null check (score >= 0 and score <= 100),
  n              int not null check (n > 0),
  method         text not null default '',
  set_hash       text not null check (set_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  superseded_at  timestamptz
);
create index if not exists vy_recall_run_owner_ix
  on vy_recall_run (replica_id, owner_user_id, created_at desc);

-- Migration 128 - the Room on WhatsApp (WS-R104). See
-- db/migrations/128_room_whatsapp_chat.sql for the full argument: which
-- room a WhatsApp phone number currently means, `vy_room_follower_channel`'s
-- own pointer (082) restated one transport over, with the phone stored ONLY
-- as a salted sha256 (never in the clear) and, unlike 082, no FK on
-- person_id/follower_id (room_id keeps its FK with cascade; erasure reach
-- is the explicit by-name delete in roomForgetCore, not a cascade).
create table if not exists vy_room_follower_whatsapp_chat (
  phone_hash   text primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  follower_id  uuid not null,
  locale       text not null default 'en',
  joined_at    timestamptz not null default now(),
  stopped_at   timestamptz,
  stopped_code text,
  constraint vy_room_follower_whatsapp_chat_locale_check check (locale in ('en', 'hi')),
  constraint vy_room_follower_whatsapp_chat_hash_check check (phone_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists vy_room_follower_whatsapp_chat_person_ix
  on vy_room_follower_whatsapp_chat (person_id, room_id);
create index if not exists vy_room_follower_whatsapp_chat_follower_ix
  on vy_room_follower_whatsapp_chat (follower_id);

-- Migration 129 - review card kind widened to admit 'instruction_shaped'
-- (WS-R112). See db/migrations/129_review_card_instruction_shaped.sql for
-- the full argument. Drop-then-add on Postgres's own default name for this
-- unnamed, single-column, inline CHECK — migration 096's own precedent one
-- migration family over, for `vy_room_checkin_delivery`'s channel CHECK.
alter table vy_review_card drop constraint if exists vy_review_card_kind_check;
alter table vy_review_card add constraint vy_review_card_kind_check
  check (kind in ('question','claim','delta','follower_declined','instruction_shaped'));

-- Migration 130 - the UPI Autopay mandate lifecycle (WS-R125). See
-- db/migrations/130_mandate_state.sql for the full argument: a SIBLING
-- column to `state`, never a widening of `vy_room_subscription_state_check`/
-- `vy_creator_subscription_state_check` (`context/decisions.md#ws-r69-
-- halted-is-a-derived-read-never-a-stored-value`'s own reversal condition,
-- exercised here for a second reader rather than a third fifth-value-on-
-- `state`). Default 'none': a subscription with no bank-side mandate event
-- yet observed is exactly as renewal-eligible as one confirmed 'active'.
alter table vy_room_subscription add column if not exists mandate_state text not null default 'none';
alter table vy_room_subscription add column if not exists mandate_state_at timestamptz;
alter table vy_room_subscription drop constraint if exists vy_room_subscription_mandate_state_check;
alter table vy_room_subscription add constraint vy_room_subscription_mandate_state_check
  check (mandate_state in ('none', 'pending', 'active', 'paused', 'halted', 'cancelled', 'completed'));

alter table vy_creator_subscription add column if not exists mandate_state text not null default 'none';
alter table vy_creator_subscription add column if not exists mandate_state_at timestamptz;
alter table vy_creator_subscription drop constraint if exists vy_creator_subscription_mandate_state_check;
alter table vy_creator_subscription add constraint vy_creator_subscription_mandate_state_check
  check (mandate_state in ('none', 'pending', 'active', 'paused', 'halted', 'cancelled', 'completed'));
-- Migration 131 - join from WhatsApp (WS-R126). See
-- db/migrations/131_arrival_via_whatsapp.sql for the full argument: 'whatsapp'
-- is ALREADY a valid vy_room_arrival.via value as of migrations 122/123 (the
-- share kit's own web-link channel); this workstream reuses that SAME value
-- for a second, distinct arrival source (a follower opening the WhatsApp
-- Business chat itself via a wa.me deep link, api/_room-whatsapp-chat.js's
-- `handleJoin`) rather than adding a sibling one, so the two statements below
-- are a defensive, idempotent reassertion of the unchanged 11-value list, not
-- a genuine widening.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster', 'whatsapp', 'instagram', 'youtube', 'telegram', 'friend'));
-- Migration 132 - the Suite admin's weekly note (WS-R127). See
-- db/migrations/132_org_weekly_note.sql for the full argument; mirrored
-- here per this file's own convention. Content-free (org_id, week_start,
-- sent_at, channel), no FK on org_id (a send ledger outlives an org row the
-- same way `vy_org` itself outlives a creator's own erasure), owner lane
-- but outside PERSON_TABLES and outside scripts/relcheck.mjs's owner-lane
-- reach walk (no owner_user_id/person column exists on it at all).
create table if not exists vy_org_weekly_note (
  note_id    uuid primary key,
  org_id     uuid not null,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  channel    text not null check (channel in ('push', 'email'))
);
create unique index if not exists vy_org_weekly_note_org_week_channel_ix
  on vy_org_weekly_note (org_id, week_start, channel);
create index if not exists vy_org_weekly_note_org_sent_ix
  on vy_org_weekly_note (org_id, sent_at desc);
-- Migration 133 - the referral reward (WS-R130). See
-- db/migrations/133_referral_reward.sql for the full argument: a follower
-- whose personal link brought three friends who each completed a first
-- paid month gets one free month. `vy_room_referral_credit` is the
-- per-follower identity link `vy_room_referral` (123) deliberately does
-- not carry; `vy_room_referral_reward` is the grant itself, capped one per
-- follower per room per financial year by its own unique index. Neither
-- table carries an FK on its identity columns (`vy_room_follower_whatsapp_
-- chat`'s own precedent, 128) - both are financial-ledger rows that must
-- survive a person's later forget with their number and room intact.
create table if not exists vy_room_referral_credit (
  credit_id             uuid primary key,
  room_id               uuid not null references vy_room(room_id) on delete cascade,
  referred_follower_id  uuid not null,
  referrer_follower_id  uuid not null,
  referrer_person_id    uuid not null,
  created_at            timestamptz not null default now()
);
create unique index if not exists vy_room_referral_credit_referred_ix
  on vy_room_referral_credit (referred_follower_id);
create index if not exists vy_room_referral_credit_referrer_ix
  on vy_room_referral_credit (referrer_follower_id);

create table if not exists vy_room_referral_reward (
  reward_id             uuid primary key,
  room_id               uuid not null references vy_room(room_id) on delete cascade,
  referrer_follower_id  uuid not null,
  referrer_person_id    uuid not null,
  granted_at            timestamptz not null default now(),
  period_extended_to    timestamptz not null,
  year_key              text not null,
  reason                text not null default 'referral_reward',
  constraint vy_room_referral_reward_year_key_check check (year_key ~ '^[0-9]{4}-[0-9]{2}$')
);
create unique index if not exists vy_room_referral_reward_cap_ix
  on vy_room_referral_reward (referrer_follower_id, room_id, year_key);
create index if not exists vy_room_referral_reward_room_granted_ix
  on vy_room_referral_reward (room_id, granted_at);

-- Migration 134 - the follower's own timezone and quiet hours (WS-R131).
-- See db/migrations/134_follower_quiet_hours.sql for the full argument: a
-- real, one-row-per-follower column set (nullable, both-or-neither on the
-- quiet pair, IANA-shaped timezone), set once on the account page, that a
-- new check-in schedule inherits and that the shared quiet-hours fragment
-- (api/_quiet-hours.js) now prefers over WS-R129's check-in proxy.
alter table vy_room_follower add column if not exists timezone text;
alter table vy_room_follower add column if not exists quiet_from time;
alter table vy_room_follower add column if not exists quiet_to time;
alter table vy_room_follower drop constraint if exists vy_room_follower_quiet_hours_pairing_check;
alter table vy_room_follower add constraint vy_room_follower_quiet_hours_pairing_check
  check ((quiet_from is null and quiet_to is null) or (quiet_from is not null and quiet_to is not null));
alter table vy_room_follower drop constraint if exists vy_room_follower_timezone_shape_check;
alter table vy_room_follower add constraint vy_room_follower_timezone_shape_check
  check (timezone is null or timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+)*$');
-- Migration 135 - starting a new mandate after a halted or cancelled one
-- (WS-R132). See db/migrations/135_live_subscription_excludes_halted.sql
-- for the full argument: the two "ONE LIVE SUBSCRIPTION" partial unique
-- indexes below now also require `mandate_state not in ('halted',
-- 'cancelled')`, so a halted or cancelled mandate no longer blocks a
-- follower or creator from starting a fresh one. Both index definitions
-- below REPLACE the ones created earlier in this file by migrations 078
-- and 095 - this file mirrors the live schema's final shape, so the
-- earlier `create unique index if not exists` statements for these same
-- two names are stale and are not run again; only the migration file
-- itself carries the `drop index` that actually widens the live database.
drop index if exists vy_room_subscription_follower_live_ix;
create unique index if not exists vy_room_subscription_follower_live_ix
  on vy_room_subscription (follower_id)
  where state in ('created','authenticated','active','paused')
    and mandate_state not in ('halted','cancelled');
drop index if exists vy_creator_subscription_replica_live_ix;
create unique index if not exists vy_creator_subscription_replica_live_ix
  on vy_creator_subscription (replica_id)
  where state in ('created','authenticated','active','paused')
    and mandate_state not in ('halted','cancelled');
-- Migration 136 - the follower's monthly note (WS-R137). See
-- db/migrations/136_room_follower_month_note.sql for the full argument.
-- Content-free ledger (no counts, no text - api/_room-month-note.js
-- recomputes the note fresh every time); unique (follower_id, room_id,
-- month_key) is the whole idempotency. FK on room_id only, cascade; no FK
-- on follower_id/person_id (009's convention) - a follower's own forget
-- deletes this row by an explicit statement in roomForgetCore.
create table if not exists vy_room_follower_month_note (
  note_id             uuid primary key,
  room_id             uuid not null references vy_room(room_id) on delete cascade,
  follower_id         uuid not null,
  person_id           uuid not null,
  month_key           text not null,
  built_at            timestamptz not null default now(),
  delivered_channels  text[] not null default '{}'::text[],
  constraint vy_room_follower_month_note_month_key_check
    check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);
create unique index if not exists vy_room_follower_month_note_follower_room_month_ix
  on vy_room_follower_month_note (follower_id, room_id, month_key);
create index if not exists vy_room_follower_month_note_follower_built_ix
  on vy_room_follower_month_note (follower_id, built_at desc);
create index if not exists vy_room_follower_month_note_room_person_ix
  on vy_room_follower_month_note (room_id, person_id);

-- INTEGRATION CANDIDATE: local voice lineage; catalog verification pending.
-- Migration 067 - durable, owner-scoped ordinary voice-preview intents.
create table if not exists vy_replica_voice_preview_intent (
  intent_id             uuid primary key,
  replica_id            uuid not null,
  owner_user_id         uuid not null,
  genome_version        integer not null check (genome_version > 0),
  preview_artifact_id   uuid not null,
  language_id           text not null check (language_id in ('en','hi')),
  text_hash              text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  text_plan_sha256       text not null check (text_plan_sha256 ~ '^[0-9a-f]{64}$'),
  model_commitment       text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
  style                  jsonb not null,
  preview_seed           integer not null check (preview_seed between 1 and 2147483647),
  regeneration_key       text not null default '',
  intent_key             text not null check (intent_key ~ '^[0-9a-f]{64}$'),
  state                  text not null check (state in ('warming','synthesizing','sealed','retryable','failed')),
  attempt                integer not null default 1 check (attempt > 0),
  generation_id          uuid,
  lease_token_hash       text not null default '',
  leased_at              timestamptz,
  lease_expires_at       timestamptz,
  next_attempt_at        timestamptz not null default now(),
  failure_code           text not null default '',
  failure_count          integer not null default 0 check (failure_count between 0 and 3),
  result_storage_bucket  text,
  result_object_path     text,
  result_mime            text,
  result_byte_size       bigint,
  result_sha256          text,
  result_object_id       text,
  result_metadata        jsonb not null default '{}'::jsonb,
  result_expires_at      timestamptz,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  updated_at             timestamptz not null default now(),
  constraint vy_replica_voice_preview_intent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_preview_intent_artifact_fk
    foreign key (preview_artifact_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_preview_intent_style_shape
    check (jsonb_typeof(style)='object' and octet_length(style::text) between 2 and 2048),
  constraint vy_replica_voice_preview_intent_regeneration_key_shape
    check (regeneration_key='' or regeneration_key ~ '^[A-Za-z0-9_-]{8,96}$'),
  constraint vy_replica_voice_preview_intent_lease_shape check (
    (state<>'synthesizing' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
    or
    (state='synthesizing' and lease_token_hash ~ '^[0-9a-f]{64}$'
      and leased_at is not null and lease_expires_at>leased_at)
  ),
  constraint vy_replica_voice_preview_intent_result_shape check (
    (
      state='sealed' and generation_id is not null and completed_at is not null
      and result_expires_at>completed_at
      and lease_token_hash='' and failure_code=''
      and result_storage_bucket is not null and result_object_path is not null
      and result_mime='audio/wav' and result_byte_size between 45 and 67108864
      and result_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(result_metadata)='object' and octet_length(result_metadata::text)<=2048
    ) or (
      state<>'sealed' and completed_at is null
      and result_expires_at is null
      and result_storage_bucket is null and result_object_path is null
      and result_mime is null and result_byte_size is null and result_sha256 is null
      and result_object_id is null
    )
  ),
  constraint vy_replica_voice_preview_intent_exact_identity unique
    (owner_user_id, replica_id, genome_version, preview_artifact_id, language_id,
     text_hash, text_plan_sha256, model_commitment, style, preview_seed, regeneration_key),
  constraint vy_replica_voice_preview_intent_key_identity unique
    (owner_user_id, intent_key, regeneration_key),
  constraint vy_replica_voice_preview_intent_owner_identity unique
    (intent_id, replica_id, owner_user_id)
);

create index if not exists vy_replica_voice_preview_intent_observe_ix
  on vy_replica_voice_preview_intent
    (owner_user_id, replica_id, updated_at desc);

create index if not exists vy_replica_voice_preview_intent_recovery_ix
  on vy_replica_voice_preview_intent
    (state, next_attempt_at, lease_expires_at)
  where state in ('warming','synthesizing','retryable');

alter table vy_replica_generation
  add column if not exists preview_intent_id uuid;

alter table vy_replica_generation
  add column if not exists preview_intent_attempt integer;

alter table vy_replica_generation
  add column if not exists preview_regeneration_key text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_storage_bucket text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_object_path text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_deleted_at timestamptz;

alter table vy_replica_generation
  add column if not exists preview_result_cleanup_claimed_at timestamptz;

alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_intent_shape;

alter table vy_replica_generation
  add constraint vy_replica_generation_preview_intent_shape check (
    (preview_intent_id is null and preview_intent_attempt is null and preview_regeneration_key=''
      and preview_result_storage_bucket='' and preview_result_object_path=''
      and preview_result_deleted_at is null and preview_result_cleanup_claimed_at is null)
    or
    (purpose='voice_preview' and preview_trial_id is null and preview_intent_id is not null
      and preview_intent_attempt>0
      and (preview_regeneration_key='' or preview_regeneration_key ~ '^[A-Za-z0-9_-]{8,96}$')
      and preview_result_storage_bucket<>''
      and preview_result_object_path like '%/derived/voice-preview/%.wav')
  );

alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_intent_fk;

alter table vy_replica_generation
  add constraint vy_replica_generation_preview_intent_fk
    foreign key (preview_intent_id, replica_id, owner_user_id)
    references vy_replica_voice_preview_intent(intent_id, replica_id, owner_user_id) on delete cascade;

create unique index if not exists vy_replica_generation_preview_intent_attempt_ix
  on vy_replica_generation (preview_intent_id, preview_intent_attempt)
  where preview_intent_id is not null;

-- Migration 066 - one owner-chosen audio or video source drives voice
-- conditioning. Every other source remains available to the wider person
-- model as supporting context.
create unique index if not exists vy_replica_source_owner_locator_ix
  on vy_replica_source (source_id, replica_id, owner_user_id);

create table if not exists vy_replica_voice_reference (
  replica_id      uuid primary key,
  owner_user_id   uuid not null,
  source_id       uuid not null unique,
  selected_at     timestamptz not null default now(),
  constraint vy_replica_voice_reference_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_reference_source_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade
);

with latest_selection as (
  select distinct on (d.artifact_id)
         d.artifact_id, d.decision, d.created_at, d.decision_id
    from vy_replica_processing_artifact_decision d
   order by d.artifact_id, d.created_at desc, d.decision_id desc
), candidates as (
  select distinct on (s.replica_id)
         s.replica_id, s.owner_user_id, s.source_id
    from vy_replica_source s
    join vy_replica_processing_artifact a
      on a.source_id=s.source_id and a.replica_id=s.replica_id and a.owner_user_id=s.owner_user_id
    join latest_selection d on d.artifact_id=a.artifact_id and d.decision='selected'
   where s.kind in ('audio','video') and s.capture_mode in ('upload','import','derived')
     and s.state='ready' and s.contains_third_parties=false and a.stage='enhance'
   order by s.replica_id, d.created_at desc, d.decision_id desc, a.created_at desc
)
insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id)
select replica_id,owner_user_id,source_id from candidates
on conflict (replica_id) do nothing;

-- Migration 068 - short-lived, source-cited expression observations. One row
-- is one measurable delivery or turn-taking feature, never an inner state.
create unique index if not exists vy_replica_expression_scope_ix
  on vy_replica (replica_id, owner_user_id, agent_id);
create unique index if not exists vy_replica_source_expression_scope_ix
  on vy_replica_source (source_id, replica_id, owner_user_id, sha256);
create unique index if not exists vy_mirror_session_expression_scope_ix
  on vy_mirror_session (session_id, replica_id, owner_user_id);
create unique index if not exists vy_mirror_window_expression_scope_ix
  on vy_mirror_window (window_id, session_id, replica_id, owner_user_id);
create unique index if not exists vy_mirror_turn_expression_scope_ix
  on vy_mirror_turn (turn_id, window_id, session_id, replica_id, owner_user_id);

create table if not exists vy_replica_expression_observation (
  observation_id          text primary key
                          check (observation_id ~ '^obs_[0-9a-f]{64}$'),
  replica_id               uuid not null,
  owner_user_id            uuid not null,
  source_id                uuid not null,
  source_commitment_id     text not null
                          check (source_commitment_id ~ '^src_[0-9a-f]{64}$'),
  source_record_hash       text not null
                          check (source_record_hash ~ '^[0-9a-f]{64}$'),
  source_content_sha256    text not null
                          check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_consent_id        uuid not null,
  session_id               uuid,
  window_id                uuid,
  mirror_turn_id           uuid,
  turn_id                  text not null
                          check (turn_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  dyad_id                  text not null
                          check (dyad_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  agent_id                 uuid,
  person_id                uuid,
  span_unit                text not null
                          check (span_unit in ('audio_ms','video_ms','utf8_bytes')),
  span_start               bigint not null check (span_start >= 0),
  span_end                 bigint not null check (span_end > span_start),
  span_content_sha256      text not null
                          check (span_content_sha256 ~ '^[0-9a-f]{64}$'),
  span_hash                text not null
                          check (span_hash ~ '^[0-9a-f]{64}$'),
  feature_name             text not null check (feature_name in (
                            'speech_rate_wpm','articulation_rate_sps',
                            'pause_ratio','mean_pause_ms','pause_count',
                            'turn_latency_ms','turn_duration_ms',
                            'overlap_ratio','interruption_count','backchannel_count',
                            'laughter_ratio','laughter_count',
                            'energy_rms_db','pitch_median_hz','pitch_range_hz',
                            'voiced_ratio','emphasis_rate','code_switch_ratio',
                            'token_count','syllable_count'
                          )),
  feature_value            double precision not null,
  feature_unit             text not null check (feature_unit in (
                            'words_per_minute','syllables_per_second','ratio',
                            'milliseconds','count','decibels_rms','hertz',
                            'events_per_minute'
                          )),
  epistemic_status         text not null check (epistemic_status in ('observed','inferred')),
  confidence               double precision not null check (confidence between 0 and 1),
  producer_kind            text not null
                          check (producer_kind in ('direct_measurement','model','rules','human_annotation')),
  producer_name            text not null
                          check (producer_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  producer_revision        text not null
                          check (producer_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  producer_code_hash       text not null
                          check (producer_code_hash ~ '^[0-9a-f]{64}$'),
  calibration_status       text not null check (calibration_status in ('calibrated','uncalibrated')),
  calibration_method       text not null
                          check (calibration_method ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  calibration_revision     text not null
                          check (calibration_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  calibration_sample_size  integer not null check (calibration_sample_size >= 0),
  calibration_dataset_hash text,
  calibration_measured_at  timestamptz,
  observed_at               timestamptz not null,
  expires_at                timestamptz not null,
  compiler_revision         text not null check (compiler_revision='experience-compiler-contract-v1'),
  claim_target              text not null check (claim_target='delivery_cue'),
  interpretation            text not null check (interpretation='observer_interpretation'),
  may_claim_inner_emotion   boolean not null default false
                           check (may_claim_inner_emotion=false),
  record_hash               text not null unique
                           check (record_hash ~ '^[0-9a-f]{64}$'),
  created_at                timestamptz not null default now(),
  constraint vy_replica_expression_observation_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_agent_scope_fk
    foreign key (replica_id, owner_user_id, agent_id)
    references vy_replica(replica_id, owner_user_id, agent_id) on delete cascade,
  constraint vy_replica_expression_observation_person_fk
    foreign key (person_id) references vy_person(person_id) on delete cascade,
  constraint vy_replica_expression_observation_source_fk
    foreign key (source_id, replica_id, owner_user_id, source_content_sha256)
    references vy_replica_source(source_id, replica_id, owner_user_id, sha256) on delete cascade,
  constraint vy_replica_expression_observation_consent_fk
    foreign key (source_consent_id, replica_id, owner_user_id)
    references vy_replica_consent(consent_id, replica_id, owner_user_id),
  constraint vy_replica_expression_observation_session_fk
    foreign key (session_id, replica_id, owner_user_id)
    references vy_mirror_session(session_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_window_fk
    foreign key (window_id, session_id, replica_id, owner_user_id)
    references vy_mirror_window(window_id, session_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_turn_fk
    foreign key (mirror_turn_id, window_id, session_id, replica_id, owner_user_id)
    references vy_mirror_turn(turn_id, window_id, session_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_mirror_scope check (
    (session_id is null and window_id is null and mirror_turn_id is null)
    or
    (session_id is not null and
      (window_id is not null or mirror_turn_id is null) and
      (mirror_turn_id is null or window_id is not null))
  ),
  constraint vy_replica_expression_observation_turn_binding
    check (mirror_turn_id is null or turn_id=mirror_turn_id::text),
  constraint vy_replica_expression_observation_finite
    check (feature_value > '-Infinity'::double precision
      and feature_value < 'Infinity'::double precision),
  constraint vy_replica_expression_observation_feature_shape check (
    (feature_name='speech_rate_wpm' and feature_unit='words_per_minute' and feature_value between 0 and 1000)
    or (feature_name='articulation_rate_sps' and feature_unit='syllables_per_second' and feature_value between 0 and 50)
    or (feature_name in ('pause_ratio','overlap_ratio','laughter_ratio','voiced_ratio','code_switch_ratio')
      and feature_unit='ratio' and feature_value between 0 and 1)
    or (feature_name in ('mean_pause_ms','turn_latency_ms') and feature_unit='milliseconds' and feature_value between 0 and 300000)
    or (feature_name='turn_duration_ms' and feature_unit='milliseconds' and feature_value between 1 and 86400000)
    or (feature_name in ('pause_count','interruption_count','backchannel_count','laughter_count')
      and feature_unit='count' and feature_value between 0 and 10000 and feature_value=trunc(feature_value))
    or (feature_name in ('token_count','syllable_count')
      and feature_unit='count' and feature_value between 0 and 1000000 and feature_value=trunc(feature_value))
    or (feature_name='energy_rms_db' and feature_unit='decibels_rms' and feature_value between -200 and 50)
    or (feature_name in ('pitch_median_hz','pitch_range_hz') and feature_unit='hertz' and feature_value between 0 and 5000)
    or (feature_name='emphasis_rate' and feature_unit='events_per_minute' and feature_value between 0 and 1000)
  ),
  constraint vy_replica_expression_observation_epistemic_producer check (
    (epistemic_status='observed' and producer_kind in ('direct_measurement','human_annotation'))
    or
    (epistemic_status='inferred' and producer_kind in ('model','rules'))
  ),
  constraint vy_replica_expression_observation_calibration_shape check (
    (calibration_status='uncalibrated' and calibration_sample_size=0
      and calibration_dataset_hash is null and calibration_measured_at is null)
    or
    (calibration_status='calibrated' and calibration_sample_size>0
      and calibration_dataset_hash ~ '^[0-9a-f]{64}$' and calibration_measured_at is not null)
  ),
  constraint vy_replica_expression_observation_expiry check (
    expires_at>observed_at and expires_at<=observed_at+interval '24 hours'
  )
);

create index if not exists vy_replica_expression_observation_active_ix
  on vy_replica_expression_observation
    (owner_user_id, replica_id, expires_at, observed_at desc);
create index if not exists vy_replica_expression_observation_dyad_ix
  on vy_replica_expression_observation
    (owner_user_id, replica_id, dyad_id, observed_at desc);
create index if not exists vy_replica_expression_observation_source_ix
  on vy_replica_expression_observation
    (source_id, span_start, span_end, feature_name);

-- migration 069 - durable nearline claim extraction queue

alter table vy_replica_claim_extraction
  add column if not exists lease_token_hash text not null default '';
alter table vy_replica_claim_extraction
  add column if not exists leased_at timestamptz;
alter table vy_replica_claim_extraction
  add column if not exists lease_expires_at timestamptz;
alter table vy_replica_claim_extraction
  drop constraint if exists vy_replica_claim_extraction_lease_shape;
alter table vy_replica_claim_extraction
  add constraint vy_replica_claim_extraction_lease_shape check (
    (state='extracting' and (
      (lease_token_hash='' and leased_at is null and lease_expires_at is null)
      or
      (lease_token_hash ~ '^[0-9a-f]{64}$' and leased_at is not null
        and lease_expires_at is not null and lease_expires_at>leased_at)
    ))
    or
    (state<>'extracting' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
  );

create table if not exists vy_replica_claim_extraction_input (
  run_id          uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  evidence_id     uuid not null,
  source_id       uuid not null,
  created_at      timestamptz not null default now(),
  primary key (run_id,evidence_id),
  constraint vy_replica_claim_extraction_input_run_fk
    foreign key (run_id,replica_id,owner_user_id)
    references vy_replica_claim_extraction(run_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);
create index if not exists vy_replica_claim_extraction_input_evidence_ix
  on vy_replica_claim_extraction_input (owner_user_id,replica_id,evidence_id);

create table if not exists vy_replica_claim_extraction_queue (
  job_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  state              text not null default 'queued'
                     check (state in ('queued','running','waiting','complete')),
  attempt            integer not null default 0 check (attempt>=0),
  next_attempt_at    timestamptz not null default now(),
  lease_token_hash   text not null default '',
  leased_at          timestamptz,
  lease_expires_at   timestamptz,
  last_error_code    text not null default '',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_claim_extraction_queue_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_owner_unique
    unique (replica_id,owner_user_id),
  constraint vy_replica_claim_extraction_queue_owner_tuple
    unique (job_id,replica_id,owner_user_id),
  constraint vy_replica_claim_extraction_queue_lease_shape check (
    (state='running' and lease_token_hash ~ '^[0-9a-f]{64}$'
      and leased_at is not null and lease_expires_at is not null
      and lease_expires_at>leased_at and completed_at is null)
    or
    (state<>'running' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
  ),
  constraint vy_replica_claim_extraction_queue_waiting_reason check (
    state<>'waiting' or last_error_code<>''
  ),
  constraint vy_replica_claim_extraction_queue_complete_shape check (
    (state='complete' and completed_at is not null)
    or
    (state<>'complete' and completed_at is null)
  )
);
create index if not exists vy_replica_claim_extraction_queue_due_ix
  on vy_replica_claim_extraction_queue (next_attempt_at,created_at)
  where state in ('queued','waiting','running');

create table if not exists vy_replica_claim_extraction_queue_item (
  job_id          uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  evidence_id     uuid not null,
  source_id       uuid not null,
  state           text not null default 'pending' check (state in ('pending','complete')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  primary key (job_id,evidence_id),
  constraint vy_replica_claim_extraction_queue_item_evidence_unique unique (evidence_id),
  constraint vy_replica_claim_extraction_queue_item_job_fk
    foreign key (job_id,replica_id,owner_user_id)
    references vy_replica_claim_extraction_queue(job_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_complete_shape check (
    (state='complete' and completed_at is not null)
    or
    (state='pending' and completed_at is null)
  )
);
create index if not exists vy_replica_claim_extraction_queue_item_pending_ix
  on vy_replica_claim_extraction_queue_item (job_id,created_at,evidence_id)
  where state='pending';

-- migration 070 - Context Locker sources and canonical text/image evidence

alter table vy_replica_processing_evidence
  drop constraint if exists vy_replica_processing_evidence_evidence_type_check;
alter table vy_replica_processing_evidence
  add constraint vy_replica_processing_evidence_evidence_type_check check (
    evidence_type in (
      'media_probe','speaker_segment','transcript_span','language_span',
      'voice_embedding','voice_measurement','quality_measurement',
      'text_span','image_region'
    )
  );

alter table vy_context_item add column if not exists source_id uuid;
create unique index if not exists vy_context_item_owner_tuple_ix
  on vy_context_item (item_id, replica_id, owner_user_id);
create unique index if not exists vy_context_item_source_ix
  on vy_context_item (source_id) where source_id is not null;
alter table vy_context_item drop constraint if exists vy_context_item_source_fk;
alter table vy_context_item add constraint vy_context_item_source_fk
  foreign key (source_id, replica_id, owner_user_id)
  references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade;
alter table vy_context_item_text drop constraint if exists vy_context_item_text_item_fk;
alter table vy_context_item_text add constraint vy_context_item_text_item_fk
  foreign key (item_id, replica_id, owner_user_id)
  references vy_context_item(item_id, replica_id, owner_user_id) on delete cascade;

-- migration 071 - exact TeacherSheet materialization lineage for Mirror deltas

alter table vy_mirror_delta add column if not exists applied_sheet_id uuid;
alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_applied_sheet_shape;
alter table vy_mirror_delta add constraint vy_mirror_delta_applied_sheet_shape
  check (applied_sheet_id is null or applied_at is not null);
alter table vy_mirror_delta drop constraint if exists vy_mirror_delta_applied_sheet_fk;
alter table vy_mirror_delta add constraint vy_mirror_delta_applied_sheet_fk
  foreign key (applied_sheet_id) references vy_teacher_sheet(sheet_id) on delete set null;
create index if not exists vy_mirror_delta_applied_sheet_ix
  on vy_mirror_delta (applied_sheet_id) where applied_sheet_id is not null;

-- migration 072 - idempotent public clone creation saga

alter table vy_replica add column if not exists creation_intent_id uuid;
create unique index if not exists vy_replica_owner_creation_intent_ix
  on vy_replica (owner_user_id, creation_intent_id)
  where creation_intent_id is not null;

alter table vy_replica_source add column if not exists upload_intent_id uuid;
alter table vy_replica_source add column if not exists language_hint text;
alter table vy_replica_source drop constraint if exists vy_replica_source_language_hint_check;
alter table vy_replica_source add constraint vy_replica_source_language_hint_check
  check (language_hint is null or language_hint in ('en','hi','hi-latn'));
create unique index if not exists vy_replica_source_owner_upload_intent_ix
  on vy_replica_source (owner_user_id, replica_id, upload_intent_id)
  where upload_intent_id is not null;

create table if not exists vy_replica_voice_build_intent (
  intent_id        uuid primary key,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  candidate_source_id uuid not null,
  state            text not null default 'waiting'
                   check (state in ('waiting','queued','review','failed')),
  build_id         uuid,
  blockers         text[] not null default '{}'::text[],
  last_error_code  text not null default '',
  promoted_at      timestamptz,
  next_check_at    timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vy_replica_voice_build_intent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_build_intent_candidate_fk
    foreign key (candidate_source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_build_intent_build_fk
    foreign key (build_id) references vy_replica_model_build(build_id) on delete cascade,
  constraint vy_replica_voice_build_intent_owner_tuple
    unique (intent_id, replica_id, owner_user_id),
  constraint vy_replica_voice_build_intent_shape check (
    (state='waiting' and build_id is null and promoted_at is null)
    or
    (state='queued' and build_id is not null and promoted_at is null)
    or
    (state='review' and build_id is not null and promoted_at is not null)
    or
    (state='failed' and promoted_at is null)
  ),
  constraint vy_replica_voice_build_intent_blocker_shape check (
    cardinality(blockers)<=16 and (
      cardinality(blockers)=0
      or array_to_string(blockers,',') ~ '^[a-z0-9_]{1,96}(,[a-z0-9_]{1,96}){0,15}$'
    )
  ),
  constraint vy_replica_voice_build_intent_error_shape check (
    last_error_code='' or last_error_code ~ '^[a-z0-9_]{1,96}$'
  )
);
create index if not exists vy_replica_voice_build_intent_due_ix
  on vy_replica_voice_build_intent (next_check_at, created_at)
  where state in ('waiting','queued');
create index if not exists vy_replica_voice_build_intent_owner_ix
  on vy_replica_voice_build_intent (owner_user_id, replica_id, created_at desc);

-- Migration 073 - direct upload authorization fence for physical erasure.
alter table vy_replica_source
  add column if not exists upload_authorization_expires_at timestamptz;

update vy_replica_source
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;

-- Migration 074 - durable channel extraction storage authority.
alter table vy_ingest_run
  add column if not exists upload_authorization_expires_at timestamptz
  default (now()+interval '210 minutes');
update vy_ingest_run
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;
alter table vy_video_enrollment
  add column if not exists upload_authorization_expires_at timestamptz
  default (now()+interval '210 minutes');
update vy_video_enrollment
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;
create table if not exists vy_channel_extraction_object (
  extraction_object_id uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  scope_kind           text not null
                       check (scope_kind in ('channel_watch','video_enrollment')),
  scope_id             uuid not null,
  video_id             text not null
                       check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  storage_bucket       text not null
                       check (
                         storage_bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
                         or storage_bucket ~ '^azureblob:[a-z0-9]{3,24}:[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
                       ),
  object_path          text not null
                       check (length(object_path) between 1 and 1024),
  upload_authorization_expires_at timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_channel_extraction_object_scope_path check (
    object_path = owner_user_id::text || '/' || replica_id::text || '/' ||
      scope_id::text || '/' || video_id || '/original'
  ),
  constraint vy_channel_extraction_object_locator_unique
    unique (replica_id, storage_bucket, object_path),
  constraint vy_channel_extraction_object_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);
create index if not exists vy_channel_extraction_object_owner_ix
  on vy_channel_extraction_object (owner_user_id, replica_id, created_at desc);
create index if not exists vy_channel_extraction_object_authority_ix
  on vy_channel_extraction_object (replica_id, upload_authorization_expires_at);

-- Migration 075 - durable token-fenced authority for server storage writes.
alter table vy_replica_source
  alter column upload_authorization_expires_at
  set default (now()+interval '12 hours');
create table if not exists vy_replica_source_storage_writer (
  writer_id              uuid primary key,
  source_id              uuid not null,
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  purpose                text not null
                         check (purpose in (
                           'context_source','processing_artifact','voice_preview_result','legacy_rollout'
                         )),
  guard_id               uuid not null,
  guard_token_hash       text not null
                         check (guard_token_hash ~ '^[0-9a-f]{64}$'),
  token_hash             text not null
                         check (token_hash ~ '^[0-9a-f]{64}$'),
  state                  text not null default 'active'
                         check (state in ('active','released')),
  storage_write_not_after timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  released_at            timestamptz,
  constraint vy_replica_source_storage_writer_release_shape check (
    (state='active' and released_at is null)
    or (state='released' and released_at is not null)
  ),
  constraint vy_replica_source_storage_writer_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);
create index if not exists vy_replica_source_storage_writer_active_ix
  on vy_replica_source_storage_writer (source_id,storage_write_not_after)
  where state='active';
create index if not exists vy_replica_source_storage_writer_owner_ix
  on vy_replica_source_storage_writer (owner_user_id,replica_id,created_at desc);
create table if not exists vy_replica_storage_writer_rollout (
  rollout_key text primary key check (rollout_key='075'),
  completed_at timestamptz not null default now()
);
with first_apply as (
  insert into vy_replica_storage_writer_rollout (rollout_key)
  values ('075')
  on conflict (rollout_key) do nothing
  returning rollout_key
)
insert into vy_replica_source_storage_writer
  (writer_id,source_id,replica_id,owner_user_id,purpose,guard_id,guard_token_hash,
   token_hash,state,storage_write_not_after)
select s.source_id,s.source_id,s.replica_id,s.owner_user_id,'legacy_rollout',
       s.source_id,repeat('0',64),repeat('0',64),'active',now()+interval '12 hours'
  from vy_replica_source s
  cross join first_apply
on conflict (writer_id) do nothing;

-- Migration 076 - structural write-after-erasure fence for owner/replica rows.
-- vy_replica_audit intentionally remains NOT VALID because live preflight
-- found historical content-free orphan rows; new writes are still enforced.
alter table vy_replica_audit
  drop constraint if exists vy_replica_audit_replica_owner_fk,
  add constraint vy_replica_audit_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_clone_channel
  drop constraint if exists vy_clone_channel_replica_owner_fk,
  add constraint vy_clone_channel_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_channel_attestation
  drop constraint if exists vy_channel_attestation_replica_owner_fk,
  add constraint vy_channel_attestation_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_channel_watch
  drop constraint if exists vy_channel_watch_replica_owner_fk,
  add constraint vy_channel_watch_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_ingest_run
  drop constraint if exists vy_ingest_run_replica_owner_fk,
  add constraint vy_ingest_run_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_context_item
  drop constraint if exists vy_context_item_replica_owner_fk,
  add constraint vy_context_item_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_context_item_text
  drop constraint if exists vy_context_item_text_replica_owner_fk,
  add constraint vy_context_item_text_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_video_enrollment
  drop constraint if exists vy_video_enrollment_replica_owner_fk,
  add constraint vy_video_enrollment_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table vy_video_enrollment_window
  drop constraint if exists vy_video_enrollment_window_replica_owner_fk,
  add constraint vy_video_enrollment_window_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;
alter table meera_log
  drop constraint if exists meera_log_agent_fk,
  add constraint meera_log_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;
alter table vy_episode
  drop constraint if exists vy_episode_agent_fk,
  add constraint vy_episode_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;
alter table vy_fact
  drop constraint if exists vy_fact_agent_fk,
  add constraint vy_fact_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;
alter table vy_teacher_sheet
  drop constraint if exists vy_teacher_sheet_agent_fk,
  add constraint vy_teacher_sheet_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;
alter table vy_clone_channel validate constraint vy_clone_channel_replica_owner_fk;
alter table vy_channel_attestation validate constraint vy_channel_attestation_replica_owner_fk;
alter table vy_channel_watch validate constraint vy_channel_watch_replica_owner_fk;
alter table vy_ingest_run validate constraint vy_ingest_run_replica_owner_fk;
alter table vy_context_item validate constraint vy_context_item_replica_owner_fk;
alter table vy_context_item_text validate constraint vy_context_item_text_replica_owner_fk;
alter table vy_video_enrollment validate constraint vy_video_enrollment_replica_owner_fk;
alter table vy_video_enrollment_window validate constraint vy_video_enrollment_window_replica_owner_fk;
alter table meera_log validate constraint meera_log_agent_fk;
alter table vy_episode validate constraint vy_episode_agent_fk;
alter table vy_fact validate constraint vy_fact_agent_fk;
alter table vy_teacher_sheet validate constraint vy_teacher_sheet_agent_fk;

-- Integration source-purpose reconciliation candidate, unexecuted.
-- Integration candidate only. Not applied or catalog-verified.
-- Preserve every known source purpose from Rooms and the local clone lineage.
-- Before execution, inspect pg_constraint and distinct purpose values on the
-- intended database; any value or CHECK beyond this set requires review.
-- One atomic statement: no window without the constraint.
alter table vy_replica_source
  drop constraint if exists vy_replica_source_purpose_check,
  add constraint vy_replica_source_purpose_check
    check (purpose in ('memory','identity_document','identity_challenge','correction','interview','mirror_window','context_item'));

-- Migration 137: additive issued voice-challenge contract.
-- No backfill: NULL means legacy/unversioned evidence, never inferred locale.
-- Non-v2 legacy policy labels are preserved, not authorized for new serving.
-- Each statement is independently idempotent; no DO block or cross-request
-- transaction is required. Hashes are format-checked here; canonical JSON
-- commitment validation and bank/profile registry checks remain application
-- responsibilities. This migration does not enable the prerequisite profile.

alter table vy_replica_voice_challenge
  add column if not exists issued_locale text,
  add column if not exists sentence_bank_version text,
  add column if not exists verifier_profile text,
  add column if not exists issued_contract jsonb,
  add column if not exists issued_contract_sha256 text;

alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_issued_contract_check,
  add constraint vy_replica_voice_challenge_issued_contract_check
  check ((
    (
      issued_locale is null and sentence_bank_version is null
      and verifier_profile is null and issued_contract is null
      and issued_contract_sha256 is null
      and challenge_policy <> 'voice-identity-challenge/v2'
    )
    or
    (
      issued_locale is not null and sentence_bank_version is not null
      and verifier_profile is not null and issued_contract is not null
      and issued_contract_sha256 is not null
      and challenge_policy = 'voice-identity-challenge/v2'
      and reference_genome_version is not null and reference_genome_version > 0
      and issued_locale in ('hi-IN','en-IN')
      and (
        (issued_locale='hi-IN' and sentence_bank_version='identity-bank-hi-deva/v1')
        or (issued_locale='en-IN' and sentence_bank_version='identity-bank-en-latn/v1')
      )
      and verifier_profile='azure-shared-audio/v1'
      and length(issued_contract_sha256)=64
      and issued_contract_sha256 ~ '^[0-9a-f]{64}$'
      and octet_length(issued_contract::text)<=4096
      and case when jsonb_typeof(issued_contract)='object' then (
        -- Both checks are needed: no missing keys and no additional keys.
        issued_contract ?& array[
          'schema','challenge_id','replica_id','owner_user_id','issued_locale',
          'sentence_bank_version','sentence_bank_sha256','sentence_item_id',
          'sentence_hash','nonce_sha256','normalizer_version',
          'decision_policy_version','verifier_profile','verifier_profile_sha256',
          'reference_genome_version'
        ]::text[]
        and (issued_contract - array[
          'schema','challenge_id','replica_id','owner_user_id','issued_locale',
          'sentence_bank_version','sentence_bank_sha256','sentence_item_id',
          'sentence_hash','nonce_sha256','normalizer_version',
          'decision_policy_version','verifier_profile','verifier_profile_sha256',
          'reference_genome_version'
        ]::text[])='{}'::jsonb
        and jsonb_typeof(issued_contract->'schema')='string'
        and jsonb_typeof(issued_contract->'challenge_id')='string'
        and jsonb_typeof(issued_contract->'replica_id')='string'
        and jsonb_typeof(issued_contract->'owner_user_id')='string'
        and jsonb_typeof(issued_contract->'issued_locale')='string'
        and jsonb_typeof(issued_contract->'sentence_bank_version')='string'
        and jsonb_typeof(issued_contract->'sentence_bank_sha256')='string'
        and jsonb_typeof(issued_contract->'sentence_item_id')='string'
        and jsonb_typeof(issued_contract->'sentence_hash')='string'
        and jsonb_typeof(issued_contract->'nonce_sha256')='string'
        and jsonb_typeof(issued_contract->'normalizer_version')='string'
        and jsonb_typeof(issued_contract->'decision_policy_version')='string'
        and jsonb_typeof(issued_contract->'verifier_profile')='string'
        and jsonb_typeof(issued_contract->'verifier_profile_sha256')='string'
        and jsonb_typeof(issued_contract->'reference_genome_version')='number'
        and issued_contract->>'schema'='vyakti.identity-issued.v1'
        and issued_contract->>'challenge_id'=challenge_id::text
        and issued_contract->>'replica_id'=replica_id::text
        and issued_contract->>'owner_user_id'=owner_user_id::text
        and issued_contract->>'issued_locale'=issued_locale
        and issued_contract->>'sentence_bank_version'=sentence_bank_version
        and issued_contract->>'verifier_profile'=verifier_profile
        and issued_contract->>'decision_policy_version'=challenge_policy
        and issued_contract->'reference_genome_version'=to_jsonb(reference_genome_version)
        and issued_contract->>'sentence_hash'=sentence_hash
        and issued_contract->>'normalizer_version'='challenge-speech-nfkc-digitfold/v1'
        and issued_contract->>'sentence_item_id' in ('item-1','item-2','item-3','item-4','item-5','item-6')
        and length(issued_contract->>'sentence_hash')=64
        and issued_contract->>'sentence_hash' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'nonce_sha256')=64
        and issued_contract->>'nonce_sha256' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'sentence_bank_sha256')=64
        and issued_contract->>'sentence_bank_sha256' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'verifier_profile_sha256')=64
        and issued_contract->>'verifier_profile_sha256' ~ '^[0-9a-f]{64}$'
      ) else false end
    )
  ) is true);

-- Migration 139: private TeacherSheet drafts before runtime activation.
-- Explicit owner saves can precede runtime activation. These rows are private
-- drafts, never an invented runtime agent or a publishable persona. Historical
-- agent-owned rows retain their ownership path; do not infer a replica backfill.
alter table vy_teacher_sheet
  add column if not exists replica_id uuid,
  add column if not exists owner_user_id uuid;

alter table vy_teacher_sheet alter column agent_id drop not null;

alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_private_owner_shape;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_private_owner_shape check (
  (replica_id is null) = (owner_user_id is null)
  and (agent_id is not null or
       (replica_id is not null and owner_user_id is not null and status in ('draft','revoked')))
);

alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_private_owner_fk;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_private_owner_fk
  foreign key (replica_id,owner_user_id)
  references vy_replica(replica_id,owner_user_id) on delete cascade;

-- New saves attach explicit ownership. No historical rows are rewritten or
-- discarded to satisfy this index. ON CONFLICT also arbitrates first saves
-- whose snapshots both precede the first insert.
create unique index if not exists vy_teacher_sheet_private_draft_ix
  on vy_teacher_sheet(replica_id)
  where replica_id is not null and status='draft';

create index if not exists vy_teacher_sheet_private_owner_recent_ix
  on vy_teacher_sheet(owner_user_id,replica_id,created_at desc)
  where replica_id is not null;

-- 140: persistent selection epoch, including absence. This grants no identity.
alter table vy_replica
  add column if not exists primary_selection_id uuid not null default gen_random_uuid();

-- No inferred snapshot for historical intents; an owner must issue a new one.
alter table vy_replica_voice_build_intent
  add column if not exists expected_primary_selection_id uuid;

-- 141: one owner-authorized private text question. No verified model scope.
alter table vy_replica add column if not exists private_text_epoch bigint not null default 0 check (private_text_epoch >= 0);

alter table vy_replica_consent drop constraint if exists vy_replica_consent_scope_check;

alter table vy_replica_consent add constraint vy_replica_consent_scope_check check (scope in ('capture','transcription','biometric','training','inference','storage','sharing','api','telephony','model_improvement','private_text_rehearsal'));

create unique index if not exists vy_private_text_consent_request_ix on vy_replica_consent ((metadata->>'request_id')) where scope='private_text_rehearsal';

create table if not exists vy_private_text_rehearsal (
  request_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  consent_id uuid not null,
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  question_hash text not null check (question_hash ~ '^[0-9a-f]{64}$'),
  sheet_id uuid not null,
  context_item_id uuid not null references vy_context_item(item_id) on delete cascade,
  source_id uuid not null,
  authority_epoch bigint not null check (authority_epoch >= 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  state text not null default 'admitted' check (state in ('admitted','dispatched','complete','blocked','uncertain','withdrawn')),
  dispatch_token_hash text,
  dispatched_at timestamptz,
  reservation_id uuid,
  budget_id text,
  spend_request_hash text,
  provider jsonb,
  billing_state text not null default 'not_started' check (billing_state in ('not_started','reserved','in_flight','settled','reconcile_required')),
  question_envelope jsonb,
  raw_envelope jsonb,
  answer_envelope jsonb,
  raw_hash text,
  answer_hash text,
  gate_sidecar jsonb not null default '{}'::jsonb,
  failure_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_private_text_owner_fk foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_consent_fk foreign key(consent_id,replica_id,owner_user_id) references vy_replica_consent(consent_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_source_fk foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_private_text_receipt_once unique(consent_id),
  constraint vy_private_text_complete_payload check (state<>'complete' or (answer_envelope is not null and answer_hash ~ '^[0-9a-f]{64}$')),
  constraint vy_private_text_withdrawn_payload check (state<>'withdrawn' or (question_envelope is null and raw_envelope is null and answer_envelope is null))
);

create index if not exists vy_private_text_owner_ix on vy_private_text_rehearsal(owner_user_id,replica_id,created_at desc);

-- 142: an owned terminal request ID can exist without ever minting consent.
alter table vy_private_text_rehearsal
  alter column consent_id drop not null,
  alter column receipt_hash drop not null,
  alter column request_hash drop not null,
  alter column question_hash drop not null,
  alter column sheet_id drop not null,
  alter column context_item_id drop not null,
  alter column source_id drop not null,
  alter column authority_epoch drop not null,
  alter column snapshot_hash drop not null,
  alter column snapshot drop not null;

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_rehearsal_billing_state_check;

alter table vy_private_text_rehearsal add constraint vy_private_text_rehearsal_billing_state_check
 check (billing_state in ('not_started','reserved','in_flight','settled','reconcile_required','unknown'));

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_authority_or_cancel;

alter table vy_private_text_rehearsal add constraint vy_private_text_authority_or_cancel check (
 (consent_id is not null and receipt_hash is not null and request_hash is not null and question_hash is not null
  and sheet_id is not null and context_item_id is not null and source_id is not null
  and authority_epoch is not null and snapshot_hash is not null and snapshot is not null)
 or (state='withdrawn' and billing_state='unknown' and consent_id is null and receipt_hash is null
  and request_hash is null and question_hash is null and sheet_id is null and context_item_id is null
  and source_id is null and authority_epoch is null and snapshot_hash is null and snapshot is null
  and reservation_id is null and budget_id is null and spend_request_hash is null and provider is null
  and dispatch_token_hash is null and dispatched_at is null and raw_hash is null and answer_hash is null)
);

alter table vy_private_text_rehearsal drop constraint if exists vy_private_text_live_request_payload;

alter table vy_private_text_rehearsal add constraint vy_private_text_live_request_payload
 check (state='withdrawn' or (question_envelope is not null and billing_state<>'unknown'));

-- Existing request PK arbitrates cancellation versus late admission. Existing
-- owner index and replica FK also cover tombstones with no source/consent FK.

-- Account-material text only. No agent, voice or verified identity grant.
-- Content-free claim-once URL ledger survives replica/source deletion. It cannot
-- resolve an owner, source, visitor, receipt or answer.
create table if not exists vy_text_publication_id_ledger (
 id uuid primary key,
 kind text not null check(kind in ('publication','request')),
 claimed_at timestamptz not null default now()
);

create table if not exists vy_text_publication (
 publication_id uuid primary key,
 replica_id uuid not null,
 owner_user_id uuid not null,
 source_id uuid,
 context_item_id uuid references vy_context_item(item_id) on delete cascade,
 sheet_id uuid,
 version integer not null default 1 check(version=1),
 epoch bigint not null default 0 check(epoch>=0),
 state text not null default 'active' check(state in ('active','revoked')),
 review_hash text check(review_hash ~ '^[0-9a-f]{64}$'),
 request_hash text check(request_hash ~ '^[0-9a-f]{64}$'),
 snapshot jsonb not null default '{}'::jsonb,
 projection jsonb,
 receipt jsonb,
 receipt_hash text check(receipt_hash ~ '^[0-9a-f]{64}$'),
 disclosure text not null default '',
 disclosure_hash text not null default '',
 terms jsonb not null default '{}'::jsonb,
 question_count integer not null default 0 check(question_count>=0),
 committed_microusd bigint not null default 0 check(committed_microusd>=0),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now(),
 revoked_at timestamptz,
 constraint vy_text_publication_owner_fk foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
 constraint vy_text_publication_source_fk foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_text_publication_scope unique(publication_id,replica_id,owner_user_id),
 constraint vy_text_publication_active_payload check(state<>'active' or (projection is not null and receipt is not null and source_id is not null and context_item_id is not null and sheet_id is not null and review_hash is not null and request_hash is not null and receipt_hash is not null)),
 constraint vy_text_publication_revoked_payload check(state<>'revoked' or (projection is null and receipt is null))
);

create unique index if not exists vy_text_publication_one_active on vy_text_publication(replica_id,owner_user_id) where state='active';

create table if not exists vy_text_publication_visitor (
 publication_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 visitor_user_id uuid not null,
 session_epoch bigint not null default 0 check(session_epoch>=0),
 question_count integer not null default 0 check(question_count>=0),
 admission jsonb,
 admission_hash text,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(publication_id,visitor_user_id),
 constraint vy_text_visitor_publication_fk foreign key(publication_id,replica_id,owner_user_id) references vy_text_publication(publication_id,replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_text_publication_request (
 request_id uuid primary key,
 publication_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 visitor_user_id uuid not null,
 publication_epoch bigint not null,
 session_epoch bigint not null,
 request_hash text not null,
 question_hash text not null,
 state text not null default 'admitted' check(state in ('admitted','dispatched','complete','blocked','uncertain','withdrawn')),
 dispatch_token_hash text,
 dispatch_authority_epoch bigint,
 reservation_id uuid,
 budget_id text,
 spend_request_hash text,
 provider jsonb,
 billing_state text not null default 'not_started' check(billing_state in ('not_started','reserved','in_flight','settled','reconcile_required')),
 question_envelope jsonb,
 answer_envelope jsonb,
 raw_envelope jsonb,
 answer_hash text,
 raw_hash text,
 gate_sidecar jsonb not null default '{}'::jsonb,
 failure_code text not null default '',
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now(),
 constraint vy_text_request_publication_fk foreign key(publication_id,replica_id,owner_user_id) references vy_text_publication(publication_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_text_request_visitor_fk foreign key(publication_id,visitor_user_id) references vy_text_publication_visitor(publication_id,visitor_user_id) on delete cascade,
 constraint vy_text_request_complete_payload check(state<>'complete' or (answer_envelope is not null and answer_hash is not null)),
 constraint vy_text_request_withdrawn_payload check(state<>'withdrawn' or (question_envelope is null and answer_envelope is null and raw_envelope is null))
);

create index if not exists vy_text_publication_owner_ix on vy_text_publication(owner_user_id,replica_id);

create index if not exists vy_text_visitor_user_ix on vy_text_publication_visitor(visitor_user_id);

create index if not exists vy_text_request_user_ix on vy_text_publication_request(visitor_user_id,publication_id);

-- Migration 144 - private comparison authority, independent of text.
alter table vy_replica
  add column if not exists reference_authority_epoch bigint not null default 0;


-- Migration145: private comparison selection authority.
-- Comparison USE only. This table grants no processing, training or inference.
create table if not exists vy_replica_comparison_reference (
  reference_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_id uuid,
  artifact_id uuid,
  state text not null check (state in ('review','selected','revoked')),
  receipt_payload jsonb,
  receipt_hash text,
  observed_epoch bigint,
  selected_epoch bigint,
  audition_response_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  active_replica_id uuid generated always as
    (case when state='selected' then replica_id else null end) stored,
  unique (active_replica_id),
  constraint vy_comparison_reference_owner_fk foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_source_fk foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_artifact_fk foreign key (artifact_id,source_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_payload_check check (
    state='revoked' or (source_id is not null and artifact_id is not null
      and jsonb_typeof(receipt_payload)='object' and receipt_payload is not null
      and receipt_hash is not null and length(receipt_hash)=64 and receipt_hash ~ '^[0-9a-f]{64}$'
      and observed_epoch is not null and observed_epoch>=0
      and expires_at is not null and expires_at>created_at
      and expires_at<=created_at+interval '24 hours')),
  constraint vy_comparison_reference_selected_check check (
    state<>'selected' or (selected_epoch is not null and selected_epoch>observed_epoch
      and audition_response_at is not null and confirmed_at is not null)),
  constraint vy_comparison_reference_revoked_check check (
    state<>'revoked' or (revoked_at is not null and receipt_payload is null and receipt_hash is null))
);

-- Purpose-limited preparation; never enrollment, training or serving authority.
create table if not exists vy_comparison_preparation_id (
  preparation_id uuid primary key,
  retired_at timestamptz not null default now()
);

create table if not exists vy_replica_comparison_preparation (
  preparation_id uuid primary key references vy_comparison_preparation_id(preparation_id),
  replica_id uuid not null references vy_replica(replica_id) on delete cascade,
  owner_user_id uuid not null,
  source_id uuid references vy_replica_source(source_id) on delete cascade,
  policy_version text not null,
  statement_set text not null check (statement_set='private-comparison-preparation/v1'),
  receipt jsonb,
  receipt_sha256 text,
  state text not null check (state in ('authorized','queued','running','prepared','revoked','expired','failed','reconciliation_required')),
  max_duration_ms integer not null default 60000 check (max_duration_ms=60000),
  max_evidence_dispatches integer not null default 4 check (max_evidence_dispatches=4),
  completed_receipt jsonb,
  completed_receipt_sha256 text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state='revoked' and source_id is null and receipt is null and receipt_sha256 is null)
    or (source_id is not null and receipt is not null and receipt_sha256 is not null and jsonb_typeof(receipt)='object' and receipt_sha256 ~ '^[0-9a-f]{64}$')),
  check (state<>'prepared' or (completed_receipt is not null and completed_receipt_sha256 is not null and jsonb_typeof(completed_receipt)='object' and completed_receipt_sha256 ~ '^[0-9a-f]{64}$')),
  unique (source_id),
  foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  unique (preparation_id,source_id,replica_id,owner_user_id)
);

alter table vy_replica_processing_job add column if not exists comparison_preparation_id uuid
  references vy_replica_comparison_preparation(preparation_id) on delete cascade;

alter table vy_replica_processing_job drop constraint if exists vy_comparison_job_preparation_owner_fk;

alter table vy_replica_processing_job add constraint vy_comparison_job_preparation_owner_fk
  foreign key(comparison_preparation_id,source_id,replica_id,owner_user_id)
  references vy_replica_comparison_preparation(preparation_id,source_id,replica_id,owner_user_id) on delete cascade;

create table if not exists vy_replica_comparison_dispatch (
  preparation_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_id uuid not null,
  job_id uuid not null references vy_replica_processing_job(job_id) on delete cascade,
  step text not null check (step in ('diarize','separate','enhance','voice_quality')),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  meter_receipt_sha256 text not null check (meter_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('started','settled','reconciliation_required')),
  result_sha256 text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key(preparation_id,step),
  foreign key(preparation_id,source_id,replica_id,owner_user_id)
    references vy_replica_comparison_preparation(preparation_id,source_id,replica_id,owner_user_id) on delete cascade,
  foreign key(job_id,source_id,replica_id,owner_user_id)
    references vy_replica_processing_job(job_id,source_id,replica_id,owner_user_id) on delete cascade,
  check (state<>'settled' or (result_sha256 is not null and result_sha256 ~ '^[0-9a-f]{64}$' and settled_at is not null))
);

alter table vy_replica_source drop constraint if exists vy_replica_source_purpose_check;

alter table vy_replica_source add constraint vy_replica_source_purpose_check
  check (purpose in ('memory','identity_document','identity_challenge','correction','interview','mirror_window','context_item','comparison_reference'));

-- Content-free infrastructure accounting. No owner, source, audio or prompt.
-- A held row is an exclusive resource lease even after its proposed deadline.
create table if not exists vy_gpu_allocation_window (
  window_id uuid primary key default gen_random_uuid(),
  budget_id text not null references vy_provider_budget(budget_id) on delete restrict,
  resource_sha256 text not null check (resource_sha256 ~ '^[0-9a-f]{64}$'),
  revision_sha256 text not null check (revision_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  provider_request_sha256 text not null check (provider_request_sha256 ~ '^[0-9a-f]{64}$'),
  contract_sha256 text not null check (contract_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  max_allocation_seconds integer not null check (max_allocation_seconds between 1 and 3600),
  state text not null check (state in ('reserved','in_flight','accounting_pending','uncertain','settled','released')),
  response_sha256 text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  usage_sha256 text check (usage_sha256 is null or usage_sha256 ~ '^[0-9a-f]{64}$'),
  actual_microusd bigint check (actual_microusd >= 0 and actual_microusd <= reserved_microusd),
  created_at timestamptz not null default now(),
  begun_at timestamptz,
  finished_at timestamptz,
  unique (budget_id,request_sha256),
  check (state <> 'settled' or (usage_sha256 is not null and actual_microusd is not null and finished_at is not null)),
  check (state <> 'accounting_pending' or response_sha256 is not null)
);

-- All revisions and all budgets share the same resource exclusion.
create unique index if not exists vy_gpu_allocation_window_exclusive
  on vy_gpu_allocation_window(resource_sha256)
  where state not in ('settled','released');

alter table vy_replica_comparison_dispatch add column if not exists response_recorded_at timestamptz;

-- A provider response is not a settled Azure invoice. Preserve historical rows.
alter table vy_replica_comparison_dispatch drop constraint if exists vy_replica_comparison_dispatch_state_check;

alter table vy_replica_comparison_dispatch add constraint vy_replica_comparison_dispatch_state_check
  check (state in ('started','settled','response_recorded','reconciliation_required'));

alter table vy_replica_comparison_dispatch drop constraint if exists vy_comparison_response_receipt_check;

alter table vy_replica_comparison_dispatch add constraint vy_comparison_response_receipt_check
  check (state<>'response_recorded' or (result_sha256 is not null and result_sha256 ~ '^[0-9a-f]{64}$' and response_recorded_at is not null));
-- 148: prior private rehearsal evidence IDs and content commitments only.
-- No transcript copy. The owning turn already follows owner/person/log erasure.
alter table vy_replica_dialogue_turn add column if not exists continuity_refs jsonb
  check (continuity_refs is null or (jsonb_typeof(continuity_refs)='array' and jsonb_array_length(continuity_refs)<=3));

-- Source deletion removes a derived reply's only raw-log copy. That log's
-- existing FK cascades its dialogue turn and feedback. Recall sources cannot
-- themselves carry continuity refs, and derived turns cannot produce voice.
create or replace function vy_erase_private_continuity_reply() returns trigger language plpgsql as $$
begin
  -- Serialize source erasure with dialogue admission/completion on the same parent.
  perform 1 from vy_replica r where r.replica_id=old.replica_id and r.owner_user_id=old.owner_user_id for update;
  delete from meera_log l using vy_replica_dialogue_turn derived
   where derived.replica_id=old.replica_id and derived.owner_user_id=old.owner_user_id
     and derived.agent_id=old.agent_id and derived.person_id=old.person_id
     and derived.continuity_refs @> jsonb_build_array(jsonb_build_object('turn_id',old.turn_id))
     and l.id=derived.assistant_log_id and l.agent_id=derived.agent_id and l.device_id=derived.device_id;
  return old;
end;
$$;

create or replace trigger vy_private_continuity_source_erasure before delete on vy_replica_dialogue_turn
for each row execute function vy_erase_private_continuity_reply();

create index if not exists vy_private_continuity_source_ix on vy_replica_dialogue_turn
  using gin(continuity_refs jsonb_path_ops) where continuity_refs is not null;

-- Operator-controlled manual GPU experiment lifecycle, no personal payloads.
alter table vy_gpu_allocation_window add column if not exists azure_job_id text;

alter table vy_gpu_allocation_window add column if not exists azure_execution_name text;

alter table vy_gpu_allocation_window add column if not exists job_configuration_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_runtime_seconds integer;

alter table vy_gpu_allocation_window add column if not exists job_control_state text;

alter table vy_gpu_allocation_window add column if not exists job_observation_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_terminal_at timestamptz;

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_job_control_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_job_control_check check (
  job_control_state is null or (
    job_control_state in ('start_claimed','start_unknown','running','stop_requested','stop_pending','observation_unknown','terminal_observed')
    and azure_job_id is not null and azure_job_id like '/subscriptions/%/providers/Microsoft.App/jobs/%'
    and job_configuration_sha256 is not null and job_configuration_sha256 ~ '^[0-9a-f]{64}$'
    and job_runtime_seconds is not null and job_runtime_seconds between 1 and 3600
  )
);

-- Estimates must not hide a larger verified invoice. Record actual cost,
-- pause further admission and allow the ledger to report the overrun.
alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_allocation_window_actual_microusd_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_allocation_window_actual_microusd_check
  check (actual_microusd is null or actual_microusd >= 0);

alter table vy_provider_budget drop constraint if exists vy_provider_budget_total_check;

alter table vy_provider_budget add constraint vy_provider_budget_total_check
  check (spent_microusd + reserved_microusd <= limit_microusd or state in ('paused','exhausted'));

-- Historical147 only admitted the older verified-bound interface. New
-- supervised experiments explicitly persist that their amount is estimated.
alter table vy_gpu_allocation_window add column if not exists accounting_basis text not null default 'verified_bound'
  check (accounting_basis in ('verified_bound','planning_estimate'));

-- Preserve the original149 pin. New starts capture a durable idle inventory
-- before ARM POST. Legacy windows without it cannot infer an execution name.
alter table vy_gpu_allocation_window add column if not exists job_prestart_inventory jsonb;

alter table vy_gpu_allocation_window add column if not exists job_start_requested_at timestamptz;

alter table vy_gpu_allocation_window add column if not exists job_recovery_sha256 text;

alter table vy_gpu_allocation_window add column if not exists job_execution_template_sha256 text;

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_start_inventory_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_start_inventory_check check (
  job_prestart_inventory is null or (
    jsonb_typeof(job_prestart_inventory)='array' and job_start_requested_at is not null
    and job_execution_template_sha256 is not null and job_execution_template_sha256 ~ '^[0-9a-f]{64}$'
  )
);

alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_start_recovery_check;

alter table vy_gpu_allocation_window add constraint vy_gpu_start_recovery_check check (
  job_recovery_sha256 is null or (job_recovery_sha256 ~ '^[0-9a-f]{64}$'
    and azure_execution_name is not null and job_prestart_inventory is not null
    and job_start_requested_at is not null)
);

-- Repair the actual PostgreSQL name observed in the 2026-09-08 dev catalog.
-- Migration147 references two columns, so PostgreSQL named this constraint
-- vy_gpu_allocation_window_check, not the column-specific name dropped in149.
-- Keep149's nonnegative check and check1's settled-receipt requirements.
-- Verified debt must be recorded in full; reconciliation pauses new admission.
alter table vy_gpu_allocation_window drop constraint if exists vy_gpu_allocation_window_check;

-- 154: erase derived replies after the dialogue row has left the FK cascade.
-- Migration148's BEFORE trigger could re-delete a row already being removed
-- by the person-device cascade, raising PostgreSQL27000. Preserve148 history.
create or replace function vy_erase_private_continuity_reply() returns trigger language plpgsql as $$
begin
  perform 1 from vy_replica r where r.replica_id=old.replica_id and r.owner_user_id=old.owner_user_id for update;
  -- A parent cascade can remove every dialogue row before AFTER triggers run.
  -- OLD preserves the only assistant-log binding even when no derived row remains.
  delete from meera_log l
   where coalesce(old.continuity_refs,'[]'::jsonb)<>'[]'::jsonb
     and l.id=old.assistant_log_id and l.agent_id=old.agent_id and l.device_id=old.device_id;
  delete from meera_log l using vy_replica_dialogue_turn derived
   where derived.replica_id=old.replica_id and derived.owner_user_id=old.owner_user_id
     and derived.agent_id=old.agent_id and derived.person_id=old.person_id
     and derived.continuity_refs @> jsonb_build_array(jsonb_build_object('turn_id',old.turn_id))
     and l.id=derived.assistant_log_id and l.agent_id=derived.agent_id and l.device_id=derived.device_id;
  return old;
end;
$$;

create or replace trigger vy_private_continuity_source_erasure after delete on vy_replica_dialogue_turn
for each row execute function vy_erase_private_continuity_reply();
-- Owner-requested private correction candidate work. No active persona writes.
create table if not exists vy_replica_correction_candidate_job (
  job_id uuid primary key,
  dataset_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_set_hash text not null check (source_set_hash ~ '^[0-9a-f]{64}$'),
  protocol text not null,
  model_commitment text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
  request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('preparing','running','response_recorded','accounting_pending','draft','abstained','failed','unknown','retired')),
  proposal jsonb,
  artifact jsonb,
  artifact_sha256 text check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  build_manifest jsonb,
  build_manifest_hash text check (build_manifest_hash ~ '^[0-9a-f]{64}$'),
  usage jsonb,
  reservation_id uuid,
  candidate_id uuid,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_replica_correction_candidate_job_once unique (dataset_id,model_commitment,protocol),
  constraint vy_replica_correction_candidate_job_dataset_fk foreign key (dataset_id,replica_id,owner_user_id)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_correction_candidate_job_candidate_fk foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_correction_candidate_job_draft_shape check
    (state <> 'draft' or (candidate_id is not null and artifact is not null and artifact_sha256 is not null and build_manifest_hash is not null)),
  constraint vy_replica_correction_candidate_job_running_shape check
    (state <> 'running' or (request_hash is not null and reservation_id is not null))
);

create index if not exists vy_replica_correction_candidate_job_owner_ix
  on vy_replica_correction_candidate_job(replica_id,owner_user_id,created_at desc);
-- Migration 153: optional publication visitor continuity.
-- Optional continuity for newly reviewed v2 publications. Existing v1 stays off.
alter table vy_text_publication drop constraint if exists vy_text_publication_version_check;

alter table vy_text_publication add constraint vy_text_publication_version_check check(version in (1,2));

alter table vy_text_publication_visitor add column if not exists memory_enabled boolean not null default false;

alter table vy_text_publication_visitor add column if not exists memory_epoch bigint not null default 0 check(memory_epoch>=0);

alter table vy_text_publication_visitor add column if not exists memory_policy_hash text check(memory_policy_hash is null or memory_policy_hash ~ '^[0-9a-f]{64}$');

alter table vy_text_publication_visitor add column if not exists memory_choice_at timestamptz;

alter table vy_text_publication_request add column if not exists memory_epoch bigint check(memory_epoch is null or memory_epoch>=0);

alter table vy_text_publication_request add column if not exists memory_refs jsonb not null default '[]'::jsonb check(jsonb_typeof(memory_refs)='array' and jsonb_array_length(memory_refs)<=3);

alter table vy_text_publication_request add column if not exists memory_refs_hash text check(memory_refs_hash is null or memory_refs_hash ~ '^[0-9a-f]{64}$');

create index if not exists vy_text_request_memory_scope_ix on vy_text_publication_request(publication_id,visitor_user_id,memory_epoch,created_at,request_id) where state='complete' and memory_epoch is not null;

-- One owner-requested private text comparison per exact candidate. No activation.
create table if not exists vy_replica_candidate_materialization (
 job_id uuid primary key,
 correction_job_id uuid not null references vy_replica_correction_candidate_job(job_id) on delete cascade,
 candidate_id uuid not null,
 dataset_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 protocol text not null,
 model_commitment text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
 source_set_hash text not null check (source_set_hash ~ '^[0-9a-f]{64}$'),
 baseline_hash text not null check (baseline_hash ~ '^[0-9a-f]{64}$'),
 artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
 manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
 blind_seed text not null check (blind_seed ~ '^[0-9a-f]{64}$'),
 total integer not null check (total between 60 and 200 and total % 2 = 0),
 state text not null check (state in ('preparing','working','packing','ready','held','failed')),
 package jsonb,
 eval_run_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (candidate_id),
 unique (job_id,replica_id,owner_user_id),
 foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
  references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
 foreign key (dataset_id,replica_id,owner_user_id)
  references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade,
 check (state <> 'ready' or (package is not null and eval_run_id is not null))
);

create table if not exists vy_replica_candidate_materialization_item (
 item_id uuid primary key,
 job_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 feedback_id uuid not null,
 sequence integer not null check (sequence between 1 and 200),
 role text not null check (role in ('baseline','candidate')),
 session_commitment text not null check (session_commitment ~ '^[0-9a-f]{64}$'),
 prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
 context_asset jsonb not null,
 output_asset jsonb,
 reservation_id uuid,
 usage jsonb,
 provider_identity jsonb,
 state text not null check (state in ('pending','claimed','running','response_recorded','complete','held','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (job_id,replica_id,owner_user_id)
  references vy_replica_candidate_materialization(job_id,replica_id,owner_user_id) on delete cascade,
 foreign key (feedback_id,replica_id,owner_user_id)
  references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade,
 unique (job_id,feedback_id,role),
 unique (job_id,sequence),
 check (state not in ('running','response_recorded','complete') or reservation_id is not null),
 check (state <> 'complete' or (output_asset is not null and usage is not null and provider_identity is not null))
);

create index if not exists vy_replica_candidate_materialization_owner_ix
 on vy_replica_candidate_materialization(replica_id,owner_user_id,created_at desc);

create index if not exists vy_replica_candidate_materialization_item_job_ix
 on vy_replica_candidate_materialization_item(job_id,state,sequence);

-- Explicit owner activation history. A missing erased binding never falls back.
alter table vy_replica_runtime_capability add column if not exists candidate_binding_required boolean not null default false;

-- Apply the migration transactionally: retain every prior state and add an
-- explicit owner-private state that public state='active' readers never select.
alter table vy_replica_runtime_capability drop constraint if exists vy_replica_runtime_capability_state_check;

alter table vy_replica_runtime_capability add constraint vy_replica_runtime_capability_state_check
 check(state in ('active','paused','revoked','superseded','private'));

alter table vy_replica_candidate_materialization add column if not exists candidate_core_hash text check (candidate_core_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists vy_replica_runtime_activation_identity_ix
 on vy_replica_runtime_capability(capability_id,replica_id,owner_user_id);

create table if not exists vy_replica_owner_private_selection (
 replica_id uuid not null,
 owner_user_id uuid not null,
 capability_id uuid not null unique,
 base_capability_id uuid not null,
 updated_at timestamptz not null default now(),
 primary key(replica_id,owner_user_id),
 check(capability_id<>base_capability_id),
 foreign key(capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 foreign key(base_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade
);

-- No private artifacts here: this pointer survives their erasure so an owner
-- can request rollback, which must independently revalidate the prior target.
create table if not exists vy_replica_candidate_runtime_transition (
 new_capability_id uuid primary key,
 prior_capability_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 action text not null check(action in ('activate','experiment','rollback','reset')),
 created_at timestamptz not null default now(),
 check(new_capability_id<>prior_capability_id),
 foreign key(new_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 foreign key(prior_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade
);

create unique index if not exists vy_replica_qualification_activation_identity_ix
 on vy_replica_candidate_qualification(qualification_id,candidate_id,replica_id,owner_user_id);

create table if not exists vy_replica_candidate_activation (
 activation_id uuid primary key,
 new_capability_id uuid not null,
 prior_capability_id uuid not null,
 target_capability_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 action text not null check (action in ('activate','experiment','rollback','reset')),
 selection_kind text not null check (selection_kind in ('qualified','experimental','baseline')),
 exposure text not null default 'owner_private_text' check (exposure='owner_private_text'),
 candidate_id uuid,
 dataset_id uuid,
 qualification_id uuid,
 qualification_binding jsonb,
 artifact_snapshot jsonb,
 profile_definition jsonb not null check (jsonb_typeof(profile_definition)='object'),
 calibration_definition jsonb not null check (jsonb_typeof(calibration_definition)='object'),
 core_hash text not null check (core_hash ~ '^[0-9a-f]{64}$'),
 model_commitment text check (model_commitment ~ '^[0-9a-f]{64}$'),
 base_model_commitment text check (base_model_commitment ~ '^[0-9a-f]{64}$'),
 provider_revision_binding jsonb,
 provider_identity jsonb,
 created_at timestamptz not null default now(),
 constraint vy_replica_candidate_activation_new_unique unique(new_capability_id,replica_id,owner_user_id),
 constraint vy_replica_candidate_activation_owner_fk foreign key(replica_id,owner_user_id)
  references vy_replica(replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_new_fk foreign key(new_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_prior_fk foreign key(prior_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_target_fk foreign key(target_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_candidate_fk foreign key(candidate_id,dataset_id,replica_id,owner_user_id)
  references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_qualification_fk foreign key(qualification_id,candidate_id,replica_id,owner_user_id)
  references vy_replica_candidate_qualification(qualification_id,candidate_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_shape check (
  (selection_kind in ('qualified','experimental') and candidate_id is not null and dataset_id is not null and qualification_id is not null
   and ((selection_kind='qualified' and action in ('activate','rollback'))
    or (selection_kind='experimental' and action in ('experiment','rollback')))
   and qualification_binding is not null and jsonb_typeof(qualification_binding)='object'
   and artifact_snapshot is not null and jsonb_typeof(artifact_snapshot)='object'
   and model_commitment is not null and base_model_commitment is not null
   and provider_revision_binding is not null and jsonb_typeof(provider_revision_binding)='object'
   and provider_identity is not null and jsonb_typeof(provider_identity)='object')
  or (selection_kind='baseline' and action in ('rollback','reset') and candidate_id is null and dataset_id is null and qualification_id is null
   and qualification_binding is null and artifact_snapshot is null and model_commitment is null
   and base_model_commitment is null and provider_revision_binding is null and provider_identity is null)
 ),
 constraint vy_replica_candidate_activation_new_distinct check(new_capability_id<>prior_capability_id and new_capability_id<>target_capability_id)
);

create index if not exists vy_replica_candidate_activation_owner_ix
 on vy_replica_candidate_activation(replica_id,owner_user_id,created_at desc);

create or replace function public.vy_replica_candidate_activation_no_update() returns trigger
 language plpgsql set search_path=pg_catalog,public as $$ begin raise exception 'candidate_activation_immutable' using errcode='55000'; end $$;

create or replace trigger vy_replica_candidate_activation_immutable
 before update on vy_replica_candidate_activation for each row execute function public.vy_replica_candidate_activation_no_update();

create or replace trigger vy_replica_candidate_transition_immutable
 before update on vy_replica_candidate_runtime_transition for each row execute function public.vy_replica_candidate_activation_no_update();

-- A losing pointer CAS must abort the whole statement, including its newly
-- created private capability. No application retry is implied by this result.
create or replace function public.vy_replica_candidate_selection_result(
 p_created bigint,p_selected bigint,p_transitioned bigint,p_recorded bigint,p_capability uuid)
 returns uuid language plpgsql set search_path=pg_catalog,public as $$
 begin
  if p_created=0 and p_selected=0 and p_transitioned=0 and p_recorded=0 and p_capability is null then return null; end if;
  if p_created is distinct from 1 or p_selected is distinct from 1
   or p_transitioned is distinct from 1 or p_recorded is distinct from 1 or p_capability is null then
   raise exception 'candidate_private_selection_write_conflict' using errcode='40001';
  end if;
  return p_capability;
 end $$;

-- BEGIN migration 159: Room memory source authority
-- Source-only. 157 and 158 are reserved independently. Apply each statement
-- separately through Neon. No historical logs are assigned guessed consent.
alter table vy_room_follower add column if not exists memory_epoch bigint not null default 0 check(memory_epoch>=0);

alter table meera_log add column if not exists room_memory_follower_id uuid references vy_room_follower(follower_id) on delete cascade;

alter table meera_log add column if not exists room_memory_epoch bigint check((room_memory_epoch is null)=(room_memory_follower_id is null) and (room_memory_epoch is null or room_memory_epoch>=0));

alter table vy_episode add column if not exists room_memory_follower_id uuid references vy_room_follower(follower_id) on delete cascade;

alter table vy_episode add column if not exists room_memory_epoch bigint check((room_memory_epoch is null)=(room_memory_follower_id is null) and (room_memory_epoch is null or room_memory_epoch>=0));

create index if not exists meera_log_room_memory_pending_ix on meera_log(room_memory_follower_id,room_memory_epoch,id) where role='me' and episode_id is null;

create index if not exists vy_episode_room_memory_ix on vy_episode(room_memory_follower_id,room_memory_epoch,id);

-- Epoch survives disable/re-enable on one membership. A delete/rejoin gets a
-- fresh follower UUID, so neither absence nor timestamp precision permits ABA.
create or replace function vy_room_memory_epoch_change() returns trigger language plpgsql as $fn$
begin
  new.memory_epoch := old.memory_epoch + 1;
  return new;
end
$fn$;

create or replace trigger vy_room_memory_epoch_change before update of memory_consent_at on vy_room_follower
for each row execute function vy_room_memory_epoch_change();

-- Cited tables deliberately have no episode FK. This explicit erasure backstop
-- removes this writer's two derived classes before the episode FK can cascade.
-- Room forget revokes first and counts its ordinary manifest deletes; this
-- backstop handles account deletion and direct/cascaded follower removal too.
create or replace function vy_room_memory_follower_erasure() returns trigger language plpgsql as $fn$
begin
  delete from vy_fact v using vy_episode e
    where e.room_memory_follower_id=old.follower_id and e.id=any(v.citations)
      and e.agent_id=old.agent_id and e.person_id=old.person_id
      and v.agent_id=old.agent_id and v.person_id=old.person_id;
  delete from vy_observation v using vy_episode e
    where e.room_memory_follower_id=old.follower_id and e.id=any(v.citations)
      and e.agent_id=old.agent_id and e.person_id=old.person_id
      and v.agent_id=old.agent_id and v.person_id=old.person_id;
  return old;
end
$fn$;

create or replace trigger vy_room_memory_follower_erasure before delete on vy_room_follower
for each row execute function vy_room_memory_follower_erasure();

-- END migration 159

-- 158 SOURCE ONLY: private authority cascades; infrastructure cost survives erasure.
create table if not exists vy_voice_app_lifecycle (
 window_id uuid primary key references vy_gpu_allocation_window(window_id) on delete restrict,
 app_id text not null, revision_name text not null,
 configuration_sha256 text not null check(configuration_sha256 ~ '^[0-9a-f]{64}$'),
 template_sha256 text not null check(template_sha256 ~ '^[0-9a-f]{64}$'),
 contract_sha256 text not null check(contract_sha256 ~ '^[0-9a-f]{64}$'),
 broker_origin text not null, runtime_origin text not null,
 state text not null check(state in ('open','closing','close_claimed','terminal_observed','observation_unknown')),
 activation_state text not null default 'not_started' check(activation_state in ('not_started','claimed','acknowledged','unknown')),
 activation_dispatched_at timestamptz,
 deactivation_state text not null default 'not_started' check(deactivation_state in ('not_started','claimed','acknowledged','unknown')),
 deactivation_dispatched_at timestamptz,
 dispatch_deadline_at timestamptz not null,
 observation jsonb,
 created_at timestamptz not null default now()
);

create table if not exists vy_voice_allocation_authority (
 window_id uuid primary key references vy_voice_app_lifecycle(window_id) on delete restrict,
 replica_id uuid not null, owner_user_id uuid not null, source_id uuid not null,
 generation_id uuid not null, reference_sha256 text not null check(reference_sha256 ~ '^[0-9a-f]{64}$'),
 intent_id uuid not null, intent_attempt integer not null check(intent_attempt>0),
 lease_token_hash text not null check(lease_token_hash ~ '^[0-9a-f]{64}$'),
 text_sha256 text not null check(text_sha256 ~ '^[0-9a-f]{64}$'),
 language_id text not null check(language_id in ('hi','en')),
 foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
 foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_voice_allocation_child (
 child_id uuid primary key, window_id uuid not null references vy_voice_allocation_authority(window_id) on delete cascade,
 ordinal integer not null check(ordinal between 0 and 31),
 operation text not null check(operation in ('status','synthesize')),
 body_sha256 text not null check(body_sha256 ~ '^[0-9a-f]{64}$'),
 consumed_at timestamptz,
 unique(window_id,ordinal)
);

create table if not exists vy_voice_app_supervisor_lease (
 app_id text primary key, contract_sha256 text not null,
 revision_sha256 text not null, source_sha256 text not null,
 heartbeat_at timestamptz not null, lease_expires_at timestamptz not null
);

-- Monetary liability remains held after verified App shutdown; only resource exclusion is released.
alter table vy_gpu_allocation_window add column if not exists resource_released_at timestamptz;

alter table vy_gpu_allocation_window add column if not exists resource_release_sha256 text check(resource_release_sha256 ~ '^[0-9a-f]{64}$');

-- Apply158 transactionally: install replacement exclusion before removing the original stricter index.
create unique index if not exists vy_gpu_allocation_window_resource_exclusive
 on vy_gpu_allocation_window(resource_sha256)
 where state not in ('settled','released') and resource_released_at is null;

drop index if exists vy_gpu_allocation_window_exclusive;

-- One logical remembered quote, with closed presentation metadata. Existing
-- fact/episode erasure and export ownership apply to the same row.
alter table vy_fact add column if not exists communication jsonb
constraint vy_fact_communication_check check (
 communication is null or (
  kind='user' and name='preference' and provenance='user_said'
  and jsonb_typeof(communication)='object'
  and communication ?& array['version','state','scope','language','script','brevity']
  and communication - array['version','state','scope','language','script','brevity']='{}'::jsonb
  and communication->'version'='1'::jsonb
  and communication->'state' in ('"classified"'::jsonb,'"unclassified"'::jsonb,'"no_preference"'::jsonb)
  and jsonb_typeof(communication->'scope')='object'
  and (communication->'scope') ?& array['language','script','brevity']
  and (communication->'scope') - array['language','script','brevity']='{}'::jsonb
  and jsonb_typeof(communication->'scope'->'language')='boolean'
  and jsonb_typeof(communication->'scope'->'script')='boolean'
  and jsonb_typeof(communication->'scope'->'brevity')='boolean'
  and (communication->'scope'->'language'='true'::jsonb
    or communication->'scope'->'script'='true'::jsonb
    or communication->'scope'->'brevity'='true'::jsonb)
  and communication->'language' in ('null'::jsonb,'"english"'::jsonb,'"hindi"'::jsonb,'"hinglish"'::jsonb)
  and communication->'script' in ('null'::jsonb,'"roman"'::jsonb,'"devanagari"'::jsonb)
  and communication->'brevity' in ('null'::jsonb,'"short"'::jsonb,'"detailed"'::jsonb)
  and (communication->'language'='null'::jsonb or communication->'scope'->'language'='true'::jsonb)
  and (communication->'script'='null'::jsonb or communication->'scope'->'script'='true'::jsonb)
  and (communication->'brevity'='null'::jsonb or communication->'scope'->'brevity'='true'::jsonb)
  and ((communication->>'state'='classified' and
    (communication->'language'<>'null'::jsonb or communication->'script'<>'null'::jsonb or communication->'brevity'<>'null'::jsonb))
   or (communication->>'state' in ('unclassified','no_preference')
    and communication->'language'='null'::jsonb and communication->'script'='null'::jsonb and communication->'brevity'='null'::jsonb))
 )
);


-- 161 SOURCE ONLY. Source authority cascades; infrastructure observations and monetary holds survive erasure.
create table if not exists vy_processing_gpu_lifecycle (
 window_id uuid primary key references vy_gpu_allocation_window(window_id) on delete restrict,
 resource_id text not null, revision_sha256 text not null check(revision_sha256 ~ '^[0-9a-f]{64}$'),
 origin text not null, contract_sha256 text not null check(contract_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('open','closed','natural_zero_observed')),
 admission_deadline_at timestamptz not null, closed_at timestamptz, observation jsonb,
 created_at timestamptz not null default now()
);

create table if not exists vy_processing_gpu_authority (
 window_id uuid primary key references vy_processing_gpu_lifecycle(window_id) on delete restrict,
 source_id uuid not null, replica_id uuid not null, owner_user_id uuid not null,
 revision integer not null check(revision>0), source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
 foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade
);

create table if not exists vy_processing_gpu_child (
 window_id uuid not null references vy_processing_gpu_lifecycle(window_id) on delete restrict,
 job_sha256 text not null check(job_sha256 ~ '^[0-9a-f]{64}$'),
 operation text not null check(operation in ('diarize','separate','enhance','voice_quality')),
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in ('claimed','response_received')),
 response_sha256 text check(response_sha256 ~ '^[0-9a-f]{64}$'),
 claimed_at timestamptz not null default now(), response_at timestamptz,
 primary key(window_id,job_sha256), unique(window_id,operation)
);

-- 163: HumanOS, the person sheet. A row is a TEACHER's compiled sheet or a
-- PERSON's; same row shape either way, see migration 163's own header.
alter table vy_teacher_sheet add column if not exists sheet_kind text not null default 'teacher';

alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_sheet_kind_check;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_sheet_kind_check check (sheet_kind in ('teacher','person'));
-- BEGIN historical replica mirror: 166_voice_listening_verdict.sql
-- Migration 166 - WS-R155, "Sounds like you" and the listening test. See the
-- migration file itself for the full rationale; this table already existed
-- (025_replica_calibration.sql) and only gains the two columns a voice
-- listening verdict needs beyond a personality preference row.
alter table vy_replica_calibration add column if not exists pair_sha256 text
  constraint vy_replica_calibration_pair_hash check (pair_sha256 is null or pair_sha256 ~ '^[0-9a-f]{64}$');

alter table vy_replica_calibration add column if not exists winner_artifact_id uuid;

create index if not exists vy_replica_calibration_pair_ix
  on vy_replica_calibration (replica_id, owner_user_id, pair_sha256, created_at desc)
  where pair_sha256 is not null;
-- END historical replica mirror: 166_voice_listening_verdict.sql
-- 164 (WS-R153). EmotionOS's own vibe: warmth/energy/humour/directness/
-- formality, versioned and reversible. No FK on replica_id/owner_user_id
-- (009's own convention).
create table if not exists vy_replica_vibe (
 vibe_id uuid primary key default gen_random_uuid(),
 replica_id uuid not null,
 owner_user_id uuid not null,
 version int not null check (version > 0),
 warmth smallint not null check (warmth between 0 and 4),
 energy smallint not null check (energy between 0 and 4),
 humour smallint not null check (humour between 0 and 4),
 directness smallint not null check (directness between 0 and 4),
 formality smallint not null check (formality between 0 and 4),
 note text not null default '' check (char_length(note) <= 280),
 created_at timestamptz not null default now(),
 superseded_at timestamptz
);

create unique index if not exists vy_replica_vibe_live_ix
 on vy_replica_vibe(replica_id)
 where superseded_at is null;

create index if not exists vy_replica_vibe_owner_history_ix
 on vy_replica_vibe(replica_id, owner_user_id, version desc);

-- 167 (WS-R161). Meet opens for any person: a lighter, text-only runtime
-- capability, a peer of vy_replica_runtime_capability above rather than a
-- relaxation of it. No FK on replica_id/owner_user_id (009's own
-- convention, vy_replica_vibe's own shape immediately above restated).
create table if not exists vy_replica_text_capability (
 capability_id uuid primary key default gen_random_uuid(),
 replica_id uuid not null,
 owner_user_id uuid not null,
 profile_version integer not null check (profile_version > 0),
 policy_version text not null,
 state text not null default 'active' check (state in ('active','revoked')),
 activated_at timestamptz not null default now(),
 revoked_at timestamptz
);

create unique index if not exists vy_replica_text_capability_one_active_ix
 on vy_replica_text_capability(replica_id)
 where state = 'active';

create index if not exists vy_replica_text_capability_owner_ix
 on vy_replica_text_capability(owner_user_id, replica_id, activated_at desc);
-- BEGIN historical replica mirror: 170_owner_meet_memory_consent.sql
-- Migration 170 - WS-R167, the owner's own continuity in Meet. See the
-- migration file itself for the full rationale: one CHECK widening on an
-- already-existing table/column, no new table, no new agent/replica/owner/
-- person column.
alter table vy_replica_consent drop constraint if exists vy_replica_consent_scope_check;

alter table vy_replica_consent add constraint vy_replica_consent_scope_check check (scope in (
  'capture','transcription','biometric','training',
  'inference','storage','sharing','api','telephony',
  'model_improvement','private_text_rehearsal','memory'
));
-- END historical replica mirror: 170_owner_meet_memory_consent.sql
-- WS-R170 mirror corrections, appended (never edited in place, ws-common.md).
-- scripts/check-schema-mirror.mjs found both by walking every migration file
-- in numeric order and confirming its own declared objects exist somewhere
-- in this file; both were real, confirmed by hand against the cited
-- migration file before being added here.
--
-- 046 (context/rejected.md#046-replica-voice-preference). The preference
-- table's left/right FKs reference the owner tuple on vy_replica_generation;
-- no earlier migration created a unique constraint on that exact tuple, so
-- 046's own file adds this index immediately before creating the table that
-- needs it. The CREATE TABLE made it into this mirror; this preceding INDEX
-- did not.
create unique index if not exists vy_replica_generation_owner_tuple_ix
  on vy_replica_generation (generation_id,replica_id,owner_user_id);

-- 056 (fact_validity). Event-time columns on the belief-time fact/graph
-- stores, closing `stale-note-keys-on-row-age` (context/decisions.md) — see
-- db/migrations/056_fact_validity.sql for the full product reasoning. Never
-- backfilled (both columns are nullable with no default); absence means
-- "not derivable", not "false".
alter table vy_fact add column if not exists valid_from timestamptz;
alter table vy_fact add column if not exists valid_to timestamptz;
alter table vy_fact drop constraint if exists vy_fact_validity_order;
alter table vy_fact add constraint vy_fact_validity_order
  check (valid_from is null or valid_to is null or valid_to >= valid_from);
create index if not exists vy_fact_validity_ix
  on vy_fact (person_id, valid_to)
  where valid_to is not null and t_invalid is null and retracted_at is null;

alter table meera_nodes add column if not exists valid_from timestamptz;
alter table meera_nodes add column if not exists valid_to timestamptz;
alter table meera_nodes drop constraint if exists meera_nodes_validity_order;
alter table meera_nodes add constraint meera_nodes_validity_order
  check (valid_from is null or valid_to is null or valid_to >= valid_from);
create index if not exists meera_nodes_validity_ix
  on meera_nodes (device_id, valid_to)
  where valid_to is not null;
