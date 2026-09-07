// Private authoring handoff only. This cannot activate a runtime or publish a
// sheet: the caller must have just received an active, qualified capability.
export const PRIVATE_TEACHER_SHEET_ADOPTION_SQL = `with owned as materialized (
  select r.replica_id,r.owner_user_id,r.agent_id,r.subject_person_id
    from vy_replica r
   where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
     and r.lifecycle='active' and r.policy_version=$4 and r.agent_id is not null
   for update of r
), capability as materialized (
  select c.capability_id,o.replica_id,o.owner_user_id,o.agent_id
    from vy_replica_runtime_capability c join owned o
      on c.replica_id=o.replica_id and c.owner_user_id=o.owner_user_id
     and c.agent_id=o.agent_id and c.subject_person_id=o.subject_person_id
   where c.capability_id=$3::uuid and c.state='active' and c.policy_version=$5
   for update of c
), drafts as materialized (
  select s.sheet_id,s.agent_id from vy_teacher_sheet s join capability c
    on s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
   where s.status='draft'
   for update of s
), conflict as materialized (
  select ((select count(*) from drafts)>1 or exists (
    select 1 from drafts d cross join capability c
     where d.agent_id is not null and d.agent_id<>c.agent_id
  )) as refused
), adopted as (
  update vy_teacher_sheet s set agent_id=c.agent_id
    from drafts d cross join capability c cross join conflict x
   where not x.refused and s.sheet_id=d.sheet_id
     and s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
     and s.status='draft' and s.agent_id is null
  returning s.sheet_id
)
select case when x.refused then 'conflict'
            when exists(select 1 from adopted) then 'adopted'
            when exists(select 1 from drafts) then 'already_bound'
            else 'no_private_draft' end as adoption_status
  from capability c cross join conflict x`;

export async function adoptActivatedPrivateTeacherSheet(db, {
  replicaId, ownerUserId, capabilityId, replicaPolicy, runtimePolicy,
}) {
  const rows = await db(PRIVATE_TEACHER_SHEET_ADOPTION_SQL,
    [replicaId,ownerUserId,capabilityId,replicaPolicy,runtimePolicy]);
  const status = rows[0]?.adoption_status;
  if (!['adopted','already_bound','no_private_draft'].includes(status)) {
    const code = status === 'conflict' ? 'runtime_private_draft_conflict' : 'runtime_private_draft_authority_changed';
    throw Object.assign(new Error(code), {code,status:409});
  }
  return status;
}
