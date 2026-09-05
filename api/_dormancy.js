// api/_dormancy.js — dormancy (WS-R75, migration 119). A follower who has
// not visited for a long time is told, then forgotten with a receipt, on a
// schedule the follower can see, behind a flag that is off.
//
// ── LAW 1: NO NEW PERSON TABLE, NO NEW LEDGER ───────────────────────────────
//
// Every fact this file needs already lives on `vy_room` (`dormancy_days`,
// the owner's own setting) and `vy_room_follower` (`dormancy_notice_at`, the
// one new column on an EXISTING person-lane row). There is no dormancy-
// specific ledger to insert into and nothing here writes to one — the
// notice's own idempotency IS the column: `dormancyNoticeDue` below only
// ever selects a row with `dormancy_notice_at is null`, so the same UPDATE
// that marks the notice sent is also what stops the next sweep tick from
// finding that follower again.
//
// ── LAW 2: THE FORGET PREDICATE NEVER TRUSTS A CLEARED NOTICE ALONE ────────
//
// `dormancyForgetDue` re-checks `last_seen_at` against `dormancy_notice_at`
// directly (`f.last_seen_at <= f.dormancy_notice_at`, "has not visited
// SINCE the notice"), rather than relying solely on `joinRoom`'s own
// defensive clear (`api/_room-surface.js`) to null the column back out. A
// follower who returns and keeps talking — never touching the `join` op
// again — advances `last_seen_at` on every `say`/`speak` turn regardless
// (`roomSay`/`roomSpeak`'s own cap-spend UPDATEs, unchanged by this
// workstream), and that alone is what keeps them out of this predicate.
// This is the property this file's own negative control (b) proves: forget
// a follower who visited after their notice, and the assertion must FAIL
// the naive version and PASS the real one.
//
// ── LAW 3: FORGETTING GOES THROUGH THE REAL roomForget, NEVER A SECOND PATH ─
//
// `dormancySweep` below calls `roomForgetForFollower` — the exact same
// delete sequence, same child-before-parent ordering, same receipt
// `roomForget` (the follower's own "forget me" op) calls, `api/_room-
// surface.js`'s own header explains the split. This file owns no DELETE
// statement of its own for any person-lane table.
//
// ── LAW 4: ROOM_DORMANCY GATES THE SWEEP STEP, NOT THE COLUMNS ─────────────
//
// The columns exist the moment migration 119 is applied, unconditionally —
// `api/_room-publish.js`'s `setRoomDormancyDays` and the account page's own
// read (`roomSettings`) are never gated on this flag, because an owner who
// explicitly sets a policy has explicitly opted in regardless of platform
// defaults. What the flag gates is the SWEEP: with `ROOM_DORMANCY` unset (or
// anything but the exact string `"1"`), `dormancySweep` returns immediately,
// having run neither of the two statements below — `VOICE_IDENTITY_
// CHALLENGE`'s own `voiceIdentityChallengeEnabled` shape (api/_replica-
// voice-identity.js), restated for this flag.
import { activeTelegramChannelFor, roomForgetForFollower } from "./_room-surface.js";
import { activeSubscriptionsFor } from "./_room-push.js";
import { send as webPushSend, dormancyPushPayload } from "./_push/webpush.js";
import { sendRoomCheckinMessage } from "./_room-telegram.js";

/** The floor migration 119's own CHECK enforces — mirrored here (never
 *  re-typed as a bare number) for the same reason `api/_room-publish.js`'s
 *  `ROOM_DORMANCY_DAYS_MIN` is: a bad value gets a named reason, not a raw
 *  constraint-violation 500. The two files agree on the number because both
 *  import nothing from each other (an api/_room-publish.js -> api/_dormancy.js
 *  import would be the only reason to, and neither file needs the other), so
 *  this is deliberately restated rather than shared — `MIN_CREATORS_FOR_DATA`'s
 *  own precedent in api/_renewals.js states the identical tradeoff.
 */
export const DORMANCY_DAYS_MIN = 180;

/** The grace window between a notice going out and the follower actually
 *  being forgotten — the workstream brief's own number, named once rather
 *  than typed twice (the notice predicate subtracts it, the forget predicate
 *  adds it back by comparing timestamps instead of re-deriving it). */
export const DORMANCY_GRACE_DAYS = 30;

/** The ops board's own anonymity floor — `api/_funnel.js`'s `SHARE_ARRIVAL_
 *  FLOOR` restated for a follower count instead of an arrival count. */
export const DORMANCY_OPS_FLOOR = 5;

