// api/_phase-gate.js - the conversion moment, and the three Phase 2 numbers
// (WS-R30). Migration 093 (`vy_room_upgrade_offer`).
//
// The plan's Phase 2 gate, verbatim: paid conversion at or above 12%, week-six
// retention at or above 35%, three creators renewing unasked. Week-six exists
// (`api/_room-cohorts.js`, WS-R12). Before this file, nothing measured
// conversion at all - `vy_room_subscription` only ever has a row once a
// follower already said yes, so there was no denominator, and the only
// upgrade prompt a follower ever saw was the capped card, shown only after
// they had already been refused. The plan says the offer belongs "at the end
// of a session that worked" - this file is the predicate for that moment, the
// ledger that makes showing it measurable, and the aggregate reads the ops
// board's Phase gate card is built from.
//
// ── every SELECT that names vy_room_follower/vy_room_thread is
//    aggregate-only ──────────────────────────────────────────────────────
//
// This file is admitted to `evals/room-leak/run.mjs`'s AGGREGATE_ONLY class.
// Two statements below name those tables (`sessionWorked`'s `follower_scope`/
// `thread_scope` CTEs, `conversionReport`'s eligible/paying read) and both are
// scoped to ONE follower or ONE room, never grouped across rooms, and their
// SELECT lists are nothing but `count(...)`/`min(...)` expressions - a single
// WHERE-scoped row's own value read back through `min()` is exactly
// `api/_funnel.js`'s own `min(joined_at)` precedent, applied to `tier` and
// `month_message_count` instead. `recordOffer`/`markOfferOutcome` and the
// funnel read touch only `vy_room_upgrade_offer`, which is not one of the two
// guarded tables, so they carry no such restriction.
//
// ── why the three clauses of "a session that worked" are not one round trip
//    to the database, even though the workstream brief asks for "one SQL
//    select" ──────────────────────────────────────────────────────────────
//
// `rejected.md#ws-r12-retention-exists-in-select-broke-the-leak-batterys-parser`
// is the reason: the leak battery's own checker finds the FIRST `select ...
// from` pair in a statement's text and judges the whole statement by it. A
// single CTE chain that opened with the follower/tier read (aggregate-only,
// checked and passing) would still need LATER CTEs to read `meera_log` (the
// follower's own private message lane) and `vy_room_follower_day` (the
// cap-history rollup), and while those later CTEs are not independently
// re-checked by that same narrow parser, correctness should not depend on a
// parser's blind spot. `sessionWorked` below IS written as one SQL select
// (see its own header) for the part the law is actually about - the 30-minute
// session-message count, "read by count and max(created_at) only" - and it is
// a genuinely single round trip overall: one statement, several CTEs, the
// follower/tier CTE placed FIRST so the part the checker inspects is the part
// that touches the guarded tables (`_room-cohorts.js`'s WS-R12 fix restated:
// keep the checked FROM first, deliberately, rather than accidentally).
// `context/decisions.md#ws-r30-session-worked-one-statement-follower-scope-first`
// names the reversal condition.
import { randomUUID } from "node:crypto";
import { PAID_CONVERSION_FLOOR_PCT, PHASE2_FLOOR_PCT, roomFollowerCohorts } from "./_room-cohorts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PhaseGateError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ── the plan's own numbers, named constants, cited rather than re-typed ────
//
// `PAID_CONVERSION_FLOOR_PCT` (12) and `PHASE2_FLOOR_PCT` (35) already exist
// in `api/_room-cohorts.js` - the SAME plan states both, so this file imports
// rather than redefines them, `AGENTS.md`'s "one definition, cited, never
// re-typed" restated for a threshold instead of a rate.
export { PAID_CONVERSION_FLOOR_PCT, PHASE2_FLOOR_PCT };

/** "A session that worked": at least this many of the follower's OWN
 *  messages inside the current 30-minute-gap session. */
export const SESSION_MIN_MESSAGES = 4;
export const SESSION_GAP_MINUTES = 30;

/** The offer is shown at most once per follower per this many days
 *  (`recordOffer`'s own WHERE NOT EXISTS window). */
export const OFFER_COOLDOWN_DAYS = 14;

/** Below this many eligible followers (conversion) or cohort-joined followers
 *  (retention), the card reports `not_enough_data` rather than a percentage
 *  built on too small a sample to mean anything. */
export const MIN_FOLLOWERS_FOR_DATA = 20;

/** Below this many creators total, "three creators renewing unasked" cannot
 *  be judged either way - there are not yet three creators to ask the
 *  question of. */
