import { randomBytes } from "node:crypto";
import { REPLICA_POLICY_VERSION } from "./_replica.js";
import { sha256Hex } from "./_replica-processing/contracts.js";
import { deleteReplicaSourceObjects, replicaStorageBucketDescriptor } from "./_replica-storage.js";
import { primarySelectionQuery } from "./_replica-primary-selection.js";

const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PENDING_UPLOAD_STALE_MS = 24 * 60 * 60 * 1000;
const MIN_PENDING_UPLOAD_STALE_MS = 60 * 60 * 1000;
const MAX_PENDING_UPLOAD_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PENDING_UPLOAD_CLEANUP_BATCH = 25;

export function sourceErasureLeaseTokenHash(token) {
  if (typeof token !== "string" || token.length < 32) throw new Error("strong source erasure lease token required");
  return sha256Hex(`replica-source-erasure-lease:v1:${token}`);
}

function objectPaths(row) {
  const prefix = `${row.owner_user_id}/${row.replica_id}/${row.source_id}/`;
  const objects = [{ bucket: row.storage_bucket, path: row.object_path }, ...(Array.isArray(row.artifacts) ? row.artifacts : [])];
  const locators = [];
  for (const object of objects) {
    const path = String(object?.path || "");
    try { replicaStorageBucketDescriptor(object?.bucket); }
    catch { throw Object.assign(new Error("source erasure storage lineage invalid"), { code: "storage_lineage_invalid" }); }
    if (!path.startsWith(prefix) || path.includes("://") ||
        (path !== `${prefix}original` && !path.startsWith(`${prefix}derived/`))) {
      throw Object.assign(new Error("source erasure storage lineage invalid"), { code: "storage_lineage_invalid" });
    }
    locators.push(Object.freeze({ storageBucket: object.bucket, objectPath: path }));
  }
  const unique = new Map(locators.map((locator) => [`${locator.storageBucket}\n${locator.objectPath}`, locator]));
  return Object.freeze([...unique.values()].sort((left, right) =>
    left.storageBucket.localeCompare(right.storageBucket) || left.objectPath.localeCompare(right.objectPath)));
}

export async function markAbandonedPendingSourceUploads(db, options = {}) {
  const staleAfterMs = Math.max(MIN_PENDING_UPLOAD_STALE_MS, Math.min(MAX_PENDING_UPLOAD_STALE_MS,
    Number(options.staleAfterMs || DEFAULT_PENDING_UPLOAD_STALE_MS)));
  const batchSize = Math.max(1, Math.min(100, Number(options.batchSize || DEFAULT_PENDING_UPLOAD_CLEANUP_BATCH)));
  const rows = await db(
    `with stale as (
       select s.source_id
         from vy_replica_source s
        where s.state='pending_upload'
          and s.updated_at<=now()-($1::bigint*interval '1 millisecond')
        order by s.updated_at,s.source_id
        for update skip locked limit $2::integer
     ), marked as (
       update vy_replica_source s
          set state='deleting',erasure_next_attempt_at=now(),updated_at=now()
         from stale where s.source_id=stale.source_id and s.state='pending_upload'
       returning s.source_id,s.storage_bucket,s.object_path
     ) select * from marked`,
    [staleAfterMs, batchSize],
  );
  return Object.freeze(rows.map((row) => Object.freeze({
    sourceId: row.source_id,
    storageBucket: row.storage_bucket,
    objectPath: row.object_path,
  })));
}

