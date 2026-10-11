-- Migration 114 - operator push subscriptions (WS-R62).
--
-- WS-R58 (migration 109) built the incident ledger and a once-a-day "a new
-- door started failing" push, but resolved WHO to push to through an
-- injected, default-empty seam because no store existed anywhere in this
-- repo that maps a platform operator's own Supabase auth id
-- (`OPS_OWNER_USER_IDS`) to a browser subscription
-- (`context/decisions.md#ws-r58-operator-push-subscription-store-does-not-exist`,
-- whose own reversal condition names this workstream). This migration is
-- that store, and nothing else - the send path stays `api/_push/webpush.js`
-- unchanged, `api/_ops.js` and `api/_incidents.js` wire it in.
--
-- Same shape `vy_room_push_subscription` (migration 085) keeps for a
-- follower's own browser subscription - endpoint/p256dh/auth, created_at,
-- revoked_at - narrowed to what an OPERATOR's row actually needs: there is
-- no room, no person, no follower here, only the operator's own
-- `owner_user_id` (the same Supabase auth id `OPS_OWNER_USER_IDS` lists by
-- name, api/_ops.js's own `opsOwnerIds`).
--
-- NOT A PERSON TABLE and NOT in PERSON_TABLES (api/memory.js): an operator
-- is an OWNER acting in a platform-staff capacity, migration 086's own
-- `issued_by_user_id` precedent restated for a subscription instead of an
-- invite code - `scripts/relcheck.mjs`'s OWNER_KEYS scan picks up
-- `owner_user_id` automatically (no line to add there) and its owner-lane
-- reach walk requires this table be either reached by ON DELETE CASCADE
-- from vy_replica (it is not - an operator's own subscription has no
-- replica) or deleted BY NAME in `api/_replica-full-erasure.js` (it is,
-- scoped by `owner_user_id` alone, `vy_org_member`'s own "owner_user_id
-- ALONE" precedent one migration family over).
--
-- No FK on owner_user_id (009's convention, restated by every migration
-- since - a Supabase auth id, not a row this database owns). Unique on
-- (owner_user_id, endpoint) rather than `vy_room_push_subscription`'s bare
-- `endpoint` alone (workstream law #1): a shared ops device is not
-- impossible for a small operator team, and scoping the browser's own
-- one-subscription-per-(origin,device) uniqueness BY OPERATOR is what lets
-- two operators who happen to open the SAME endpoint (a shared kiosk, a
-- test device) each hold their own row rather than one silently overwriting
-- the other's.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO blocks,
-- explicit ::uuid casts on every comparison in the code that reads this
-- table (api/_ops.js).
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
-- The sweep's own read shape: every ACTIVE subscription for one operator.
-- Partial on `revoked_at is null`, `vy_room_push_subscription_active_ix`'s
-- own precedent (migration 085) restated for the owner lane.
create index if not exists vy_operator_push_subscription_active_ix
  on vy_operator_push_subscription (owner_user_id)
  where revoked_at is null;
