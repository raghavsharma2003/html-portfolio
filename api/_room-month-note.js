// api/_room-month-note.js - the follower's monthly note (WS-R137, migration
// 136).
//
// Once a month a follower gets one note from their own Room: the turns they
// exchanged, the days they showed up, their current streak, the threads they
// came back to, the check-ins their AI kept, and (only if they still have
// memory on) how many things they have asked to be remembered. NEVER a model
// call - `checkinDirective`/`gatedReply` (api/_checkins.js) are the shape a
// proactive message that NEEDS a voice takes; this note needs no voice, only
// arithmetic over rows this follower's own presence already wrote, so it is
// built the same way `api/_org-weekly-note.js#buildOrgWeeklyNote` builds its
// own note: reading, never generating.
//
// ── THE ONE FUNCTION THIS FILE'S LAW 3 IS ABOUT ─────────────────────────────
//
// `computeFollowerMonthNote` below is the whole "built from their own lane
// only" guarantee. It takes no import at all - every name it uses is either
// a parameter or a local of its own body - so a static scan of ITS OWN
// SOURCE TEXT ALONE (never the rest of this file) can prove two things by
// inspection: it never mentions a creator-lane table (`vy_room` itself is
// read nowhere inside it; every query is scoped to `vy_room_follower_day`,
// `vy_room_thread`, `vy_room_checkin_delivery`, `vy_fact`), and it never
// mentions a column that could name a DIFFERENT follower (no
// `referrer_hash`, no `phone_hash`, no other follower's `person_id`/
// `follower_id` literal anywhere in its body - the only identity values it
// ever binds are the three the CALLER handed it in `who`).
// `evals/room-month-note/run.mjs`'s own static control extracts this
// function's source the same way `evals/room-leak/run.mjs`'s layer 16
// extracts `orgWeeklyNotePushPayload`'s.
//
// ── WHY THE LEDGER TABLE CARRIES NO COUNTS ──────────────────────────────────
//
// `vy_room_follower_month_note` (migration 136) is content-free by design -
// `vy_org_weekly_note`'s own precedent (132: "NO COUNTS COLUMN, on purpose...
// this note's own numbers are recomputed fresh every time"). The account
// page's own read (`lastFollowerMonthNote`) finds the last MONTH this
// follower got a note for and recomputes it fresh from the same rows the
// cron read - there is nothing here for a later session to misread as a
// stale snapshot, and nothing a leak of this table alone could ever turn
// into a follower fact: its five columns are two ids, a "YYYY-MM" label, a
// timestamp and a small array of channel names.
//
// ── DELIVERY, THE SAME CHANNELS THE CHECK-IN SWEEP ALREADY USES ────────────
//
// Web push (`api/_room-push.js`) and Telegram (`api/_room-telegram.js`) -
// both free-form enough to carry an arbitrary plain-text summary. WhatsApp is
// DELIBERATELY not wired here: `api/_room-whatsapp.js`'s templates are
// Meta-approved for the CHECK-IN shape specifically (a title, a prompt), and
// reusing one for an unrelated monthly summary would put text on the wire a
// template was never approved to carry - see `context/decisions.md`'s entry
// for this workstream for the reversal condition (a monthly-note template
// gets approved).
import {
  RoomError,
  roomUnavailable,
  readRoomSession,
  assertSessionFresh,
  resolveRoom,
  followerRow,
  activeTelegramChannelFor,
  markTelegramChannelStopped,
} from "./_room-surface.js";
import { activeSubscriptionsFor, revokeSubscriptionById, touchSubscription } from "./_room-push.js";
import { send as webPushSend, monthNotePushPayload } from "./_push/webpush.js";
import { sendRoomCheckinMessage } from "./_room-telegram.js";
import { quietHoursOkForFollowerSql } from "./_quiet-hours.js";
import { recordIncident } from "./_incidents.js";
import { randomUUID } from "node:crypto";

