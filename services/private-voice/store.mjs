import {randomBytes} from 'node:crypto';
import {PRIVATE_VOICE_CANDIDATE_CTES,requirePrivateVoiceRun,privateVoiceError,privateVoiceHash} from '../../api/_private-voice-store.js';

// Each effect locks the same source -> replica -> run order as admission.
// A historical grant never substitutes for current source/consent authority.
export const AUTHORITY=`${PRIVATE_VOICE_CANDIDATE_CTES}, authorized as materialized (
 select h.* from vy_private_voice_run h join candidates c on c.artifact_id=h.artifact_id and c.snapshot=h.snapshot
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.source_id=$3::uuid and h.artifact_id=$4::uuid
 and h.run_id=$5::uuid and h.revoked_at is null and h.expires_at>now()
 and h.state='running' and h.lease_token_hash=$6 and h.lease_expires_at>now() for update of h
)`;
export const SQL=Object.freeze({
 claim:`with candidate as materialized (select h.run_id from vy_private_voice_run h
 where h.replica_id=$1::uuid and h.owner_user_id=$2::uuid and h.run_id=$3::uuid
 and h.revoked_at is null and h.expires_at>now() and h.window_id is null
 and (h.state='queued' or (h.state='claimed' and h.lease_expires_at<=now())) for update skip locked)
 update vy_private_voice_run h set state='claimed',lease_token_hash=$4,lease_expires_at=now()+interval '10 minutes',updated_at=now()
 from candidate c where h.run_id=c.run_id returning h.*`,
 start:`with ${PRIVATE_VOICE_CANDIDATE_CTES} update vy_private_voice_run h set state='running',updated_at=now()
 from candidates c where h.run_id=$5::uuid and h.owner_user_id=$2::uuid and h.replica_id=$1::uuid
 and h.source_id=$3::uuid and h.artifact_id=c.artifact_id and h.snapshot=c.snapshot
 and h.state='claimed' and h.lease_token_hash=$6 and h.lease_expires_at>now() and h.expires_at>now() and h.revoked_at is null returning h.*`,
 check:`with ${AUTHORITY} select * from authorized`,
 renew:`with ${AUTHORITY} update vy_private_voice_run h set lease_expires_at=least(h.expires_at,now()+interval '10 minutes'),updated_at=now()
 from authorized a where h.run_id=a.run_id returning h.*`,
 write:`with ${AUTHORITY} update vy_private_voice_run h set output_write_not_after=now()+interval '90 seconds',
 lease_expires_at=least(h.expires_at,greatest(h.lease_expires_at,now()+interval '120 seconds')),updated_at=now()
 from authorized a where h.run_id=a.run_id returning h.*`,
 settle:`with ${AUTHORITY} update vy_private_voice_run h set state='ready',output_sha256=$7,output_receipt=$8::jsonb,metrics=$9::jsonb,updated_at=now(),lease_expires_at=now()
 from authorized a where h.run_id=a.run_id and h.output_write_not_after>now() and h.output_deleted_at is null
 and h.protection->>'state'='sealed' and h.protection->'receipt'=$8::jsonb returning h.*`,
 fail:`update vy_private_voice_run set state=case when window_id is not null or output_write_not_after is not null then 'unknown' else 'failed' end,
 error_code=$5,lease_expires_at=now(),updated_at=now() where replica_id=$1::uuid and owner_user_id=$2::uuid and run_id=$3::uuid
 and lease_token_hash=$4 and revoked_at is null and state in ('claimed','running') returning *`,
 stale:`update vy_private_voice_run set state='unknown',error_code='private_voice_worker_expired',updated_at=now()
 where replica_id=$1::uuid and owner_user_id=$2::uuid and run_id=$3::uuid and state='running' and lease_expires_at<=now() returning *`,
 rate:`with ${PRIVATE_VOICE_CANDIDATE_CTES} update vy_private_voice_run h set ratings=$6::jsonb,updated_at=now()
 from candidates c where h.run_id=$5::uuid and h.replica_id=$1::uuid and h.owner_user_id=$2::uuid
 and h.artifact_id=c.artifact_id and h.snapshot=c.snapshot and h.state='ready' and h.revoked_at is null and h.expires_at>now()
 and h.output_deleted_at is null returning h.run_id`,
 cleanup:`select h.* from vy_private_voice_run h left join vy_voice_app_lifecycle l using(window_id)
 left join vy_gpu_allocation_window w using(window_id) where h.output_deleted_at is null
 and (h.revoked_at is not null or h.expires_at<=now() or h.state in ('failed','unknown'))
 and coalesce(h.lease_expires_at,'-infinity'::timestamptz)<=now()
 and coalesce(h.output_write_not_after,'-infinity'::timestamptz)<=now()
 and (h.window_id is null or (l.state='terminal_observed' and w.resource_released_at is not null))
 order by h.created_at limit 20`,
 deleted:`update vy_private_voice_run set output_deleted_at=now(),updated_at=now() where run_id=$1::uuid
 and owner_user_id=$2::uuid and output_object_path=$3 and output_deleted_at is null
 and (revoked_at is not null or expires_at<=now() or state in ('failed','unknown'))
 and coalesce(lease_expires_at,'-infinity'::timestamptz)<=now() and coalesce(output_write_not_after,'-infinity'::timestamptz)<=now() returning run_id`,
});
export const args=r=>[r.replica_id,r.owner_user_id,r.source_id,r.artifact_id,r.run_id,r.lease_token_hash];
export function one(rows){if(rows?.length!==1)throw privateVoiceError('private_voice_authority_changed');return rows[0];}
export function createExecutionStore(db,now=Date.now){return {
 async require(owner,input){return requirePrivateVoiceRun(db,owner,input,{now});},
 async claim(owner,input){const token=privateVoiceHash(randomBytes(32).toString('hex'));
  await db(SQL.stale,[input.replica_id,owner,input.run_id]);
  return (await db(SQL.claim,[input.replica_id,owner,input.run_id,token]))[0]||null;},
 async start(r){await requirePrivateVoiceRun(db,r.owner_user_id,r,{now});return one(await db(SQL.start,args(r)));},
 async check(r){await requirePrivateVoiceRun(db,r.owner_user_id,r,{now});return one(await db(SQL.check,args(r)));},
 async renew(r){return one(await db(SQL.renew,args(r)));},
 async write(r){return one(await db(SQL.write,args(r)));},
 async settle(r,hash,receipt,metrics){return one(await db(SQL.settle,[...args(r),hash,JSON.stringify(receipt),JSON.stringify(metrics)]));},
 async fail(r,error){const raw=String(error?.code||'operation_failed');const code=`private_voice_${raw.replace(/^private_voice_/,'').replace(/[^a-z0-9_]/g,'').slice(0,80)}`;
  return db(SQL.fail,[r.replica_id,r.owner_user_id,r.run_id,r.lease_token_hash,code]);},
 async cleanup(deleteObject){const rows=await db(SQL.cleanup,[]);let deleted=0;
  for(const row of rows){try{await deleteObject({storageBucket:row.output_storage_bucket,objectPath:row.output_object_path});
   one(await db(SQL.deleted,[row.run_id,row.owner_user_id,row.output_object_path]));deleted++;}catch{/* Keep exact locator for retry. */}}
  return {examined:rows.length,deleted};},
};}
