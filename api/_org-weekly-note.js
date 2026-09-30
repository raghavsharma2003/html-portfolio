// api/_org-weekly-note.js - the Suite admin's weekly note (WS-R127,
// migration 132).
//
// WS-R74 (migration 118, api/_creator-push.js) gave a CREATOR a weekly push
// about their own Room. A Suite admin - the one who actually bought the
// seats - gets nothing today: "a coaching institute that bought five seats
// has no idea whether anyone used them" (this workstream's own brief,
// verbatim). This file is the identical mechanism restated for the admin
// lane: one note per Suite, once a week, carrying every attached Room's own
// already-aggregated counts, floored per Room at n>=5 the same way
// `api/_operator-digest.js#digestCounts` floors its own platform-wide sum -
// "a Room under the floor shows 'fewer than five' by name, never a number"
// (workstream law 1, verbatim).
//
// ── WHAT THIS FILE OWNS ─────────────────────────────────────────────────
//
//   1. `buildOrgWeeklyNote(db, org, now)` - reads THIS Suite's own attached
//      Rooms and, per Room, the SAME 7-day followers/messages aggregate
//      `api/_creator-push.js#followersThisWeekFor`/`messagesThisWeekFor`
//      already compute for the identical question one lane over (restated
//      here rather than imported - this file's own header on why, right
//      below) - never a follower or thread table read directly, never
//      `select *`. The floor is applied HERE, once, at the source: a Room
//      under 5 followers this week gets `followers_joined_7d: null` and
//      `followers_joined_below_floor: true` in the very object this
//      function returns, so no downstream consumer (the push payload
//      builder, the Suite board's own read, the email seam) can ever see
//      the raw number even by accident - `api/_operator-digest.js#digestCounts`'s
//      own "the floored boolean travels, the raw number never does once
//      below the floor" law, applied at construction time instead of only
//      inside the payload builder.
//   2. `orgWeeklyNotePushPayload(note)` - the push body. Takes ONLY the
//      already-built, already-floored `note` object as its PARAMETER -
//      `api/_creator-push.js#creatorWeeklyPushPayload`'s own "the parameter
//      list IS the enforcement" law, restated a fifth way
//      (`_incidents.js#incidentPushPayload`, `_operator-digest.js#operatorDigestPayload`
//      and `_creator-push.js#creatorWeeklyPushPayload` are the second,
//      third and fourth). There is no variable in scope inside that
//      function that could ever hold a follower id or a raw message, so no
//      code path through it can put one on the wire -
//      `evals/org-weekly-note/run.mjs`'s static control greps this
//      function's own source for the names of every follower-facing column
//      this repo has and fails if any appear (`evals/room-leak/run.mjs`'s
//      own layer 16 restates the identical scan as a leak-battery layer).
//   3. `sendOrgWeeklyNotes(db, deps)` - the cron's own step. For every
//      Suite, claims THIS Suite's own ledger row for THIS ISO week PER
//      CHANNEL (`vy_org_weekly_note`'s own unique `(org_id, week_start,
//      channel)` index is the WHOLE idempotency mechanism, migration 132's
//      own header) and, only on a win, sends to every admin's own active
//      push subscription (`api/_creator-push.js`'s own subscription table,
//      reused verbatim - see the note below on why that is not a lane
//      violation) or records a would-send on the email seam
//      (`api/_email-seam.js`).
//   4. `sendTestOrgWeeklyNote(db, callerOwnerUserId, orgId, deps)` - the
//      Suite board's own "Send a test note now" control (workstream law 4).
//      Sends to the CALLING admin's own active subscriptions only, marks
//      the title as a test, and writes NO ledger row of any kind - a test
//      send can never consume the one real send/week/channel the ledger's
//      own unique index protects.
//
// ── WHY THIS FILE REUSES `vy_creator_push_subscription`, NOT A NEW TABLE ──
//
// `subscribeCreatorPush`/`creatorPushSubscriptionsFor` (api/_creator-push.js)
// are keyed on `owner_user_id` ALONE - nothing about that table's shape, its
// unique index, or its read says "this owner subscribed AS A CREATOR". An
// admin who is ALSO a creator already has exactly one row there; an admin
// who is not a creator at all subscribes through the SAME "This week on
// your phone" control every creator sees (`StudioApp.tsx`'s `WeeklyPushCard`,
// mounted for every signed-in owner regardless of whether they have a Room)
// and gets the identical row. Building a second, org-scoped subscription
// table would duplicate that entire mechanism (endpoint/p256dh/auth
// validation, the upsert-by-conflict-key shape, the 404/410 revoke path) for
// zero behavioural difference - this workstream's own brief names the reuse
// explicitly ("WS-R74's table shape reused, keyed by the admin's user id").
//
// ── WHY THIS FILE DOES NOT IMPORT `api/_org.js` ────────────────────────────
//
// `api/_org.js`'s own `orgBoard`/`listMyOrgs` already read a Suite's
// attached Rooms and its admin roster, and importing them here would look
// like the obvious reuse - but `api/_org.js` does NOT import this file back
// (its own `listMyOrgs`/`orgBoard` read `vy_org_weekly_note`'s own
// `max(sent_at)` by a plain correlated subquery, in the SAME statement,
// never through a function this file exports), so there is no cycle risk
// either direction; the reads below are restated as their OWN minimal
// queries anyway because `orgBoard` computes six aggregates per Room this
// feature needs none of (checkins, deliveries, subscriptions, revenue,
// drift, Pulse) - calling it from a cron sweeping every Suite once a week
// would multiply that cost by every Room on the platform for numbers this
// note never shows. `followersThisWeekFor`/`messagesThisWeekFor` are
// restated from `api/_creator-push.js` rather than imported for the
// identical reason `api/_operator-digest.js` restates `opsOwnerIdsLocal`
// rather than importing it from `api/_ops.js` - two independent leaf
// queries, six lines each, are cheaper to keep in sync by inspection than a
// shared export is to keep free of an import-cycle surprise.
//
// ── THE STATIC-SCAN GUARANTEE (workstream law 3, evals/room-leak layer 16) ─
//
// This file imports exactly: `node:crypto` (`randomUUID`), `./_creator-push.js`
// (subscription management only - `creatorPushConfig`/`creatorPushSubscriptionsFor`/
// `revokeCreatorPushById`, never `pulseHeadlineFor` or anything Pulse-shaped),
// `./_push/webpush.js` (`send`), and `./_email-seam.js` (this workstream's
// own new file). None of the four is a follower-lane module - none touches
// `api/memory.js`'s PERSON_TABLES, `api/_room-surface.js`, `api/_handoff.js`,
// or any table `evals/room-leak/world.mjs`'s TABLE_ROLES marks person-keyed -
// and every SQL statement this file runs itself is scoped to `vy_room`,
// `vy_room_follower` (bare `count(*)`, never a row), `vy_room_follower_day`
// (bare `sum(turns)`, never a row), `vy_org_member` and `vy_org_weekly_note`.
import { randomUUID } from "node:crypto";
import { creatorPushConfig, creatorPushSubscriptionsFor, revokeCreatorPushById } from "./_creator-push.js";
import { send as webPushSend } from "./_push/webpush.js";
import { emailSeamConfigured, recordWouldSendOrgWeeklyNoteEmail } from "./_email-seam.js";

