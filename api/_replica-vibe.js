// EmotionOS vibe — the owner's own five-dial description of their AI's
// baseline vibe (WS-R153, migration 164). Every read and mutation includes
// owner_user_id in SQL, `api/_replica.js`'s own standing rule restated: the
// caller must pass the id `requireUser()` returned, never any identifier
// from request JSON.
//
// One live row per replica, enforced by `vy_replica_vibe_live_ix` (a
// partial unique index where `superseded_at is null`); every SET or REVERT
// supersedes the current live row and inserts a new one in the SAME
// statement, `vy_recall_run`'s own superseding-CTE shape (`_recall-run.js`'s
// `RECALL_RUN_INSERT_SQL`) restated for a table with no rate limit forcing
// every write through that shape. A REVERT never destroys a row — it reads
// an old version's own dims and inserts THEM as a new, live version, so
// "one-tap revert" is the exact same mechanism as a normal edit, and the
// owner's history stays a real, append-only ledger rather than something a
// revert could corrupt.
//
// Ownership is checked with the IDENTICAL SQL shape `_recall-run.js` and
// `_payments.js`'s `startCreatorSubscription` fix already use — literally
// the same string, so `evals/room-doors/fixtures.mjs`'s existing generic
// matcher answers it with no new fixture code (grepped before this file was
// written, not assumed).
import { replicaId } from "./_replica.js";
import { randomUUID } from "node:crypto";

const OWNERSHIP_SQL = "select replica_id from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid";

const SET_SQL = `with superseded as (
  update vy_replica_vibe v set superseded_at=now()
   where v.replica_id=$1::uuid and v.owner_user_id=$2::uuid and v.superseded_at is null
  returning v.version
)
insert into vy_replica_vibe (vibe_id,replica_id,owner_user_id,version,warmth,energy,humour,directness,formality,note)
select $3::uuid,$1::uuid,$2::uuid,coalesce((select max(version)+1 from superseded),1),$4::int2,$5::int2,$6::int2,$7::int2,$8::int2,$9::text
returning vibe_id,replica_id,owner_user_id,version,warmth,energy,humour,directness,formality,note,created_at`;

const REVERT_SQL = `with target as (
  select * from vy_replica_vibe where replica_id=$1::uuid and owner_user_id=$2::uuid and version=$3::int4
), superseded as (
  update vy_replica_vibe v set superseded_at=now()
   where v.replica_id=$1::uuid and v.owner_user_id=$2::uuid and v.superseded_at is null
  returning v.version
)
insert into vy_replica_vibe (vibe_id,replica_id,owner_user_id,version,warmth,energy,humour,directness,formality,note)
select $4::uuid,t.replica_id,t.owner_user_id,coalesce((select max(version)+1 from superseded),1),
       t.warmth,t.energy,t.humour,t.directness,t.formality,t.note
  from target t
returning vibe_id,replica_id,owner_user_id,version,warmth,energy,humour,directness,formality,note,created_at`;

const LIVE_SQL = `select vibe_id,replica_id,owner_user_id,version,warmth,energy,humour,directness,formality,note,created_at
   from vy_replica_vibe where replica_id=$1::uuid and owner_user_id=$2::uuid and superseded_at is null`;

const HISTORY_SQL = `select vibe_id,version,warmth,energy,humour,directness,formality,note,created_at,superseded_at
   from vy_replica_vibe where replica_id=$1::uuid and owner_user_id=$2::uuid
   order by version desc limit $3::int4`;

export const VIBE_HISTORY_LIMIT_DEFAULT = 20;
export const VIBE_HISTORY_LIMIT_MAX = 100;

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function dim(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 4) fail(`replica_vibe_${name}_invalid`);
  return n;
}

