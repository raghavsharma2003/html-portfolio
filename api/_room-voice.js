// The Room's voice — the glue between a paid follower's "speak this reply"
// and the EXISTING, real voice-preview corridor (WS-R19).
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THIS REUSES `beginOwnedVoicePreview` RATHER THAN A NEW AUTHORIZATION
// ═════════════════════════════════════════════════════════════════════════
//
// The brief for this workstream names `api/_clonechannel.js`'s `voiceEngine`
// as one of the places to look for "how the studio preview and the clone
// channels synthesize". That symbol does not exist — grepped, not assumed
// (AGENTS.md's "grep for a CALLER, not a definition" applies exactly as hard
// to a pointer as to a claim). What DOES exist, and what this file actually
// reuses, is `api/_replica-voice-preview.js`'s `beginOwnedVoicePreview` — the
// SQL fence behind the studio's "Preview my voice" panel
// (`api/_voice/preview-panel.js`) and behind the Mirror Call's own reuse of
// it (`context/rejected.md#mirror-call-channel-in-the-generation-ledger`,
// WS-AC's own decision NOT to fork the watermark/ledger path by widening
// migration 019's `channel` CHECK, choosing reuse of
// `purpose='voice_preview'`/`channel='studio_preview'` instead).
//
// Two hard constraints make that the ONLY schema-compatible choice here too,
// not merely the precedent-consistent one:
//
//   1. Migration 045's `vy_replica_generation_preview_shape` CHECK ties
//      `preview_model_commitment` — the ONE column drift watch's swap
//      detector reads (`api/_drift-watch.js`'s `GENERATION_COMMITMENTS_SQL`,
//      filtered to `purpose='voice_preview' and channel='studio_preview'`) —
//      to that exact (purpose, channel) pair. A `private_conversation`/
//      `private_chat` row is FORBIDDEN by the same CHECK from ever carrying a
//      commitment hash at all (`preview_model=''` and
//      `preview_model_commitment=''` in that branch). So "a Room voice reply
//      must write the same ledger row shape the preview lane writes, so a
//      swap in the Room is noticed by the same sweep" (this workstream's own
//      law 4) is not satisfiable any other way without a schema change this
//      workstream was not asked to make.
//
//   2. `beginOwnedVoicePreview`'s fifteen-precondition CTE is the real,
//      already-shipped test of "has this creator actually built and
//      consented to a synthesizable voice" — a draft VoiceGenome, a selected
//      enhance-stage reference, identity/liveness/consent all live. Rebuilding
//      a second, weaker version of that test for the Room would be exactly
//      the failure this repo's whole open problem warns about: a Room that
//      could speak in a voice nobody actually consented to or finished
//      building.
//
// `ownerUserId` passed below is always `resolved.room.owner_user_id` —
// derived server-side from the resolved room row, never accepted from the
// follower who triggered the call. That is the identical trust shape
// `api/_voice/preview-panel.js` already relies on for the owner's OWN click;
// here the "owner" of the generation is the CREATOR whose Room is answering,
// regardless of who is standing in front of the door.
//
// ═════════════════════════════════════════════════════════════════════════
// NO GPU WAKES
// ═════════════════════════════════════════════════════════════════════════
//
// Nothing in this file calls a provider or a protection adapter. `deps.synth`
// and `deps.protect` are supplied by the caller (api/_room-surface.js's
// `roomSpeak`) exactly the way `api/voice-preview.js` supplies
// `createOpenChatterboxPreviewProvider()`/`protectReplicaStream` to
// `handleVoicePreviewPanel` — the SAME real modules, reused, never a fork —
// but this workstream never constructs that real wiring's default in a path
// this session executes: the eval fakes both, and `api/room.js`'s real
// handler (wired to the same real modules `api/voice-preview.js` already
// uses) 503s with a named "not configured" code in THIS environment, exactly
// as `api/voice-preview.js` already does with no `AZURE_OPEN_VOICE_ORIGIN`
// set — never a live GPU call, proven by the same absence that already
// protects the studio panel.
import { randomUUID } from "node:crypto";
import { beginOwnedVoicePreview, cleanVoicePreviewText, voicePreviewTextHash } from "./_replica-voice-preview.js";
import { buildVoiceTextPlan, voiceTextPlanAudit } from "./_voice/hindi-text-frontend.js";
import { voiceScriptMode } from "./_voice/language-conditioning.js";

/** `faithful` over the panel's own `balanced` default: the whole point of a
 *  Room voice reply is identity, not performance — DEFAULT_VOICE_PREVIEW_STYLE
 *  (`identity_anchor`) is reserved for the Meet-step "does this sound like
 *  me" question and is deliberately not reused here, since a Room reply is
 *  conversational rather than a calibration probe. */
export const ROOM_VOICE_STYLE_KEY = "faithful";

/** A deterministic, pre-synthesis clip-length ESTIMATE, in whole seconds,
 *  from the text alone — `roomSay`'s cap law restated for voice: "spent
 *  BEFORE the model call and not after ... charging first costs a follower
 *  one message on a genuine platform failure, which is the error the
 *  platform can afford to be wrong about." Voice needs a number before any
 *  audio exists to measure, so the estimate IS the number the predicate
 *  spends and the number the usage row records — never re-estimated at
 *  display time (law 5: every number shown is real, from the row). 13
 *  characters/second is a plain mid-pace speaking-rate approximation (roughly
 *  160-170 wpm at ~5.5 characters/word), rounded up so the estimate never
 *  UNDER-charges a real clip — the safe direction for a ceiling. */
