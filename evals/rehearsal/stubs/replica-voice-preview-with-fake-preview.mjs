// WS-R119 (wave seventeen, third pass). `../loader.mjs` redirects any
// relative import ending in `_replica-voice-preview.js` here. Two of that
// real file's exports are overridden:
//
//   `beginOwnedVoicePreview` — the fifteen-precondition CTE
//   (`api/_replica-voice-preview.js`'s own header: "the ONLY schema-
//   compatible choice", never re-derived) that a Room voice reply's
//   `authorizeRoomVoice` (api/_room-voice.js, itself unmodified and
//   unredirected) calls through THIS relative specifier. No fixture in this
//   repo reproduces those fifteen preconditions (three consent scopes, four
//   identity checks, source readiness, a draft genome, a selected `enhance`
//   artifact, ...) — every existing suite that reaches `roomSpeak`
//   (`evals/room-telegram-voice/run.mjs`, `evals/room-paid-tier/run.mjs`)
//   injects `deps.authorize` directly INSTEAD of driving this real function,
//   which the real HTTP door (`api/room-tg.js`) never allows a caller to do
//   (`buildRoomVoiceDeps` supplies no `authorize` override at all). This
//   stub is what makes "a Telegram voice reply rehearsed... through the real
//   lane" reachable through the REAL door rather than only through a direct
//   function call — see `context/rejected.md#ws-r119-fifteen-precondition-
//   voice-preview-cte-not-reproduced-in-a-fixture` for why reproducing the
//   real CTE in `evals/room-doors/fixtures.mjs` instead was rejected.
//
//   `createNeonVoicePreviewLedger` — the real one issues real SQL against
//   `vy_replica_generation` for a `generation_id` this stub's own
//   `beginOwnedVoicePreview` never actually inserted (it returns a
//   fabricated row, not a real one), so the real ledger's own `update ...
//   where g.generation_id=$1` would match zero rows and fail closed. The
//   fake ledger below is in-memory only.
//
// Every other real export (`voicePreviewStyle`, `cleanVoicePreviewText`,
// `voicePreviewTextHash`, `voicePreviewTextMode`, `voicePreviewMatchedSeed`,
// `DEFAULT_VOICE_PREVIEW_STYLE`, `markVoicePreviewFailed`,
// `voicePreviewReceiptCommitment`) is re-exported unchanged, so
// `authorizeRoomVoice`'s own text-cleaning/hashing/style-resolution calls
// stay the real, shipping logic — only the DATABASE-BACKED authorization and
// ledger are faked.
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_replica-voice-preview.js")).href;
const REAL = await import(REAL_URL);
const CONTRACTS_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_provenance", "contracts.js")).href;
const { assertVoicePreviewAuthorization, PROVENANCE_POLICY } = await import(CONTRACTS_URL);
const REPLICA_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_replica.js")).href;
const { REPLICA_POLICY_VERSION } = await import(REPLICA_URL);
const LANG_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_voice", "language-conditioning.js")).href;
const { voiceLanguageConditioning } = await import(LANG_URL);

export const {
  DEFAULT_VOICE_PREVIEW_STYLE, voicePreviewStyle, cleanVoicePreviewText,
  voicePreviewTextHash, voicePreviewTextMode, voicePreviewMatchedSeed,
  markVoicePreviewFailed, voicePreviewReceiptCommitment,
} = REAL;

const SHA256_64 = "b".repeat(64);

/**
 * A fixed, always-eligible "creator has finished building a voice"
 * authorization — no `db` read at all (the first param is accepted, never
 * touched, so a caller passing the real fixture `db` still works). Built
 * from `input` alone, then self-checked through the REAL
 * `assertVoicePreviewAuthorization` (imported unmodified above) so a future
 * tightening of that validator fails THIS fake loudly rather than silently
 * drifting from what the real fence actually demands.
 */
export async function beginOwnedVoicePreview(_db, ownerUserId, input) {
  const rid = String(input?.replica_id || "");
  const genomeVersion = Number.isInteger(Number(input?.genome_version)) && Number(input?.genome_version) > 0
    ? Number(input.genome_version) : 1;
  const traceId = String(input?.trace_id || "");
  const languageId = String(input?.language_id || "en").toLowerCase();
  const previewStyle = voicePreviewStyle(input?.style_key);
  const previewSeed = input?.preview_seed == null ? 1 : Number(input.preview_seed);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
  const generationId = randomUUID();
  const artifactId = randomUUID();
  const sourceId = randomUUID();

  const authorizationInput = {
    request: {
      generationId, replicaId: rid, ownerUserId: String(ownerUserId),
      channel: "studio_preview", purpose: "voice_preview",
      policyVersion: PROVENANCE_POLICY, traceId,
    },
    replica: {
      replica_id: rid, owner_user_id: String(ownerUserId), subject_mode: "self", lifecycle: "active",
      policy_version: REPLICA_POLICY_VERSION,
      age_verified_at: now, identity_verified_at: now, liveness_verified_at: now,
      identity_expires_at: expires,
    },
    inferenceConsent: {
      consent_id: randomUUID(), replica_id: rid, owner_user_id: String(ownerUserId),
      scope: "inference", policy_version: REPLICA_POLICY_VERSION,
      granted_at: now, expires_at: null, revoked_at: null,
    },
    voiceGenome: { replica_id: rid, version: genomeVersion, status: "draft" },
    previewArtifact: {
      artifact_id: artifactId, replica_id: rid, owner_user_id: String(ownerUserId),
      source_id: sourceId, stage: "enhance", selection_decision: "selected",
      source_state: "ready", contains_third_parties: false, sha256: SHA256_64,
    },
  };
  // Throws the REAL named code (e.g. `identity_verification_incomplete`) if
  // this fabricated shape ever stops satisfying the real validator — never
  // silently wrong.
  const authorization = assertVoicePreviewAuthorization(authorizationInput);

  const referenceLanguageEvidenceScope = "source_transcript";
  const voiceConditioning = voiceLanguageConditioning({
    languageId,
    referenceLanguageMode: "latin_only",
    referenceLanguageEvidenceScope,
    textLanguageMode: String(input?.text_language_mode || "unknown"),
    requestedCfgWeight: previewStyle.cfg_weight,
    disclosureLanguageId: input?.text_frontend?.disclosureLanguage,
  });

  return Object.freeze({
    generation: { generation_id: generationId, replica_id: rid, owner_user_id: String(ownerUserId) },
    authorizationInput,
    authorization,
    previewStyle,
    previewSeed,
    voiceConditioning,
    reference: Object.freeze({
      artifactId, sourceId,
      storageBucket: "rehearsal-fake-bucket", objectPath: `rehearsal/${artifactId}.wav`,
      mime: "audio/wav", byteSize: 4096, durationMs: 4000, sha256: SHA256_64,
      languageMode: voiceConditioning.referenceLanguageMode,
      languageEvidenceScope: referenceLanguageEvidenceScope,
      transcriptSpanCount: 1, devanagariChars: 0, latinChars: 40,
    }),
  });
}

/** In-memory only — see this file's own header for why the real, SQL-backed
 *  ledger cannot be reused against a `beginOwnedVoicePreview` that never
 *  inserted a real `vy_replica_generation` row. */
export function createNeonVoicePreviewLedger(_db) {
  return Object.freeze({
    name: "rehearsal-voice-preview-ledger",
    async open() {}, async appendSegment() {}, async seal() {}, async abort() {},
  });
}
