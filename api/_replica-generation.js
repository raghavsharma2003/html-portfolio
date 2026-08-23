// Atomic owner/replica generation authorization. The insert is the fence:
// inactive or revoked capabilities cannot obtain an operational generation id.
import { PROVENANCE_POLICY, REQUIRED_QUALIFICATION_SUITES, assertGenerationAuthorization } from "./_provenance/contracts.js";
import { loadOwnedRuntimeContext } from "./_replica-runtime.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

const CHANNELS = new Set(["studio_preview", "private_chat", "private_call"]);
const PURPOSES = new Set(["calibration", "private_conversation"]);
const TRACE = /^[A-Za-z0-9_-]{8,96}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

export async function beginOwnedPrivateGeneration(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const channel = String(input?.channel || "");
  const purpose = String(input?.purpose || "");
  const traceId = String(input?.trace_id || "");
  if (!CHANNELS.has(channel)) fail("generation_channel_not_allowed", 400);
  if (!PURPOSES.has(purpose)) fail("generation_purpose_not_allowed", 400);
  if (!TRACE.test(traceId)) fail("valid_trace_id_required", 400);
  const dialogueTurnId = input?.dialogue_turn_id == null ? null : String(input.dialogue_turn_id).toLowerCase();
  if (dialogueTurnId !== null && !UUID.test(dialogueTurnId)) fail("valid_dialogue_turn_id_required", 400);
  if (purpose === "private_conversation" && !dialogueTurnId) fail("dialogue_turn_required", 400);
  if (purpose === "calibration" && dialogueTurnId) fail("dialogue_turn_not_allowed", 400);
  if (purpose === "calibration" && channel !== "studio_preview") fail("calibration_channel_required", 400);
  if (purpose === "private_conversation" && channel === "studio_preview") fail("private_channel_required", 400);

  const rows = await db(
    `insert into vy_replica_generation
       (replica_id,owner_user_id,voice_profile_id,genome_version,profile_version,calibration_version,dialogue_turn_id,
        channel,purpose,policy_version,trace_id,state,disclosure_scheme,watermark_algorithm,provenance_standard)
     select r.replica_id,r.owner_user_id,c.voice_profile_id,c.genome_version,c.profile_version,c.calibration_version,
            dialogue.turn_id,$3,$4,$5,$6,'authorized','audible-prefix-v1','pending','c2pa-2.4'
       from vy_replica r
       join vy_replica_runtime_capability c
         on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
        and c.agent_id=r.agent_id and c.subject_person_id=r.subject_person_id
        and c.state='active'
       join vy_agent a on a.agent_id=c.agent_id and a.status='active'
       join vy_person p on p.person_id=c.subject_person_id and p.age_tier='adult_verified'
       join vy_replica_voice_profile vp
         on vp.voice_profile_id=c.voice_profile_id and vp.replica_id=c.replica_id
        and vp.genome_version=c.genome_version and vp.status='ready'
       join vy_replica_calibration cal
         on cal.replica_id=c.replica_id and cal.owner_user_id=c.owner_user_id
        and cal.version=c.calibration_version and cal.profile_version=c.profile_version and cal.status='approved'
       left join vy_replica_dialogue_turn dialogue
         on dialogue.turn_id=$8::uuid and dialogue.replica_id=r.replica_id and dialogue.owner_user_id=r.owner_user_id
        and dialogue.capability_id=c.capability_id and dialogue.profile_version=c.profile_version
        and dialogue.calibration_version=c.calibration_version and dialogue.state='complete'
      where r.replica_id=$1 and r.owner_user_id=$2 and r.subject_mode='self'
        and r.lifecycle='active' and r.policy_version=$7
        and r.age_verified_at is not null and r.identity_verified_at is not null
        and r.liveness_verified_at is not null
        and exists(select 1 from vy_replica_consent x
          where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
            and x.scope='inference' and x.policy_version=$7 and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
        and (($4='calibration' and $8::uuid is null) or
             ($4='private_conversation' and dialogue.turn_id is not null))
     returning generation_id,replica_id,owner_user_id,voice_profile_id,genome_version,
               profile_version,calibration_version,dialogue_turn_id,channel,purpose,policy_version,trace_id,state`,
    [rid, ownerUserId, channel, purpose, PROVENANCE_POLICY, traceId, REPLICA_POLICY_VERSION, dialogueTurnId],
  );
  const generation = rows[0];
  if (!generation) fail("generation_not_authorized");
  const runtime = await loadOwnedRuntimeContext(db, ownerUserId, rid);
  if (!runtime || runtime.voiceProfile.voice_profile_id !== generation.voice_profile_id ||
      runtime.voiceGenome.version !== Number(generation.genome_version) ||
      runtime.personProfile.version !== Number(generation.profile_version) ||
      runtime.calibration.version !== Number(generation.calibration_version)) {
    await markGenerationFailed(db, ownerUserId, generation.generation_id, "runtime_changed_during_authorization");
    fail("runtime_changed_during_authorization");
  }
  const authorizationInput = {
    request: {
      generationId: generation.generation_id,
      replicaId: generation.replica_id,
      ownerUserId: generation.owner_user_id,
      channel: generation.channel,
      purpose: generation.purpose,
      policyVersion: generation.policy_version,
      traceId: generation.trace_id,
    },
    replica: runtime.replica,
    inferenceConsent: runtime.inferenceConsent,
    voiceProfile: runtime.voiceProfile,
    voiceGenome: runtime.voiceGenome,
    personProfile: runtime.personProfile,
    calibration: runtime.calibration,
    qualification: { verdict: "pass", passedSuites: [...REQUIRED_QUALIFICATION_SUITES] },
  };
  const authorization = assertGenerationAuthorization(authorizationInput);
  return { generation, runtime, authorizationInput, authorization };
}

export async function markGenerationFailed(db, ownerUserId, generationId, code) {
  const failure = String(code || "generation_failed").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
  await db(
    `update vy_replica_generation
        set state=case when state='sealed' then state else 'failed' end,
            failure_code=case when state='sealed' then failure_code else $3 end,
            updated_at=now()
      where generation_id=$1 and owner_user_id=$2`,
    [generationId, ownerUserId, failure],
  ).catch(() => []);
}