const FOLLOWER_FLOOR = 5;

export class OrgWeeklyNoteError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "OrgWeeklyNoteError";
    this.code = code;
    this.status = status;
  }
}

// ISO week start (Monday, UTC midnight) - `api/_creator-push.js#isoWeekStartDate`'s
// own restatement, restated a second time for the identical reason that
// file's own header gives for restating `api/_pulse.js`'s version: cheaper
// to duplicate six lines than to widen an unrelated file's export surface.
function isoWeekStartDate(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
  return monday;
}

/** Followers who joined THIS Room in the 7 days ending `now` -
 *  `api/_creator-push.js#followersThisWeekFor`'s own query, restated (this
 *  file's own header on why). Bare `count(*)`, no follower row ever leaves
 *  Postgres. */
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
 *  `api/_creator-push.js#messagesThisWeekFor`'s own query, restated. Bare
 *  `sum(turns)`, no message row ever leaves Postgres. */
async function messagesThisWeekFor(db, roomId, now) {
  const [row] = await db(
    `select coalesce(sum(turns), 0)::int as n
       from vy_room_follower_day
      where room_id = ($1)::uuid and day >= (($2)::timestamptz - interval '7 days')::date and day < ($2)::timestamptz::date`,
    [String(roomId), new Date(now).toISOString()],
  );
  return Number(row?.n || 0);
}

/** Law 1's floor, applied at construction - see this file's header on why
 *  the null happens HERE rather than only inside the payload builder. Pure. */
