import {replicaId,REPLICA_POLICY_VERSION} from './_replica.js';
import {sha256Hex,canonicalJson} from './_replica-processing/contracts.js';
import {processingCompletionReceipt} from './_replica-processing/queue.js';
import {COMPARISON_PREPARATION_PURPOSE,comparisonAuthoritySql,comparisonError} from './_replica-processing/comparison.js';
export const COMPARISON_PREPARATION_ATTESTATIONS=Object.freeze(['recording_is_only_me','process_for_private_comparison','no_training_or_public_voice_permission']);
export function comparisonPreparationInput(input){
 const preparationId=replicaId(input?.preparation_id),sourceId=replicaId(input?.source_id);
 const a=input?.attestations;if(!a||Object.getPrototypeOf(a)!==Object.prototype||Reflect.ownKeys(a).length!==3||COMPARISON_PREPARATION_ATTESTATIONS.some(k=>Object.getOwnPropertyDescriptor(a,k)?.value!==true))throw comparisonError('comparison_processing_consent_required',400);
 return {preparationId,sourceId,attestations:Object.fromEntries(COMPARISON_PREPARATION_ATTESTATIONS.map(k=>[k,true]))};
}
export const COMPARISON_PREPARATION_SNAPSHOT_SQL=`with snapshot as materialized (
 select * from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid
), source as materialized (
 select s.* from vy_replica_source s where s.source_id=$3::uuid and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
 and s.purpose='comparison_reference' and s.state in ('pending_upload','quarantined') and s.contains_third_parties=false
 and s.kind in ('audio','video') and s.byte_size between 1 and 33554432 for update of s nowait
), owned as materialized (
 select r.* from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
 and r.subject_mode='self' and r.lifecycle not in ('revoked','purging') and r.policy_version=$4
 and r.private_text_epoch=(select private_text_epoch from snapshot) and exists(select 1 from source)
 for update of r nowait
), capture as (select c.* from vy_replica_consent c join owned r using(replica_id,owner_user_id)
 where c.consent_id=(select consent_id from source) and c.scope='capture' and c.policy_version=r.policy_version
 and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())),
 storage as (select c.* from vy_replica_consent c join owned r using(replica_id,owner_user_id)
 where c.scope='storage' and c.policy_version=r.policy_version and c.revoked_at is null
 and (c.expires_at is null or c.expires_at>now()) order by c.granted_at desc,c.consent_id desc limit 1)
 select jsonb_build_object('replica_id',r.replica_id,'owner_user_id',r.owner_user_id,'source_id',s.source_id,
 'source_sha256',s.sha256,'byte_size',s.byte_size,'mime',s.mime,'capture_consent_id',cc.consent_id,
 'storage_consent_id',cs.consent_id,'policy_version',r.policy_version,'authority_epoch',r.private_text_epoch,
 'max_duration_ms',60000,'max_evidence_dispatches',4) binding from owned r cross join source s cross join capture cc cross join storage cs`;
export const COMPARISON_PREPARATION_AUTHORIZE_SQL=`with current as materialized (${COMPARISON_PREPARATION_SNAPSHOT_SQL}),
 eligible as materialized (select binding from current where binding=$6::jsonb),
 claimed as (insert into vy_comparison_preparation_id(preparation_id) select $5::uuid from eligible
 on conflict do nothing returning preparation_id),
 inserted as (insert into vy_replica_comparison_preparation(preparation_id,replica_id,owner_user_id,source_id,policy_version,statement_set,receipt,receipt_sha256,state,expires_at)
 select $5::uuid,$1::uuid,$2::uuid,$3::uuid,$4,'private-comparison-preparation/v1',$7::jsonb,$8,'authorized',now()+interval '24 hours'
 from claimed returning *) select * from inserted`;
export const COMPARISON_PREPARATION_READ_SQL=`select p.* from vy_replica_comparison_preparation p
 where p.preparation_id=$1::uuid and p.replica_id=$2::uuid and p.owner_user_id=$3::uuid`;
export async function readOwnedComparisonPreparation(db,owner,rid,pid){return (await db(COMPARISON_PREPARATION_READ_SQL,[replicaId(pid),replicaId(rid),owner]))[0]||null;}
export function clientComparisonPreparation(p){if(!p)return null;const expired=Date.parse(p.expires_at)<=Date.now()&&!['revoked','failed','reconciliation_required'].includes(p.state);
 return {preparation_id:p.preparation_id,source_id:p.source_id,state:expired?'expired':p.state,
 expires_at:p.expires_at,completed_receipt_sha256:!expired&&p.state==='prepared'?p.completed_receipt_sha256:null,can_voice:false};}
