// api/_self-check.js — WS-R76 (migration 120). The deployment's own morning
// report on itself: which env values are missing BY NAME, whether the
// database answers, whether every migration family the tree ships is
// applied, and whether every OTHER cron has run recently enough.
//
// Both Vercel projects ran for a day with no `NEON_URL` and every database
// door failing before anyone noticed
// (`measurements.md#live-probe-wave-eleven-preview-2026-09-05`). The
// incident ledger (WS-R58) records a 5xx AFTER the fact, once a real
// request happens to hit a broken door. This file is what lets a deployment
// find the SAME class of gap on its own, every morning, before a follower
// does.
//
// Pure — `db`, `env` and `now` are all injected, never imported — the same
// seam `api/_ops.js`/`api/_drift-watch.js` already take, so
// `evals/self-check/run.mjs` can drive every branch offline with a fake db
// and a fake env, no network.
//
// LAW (workstream brief): NEVER print, log or commit a value from
// `api/_config.js` or the environment — the self-check reports NAMES only.
// Every finding this file can ever produce is a NAME - an env var's own
// name, a table's or column's own name, a sweep's own name - never
// anything read FROM that name's own value, and never a length or a prefix
// of one either (a length still narrows a secret). `evals/self-check/
// run.mjs`'s own static scan of this file's real source is the second,
// independent guarantee - `api/_incidents.js`'s own INSERT-column-list scan
// precedent, restated for an env reader instead of a SQL writer.
import { INCIDENT_KINDS, recordIncident } from "./_incidents.js";
import { sweepSchedules } from "./_sweep-schedule.js";
// WS-R98. The failure path's own Telegram alert - safe to import directly,
// `api/_operator-telegram.js` never imports this file back (see that file's
// own header).
import { sendOperatorTelegram } from "./_operator-telegram.js";

// ═════════════════════════════════════════════════════════════════════════
// (a) env presence, by NAME only
// ═════════════════════════════════════════════════════════════════════════
//
// Mirrors `scripts/write-config.mjs`'s own two lists exactly: `REQUIRED_ENV`
// is that file's own closing `for (const required of [...])` deploy guard
// ("the site cannot function without these two"); `OPTIONAL_ENV` is its own
// `STRINGS` array (every OTHER name it bakes into `api/_config.js`) plus
// `GOOGLE_KEYS`, which that file resolves separately into `GOOGLE_KEYRING`/
// `GOOGLE_KEYS` rather than listing in `STRINGS`.
//
// Kept in sync NOT by importing that file — it is a CI script that WRITES
// `api/_config.js` and calls `process.exit` at module scope the moment it is
// evaluated (refusing to overwrite a real local config, or failing the
// build when a required key is absent); importing it here would run a
// deploy-time side effect, and possibly a hard exit, on every self-check
// tick. Instead, `evals/self-check/run.mjs` statically parses that file's
// own source text for both lists and asserts they match these two exactly —
// `api/_incidents.js`'s own `opsOwnerIdsLocal` local-restatement-instead-of-
// a-cycle precedent
// (`context/rejected.md#ws-r58-incidents-importing-opsownerids-from-ops-js-
// makes-a-cycle`), restated for a script instead of a sibling module.
export const REQUIRED_ENV = Object.freeze(["OPENROUTER_KEY", "NEON_URL"]);
export const OPTIONAL_ENV = Object.freeze([
  "OPENROUTER_RESEARCH_KEY",
  "GOOGLE_KEY",
  "GOOGLE_PAID_KEY",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AZURE_KEY",
  "AZURE_ENDPOINT",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_BOT_USERNAME",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
  "GOOGLE_KEYS",
]);

/**
 * One entry per name in `REQUIRED_ENV` then `OPTIONAL_ENV`, `present` a
 * plain boolean — never the value, never `.length`, never a prefix.
 * `Boolean(env[name])` is the WHOLE read; nothing downstream of this
 * function ever sees the string itself.
 */