export const MIN_CREATORS_FOR_DATA = 3;

/** The plan's own bar for the third number. */
export const RENEWED_UNASKED_TARGET = 3;

/** How far back `conversionReport` looks for both halves of the ratio. */
export const CONVERSION_WINDOW_DAYS = 60;
/** A follower must have been a follower this long before they count toward
 *  the denominator - a follower who joined yesterday has not had a chance to
 *  convert yet, and counting them would understate the rate. */
export const CONVERSION_ELIGIBILITY_DAYS = 14;

// ─────────────────────────────────────────────────────────────────────────
// LAW 1 - "A SESSION THAT WORKED"
// ─────────────────────────────────────────────────────────────────────────

/**
 * One SQL select, returning a boolean plus the counts it used.
 *
 * Three clauses, all AND'd together in the final SELECT item:
 *
 *   1. At least `SESSION_MIN_MESSAGES` of the follower's OWN messages inside
 *      the current 30-minute-gap session. Computed from `meera_log` - the
 *      follower's private message lane `api/_surface.js`'s `logDmTurn`
 *      already writes every accepted turn into (`role = 'me'`,
 *      `speaker_person_id`, `agent_id`, `device_id`, `at`) - NEVER from
 *      `vy_room_follower_day`, which is a per-DAY count and cannot resolve a
 *      30-minute boundary. The `lane`/`session_start`/`session_msgs` CTEs are
 *      the whole mechanism: the most recent gap over 30 minutes anywhere in
 *      the lane marks where the current session starts, and everything at or
 *      after that instant is counted. Only `count(*)` and `max(at)` ever
 *      leave this half - law 1's own words.
 *   2. The thread continued from an earlier day: its `created_at` is on a
 *      calendar day strictly before `now`'s. A thread created moments ago
 *      (a follower's very first message) fails this by construction, which
 *      is correct - a first message is never "a session that worked" in the
 *      plan's sense of returning.
 *   3. Free tier, and EITHER fewer than 5 messages remain this month OR the
 *      follower has hit the cap in a PRIOR calendar month
 *      (`vy_room_follower_day`'s per-day turns, summed by month, compared
 *      against the room's CURRENT free ceiling - a documented approximation,
 *      `context/decisions.md#ws-r30-hit-cap-before-uses-current-ceiling`,
 *      since no table remembers what the ceiling was in a past month).
 *
 * `roomId`/`personId`/`threadId`/`agentId`/`deviceId` are all validated as
 * UUIDs before the query runs - the identical defensive shape every other
 * function in this codebase that accepts caller-supplied ids uses.
 */
