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
