export const PREVIEW_FENCE = `
  g.purpose='voice_preview' and g.channel='studio_preview'
  and r.subject_mode='self' and r.lifecycle in ('enrolling','calibrating','ready','active','paused')
  and r.policy_version='replica-self-v1' and r.age_verified_at is not null
  and r.identity_verified_at is not null and r.liveness_verified_at is not null
  and r.identity_expires_at>now()
  and exists(select 1 from vy_replica_consent c where c.replica_id=g.replica_id
    and c.owner_user_id=g.owner_user_id and c.scope='inference' and c.policy_version=r.policy_version
    and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
  and exists(select 1 from vy_replica_consent c where c.replica_id=g.replica_id
    and c.owner_user_id=g.owner_user_id and c.scope='biometric'
    and c.policy_version=r.policy_version
    and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
  and exists(select 1 from vy_replica_consent c where c.replica_id=g.replica_id
    and c.owner_user_id=g.owner_user_id and c.scope='training'
    and c.policy_version=r.policy_version
    and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
  and exists(select 1 from vy_replica_voice_genome vg where vg.replica_id=g.replica_id
    and vg.version=g.genome_version and vg.status='draft'
    and (vg.definition#>'{references,enrollment_artifact_ids}') ? g.preview_artifact_id::text)
  and exists(select 1 from vy_replica_processing_artifact a
    join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
      and s.owner_user_id=a.owner_user_id
    where a.artifact_id=g.preview_artifact_id and a.replica_id=g.replica_id
      and a.owner_user_id=g.owner_user_id and a.stage='enhance'
      and a.mime in ('audio/wav','audio/x-wav') and s.state='ready' and s.contains_third_parties=false
      and exists(select 1 from vy_replica_processing_artifact_decision d
        where d.artifact_id=a.artifact_id and d.replica_id=a.replica_id and d.owner_user_id=a.owner_user_id
          and d.decision='selected' and not exists(select 1 from vy_replica_processing_artifact_decision newer
            where newer.artifact_id=d.artifact_id and newer.replica_id=d.replica_id
              and newer.owner_user_id=d.owner_user_id
              and (newer.created_at,newer.decision_id)>(d.created_at,d.decision_id))))`;
