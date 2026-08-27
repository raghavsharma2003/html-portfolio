import {
  ProcessingAdapterError,
  ProcessingContractError,
  adapterFacts,
  assertAdapter,
  assertJob,
  assertProcessingSource,
  assertSha256,
  createArtifactManifest,
  createEvidenceRecord,
  derivedArtifactPath,
  sha256Hex,
  stableUuid,
} from "./contracts.js";
import { assertDependencies, classifyProcessingFailure, nextProcessingSteps } from "./pipeline.js";
import { selectOwnerReferenceWindow } from "./reference-window.js";
import {
  beginProviderSpend,
  markProviderSpendUncertain,
  releaseProviderSpendBeforeCall,
  reserveAzureSpeechSpend,
  settleAzureSpeechSpend,
} from "../_provider-budget.js";

function sameIdentity(job, source) {
  return job.source_id === source.source_id && job.replica_id === source.replica_id && job.owner_user_id === source.owner_user_id;
}

function wholeSourceEvidence({ job, source, adapter, type, value, confidence = null, artifactId = null, inputSha256 }) {
  return createEvidenceRecord({
    replica_id: source.replica_id,
    owner_user_id: source.owner_user_id,
    source_id: source.source_id,
    artifact_id: artifactId,
    created_by_job_id: job.job_id,
    evidence_type: type,
    span: null,
    confidence,
    value,
    input_sha256: inputSha256,
    adapter,
    adapter_stage: job.step,
  });
}

function spannedEvidence({ job, source, adapter, type, value, segment, artifactId = null, inputSha256 }) {
  return createEvidenceRecord({
    replica_id: source.replica_id,
    owner_user_id: source.owner_user_id,
    source_id: source.source_id,
    artifact_id: artifactId,
    created_by_job_id: job.job_id,
    evidence_type: type,
    span: { start_ms: segment.start_ms, end_ms: segment.end_ms },
    confidence: segment.confidence,
    value,
    input_sha256: inputSha256,
    adapter,
    adapter_stage: job.step,
  });
}

function assertSegments(segments, label) {
  if (!Array.isArray(segments) || !segments.length) throw new ProcessingContractError(`${label} returned no segments`);
  for (const segment of segments) {
    if (!Number.isInteger(segment.start_ms) || segment.start_ms < 0 ||
        !Number.isInteger(segment.end_ms) || segment.end_ms <= segment.start_ms ||
        !Number.isFinite(segment.confidence) || segment.confidence < 0 || segment.confidence > 1) {
      throw new ProcessingContractError(`${label} returned an invalid segment`);
    }
  }
  return segments;
}

function inputReferences(source, inputArtifacts) {
  const references = (inputArtifacts || []).map((artifact) => {
    if (artifact.source_id !== source.source_id || artifact.replica_id !== source.replica_id ||
        artifact.owner_user_id !== source.owner_user_id || artifact.storage_bucket !== source.storage_bucket) {
      throw new ProcessingContractError("cross-replica input artifact rejected", { code: "cross_replica_artifact" });
    }
    return {
      artifact_id: artifact.artifact_id,
      storage_bucket: artifact.storage_bucket,
      sha256: assertSha256(artifact.sha256, "input artifact sha256"),
      mime: artifact.mime,
      duration_ms: artifact.duration_ms,
      object_path: artifact.object_path,
    };
  });
  return references.length ? references : [{
    artifact_id: null,
    storage_bucket: source.storage_bucket,
    object_id: source.provenance?.storage_object_id || "",
    sha256: source.sha256,
    mime: source.mime,
    duration_ms: source.duration_ms ?? null,
    object_path: source.object_path,
  }];
}

