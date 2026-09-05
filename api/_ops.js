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
import { opsFunnel, creatorInviteArrivalsThisWeek, shareArrivalsThisWeek, tasteTurnsThisWeek, posterArrivalsThisWeek, shareKitArrivalsThisWeek, friendArrivalsThisWeek } from "./_funnel.js";
// WS-R75 (migration 119). `dormancyThisWeek` reads `vy_sweep_run`'s own
// `counts` history (the SAME "renewals" sweep row `sweepsOverview` above
// already reads for staleness), never `vy_room_follower` directly - it is
// not admitted to this file's own AGGREGATE_ONLY class in `evals/room-
// leak/run.mjs` because it has no reason to be: nothing here names either
// guarded table at all.
import { dormancyThisWeek } from "./_dormancy.js";
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
// WS-R42 (migration 104). "The money reconciles" - `reconciliationOverview`
// (api/_payments.js) owns the count, imported rather than re-derived, this
// file's own established pattern one import list up.
import { reconciliationOverview } from "./_payments.js";
// WS-R58 (migration 109). The incident ledger's own board read - reused
// rather than re-derived, this file's own established pattern one import
// list up.
import { INCIDENT_KINDS, OBSERVED_DOOR_COUNT } from "./_incidents.js";
// WS-R102. The one door name every optional-absent incident row is written
// under - imported rather than restated, so this file's own partition of
// today's self_check-kind doors can never drift from what api/_self-check.js
// actually writes. Safe direction: api/_self-check.js never imports this
// file (see that file's own header on why importing api/_ops.js back would
// make a cycle one file over from api/_incidents.js's own precedent).
// (declared in api/_incidents.js since the wave-sixteen merge: an import
// of api/_self-check.js from here closed a load-order cycle on
// INCIDENT_KINDS, `context/rejected.md#ops-importing-self-check-closed-a-load-order-cycle-on-the-incident-kinds`).
import { OPTIONAL_ABSENT_DOOR_PREFIX } from "./_incidents.js";
// WS-R88 (migration 125). The board's own "Last digest" read - the ONE
// direction this import is safe: `api/_operator-digest.js` never imports
// THIS file back (see that file's own header), so there is no
// `_ops.js -> _operator-digest.js -> _ops.js` cycle the way there would be
// if the digest's own write path (`sendOperatorDigest`/
// `sendTestOperatorDigest`) needed `opsOverview`/`opsOwnerIds`/`isOpsOwner`
// imported directly instead of injected.
import { lastOperatorDigest } from "./_operator-digest.js";
// WS-R98. `operatorTelegramConfigured` is a pure function of env, no db -
// the SAME "safe direction" this file's own header names for
// `lastOperatorDigest` one import up: `api/_operator-telegram.js` never
// imports THIS file back (see that file's own header).
import { operatorTelegramConfigured } from "./_operator-telegram.js";
import { randomUUID } from "node:crypto";
// WS-R116. The SAME leaf module api/_self-check.js imports for its own
// widened envPresence() - imported directly here rather than through
// api/_self-check.js, since this file may not import that one (the cycle
// this section's own comment above already names). Zero risk: this module
// imports nothing from api/ itself, so there is no cycle to be part of.
import { groupAbsentBySection } from "./_env-manifest.js";

const OPS_OWNER_ENV = "OPS_OWNER_USER_IDS";

