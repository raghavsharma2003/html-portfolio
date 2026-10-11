-- Migration 113 (main loop, at the WS-R59 merge). WS-R59 made the Room an
-- installable app whose manifest starts at `/r/<slug>?via=install` and added
-- `install` to api/_room-surface.js's ROOM_ARRIVAL_VIA, but migration 102's
-- CHECK on `vy_room_arrival.via` still named four values, so every arrival
-- from a home-screen icon would have been refused by the database and
-- swallowed by the upsert's best-effort catch: a count that silently stayed
-- at zero. The allowlist in JS and the CHECK in SQL must name the same set;
-- this widens the CHECK to the five values the JS now allows.
--
-- One statement per request, idempotent (drop-if-exists then add), no DO
-- blocks. The constraint name is the one Postgres gave 102's inline column
-- CHECK, read back from the live catalog before this was written.
alter table vy_room_arrival drop constraint if exists vy_room_arrival_via_check;
alter table vy_room_arrival add constraint vy_room_arrival_via_check
  check (via in ('share', 'direct', 'embed', 'search', 'install'));
