with eligible as (
       select s.source_id
         from vy_replica_source s
         join vy_replica_voice_challenge ch
           on ch.replica_id=s.replica_id and ch.owner_user_id=s.owner_user_id
          and s.source_id in (ch.captured_source_id,ch.transcript_source_id)
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.source_id=$4::uuid
          and s.capture_mode='identity_challenge' and s.state='pending_upload'
          and ch.challenge_id=$3::uuid and ch.state='issued' and ch.expires_at>now()
     ), updated_source as (
       update vy_replica_source s
          set state=$5,rejection_code=$6,updated_at=now(),provenance=provenance||$7::jsonb
         from eligible e where s.source_id=e.source_id
       returning s.*
     ), updated_challenge as (
       update vy_replica_voice_challenge ch
          set state=case
                when $5<>'quarantined' then 'failed'
                when exists (
                  select 1 from vy_replica_source ready
                   where ready.source_id=ch.captured_source_id and ready.state='quarantined'
                ) and exists (
                  select 1 from vy_replica_source ready
                   where ready.source_id=ch.transcript_source_id and ready.state='quarantined'
                ) then 'captured'
                else ch.state end,
              decision=case when $5<>'quarantined' then 'reject' else ch.decision end,
              decided_at=case when $5<>'quarantined' then now() else ch.decided_at end,
              failure_code=case when $5<>'quarantined' then $6 else ch.failure_code end,
              updated_at=now()
        from updated_source s
        where ch.challenge_id=$3::uuid and ch.replica_id=$1::uuid and ch.owner_user_id=$2::uuid
        returning ch.*
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select $1::uuid,$2::uuid,'voice_identity.challenge.upload.finalize','voice_challenge',
              challenge_id::text,$8,case when $5='quarantined' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code',$6) from updated_challenge
     )
     select row_to_json(s) as source, row_to_json(ch) as challenge
       from updated_source s cross join updated_challenge ch
