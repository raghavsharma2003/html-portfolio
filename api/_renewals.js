// api/_renewals.js - the reminder ledger, and "renewed unasked" made real
// (WS-R37, migration 099). The Phase gate card (WS-R30) has shown "renewed
// unasked" as an honest, hardcoded zero since it shipped: no reminder
// mechanism existed, so nothing could be measured, and WS-R33 built the
// creator-tier table this file finally wires it to.
//
// ── LAW 1: A REMINDER IS A ROW FIRST ────────────────────────────────────
//
// `vy_renewal_reminder`'s primary key IS the idempotency mechanism - `on
// conflict (subject_kind, subject_id, period_end, channel) do nothing`
// inside `recordAndSend` below, never a read-then-send. `dueReminders`'
// three selects each carry their own `not exists` inside the WHERE clause
// (never the SELECT list - `rejected.md#ws-r12-retention-exists-in-select-
// broke-the-leak-batterys-parser`'s lesson applied on arrival), so a subject
// that already has ANY reminder row for this period (any channel) is never
// visited again this period: the NEXT sweep tick's due-select finds nothing,
// which is the whole mechanism NEGATIVE CONTROL (a) proves.
//
// ── LAW 5: CANCEL IS A FIRST-CLASS OP, AND IT NEVER TOUCHES `state` ─────
//
// The three cancel functions below call the provider's own `cancelSubscription`
// with `{atCycleEnd: true}` (widened in api/_payments/providers/{fake,razorpay}.js,
// no prior caller anywhere in this tree) and then set `cancel_at_period_end`
// on the subject's own subscription row - a NEW, LOCAL column (migration
// 099), deliberately separate from `state`. `state` keeps meaning exactly
// what api/_payments.js's own header says it always has ("a fact the
// PROVIDER confirmed"), so the follower-tier-flip predicate in
// `applyWebhook` is untouched and access continues until `current_period_end`
// exactly as the workstream brief requires. `dueReminders` below excludes
// `cancel_at_period_end = true` rows, which is what makes "the reminder for
// that period is not sent" true without inventing a second meaning for
// `state`.
//
// ── WHAT THIS FILE DOES NOT TOUCH ───────────────────────────────────────
//
// No statement here ever names either table the leak battery guards (the
// Room's own member roster or its topic threads) - the three subscription
// tables (`vy_room_subscription`, `vy_org_subscription`,
// `vy_creator_subscription`) already carry every column a due-select or a
// cancel needs (room_id/person_id/follower_id, owner_user_id/replica_id,
// org_id), so this file has no reason to join either guarded table and is
// therefore outside `evals/room-leak/run.mjs`'s scan by construction, never
// by an added allowlist entry. (`evals/renewals/run.mjs`'s own NEGATIVE
// CONTROL (c) greps this file's source for the two literal table names and
// fails if either appears anywhere, comments included - the same "prose,
// not only SQL" scope `rejected.md#ws-r28-leak-battery-scanner-matches-
// prose-not-only-sql` names for the real battery.)
//
// ── CHANNELS (law 3) ─────────────────────────────────────────────────────
//
// In-app is attempted for every due subject on every kind, unconditionally
// and with no network call - the studio card and the Room panel read the
// reminder row directly, so "sent" for `channel='in_app'` means only "the
// row exists to read." Web push and Telegram are attempted for FOLLOWERS
// ONLY, and only where a pointer already exists (`api/_room-push.js`'s
// `activeSubscriptionsFor`, `api/_room-surface.js`'s
// `activeTelegramChannelFor` - reused, never re-implemented). This repo
// carries no SMTP path (grepped before writing this file: no `smtp`,
// `nodemailer`, `sendgrid`, `mailgun`, `ses`, or `resend.com` reference
// anywhere in `api/`), so a creator's ONLY channel is `in_app` - migration
// 099's own `channel` CHECK has no `'email'` value for exactly this reason.
import {
  PaymentsError,
  activeProviderName,
  providerFor,
  providerSecrets,
  paidSessionScope,
  orgAdminOrThrow,
} from "./_payments.js";
import { normalizeLocale, activeTelegramChannelFor } from "./_room-surface.js";
import { activeSubscriptionsFor } from "./_room-push.js";
import { send as webPushSend, renewalPushPayload } from "./_push/webpush.js";
import { sendRoomCheckinMessage } from "./_room-telegram.js";
import { tableApplied } from "./memory.js";
// WS-R129: "quiet hours on every channel" - the follower proxy (this file
// has no check-in row of its own; `api/_quiet-hours.js`'s own header names
// why that is the best this schema can do without a follower-level
// timezone column).
import { quietHoursOkForFollowerSql } from "./_quiet-hours.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RenewalsError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** The window `dueReminders` looks ahead - the workstream brief's own
 *  number, named rather than re-typed at every call site. */
