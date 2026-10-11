-- Migration 024 - owner-reviewed claims and deterministic Person Models.

alter table vy_replica_claim
  add column if not exists owner_user_id uuid;

update vy_replica_claim c
   set owner_user_id=r.owner_user_id
  from vy_replica r
 where c.replica_id=r.replica_id and c.owner_user_id is null;

alter table vy_replica_claim
  alter column owner_user_id set not null;

create unique index if not exists vy_replica_claim_owner_pair_ix
  on vy_replica_claim (claim_id, replica_id, owner_user_id);

do $person_model_claim_owner_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_owner_fk') then
    alter table vy_replica_claim add constraint vy_replica_claim_owner_fk
      foreign key (replica_id,owner_user_id)
      references vy_replica(replica_id,owner_user_id) on delete cascade;
  end if;
end;
$person_model_claim_owner_fk$;

create table if not exists vy_replica_claim_decision (
  decision_id      uuid primary key default gen_random_uuid(),
  claim_id         bigint not null,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  decision         text not null check (decision in ('accepted','rejected','superseded')),
  reason_code      text not null,
  policy_version   text not null,
  created_at       timestamptz not null default now(),
  constraint vy_replica_claim_decision_owner_check
    check (owner_user_id is not null),
  constraint vy_replica_claim_decision_claim_fk
    foreign key (claim_id,replica_id,owner_user_id)
    references vy_replica_claim(claim_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_claim_decision_latest_ix
  on vy_replica_claim_decision (replica_id,owner_user_id,claim_id,created_at desc);

create unique index if not exists vy_replica_profile_source_set_ix
  on vy_replica_profile (replica_id,source_set_hash);

alter table vy_replica_preference
  add column if not exists owner_user_id uuid;

update vy_replica_preference p
   set owner_user_id=r.owner_user_id
  from vy_replica r
 where p.replica_id=r.replica_id and p.owner_user_id is null;

alter table vy_replica_preference
  alter column owner_user_id set not null;

do $person_model_preference_owner_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_owner_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_owner_fk
      foreign key (replica_id,owner_user_id)
      references vy_replica(replica_id,owner_user_id) on delete cascade;
  end if;
end;
$person_model_preference_owner_fk$;

create index if not exists vy_replica_preference_owner_layer_ix
  on vy_replica_preference (owner_user_id,replica_id,layer,created_at desc);
