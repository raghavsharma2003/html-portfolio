// WS-R163. Serving a past SEALED generation's audio bytes back to its own
// owner — the other open item WS-R155 left ("no endpoint serves a past
// sealed generation's audio, so the test's players show 'not available
// yet'"). Voice quality is the most important single thing this product
// ships; a listening test whose players cannot play is not one.
//
// Every decision lives here so the door (api/replica-generation-audio.js)
// stays thin: owner bearer only, the generation must be SEALED and owned by
// the caller (both replica_id and owner_user_id are columns on
// vy_replica_generation itself, migration 025's own fence — no join is
// needed to prove ownership, only to exclude a revoked/purging replica),
// bytes come from the EXACT SAME signed-read seam api/voice-preview.js
// already uses to read a preview result back (readPrivateReplicaObject over
// {storageBucket, objectPath} taken directly off the generation row — no
// new storage locator shape, no new bucket). Only a `purpose='voice_preview'`
// generation ever carries a populated preview_result_object_path at all
// (migration 069's own `vy_replica_generation_preview_intent_shape` CHECK:
// every other purpose is constrained to '' by construction), so this
// endpoint is naturally scoped to exactly the candidates the listening test
// itself lists (`ownedVoiceLikenessSummary`'s own `listening_candidates`,
// api/_replica-voice-preview.js) without a second purpose filter needing to
// be trusted to stay in sync with that CHECK by hand.
//
// Watermark policy is untouched: this endpoint never re-synthesises,
// re-encodes or strips anything — it streams back the exact sealed bytes
// `storeVoicePreviewResult` (api/voice-preview.js) wrote once, watermark
// already baked in at synthesis time.
import { readPrivateReplicaObject } from "./_replica-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, status = 404) {
  throw Object.assign(new Error(code), { code, status });
}

function exactUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code, 400);
  return id;
}

// Exported so the eval suite can prove the exact WHERE clause without
// duplicating it by hand (the same "the SQL is the gate" posture
// api/_replica-runtime.js's own activation query documents).
export const OWNED_SEALED_GENERATION_AUDIO_SQL = `select g.generation_id,g.replica_id,g.owner_user_id,
          g.preview_result_storage_bucket,g.preview_result_object_path
     from vy_replica_generation g
     join vy_replica r on r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
    where g.generation_id=$1::uuid and g.replica_id=$2::uuid and g.owner_user_id=$3::uuid
      and g.state='sealed' and g.purpose='voice_preview'
      and g.preview_result_object_path<>'' and g.preview_result_deleted_at is null
      and r.lifecycle not in ('revoked','purging')`;

/**
 * Owner bearer only (the door's own requireUser boundary), a specific
 * replica and a specific generation both named explicitly (never inferred
 * from "the latest one") -- so a caller who does not own this replica, or
 * names a generation that belongs to someone else's replica, a generation
 * that is not sealed, or one whose stored result has already been swept by
 * api/_voice-preview-result-cleanup.js, all fail the SAME WHERE clause with
 * the SAME honest 404 rather than a distinguishable 403/410 an attacker
 * could use to enumerate other owners' generation ids.
 */
export async function ownedSealedGenerationAudio(db, ownerUserId, replicaIdInput, generationIdInput, deps = {}) {
  const rid = exactUuid(replicaIdInput, "valid_replica_id_required");
  const gid = exactUuid(generationIdInput, "valid_generation_id_required");
  const owner = exactUuid(ownerUserId, "valid_owner_required");
  const rows = await db(OWNED_SEALED_GENERATION_AUDIO_SQL, [gid, rid, owner]);
  const row = rows[0];
  if (!row) fail("generation_audio_not_available", 404);
  const readObject = deps.readObject || readPrivateReplicaObject;
  const object = await readObject(
    { storageBucket: row.preview_result_storage_bucket, objectPath: row.preview_result_object_path },
    { maxBytes: 20 * 1024 * 1024, timeoutMs: 30_000 },
  );
  return Object.freeze({
    generation_id: row.generation_id,
    mime: object.mime,
    body: object.body,
    byteSize: object.byteSize,
  });
}
