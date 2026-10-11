-- Bounded operator-reviewed cleanup for historical Mirror windows whose source
-- handle was already lost to ON DELETE SET NULL. It is intentionally narrower
-- than the live erasure path: rows with any derived dependency are refused and
-- require a case-specific review. The statement never returns transcript text.
with candidate as materialized (
  select w.window_id,w.session_id,w.replica_id,w.owner_user_id
   from vy_mirror_window w
   where w.owner_user_id=$1::uuid
     and ($2::uuid is null or w.replica_id=$2::uuid)
     and w.source_id is null
     and (w.transcript<>'' or w.asr_provider<>'' or w.asr_model<>'')
     and not exists (
       select 1 from vy_mirror_turn t
        where t.window_id=w.window_id and t.session_id=w.session_id
          and t.replica_id=w.replica_id and t.owner_user_id=w.owner_user_id
     )
     and not exists (
       select 1 from vy_mirror_conditioning c
        where c.window_id=w.window_id and c.session_id=w.session_id
          and c.replica_id=w.replica_id and c.owner_user_id=w.owner_user_id
     )
     and not exists (
       select 1 from vy_replica_expression_observation o
        where o.window_id=w.window_id and o.session_id=w.session_id
          and o.replica_id=w.replica_id and o.owner_user_id=w.owner_user_id
     )
     and not exists (
       select 1 from vy_mirror_delta d
        where d.session_id=w.session_id and d.replica_id=w.replica_id
          and d.owner_user_id=w.owner_user_id and w.seq=any(d.cited_windows)
     )
   order by w.created_at,w.window_id
   for update skip locked
   limit $3::integer
), removed as (
  delete from vy_mirror_window w using candidate c
   where w.window_id=c.window_id and w.session_id=c.session_id
     and w.replica_id=c.replica_id and w.owner_user_id=c.owner_user_id
  returning w.window_id
)
select count(*)::integer removed from removed;
