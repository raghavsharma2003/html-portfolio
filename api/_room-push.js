// api/_room-push.js — a follower's own web push subscription (WS-R22,
// migration 085). `api/_pulse.js`'s own shape one file over: re-derives
// `api/_room-surface.js`'s private `selfScope`/`followerScope` rather than
// importing it (not exported, that file's own stated reason — this module
// stays reachable with only a fake `db`), and every identity read goes
// through an ALREADY-EXPORTED function (`resolveRoom`, `followerRow`) so the
// only new SQL this file contributes is against `vy_room_push_subscription`
// itself.
//
// ── WHAT THIS FILE OWNS ─────────────────────────────────────────────────
//
//   1. `setSubscription` — an UPSERT keyed on `endpoint` (the migration's own
//      unique index): a follower who re-enables notifications on the same
//      browser/device updates the SAME row (clearing `revoked_at`, refreshing
//      the keys a browser MAY rotate) rather than growing a duplicate one
//      request at a time would leave behind. Scope (room_id/person_id/
//      follower_id) comes from the caller's OWN session, never the request
//      body — api/_auth.js's first law, restated here because this is
//      exactly the lane where getting it wrong would let one follower's
//      subscribe request bind ANOTHER follower's browser.
//   2. `removeSubscription` — sets `revoked_at`, scoped to the caller's own
//      rows by `follower_id` (never a bare `endpoint` match — a follower
//      could not otherwise revoke a subscription by guessing someone else's
//      endpoint string).
//   3. `activeSubscriptionsFor(db, followerId)` — the sweep's own read, the
//      ONLY function in this file with no session to scope from: it is
//      called from `api/_checkins.js` with a `follower_id` the SWEEP's own
//      due-select query already resolved, never from a client request.
//
// The endpoint/p256dh/auth are secrets in the sense AGENTS.md means (never
// logged, never printed) — this file never calls `console.log`/`console.
// error` with a row's own columns, only with a caller's already-safe scope
// identifiers when something fails.
import { randomUUID } from "node:crypto";
import { RoomError, readRoomSession, resolveRoom, followerRow } from "./_room-surface.js";

async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw new RoomError("room_unavailable", 404);
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  return {
    roomId: String(resolved.room.room_id),
    personId: String(payload.p),
    followerId: String(follower.follower_id),
  };
}

const B64U = /^[A-Za-z0-9_-]+$/;

function assertSubscription({ endpoint, p256dh, auth }) {
  const url = String(endpoint || "");
  if (!/^https:\/\//.test(url) || url.length > 2000) throw new RoomError("room_push_endpoint_invalid", 400);
  if (!B64U.test(String(p256dh || "")) || String(p256dh).length < 40) {
    throw new RoomError("room_push_key_invalid", 400);
  }
  if (!B64U.test(String(auth || "")) || String(auth).length < 10) {
    throw new RoomError("room_push_key_invalid", 400);
  }
}

/** Best-effort, never load-bearing: a short fingerprint of the caller's own
 *  User-Agent string, kept only so a follower's "your devices" listing could
 *  one day tell two subscriptions apart without holding the raw UA string
 *  (which is fingerprint-shaped data a content-free ledger should not need
 *  to carry). Absent input yields an empty string, never a hash of nothing
 *  pretending to mean something. */
export function userAgentHash(userAgent) {
  const ua = String(userAgent || "").trim();
  if (!ua) return "";
  let h = 0;
  for (let i = 0; i < ua.length; i++) h = (Math.imul(31, h) + ua.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export async function setSubscription(db, { session, endpoint, p256dh, auth, userAgent }, deps = {}) {
  const who = await followerScope(db, session, deps);
  assertSubscription({ endpoint, p256dh, auth });
  const rows = await db(
    `insert into vy_room_push_subscription
       (subscription_id, room_id, person_id, follower_id, endpoint, p256dh, auth, user_agent_hash,
        created_at, last_used_at, revoked_at)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, $5, $6, $7, $8, now(), null, null)
     on conflict (endpoint) do update
        set room_id = excluded.room_id,
            person_id = excluded.person_id,
            follower_id = excluded.follower_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent_hash = excluded.user_agent_hash,
            revoked_at = null
     returning subscription_id, created_at`,
    [randomUUID(), who.roomId, who.personId, who.followerId, endpoint, p256dh, auth, userAgentHash(userAgent)],
  );
  return { subscribed: true, subscription_id: rows[0]?.subscription_id };
}

export async function removeSubscription(db, { session, endpoint }, deps = {}) {
  const who = await followerScope(db, session, deps);
  const rows = await db(
    `update vy_room_push_subscription
        set revoked_at = now()
      where follower_id = ($1)::uuid and endpoint = $2 and revoked_at is null
      returning subscription_id`,
    [who.followerId, String(endpoint || "")],
  );
  return { subscribed: false, revoked: rows.length > 0 };
}

/** Whether THIS follower currently has any active (unrevoked) subscription —
 *  the panel's own "already on" state, `api/room.js`'s `push_status` op. */
export async function subscriptionStatus(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  const rows = await db(
    `select count(*)::int as n from vy_room_push_subscription
      where follower_id = ($1)::uuid and revoked_at is null`,
    [who.followerId],
  );
  return { subscribed: Number(rows[0]?.n || 0) > 0 };
}

/** The sweep's own read — `follower_id` comes from the due-select query,
 *  never from a request. Active subscriptions only, the migration's own
 *  partial index. */
export async function activeSubscriptionsFor(db, followerId) {
  return db(
    `select subscription_id, endpoint, p256dh, auth
       from vy_room_push_subscription
      where follower_id = ($1)::uuid and revoked_at is null`,
    [String(followerId)],
  );
}

/** Revoke on a 404/410 from the push service (workstream law #2) — by
 *  `subscription_id`, the row a send just failed for, never by endpoint text
 *  a caller supplies (there is no caller of this but the sweep itself). */
export async function revokeSubscriptionById(db, subscriptionId) {
  await db(`update vy_room_push_subscription set revoked_at = now() where subscription_id = ($1)::uuid`, [
    String(subscriptionId),
  ]);
}

/** Best-effort freshness marker on a successful send — never gates delivery,
 *  never catch-wrapped by a caller that treats its failure as the send's own. */
export async function touchSubscription(db, subscriptionId) {
  await db(`update vy_room_push_subscription set last_used_at = now() where subscription_id = ($1)::uuid`, [
    String(subscriptionId),
  ]);
}
