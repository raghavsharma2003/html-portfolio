-- Migration 048 - server-owned multilingual calibration prompt deck binding.
-- Prompt text is public protocol material and is represented in the private
-- trial ledger only by a stable key plus the existing content hash.

alter table vy_replica_voice_trial
  add column if not exists prompt_key text not null default 'legacy.owner_custom.v1';
alter table vy_replica_voice_trial
  add column if not exists prompt_deck_version text not null default 'legacy.owner-custom/v1';

do $replica_voice_prompt_key_constraint$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_trial_prompt_key_check') then
    alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_prompt_key_check
      check (prompt_key~'^[a-z0-9_.:-]{3,96}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_trial_prompt_deck_check') then
    alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_prompt_deck_check
      check (prompt_deck_version in ('legacy.owner-custom/v1','voice-calibration-deck/v1'));
  end if;
end;
$replica_voice_prompt_key_constraint$;

alter table vy_replica_voice_trial drop constraint if exists vy_replica_voice_trial_algorithm_check;
alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_algorithm_check
  check (algorithm in ('voice-curriculum/bt-active-v1','voice-curriculum/bt-active-v2'));

create index if not exists vy_replica_voice_trial_prompt_coverage_ix
  on vy_replica_voice_trial(owner_user_id,replica_id,genome_version,language_id,prompt_key)
  where state='completed';