const MONTH_KEY_RE = /^([0-9]{4})-([0-9]{2})$/;

export class MonthNoteError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "MonthNoteError";
    this.code = code;
    this.status = status;
  }
}

/** Sweep batch size, `api/_checkins.js#CHECKIN_SWEEP_DEFAULT_LIMIT`'s own
 *  default one feature over. */
export const MONTH_NOTE_SWEEP_DEFAULT_LIMIT = 200;

// ─────────────────────────────────────────────────────────────────────────
// MONTH-KEY ARITHMETIC — pure, UTC calendar months.
// ─────────────────────────────────────────────────────────────────────────

/** The "YYYY-MM" label of the calendar month strictly BEFORE the one `nowMs`
 *  falls in, UTC. A monthly note is always about a COMPLETED month - the
 *  cron's own due-select never claims a note for the month still in
 *  progress. */
export function previousMonthKey(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based; the PREVIOUS month is m-1
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 12 : m; // 1-based month number
  return `${prevY}-${String(prevM).padStart(2, "0")}`;
}

/** `"YYYY-MM"` -> the month's own UTC start/end instants (end EXCLUSIVE, the
 *  first instant of the NEXT month) and the two date strings every query
 *  below binds. Throws on a malformed key - every caller either built the
 *  key itself (`previousMonthKey`) or read it back off a row this file's own
 *  writer already validated at insert time (migration 136's own CHECK). */
export function monthKeyBounds(monthKey) {
  const m = MONTH_KEY_RE.exec(String(monthKey || ""));
  if (!m) throw new MonthNoteError("month_note_month_key_invalid", 400);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const startDate = new Date(Date.UTC(y, mo - 1, 1));
  const endDate = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1));
  return {
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    startDateStr: startDate.toISOString().slice(0, 10),
    endDateStr: endDate.toISOString().slice(0, 10),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE BUILDER — law 3's own subject. NO IMPORT OF ANY KIND: every name
// below is either a parameter or a local. Do not add an import to this
// function's own closure — move the need one function up instead.
// ─────────────────────────────────────────────────────────────────────────

/**
 * `who` is `{roomId, followerId, personId, agentId, memoryConsentAt}` - the
 * caller's own already-resolved scope (`followerScope` below, or the sweep's
 * own due row), NEVER a session or a body. Every query is scoped to
 * `room_id`/`person_id` (or `person_id`/`agent_id` for the memory count) off
 * THESE THREE VALUES ALONE — there is no code path here that could bind a
 * different id than the one the caller handed in, and nothing here ever
 * selects another follower's column, a creator's column, or a word anyone
 * typed. Floor-free: unlike `api/_org-weekly-note.js`'s admin-facing note
 * (which floors a Room's count at n>=5 because it is shown to someone ELSE),
 * this note is shown back to the SAME person the rows are about, so there is
 * no one for a small number to identify.
 */
export async function computeFollowerMonthNote(db, who, monthKey) {
  const { roomId, followerId, personId, agentId, memoryConsentAt } = who;
  const { startIso, endIso, startDateStr, endDateStr } = monthKeyBounds(monthKey);

  const [turnsRow] = await db(
    `select coalesce(sum(turns), 0)::int as turns,
            count(*) filter (where turns > 0)::int as days_active
       from vy_room_follower_day
      where room_id = ($1)::uuid and person_id = ($2)::uuid
        and day >= ($3)::date and day < ($4)::date`,
    [roomId, personId, startDateStr, endDateStr],
  );

  // The streak: consecutive calendar days with at least one turn, ending on
  // the LAST day of this month. Read wide enough to cross a month boundary
  // (400 days is over a year of daily rows, comfortably more than any real
  // streak this product has ever measured) and walk backward in JS from the
  // month's own last day - the query itself does no date arithmetic beyond
  // `day < end`, so it never needs to know where the streak actually stops.
  const dayRows = await db(
    `select day, turns from vy_room_follower_day
      where room_id = ($1)::uuid and person_id = ($2)::uuid and day < ($3)::date
      order by day desc
      limit 400`,
    [roomId, personId, endDateStr],
  );
  const activeDays = new Set(
    dayRows.filter((r) => Number(r.turns) > 0).map((r) => new Date(r.day).toISOString().slice(0, 10)),
  );
  let streak = 0;
  let cursor = new Date(new Date(endDateStr).getTime() - 86_400_000); // the month's own last day
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }

  const [threadsRow] = await db(
    `select count(*)::int as n from vy_room_thread
      where room_id = ($1)::uuid and person_id = ($2)::uuid
        and created_at < ($3)::timestamptz
        and last_message_at >= ($3)::timestamptz and last_message_at < ($4)::timestamptz`,
    [roomId, personId, startIso, endIso],
  );

  const [checkinsRow] = await db(
    `select count(*)::int as n from vy_room_checkin_delivery
      where room_id = ($1)::uuid and person_id = ($2)::uuid and state = 'delivered'
        and delivered_at >= ($3)::timestamptz and delivered_at < ($4)::timestamptz`,
    [roomId, personId, startIso, endIso],
  );

  // "What they asked to be remembered" - a follower who turned memory off
  // gets no line at all, the SAME predicate the reply lane uses
  // (`api/_checkins.js`'s own `f.memory_consent_at is not null`). All-time,
  // not month-scoped: memory is cumulative, never reset at a month boundary.
  let rememberedThingsCount = null;
  if (memoryConsentAt != null) {
    const [factsRow] = await db(
      `select count(*)::int as n from vy_fact where person_id = ($1)::uuid and agent_id = ($2)::uuid`,
      [personId, agentId],
    );
    rememberedThingsCount = Number(factsRow?.n || 0);
  }

  return {
    room_id: String(roomId),
    follower_id: String(followerId),
    person_id: String(personId),
    month_key: String(monthKey),
    turns_this_month: Number(turnsRow?.turns || 0),
    days_active_this_month: Number(turnsRow?.days_active || 0),
    streak_days: streak,
    threads_revisited: Number(threadsRow?.n || 0),
    checkins_kept: Number(checkinsRow?.n || 0),
    remembered_things_count: rememberedThingsCount,
  };
}

