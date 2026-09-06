-- Migration 066 - one explicit voice reference per replica.
--
-- Long uploads remain useful context, but only one owner-chosen audio or video
-- source may drive voice conditioning. A separate one-row pointer avoids
-- transient uniqueness failures when the owner switches the star.

create unique index if not exists vy_replica_source_owner_locator_ix
  on vy_replica_source (source_id, replica_id, owner_user_id);

create table if not exists vy_replica_voice_reference (
  replica_id      uuid primary key,
  owner_user_id   uuid not null,
  source_id       uuid not null unique,
  selected_at     timestamptz not null default now(),
  constraint vy_replica_voice_reference_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_reference_source_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade
);

with latest_selection as (
  select distinct on (d.artifact_id)
         d.artifact_id, d.decision, d.created_at, d.decision_id
    from vy_replica_processing_artifact_decision d
   order by d.artifact_id, d.created_at desc, d.decision_id desc
), candidates as (
  select distinct on (s.replica_id)
         s.replica_id, s.owner_user_id, s.source_id
    from vy_replica_source s
    join vy_replica_processing_artifact a
      on a.source_id=s.source_id and a.replica_id=s.replica_id and a.owner_user_id=s.owner_user_id
    join latest_selection d on d.artifact_id=a.artifact_id and d.decision='selected'
   where s.kind in ('audio','video') and s.capture_mode in ('upload','import','derived')
     and s.state='ready' and s.contains_third_parties=false and a.stage='enhance'
   order by s.replica_id, d.created_at desc, d.decision_id desc, a.created_at desc
)
insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id)
select replica_id,owner_user_id,source_id from candidates
on conflict (replica_id) do nothing;
