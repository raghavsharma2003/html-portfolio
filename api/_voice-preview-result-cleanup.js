// Bounded cleanup for durable voice-preview WAVs.
//
// Expired sealed rows are transitioned before object deletion, so the public
// preview route can never serve an expired locator and a transient SQL failure
// cannot leave a sealed row pointing at bytes we already removed. Generation
// rows retain their exact private locator until deletion is confirmed, which
// also recovers objects written before a failed intent seal.

function boundedLimit(value) {
  const parsed = Number(value || 20);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(50, parsed)) : 20;
}

export async function claimVoicePreviewResultCleanup(db, options = {}) {
  const limit = boundedLimit(options.limit);
  const rows = await db(
    `with expired as materialized (
       select i.intent_id,i.replica_id,i.owner_user_id,i.generation_id,a.source_id,
              i.result_storage_bucket,i.result_object_path,i.result_sha256
         from vy_replica_voice_preview_intent i
         join vy_replica_processing_artifact a on a.artifact_id=i.preview_artifact_id
          and a.replica_id=i.replica_id and a.owner_user_id=i.owner_user_id
        where i.state='sealed' and i.result_expires_at<=now()
        order by i.result_expires_at,i.intent_id
        for update skip locked limit $1::int4
     ), settled as (
       update vy_replica_voice_preview_intent i
          set state='retryable',failure_code='voice_preview_result_expired',
              result_storage_bucket=null,result_object_path=null,result_mime=null,result_byte_size=null,
              result_sha256=null,result_object_id=null,result_metadata='{}'::jsonb,result_expires_at=null,
              completed_at=null,next_attempt_at=now(),updated_at=now()
         from expired e where i.intent_id=e.intent_id
       returning e.intent_id,e.replica_id,e.owner_user_id,e.generation_id,e.source_id,
                 e.result_storage_bucket,e.result_object_path,e.result_sha256
     ), orphan_candidate as materialized (
       select i.intent_id,g.replica_id,g.owner_user_id,g.generation_id,a.source_id,
              g.preview_result_storage_bucket result_storage_bucket,
              g.preview_result_object_path result_object_path,null::text result_sha256
         from vy_replica_generation g
         join vy_replica_voice_preview_intent i
           on i.intent_id=g.preview_intent_id and i.replica_id=g.replica_id
          and i.owner_user_id=g.owner_user_id
         join vy_replica_processing_artifact a on a.artifact_id=g.preview_artifact_id
          and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
        where g.preview_result_object_path<>'' and g.preview_result_deleted_at is null
          and (g.preview_result_cleanup_claimed_at is null
            or g.preview_result_cleanup_claimed_at<=now()-interval '10 minutes')
          and (
            g.generation_id<>i.generation_id
            or i.state in ('warming','retryable','failed')
            or (i.state='synthesizing' and i.lease_expires_at<=now())
          )
          and not exists (
            select 1 from settled s
             where s.result_storage_bucket=g.preview_result_storage_bucket
               and s.result_object_path=g.preview_result_object_path
          )
        order by g.updated_at,g.generation_id
        for update of g skip locked
        limit $1::int4
     ), candidate as materialized (
       select 'expired'::text cleanup_kind,intent_id,replica_id,owner_user_id,generation_id,source_id,
              result_storage_bucket,result_object_path,result_sha256 from settled
       union all
       select 'orphan'::text cleanup_kind,intent_id,replica_id,owner_user_id,generation_id,source_id,
              result_storage_bucket,result_object_path,result_sha256 from orphan_candidate
       limit $1::int4
     ), claimed as (
       update vy_replica_generation g
          set preview_result_cleanup_claimed_at=now(),updated_at=now()
         from candidate c
        where g.generation_id=c.generation_id and g.replica_id=c.replica_id
          and g.owner_user_id=c.owner_user_id and g.preview_intent_id=c.intent_id
          and g.preview_result_storage_bucket=c.result_storage_bucket
          and g.preview_result_object_path=c.result_object_path
          and g.preview_result_deleted_at is null
          and (g.preview_result_cleanup_claimed_at is null
            or g.preview_result_cleanup_claimed_at<=now()-interval '10 minutes')
       returning c.*
     )
     select * from claimed`,
    [limit],
  );
  return Object.freeze(rows.map((row) => Object.freeze({
    kind: row.cleanup_kind,
    intentId: row.intent_id,
    replicaId: row.replica_id,
    ownerUserId: row.owner_user_id,
    generationId: row.generation_id,
    sourceId: row.source_id,
    storageBucket: row.result_storage_bucket,
    objectPath: row.result_object_path,
    sha256: row.result_sha256 || "",
  })));
}

export async function markVoicePreviewResultDeleted(db, item) {
  const rows = await db(
    `update vy_replica_generation g
        set preview_result_deleted_at=coalesce(g.preview_result_deleted_at,now()),
            preview_result_cleanup_claimed_at=null,updated_at=now()
      where g.generation_id=$1::uuid and g.replica_id=$2::uuid and g.owner_user_id=$3::uuid
        and g.preview_intent_id=$4::uuid and g.preview_result_storage_bucket=$5
        and g.preview_result_object_path=$6 and g.preview_result_deleted_at is null
        and g.preview_result_cleanup_claimed_at is not null
      returning g.generation_id`,
    [item.generationId, item.replicaId, item.ownerUserId, item.intentId,
      item.storageBucket, item.objectPath],
  );
  return rows.length === 1;
}

export async function runVoicePreviewResultCleanup({ db, deleteObject, limit = 20 }) {
  const claimed = await claimVoicePreviewResultCleanup(db, { limit });
  let deleted = 0;
  let failed = 0;
  for (const item of claimed) {
    try {
      const prefix = `${item.ownerUserId}/${item.replicaId}/${item.sourceId}/derived/voice-preview/`;
      if (!item.storageBucket || !item.objectPath.startsWith(prefix) || !item.objectPath.endsWith(".wav") ||
          item.objectPath.includes("://")) {
        throw new Error("voice_preview_result_cleanup_locator_invalid");
      }
      await deleteObject({ storageBucket: item.storageBucket, objectPath: item.objectPath });
      if (!await markVoicePreviewResultDeleted(db, item)) {
        throw new Error("voice_preview_result_cleanup_acknowledgement_lost");
      }
      deleted += 1;
    } catch {
      // The row remains discoverable through its generation locator. A later
      // bounded sweep retries the exact idempotent delete.
      failed += 1;
    }
  }
  return Object.freeze({ claimed: claimed.length, deleted, failed });
}
