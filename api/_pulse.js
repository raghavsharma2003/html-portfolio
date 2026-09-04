// api/_pulse.js — Pulse v0 (WS-R17, migration 080).
//
// The plan's own warning, verbatim: "Pulse is the write-path leak in a
// dashboard costume." This file's whole job is to make the costume
// impossible to wear, structurally rather than by discipline:
//
//   1. OPT-IN, PER CONVERSATION, REVOCABLE. A follower's toggle, recorded in
//      `vy_room_pulse_optin` (migration 080) — a row with no content column
//      at all. Revoking sets `revoked_at`; it is never deleted here, because
//      there is nothing in the row a delete would protect that an UPDATE
//      does not already remove from every future read.
//   2. LABELS ARE NEVER FOLLOWER TEXT. `setTopics` is the ONLY writer of
//      `vy_room_pulse_topic.label`, it is OWNER-scoped, and nothing in this
//      file ever copies a thread title or a message into it. Matching a
//      creator's topic against a follower's thread happens entirely inside
//      SQL predicates (`computeSnapshot`, below) — the text is read by
//      Postgres to decide whether a row counts, and never crosses back into
//      anything this file returns.
//   3. n>=5, OR THE BUCKET DOES NOT EXIST. `vy_room_pulse_snapshot.follower_
//      count` carries `check (follower_count >= 5)` in the migration itself,
//      so `computeSnapshot` cannot INSERT a bucket below the floor even if
//      every check in THIS file were wrong. One dimension only (topic); no
//      cross-tab, no time-of-day, no tier split — the plan's own ban on a
//      rare-attribute combination.
//   4. READ-ONLY FOR THE CREATOR, AGGREGATE-ONLY IN SQL. `readPulse` selects
//      nothing but a creator-typed label and a floor-checked count. The one
//      statement in this file that reaches `vy_room_thread` at all — the
//      per-topic match inside `computeSnapshot` — is written the way
//      `api/_room-cohorts.js` (WS-R12) proved out: a person id may sit inside
//      a WHERE-clause predicate, including one buried in an `exists(...)`
//      subquery, without ever appearing in what the statement SELECTS. That
//      statement's outer SELECT LIST is exactly `count(*)` — never `count(
//      distinct person_id)`, because `person_id` typed anywhere in a SELECT
//      LIST, aggregated or not, is exactly what `evals/room-leak/run.mjs`'s
//      AGGREGATE_ONLY parser refuses (`context/rejected.md#ws-r12-retention-
//      exists-in-select-broke-the-leak-batterys-parser` names the same trap
//      the other direction: keep every subquery's own `from` AFTER the outer
//      statement's `from`, or the parser's non-greedy capture stops at the
//      wrong one). This file is admitted to that battery's AGGREGATE_ONLY set
//      by name, not by a blanket exemption
//      (`context/rejected.md#ws-r11-room-leak-blanket-allowlist` is why a
//      blanket ALLOWED entry was rejected the one other time it was tried).
//   5. THE DERIVATION CAN ONLY NARROW. Every bucket this file can ever emit
//      is a subset of what opt-in already permits: revoking a follower's
//      opt-in can only ever remove them from a future count, never add them
//      to one, and the room-total floor gates the WHOLE snapshot before any
//      per-topic query runs at all.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────
//
// It never writes a fresh SELECT against `vy_room_follower` or `vy_room_
// thread` for identity/ownership checks — `setOptIn`/`revoke` reuse
// `followerRow` and `listThreads`, both already EXPORTED from
// `api/_room-surface.js` (an ALLOWED file in the leak battery), so the only
// new SQL this file contributes against those two tables is the one
// aggregate statement law 4 describes. Reusing rather than re-querying is not
// a style choice: a second hand-written ownership check is a second place the
// scope predicate could be gotten wrong, and this product has exactly one of
// those it trusts (`api/_room-surface.js`'s own header).
import { randomUUID } from "node:crypto";
import {
  RoomError,
  ROOM_SESSION_TTL_MS,
  readRoomSession,
  resolveRoom,
  followerRow,
  listThreads,
} from "./_room-surface.js";
import { isoWeekStart, WEEK_MS } from "./_room-cohorts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** The opt-in copy's own version — mirrored the way every other consent
 *  artifact in this schema stamps the words a person actually read (016's
 *  `meera_consent`, migration 026's `consent_ids`). Bump this the day the
 *  toggle's sentence changes; a later version never reinterprets an earlier
 *  grant, it only changes what a FUTURE toggle records. */
export const PULSE_POLICY_VERSION = 1;

/** Law 3's floor, exported so `computeSnapshot`, `readPulse` and the studio
 *  card's copy read ONE number rather than three that could drift — the
 *  same reason `api/_room-cohorts.js` exports its own floors. */
export const PULSE_MIN_FOLLOWERS = 5;

/** A creator declares a short list, not an open-ended one — the same
 *  reasoning `vy_room_thread.title`'s 80-character cap uses one column over:
 *  a label is a name, not a taxonomy. */
export const PULSE_MAX_TOPICS = 8;

export class PulseError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE FOLLOWER'S OWN SCOPE — session in, {roomId, personId, agentId} out.
// Re-derives `api/_room-surface.js`'s private `selfScope` rather than
// importing it (it is not exported, on that file's own stated reason for
// `_room-cohorts.js`'s `ownedRoomHandle`: this module stays reachable with
// only a fake `db`). Every read it performs is through an ALREADY-EXPORTED
// function — `resolveRoom`, `followerRow` — so it adds no new SQL of its own.
// ─────────────────────────────────────────────────────────────────────────
async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  const now = deps.now ?? Date.now();
  if (!Number.isFinite(payload.iat) || now - payload.iat > ROOM_SESSION_TTL_MS) {
    throw new RoomError("room_session_expired", 401);
  }
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw new RoomError("room_unavailable", 404);
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  return { roomId: String(resolved.room.room_id), personId: String(payload.p), agentId: String(resolved.agentId) };
}

