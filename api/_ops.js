// The platform-operator ops board (WS-R21). Answers "is the Room alive" in
// ten seconds, without a database client and without ever showing a
// follower's words - every read here is a count, a timestamp or a state.
//
// ── law 1: platform-operator only, 404 by name ─────────────────────────────
//
// `OPS_OWNER_USER_IDS` (comma-separated Supabase user ids) is the whole
// allowlist. Unset means this capability does not exist for anyone, and a
// signed-in user who is not on the list gets the identical answer a stranger
// gets - `api/ops.js` returns 404, never 403, so the board's existence is
// never disclosed to anyone it is not for. `isOpsOwner`/`opsBoardConfigured`
// are pure functions of `process.env` (no db, no request) so
// `evals/ops/run.mjs` can drive both negative controls (unset allowlist,
// non-allowlisted user) with nothing but an env var.
//
// ── law 2: aggregate-only, every read ───────────────────────────────────────
//
// This file is admitted to `evals/room-leak/run.mjs`'s AGGREGATE_ONLY class
// (its own comment there names the rule): every statement here that names
// `vy_room_follower` (or its day-count sibling `vy_room_follower_day`, which
// contains that name as a substring) is scoped to ONE room by
// `where room_id = ($1)::uuid` - never grouped across rooms - and its select
// list is nothing but `count(...)`/`sum(...)` expressions, the same shape
// `api/_room-cohorts.js` and `api/_pulse.js` already prove out. Follower ids
// never leave this file: the board shows counts, never a person.
import { monthKeyOf } from "./_room-surface.js";
import { readPulse } from "./_pulse.js";
import { sweepSchedules } from "./_sweep-schedule.js";
// WS-R25 (migration 088). "Minutes to first Room" and "where creators stop" -
// `opsFunnel` is its own aggregate-only function in `api/_funnel.js` (that
// file's own header names the rule this file already keeps), imported here
// rather than re-derived so the board's one call stays the board's one call.
import { opsFunnel, creatorInviteArrivalsThisWeek, shareArrivalsThisWeek } from "./_funnel.js";
// WS-R29 (migration 092). The unit cost is a named constant in the one file
// that owns the send path - imported here rather than restated, so the
// board's own number and the send path's own comment can never drift apart.
import { WHATSAPP_TEMPLATE_UNIT_COST_INR } from "./_room-whatsapp.js";
// WS-R30 (migration 093). `phaseGate`'s own header names the same rule this
// file already keeps: aggregate-only, one room at a time, imported rather
// than re-derived so the board's Phase gate card can never disagree with the
// function that actually decided the numbers.
import { phaseGate } from "./_phase-gate.js";
// WS-R48 (migration 107). Suites sell themselves: `suitesFunnelThisWeek`
// (api/_funnel.js) owns the two Suite-growth counts, `suiteIntentApplicationsThisWeek`
// (api/_apply.js) owns the "someone who wants to talk first" count - both
// imported rather than re-derived, this file's own established pattern one
// import list up.
import { suitesFunnelThisWeek } from "./_funnel.js";
import { suiteIntentApplicationsThisWeek } from "./_apply.js";

const OPS_OWNER_ENV = "OPS_OWNER_USER_IDS";

