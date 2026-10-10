-- Migration 090 - the forget receipt: the one row that survives a follower's
-- "forget me" in a creator's Room (WS-R27).
--
-- api/_replica-full-erasure.js already has this shape for a REPLICA's own
-- erasure (`vy_replica_deletion_receipt`, migration 015): a compliance record
-- that survives content deletion by naming nobody. `roomForget`
-- (api/_room-surface.js) has had the DELETES since WS-R1 but never the
-- receipt - a follower who asked to be forgotten got counts back on one
-- response and then nothing they could keep. This table is that receipt, for
-- the Room's own narrower "forget me in this room" rather than a whole-account
-- wipe, so it needs its own row shape rather than reusing the replica one
-- (which names a REPLICA and an OWNER, neither of which this event is about).
--
-- ── content-free, restated a fifth time on this migration (012, 016, 071,
--    077) ────────────────────────────────────────────────────────────────
--
-- `person_hash` is a one-way SHA-256 of (room_id, person_id, policy_version) -
-- api/memory.js's `roomForgetReceiptHash`, the ONE function both this
-- migration's writer (`roomForget`) and its eraser (the account-wide whole
-- wipe) call, so the two can never compute it differently. There is
-- deliberately NO `person_id` column: a receipt keyed on person_id would BE
-- the record of who forgot, in the one table whose entire purpose is that no
-- such record survives. `counts` is the same per-table integers `roomForget`
-- already returns - a number, never a row, exactly `vy_room_follower_day`'s
-- own "an id, a date, a count" bar (077's header) applied to a receipt
-- instead of a ledger.
--
-- ── why NOT keyed on the hash, the workstream brief's own question, answered
--    in writing here as it asks ────────────────────────────────────────────
--
-- The account-wide whole wipe (`api/memory.js`'s `purgeRelational`, scope
-- "all") must delete every receipt a person's OWN forgets ever produced,
-- across every Room they have ever left, with no `person_id` column to join
-- on. Keying this table BY the hash (making `person_hash` a lookup key
-- something reads FROM) was rejected: nothing in this product ever looks a
-- receipt up again after the one response that carries it (law 3 - "no later
-- lookup by anyone: there is nothing to look it up by"), so a table indexed
-- for lookup-by-hash would be infrastructure built for a read that never
-- happens. Instead `room_id` and `policy_version` stay in PLAIN TEXT on the
-- row (neither identifies a person on its own - a room is public, a policy
-- version is a small integer every receipt under it shares), and the whole
-- wipe reads the table, recomputes `roomForgetReceiptHash(row.room_id,
-- <the person being wiped>, row.policy_version)` for each row, and deletes
-- the ones that match. See `context/decisions.md#ws-r27-forget-receipt-hash-recomputed-not-looked-up`
-- for the reversal condition.
--
-- Idempotent, one statement per request (Neon's SQL-over-HTTP endpoint
-- accepts exactly one), no DO blocks, no functions, explicit ::type casts on
-- every bound parameter.
create table if not exists vy_room_forget_receipt (
  receipt_id     uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_hash    text not null check (person_hash ~ '^[0-9a-f]{64}$'),
  policy_version integer not null default 1 check (policy_version > 0),
  counts         jsonb not null default '{}'::jsonb,
  issued_at      timestamptz not null default now()
);
-- The only real read this table ever gets in production: the account-wide
-- whole wipe's own scan (unbounded on room, since it has no person column to
-- filter by) does not use this index at all - it is here for the operational
-- read this table WOULD want if anyone ever built one (a creator's own
-- "how many people have forgotten me" count, which nothing today asks for),
-- named rather than assumed so a future reader is not left guessing why an
-- unread index exists.
create index if not exists vy_room_forget_receipt_room_issued_ix
  on vy_room_forget_receipt (room_id, issued_at desc);