export function dormancyEnabled(env = process.env) {
  return String(env?.ROOM_DORMANCY || "") === "1";
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 1/2 — THE TWO STATEMENTS, EVERY PREDICATE INSIDE
// ─────────────────────────────────────────────────────────────────────────

/**
 * (a) THE NOTICE. Every follower, across every Room with a policy set,
 * whose `last_seen_at` is older than `dormancy_days - 30` and who carries no
 * notice yet. ONE statement: the UPDATE that marks the notice sent IS the
 * read that finds who is due — there is no separate SELECT this could drift
 * from, `_renewals.js`'s own `recordAndSend` idempotency-by-INSERT restated
 * as idempotency-by-UPDATE-predicate for a column instead of a row.
 * `f.age_attested_at is not null` excludes a row `joinRoom` never finished
 * attesting — the same guard every other follower-scoped write in this
 * repo carries (`api/_room-surface.js`'s own `selfScope`).
 */
export async function dormancyNoticeDue(db, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  return db(
    `update vy_room_follower f
        set dormancy_notice_at = ($1)::timestamptz, updated_at = ($1)::timestamptz
       from vy_room r
      where r.room_id = f.room_id
        and r.dormancy_days is not null
        and f.dormancy_notice_at is null
        and f.age_attested_at is not null
        and f.last_seen_at < ($1)::timestamptz - make_interval(days => r.dormancy_days - ${DORMANCY_GRACE_DAYS})
      returning f.follower_id, f.room_id, f.person_id, f.agent_id, f.locale,
                r.slug, r.display_name`,
    [nowIso],
  );
}

/**
 * (b) WHO IS DUE TO BE FORGOTTEN. Every follower whose notice is older than
 * the grace window AND who has not visited SINCE the notice —
 * `f.last_seen_at <= f.dormancy_notice_at`, this file's own law 2, read
 * directly off the two timestamps rather than trusted from a cleared
 * column. A plain WHERE, no `not exists`, no subquery —
 * `rejected.md#ws-r12-retention-exists-in-select-broke-the-leak-batterys-
 * parser`'s lesson has nothing to apply to here because there is nothing
 * shaped like its failure mode in this statement at all.
 */
export async function dormancyForgetDue(db, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  return db(
    `select f.follower_id, f.room_id, f.person_id, f.agent_id, f.locale, r.slug
       from vy_room_follower f
       join vy_room r on r.room_id = f.room_id
      where f.dormancy_notice_at is not null
        and f.dormancy_notice_at < ($1)::timestamptz - interval '${DORMANCY_GRACE_DAYS} days'
        and f.last_seen_at <= f.dormancy_notice_at`,
    [nowIso],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE MESSAGE — app-voiced, deterministic, never model text. `api/_renewals.
// js`'s own header law restated: kept here as plain JS for the one channel
// that needs server-composed text (a follower's Telegram DM), never
// imported from src/room/copy.ts (api/ and src/ are two different runtimes).
// Deliberately does NOT carry `dormancy_days` — the message is about the
// GRACE WINDOW (a fixed 30 days from THIS notice, `DORMANCY_GRACE_DAYS`),
// never the Room's own overall policy length, so it needs no duration-label
// derivation the account page's own sentence (src/room/copy.ts) does need.
// ─────────────────────────────────────────────────────────────────────────
export function dormancyNoticeTelegramText({ name }, locale = "en") {
  const who = String(name || "").trim() || (locale === "hi" ? "यह" : "This");
  if (locale === "hi") {
    return `आपने ${who} AI पर काफ़ी समय से बात नहीं की। अगर आप अगले ${DORMANCY_GRACE_DAYS} दिनों में नहीं लौटे, तो आपकी बातचीत वहाँ भुला दी जाएगी। इसे बनाए रखने के लिए Room खोलें।`;
  }
  return `You have not visited ${who} AI in a while. If you do not return in the next ${DORMANCY_GRACE_DAYS} days, your conversation there will be forgotten. Open the Room to keep it.`;
}

// ─────────────────────────────────────────────────────────────────────────
// THE SWEEP — one visit per due notice, the real roomForget for every
// follower due to be forgotten. Called from api/renewals-sweep.js (WS-R37's
// own daily cron, "the daily sweep gains two statements" — this workstream's
// own law 2) alongside, never instead of, that sweep's own renewal work.
// ─────────────────────────────────────────────────────────────────────────

export async function dormancySweep(deps, now = Date.now()) {
  const db = deps.db;
  if (typeof db !== "function") throw new Error("dormancy sweep database required");
  const env = deps.env || process.env;
  if (!dormancyEnabled(env)) {
    // LAW 4. Neither statement above runs — the columns exist, nothing else
    // does. Distinguished from "ran and found nothing due" so the ops board
    // (`dormancyThisWeek` below) can tell the two apart.
    return { dormancyNoticesSent: 0, dormancyForgotten: 0, dormancyErrors: 0, dormancyDisabled: true };
  }

  const summary = { dormancyNoticesSent: 0, dormancyForgotten: 0, dormancyErrors: 0, dormancyDisabled: false };

  const due = await (deps.dormancyNoticeDue ?? dormancyNoticeDue)(db, now);
  for (const row of due) {
    try {
      // In-app: unconditional, no network call — `roomSettings`'s own
      // `dormancy_notice_at`-backed read is what a follower's account page
      // shows; the UPDATE above that produced this row IS the delivery.
      summary.dormancyNoticesSent++;

      // Web push: now real (WS-R81). `public/room-sw.js`'s own push handler
      // used to drop any payload whose `t` was not the literal string
      // "checkin" — this workstream's own reason this sweep shipped with
      // NO send path at all (`context/rejected.md#ws-r75-web-push-type-
      // switch-drops-every-non-checkin-payload`). That worker now
      // recognises `t: "dormancy"`, so this is the first real send.
      // Best-effort, `_renewals.js`'s own sweep posture restated: a send
      // failure here never blocks the notice (the UPDATE above already IS
      // the delivery of record) and is caught here, never left to bubble
      // into the outer per-follower try/catch, so a push failure can never
      // stop the Telegram attempt just below it for the SAME follower.
      const pushSubs = await (deps.activeSubscriptionsFor ?? activeSubscriptionsFor)(db, row.follower_id).catch(() => []);
      if (pushSubs.length) {
        const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
        const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
        const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
        if (vapidPublic && vapidPrivate && vapidSubject) {
          const payload = (deps.dormancyPushPayload ?? dormancyPushPayload)(row.slug, row.display_name);
          for (const sub of pushSubs) {
            try {
              await (deps.webPushSend ?? webPushSend)(sub, payload, {
                fetch: deps.fetch, vapidPublic, vapidPrivate, vapidSubject, now,
              });
            } catch {
              // Best effort — see this block's own header.
            }
          }
        }
      }

      // Telegram: real, functional (no service-worker dispatch involved) —
      // `api/_renewals.js`'s own reuse of the same pointer, restated.
      const pointer = await (deps.activeTelegramChannelFor ?? activeTelegramChannelFor)(db, row.follower_id);
      if (pointer) {
        const token = String(env.ROOM_TELEGRAM_BOT_TOKEN || "");
        if (token) {
          const text = dormancyNoticeTelegramText({ name: row.display_name || row.slug }, row.locale);
          await (deps.sendRoomCheckinMessage ?? sendRoomCheckinMessage)(pointer.channel_ref, text, {
            token,
            fetch: deps.fetch,
          }).catch(() => {});
        }
      }

      // WhatsApp: the brief's own hedge, "a WhatsApp template only if one is
      // approved" — no dormancy-specific template exists in this repo (only
      // `vyakti_checkin_v1`, api/_room-whatsapp.js's own `TEMPLATE_NAME`),
      // and Meta refuses free-form WhatsApp text outside an approved
      // template. Sending one here would mean inventing an unapproved
      // template that would 400 at Meta — the honest-states law names this
      // exact failure shape. Left structurally present (this comment, this
      // gap) and inert until a real template is approved and named by a
      // future workstream, never faked.
    } catch (error) {
      summary.dormancyErrors++;
    }
  }

  const forgetDue = await (deps.dormancyForgetDue ?? dormancyForgetDue)(db, now);
  for (const row of forgetDue) {
    try {
      await (deps.roomForgetForFollower ?? roomForgetForFollower)(
        db,
        { roomId: row.room_id, personId: row.person_id, agentId: row.agent_id, slug: row.slug, locale: row.locale },
        deps,
      );
      summary.dormancyForgotten++;
    } catch (error) {
      summary.dormancyErrors++;
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// THE OPS BOARD READ — n>=5 floored, never a person nameable from a small
// bucket. Reads `vy_sweep_run`'s own `counts` (WS-R21, migration 084,
// already applied and gated by nothing this file needs to check) rather
// than a dedicated ledger — this file's own law 1 restated for a read
// instead of a write: `renewals-sweep.js` folds this sweep's summary into
// the SAME "renewals" sweep row every day, so a rolling 7-day SUM over that
// row's history is the real weekly count, no new table required.
// ─────────────────────────────────────────────────────────────────────────
export async function dormancyThisWeek(db, now = Date.now(), deps = {}) {
  if (typeof db !== "function") throw new Error("dormancy_database_required");
  const env = deps.env || process.env;
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const rows = await db(
    `select coalesce(sum((counts->>'dormancyNoticesSent')::int), 0)::int as notices,
            coalesce(sum((counts->>'dormancyForgotten')::int), 0)::int as forgotten
       from vy_sweep_run
      where sweep = 'renewals' and started_at >= ($1)::timestamptz`,
    [since],
  );
  const row = rows[0] || {};
  const notices = Number(row.notices || 0);
  const forgotten = Number(row.forgotten || 0);
  return {
    enabled: dormancyEnabled(env),
    notices: notices < DORMANCY_OPS_FLOOR ? null : notices,
    forgotten: forgotten < DORMANCY_OPS_FLOOR ? null : forgotten,
    below_floor: notices < DORMANCY_OPS_FLOOR || forgotten < DORMANCY_OPS_FLOOR,
  };
}