/** Plain text, Telegram's own free-form channel — never a bubble the model
 *  produced, just the counts read out. */
export function followerMonthNoteTelegramText(displayName, note) {
  const name = String(displayName || "your creator").trim() || "your creator";
  const turns = Math.max(0, Math.trunc(Number(note?.turns_this_month) || 0));
  const days = Math.max(0, Math.trunc(Number(note?.days_active_this_month) || 0));
  const streak = Math.max(0, Math.trunc(Number(note?.streak_days) || 0));
  const threads = Math.max(0, Math.trunc(Number(note?.threads_revisited) || 0));
  const parts = [
    `Your month with ${name} AI: ${turns} message${turns === 1 ? "" : "s"} across ${days} day${days === 1 ? "" : "s"}.`,
  ];
  if (streak >= 2) parts.push(`A ${streak}-day streak.`);
  if (threads > 0) parts.push(`${threads} conversation${threads === 1 ? "" : "s"} you came back to.`);
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────
// SESSION SCOPE — re-derived rather than imported (`api/_checkins.js`'s own
// `followerScope`, this house's standing convention: a fake `db` can reach
// this module with no import back into a file that itself imports this one).
// ─────────────────────────────────────────────────────────────────────────

async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  assertSessionFresh(payload, deps.now ?? Date.now());
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  return {
    personId: String(payload.p),
    agentId: String(resolved.agentId),
    roomId: String(resolved.room.room_id),
    followerId: String(follower.follower_id),
    memoryConsentAt: follower.memory_consent_at,
  };
}

/** The account page's own read (`api/room.js`'s `month_note` op). `note:
 *  null` when this follower has never had one built yet - the honest empty
 *  state, never a fabricated zeroed note. */