export function orgWeeklyNoteRoomLine(room, followers, messages) {
  const belowFloor = Number(followers) < FOLLOWER_FLOOR;
  return {
    room_id: String(room.room_id),
    // A Room's own PUBLIC display name - already shown to anyone who opens
    // `/r/<slug>` - `api/_creator-push.js#creatorWeeklyPushPayload`'s own
    // precedent for the identical field, never follower content.
    display_name: String(room.display_name || "").slice(0, 80),
    published: Boolean(room.published_at) && !room.paused_at,
    followers_joined_7d: belowFloor ? null : Number(followers),
    followers_joined_below_floor: belowFloor,
    messages_last_7d: Math.max(0, Math.trunc(Number(messages) || 0)),
  };
}

/** Every Room attached to this Suite, in creation order - the SAME
 *  `org_id = $1` scoping `api/_org.js#orgBoard`'s own Rooms read uses, no
 *  follower/thread column named. */
async function roomsForOrg(db, orgId) {
  return db(
    `select room_id, display_name, published_at, paused_at
       from vy_room
      where org_id = ($1)::uuid
      order by created_at asc`,
    [String(orgId)],
  );
}

/** Every ACTIVE Suite - "0 Rooms attached, 0 followers joined" is exactly
 *  the diagnostic this feature exists to hand an admin who is not sure
 *  anyone used their seats, so a Suite with no Rooms yet still gets a note
 *  rather than being silently skipped. */
export async function orgsForWeeklyNote(db, cap) {
  return db(`select org_id, name from vy_org order by created_at asc limit $1`, [Math.max(1, Math.min(500, Number(cap) || 200))]);
}

/** Every admin of this Suite - `vy_org_member`'s own `role = 'admin'`
 *  predicate, `api/_org.js#orgBoard`'s own admin-membership join restated
 *  as a plain list rather than an EXISTS check. */
export async function orgAdminUserIds(db, orgId) {
  const rows = await db(`select owner_user_id from vy_org_member where org_id = ($1)::uuid and role = 'admin'`, [String(orgId)]);
  return rows.map((r) => String(r.owner_user_id));
}

/**
 * Law 1. One Suite's own note: every attached Room's own floored weekly
 * line, plus the Suite-level rollups the push/email bodies read. `org` is
 * `{org_id, name}` (this file's own `orgsForWeeklyNote`/the door's own
 * `vy_org` row - either shape works, only these two fields are read).
 */
export async function buildOrgWeeklyNote(db, org, now) {
  const weekStart = isoWeekStartDate(now).toISOString().slice(0, 10);
  const rooms = await roomsForOrg(db, org.org_id);
  const lines = [];
  for (const room of rooms) {
    const [followers, messages] = await Promise.all([
      followersThisWeekFor(db, room.room_id, now),
      messagesThisWeekFor(db, room.room_id, now),
    ]);
    lines.push(orgWeeklyNoteRoomLine(room, followers, messages));
  }
  return {
    org_id: String(org.org_id),
    org_name: String(org.name || "").slice(0, 120),
    week_start: weekStart,
    generated_at: new Date(now).toISOString(),
    rooms_total: lines.length,
    rooms_published: lines.filter((r) => r.published).length,
    rooms: lines,
  };
}

// Every follower-facing content column this repo has ever put a name to -
// `api/_creator-push.js#CREATOR_PUSH_FOLLOWER_CONTENT_NAMES`'s own list,
// restated independently (that file's own header: "two independent
// guarantees should not share one list that could silently drift both at
// once"), plus `slug` (this function never reads a Room's slug at all -
// only its already-public `display_name`).
const ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES = [
  "slug", "thread_title", "content", "message_text", "payload_text", "reply_text", "person_id", "follower_id",
];

/**
 * Law 3. Pure - takes ONLY the already-built `note` object (law 1's own
 * floor already applied) and returns `public/room-sw.js`'s own `{t, title,
 * body, url}` contract, `api/_creator-push.js#creatorWeeklyPushPayload`'s
 * own shape restated for a Suite instead of a Room. Every Room line reads
 * `followers_joined_below_floor` FIRST, so a Room under the floor is
 * rendered as "fewer than five followers" by name, and
 * `note.rooms[i].followers_joined_7d` (already `null` below the floor) is
 * never interpolated when that boolean is true - even a caller that handed
 * this function a hand-built `note` with a stray raw number left in a
 * floored slot cannot leak it, since the branch never reads that field at
 * all once the boolean says so.
 */