export async function leaseNextSourceErasure(db, options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const leaseMs = Math.max(60_000, Math.min(300_000, Number(options.leaseMs || 240_000)));
  const rows = await db(
    `with candidate as (
       select s.source_id,s.erasure_attempts previous_attempt,s.erasure_lease_token_hash previous_lease
         from vy_replica_source s where s.state='deleting' and (
          (s.erasure_lease_token_hash='' and s.erasure_next_attempt_at<=now()) or
          (s.erasure_lease_token_hash<>'' and s.erasure_lease_expires_at<=now())
          )
          -- A direct browser capability can recreate the exact original even
          -- after it was observed absent. It is not revocable at either
          -- provider, so physical erasure waits for the durable not-after.
          and coalesce(s.upload_authorization_expires_at,'-infinity'::timestamptz)<=now()
          -- A DB job/intent can settle before a provider finishes a request.
          -- The per-writer authority is the durable provider quiescence gate;
          -- released or expired rows do not block, active future rows do.
          and not exists (
            select 1 from vy_replica_source_storage_writer sw
             where sw.source_id=s.source_id and sw.replica_id=s.replica_id
               and sw.owner_user_id=s.owner_user_id and sw.state='active'
               and sw.storage_write_not_after>now()
          )
          -- A worker that loaded context before deletion may still be inside
          -- a provider call. Source state stops renewal/commit; this fence
          -- waits for its last owned lease before prefix enumeration begins.
          and not exists (
            select 1 from vy_replica_processing_job pj
             where pj.source_id=s.source_id and pj.replica_id=s.replica_id
               and pj.owner_user_id=s.owner_user_id and pj.state='leased'
               and pj.lease_expires_at+interval '60 minutes'>now()
          ) and not exists (
            select 1 from vy_replica_voice_preview_intent pi
            join vy_replica_processing_artifact pa
              on pa.artifact_id=pi.preview_artifact_id and pa.replica_id=pi.replica_id
             and pa.owner_user_id=pi.owner_user_id
             where pa.source_id=s.source_id and pi.replica_id=s.replica_id
               and pi.owner_user_id=s.owner_user_id and pi.state='synthesizing'
               and pi.lease_expires_at>now()
          ) and not exists (
            select 1 from vy_replica_liveness_challenge ch where ch.replica_id=s.replica_id
              and ch.owner_user_id=s.owner_user_id and ch.face_session_state in (
                'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
              )
          ) order by s.erasure_next_attempt_at,s.updated_at for update skip locked limit 1
     ), expired as (
       update vy_replica_source_erasure_attempt a
          set outcome='retry',failure_code='lease_expired',finished_at=now()
         from candidate c where c.previous_lease<>'' and a.source_id=c.source_id
          and a.attempt=c.previous_attempt and a.outcome='running'
     ), leased as (
       update vy_replica_source s set erasure_attempts=s.erasure_attempts+1,
              erasure_lease_token_hash=$1,erasure_leased_at=now(),
              erasure_lease_expires_at=now()+($2::integer*interval '1 millisecond'),
              erasure_last_error_code='',updated_at=now()
         from candidate c where s.source_id=c.source_id
       returning s.source_id,s.replica_id,s.owner_user_id,s.storage_bucket,s.object_path,
                 s.erasure_attempts,s.erasure_lease_expires_at,
                 coalesce((select jsonb_agg(jsonb_build_object('bucket',stored.bucket,'path',stored.path)
                   order by stored.path) from (
                     select a.storage_bucket bucket,a.object_path path
                       from vy_replica_processing_artifact a
                      where a.source_id=s.source_id and a.replica_id=s.replica_id
                        and a.owner_user_id=s.owner_user_id
                     union all
                     select i.result_storage_bucket bucket,i.result_object_path path
                       from vy_replica_voice_preview_intent i
                       join vy_replica_processing_artifact a on a.artifact_id=i.preview_artifact_id
                        and a.replica_id=i.replica_id and a.owner_user_id=i.owner_user_id
                      where a.source_id=s.source_id and i.replica_id=s.replica_id
                        and i.owner_user_id=s.owner_user_id and i.result_object_path is not null
                     union all
                     select g.preview_result_storage_bucket bucket,g.preview_result_object_path path
                       from vy_replica_generation g
                       join vy_replica_processing_artifact a on a.artifact_id=g.preview_artifact_id
                        and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
                      where a.source_id=s.source_id and g.replica_id=s.replica_id
                        and g.owner_user_id=s.owner_user_id and g.preview_result_object_path<>''
                        and g.preview_result_deleted_at is null
                   ) stored),'[]'::jsonb) artifacts
     ), attempted as (
       insert into vy_replica_source_erasure_attempt
         (source_id,replica_id,owner_user_id,attempt,object_count,outcome)
       select source_id,replica_id,owner_user_id,erasure_attempts,
              1+jsonb_array_length(artifacts),'running' from leased
       on conflict (source_id,attempt) do nothing
     ) select * from leased`,
    [sourceErasureLeaseTokenHash(token), leaseMs],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const claimed = Object.freeze({
    source: Object.freeze({
      sourceId: row.source_id,
      replicaId: row.replica_id,
      ownerUserId: row.owner_user_id,
      paths: Object.freeze([]),
      attempt: Number(row.erasure_attempts),
    }),
    leaseToken: token,
  });
  try {
    return Object.freeze({
      ...claimed,
      source: Object.freeze({ ...claimed.source, paths: objectPaths(row) }),
    });
  } catch (error) {
    await retrySourceErasure(db, claimed, { error, retryAfterMs: MAX_RETRY_MS });
    return null;
  }
}

export async function renewSourceErasureLease(db, lease, options = {}) {
  const leaseMs = Math.max(60_000, Math.min(300_000, Number(options.leaseMs || 240_000)));
  const rows = await db(
    `update vy_replica_source s
        set erasure_lease_expires_at=now()+($5::integer*interval '1 millisecond'),updated_at=now()
      where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
        and s.state='deleting' and s.erasure_lease_token_hash=$4
           and s.erasure_lease_expires_at>now()
           and not exists (
             select 1 from vy_replica_source_storage_writer sw
              where sw.source_id=s.source_id and sw.replica_id=s.replica_id
                and sw.owner_user_id=s.owner_user_id and sw.state='active'
                and sw.storage_write_not_after>now()
           )
      returning s.source_id`,
    [lease.source.sourceId, lease.source.replicaId, lease.source.ownerUserId,
      sourceErasureLeaseTokenHash(lease.leaseToken), leaseMs],
  );
  return requireSettlement(rows, "lost_source_erasure_lease");
}

function requireSettlement(rows, code) {
  if (!rows[0]) throw Object.assign(new Error(code), { code });
  return true;
}

export async function completeSourceErasure(db, lease) {
  const rows = await primarySelectionQuery(db,
    `with selection_snapshot as materialized (
       select primary_selection_id from vy_replica
        where replica_id=$2::uuid and owner_user_id=$3::uuid
     ), review_lock as materialized (
       select pg_try_advisory_xact_lock(hashtextextended($2::text || ':voice_genome_review',0)) acquired
     ), candidate as materialized (
       select s.source_id,s.replica_id,s.owner_user_id,s.erasure_attempts,
              coalesce(
                nullif(s.provenance->>'erasure_requested_at','')::timestamptz,
                (select min(a.at) from vy_replica_audit a
                  where a.replica_id=s.replica_id and a.owner_user_id=s.owner_user_id
                    and a.action='source.delete.request' and a.object_kind='source'
                    and a.object_id=s.source_id::text),
                s.updated_at
              )
                erasure_requested_at
         from vy_replica_source s cross join review_lock
        where review_lock.acquired and s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
          and s.state='deleting' and s.erasure_lease_token_hash=$4
          and s.erasure_lease_expires_at>now()
          -- Recheck every provider authority under the completion row lock.
          -- The prefix sweep happened outside this transaction, so a receipt
          -- must not remove the final manifest if an authority was extended or
          -- an old-version writer became visible after the lease was issued.
          and coalesce(s.upload_authorization_expires_at,'-infinity'::timestamptz)<=now()
          and not exists (
            select 1 from vy_replica_source_storage_writer sw
             where sw.source_id=s.source_id and sw.replica_id=s.replica_id
               and sw.owner_user_id=s.owner_user_id and sw.state='active'
               and sw.storage_write_not_after>now()
          )
          and not exists (
            select 1 from vy_replica_liveness_challenge ch where ch.replica_id=s.replica_id
               and ch.owner_user_id=s.owner_user_id and ch.face_session_state in (
                 'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
               )
           )
        for update of s nowait
     ), primary_owner as materialized (
       select r.replica_id,r.primary_selection_id=ss.primary_selection_id snapshot_current
         from vy_replica r cross join selection_snapshot ss
        where r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
          and exists (select 1 from candidate)
        for update of r nowait
     ), affected_genomes as materialized (
       select g.version,g.source_set_hash
         from vy_replica_voice_genome g join candidate c on c.replica_id=g.replica_id
        where (g.definition#>'{references,source_ids}') ? c.source_id::text
     ), affected_profiles as materialized (
       select p.version,p.source_set_hash
         from vy_replica_profile p join candidate c on c.replica_id=p.replica_id
        where jsonb_path_exists(
          p.definition,'$.domains.*[*].source_ids[*] ? (@ == $source)',
          jsonb_build_object('source',to_jsonb(c.source_id::text))
        )
     ), target as materialized (
       select c.* from candidate c
        where exists (select 1 from primary_owner where snapshot_current) and not exists (
          select 1 from vy_replica_voice_profile vp
          join affected_genomes affected on affected.version=vp.genome_version
           where vp.replica_id=c.replica_id and vp.owner_user_id=c.owner_user_id
        )
     ), retired_text_links as (
       insert into vy_text_publication_id_ledger(id,kind)
       select p.publication_id,'publication' from vy_text_publication p join target t on p.source_id=t.source_id
         and p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
       on conflict do nothing returning id
     ), erased_text_publications as (
       delete from vy_text_publication p using target t where p.source_id=t.source_id
         and p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
         and (select count(*) from retired_text_links)>=0 returning p.publication_id
     ), source_context_items as materialized (
       -- Capture the exact context handles before source deletion cascades
       -- through the item/text FKs. Ingest runs retain a text video_ref rather
       -- than an item FK, so that cascade alone cannot erase their quotations.
       select i.item_id,i.replica_id,i.owner_user_id
         from vy_context_item i join target t
           on i.source_id=t.source_id and i.replica_id=t.replica_id
          and i.owner_user_id=t.owner_user_id
          and (select count(*) from erased_text_publications)>=0
        for update of i
     ), context_ingest_runs as (
       update vy_ingest_run r
          set stats='{}'::jsonb,proposed_delta='{}'::jsonb,proposed_delta_count=0,
              video_title='',failure_code='context_source_removed',
              status=case when r.status in ('applied','rejected') then r.status else 'rejected' end,
              approved_by_user_id=case when r.status in ('applied','rejected') then r.approved_by_user_id else $3::uuid end,
              decided_at=case when r.status in ('applied','rejected') then r.decided_at else now() end,
              updated_at=now()
         from source_context_items i
        where r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
          and r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
          and r.transcript_source='context_item' and r.video_ref='context:' || i.item_id::text
       returning r.run_id
     ), source_windows as materialized (
       -- vy_mirror_window.source_id is ON DELETE SET NULL for historical
       -- source-less calls. A source erasure must therefore capture the exact
       -- owner/replica/source window set before the source row disappears.
       -- Otherwise the FK keeps the transcript while destroying its erasure
       -- handle.
       select w.window_id,w.session_id,w.replica_id,w.owner_user_id,w.seq
         from vy_mirror_window w join target t
           on t.source_id=w.source_id and t.replica_id=w.replica_id
          and t.owner_user_id=w.owner_user_id
     ), source_turns as materialized (
       select tr.turn_id,tr.window_id,tr.session_id,tr.replica_id,tr.owner_user_id
         from vy_mirror_turn tr join source_windows w
           on w.window_id=tr.window_id and w.session_id=tr.session_id
          and w.replica_id=tr.replica_id and w.owner_user_id=tr.owner_user_id
     ), source_deltas as materialized (
       -- Mirror deltas cite window sequence numbers rather than a foreign key.
       -- Their citation/evidence JSON may contain transcript excerpts, so a
       -- source-bound delta must be found before its cited window is removed.
       select distinct d.delta_id,d.session_id,d.replica_id,d.owner_user_id,
              d.target_field,d.fragment,d.state,d.applied_at,d.applied_sheet_id
         from vy_mirror_delta d join source_windows w
           on w.session_id=d.session_id and w.replica_id=d.replica_id
          and w.owner_user_id=d.owner_user_id and w.seq=any(d.cited_windows)
     ), reversible_delta_fragments as materialized (
       -- Only an accepted delta that actually changed a sheet is reversed.
       -- Preserve a phrase when another still-cited accepted delta supports it.
       select distinct d.delta_id,d.replica_id,d.owner_user_id,d.target_field,d.fragment,
              d.applied_sheet_id
         from source_deltas d
        where d.state='accepted' and d.applied_at is not null and d.target_field<>''
          and not exists (
            select 1 from vy_mirror_delta support
             where support.replica_id=d.replica_id and support.owner_user_id=d.owner_user_id
               and support.delta_id<>d.delta_id and support.state='accepted'
               and support.applied_at is not null
               and support.target_field=d.target_field and support.fragment=d.fragment
               and not exists (select 1 from source_deltas erased where erased.delta_id=support.delta_id)
               and not exists (
                 select 1 from unnest(support.cited_windows) cited(seq)
                  where not exists (
                    select 1 from vy_mirror_window live
                     where live.session_id=support.session_id and live.replica_id=support.replica_id
                       and live.owner_user_id=support.owner_user_id and live.seq=cited.seq
                       and live.source_id is not null
                  )
               )
          )
     ), sheet_candidates as materialized (
       select s.sheet_id,s.agent_id,s.sheet,s.status,
              exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and f.target_field='boardVerbalisms'
                         and (f.applied_sheet_id=s.sheet_id or (f.applied_sheet_id is null and s.agent_id is not null))) remove_board,
              exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and f.target_field='exSlangRepeat'
                         and (f.applied_sheet_id=s.sheet_id or (f.applied_sheet_id is null and s.agent_id is not null))) remove_slang,
              t.replica_id,t.owner_user_id
         from target t join vy_replica r
           on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
        -- Explicit ownership wins. Exact materialization IDs can also name
        -- an unbound private sheet; legacy null IDs keep their bound-only reach.
        -- Revoked rows are nonservable, but still hold source-derived content.
        join vy_teacher_sheet s on
          (s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id
            and (s.agent_id is null or s.agent_id=r.agent_id))
          or (s.replica_id is null and s.owner_user_id is null and s.agent_id=r.agent_id)
        where exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and (f.applied_sheet_id=s.sheet_id or (f.applied_sheet_id is null and s.agent_id is not null)))
     ), sheet_board_rewritten as materialized (
       select c.*,
              case when not c.remove_board then c.sheet else
                jsonb_set(c.sheet,'{boardVerbalisms}',coalesce((
                  select jsonb_agg(item.value order by item.ordinality)
                    from jsonb_array_elements(case
                      when jsonb_typeof(c.sheet->'boardVerbalisms')='array'
                        then c.sheet->'boardVerbalisms' else '[]'::jsonb end)
                      with ordinality item(value,ordinality)
                   where not exists (
                     select 1 from reversible_delta_fragments f
                      where f.replica_id=c.replica_id and f.owner_user_id=c.owner_user_id
                        and f.target_field='boardVerbalisms'
                        and (f.applied_sheet_id=c.sheet_id or (f.applied_sheet_id is null and c.agent_id is not null))
                        and f.fragment=btrim(item.value#>>'{}')
                   )
                ),'[]'::jsonb),true) end sheet_after_board
         from sheet_candidates c
     ), sheet_rewritten as materialized (
       select b.sheet_id,b.status,
              case when not b.remove_slang then b.sheet_after_board else
                jsonb_set(b.sheet_after_board,'{exSlangRepeat}',to_jsonb((
                  select '('||coalesce(string_agg(to_jsonb(existing.fragment)::text,', '
                                               order by existing.ordinality),'')||')'
                    from (
                      select btrim(part,E' \t\n\r\"') fragment,ordinality
                        from regexp_split_to_table(
                          btrim(coalesce(b.sheet_after_board->>'exSlangRepeat',''),E' \t\n\r()'),
                          E'[[:space:]]*,[[:space:]]*') with ordinality pieces(part,ordinality)
                    ) existing
                   where existing.fragment<>'' and not exists (
                     select 1 from reversible_delta_fragments f
                      where f.replica_id=b.replica_id and f.owner_user_id=b.owner_user_id
                        and f.target_field='exSlangRepeat'
                        and (f.applied_sheet_id=b.sheet_id or (f.applied_sheet_id is null and b.agent_id is not null))
                        and f.fragment=existing.fragment
                   )
                )),true) end rewritten_sheet
         from sheet_board_rewritten b
     ), teacher_sheet_effects as (
       update vy_teacher_sheet s
          set sheet=x.rewritten_sheet,
              -- Historical sheets cannot become a second explicit private
              -- draft (migration139). Retire their serving authority instead.
              status=case when s.status in ('published','validated') then 'revoked' else s.status end,
              published_at=case when s.status in ('published','validated','revoked') then null else s.published_at end,
              consent_artifact_id=case when s.status in ('published','validated','revoked') then null else s.consent_artifact_id end,
              updated_at=now()
         from sheet_rewritten x where s.sheet_id=x.sheet_id
       returning s.sheet_id
     ), provider_consent as (
       update vy_replica_provider_consent pc set source_id=null,state='revoked',
              revoked_at=coalesce(revoked_at,now()),updated_at=now()
         from target t where pc.source_id=t.source_id and pc.replica_id=t.replica_id
          and pc.owner_user_id=t.owner_user_id
     ), identity_binding as (
       select ic.identity_case_id,ic.replica_id,ic.owner_user_id,
              (ic.state='verified' and r.age_verified_at is not null
               and r.identity_verified_at is not null and r.liveness_verified_at is not null
               and r.identity_expires_at>now()) preserve
         from vy_replica_identity_case ic
         join target t on t.source_id=ic.source_id and t.replica_id=ic.replica_id
          and t.owner_user_id=ic.owner_user_id
         join vy_replica r on r.replica_id=ic.replica_id and r.owner_user_id=ic.owner_user_id
     ), preserved_identity as (
       update vy_replica_identity_case ic set source_id=null,updated_at=now()
        from identity_binding b where b.preserve and ic.identity_case_id=b.identity_case_id
       returning ic.identity_case_id
     ), identity_challenge_sources as (
       update vy_replica_source live set state='deleting',updated_at=now()
         from vy_replica_liveness_challenge ch
         join identity_binding b on b.identity_case_id=ch.identity_case_id and not b.preserve
         join target t on t.replica_id=b.replica_id and t.owner_user_id=b.owner_user_id
        where live.source_id=ch.source_id and live.replica_id=ch.replica_id
          and live.owner_user_id=ch.owner_user_id and live.source_id<>t.source_id
       -- RETURNING is mandatory, not decoration: a data-modifying CTE with no
       -- RETURNING clause cannot be REFERENCED, and the "count(*)" below is a
       -- reference. Without it Postgres rejects the whole statement at parse
       -- time — 0A000, "WITH query "identity_challenge_sources" does not have a
       -- RETURNING clause" — so it could never execute.
       returning live.source_id
     ), identity_cases as (
       delete from vy_replica_identity_case ic using identity_binding b
        where ic.identity_case_id=b.identity_case_id and not b.preserve
          -- Reads the rows the CTE above actually marked. The predicate is
          -- deliberately total (>=0 holds for an empty set too): its job is to
          -- name the dependency, not to filter. Marking the challenge sources
          -- for deletion must not be skipped when there happen to be none.
          and (select count(*) from identity_challenge_sources)>=0
       returning ic.replica_id,ic.owner_user_id
     ), removed_primary as (
       delete from vy_replica_voice_reference vr using target t
        where vr.replica_id=t.replica_id and vr.owner_user_id=t.owner_user_id and vr.source_id=t.source_id
       returning vr.replica_id,vr.owner_user_id
     ), replica_effects as materialized (
       select t.replica_id,t.owner_user_id,
              exists (select 1 from identity_cases ic where ic.replica_id=t.replica_id
                and ic.owner_user_id=t.owner_user_id) revoke_identity,
              exists (select 1 from removed_primary p where p.replica_id=t.replica_id
                and p.owner_user_id=t.owner_user_id) withdraw_primary
         from target t
     ), identity_replica as (
       update vy_replica r
          set age_verified_at=case when e.revoke_identity then null else r.age_verified_at end,
              identity_verified_at=case when e.revoke_identity then null else r.identity_verified_at end,
              liveness_verified_at=case when e.revoke_identity then null else r.liveness_verified_at end,
              identity_expires_at=case when e.revoke_identity then null else r.identity_expires_at end,
              lifecycle=case when e.revoke_identity and r.lifecycle not in ('revoked','purging')
                then 'enrolling' else r.lifecycle end,
              private_text_epoch=r.private_text_epoch+1,
              primary_selection_id=case when e.withdraw_primary then gen_random_uuid() else r.primary_selection_id end,
              updated_at=now()
         from replica_effects e where r.replica_id=e.replica_id and r.owner_user_id=e.owner_user_id
          -- Every erased source invalidates its private rehearsal snapshot.
       returning case when e.revoke_identity then r.subject_person_id end subject_person_id
     ), identity_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where exists (select 1 from identity_cases ic where ic.replica_id=c.replica_id
          and ic.owner_user_id=c.owner_user_id) and c.scope='biometric' and c.revoked_at is null
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), claim_materialization_episodes as materialized (
       select e.id,e.agent_id,e.person_id
         from target t
         join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
         join vy_replica_claim c on c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and t.source_id=any(c.source_ids) and c.proposal_hash is not null
         join vy_episode e on e.agent_id=r.agent_id and e.person_id=r.subject_person_id
          and e.boundary_reason like 'replica_claim:'||c.proposal_hash||':%'
     ), claim_materialized_facts as (
       delete from vy_fact f using claim_materialization_episodes e
        where f.agent_id=e.agent_id and f.person_id=e.person_id
          and f.citations && array[e.id]::bigint[]
     ), claim_materialized_rel_events as (
       delete from vy_rel_event v using claim_materialization_episodes e
        where v.agent_id=e.agent_id and v.person_id=e.person_id
          and v.citations && array[e.id]::bigint[]
     ), claim_materialized_episodes as (
       delete from vy_episode e using claim_materialization_episodes doomed
        where e.id=doomed.id and e.agent_id=doomed.agent_id and e.person_id=doomed.person_id
     ), claims as (
       delete from vy_replica_claim c using target t
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and t.source_id=any(c.source_ids)
     ), affected_calibrations as materialized (
       select c.version
         from vy_replica_calibration c join target t
           on t.replica_id=c.replica_id and t.owner_user_id=c.owner_user_id
        where exists (select 1 from affected_profiles affected where affected.version=c.profile_version)
     ), affected_datasets as materialized (
       select d.dataset_id
         from vy_replica_feedback_dataset d join target t
           on t.replica_id=d.replica_id and t.owner_user_id=d.owner_user_id
        where exists (select 1 from affected_profiles affected where affected.version=d.profile_version)
           or exists (select 1 from affected_calibrations affected where affected.version=d.calibration_version)
     ), affected_builds as materialized (
       select b.build_id
         from vy_replica_model_build b join target t
           on t.replica_id=b.replica_id and t.owner_user_id=b.owner_user_id
        where b.created_at<=t.erasure_requested_at
           or exists (select 1 from affected_genomes affected where affected.source_set_hash=b.source_set_hash)
           or exists (select 1 from affected_profiles affected where affected.source_set_hash=b.source_set_hash)
     ), genomes as (
       update vy_replica_voice_genome g set status='retired',
              source_set_hash='erased:'||$1::text||':'||g.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where g.replica_id=t.replica_id
          and exists (select 1 from affected_genomes affected where affected.version=g.version)
     ), profiles as (
       update vy_replica_profile p set status='retired',
              source_set_hash='erased:'||$1::text||':'||p.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where p.replica_id=t.replica_id
          and exists (select 1 from affected_profiles affected where affected.version=p.version)
     ), calibrations as (
       update vy_replica_calibration c set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and exists (select 1 from affected_calibrations affected where affected.version=c.version)
     ), datasets as (
       update vy_replica_feedback_dataset d set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased'),
              readiness=jsonb_build_object('ready',false,'blockers',jsonb_build_array('source_erased'))
         from target t where d.replica_id=t.replica_id and d.owner_user_id=t.owner_user_id
          and exists (select 1 from affected_datasets affected where affected.dataset_id=d.dataset_id)
     ), candidate_activations as (
       delete from vy_replica_candidate_activation h using target t
        where h.replica_id=t.replica_id and h.owner_user_id=t.owner_user_id
          and (exists (select 1 from affected_datasets d where d.dataset_id=h.dataset_id)
            or exists (select 1 from vy_replica_runtime_capability cap
              where cap.capability_id=h.new_capability_id and cap.replica_id=h.replica_id and cap.owner_user_id=h.owner_user_id
                and (exists (select 1 from affected_profiles p where p.version=cap.profile_version)
                  or exists (select 1 from affected_calibrations k where k.version=cap.calibration_version))))
     ), correction_candidate_jobs as (
       delete from vy_replica_correction_candidate_job j using target t,affected_datasets affected
        where j.replica_id=t.replica_id and j.owner_user_id=t.owner_user_id
          and j.dataset_id=affected.dataset_id
     ), candidate_evaluations as (
       delete from vy_replica_candidate_eval_run r using target t,affected_datasets affected
        where r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
          and r.dataset_id=affected.dataset_id
     ), candidate_qualifications as (
       delete from vy_replica_candidate_qualification q
        using target t,affected_datasets affected,vy_replica_candidate c
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.dataset_id=affected.dataset_id
          and q.candidate_id=c.candidate_id and q.replica_id=c.replica_id
          and q.owner_user_id=c.owner_user_id
     ), candidates as (
       update vy_replica_candidate c set status='retired',updated_at=now()
         from target t,affected_datasets affected
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.dataset_id=affected.dataset_id
          and c.status<>'retired'
      ), builds as (
        update vy_replica_model_build b set state='retired',updated_at=now()
          from target t,affected_builds affected
         where b.replica_id=t.replica_id and b.owner_user_id=t.owner_user_id
           and b.build_id=affected.build_id
           and b.state<>'retired'
      ), voice_delivery_policies as (
        delete from vy_replica_voice_delivery_policy p using vy_replica_processing_artifact a,target t
         where p.preview_artifact_id=a.artifact_id and p.replica_id=a.replica_id
           and p.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
      ), voice_preferences as (
        delete from vy_replica_voice_preference p using target t
         where p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
           and exists (
             select 1 from vy_replica_generation g
             join vy_replica_processing_artifact a on a.artifact_id=g.preview_artifact_id
              and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
              where g.generation_id in (p.left_generation_id,p.right_generation_id)
                and a.source_id=t.source_id and a.replica_id=t.replica_id
                and a.owner_user_id=t.owner_user_id
           )
      ), preview_generations as (
        delete from vy_replica_generation g using vy_replica_processing_artifact a,target t
         where g.preview_artifact_id=a.artifact_id and g.replica_id=a.replica_id
           and g.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
       ), voice_trials as (
         delete from vy_replica_voice_trial v using target t
         where v.preview_artifact_id in (
           select a.artifact_id from vy_replica_processing_artifact a
            where a.source_id=t.source_id and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
          ) and v.replica_id=t.replica_id and v.owner_user_id=t.owner_user_id
       ), mirror_feedback as (
         delete from vy_mirror_feedback f using source_turns tr
          where f.session_id=tr.session_id and f.replica_id=tr.replica_id
            and f.owner_user_id=tr.owner_user_id and f.turn_ref=tr.turn_id::text
         returning f.feedback_id
       ), mirror_finetune_jobs as (
         delete from vy_mirror_finetune_job j using source_windows w
          where j.session_id=w.session_id and j.replica_id=w.replica_id
            and j.owner_user_id=w.owner_user_id
         returning j.job_id
       ), mirror_deltas as (
         delete from vy_mirror_delta d using source_deltas doomed
          where d.delta_id=doomed.delta_id and d.session_id=doomed.session_id
            and d.replica_id=doomed.replica_id and d.owner_user_id=doomed.owner_user_id
            and (select count(*) from teacher_sheet_effects)>=0
         returning d.delta_id
       ), expression_observations as (
         delete from vy_replica_expression_observation o using target t
          where o.source_id=t.source_id and o.replica_id=t.replica_id
            and o.owner_user_id=t.owner_user_id
         returning o.observation_id
       ), canonical_evidence as (
         delete from vy_replica_processing_evidence e using target t
          where e.source_id=t.source_id and e.replica_id=t.replica_id
            and e.owner_user_id=t.owner_user_id
         returning e.evidence_id
       ), mirror_conditioning as (
         delete from vy_mirror_conditioning c using source_windows w
          where c.window_id=w.window_id and c.session_id=w.session_id
            and c.replica_id=w.replica_id and c.owner_user_id=w.owner_user_id
         returning c.selection_id
       ), mirror_turns as (
         delete from vy_mirror_turn tr using source_turns doomed
          where tr.turn_id=doomed.turn_id and tr.window_id=doomed.window_id
            and tr.replica_id=doomed.replica_id and tr.owner_user_id=doomed.owner_user_id
            and (select count(*) from mirror_feedback)>=0
            and (select count(*) from expression_observations)>=0
         returning tr.turn_id
       ), mirror_windows as (
         delete from vy_mirror_window w using source_windows doomed
          where w.window_id=doomed.window_id and w.session_id=doomed.session_id
            and w.replica_id=doomed.replica_id and w.owner_user_id=doomed.owner_user_id
            and (select count(*) from mirror_finetune_jobs)>=0
            and (select count(*) from mirror_deltas)>=0
            and (select count(*) from canonical_evidence)>=0
            and (select count(*) from mirror_conditioning)>=0
            and (select count(*) from mirror_turns)>=0
         returning w.window_id
       ), removed as (
         delete from vy_replica_source s using target t
          where s.source_id=t.source_id and s.replica_id=t.replica_id and s.owner_user_id=t.owner_user_id
           and (select count(*) from identity_cases)>=0 and (select count(*) from preserved_identity)>=0
           and (select count(*) from mirror_windows)>=0
           and (select count(*) from context_ingest_runs)>=0
           and (select count(*) from identity_replica)>=0
        returning t.source_id,t.replica_id,t.owner_user_id,t.erasure_attempts
     ), attempted as (
       update vy_replica_source_erasure_attempt a set outcome='complete',failure_code='',finished_at=now()
         from removed r where a.source_id=r.source_id and a.attempt=r.erasure_attempts and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'source.delete.complete','source',source_id::text,$5,'allowed',
              jsonb_build_object(
                'derived_models_scrubbed',true,'worker','reconciler',
                'mirror_windows_removed',(select count(*) from mirror_windows),
                'mirror_deltas_removed',(select count(*) from mirror_deltas),
                'expression_observations_removed',(select count(*) from expression_observations),
                'canonical_evidence_removed',(select count(*) from canonical_evidence),
                'context_ingest_runs_scrubbed',(select count(*) from context_ingest_runs),
                'teacher_sheets_rewritten',(select count(*) from teacher_sheet_effects)
              ) from removed
     ) select coalesce((select jsonb_agg(x) from (select source_id from removed) x),'[]'::jsonb) primary_selection_rows,
              exists (select 1 from primary_owner where not snapshot_current) primary_selection_snapshot_stale`,
    [lease.source.sourceId, lease.source.replicaId, lease.source.ownerUserId,
      sourceErasureLeaseTokenHash(lease.leaseToken), REPLICA_POLICY_VERSION],
  );
  return requireSettlement(rows, "source_erasure_waiting_for_provider");
}

export function normalizeSourceErasureFailure(error) {
  const code = String(error?.code || error || "");
  if (code === "source_erasure_waiting_for_provider") return "provider_voice_erasure_pending";
  if (code === "storage_lineage_invalid") return "storage_lineage_invalid";
  if (code.includes("unreachable")) return "private_storage_unreachable";
  if (code.includes("storage")) return "private_storage_delete_failed";
  return "source_erasure_failed";
}

export async function retrySourceErasure(db, lease, input = {}) {
  const retryAfterMs = Math.max(30_000, Math.min(MAX_RETRY_MS, Number(input.retryAfterMs || 30_000)));
  const failureCode = normalizeSourceErasureFailure(input.error || input.failureCode);
  const rows = await db(
    `with retried as (
       update vy_replica_source s set erasure_next_attempt_at=now()+($5::integer*interval '1 millisecond'),
              erasure_lease_token_hash='',erasure_leased_at=null,erasure_lease_expires_at=null,
              erasure_last_error_code=$6,updated_at=now()
        where s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid and s.state='deleting'
          and s.erasure_lease_token_hash=$4 and s.erasure_lease_expires_at>now()
       returning s.source_id,s.erasure_attempts
     ), attempted as (
       update vy_replica_source_erasure_attempt a set outcome='retry',failure_code=$6,finished_at=now()
         from retried r where a.source_id=r.source_id and a.attempt=r.erasure_attempts and a.outcome='running'
     ) select source_id from retried`,
    [lease.source.sourceId, lease.source.replicaId, lease.source.ownerUserId,
      sourceErasureLeaseTokenHash(lease.leaseToken), retryAfterMs, failureCode],
  );
  return requireSettlement(rows, "lost_source_erasure_lease");
}

export function sourceErasureRetryDelayMs(attempt) {
  const safeAttempt = Math.max(1, Math.min(30, Number(attempt) || 1));
  return Math.min(MAX_RETRY_MS, 30_000 * (2 ** (safeAttempt - 1)));
}

async function withSourceErasureLeaseHeartbeat(db, lease, renew, task, options = {}) {
  const heartbeatMs = Math.max(100, Math.min(120_000, Number(options.heartbeatMs || 60_000)));
  let stop = false;
  let wake;
  let leaseError = null;
  const heartbeatAborter = new AbortController();
  const stopped = new Promise((resolve) => { wake = resolve; });
  const heartbeat = (async () => {
    while (!stop) {
      let timer;
      try {
        await Promise.race([
          new Promise((resolve) => {
            timer = setTimeout(resolve, heartbeatMs);
          }),
          stopped,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (stop) break;
      try { await renew(db, lease, { leaseMs: 240_000 }); }
      catch (error) {
        leaseError = error;
        heartbeatAborter.abort(error);
        break;
      }
    }
  })();
  try {
    const result = await task(heartbeatAborter.signal);
    if (leaseError) throw leaseError;
    return result;
  } finally {
    stop = true;
    wake();
    await heartbeat;
  }
}

export async function runSourceErasureSweep(options) {
  const db = options?.db;
  if (typeof db !== "function") throw new Error("source erasure database required");
  const cleanup = options.cleanup || markAbandonedPendingSourceUploads;
  const lease = options.lease || leaseNextSourceErasure;
  const removeObjects = options.removeObjects || ((paths, source, signal) =>
    deleteReplicaSourceObjects(source, paths, undefined, { signal }));
  const renew = options.renew || renewSourceErasureLease;
  const complete = options.complete || completeSourceErasure;
  const retry = options.retry || retrySourceErasure;
  const maxJobs = Math.max(1, Math.min(4, Number(options.maxJobs || 2)));
  const timeBudgetMs = Math.max(10_000, Math.min(240_000, Number(options.timeBudgetMs || 120_000)));
  const started = Date.now();
  const abandoned = await cleanup(db, {
    staleAfterMs: options.staleUploadAfterMs,
    batchSize: options.cleanupBatchSize,
  });
  const summary = { abandoned: abandoned.length, leased: 0, completed: 0, retried: 0 };
  while (summary.leased < maxJobs && Date.now() - started < timeBudgetMs) {
    const claimed = await lease(db, { leaseMs: 240_000 });
    if (!claimed) break;
    summary.leased += 1;
    try {
      await withSourceErasureLeaseHeartbeat(db, claimed, renew,
        (signal) => removeObjects(claimed.source.paths, claimed.source, signal),
        { heartbeatMs: options.heartbeatMs });
      await complete(db, claimed);
      summary.completed += 1;
    } catch (error) {
      await retry(db, claimed, { error, retryAfterMs: sourceErasureRetryDelayMs(claimed.source.attempt) });
      summary.retried += 1;
    }
  }
  return Object.freeze(summary);
}