export const REMINDER_WINDOW_DAYS = 7;

/** Below this many creators who have ever renewed at least once, "renewed
 *  unasked" cannot be judged - `api/_phase-gate.js`'s own
 *  `MIN_CREATORS_FOR_DATA` restated here so the two files agree on the
 *  number without either re-typing it as a magic constant. */
export const MIN_CREATORS_FOR_DATA = 3;

const isTableAppliedFor = (deps) => deps.tableApplied ?? tableApplied;

// ─────────────────────────────────────────────────────────────────────────
// THE MESSAGE - app-voiced, deterministic, never model text. `docs/gurukul/
// DESIGN-LAW.md`'s "no urgency, no discount, no countdown" and this
// workstream's own law 4: one sentence, the date, the amount already agreed
// to, one control. Kept here as plain JS (never imported from
// src/room/copy.ts - api/ and src/ are two different runtimes, and
// api/_room-telegram.js's own cards are this repo's precedent for a
// Telegram-shaped copy carrying its own strings rather than importing the
// browser bundle's module) for the ONE channel that needs server-composed
// text: a follower's Telegram DM. The Room panel and the studio's cards
// render the SAME facts (period_end, amount, currency) from their own
// locale table (src/room/copy.ts's new `renewal` block) rather than a
// string this file hands them, so there is exactly one place either
// surface's own words live.
function moneyLabel(amountInr, currency = "INR") {
  const n = Number(amountInr);
  if (!Number.isFinite(n) || n <= 0) return "";
  return currency === "INR" ? `Rs ${n}` : `${n} ${currency}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The one sentence a follower's Telegram DM carries. No urgency, no
 *  discount, no countdown - a stated fact about what the state is and one
 *  place to act on it, `copy.ts`'s `offer` block's own rule restated for a
 *  renewal instead of an upgrade. Never claims a charge will happen when the
 *  provider cannot make one: `priceLabel` is empty (and the no-price
 *  sentence is used) whenever `PAYMENTS_PROVIDER` is `none`/`fake`'s own
 *  amount is unavailable, or the room never set a price. */
export function followerRenewalTelegramText({ name, periodEnd, amountInr, currency, providerName }, locale = "en") {
  const date = dateLabel(periodEnd);
  const price = providerName && providerName !== "none" ? moneyLabel(amountInr, currency) : "";
  const who = String(name || "").trim() || "This";
  if (normalizeLocale(locale) === "hi") {
    return price
      ? `${who} AI ki sadasyata ${date} ko ${price} par naveenikrit hogi. Manage karne ke liye Room kholein.`
      : `${who} AI ki sadasyata ${date} ko naveenikrit hogi. Manage karne ke liye Room kholein.`;
  }
  return price
    ? `${who} AI's subscription renews on ${date} for ${price}. Open the Room to manage it.`
    : `${who} AI's subscription renews on ${date}. Open the Room to manage it.`;
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 1 - THE DUE-SELECT. One statement per subject kind, NOT EXISTS inside.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every subscription, across all three kinds, that is active, not flagged
 * to cancel, whose `current_period_end` falls within the next
 * `REMINDER_WINDOW_DAYS`, and carries no `vy_renewal_reminder` row yet for
 * that period (any channel). Returns `{follower, creator, org}`, each an
 * array tagged with `subject_kind`.
 *
 * WS-R129 ("quiet hours on every channel"): the FOLLOWER query only also
 * excludes a subject currently inside any of their own active check-in
 * schedules' quiet window (`quietHoursOkForFollowerSql`, `api/_quiet-
 * hours.js`) — the follower row itself carries no timezone/quiet-hours
 * column of its own (see that module's own header for the gap this is a
 * proxy for). A subject blocked this tick is simply never inserted into
 * `vy_renewal_reminder` for this (subject, period, channel), so the next
 * daily sweep tick retries it — deferred, not dropped, `dueReminders`'s own
 * idempotency-by-INSERT already relied on nothing about WHEN a subject
 * first appears here. Creator and org reminders are owner-lane (this
 * workstream's brief names them out of scope) and are unaffected.
 */
export async function dueReminders(db, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const windowEndIso = new Date(now + REMINDER_WINDOW_DAYS * 86_400_000).toISOString();

  const followerRows = await db(
    `select s.follower_id as subject_id, s.room_id, s.person_id,
            s.current_period_end as period_end,
            r.slug, r.display_name, f.locale,
            p.follower_price_inr as amount_inr, coalesce(p.currency, 'INR') as currency
       from vy_room_subscription s
       join vy_room r on r.room_id = s.room_id
       join vy_room_follower f on f.follower_id = s.follower_id
       left join vy_room_price p on p.room_id = s.room_id
      where s.state = 'active'
        and s.cancel_at_period_end = false
        and s.current_period_end is not null
        and s.current_period_end >= ($1)::timestamptz
        and s.current_period_end < ($2)::timestamptz
        and not exists (
          select 1 from vy_renewal_reminder rr
           where rr.subject_kind = 'follower'
             and rr.subject_id = s.follower_id
             and rr.period_end = s.current_period_end
        )
        and ${quietHoursOkForFollowerSql("f", 1)}
      order by s.current_period_end asc
      limit 500`,
    [nowIso, windowEndIso],
  );

  const creatorRows = await db(
    `select s.replica_id as subject_id, s.owner_user_id, s.replica_id,
            s.current_period_end as period_end, s.plan,
            s.price_inr as amount_inr, s.currency
       from vy_creator_subscription s
      where s.state = 'active'
        and s.cancel_at_period_end = false
        and s.current_period_end is not null
        and s.current_period_end >= ($1)::timestamptz
        and s.current_period_end < ($2)::timestamptz
        and not exists (
          select 1 from vy_renewal_reminder rr
           where rr.subject_kind = 'creator'
             and rr.subject_id = s.replica_id
             and rr.period_end = s.current_period_end
        )
      order by s.current_period_end asc
      limit 500`,
    [nowIso, windowEndIso],
  );

  const orgRows = await db(
    `select s.org_id as subject_id, s.current_period_end as period_end,
            s.plan, (s.price_per_seat_inr * s.seats)::int as amount_inr, s.currency,
            o.slug, o.name
       from vy_org_subscription s
       join vy_org o on o.org_id = s.org_id
      where s.state = 'active'
        and s.cancel_at_period_end = false
        and s.current_period_end is not null
        and s.current_period_end >= ($1)::timestamptz
        and s.current_period_end < ($2)::timestamptz
        and not exists (
          select 1 from vy_renewal_reminder rr
           where rr.subject_kind = 'org'
             and rr.subject_id = s.org_id
             and rr.period_end = s.current_period_end
        )
      order by s.current_period_end asc
      limit 500`,
    [nowIso, windowEndIso],
  );

  return {
    follower: followerRows.map((r) => ({ ...r, subject_kind: "follower" })),
    creator: creatorRows.map((r) => ({ ...r, subject_kind: "creator" })),
    org: orgRows.map((r) => ({ ...r, subject_kind: "org" })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 1 (continued) - RECORD, THEN SEND
// ─────────────────────────────────────────────────────────────────────────

/**
 * INSERT first (the idempotency), send second. `sendFn` is called ONLY when
 * this call's own INSERT actually landed a new row - a racing second sweep,
 * or a subject already reminded on this channel for this period, finds `on
 * conflict do nothing` firing and never calls `sendFn` at all. A send
 * failure leaves the inserted row exactly where it landed: `sent_at` stays
 * null and `reason` carries a short code, and because the ROW now exists,
 * `dueReminders` will not surface this subject again for this period - a
 * failed send is a fact for a human reading the ops board to see, never
 * something the sweep quietly retries into a duplicate charge-adjacent
 * message.
 */
export async function recordAndSend(db, params, sendFn) {
  const {
    subjectKind, subjectId, periodEnd, channel,
    roomId = null, personId = null, followerId = null,
    ownerUserId = null, replicaId = null, orgId = null,
  } = params || {};
  if (!["creator", "follower", "org"].includes(subjectKind)) {
    throw new RenewalsError("renewal_subject_kind_invalid", 400);
  }
  if (!UUID.test(String(subjectId || ""))) throw new RenewalsError("renewal_subject_id_invalid", 400);
  if (!["in_app", "web_push", "telegram"].includes(channel)) {
    throw new RenewalsError("renewal_channel_invalid", 400);
  }
  const inserted = await db(
    `insert into vy_renewal_reminder
       (subject_kind, subject_id, room_id, person_id, follower_id, owner_user_id, replica_id, org_id,
        period_end, channel)
     values ($1, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::uuid, ($6)::uuid, ($7)::uuid, ($8)::uuid,
             ($9)::timestamptz, $10)
     on conflict (subject_kind, subject_id, period_end, channel) do nothing
     returning reminder_id`,
    [
      subjectKind, String(subjectId), roomId, personId, followerId, ownerUserId, replicaId, orgId,
      new Date(periodEnd).toISOString(), channel,
    ],
  );
  const row = inserted[0];
  if (!row) return { inserted: false, sent: false, reminder_id: null };

  let result;
  try {
    result = await sendFn();
  } catch (error) {
    result = { ok: false, code: String(error?.code || error?.message || "send_threw").slice(0, 120) };
  }
  if (result?.ok) {
    await db(`update vy_renewal_reminder set sent_at = now() where reminder_id = ($1)::uuid`, [row.reminder_id]);
    return { inserted: true, sent: true, reminder_id: row.reminder_id };
  }
  const reason = String(result?.code || result?.reason || "unknown").slice(0, 120);
  await db(`update vy_renewal_reminder set reason = $2 where reminder_id = ($1)::uuid`, [row.reminder_id, reason]);
  return { inserted: true, sent: false, reminder_id: row.reminder_id, reason };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SWEEP - one visit per due subject, every applicable channel attempted
// ─────────────────────────────────────────────────────────────────────────

export async function sweep(deps, now = Date.now()) {
  const db = deps.db;
  if (typeof db !== "function") throw new Error("renewals sweep database required");
  const env = deps.env || process.env;
  const due = await dueReminders(db, now);
  const summary = {
    seenFollower: due.follower.length,
    seenCreator: due.creator.length,
    seenOrg: due.org.length,
    sentInApp: 0,
    sentWebPush: 0,
    sentTelegram: 0,
    failed: 0,
    errors: 0,
  };
  const providerName = activeProviderName(env);

  for (const row of due.follower) {
    const name = row.display_name || row.slug || "";
    try {
      const inApp = await recordAndSend(
        db,
        {
          subjectKind: "follower", subjectId: row.subject_id, periodEnd: row.period_end, channel: "in_app",
          roomId: row.room_id, personId: row.person_id, followerId: row.subject_id,
        },
        async () => ({ ok: true }),
      );
      if (inApp.sent) summary.sentInApp++;
      else if (inApp.inserted) summary.failed++;

      const pushSubs = await (deps.activeSubscriptionsFor ?? activeSubscriptionsFor)(db, row.subject_id);
      if (pushSubs.length) {
        const push = await recordAndSend(
          db,
          {
            subjectKind: "follower", subjectId: row.subject_id, periodEnd: row.period_end, channel: "web_push",
            roomId: row.room_id, personId: row.person_id, followerId: row.subject_id,
          },
          async () => {
            const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
            const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
            const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
            if (!vapidPublic || !vapidPrivate || !vapidSubject) return { ok: false, code: "not_configured" };
            const payload = (deps.renewalPushPayload ?? renewalPushPayload)(row.slug, name);
            let anyOk = false;
            for (const sub of pushSubs) {
              const r = await (deps.webPushSend ?? webPushSend)(sub, payload, {
                fetch: deps.fetch, vapidPublic, vapidPrivate, vapidSubject, now,
              });
              if (r.ok) anyOk = true;
            }
            return anyOk ? { ok: true } : { ok: false, code: "no_subscription_accepted" };
          },
        );
        if (push.sent) summary.sentWebPush++;
        else if (push.inserted) summary.failed++;
      }

      const pointer = await (deps.activeTelegramChannelFor ?? activeTelegramChannelFor)(db, row.subject_id);
      if (pointer) {
        const text = followerRenewalTelegramText(
          { name, periodEnd: row.period_end, amountInr: row.amount_inr, currency: row.currency, providerName },
          row.locale,
        );
        const tg = await recordAndSend(
          db,
          {
            subjectKind: "follower", subjectId: row.subject_id, periodEnd: row.period_end, channel: "telegram",
            roomId: row.room_id, personId: row.person_id, followerId: row.subject_id,
          },
          async () => {
            const token = String(env.ROOM_TELEGRAM_BOT_TOKEN || "");
            if (!token) return { ok: false, code: "not_configured" };
            const result = await (deps.sendRoomCheckinMessage ?? sendRoomCheckinMessage)(pointer.channel_ref, text, {
              token,
              fetch: deps.fetch,
            });
            return result.ok ? { ok: true } : { ok: false, code: `telegram_${result.status || result.errorCode || "failed"}` };
          },
        );
        if (tg.sent) summary.sentTelegram++;
        else if (tg.inserted) summary.failed++;
      }
    } catch (error) {
      summary.errors++;
      console.error("[renewals sweep] follower delivery failure:", error?.message || "unknown");
    }
  }

  for (const row of due.creator) {
    try {
      const out = await recordAndSend(
        db,
        {
          subjectKind: "creator", subjectId: row.subject_id, periodEnd: row.period_end, channel: "in_app",
          ownerUserId: row.owner_user_id, replicaId: row.replica_id,
        },
        async () => ({ ok: true }),
      );
      if (out.sent) summary.sentInApp++;
      else if (out.inserted) summary.failed++;
    } catch (error) {
      summary.errors++;
      console.error("[renewals sweep] creator reminder failure:", error?.message || "unknown");
    }
  }

  for (const row of due.org) {
    try {
      const out = await recordAndSend(
        db,
        {
          subjectKind: "org", subjectId: row.subject_id, periodEnd: row.period_end, channel: "in_app",
          orgId: row.subject_id,
        },
        async () => ({ ok: true }),
      );
      if (out.sent) summary.sentInApp++;
      else if (out.inserted) summary.failed++;
    } catch (error) {
      summary.errors++;
      console.error("[renewals sweep] org reminder failure:", error?.message || "unknown");
    }
  }

  return summary;
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 5 - CANCEL, PER SUBJECT KIND, THROUGH THE SEAM
// ─────────────────────────────────────────────────────────────────────────

async function cancelThroughSeam(db, { table, key, subscriptionId, provider, providerRef }, deps) {
  const env = deps.env ?? process.env;
  if (providerRef) {
    const secrets = deps.secrets ?? (await providerSecrets(provider, env, deps.secretBackend));
    const providerModule = providerFor(provider);
    await providerModule.cancelSubscription(providerRef, { atCycleEnd: true }, secrets);
  }
  const rows = await db(
    `update ${table}
        set cancel_at_period_end = true, updated_at = now()
      where ${key} = ($1)::uuid
     returning subscription_id, state, current_period_end, cancel_at_period_end`,
    [subscriptionId],
  );
  return rows[0] || null;
}

/** The follower's own cancel. Scope comes off the SESSION, `api/_payments.js`'s
 *  own `startFollowerSubscription`/`followerSubscriptionStatus` shape - never
 *  a subscription id a client could supply. */
export async function cancelFollowerRenewal(db, { session }, deps = {}) {
  const { follower } = await paidSessionScope(db, session, deps);
  const rows = await db(
    `select subscription_id, provider, provider_subscription_ref
       from vy_room_subscription
      where follower_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(follower.follower_id)],
  );
  const sub = rows[0];
  if (!sub) throw new PaymentsError("payments_subscription_not_started", 409);
  return cancelThroughSeam(
    db,
    {
      table: "vy_room_subscription", key: "subscription_id", subscriptionId: sub.subscription_id,
      provider: sub.provider, providerRef: sub.provider_subscription_ref,
    },
    deps,
  );
}

