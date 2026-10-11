import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMirrorCanonicalEvidence } from "../../api/_mirrorcall-evidence.js";
import { mirrorWindowAudioRef, settleMirrorWindow } from "../../api/_mirrorcall-store.js";
import { dropReason } from "../../api/_mirrorcall-wire.js";
import { MIRROR_DERIVATION_SCOPES, MIRROR_SESSION_SCOPES } from "../../api/_mirrorcall.js";
import { ELIGIBLE_TRANSCRIPTS_SQL } from "../../api/_replica-claims.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "20000000-0000-4000-8000-000000000002";
const REPLICA = "10000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const SESSION = "40000000-0000-4000-8000-000000000004";
const WINDOW = "50000000-0000-4000-8000-000000000005";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function evidence(overrides = {}) {
  return createMirrorCanonicalEvidence({
    replicaId: REPLICA,
    ownerUserId: OWNER,
    sourceId: SOURCE,
    sessionId: SESSION,
    windowId: WINDOW,
    seq: 3,
    durationMs: 12_000,
    transcript: "mera favourite subject physics hai",
    inputSha256: "a".repeat(64),
    provider: "sarvam-sync",
    model: "saarika:v2.5",
    languageCode: "hi-IN",
    languageSource: "requested_hint",
    transcriptConfidence: 0.91,
    speakerVerification: "unverified",
    ...overrides,
  });
}

const first = evidence();
const replay = evidence();
ok("one settlement produces deterministic transcript and language evidence", first.length === 2 && first[0].evidence_type === "transcript_span" && first[1].evidence_type === "language_span" && JSON.stringify(first) === JSON.stringify(replay));
ok("both rows bind the exact source session window and sequence", first.every((row) => row.source_id === SOURCE && row.value.provenance.source_id === SOURCE && row.value.provenance.session_id === SESSION && row.value.provenance.window_id === WINDOW && row.value.provenance.seq === 3));
ok("the real ASR provider and model remain visible while DB adapter parts stay safe", first.every((row) => row.adapter.name === "sarvam-sync" && row.adapter.version === "saarika_v2.5" && row.value.provenance.asr_model === "saarika:v2.5"));
ok("transcript confidence is provider evidence rather than an invented default", first[0].confidence === 0.91 && evidence({ transcriptConfidence: null })[0].confidence === null);
ok("no speaker segment or owner verdict is fabricated", first.every((row) => row.evidence_type !== "speaker_segment" && row.value.provenance.speaker_verification === "unverified"));
ok("changing the session changes both immutable commitments", evidence({ sessionId: "60000000-0000-4000-8000-000000000006" }).every((row, index) => row.evidence_id !== first[index].evidence_id && row.record_hash !== first[index].record_hash));