async function writeCandidates({ job, source, adapter, candidates, artifactStore, inputReferences }) {
  if (!artifactStore || typeof artifactStore.writeImmutable !== "function") {
    throw new ProcessingContractError("immutable artifact store required", { code: "missing_artifact_store" });
  }
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new ProcessingContractError("enhancement returned no candidates", { code: "empty_enhancement_candidates" });
  }
  const variants = new Set();
  const artifacts = [];
  const derivedInputs = inputReferences.filter((entry) => entry.artifact_id);
  for (const candidate of candidates) {
    if (variants.has(candidate.variant_key)) {
      throw new ProcessingContractError("enhancement candidate variants must be unique", { code: "duplicate_candidate_variant" });
    }
    variants.add(candidate.variant_key);
    const parent = candidate.parent_artifact_id
      ? inputReferences.find((entry) => entry.artifact_id === candidate.parent_artifact_id)
      : null;
    if (derivedInputs.length && !parent) {
      throw new ProcessingContractError("derived candidate must cite a known parent artifact", { code: "candidate_lineage_missing" });
    }
    const candidateInputSha = assertSha256(candidate.input_sha256 || source.sha256, "candidate input sha256");
    if (parent && candidateInputSha !== parent.sha256) {
      throw new ProcessingContractError("candidate input digest does not match its parent", { code: "candidate_lineage_mismatch" });
    }
    if (!candidate.body || (!Buffer.isBuffer(candidate.body) && !ArrayBuffer.isView(candidate.body) &&
        typeof candidate.body[Symbol.asyncIterator] !== "function")) {
      throw new ProcessingContractError("candidate must provide bytes or an async byte stream", { code: "invalid_candidate_body" });
    }
    const artifactId = stableUuid(`${job.job_id}:${job.revision}:${candidate.variant_key}`);
    const transformVersion = String(candidate.transform_version || "processing-v1");
    const objectPath = derivedArtifactPath({
      ownerUserId: source.owner_user_id,
      replicaId: source.replica_id,
      sourceId: source.source_id,
      transformVersion,
      stage: job.step,
      artifactId,
    });
    if (objectPath === source.object_path) throw new ProcessingContractError("derived output cannot replace raw evidence");
    const stored = await artifactStore.writeImmutable({
      bucket: source.storage_bucket,
      objectPath,
      body: candidate.body,
      mime: candidate.mime,
      expectedSha256: candidate.sha256,
      ifNoneMatch: "*",
    });
    const storedSha = assertSha256(stored.sha256, "stored artifact sha256");
    if (candidate.sha256 && storedSha !== assertSha256(candidate.sha256, "candidate sha256")) {
      throw new ProcessingContractError("stored candidate digest mismatch", { code: "artifact_integrity_mismatch" });
    }
    artifacts.push(createArtifactManifest({
      artifact_id: artifactId,
      replica_id: source.replica_id,
      owner_user_id: source.owner_user_id,
      source_id: source.source_id,
      parent_artifact_id: parent?.artifact_id || null,
      created_by_job_id: job.job_id,
      stage: job.step,
      variant_key: candidate.variant_key,
      storage_bucket: source.storage_bucket,
      object_path: objectPath,
      mime: stored.mime || candidate.mime,
      byte_size: stored.byteSize,
      duration_ms: candidate.duration_ms ?? null,
      sha256: storedSha,
      input_sha256: candidateInputSha,
      transform_name: candidate.transform_name || job.step,
      transform_version: transformVersion,
      parameter_hash: sha256Hex(candidate.parameters || {}),
      quality: candidate.quality || {},
      adapter,
      adapter_stage: job.step,
    }));
  }
  return artifacts;
}

// `separate` used to receive the whole recording as its one input -- see
// `inputReferences`'s fallback below, which is exactly what every OTHER step
// still gets. Measured on the owner's real 822.72 s upload: that fails the GPU
// every time (`context/measurements.md#separate-fails-on-the-whole-recording`).
//
// This builds the one input `separate` gets instead: the single highest-
// scoring ~10 s window drawn from the OWNER's own diarized speech (never the
// whole recording, never a second speaker's segments). The scoring itself is
// `api/_video-enroll/windows.js`'s `rankReferenceWindows` -- WS-AD's scorer,
// reused rather than reimplemented, exactly per this workstream's brief.
//
// The window is written to private storage as an ordinary immutable object
// (same bucket, same content-addressed shape every derived candidate uses) so
// the adapter's existing `resolveInput` + sha256 verification path needs no
// special case for it. It is NOT registered as a `vy_replica_processing_
// artifact` row: it is an INPUT this job constructs for itself, not an output
// the DAG hands to a later step, and `commitProcessingOutput`'s collision
// guard is written to expect exactly the artifact set a step's adapter
// produces. Giving the studio a way to show which window was picked is a real
// follow-up; the object path and score are on the retryable failure/complete
// path below either way, so nothing about that follow-up needs re-deriving.
async function buildOwnerReferenceWindowInput({ job, source, diarizeSegments, withMaterializedAudio, artifactStore, signal }) {
  if (typeof withMaterializedAudio !== "function") {
    throw Object.assign(new ProcessingContractError("reference window selection requires storage and ffmpeg"), {
      code: "reference_window_capability_missing",
    });
  }
  const selected = await selectOwnerReferenceWindow({
    segments: diarizeSegments,
    withMaterializedAudio,
    sourceInput: {
      source,
      input: {
        storage_bucket: source.storage_bucket, object_path: source.object_path,
        object_id: source.provenance?.storage_object_id || "", sha256: source.sha256, mime: source.mime,
        byte_size: source.byte_size,
      },
      signal,
    },
  });
  if (!selected) {
    // The owner's own cluster never holds ten contiguous seconds. Genuinely
    // rare -- diarize's own chunking already caps a single segment at 8 s, so
    // this means even ADJACENT same-speaker segments never close a 10 s run --
    // and worth a name a human can act on rather than a retry that will never
    // succeed differently.
    throw Object.assign(new ProcessingContractError("no contiguous 10s owner-speech window available"), {
      code: "reference_window_no_candidate", retryable: false,
    });
  }
  const artifactId = stableUuid(`${job.job_id}:${job.revision}:reference-window`);
  const objectPath = derivedArtifactPath({
    ownerUserId: source.owner_user_id, replicaId: source.replica_id, sourceId: source.source_id,
    transformVersion: "reference-window-v1", stage: "separate", artifactId,
  });
  const stored = await artifactStore.writeImmutable({
    bucket: source.storage_bucket, objectPath, body: selected.wavBytes, mime: "audio/wav",
    expectedSha256: sha256Hex(selected.wavBytes), ifNoneMatch: "*",
  });
  const references = [{ artifact_id: null, storage_bucket: source.storage_bucket,
    sha256: stored.sha256, mime: "audio/wav", duration_ms: selected.durationMs, object_path: objectPath }];
  return { references, selected };
}