// Exported (WS-R58) for any future caller that needs the same allowlist
// this board's own auth gate reads - `api/_incidents.js`'s own new-kind
// push step re-derives the identical three-step parse locally instead of
// importing it, since this file already imports `api/_incidents.js` for
// the board's own Incidents card (`incidentsOverview`, below) and an import
// the other way would make a cycle.
export function opsOwnerIds(env = process.env) {
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
        count(*) filter (where state = 'expired')::int as expired,
        -- WS-R125 (migration 130): state = 'paused' above already counts
        -- BOTH a customer's own UPI-app pause and a mandate's retry ladder
        -- giving up (api/_payments.js's pausedOrHalted header) - these
        -- two split that SAME bucket by the bank's own last word, never
        -- adding to it, so paused above stays the total an operator
        -- already knows how to read.
        count(*) filter (where mandate_state = 'paused')::int as mandate_paused,
        count(*) filter (where mandate_state = 'halted')::int as mandate_halted
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
      // WS-R125 (migration 130): the mandate's own split of `paused` above.
      mandate_paused: Number(subscriptions?.mandate_paused || 0),
      mandate_halted: Number(subscriptions?.mandate_halted || 0),
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

/**
 * WS-R103 (no migration). "A count on the ops board" (this workstream's own
 * law 2), platform-wide - `whatsappSpendThisMonth`'s own no-floor shape one
 * section up (a total of RECEIPTS issued, never a follower or a Room, so
 * there is nothing here a small bucket could identify). Rolling 7-day SUM
 * over the `receipt` sweep's own `vy_sweep_run` history, `dormancyThisWeek`'s
 * own precedent (api/_dormancy.js): the sweep's own summary is the real
 * weekly count, no new table required. Every receipt this line counts was,
 * by construction, issued LATE - `backfillReceipts`'s own header: the
 * webhook itself issues a receipt inline, in the same request, and never
 * through this sweep at all; a row only reaches `backfillReceipts` because
 * the inline issue never landed.
 *
 * Exported (WS-R103) - `dormancyThisWeek`'s own precedent (api/_dormancy.js,
 * imported and driven directly by `evals/room-dormancy/run.mjs`): this
 * board's own weekly-sum shape gets its own direct suite,
 * `evals/receipt-sweep/run.mjs`, rather than being reachable only through
 * `opsOverview`'s much larger fixture.
 */
export async function receiptsIssuedLateThisWeek(db, now) {
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const [row] = await db(
    `select coalesce(sum((counts->>'issued')::int), 0)::int as issued
       from vy_sweep_run
      where sweep = 'receipt' and started_at >= ($1)::timestamptz`,
    [since],
  );
  return { issued: Number(row?.issued || 0) };
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

/**
 * WS-R58 (migration 109). "Last 7 days by kind and door as counts" - the
 * workstream brief's own words. Two reads: the rollup itself (grouped,
 * summed across every `status` and every day in the window - the board
 * shows a shape, not a status-code table), and which kinds are NEW against
 * the 7 days before that window, for the card's own red badge. `kind` is
 * always one of `INCIDENT_KINDS` (migration 109's CHECK, mirrored in
 * `api/_incidents.js`), so this file never invents a label the reader has
 * not already seen defined.
 */
export async function incidentsOverview(db, now = Date.now()) {
  const byKindDoor = await db(
    `select kind, door, coalesce(sum(count), 0)::int as n
       from vy_incident
      where day >= (current_date - 6)
      group by kind, door
      order by kind, door`,
    [],
  );
  const recentKindRows = await db(
    `select distinct kind from vy_incident where day >= (current_date - 6)`,
    [],
  );
  const priorKindRows = await db(
    `select distinct kind from vy_incident
      where day >= (current_date - 13) and day < (current_date - 6)`,
    [],
  );
  const priorKinds = new Set(priorKindRows.map((r) => r.kind));
  const newKinds = [...new Set(recentKindRows.map((r) => r.kind))]
    .filter((k) => !priorKinds.has(k) && INCIDENT_KINDS.includes(k))
    .sort();
  return {
    by_kind_door: byKindDoor.map((r) => ({ kind: r.kind, door: r.door, count: Number(r.n) || 0 })),
    new_kinds: newKinds,
    // WS-R123, law 4: "the derived door count as its denominator". Both
    // halves are the SAME literal (`api/_incidents.js#OBSERVED_DOOR_COUNT`)
    // by construction - a completeness badge, not something this read
    // computes from the rows above (a door with zero incidents this week is
    // still wrapped, still observed; this number answers "is every door
    // watched", never "did every door fail").
    doors_observed: OBSERVED_DOOR_COUNT,
    doors_total: OBSERVED_DOOR_COUNT,
  };
}

// ── WS-R62 (migration 114): operator push subscriptions ────────────────────
//
// Closes the gap `context/decisions.md#ws-r58-operator-push-subscription-
// store-does-not-exist` names: `notifyNewIncidentKinds` (api/_incidents.js)
// has always been able to SEND a push, through the real `_push/webpush.js`
// `send()`, but had nobody real to send to. This section is that store's own
// reader/writer pair, the follower lane's `api/_room-push.js` restated for
// the owner lane - same endpoint/p256dh/auth validation, same
// upsert-by-conflict-key shape, narrowed to one column of identity
// (`owner_user_id`) instead of three (room/person/follower).
//
// LAW (workstream brief #2): a subscription row is written only for a
// bearer on `OPS_OWNER_USER_IDS` - decided in the INSERT's own WHERE clause,
// with the id list itself passed as a query PARAMETER, never by an `if` in
// this JS above the query. That is not decoration: it means a caller who
// reached `subscribeOperatorPush` with a non-operator id (a bug upstream in
// the door's own gate, a future caller that forgets to check) still cannot
// write a row - the SAME guarantee `evals/room-doors/run.mjs`'s class (e)
// checks for every other owner-bearer op, proven here with a NEGATIVE
// CONTROL that calls this function directly with an id NOT on the list and
// asserts zero rows result.
export class OpsPushError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "OpsPushError";
    this.code = code;
    this.status = status;
  }
}

const B64U_RE = /^[A-Za-z0-9_-]+$/;

function assertOperatorPushSubscription({ endpoint, p256dh, auth }) {
  const url = String(endpoint || "");
  if (!/^https:\/\//.test(url) || url.length > 2000) throw new OpsPushError("ops_push_endpoint_invalid", 400);
  if (!B64U_RE.test(String(p256dh || "")) || String(p256dh).length < 40) {
    throw new OpsPushError("ops_push_key_invalid", 400);
  }
  if (!B64U_RE.test(String(auth || "")) || String(auth).length < 10) {
    throw new OpsPushError("ops_push_key_invalid", 400);
  }
}

/** Whether a real push can ever be sent, and the public key a browser needs
 *  to open a subscription with it (VAPID public keys are not secret - this
 *  is the same "asked for here rather than a second copy" posture
 *  `AccountPage.tsx`'s own `pushKey` read documents for the follower lane).
 *  Pure function of env, no db - the board's own honest-empty-state law
 *  (workstream brief #4): "the card says honestly when VAPID is unset." */
export function operatorPushConfig(env = process.env) {
  const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
  const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
  const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
  const configured = Boolean(vapidPublic && vapidPrivate && vapidSubject);
  return { configured, vapid_public: configured ? vapidPublic : null };
}

/**
 * The one write. `ownerUserId` is the CALLING bearer's own already-verified
 * id (`api/ops.js`'s `requireUser`, never a body-supplied id - there is no
 * "another operator's id" input anywhere in this op's body, the same "no
 * cross-identity input" shape `room.js`'s "open"/"join" already establish
 * for class (e)'s own exclusions). `env` carries `OPS_OWNER_USER_IDS`; the
 * WHERE clause, not this function's control flow, is what refuses a bearer
 * who is not on it - see this section's own header.
 *
 * Upserts on `(owner_user_id, endpoint)` (the migration's own unique index):
 * an operator who re-enables notifications on the same browser/device
 * updates the SAME row (clearing `revoked_at`) rather than growing a
 * duplicate one request at a time would leave behind.
 */
export async function subscribeOperatorPush(db, ownerUserId, sub, env = process.env) {
  if (typeof db !== "function") throw new Error("ops_push_database_required");
  assertOperatorPushSubscription(sub || {});
  const ids = opsOwnerIds(env);
  const { endpoint, p256dh, auth } = sub;
  const rows = await db(
    `insert into vy_operator_push_subscription (id, owner_user_id, endpoint, p256dh, auth, created_at, revoked_at)
     select ($1)::uuid, ($2)::uuid, $3, $4, $5, now(), null
      where lower(($2)::text) = any(($6)::text[])
     on conflict (owner_user_id, endpoint) do update
        set p256dh = excluded.p256dh,
            auth = excluded.auth,
            revoked_at = null
     returning id`,
    [randomUUID(), ownerUserId, endpoint, p256dh, auth, ids],
  );
  return { subscribed: rows.length > 0 };
}

/** Revoke ONE of the calling bearer's own subscriptions, by the endpoint
 *  their own browser reports - never by a body-supplied `owner_user_id`
 *  (there is none in this op's body at all, the follower lane's
 *  `removeSubscription` own shape restated). Same WHERE-decides-not-JS-
 *  decides posture as `subscribeOperatorPush` above, belt and suspenders:
 *  even a bearer somehow past the door's own gate revokes nothing for an id
 *  the allowlist does not name. */
export async function revokeOperatorPush(db, ownerUserId, endpoint, env = process.env) {
  if (typeof db !== "function") throw new Error("ops_push_database_required");
  const ids = opsOwnerIds(env);
  const rows = await db(
    `update vy_operator_push_subscription
        set revoked_at = now()
      where owner_user_id = ($1)::uuid
        and endpoint = $2
        and revoked_at is null
        and lower(($1)::text) = any(($3)::text[])
      returning id`,
    [ownerUserId, String(endpoint || ""), ids],
  );
  return { revoked: rows.length > 0 };
}

/** The sweep's own read (workstream law #3) - `deps.operatorSubscriptionsFor`
 *  in `api/_incidents.js`'s `notifyNewIncidentKinds` resolves to THIS in
 *  production. Active (unrevoked) rows only, the migration's own partial
 *  index - `api/_room-push.js`'s `activeSubscriptionsFor` restated for the
 *  owner lane, ownerUserId never a request-supplied value here either (the
 *  sweep already resolved it from `OPS_OWNER_USER_IDS` itself). NEGATIVE
 *  CONTROL (workstream brief): a revoked row is never returned, so a 404/410
 *  a sweep already acted on cannot be sent to twice. */
export async function operatorPushSubscriptionsFor(db, ownerUserId) {
  if (typeof db !== "function") return [];
  return db(
    `select id, endpoint, p256dh, auth
       from vy_operator_push_subscription
      where owner_user_id = ($1)::uuid and revoked_at is null`,
    [String(ownerUserId)],
  );
}

/** Revoke on a 404/410 from the push service - `api/_room-push.js`'s
 *  `revokeSubscriptionById` restated, by `id` (the row a send just failed
 *  for), never by endpoint text a caller supplies. */
export async function revokeOperatorPushById(db, id) {
  if (typeof db !== "function") return;
  await db(`update vy_operator_push_subscription set revoked_at = now() where id = ($1)::uuid`, [String(id)]);
}

/**
 * WS-R76 (migration 120). "The ops board gains a Self-check line: last run,
 * checks passed, the names of the failing ones" — the workstream brief's
 * own words. `sweep` is `sweeps`'s own "self-check" row — the generic
 * `vy_sweep_run` heartbeat every cron already gets, `sweepsOverview`'s own
 * read one section up, never a second query here. `checked`/`passed`/
 * `failed` come from that row's own `counts` (WS-R76's own handler returns
 * them as plain numbers so `sanitizeCounts`, api/_sweep-run.js, keeps them
 * rather than dropping them the way it drops a string).
 *
 * The failing check NAMES do not live on that row at all — `sanitizeCounts`
 * collapses an array to its length by construction, the same content-free
 * digest every other sweep's summary already gets — they live in
 * `vy_incident` itself, one row per finding, `kind: "self_check"`,
 * `door` the check's own name (`api/_self-check.js`'s own
 * `recordSelfCheckIncidents`). Read HERE as today's rows only, never
 * `incidentsOverview`'s own 7-day rolling window one section up: "the
 * names of the failing ones" means THIS morning's run, not a week of
 * history a single stale finding would otherwise keep alive on this line
 * for six more days after it was already fixed.
 */
/**
 * WS-R102 widens this from "the failing checks' own names" to also
 * partition out today's OPTIONAL_ENV absences - the SAME query,
 * unchanged, since both shapes are written under the identical
 * `kind = 'self_check'` (api/_self-check.js's own `recordSelfCheckIncidents`/
 * `recordOptionalAbsentIncidents`, one file over) and differ only by
 * whether the door starts with `OPTIONAL_ABSENT_DOOR_PREFIX`. No second
 * round trip: a door is either a real failing check's own name or an
 * optional-absent encoding, never both, so one pass over the same rows
 * sorts every door into exactly one of the two lists this board shows.
 */
async function selfCheckTodayDoors(db) {
  const rows = await db(`select distinct door from vy_incident where day = current_date and kind = 'self_check' order by door`, []);
  const failing = [];
  const optionalAbsent = [];
  for (const row of rows) {
    const door = String(row.door || "");
    if (door.startsWith(OPTIONAL_ABSENT_DOOR_PREFIX)) optionalAbsent.push(door.slice(OPTIONAL_ABSENT_DOOR_PREFIX.length));
    else failing.push(door);
  }
  optionalAbsent.sort();
  return { failing, optionalAbsent };
}

/**
 * WS-R98. "The ops board's digest card shows both channels' last delivery"
 * (workstream law #3) - push's own half is `lastOperatorDigest`'s `sent_at`,
 * unchanged, from the `vy_operator_digest` ledger. Telegram's own half is
 * deliberately NOT a new table or a new column on that ledger (this
 * workstream's own brief: "No migration expected") - it is read off the
 * SAME already-fetched `sweeps` array `selfCheckOverview` above reads from,
 * one section up: the "operator-digest" sweep's own latest `vy_sweep_run`
 * row already carries a `telegramSent` count (`api/_operator-digest.js#
 * sendOperatorDigest`'s own summary, kept by `api/_sweep-run.js#
 * sanitizeCounts` because it is a plain number) - no second query.
 *
 * This is honestly a WEAKER guarantee than the push ledger's own row-per-day
 * history: `vy_sweep_run` keeps only the LATEST run per sweep, so if
 * yesterday's Telegram send succeeded and this morning's failed (config
 * pulled, bot blocked), this reads as "last delivery: never", not
 * "yesterday" - see `context/decisions.md#ws-r98-digest-telegram-last-
 * delivery-read-from-sweep-run-not-a-ledger` for the reversal condition
 * (build a real per-channel delivery ledger, migration 126, if that gap is
 * ever found to matter in practice).
 */
function digestTelegramOverview(sweeps, env) {
  const sweep = sweeps.find((s) => s.sweep === "operator-digest") || null;
  return {
    configured: operatorTelegramConfigured(env),
    last_run_at: sweep?.last_started_at ?? null,
    last_sent_count: Number(sweep?.counts?.telegramSent) || 0,
  };
}

/**
 * `todayDoors` is `selfCheckTodayDoors`'s own `{failing, optionalAbsent}`
 * shape, above. `optional_absent` (WS-R102) is exposed alongside
 * `failing_checks`, never merged into it: a name here is honestly "not set,
 * and that is fine" (workstream law 1), never a red badge the way a
 * `failing_checks` entry is.
 */
function selfCheckOverview(sweeps, todayDoors) {
  const sweep = sweeps.find((s) => s.sweep === "self-check") || null;
  return {
    last_started_at: sweep?.last_started_at ?? null,
    last_outcome: sweep ? sweep.last_outcome : "never_ran",
    staleness: sweep ? sweep.staleness : "unscheduled",
    checked: Number(sweep?.counts?.checked) || 0,
    passed: Number(sweep?.counts?.passed) || 0,
    failed: Number(sweep?.counts?.failed) || 0,
    failing_checks: todayDoors.failing,
    optional_absent: todayDoors.optionalAbsent,
    // WS-R116. The board's own "grouped by manifest section" card reads
    // this instead of re-deriving the grouping from the flat list above -
    // ONE reducer (api/_env-manifest.js), called from both here and
    // api/_self-check.js#runSelfCheck, never two independent groupings
    // that could silently disagree about which section a name belongs to.
    optional_absent_by_section: groupAbsentBySection(todayDoors.optionalAbsent),
  };
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
  // WS-R76: hoisted out of the return object below so `selfCheckOverview`
  // can read the SAME already-fetched `sweeps` array rather than this board
  // paying for a second `vy_sweep_run` round trip just to find one row in it.
  const sweeps = await sweepsOverview(db, now);
  return {
    generated_at: new Date(now).toISOString(),
    rooms: roomsOut,
    sweeps,
    // WS-R76 (migration 120). "Last run, checks passed, the names of the
    // failing ones" - derived from `sweeps` above plus today's own
    // `self_check`-kind incident rows, never a re-derivation of either.
    self_check: selfCheckOverview(sweeps, await selfCheckTodayDoors(db)),
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
    // WS-R53 (migration 110). A count of TURNS, never people - the taste has
    // no follower at all, so there is no floor here the way there is one
    // line up (`_funnel.js`'s own header on why).
    taste_turns_this_week: await tasteTurnsThisWeek(db, now, deps),
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
    // WS-R42. "The money reconciles" - a count of periods, never a Room or a
    // rupee figure, `whatsappSpendThisMonth`'s own aggregate-only shape one
    // section up. WS-R103 (no migration) adds `charges_without_receipt` to
    // this same object, threaded through via `deps` rather than a second call.
    reconciliation: await reconciliationOverview(db, now, deps),
    // WS-R58 (migration 109). "Make failure a row" - last 7 days by kind and
    // door, `none` an honest empty state, red only for a kind new since the
    // 7 days before that.
    incidents: await incidentsOverview(db, now),
    // WS-R62 (migration 114). Pure function of env, no db - whether a real
    // push can be sent at all, and the public key the board's own "Alerts
    // on this phone" control needs to open a subscription. Never the
    // private key.
    push: operatorPushConfig(deps.env || process.env),
    // WS-R78 (migration 121). Growth from the printed poster's QR: how many
    // arrivals this week came in through `?via=poster`, n>=5 floored the
    // same way `share_arrivals_this_week` already is.
    poster_arrivals_this_week: await posterArrivalsThisWeek(db, now, deps),
    // WS-R86 (migration 123). Growth from a follower's own "Bring a
    // friend" link: how many arrivals this week came in through
    // `?via=friend`, n>=5 floored the same way every other arrival line on
    // this board already is - `posterArrivalsThisWeek`'s own shape, one
    // `via` value over.
    friend_arrivals_this_week: await friendArrivalsThisWeek(db, now, deps),
    // WS-R75 (migration 119). Notices sent and followers forgotten this
    // week, both n>=5 floored - `share_arrivals_this_week`'s own shape,
    // restated for a count that COULD identify a person in a small bucket
    // (this workstream's own law 4).
    dormancy: await dormancyThisWeek(db, now, deps),
    // WS-R88 (migration 125). "Last digest" with its sent time - the board's
    // own read, `api/_operator-digest.js#lastOperatorDigest`'s own single
    // query, reused rather than re-derived. WS-R98 nests `telegram` inside
    // this same object - "the digest card shows both channels' last
    // delivery" (workstream law #3), `digestTelegramOverview`'s own header
    // one section up on why no new query is needed for it.
    digest: { ...(await lastOperatorDigest(db)), telegram: digestTelegramOverview(sweeps, deps.env || process.env) },
    // WS-R85 (migration 122). Growth from the share kit, broken down by
    // channel (WhatsApp / Instagram / YouTube / Telegram) rather than
    // lumped into one line - `share_arrivals_this_week`'s own shape, one
    // count per channel, each floored at n>=5 the same way.
    share_kit_arrivals_this_week: await shareKitArrivalsThisWeek(db, now, deps),
    // WS-R103 (no migration). The receipt backfill sweep's own weekly count -
    // "receipts issued late this week" (this workstream's own law 2), never
    // cached, `whatsappSpendThisMonth`'s own no-floor shape restated.
    receipts_issued_late_this_week: await receiptsIssuedLateThisWeek(db, now),
  };
}
