-- Migration 105 - the creator directory's listing switch (WS-R45).
--
-- A Room today is reachable only by its link. `listed_at` is the creator's
-- own opt-in to being FOUND: a second, independent timestamp alongside
-- `published_at` (071), never a derived flag. `api/creators.js`'s directory
-- read and `api/sitemap.js`'s crawler feed both admit a Room only when BOTH
-- are set, in the SAME predicate, never one checked without the other -
-- `api/_creators.js` and `api/_sitemap.js` restate this rule rather than
-- import it, because both are read-only modules with no owner scope and the
-- predicate is one line, not a shared abstraction worth a third file.
--
-- `one_line_bio` travels with it: the directory's own brief names three
-- fields the listing shows (the name, the one-line bio, the language) and
-- this repo has no bio column anywhere yet (`vy_room.display_name` is the
-- name; nothing else is free text a creator writes for a stranger to read).
-- Added here rather than a second migration because it is creator material on
-- the same row, gated by the same publish/list switch, and a directory entry
-- with a name and no description is not what the brief asked for. Bounded to
-- 140 characters (a name plus a bio both fit one line on a 390px directory
-- card - `scripts/check-layout.mjs`'s own MIN_CPL/MAX_CPL floor at that
-- width) and defaulted to '' so an existing Room opts into a bio explicitly
-- rather than the migration inventing one.
--
-- No PERSON_TABLES change: neither column names a follower, so
-- `api/_replica-full-erasure.js`'s owner-lane deletion of `vy_room` by name
-- (071's own comment) already covers both, and `scripts/relcheck.mjs`'s
-- owner-lane reach walk needs no new entry because it walks the TABLE, not
-- the column list.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, no foreign key on any
-- person/owner column (009's WHERE-clause-binding convention; this migration
-- adds no new table and no new FK-shaped column).
alter table vy_room
  add column if not exists listed_at timestamptz;

alter table vy_room
  add column if not exists one_line_bio text not null default '';
alter table vy_room
  drop constraint if exists vy_room_one_line_bio_len;
alter table vy_room
  add constraint vy_room_one_line_bio_len check (length(one_line_bio) <= 140);

-- The directory's own read pattern: every listed-and-published Room, newest
-- listing first. Partial so an unlisted or unpublished Room (the overwhelming
-- majority, always) costs this index nothing - `vy_room_slug_ix`'s own
-- reasoning, one predicate over.
create index if not exists vy_room_listed_ix
  on vy_room (listed_at desc)
  where listed_at is not null and published_at is not null;
