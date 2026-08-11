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
