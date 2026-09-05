// api/_operator-digest.js - the operator's morning digest (WS-R88, migration
// 125). One push a day naming what happened: the self-check's verdict,
// incidents, Rooms published, followers joined, money moved - everything as
// counts, never a name, a slug or a message.
//
// ── WHAT THIS FILE OWNS ──────────────────────────────────────────────────
//
//   1. `digestCounts(overview)` - a pure reduction of `api/_ops.js`'s own
//      `opsOverview()` result (the SAME reads the board already makes - the
//      workstream brief's own law 2, verbatim) down to a handful of numbers
//      and booleans. NEVER reads `overview.rooms[i].slug`,
//      `.display_name`, or any other content-shaped field - only
//      `.published`, `.joined_last_7d`, `.messages_last_24h` and
//      `.revenue_this_month_inr`, all already-aggregated numbers the board
//      itself already shows the operator. Platform-wide `followers_joined`
//      is floored at `>= 5` here, BEFORE the payload builder ever sees it -
//      "one follower joined one Room is fewer than 5" (workstream law 2,
//      verbatim): the floored boolean travels, the raw number never does
//      once below the floor.
//   2. `operatorDigestPayload(counts)` - the push body. Takes ONLY the
//      already-floored, already-aggregated numbers `digestCounts` returns as
//      PARAMETERS - `api/_push/webpush.js`'s own `checkinPushPayload`
//      "the parameter list IS the enforcement" law (WS-R22), restated a
//      fourth way (`_incidents.js#incidentPushPayload`,
//      `_creator-push.js#creatorWeeklyPushPayload` are the second and
//      third). There is no variable in scope inside that function that
//      could ever hold a Room's slug or a follower's own words, so no code
//      path through it can put one on the wire -
//      `evals/operator-digest/run.mjs`'s static control greps this
//      function's own source for the names of every follower/room-content
//      column this repo has and fails if any appear.
//   3. `sendOperatorDigest(db, deps)` - the sweep's own step. Claims TODAY's
//      row in `vy_operator_digest` (migration 125's own unique `day` index
//      is the WHOLE idempotency mechanism, see that migration's header) and,
//      only on a win, sends one push per configured operator's own active
//      subscription.
//   4. `sendTestOperatorDigest(db, ownerUserId, deps)` - the ops board's own
//      "Send a test digest now" control (workstream law 4). Sends to the
//      CALLING operator's own subscriptions only, marks the title as a
//      test, and writes NO ledger row - a test send can never consume the
//      one real send a day the ledger's own unique index protects.
//   5. `lastOperatorDigest(db)` - the board's own "Last digest, sent time"
//      read. Pure, no other import, safe for `api/_ops.js` to import
//      directly (see the note below on why the reverse direction is not
//      safe).
//
// ── NO IMPORT OF api/_ops.js, ON PURPOSE ───────────────────────────────────
//
// `api/_ops.js` needs to show "Last digest" on the board, which means it
// needs to import something FROM this file (`lastOperatorDigest`). If this
// file imported `api/_ops.js` back - for `opsOverview`, `opsOwnerIds`,
// `isOpsOwner`, `operatorPushConfig`, `operatorPushSubscriptionsFor`,
// `revokeOperatorPushById`, all of which this file's write path needs - that
// would be exactly the `api/_ops.js -> api/_operator-digest.js ->
// api/_ops.js` cycle `context/rejected.md#ws-r58-incidents-importing-
// opsownerids-from-ops-js-makes-a-cycle` already names, one file over. So
// this file takes every one of those as an INJECTED `deps` function
// (`sendOperatorDigest`/`sendTestOperatorDigest`'s own `deps.opsOverviewFn`/
// `deps.operatorSubscriptionsFor`/`deps.revokeOperatorSubscription`/
// `deps.sendPush`) - `api/_incidents.js#notifyNewIncidentKinds`'s own
// injected-deps shape exactly - and LOCALLY RESTATES the two small pure
// reads it cannot avoid needing (`opsOwnerIdsLocal`,
// `operatorDigestConfig`) rather than importing them - `api/_incidents.js`'s
// own `opsOwnerIdsLocal` and `api/_creator-push.js`'s own `creatorPushConfig`
// are both the identical restatement, for the identical reason, one file
// each. The two callers that DO need both files (`api/operator-digest-
// sweep.js`, `api/ops.js`) import them separately and wire the real
// functions together via `deps` - never a cross-import.
import { randomUUID } from "node:crypto";
import { send as webPushSend } from "./_push/webpush.js";
import { sanitizeCounts } from "./_sweep-run.js";
// WS-R98. The digest's own Telegram fallback, plus `recordIncident` for
// `sendOperatorTelegram`'s own 403/400 -> provider_telegram write. Safe to
// import directly: `api/_incidents.js` never imports THIS file, and
// `api/_operator-telegram.js` never imports EITHER of these back (see that
// file's own header).
import { sendOperatorTelegram, operatorTelegramConfigured } from "./_operator-telegram.js";
import { recordIncident } from "./_incidents.js";

