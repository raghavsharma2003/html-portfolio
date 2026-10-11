// WS-R179. The listening test against the person's own voice.
//
// Two saved candidates already play, since WS-R163's `_replica-generation-
// audio.js`. Judging them without hearing the actual reference is guessing:
// the brief's own words, "a person judging two candidates without hearing
// themselves is guessing." This file serves the OTHER clip the test needs:
// the owner's own CURRENT primary voice recording, the exact original
// `api/_replica-source.js` chose with `setOwnedPrimaryVoiceSource` (`voice_
// role: primary`, migration 066's own `vy_replica_voice_reference`, one row
// per replica, `replica_id primary key` -- so "the reference" needs no
// source id from the caller, unlike a generation, because there is only
// ever one current primary to serve).
//
// Every decision lives here so the door (api/replica-source-audio.js) stays
// thin, the identical split WS-R163 already established: owner bearer only,
// bytes come from the EXACT SAME signed-read seam
// (`readPrivateReplicaObject`), watermark policy is untouched because this
// endpoint never synthesises anything -- it streams back the owner's own
// original upload, byte for byte, the same object every voice-conditioning
// and fidelity-scoring path already reads.
//
// `s.state='ready'` (never 'quarantined' or 'processing') is the same floor
// `evals/primary-voice-source/run.mjs` already proves migration 066's own
// backfill uses for "this source may drive the voice at all" -- a source
// still being scanned or transcoded is not yet safe to hand back as bytes,
// the identical reasoning WS-R163's `state='sealed'` applies to a generation.
// `s.contains_third_parties=false` is asserted again here even though
// `setOwnedPrimaryVoiceSource`'s own WHERE clause already required it at
// selection time -- defense in depth, not trust in a value that could only
// ever have been true once.
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

// The primary reference is a single, short, owner-chosen clip (the same
// class of source `_replica-source.js`'s own `comparison_reference` purpose
// already caps at 32 MiB, line 68 of that file) -- not the one-to-two-hour
// raw captures `_replica-storage.js`'s own header names as the reason its
// BUCKET ceiling is a full GiB. A primary voice source larger than this
// fails loudly with an honest error rather than the door hanging on a
// multi-hour original it was never meant to stream whole.
const MAX_REFERENCE_BYTES = 33_554_432;

// Exported so the eval suite proves the exact WHERE clause runs, the same
// "the SQL is the gate" posture `_replica-generation-audio.js` documents.
export const OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL = `select s.source_id,s.replica_id,s.owner_user_id,
          s.storage_bucket,s.object_path
     from vy_replica_voice_reference vr
     join vy_replica_source s on s.source_id=vr.source_id and s.replica_id=vr.replica_id and s.owner_user_id=vr.owner_user_id
     join vy_replica r on r.replica_id=vr.replica_id and r.owner_user_id=vr.owner_user_id
    where vr.replica_id=$1::uuid and vr.owner_user_id=$2::uuid
      and s.state='ready' and s.contains_third_parties=false
      and r.lifecycle not in ('revoked','purging')`;

/**
 * Owner bearer only. Only a replica id is named -- the current primary
 * voice reference is unique per replica by construction (migration 066's
 * `vy_replica_voice_reference.replica_id primary key`), so there is no
 * caller-suppliable source id to trust or mistrust. A caller who does not
 * own this replica, whose replica has no primary voice source selected yet,
 * or whose selected source is not `state='ready'` (still quarantined,
 * still processing, or contains a third party) all fail the SAME WHERE
 * clause with the SAME honest 404 -- never a distinguishable code an
 * attacker could use to learn whether a replica id exists at all.
 */
export async function ownedPrimaryVoiceReferenceAudio(db, ownerUserId, replicaIdInput, deps = {}) {
  const rid = exactUuid(replicaIdInput, "valid_replica_id_required");
  const owner = exactUuid(ownerUserId, "valid_owner_required");
  const rows = await db(OWNED_PRIMARY_VOICE_REFERENCE_AUDIO_SQL, [rid, owner]);
  const row = rows[0];
  if (!row) fail("reference_audio_not_available", 404);
  const readObject = deps.readObject || readPrivateReplicaObject;
  const object = await readObject(
    { storageBucket: row.storage_bucket, objectPath: row.object_path },
    { maxBytes: MAX_REFERENCE_BYTES, timeoutMs: 30_000 },
  );
  return Object.freeze({
    source_id: row.source_id,
    mime: object.mime,
    body: object.body,
    byteSize: object.byteSize,
  });
}
