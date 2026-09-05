// WS-R21. The ops board's offline suite: `api/_ops.js` (overview + auth
// gate), `api/_sweep-run.js` (the heartbeat), `api/_sweep-schedule.js`
// (vercel.json's own schedule table, read not guessed).
//
//   node evals/ops/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres. Reuses
// `evals/room/fixtures.mjs`'s `fakeDb`/`freshState` and `evals/pulse/
// fixtures.mjs`'s `pulseDb` rather than re-deriving a third follower fixture
// (`dead-writers`'s sibling risk this repo names repeatedly: two fakes for
// the same tables silently drifting apart). This file only adds the tables
// those two do not already know about: `vy_room_follower_day` (day-level
// turns, room-cohorts's own convention), `vy_room_checkin`/`_delivery`,
// `vy_room_subscription`, `vy_payment_event`, `vy_replica_drift_report` and
// the new `vy_sweep_run` (migration 084).
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshState, fakeDb, ROOM_ID, REPLICA_ID, OWNER } from "../room/fixtures.mjs";
import { freshPulseState, pulseDb } from "../pulse/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threwAsync = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};

const {
  opsOverview,
  opsBoardConfigured,
  isOpsOwner,
  sweepStaleness,
  incidentsOverview,
  operatorPushConfig,
  subscribeOperatorPush,
  revokeOperatorPush,
  operatorPushSubscriptionsFor,
} = await import(pathToFileURL(join(REPO, "api/_ops.js")).href);
const { withSweepRun, sanitizeCounts } = await import(pathToFileURL(join(REPO, "api/_sweep-run.js")).href);
const { sweepSchedules, expectedIntervalMs, sweepNameFromPath } = await import(
  pathToFileURL(join(REPO, "api/_sweep-schedule.js")).href
);

// ═════════════════════════════════════════════════════════════════════════
// THE FIXTURE. One db function covering everything `opsOverview` and
// `withSweepRun` touch: the base Room fixture, Pulse's own reader, and the
// tables new to this migration.
// ═════════════════════════════════════════════════════════════════════════
const SECOND_ROOM_ID = "d0000000-0000-4000-8000-000000000002";
const SECOND_REPLICA_ID = "c1000000-0000-4000-8000-000000000002";

function opsState() {
  const state = freshPulseState(freshState());
  // A second, EMPTY Room — the honest-empty-states check (law 4): a Room
  // with zero followers, zero everything, must report real zeros, never
  // omit itself or fake a number.
  state.rooms.push({
    room_id: SECOND_ROOM_ID,
    slug: "quiet-room",
    replica_id: SECOND_REPLICA_ID,
    agent_id: "b1000000-0000-4000-8000-000000000002",
    owner_user_id: OWNER,
    display_name: "Quiet",
    free_monthly_messages: 20,
    paid_monthly_messages: 500,
    paid_monthly_voice_seconds: 1800,
    published_at: "2026-09-02T00:00:00.000Z",
    paused_at: null,
  });
  state.followerDays = [];
  state.checkins = [];
  state.checkinDeliveries = [];
  state.subscriptions = [];
  state.paymentEvents = [];
  state.driftReports = [];
  state.sweepRuns = [];
  // WS-R58 (migration 109). Rows are plain {day, kind, door, count} - `day`
  // a "YYYY-MM-DD" string, compared lexicographically against the SAME
  // anchor date §4's fixture already uses (2026-09-10) rather than the real
  // wall clock, `opsState`'s own header rule ("a test whose fixture month
  // depends on when it happens to run is a test that passes today and fails
  // on its own next October") restated for a day instead of a month.
  state.incidents = [];
  // The fixture's own "current_date" - §4's own fixed `now` (2026-09-10),
  // never the real wall clock. `incidentsOverview`'s SQL reads Postgres's
  // own `current_date`, which this offline fixture has no server for, so
  // the handlers below anchor on this field instead.
  state.today = "2026-09-10";
  return state;
}