const FOLLOWER_FLOOR = 5;

// A local re-derivation of `api/_ops.js`'s own `opsOwnerIds` - see this
// file's header on why this is a restatement, not an import.
function opsOwnerIdsLocal(env) {
  return String(env.OPS_OWNER_USER_IDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function isOpsOwnerLocal(userId, env) {
  const ids = opsOwnerIdsLocal(env);
  return ids.length > 0 && ids.includes(String(userId || "").toLowerCase());
}

/** `api/_ops.js#operatorPushConfig`'s own shape, restated - the SAME
 *  restatement `api/_creator-push.js#creatorPushConfig` already is, one
 *  file over, for the identical reason (this file cannot import `_ops.js`).
 *  DELIBERATELY the same env vars (workstream law: "no new env vars") -
 *  one VAPID identity for this whole platform's web push. Never the private
 *  key. */
export function operatorDigestConfig(env = process.env) {
  const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
  const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
  const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
  const configured = Boolean(vapidPublic && vapidPrivate && vapidSubject);
  return { configured, vapid_public: configured ? vapidPublic : null };
}

/**
 * Law 2. Pure reduction of `opsOverview()`'s own shape - reads only
 * `.rooms[].published`/`.joined_last_7d`/`.messages_last_24h`/
 * `.revenue_this_month_inr` (all already-aggregated numbers the board
 * already renders per Room), `.self_check.checked`/`.passed`/`.failed`/
 * `.last_outcome`, and `.incidents.by_kind_door`/`.new_kinds` - never a new
 * query against a person table (law 2, verbatim), never `overview.rooms[i]
 * .slug` or `.display_name`. Every returned field is a number or a
 * boolean, one level deep - the shape `api/_sweep-run.js#sanitizeCounts`
 * already keeps for `vy_sweep_run`, kept here as the SOURCE shape rather
 * than only the sanitizer's own after-the-fact cleanup (belt and
 * suspenders, `vy_incident` (109)'s own "the CHECK is the enforcement, not
 * a comment asking nicely" restated for a JS function instead of a SQL
 * constraint).
 *
 * `followers_joined_below_floor` is `true` whenever the PLATFORM-WIDE sum
 * (never one Room's own count) is under 5 - "one follower joined one Room
 * is fewer than 5" (workstream law 2, verbatim). The raw sum still travels
 * in `followers_joined_7d` for the LEDGER's own content-free digest (a
 * platform-wide integer that could be as large as the whole follower base
 * is not, on its own, a person - `whatsappSpendThisMonth`'s own platform-
 * wide, ungrouped `count(*)` precedent in `api/_ops.js`), but
 * `operatorDigestPayload` below NEVER reads that raw field once
 * `followers_joined_below_floor` is true - see that function's own header.
 */
export function digestCounts(overview) {
  const rooms = Array.isArray(overview?.rooms) ? overview.rooms : [];
  const roomsPublished = rooms.filter((r) => r?.published === true).length;
  const followersJoined = rooms.reduce((s, r) => s + (Number(r?.joined_last_7d) || 0), 0);
  const messagesLast24h = rooms.reduce((s, r) => s + (Number(r?.messages_last_24h) || 0), 0);
  const revenueThisMonthInr = rooms.reduce((s, r) => s + (Number(r?.revenue_this_month_inr) || 0), 0);

  const selfCheck = overview?.self_check || {};
  const incidents = overview?.incidents || {};
  const incidentsToday = Array.isArray(incidents.by_kind_door)
    ? incidents.by_kind_door.reduce((s, r) => s + (Number(r?.count) || 0), 0)
    : 0;

  return {
    rooms_published: roomsPublished,
    followers_joined_7d: followersJoined,
    followers_joined_below_floor: followersJoined < FOLLOWER_FLOOR,
    messages_last_24h: messagesLast24h,
    revenue_this_month_inr: revenueThisMonthInr,
    self_check_checked: Number(selfCheck.checked) || 0,
    self_check_failed: Number(selfCheck.failed) || 0,
    self_check_ran: selfCheck.last_outcome != null && selfCheck.last_outcome !== "never_ran",
    incidents_today: incidentsToday,
    incidents_new_kinds: Array.isArray(incidents.new_kinds) ? incidents.new_kinds.length : 0,
    // WS-R102, widened WS-R116. A COUNT only, never `selfCheck.
    // optional_absent` itself - this digest's own push payload is a
    // broadcast body, and workstream law 3 is explicit: "never the names"
    // (`docs/gurukul/DAY-ONE.md`'s own gap 1, named by a static scan of
    // `operatorDigestPayload`'s own source below). WS-R116 widens the
    // COUNT'S OWN MEANING, not the law: `envPresence` now reports ~90 more
    // names (`docs/gurukul/ENV-MANIFEST.md`), so a flat name count would
    // read as "127 optional not set" the morning after this workstream
    // merges, for a deployment whose actual dark surface is unchanged -
    // alarming and useless in the same breath. `optional_absent_by_section`
    // (`api/_self-check.js#runSelfCheck`, same field `selfCheckOverview`
    // exposes) is grouped by manifest section already; counting SECTIONS
    // with at least one absent name (plus the pre-Rooms `ungrouped` bucket
    // as one more, if non-empty) answers "how many capability areas are
    // dark" - the number that stays roughly stable as the manifest grows,
    // the same way `selfCheck.checked` growing does not inflate `failed`.
    optional_absent_count: sectionsWithAbsences(selfCheck.optional_absent_by_section),
  };
}

/** `{sections, ungrouped}` -> a plain count of "buckets with at least one
 *  absent name" - `ungrouped` counts as one more bucket only when non-empty,
 *  same "an honest empty state contributes nothing" posture this file's
 *  other counts already take. Tolerant of an older/missing shape (an
 *  absent `optional_absent_by_section` reads as zero, never throws) so a
 *  caller feeding this an older `runSelfCheck` result does not crash the
 *  whole digest over one field. */
function sectionsWithAbsences(bySection) {
  const sections = Array.isArray(bySection?.sections) ? bySection.sections.length : 0;
  const ungrouped = Array.isArray(bySection?.ungrouped) && bySection.ungrouped.length > 0 ? 1 : 0;
  return sections + ungrouped;
}

// Every follower/room-content column this repo has ever put a name to on a
// person- or Room-identity-shaped field - `api/_creator-push.js`'s own
// `FOLLOWER_CONTENT_NAMES` list restated, plus `slug`/`display_name` (this
// function's own two forbidden Room-identity fields, `digestCounts`'s own
// header names the reason neither is ever read). Kept independently, not
// imported, the same "two independent guarantees should not share one list
// that could silently drift both at once" reasoning `_creator-push.js`'s
// own header states for the identical choice.
const OPERATOR_DIGEST_FOLLOWER_CONTENT_NAMES = [
  "slug", "display_name", "thread_title", "content", "message_text", "payload_text", "reply_text", "person_id", "follower_id",
];

/**
 * Law 2. `{title, body, kind, route}` - `public/push-sw.js`'s own already-
 * reviewed display worker contract, `api/_incidents.js#incidentPushPayload`'s
 * own precedent restated a third time (`api/_creator-push.js` is the
 * second) - so the operator's real notification is drawn by the SAME
 * already-committed display path every other account-wide push in this
 * repo already uses, never a fourth one this workstream would have to
 * write from scratch.
 *
 * Body is built ENTIRELY from `counts`' own numbers/booleans, sliced to 200
 * characters (law 2's own cap, half `creatorWeeklyPushPayload`'s 400 - a
 * platform-wide summary has fewer facts to carry than one creator's own
 * Room, so it needs less room). `followers_joined_below_floor` decides
 * WHICH sentence is built - the floored branch never reads
 * `counts.followers_joined_7d` at all, so a caller that somehow passed a
 * real sub-5 number through cannot leak it even by accident; the
 * un-floored branch names the real count.
 */
export function operatorDigestPayload(counts) {
  const roomsPublished = Math.max(0, Math.trunc(Number(counts?.rooms_published) || 0));
  const messages = Math.max(0, Math.trunc(Number(counts?.messages_last_24h) || 0));
  const revenue = Math.max(0, Math.trunc(Number(counts?.revenue_this_month_inr) || 0));
  const selfChecked = Math.max(0, Math.trunc(Number(counts?.self_check_checked) || 0));
  const selfFailed = Math.max(0, Math.trunc(Number(counts?.self_check_failed) || 0));
  const incidentsToday = Math.max(0, Math.trunc(Number(counts?.incidents_today) || 0));
  const newKinds = Math.max(0, Math.trunc(Number(counts?.incidents_new_kinds) || 0));
  const optionalAbsent = Math.max(0, Math.trunc(Number(counts?.optional_absent_count) || 0));
  const belowFloor = Boolean(counts?.followers_joined_below_floor);

  const followersPart = belowFloor
    ? "fewer than 5 followers joined"
    : `${Math.max(0, Math.trunc(Number(counts?.followers_joined_7d) || 0))} follower${Number(counts?.followers_joined_7d) === 1 ? "" : "s"} joined`;

  const selfPart = !counts?.self_check_ran
    ? "self-check has not run yet"
    : selfFailed > 0
      ? `self-check ${selfFailed}/${selfChecked} failing`
      : `self-check ${selfChecked}/${selfChecked} passing`;

  const incidentsPart = incidentsToday > 0
    ? `${incidentsToday} incident${incidentsToday === 1 ? "" : "s"} today${newKinds > 0 ? ` (${newKinds} new)` : ""}`
    : "no incidents today";

  // WS-R102, reworded WS-R116. A count only, never a name - `digestCounts`'s
  // own header on why. "Area(s)" rather than "optional [name count]" since
  // WS-R116 widened what `optional_absent_count` counts (manifest SECTIONS
  // with a gap, not raw names, same header) - the word in the body has to
  // match the number or the sentence lies about what it measured. Silent
  // when zero, the same "an honest empty state says nothing extra" posture
  // `incidentsPart` above already takes for zero incidents.
  const optionalPart = optionalAbsent > 0
    ? ` ${optionalAbsent} area${optionalAbsent === 1 ? "" : "s"} with an optional setting not set.`
    : "";

  const body = `${roomsPublished} Room${roomsPublished === 1 ? "" : "s"} live, ${followersPart}, ${messages} message${messages === 1 ? "" : "s"}, Rs ${revenue} this month. ${selfPart}. ${incidentsPart}.${optionalPart}`
    .slice(0, 200);

  return {
    title: "Vyakti - morning digest",
    body,
    kind: "operatorDigest",
    route: "/studio?mode=ops",
  };
}

/** Referenced by `evals/operator-digest/run.mjs`'s own static control -
 *  kept here so a change to what a follower/Room-content column is called
 *  anywhere in this file is visible in one place. */
export const OPERATOR_DIGEST_CONTENT_NAMES = Object.freeze(OPERATOR_DIGEST_FOLLOWER_CONTENT_NAMES);

/** The board's own "Last digest, sent time" read - the ONE function in this
 *  file `api/_ops.js` is safe to import directly (see this file's header).
 *  Pure read, no write, no other import. */
export async function lastOperatorDigest(db) {
  if (typeof db !== "function") return { sent_at: null };
  const [row] = await db(`select sent_at from vy_operator_digest order by day desc limit 1`, []);
  return { sent_at: row?.sent_at || null };
}

/**
 * The cron's own step (workstream law 3). `deps.opsOverviewFn(db, now)` is
 * REQUIRED (never defaulted to a real import - see this file's header on
 * why) - its absence is an honest, loud failure (`Error`), never a silent
 * no-op a missing wire-up could hide behind. `deps.operatorSubscriptionsFor`/
 * `deps.revokeOperatorSubscription`/`deps.sendPush` mirror
 * `api/_incidents.js#notifyNewIncidentKinds`'s own injected-deps shape
 * exactly; production (`api/operator-digest-sweep.js`) wires the real
 * `api/_ops.js` functions in.
 *
 * Unset VAPID or an empty operator allowlist: push runs nothing, honestly.
 * The ledger row is now claimed whenever EITHER channel is configured
 * (WS-R98, `context/decisions.md#ws-r98-notify-claim-widened-to-either-
 * channel` - the identical widening `notifyNewIncidentKinds`,
 * api/_incidents.js, makes for the SAME reason) - so an operator running
 * Telegram alone still gets today's digest, and an operator running push
 * alone sees no change at all. `api/_creator-push.js#sendCreatorWeeklyPushes`'s
 * own "(a) unset VAPID: nothing runs" posture is what this widens: the day
 * a channel gets configured mid-day, THAT channel can still send for TODAY
 * rather than having silently used up its one claim against nobody
 * (`context/decisions.md#ws-r58-notify-claim-only-marks-notified-with-a-
 * configured-recipient`'s own reasoning, restated a third time).
 *
 * NEVER throws for one subscription's own send failure - every push is its
 * own try/catch, `notifyNewIncidentKinds`'s own posture (restated for the
 * Telegram channel beside it).
 */
export async function sendOperatorDigest(db, deps = {}) {
  const summary = { sent_ledger: 0, pushed: 0, telegramSent: 0 };
  if (typeof db !== "function") return summary;
  if (typeof deps.opsOverviewFn !== "function") throw new Error("operator_digest_overview_required");
  const now = deps.now ?? Date.now();
  const env = deps.env || process.env;
  const config = operatorDigestConfig(env);
  const ownerIds = opsOwnerIdsLocal(env);
  const pushConfigured = config.configured && ownerIds.length > 0;
  const telegramConfigured = operatorTelegramConfigured(env);
  if (!pushConfigured && !telegramConfigured) return summary;

  const overview = await deps.opsOverviewFn(db, now);
  const counts = digestCounts(overview);
  const day = new Date(now).toISOString().slice(0, 10);

  // THE CLAIM. `on conflict (day) do nothing` - migration 125's own unique
  // index is the WHOLE idempotency mechanism, this migration's own header.
  const claimed = await db(
    `insert into vy_operator_digest (digest_id, day, sent_at, counts)
     values (($1)::uuid, ($2)::date, now(), $3::jsonb)
     on conflict (day) do nothing
     returning digest_id`,
    [randomUUID(), day, JSON.stringify(sanitizeCounts(counts))],
  );
  if (!claimed.length) return summary;
  summary.sent_ledger = 1;

  const payloadObj = operatorDigestPayload(counts);

  if (pushConfigured) {
    const payload = JSON.stringify(payloadObj);
    const resolveSubs = typeof deps.operatorSubscriptionsFor === "function" ? deps.operatorSubscriptionsFor : async () => [];
    const sendPush = deps.sendPush || webPushSend;
    const revoke = typeof deps.revokeOperatorSubscription === "function" ? deps.revokeOperatorSubscription : async () => {};

    for (const ownerId of ownerIds) {
      let subs = [];
      try {
        subs = (await resolveSubs(db, ownerId)) || [];
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
          console.error("[operator-digest] send failure:", error?.message || "unknown");
        }
      }
    }
  }

  if (telegramConfigured) {
    try {
      const sendTelegram = deps.sendTelegram || sendOperatorTelegram;
      const result = await sendTelegram(db, payloadObj, {
        env,
        fetch: deps.fetch || globalThis.fetch,
        now,
        recordIncident,
      });
      summary.telegramSent = result?.sent || 0;
    } catch (error) {
      console.error("[operator-digest] telegram send failure:", error?.message || "unknown");
    }
  }

  return summary;
}

/**
 * Law 4. "Send a test digest now" - sends the SAME `operatorDigestPayload`
 * shape, title prefixed "TEST", to `ownerUserId`'s OWN active subscriptions
 * only, and NEVER touches `vy_operator_digest` at all - a test send can
 * never consume the one real send/day the ledger's own unique `day` index
 * protects, and no `deps.opsOverviewFn`/ledger claim of any kind runs on
 * this path beyond the one read needed to build a realistic body.
 *
 * `isOpsOwnerLocal(ownerUserId, env)` gates this even though
 * `api/ops.js`'s own door already checked `isOpsOwner` before dispatch -
 * defense in depth, the SAME posture `api/_ops.js#subscribeOperatorPush`'s
 * own WHERE-decides law takes for its INSERT, restated here as an explicit
 * check because there is no SQL WRITE to gate on this read-and-send path:
 * calling this function DIRECTLY with an id not on `OPS_OWNER_USER_IDS`
 * pushes to NOBODY, proven by `evals/room-doors/run.mjs`'s own class (e)
 * negative control.
 */
export async function sendTestOperatorDigest(db, ownerUserId, deps = {}) {
  const summary = { pushed: 0 };
  if (typeof db !== "function") return summary;
  const env = deps.env || process.env;
  if (!isOpsOwnerLocal(ownerUserId, env)) return summary;
  const config = operatorDigestConfig(env);
  if (!config.configured) return summary;
  if (typeof deps.opsOverviewFn !== "function") throw new Error("operator_digest_overview_required");

  const now = deps.now ?? Date.now();
  const overview = await deps.opsOverviewFn(db, now);
  const counts = digestCounts(overview);
  const payload = operatorDigestPayload(counts);
  payload.title = `TEST - ${payload.title}`;
  const body = JSON.stringify(payload);

  const resolveSubs = typeof deps.operatorSubscriptionsFor === "function" ? deps.operatorSubscriptionsFor : async () => [];
  const sendPush = deps.sendPush || webPushSend;
  const revoke = typeof deps.revokeOperatorSubscription === "function" ? deps.revokeOperatorSubscription : async () => {};

  let subs = [];
  try {
    subs = (await resolveSubs(db, ownerUserId)) || [];
  } catch {
    subs = [];
  }
  for (const sub of subs) {
    try {
      const result = await sendPush(sub, body, {
        vapidPublic: config.vapid_public,
        vapidPrivate: String(env.ROOM_PUSH_VAPID_PRIVATE || ""),
        vapidSubject: String(env.ROOM_PUSH_VAPID_SUBJECT || ""),
        now,
      });
      if (result?.ok) summary.pushed++;
      else if (result?.status === 404 || result?.status === 410) await revoke(db, sub.id);
    } catch (error) {
      console.error("[operator-digest] test send failure:", error?.message || "unknown");
    }
  }
  return summary;
}
