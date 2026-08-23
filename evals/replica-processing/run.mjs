// Offline structural gate for noisy-evidence processing. The providers and
// bytes are deterministic fixtures: this suite proves boundaries, lineage and
// retry behavior, never speech quality or human similarity.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const Contracts = await import(pathToFileURL(join(ROOT, "api/_replica-processing/contracts.js")));
const Pipeline = await import(pathToFileURL(join(ROOT, "api/_replica-processing/pipeline.js")));
const Queue = await import(pathToFileURL(join(ROOT, "api/_replica-processing/queue.js")));
const Worker = await import(pathToFileURL(join(ROOT, "api/_replica-processing/worker.js")));
const Builders = await import(pathToFileURL(join(ROOT, "api/_replica-processing/builders.js")));
const Fake = await import(pathToFileURL(join(ROOT, "api/_replica-processing/providers/fake.js")));
const Repository = await import(pathToFileURL(join(ROOT, "api/_replica-processing/repository.js")));
const { splitSql } = await import(pathToFileURL(join(ROOT, "db/migrations/apply.mjs")));

let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};
const throwsAsync = async (fn, code = "") => {
  try { await fn(); return false; } catch (error) { return code ? error.code === code : true; }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHA = "d".repeat(64);
const source = Object.freeze({
  source_id: SOURCE,
  replica_id: REPLICA,
  owner_user_id: OWNER,
  kind: "audio",
  state: "quarantined",
  storage_bucket: "private-replica-evidence",
  object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  mime: "audio/wav",
  byte_size: 48_000,
  duration_ms: 24_000,
  sha256: SHA,
  contains_third_parties: false,
});
const job = (step, attempt = 1) => ({
  job_id: Contracts.stableUuid(`job:${step}`),
  replica_id: REPLICA,
  owner_user_id: OWNER,
  source_id: SOURCE,
  step,
  revision: 1,
  state: "leased",
  attempt,
});
const dependencies = {
  integrity: [],
  malware_scan: ["integrity"],
  media_probe: ["integrity", "malware_scan"],
  diarize: ["integrity", "malware_scan", "media_probe"],
  separate: ["integrity", "malware_scan", "media_probe", "diarize"],
  enhance: ["integrity", "malware_scan", "media_probe", "diarize", "separate"],
  transcribe: ["integrity", "malware_scan", "media_probe", "diarize", "separate", "enhance"],
  voice_quality: ["integrity", "malware_scan", "media_probe", "diarize", "separate", "enhance", "transcribe"],
};

{
  ok("only quarantined audio/video sources enter the shipped DAG",
    Pipeline.initialProcessingSteps(source).join() === "integrity" &&
    Pipeline.initialProcessingSteps({ ...source, kind: "text" }).length === 0);
  ok("the shipped DAG cannot skip target-source separation",
    Pipeline.nextProcessingSteps("diarize", dependencies.diarize).join() === "separate" &&
    Pipeline.nextProcessingSteps("separate", dependencies.separate).join() === "enhance");
  ok("derived paths are owner/replica/source scoped",
    Contracts.derivedArtifactPath({
      ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
      transformVersion: "fixture-v1", stage: "enhance",
      artifactId: Contracts.stableUuid("artifact"),
    }).startsWith(`${OWNER}/${REPLICA}/${SOURCE}/derived/fixture-v1/`));
  ok("path injection is rejected before storage", throws(() => Contracts.derivedArtifactPath({
    ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
    transformVersion: "../original", stage: "enhance", artifactId: Contracts.stableUuid("artifact"),
  })));
  ok("non-quarantined sources cannot be processed", throws(() => Contracts.assertProcessingSource({ ...source, state: "ready" })));
}

const adapters = Fake.createFakeProcessingAdapters();
const store = Fake.createFakeImmutableArtifactStore();
const integrity = await Worker.executeProcessingJob({
  job: job("integrity"), source, adapters, artifactStore: store, completedSteps: dependencies.integrity,
});
ok("server integrity seam completes only on the declared digest", integrity.outcome === "complete" && integrity.result.verified_input_sha256 === SHA);

const badIntegrity = await Worker.executeProcessingJob({
  job: job("integrity"), source, adapters: Fake.createFakeProcessingAdapters({ corruptIntegrity: true }),
  artifactStore: store, completedSteps: [],
});
ok("integrity mismatch blocks rather than completing", badIntegrity.outcome === "blocked" && badIntegrity.failure_code === "integrity_mismatch");

const transientAdapters = Fake.createFakeProcessingAdapters({ failOnceStage: "diarize" });
const firstDiarize = await Worker.executeProcessingJob({
  job: job("diarize", 1), source, adapters: transientAdapters, artifactStore: store,
  completedSteps: dependencies.diarize,
});
const secondDiarize = await Worker.executeProcessingJob({
  job: job("diarize", 2), source, adapters: transientAdapters, artifactStore: store,
  completedSteps: dependencies.diarize,
});
ok("transient adapter failures become bounded retries, not false completion",
  firstDiarize.outcome === "retry" && firstDiarize.retry_after_ms >= 2_000 && secondDiarize.outcome === "complete");

const diarization = await Worker.executeProcessingJob({
  job: job("diarize"), source, adapters, artifactStore: store, completedSteps: dependencies.diarize,
});
ok("speaker evidence retains offsets, confidence and adapter provenance",
  diarization.evidence.every((entry) => entry.span.end_ms > entry.span.start_ms && entry.confidence != null && entry.adapter.family === "diarization"));

const separated = await Worker.executeProcessingJob({
  job: job("separate"), source, adapters, artifactStore: store, completedSteps: dependencies.separate,
});
ok("separation creates an immutable foreground candidate before enhancement",
  separated.outcome === "complete" && separated.artifacts.length === 1 && separated.artifacts[0].stage === "separate");

const enhanced = await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
});
const repeatedEnhancement = await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
});
ok("enhancement emits multiple immutable candidates beside the raw object",
  enhanced.outcome === "complete" && enhanced.artifacts.length === 2 &&
  enhanced.artifacts.every((entry) => entry.object_path.includes("/derived/") && entry.object_path !== source.object_path &&
    entry.parent_artifact_id === separated.artifacts[0].artifact_id && entry.input_sha256 === separated.artifacts[0].sha256));
