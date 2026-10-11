import {personProfileValiditySql} from "./_person-model.js";
export const DIALOGUE_AUTHORITY_SQL = `select r.replica_id,r.owner_user_id,r.agent_id,r.subject_person_id,
      r.lifecycle,r.subject_mode,r.policy_version,r.identity_expires_at,
      r.age_verified_at,r.identity_verified_at,r.liveness_verified_at,
      c.capability_id,c.profile_version,c.calibration_version
    from vy_replica r
    join vy_replica_runtime_capability c on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
      and c.agent_id=r.agent_id and c.subject_person_id=r.subject_person_id and c.state='active'
    join vy_agent a on a.agent_id=c.agent_id and a.status='active'
    join vy_person person on person.person_id=c.subject_person_id and person.age_tier='adult_verified'
    join vy_account_person ap on ap.auth_user_id=r.owner_user_id and ap.person_id=c.subject_person_id
    join vy_replica_voice_profile vp on vp.voice_profile_id=c.voice_profile_id and vp.replica_id=c.replica_id
      and vp.genome_version=c.genome_version and vp.status='ready'
    join vy_replica_voice_genome vg on vg.replica_id=c.replica_id and vg.version=c.genome_version and vg.status='approved'
    join vy_replica_profile pp on pp.replica_id=c.replica_id and pp.version=c.profile_version and pp.status='approved'
      and (${personProfileValiditySql("pp", "r")})
    join vy_replica_calibration cal on cal.replica_id=c.replica_id and cal.owner_user_id=c.owner_user_id
      and cal.version=c.calibration_version and cal.profile_version=c.profile_version and cal.status='approved'
   where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
     and r.lifecycle='active' and r.policy_version=$4
     and r.age_verified_at is not null and r.identity_verified_at is not null
     and r.liveness_verified_at is not null and r.identity_expires_at>now()
     and exists(select 1 from vy_replica_consent x where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
       and x.scope='inference' and x.policy_version=$4 and x.revoked_at is null
       and (x.expires_at is null or x.expires_at>now()))`;
