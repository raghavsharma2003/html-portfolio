import { clientIntentId, replicaId } from "./_replica.js";
import { queueOwnedVoiceGenome } from "./_replica-review.js";
import { primarySelectionQuery } from "./_replica-primary-selection.js";

const INTENT_RETURNING = `intent_id,replica_id,owner_user_id,candidate_source_id,state,build_id,
  blockers,last_error_code,promoted_at,next_check_at,created_at,updated_at,expected_primary_selection_id`;
const INTENT_SELECT = `i.intent_id,i.replica_id,i.owner_user_id,i.candidate_source_id,i.state,i.build_id,
  i.blockers,i.last_error_code,i.promoted_at,i.next_check_at,i.created_at,i.updated_at,i.expected_primary_selection_id`;
const INTENT_UPDATE_RETURNING = `i.intent_id,i.replica_id,i.owner_user_id,i.candidate_source_id,
  i.state,i.build_id,i.blockers,i.last_error_code,i.promoted_at,i.next_check_at,i.created_at,i.updated_at,i.expected_primary_selection_id`;

function safeCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 96))
    .filter((value) => /^[a-z0-9_]{1,96}$/.test(value)))]
    .slice(0, 16);
}

function safeErrorCode(value, fallback = "voice_genome_build_failed") {
  const code = String(value || fallback).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 96);
  return /^[a-z0-9_]{1,96}$/.test(code) ? code : fallback;
}

function stateForBuild(buildState) {
  if (["review", "approved"].includes(buildState)) return "review";
  if (["failed", "retired"].includes(buildState)) return "failed";
  return "queued";
}