/** `threadId` resolved against the caller's OWN threads, via `listThreads`
 *  (exported, `api/_room-surface.js`'s own SQL) — never a fresh query here.
 *  `null` means "the whole relationship, room-wide" (law 1's second clause:
 *  "or per follower if the Room has no threads yet"). */
async function resolveOwnThread(db, scope, threadId) {
  if (threadId == null) return null;
  if (!UUID.test(String(threadId))) throw new PulseError("pulse_thread_unknown", 404);
  const threads = await listThreads(db, scope.roomId, scope.personId, scope.agentId);
  if (!threads.some((t) => String(t.thread_id) === String(threadId))) {
    throw new PulseError("pulse_thread_unknown", 404);
  }
  return String(threadId);
}

const clientOptIn = (row) => ({
  thread_id: row.thread_id ?? null,
  active: row.revoked_at == null,
  granted_at: row.granted_at,
  revoked_at: row.revoked_at ?? null,
  policy_version: row.policy_version,
});

// ─────────────────────────────────────────────────────────────────────────
// OP: pulse_optin / pulse_revoke — the follower's own toggle.
//
// Both statements below name only `vy_room_pulse_optin`, this migration's own
// table, so neither is inside the leak battery's watch at all (that watch is
// `vy_room_follower`/`vy_room_thread` by name). The `coalesce(...)` in the
// WHERE clause is deliberately NOT an `on conflict` arbiter target — a
// plain WHERE match, checked with a SELECT before the write, is the shape
// this codebase already trusts for exactly this kind of scoped upsert
// (`api/_room-surface.js`'s own `followerRow`-then-insert), and it needs no
// Postgres expression-index arbiter matching to get right in an environment
// with no live database to `EXPLAIN` it against before merge.
// ─────────────────────────────────────────────────────────────────────────

export async function setOptIn(db, { session, threadId = null }, deps = {}) {
  const scope = await followerScope(db, session, deps);
  const boundThreadId = await resolveOwnThread(db, scope, threadId);

  const [existing] = await db(
    `select optin_id from vy_room_pulse_optin
      where room_id = ($1)::uuid
        and person_id = ($2)::uuid
        and coalesce(thread_id, ($4)::uuid) = coalesce(($3)::uuid, ($4)::uuid)
      limit 1`,
    [scope.roomId, scope.personId, boundThreadId, NIL_UUID],
  );

  const rows = existing
    ? await db(
        `update vy_room_pulse_optin
            set revoked_at = null, policy_version = $2, granted_at = now(), updated_at = now()
          where optin_id = ($1)::uuid
          returning optin_id, thread_id, granted_at, revoked_at, policy_version`,
        [String(existing.optin_id), PULSE_POLICY_VERSION],
      )
    : await db(
        `insert into vy_room_pulse_optin
           (optin_id, room_id, person_id, thread_id, policy_version, granted_at, updated_at)
         values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, $5, now(), now())
         returning optin_id, thread_id, granted_at, revoked_at, policy_version`,
        [randomUUID(), scope.roomId, scope.personId, boundThreadId, PULSE_POLICY_VERSION],
      );
  return clientOptIn(rows[0]);
}

