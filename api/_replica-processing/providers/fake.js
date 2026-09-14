import { ProcessingAdapterError, assertSha256, sha256Hex } from "../contracts.js";

const META = Object.freeze({ name: "deterministic-fake", version: "0-test" });

function bytesFor(...parts) {
  return Buffer.from(`FAKE-NOT-AUDIO\n${parts.join("\n")}`, "utf8");
}

function candidate(source, variantKey, quality, input = null) {
  const inputSha = input?.sha256 || source.sha256;
  const body = bytesFor(source.source_id, inputSha, variantKey);
  return {
    variant_key: variantKey,
    body,
    sha256: sha256Hex(body),
    mime: "audio/wav",
    duration_ms: Number(source.duration_ms || 24_000),
    input_sha256: inputSha,
    parent_artifact_id: input?.artifact_id || null,
    transform_name: "fixture-enhancement",
    transform_version: "fixture-v1",
    parameters: { fixture: true, variant: variantKey },
    quality,
  };
}

export function createFakeProcessingAdapters(options = {}) {
  const calls = new Map();
  const maybeFail = (stage) => {
    const count = (calls.get(stage) || 0) + 1;
    calls.set(stage, count);
    if (options.failOnceStage === stage && count === 1) {
      throw new ProcessingAdapterError(`fixture transient failure at ${stage}`, {
        code: `fixture_${stage}_transient`,
        retryable: true,
      });
    }
  };
  const metadata = (family) => ({ family, ...META });
  return Object.freeze({
    integrity: Object.freeze({
      ...metadata("integrity"),
      async verify({ source }) {
        maybeFail("integrity");
        return {
          sha256: options.corruptIntegrity ? "0".repeat(64) : source.sha256,
          byte_size: Number(source.byte_size),
          sniffed_mime: source.mime,
        };
      },
    }),
    malware_scan: Object.freeze({
      ...metadata("malware"),
      async scan() {
        maybeFail("malware_scan");
        return { safe: !options.malwareDetected, signatures: [] };
      },
    }),
    media_probe: Object.freeze({
      ...metadata("media-probe"),
      async probe({ source }) {
        maybeFail("media_probe");
        return {
          duration_ms: Number(source.duration_ms || 24_000),
          sample_rate_hz: 48_000,
          channels: 1,
          codec: "fixture-pcm",
        };
      },
    }),
    diarize: Object.freeze({
      ...metadata("diarization"),
      async diarize({ source }) {
        maybeFail("diarize");
        if (options.invalidDiarization) return { segments: [{ start_ms: 10, end_ms: 5 }] };
        const duration = Number(source.duration_ms || 24_000);
        const split = Math.max(1, Math.floor(duration * 0.72));
        const segments = [{
          start_ms: 0,
          end_ms: split,
          speaker_key: "subject-candidate",
          confidence: 0.91,
          target_likelihood: 0.88,
          overlap: false,
        }];
        if (source.contains_third_parties) segments.push({
          start_ms: split,
          end_ms: duration,
          speaker_key: "other-speaker",
          confidence: 0.82,
          target_likelihood: 0.12,
          overlap: false,
        });
        return { segments };
      },
    }),
    separate: Object.freeze({
      ...metadata("separation"),
      async separate({ source }) {
        maybeFail("separate");
        return { candidates: [candidate(source, "foreground", { fixture_score: 0.61 })] };
      },
    }),
    enhance: Object.freeze({
      ...metadata("enhancement"),
      async enhance({ source, inputs }) {
        maybeFail("enhance");
        const parent = inputs.find((entry) => entry.artifact_id) || null;
        if (options.duplicateEnhancementVariant) {
          return { candidates: [candidate(source, "balanced", {}, parent), candidate(source, "balanced", {}, parent)] };
        }
        return { candidates: [
          candidate(source, "identity-preserving", { fixture_score: 0.57, aggressiveness: 0.2 }, parent),
          candidate(source, "noise-suppressing", { fixture_score: 0.63, aggressiveness: 0.7 }, parent),
        ] };
      },
    }),
    transcribe: Object.freeze({
      ...metadata("asr"),
      async transcribe({ source, inputs }) {
        maybeFail("transcribe");
        if (options.invalidAsr) return { segments: [{ start_ms: 0, end_ms: 100, confidence: 0.8, text: "" }] };
        return { segments: inputs.map((input, index) => ({
          artifact_id: input.artifact_id,
          start_ms: 0,
          end_ms: Math.min(Number(input.duration_ms || source.duration_ms || 24_000), 12_000),
          confidence: 0.87 - index * 0.01,
          text: `deterministic fixture transcript ${index + 1}`,
          language: index % 2 ? "hi-Latn" : "en-IN",
          code_switch: index % 2 === 1,
          words: [
            { text: "deterministic", start_ms: 0, end_ms: 400, confidence: 0.9 },
            { text: "fixture", start_ms: 410, end_ms: 710, confidence: 0.88 },
          ],
        })) };
      },
    }),
    voice_quality: Object.freeze({
      ...metadata("voice-analysis"),
      async measure({ inputs }) {
        maybeFail("voice_quality");
        const measured = inputs[0];
        const lineage = options.missingVoiceLineage
          ? {}
          : measured.artifact_id ? { artifact_id: measured.artifact_id } : { input: "raw" };
        const embeddings = options.singleEmbeddingFamily ? [
          { ...lineage, family: "fixture-family-a", vector: [0.12, -0.31, 0.55], confidence: 0.8 },
        ] : [
          { ...lineage, family: "fixture-family-a", vector: [0.12, -0.31, 0.55], confidence: 0.8 },
          { ...lineage, family: "fixture-family-b", vector: [-0.24, 0.44, 0.19], confidence: 0.78 },
        ];
        return {
          embeddings,
          confidence: 0.74,
          measurements: {
            pitch_hz: { median: 184, p10: 132, p90: 246 },
            energy_db: { median: -21, p10: -33, p90: -11 },
            speaking_rate_syllables_s: { median: 4.2, p10: 3.1, p90: 5.6 },
            pause_ms: { median: 260, p90: 710 },
            rhythm: { phrase_ms_median: 1820, phrase_final_lengthening_ratio: 1.18 },
            phrase_boundaries: { per_minute: 18.2 },
            paralinguistics: { laugh_rate_per_minute: 0.4, breath_rate_per_minute: 5.1 },
            language: { primary: "en-IN", observed: ["en-IN", "hi-Latn"], code_switch_rate: 0.17 },
            accent: { self_label_required: true, fixture_cluster: "en-in-fixture" },
          },
          quality: { snr_db_fixture: 11.4, clipping_ratio: 0.001, usable_target_speech_ms: 17_280 },
        };
      },
    }),
  });
}