function noteOf(value) {
  if (value == null) return "";
  const s = String(value);
  // Array.from (not `.length`) counts code points, not UTF-16 units — the
  // same discipline `renderPublicKnowledge`'s own `validPublicKnowledgeText`
  // uses, so a two-unit emoji in a note is never refused for the wrong
  // reason and never silently truncated to a lone surrogate half.
  if (Array.from(s).length > 280) fail("replica_vibe_note_too_long");
  return s;
}

async function assertOwned(db, rid, ownerUserId) {
  const rows = await db(OWNERSHIP_SQL, [rid, ownerUserId]);
  if (!rows[0]) fail("replica_not_found", 404);
}

/** The owner's current vibe, or `null` when none has ever been set — an
 *  absent row is not an error, it is the "no vibe yet" state the compiler's
 *  own `renderVibe` already renders as nothing. */
export async function getReplicaVibe(db, ownerUserId, replicaIdValue) {
  const rid = replicaId(replicaIdValue);
  await assertOwned(db, rid, ownerUserId);
  const rows = await db(LIVE_SQL, [rid, ownerUserId]);
  return rows[0] || null;
}

/** The owner's own history, newest first, capped at `limit` (default 20,
 *  hard ceiling 100 — a screen's own "load more", never an unbounded dump). */
export async function listReplicaVibeHistory(db, ownerUserId, replicaIdValue, limit = VIBE_HISTORY_LIMIT_DEFAULT) {
  const rid = replicaId(replicaIdValue);
  await assertOwned(db, rid, ownerUserId);
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), VIBE_HISTORY_LIMIT_MAX) : VIBE_HISTORY_LIMIT_DEFAULT;
  return db(HISTORY_SQL, [rid, ownerUserId, capped]);
}

/** Both the live vibe and its recent history in one round trip — the
 *  EmotionOS screen's own single "get" op, so opening it never costs two
 *  requests for two things it always needs together. */
export async function readReplicaVibe(db, ownerUserId, replicaIdValue, limit = VIBE_HISTORY_LIMIT_DEFAULT) {
  const rid = replicaId(replicaIdValue);
  await assertOwned(db, rid, ownerUserId);
  const [live, history] = await Promise.all([
    db(LIVE_SQL, [rid, ownerUserId]),
    db(HISTORY_SQL, [rid, ownerUserId, Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(Math.floor(Number(limit)), VIBE_HISTORY_LIMIT_MAX) : VIBE_HISTORY_LIMIT_DEFAULT]),
  ]);
  return { vibe: live[0] || null, history };
}

/**
 * Sets a NEW live vibe. Never updates a row in place — always supersedes
 * the current live row (if any) and inserts a fresh one, so every edit is a
 * real entry in the owner's own history, never a silent overwrite.
 */
export async function setReplicaVibe(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  await assertOwned(db, rid, ownerUserId);
  const warmth = dim(input?.warmth, "warmth");
  const energy = dim(input?.energy, "energy");
  const humour = dim(input?.humour, "humour");
  const directness = dim(input?.directness, "directness");
  const formality = dim(input?.formality, "formality");
  const note = noteOf(input?.note);
  const vibeId = randomUUID();
  const rows = await db(SET_SQL, [rid, ownerUserId, vibeId, warmth, energy, humour, directness, formality, note]);
  if (!rows[0]) fail("replica_vibe_write_failed", 500);
  return rows[0];
}

/**
 * One-tap revert: makes an OLD version live again by copying its own dims
 * into a brand-new row (never resurrecting the old row itself, never
 * deleting anything). Reverting to a version that does not exist for THIS
 * owner+replica (including another owner's version id, which this query
 * cannot even see) is refused by name.
 */
export async function revertReplicaVibe(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  await assertOwned(db, rid, ownerUserId);
  const toVersion = Number(input?.to_version);
  if (!Number.isInteger(toVersion) || toVersion <= 0) fail("replica_vibe_version_invalid");
  const vibeId = randomUUID();
  const rows = await db(REVERT_SQL, [rid, ownerUserId, toVersion, vibeId]);
  if (!rows[0]) fail("replica_vibe_version_not_found", 404);
  return rows[0];
}