/** Revocation is an UPDATE, never a delete — law 1: "removes the contribution
 *  from every future snapshot; snapshots are recomputed, never patched." The
 *  row surviving costs nothing (it holds no content) and lets a later
 *  re-opt-in reuse it rather than minting a second consent artifact for the
 *  same decision made twice. Answers `{active:false, revoked:false}` — never
 *  throws — for a scope that was never opted in, which is the honest state:
 *  asking to stop something that was never started is not an error. */
export async function revoke(db, { session, threadId = null }, deps = {}) {
  const scope = await followerScope(db, session, deps);
  const boundThreadId = await resolveOwnThread(db, scope, threadId).catch((e) => {
    // A follower may revoke a thread that has since been archived or deleted
    // (roomForget's own child-before-parent ordering can reach this); the
    // WHERE clause below still finds the row by id, so refusing here would
    // block a legitimate "turn this off" on a technicality unrelated to it.
    if (e instanceof PulseError && threadId != null && UUID.test(String(threadId))) return String(threadId);
    throw e;
  });

  const rows = await db(
    `update vy_room_pulse_optin
        set revoked_at = now(), updated_at = now()
      where room_id = ($1)::uuid
        and person_id = ($2)::uuid
        and coalesce(thread_id, ($4)::uuid) = coalesce(($3)::uuid, ($4)::uuid)
        and revoked_at is null
      returning optin_id, thread_id, granted_at, revoked_at, policy_version`,
    [scope.roomId, scope.personId, boundThreadId, NIL_UUID],
  );
  return rows[0] ? clientOptIn(rows[0]) : { thread_id: boundThreadId, active: false, revoked: false };
}

// ─────────────────────────────────────────────────────────────────────────
// OWNER-SCOPED HANDLE — re-derived from `api/_room-cohorts.js`'s own private
// `ownedRoomHandle` rather than imported, for its own stated reason: "not
// yours" and "does not exist" answer identically, and this module stays
// reachable with only a fake `db`.
// ─────────────────────────────────────────────────────────────────────────
async function ownedRoomHandle(db, ownerUserId, replicaId) {
  const rows = await db(
    `select room_id, created_at, published_at
       from vy_room
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      limit 1`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] || null;
}

/** OWNER, WRITE. Replaces the room's whole topic list — the studio card's own
 *  shape (a short list the creator edits as one unit, `RoomStudio.tsx`).
 *  Trimmed to `PULSE_MAX_TOPICS`, deduplicated case-insensitively (the
 *  migration's own unique index does the same on the database side; this is
 *  the honest client-visible half of that same rule). Every statement names
 *  only `vy_room_pulse_topic` — creator-authored text this file WRITES,
 *  never text it reads off a follower — so none of this is inside the leak
 *  battery's watch either. */
