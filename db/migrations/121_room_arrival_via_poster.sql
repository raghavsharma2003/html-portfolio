-- Migration 121 (WS-R78, the poster and the QR). `vy_room_arrival.via`
-- gains 'poster' alongside share, direct, embed, search and install --
-- api/_room-surface.js's ROOM_ARRIVAL_VIA is widened in the SAME commit
-- as this file (this workstream's own brief, law 1: "never one without
-- the other" -- the JS allowlist and the SQL CHECK must agree, or a
-- best-effort insert is silently refused and a real count stays at zero;
-- measurements.md#rooms-migration-113-live-verification-2026-09-05 is the
-- WS-R59 finding that names exactly why).
--
-- One statement per request (Neon SQL-over-HTTP), idempotent (drop-if-
-- exists then add), no DO blocks. The constraint name is the one
-- migration 113 gave it, read back from db/schema.sql (that migration's
-- own comment already names it as read back from the live catalog at its
-- own merge) rather than re-derived here.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install', 'poster'));
