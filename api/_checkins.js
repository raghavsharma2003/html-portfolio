// Check-ins - the follower's second reason to pay (WS-R16, migration 079).
//
// A creator designs a check-in shape ("Did you finish today's revision
// block?"); a follower opts in and picks their OWN schedule; it fires on
// that schedule and never on silence. `proactive-reason-contingent`
// (context/decisions.md, 2026-08-21) is the law this whole file is built
// around: she may open a conversation because something HAPPENED - a call
// ended, a time HE named arrived - and never because he went quiet. A
// schedule the follower set is exactly that kind of event; "he has not
// talked in six days" is exactly the shape that decision forbids, and this
// file has no field anywhere that could hold it. `next_due_at` is the ONLY
// column the sweep's WHERE clause reads to decide "is this due" (migration
// 079's own header), so a row with no schedule (`next_due_at` null) cannot
// be selected by any query in this file, correct or buggy.
//
// Every decision lives here rather than in api/checkins.js or
// api/checkins-sweep.js, so a fake `db` can reach it - `api/_room-cohorts.js`
// is the pattern for the owner-scoped reads, `api/_room-surface.js`'s
// `roomSay`/`roomForget` the pattern for the follower-scoped ops and the ONE
// reply door (`gatedReply`, api/_surface.js).
//
// ── the free cap is a PREDICATE, never a JS check (workstream law #2) ──────
//
// The sweep issues two separate SQL statements over the same due rows: one
// whose WHERE clause requires `f.tier = 'paid'` and drives real delivery,
// and one whose WHERE clause requires the COMPLEMENT and drives a skip-log
// entry plus a reschedule. There is no code path between "a row is due" and
// "gatedReply is called" that could accidentally admit a free follower's
// row, because the delivery query's own SQL text is the only place that
// decision is made.
//
// ── memory consent is required at OPT-IN, not filtered at sweep time ───────
//
// A due check-in becomes a message in the follower's own private thread
// (workstream law #4), which means it needs a server-side episode to land
// in - there is no live HTTP response for a cron tick to hand a
// transcript digest to the way `roomSay`'s memory-declined path does. So
// `optIn` refuses a follower who has not consented to memory
// (`room_checkin_memory_required`), and no check-in row this file ever
// writes can exist without one. The sweep's skip-log query still checks
// `memory_consent_at` defensively (a follower can withdraw memory inside
// this same Room after opting in, `roomForget`'s own withdrawal path;
// checked in room-surface tests), so a design that changes later is caught
// rather than silently mis-delivered.
import { randomUUID } from "node:crypto";
import {
  gatedReply,
  makeCtx,
  loadEngine,
  think,
  logDmTurn,
} from "./_surface.js";
import {
  RoomError,
  roomUnavailable,
  readRoomSession,
  assertSessionFresh,
  resolveRoom,
  followerRow,
  roomThreadDevice,
  bindThreadDevice,
  activeTelegramChannelFor,
  markTelegramChannelStopped,
  telegramCheckinsStatusFor,
  setTelegramCheckinsEnabledForFollower,
} from "./_room-surface.js";
import { activeSubscriptionsFor, revokeSubscriptionById, touchSubscription } from "./_room-push.js";
import { send as webPushSend, checkinPushPayload } from "./_push/webpush.js";
import { purgeStalePublicRateWindows } from "./_rate-limit.js";
import {
  templateApproved,
  activeWhatsappFollower,
  markFollowerWhatsappFailed,
  buildTemplatePayload,
  sendTemplate,
} from "./_room-whatsapp.js";
import { sendRoomCheckinMessage } from "./_room-telegram.js";
import { recordIncident, notifyNewIncidentKinds, pruneOldIncidents } from "./_incidents.js";
// WS-R62 (migration 114). The real operator subscription store —
// `notifyNewIncidentKinds`'s own injected seam, wired to production here
// exactly as `activeSubscriptionsFor`/`revokeSubscriptionById` above are for
// a follower's own subscription. `api/_ops.js` does NOT import this file
// (see that file's own header), so this import is one-directional.
import { operatorPushSubscriptionsFor, revokeOperatorPushById } from "./_ops.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Same recall window `api/_room-surface.js`'s `ROOM_RECALL_TURNS` uses - a
 *  check-in message is a DM in every respect this file cares about, so it is
 *  compiled with the same amount of prior context. */
export const CHECKIN_RECALL_TURNS = 30;
/** Batch size a single cron tick will process, mirroring
 *  `api/drift-watch-sweep.js`'s own default. */
export const CHECKIN_SWEEP_DEFAULT_LIMIT = 50;
export const CHECKIN_TITLE_MAX = 120;
export const CHECKIN_PROMPT_SHAPE_MAX = 2000;
export const CHECKIN_CADENCE_HINT_MAX = 200;

export class CheckinsError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function assertOwnerScope(ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new CheckinsError("checkins_identity_invalid", 400);
  }
}

/** The owner-scoped room handle. `api/_room-cohorts.js`'s `ownedRoomHandle`
 *  one file over, re-derived rather than imported for its own stated reason:
 *  this module stays reachable with only a fake `db`. */