export async function lastFollowerMonthNote(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  const rows = await db(
    `select note_id, month_key, built_at, delivered_channels
       from vy_room_follower_month_note
      where follower_id = ($1)::uuid and room_id = ($2)::uuid
      order by built_at desc
      limit 1`,
    [who.followerId, who.roomId],
  );
  if (!rows[0]) return { note: null };
  const note = await computeFollowerMonthNote(db, who, rows[0].month_key);
  return {
    note: {
      ...note,
      built_at: rows[0].built_at,
      delivered_channels: Array.isArray(rows[0].delivered_channels) ? rows[0].delivered_channels : [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE CRON'S OWN HALF.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every active follower of a published Room who was already present at some
 * point during `monthKey` (`joined_at` before the month's own end) and does
 * not yet have a note for it — `not exists`, `api/_renewals.js#dueReminders`'s
 * own idempotency-by-absence shape restated for this ledger. WS-R129:
 * `quietHoursOkForFollowerSql` excludes a follower currently inside one of
 * their own active check-in schedules' quiet window; a follower blocked this
 * tick is simply never claimed, so the NEXT daily sweep tick retries them —
 * deferred, not dropped, `dueReminders`'s own header restated.
 */
export async function dueFollowerMonthNoteCandidates(db, monthKey, now, limit = MONTH_NOTE_SWEEP_DEFAULT_LIMIT) {
  const { endIso } = monthKeyBounds(monthKey);
  const nowIso = new Date(now).toISOString();
  const cap = Math.max(1, Math.min(500, Number(limit) || MONTH_NOTE_SWEEP_DEFAULT_LIMIT));
  return db(
    `select f.follower_id, f.room_id, f.person_id, f.agent_id, f.memory_consent_at,
            r.slug, r.display_name
       from vy_room_follower f
       join vy_room r on r.room_id = f.room_id and r.published_at is not null
      where f.joined_at < ($2)::timestamptz
        and not exists (
          select 1 from vy_room_follower_month_note n
           where n.follower_id = f.follower_id and n.room_id = f.room_id and n.month_key = $3
        )
        and ${quietHoursOkForFollowerSql("f", 1)}
      order by f.joined_at asc
      limit $4`,
    [nowIso, endIso, monthKey, cap],
  );
}

/** The unique index (migration 136) is the whole idempotency mechanism - a
 *  second racer for the same (follower, room, month) gets zero rows back. */
export async function claimFollowerMonthNote(db, { roomId, followerId, personId, monthKey }, deps = {}) {
  const newId = deps.newId ? deps.newId() : randomUUID();
  return db(
    `insert into vy_room_follower_month_note (note_id, room_id, follower_id, person_id, month_key, built_at, delivered_channels)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, $5, now(), '{}'::text[])
     on conflict (follower_id, room_id, month_key) do nothing
     returning note_id`,
    [newId, roomId, followerId, personId, monthKey],
  );
}

export async function recordFollowerMonthNoteChannels(db, noteId, channels) {
  await db(`update vy_room_follower_month_note set delivered_channels = ($2)::text[] where note_id = ($1)::uuid`, [
    noteId,
    Array.isArray(channels) ? channels : [],
  ]);
}

/** One candidate row -> claim, build, deliver, record. Never throws for one
 *  follower's own failure — the sweep's own per-row try/catch, `api/
 *  _checkins.js#sweep`'s own posture. */
export async function deliverFollowerMonthNote(db, row, monthKey, deps = {}) {
  const claimed = await claimFollowerMonthNote(db, {
    roomId: row.room_id, followerId: row.follower_id, personId: row.person_id, monthKey,
  }, deps);
  if (!claimed.length) return { claimed: false };
  const noteId = claimed[0].note_id;

  const who = {
    roomId: row.room_id, followerId: row.follower_id, personId: row.person_id,
    agentId: row.agent_id, memoryConsentAt: row.memory_consent_at,
  };
  const note = await (deps.computeFollowerMonthNote || computeFollowerMonthNote)(db, who, monthKey);

  const channels = [];
  const sendWebPush = deps.webPushSend || webPushSend;
  const subscriptions = await (deps.activeSubscriptionsFor || activeSubscriptionsFor)(db, row.follower_id);
  if (subscriptions.length) {
    const env = deps.env || process.env;
    const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
    const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
    const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
    if (vapidPublic && vapidPrivate && vapidSubject) {
      const payload = monthNotePushPayload(row.slug, row.display_name, note);
      let anyOk = false;
      for (const sub of subscriptions) {
        try {
          const result = await sendWebPush(sub, payload, { fetch: deps.fetch, vapidPublic, vapidPrivate, vapidSubject, now: deps.now });
          if (result.ok) {
            anyOk = true;
            await (deps.touchSubscription || touchSubscription)(db, sub.subscription_id).catch(() => {});
          } else {
            recordIncident(db, { kind: "provider_webpush", door: "_room-month-note.js", status: Number(result.status) || 0 });
            if (result.status === 404 || result.status === 410) {
              await (deps.revokeSubscriptionById || revokeSubscriptionById)(db, sub.subscription_id).catch(() => {});
            }
          }
        } catch (error) {
          console.error("[room-month-note] web push send failure:", error?.message || "unknown");
        }
      }
      if (anyOk) channels.push("web_push");
    }
  }

  const env = deps.env || process.env;
  const token = String(env.ROOM_TELEGRAM_BOT_TOKEN || "");
  if (token) {
    const pointer = await (deps.activeTelegramChannelFor || activeTelegramChannelFor)(db, row.follower_id);
    if (pointer) {
      const text = followerMonthNoteTelegramText(row.display_name, note);
      try {
        const result = await (deps.sendRoomCheckinMessage || sendRoomCheckinMessage)(pointer.channel_ref, text, { token, fetch: deps.fetch });
        if (result.ok) {
          channels.push("telegram");
        } else {
          recordIncident(db, { kind: "provider_telegram", door: "_room-month-note.js", status: Number(result.status) || 0 });
          if (result.status === 403 || result.status === 400) {
            await (deps.markTelegramChannelStopped || markTelegramChannelStopped)(db, row.follower_id, result.errorCode || String(result.status)).catch(() => {});
          }
        }
      } catch (error) {
        console.error("[room-month-note] telegram send failure:", error?.message || "unknown");
      }
    }
  }

  await (deps.recordFollowerMonthNoteChannels || recordFollowerMonthNoteChannels)(db, noteId, channels);
  return { claimed: true, delivered: channels.length > 0, channels, note };
}

/** The cron's own step. */
export async function sendFollowerMonthNotes(db, deps = {}) {
  const summary = { checked: 0, claimed: 0, delivered: 0, errors: 0 };
  if (typeof db !== "function") return summary;
  const now = deps.now ?? Date.now();
  const monthKey = previousMonthKey(now);
  const limit = Math.max(1, Math.min(500, Number(deps.limit) || MONTH_NOTE_SWEEP_DEFAULT_LIMIT));
  let candidates;
  try {
    candidates = await (deps.dueFollowerMonthNoteCandidates || dueFollowerMonthNoteCandidates)(db, monthKey, now, limit);
  } catch (error) {
    console.error("[room-month-note] due-select failure:", error?.message || "unknown");
    return summary;
  }
  summary.checked = candidates.length;
  for (const row of candidates) {
    try {
      const outcome = await (deps.deliverFollowerMonthNote || deliverFollowerMonthNote)(db, row, monthKey, deps);
      if (outcome.claimed) {
        summary.claimed++;
        if (outcome.delivered) summary.delivered++;
      }
    } catch (error) {
      summary.errors++;
      console.error("[room-month-note] delivery failure:", error?.message || "unknown");
    }
  }
  return summary;
}