export function orgWeeklyNotePushPayload(note) {
  const roomsPublished = Math.max(0, Math.trunc(Number(note?.rooms_published) || 0));
  const roomsTotal = Math.max(0, Math.trunc(Number(note?.rooms_total) || 0));
  const rooms = Array.isArray(note?.rooms) ? note.rooms : [];
  const orgName = String(note?.org_name || "your Suite").slice(0, 120);

  const lines = rooms.slice(0, 25).map((r) => {
    const name = String(r?.display_name || "a Room").slice(0, 80);
    const followersPart = r?.followers_joined_below_floor
      ? "fewer than five followers"
      : `${Math.max(0, Math.trunc(Number(r?.followers_joined_7d) || 0))} follower${Number(r?.followers_joined_7d) === 1 ? "" : "s"}`;
    const messages = Math.max(0, Math.trunc(Number(r?.messages_last_7d) || 0));
    return `${name}: ${followersPart}, ${messages} message${messages === 1 ? "" : "s"}`;
  });

  const body = `${roomsPublished} of ${roomsTotal} Room${roomsTotal === 1 ? "" : "s"} live this week. ${lines.join("; ")}`.slice(0, 600);

  return {
    t: "org_week",
    title: `${orgName}: your Suite's weekly note`,
    body,
    url: "/studio?mode=suite",
  };
}

/** Referenced by `evals/org-weekly-note/run.mjs`'s and `evals/room-leak/
 *  run.mjs`'s (layer 16) own static controls. */
export const ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES_EXPORT = Object.freeze(ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES);

/**
 * The cron's own step (workstream law 3). NEVER throws for one Suite's own
 * failure - one error isolates to one Suite, `api/_creator-push.js#sendCreatorWeeklyPushes`'s
 * own per-room try/catch restated for a per-org loop.
 */
export async function sendOrgWeeklyNotes(db, deps = {}) {
  const summary = {
    checked: 0, sent_ledger_push: 0, sent_ledger_email: 0, pushed: 0, email_would_send: 0,
    errors: 0, error_details: [],
  };
  if (typeof db !== "function") return summary;
  const now = deps.now ?? Date.now();
  const env = deps.env || process.env;
  const pushConfig = (deps.pushConfig || creatorPushConfig)(env);
  const emailOn = (deps.emailSeamConfigured || emailSeamConfigured)(env);
  if (!pushConfig.configured && !emailOn) return summary;

  const weekStart = isoWeekStartDate(now).toISOString().slice(0, 10);
  const cap = Math.max(1, Math.min(200, Number(deps.limit) || 50));
  let orgs;
  try {
    orgs = await (deps.orgsForWeeklyNote || orgsForWeeklyNote)(db, cap);
  } catch (error) {
    console.error("[org-weekly-note] org scan failure:", error?.message || "unknown");
    return summary;
  }
  summary.checked = orgs.length;

  const buildNote = deps.buildOrgWeeklyNote || buildOrgWeeklyNote;
  const resolveAdmins = deps.orgAdminUserIds || ((orgId) => orgAdminUserIds(db, orgId));
  const resolveSubs = deps.creatorPushSubscriptionsFor || ((ownerId) => creatorPushSubscriptionsFor(db, ownerId));
  const sendPush = deps.sendPush || webPushSend;
  const revoke = deps.revokeCreatorPushSubscription || ((database, id) => revokeCreatorPushById(database, id));
  const sendEmail = deps.recordEmailSend || recordWouldSendOrgWeeklyNoteEmail;

  for (const org of orgs) {
    try {
      const note = await buildNote(db, org, now);

      if (pushConfig.configured) {
        const claimed = await db(
          `insert into vy_org_weekly_note (note_id, org_id, week_start, sent_at, channel)
           values (($1)::uuid, ($2)::uuid, ($3)::date, now(), 'push')
           on conflict (org_id, week_start, channel) do nothing
           returning note_id`,
          [randomUUID(), org.org_id, weekStart],
        );
        if (claimed.length) {
          summary.sent_ledger_push++;
          const payload = JSON.stringify(orgWeeklyNotePushPayload(note));
          let admins = [];
          try {
            admins = (await resolveAdmins(org.org_id)) || [];
          } catch {
            admins = [];
          }
          for (const adminId of admins) {
            let subs = [];
            try {
              subs = (await resolveSubs(adminId)) || [];
            } catch {
              subs = [];
            }
            for (const sub of subs) {
              try {
                const result = await sendPush(sub, payload, {
                  vapidPublic: pushConfig.vapid_public,
                  vapidPrivate: String(env.ROOM_PUSH_VAPID_PRIVATE || ""),
                  vapidSubject: String(env.ROOM_PUSH_VAPID_SUBJECT || ""),
                  now,
                });
                if (result?.ok) summary.pushed++;
                else if (result?.status === 404 || result?.status === 410) await revoke(db, sub.id);
              } catch (error) {
                console.error("[org-weekly-note] push send failure:", error?.message || "unknown");
              }
            }
          }
        }
      }

      if (emailOn) {
        const claimedEmail = await db(
          `insert into vy_org_weekly_note (note_id, org_id, week_start, sent_at, channel)
           values (($1)::uuid, ($2)::uuid, ($3)::date, now(), 'email')
           on conflict (org_id, week_start, channel) do nothing
           returning note_id`,
          [randomUUID(), org.org_id, weekStart],
        );
        if (claimedEmail.length) {
          summary.sent_ledger_email++;
          try {
            await sendEmail(note);
            summary.email_would_send++;
          } catch (error) {
            console.error("[org-weekly-note] email seam failure:", error?.message || "unknown");
          }
        }
      }
    } catch (error) {
      summary.errors++;
      summary.error_details.push({ org_id: org.org_id, message: error?.message || String(error) });
    }
  }
  return summary;
}

