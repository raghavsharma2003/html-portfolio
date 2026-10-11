// Optional schema: 172 must be applied explicitly. Never put an absent-table
// reference into the existing erasure SQL before the catalog confirms it.
import {erasureScope,erasureScopePredicate,erasureScopeParams} from './_replica-erasure-scope.js';
export async function privateVoiceSchemaPresent(db){return (await db("select to_regclass('public.vy_private_voice_run') is not null private_voice_present",[]))[0]?.private_voice_present===true;}
export async function revokeDeletingPrivateVoice(db,options={}){
 const scope=erasureScope(options.scope);
 if(!await privateVoiceSchemaPresent(db))return false;
 await db(`with revoked as (
 update vy_private_voice_run h set state='revoked',revoked_at=coalesce(h.revoked_at,now()),updated_at=now()
 from vy_replica_source s,vy_replica r where h.source_id=s.source_id and h.replica_id=s.replica_id and h.owner_user_id=s.owner_user_id
 and r.replica_id=h.replica_id and r.owner_user_id=h.owner_user_id
 and (s.state='deleting' or r.lifecycle in ('purging','revoked') or h.expires_at<=now()) and h.revoked_at is null
 ${erasureScopePredicate(scope,'h',0)} returning h.window_id
 ) update vy_voice_app_lifecycle l set state='closing' from revoked h where l.window_id=h.window_id and l.state='open'`,erasureScopeParams(scope));
 return true;
}
export function privateVoiceSourceFence(alias='s'){
 if(alias!=='s')throw Error('private_voice_erasure_alias_invalid');
 return `and not exists(select 1 from vy_private_voice_run pv left join vy_voice_app_lifecycle vl using(window_id)
 left join vy_gpu_allocation_window vw using(window_id) where pv.source_id=s.source_id and pv.replica_id=s.replica_id and pv.owner_user_id=s.owner_user_id
 and (pv.lease_expires_at>now() or pv.output_write_not_after>now() or
 (pv.window_id is not null and (vl.state<>'terminal_observed' or vw.resource_released_at is null))))`;
}
export const privateVoiceSourcePaths=`union all select pv.output_storage_bucket bucket,pv.output_object_path path
 from vy_private_voice_run pv where pv.source_id=s.source_id and pv.replica_id=s.replica_id and pv.owner_user_id=s.owner_user_id`;

// Retain the cleanup ledger against older deployed erasers. The migration's
// non-cascading parent FKs require this explicit, lease-fenced removal after
// the actual storage sweep; an older writer cannot silently discard it.
export const privateVoiceSourceRemoval=`, private_voice_removed as (
 delete from vy_private_voice_run pv using target t
 where pv.source_id=t.source_id and pv.replica_id=t.replica_id and pv.owner_user_id=t.owner_user_id
 returning pv.run_id
)`;