export const ROOM_VOICE_CHARS_PER_SECOND = 13;
export const ROOM_VOICE_CLIP_SECONDS_MIN = 1;
export const ROOM_VOICE_CLIP_SECONDS_MAX = 120;

export function estimateClipSeconds(text) {
  const len = Array.from(cleanVoicePreviewText(text)).length;
  const raw = Math.ceil(len / ROOM_VOICE_CHARS_PER_SECOND);
  return Math.max(ROOM_VOICE_CLIP_SECONDS_MIN, Math.min(ROOM_VOICE_CLIP_SECONDS_MAX, raw));
}

const LATEST_DRAFT_GENOME_SQL = `select max(g.version)::int4 as version
   from vy_replica_voice_genome g
  where g.replica_id = ($1)::uuid and g.status = 'draft'`;

/** The creator's current draft VoiceGenome version, or null. One simple,
 *  narrow read — never the fifteen-precondition CTE itself, which
 *  `beginOwnedVoicePreview` owns and re-verifies regardless of what this
 *  returns. A Room reply has no studio panel asking the owner which version
 *  to preview, so "the newest draft" is the only version a follower's click
 *  could ever mean. */
export async function latestDraftGenomeVersion(db, replicaId) {
  const rows = await db(LATEST_DRAFT_GENOME_SQL, [String(replicaId)]);
  const version = Number(rows[0]?.version);
  return Number.isInteger(version) && version > 0 ? version : null;
}

function fail(code, status, details) {
  return Object.assign(new Error(code), { code, status, details });
}

/**
 * Authorize one Room voice generation, reusing `beginOwnedVoicePreview`
 * exactly. Returns its result unchanged (`generation`, `authorizationInput`,
 * `previewStyle`, `previewSeed`, `reference`, ...) — `roomSpeak` reads it the
 * same way `api/_voice/preview-panel.js` reads `started`.
 *
 * Every refusal from the real fence is translated to a NAMED, room-facing
 * code rather than passed through raw: a follower must never see
 * `voice_preview_*` language built for a studio owner's own panel, and the
 * blocker split (`waiting on you` / `waiting on us`) still applies — a Room
 * whose creator has not finished building a voice is "us", never a fault of
 * the follower who asked to hear it.
 */
// ═════════════════════════════════════════════════════════════════════════
// WS-R110: a CONTAINER for the SAME bytes, never a second synthesis path
// ═════════════════════════════════════════════════════════════════════════
//
// `roomSpeak` returns raw `pcm_s16le` samples with no container at all
// (`VOICE_PCM_FORMAT`, api/_voice/contracts.js) — the shape the web Room's
// own client already assumes when it builds `data:audio/wav;base64,...`
// (src/room/RoomApp.tsx), which a browser's `<audio>` element tolerates far
// more permissively than a dedicated Bot API client does. Telegram's
// `sendVoice` needs an actual audio FILE, not a bare sample stream, so this
// wraps the exact same bytes in a minimal, standard 44-byte WAV header —
// deterministic, lossless, and never touching a single sample: any
// watermark verification that walks PAST byte 44 sees precisely the bytes
// `protectReplicaStream` produced, untouched. This is a container, not a
// re-encode — `roomSay`/`roomSpeak`'s own law ("never a second synthesis
// path") is about NOT calling a model or a provider a second time, and
// nothing here does either.
export function pcmToWavBuffer(pcm, format = {}) {
  const numChannels = Number(format.channels) > 0 ? Number(format.channels) : 1;
  const sampleRate = Number(format.sampleRate) > 0 ? Number(format.sampleRate) : 24_000;
  const bitsPerSample = 16; // pcm_s16le — VOICE_PCM_FORMAT's own, only, encoding
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt sub-chunk size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM, no compression
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

export async function authorizeRoomVoice(db, ownerUserId, { replicaId, text, traceId } = {}) {
  const cleaned = cleanVoicePreviewText(text);
  const genomeVersion = await latestDraftGenomeVersion(db, replicaId);
  if (!genomeVersion) throw fail("room_voice_not_built_yet", 409, { blocker: "us" });

  const scriptMode = voiceScriptMode(cleaned).mode;
  const languageId = scriptMode === "devanagari" || scriptMode === "mixed" ? "hi" : "en";
  const textHash = voicePreviewTextHash(cleaned);
  let plan;
  try {
    plan = buildVoiceTextPlan({ text: cleaned, languageId });
  } catch (error) {
    throw fail("room_voice_text_invalid", 400, { reason: error?.code || error?.message });
  }
  const textFrontend = voiceTextPlanAudit(plan);

  try {
    return await beginOwnedVoicePreview(db, ownerUserId, {
      replica_id: replicaId,
      genome_version: genomeVersion,
      trace_id: traceId || `room_${randomUUID().replaceAll("-", "")}`,
      language_id: languageId,
      text_hash: textHash,
      text_language_mode: scriptMode,
      text_frontend: textFrontend,
      style_key: ROOM_VOICE_STYLE_KEY,
    });
  } catch (error) {
    // Every refusal from the real fence — consent withdrawn, no ready
    // source, no selected reference, an unbuilt genome the SQL itself could
    // not see from `latestDraftGenomeVersion`'s narrower read — collapses to
    // one honest, "us"-classed code. Distinguishing them to a follower would
    // let a stranger enumerate exactly how far a creator's own voice-cloning
    // pipeline has gotten, which is the creator's business, not theirs
    // (`api/_clonechannel.js`'s own indistinguishable-refusal law, one voice
    // lane over).
    throw fail("room_voice_unavailable", 503, {
      blocker: error?.blockerClass || "us",
      reason: error?.code || String(error?.message || "unknown"),
    });
  }
}