ok("candidate manifests and nested provenance are frozen after hashing",
  Object.isFrozen(enhanced.artifacts) && Object.isFrozen(enhanced.artifacts[0]) &&
  Object.isFrozen(enhanced.artifacts[0].transform) && Object.isFrozen(enhanced.artifacts[0].quality));
ok("retrying the same revision is byte/manifest idempotent",
  enhanced.artifacts.map((entry) => entry.manifest_hash).join() === repeatedEnhancement.artifacts.map((entry) => entry.manifest_hash).join() &&
  store.snapshot().length === 3);
ok("enhancement refuses to skip the separated parent artifact", (await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
})).failure_code === "separation_artifact_missing");
ok("duplicate enhancement variants are rejected before persistence", (await Worker.executeProcessingJob({
  job: job("enhance"), source,
  adapters: Fake.createFakeProcessingAdapters({ duplicateEnhancementVariant: true }),
  artifactStore: Fake.createFakeImmutableArtifactStore(), completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
})).outcome === "failed");

const crossArtifact = { ...enhanced.artifacts[0], replica_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
const crossResult = await Worker.executeProcessingJob({
  job: job("transcribe"), source, adapters, artifactStore: store,
  completedSteps: dependencies.transcribe, inputArtifacts: [crossArtifact],
});
ok("worker rejects a cross-replica artifact before ASR", crossResult.outcome === "failed" && crossResult.failure_code === "cross_replica_artifact");

const transcript = await Worker.executeProcessingJob({
  job: job("transcribe"), source, adapters, artifactStore: store,
  completedSteps: dependencies.transcribe, inputArtifacts: enhanced.artifacts,
});
ok("ASR keeps transcript and language spans cited to candidate artifacts",
  transcript.outcome === "complete" && transcript.evidence.length === 4 &&
  transcript.evidence.every((entry) => entry.artifact_id && entry.input_sha256 !== SHA));

const voice = await Worker.executeProcessingJob({
  job: job("voice_quality"), source, adapters, artifactStore: store,
  completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
});
ok("voice analysis contract requires multiple embedding families and distributions",
  voice.outcome === "complete" && voice.evidence.filter((entry) => entry.evidence_type === "voice_embedding").length === 2 &&
  voice.evidence.filter((entry) => entry.evidence_type === "voice_embedding").every((entry) =>
    entry.artifact_id === enhanced.artifacts[0].artifact_id && entry.input_sha256 === enhanced.artifacts[0].sha256) &&
  voice.evidence.some((entry) => entry.evidence_type === "voice_measurement" && entry.value.input_set.length === 2));
ok("voice analysis rejects missing enhanced-input lineage", (await Worker.executeProcessingJob({
  job: job("voice_quality"), source,
  adapters: Fake.createFakeProcessingAdapters({ missingVoiceLineage: true }),
  artifactStore: store, completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
})).failure_code === "voice_lineage_missing");
ok("one embedding family is rejected as insufficient identity evidence", (await Worker.executeProcessingJob({
  job: job("voice_quality"), source,
  adapters: Fake.createFakeProcessingAdapters({ singleEmbeddingFamily: true }),
  artifactStore: store, completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
})).outcome === "failed");

{
  const acceptedArtifacts = [...separated.artifacts, ...enhanced.artifacts].map((entry) => ({ ...entry, decision: "accepted" }));
  const acceptedEvidence = [...diarization.evidence, ...voice.evidence].map((entry) => ({ ...entry, decision: "accepted" }));
  const draft = Builders.buildVoiceGenomeDraft({
    version: 1, builderVersion: "fixture-builder-v1",
    artifacts: acceptedArtifacts, evidence: acceptedEvidence,
    exclusions: ["overlap", "low-target-likelihood"],
  });
  const reordered = Builders.buildVoiceGenomeDraft({
    version: 1, builderVersion: "fixture-builder-v1",
    artifacts: [...acceptedArtifacts].reverse(), evidence: [...acceptedEvidence].reverse(),
    exclusions: ["low-target-likelihood", "overlap"],
  });
  ok("VoiceGenome source-set hash is order-independent and versioned",
    draft.source_set_hash === reordered.source_set_hash && draft.definition.schema_version === "voice-genome/v1");
  ok("VoiceGenome is portable and retains transform lineage",
    !JSON.stringify(draft.definition).includes("provider_ref") && draft.definition.references.transform_lineage.length === 3);
  ok("builder emits a draft, never an automatically approved model", draft.status === "draft" && draft.definition.calibration.status === "required");
  ok("hashed VoiceGenome definitions are deeply immutable",
    Object.isFrozen(draft.definition) && Object.isFrozen(draft.definition.references.transform_lineage));
  const fixtureOnly = Builders.voiceGenomeApprovalReadiness({
    draft, integrityVerified: true, thirdPartyCleared: true, ownerCalibrationApproved: true,
    heldOutEval: { verdict: "pass", realEvidence: true },
  });
  ok("fixture provenance can never approve a VoiceGenome", !fixtureOnly.ready && fixtureOnly.issues.includes("test_fixture_provenance"));
  let build = { build_kind: "voice_genome", state: "queued", attempt: 0, manifest_hash: "" };
  build = Builders.transitionModelBuild(build, "lease");
  build = Builders.transitionModelBuild(build, "start");
  build = Builders.transitionModelBuild(build, "submit_review", { manifest_hash: draft.manifest_hash });
  ok("versioned build state cannot approve without readiness", throws(() => Builders.transitionModelBuild(build, "approve", { readiness: fixtureOnly })));
  build = Builders.transitionModelBuild(build, "approve", { readiness: { ready: true } });
  ok("state machine can record an externally established approval verdict", build.state === "approved" && build.attempt === 1);
  ok("approved builds cannot be silently rebuilt in place", throws(() => Builders.transitionModelBuild(build, "start")));

  const profile = Builders.buildPersonProfileDraft({
    version: 1,
    builderVersion: "structured-profile-v1",
    claims: [{
      claim_id: 7, domain: "relationship", key: "friendship_origin",
      body: "Owner-reviewed fixture claim", origin: "self_declared", confidence: 0.98,
      source_ids: [SOURCE], status: "approved",
    }],
  });
  ok("person-profile builder remains structured, cited, versioned and draft-only",
    profile.status === "draft" && profile.definition.schema_version === "person-profile/v1" &&
    profile.definition.domains.relationship[0].source_ids[0] === SOURCE);
}

{
  const calls = [];
  const token = "fixed-lease-token-that-is-long-enough-for-tests";
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{ ...job("integrity"), state: "leased", lease_expires_at: "later" }];
  };
  const leased = await Queue.leaseNextProcessingJob(db, { token, leaseMs: 30_000 });
  ok("queue leases atomically with SKIP LOCKED and reclaims expired leases",
    /for update skip locked/.test(calls[0].sql) && /lease_expires_at <= now\(\)/.test(calls[0].sql) &&
    /failure_code = 'lease_expired'/.test(calls[0].sql) &&
    /join vy_replica_source s[\s\S]*s\.source_id = j\.source_id[\s\S]*s\.owner_user_id = j\.owner_user_id/.test(calls[0].sql));
  ok("raw lease capability is returned once and only its digest is persisted",
    leased.leaseToken === token && calls[0].params[0] === Queue.leaseTokenHash(token) && !calls[0].params.includes(token));
  const completionCalls = [];
  await Queue.completeProcessingJob(async (sql, params) => {
    completionCalls.push({ sql, params });
    return [{ ...job("integrity"), state: "complete" }];
  }, {
    jobId: job("integrity").job_id, leaseToken: token, adapter: integrity.adapter, result: integrity.result,
  });
  ok("completion SQL proves every artifact/evidence id belongs to the leased owner tuple",
    /vy_replica_processing_artifact/.test(completionCalls[0].sql) &&
    /vy_replica_processing_evidence/.test(completionCalls[0].sql) && /owner_user_id = j\.owner_user_id/.test(completionCalls[0].sql) &&
    /j\.lease_expires_at > now\(\)/.test(completionCalls[0].sql));
  ok("a lost lease cannot be marked complete", await throwsAsync(() => Queue.completeProcessingJob(async () => [], {
    jobId: job("integrity").job_id, leaseToken: token, adapter: integrity.adapter, result: integrity.result,
  }), "lost_processing_lease"));
}