export async function authorizeOwnedComparisonPreparation(db,owner,rid,input){
 const i=comparisonPreparationInput(input),r=replicaId(rid);
 const prior=await readOwnedComparisonPreparation(db,owner,r,i.preparationId);
 if(prior){if(prior.source_id!==i.sourceId||prior.receipt?.attestations&&sha256Hex(prior.receipt.attestations)!==sha256Hex(i.attestations))throw comparisonError('comparison_preparation_conflict');return prior;}
 const params=[r,owner,i.sourceId,REPLICA_POLICY_VERSION];
 const current=(await db(COMPARISON_PREPARATION_SNAPSHOT_SQL,params))[0];if(!current)throw comparisonError('comparison_preparation_authority_unavailable');
 const receipt={...current.binding,statement_set:COMPARISON_PREPARATION_PURPOSE,attestations:i.attestations,preparation_id:i.preparationId};
 const rows=await db(COMPARISON_PREPARATION_AUTHORIZE_SQL,[...params,i.preparationId,JSON.stringify(current.binding),JSON.stringify(receipt),sha256Hex(receipt)]);
 if(!rows[0])throw comparisonError('comparison_preparation_changed');return rows[0];
}
export const COMPARISON_PREPARATION_WITHDRAW_SQL=`with retired as (
 insert into vy_comparison_preparation_id(preparation_id) select $1::uuid from vy_replica
 where replica_id=$2::uuid and owner_user_id=$3::uuid on conflict do nothing returning preparation_id
), target as materialized (
 select s.source_id from vy_replica_source s join vy_replica_comparison_preparation p using(source_id,replica_id,owner_user_id)
 where p.preparation_id=$1::uuid and p.replica_id=$2::uuid and p.owner_user_id=$3::uuid for update of s nowait
), owned as materialized (select r.* from vy_replica r where r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
 and ((select count(*) from target)>=0) for update of r nowait),
 withdrawn as (update vy_replica_comparison_preparation p set state='revoked',completed_receipt=null,completed_receipt_sha256=null,updated_at=now()
 where p.preparation_id=$1::uuid and p.replica_id=$2::uuid and p.owner_user_id=$3::uuid and exists(select 1 from owned) returning p.*),
 tombstone as (insert into vy_replica_comparison_preparation(preparation_id,replica_id,owner_user_id,policy_version,statement_set,state,expires_at)
 select $1::uuid,$2::uuid,$3::uuid,policy_version,'private-comparison-preparation/v1','revoked',now() from owned
 where exists(select 1 from retired) and not exists(select 1 from withdrawn) on conflict do nothing returning *),
 stopped as (update vy_replica_processing_job j set state='failed',failure_code='comparison_preparation_revoked',lease_token_hash='',lease_expires_at=null,updated_at=now()
 where j.comparison_preparation_id=$1::uuid and j.replica_id=$2::uuid and j.owner_user_id=$3::uuid and j.state<>'complete'
 and exists(select 1 from withdrawn) returning job_id)
 select * from withdrawn union all select * from tombstone`;
export async function withdrawOwnedComparisonPreparation(db,owner,rid,pid){
 const p=[replicaId(pid),replicaId(rid),owner];await db(COMPARISON_PREPARATION_WITHDRAW_SQL,p);
 let current=await readOwnedComparisonPreparation(db,owner,rid,pid);
 // A concurrent first admission may commit while our claim-once INSERT waits,
 // after this statement's snapshot. A fresh statement must revoke that row.
 if(current&&current.state!=='revoked'){await db(COMPARISON_PREPARATION_WITHDRAW_SQL,p);current=await readOwnedComparisonPreparation(db,owner,rid,pid);}
 if(current&&current.state!=='revoked')throw comparisonError('comparison_withdrawal_uncertain',503);
 return current;
}
export async function requireCurrentComparisonPreparation(db,source){
 const rows=await db(`with source as materialized (select s.* from vy_replica_source s
 where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid for update of s nowait),
 owned as materialized (select r.replica_id from vy_replica r join vy_replica_comparison_preparation p using(replica_id,owner_user_id)
 where r.replica_id=$2::uuid and r.owner_user_id=$3::uuid and p.source_id=$1::uuid
 and r.private_text_epoch=(p.receipt->>'authority_epoch')::bigint and exists(select 1 from source) for update of r nowait)
 select p.* from source s join vy_replica_comparison_preparation p using(source_id,replica_id,owner_user_id)
 where exists(select 1 from owned) and ${comparisonAuthoritySql()}`,[source.source_id,source.replica_id,source.owner_user_id]);
 if(!rows[0])throw comparisonError('comparison_preparation_authority_unavailable');return rows[0];
}
export const COMPARISON_COMPLETED_AUTHORITY_SQL=`select cp.* from vy_replica_source s
 join vy_replica_processing_job j using(source_id,replica_id,owner_user_id)
 join vy_replica_comparison_preparation cp on cp.preparation_id=j.comparison_preparation_id
 and cp.replica_id=j.replica_id and cp.owner_user_id=j.owner_user_id
 where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid and s.state='ready'
 and j.job_id=$4::uuid and j.step='voice_quality' and j.state='complete' and j.revision=1
 and j.result=cp.completed_receipt and j.result->>'manifest_hash'=cp.completed_receipt_sha256
 and ${comparisonAuthoritySql('s','j',{completed:true})}
 and not exists(select 1 from unnest(array['diarize','enhance','voice_quality']::text[]) required(step)
 where not exists(select 1 from vy_replica_comparison_dispatch d where d.preparation_id=cp.preparation_id and d.step=required.step and d.state='response_recorded'))
 and not exists(select 1 from vy_replica_comparison_dispatch d where d.preparation_id=cp.preparation_id and d.state<>'response_recorded')`;
export async function readOwnedCompletedComparisonPreparation(db,owner,rid,sourceId,jobId){
 const row=(await db(COMPARISON_COMPLETED_AUTHORITY_SQL,[replicaId(sourceId),replicaId(rid),owner,replicaId(jobId)]))[0];
 if(!row)return null;const receipt=processingCompletionReceipt(row.completed_receipt);
 if(receipt.purpose!==COMPARISON_PREPARATION_PURPOSE||receipt.preparation_id!==row.preparation_id||receipt.preparation_receipt_sha256!==row.receipt_sha256||
 receipt.manifest_hash!==row.completed_receipt_sha256||canonicalJson(receipt)!==canonicalJson(row.completed_receipt)||sha256Hex(row.receipt)!==row.receipt_sha256)throw comparisonError('comparison_completed_receipt_invalid',503);
 return {preparation_id:row.preparation_id,completed_receipt_sha256:row.completed_receipt_sha256,receipt_sha256:row.receipt_sha256,
 expires_at:row.expires_at,completed_receipt:receipt};
}