/** The creator's own cancel - `api/_payments.js`'s `ownedReplicaHandle`'s own
 *  scope (UUID shape only; every caller already knows the replica is theirs
 *  by construction, that function's own header). */
export async function cancelCreatorRenewal(db, { ownerUserId, replicaId }, deps = {}) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new PaymentsError("room_publish_identity_invalid", 400);
  }
  const rows = await db(
    `select subscription_id, provider, provider_subscription_ref
       from vy_creator_subscription
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(ownerUserId), String(replicaId)],
  );
  const sub = rows[0];
  if (!sub) throw new PaymentsError("payments_subscription_not_started", 409);
  return cancelThroughSeam(
    db,
    {
      table: "vy_creator_subscription", key: "subscription_id", subscriptionId: sub.subscription_id,
      provider: sub.provider, providerRef: sub.provider_subscription_ref,
    },
    deps,
  );
}

/** The Suite's own cancel - `api/_payments.js`'s `orgAdminOrThrow`, reused
 *  verbatim rather than a second hand-rolled membership join. */
export async function cancelOrgRenewal(db, { ownerUserId, orgId }, deps = {}) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(orgId || ""))) {
    throw new PaymentsError("org_owner_identity_invalid", 400);
  }
  await orgAdminOrThrow(db, orgId, ownerUserId);
  const rows = await db(
    `select subscription_id, provider, provider_subscription_ref
       from vy_org_subscription
      where org_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(orgId)],
  );
  const sub = rows[0];
  if (!sub) throw new PaymentsError("org_subscription_not_started", 409);
  return cancelThroughSeam(
    db,
    {
      table: "vy_org_subscription", key: "subscription_id", subscriptionId: sub.subscription_id,
      provider: sub.provider, providerRef: sub.provider_subscription_ref,
    },
    deps,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 2 - "RENEWED UNASKED", WIRED
// ─────────────────────────────────────────────────────────────────────────

/**
 * A creator subscription's new period has BEGUN (`current_period_start`
 * advancing past a creation that predates it - the same "period bounds
 * advancing" the workstream brief names) with NO SENT `in_app` reminder row
 * for that boundary as `period_end`. `current_period_start` stands in for
 * "the previous period's `period_end`" because in a continuous subscription
 * the two are the same instant - `api/_phase-gate.js`'s own `hit_cap_before`
 * documented-approximation shape, restated for a renewal boundary instead of
 * a message cap, with the identical honesty: this is the best available
 * signal, not a claim of a stored renewal history that does not exist.
 *
 * `channel = 'in_app'` is the ON clause's own filter, not an afterthought:
 * `recordAndSend` always attempts `in_app` first for every due creator, so
 * it is the one channel guaranteed to produce AT MOST ONE row per (subject,
 * period_end) - joining on it keeps this a plain LEFT JOIN rather than a
 * `count(distinct ...)` that could multiply a row across several channels.
 *
 * Gated on `vy_renewal_reminder` being applied (`isTableAppliedFor`,
 * `api/_room-surface.js`'s own seam): this function EXISTED before migration
 * 099 (as `api/_phase-gate.js`'s hardcoded zero) and must keep answering on a
 * database that has not applied 099 yet, `applyWebhook`'s own gated
 * `offer_update` CTE precedent (WS-R30) restated for a read instead of a
 * write.
 */
export async function renewedUnaskedCount(db, now = Date.now(), deps = {}) {
  const [creatorsRow] = await db(`select count(distinct owner_user_id)::int as creators from vy_room`, []);
  const creatorsTotal = Number(creatorsRow?.creators || 0);
  if (!(await isTableAppliedFor(deps)("vy_renewal_reminder"))) {
    return {
      creators_total: creatorsTotal,
      renewed_total: 0,
      renewed_unasked: 0,
      n: 0,
      note: "no reminder mechanism has been applied to this database yet",
      computed_at: new Date(now).toISOString(),
    };
  }
  const [row] = await db(
    `select
        count(*)::int as renewed_total,
        count(*) filter (where r.reminder_id is null)::int as renewed_unasked
       from vy_creator_subscription s
       left join vy_renewal_reminder r
         on r.subject_kind = 'creator'
        and r.subject_id = s.replica_id
        and r.period_end = s.current_period_start
        and r.channel = 'in_app'
        and r.sent_at is not null
      where s.state = 'active'
        and s.current_period_start is not null
        and s.created_at < s.current_period_start`,
    [],
  );
  const renewedTotal = Number(row?.renewed_total || 0);
  const renewedUnasked = Number(row?.renewed_unasked || 0);
  return {
    creators_total: creatorsTotal,
    renewed_total: renewedTotal,
    renewed_unasked: renewedUnasked,
    n: renewedTotal,
    note: renewedTotal > 0 ? "" : "no creator subscription has completed a renewal yet",
    computed_at: new Date(now).toISOString(),
  };
}