export function clientVoiceBuildIntent(row) {
  if (!row) return null;
  return Object.freeze({
    intent_id: row.intent_id,
    replica_id: row.replica_id,
    candidate_source_id: row.candidate_source_id,
    state: row.state,
    build_id: row.build_id || null,
    build_state: row.build_state || null,
    target_version: row.target_version == null ? null : Number(row.target_version),
    blockers: safeCodes(row.blockers),
    last_error_code: String(row.last_error_code || ""),
    promoted_at: row.promoted_at || null,
    next_check_at: row.next_check_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export async function getOwnedVoiceBuildIntent(db, ownerUserId, value) {
  const rid = replicaId(value.replica_id);
  const intentId = clientIntentId(value.build_intent_id, "valid_build_intent_id_required");
  const rows = await db(
    `select ${INTENT_SELECT},b.state build_state,b.target_version,b.failure_code,
            i.expected_primary_selection_id is distinct from r.primary_selection_id primary_selection_changed,
            s.state candidate_state,s.kind candidate_kind,s.capture_mode candidate_capture_mode,
            s.contains_third_parties candidate_contains_third_parties
       from vy_replica_voice_build_intent i
       join vy_replica r on r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
       join vy_replica_source s on s.source_id=i.candidate_source_id and s.replica_id=i.replica_id
        and s.owner_user_id=i.owner_user_id
       left join vy_replica_model_build b on b.build_id=i.build_id and b.replica_id=i.replica_id
        and b.owner_user_id=i.owner_user_id
      where i.intent_id=$3::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
        and r.lifecycle not in ('revoked','purging')
      limit 1`,
    [rid, ownerUserId, intentId],
  );
  return rows[0] || null;
}

async function createOwnedVoiceBuildIntent(db, ownerUserId, value) {
  const rid = replicaId(value.replica_id);
  const intentId = clientIntentId(value.build_intent_id, "valid_build_intent_id_required");
  const candidateSourceId = replicaId(value.candidate_source_id);
  const rows = await primarySelectionQuery(db,
    `with source_lock as materialized (
       select s.* from vy_replica_source s
        where s.source_id=$4::uuid and s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
        for update of s nowait
     ), owned as materialized (
       select r.replica_id,r.owner_user_id,r.policy_version,r.primary_selection_id
         from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.lifecycle not in ('revoked','purging')
          and exists (select 1 from source_lock)
        for update of r nowait
     ), candidate as (
       select s.source_id,s.replica_id,s.owner_user_id,o.primary_selection_id
         from source_lock s join owned o on o.replica_id=s.replica_id
          and o.owner_user_id=s.owner_user_id
        where s.source_id=$4::uuid and s.kind in ('audio','video')
          and s.capture_mode in ('upload','import','derived') and s.purpose<>'comparison_reference'
          and s.state in ('quarantined','processing','ready') and s.contains_third_parties=false
          and not (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
     ), inserted as (
       insert into vy_replica_voice_build_intent
         (intent_id,replica_id,owner_user_id,candidate_source_id,state,expected_primary_selection_id)
       select $3::uuid,replica_id,owner_user_id,source_id,'waiting',primary_selection_id from candidate
       on conflict (intent_id) do nothing
       returning ${INTENT_RETURNING},false intent_replayed
     ), superseded as (
       update vy_replica_voice_build_intent prior
          set state='failed',blockers='{}'::text[],last_error_code='superseded_by_new_build_intent',
              promoted_at=null,updated_at=now()
         from inserted fresh
        where prior.replica_id=fresh.replica_id and prior.owner_user_id=fresh.owner_user_id
          and prior.intent_id<>fresh.intent_id and prior.state in ('waiting','queued')
     ), replay as (
       select ${INTENT_SELECT},true intent_replayed
         from vy_replica_voice_build_intent i join owned o on o.replica_id=i.replica_id
          and o.owner_user_id=i.owner_user_id
        where i.intent_id=$3::uuid and i.candidate_source_id=$4::uuid
          and not exists (select 1 from inserted)
     ), resolved as (
       select * from inserted union all select * from replay
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_genome.build_intent.request','voice_build_intent',
              intent_id::text,(select policy_version from owned),'allowed','{}'::jsonb
         from inserted
     ) select * from resolved`,
    [rid, ownerUserId, intentId, candidateSourceId],
  );
  if (rows[0]) return rows[0];
  const owned = await db(
    `select r.replica_id,s.source_id,s.kind,s.capture_mode,s.state,s.contains_third_parties,
            s.provenance->>'purpose' purpose
       from vy_replica r left join vy_replica_source s on s.replica_id=r.replica_id
        and s.owner_user_id=r.owner_user_id and s.source_id=$3::uuid
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
        and r.lifecycle not in ('revoked','purging')`,
    [rid, ownerUserId, candidateSourceId],
  );
  if (!owned[0]) return null;
  if (!owned[0].source_id) {
    throw Object.assign(new Error("candidate_source_not_found"), { status: 404, code: "candidate_source_not_found" });
  }
  const stageable = ["audio", "video"].includes(String(owned[0].kind))
    && ["upload", "import", "derived"].includes(String(owned[0].capture_mode))
    && ["quarantined", "processing", "ready"].includes(String(owned[0].state))
    && owned[0].contains_third_parties !== true
    && !(owned[0].capture_mode === "derived" && owned[0].purpose === "mirror_window");
  if (!stageable) {
    throw Object.assign(new Error("candidate_source_not_stageable"), { status: 409, code: "candidate_source_not_stageable" });
  }
  throw Object.assign(new Error("build_intent_conflict"), { status: 409, code: "build_intent_conflict" });
}

async function settleWaiting(db, ownerUserId, rid, intentId, blockers, lastErrorCode = "") {
  const rows = await db(
    `update vy_replica_voice_build_intent
        set state='waiting',build_id=null,blockers=$4::text[],last_error_code=$5,
            promoted_at=null,next_check_at=now()+interval '30 seconds',updated_at=now()
      where intent_id=$3::uuid and replica_id=$1::uuid and owner_user_id=$2::uuid
        and state='waiting' and build_id is null
      returning ${INTENT_RETURNING}`,
    [rid, ownerUserId, intentId, safeCodes(blockers), lastErrorCode ? safeErrorCode(lastErrorCode) : ""],
  );
  return rows[0] || getOwnedVoiceBuildIntent(db, ownerUserId, {
    replica_id: rid,
    build_intent_id: intentId,
  });
}

async function settleFailed(db, ownerUserId, rid, intentId, errorCode) {
  const rows = await db(
    `update vy_replica_voice_build_intent
        set state='failed',blockers='{}'::text[],last_error_code=$4,promoted_at=null,updated_at=now()
      where intent_id=$3::uuid and replica_id=$1::uuid and owner_user_id=$2::uuid
        and state in ('waiting','queued')
      returning ${INTENT_RETURNING}`,
    [rid, ownerUserId, intentId, safeErrorCode(errorCode)],
  );
  return rows[0] || getOwnedVoiceBuildIntent(db, ownerUserId, {
    replica_id: rid,
    build_intent_id: intentId,
  });
}

async function bindBuild(db, ownerUserId, rid, intentId, build) {
  const rows = await db(
    `with updated as (
       update vy_replica_voice_build_intent i
          set state='queued',build_id=$4::uuid,blockers='{}'::text[],last_error_code='',
              promoted_at=null,next_check_at=now()+interval '30 seconds',updated_at=now()
        where i.intent_id=$3::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
          and i.state='waiting' and i.build_id is null
       returning ${INTENT_UPDATE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice_genome.build_intent.queue','voice_build_intent',
              intent_id::text,(select policy_version from vy_replica
                where replica_id=$1::uuid and owner_user_id=$2::uuid),
              'allowed',jsonb_build_object('build_id',$4::uuid) from updated
        where not exists (
          select 1 from vy_replica_audit a where a.replica_id=$1::uuid and a.owner_user_id=$2::uuid
            and a.action='voice_genome.build_intent.queue' and a.object_id=$3::text
        )
     ) select * from updated`,
    [rid, ownerUserId, intentId, build.build_id],
  );
  return rows[0] || getOwnedVoiceBuildIntent(db, ownerUserId, {
    replica_id: rid,
    build_intent_id: intentId,
  });
}

async function promoteCandidate(db, ownerUserId, row) {
  const rows = await primarySelectionQuery(db,
    `with source_lock as materialized (
       select s.* from vy_replica_source s
        join vy_replica_voice_build_intent i on i.candidate_source_id=s.source_id
         and i.replica_id=s.replica_id and i.owner_user_id=s.owner_user_id
        where i.intent_id=$3::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
        for update of s nowait
     ), owned as materialized (
       select r.* from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and exists (select 1 from source_lock)
        for update of r nowait
     ), intent_lock as materialized (
       select i.* from vy_replica_voice_build_intent i
        where i.intent_id=$3::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
          and exists (select 1 from owned)
        for update of i nowait
     ), target as materialized (
       select i.intent_id,i.replica_id,i.owner_user_id,i.candidate_source_id,i.build_id,
              b.target_version,b.source_set_hash,r.policy_version,vr.source_id previous_source_id
         from intent_lock i
         join owned r on r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
         join source_lock s on s.source_id=i.candidate_source_id and s.replica_id=i.replica_id
          and s.owner_user_id=i.owner_user_id
         join vy_replica_model_build b on b.build_id=i.build_id and b.replica_id=i.replica_id
          and b.owner_user_id=i.owner_user_id
         join vy_replica_voice_genome g on g.replica_id=b.replica_id and g.version=b.target_version
          and g.source_set_hash=b.source_set_hash
         left join vy_replica_voice_reference vr on vr.replica_id=i.replica_id
          and vr.owner_user_id=i.owner_user_id
        where i.intent_id=$3::uuid and i.replica_id=$1::uuid and i.owner_user_id=$2::uuid
          and i.state='queued' and i.promoted_at is null and b.state in ('review','approved')
          and g.status in ('draft','approved')
          and (g.definition#>'{references,source_ids}') ? i.candidate_source_id::text
          and s.state='ready' and s.kind in ('audio','video')
          and s.capture_mode in ('upload','import','derived') and s.purpose<>'comparison_reference' and s.contains_third_parties=false
          and not (s.capture_mode='derived' and s.provenance->>'purpose'='mirror_window')
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and i.expected_primary_selection_id=r.primary_selection_id
          and not exists (
            select 1 from vy_replica_voice_build_intent newer
             where newer.replica_id=i.replica_id and newer.owner_user_id=i.owner_user_id
               and newer.state in ('waiting','queued') and newer.intent_id<>i.intent_id
               and (newer.created_at,newer.intent_id)>(i.created_at,i.intent_id)
          )
     ), epoch as (
       update vy_replica r set primary_selection_id=gen_random_uuid()
         from target t where r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
       returning r.replica_id
     ), selected as (
       insert into vy_replica_voice_reference(replica_id,owner_user_id,source_id,selected_at)
       select replica_id,owner_user_id,candidate_source_id,now() from target
        where exists (select 1 from epoch)
       on conflict (replica_id) do update
         set owner_user_id=excluded.owner_user_id,source_id=excluded.source_id,selected_at=excluded.selected_at
       returning replica_id,owner_user_id,source_id
     ), updated as (
       update vy_replica_voice_build_intent i
          set state='review',blockers='{}'::text[],last_error_code='',promoted_at=now(),updated_at=now()
         from target t
        where i.intent_id=t.intent_id and exists (
          select 1 from selected s where s.replica_id=t.replica_id
            and s.owner_user_id=t.owner_user_id and s.source_id=t.candidate_source_id
        )
       returning ${INTENT_UPDATE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select t.replica_id,t.owner_user_id,'source.primary_voice.promote_after_build','source',
              t.candidate_source_id::text,t.policy_version,'allowed',
              jsonb_build_object('build_id',t.build_id,'previous_source_id',t.previous_source_id)
         from target t join updated u on u.intent_id=t.intent_id
     ) select * from updated`,
    [row.replica_id, ownerUserId, row.intent_id],
  );
  if (rows[0]) {
    return getOwnedVoiceBuildIntent(db, ownerUserId, {
      replica_id: row.replica_id,
      build_intent_id: row.intent_id,
    });
  }
  const current = await getOwnedVoiceBuildIntent(db, ownerUserId, {
    replica_id: row.replica_id,
    build_intent_id: row.intent_id,
  });
  if (!current || ["review", "failed"].includes(current.state)) return current;
  return settleFailed(db, ownerUserId, row.replica_id, row.intent_id,
    current.expected_primary_selection_id == null
      ? "primary_selection_snapshot_missing"
      : current.primary_selection_changed ? "primary_voice_selection_changed" : "candidate_promotion_denied");
}

async function refreshBoundIntent(db, ownerUserId, row) {
  const state = stateForBuild(String(row.build_state || "queued"));
  if (state === "review") return promoteCandidate(db, ownerUserId, row);
  if (state === "failed") {
    return settleFailed(db, ownerUserId, row.replica_id, row.intent_id,
      row.failure_code || "voice_genome_build_failed");
  }
  if (row.state === "queued") return row;
  const rows = await db(
    `update vy_replica_voice_build_intent
        set state='queued',blockers='{}'::text[],last_error_code='',promoted_at=null,
            next_check_at=now()+interval '30 seconds',updated_at=now()
      where intent_id=$3::uuid and replica_id=$1::uuid and owner_user_id=$2::uuid
        and build_id is not null and state='waiting'
      returning ${INTENT_RETURNING}`,
    [row.replica_id, ownerUserId, row.intent_id],
  );
  return rows[0] || row;
}

export async function advanceOwnedVoiceBuildIntent(db, ownerUserId, value, options = {}) {
  const rid = replicaId(value.replica_id);
  const intentId = clientIntentId(value.build_intent_id, "valid_build_intent_id_required");
  const current = await getOwnedVoiceBuildIntent(db, ownerUserId, {
    replica_id: rid,
    build_intent_id: intentId,
  });
  if (!current) return null;
  if (["review", "failed"].includes(current.state)) return clientVoiceBuildIntent(current);
  if (current.expected_primary_selection_id == null) {
    return clientVoiceBuildIntent(await settleFailed(
      db, ownerUserId, rid, intentId, "primary_selection_snapshot_missing",
    ));
  }
  if (current.candidate_contains_third_parties === true
    || ["rejected", "deleting"].includes(String(current.candidate_state))) {
    return clientVoiceBuildIntent(await settleFailed(
      db, ownerUserId, rid, intentId, "candidate_source_unavailable",
    ));
  }
  if (String(current.candidate_state) !== "ready") {
    if (current.build_id) {
      return clientVoiceBuildIntent(await settleFailed(
        db, ownerUserId, rid, intentId, "candidate_source_no_longer_ready",
      ));
    }
    return clientVoiceBuildIntent(await settleWaiting(
      db, ownerUserId, rid, intentId, ["candidate_source_processing"],
    ));
  }
  if (current.build_id) return clientVoiceBuildIntent(await refreshBoundIntent(db, ownerUserId, current));

  const queue = options.queue || queueOwnedVoiceGenome;
  try {
    const build = await queue(db, ownerUserId, {
      replica_id: rid,
      candidate_source_id: current.candidate_source_id,
    });
    if (!build) return null;
    await bindBuild(db, ownerUserId, rid, intentId, build);
    const bound = await getOwnedVoiceBuildIntent(db, ownerUserId, {
      replica_id: rid,
      build_intent_id: intentId,
    });
    if (!bound) return null;
    if (["review", "failed"].includes(bound.state)) return clientVoiceBuildIntent(bound);
    return clientVoiceBuildIntent(await refreshBoundIntent(db, ownerUserId, bound));
  } catch (error) {
    // Keep a bound queued intent intact so the reconciler can retry promotion.
    if (error?.code === "primary_voice_selection_busy") throw error;
    if (error?.message === "voice_genome_not_ready") {
      const waiting = await settleWaiting(db, ownerUserId, rid, intentId, error?.details?.blockers || []);
      return clientVoiceBuildIntent(waiting);
    }
    if (Number(error?.status) === 409) {
      const waiting = await settleWaiting(db, ownerUserId, rid, intentId, [],
        safeErrorCode(error?.code || error?.message, "voice_genome_build_waiting"));
      return clientVoiceBuildIntent(waiting);
    }
    throw error;
  }
}

export async function requestOwnedVoiceGenomeBuild(db, ownerUserId, value, options = {}) {
  const created = await createOwnedVoiceBuildIntent(db, ownerUserId, value);
  if (!created) return null;
  const intent = await advanceOwnedVoiceBuildIntent(db, ownerUserId, value, options);
  return intent ? Object.freeze({ ...intent, replayed: Boolean(created.intent_replayed) }) : null;
}

export async function reconcileVoiceBuildIntents(db, options = {}) {
  const limit = Math.max(1, Math.min(50, Number(options.limit || 12)));
  const rows = await db(
    `select i.intent_id,i.replica_id,i.owner_user_id
       from vy_replica_voice_build_intent i
       join vy_replica r on r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
      where i.state in ('waiting','queued') and i.next_check_at<=now()
        and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
      order by i.next_check_at,i.created_at limit $1::int4`,
    [limit],
  );
  const summary = { examined: rows.length, waiting: 0, queued: 0, review: 0, failed: 0 };
  for (const row of rows) {
    try {
      const intent = await advanceOwnedVoiceBuildIntent(db, row.owner_user_id, {
        replica_id: row.replica_id,
        build_intent_id: row.intent_id,
      }, options);
      if (intent && Object.hasOwn(summary, intent.state)) summary[intent.state]++;
    } catch {
      summary.waiting++;
    }
  }
  return Object.freeze(summary);
}