async function ownedRoomHandle(db, ownerUserId, replicaId) {
  const rows = await db(
    `select room_id, owner_user_id from vy_room
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      limit 1`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// OWNER OPS - designing a check-in
// ─────────────────────────────────────────────────────────────────────────

export async function createDesign(db, ownerUserId, replicaId, { title, promptShape, cadenceHint } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new CheckinsError("room_not_found", 404);
  const t = String(title ?? "").trim().slice(0, CHECKIN_TITLE_MAX);
  const shape = String(promptShape ?? "").trim().slice(0, CHECKIN_PROMPT_SHAPE_MAX);
  const cadence = String(cadenceHint ?? "").trim().slice(0, CHECKIN_CADENCE_HINT_MAX);
  if (!t) throw new CheckinsError("checkin_title_required", 400);
  if (!shape) throw new CheckinsError("checkin_prompt_shape_required", 400);
  const rows = await db(
    `insert into vy_room_checkin_design
       (design_id, room_id, owner_user_id, title, prompt_shape, cadence_hint, state)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, $4, $5, $6, 'active')
     returning design_id, room_id, title, prompt_shape, cadence_hint, state, created_at, updated_at`,
    [randomUUID(), room.room_id, ownerUserId, t, shape, cadence],
  );
  return rows[0];
}

export async function listDesigns(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) return null;
  return db(
    `select design_id, title, prompt_shape, cadence_hint, state, created_at, updated_at
       from vy_room_checkin_design
      where room_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by created_at desc`,
    [room.room_id, ownerUserId],
  );
}

/** Toggle active/paused. A paused design's existing follower rows are
 *  untouched - `optIn` is the only writer of `vy_room_checkin`, and the
 *  sweep's own WHERE clause already requires the design to be 'active', so
 *  pausing a design is enough on its own to stop every scheduled follower's
 *  next occurrence without deleting anything a resume would need back. */
export async function pauseDesign(db, ownerUserId, replicaId, designId, { state } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  if (!UUID.test(String(designId || ""))) throw new CheckinsError("checkin_design_id_invalid", 400);
  const next = state === "active" ? "active" : "paused";
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new CheckinsError("room_not_found", 404);
  const rows = await db(
    `update vy_room_checkin_design
        set state = $4, updated_at = now()
      where design_id = ($1)::uuid and room_id = ($2)::uuid and owner_user_id = ($3)::uuid
      returning design_id, title, prompt_shape, cadence_hint, state, created_at, updated_at`,
    [designId, room.room_id, ownerUserId, next],
  );
  if (!rows[0]) throw new CheckinsError("checkin_design_not_found", 404);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// FOLLOWER OPS - opting in, listing, stopping
// ─────────────────────────────────────────────────────────────────────────

/** The only way this file names a person: from the caller's OWN signed
 *  session, never from a request field - `api/_room-surface.js`'s
 *  `selfScope` re-derived here for its own stated reason (that function is
 *  not exported, and "re-derived rather than imported" is already this
 *  house's convention, `_room-cohorts.js`'s `ownedRoomHandle`). */
async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  // WS-R38: see api/_handoff.js's own followerScope for the finding.
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
    follower,
  };
}

/** Follower-facing list of the designs available to opt into - title and
 *  cadence hint only. `prompt_shape` is the creator's own note to their AI,
 *  never customer-facing copy, and never leaves this file. */
export async function listRoomCheckinDesigns(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  return db(
    `select design_id, title, cadence_hint
       from vy_room_checkin_design
      where room_id = ($1)::uuid and state = 'active'
      order by created_at asc`,
    [who.roomId],
  );
}

export async function listMine(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  return db(
    `select c.checkin_id, c.design_id, d.title, c.days_of_week, c.local_time,
            c.timezone, c.quiet_from, c.quiet_to, c.next_due_at, c.state
       from vy_room_checkin c
       join vy_room_checkin_design d on d.design_id = c.design_id
      where c.room_id = ($1)::uuid and c.person_id = ($2)::uuid and c.follower_id = ($3)::uuid
      order by c.created_at desc`,
    [who.roomId, who.personId, who.followerId],
  );
}

/** `null`/`null` is the shipping default (migration 085) and means "no
 *  window" — a follower who never opens the quiet-hours control gets exactly
 *  today's behaviour. Both-or-neither: a half-set window has no meaning to
 *  `computeNextDue`'s own math below. */
function validateQuietWindow({ quietFrom, quietTo }) {
  const from = quietFrom == null || quietFrom === "" ? null : String(quietFrom);
  const to = quietTo == null || quietTo === "" ? null : String(quietTo);
  if (from == null && to == null) return { quietFrom: null, quietTo: null };
  if (from == null || to == null) throw new CheckinsError("checkin_quiet_hours_invalid", 400);
  if (!TIME_RE.test(from) || !TIME_RE.test(to)) throw new CheckinsError("checkin_quiet_hours_invalid", 400);
  if (from === to) throw new CheckinsError("checkin_quiet_hours_invalid", 400); // a zero-width window is not a window
  return { quietFrom: from, quietTo: to };
}

function validateSchedule({ daysOfWeek, localTime, timezone, quietFrom, quietTo }) {
  const days = Array.isArray(daysOfWeek) ? [...new Set(daysOfWeek.map(Number))] : [];
  if (!days.length || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new CheckinsError("checkin_days_invalid", 400);
  }
  const time = String(localTime || "");
  if (!TIME_RE.test(time)) throw new CheckinsError("checkin_local_time_invalid", 400);
  const tz = String(timezone || "").trim();
  if (!tz) throw new CheckinsError("checkin_timezone_invalid", 400);
  try {
    // The one live probe this file makes of a caller-supplied value: an
    // unrecognised IANA zone name throws here rather than silently landing
    // on UTC three layers down inside `computeNextDue`.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new CheckinsError("checkin_timezone_invalid", 400);
  }
  const quiet = validateQuietWindow({ quietFrom, quietTo });
  return { days: days.sort((a, b) => a - b), time, tz, ...quiet };
}

