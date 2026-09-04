// The creator funnel: "minutes to first Room", and where creators stall
// (WS-R25, migration 088 / `vy_replica_funnel_mark`).
//
// ── law 1: content-free, read from the tables that already know ───────────
//
// Every timestamp below is read from the table that already owns it, with a
// select scoped to ONE replica (`where replica_id = $1 and owner_user_id =
// $2`) - never a source's text, never a follower's name, never a duplicate
// column. The only two moments no table knows are the studio wizard's mount
// and the Publish click (as distinct from the write it triggers); those two
// live in `vy_replica_funnel_mark`, written by `markStep` below and by
// nothing else.
//
// ── law 2: aggregate-only wherever this file touches a follower table ─────
//
// `first_follower_joined` is the one read here that names `vy_room_follower`,
// and it is admitted to `evals/room-leak/run.mjs`'s AGGREGATE_ONLY class
// (that file's own header names the rule): scoped to ONE room by
// `where room_id = ($1)::uuid`, never grouped across rooms, select list
// nothing but `min(joined_at)` - a follower's id, thread or words never leave
// this file.
import { replicaId as validReplicaId } from "./_replica.js";

const MARK_STEPS = Object.freeze(["studio_opened", "publish_clicked"]);

/** The funnel's own order. `studio_opened` sits right after account
 *  creation (the wizard mount is usually the very next thing a creator
 *  does); `publish_clicked` sits immediately before `room_published` (the
 *  click and the write it triggers are two different instants -
 *  `api/_room-publish.js`'s gate can refuse the write, so a click with no
 *  matching publish is a real, common shape, not a bug in this list). */
export const FUNNEL_STEPS = Object.freeze([
  "account_created",
  "studio_opened",
  "first_source_uploaded",
  "processing_finished",
  "first_preview_heard",
  "readiness_first_measured",
  "readiness_passed_lock",
  "disclosure_approved",
  "room_created",
  "publish_clicked",
  "room_published",
  "first_follower_joined",
]);

function iso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Owner-authenticated op: mark one of the two studio-only funnel moments for
 * one replica. First write wins (`on conflict (replica_id, step) do
 * nothing`); a second mount or a second click never moves the number.
 *
 * Ownership is the row source of the INSERT itself (`from owned`, gated by
 * `replica_id = $1 and owner_user_id = $2`) rather than a JS check before or
 * after a separate write - the same "predicate inside the statement" shape
 * `api/_replica.js`'s invite gate and `api/_room-publish.js`'s publish lock
 * both use. A mark for a replica this caller does not own therefore inserts
 * ZERO rows, in the SAME statement that would have written it: refused
 * before any write, never after one.
 */
export async function markStep(db, ownerUserId, replicaId, step) {
  if (typeof db !== "function") throw new Error("funnel_mark_database_required");
  if (!MARK_STEPS.includes(step)) {
    throw Object.assign(new Error("unknown_funnel_step"), { status: 400, code: "unknown_funnel_step" });
  }
  const rid = validReplicaId(replicaId);
  const rows = await db(
    `with owned as (
       select replica_id, owner_user_id from vy_replica
        where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
     ), inserted as (
       insert into vy_replica_funnel_mark (replica_id, owner_user_id, step, at)
       select replica_id, owner_user_id, ($3)::text, now() from owned
       on conflict (replica_id, step) do nothing
       returning at
     )
     select
       (select count(*) from owned)::int as owned,
       (select at from vy_replica_funnel_mark
         where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid and step = ($3)::text
         limit 1) as at`,
    [rid, ownerUserId, step],
  );
  const row = rows[0];
  if (!row || !Number(row.owned)) {
    throw Object.assign(new Error("replica_not_found"), { status: 404, code: "replica_not_found" });
  }
  return { step, at: iso(row.at) };
}

/**
 * The ordered funnel for ONE replica: every timestamp above, each read from
 * its own table with a scoped select. Returns `null` when the replica is not
 * this owner's, the same "null means not yours" shape `getOwnedReplica`
 * uses, so a stranger cannot tell an existing replica from a missing one.
 */
