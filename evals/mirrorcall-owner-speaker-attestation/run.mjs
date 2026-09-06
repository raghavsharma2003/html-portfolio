import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIRROR_OWNER_SPEAKER_ATTESTATION,
  attestMirrorOwnerSpeaker,
  createMirrorOwnerSpeakerEvidence,
  mirrorOwnerSpeakerAttestationStatus,
} from "../../api/_mirrorcall-speaker-attestation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WINDOW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let checks = 0;
let failed = 0;
function ok(condition, label) {
  checks += 1;
  if (condition) return;
  failed += 1;
  console.error(`FAIL ${label}`);
}

const windows = [{
  window_id: WINDOW,
  session_id: SESSION,
  replica_id: REPLICA,
  source_id: SOURCE,
  seq: 1,
  duration_ms: 12_000,
  input_sha256: "a".repeat(64),
}];
const first = createMirrorOwnerSpeakerEvidence(windows, {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sessionId: SESSION,
});
const replay = createMirrorOwnerSpeakerEvidence(windows, {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sessionId: SESSION,
});
ok(JSON.stringify(first) === JSON.stringify(replay), "evidence and decision identifiers are deterministic across retries");
const rejectedEvidence = createMirrorOwnerSpeakerEvidence(windows, {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sessionId: SESSION,
  decision: "rejected",
});
ok(first[0].evidence_id === rejectedEvidence[0].evidence_id
  && first[0].decision_id === rejectedEvidence[0].decision_id,
"opposite tabs contend on one deterministic evidence and decision identity, so only one choice can win");
ok(first[0].evidence_type === "speaker_segment", "the fallback creates only speaker segment evidence");
ok(first[0].adapter.family === "human_annotation" && first[0].adapter.name === "owner_speaker_attestation",
  "the evidence is named as a human annotation, not a biometric measurement");
ok(first[0].value.epistemic_status === "attested" && first[0].value.target_likelihood === 1,
  "the owner statement is explicitly attested and clears the existing claim-speaker floor");
ok(first[0].value.provenance.excludes_clone_playback === true,
  "the canonical value records that generated clone playback is outside the statement");
ok(first[0].span.end_ms === 12_000 && first[0].source_id === SOURCE,
  "the annotation is bound to the exact immutable microphone window");

let writeSql = "";
let writeParams = [];
let calls = 0;
const successDb = async (sql, params) => {
  calls += 1;
  if (/select distinct w\.window_id,w\.session_id/.test(sql)) return windows;
  writeSql = sql;
  writeParams = params;
  return [{
    eligible_windows: 1,
    attested_windows: 1,
    newly_attested_windows: 1,
    claim_job_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    claim_job_state: "queued",
    next_attempt_at: "2026-08-30T12:00:00.000Z",
  }];
};
const saved = await attestMirrorOwnerSpeaker(successDb, OWNER, {
  session_id: SESSION,
  choice: "only_me",
});
ok(calls === 2, "the action performs one immutable read and one atomic mutating statement");
ok(saved.state === "attested" && saved.queued === true && saved.attested_windows === 1,
  "the response confirms the attestation and nearline wakeup without claiming extraction finished");
ok(/ms\.state='ended'/.test(writeSql), "only an ended Mirror session can be attested");
ok(/ms\.session_id=\$1::uuid and ms\.replica_id=\$2::uuid\s+and ms\.owner_user_id=\$3::uuid/.test(writeSql),
  "the write binds exact session, replica and authenticated owner in SQL");
ok(/ms\.consent_scopes @> array\['capture','storage','transcription'\]::text\[\]/.test(writeSql),
  "the session must have captured the three recording scopes at call time");
ok(/unnest\(\$5::text\[\]\)[\s\S]*c\.scope=required\.scope[\s\S]*c\.policy_version=r\.policy_version[\s\S]*c\.revoked_at is null/.test(writeSql),
  "capture, storage, transcription and training are rechecked live under the current policy");
ok(JSON.stringify(writeParams[4]) === JSON.stringify(["capture", "storage", "transcription", "training"]),
  "the live consent parameter contains exactly the four required scopes");
ok(/src\.capture_mode='derived'[\s\S]*src\.provenance->>'purpose'='mirror_window'/.test(writeSql),
  "only derived mirror window sources are eligible");
ok(/w\.asr_state='transcribed'[\s\S]*evidence_type='transcript_span'/.test(writeSql),
  "an attestation cannot cover an untranscribed source");
ok(/w\.own_voice_state in \('unverified','owner_verified'\)/.test(writeSql),
  "client-reported clone overlap and measured foreign speakers remain excluded");
ok(/provenance,session_id.*o\.session_id::text[\s\S]*provenance,window_id.*w\.window_id::text/.test(writeSql),
  "canonical transcript evidence is bound to the same session and window");