function opsOwnerIds(env = process.env) {
  return String(env[OPS_OWNER_ENV] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Is the capability configured at all - checked BEFORE any request touches
 *  a user id, so an unset allowlist answers identically for every caller. */
export function opsBoardConfigured(env = process.env) {
  return opsOwnerIds(env).length > 0;
}

/** Is this specific (already-authenticated) user id the platform operator.
 *  False whenever the capability is unconfigured, so a caller cannot get a
 *  different answer by skipping the `opsBoardConfigured` check. */
export function isOpsOwner(userId, env = process.env) {
  const ids = opsOwnerIds(env);
  return ids.length > 0 && ids.includes(String(userId || "").toLowerCase());
}

function monthStartIso(now) {
  return `${new Date(now).toISOString().slice(0, 7)}-01T00:00:00.000Z`;
}

// Neon's SQL-over-HTTP endpoint has, in this repo's own experience
// (api/_drift-watch.js), returned a `jsonb` column as either a parsed object
// or its raw string depending on path - defended the same way there.
function parseJsonbMaybe(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value) {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

/** One Room's numbers. Every statement below is scoped by `room_id = $1`
 *  alone - see this file's header for why that is what keeps every
 *  follower-table read inside AGGREGATE_ONLY.
 *
 *  Exported (WS-R28) so a Suite admin's own board (`api/_org.js`'s
 *  `orgBoard`) can read the identical shape for a Room that belongs to their
 *  organisation, rather than re-deriving the same aggregate query a second
 *  time - `api/_funnel.js`'s `opsFunnel` reused-not-rederived precedent,
 *  restated one file over: two aggregator surfaces reading one proven leaf
 *  function can never disagree about what one Room's numbers are. */
export async function roomOverview(db, room, monthKey, now) {
  const roomId = String(room.room_id);
  const freeCeiling = Number(room.free_monthly_messages ?? 20);
  const paidCeiling = Number(room.paid_monthly_messages ?? 500);

  const [followers] = await db(
    `select
        count(*)::int as total,
        count(*) filter (where tier = 'paid')::int as paid,
        count(*) filter (where joined_at >= now() - interval '7 days')::int as joined_7d,
        count(*) filter (
          where month_key = ($2)
            and (
              (tier = 'paid' and month_message_count >= ($3)::int)
              or (tier <> 'paid' and month_message_count >= ($4)::int)
            )
        )::int as at_cap,
        coalesce(sum(voice_seconds_month) filter (where voice_month_key = ($2)), 0)::int as voice_seconds
       from vy_room_follower
      where room_id = ($1)::uuid`,
    [roomId, monthKey, paidCeiling, freeCeiling],
  );

  const [messages] = await db(
    `select coalesce(sum(turns), 0)::int as last_24h
       from vy_room_follower_day
      where room_id = ($1)::uuid and day >= (current_date - 1)`,
    [roomId],
  );

  const [checkins] = await db(
    `select count(*)::int as active
       from vy_room_checkin
      where room_id = ($1)::uuid and state = 'active'`,
    [roomId],
  );

  const deliveryRows = await db(
    `select state, count(*)::int as n
       from vy_room_checkin_delivery
      where room_id = ($1)::uuid and created_at >= now() - interval '24 hours'
      group by state`,
    [roomId],
  );

  const [subscriptions] = await db(
    `select
        count(*) filter (where state = 'created')::int as created,
        count(*) filter (where state = 'authenticated')::int as authenticated,
        count(*) filter (where state = 'active')::int as active,
        count(*) filter (where state = 'paused')::int as paused,
        count(*) filter (where state = 'cancelled')::int as cancelled,
        count(*) filter (where state = 'expired')::int as expired
       from vy_room_subscription
      where room_id = ($1)::uuid`,
    [roomId],
  );

  const [revenue] = await db(
    `select coalesce(sum(amount_inr) filter (
        where kind = 'subscription.charged' and received_at >= ($2)::timestamptz
      ), 0)::int as this_month_inr
       from vy_payment_event
      where room_id = ($1)::uuid`,
    [roomId, monthStartIso(now)],
  );

  const [drift] = await db(
    `select state, computed_at
       from vy_replica_drift_report
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by computed_at desc
      limit 1`,
    [String(room.replica_id), String(room.owner_user_id)],
  );

  // Pulse's own reader - already aggregate-only and already admitted to the
  // leak battery under its own name; reused rather than re-derived so the
  // "opt-ins" and "latest week" numbers can never disagree with what a
  // creator's own Pulse card shows.
  const pulse = await readPulse(db, room.owner_user_id, room.replica_id).catch(() => null);

  return {
    room_id: roomId,
    slug: room.slug,
    display_name: room.display_name || "",
    published: Boolean(room.published_at) && !room.paused_at,
    followers_total: Number(followers?.total || 0),
    followers_paid: Number(followers?.paid || 0),
    joined_last_7d: Number(followers?.joined_7d || 0),
    messages_last_24h: Number(messages?.last_24h || 0),
    at_cap_this_month: Number(followers?.at_cap || 0),
    voice_seconds_this_month: Number(followers?.voice_seconds || 0),
    active_check_ins: Number(checkins?.active || 0),
    deliveries_last_24h: Object.fromEntries(deliveryRows.map((d) => [d.state, Number(d.n)])),
    pulse_opt_ins: pulse?.total_optin ?? 0,
    latest_pulse_week: pulse?.week_start ?? null,
    subscriptions: {
      created: Number(subscriptions?.created || 0),
      authenticated: Number(subscriptions?.authenticated || 0),
      active: Number(subscriptions?.active || 0),
      paused: Number(subscriptions?.paused || 0),
      cancelled: Number(subscriptions?.cancelled || 0),
      expired: Number(subscriptions?.expired || 0),
    },
    revenue_this_month_inr: Number(revenue?.this_month_inr || 0),
    drift_state: drift?.state || "no_report",
    drift_computed_at: drift?.computed_at || null,
  };
}

/** "has this sweep run recently enough" - never guessed: `schedule` is null
 *  when `vercel.json` carries no cron for this name, or when its shape is
 *  not one `api/_sweep-schedule.js` recognises, and both cases are reported
 *  as a distinct state rather than folded into "fresh" or "stale". */
export function sweepStaleness(last, schedule, now) {
  if (!last) return schedule ? "never_ran" : "unscheduled";
  const interval = schedule?.expected_interval_ms;
  if (!Number.isFinite(interval)) return "unknown_schedule";
  const lastAt = new Date(last.started_at).getTime();
  if (!Number.isFinite(lastAt)) return "unknown_schedule";
  return now - lastAt > 2 * interval ? "stale" : "fresh";
}

/**
 * WS-R29 (workstream law #5): "the owner sees the bill before Meta does."
 * Platform-wide (not per-room) - a creator's own room card already shows
 * `deliveries_last_24h` broken out by state; this is the OWNER's monthly
 * spend across every Room, the number `_payments.js`'s `revenue_this_month_
 * inr` sits beside. `count(*)` alone, ungrouped by room, is still
 * aggregate-only in the sense `evals/room-leak/run.mjs`'s check names (this
 * table is not `vy_room_follower`/`vy_room_thread`, so that check does not
 * scan it at all) - named here rather than silently assumed.
 */
async function whatsappSpendThisMonth(db, now) {
  const [row] = await db(
    `select count(*)::int as n
       from vy_room_checkin_delivery
      where channel = 'whatsapp_template' and state = 'delivered'
        and created_at >= ($1)::timestamptz`,
    [monthStartIso(now)],
  );
  const count = Number(row?.n || 0);
  return {
    template_sends_this_month: count,
    // Rounded to paise (2 decimals) - a currency figure with float noise
    // past that is a number nobody asked for.
    cost_this_month_inr: Math.round(count * WHATSAPP_TEMPLATE_UNIT_COST_INR * 100) / 100,
  };
}

/** The latest `vy_sweep_run` row per sweep, joined against `vercel.json`'s
 *  own schedule table (read at build time by `_sweep-schedule.js`, not
 *  guessed). A sweep named in `vercel.json` with no row at all reports
 *  `never_ran` rather than being silently absent from the board. */
async function sweepsOverview(db, now) {
  const rows = await db(
    `select distinct on (sweep) sweep, started_at, finished_at, outcome, counts, error_code
       from vy_sweep_run
      order by sweep, started_at desc`,
    [],
  );
  const bySweep = new Map(rows.map((r) => [r.sweep, r]));
  const schedules = sweepSchedules();
  const names = new Set([...Object.keys(schedules), ...bySweep.keys()]);

  const sweeps = [];
  for (const name of names) {
    const schedule = schedules[name] || null;
    const last = bySweep.get(name) || null;
    sweeps.push({
      sweep: name,
      path: schedule?.path ?? null,
      schedule: schedule?.schedule ?? null,
      last_started_at: last?.started_at ?? null,
      last_finished_at: last?.finished_at ?? null,
      last_outcome: last ? last.outcome : "never_ran",
      last_error_code: last?.error_code || "",
      counts: last ? parseJsonbMaybe(last.counts) : {},
      staleness: sweepStaleness(last, schedule, now),
    });
  }
  sweeps.sort((a, b) => a.sweep.localeCompare(b.sweep));
  return sweeps;
}

/** The board's one call. `now` is a parameter (default `Date.now()`) so
 *  `evals/ops/run.mjs` can drive it at a fixed instant rather than racing a
 *  real clock. `deps` (WS-R40) exists for exactly one downstream seam today
 *  - `shareArrivalsThisWeek`'s `tableApplied` gate, `api/_room-surface.js`'s
 *  `isTableAppliedFor` restated - so an offline eval can drive migration
 *  102's applied/unapplied states without a real database round trip; the
 *  production caller (`api/ops.js`) passes none and gets the real gate. */
export async function opsOverview(db, now = Date.now(), deps = {}) {
  if (typeof db !== "function") throw new Error("ops_overview_database_required");
  const rooms = await db(
    `select room_id, slug, display_name, replica_id, agent_id, owner_user_id,
            free_monthly_messages, paid_monthly_messages, published_at, paused_at, created_at
       from vy_room
      order by created_at asc`,
    [],
  );
  const monthKey = monthKeyOf(now);
  const roomsOut = [];
  for (const room of rooms) {
    roomsOut.push(await roomOverview(db, room, monthKey, now));
  }
  return {
    generated_at: new Date(now).toISOString(),
    rooms: roomsOut,
    sweeps: await sweepsOverview(db, now),
    // WS-R25. "Minutes to first Room" and "where creators stop" -
    // `opsFunnel`'s own read, one extra call on the board's one endpoint.
    funnel: await opsFunnel(db, now),
    // WS-R47 (migration 106). The same number the studio's own "Invite a
    // creator" card computes, read here rather than re-derived so the two
    // can never disagree - `_funnel.js`'s own aggregate-only line.
    creator_invite_arrivals: await creatorInviteArrivalsThisWeek(db, now),
    // WS-R40 (migration 102). Growth from the share loop: how many arrivals
    // this week came in through a shared link, n>=5 floored the same way
    // the line immediately above already is.
    share_arrivals_this_week: await shareArrivalsThisWeek(db, now, deps),
    // WS-R29. "The owner sees the bill before Meta does" - the workstream
    // brief's own words.
    whatsapp: await whatsappSpendThisMonth(db, now),
    // WS-R30. The three Phase 2 numbers, one sentence.
    phase_gate: await phaseGate(db, now),
    // WS-R48. Suites sell themselves: two growth counts plus the "talk
    // first" apply-intent count, all rolling-7-day, none a follower.
    suites: {
      ...(await suitesFunnelThisWeek(db, now)),
      intent_applications_this_week: await suiteIntentApplicationsThisWeek(db, now),
    },
  };
}
