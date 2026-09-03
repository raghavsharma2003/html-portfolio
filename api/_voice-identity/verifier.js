// The live half of the voice identity challenge (WS-R2).
//
// `api/_replica-voice-identity.js` decides. THIS file measures, and it is the
// only place in the workstream that talks to a network. The seam between them
// is the reason the whole decision is testable offline with fixtures: the
// verifier returns numbers and a string, and `decideVoiceChallenge` turns
// those into a verdict with no I/O of any kind.
//
// Two services, both already deployed and already used elsewhere in this repo:
//
//   * `services/voice-evidence` via the EXISTING processing adapter
//     (`createAzureVoiceEvidenceAdapters().voice_quality`). It embeds the
//     capture clip and returns ECAPA + x-vector. Reused rather than
//     re-implemented because that adapter already carries the two things this
//     path cannot afford to get wrong: WAKE-THEN-SIGN against a scale-to-zero
//     replica (rejected.md#hmac-skew-shorter-than-cold-start) and a signed,
//     hash-bound response envelope.
//
//   * Sarvam's SYNCHRONOUS ASR (`createSarvamSyncProvider`). Sync and not
//     batch because the challenge clip is about ten seconds: the batch lane
//     was measured at 137 s for 71 s of audio, and the sync lane at 4 134 ms
//     for 25 s with a hard 30 s cap (measurements.md#first-real-clone). Ten
//     seconds is comfortably inside that cap.
//
// ── the private-bytes rule ────────────────────────────────────────────────
// Neither service is ever handed a URL. The evidence adapter receives bytes
// this process fetched and sha256-verified through
// `createReplicaProcessingStorage().resolveInput`, and refuses a resolver
// that returns anything URL-shaped. The Sarvam provider reads the object
// itself through `readPrivateReplicaObject`. Both are the paths those modules
// already document; nothing here widens either.
import { createAzureVoiceEvidenceAdapters } from "../_replica-processing/providers/azure-voice-evidence.js";
import { createReplicaProcessingStorage } from "../_replica-processing/storage.js";
import { createSarvamSyncProvider } from "../_asr/providers/sarvam-sync.js";
import { embeddingVectors, FIDELITY_EMBEDDING_FAMILY } from "../_fidelity.js";

export const VOICE_CHALLENGE_VERIFIER_NAME = "vyakti_voice_evidence_sarvam";
export const VOICE_CHALLENGE_VERIFIER_VERSION = "voice-evidence-v1+saarika-v2.5";

function fail(code, retryable = false, status = 503) {
  throw Object.assign(new Error(code), { code, retryable, status });
}

/** A lease's source row rendered in the shape `resolveInput` scopes against.
 *  `scopedPath` requires the object path to sit under
 *  `<owner>/<replica>/<source>/` and to end in `/original`, which is exactly
 *  what `privateObjectPath` produced when the upload was authorized. */
function scopedSource(lease, side) {
  return Object.freeze({
    owner_user_id: lease.ownerUserId,
    replica_id: lease.replicaId,
    source_id: side.sourceId,
    storage_bucket: side.storageBucket,
  });
}

/**
 * @param {object} options
 *   `env`        - process.env by default.
 *   `fetchImpl`  - injected for tests.
 *   `apiKey`     - Sarvam subscription key.
 *   `evidence`   - injected voice_quality adapter (tests).
 *   `asr`        - injected ASR provider (tests).
 *   `storage`    - injected processing storage (tests).
 */
export function createVoiceChallengeVerifier(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = options.storage || createReplicaProcessingStorage({ fetchImpl });
  const evidence = options.evidence ||
    createAzureVoiceEvidenceAdapters({ env, fetchImpl, resolveInput: storage.resolveInput }).voice_quality;
  const asr = options.asr || createSarvamSyncProvider({
    apiKey: String(options.apiKey || env.SARVAM_API_KEY || ""),
    fetchImpl,
  });

  return Object.freeze({
    name: VOICE_CHALLENGE_VERIFIER_NAME,
    version: VOICE_CHALLENGE_VERIFIER_VERSION,

    async verify(lease) {
      // 1. The capture clip becomes speaker embeddings. The adapter wakes a
      //    cold evidence service on /healthz BEFORE it signs anything; if it
      //    cannot come up inside its ready budget it raises a RETRYABLE
      //    error and this challenge goes back on the queue warm for the next
      //    tick, rather than being failed for its own cold start.
      const measured = await evidence.measure({
        source: scopedSource(lease, lease.capture),
        inputs: [{
          sha256: lease.capture.sha256,
          mime: lease.capture.mime,
          object_path: lease.capture.objectPath,
          storage_bucket: lease.capture.storageBucket,
          duration_ms: null,
        }],
        signal: options.signal,
      });
      const candidateEmbeddings = embeddingVectors(measured?.embeddings, FIDELITY_EMBEDDING_FAMILY);
      if (!candidateEmbeddings.length) fail("voice_challenge_embedding_family_missing");

      // 2. The WAV becomes a transcript. A failure here is NEVER downgraded
      //    into "transcript unavailable, accept on the voice alone": that
      //    would delete the entire anti-replay argument at the exact moment a
      //    vendor is flaky, which is the shape
      //    rejected.md#plausible-return-hides-a-dead-pipeline names. It
      //    propagates, the sweep retries, and the owner is told we are still
      //    working.
      const transcript = await asr.transcribe({
        storageBucket: lease.transcript.storageBucket,
        storagePath: lease.transcript.objectPath,
        sha256: lease.transcript.sha256,
        mime: lease.transcript.mime,
        byteSize: lease.transcript.byteSize,
      }, "unknown");
      const recognizedText = (transcript?.turns || []).map((turn) => turn.text).join(" ").trim();
      if (!recognizedText) fail("voice_challenge_transcript_empty");

      return Object.freeze({
        candidateEmbeddings,
        recognizedText,
        inputSha256: lease.capture.sha256,
        transcriptInputSha256: lease.transcript.sha256,
      });
    },
  });
}

/** Configured only when both services can actually be reached. An
 *  unconfigured deployment reports `disabled` rather than leasing work it
 *  cannot finish, so a challenge is never failed because a key was missing. */
export function configuredVoiceChallengeVerifier(options = {}) {
  const env = options.env || process.env;
  if (!String(env.AZURE_VOICE_EVIDENCE_ORIGIN || "") || !String(env.AZURE_VOICE_EVIDENCE_HMAC_SECRET || "")) return null;
  if (!String(env.SARVAM_API_KEY || "")) return null;
  try {
    return createVoiceChallengeVerifier({ ...options, env });
  } catch {
    return null;
  }
}
