import { timingSafeEqual } from "node:crypto";

// The processing worker and the model-build sweep already own their leases.
// This module never leases, retries or settles work. It only answers the one
// operational question those workers cannot answer about themselves: is due
// work moving at all?

export const PIPELINE_STALE_MS = 15 * 60 * 1_000;

// These are the complete waiting reasons written by advanceOwnedVoiceBuildIntent
// when progress depends on the owner or on upstream source/evidence preparation.
// A due waiting row containing only these reasons is not runnable server work.
// Empty, errored or novel reasons remain observable so contract drift cannot
// silently turn a dead reconciler into a healthy report.
export const VOICE_BUILD_INTENT_DEFERRED_BLOCKERS = Object.freeze([
  "candidate_source_processing",
  "adult_age_verification_required",
  "identity_verification_required",
  "liveness_verification_required",
  "biometric_consent_required",
  "training_consent_required",
  "inference_consent_required",
  "two_independent_embedding_families_required",
  "reviewed_voice_measurement_required",
  "reviewed_quality_measurement_required",
  "reviewed_speaker_segment_required",
  "owner_selected_voice_candidate_required",
]);

function boundedMilliseconds(value, fallback = PIPELINE_STALE_MS) {
  const number = value == null || value === "" ? fallback : Number(value);
  return Number.isInteger(number) && number >= 10 * 60 * 1_000 && number <= 60 * 60 * 1_000
    ? number
    : fallback;
}

function nonNegative(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function ageMs(nowMs, value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, nowMs - timestamp) : null;
}