ok(/insert into vy_replica_processing_evidence[\s\S]*insert into vy_replica_processing_evidence_decision[\s\S]*insert into vy_replica_claim_extraction_queue_item[\s\S]*update vy_replica_claim_extraction_queue/.test(writeSql),
  "evidence, accepted decision, exact session items and queue wakeup share one statement");
ok(/on conflict \(evidence_id\) do nothing[\s\S]*on conflict \(decision_id\) do nothing/.test(writeSql),
  "deterministic evidence and decision collisions are handled idempotently");
ok(/collision_free[\s\S]*record_hash<>[\s\S]*decision_id/.test(writeSql),
  "a same-id, different-record collision blocks the batch");
ok(!/update\s+vy_mirror_window/i.test(writeSql) && !/vy_mirror_conditioning/i.test(writeSql),
  "the fallback cannot alter window admission, own-voice state or conditioning");
ok(!/vy_replica_processing_job/i.test(writeSql),
  "the fallback never queues voice evidence or voice model work");
ok(writeParams[5] === MIRROR_OWNER_SPEAKER_ATTESTATION,
  "the durable statement set is bound as a parameter");

let negativeSql = "";
let negativeParams = [];
const negative = await attestMirrorOwnerSpeaker(async (sql, params) => {
  if (/select distinct w\.window_id,w\.session_id/.test(sql)) return windows;
  negativeSql = sql;
  negativeParams = params;
  return [{
    eligible_windows: 1,
    attested_windows: 1,
    newly_attested_windows: 1,
    claim_job_state: "complete",
  }];
}, OWNER, { session_id: SESSION, choice: "not_sure_or_other_people" });
ok(negative.state === "excluded" && negative.queued === false,
  "No or not sure explicitly excludes the call from claim learning");
ok(/insert into vy_replica_processing_evidence_decision/.test(negativeSql)
  && negativeParams[6] === "rejected" && negativeParams[7] === "mixed_or_uncertain_speaker",
"the negative choice durably rejects the exact speaker evidence without mutating another session's queue");
ok(/where \$7='accepted'/.test(negativeSql)
  && /te\.value#>>'\{provenance,session_id\}'=\$1::text/.test(negativeSql)
  && !/owner_speaker_excluded/.test(negativeSql),
"only a positive terminal choice queues transcript items from that exact session");

const status = await mirrorOwnerSpeakerAttestationStatus(async () => [{
  session_id: SESSION,
  replica_id: REPLICA,
  consent_ready: true,
  eligible_windows: 2,
  attested_windows: 0,
}], OWNER, SESSION);
ok(status.state === "needs_owner_choice" && status.eligible_windows === 2,
  "the end receipt exposes a content-free owner-choice state");

const excludedStatus = await mirrorOwnerSpeakerAttestationStatus(async () => [{
  session_id: SESSION,
  replica_id: REPLICA,
  consent_ready: true,
  eligible_windows: 2,
  attested_windows: 0,
  excluded_windows: 2,
}], OWNER, SESSION);
ok(excludedStatus.state === "excluded" && excludedStatus.excluded_windows === 2,
  "a durable latest rejection remains excluded after reload instead of asking again");

let invalidChoice = false;
try {
  await attestMirrorOwnerSpeaker(async () => [], OWNER, { session_id: SESSION, choice: "yes" });
} catch (error) {
  invalidChoice = error?.code === "mirror_speaker_attestation_choice_invalid" && error?.status === 400;
}
ok(invalidChoice, "an ambiguous client choice is refused by name");

const wireSource = readFileSync(join(ROOT, "api/_mirrorcall-wire.js"), "utf8");
const routeSource = readFileSync(join(ROOT, "api/mirror-call.js"), "utf8");
const clientSource = readFileSync(join(ROOT, "src/studio/mirrorCallApi.ts"), "utf8");
const uiSource = readFileSync(join(ROOT, "src/studio/MirrorCallStudio.tsx"), "utf8");
ok(wireSource.includes('"speaker_attestation"'), "the server handshake publishes the new op");
ok(routeSource.includes("opSpeakerAttestation") && routeSource.includes("attestMirrorOwnerSpeaker"),
  "the authenticated API route has a real caller for the store function");
ok(clientSource.includes('"speaker_attestation"') && clientSource.includes("attestMirrorCallOwnerSpeaker"),
  "the frontend contract calls the exact published op");
ok(uiSource.includes("Yes, only me") && uiSource.includes("No or not sure"),
  "the post-call screen offers the two explicit one-tap choices");
ok(uiSource.includes("generated playback is excluded") && uiSource.includes("still waits for your review"),
  "the UI explains clone playback exclusion and the later owner-review gate");
ok(uiSource.includes("does not change the clone voice"),
  "the UI does not imply this memory fallback changes voice conditioning");
ok(uiSource.includes("choice is final for this call"),
  "the post-call UI explains the terminal choice before either mutation");

if (failed) {
  console.error(`\n${failed}/${checks} Mirror owner speaker attestation checks failed`);
  process.exit(1);
}
console.log(`ok ${checks}/${checks} Mirror owner speaker attestation checks passed`);
