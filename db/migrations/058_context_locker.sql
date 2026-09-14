-- Migration 058 — the Context Locker: vy_context_item + vy_context_item_text.
--
-- Contract: context/decisions.md#horizontal-platform-reweight — "ingestion
-- today is YouTube-channel + voice-upload; there is no universal 'bring your
-- context' lane (files, arbitrary links, documents, chat exports) feeding the
-- Person Model. That lane is now on the build list." These two tables are the
-- durable half of that lane: one row per item an owner ever handed us, and one
-- row per item whose text we actually extracted.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 009's law, restated by 051/052/053
-- and binding here for the same reason: Neon's SQL-over-HTTP endpoint accepts
-- exactly one statement per body, db/migrations/apply.mjs runs them
-- individually with no transaction, so every statement below is independently
-- re-runnable and an interrupted apply is recovered by re-running this file.
-- NO DO blocks and no functions: apply.mjs's splitter does not handle them.
--
-- ── no foreign keys, same convention as 051/053/055/057 ───────────────────
-- `replica_id` and `owner_user_id` are FK-SHAPED and carry no FK constraint.
-- The binding is enforced by the WHERE clause. Because there is no cascade to
-- inherit, BOTH tables are deleted BY NAME in api/_replica-full-erasure.js —
-- scripts/relcheck.mjs's owner-lane reach walk fails the build for any
-- owner_user_id table that is reachable by neither, and it would have failed
-- for these the moment they existed. They are deliberately NOT added to
-- PERSON_TABLES: api/memory.js's "WHAT IS DELIBERATELY NOT IN THE LIST ABOVE"
-- gives the argument, and relcheck's manifest check excludes owner-keyed
-- tables for exactly that reason.
--
-- ── the two tables are split on a size boundary, not a concern boundary ───
-- Every list read, every quota aggregate and every status render touches
-- vy_context_item and NONE of them wants a 400 000-character `text` column
-- coming back with the row. The body is read only when an item is mined or a
-- citation is resolved. One table would make the common read the expensive one.
--
-- ── a refusal must be NAMED, and the database is what makes that true ─────
-- `vy_context_item_refusal_named` and `vy_context_item_routing_named` are the
-- brief's central rule written as CHECK constraints: a file we cannot extract
-- is refused WITH A REASON, never silently stored-and-ignored. A future writer
-- that sets status='refused' and forgets the reason is refused by Postgres
-- rather than by a code review — the same argument migration 053 gives for
-- `vy_ingest_run_approval_gate`, and the same one 051 gives for the publish
-- gate: both a JS branch and a constraint exist; only one of them cannot be
-- forgotten by the next writer.

create table if not exists vy_context_item (
  item_id         uuid primary key,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  kind            text not null
                  check (kind in ('file','link')),
  -- The extractor's own verdict about WHAT this is, not the owner's filename.
  -- 'unknown' exists for a refused item whose format was never determined.
  format          text not null default 'unknown',
  source_name     text not null default '',
  source_url      text not null default '',
  -- The dedup key. sha256 of the RAW BYTES for a file, of the canonical URL
  -- for a link. A hex-shaped CHECK because a column that is documented to hold
  -- a hash and is not constrained to look like one eventually holds a filename.
  content_sha256  text not null
                  check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size       bigint not null default 0 check (byte_size >= 0),
  extracted_chars integer not null default 0 check (extracted_chars >= 0),
  extractor       text not null default '',
  -- 'received'  accepted, extraction not yet run
  -- 'extracted' text recovered; not mined (and `mine_skip_reason` says why)
  -- 'mined'     a proposal row exists on vy_ingest_run
  -- 'refused'   we will not pretend to have read this; `refusal_reason` names it
  -- 'routed'    it belongs to another lane; `routed_to` names which
  status          text not null default 'received'
                  check (status in ('received','extracted','mined','refused','routed')),
  refusal_reason  text not null default '',
  routed_to       text not null default '',
  -- Why an EXTRACTED item produced no proposals. Named, never blank-by-default:
  -- 'not_owner_authored_no_style_evidence',
  -- 'speaker_unattributed_no_style_evidence', 'no_candidates_cleared_held_out'.
  mine_skip_reason text not null default '',
  -- The owner's own declaration about whose words these are. 'unknown' is a
  -- real state and it mines NOTHING — a document nobody has claimed is not
  -- evidence of how its uploader writes.
  authorship      text not null default 'unknown'
                  check (authorship in ('mine','not_mine','unknown')),
  -- Chat exports only: the sender name, exactly as the export spells it, whose
  -- messages are the owner's. Empty means unattributed, which mines nothing.
  owner_speaker   text not null default '',
  consent_scope   text not null default 'own_context',
  -- The vy_ingest_run this item's proposal landed on. Nullable: most items
  -- never produce one, and a run that was rejected keeps its row.
  run_id          uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vy_context_item_refusal_named
    check (status <> 'refused' or refusal_reason <> ''),
  constraint vy_context_item_routing_named
    check (status <> 'routed' or routed_to <> '')
);

