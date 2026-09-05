// api/_creator-push.js - the creator's weekly push (WS-R74, migration 118).
//
// Pulse (WS-R35) writes a weekly note and the funnel/cohorts (WS-R21) know
// the week's numbers, but a creator learns any of it only by opening the
// studio. WS-R62 (migration 114) built the mechanism for a platform
// OPERATOR to get a push on their own phone (`api/_ops.js`'s own push
// section); this file is the identical mechanism restated for a CREATOR,
// carrying their own Room's counts instead of an ops alert - same
// endpoint/p256dh/auth validation, same upsert-by-conflict-key shape, same
// `send` through `api/_push/webpush.js`, narrowed to one column of
// identity (`owner_user_id`) for the subscription and one Room per push.
//
// LAW (workstream brief #3): the payload builder below (`creatorWeeklyPushPayload`)
// takes ONLY a slug, a display name and three already-aggregated facts as
// PARAMETERS - `api/_push/webpush.js`'s `checkinPushPayload`/`renewalPushPayload`
// own "the parameter list IS the enforcement" law, restated a third way.
// There is no variable in scope inside that function that could ever hold a
// follower's own words, so no code path through it can put one on the wire.
// `evals/creator-push/run.mjs`'s static control greps this function's own
// source for the names of every follower-facing column this repo has (the
// same list `api/_push/webpush.js`'s own header names) and fails if any
// appear.
//
// THE HEADLINE. "The Pulse note's headline if published" (workstream brief
// #3) is read through `api/_pulse.js`'s own already-reviewed, already-gated
// `readPulse` - the SAME function `api/_ops.js`'s `roomOverview` already
// calls for the ops board's own Pulse card (`const pulse = await readPulse(db,
// room.owner_user_id, room.replica_id)`) - never a second, hand-rolled query
// against `vy_room_pulse_combo`/`vy_room_pulse_week`. `readPulse`'s own
// `combo_buckets` field is built entirely from creator-typed topic labels
// (`setTopics`, owner-scoped) and floor-checked counts (`vy_room_pulse_combo.
// follower_count` carries `check (follower_count >= 5)` in the migration
// itself) - it is PUBLISHED creator material, never a follower's own words,
// `weeklyNote`'s own header states this in full for the identical rows.
// `pulseHeadlineFor` (below) derives its OWN short one-line headline from
// those rows rather than forwarding `readPulse`'s own `note` field verbatim
// - that field opens with a two-sentence disclaimer that a lock-screen
// notification body has no room for, see that function's own header for
// what running this file's own eval against it found. "Published" is
// `combo_buckets.length > 0`, never `status` (that field reflects the OLDER
// v0 single-topic snapshot, a different question - see that function's own
// header).
//
// THE LEDGER. `vy_creator_weekly_push` (migration 118) is the ledger law 4
// names: one row per Room per ISO week, the unique (room_id, week_start)
// index the WHOLE idempotency mechanism (`recordSend` below's own INSERT ...
// ON CONFLICT ... DO NOTHING), the same "the WHERE decides, not a JS `if`"
// discipline `api/_ops.js`'s own push section documents for
// `subscribeOperatorPush`.
import { randomUUID } from "node:crypto";
import { send as webPushSend } from "./_push/webpush.js";
import { readPulse } from "./_pulse.js";

export class CreatorPushError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "CreatorPushError";
    this.code = code;
    this.status = status;
  }
}

const B64U_RE = /^[A-Za-z0-9_-]+$/;