// WS-AS, 2026-08-27. Diarize already reports how much of the recording each
// cluster holds; `shouldSkipSeparation` reads that (see reference-window.js's
// header for the threshold and its reasoning) rather than running
// `sepformer-whamr16k` unconditionally. When it says skip, the window
// `buildOwnerReferenceWindowInput` already extracted at full bandwidth IS
// `separate`'s output -- an honest identity pass-through, not a fabricated
// "separation succeeded" result. This never invokes the GPU adapter, so the
// 16 kHz Nyquist that model imposes never enters the chain for a recording
// that never had an overlapping-speaker problem for it to solve.
function passthroughSeparationCandidate({ selected, references }) {
  const input = references[0];
  return {
    variant_key: "owner-reference-passthrough",
    body: selected.wavBytes,
    sha256: sha256Hex(selected.wavBytes),
    mime: "audio/wav",
    duration_ms: selected.durationMs,
    input_sha256: input.sha256,
    transform_name: "reference-window-passthrough",
    transform_version: "reference-window-passthrough-v1",
    parameters: {
      separation_skipped: true,
      dominant_share: selected.dominantShare,
      cluster_count: selected.clusterCount,
      sample_rate: selected.sampleRate,
    },
    quality: { subject_selection_required: false, bandwidth_preserved: true },
  };
}

