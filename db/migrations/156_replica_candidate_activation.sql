-- Explicit owner activation history. A missing erased binding never falls back.
alter table vy_replica_runtime_capability add column if not exists candidate_binding_required boolean not null default false;

-- Apply the migration transactionally: retain every prior state and add an
-- explicit owner-private state that public state='active' readers never select.
alter table vy_replica_runtime_capability drop constraint if exists vy_replica_runtime_capability_state_check;

alter table vy_replica_runtime_capability add constraint vy_replica_runtime_capability_state_check
 check(state in ('active','paused','revoked','superseded','private'));

alter table vy_replica_candidate_materialization add column if not exists candidate_core_hash text check (candidate_core_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists vy_replica_runtime_activation_identity_ix
 on vy_replica_runtime_capability(capability_id,replica_id,owner_user_id);

create table if not exists vy_replica_owner_private_selection (
 replica_id uuid not null,
 owner_user_id uuid not null,
 capability_id uuid not null unique,
 base_capability_id uuid not null,
 updated_at timestamptz not null default now(),
 primary key(replica_id,owner_user_id),
 check(capability_id<>base_capability_id),
 foreign key(capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 foreign key(base_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade
);

-- No private artifacts here: this pointer survives their erasure so an owner
-- can request rollback, which must independently revalidate the prior target.
create table if not exists vy_replica_candidate_runtime_transition (
 new_capability_id uuid primary key,
 prior_capability_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 action text not null check(action in ('activate','experiment','rollback','reset')),
 created_at timestamptz not null default now(),
 check(new_capability_id<>prior_capability_id),
 foreign key(new_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 foreign key(prior_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade
);

create unique index if not exists vy_replica_qualification_activation_identity_ix
 on vy_replica_candidate_qualification(qualification_id,candidate_id,replica_id,owner_user_id);

create table if not exists vy_replica_candidate_activation (
 activation_id uuid primary key,
 new_capability_id uuid not null,
 prior_capability_id uuid not null,
 target_capability_id uuid not null,
 replica_id uuid not null,
 owner_user_id uuid not null,
 action text not null check (action in ('activate','experiment','rollback','reset')),
 selection_kind text not null check (selection_kind in ('qualified','experimental','baseline')),
 exposure text not null default 'owner_private_text' check (exposure='owner_private_text'),
 candidate_id uuid,
 dataset_id uuid,
 qualification_id uuid,
 qualification_binding jsonb,
 artifact_snapshot jsonb,
 profile_definition jsonb not null check (jsonb_typeof(profile_definition)='object'),
 calibration_definition jsonb not null check (jsonb_typeof(calibration_definition)='object'),
 core_hash text not null check (core_hash ~ '^[0-9a-f]{64}$'),
 model_commitment text check (model_commitment ~ '^[0-9a-f]{64}$'),
 base_model_commitment text check (base_model_commitment ~ '^[0-9a-f]{64}$'),
 provider_revision_binding jsonb,
 provider_identity jsonb,
 created_at timestamptz not null default now(),
 constraint vy_replica_candidate_activation_new_unique unique(new_capability_id,replica_id,owner_user_id),
 constraint vy_replica_candidate_activation_owner_fk foreign key(replica_id,owner_user_id)
  references vy_replica(replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_new_fk foreign key(new_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_prior_fk foreign key(prior_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_target_fk foreign key(target_capability_id,replica_id,owner_user_id)
  references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_candidate_fk foreign key(candidate_id,dataset_id,replica_id,owner_user_id)
  references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_qualification_fk foreign key(qualification_id,candidate_id,replica_id,owner_user_id)
  references vy_replica_candidate_qualification(qualification_id,candidate_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_replica_candidate_activation_shape check (
  (selection_kind in ('qualified','experimental') and candidate_id is not null and dataset_id is not null and qualification_id is not null
   and ((selection_kind='qualified' and action in ('activate','rollback'))
    or (selection_kind='experimental' and action in ('experiment','rollback')))
   and qualification_binding is not null and jsonb_typeof(qualification_binding)='object'
   and artifact_snapshot is not null and jsonb_typeof(artifact_snapshot)='object'
   and model_commitment is not null and base_model_commitment is not null
   and provider_revision_binding is not null and jsonb_typeof(provider_revision_binding)='object'
   and provider_identity is not null and jsonb_typeof(provider_identity)='object')
  or (selection_kind='baseline' and action in ('rollback','reset') and candidate_id is null and dataset_id is null and qualification_id is null
   and qualification_binding is null and artifact_snapshot is null and model_commitment is null
   and base_model_commitment is null and provider_revision_binding is null and provider_identity is null)
 ),
 constraint vy_replica_candidate_activation_new_distinct check(new_capability_id<>prior_capability_id and new_capability_id<>target_capability_id)
);

create index if not exists vy_replica_candidate_activation_owner_ix
 on vy_replica_candidate_activation(replica_id,owner_user_id,created_at desc);

create or replace function public.vy_replica_candidate_activation_no_update() returns trigger
 language plpgsql set search_path=pg_catalog,public as $$ begin raise exception 'candidate_activation_immutable' using errcode='55000'; end $$;

create or replace trigger vy_replica_candidate_activation_immutable
 before update on vy_replica_candidate_activation for each row execute function public.vy_replica_candidate_activation_no_update();

create or replace trigger vy_replica_candidate_transition_immutable
 before update on vy_replica_candidate_runtime_transition for each row execute function public.vy_replica_candidate_activation_no_update();

-- A losing pointer CAS must abort the whole statement, including its newly
-- created private capability. No application retry is implied by this result.
create or replace function public.vy_replica_candidate_selection_result(
 p_created bigint,p_selected bigint,p_transitioned bigint,p_recorded bigint,p_capability uuid)
 returns uuid language plpgsql set search_path=pg_catalog,public as $$
 begin
  if p_created=0 and p_selected=0 and p_transitioned=0 and p_recorded=0 and p_capability is null then return null; end if;
  if p_created is distinct from 1 or p_selected is distinct from 1
   or p_transitioned is distinct from 1 or p_recorded is distinct from 1 or p_capability is null then
   raise exception 'candidate_private_selection_write_conflict' using errcode='40001';
  end if;
  return p_capability;
 end $$;