export async function replicaFunnel(db, replicaId, ownerUserId) {
  if (typeof db !== "function") throw new Error("funnel_database_required");
  const rid = validReplicaId(replicaId);
  const [replica] = await db(
    `select replica_id, owner_user_id, agent_id, created_at
       from vy_replica
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
      limit 1`,
    [rid, ownerUserId],
  );
  if (!replica) return null;

  const [sourceRows, processingRows, previewRows, readinessFirstRows, readinessPassedRows, sheetRows, marks, roomRows] =
    await Promise.all([
      db(
        `select min(created_at) as at from vy_replica_source
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid`,
        [rid, ownerUserId],
      ),
      // The DAG's own terminal step (AUDIO_PROCESSING_DAG in
      // api/_replica-processing/pipeline.js: 'voice_quality' is the one step
      // whose NEXT is null). Its own table, own scoped select - the DAG's
      // terminal state timestamp, never re-derived from vy_replica_source's
      // own 'ready' state, which several other steps can also produce.
      db(
        `select min(updated_at) as at from vy_replica_processing_job
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
            and step = 'voice_quality' and state = 'complete'`,
        [rid, ownerUserId],
      ),
      // migration 045's own shape (restated by WS-R19's own header): purpose
      // 'voice_preview' + channel 'studio_preview' is the ONLY
      // schema-compatible choice for the owner's private preview corridor.
      // 'sealed' is the state a preview reaches once it has actually played.
      db(
        `select min(sealed_at) as at from vy_replica_generation
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
            and purpose = 'voice_preview' and channel = 'studio_preview' and state = 'sealed'`,
        [rid, ownerUserId],
      ),
      db(
        `select min(computed_at) as at from vy_replica_readiness
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid`,
        [rid, ownerUserId],
      ),
      // The publish lock's own predicate (073's header: overall >= 70, every
      // part >= 55), read here rather than re-derived, since a passed row is
      // by definition one where readinessScreen's own constraint already
      // guarantees overall/min_part are both non-null.
      db(
        `select min(computed_at) as at from vy_replica_readiness
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
            and overall >= 70 and min_part >= 55`,
        [rid, ownerUserId],
      ),
      // vy_teacher_sheet is keyed on agent_id, not replica_id/owner_user_id -
      // a replica with no agent yet (draft, pre-consent) simply has no
      // matching row, and the cast below on a null agent_id reads as no rows
      // rather than a SQL error.
      db(
        `select min(published_at) as at from vy_teacher_sheet
          where agent_id = ($1)::uuid and status = 'published'`,
        [replica.agent_id],
      ),
      db(
        `select step, at from vy_replica_funnel_mark
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid`,
        [rid, ownerUserId],
      ),
      // The earliest Room this replica ever created - "first Room", the
      // funnel's own name for the thing it measures minutes to.
      db(
        `select room_id, created_at, published_at from vy_room
          where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
          order by created_at asc limit 1`,
        [rid, ownerUserId],
      ),
    ]);

  const roomId = roomRows[0]?.room_id || null;
  let followerAt = null;
  if (roomId) {
    // AGGREGATE_ONLY (see this file's own header): scoped to ONE room,
    // select list nothing but min(joined_at).
    const [row] = await db(
      `select min(joined_at) as at from vy_room_follower
        where room_id = ($1)::uuid`,
      [roomId],
    );
    followerAt = row?.at || null;
  }

  const markAt = (name) => marks.find((m) => m.step === name)?.at || null;

  return {
    replica_id: replica.replica_id,
    owner_user_id: replica.owner_user_id,
    steps: {
      account_created: iso(replica.created_at),
      studio_opened: iso(markAt("studio_opened")),
      first_source_uploaded: iso(sourceRows[0]?.at),
      processing_finished: iso(processingRows[0]?.at),
      first_preview_heard: iso(previewRows[0]?.at),
      readiness_first_measured: iso(readinessFirstRows[0]?.at),
      readiness_passed_lock: iso(readinessPassedRows[0]?.at),
      disclosure_approved: iso(sheetRows[0]?.at),
      room_created: iso(roomRows[0]?.created_at),
      publish_clicked: iso(markAt("publish_clicked")),
      room_published: iso(roomRows[0]?.published_at),
      first_follower_joined: iso(followerAt),
    },
  };
}

