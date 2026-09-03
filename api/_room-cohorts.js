// api/_room-cohorts.js — the number that decides the company (WS-R12).
//
// The Rooms plan, verbatim: "Not signups, not messages, not MAU. Week-six
// retention of followers who arrived in week one. Below 25% this product does
// not work and no amount of feature building fixes it. Above 40% it is a
// category. Everything in Phase 0 exists to find out which." Phase 0's gate is
// week-six retention of week-one arrivals at or above 25%. Phase 2's is at or
// above 35%, plus paid conversion at or above 12% of signups. Nothing in this
// repo measured either number before this file existed — `ownerRoomStats`
// (api/_room-publish.js) answers "followers total, active today, messages this
// month", and none of those three is retention (context/decisions.md, the
// Rooms plan's own list of banned success metrics: messages per user, session
// length, DAU and streaks are diagnostics, never a substitute for this one).
//
// ── a pure function plus its SQL, kept apart on purpose ────────────────────
//
// `cohortRow` and `verdictFor` take already-aggregated counts and decide
// nothing about the database — they are unit-testable with plain numbers, and
// `evals/room-cohorts/run.mjs`'s fixtures (a 2-week cohort, a 7-week cohort at
// 3/10, an 8-week cohort at 5/10) exercise them directly, offline, with no db
// at all. `roomFollowerCohorts` is the one function that talks to Postgres,
// and every statement it sends is content-free and AGGREGATE-ONLY — nothing
// but `count(*)` and `count(*) filter (...)`, never a follower's own column —
// the same discipline `api/_room-publish.js`'s `ownerRoomStats` already holds,
// and `evals/room-leak/run.mjs`'s AGGREGATE_ONLY set now proves this file to
// as well as that one.
//
// ── why the retention window filters through the WHERE clause, not SELECT ──
//
// Whether a follower returned in week six is answered with an `exists (select
// 1 from vy_room_follower_day d where d.person_id = f.person_id and ...)`
// clause INSIDE the outer query's WHERE, never as a selected column and never
// as `count(distinct d.person_id)`. That is not a style preference — it is
// what keeps the reveal this product exists to refuse (a creator learning
// WHICH follower talked) structurally impossible: a person id can appear in a
// predicate that FILTERS rows without ever appearing in what the predicate
// counts, and the count that comes back cannot be traced to any one row.
//
// ── the cohort week is a WHOLE ISO week, the retention window is 36-42 days
//    after that week's Monday, not after each follower's own exact timestamp ─
//
// The plan's own framing is "followers who arrived in week one", not
// "followers who arrived at 14:32 on Tuesday" — a cohort table that answered
// with a different window per follower would report a false precision the
// plan never asked for, and would need to reach into `f.joined_at` per row to
// compute it, which is exactly the shape of read this file exists to refuse.
// Anchoring the whole cohort to its ISO week's Monday keeps every follower in
// one cohort answering the same question over the same seven-day window, and
// is a deliberate simplification, logged as `ws-r12-cohort-week-anchor` in
// context/decisions.md with its own reversal condition.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// The plan's own numbers, verbatim, exported so a caller (the owner endpoint,
// the eval, the studio card's copy) reads ONE definition rather than three
// that could drift.
export const WEEK6_START_DAY = 36;
export const WEEK6_END_DAY = 42;
export const PHASE0_FLOOR_PCT = 25;
export const PHASE2_FLOOR_PCT = 35;
export const CATEGORY_FLOOR_PCT = 40;
export const PAID_CONVERSION_FLOOR_PCT = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RoomCohortsError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** The Monday 00:00 UTC of the ISO week containing `at`. Pure — no clock read
 *  unless the caller passes none, and even then it is the only place `Date.now()`
 *  is read in this module's SQL-issuing half, so a test can hold time still by
 *  passing `now`. */