export async function setTopics(db, ownerUserId, replicaId, topics) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new PulseError("pulse_identity_invalid", 400);
  }
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new PulseError("pulse_room_not_found", 404);

  const clean = [];
  const seen = new Set();
  for (const raw of Array.isArray(topics) ? topics : []) {
    const label = String(raw ?? "").trim().slice(0, 60);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(label);
    if (clean.length >= PULSE_MAX_TOPICS) break;
  }

  const existing = await db(
    `select topic_id, label from vy_room_pulse_topic where room_id = ($1)::uuid`,
    [String(room.room_id)],
  );
  const keep = new Set(clean.map((l) => l.toLowerCase()));
  for (const row of existing) {
    if (!keep.has(String(row.label).toLowerCase())) {
      await db(`delete from vy_room_pulse_topic where topic_id = ($1)::uuid`, [String(row.topic_id)]);
    }
  }

  const out = [];
  for (const label of clean) {
    const already = existing.find((row) => String(row.label).toLowerCase() === label.toLowerCase());
    const rows = already
      ? await db(
          `update vy_room_pulse_topic set label = $2, updated_at = now()
            where topic_id = ($1)::uuid
            returning topic_id, label`,
          [String(already.topic_id), label],
        )
      : await db(
          `insert into vy_room_pulse_topic (topic_id, room_id, owner_user_id, label, updated_at)
           values (($1)::uuid, ($2)::uuid, ($3)::uuid, $4, now())
           returning topic_id, label`,
          [randomUUID(), String(room.room_id), String(ownerUserId).toLowerCase(), label],
        );
    out.push(rows[0]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE SNAPSHOT — the one place this product decides a bucket exists.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The RAW, UNGUARDED count of distinct followers whose actively opted-in
 * thread title matches `label`. Exported and used by exactly two callers:
 * `computeSnapshot` (which applies law 3's floor to whatever this returns
 * before a bucket is ever inserted) and `evals/pulse/run.mjs`'s negative
 * control, which calls this DIRECTLY, bypassing the floor, to prove the
 * floor is load-bearing rather than vacuous — the same shape
 * `evals/room-leak/run.mjs`'s two negative controls use: strike (here,
 * bypass) the guard and show the leak the guard exists to prevent.
 *
 * THE AGGREGATE-ONLY STATEMENT. Outer SELECT LIST is `count(*)` alone;
 * `person_id`/`title` appear only inside the WHERE clause's `exists(...)`
 * subqueries, whose own `from` sits AFTER this statement's own `from` —
 * `context/rejected.md#ws-r12-retention-exists-in-select-broke-the-leak-
 * batterys-parser`'s exact lesson, applied here rather than relearned.
 */
export async function topicFollowerCount(db, roomId, label) {
  const term = `%${String(label).trim().toLowerCase()}%`;
  if (term === "%%") return 0;
  const [row] = await db(
    `select count(*)::int as follower_count
       from (
         select distinct o.person_id
           from vy_room_pulse_optin o
          where o.room_id = ($1)::uuid
            and o.revoked_at is null
       ) op
      where exists (
        select 1 from vy_room_thread t
         where t.room_id = ($1)::uuid
           and t.person_id = op.person_id
           and t.archived_at is null
           and lower(t.title) like ($2)
           and exists (
             select 1 from vy_room_pulse_optin o2
              where o2.thread_id = t.thread_id
                and o2.revoked_at is null
           )
      )`,
    [String(roomId), term],
  );
  return Number(row?.follower_count || 0);
}

/**
 * One room, one ISO week. Deletes the week's existing rows FIRST (law 1:
 * recomputed, never patched — a revoked opt-in must never leave a stale
 * bucket standing, and two sweeps of the same week must never coexist), then
 * gates the WHOLE snapshot on the room-total floor before touching a single
 * topic. Only once that gate is cleared does the per-topic statement run —
 * the one statement in this file admitted to AGGREGATE_ONLY, see this file's
 * header for exactly how its SELECT LIST stays clean of `person_id`.
 *
 * `db` first, positional, matching every other function in this Room family
 * (`api/_room-cohorts.js#roomFollowerCohorts`) rather than a `deps`-first
 * signature — consistency with the file this one was built to match wins
 * over a literal reading of the brief's own prose.
 */
export async function computeSnapshot(db, roomId, weekStart, deps = {}) {
  const room = String(roomId);
  const start = isoWeekStart(weekStart);
  const startIso = start.toISOString().slice(0, 10);
  void deps;

  await db(
    `delete from vy_room_pulse_snapshot where room_id = ($1)::uuid and week_start = ($2)::date`,
    [room, startIso],
  );

  // LAW 3, ROOM-TOTAL HALF: "and >=5 opted-in followers in the Room in
  // total, else the snapshot is empty." Gated before any topic is looked at,
  // so a room with four opted-in followers spread across every topic never
  // even reaches the per-topic query.
  const [totalRow] = await db(
    `select count(distinct o.person_id)::int as total_optin
       from vy_room_pulse_optin o
      where o.room_id = ($1)::uuid
        and o.revoked_at is null`,
    [room],
  );
  const totalOptin = Number(totalRow?.total_optin || 0);
  if (totalOptin < PULSE_MIN_FOLLOWERS) {
    return { room_id: room, week_start: startIso, total_optin: totalOptin, buckets: [] };
  }

  const topics = await db(
    `select topic_id, label from vy_room_pulse_topic where room_id = ($1)::uuid order by created_at asc`,
    [room],
  );

  const buckets = [];
  for (const topic of topics) {
    if (!String(topic.label).trim()) continue; // an empty label can never match anything
    const count = await topicFollowerCount(db, room, topic.label);
    if (count < PULSE_MIN_FOLLOWERS) continue; // law 3: drop every bucket below the floor
    await db(
      `insert into vy_room_pulse_snapshot (snapshot_id, room_id, week_start, topic_id, follower_count, computed_at)
       values (($1)::uuid, ($2)::uuid, ($3)::date, ($4)::uuid, $5, now())`,
      [randomUUID(), room, startIso, String(topic.topic_id), count],
    );
    buckets.push({ topic_id: topic.topic_id, label: topic.label, follower_count: count });
  }

  return { room_id: room, week_start: startIso, total_optin: totalOptin, buckets };
}

/** OWNER, READ. The most recently COMPUTED week (whatever the sweep actually
 *  wrote), never a wall-clock guess at what week "should" exist — a sweep
 *  that ran late or not at all must never be papered over by a client-side
 *  date computation pretending it ran on schedule
 *  (`plausible-return-hides-a-dead-pipeline`, read the other way). Reads only
 *  `vy_room_pulse_snapshot` and `vy_room_pulse_topic` — neither is inside the
 *  leak battery's watch, and `s.follower_count`'s own CHECK is what makes
 *  every row this returns already floor-clean before this function runs at
 *  all. */
export async function readPulse(db, ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new PulseError("pulse_identity_invalid", 400);
  }
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) return null;

  const [totalRow] = await db(
    `select count(distinct o.person_id)::int as total_optin
       from vy_room_pulse_optin o
      where o.room_id = ($1)::uuid
        and o.revoked_at is null`,
    [String(room.room_id)],
  );
  const totalOptin = Number(totalRow?.total_optin || 0);

  // The creator's OWN full topic list, not only the ones that reached the
  // floor - the studio's editor needs to show every label they declared, and
  // there is no privacy question here: these are labels the creator wrote.
  const topicRows = await db(
    `select topic_id, label from vy_room_pulse_topic where room_id = ($1)::uuid order by created_at asc`,
    [String(room.room_id)],
  );
  const topics = topicRows.map((t) => ({ topic_id: t.topic_id, label: t.label }));

  const [latest] = await db(
    `select max(week_start)::text as week_start from vy_room_pulse_snapshot where room_id = ($1)::uuid`,
    [String(room.room_id)],
  );
  const weekStart = latest?.week_start || null;

  let buckets = [];
  if (weekStart) {
    const rows = await db(
      `select s.topic_id, t.label, s.follower_count
         from vy_room_pulse_snapshot s
         join vy_room_pulse_topic t on t.topic_id = s.topic_id
        where s.room_id = ($1)::uuid
          and s.week_start = ($2)::date
        order by s.follower_count desc, t.label asc`,
      [String(room.room_id), weekStart],
    );
    buckets = rows.map((r) => ({ topic_id: r.topic_id, label: r.label, follower_count: Number(r.follower_count) }));
  }

  // Honest empty state (law 3), not a fake number: two different reasons a
  // card can be empty, and a follower/creator deserves to know which.
  const status = buckets.length > 0
    ? "ready"
    : totalOptin < PULSE_MIN_FOLLOWERS
      ? "not_enough_optins"
      : "no_topic_at_floor";

  return { week_start: weekStart, total_optin: totalOptin, status, buckets, topics };
}

/**
 * The scheduled half — every PUBLISHED room, the most recently CLOSED ISO
 * week, one `computeSnapshot` call each. `api/_drift-watch.js#runDriftWatchSweep`'s
 * own shape: cheap, side-effect-free beyond the guarded write, one error
 * isolates to one room rather than failing the whole sweep.
 */
export async function runPulseSweep({ db, limit = 50, now = Date.now() } = {}) {
  if (typeof db !== "function") throw new PulseError("pulse_sweep_database_required", 500);
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  const rooms = await db(
    `select room_id from vy_room where published_at is not null and paused_at is null order by published_at asc limit $1`,
    [cap],
  );
  const weekStart = isoWeekStart(Number(now) - WEEK_MS).toISOString().slice(0, 10);
  const summary = { checked: 0, computed: 0, week_start: weekStart, errors: 0, error_details: [] };
  for (const row of rooms) {
    summary.checked += 1;
    try {
      await computeSnapshot(db, row.room_id, weekStart);
      summary.computed += 1;
    } catch (error) {
      summary.errors += 1;
      summary.error_details.push({ room_id: row.room_id, message: error?.message || String(error) });
    }
  }
  return summary;
}