/**
 * Law 4. "Send a test note now" - sends the SAME `orgWeeklyNotePushPayload`
 * shape, title prefixed "TEST", to the CALLING admin's own active
 * subscriptions only, and NEVER touches `vy_org_weekly_note` at all - a test
 * send can never consume the one real send/week/channel the ledger's own
 * unique index protects.
 *
 * Admin-only, checked here (defense in depth, `api/_operator-digest.js#sendTestOperatorDigest`'s
 * own posture: `api/org.js`'s door dispatches this op to any authenticated
 * owner, so the admin membership check has to live where a fake `db` can
 * reach it, never only at the door). Throws `org_not_found` (404, never a
 * 403 that would confirm the Suite exists) for a non-admin - `api/_org.js`'s
 * own "404, never 403" law for every other admin-only op, restated.
 */
export async function sendTestOrgWeeklyNote(db, callerOwnerUserId, orgId, deps = {}) {
  if (typeof db !== "function") throw new Error("org_weekly_note_database_required");
  const admin = await db(
    `select 1 from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1`,
    [String(orgId), String(callerOwnerUserId)],
  );
  if (!admin.length) throw new OrgWeeklyNoteError("org_not_found", 404);

  const summary = { pushed: 0 };
  const env = deps.env || process.env;
  const pushConfig = (deps.pushConfig || creatorPushConfig)(env);
  if (!pushConfig.configured) return summary;

  const orgRows = await db(`select org_id, name from vy_org where org_id = ($1)::uuid limit 1`, [String(orgId)]);
  if (!orgRows[0]) throw new OrgWeeklyNoteError("org_not_found", 404);

  const now = deps.now ?? Date.now();
  const note = await (deps.buildOrgWeeklyNote || buildOrgWeeklyNote)(db, orgRows[0], now);
  const payload = orgWeeklyNotePushPayload(note);
  payload.title = `TEST - ${payload.title}`;
  const body = JSON.stringify(payload);

  const resolveSubs = deps.creatorPushSubscriptionsFor || ((ownerId) => creatorPushSubscriptionsFor(db, ownerId));
  const sendPush = deps.sendPush || webPushSend;
  const revoke = deps.revokeCreatorPushSubscription || ((database, id) => revokeCreatorPushById(database, id));

  let subs = [];
  try {
    subs = (await resolveSubs(callerOwnerUserId)) || [];
  } catch {
    subs = [];
  }
  for (const sub of subs) {
    try {
      const result = await sendPush(sub, body, {
        vapidPublic: pushConfig.vapid_public,
        vapidPrivate: String(env.ROOM_PUSH_VAPID_PRIVATE || ""),
        vapidSubject: String(env.ROOM_PUSH_VAPID_SUBJECT || ""),
        now,
      });
      if (result?.ok) summary.pushed++;
      else if (result?.status === 404 || result?.status === 410) await revoke(db, sub.id);
    } catch (error) {
      console.error("[org-weekly-note] test send failure:", error?.message || "unknown");
    }
  }
  return summary;
}

/** The Suite board's own "Last delivered" read, ACROSS every channel - the
 *  most recent send of any kind. Exported for `evals/org-weekly-note/run.mjs`
 *  alone: `api/_org.js`'s own `listMyOrgs`/`orgBoard` read this same fact by
 *  a plain correlated subquery in their own single SQL statement (this
 *  file's header explains why), never by calling this function - it exists
 *  so the eval can assert the SQL shape those two callers rely on without
 *  duplicating the query text a third time. */
export async function lastOrgWeeklyNote(db, orgId) {
  if (typeof db !== "function") return { last_sent_at: null };
  const [row] = await db(`select max(sent_at) as sent_at from vy_org_weekly_note where org_id = ($1)::uuid`, [String(orgId)]);
  return { last_sent_at: row?.sent_at || null };
}