async function collect(body) {
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createFakeImmutableArtifactStore() {
  const objects = new Map();
  return Object.freeze({
    async writeImmutable({ bucket, objectPath, body, mime, expectedSha256, ifNoneMatch }) {
      if (ifNoneMatch !== "*") throw new Error("fixture store requires create-only writes");
      if (objectPath.endsWith("/original") || !objectPath.includes("/derived/") || objectPath.includes("://")) {
        throw new Error("fixture store rejected a non-derived path");
      }
      const bytes = await collect(body);
      const sha256 = sha256Hex(bytes);
      if (expectedSha256 && sha256 !== assertSha256(expectedSha256, "expected artifact sha256")) {
        throw Object.assign(new Error("fixture artifact digest mismatch"), { code: "artifact_integrity_mismatch" });
      }
      const key = `${bucket}/${objectPath}`;
      const existing = objects.get(key);
      if (existing && existing.sha256 !== sha256) {
        throw Object.assign(new Error("immutable artifact collision"), { code: "immutable_artifact_collision" });
      }
      const record = Object.freeze({ sha256, byteSize: bytes.length, mime });
      if (!existing) objects.set(key, record);
      return existing || record;
    },
    snapshot() {
      return [...objects.entries()].map(([key, value]) => ({ key, ...value }));
    },
  });
}