/** Rank-based percentile over a SORTED numeric array (ascending), linear
 *  interpolation between the two bracketing ranks - the standard method, and
 *  the one whose n=1 case (median === p90 === the single value) matches the
 *  eval's own two-replica fixture without a special case. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const frac = rank - lower;
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * frac);
}

/** The last step in FUNNEL_STEPS order this replica has a timestamp for -
 *  "where the stalled ones stopped". Walks the WHOLE ordered list rather
 *  than stopping at the first gap, because `studio_opened` can race ahead of
 *  `first_source_uploaded` (a creator can open the studio before uploading
 *  anything) without that being a stall in an earlier step. */
function lastReachedStep(steps) {
  let last = "account_created";
  for (const name of FUNNEL_STEPS) {
    if (steps[name]) last = name;
  }
  return last;
}

const STALL_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Pure. `rows` is an array of `replicaFunnel`'s own return shape (or the
 * plain `{steps}` objects it returns). Two numbers:
 *   - minutes_to_first_room: median/p90/n of (room_published - account_created)
 *     in minutes, over replicas that HAVE published.
 *   - stalled_at: counts of the last-reached funnel step, over replicas that
 *     have NOT published and whose account_created is at least 7 days old -
 *     an unpublished replica younger than that is still in progress, not
 *     stalled, and must never be counted as a defect on day one.
 */
export function funnelSummary(rows, now = Date.now()) {
  const minutes = [];
  const stalled = new Map();
  for (const entry of rows || []) {
    const steps = entry?.steps || entry || {};
    const createdIso = steps.account_created;
    const publishedIso = steps.room_published;
    const createdAt = createdIso ? Date.parse(createdIso) : NaN;
    const publishedAt = publishedIso ? Date.parse(publishedIso) : NaN;
    if (Number.isFinite(createdAt) && Number.isFinite(publishedAt)) {
      minutes.push(Math.max(0, Math.round((publishedAt - createdAt) / 60_000)));
      continue;
    }
    if (Number.isFinite(createdAt) && now - createdAt >= STALL_WINDOW_MS) {
      const step = lastReachedStep(steps);
      stalled.set(step, (stalled.get(step) || 0) + 1);
    }
  }
  minutes.sort((a, b) => a - b);
  const stalledAt = [...stalled.entries()]
    .map(([step, count]) => ({ step, count }))
    .sort((a, b) => b.count - a.count || FUNNEL_STEPS.indexOf(a.step) - FUNNEL_STEPS.indexOf(b.step));
  return {
    minutes_to_first_room: {
      median: percentile(minutes, 50),
      p90: percentile(minutes, 90),
      n: minutes.length,
    },
    stalled_at: stalledAt,
  };
}

/**
 * The board's own read: every replica's funnel, then `funnelSummary` over
 * the result. One extra query per replica (`replicaFunnel`'s own eight),
 * `api/_ops.js`'s own per-room loop shape one file over - Phase 0 scale (one
 * creator, a handful more) makes this the honest tradeoff against a single
 * grouped statement that would have to group `vy_room_follower` ACROSS
 * rooms, which this file's own header (and `api/_ops.js`'s) says never to
 * do.
 */
export async function opsFunnel(db, now = Date.now()) {
  if (typeof db !== "function") throw new Error("ops_funnel_database_required");
  const replicas = await db(
    `select replica_id, owner_user_id from vy_replica
      where lifecycle <> 'purging'
      order by created_at asc`,
    [],
  );
  const rows = [];
  for (const r of replicas) {
    const funnel = await replicaFunnel(db, r.replica_id, r.owner_user_id);
    if (funnel) rows.push(funnel);
  }
  return funnelSummary(rows, now);
}