export function isoWeekStart(at) {
  const src = new Date(at);
  const d = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday is 0; treated as 7 so Monday is always day 1
  if (day > 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** 'YYYY-Www', the standard ISO week label (Thursday-of-week decides the
 *  year, so the last days of December and the first of January land in the
 *  right week without a special case). Display only — never used as a key. */
export function isoWeekLabel(at) {
  const d = isoWeekStart(at);
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((thursday.getTime() - yearStart.getTime()) / DAY_MS / 7) + 1;
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** One cohort's row, from already-aggregated counts. Pure: no db, no clock
 *  read beyond the `now` it is handed. `followersJoined`/`paidFollowers` are
 *  always known; `returnedWeek6` is only meaningful once the window has
 *  closed, and the caller is expected to pass 0 for a cohort that is not yet
 *  measurable — this function decides "not measurable" from `weekStart` and
 *  `now` alone, never from whether a count arrived, so it cannot be fooled by
 *  a caller that forgot to skip the second query. */
export function cohortRow({ weekStart, now = Date.now(), followersJoined = 0, returnedWeek6 = 0, paidFollowers = 0 }) {
  const start = new Date(weekStart);
  const joined = Number(followersJoined) || 0;
  const returned = Number(returnedWeek6) || 0;
  const paid = Number(paidFollowers) || 0;
  // Measurable once day WEEK6_END_DAY has fully elapsed for this cohort — the
  // instant `start + (WEEK6_END_DAY + 1) days` is reached, not a day earlier,
  // so a share is never reported off a window still in progress.
  const measurableAt = new Date(start.getTime() + (WEEK6_END_DAY + 1) * DAY_MS);
  const measurable = Number(now) >= measurableAt.getTime();
  return {
    cohort_week: isoWeekLabel(start),
    week_start: start.toISOString().slice(0, 10),
    followers_joined: joined,
    measurable,
    not_measurable_until: measurable ? null : measurableAt.toISOString().slice(0, 10),
    week6_return_share: measurable && joined > 0 ? returned / joined : null,
    // Paid conversion is not time-windowed the way retention is — the plan
    // asks for "followers with tier='paid' / followers joined", a ratio true
    // at read time, so it is reported whether or not the cohort has reached
    // week six.
    paid_conversion_share: joined > 0 ? paid / joined : null,
  };
}

/** The Phase-0/Phase-2 verdict, for the OLDEST measurable cohort — the plan's
 *  own framing is "followers who arrived in week one", i.e. the first cohort
 *  this Room ever had, so once ANY cohort is measurable the oldest one is the
 *  one the plan is asking about; a newer, larger cohort's share is not
 *  substituted for it even if it happens to be higher. Pure: takes the array
 *  `roomFollowerCohorts` already built. */
export function verdictFor(cohorts) {
  const measurable = (cohorts || []).filter((c) => c.measurable && c.week6_return_share != null);
  if (!measurable.length) {
    return { verdict: "not_measurable_yet", cohort_week: null, week6_return_share: null };
  }
  const oldest = measurable.reduce((a, b) => (a.week_start <= b.week_start ? a : b));
  const pct = oldest.week6_return_share * 100;
  const verdict = pct < PHASE0_FLOOR_PCT ? "below_25" : pct < CATEGORY_FLOOR_PCT ? "between_25_and_40" : "above_40";
  return { verdict, cohort_week: oldest.cohort_week, week6_return_share: oldest.week6_return_share };
}

/**
 * The one function that talks to Postgres. One cohort week at a time, from
 * the Room's own anchor (published_at, since no follower can join before that
 * — 071's own gate) through the current week, each week costing one or two
 * strictly aggregate statements (the second is skipped for a cohort with zero
 * followers or one not yet measurable, so an empty week costs one).
 *
 * KNOWN TRADE, STATED RATHER THAN HIDDEN: this issues one round trip per
 * cohort week, so a Room with several years of history costs several hundred
 * statements per read. Acceptable for v1 — an owner opens this screen rarely,
 * never on a follower's path — and the reversal condition is named in
 * context/decisions.md#ws-r12-per-week-queries: if a Room's week count ever
 * makes this read slow enough to matter, replace the loop with one grouped
 * query and re-derive the AGGREGATE_ONLY proof for it.
 */
export async function roomFollowerCohorts(db, room, { now = Date.now() } = {}) {
  const roomId = String(room.room_id);
  const anchor = room.published_at ?? room.created_at ?? now;
  const start0 = isoWeekStart(anchor).getTime();
  const rows = [];
  for (let t = start0; t <= Number(now); t += WEEK_MS) {
    const weekStart = new Date(t);
    const weekEnd = new Date(t + WEEK_MS);

    const [agg] = await db(
      `select
          count(*)::int as followers_joined,
          count(*) filter (where f.tier = 'paid')::int as paid_followers
        from vy_room_follower f
       where f.room_id = ($1)::uuid
         and f.joined_at >= ($2)::timestamptz
         and f.joined_at < ($3)::timestamptz`,
      [roomId, weekStart.toISOString(), weekEnd.toISOString()],
    );
    const followersJoined = Number(agg?.followers_joined || 0);
    const paidFollowers = Number(agg?.paid_followers || 0);

    const week6Start = new Date(t + WEEK6_START_DAY * DAY_MS);
    const week6EndExclusive = new Date(t + (WEEK6_END_DAY + 1) * DAY_MS);
    const measurableNow = Number(now) >= week6EndExclusive.getTime();

    let returnedWeek6 = 0;
    if (measurableNow && followersJoined > 0) {
      const [ret] = await db(
        `select count(*)::int as returned_week6
           from vy_room_follower f
          where f.room_id = ($1)::uuid
            and f.joined_at >= ($2)::timestamptz
            and f.joined_at < ($3)::timestamptz
            and exists (
              select 1 from vy_room_follower_day d
               where d.room_id = f.room_id
                 and d.person_id = f.person_id
                 and d.day >= ($4)::date
                 and d.day < ($5)::date
                 and d.turns > 0
            )`,
        [
          roomId,
          weekStart.toISOString(),
          weekEnd.toISOString(),
          week6Start.toISOString().slice(0, 10),
          week6EndExclusive.toISOString().slice(0, 10),
        ],
      );
      returnedWeek6 = Number(ret?.returned_week6 || 0);
    }

    rows.push(cohortRow({ weekStart, now, followersJoined, returnedWeek6, paidFollowers }));
  }
  return rows;
}

/** The owner-scoped room handle, `api/_room-publish.js`'s `ownedRoomRow` one
 *  file over — re-derived rather than imported so this module stays reachable
 *  with only a fake `db`, exactly `api/_room-publish.js`'s own reasoning for
 *  not sharing shape with `api/_clonechannel.js`. Ownership is decided by the
 *  predicate itself: "not yours" and "does not exist" answer identically. */
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

/** GET-side entry point. Owner-scoped, read-only, aggregate-only in every
 *  statement it or its callee ever issues. Returns null for a replica that is
 *  not this owner's or does not exist — the same non-answer, on purpose. */
export async function readOwnedRoomCohorts(db, ownerUserId, replicaId, { now = Date.now() } = {}) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new RoomCohortsError("room_cohorts_identity_invalid", 400);
  }
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) return null;
  const cohorts = await roomFollowerCohorts(db, room, { now });
  return { cohorts, verdict: verdictFor(cohorts) };
}