export function envPresence(env = process.env) {
  const out = [];
  for (const name of REQUIRED_ENV) out.push({ name, required: true, present: Boolean(env[name]) });
  for (const name of OPTIONAL_ENV) out.push({ name, required: false, present: Boolean(env[name]) });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// (b) the database answers
// ═════════════════════════════════════════════════════════════════════════
//
// `select 1` alone — the smallest statement that can distinguish "the URL
// is missing" (`api/_db.js`'s own `neon_url_missing` throw, the exact
// finding the main loop's live probe of the wave-eleven preview made by
// hand, `measurements.md#live-probe-wave-eleven-preview-2026-09-05`) from
// every other way a database can fail to answer.
export async function checkDatabase(db) {
  if (typeof db !== "function") return { ok: false, door: "db: neon_url_missing" };
  try {
    await db("select 1", []);
    return { ok: true, door: null };
  } catch (error) {
    if (error?.message === "neon_url_missing") return { ok: false, door: "db: neon_url_missing" };
    return { ok: false, door: "db: select_1_failed" };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// (c) every migration family the tree ships, versus the live catalog
// ═════════════════════════════════════════════════════════════════════════
//
// NOT a walk of every one of the ~90 files under `db/migrations/` — a
// small, explicit, hand-picked representative TABLE (or, where a migration
// only added a column to an already-existing table, a COLUMN) per major
// schema epoch, read with `information_schema` — `scripts/relcheck.mjs`'s
// own `information_schema.columns` reads are this file's precedent for the
// query shape, never a DO block. One family, one anchor: every table a
// single migration FILE creates lands together in one transaction-shaped
// apply, so proving that file's own first/anchor table exists is proof the
// whole file ran — the point is not exhaustive column-level completeness,
// it is catching the exact gap a missing `NEON_URL` or a skipped `apply.mjs`
// run would otherwise hide silently until a follower's own request 500s.
// THREE migrations that would otherwise anchor this list are deliberately
// ABSENT, not merely uncovered — see `context/rejected.md#ws-r76-migration-
// family-anchors-cannot-name-a-boundary-table-even-in-a-comment` for which
// three and why. Short version: each would-be anchor names an identifier
// the leak battery already holds under its own dedicated static scanner,
// and those scanners work by SUBSTRING over every API file's raw source
// TEXT — comments included, `context/rejected.md#ws-r54-erasure-comment-
// naming-a-sibling-table-breaks-the-leak-scanner` and `context/rejected.md
// #ws-r70-mentioning-a-boundary-tables-name-in-a-comment-trips-a-repo-wide-
// static-scanner`'s own gotcha, which is why this comment itself stops
// short of spelling any of the three out. WS-R70's own precedent (see that
// same rejection) is to drop the anchor from the manifest rather than fight
// an established, unrelated discipline — restated here. Coverage is not
// lost silently: one of the three migrations has a SECOND change (a column
// on a table this file already anchors safely) that still proves it ran,
// kept in `MIGRATION_FAMILY_COLUMNS` below; the other two have no such safe
// alternative and are simply absent from this file entirely.
export const MIGRATION_FAMILY_TABLES = Object.freeze([
  { id: "person_core", migration: "001", table: "vy_person" },
  { id: "meera_turn_trace", migration: "012", table: "meera_turn" },
  { id: "replica_core", migration: "015", table: "vy_replica" },
  { id: "replica_full_erasure", migration: "037", table: "vy_replica_erasure_attempt" },
  { id: "room_core", migration: "071", table: "vy_room" },
  { id: "room_payments", migration: "078", table: "vy_payment_event" },
  { id: "sweep_run", migration: "084", table: "vy_sweep_run" },
  { id: "room_push", migration: "085", table: "vy_room_push_subscription" },
  { id: "org_suites", migration: "091", table: "vy_org" },
  { id: "incidents", migration: "109", table: "vy_incident" },
  { id: "operator_push", migration: "114", table: "vy_operator_push_subscription" },
  { id: "room_showcase", migration: "115", table: "vy_room_showcase" },
]);

// One migration in the anchor list above only ever added a COLUMN to a
// table an earlier family already anchors — a table-existence check alone
// would not catch it being skipped.
export const MIGRATION_FAMILY_COLUMNS = Object.freeze([
  { id: "room_taste_enabled", migration: "110", table: "vy_room", column: "taste_enabled" },
]);

/** Two reads total — one for every anchor TABLE, one for every anchor
 *  COLUMN — never one read per family; `information_schema` happily
 *  answers "which of these names exist" in a single round trip, so batching
 *  is the honest reading of "a small, explicit list of information_schema
 *  reads", not fifteen-plus round trips this deployment would pay for on
 *  every tick. Missing entries come back named exactly as
 *  `MIGRATION_FAMILY_TABLES`/`MIGRATION_FAMILY_COLUMNS` describe them —
 *  "a missing migration table is reported by name" (workstream brief's own
 *  negative control). */
export async function checkMigrationFamilies(db) {
  const missing = [];
  if (typeof db !== "function") {
    for (const f of MIGRATION_FAMILY_TABLES) missing.push(`migration ${f.migration}: ${f.table} missing`);
    for (const f of MIGRATION_FAMILY_COLUMNS) missing.push(`migration ${f.migration}: ${f.table}.${f.column} missing`);
    return { missing };
  }
  const tableNames = MIGRATION_FAMILY_TABLES.map((f) => f.table);
  const tableRows = await db(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
    [tableNames],
  );
  const tablesPresent = new Set(tableRows.map((r) => r.table_name));
  for (const f of MIGRATION_FAMILY_TABLES) {
    if (!tablesPresent.has(f.table)) missing.push(`migration ${f.migration}: ${f.table} missing`);
  }

  const colTableNames = MIGRATION_FAMILY_COLUMNS.map((f) => f.table);
  const colColumnNames = MIGRATION_FAMILY_COLUMNS.map((f) => f.column);
  const colRows = await db(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1::text[]) and column_name = any($2::text[])`,
    [colTableNames, colColumnNames],
  );
  const colsPresent = new Set(colRows.map((r) => `${r.table_name}:${r.column_name}`));
  for (const f of MIGRATION_FAMILY_COLUMNS) {
    if (!colsPresent.has(`${f.table}:${f.column}`)) missing.push(`migration ${f.migration}: ${f.table}.${f.column} missing`);
  }
  return { missing };
}

// ═════════════════════════════════════════════════════════════════════════
// (d) every OTHER cron, versus vercel.json's own schedule
// ═════════════════════════════════════════════════════════════════════════
//
// `sweepSchedules()` (api/_sweep-schedule.js) is the SAME build-time read
// the ops board's own Sweeps strip already uses — WS-R21's own law, "read
// at build time, not guessed" — reused rather than re-derived. The
// staleness math below is a LOCAL restatement of `api/_ops.js`'s own
// `sweepStaleness`, not an import: `api/_ops.js` already imports
// `api/_incidents.js` for `INCIDENT_KINDS`/`incidentsOverview`'s own read,
// and this file also imports `api/_incidents.js` — if `api/_ops.js` ever
// imported FROM this file too, that would be the exact
// `api/_ops.js -> api/_incidents.js -> api/_ops.js`-shaped cycle
// `context/rejected.md#ws-r58-incidents-importing-opsownerids-from-ops-js-
// makes-a-cycle` already names, one file over. Six lines duplicated once is
// a smaller risk than that cycle; `evals/self-check/run.mjs` asserts both
// functions agree on every case `evals/ops/run.mjs` already exercises.
function sweepStalenessLocal(last, schedule, now) {
  if (!last) return schedule ? "never_ran" : "unscheduled";
  const interval = schedule?.expected_interval_ms;
  if (!Number.isFinite(interval)) return "unknown_schedule";
  const lastAt = new Date(last.started_at).getTime();
  if (!Number.isFinite(lastAt)) return "unknown_schedule";
  return now - lastAt > 2 * interval ? "stale" : "fresh";
}

/**
 * "Every OTHER cron" (workstream law, verbatim) — self-check's OWN row is
 * excluded by name: on its first-ever run there is no prior row to compare
 * against, and a sweep judging its own freshness against a run that has not
 * finished yet is not a finding, it is a tautology.
 */
export async function checkSiblingSweeps(db, now, deps = {}) {
  if (typeof db !== "function") return { stale: [] };
  const schedules = (deps.sweepSchedulesFn || sweepSchedules)(deps.vercelConfig);
  const rows = await db(`select distinct on (sweep) sweep, started_at from vy_sweep_run order by sweep, started_at desc`, []);
  const bySweep = new Map(rows.map((r) => [r.sweep, r]));
  const stale = [];
  for (const [name, schedule] of Object.entries(schedules)) {
    if (name === "self-check") continue;
    const last = bySweep.get(name) || null;
    if (sweepStalenessLocal(last, schedule, now) === "stale") stale.push(`sweep ${name}: stale`);
  }
  return { stale };
}

// ═════════════════════════════════════════════════════════════════════════
// the whole self-check, one call
// ═════════════════════════════════════════════════════════════════════════

/**
 * `deps`: `db` (required for b/c/d — its absence is itself reported as the
 * `db: neon_url_missing` finding, never a thrown error that would abort the
 * rest), `env` (default `process.env`), `now` (default `Date.now()`),
 * `sweepSchedulesFn`/`vercelConfig` (injectable for the eval, `(d)`'s own
 * seam). NEVER throws — every section stands alone, and a section that
 * cannot run is reported as its own failing check rather than aborting the
 * others (`AGENTS.md`'s own "a plausible return hides a dead pipeline" law,
 * read the other way: a self-check that dies partway must still say what it
 * DID find, never nothing at all).
 *
 * `(c)`/`(d)` are skipped, not attempted, when `(b)` itself failed — a
 * database that never answered `select 1` cannot meaningfully be asked
 * whether a TABLE exists either, and running those two anyway would produce
 * a cascade of misleading "table missing" findings for a database that was
 * simply unreachable, `sweepStalenessLocal`'s own "not a finding, a
 * tautology" law restated for the whole section rather than one row.
 *
 * Returns `{checks, checked, passed, failed, ok, failing_doors}` — only
 * `failing_doors` (a list of the static, content-free door labels this file
 * builds — an env var's own name, a table's own name, a sweep's own name,
 * NEVER anything read off a value) is meant to leave this process, via
 * `recordSelfCheckIncidents`, below.
 */
export async function runSelfCheck(deps = {}) {
  const db = deps.db;
  const env = deps.env || process.env;
  const now = deps.now ?? Date.now();
  const checks = [];

  for (const entry of envPresence(env)) {
    if (entry.required) checks.push({ door: `env: ${entry.name} missing`, ok: entry.present });
  }

  const dbResult = await checkDatabase(db);
  checks.push({ door: dbResult.door || "db: select 1", ok: dbResult.ok });

  if (dbResult.ok) {
    const { missing } = await checkMigrationFamilies(db);
    for (const door of missing) checks.push({ door, ok: false });
    const { stale } = await checkSiblingSweeps(db, now, deps);
    for (const door of stale) checks.push({ door, ok: false });
  }

  const failing = checks.filter((c) => !c.ok);
  return {
    checks,
    checked: checks.length,
    passed: checks.length - failing.length,
    failed: failing.length,
    ok: failing.length === 0,
    failing_doors: failing.map((c) => c.door),
  };
}

/**
 * One `recordIncident` (api/_incidents.js) per failing check — workstream
 * law 2, verbatim: "each failing check is one recordIncident row with the
 * check's name as the door". `kind` is always `"self_check"` (migration
 * 120's own widened CHECK); `status` is a fixed sentinel (`0`) since a
 * self-check finding has no HTTP status of its own to carry the way
 * `withDoor`'s own `door_5xx` rows do — `withDoor` itself is not reused
 * here for exactly that reason, it exists to watch a door's OWN response
 * code from the outside, not to record an arbitrary named finding.
 *
 * Awaited sequentially, not fired-and-forgotten — `api/_incidents.js`'s own
 * `notifyNewIncidentKinds` precedent: nothing left to race against once
 * this cron's own response has not yet gone out, and a handful of failing
 * checks is never enough rows for sequential awaits to matter.
 */
export async function recordSelfCheckIncidents(db, result) {
  for (const door of result.failing_doors) {
    await recordIncident(db, { kind: "self_check", door, status: 0 });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// (e) the failure path's own Telegram alert (WS-R98)
// ═════════════════════════════════════════════════════════════════════════
//
// Content-free by construction: only `result.checked`/`result.failed` (plain
// counts, already proven safe by `runSelfCheck`'s own return shape) ever
// reach the body - never `result.failing_doors`' own names, even though
// those names are themselves already content-free (an env var's name, a
// table's name, a sweep's name, never a value) - kept OUT anyway so this
// alert is exactly as content-free as `operatorDigestPayload`/
// `incidentPushPayload` one file over, never a special case a future editor
// has to reason about differently.

/** Pure, `operatorDigestPayload`'s own "the parameter list is the
 *  enforcement" shape (api/_operator-digest.js) restated a fourth time. */
export function selfCheckTelegramPayload(result) {
  const checked = Math.max(0, Math.trunc(Number(result?.checked) || 0));
  const failed = Math.max(0, Math.trunc(Number(result?.failed) || 0));
  return {
    title: "Vyakti self-check",
    body: `${failed}/${checked} checks failing this morning. See the ops board.`.slice(0, 200),
    url: "/studio?mode=ops",
  };
}

/**
 * Fires ONLY on the failure path (`result.ok === false`) - a clean morning
 * sends nothing, `notifyNewIncidentKinds`'s own "only a genuinely new kind
 * wakes anyone" restraint restated for a daily cron instead of a per-kind
 * claim. No idempotency machinery of its own is needed: this cron already
 * runs at most once a day (`vercel.json`'s `30 2 * * *`), so "the failure
 * path calls the sender" is naturally at-most-once-per-day, `withSweepRun`'s
 * own heartbeat wrapper is what recorded it ran at all.
 *
 * Never throws - `deps.sendTelegram` defaults to the real
 * `sendOperatorTelegram`, and every failure inside is caught, the same
 * best-effort posture `recordSelfCheckIncidents`'s own caller
 * (`api/self-check.js`) already takes for this whole step.
 */
export async function sendSelfCheckTelegramAlert(db, result, deps = {}) {
  if (result?.ok) return { telegramSent: 0 };
  const env = deps.env || process.env;
  const sendTelegram = deps.sendTelegram || sendOperatorTelegram;
  try {
    const outcome = await sendTelegram(db, selfCheckTelegramPayload(result), {
      env,
      fetch: deps.fetch,
      now: deps.now,
      recordIncident,
    });
    return { telegramSent: outcome?.sent || 0 };
  } catch (error) {
    console.error("[self-check] telegram send failure:", error?.message || "unknown");
    return { telegramSent: 0 };
  }
}

// Re-exported so a caller (or the eval) can assert this file's own kind is
// still on the closed list without importing api/_incidents.js a second
// time under a different name.
export const SELF_CHECK_KIND_REGISTERED = INCIDENT_KINDS.includes("self_check");