let statement;
const settled = await settleMirrorWindow(async (sql, params) => {
  statement = { sql, params };
  return [{
    window_id: WINDOW, session_id: SESSION, replica_id: REPLICA, owner_user_id: OWNER,
    seq: 3, source_id: SOURCE, duration_ms: 12_000, lane: "sync", asr_state: "transcribed",
    failure_code: "", transcript: first[0].value.text, asr_provider: "sarvam-sync", asr_model: "saarika:v2.5",
  }];
}, OWNER, REPLICA, WINDOW, {
  transcript: first[0].value.text,
  provider: "sarvam-sync",
  model: "saarika:v2.5",
  evidence: first,
});
ok("window settlement and evidence insertion share one database statement", settled.asr_state === "transcribed" && /\bsettled as\s*\(/i.test(statement.sql) && /insert into vy_replica_processing_evidence/i.test(statement.sql));
ok("the atomic statement joins exact owner source session window and sequence provenance", /w\.owner_user_id=.*owner_user_id/i.test(statement.sql) && /provenance,window_id/i.test(statement.sql) && /provenance,session_id/i.test(statement.sql) && /provenance,seq/i.test(statement.sql));
ok("the write structurally admits only transcript and language evidence and binds the stored source SHA", /evidence_type' in \('transcript_span','language_span'\)/i.test(statement.sql) && /src\.sha256=d\.item->>'input_sha256'/i.test(statement.sql));
ok("language evidence does not need a text field while transcript evidence must equal the settled scrubbed text", /evidence_type'='language_span'/i.test(statement.sql) && /w\.transcript=d\.item#>>'\{value,text\}'/i.test(statement.sql));
ok("immutable collision checking covers evidence id input hash and record hash", /valid_evidence/i.test(statement.sql) && /e\.input_sha256=d\.item->>'input_sha256'/i.test(statement.sql) && /e\.record_hash=d\.item->>'record_hash'/i.test(statement.sql));
ok("settlement carries exactly the two canonical records and no speaker segment", JSON.parse(statement.params[8]).length === 2 && !statement.params[8].includes("speaker_segment"));
ok("settlement rechecks live ASR and derivation consent under the current policy", /consent_at_settlement as materialized/i.test(statement.sql) && /unnest\(\$11::text\[\]\)/i.test(statement.sql) && /unnest\(\$12::text\[\]\)/i.test(statement.sql) && /c\.policy_version=r\.policy_version/i.test(statement.sql) && /c\.revoked_at is null/i.test(statement.sql) && /c\.expires_at>now\(\)/i.test(statement.sql));
ok("a consent race drops the transcript before canonical or expression evidence can be selected", /when \$4='transcribed' and not c\.asr_authorized then 'dropped'/i.test(statement.sql) && /then 'mirror_live_asr_consent_inactive'/i.test(statement.sql) && /desired_evidence as materialized[\s\S]*w\.asr_state='transcribed'/i.test(statement.sql) && /desired_expression as materialized[\s\S]*c\.derivation_authorized/i.test(statement.sql));
ok("settlement receives the exact live scope sets instead of a client assertion", JSON.stringify(statement.params[10]) === JSON.stringify(MIRROR_SESSION_SCOPES) && JSON.stringify(statement.params[11]) === JSON.stringify(MIRROR_DERIVATION_SCOPES) && MIRROR_DERIVATION_SCOPES.includes("training"));

let audioRefStatement;
const deniedAudioRef = await mirrorWindowAudioRef(async (sql, params) => {
  audioRefStatement = { sql, params };
  return [{
    source_id: SOURCE, storage_bucket: "private", object_path: "mirror/window.wav",
    sha256: "a".repeat(64), mime: "audio/wav", byte_size: 128,
    live_consent_scopes: ["capture", "storage"], live_consent_authorized: false,
  }];
}, OWNER, REPLICA, SOURCE, SESSION, 3);
ok("pre-ASR private read scope resolution fails closed when transcription was revoked", deniedAudioRef?.liveConsentAuthorized === false && deniedAudioRef.requiredScopes.includes("transcription"));
ok("pre-ASR lookup binds the exact source window session sequence and current unexpired grants", /w\.source_id=src\.source_id/i.test(audioRefStatement.sql) && /w\.session_id=\$4::uuid/i.test(audioRefStatement.sql) && /w\.seq=\$5::int/i.test(audioRefStatement.sql) && /c\.policy_version=t\.policy_version/i.test(audioRefStatement.sql) && /c\.revoked_at is null/i.test(audioRefStatement.sql) && /c\.expires_at>now\(\)/i.test(audioRefStatement.sql) && JSON.stringify(audioRefStatement.params[5]) === JSON.stringify(MIRROR_SESSION_SCOPES));
ok("the named consent policy state is stable on the wire", dropReason("mirror_live_asr_consent_inactive") === "consent_inactive");

ok("claim eligibility admits integrity-bound Mirror sources without pretending they completed enrollment", /s\.capture_mode='derived'/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /s\.provenance->>'purpose'='mirror_window'/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /provenance,origin/i.test(ELIGIBLE_TRANSCRIPTS_SQL));
ok("claim eligibility still requires confidence and an accepted measured owner speaker overlap", /e\.confidence>=0\.55/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /d\.decision='accepted'/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /target_likelihood/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /evidence_type='speaker_segment'/i.test(ELIGIBLE_TRANSCRIPTS_SQL));

const route = readFileSync(join(ROOT, "api/replica-claims.js"), "utf8");
const mirror = readFileSync(join(ROOT, "api/mirror-call.js"), "utf8");
const store = readFileSync(join(ROOT, "api/_mirrorcall-store.js"), "utf8");
ok("the nearline sweep is a named owner-authenticated callable operation", /body\.op !== "extract" && body\.op !== "sweep"/.test(route) && /requireUser\(req\)/.test(route) && /sweepOwnedClaims/.test(route));
ok("call end reports owner-speaker review before exposing the durable automatic queue",
  /canonical_evidence_pending_owner_speaker/.test(mirror)
    && /\["queued", "running"\]\.includes/.test(mirror)
    && /waiting_for_owner_speaker_attestation/.test(mirror)
    && /claim_extraction_job_state/.test(mirror)
    && /automatic_sweep:[\s\S]*route: "\/api\/replica-claim-sweep"/.test(mirror)
    && !/insert into vy_replica_claim_extraction_queue_item/.test(store)
    && /scheduled_nearline_sweep/.test(store));
ok("the turn path never calls claim extraction or a provider-backed sweep", !/extractOwnedClaims|sweepOwnedClaims|createProductionClaimExtractor/.test(mirror));
const consentCheckAt = mirror.indexOf("!ref.liveConsentAuthorized");
const privateReadAt = mirror.indexOf("readPrivateReplicaObject", consentCheckAt);
const providerAt = mirror.indexOf("createLiveAsrProvider", consentCheckAt);
ok("the live consent branch precedes both the private object read and ASR provider construction", consentCheckAt >= 0 && privateReadAt > consentCheckAt && providerAt > privateReadAt);
ok("a settlement-time revocation clears the in-memory ASR result before learning and reply", /if \(window\.asr_state !== "transcribed"\) \{\s*asr = null;\s*bytes = null;/m.test(mirror));

console.log(`\n${checks} Mirror Call canonical evidence checks passed`);
