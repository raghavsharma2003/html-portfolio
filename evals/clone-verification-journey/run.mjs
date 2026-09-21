import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const source = readFileSync(join(ROOT, "src/studio/CloneVerificationJourney.tsx"), "utf8");
const css = readFileSync(join(ROOT, "src/studio/clone-verification-journey.css"), "utf8");
const start = source.indexOf("// stage-model:start");
const end = source.indexOf("// stage-model:end");
assert.ok(start >= 0 && end > start, "stage model markers must remain present");
const modelSource = source.slice(start + "// stage-model:start".length, end);
const compiled = ts.transpileModule(modelSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const model = {};
new Function("exports", compiled.outputText)(model);
const { deriveCloneVerificationStage } = model;

let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const NOW = Date.parse("2026-09-02T00:00:00.000Z");
const replica = {
  replica_id: "10000000-0000-4000-8000-000000000001",
  display_name: "Me",
  lifecycle: "enrolling",
  age_verified: false,
  identity_verified: false,
  liveness_verified: false,
};
const receipt = (scope, patch = {}) => ({ scope, revoked_at: null, expires_at: "2027-09-02T00:00:00.000Z", ...patch });
const baseConsents = [receipt("capture"), receipt("transcription"), receipt("storage")];
const primary = { source_id: "voice", voice_role: "primary", state: "ready", capture_mode: "upload", created_at: "2026-09-01T00:00:00.000Z" };
const idPending = { source_id: "id-pending", voice_role: "supporting", state: "pending_upload", capture_mode: "identity_document", created_at: "2026-09-01T01:00:00.000Z" };
const idReady = { ...idPending, source_id: "id-ready", state: "quarantined", created_at: "2026-09-01T02:00:00.000Z" };
const emptyReview = { self_test_mode: false, builds: [], voice_genomes: [] };
const stage = (patch = {}) => deriveCloneVerificationStage({
  replica: { ...replica, ...(patch.replica || {}) },
  consents: patch.consents ?? baseConsents,
  sources: patch.sources ?? [primary],
  review: patch.review ?? emptyReview,
  candidateSourceId: patch.candidateSourceId ?? null,
  buildIntent: patch.buildIntent ?? null,
}, NOW);

ok("revoked replicas stop before any verification action", stage({ replica: { lifecycle: "revoked" } }) === "stopped");
ok("internal test receipts fail closed instead of becoming identity", stage({ review: { ...emptyReview, self_test_mode: true } }) === "self_test_blocked");
ok("a legacy internal-test clone offers explicit owner-confirmed erasure instead of a dead end",
  /function LegacySelfTestReset/.test(source)
    && /Start clean/.test(source)
    && /Erase and start again/.test(source)
    && /onResetLegacyClone/.test(source)
    && /const started = await onReset\(\)/.test(source));
ok("legacy recovery never clears the blocker or grants permission in the browser",
  !/setSelfTest/.test(source)
    && !/grant.*Consent/.test(source.slice(source.indexOf("function LegacySelfTestReset"), source.indexOf("function IdentityDocumentUpload")))
    && /This test clone is still blocked/.test(source));
ok("missing or expired source permission returns to the real ceremony",
  stage({ consents: [receipt("capture"), receipt("transcription"), receipt("storage", { expires_at: "2026-09-01T00:00:00.000Z" })] }) === "source_permission");
ok("a selected primary source gets an honest server-processing stage", stage({ sources: [{ ...primary, state: "processing" }] }) === "source_processing");
ok("no identity document opens the private document upload", stage() === "identity_document");
ok("an unfinished identity upload does not look like verified evidence", stage({ sources: [primary, idPending] }) === "identity_document");
ok("only a quarantined identity document reaches independent proofing", stage({ sources: [primary, idReady] }) === "identity_proof");
ok("adult ID evidence still requires live identity and biometric proof", stage({ replica: { age_verified: true }, sources: [primary, idReady] }) === "liveness");

const verifiedReplica = { age_verified: true, identity_verified: true, liveness_verified: true };
const verifiedConsents = [...baseConsents, receipt("biometric")];
ok("verified identity cannot silently grant model rights", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: verifiedConsents }) === "model_consent");

const modelConsents = [...verifiedConsents, receipt("training"), receipt("inference")];
ok("real identity and model receipts reach owner review", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents }) === "review");
ok("a real queued build becomes waiting on the server", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, builds: [{ state: "queued", created_at: "2026-09-02T00:00:00.000Z" }] } }) === "building");
ok("a retry remains server work rather than an owner failure", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, builds: [{ state: "retry", created_at: "2026-09-02T00:00:00.000Z" }] } }) === "building");
ok("a failed build returns to honest review and a real retry action", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, builds: [{ state: "failed", created_at: "2026-09-02T00:00:00.000Z" }] } }) === "review");
ok("only a draft bound to the selected source completes the bridge", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, voice_genomes: [{ status: "draft", source_ids: [primary.source_id] }] } }) === "complete");
ok("a draft from an older source cannot masquerade as the replacement", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, voice_genomes: [{ status: "draft", source_ids: ["old-voice"] }] } }) === "review");
ok("a retired genome cannot masquerade as a current draft", stage({ replica: verifiedReplica, sources: [primary, idReady], consents: modelConsents, review: { ...emptyReview, voice_genomes: [{ status: "retired", source_ids: [primary.source_id] }] } }) === "review");

