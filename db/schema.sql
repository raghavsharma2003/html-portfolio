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
    check (verification_lease_token_hash='' or verification_lease_token_hash ~ '^[0-9a-f]{64});
alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_hash_check,
  add constraint vy_replica_voice_challenge_hash_check
    check (sentence_hash ~ '^[0-9a-f]{64});
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
  dedupe_hash          text not null check (dedupe_hash ~ '^[0-9a-f]{64}),
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
  constraint vy_replica_readiness_inputs_hash check (inputs_hash ~ '^[0-9a-f]{64}),
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
  question_shape_hash text not null check (question_shape_hash ~ '^[0-9a-f]{64}),
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

create table if not exists vy_payment_event (
  event_id            uuid primary key default gen_random_uuid(),
  provider             text not null,
  provider_event_ref   text not null,
  room_id              uuid not null references vy_room(room_id) on delete cascade,
  subscription_id      uuid not null references vy_room_subscription(subscription_id) on delete cascade,
  kind                 text not null,
  amount_inr           integer not null default 0,
  platform_take_inr    integer not null default 0,
  creator_share_inr    integer not null default 0,
  received_at          timestamptz not null default now(),
  signature_verified   boolean not null,
  payload_hash         text not null,
  constraint vy_payment_event_provider_check check (provider in ('razorpay','fake')),
  constraint vy_payment_event_kind_check check (kind in (
    'subscription.authenticated','subscription.activated','subscription.charged',
    'subscription.completed','subscription.cancelled','subscription.paused',
    'subscription.resumed','subscription.pending','subscription.halted',
    'payment.failed'
  )),
  constraint vy_payment_event_amounts_nonneg
    check (amount_inr >= 0 and platform_take_inr >= 0 and creator_share_inr >= 0),
  constraint vy_payment_event_split_sums check (platform_take_inr + creator_share_inr = amount_inr),
  constraint vy_payment_event_signature_verified check (signature_verified = true),
  constraint vy_payment_event_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists vy_payment_event_provider_ref_ix on vy_payment_event (provider, provider_event_ref);
create index if not exists vy_payment_event_subscription_ix on vy_payment_event (subscription_id, received_at desc);
create index if not exists vy_payment_event_room_ix on vy_payment_event (room_id, received_at desc);

create table if not exists vy_creator_payout (
  payout_id      uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  gross_inr      integer not null default 0,
  take_inr       integer not null default 0,
  net_inr        integer not null default 0,
  tds_inr        integer not null default 0,
  state          text not null default 'pending',
  created_at     timestamptz not null default now(),
  constraint vy_creator_payout_state_check check (state in ('pending','paid')),
  constraint vy_creator_payout_amounts_nonneg
    check (gross_inr >= 0 and take_inr >= 0 and net_inr >= 0 and tds_inr >= 0),
  constraint vy_creator_payout_sums check (gross_inr = take_inr + tds_inr + net_inr),
  constraint vy_creator_payout_period_order check (period_end > period_start)
);
create unique index if not exists vy_creator_payout_period_ix
  on vy_creator_payout (owner_user_id, period_start, period_end);

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