async function runStage({ job, source, adapter, artifactStore, inputArtifacts, diarizeSegments, withMaterializedAudio, signal, billing }) {
  let selectedReferenceWindow = null;
  const references = job.step === "separate"
    ? await (async () => {
        const built = await buildOwnerReferenceWindowInput({ job, source, diarizeSegments, withMaterializedAudio, artifactStore, signal });
        selectedReferenceWindow = built.selected;
        return built.references;
      })()
    : inputReferences(source, inputArtifacts);
  const common = { source, inputs: references, signal, billing };
  switch (job.step) {
    case "integrity": { // Server-side stream/digest implementation belongs behind this seam.
      const result = await adapter.verify(common);
      const actual = assertSha256(result?.sha256, "verified source sha256");
      if (actual !== source.sha256 || Number(result.byte_size) !== Number(source.byte_size)) {
        throw Object.assign(new ProcessingContractError("server integrity verification did not match declaration"), {
          code: "integrity_mismatch",
        });
      }
      return { artifacts: [], evidence: [], verifiedSha256: actual };
    }
    case "malware_scan": {
      const result = await adapter.scan(common);
      if (result?.safe !== true) {
        throw Object.assign(new ProcessingContractError("malware scan did not clear the source"), { code: "malware_detected" });
      }
      return { artifacts: [], evidence: [], verifiedSha256: source.sha256 };
    }
    case "media_probe": {
      const result = await adapter.probe(common);
      if (!Number.isInteger(result?.duration_ms) || result.duration_ms <= 0 || !Number.isInteger(result.sample_rate_hz)) {
        throw new ProcessingContractError("media probe returned invalid metadata");
      }
      const evidence = wholeSourceEvidence({
        job, source, adapter, type: "media_probe", inputSha256: source.sha256,
        value: {
          duration_ms: result.duration_ms,
          sample_rate_hz: result.sample_rate_hz,
          channels: result.channels,
          codec: result.codec,
        },
      });
      return { artifacts: [], evidence: [evidence], verifiedSha256: source.sha256 };
    }
    case "diarize": {
      const result = await adapter.diarize(common);
      const segments = assertSegments(result?.segments, "diarization");
      const evidence = segments.map((segment) => spannedEvidence({
        job, source, adapter, type: "speaker_segment", segment, inputSha256: source.sha256,
        value: {
          speaker_key: String(segment.speaker_key || ""),
          target_likelihood: Number(segment.target_likelihood),
          overlap: Boolean(segment.overlap),
        },
      }));
      return { artifacts: [], evidence, verifiedSha256: source.sha256 };
    }
    case "separate":
    case "enhance": {
      const method = job.step === "separate" ? "separate" : "enhance";
      if (job.step === "enhance" && !references.some((entry) => entry.artifact_id)) {
        throw new ProcessingContractError("enhancement requires a separated parent artifact", { code: "separation_artifact_missing" });
      }
      const result = job.step === "separate" && selectedReferenceWindow?.separationSkipped
        // Diarize already showed this is a single-speaker recording (or near
        // enough -- see reference-window.js#shouldSkipSeparation). The GPU
        // `sepformer-whamr16k` call never runs, so its 16 kHz Nyquist never
        // touches this reference: the full-bandwidth window becomes
        // `separate`'s output directly, honestly labelled as a pass-through
        // rather than a fabricated separation result.
        ? { candidates: [passthroughSeparationCandidate({ selected: selectedReferenceWindow, references })] }
        : await adapter[method](common);
      const artifacts = await writeCandidates({
        job, source, adapter, candidates: result?.candidates, artifactStore, inputReferences: references,
      });
      return { artifacts, evidence: [], verifiedSha256: source.sha256 };
    }
    case "transcribe": {
      const result = await adapter.transcribe(common);
      const segments = assertSegments(result?.segments, "ASR");
      const evidence = [];
      for (const segment of segments) {
        if (typeof segment.text !== "string" || !segment.text.trim() || typeof segment.language !== "string") {
          throw new ProcessingContractError("ASR segment requires text and language");
        }
        const input = references.find((ref) => ref.artifact_id === (segment.artifact_id || null)) || references[0];
        evidence.push(spannedEvidence({
          job, source, adapter, type: "transcript_span", segment, artifactId: input.artifact_id,
          inputSha256: input.sha256,
          value: { text: segment.text, language: segment.language, words: segment.words || [] },
        }));
        evidence.push(spannedEvidence({
          job, source, adapter, type: "language_span",
          segment: { ...segment, confidence: segment.language_probability ?? null }, artifactId: input.artifact_id,
          inputSha256: input.sha256,
          value: {
            language: segment.language,
            language_source: segment.language_source || "unavailable",
            language_probability: segment.language_probability ?? null,
            code_switch: typeof segment.code_switch === "boolean" ? segment.code_switch : null,
          },
        }));
      }
      return { artifacts: [], evidence, verifiedSha256: source.sha256, providerUsage: result.usage };
    }
    case "voice_quality": {
      const result = await adapter.measure(common);
      if (!Array.isArray(result?.embeddings) || result.embeddings.length < 2) {
        throw new ProcessingContractError("voice analysis requires at least two embedding families");
      }
      const evidence = [];
      const hasDerivedInputs = references.some((entry) => entry.artifact_id);
      for (const embedding of result.embeddings) {
        if (!embedding.family || !Array.isArray(embedding.vector) || !embedding.vector.length ||
            embedding.vector.some((number) => !Number.isFinite(number))) {
          throw new ProcessingContractError("voice embedding is invalid");
        }
        const measuredInput = embedding.artifact_id
          ? references.find((entry) => entry.artifact_id === embedding.artifact_id)
          : null;
        if ((hasDerivedInputs && !measuredInput) || (!hasDerivedInputs && embedding.input !== "raw")) {
          throw new ProcessingContractError("voice embedding must cite a known measured input", { code: "voice_lineage_missing" });
        }
        const inputRef = measuredInput || references[0];
        evidence.push(wholeSourceEvidence({
          job, source, adapter, type: "voice_embedding", artifactId: inputRef.artifact_id,
          inputSha256: inputRef.sha256,
          confidence: embedding.confidence,
          value: { family: embedding.family, vector: embedding.vector },
        }));
      }
      const inputSet = references.map((entry) => ({ artifact_id: entry.artifact_id, sha256: entry.sha256 }))
        .sort((a, b) => String(a.artifact_id).localeCompare(String(b.artifact_id)));
      const inputSetSha = sha256Hex({ schema_version: "voice-analysis-input-set/v1", inputs: inputSet });
      evidence.push(wholeSourceEvidence({
        job, source, adapter, type: "voice_measurement", inputSha256: inputSetSha,
        confidence: result.confidence,
        value: { input_set: inputSet, measurements: result.measurements },
      }));
      evidence.push(wholeSourceEvidence({
        job, source, adapter, type: "quality_measurement", inputSha256: inputSetSha,
        confidence: result.confidence,
        value: { input_set: inputSet, measurements: result.quality },
      }));
      return { artifacts: [], evidence, verifiedSha256: source.sha256 };
    }
    default:
      throw new ProcessingContractError(`worker does not implement ${job.step}`, { code: "unsupported_processing_stage" });
  }
}

