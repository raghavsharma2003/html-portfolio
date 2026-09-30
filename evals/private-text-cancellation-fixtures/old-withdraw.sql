with owned as (
 update vy_replica r set private_text_epoch=r.private_text_epoch
 where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid returning r.replica_id
), target as materialized (
 select h.request_id,h.consent_id from vy_private_text_rehearsal h,owned o
 where h.replica_id=o.replica_id and h.owner_user_id=$2::uuid and h.request_id=$3::uuid
), revoked as (
 update vy_replica_consent c set revoked_at=coalesce(c.revoked_at,now()) from target t
 where c.consent_id=t.consent_id and c.replica_id=$1::uuid and c.owner_user_id=$2::uuid
 returning c.consent_id
), erased as (
 update vy_private_text_rehearsal h set state='withdrawn',question_envelope=null,raw_envelope=null,answer_envelope=null,
 gate_sidecar='{}'::jsonb,failure_code='rehearsal_withdrawn',updated_at=now() from target t
 where h.request_id=t.request_id returning h.request_id
) select request_id from erased