export async function optIn(
  db,
  { session, designId, daysOfWeek, localTime, timezone, quietFrom = null, quietTo = null },
  deps = {},
) {
  const who = await followerScope(db, session, deps);
  if (who.follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  // WORKSTREAM LAW #2, at the door a follower can act on: a free follower is
  // told why rather than being allowed to schedule something the sweep's own
  // predicate will silently never deliver.
  if (who.follower.tier !== "paid") throw new CheckinsError("room_checkin_paid_only", 402);
  // The module header's own reasoning: no server-side episode, nowhere for a
  // proactive message to land.
  if (who.follower.memory_consent_at == null) throw new CheckinsError("room_checkin_memory_required", 409);
  if (!UUID.test(String(designId || ""))) throw new CheckinsError("checkin_design_id_invalid", 400);
  const { days, time, tz, quietFrom: qf, quietTo: qt } = validateSchedule({
    daysOfWeek,
    localTime,
    timezone,
    quietFrom,
    quietTo,
  });
  const now = deps.now ?? Date.now();
  const nextDueAt = computeNextDue(now, days, time, tz, { quietFrom: qf, quietTo: qt });
  if (!nextDueAt) throw new CheckinsError("checkin_schedule_unresolvable", 400);

  const rows = await db(
    `insert into vy_room_checkin
       (checkin_id, room_id, person_id, follower_id, design_id,
        days_of_week, local_time, timezone, quiet_from, quiet_to, next_due_at, state)
     select ($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, d.design_id,
            ($6)::int[], ($7)::time, $8, ($10)::time, ($11)::time, ($9)::timestamptz, 'active'
       from vy_room_checkin_design d
      where d.design_id = ($5)::uuid and d.room_id = ($2)::uuid and d.state = 'active'
     on conflict (follower_id, design_id) where state = 'active' do update
        set days_of_week = excluded.days_of_week,
            local_time = excluded.local_time,
            timezone = excluded.timezone,
            quiet_from = excluded.quiet_from,
            quiet_to = excluded.quiet_to,
            next_due_at = excluded.next_due_at,
            updated_at = now()
     returning checkin_id, design_id, days_of_week, local_time, timezone, quiet_from, quiet_to, next_due_at, state`,
    [
      randomUUID(),
      who.roomId,
      who.personId,
      who.followerId,
      designId,
      days,
      time,
      tz,
      new Date(nextDueAt).toISOString(),
      qf,
      qt,
    ],
  );
  if (!rows[0]) throw new CheckinsError("checkin_design_not_found", 404);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// CHECK-INS ON TELEGRAM (WS-R34) - the Room panel's own control. `/checkins
// on|off` (api/_room-telegram.js) is the SAME toggle over the SAME follower
// row, resolved off a Telegram chat instead of a session - two doors onto
// one column, never two definitions of it.
// ─────────────────────────────────────────────────────────────────────────

/** The panel's "already on" read. `connected:false` (no Telegram pointer for
 *  this follower at all) is not an error - there is simply nothing to
 *  toggle, and the panel renders no control, `waAvailable`'s own shape one
 *  channel over. */
export async function telegramCheckinsStatus(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  return telegramCheckinsStatusFor(db, who.followerId);
}

/** The panel's toggle. No-op (never an error) when this follower has no
 *  Telegram pointer - `setTelegramCheckinsEnabledForFollower`'s own header,
 *  restated here rather than re-checked, since there is nothing this
 *  follower-scoped door could add beyond confirming a pointer they already
 *  know they do not have. */
export async function setTelegramCheckins(db, { session, enabled }, deps = {}) {
  const who = await followerScope(db, session, deps);
  const row = await setTelegramCheckinsEnabledForFollower(db, who.followerId, Boolean(enabled));
  return { checkins_enabled: row ? row.checkins_enabled === true : false };
}

export async function stop(db, { session, checkinId }, deps = {}) {
  const who = await followerScope(db, session, deps);
  if (!UUID.test(String(checkinId || ""))) throw new CheckinsError("checkin_id_invalid", 400);
  const rows = await db(
    `update vy_room_checkin
        set state = 'stopped', updated_at = now()
      where checkin_id = ($1)::uuid and room_id = ($2)::uuid
        and person_id = ($3)::uuid and follower_id = ($4)::uuid
      returning checkin_id, state`,
    [checkinId, who.roomId, who.personId, who.followerId],
  );
  if (!rows[0]) throw new CheckinsError("checkin_not_found", 404);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// THE MATH - a pure function, tested across a DST-free zone and a DST one
// ─────────────────────────────────────────────────────────────────────────

/** The offset (minutes, tz-local minus UTC) in effect for `tz` at instant
 *  `ms`. Node 22 carries the IANA database through `Intl`, so this needs no
 *  dependency and no network - the same guarantee `isoWeekStart`
 *  (api/_room-cohorts.js) gets from `Date.UTC` for a fixed UTC offset, one
 *  layer up for a NAMED zone. */
function tzOffsetMinutes(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const at = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(+at.year, +at.month - 1, +at.day, +at.hour, +at.minute, +at.second);
  return (asIfUtc - ms) / 60000;
}

/** A wall-clock date and time IN `tz` -> the UTC instant it names. Converges
 *  in at most two passes for every real IANA zone: the offset only changes
 *  between passes across a DST transition whose own window is much shorter
 *  than the loop's own second guess, so a third pass is never needed by any
 *  zone this repo ships to a user in. Documented rather than proven for the
 *  DST-transition INSTANT itself (a local time that is skipped or repeated
 *  by the transition) - `checkin-dst-transition-instant` in
 *  context/decisions.md names this as the v1 trade with its reversal
 *  condition, `tzOffsetMinutes`'s own reasoning for why it is a small one. */
function zonedTimeToUtcMs(y, m, d, hh, mm, tz) {
  let guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(guess, tz);
    guess = Date.UTC(y, m - 1, d, hh, mm, 0) - offset * 60000;
  }
  return guess;
}

/** ISO weekday (1=Monday..7=Sunday, `api/_room-cohorts.js`'s own convention,
 *  restated in migration 079's header so the two never disagree) of the
 *  UTC-normalised calendar date (y, m, d). Date-only arithmetic, so this is
 *  timezone-agnostic once the caller has already resolved y/m/d in the right
 *  zone. */
function isoWeekday(y, m, d) {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day || 7;
}

/** Whether `localTime` (HH:MM) falls inside the follower's own `[quietFrom,
 *  quietTo)` window, and if so, the clock time and day-offset (0 or 1) that
 *  window's END lands on. `localTime` never varies by day in this schedule
 *  model (one time-of-day applied across the chosen weekdays), so this is a
 *  static classification computed once rather than re-derived per candidate
 *  day. A window that WRAPS midnight (`quietFrom > quietTo`, e.g. 22:00 to
 *  07:00) can end on the day AFTER the one the occurrence itself falls on —
 *  that is the `+1` case below, and it is the reason this returns a day
 *  offset rather than only a clock time. */
function quietExit(localTime, quietFrom, quietTo) {
  if (!quietFrom || !quietTo) return null;
  const wraps = quietFrom > quietTo;
  const inside = wraps ? localTime >= quietFrom || localTime < quietTo : localTime >= quietFrom && localTime < quietTo;
  if (!inside) return null;
  const dayOffset = wraps && localTime >= quietFrom ? 1 : 0;
  const [eh, em] = quietTo.split(":").map(Number);
  return { hh: eh, mm: em, dayOffset };
}

/**
 * The next UTC instant, strictly after `now`, at which the follower's local
 * `HH:MM` next falls on one of `days` (ISO 1-7) in `tz`. Pure: no clock read
 * beyond the `now` argument, so a test can hold time still.
 *
 * `quiet` (`{quietFrom, quietTo}`, both HH:MM or both null/absent — migration
 * 085) is the follower's own "not between" window (workstream law #5). When
 * the picked `localTime` falls inside it, EVERY occurrence of this schedule
 * is shifted to the moment the window ends (`quietExit` above) rather than
 * skipped — a follower who asked for 3am and also asked for quiet hours
 * covering 3am gets their check-in at the end of their own quiet window, not
 * a check-in that silently never fires.
 *
 * Returns null for an empty `days` - the caller (`optIn`) never persists a
 * null result, and the sweep never has a row to find with one, which is
 * migration 079's own structural argument restated in code: there is no
 * value this function can return for "no schedule" that a later `<= now()`
 * comparison could ever match.
 */
export function computeNextDue(now, days, localTime, tz, quiet = {}) {
  const wanted = new Set((days || []).map(Number));
  if (!wanted.size) return null;
  const time = String(localTime || "00:00");
  const [hh, mm] = time.split(":").map(Number);
  const exit = quietExit(time, quiet?.quietFrom ?? null, quiet?.quietTo ?? null);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const at = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const y0 = +at.year, m0 = +at.month, d0 = +at.day;
  const base = Date.UTC(y0, m0 - 1, d0);
  for (let offset = 0; offset <= 7; offset++) {
    const cursor = new Date(base + offset * 86_400_000);
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth() + 1, d = cursor.getUTCDate();
    if (!wanted.has(isoWeekday(y, m, d))) continue;
    const at2 = exit ? new Date(cursor.getTime() + exit.dayOffset * 86_400_000) : cursor;
    const y2 = at2.getUTCFullYear(), m2 = at2.getUTCMonth() + 1, d2 = at2.getUTCDate();
    const candidate = exit ? zonedTimeToUtcMs(y2, m2, d2, exit.hh, exit.mm, tz) : zonedTimeToUtcMs(y, m, d, hh, mm, tz);
    if (candidate > now) return candidate;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// DELIVERY - the ONE reply door, in the follower's own private scope
// ─────────────────────────────────────────────────────────────────────────

/** A SHAPE, never a line she could recite - `recited-prompt`
 *  (context/rejected.md) and CLAUDE.md's "write shapes, never lines" both
 *  bind here exactly as they bind persona.ts. The creator's `prompt_shape` is
 *  a NOTE about what to check on, not a sentence to say, and this wraps it in
 *  an explicit instruction not to quote it - the same discipline
 *  `onLinkTap`'s `ROOM_INTRO_DIRECTIVE` (src/engine/room.ts) uses for a
 *  scripted moment, restated here without touching the engine bundle: this
 *  directive is assembled locally and fed to `gatedReply` as the sole "user"
 *  turn with `isDirective: true`, exactly the shape `onLinkTap` already
 *  proves out in api/_surface.js. */
export function checkinDirective(promptShape, title) {
  const shape = String(promptShape || "").trim();
  const name = String(title || "").trim();
  return (
    "[System note: this is a scheduled check-in you set up with this person. " +
    (name ? `It is called "${name}". ` : "") +
    `What to check on, in your own words, shaped like: ${shape}. ` +
    "Say it your own way, one or two lines, casual, the way you would text " +
    "someone you know - never recite this note itself, and never mention " +
    "that it is a scheduled or automated message."
  );
}

/** WS-R19's own seam, named rather than built - the workstream brief's own
 *  instruction. A delivered check-in is paid-only, so it does not touch the
 *  free cap (`vy_room_follower.month_message_count`, `roomSay`'s own
 *  predicate), but it MAY need to count against a future paid fair-use
 *  ceiling. Default no-op; a caller (or a future WS-R19 wiring) may pass its
 *  own `countDelivery` through `deps`. */
export async function countDelivery(deps = {}) {
  if (typeof deps.countDelivery === "function") await deps.countDelivery();
}

/**
 * The WhatsApp seam — WS-R29, migration 092. Wired for real now: a template
 * ALWAYS (never `api/whatsapp.js`'s free-form `send()`, which refuses
 * outside Meta's 24-hour window — the exact defect a proactive check-in
 * would hit on every send). Records intent in the SAME ledger, on the SAME
 * (checkin_id, due_at, channel) idempotency key, `channel='whatsapp_template'`
 * — `api/_room-whatsapp.js`'s own header carries the full argument for the
 * choices below; this function is the one place they meet the check-in
 * sweep's own row shape.
 *
 * States, in the order this function can reach them:
 *   not_configured      the flag is off OR the shared WhatsApp credentials
 *                        are absent — no read of the opt-in table at all.
 *   skipped_stopped      configured, but this follower has no ACTIVE opt-in
 *                        (never opted in, or opted in then stopped) — no
 *                        network call. Workstream negative control (c).
 *   delivered            a 2xx from Meta.
 *   failed                a 4xx naming an invalid number — the opt-in is
 *                        ALSO marked 'failed' here (revoke on failure,
 *                        workstream law #4) so no further check-in for this
 *                        follower attempts a send until they opt in again.
 *   (no row written)     a 429/5xx — transient, `api/_room-whatsapp.js`'s own
 *                        header states why no ledger row is written for this
 *                        case: writing one would be a false terminal state
 *                        for a failure that was never final.
 */
export const deliverers = {
  async whatsappTemplate(db, row, deps = {}) {
    const env = deps.env || process.env;
    const insertLedger = async (state, reason, deliveredAt = null) => {
      const rows = await db(
        `insert into vy_room_checkin_delivery
           (delivery_id, checkin_id, room_id, person_id, due_at, delivered_at, channel, state, reason)
         values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::timestamptz, ($6)::timestamptz, 'whatsapp_template', $7, $8)
         on conflict (checkin_id, due_at, channel) do nothing
         returning delivery_id`,
        [
          randomUUID(),
          row.checkin_id,
          row.room_id,
          row.person_id,
          new Date(row.due_at).toISOString(),
          deliveredAt ? new Date(deliveredAt).toISOString() : null,
          state,
          reason,
        ],
      );
      return rows[0] || null;
    };

    if (!templateApproved(env)) {
      return insertLedger("not_configured", "ROOM_WHATSAPP_TEMPLATE_APPROVED is not set to 1");
    }
    const accessToken = deps.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? "";
    const phoneId = deps.phoneId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    if (!accessToken || !phoneId) {
      return insertLedger("not_configured", "WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID not set");
    }

    const followerId = row.follower_id;
    const optin = followerId ? await activeWhatsappFollower(db, followerId) : null;
    if (!optin) {
      // Workstream NEGATIVE CONTROL (c): a stopped (or never-made) opt-in is
      // never sent to. No network call above this line.
      return insertLedger("skipped_stopped", "no active WhatsApp opt-in for this follower");
    }

    const payload = buildTemplatePayload(row.slug, row.display_name, row.title, null);
    const result = await sendTemplate(optin.phone_e164, payload, {
      env,
      accessToken,
      phoneId,
      fetch: deps.fetch,
    });

    if (result.ok) {
      return insertLedger("delivered", "", deps.now ?? Date.now());
    }
    // WS-R58 (migration 109). This deliverer already catches a provider
    // failure (the branches below decide revoke-or-leave off `result.status`)
    // - one content-free row per attempt, never awaited so a slow write
    // cannot hold up the sweep tick.
    recordIncident(db, { kind: "provider_whatsapp", door: "_checkins.js", status: Number(result.status) || 0 });
    // 429 is numerically a 4xx and DELIBERATELY excluded from the revoke
    // branch below (workstream law #4's own words: "a 429 or 5xx leaves the
    // row for the next sweep") — it means "too many requests", never
    // "invalid number", and revoking a real opt-in over Meta's own rate
    // limiting would be a false positive with a permanent effect.
    if (result.status >= 400 && result.status < 500 && result.status !== 429) {
      // Revoke on failure (workstream law #4) — a 4xx from Meta naming an
      // invalid/unreachable number stops every future send to this follower
      // until they opt in again.
      await markFollowerWhatsappFailed(db, followerId, result.errorCode || String(result.status)).catch(() => {});
      return insertLedger("failed", `meta error ${result.errorCode || result.status}`);
    }
    // 429/5xx/network — transient. `api/_room-whatsapp.js`'s own header: no
    // ledger row here, so this occurrence is left rather than recorded as a
    // false terminal failure.
    return null;
  },

  /**
   * WS-R22 (migration 085): the phone, without Meta. Called from `deliverOne`
   * ONLY after the in-app delivery has already claimed the row — a losing
   * racer (`writeOutcome`'s own idempotency guard) never reaches here, so
   * this function never sends a duplicate push for one occurrence.
   *
   * Unset VAPID config writes ONE ledger row, `state='not_configured'`, no
   * network call — `whatsappTemplate`'s own shape one function up
   * (workstream law #3). Configured, it pushes to EVERY active subscription
   * this follower has (more than one device is ordinary) and writes exactly
   * ONE ledger row for the occurrence — migration 079's own `(checkin_id,
   * due_at, channel)` uniqueness allows no more — `'delivered'` if at least
   * one subscription accepted the push, `'failed'` otherwise. A 404/410 from
   * a subscription revokes THAT subscription (`revokeSubscriptionById`,
   * workstream law #2); a subscriber that succeeds gets its
   * `last_used_at` touched. Neither ever throws out of this function: a
   * per-send failure is caught, logged (never the subscription's own
   * endpoint/keys — AGENTS.md's secrets rule), and treated as that one
   * subscription not accepting the push, exactly like any other non-2xx.
   */
  async webPush(db, row, deps = {}) {
    const env = deps.env || process.env;
    const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
    const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
    const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");

    const insertLedger = async (state, reason, deliveredAt = null) => {
      const rows = await db(
        `insert into vy_room_checkin_delivery
           (delivery_id, checkin_id, room_id, person_id, due_at, delivered_at, channel, state, reason)
         values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::timestamptz, ($6)::timestamptz, 'web_push', $7, $8)
         on conflict (checkin_id, due_at, channel) do nothing
         returning delivery_id`,
        [
          randomUUID(),
          row.checkin_id,
          row.room_id,
          row.person_id,
          new Date(row.due_at).toISOString(),
          deliveredAt ? new Date(deliveredAt).toISOString() : null,
          state,
          reason,
        ],
      );
      return rows[0] || null;
    };

    if (!vapidPublic || !vapidPrivate || !vapidSubject) {
      return insertLedger("not_configured", "ROOM_PUSH_VAPID_PUBLIC/ROOM_PUSH_VAPID_PRIVATE/ROOM_PUSH_VAPID_SUBJECT not set");
    }
    const followerId = row.follower_id;
    if (!followerId) return insertLedger("failed", "no follower_id available for this occurrence");

    const subscriptions = await activeSubscriptionsFor(db, followerId);
    if (!subscriptions.length) return insertLedger("failed", "no active push subscription for this follower");

    // LAW #1: the payload builder's own parameter list is the enforcement -
    // it never receives `row.prompt_shape`, `row.title`, or the reply text
    // `said` held one scope up in `deliverOne`. Only the room slug, its
    // PUBLIC display name and a thread id (null - check-ins land in the
    // follower's default room-wide thread, workstream law #1's own note).
    const payload = checkinPushPayload(row.slug, row.display_name, null);
    let anyOk = false;
    for (const sub of subscriptions) {
      try {
        const result = await webPushSend(sub, payload, {
          fetch: deps.fetch,
          vapidPublic,
          vapidPrivate,
          vapidSubject,
          now: deps.now,
        });
        if (result.ok) {
          anyOk = true;
          await touchSubscription(db, sub.subscription_id).catch(() => {});
        } else {
          // WS-R58 (migration 109). This per-subscription branch already
          // catches a provider failure (the 404/410 revoke below is one
          // outcome of it) - one content-free row per attempt.
          recordIncident(db, { kind: "provider_webpush", door: "_checkins.js", status: Number(result.status) || 0 });
          if (result.status === 404 || result.status === 410) {
            await revokeSubscriptionById(db, sub.subscription_id).catch(() => {});
          }
        }
      } catch (error) {
        console.error("[checkins webPush] send failure for one subscription:", error?.message || "unknown");
      }
    }
    return anyOk
      ? insertLedger("delivered", "", deps.now ?? Date.now())
      : insertLedger("failed", "no active subscription accepted the push");
  },

  /**
   * WS-R34 (migration 096): the channel that already works, carrying the
   * thing itself. Called from `deliverOne` with the SAME `said` text the
   * in-app delivery already produced through `gatedReply` - workstream law
   * #2, "never a second assembler." Unlike `webPush`/`whatsappTemplate`
   * (both content-free by law), this deliverer sends the real reply, because
   * a Telegram DM the follower already has open is not a notification
   * surface with the privacy and length limits those two are built around -
   * it is the same conversational wire `api/_room-telegram.js`'s
   * `handleOrdinaryMessage` already answers on.
   *
   * ELIGIBILITY IS A SQL PREDICATE (`activeTelegramChannelFor`), never a JS
   * check after a broader read - workstream law #2 restated for this
   * channel: a pointer with `checkins_enabled = false` or a non-null
   * `stopped_code` is structurally never returned, so NEGATIVE CONTROLS (a)
   * and (b) hold by construction, not by a branch this function could get
   * wrong.
   *
   * States: `not_configured` (no `ROOM_TELEGRAM_BOT_TOKEN`, no DB read at
   * all); `skipped_stopped` (no eligible pointer - opted out, stopped, or
   * never joined via Telegram); `delivered` (a 2xx from Telegram);
   * `failed` (a 403 bot-blocked or a 400 naming a dead chat - ALSO marks
   * the pointer stopped, workstream law #3, so no further check-in reaches
   * this follower on this channel until they clear it); no ledger row at
   * all for a 429/5xx (transient - left for the next sweep, honouring
   * Telegram's own `retry_after` by logging it rather than hammering again
   * this same tick, `deliverers.whatsappTemplate`'s own precedent for a
   * status this function does not itself have a scheduler to delay).
   */
  async telegram(db, row, said, deps = {}) {
    const env = deps.env || process.env;
    const insertLedger = async (state, reason, deliveredAt = null) => {
      const rows = await db(
        `insert into vy_room_checkin_delivery
           (delivery_id, checkin_id, room_id, person_id, due_at, delivered_at, channel, state, reason)
         values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::timestamptz, ($6)::timestamptz, 'telegram', $7, $8)
         on conflict (checkin_id, due_at, channel) do nothing
         returning delivery_id`,
        [
          randomUUID(),
          row.checkin_id,
          row.room_id,
          row.person_id,
          new Date(row.due_at).toISOString(),
          deliveredAt ? new Date(deliveredAt).toISOString() : null,
          state,
          reason,
        ],
      );
      return rows[0] || null;
    };

    const token = String(env.ROOM_TELEGRAM_BOT_TOKEN || "");
    if (!token) return insertLedger("not_configured", "ROOM_TELEGRAM_BOT_TOKEN not set");

    const followerId = row.follower_id;
    const pointer = followerId ? await activeTelegramChannelFor(db, followerId) : null;
    if (!pointer) {
      // NEGATIVE CONTROLS (a)/(b): a disabled or stopped pointer (or none at
      // all) is never sent to. No network call above this line.
      return insertLedger("skipped_stopped", "no active Telegram check-ins pointer for this follower");
    }

    const text = String(said || "").trim();
    if (!text) return insertLedger("failed", "no reply text to deliver");

    const result = await sendRoomCheckinMessage(pointer.channel_ref, text, { token, fetch: deps.fetch });

    if (result.ok) {
      return insertLedger("delivered", "", deps.now ?? Date.now());
    }
    // WS-R58 (migration 109). This deliverer already catches a provider
    // failure (the 403/400 stop-branch and the 429/5xx transient branch
    // below are both outcomes of it) - one content-free row per attempt.
    recordIncident(db, { kind: "provider_telegram", door: "_checkins.js", status: Number(result.status) || 0 });
    if (result.status === 403 || result.status === 400) {
      // Revoke on failure (workstream law #3) - a blocked bot or a dead chat
      // stops every future send to this follower on this channel until they
      // clear it (`/checkins on`, or the Room panel's own toggle).
      await markTelegramChannelStopped(db, followerId, result.errorCode || String(result.status)).catch(() => {});
      return insertLedger("failed", `telegram error ${result.errorCode || result.status}`);
    }
    // 429/5xx/network - transient, `deliverers.whatsappTemplate`'s own
    // precedent: no ledger row here, so this occurrence is left rather than
    // recorded as a false terminal failure. `retry_after`, when Telegram
    // sends one, is honoured by not sending again THIS tick (there is
    // nothing else to do about it inside a single cron pass with no
    // per-follower cooldown state) and logged so an operator can see it.
    if (result.status === 429 && result.retryAfter) {
      console.error(`[checkins telegram] rate limited, retry_after=${result.retryAfter}s`);
    }
    return null;
  },
};

/** One row's outcome, written and `next_due_at` advanced in ONE statement -
 *  the workstream brief's own phrase. The `where next_due_at = ($3)` guard is
 *  the whole idempotency mechanism: a second processor racing the same row
 *  (an overlapping cron tick) finds `next_due_at` already moved and this
 *  UPDATE returns zero rows, so the CTE's INSERT has nothing to insert from
 *  and the whole statement is a no-op for the loser - no separate lock, no
 *  separate transaction, one statement per row, Neon's SQL-over-HTTP law. */
async function writeOutcome(db, row, { nextDueAt, deliveredAt, state, reason }) {
  const rows = await db(
    `with advanced as (
       update vy_room_checkin
          set next_due_at = ($1)::timestamptz, updated_at = now()
        where checkin_id = ($2)::uuid and next_due_at = ($3)::timestamptz
       returning checkin_id, room_id, person_id
     )
     insert into vy_room_checkin_delivery
       (delivery_id, checkin_id, room_id, person_id, due_at, delivered_at, channel, state, reason)
     select ($4)::uuid, a.checkin_id, a.room_id, a.person_id, ($3)::timestamptz, ($5)::timestamptz, 'in_app', $6, $7
       from advanced a
     on conflict (checkin_id, due_at, channel) do nothing
     returning delivery_id`,
    [
      nextDueAt ? new Date(nextDueAt).toISOString() : null,
      row.checkin_id,
      new Date(row.due_at).toISOString(),
      randomUUID(),
      deliveredAt ? new Date(deliveredAt).toISOString() : null,
      state,
      reason || "",
    ],
  );
  return Boolean(rows[0]);
}

/** One due row, delivered through `gatedReply` in the follower's own private
 *  scope - `roomSay`'s own reply mechanics, minus the inbound message. */
async function deliverOne(db, row, deps) {
  const memory = { ...deps.memory };
  const device = roomThreadDevice(row.room_id, row.person_id, null);
  await bindThreadDevice(db, device, row.person_id);
  const history = await memory.history(device, row.agent_id, CHECKIN_RECALL_TURNS);
  const facts = await memory.recall(row.person_id, row.agent_id);

  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  if (!engine) throw new CheckinsError("checkin_engine_unavailable", 503);

  const ctx = makeCtx(deps.adapter || { surface: "cron", send: async () => ({ ok: true }) }, {
    engine,
    agent: row.agent_module,
    agentId: row.agent_id,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
  });
  const compiled = engine.compile({
    agent: row.agent_module,
    user: { name: "", vibe: [], facts: {} },
    messageCount: history.length,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: true,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: facts.map((f) => `- ${f.body}`).join("\n"),
    herLife: "",
    cultureNoteText: "",
    latestUserText: "",
  });
  const directive = checkinDirective(row.prompt_shape, row.title);
  const gatedOut = await gatedReply(ctx, compiled, [...history, { role: "user", content: directive }], {
    record: facts.map((f) => f.body),
    label: "cron/checkin",
  });
  const said = gatedOut.text;
  const nextDueAt = computeNextDue(deps.now ?? Date.now(), row.days_of_week, row.local_time, row.timezone, {
    quietFrom: row.quiet_from, quietTo: row.quiet_to,
  });
  if (said) {
    await memory.logTurn({ device, person: row.person_id, role: "her", content: said, agentId: row.agent_id });
    await countDelivery(deps);
    const claimed = await writeOutcome(db, row, {
      nextDueAt,
      deliveredAt: deps.now ?? Date.now(),
      state: "delivered",
      reason: "",
    });
    // WS-R22: the phone, without Meta — ONLY after the in-app delivery above
    // actually claimed the row (a losing racer here has nothing to push
    // about) and ONLY the room slug/name/thread id ever cross into the
    // payload (`checkinPushPayload`'s own law). Never awaited into the
    // caller's own success/failure — a push failing is not an in-app
    // delivery failing, and `deliverers.webPush` never throws (it logs its
    // own ledger row and swallows a per-subscription send error).
    if (claimed) await deliverers.webPush(db, row, deps);
    // WS-R29: the WhatsApp template, same "only after the claim" rule one
    // channel over — a losing racer has nothing to text about either.
    // `deliverers.whatsappTemplate` never throws (every branch it can take
    // either writes its own ledger row or, for a transient failure,
    // deliberately writes nothing).
    if (claimed) await deliverers.whatsappTemplate(db, row, deps);
    // WS-R34: the channel that already works, carrying the SAME `said` this
    // scope already produced through `gatedReply` - never a second model
    // call, workstream law #2 (negative control (c)). Same "only after the
    // claim" rule as the two deliverers above.
    if (claimed) await deliverers.telegram(db, row, said, deps);
    return { claimed, delivered: claimed };
  }
  // The gate suppressed everything a turn could have said. Still a completed
  // attempt, still advanced - a due date that fires into a `[]` gate result
  // every 15 minutes forever is worse than one that moves on.
  const claimed = await writeOutcome(db, row, {
    nextDueAt,
    deliveredAt: null,
    state: "failed",
    reason: "gate suppressed the reply",
  });
  return { claimed, delivered: false };
}

/**
 * Migration 085, workstream law #5: "a due row inside the quiet window is
 * not selected until the window ends." `$1` is the same `now` cutoff both
 * due-select queries already bind, converted into the follower's own
 * `timezone` wall-clock reading and compared against `quiet_from`/
 * `quiet_to` — a plain window when `quiet_from <= quiet_to`, a wraparound
 * one (e.g. 22:00 to 07:00) otherwise. Either `quiet_from`/`quiet_to` null
 * (the shipping default, migration 085's own column default) short-circuits
 * to "always selectable" before either comparison runs. Applied identically
 * to BOTH the delivery query and the skip-log query — a defense-in-depth
 * check alongside `computeNextDue`'s own scheduling-time avoidance below, so
 * a `next_due_at` computed before a follower narrowed their quiet window
 * still cannot fire inside it.
 */
const QUIET_HOURS_SQL = `(
  c.quiet_from is null or c.quiet_to is null or not (
    case when c.quiet_from <= c.quiet_to
      then (($1)::timestamptz at time zone c.timezone)::time >= c.quiet_from
           and (($1)::timestamptz at time zone c.timezone)::time < c.quiet_to
      else (($1)::timestamptz at time zone c.timezone)::time >= c.quiet_from
           or (($1)::timestamptz at time zone c.timezone)::time < c.quiet_to
    end
  )
)`;

/**
 * The scheduled half. Two SQL statements over the due rows - the delivery
 * query, whose WHERE clause names `f.tier = 'paid'` (workstream law #2), and
 * the skip-log query, whose WHERE clause names the complement - so which
 * follower ever reaches `gatedReply` is decided entirely by the delivery
 * query's own text, never by a branch in this function.
 */
export async function sweep(deps, now = Date.now()) {
  const db = deps.db;
  if (typeof db !== "function") throw new Error("checkins sweep database required");
  const limit = Math.max(1, Math.min(200, Number(deps.limit) || CHECKIN_SWEEP_DEFAULT_LIMIT));
  const loadAgent = deps.loadAgent;
  const summary = { seen: 0, delivered: 0, skippedFreeTier: 0, failed: 0, errors: 0 };

  const dueForDelivery = await db(
    `select c.checkin_id, c.room_id, c.person_id, c.follower_id, c.next_due_at as due_at,
            c.days_of_week, c.local_time, c.timezone, c.quiet_from, c.quiet_to,
            r.agent_id, r.slug, r.display_name, d.prompt_shape, d.title
       from vy_room_checkin c
       join vy_room_checkin_design d on d.design_id = c.design_id and d.state = 'active'
       join vy_room r on r.room_id = c.room_id and r.published_at is not null
       join vy_room_follower f on f.room_id = c.room_id and f.person_id = c.person_id
                               and f.follower_id = c.follower_id and f.tier = 'paid'
                               and f.memory_consent_at is not null
      where c.state = 'active' and c.next_due_at is not null and c.next_due_at <= ($1)::timestamptz
        and ${QUIET_HOURS_SQL}
      order by c.next_due_at asc
      limit $2`,
    [new Date(now).toISOString(), limit],
  );
  for (const row of dueForDelivery) {
    summary.seen++;
    try {
      const agent_module = loadAgent ? (await loadAgent(row.slug))?.module : undefined;
      const outcome = await deliverOne(db, { ...row, agent_module }, { ...deps, now });
      if (outcome.claimed) {
        if (outcome.delivered) summary.delivered++;
        else summary.failed++;
      }
    } catch (error) {
      summary.errors++;
      console.error("[checkins sweep] delivery failure:", error?.message || "unknown");
    }
  }

  const dueForSkip = await db(
    `select c.checkin_id, c.room_id, c.person_id, c.next_due_at as due_at,
            c.days_of_week, c.local_time, c.timezone, c.quiet_from, c.quiet_to
       from vy_room_checkin c
       join vy_room_checkin_design d on d.design_id = c.design_id and d.state = 'active'
       join vy_room r on r.room_id = c.room_id and r.published_at is not null
       join vy_room_follower f on f.room_id = c.room_id and f.person_id = c.person_id
                               and f.follower_id = c.follower_id
      where c.state = 'active' and c.next_due_at is not null and c.next_due_at <= ($1)::timestamptz
        and (f.tier <> 'paid' or f.memory_consent_at is null)
        and ${QUIET_HOURS_SQL}
      order by c.next_due_at asc
      limit $2`,
    [new Date(now).toISOString(), limit],
  );
  for (const row of dueForSkip) {
    summary.seen++;
    try {
      const nextDueAt = computeNextDue(now, row.days_of_week, row.local_time, row.timezone, {
        quietFrom: row.quiet_from, quietTo: row.quiet_to,
      });
      const claimed = await writeOutcome(db, row, {
        nextDueAt,
        deliveredAt: null,
        state: "skipped_free_tier",
        reason: "follower is not on the paid tier, or has withdrawn memory consent",
      });
      if (claimed) summary.skippedFreeTier++;
    } catch (error) {
      summary.errors++;
      console.error("[checkins sweep] skip-log failure:", error?.message || "unknown");
    }
  }

  // WS-R26: the abuse-limit windows table's own retention delete, run inside
  // whichever sweep is cheapest (migration 089's own header names this one -
  // the 15-minute cron). Best-effort: a purge failure must never fail the
  // check-ins sweep itself, the same posture withSweepRun's own heartbeat
  // writes take (api/_sweep-run.js).
  try {
    summary.ratePurged = await purgeStalePublicRateWindows(db, now);
  } catch (error) {
    console.error("[checkins sweep] rate purge failure:", error?.message || "unknown");
  }

  // WS-R58 (migration 109). The incident ledger's own new-kind alert
  // (workstream law #4) and its 90-day retention delete (law #5) - both
  // best-effort, `purgeStalePublicRateWindows`'s own posture one block up
  // restated twice: neither failure mode may ever turn an otherwise-
  // successful check-ins sweep into one that reports `errors`.
  try {
    const notified = await notifyNewIncidentKinds(db, {
      env: deps.env || process.env,
      fetch: deps.fetch,
      now,
      // WS-R62: the real store, no longer the always-empty default.
      operatorSubscriptionsFor: (ownerId) => operatorPushSubscriptionsFor(db, ownerId),
      revokeOperatorSubscription: (id) => revokeOperatorPushById(db, id),
    });
    summary.incidentKindsChecked = notified.checked;
    summary.incidentKindsNotified = notified.claimed;
  } catch (error) {
    console.error("[checkins sweep] incident notify failure:", error?.message || "unknown");
  }
  try {
    summary.incidentsPruned = await pruneOldIncidents(db);
  } catch (error) {
    console.error("[checkins sweep] incident prune failure:", error?.message || "unknown");
  }

  return summary;
}