function addDaysIso(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Layered on `pulseDb(state, fakeDb(state))`, `evals/room-leak/run.mjs`'s
 *  layer 5 precedent for combining the two — this only ADDS handlers for
 *  what neither of those already answers. Day/24h-window filtering is not
 *  reproduced here (that SQL semantics is already proven by `evals/room-
 *  cohorts/run.mjs` and `evals/payments/*`); this fixture exists to prove
 *  the OVERVIEW's own plumbing - the right numbers reach the right field
 *  names - not to re-derive every WHERE clause a second time. */
function opsDb(state) {
  const base = pulseDb(state, fakeDb(state));
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── the board's own room list ──────────────────────────────────────────
    if (has("order by created_at asc") && has("from vy_room") && !has("vy_room_")) {
      return state.rooms.map((r) => ({
        room_id: r.room_id,
        slug: r.slug,
        display_name: r.display_name,
        replica_id: r.replica_id,
        agent_id: r.agent_id,
        owner_user_id: r.owner_user_id,
        free_monthly_messages: r.free_monthly_messages,
        paid_monthly_messages: r.paid_monthly_messages,
        published_at: r.published_at,
        paused_at: r.paused_at,
        created_at: r.created_at ?? "2026-09-01T00:00:00.000Z",
      }));
    }

    // ── followers aggregate (AGGREGATE_ONLY - see api/_ops.js's header) ────
    if (has("count(*)::int as total,")) {
      const [roomId, monthKey, paidCeiling, freeCeiling] = p;
      const rows = state.followers.filter((f) => f.room_id === roomId);
      const total = rows.length;
      const paid = rows.filter((f) => f.tier === "paid").length;
      const joined7d = rows.filter((f) => Date.now() - new Date(f.joined_at).getTime() < 7 * 86_400_000).length;
      const atCap = rows.filter((f) => {
        if (f.month_key !== monthKey) return false;
        const ceiling = f.tier === "paid" ? Number(paidCeiling) : Number(freeCeiling);
        return Number(f.month_message_count) >= ceiling;
      }).length;
      const voiceSeconds = rows
        .filter((f) => f.voice_month_key === monthKey)
        .reduce((sum, f) => sum + Number(f.voice_seconds_month || 0), 0);
      return [{ total, paid, joined_7d: joined7d, at_cap: atCap, voice_seconds: voiceSeconds }];
    }

    // ── messages last 24h, from vy_room_follower_day ────────────────────────
    if (has("as last_24h")) {
      const [roomId] = p;
      const sum = (state.followerDays || [])
        .filter((d) => d.room_id === roomId)
        .reduce((s, d) => s + Number(d.turns || 0), 0);
      return [{ last_24h: sum }];
    }

    // ── active check-ins ─────────────────────────────────────────────────
    if (has("count(*)::int as active")) {
      const [roomId] = p;
      const n = (state.checkins || []).filter((c) => c.room_id === roomId && c.state === "active").length;
      return [{ active: n }];
    }

    // ── WS-R29: platform-wide WhatsApp spend this month ──────────────────
    if (has("from vy_room_checkin_delivery") && has("channel = 'whatsapp_template'")) {
      const [cutoffIso] = p;
      const n = (state.checkinDeliveries || []).filter(
        (d) => d.channel === "whatsapp_template" && d.state === "delivered"
          && (d.created_at == null || d.created_at >= cutoffIso),
      ).length;
      return [{ n }];
    }

    // ── deliveries, grouped by state ─────────────────────────────────────
    if (has("from vy_room_checkin_delivery") && has("group by state")) {
      const [roomId] = p;
      const bucket = new Map();
      for (const d of state.checkinDeliveries || []) {
        if (d.room_id !== roomId) continue;
        bucket.set(d.state, (bucket.get(d.state) || 0) + 1);
      }
      return [...bucket.entries()].map(([state_, n]) => ({ state: state_, n }));
    }

    // ── subscriptions by state ───────────────────────────────────────────
    if (has("as expired")) {
      const [roomId] = p;
      const rows = (state.subscriptions || []).filter((s) => s.room_id === roomId);
      const count = (st) => rows.filter((s) => s.state === st).length;
      return [{
        created: count("created"), authenticated: count("authenticated"), active: count("active"),
        paused: count("paused"), cancelled: count("cancelled"), expired: count("expired"),
      }];
    }

    // ── revenue this month ────────────────────────────────────────────────
    if (has("as this_month_inr")) {
      const [roomId] = p;
      const sum = (state.paymentEvents || [])
        .filter((e) => e.room_id === roomId && e.kind === "subscription.charged")
        .reduce((s, e) => s + Number(e.amount_inr || 0), 0);
      return [{ this_month_inr: sum }];
    }

    // ── latest drift report ──────────────────────────────────────────────
    if (has("from vy_replica_drift_report")) {
      const [replicaId, ownerUserId] = p;
      const rows = (state.driftReports || [])
        .filter((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)
        .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
      return rows.length ? [{ state: rows[0].state, computed_at: rows[0].computed_at }] : [];
    }

    // ── vy_sweep_run: the heartbeat itself ───────────────────────────────
    if (has("insert into vy_sweep_run")) {
      const [runId, sweep, startedAt] = params;
      state.sweepRuns.push({ run_id: runId, sweep, started_at: startedAt, finished_at: null, outcome: "running", counts: {}, error_code: "" });
      return [];
    }
    if (has("update vy_sweep_run")) {
      const [runId, outcome, counts, errorCode] = params;
      const row = state.sweepRuns.find((r) => r.run_id === runId);
      if (!row) return [];
      row.finished_at = new Date().toISOString();
      row.outcome = outcome;
      row.counts = counts; // stored as the raw string, mirroring Neon's ::jsonb round trip
      row.error_code = errorCode;
      return [];
    }
    if (has("distinct on (sweep)")) {
      const bySweep = new Map();
      for (const r of state.sweepRuns) {
        const prev = bySweep.get(r.sweep);
        if (!prev || r.started_at > prev.started_at) bySweep.set(r.sweep, r);
      }
      return [...bySweep.values()];
    }

    // ── WS-R58 (migration 109): vy_incident, api/_ops.js's `incidentsOverview` ──
    if (has("from vy_incident") && has("group by kind, door")) {
      const floor = addDaysIso(state.today, -6);
      const bucket = new Map();
      for (const r of state.incidents) {
        if (r.day < floor) continue;
        const key = `${r.kind} ${r.door}`;
        bucket.set(key, (bucket.get(key) || 0) + Number(r.count || 0));
      }
      return [...bucket.entries()]
        .map(([key, n]) => { const [kind, door] = key.split(" "); return { kind, door, n }; })
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.door.localeCompare(b.door));
    }
    if (has("select distinct kind from vy_incident where day >= (current_date - 6)")) {
      const floor = addDaysIso(state.today, -6);
      return [...new Set(state.incidents.filter((r) => r.day >= floor).map((r) => r.kind))].map((kind) => ({ kind }));
    }
    if (has("select distinct kind from vy_incident") && has("current_date - 13") && has("current_date - 6")) {
      const floor = addDaysIso(state.today, -13);
      const ceil = addDaysIso(state.today, -6);
      return [...new Set(state.incidents.filter((r) => r.day >= floor && r.day < ceil).map((r) => r.kind))]
        .map((kind) => ({ kind }));
    }
    // WS-R76 (migration 120): `api/_ops.js`'s own `selfCheckFailingToday` -
    // TODAY only, kind = 'self_check', never the 7-day window the branch
    // above reads for the general Incidents card.
    if (has("select distinct door from vy_incident") && has("day = current_date") && has("kind = 'self_check'")) {
      return [...new Set(state.incidents.filter((r) => r.day === state.today && r.kind === "self_check").map((r) => r.door))]
        .sort()
        .map((door) => ({ door }));
    }

    return base(sql, params);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// §1 — LAW 1: platform-operator only, 404 by name. Pure functions, no db.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: platform-operator allowlist ──");

ok("unconfigured: opsBoardConfigured is false with no env var set", !opsBoardConfigured({}));
ok("unconfigured: opsBoardConfigured is false with an empty string", !opsBoardConfigured({ OPS_OWNER_USER_IDS: "" }));
ok("configured: opsBoardConfigured is true once at least one id is set",
  opsBoardConfigured({ OPS_OWNER_USER_IDS: OWNER }));

const ENV = { OPS_OWNER_USER_IDS: `${OWNER}, 11111111-1111-4111-8111-111111111111` };
ok("the operator's own id (any case) is allowed", isOpsOwner(OWNER.toUpperCase(), ENV));
ok("a second listed id is allowed", isOpsOwner("11111111-1111-4111-8111-111111111111", ENV));
ok("NEGATIVE CONTROL (b): unset allowlist refuses EVERY id, including one that would otherwise match",
  !isOpsOwner(OWNER, {}));

// NEGATIVE CONTROL (a): a non-allowlisted user gets refused BEFORE any db
// read. Modelled on api/ops.js's own control flow rather than re-describing
// it: a db that throws if touched at all, run through the identical
// "configured? -> isOpsOwner? -> only then read" order the real handler
// uses, proves the ordering rather than asserting it.
{
  let dbTouched = false;
  const poisoned = async () => {
    dbTouched = true;
    throw new Error("db must not be read for a non-owner");
  };
  const STRANGER = "99999999-9999-4999-8999-999999999999";
  async function handleLikeOpsJs(userId, env) {
    if (!opsBoardConfigured(env)) return 404;
    if (!isOpsOwner(userId, env)) return 404;
    await opsOverview(poisoned, Date.now());
    return 200;
  }
  const status = await handleLikeOpsJs(STRANGER, ENV);
  ok("NEGATIVE CONTROL (a): a non-allowlisted user gets 404, and the db was never touched",
    status === 404 && !dbTouched);
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — the schedule table: read from vercel.json, not guessed.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: sweep schedules, read from vercel.json ──");

const vercelJson = JSON.parse(fs.readFileSync(join(REPO, "vercel.json"), "utf8"));
const schedules = sweepSchedules(vercelJson);

ok("every cron in vercel.json's own crons array resolves to a sweep name",
  vercelJson.crons.every((c) => sweepNameFromPath(c.path)));
ok("drift-watch is read as every 6 hours", schedules["drift-watch"]?.expected_interval_ms === 6 * 3_600_000);
ok("checkins is read as every 15 minutes", schedules["checkins"]?.expected_interval_ms === 15 * 60_000);
ok("pulse is read as weekly", schedules["pulse"]?.expected_interval_ms === 7 * 24 * 3_600_000);
ok("consolidate is read as hourly", schedules["consolidate"]?.expected_interval_ms === 3_600_000);
ok("replica-erasure is read as every 10 minutes", schedules["replica-erasure"]?.expected_interval_ms === 10 * 60_000);
ok("every one of this repo's crons resolves to a NON-NULL interval (no shape here goes unrecognised)",
  Object.values(schedules).filter((s) => Number.isFinite(s.expected_interval_ms)).length === vercelJson.crons.length);
ok("an unrecognised schedule shape (day-of-month) is null, never guessed",
  expectedIntervalMs("0 0 1 * *") === null);
ok("a malformed schedule string is null, never guessed", expectedIntervalMs("not a cron") === null);
// The renewals sweep (WS-R37) is daily at midnight. It was first written as
// `0 */24 * * *`, which Vercel refuses to deploy (an hour step must be 1..23);
// the parser reads the daily slot shape instead, and the invalid shape stays
// unrecognised rather than guessed.
ok("a daily slot (0 0 * * *) is read as 24 hours", expectedIntervalMs("0 0 * * *") === 24 * 3_600_000);
ok("a daily slot at a fixed hour (0 6 * * *) is read as 24 hours", expectedIntervalMs("0 6 * * *") === 24 * 3_600_000);
ok("renewals is read as daily from vercel.json", schedules["renewals"]?.expected_interval_ms === 24 * 3_600_000);
ok("every schedule in vercel.json has an hour step Vercel accepts (1..23)", (schedules && Object.values(schedules).every((s) => { const m = String(s.schedule).split(/\s+/)[1].match(/^\*\/(\d+)$/); return !m || (Number(m[1]) >= 1 && Number(m[1]) <= 23); })));

// ── staleness math ──────────────────────────────────────────────────────
const NOW = Date.parse("2026-09-10T00:00:00Z");
const sixHourSchedule = { expected_interval_ms: 6 * 3_600_000 };
ok("staleness: a sweep that ran 1 hour ago against a 6h schedule is fresh",
  sweepStaleness({ started_at: new Date(NOW - 3_600_000).toISOString() }, sixHourSchedule, NOW) === "fresh");
ok("staleness: a sweep that ran 13 hours ago against a 6h schedule (>2x) is stale",
  sweepStaleness({ started_at: new Date(NOW - 13 * 3_600_000).toISOString() }, sixHourSchedule, NOW) === "stale");
ok("staleness: exactly 2x the interval is still fresh (the boundary is exclusive)",
  sweepStaleness({ started_at: new Date(NOW - 12 * 3_600_000).toISOString() }, sixHourSchedule, NOW) === "fresh");
ok("staleness: no row at all, but a schedule exists, is 'never_ran' - not 'ok', law 4",
  sweepStaleness(null, sixHourSchedule, NOW) === "never_ran");
ok("staleness: no row and no schedule is 'unscheduled'", sweepStaleness(null, null, NOW) === "unscheduled");
ok("staleness: a row exists but the schedule is unrecognised is 'unknown_schedule', never guessed",
  sweepStaleness({ started_at: new Date(NOW).toISOString() }, { expected_interval_ms: null }, NOW) === "unknown_schedule");

// ═════════════════════════════════════════════════════════════════════════
// §3 — withSweepRun: the heartbeat, and its content-free guarantee.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: withSweepRun (the heartbeat) ──");

{
  const state = opsState();
  const db = opsDb(state);

  const summary = await withSweepRun(db, "drift-watch", async () => ({ checked: 3, written: 2, alerted: 0, errors: 0 }));
  ok("withSweepRun returns the wrapped function's value UNCHANGED",
    summary.checked === 3 && summary.written === 2);
  ok("a successful run writes exactly one vy_sweep_run row", state.sweepRuns.length === 1);
  const row = state.sweepRuns[0];
  ok("the row's outcome is 'ok' (no errors reported)", row.outcome === "ok");
  ok("the row carries finished_at", Boolean(row.finished_at));
  const counts = JSON.parse(row.counts);
  ok("the row's counts match the sanitized digest", counts.checked === 3 && counts.written === 2);
}

// A summary carrying `errors > 0` (this repo's own `runPulseSweep`/
// `runDriftWatchSweep` shape) classifies as 'partial', never 'ok' - a
// partially-failed sweep must never read as healthy on the board.
{
  const state = opsState();
  const db = opsDb(state);
  await withSweepRun(db, "pulse", async () => ({ checked: 4, computed: 2, errors: 2 }));
  ok("a summary with errors > 0 writes outcome 'partial'", state.sweepRuns[0].outcome === "partial");
}
{
  const state = opsState();
  const db = opsDb(state);
  await withSweepRun(db, "consolidate", async () => ({ halted: true, processed: 1 }));
  ok("a summary with halted:true writes outcome 'partial'", state.sweepRuns[0].outcome === "partial");
}

// CONTENT-FREE, PROVEN NOT ASSUMED: a summary carrying a string field (this
// repo's own sweeps do - `error_details: [{room_id, message}]`) must never
// land that string in `counts`. An array collapses to its length.
{
  const state = opsState();
  const db = opsDb(state);
  await withSweepRun(db, "channel-ingest", async () => ({
    checked: 1,
    room_id: "d0000000-0000-4000-8000-000000000009", // a real-looking id, on purpose
    note: "processed for Anjali's room",              // a real-looking name, on purpose
    error_details: [{ room_id: "x", message: "a follower's own words would go here" }],
  }));
  const written = JSON.stringify(state.sweepRuns[0].counts);
  ok("a string field on the summary never reaches the written row",
    !written.includes("Anjali") && !written.includes("d0000000-0000-4000-8000-000000000009"));
  ok("a follower's words inside a nested array never reach the written row",
    !written.includes("follower's own words"));
  ok("the array DOES survive, as its length only", JSON.parse(state.sweepRuns[0].counts).error_details === 1);
  ok("sanitizeCounts itself drops a bare string field, direct unit check",
    sanitizeCounts({ ok: true, name: "a person's name" }).name === undefined);
}

// NEGATIVE CONTROL (d): a sweep that THROWS still writes finished_at with
// outcome 'failed' - proven by making the wrapped function throw, not by
// reading the implementation.
{
  const state = opsState();
  const db = opsDb(state);
  let threw = false;
  try {
    await withSweepRun(db, "replica-liveness", async () => {
      throw new Error("verifier_unreachable");
    });
  } catch (e) {
    threw = true;
    ok("NEGATIVE CONTROL (d): the original error is rethrown, never swallowed",
      e.message === "verifier_unreachable");
  }
  ok("NEGATIVE CONTROL (d): withSweepRun's own try/catch actually ran (the throw was not silently absorbed higher up)",
    threw);
  ok("NEGATIVE CONTROL (d): the row was still written", state.sweepRuns.length === 1);
  const row = state.sweepRuns[0];
  ok("NEGATIVE CONTROL (d): outcome is 'failed'", row.outcome === "failed");
  ok("NEGATIVE CONTROL (d): finished_at is set (not left at null/'running' forever)", Boolean(row.finished_at));
  // errorCodeOf prefers err.code/err.error_code/err.name, falling back to
  // "sweep_failed" only when none exist - a plain `new Error(...)` carries
  // `.name === "Error"`, which IS the short code here, not the raw message.
  ok("NEGATIVE CONTROL (d): error_code is a short code (err.name), never the raw message text",
    row.error_code === "Error" && row.error_code !== "verifier_unreachable");
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — opsOverview: honest counts, honest empty states, no follower content.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: opsOverview (real counts, honest empty states) ──");

{
  const state = opsState();
  // Three followers in the primary Room: two free (one at cap, one not),
  // one paid, seeded directly (fixture precedent: evals/room-leak/run.mjs's
  // own N-follower seeding does the same for the same reason - predictable
  // ids for token/number assertions). `monthKey` matches the FIXED `now`
  // passed to `opsOverview` below (2026-09-10), never the real wall clock -
  // a test whose fixture month depends on when it happens to run is a test
  // that passes today and fails on its own next October.
  const monthKey = "2026-09";
  state.followers.push(
    { follower_id: "f1", room_id: ROOM_ID, person_id: "p1", agent_id: "a1", tier: "free",
      month_key: monthKey, month_message_count: 20, joined_at: new Date().toISOString(),
      voice_seconds_month: 0, voice_month_key: "" },
    { follower_id: "f2", room_id: ROOM_ID, person_id: "p2", agent_id: "a1", tier: "free",
      month_key: monthKey, month_message_count: 3, joined_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      voice_seconds_month: 0, voice_month_key: "" },
    { follower_id: "f3", room_id: ROOM_ID, person_id: "p3", agent_id: "a1", tier: "paid",
      month_key: monthKey, month_message_count: 40, joined_at: new Date().toISOString(),
      voice_seconds_month: 300, voice_month_key: monthKey },
  );
  state.followerDays.push({ room_id: ROOM_ID, person_id: "p1", day: "2026-09-10", turns: 5 });
  state.checkins.push({ room_id: ROOM_ID, state: "active" }, { room_id: ROOM_ID, state: "stopped" });
  state.checkinDeliveries.push(
    { room_id: ROOM_ID, state: "delivered" }, { room_id: ROOM_ID, state: "delivered" },
    { room_id: ROOM_ID, state: "skipped_free_tier" },
    // WS-R29: three delivered WhatsApp templates this month, across BOTH
    // rooms (the query is platform-wide, never `where room_id = ...` -
    // seeded on the SECOND room too, deliberately, so the ordinary
    // per-room `deliveries_last_24h` assertions below stay untouched by a
    // query that does not scope by room at all). One delivered BEFORE this
    // month (must not count), one not_configured (must not count - only
    // 'delivered' is a real send).
    { room_id: SECOND_ROOM_ID, channel: "whatsapp_template", state: "delivered", created_at: "2026-09-05T00:00:00Z" },
    { room_id: SECOND_ROOM_ID, channel: "whatsapp_template", state: "delivered", created_at: "2026-09-08T00:00:00Z" },
    { room_id: SECOND_ROOM_ID, channel: "whatsapp_template", state: "delivered", created_at: "2026-09-09T00:00:00Z" },
    { room_id: SECOND_ROOM_ID, channel: "whatsapp_template", state: "delivered", created_at: "2026-08-20T00:00:00Z" },
    { room_id: SECOND_ROOM_ID, channel: "whatsapp_template", state: "not_configured", created_at: "2026-09-06T00:00:00Z" },
  );
  state.subscriptions.push({ room_id: ROOM_ID, state: "active" }, { room_id: ROOM_ID, state: "cancelled" });
  state.paymentEvents.push(
    { room_id: ROOM_ID, kind: "subscription.charged", amount_inr: 499 },
    { room_id: ROOM_ID, kind: "subscription.charged", amount_inr: 499 },
    { room_id: ROOM_ID, kind: "payment.failed", amount_inr: 0 },
  );
  state.driftReports.push({ replica_id: REPLICA_ID, owner_user_id: OWNER, state: "steady", computed_at: "2026-09-09T00:00:00Z" });
  // Two heartbeat rows, so the sweeps strip has something to read.
  state.sweepRuns.push(
    { run_id: "r1", sweep: "drift-watch", started_at: "2026-09-10T10:00:00Z", finished_at: "2026-09-10T10:00:02Z", outcome: "ok", counts: "{}", error_code: "" },
    { run_id: "r2", sweep: "checkins", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z", outcome: "ok", counts: "{}", error_code: "" },
  );

  const db = opsDb(state);
  // WS-R40: migration 102 is not part of this fixture's schema, so the gate
  // is driven explicitly rather than left to the real `tableApplied` (which
  // would otherwise attempt one real, if fast-failing, network round trip
  // per call in this offline suite - `evals/phase-gate/run.mjs`'s own
  // precedent for the identical seam).
  const overview = await opsOverview(db, Date.parse("2026-09-10T12:00:00Z"), {
    tableApplied: async () => false,
  });

  ok("both Rooms are present", overview.rooms.length === 2);
  const primary = overview.rooms.find((r) => r.room_id === ROOM_ID);
  const quiet = overview.rooms.find((r) => r.room_id === SECOND_ROOM_ID);

  ok("followers_total is the real count", primary.followers_total === 3);
  ok("followers_paid is the real count", primary.followers_paid === 1);
  ok("at_cap_this_month counts the free follower at the 20-message ceiling, not the paid one",
    primary.at_cap_this_month === 1);
  ok("voice_seconds_this_month sums only THIS month's rows", primary.voice_seconds_this_month === 300);
  ok("messages_last_24h reflects the seeded day row", primary.messages_last_24h === 5);
  ok("active_check_ins counts only the active row", primary.active_check_ins === 1);
  ok("deliveries_last_24h is grouped by state, real counts",
    primary.deliveries_last_24h.delivered === 2 && primary.deliveries_last_24h.skipped_free_tier === 1);
  ok("subscriptions is a full state breakdown, not only active",
    primary.subscriptions.active === 1 && primary.subscriptions.cancelled === 1 && primary.subscriptions.created === 0);
  ok("revenue_this_month_inr sums only subscription.charged events", primary.revenue_this_month_inr === 998);
  ok("drift_state reflects the latest report", primary.drift_state === "steady");

  ok("LAW 4, honest empty state: the second Room reports REAL zeros, not omitted",
    quiet.followers_total === 0 && quiet.followers_paid === 0 && quiet.revenue_this_month_inr === 0);
  ok("LAW 4: an empty Room's drift_state says so honestly rather than a fake status",
    quiet.drift_state === "no_report");

  ok("no follower id, thread title or message ever appears anywhere in the overview (JSON-wide scan)",
    !JSON.stringify(overview).match(/\bp1\b|\bp2\b|\bp3\b/));

  ok("sweeps: drift-watch's latest run is fresh (2h ago against a 6h schedule)",
    overview.sweeps.find((s) => s.sweep === "drift-watch").staleness === "fresh");
  ok("sweeps: checkins' latest run is from January - stale against a 15-minute schedule",
    overview.sweeps.find((s) => s.sweep === "checkins").staleness === "stale");
  ok("sweeps: pulse has never run at all and reports 'never_ran', not 'ok' - law 4 again",
    overview.sweeps.find((s) => s.sweep === "pulse").last_outcome === "never_ran" &&
    overview.sweeps.find((s) => s.sweep === "pulse").staleness === "never_ran");
  ok("every one of this repo's crons appears in the sweeps strip",
    overview.sweeps.length === vercelJson.crons.length);

  // WS-R29: platform-wide, THIS MONTH only, delivered only, never
  // not_configured/failed/skipped, never grouped by room (it is the
  // owner's own bill across every Room).
  ok("whatsapp.template_sends_this_month counts only delivered rows in the current month, across BOTH rooms",
    overview.whatsapp.template_sends_this_month === 3, JSON.stringify(overview.whatsapp));
  ok("whatsapp.cost_this_month_inr is the count times the named unit cost constant",
    overview.whatsapp.cost_this_month_inr === 0.33, JSON.stringify(overview.whatsapp));

  // WS-R40 (migration 102): this fixture's schema does not carry
  // vy_room_arrival, and `tableApplied` was forced false above, so the
  // board's own line renders the honest "not applied yet" shape rather than
  // a query the fixture db has no table to answer.
  ok("share_arrivals_this_week is the honest not-enough-data shape when migration 102 is unapplied",
    overview.share_arrivals_this_week.n === null && overview.share_arrivals_this_week.below_floor === true,
    JSON.stringify(overview.share_arrivals_this_week));

  // WS-R78 (migration 121): the identical honest-empty-state posture, one
  // `via` value over - `posterArrivalsThisWeek` is gated on the SAME
  // `vy_room_arrival` table (migration 102), which this fixture also does
  // not carry.
  ok("poster_arrivals_this_week is the honest not-enough-data shape when migration 102 is unapplied",
    overview.poster_arrivals_this_week.n === null && overview.poster_arrivals_this_week.below_floor === true,
    JSON.stringify(overview.poster_arrivals_this_week));

  // WS-R58 (migration 109): no incident has been seeded in this fixture -
  // law 3's own "none" honest empty state, not an omitted field.
  ok("LAW 3, honest empty state: no incidents seeded means an empty by_kind_door and no new kinds",
    Array.isArray(overview.incidents.by_kind_door) && overview.incidents.by_kind_door.length === 0 &&
    Array.isArray(overview.incidents.new_kinds) && overview.incidents.new_kinds.length === 0,
    JSON.stringify(overview.incidents));

  // WS-R62 (migration 114): unset VAPID in this offline environment - the
  // board's own honest-empty-state law restated for the push card, never a
  // private key on the wire.
  ok("push.configured is honestly false when VAPID is unset in this environment",
    overview.push.configured === false && overview.push.vapid_public === null,
    JSON.stringify(overview.push));
}

// ═════════════════════════════════════════════════════════════════════════
// §5b — WS-R58 (migration 109). The Incidents card: counts by kind and
// door over the last 7 days, and "new since last week" against the 7 days
// before that.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5b: incidentsOverview (the Incidents card) ──");

{
  const state = opsState();
  // `state.today` is 2026-09-10 (opsState's own fixed anchor). Three shapes:
  //   - a kind seen only in the last 7 days (2 rows, 2 doors) -> counted,
  //     flagged new;
  //   - a kind seen BOTH in the last 7 days and the 7 days before that ->
  //     counted, NOT flagged new (it is not new, it is ongoing);
  //   - a kind seen ONLY more than 13 days ago -> outside the window
  //     entirely, must not appear at all.
  state.incidents.push(
    { day: "2026-09-09", kind: "door_5xx", door: "room.js", count: 3 },
    { day: "2026-09-08", kind: "door_5xx", door: "payments.js", count: 1 },
    { day: "2026-09-02", kind: "provider_telegram", door: "_checkins.js", count: 2 }, // 8 days before "today" - prior window
    { day: "2026-09-07", kind: "provider_telegram", door: "_checkins.js", count: 5 }, // within the last 7 days too
    { day: "2026-08-20", kind: "provider_payments", door: "_payments.js", count: 9 }, // >13 days ago - out of range entirely
  );

  const card = await incidentsOverview(opsDb(state), Date.parse(`${state.today}T12:00:00Z`));

  const byKey = Object.fromEntries(card.by_kind_door.map((r) => [`${r.kind}:${r.door}`, r.count]));
  ok("door_5xx/room.js is counted (within the 7-day window)", byKey["door_5xx:room.js"] === 3);
  ok("door_5xx/payments.js is counted separately from room.js - grouped by (kind, door), not kind alone",
    byKey["door_5xx:payments.js"] === 1);
  ok("provider_telegram/_checkins.js counts only the row inside the last-7-day window (the 2026-09-02 row is 8 days back, outside it)",
    byKey["provider_telegram:_checkins.js"] === 5);
  ok("a row more than 13 days old never appears in the card at all",
    !("provider_payments:_payments.js" in byKey));

  ok("door_5xx is flagged new (nothing in the 7 days before this window)", card.new_kinds.includes("door_5xx"));
  ok("provider_telegram is NOT flagged new - it was already present in the prior 7-day window",
    !card.new_kinds.includes("provider_telegram"));
  ok("provider_payments never appears in new_kinds either - it is outside the window entirely",
    !card.new_kinds.includes("provider_payments"));
}

// ═════════════════════════════════════════════════════════════════════════
// §5b2 — WS-R76 (migration 120). "Last run, checks passed, the names of
// the failing ones" - api/_ops.js's own `self_check` field, derived from
// the SAME `sweeps`/today's-own incidents this board already reads, never
// a third query.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5b2: self_check (WS-R76) ──");
{
  const state = opsState();
  state.sweepRuns.push({
    run_id: "sc1", sweep: "self-check",
    started_at: `${state.today}T02:30:00Z`, finished_at: `${state.today}T02:30:04Z`,
    outcome: "partial", counts: { checked: 20, passed: 18, failed: 2 }, error_code: "",
  });
  state.incidents.push(
    { day: state.today, kind: "self_check", door: "env: NEON_URL missing", count: 1 },
    { day: state.today, kind: "self_check", door: "sweep checkins: stale", count: 1 },
    // A stray OTHER kind, and a self_check row from a PRIOR day - neither
    // may leak into this board's own "today only" reading.
    { day: state.today, kind: "door_5xx", door: "room.js", count: 4 },
    { day: "2026-09-03", kind: "self_check", door: "db: select_1_failed", count: 1 },
  );
  const overview = await opsOverview(opsDb(state), Date.parse(`${state.today}T12:00:00Z`), { tableApplied: async () => false });
  const sc = overview.self_check;
  ok("self_check.last_started_at reflects the seeded self-check sweep row", sc.last_started_at === `${state.today}T02:30:00Z`);
  ok("self_check.last_outcome reflects that row's own outcome", sc.last_outcome === "partial");
  ok("self_check.checked/passed/failed come from that row's own counts, as plain numbers",
    sc.checked === 20 && sc.passed === 18 && sc.failed === 2);
  ok("self_check.failing_checks lists TODAY's own self_check-kind doors only, by name",
    [...sc.failing_checks].sort().join("|") === ["env: NEON_URL missing", "sweep checkins: stale"].sort().join("|"));
  ok("self_check.failing_checks never leaks a door_5xx-kind row seeded the same day", !sc.failing_checks.includes("room.js"));
  ok("self_check.failing_checks never leaks a self_check row from a PRIOR day",
    !sc.failing_checks.includes("db: select_1_failed"));
}
{
  // NEGATIVE CONTROL / honest empty state: no self-check has ever run in
  // this fixture at all - law 3's own "honest states everywhere" restated
  // for this card.
  const state = opsState();
  const overview = await opsOverview(opsDb(state), Date.parse(`${state.today}T12:00:00Z`), { tableApplied: async () => false });
  const sc = overview.self_check;
  ok("self_check with no run ever reports never_ran, not a fabricated ok",
    sc.last_outcome === "never_ran" && sc.last_started_at === null);
  ok("self_check with no run ever reports zero checked/passed/failed, never omitted fields",
    sc.checked === 0 && sc.passed === 0 && sc.failed === 0);
  ok("self_check with no failing rows reports an empty list, not omitted", Array.isArray(sc.failing_checks) && sc.failing_checks.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// §5c — WS-R62 (migration 114). `operatorPushConfig` (pure, no db) and the
// subscribe/revoke/read functions against a small dedicated fake
// `vy_operator_push_subscription` table. `evals/room-doors/run.mjs`'s own
// §17b attacks these same functions as class (e) (a non-operator bearer
// refused, decided by the SQL's own WHERE); this section proves the
// ordinary, well-behaved shape - `evals/room-leak/run.mjs`'s own division
// of labour between "does the boundary hold under attack" and "does the
// happy path work at all" restated one file over.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5c: operator push subscriptions (WS-R62) ──");
{
  ok("operatorPushConfig: unset VAPID reports honestly unconfigured, no public key",
    operatorPushConfig({}).configured === false && operatorPushConfig({}).vapid_public === null);
  const configured = operatorPushConfig({
    ROOM_PUSH_VAPID_PUBLIC: "pub-key", ROOM_PUSH_VAPID_PRIVATE: "priv-key", ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.test",
  });
  ok("operatorPushConfig: all three set reports configured, WITH the public key",
    configured.configured === true && configured.vapid_public === "pub-key");
  ok("operatorPushConfig: the PRIVATE key never appears on the returned shape",
    !JSON.stringify(configured).includes("priv-key"));
}
{
  const OPERATOR = "11111111-1111-4111-8111-111111111111";
  const ENV = { OPS_OWNER_USER_IDS: OPERATOR };
  const SUB = { endpoint: "https://push.example.test/ops-device", p256dh: "B".repeat(50), auth: "A".repeat(20) };

  function pushState() { return { rows: [] }; }
  function pushDb(state) {
    return async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("insert into vy_operator_push_subscription")) {
        const [id, ownerUserId, endpoint, p256dh, auth, ids] = params;
        if (!ids.map((x) => String(x).toLowerCase()).includes(String(ownerUserId).toLowerCase())) return [];
        let row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint);
        if (row) { row.p256dh = p256dh; row.auth = auth; row.revoked_at = null; }
        else { row = { id, owner_user_id: ownerUserId, endpoint, p256dh, auth, revoked_at: null }; state.rows.push(row); }
        return [{ id: row.id }];
      }
      if (has("update vy_operator_push_subscription") && has("endpoint = $2")) {
        const [ownerUserId, endpoint, ids] = params;
        if (!ids.map((x) => String(x).toLowerCase()).includes(String(ownerUserId).toLowerCase())) return [];
        const row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint && !r.revoked_at);
        if (!row) return [];
        row.revoked_at = "revoked";
        return [{ id: row.id }];
      }
      if (has("select id, endpoint, p256dh, auth") && has("from vy_operator_push_subscription")) {
        const [ownerUserId] = params;
        return state.rows.filter((r) => r.owner_user_id === ownerUserId && !r.revoked_at)
          .map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
      }
      return [];
    };
  }

  const state = pushState();
  const db = pushDb(state);
  const subscribed = await subscribeOperatorPush(db, OPERATOR, SUB, ENV);
  ok("subscribeOperatorPush: a valid subscription from the real operator succeeds", subscribed.subscribed === true);

  const resubscribed = await subscribeOperatorPush(db, OPERATOR, SUB, ENV);
  ok("subscribeOperatorPush: re-subscribing the SAME endpoint upserts, never a second row",
    resubscribed.subscribed === true && state.rows.length === 1);

  const active = await operatorPushSubscriptionsFor(db, OPERATOR);
  ok("operatorPushSubscriptionsFor: the operator's own active subscription is readable",
    active.length === 1 && active[0].endpoint === SUB.endpoint);

  const revoked = await revokeOperatorPush(db, OPERATOR, SUB.endpoint, ENV);
  ok("revokeOperatorPush: the real operator's own revoke succeeds", revoked.revoked === true);

  const afterRevoke = await operatorPushSubscriptionsFor(db, OPERATOR);
  ok("operatorPushSubscriptionsFor: a revoked row is no longer returned", afterRevoke.length === 0);

  // NEGATIVE CONTROL: assertOperatorPushSubscription's own input validation
  // (subscribeOperatorPush throws BEFORE any SQL runs for a malformed body).
  const badEndpoint = await threwAsync(() => subscribeOperatorPush(db, OPERATOR, { ...SUB, endpoint: "http://not-https.example.test" }, ENV));
  ok("NEGATIVE CONTROL: a non-https endpoint is refused before any SQL runs", badEndpoint?.code === "ops_push_endpoint_invalid");
  const badKey = await threwAsync(() => subscribeOperatorPush(db, OPERATOR, { ...SUB, p256dh: "short" }, ENV));
  ok("NEGATIVE CONTROL: a too-short p256dh key is refused before any SQL runs", badKey?.code === "ops_push_key_invalid");
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — NEGATIVE CONTROL (c): a select list that adds a follower text column
// fails the SAME aggregate-only parser evals/room-leak/run.mjs runs.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: the aggregate-only parser catches a leaking select list ──");

// The identical check evals/room-leak/run.mjs's §1c runs (copied, not
// imported - that file has no exported entry point for it, by design: the
// check is meant to run over the WHOLE api/ directory, not be called a la
// carte). Read the REAL api/_ops.js source, not retyped, so a change to the
// shipping SQL is what this test sees.
function aggregateOnlyVerdict(statementText) {
  const selectList = (statementText.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
  const items = [];
  let depth = 0, cur = "";
  for (const ch of selectList) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum)\s*\(/i.test(c));
  const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
  return { aggregateOnly, touchesPerson, leaks: !aggregateOnly || touchesPerson };
}

const opsSrc = fs.readFileSync(join(REPO, "api/_ops.js"), "utf8");
const followersStmtMatch = opsSrc.match(/`select\s+count\(\*\)::int as total,[\s\S]*?\sfrom vy_room_follower\s*\n\s*where room_id[\s\S]*?`/);
ok("the real followers statement is found in api/_ops.js (not moved/renamed)", Boolean(followersStmtMatch));
const realStmt = followersStmtMatch ? followersStmtMatch[0] : "";
const realVerdict = aggregateOnlyVerdict(realStmt);
ok("the REAL shipping statement passes the aggregate-only parser (every item is count()/sum())",
  realVerdict.aggregateOnly && !realVerdict.touchesPerson);

// NEGATIVE CONTROL (c): a copy of that exact statement with a follower text
// column appended to the select list.
const leakingStmt = realStmt.replace(
  "select\n        count(*)::int as total,",
  "select\n        person_id,\n        count(*)::int as total,",
);
ok("the mutation actually changed the text (the control is not vacuous)", leakingStmt !== realStmt);
const leakingVerdict = aggregateOnlyVerdict(leakingStmt);
ok("NEGATIVE CONTROL (c): a select list with a bare follower column (person_id) FAILS the aggregate-only parser",
  leakingVerdict.leaks);

// A second shape of the same control: appending a thread title instead of
// re-adding person_id, so the control does not rely on one single keyword.
const leakingStmt2 = realStmt.replace(
  "select\n        count(*)::int as total,",
  "select\n        message_text,\n        count(*)::int as total,",
);
ok("NEGATIVE CONTROL (c), second shape: a select list with message_text also FAILS",
  aggregateOnlyVerdict(leakingStmt2).leaks);

// ═════════════════════════════════════════════════════════════════════════
// §6 — WS-R57. Every named route class in vercel.json carries a headers[]
// entry, statically, so this offline suite catches a route class that loses
// its header entry (or a `vercel.json` edit that renames a `source` without
// updating its match) without needing Chromium at all -- that browser-level
// proof is `scripts/check-headers.mjs`'s own job; this is the cheap static
// half that runs on every `eval suite` invocation, not only when someone
// remembers to run the header gate by name. Scoped to exactly the six page
// targets plus the API class that WS-R57's brief named -- not an unscoped
// audit of every path vercel.json ever rewrites (`/privacy`, `/embed.js`,
// `/sitemap.xml`...), which is out of this workstream's stated scope; see
// `scripts/check-headers.mjs`'s own header for why that line was drawn here.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: every WS-R57 route class still has a vercel.json headers[] entry ──");
{
  const vercelConfig = JSON.parse(fs.readFileSync(join(REPO, "vercel.json"), "utf8"));
  const headerRules = vercelConfig.headers || [];
  const ROUTE_CLASSES = [
    { source: "/r/:slug", required: ["Content-Security-Policy", "Permissions-Policy"] },
    { source: "/studio", required: ["Content-Security-Policy", "Permissions-Policy"] },
    { source: "/", required: ["Content-Security-Policy"] },
    { source: "/vyakti", required: ["Content-Security-Policy"] },
    { source: "/suites", required: ["Content-Security-Policy"] },
    { source: "/creators", required: ["Content-Security-Policy"] },
    { source: "/api/(.*)", required: ["X-Content-Type-Options", "Cache-Control"] },
  ];
  for (const rc of ROUTE_CLASSES) {
    const rule = headerRules.find((h) => h.source === rc.source);
    ok(`vercel.json headers[] has a "${rc.source}" entry`, Boolean(rule));
    if (!rule) continue;
    const keys = new Set((rule.headers || []).map((h) => h.key));
    for (const key of rc.required) {
      ok(`"${rc.source}" entry carries ${key}`, keys.has(key));
    }
    // Every HTML route class (everything but the API class) also carries the
    // three headers that apply everywhere: HSTS, Referrer-Policy, nosniff.
    if (rc.source !== "/api/(.*)") {
      for (const key of ["Strict-Transport-Security", "Referrer-Policy", "X-Content-Type-Options"]) {
        ok(`"${rc.source}" entry carries ${key}`, keys.has(key));
      }
    }
  }

  // NEGATIVE CONTROL: a route class this scan invents fails to be found,
  // proving the presence check above is not vacuously true for every string.
  const fakeRule = headerRules.find((h) => h.source === "/this-route-class-does-not-exist");
  ok("NEGATIVE CONTROL: an invented route class is correctly reported absent", fakeRule === undefined);
}

console.log(`\nops: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