export function authorizedPipelineWatchdog(req, env = process.env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

function lane(name, row, nowMs, staleMs) {
  const due = nonNegative(row?.[`${name}_due`]);
  const liveLeases = nonNegative(row?.[`${name}_live_leases`]);
  const lastTransitionAgeMs = ageMs(nowMs, row?.[`${name}_last_transition_at`]);
  const stalled = due > 0 && liveLeases === 0
    && lastTransitionAgeMs != null && lastTransitionAgeMs >= staleMs;
  return Object.freeze({
    due,
    live_leases: liveLeases,
    last_transition_age_ms: lastTransitionAgeMs,
    stalled,
  });
}

/**
 * Return content-free queue liveness for the three stages a recording crosses.
 *
 * "Due" includes an expired lease because the existing lease functions are
 * already designed to reclaim it. A non-expired lease suppresses a stall even
 * when it has been running for a long time: long transcription and
 * diarization are legitimate, and the watchdog must never create a second
 * worker or label them failed. A queued backlog also stays healthy while any
 * transition is recent, so four-job bounded executions do not page merely
 * because the fifth item is waiting its turn.
 */
export async function inspectReplicaPipeline(db, options = {}) {
  if (typeof db !== "function") throw new Error("replica_pipeline_watchdog_db_required");
  const nowMs = Number(options.nowMs ?? Date.now());
  const staleMs = boundedMilliseconds(options.staleMs);
  const rows = await db(
    `with processing_live as materialized (
       select j.job_id,j.source_id,j.replica_id,j.owner_user_id,j.revision,
              j.state,j.next_attempt_at,j.lease_expires_at,j.updated_at
         from vy_replica_processing_job j
         join vy_replica_source s
           on s.source_id=j.source_id and s.replica_id=j.replica_id
          and s.owner_user_id=j.owner_user_id
        where s.state in ('quarantined','processing')
          and not exists (
            select 1 from vy_replica_processing_job terminal
             where terminal.source_id=j.source_id and terminal.replica_id=j.replica_id
               and terminal.owner_user_id=j.owner_user_id and terminal.revision=j.revision
               and terminal.state in ('failed','blocked')
          )
     ), processing_orphans as (
       select count(*)::int as orphan_due,max(s.updated_at) as orphan_last_transition_at
         from vy_replica_source s
        where s.kind in ('audio','video') and s.state in ('quarantined','processing')
          and not exists (
            select 1 from vy_replica_processing_job j
             where j.source_id=s.source_id and j.replica_id=s.replica_id
               and j.owner_user_id=s.owner_user_id
          )
     ), processing as (
       select (count(*) filter (where
                (state in ('queued','retry') and next_attempt_at<=now())
             or (state='leased' and lease_expires_at<=now())) + orphan_due)::int as processing_due,
              count(*) filter (where state='leased' and lease_expires_at>now())::int
                as processing_live_leases,
              greatest(max(updated_at),orphan_last_transition_at) as processing_last_transition_at
         from processing_live cross join processing_orphans
        group by orphan_due,orphan_last_transition_at
     ), model_build as (
       select count(*) filter (where
                (state in ('queued','retry') and next_attempt_at<=now())
             or (state in ('leased','building') and lease_expires_at<=now()))::int as model_build_due,
              count(*) filter (where state in ('leased','building') and lease_expires_at>now())::int
                as model_build_live_leases,
              max(updated_at) as model_build_last_transition_at
         from vy_replica_model_build
        where build_kind='voice_genome' and state in ('queued','retry','leased','building')
     ), voice_build_intent_open as materialized (
       select i.state intent_state,i.blockers,i.last_error_code,i.updated_at intent_updated_at,
              b.state build_state,b.next_attempt_at build_next_attempt_at,
              b.lease_expires_at build_lease_expires_at,b.updated_at build_updated_at
         from vy_replica_voice_build_intent i
         join vy_replica r on r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
         left join vy_replica_model_build b on b.build_id=i.build_id
          and b.replica_id=i.replica_id and b.owner_user_id=i.owner_user_id
        where i.state in ('waiting','queued') and i.next_check_at<=now()
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
     ), voice_build_intent_actionable as materialized (
       select greatest(intent_updated_at,build_updated_at) last_transition_at
         from voice_build_intent_open
        where (intent_state='waiting' and (
                 last_error_code<>'' or cardinality(blockers)=0 or not (blockers <@ $1::text[])
              ))
           or (intent_state='queued' and (
                 build_state is null
                 or build_state in ('review','approved','failed','retired')
                 or (build_state in ('queued','retry') and build_next_attempt_at<=now())
                 or (build_state in ('leased','building')
                     and (build_lease_expires_at is null or build_lease_expires_at<=now()))
                 or build_state not in (
                      'queued','retry','leased','building','review','approved','failed','retired'
                    )
              ))
     ), voice_build_intent as (
       select count(*)::int as voice_build_intent_due,
              0::int as voice_build_intent_live_leases,
              max(last_transition_at) as voice_build_intent_last_transition_at
         from voice_build_intent_actionable
     )
     select processing_due,processing_live_leases,processing_last_transition_at,
            model_build_due,model_build_live_leases,model_build_last_transition_at,
            voice_build_intent_due,voice_build_intent_live_leases,
            voice_build_intent_last_transition_at
       from processing cross join model_build cross join voice_build_intent`,
    [VOICE_BUILD_INTENT_DEFERRED_BLOCKERS],
    30_000,
  );
  const row = rows[0] || {};
  const processing = lane("processing", row, nowMs, staleMs);
  const modelBuild = lane("model_build", row, nowMs, staleMs);
  const voiceBuildIntent = lane("voice_build_intent", row, nowMs, staleMs);
  const stalledLanes = Object.freeze([
    ...(processing.stalled ? ["processing"] : []),
    ...(modelBuild.stalled ? ["model_build"] : []),
    ...(voiceBuildIntent.stalled ? ["voice_build_intent"] : []),
  ]);
  return Object.freeze({
    ok: stalledLanes.length === 0,
    status: stalledLanes.length ? "stalled" : "healthy",
    stale_after_ms: staleMs,
    stalled_lanes: stalledLanes,
    lanes: Object.freeze({
      processing,
      model_build: modelBuild,
      voice_build_intent: voiceBuildIntent,
    }),
  });
}

/** A response safe for cron logs and alerts. No owner, replica, source or job
 * identifier, and no timestamps from which user activity can be reconstructed. */
export function publicPipelineWatchdogReport(report) {
  const cleanLane = (value) => Object.freeze({
    due: nonNegative(value?.due),
    live_leases: nonNegative(value?.live_leases),
    stalled: value?.stalled === true,
  });
  return Object.freeze({
    ok: report?.ok === true,
    status: report?.status === "healthy" ? "healthy" : "stalled",
    stalled_lanes: Object.freeze([...(report?.stalled_lanes || [])]
      .filter((name) => name === "processing" || name === "model_build"
        || name === "voice_build_intent")),
    lanes: Object.freeze({
      processing: cleanLane(report?.lanes?.processing),
      model_build: cleanLane(report?.lanes?.model_build),
      voice_build_intent: cleanLane(report?.lanes?.voice_build_intent),
    }),
  });
}