-- DEDUP, as a constraint rather than a lookup. Per REPLICA, not per owner: the
-- same CV genuinely belongs in two different clones an owner is building, and
-- de-duplicating across them would make the second add silently vanish. Within
-- one replica, the same bytes twice is the same item.
create unique index if not exists vy_context_item_dedup_ix
  on vy_context_item (replica_id, content_sha256);

create index if not exists vy_context_item_owner_ix
  on vy_context_item (owner_user_id, replica_id, created_at desc);

create index if not exists vy_context_item_status_ix
  on vy_context_item (replica_id, status, created_at desc);

-- The quota aggregate's index. Per OWNER across every replica, because the cap
-- exists to bound what one account can push into this platform, and a per-
-- replica cap is trivially defeated by making more replicas.
create index if not exists vy_context_item_quota_ix
  on vy_context_item (owner_user_id) include (byte_size);

-- ── vy_context_item_text: the extracted body a citation resolves against ──
--
-- Spans stored on a proposal are character offsets into THIS column. That is
-- the whole reason it is a durable row rather than a transient: a delta whose
-- citations cannot be resolved is not evidence, and a reviewer looking at a
-- proposal three weeks later must be able to see the sentence it came from.
-- Deleting an item deletes this row in the same statement.
create table if not exists vy_context_item_text (
  item_id       uuid primary key,
  replica_id    uuid not null,
  owner_user_id uuid not null,
  body          text not null,
  chars         integer not null default 0 check (chars >= 0),
  created_at    timestamptz not null default now()
);

create index if not exists vy_context_item_text_owner_ix
  on vy_context_item_text (owner_user_id, replica_id);

-- ── vy_ingest_run learns one new provenance value ─────────────────────────
--
-- The review surface is NOT duplicated. A context item's proposal is a
-- vy_ingest_run row in exactly the shape the channel lane already writes, so
-- `listIngestRunsForReview`, `applyIngestRunDelta` and `rejectIngestRun` — and
-- with them migration 053's `vy_ingest_run_approval_gate`, which makes
-- status='applied' unreachable without a named approver — apply unchanged. A
-- second proposals table would be a second answer to "may this clone say this",
-- and the drifted copy would keep returning 200.
--
-- `video_ref` holds `context:<item_id>` for these rows. The column keeps its
-- name because renaming it would rewrite every statement in
-- api/_channel-ingest.js for a cosmetic gain; the unique index on
-- (replica_id, video_ref) then makes "one proposal per item" true by
-- construction, exactly as it makes "one run per video" true.
--
-- The drop-then-add idiom is 057's (`vy_channel_watch_backfill_state_check`):
-- Postgres auto-names an inline column CHECK `<table>_<column>_check`, so the
-- constraint 053 declared inline is dropped by that name and replaced by an
-- explicitly named one. Idempotent, one statement each, no DO block.
alter table vy_ingest_run drop constraint if exists vy_ingest_run_transcript_source_check;

alter table vy_ingest_run drop constraint if exists vy_ingest_run_transcript_source_ck;

alter table vy_ingest_run add constraint vy_ingest_run_transcript_source_ck
  check (transcript_source in ('asr','captions','upload','context_item'));
