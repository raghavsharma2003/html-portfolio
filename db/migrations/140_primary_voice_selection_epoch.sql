-- The epoch persists through an absent primary and changes on every actual
-- selection, same-source reselection or primary withdrawal. No identity grant.
alter table vy_replica
  add column if not exists primary_selection_id uuid not null default gen_random_uuid();

-- Historical intents deliberately have no snapshot. Reissue rather than infer
-- which primary the owner meant when the old candidate was requested.
alter table vy_replica_voice_build_intent
  add column if not exists expected_primary_selection_id uuid;
