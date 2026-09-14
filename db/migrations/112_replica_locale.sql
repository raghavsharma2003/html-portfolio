-- Migration 112 - the studio in Hindi (WS-R52).
--
-- The Room's chrome has spoken the FOLLOWER's own language since migration
-- 087. The creator's own studio never gained the same thing (WS-R47 logged
-- it: "no locale mechanism at all"), even though a coach whose Room speaks
-- Hindi may themselves read Hindi first. This migration gives the studio
-- exactly one column to remember that choice in.
--
--   vy_replica.locale   the CREATOR's own chrome language: Feed/Meet/Share,
--                        Readiness, the review queue's "Sounds right" /
--                        "Close it, fix it" / "Never say this", the Payouts
--                        and Suite cards. NEVER the AI's own replies or the
--                        Room a follower sees - `src/room/copy.ts` and
--                        `vy_room_follower.locale`/`vy_room.default_locale`
--                        are that, unchanged, untouched by this migration.
--
-- `vy_replica` (migration 015) is the settings-shaped table already keyed by
-- `owner_user_id` that every owner-scoped read in `api/_replica.js` already
-- goes through (`RETURNING`, `clientReplica`) - the brief's own instruction
-- to grep for `owner_user_id` on a settings-shaped table before adding a new
-- one lands here, not on a new table. `vy_replica.metadata` (the jsonb
-- column `self_test_mode` already lives in) was considered and rejected as
-- the home for this: a CHECK-bounded two-value column is exactly the shape
-- `vy_room_follower.locale` and `vy_room.default_locale` already use for the
-- identical decision one surface over, and a jsonb key cannot carry a CHECK
-- constraint at all - a typo or a stray third value would read silently as
-- "no locale" downstream instead of failing at the database, the same
-- argument migration 087's own header makes for its two columns.
--
-- `not null default 'en'` rather than nullable: every existing replica row
-- gets an explicit, correct value (English, the studio's shipped-until-now
-- and only language) rather than a null a reader would have to remember to
-- treat as "en" everywhere it is read - the same reasoning migration 107's
-- own header gives for `vy_creator_application.intent`.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP accepts one),
-- no DO blocks, no functions, no foreign key on owner_user_id (009's
-- WHERE-clause-binding convention - unchanged here, vy_replica already
-- carries its own shape). Widening to a third locale means widening this
-- CHECK, `src/studio/copy.ts`'s `STUDIO_LOCALES`, and
-- `scripts/check-layout.mjs`'s `studio-hi`-shaped targets in the same
-- change - `evals/studio-locale/run.mjs` fails the build if any of those
-- drift apart, `evals/room-locale/run.mjs`'s own proof shape reused rather
-- than re-invented.
alter table vy_replica
  add column if not exists locale text not null default 'en';
alter table vy_replica
  drop constraint if exists vy_replica_locale_check;
alter table vy_replica
  add constraint vy_replica_locale_check check (locale in ('en', 'hi'));