{
  const persisted = [];
  const fakeDb = async (sql, params) => {
    persisted.push({ sql, params });
    if (sql.includes("processing_artifact")) return [{ artifact_id: params[0], manifest_hash: params[22] }];
    return [{ evidence_id: params[0], record_hash: params[15] }];
  };
  const receipt = await Repository.persistProcessingOutput(fakeDb, enhanced);
  ok("repository persists create-only immutable manifests", receipt.artifact_ids.length === 2 && persisted.every((call) => /on conflict .* do nothing/.test(call.sql)));
  ok("repository refuses to persist retry/failure output", await throwsAsync(() => Repository.persistProcessingOutput(fakeDb, badIntegrity)));
}

{
  const migration = readFileSync(join(ROOT, "db/migrations/017_replica_processing_manifests.sql"), "utf8");
  ok("migration remains split into independently applicable statements", splitSql(migration).length >= 12);
  ok("schema only permits private derived artifact paths",
    /vy_replica_artifact_derived_path[\s\S]*\/derived\/%/.test(migration) && /object_path !~ ':\/\/'/.test(migration));
  ok("schema has append-only attempt, artifact, evidence and model-build records",
    ["vy_replica_processing_attempt", "vy_replica_processing_artifact", "vy_replica_processing_evidence", "vy_replica_model_build"]
      .every((name) => migration.includes(`create table if not exists ${name}`)));
  ok("schema rejects cross-replica source, job and parent-artifact linkage",
    /vy_replica_processing_source_owner_fk[\s\S]*foreign key \(source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_source\(source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_source\(source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(created_by_job_id, source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_processing_job\(job_id, source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(parent_artifact_id, source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_processing_artifact\(artifact_id, source_id, replica_id, owner_user_id\)/.test(migration));
}

console.log(`\n${failed ? `${failed} FAILED` : "all replica-processing checks passed"}`);
process.exit(failed ? 1 : 0);