export async function executeProcessingJob(input) {
  const job = assertJob(input.job);
  const source = assertProcessingSource(input.source);
  if (!sameIdentity(job, source)) {
    throw new ProcessingContractError("job and source ownership tuple mismatch", { code: "cross_replica_job" });
  }
  assertDependencies(job.step, input.completedSteps || []);
  const adapter = assertAdapter(input.adapters?.[job.step], job.step);
  let reservation = null;
  let providerStarted = false;
  try {
    let billing;
    if (adapter.billing?.meter === "azure_speech_audio_ms") {
      const references = inputReferences(source, input.inputArtifacts || []);
      reservation = await reserveAzureSpeechSpend(input.spendDb, {
        requestKey: `${job.job_id}:${job.revision}:${job.attempt}`,
        adapter,
        inputs: references,
        env: input.budgetEnv,
      });
      billing = Object.freeze({
        async beforeProviderRequest() {
          if (providerStarted) return;
          try { await beginProviderSpend(input.spendDb, reservation); }
          catch (error) {
            await releaseProviderSpendBeforeCall(input.spendDb, reservation, error).catch(() => null);
            throw error;
          }
          providerStarted = true;
        },
      });
    }
    const output = await runStage({
      job, source, adapter, artifactStore: input.artifactStore,
      inputArtifacts: input.inputArtifacts || [], diarizeSegments: input.diarizeSegments || [],
      withMaterializedAudio: input.withMaterializedAudio,
      signal: input.signal, billing,
    });
    let billingState = "not_metered";
    if (reservation) {
      if (!providerStarted) {
        await releaseProviderSpendBeforeCall(input.spendDb, reservation, "provider_request_not_started").catch(() => null);
        throw Object.assign(new Error("paid adapter did not start a provider request"), { code: "provider_request_not_started" });
      }
      try {
        await settleAzureSpeechSpend(input.spendDb, reservation, output.providerUsage);
        billingState = "settled";
      } catch (error) {
        await markProviderSpendUncertain(input.spendDb, reservation, error);
        throw Object.assign(new Error("provider spend requires reconciliation"), { code: "provider_spend_reconciliation_required", retryable: false });
      }
    }
    return Object.freeze({
      outcome: "complete",
      adapter: adapterFacts(adapter),
      artifacts: Object.freeze(output.artifacts),
      evidence: Object.freeze(output.evidence),
      result: {
        step: job.step,
        artifact_ids: output.artifacts.map((entry) => entry.artifact_id),
        evidence_ids: output.evidence.map((entry) => entry.evidence_id),
        next_steps: nextProcessingSteps(job.step, [...(input.completedSteps || []), job.step]),
        verified_input_sha256: output.verifiedSha256,
        billing_state: billingState,
      },
    });
  } catch (caught) {
    let error = caught;
    if (reservation && providerStarted) {
      await markProviderSpendUncertain(input.spendDb, reservation, error);
      if (error?.code !== "provider_spend_reconciliation_required") {
        error = Object.assign(new Error("provider spend requires reconciliation"), {
          code: "provider_spend_reconciliation_required",
          retryable: false,
        });
      }
    } else if (reservation) {
      await releaseProviderSpendBeforeCall(input.spendDb, reservation, error).catch(() => null);
    }
    if (!(error instanceof ProcessingContractError) && !(error instanceof ProcessingAdapterError) && !error?.code) {
      error.code = "processing_worker_error";
    }
    return Object.freeze({
      ...classifyProcessingFailure(error, job.attempt, { maxAttempts: input.maxAttempts || 5 }),
      adapter: adapterFacts(adapter),
      artifacts: [],
      evidence: [],
    });
  }
}