function assertCreatorPushSubscription({ endpoint, p256dh, auth }) {
  const url = String(endpoint || "");
  if (!/^https:\/\//.test(url) || url.length > 2000) throw new CreatorPushError("creator_push_endpoint_invalid", 400);
  if (!B64U_RE.test(String(p256dh || "")) || String(p256dh).length < 40) {
    throw new CreatorPushError("creator_push_key_invalid", 400);
  }
  if (!B64U_RE.test(String(auth || "")) || String(auth).length < 10) {
    throw new CreatorPushError("creator_push_key_invalid", 400);
  }
}

/** Whether a real push can ever be sent, and the public key a browser needs
 *  to open a subscription with it. Pure function of env, no db -
 *  `api/_ops.js`'s `operatorPushConfig` own shape restated, and DELIBERATELY
 *  the SAME env vars (`ROOM_PUSH_VAPID_PUBLIC`/`_PRIVATE`/`_SUBJECT`) - one
 *  VAPID identity for this whole platform's web push, never a second key
 *  pair a creator's own push would need provisioning for (workstream brief:
 *  "no new env vars"). Never the private key. */
export function creatorPushConfig(env = process.env) {
  const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
  const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
  const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
  const configured = Boolean(vapidPublic && vapidPrivate && vapidSubject);
  return { configured, vapid_public: configured ? vapidPublic : null };
}

/**
 * The one write. `ownerUserId` is the CALLING bearer's own already-verified
 * id (`api/replica.js`'s `requireUser`, never a body-supplied id - there is
 * no "another owner's id" input anywhere in this op's body). Upserts on
 * `(owner_user_id, endpoint)` (the migration's own unique index): a creator
 * who re-enables notifications on the same browser/device updates the SAME
 * row (clearing `revoked_at`) rather than growing a duplicate one request at
 * a time would leave behind. Unlike `subscribeOperatorPush`, there is no
 * allowlist to check in the WHERE here - every authenticated owner may
 * subscribe for THEMSELVES, the ordinary "no cross-identity input" shape
 * every other owner-scoped op on `api/replica.js` already takes, not a
 * second identity gate this table would need to invent.
 */
export async function subscribeCreatorPush(db, ownerUserId, sub) {
  if (typeof db !== "function") throw new Error("creator_push_database_required");
  assertCreatorPushSubscription(sub || {});
  const { endpoint, p256dh, auth } = sub;
  const rows = await db(
    `insert into vy_creator_push_subscription (id, owner_user_id, endpoint, p256dh, auth, created_at, revoked_at)
     values (($1)::uuid, ($2)::uuid, $3, $4, $5, now(), null)
     on conflict (owner_user_id, endpoint) do update
        set p256dh = excluded.p256dh,
            auth = excluded.auth,
            revoked_at = null
     returning id`,
    [randomUUID(), ownerUserId, endpoint, p256dh, auth],
  );
  return { subscribed: rows.length > 0 };
}

/** Revoke ONE of the calling bearer's own subscriptions, by the endpoint
 *  their own browser reports - never by a body-supplied `owner_user_id`
 *  (there is none in this op's body at all). The WHERE (`owner_user_id =
 *  ($1)::uuid and endpoint = $2`) is what refuses a stranger's attempt to
 *  revoke ANOTHER creator's own row by guessing their endpoint - the same
 *  class-e attack `evals/room-doors/run.mjs`'s own suite tests for every
 *  other owner-bearer op, and this file's own negative control below. */
export async function revokeCreatorPush(db, ownerUserId, endpoint) {
  if (typeof db !== "function") throw new Error("creator_push_database_required");
  const rows = await db(
    `update vy_creator_push_subscription
        set revoked_at = now()
      where owner_user_id = ($1)::uuid
        and endpoint = $2
        and revoked_at is null
      returning id`,
    [ownerUserId, String(endpoint || "")],
  );
  return { revoked: rows.length > 0 };
}

/** Every ACTIVE (unrevoked) subscription for one owner - `api/_ops.js`'s
 *  `operatorPushSubscriptionsFor` restated for the creator lane. */
export async function creatorPushSubscriptionsFor(db, ownerUserId) {
  if (typeof db !== "function") return [];
  return db(
    `select id, endpoint, p256dh, auth
       from vy_creator_push_subscription
      where owner_user_id = ($1)::uuid and revoked_at is null`,
    [String(ownerUserId)],
  );
}

/** Revoke on a 404/410 from the push service - by `id` (the row a send just
 *  failed for), never by endpoint text a caller supplies -
 *  `api/_ops.js`'s `revokeOperatorPushById` restated. */
export async function revokeCreatorPushById(db, id) {
  if (typeof db !== "function") return;
  await db(`update vy_creator_push_subscription set revoked_at = now() where id = ($1)::uuid`, [String(id)]);
}

// Every follower-facing content column this repo has ever named on a
// person-shaped or thread-shaped row - `api/_push/webpush.js`'s own
// `CONTENT_COLUMNS` list (evals/room-leak/world.mjs restates the identical
// list for its own static scan) - kept here, independently, so THIS file's
// static control does not depend on importing that list (which would let a
// shared import silently drift both checks together, `context/rejected.md`'s
// own class of near-miss named elsewhere in this repo).
// "title" is deliberately absent from this list even though `_push/
// webpush.js`'s own CONTENT_COLUMNS names it (a THREAD title there) -
// `creatorWeeklyPushPayload`'s own returned shape legitimately carries a
// `title` FIELD (public/room-sw.js's own `{t, title, body, url}` contract,
// WS-R81),
// so the bare word is not a usable signal here; `thread_title` below is,
// and is what a real leak of that specific column would actually be
// spelled as inside this file's own source.
const FOLLOWER_CONTENT_NAMES = [
  "thread_title", "content", "message_text", "payload_text", "reply_text", "person_id", "follower_id",
];

/**
 * Law 3/4. Pure - takes only a Room's own slug, its own PUBLIC display
 * name (already shown to anyone who opens `/r/<slug>`) and three
 * already-aggregated numbers/strings, touches no database, and returns the
 * SAME `{t, title, body, url}` shape `public/room-sw.js`'s own documented
 * contract requires (WS-R81 - `push-sw.js`'s own header restates it,
 * reading `t`/`url` as aliases of this file's OLDER `kind`/`route` field
 * names so nothing here has to change to keep displaying, only what those
 * fields are CALLED) so this displays through the ONE already-reviewed
 * display worker every other account-wide push in this repo uses, rather
 * than a second display path this workstream would have to write and
 * review from scratch. `headline` is `readPulse`'s own `note` text
 * (creator material, never follower words - see this file's own header) or
 * null; when present it is appended, truncated, never interpolated whole
 * without a length cap (a Pulse note can run to a few sentences, and a
 * lock-screen notification body is not the place for all of them).
 */
export function creatorWeeklyPushPayload(slug, displayName, followersThisWeek, messagesThisWeek, headline) {
  const name = String(displayName || "").slice(0, 80);
  const f = Number.isFinite(Number(followersThisWeek)) ? Math.max(0, Math.trunc(Number(followersThisWeek))) : 0;
  const m = Number.isFinite(Number(messagesThisWeek)) ? Math.max(0, Math.trunc(Number(messagesThisWeek))) : 0;
  let body = `${name}: ${f} new follower${f === 1 ? "" : "s"}, ${m} message${m === 1 ? "" : "s"} this week.`;
  const h = headline == null ? "" : String(headline).trim();
  if (h) body = `${body} ${h.slice(0, 220)}`;
  return {
    t: "creator_week",
    title: "Your Room this week",
    body: body.slice(0, 400),
    url: `/r/${String(slug || "")}`,
  };
}

/** Followers who joined THIS Room in the 7 days ending `now` - a bare
 *  aggregate over `vy_room_follower` (no TABLE_ROLES entry in
 *  evals/room-leak/world.mjs guards this table; it carries no content
 *  column this scan would ever need to admit). */
async function followersThisWeekFor(db, roomId, now) {
  const [row] = await db(
    `select count(*)::int as n
       from vy_room_follower
      where room_id = ($1)::uuid and joined_at >= ($2)::timestamptz - interval '7 days' and joined_at < ($2)::timestamptz`,
    [String(roomId), new Date(now).toISOString()],
  );
  return Number(row?.n || 0);
}

/** Turns (messages) across THIS Room in the 7 days ending `now` -
 *  `api/_ops.js`'s own `roomOverview` 24h read, widened to 7 days, over the
 *  SAME `vy_room_follower_day` table that read already uses. This file is
 *  added to that table's `aggregateOnly` readers in
 *  evals/room-leak/world.mjs's own TABLE_ROLES (a pure `sum(turns)`, no
 *  content column, no `select *`, the same shape `_ops.js`'s own read
 *  already passes that scan with). */
async function messagesThisWeekFor(db, roomId, now) {
  const [row] = await db(
    `select coalesce(sum(turns), 0)::int as n
       from vy_room_follower_day
      where room_id = ($1)::uuid and day >= (($2)::timestamptz - interval '7 days')::date and day < ($2)::timestamptz::date`,
    [String(roomId), new Date(now).toISOString()],
  );
  return Number(row?.n || 0);
}

/** The Pulse note's headline, if published this week - see this file's own
 *  header. `null` on any error or on an empty/not-yet-floored week, never
 *  thrown - a Pulse read failure must never block the push itself, the same
 *  best-effort posture `api/_incidents.js`'s `notifyNewIncidentKinds` takes
 *  for its own per-subscription send.
 *
 *  Deliberately NOT `readPulse`'s own `note` field verbatim: that string
 *  opens with a fixed, two-sentence disclaimer ("Pulse counts what your
 *  followers talk about..."), and a lock-screen notification body has so
 *  little room that the disclaimer alone can consume it, truncating away
 *  the one fact worth sending before it ever appears (found by RUNNING this
 *  eval's own §4 world, not reasoned about - `evals/creator-push/run.mjs`'s
 *  own header). So this derives its OWN short headline directly from
 *  `readPulse`'s `combo_buckets` field - the SAME already-floor-checked
 *  (`follower_count >= 5`, migration 097's own CHECK on the underlying
 *  table, re-checked here defensively) rows `weeklyNote` itself reads, a
 *  handful of lines of `weeklyNote`'s own "prefer the single-label bucket,
 *  else the highest count" pick restated for a one-line result instead of a
 *  paragraph - never a second, less-safe data source. "Published" is
 *  `combo_buckets.length > 0`; `pulse.status` is NOT used here (that field
 *  reflects the OLDER v0 single-topic snapshot alone, `readPulse`'s own
 *  header - the two can legitimately disagree, and this function's own
 *  "published" question is about v1 combos, never v0). */
async function pulseHeadlineFor(db, ownerUserId, replicaId) {
  try {
    const pulse = await readPulse(db, ownerUserId, replicaId);
    const buckets = Array.isArray(pulse?.combo_buckets) ? pulse.combo_buckets : [];
    const clean = buckets.filter((b) => Array.isArray(b?.labels) && b.labels.length > 0 && Number(b.follower_count) >= 5);
    if (!clean.length) return null;
    const single = clean.find((b) => b.labels.length === 1);
    const top = single || clean.slice().sort((a, b) => Number(b.follower_count) - Number(a.follower_count))[0];
    return `Top this week: ${top.labels.join(" and ")}.`;
  } catch {
    return null;
  }
}

/** ISO week start (Monday, UTC midnight) for `now` - the SAME week-key
 *  shape `api/_pulse.js` uses for its own snapshots, restated here rather
 *  than imported (that function is not exported; duplicating six lines is
 *  cheaper than widening `_pulse.js`'s own export surface for a workstream
 *  that only reads it, not the file this workstream's brief names). */
function isoWeekStartDate(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
  return monday;
}

/**
 * ONE push per creator with a published Room (workstream law 3). For each
 * published, unpaused Room, computes this week's followers/messages,
 * claims THIS Room's own ledger row for THIS ISO week (the unique
 * (room_id, week_start) index - a second call for the same Room/week gets
 * zero rows back and is skipped, never a second send), and, only on a win,
 * sends one push per this owner's own active subscription.
 *
 * `deps.creatorPushSubscriptionsFor`/`deps.revokeCreatorPushSubscription`
 * mirror `api/_incidents.js#notifyNewIncidentKinds`'s own injected-deps
 * shape exactly - production wires the real functions above; an eval that
 * omits them exercises the ledger-claim half alone. NEVER throws for one
 * Room's own failure - one error isolates to one Room, `api/_pulse.js#runPulseSweep`'s
 * own per-room try/catch restated.
 */
export async function sendCreatorWeeklyPushes(db, deps = {}) {
  const summary = { checked: 0, sent_ledger: 0, pushed: 0, errors: 0, error_details: [] };
  if (typeof db !== "function") return summary;
  const now = deps.now ?? Date.now();
  const env = deps.env || process.env;
  const config = creatorPushConfig(env);
  if (!config.configured) return summary;

  const weekStart = isoWeekStartDate(now).toISOString().slice(0, 10);
  const cap = Math.max(1, Math.min(200, Number(deps.limit) || 50));
  let rooms;
  try {
    rooms = await db(
      `select room_id, slug, display_name, replica_id, owner_user_id
         from vy_room
        where published_at is not null and paused_at is null
        order by published_at asc
        limit $1`,
      [cap],
    );
  } catch (error) {
    console.error("[creator-push] room scan failure:", error?.message || "unknown");
    return summary;
  }
  summary.checked = rooms.length;

  const resolveSubs = typeof deps.creatorPushSubscriptionsFor === "function"
    ? deps.creatorPushSubscriptionsFor
    : async () => [];
  const sendPush = deps.sendPush || webPushSend;
  const revoke = typeof deps.revokeCreatorPushSubscription === "function"
    ? deps.revokeCreatorPushSubscription
    : async () => {};

  for (const room of rooms) {
    try {
      const [followers, messages, headline] = await Promise.all([
        followersThisWeekFor(db, room.room_id, now),
        messagesThisWeekFor(db, room.room_id, now),
        pulseHeadlineFor(db, room.owner_user_id, room.replica_id),
      ]);

      // THE CLAIM. ON CONFLICT (room_id, week_start) DO NOTHING - a second
      // sweep tick (or a retried cron run) racing this same Room/week gets
      // zero rows back and sends nothing, workstream law 4's own negative
      // control.
      const claimed = await db(
        `insert into vy_creator_weekly_push (push_id, room_id, week_start, sent_at, followers_count, messages_count, headline_included)
         values (($1)::uuid, ($2)::uuid, ($3)::date, now(), $4, $5, $6)
         on conflict (room_id, week_start) do nothing
         returning push_id`,
        [randomUUID(), room.room_id, weekStart, followers, messages, Boolean(headline)],
      );
      if (!claimed.length) continue;
      summary.sent_ledger++;

      const payload = JSON.stringify(creatorWeeklyPushPayload(room.slug, room.display_name, followers, messages, headline));
      let subs = [];
      try {
        subs = (await resolveSubs(room.owner_user_id)) || [];
      } catch {
        subs = [];
      }
      for (const sub of subs) {
        try {
          const result = await sendPush(sub, payload, {
            vapidPublic: config.vapid_public,
            vapidPrivate: String(env.ROOM_PUSH_VAPID_PRIVATE || ""),
            vapidSubject: String(env.ROOM_PUSH_VAPID_SUBJECT || ""),
            now,
          });
          if (result?.ok) summary.pushed++;
          else if (result?.status === 404 || result?.status === 410) await revoke(db, sub.id);
        } catch (error) {
          console.error("[creator-push] send failure:", error?.message || "unknown");
        }
      }
    } catch (error) {
      summary.errors++;
      summary.error_details.push({ room_id: room.room_id, message: error?.message || String(error) });
    }
  }
  return summary;
}

// Referenced by the static control in evals/creator-push/run.mjs - kept
// here so a change to what a follower-facing column is called anywhere in
// this file is visible in one place.
export const CREATOR_PUSH_FOLLOWER_CONTENT_NAMES = Object.freeze(FOLLOWER_CONTENT_NAMES);
