// Signed fixture transport -> actual worker records -> actual draft builder.
// Retained revisions are signed service claims, not execution attestation or
// accepted model compatibility. No model execution, DB writes or backfill.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAzureVoiceEvidenceAdapters } from "../../api/_replica-processing/providers/azure-voice-evidence.js";
import { executeProcessingJob } from "../../api/_replica-processing/worker.js";
import { buildVoiceGenomeDraft } from "../../api/_replica-processing/builders.js";
import { canonicalJson, createEvidenceRecord, sha256Hex, stableUuid } from "../../api/_replica-processing/contracts.js";

let checks = 0;
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`); }
async function rejects(name, fn, pattern) { await assert.rejects(fn, pattern); check(name, () => {}); }
const ECAPA = "speechbrain-ecapa-voxceleb";
const XVECTOR = "speechbrain-xvector-voxceleb";
// Deliberately distinct synthetic commits: no allowlist or current-model claim.
const REVISIONS = { "speechbrain-xvector": "b".repeat(40), "speechbrain-ecapa": "a".repeat(40), "silero-vad": "6.2.1" };
const BY_FAMILY = { [ECAPA]: REVISIONS["speechbrain-ecapa"], [XVECTOR]: REVISIONS["speechbrain-xvector"] };
const KEY = Buffer.alloc(32, 43);
const ENV = { AZURE_VOICE_EVIDENCE_ORIGIN: "https://voice-evidence.internal", AZURE_VOICE_EVIDENCE_HMAC_SECRET: KEY.toString("base64url") };
const PROTOCOL = "vyakti-voice-evidence/v1";
const RAW = Buffer.from("synthetic revision transport fixture, not decoded speech");
const OWNER = stableUuid("revision-owner"), REPLICA = stableUuid("revision-replica"), SOURCE = stableUuid("revision-source");
const source = {
  source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER, kind: "audio", state: "quarantined",
  storage_bucket: "private-replica-evidence", object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  mime: "audio/wav", byte_size: RAW.length, duration_ms: 2000, sha256: sha256Hex(RAW), contains_third_parties: false,
};
const job = { job_id: stableUuid("revision-job"), replica_id: REPLICA, owner_user_id: OWNER, source_id: SOURCE,
  step: "voice_quality", revision: 1, state: "leased", attempt: 1 };
const completedSteps = ["integrity", "malware_scan", "media_probe", "diarize", "separate", "enhance", "transcribe"];
const input = { artifact_id: null, mime: source.mime, sha256: source.sha256, duration_ms: source.duration_ms };
const request = { source, inputs: [input] };
function payload() {
  return {
    embeddings: [
      { family: ECAPA, input_key: "input-1", vector: Array(192).fill(0.01), confidence: 0.8 },
      { family: XVECTOR, input_key: "input-1", vector: Array(512).fill(0.02), confidence: 0.7 },
    ],
    model_revisions: { ...REVISIONS }, confidence: 0.7, measurements: { fixture: true }, quality: { fixture: true },
  };
}
function sign(...parts) { return createHmac("sha256", KEY).update(parts.join("\n")).digest("base64url"); }
function adapterFor(value, factory = createAzureVoiceEvidenceAdapters, forge = false) {
  return factory({ env: ENV, resolveInput: async () => ({ body: RAW, mime: source.mime, byteSize: RAW.length }),
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/healthz") return new Response("{}", { status: 200 });
      assert.equal(path, "/v1/analyze");
      const headers = new Headers(init.headers), nonce = headers.get("x-vyakti-nonce");
      const digest = sha256Hex(Buffer.from(init.body));
      assert.equal(headers.get("x-vyakti-content-sha256"), digest);
      assert.equal(headers.get("x-vyakti-signature"), sign(PROTOCOL, "POST", path, headers.get("x-vyakti-timestamp"), nonce, digest));
      const sent = JSON.parse(init.body);
      assert.equal(sent.operation, "voice_quality");
      assert.equal(sent.inputs[0].sha256, source.sha256);
      const bytes = Buffer.from(canonicalJson(value));
      const responseSignature = sign(PROTOCOL, "response", path, nonce, "200", sha256Hex(bytes));
      const returned = forge ? Buffer.from(canonicalJson({ ...value, model_revisions: { ...REVISIONS, "speechbrain-ecapa": "c".repeat(40) } })) : bytes;
      return new Response(returned, { status: 200, headers: { "X-Vyakti-Response-Signature": responseSignature } });
    },
  });
}
async function run(adapter, execute = executeProcessingJob, inputArtifacts = []) {
  return execute({ job, source, completedSteps, inputArtifacts, adapters: { voice_quality: adapter } });
}
const adapters = adapterFor(payload());
const normalized = await adapters.voice_quality.measure(request);
check("signed map maps distinct commits by family, independent of map order", () => {
  for (const embedding of normalized.embeddings) assert.equal(embedding.model_revision, BY_FAMILY[embedding.family]);
});
check("only voice_quality advances adapter contract version", () => {
  assert.equal(adapters.voice_quality.version, "vyakti-voice-evidence-v2");
  for (const key of ["diarize", "separate", "enhance", "identity_audio"]) assert.equal(adapters[key].version, "vyakti-voice-evidence-v1");
});
check("normalized revision is immutable", () => assert.throws(() => { normalized.embeddings[0].model_revision = "c".repeat(40); }, TypeError));
const actual = await run(adapters.voice_quality);
assert.equal(actual.outcome, "complete");
const embeddings = actual.evidence.filter((row) => row.evidence_type === "voice_embedding");
check("actual worker records keep family revisions and measured input SHA", () => {
  for (const row of embeddings) { assert.equal(row.value.model_revision, BY_FAMILY[row.value.family]); assert.equal(row.input_sha256, source.sha256); }
});
const segment = createEvidenceRecord({ ...source, created_by_job_id: job.job_id, evidence_type: "speaker_segment",
  span: { start_ms: 0, end_ms: 2000 }, confidence: 0.8, value: { speaker_key: "speaker-1", target_likelihood: 0.8 },
  input_sha256: source.sha256, adapter: adapters.diarize, adapter_stage: "diarize" });
function draft(evidence, builder = buildVoiceGenomeDraft) {
  return builder({ version: 2, builderVersion: "revision-fixture-v2", artifacts: [],
    evidence: [...evidence, segment].map((row) => ({ ...row, decision: "accepted" })) });
}
const built = draft(actual.evidence);
check("actual builder retains per-entry revision in a draft requiring calibration", () => {
  for (const [family, rows] of Object.entries(built.definition.speaker_identity.embedding_families)) assert.equal(rows[0].model_revision, BY_FAMILY[family]);
  assert.equal(built.status, "draft"); assert.equal(built.definition.calibration.status, "required");
});
check("evidence revision cannot mutate after record hashing", () => assert.throws(() => { embeddings[0].value.model_revision = "c".repeat(40); }, TypeError));
check("draft revision cannot mutate after manifest hashing", () => assert.throws(() => { built.definition.speaker_identity.embedding_families[ECAPA][0].model_revision = "c".repeat(40); }, TypeError));
const derivedId = stableUuid("revision-derived");
const derived = await run(adapters.voice_quality, executeProcessingJob, [{ ...source, artifact_id: derivedId }]);
check("derived input lineage and model revision survive the same actual worker", () => {
  assert.equal(derived.outcome, "complete");
  for (const row of derived.evidence.filter((item) => item.evidence_type === "voice_embedding")) {
    assert.equal(row.artifact_id, derivedId); assert.equal(row.value.model_revision, BY_FAMILY[row.value.family]);
  }
});
const next = payload(); next.model_revisions["speechbrain-ecapa"] = "c".repeat(40);
const changed = await run(adapterFor(next).voice_quality);
const changedEmbeddings = changed.evidence.filter((row) => row.evidence_type === "voice_embedding");
check("changing only one model revision changes its evidence hash and ID", () => {
  assert.deepEqual(changed.adapter, actual.adapter, "adapter metadata must stay fixed for this comparison");
  assert.notEqual(changedEmbeddings[0].record_hash, embeddings[0].record_hash);
  assert.notEqual(changedEmbeddings[0].evidence_id, embeddings[0].evidence_id);
  assert.equal(changedEmbeddings[1].record_hash, embeddings[1].record_hash);
});
check("revision changes propagate into source-set and manifest hashes", () => {
  const changedDraft = draft(changed.evidence);
  assert.notEqual(changedDraft.source_set_hash, built.source_set_hash);
  assert.notEqual(changedDraft.manifest_hash, built.manifest_hash);
});
const legacyPayload = payload(); delete legacyPayload.model_revisions;
const legacyAdapter = adapterFor(legacyPayload).voice_quality;
const legacyNormalized = await legacyAdapter.measure(request);
const legacy = await run(legacyAdapter);
check("absent legacy metadata stays absent in adapter, worker and builder", () => {
  assert.equal(legacy.outcome, "complete");
  for (const row of legacyNormalized.embeddings) assert.equal(Object.hasOwn(row, "model_revision"), false);
  for (const row of legacy.evidence.filter((entry) => entry.evidence_type === "voice_embedding")) assert.equal(Object.hasOwn(row.value, "model_revision"), false);
  for (const rows of Object.values(draft(legacy.evidence).definition.speaker_identity.embedding_families)) assert.equal(Object.hasOwn(rows[0], "model_revision"), false);
});
for (const [label, map] of [
  ["null", null], ["array", []], ["string", "revision"], ["empty", {}],
  ["missing ecapa", { "speechbrain-xvector": REVISIONS["speechbrain-xvector"] }],
  ["missing xvector", { "speechbrain-ecapa": REVISIONS["speechbrain-ecapa"] }],
  ["embedding-family keys instead of service keys", BY_FAMILY],
]) {
  await rejects(`present ${label} revision map fails closed`, () => adapterFor({ ...payload(), model_revisions: map }).voice_quality.measure(request), /voice_evidence_model_revisions_invalid/);
}
for (const bad of [null, 123, "", "main", "A".repeat(40), "a".repeat(39), "a".repeat(41), "a".repeat(40) + "\n", "g".repeat(40)]) {
  await rejects(`signed malformed revision ${JSON.stringify(bad)} refuses`, () => adapterFor({ ...payload(), model_revisions: { ...REVISIONS, "speechbrain-ecapa": bad } }).voice_quality.measure(request), /voice_evidence_model_revisions_invalid/);
}
const foreignFamily = payload(); foreignFamily.embeddings[0].family = "speechbrain-xvector";
await rejects("unknown embedding family cannot borrow a service revision", () => adapterFor(foreignFamily).voice_quality.measure(request), /voice_evidence_embeddings_invalid/);
await rejects("changed signed response revision fails transport authentication", () => adapterFor(payload(), createAzureVoiceEvidenceAdapters, true).voice_quality.measure(request), /voice_evidence_response_signature_invalid/);
for (const bad of [undefined, null, 123, "main", "A".repeat(40), "a".repeat(40) + "\n"]) {
  const result = structuredClone(normalized); result.embeddings[0].model_revision = bad;
  const output = await run({ ...adapters.voice_quality, measure: async () => result });
  check(`worker independently rejects supplied revision ${JSON.stringify(bad)}`, () => assert.equal(output.failure_code, "voice_model_revision_invalid"));
  const rows = structuredClone(actual.evidence); rows.find((row) => row.evidence_type === "voice_embedding").value.model_revision = bad;
  check(`builder independently rejects supplied revision ${JSON.stringify(bad)}`, () => assert.throws(() => draft(rows), /model revision is invalid/));
}

// Execute actual source mutants in memory; no source files or caches are rewritten.
async function mutant(relative, before, after) {
  const url = new URL(relative, import.meta.url);
  let code = readFileSync(url, "utf8");
  assert.equal(code.split(before).length, 2, "mutation must match exactly once");
  code = code.replace(before, after).replace(/from\s+(["'])(\.[^"']+)\1/g, (_, quote, path) => `from ${quote}${new URL(path, url).href}${quote}`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const oldWorker = await mutant("../../api/_replica-processing/worker.js", "...(hasRevision ? { model_revision: embedding.model_revision } : {}),", "");
const lostWorker = await run(adapters.voice_quality, oldWorker.executeProcessingJob);
check("negative control detects actual worker dropping model revision", () => assert.throws(() => assert.deepEqual(lostWorker.evidence, actual.evidence)));
const oldBuilder = await mutant("../../api/_replica-processing/builders.js", "...(hasRevision ? { model_revision: row.value.model_revision } : {}),", "");
check("negative control detects actual builder dropping model revision", () => assert.notEqual(draft(actual.evidence, oldBuilder.buildVoiceGenomeDraft).manifest_hash, built.manifest_hash));
const legacyOldWorker = await run(legacyAdapter, oldWorker.executeProcessingJob);
check("legacy worker record shape and hashes equal the pre-propagation output", () => assert.deepEqual(legacyOldWorker.evidence, legacy.evidence));
check("historical absent-revision manifest is byte-identical to prior builder behavior", () => assert.deepEqual(draft(legacy.evidence), draft(legacy.evidence, oldBuilder.buildVoiceGenomeDraft)));
const wrongMapper = await mutant("../../api/_replica-processing/providers/azure-voice-evidence.js", "model_revision: value.model_revisions[revisionKeys[embedding.family]]", "model_revision: value.model_revisions['speechbrain-ecapa']");
const misbound = await adapterFor(payload(), wrongMapper.createAzureVoiceEvidenceAdapters).voice_quality.measure(request);
check("negative control detects incorrect family-to-service revision mapping", () => assert.throws(() => assert.equal(misbound.embeddings[1].model_revision, BY_FAMILY[XVECTOR])));
console.log(`${checks} revision lineage checks passed; signed fixtures only, no model or identity acceptance.`);