const candidate = { ...primary, source_id: "replacement", voice_role: "supporting" };
const candidateDraft = { status: "draft", source_ids: [candidate.source_id] };
const candidateIntent = { candidate_source_id: candidate.source_id, state: "waiting", build_state: null, promoted_at: null };
ok("an old primary draft cannot unlock a staged replacement journey",
  stage({ replica: verifiedReplica, sources: [primary, candidate, idReady], consents: modelConsents, candidateSourceId: candidate.source_id, buildIntent: candidateIntent, review: { ...emptyReview, voice_genomes: [{ status: "draft", source_ids: [primary.source_id] }] } }) === "review");
ok("a candidate draft stays gated until the server atomically promotes that exact build intent",
  stage({ replica: verifiedReplica, sources: [primary, candidate, idReady], consents: modelConsents, candidateSourceId: candidate.source_id, buildIntent: candidateIntent, review: { ...emptyReview, voice_genomes: [candidateDraft] } }) === "review");
ok("the exact queued candidate intent owns the visible build state",
  stage({ replica: verifiedReplica, sources: [primary, candidate, idReady], consents: modelConsents, candidateSourceId: candidate.source_id, buildIntent: { ...candidateIntent, state: "queued", build_state: "queued" }, review: { ...emptyReview, builds: [{ state: "failed", created_at: "2026-09-02T00:00:00.000Z" }] } }) === "building");
ok("only the exact promoted candidate intent and source-bound draft completes replacement",
  stage({ replica: verifiedReplica, sources: [primary, candidate, idReady], consents: modelConsents, candidateSourceId: candidate.source_id, buildIntent: { ...candidateIntent, state: "review", promoted_at: "2026-09-02T00:03:00.000Z" }, review: { ...emptyReview, voice_genomes: [candidateDraft] } }) === "complete");

ok("identity upload uses the real signed create upload and finalize callbacks",
  /purpose:\s*"identity_document"/.test(source) && /containsThirdParties:\s*false/.test(source) && /await putSignedUpload\(/.test(source) && /await onFinalizeUpload\(sourceId\)/.test(source));
ok("identity upload preserves same-file retry and unfinished-source recovery",
  /onRetryUpload\(sourceId\)/.test(source) && /retryRef\.current = \{ file, sourceId, uploaded: true \}/.test(source) && /Remove unfinished upload/.test(source));
ok("the journey reuses every server-backed verification surface without a self-test prop",
  /<IdentityProofing/.test(source) && /<LivenessCapture/.test(source) && /<ModelConsentGate/.test(source) && /<ProcessingReview/.test(source) && !/testEnvironment/.test(source));
ok("later verification ceremonies stay off the first mobile bundle",
  ["IdentityProofing", "LivenessCapture", "ModelConsentGate", "ProcessingReview"].every((name) => source.includes(`const ${name} = lazy(() => import("./${name}"))`))
    && /<Suspense fallback=/.test(source)
    && !/import IdentityProofing from/.test(source)
    && !/import LivenessCapture from/.test(source)
    && !/import ModelConsentGate from/.test(source)
    && !/import ProcessingReview from/.test(source));
ok("review and build status refresh without queueing or granting anything automatically",
  /window\.setInterval/.test(source) && /stage === "building" \? 10_000 : 20_000/.test(source) && !/grantVerifiedModelConsent\(/.test(source) && !/queueVoiceGenome\(/.test(source));
ok("mobile structure owns one scroll surface, safe areas, and 44px or larger actions",
  /grid-template-rows:\s*auto minmax\(0, 1fr\)/.test(css) && /overflow-x:\s*hidden/.test(css) && /overflow-y:\s*auto/.test(css) && /env\(safe-area-inset-bottom\)/.test(css) && /min-height:\s*48px/.test(css));
ok("responsive and reduced-motion rules are explicit",
  /@media \(max-width: 520px\)/.test(css) && /@media \(max-height: 660px\)[\s\S]*?\.cvj-shell\s*\{[\s\S]*?min-height:\s*0/.test(css) && /@media \(prefers-reduced-motion: reduce\)/.test(css));
ok("the hidden ID input paints focus on its visible file picker",
  /\.cvj-file-input:focus-visible\s*\+\s*\.cvj-file-picker/.test(css));
ok("build waiting names its polling boundary and refuses a guessed countdown",
  /This page checks progress every 10 seconds while open/.test(source) && /An estimate is not available yet/.test(source));

console.log(`\n${checks} clone verification journey checks passed`);
