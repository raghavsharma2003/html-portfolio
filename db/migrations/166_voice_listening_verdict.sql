-- Migration 166. WS-R155, "Sounds like you" and the listening test.
--
-- vy_replica_calibration (025_replica_calibration.sql) already stores
-- versioned, typed preference evidence for the personality layer. A row's
-- KIND is read from definition->>'schema', never from a dedicated column --
-- ownedCalibrationStatus and calibrationDirectives in
-- api/_replica-calibration.js already ignore any schema they do not
-- recognise -- so a voice listening verdict is a NEW schema value
-- ("vyakti.voice-listening-verdict.v1") in the SAME table rather than a new
-- one. It needs exactly two things a personality preference row never had:
--
--   pair_sha256        which pair of candidate generations was blind-tested,
--                       named by content hash (sha256 of both candidates'
--                       audio plus the reference audio, sorted) so a redo of
--                       the same pair is found by lookup rather than by
--                       guessing a version number, and so activation can ask
--                       "what is the latest verdict for THIS pair" without
--                       caring which version number it landed as.
--   winner_artifact_id  which candidate generation won. Null on a tie --
--                       context/rejected.md's own law that a cosine score
--                       does not settle likeness applies just as hard to a
--                       human tie: a tie is a real, storable outcome, not an
--                       error to paper over with a forced pick.
--
-- No FK on winner_artifact_id, by this wave's own binding rule ("no foreign
-- key on agent/replica/owner/person columns", ws-common / 009's convention):
-- the natural FK would be a composite on (winner_artifact_id,replica_id,
-- owner_user_id), and replica_id/owner_user_id are exactly the columns that
-- rule names. (A side investigation into whether the underlying unique
-- index even exists live turned up a real, separate finding worth keeping:
-- 046_replica_voice_preference.sql's own header records its first live
-- apply failing for lack of exactly this index, fixed in-file by adding
-- vy_replica_generation_owner_tuple_ix before its own FKs -- but
-- db/schema.sql's mirror of 046 carries the TABLE and not that preceding
-- index statement. See context/rejected.md#voice-preference-fk-tuple-has-
-- no-matching-unique-constraint. That finding does not change this
-- migration's own answer: the policy against replica/owner FKs applies
-- regardless of what the target index turns out to be.)
-- Eligibility is instead proved by a WHERE-clause join at write time in
-- api/_replica-calibration.js, the same pattern recordOwnedVoicePreference
-- (api/_replica-voice-preference.js) already uses for the identical
-- left/right-generation relationship, and checked live by a new conditional
-- scripts/relcheck.mjs sweep.
alter table vy_replica_calibration add column if not exists pair_sha256 text
  constraint vy_replica_calibration_pair_hash check (pair_sha256 is null or pair_sha256 ~ '^[0-9a-f]{64}$');

alter table vy_replica_calibration add column if not exists winner_artifact_id uuid;

create index if not exists vy_replica_calibration_pair_ix
  on vy_replica_calibration (replica_id, owner_user_id, pair_sha256, created_at desc)
  where pair_sha256 is not null;