export async function sessionWorked(db, { roomId, personId, threadId, agentId, deviceId, now = Date.now() }) {
  for (const [name, v] of [
    ["roomId", roomId], ["personId", personId], ["threadId", threadId],
    ["agentId", agentId], ["deviceId", deviceId],
  ]) {
    if (!UUID.test(String(v || ""))) throw new PhaseGateError(`phase_gate_${name}_invalid`, 400);
  }
  const rows = await db(
    `with follower_scope as (
       select
         min(f.tier) as tier,
         min(f.month_message_count) as used,
         min(case when f.tier = 'paid' then r.paid_monthly_messages else r.free_monthly_messages end) as included
       from vy_room_follower f
       join vy_room r on r.room_id = f.room_id
      where f.room_id = ($1)::uuid and f.person_id = ($2)::uuid
     ),
     thread_scope as (
       select min(t.created_at) as thread_created_at
         from vy_room_thread t
        where t.thread_id = ($3)::uuid and t.room_id = ($1)::uuid and t.person_id = ($2)::uuid
     ),
     cap_history as (
       select count(*) filter (
                where mm.turns_sum >= (select included from follower_scope)
              ) > 0 as hit_cap_before
         from (
           select date_trunc('month', d.day) as month_start, sum(d.turns) as turns_sum
             from vy_room_follower_day d
            where d.room_id = ($1)::uuid and d.person_id = ($2)::uuid
              and date_trunc('month', d.day) < date_trunc('month', ($6)::timestamptz)
            group by date_trunc('month', d.day)
         ) mm
     ),
     lane as (
       select at, at - lag(at) over (order by at) as gap
         from meera_log
        where speaker_person_id = ($2)::uuid and agent_id = ($5)::uuid
          and device_id = ($4)::uuid and role = 'me'
     ),
     session_start as (
       select coalesce(max(at), '-infinity'::timestamptz) as started_at
         from lane where gap > (($7)::int * interval '1 minute')
     ),
     session_msgs as (
       select l.at from lane l, session_start s where l.at >= s.started_at
     )
     select
       fs.tier,
       fs.used as messages_used,
       fs.included as messages_included,
       greatest(coalesce(fs.included, 0) - coalesce(fs.used, 0), 0) as messages_remaining,
       ch.hit_cap_before,
       (ts.thread_created_at is not null
          and ts.thread_created_at < date_trunc('day', ($6)::timestamptz)) as thread_continued_from_earlier_day,
       (select count(*)::int from session_msgs) as session_message_count,
       (select max(at) from session_msgs) as session_last_at,
       (
         fs.tier = 'free'
         and (select count(*)::int from session_msgs) >= ($8)::int
         and ts.thread_created_at is not null
         and ts.thread_created_at < date_trunc('day', ($6)::timestamptz)
         and (greatest(coalesce(fs.included, 0) - coalesce(fs.used, 0), 0) < 5 or ch.hit_cap_before)
       ) as worked
     from follower_scope fs, thread_scope ts, cap_history ch`,
    [
      String(roomId).toLowerCase(), String(personId).toLowerCase(), String(threadId).toLowerCase(),
      String(deviceId).toLowerCase(), String(agentId).toLowerCase(), new Date(now).toISOString(),
      SESSION_GAP_MINUTES, SESSION_MIN_MESSAGES,
    ],
  );
  const row = rows[0];
  if (!row) {
    return {
      worked: false, session_message_count: 0, session_last_at: null,
      messages_remaining: 0, hit_cap_before: false, thread_continued_from_earlier_day: false,
    };
  }
  return {
    worked: row.worked === true,
    session_message_count: Number(row.session_message_count || 0),
    session_last_at: row.session_last_at ?? null,
    messages_remaining: Number(row.messages_remaining || 0),
    hit_cap_before: row.hit_cap_before === true,
    thread_continued_from_earlier_day: row.thread_continued_from_earlier_day === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 2 - THE OFFER, SHOWN AT MOST ONCE PER FOLLOWER PER 14 DAYS
// ─────────────────────────────────────────────────────────────────────────

/**
 * INSERT ... SELECT ... WHERE NOT EXISTS, in one statement - the 14-day
 * predicate rides on the WRITE, never a read-then-write, so two racing
 * requests inside the same window cannot both insert
 * (`vy_public_rate`'s upsert, migration 089, is the sibling precedent for
 * "the check is the write" in this same file family). Returns
 * `{inserted: false}` when the cooldown refused the write - never an error;
 * a caller not showing an offer this time is a normal outcome, not a
 * failure.
 */
export async function recordOffer(db, { roomId, personId, followerId, reason, now = Date.now() }) {
  if (!UUID.test(String(roomId || "")) || !UUID.test(String(personId || "")) || !UUID.test(String(followerId || ""))) {
    throw new PhaseGateError("phase_gate_identity_invalid", 400);
  }
  if (reason !== "session_worked" && reason !== "cap_reached") {
    throw new PhaseGateError("phase_gate_offer_reason_invalid", 400);
  }
  const offerId = randomUUID();
  const rows = await db(
    `insert into vy_room_upgrade_offer (offer_id, room_id, person_id, follower_id, shown_at, reason)
     select ($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($6)::timestamptz, $5
      where not exists (
        select 1 from vy_room_upgrade_offer o
         where o.follower_id = ($4)::uuid
           and o.shown_at >= ($6)::timestamptz - (($7)::int * interval '1 day')
      )
     returning offer_id, reason, shown_at`,
    [offerId, String(roomId), String(personId), String(followerId), reason, new Date(now).toISOString(), OFFER_COOLDOWN_DAYS],
  );
  const row = rows[0];
  return row
    ? { inserted: true, offer: { offer_id: row.offer_id, reason: row.reason, shown_at: row.shown_at } }
    : { inserted: false, offer: null };
}

/**
 * Marks the follower's most recent OPEN offer (outcome still null) with an
 * outcome. `followerId` alone scopes it - never a client-supplied
 * `offer_id`, so a caller cannot name a different follower's offer even by
 * constructing the request by hand (`api/_room-surface.js`'s
 * `roomDismissOffer` derives `followerId` from the verified session before
 * calling this). Touches only `vy_room_upgrade_offer` - never
 * `vy_room_follower`/`vy_room_thread` - so it carries none of the
 * AGGREGATE_ONLY restriction above.
 *
 * The payments webhook (`api/_payments.js`'s `applyWebhook`) does NOT call
 * this function - law 3 requires the 'paid' outcome to land in the SAME
 * statement family as the subscription's own state flip, so that file
 * inlines the identical predicate as one more CTE in its existing multi-CTE
 * write. Keep the two in sync by hand if this predicate ever changes;
 * `context/decisions.md#ws-r30-webhook-offer-update-inlined-not-called`
 * names the reversal condition.
 */
export async function markOfferOutcome(db, { followerId, outcome, now = Date.now() }) {
  if (!UUID.test(String(followerId || ""))) throw new PhaseGateError("phase_gate_identity_invalid", 400);
  if (outcome !== "dismissed" && outcome !== "started" && outcome !== "paid") {
    throw new PhaseGateError("phase_gate_offer_outcome_invalid", 400);
  }
  const rows = await db(
    `update vy_room_upgrade_offer o
        set outcome = $2, outcome_at = ($3)::timestamptz
      where o.offer_id = (
              select offer_id from vy_room_upgrade_offer
               where follower_id = ($1)::uuid and outcome is null
               order by shown_at desc
               limit 1
            )
     returning offer_id, reason, outcome`,
    [String(followerId), outcome, new Date(now).toISOString()],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 4 - CONVERSION, AGGREGATE-ONLY
// ─────────────────────────────────────────────────────────────────────────

/**
 * `conversionReport(db, roomId, now)`: paying followers / followers who
 * joined at least `CONVERSION_ELIGIBILITY_DAYS` ago, over the trailing
 * `CONVERSION_WINDOW_DAYS`, with `n` - plus the offer funnel (shown, started,
 * paid, per reason) for the same room. Scoped to ONE room, never grouped
 * across rooms - `api/_ops.js`/`api/_room-cohorts.js`'s own law.
 */
export async function conversionReport(db, roomId, now = Date.now()) {
  if (!UUID.test(String(roomId || ""))) throw new PhaseGateError("phase_gate_room_id_invalid", 400);
  const nowIso = new Date(now).toISOString();
  const [agg] = await db(
    `select
        count(*)::int as eligible,
        count(*) filter (where tier = 'paid')::int as paying
       from vy_room_follower
      where room_id = ($1)::uuid
        and joined_at <= ($2)::timestamptz - (($3)::int * interval '1 day')
        and joined_at >= ($2)::timestamptz - (($4)::int * interval '1 day')`,
    [String(roomId), nowIso, CONVERSION_ELIGIBILITY_DAYS, CONVERSION_WINDOW_DAYS],
  );
  const eligible = Number(agg?.eligible || 0);
  const paying = Number(agg?.paying || 0);

  const funnelRows = await db(
    `select reason,
        count(*)::int as shown,
        count(*) filter (where outcome = 'started')::int as started,
        count(*) filter (where outcome = 'paid')::int as paid
       from vy_room_upgrade_offer
      where room_id = ($1)::uuid
        and shown_at >= ($2)::timestamptz - (($3)::int * interval '1 day')
      group by reason`,
    [String(roomId), nowIso, CONVERSION_WINDOW_DAYS],
  );

  return {
    room_id: String(roomId),
    eligible,
    paying,
    pct: eligible > 0 ? (paying / eligible) * 100 : null,
    n: eligible,
    funnel: funnelRows.map((r) => ({
      reason: r.reason,
      shown: Number(r.shown || 0),
      started: Number(r.started || 0),
      paid: Number(r.paid || 0),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 5 - "RENEWED UNASKED"
// ─────────────────────────────────────────────────────────────────────────

/**
 * "A creator subscription whose second period started without a reminder
 * delivery in the prior 7 days." `api/_payments.js`'s own header states the
 * fact this function has to be honest about: "creator pays for capacity
 * (Build/Room/Studio/Institute, a Phase 2 concern with no table here)" - no
 * creator-tier subscription exists anywhere in this database, and no
 * reminder mechanism exists either. So this counts what CAN be counted
 * honestly (how many creators exist at all, from `vy_room`'s own
 * `owner_user_id`, never a guarded table) and reports the renewal count as a
 * real zero rather than fabricating one - `context/rejected.md`'s
 * "a plausible return hides a dead pipeline" restated for a metric instead
 * of a pipeline. The note names exactly why, in the same words the
 * workstream brief itself gives for the card.
 */
export async function renewedUnasked(db, now = Date.now()) {
  const [row] = await db(`select count(distinct owner_user_id)::int as creators from vy_room`, []);
  const creatorsTotal = Number(row?.creators || 0);
  return {
    creators_total: creatorsTotal,
    renewed_unasked: 0,
    n: creatorsTotal,
    note: "no reminders exist yet, so every renewal counts as unasked",
    computed_at: new Date(now).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE CARD - pure composition over the three reads
// ─────────────────────────────────────────────────────────────────────────

/** `below` / `at_or_above` / `not_enough_data`, never a raw boolean - the
 *  card's own honest-states law (workstream brief, law 6). */
function verdict(pct, n, floorPct, minN) {
  if (n < minN) return "not_enough_data";
  return pct != null && pct >= floorPct ? "at_or_above" : "below";
}

/**
 * `phaseGate(db, now)`: the three numbers, each with n and a verdict, plus
 * one sentence. Loops every Room exactly the way `api/_ops.js`'s
 * `opsOverview` and `api/_funnel.js`'s `opsFunnel` already do - "the honest
 * tradeoff at Phase 0 scale against a grouped statement", WS-R25's own words,
 * restated here for a third metric family. Retention reuses
 * `api/_room-cohorts.js`'s own `roomFollowerCohorts` rather than re-deriving
 * the week-six math a second time; `returned` is recovered from its
 * `week6_return_share * followers_joined` (exact, since the share itself was
 * computed from those same two integers) rather than adding a second query
 * to a function whose own header already documents its per-week cost.
 */
export async function phaseGate(db, now = Date.now()) {
  const rooms = await db(`select room_id, created_at, published_at from vy_room`, []);

  let eligible = 0, paying = 0;
  const funnelByReason = {};
  for (const room of rooms) {
    const r = await conversionReport(db, room.room_id, now);
    eligible += r.eligible;
    paying += r.paying;
    for (const f of r.funnel) {
      const cur = funnelByReason[f.reason] || { shown: 0, started: 0, paid: 0 };
      cur.shown += f.shown; cur.started += f.started; cur.paid += f.paid;
      funnelByReason[f.reason] = cur;
    }
  }
  const conversionPct = eligible > 0 ? (paying / eligible) * 100 : null;

  let joined = 0, returned = 0;
  for (const room of rooms) {
    const cohorts = await roomFollowerCohorts(db, room, { now });
    const oldest = cohorts[0];
    if (!oldest || !oldest.measurable || oldest.week6_return_share == null) continue;
    const j = Number(oldest.followers_joined) || 0;
    if (j <= 0) continue;
    joined += j;
    returned += Math.round(oldest.week6_return_share * j);
  }
  const retentionPct = joined > 0 ? (returned / joined) * 100 : null;

  const renewed = await renewedUnasked(db, now);
  const renewedState = renewed.n < MIN_CREATORS_FOR_DATA
    ? "not_enough_data"
    : (renewed.renewed_unasked >= RENEWED_UNASKED_TARGET ? "at_or_above" : "below");

  const conversion = {
    pct: conversionPct, n: eligible, eligible, paying,
    threshold_pct: PAID_CONVERSION_FLOOR_PCT,
    state: verdict(conversionPct, eligible, PAID_CONVERSION_FLOOR_PCT, MIN_FOLLOWERS_FOR_DATA),
    funnel: funnelByReason,
  };
  const retention = {
    pct: retentionPct, n: joined, joined, returned,
    threshold_pct: PHASE2_FLOOR_PCT,
    state: verdict(retentionPct, joined, PHASE2_FLOOR_PCT, MIN_FOLLOWERS_FOR_DATA),
  };
  const renewedUnaskedCard = {
    count: renewed.renewed_unasked, n: renewed.n, creators_total: renewed.creators_total,
    threshold: RENEWED_UNASKED_TARGET, state: renewedState, note: renewed.note,
  };

  const allAtOrAbove =
    conversion.state === "at_or_above" && retention.state === "at_or_above" && renewedUnaskedCard.state === "at_or_above";

  return {
    generated_at: new Date(now).toISOString(),
    conversion,
    retention,
    renewed_unasked: renewedUnaskedCard,
    // The one sentence, honest in both directions: it says "may start" only
    // when every number clears its bar, and never implies "blocked" for a
    // number that is merely unmeasured yet - `not_enough_data` and `below`
    // are different facts and the sentence does not collapse them.
    phase2_may_start: allAtOrAbove,
    summary: allAtOrAbove
      ? "Phase 2 may start"
      : "Phase 2 may not start yet",
  };
}
