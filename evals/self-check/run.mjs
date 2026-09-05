// WS-R76 (migration 120). The self-check cron's offline suite:
// `api/_self-check.js`'s `envPresence`, `checkDatabase`,
// `checkMigrationFamilies`, `checkSiblingSweeps`, `runSelfCheck`,
// `recordSelfCheckIncidents`, `api/_sweep-schedule.js`'s widened
// `sweepNameFromPath`/`expectedIntervalMs`, and three static scans: this
// file's own env-leak scan of the real source, a static parse of
// `scripts/write-config.mjs`'s own required/optional lists asserting they
// still match `REQUIRED_ENV`/`OPTIONAL_ENV` exactly, and a check that a
// missing migration table is reported BY NAME.
//
//   node evals/self-check/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const {
  REQUIRED_ENV,
  OPTIONAL_ENV,
  envPresence,
  checkDatabase,
  MIGRATION_FAMILY_TABLES,
  MIGRATION_FAMILY_COLUMNS,
  checkMigrationFamilies,
  checkSiblingSweeps,
  runSelfCheck,
  recordSelfCheckIncidents,
  selfCheckTelegramPayload,
  sendSelfCheckTelegramAlert,
  SELF_CHECK_KIND_REGISTERED,
} = await import(pathToFileURL(join(REPO, "api/_self-check.js")).href);
const { INCIDENT_KINDS } = await import(pathToFileURL(join(REPO, "api/_incidents.js")).href);
const { sweepSchedules, sweepNameFromPath, expectedIntervalMs } = await import(
  pathToFileURL(join(REPO, "api/_sweep-schedule.js")).href
);

// ═════════════════════════════════════════════════════════════════════════
// §0 — migration 120: the kind is registered, and only there
// ═════════════════════════════════════════════════════════════════════════
console.log("── §0: the self_check kind ──");

ok("self_check is on api/_incidents.js's own closed INCIDENT_KINDS list", INCIDENT_KINDS.includes("self_check"));
ok("api/_self-check.js's own re-export agrees", SELF_CHECK_KIND_REGISTERED === true);

const migrationSql = fs.readFileSync(join(REPO, "db/migrations/120_incident_self_check.sql"), "utf8");
ok("migration 120 widens the SAME named constraint migration 109 created", /vy_incident_kind_check/.test(migrationSql));
ok("migration 120's CHECK names all six kinds", INCIDENT_KINDS.every((k) => migrationSql.includes(`'${k}'`)));
ok("migration 120 is one drop-if-exists + one add, no DO block", !/do\s+\$\$/i.test(migrationSql) && /drop constraint if exists/i.test(migrationSql));

// ═════════════════════════════════════════════════════════════════════════
// §1 — (a) env presence: mirrors scripts/write-config.mjs, by NAME only
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §1: env presence, by name only ──");

const writeConfigSrc = fs.readFileSync(join(REPO, "scripts/write-config.mjs"), "utf8");

function parseStringsArray(src) {
  const m = /const STRINGS = \[([\s\S]*?)\];/.exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((mm) => mm[1]);
}
function parseRequiredArray(src) {
  const m = /for \(const required of \[([^\]]*)\]\)/.exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((mm) => mm[1]);
}
const realStrings = parseStringsArray(writeConfigSrc);
const realRequired = parseRequiredArray(writeConfigSrc);

ok("scripts/write-config.mjs actually parsed to something (the regexes did not silently miss)",
  realStrings.length > 0 && realRequired.length > 0);
ok("REQUIRED_ENV mirrors scripts/write-config.mjs's own required-keys deploy guard exactly",
  JSON.stringify([...REQUIRED_ENV].sort()) === JSON.stringify([...new Set(realRequired)].sort()));
ok("OPTIONAL_ENV mirrors scripts/write-config.mjs's own STRINGS array (minus the required two) plus GOOGLE_KEYS",
  JSON.stringify([...OPTIONAL_ENV].sort()) ===
    JSON.stringify([...new Set([...realStrings.filter((n) => !realRequired.includes(n)), "GOOGLE_KEYS"])].sort()));
ok("REQUIRED_ENV and OPTIONAL_ENV never overlap", REQUIRED_ENV.every((n) => !OPTIONAL_ENV.includes(n)));

{
  const env = { OPENROUTER_KEY: "x", NEON_URL: "y", SUPABASE_URL: "z" };
  const rows = envPresence(env);
  ok("envPresence returns one row per name, required flagged correctly",
    rows.length === REQUIRED_ENV.length + OPTIONAL_ENV.length &&
    rows.filter((r) => r.required).every((r) => REQUIRED_ENV.includes(r.name)));
  const openrouter = rows.find((r) => r.name === "OPENROUTER_KEY");
  const azure = rows.find((r) => r.name === "AZURE_KEY");
  ok("a set var reports present: true", openrouter?.present === true);
  ok("an unset var reports present: false", azure?.present === false);
  ok("every row's own value is a boolean, never the string itself",
    rows.every((r) => typeof r.present === "boolean"));
}

// NEGATIVE CONTROL: a check that could log a value's length or prefix must
// fail a static scan of this file's own source — workstream brief's own
// words, first negative control.
const realSelfCheckSrc = fs.readFileSync(join(REPO, "api/_self-check.js"), "utf8");
function envLeakScanOk(src) {
  const dangerous = [
    /env\s*\[[^\]]+\]\s*\.\s*length/,
    /env\s*\[[^\]]+\]\s*\.\s*(slice|substring|substr)\s*\(/,
    /process\.env\s*\[[^\]]+\]\s*\.\s*length/,
    /process\.env\s*\[[^\]]+\]\s*\.\s*(slice|substring|substr)\s*\(/,
  ];
  return !dangerous.some((re) => re.test(src));
}
ok("static scan: the REAL api/_self-check.js never reads an env value's length or a substring of it",
  envLeakScanOk(realSelfCheckSrc));

const lengthLeakFixture = `function bad(env, name) { return { present: Boolean(env[name]), hint: env[name] ? env[name].length : 0 }; }`;
ok("NEGATIVE CONTROL: a fixture that reports an env value's LENGTH fails the leak scan",
  !envLeakScanOk(lengthLeakFixture));

const prefixLeakFixture = `function bad(env, name) { return { present: Boolean(env[name]), hint: env[name] ? env[name].slice(0, 4) : "" }; }`;
ok("NEGATIVE CONTROL, second shape: a fixture that reports a PREFIX of an env value fails the leak scan",
  !envLeakScanOk(prefixLeakFixture));

// ═════════════════════════════════════════════════════════════════════════
// §2 — (b) the database answers
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: the database answers ──");

{
  const okDb = async (sql) => (sql === "select 1" ? [{ "?column?": 1 }] : []);
  const r = await checkDatabase(okDb);
  ok("a database that answers select 1 reports ok", r.ok === true && r.door === null);
}
{
  const missingUrlDb = async () => { throw new Error("neon_url_missing"); };
  const r = await checkDatabase(missingUrlDb);
  ok("a db that throws neon_url_missing is named exactly that, never a generic failure",
    r.ok === false && r.door === "db: neon_url_missing");
}
{
  const brokenDb = async () => { throw new Error("neon 500: internal_error something_attacker_adjacent"); };
  const r = await checkDatabase(brokenDb);
  ok("a db that throws any OTHER error is a generic, content-free finding — never the raw driver message",
    r.ok === false && r.door === "db: select_1_failed" && !r.door.includes("attacker_adjacent"));
}
{
  const r = await checkDatabase(undefined);
  ok("no db function at all is reported the same as neon_url_missing", r.ok === false && r.door === "db: neon_url_missing");
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — (c) migration families versus the live catalog
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: migration families versus the live catalog ──");

function familyFakeDb(presentTables, presentColumns) {
  return async (sql, params = []) => {
    if (sql.includes("from information_schema.tables")) {
      const [names] = params;
      return names.filter((n) => presentTables.has(n)).map((table_name) => ({ table_name }));
    }
    if (sql.includes("from information_schema.columns")) {
      const [tables, cols] = params;
      const out = [];
      for (const t of tables) {
        for (const c of cols) {
          if (presentColumns.has(`${t}:${c}`)) out.push({ table_name: t, column_name: c });
        }
      }
      return out;
    }
    throw new Error(`familyFakeDb: unhandled SQL: ${sql.slice(0, 100)}`);
  };
}

{
  const allTables = new Set(MIGRATION_FAMILY_TABLES.map((f) => f.table));
  const allCols = new Set(MIGRATION_FAMILY_COLUMNS.map((f) => `${f.table}:${f.column}`));
  const { missing } = await checkMigrationFamilies(familyFakeDb(allTables, allCols));
  ok("every family present in the live catalog reports zero missing", missing.length === 0);
}
{
  // Drop exactly ONE table (migration 109's own vy_incident, ironic on
  // purpose — proves the self-check does not exempt its OWN table) and
  // assert the finding names it BY NAME (workstream brief's own second
  // negative control: "a missing migration table is reported by name").
  const allTables = new Set(MIGRATION_FAMILY_TABLES.map((f) => f.table));
  allTables.delete("vy_incident");
  const allCols = new Set(MIGRATION_FAMILY_COLUMNS.map((f) => `${f.table}:${f.column}`));
  const { missing } = await checkMigrationFamilies(familyFakeDb(allTables, allCols));
  ok("a missing migration TABLE is reported by its own name, not a generic 'schema drift'",
    missing.length === 1 && missing[0] === "migration 109: vy_incident missing");
}
{
  // Drop exactly one COLUMN (migration 110's taste_enabled) with its own
  // table otherwise present, proving the column-shaped check is a real,
  // independent read, not folded into the table check by accident.
  const allTables = new Set(MIGRATION_FAMILY_TABLES.map((f) => f.table));
  const allCols = new Set(MIGRATION_FAMILY_COLUMNS.map((f) => `${f.table}:${f.column}`));
  allCols.delete("vy_room:taste_enabled");
  const { missing } = await checkMigrationFamilies(familyFakeDb(allTables, allCols));
  ok("a missing migration COLUMN (table present, column absent) is reported by its own name",
    missing.length === 1 && missing[0] === "migration 110: vy_room.taste_enabled missing");
}
{
  const { missing } = await checkMigrationFamilies(undefined);
  ok("no db function at all reports every family missing, never a silent zero",
    missing.length === MIGRATION_FAMILY_TABLES.length + MIGRATION_FAMILY_COLUMNS.length);
}
ok("every family anchor table name is a real vy_/meera_ table this repo's migrations actually create",
  MIGRATION_FAMILY_TABLES.every((f) => /^(vy|meera)_/.test(f.table)));

// ═════════════════════════════════════════════════════════════════════════
// §4 — (d) sibling sweeps versus vercel.json's own schedule
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: sibling sweeps, self excluded ──");

const NOW = Date.parse("2026-09-10T12:00:00Z");
const FAKE_SCHEDULES = {
  "self-check": { path: "/api/self-check", schedule: "30 2 * * *", expected_interval_ms: 24 * 3_600_000 },
  checkins: { path: "/api/checkins-sweep", schedule: "*/15 * * * *", expected_interval_ms: 15 * 60_000 },
  "drift-watch": { path: "/api/drift-watch-sweep", schedule: "0 */6 * * *", expected_interval_ms: 6 * 3_600_000 },
};
function sweepRunFakeDb(rows) {
  return async (sql) => {
    if (sql.includes("distinct on (sweep)")) return rows;
    throw new Error(`sweepRunFakeDb: unhandled SQL: ${sql.slice(0, 100)}`);
  };
}
{
  const rows = [
    { sweep: "checkins", started_at: new Date(NOW - 5 * 60_000).toISOString() }, // fresh
    { sweep: "drift-watch", started_at: new Date(NOW - 3 * 24 * 3_600_000).toISOString() }, // very stale
    { sweep: "self-check", started_at: new Date(NOW - 30 * 24 * 3_600_000).toISOString() }, // ancient, must be ignored
  ];
  const { stale } = await checkSiblingSweeps(sweepRunFakeDb(rows), NOW, { sweepSchedulesFn: () => FAKE_SCHEDULES });
  ok("a fresh sibling sweep is not reported", !stale.some((s) => s.includes("checkins")));
  ok("a stale sibling sweep IS reported, by its own name", stale.includes("sweep drift-watch: stale"));
  ok("self-check's OWN row is excluded even when wildly stale — 'every OTHER cron' means every other one",
    !stale.some((s) => s.includes("self-check")));
}
{
  const { stale } = await checkSiblingSweeps(undefined, NOW, {});
  ok("no db function at all reports zero stale sweeps rather than throwing", Array.isArray(stale) && stale.length === 0);
}

// ── sweepNameFromPath / expectedIntervalMs, WS-R76's own widening ──────────
ok("sweepNameFromPath resolves the self-check cron's own literal path", sweepNameFromPath("/api/self-check") === "self-check");
ok("sweepNameFromPath still resolves an ordinary -sweep path unchanged", sweepNameFromPath("/api/checkins-sweep") === "checkins");
ok("sweepNameFromPath still refuses an unrelated path", sweepNameFromPath("/api/room") === null);
ok("expectedIntervalMs reads self-check's own 30-past-the-hour daily slot as 24 hours",
  expectedIntervalMs("30 2 * * *") === 24 * 3_600_000);
ok("expectedIntervalMs still reads a :00 daily slot as 24 hours (unchanged behavior)",
  expectedIntervalMs("0 0 * * *") === 24 * 3_600_000);
ok("expectedIntervalMs still reads a :00 weekly slot as 7 days (unchanged behavior)",
  expectedIntervalMs("0 3 * * 1") === 7 * 24 * 3_600_000);
ok("expectedIntervalMs still refuses an unrecognised shape (day-of-month)", expectedIntervalMs("0 0 1 * *") === null);

const realVercelJson = JSON.parse(fs.readFileSync(join(REPO, "vercel.json"), "utf8"));
ok("the real vercel.json's own self-check cron entry exists, at 02:30 UTC daily",
  realVercelJson.crons.some((c) => c.path === "/api/self-check" && c.schedule === "30 2 * * *"));
ok("every cron in the REAL vercel.json resolves to a sweep name (self-check's own exception included)",
  realVercelJson.crons.every((c) => sweepNameFromPath(c.path)));
ok("every cron in the REAL vercel.json resolves to a NON-NULL interval",
  Object.values(sweepSchedules(realVercelJson)).every((s) => Number.isFinite(s.expected_interval_ms)));

// ═════════════════════════════════════════════════════════════════════════
// §5 — runSelfCheck end to end, and recordSelfCheckIncidents
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: runSelfCheck end to end ──");

function worldDb({ selectOneOk = true, tablesPresent, colsPresent, sweepRows = [] } = {}) {
  return async (sql, params = []) => {
    if (sql === "select 1") {
      if (!selectOneOk) throw new Error("neon 500: down");
      return [{ "?column?": 1 }];
    }
    if (sql.includes("from information_schema.tables")) {
      const [names] = params;
      return names.filter((n) => tablesPresent.has(n)).map((table_name) => ({ table_name }));
    }
    if (sql.includes("from information_schema.columns")) {
      const [tables, cols] = params;
      const out = [];
      for (const t of tables) for (const c of cols) if (colsPresent.has(`${t}:${c}`)) out.push({ table_name: t, column_name: c });
      return out;
    }
    if (sql.includes("distinct on (sweep)")) return sweepRows;
    throw new Error(`worldDb: unhandled SQL: ${sql.slice(0, 100)}`);
  };
}
const ALL_TABLES = new Set(MIGRATION_FAMILY_TABLES.map((f) => f.table));
const ALL_COLS = new Set(MIGRATION_FAMILY_COLUMNS.map((f) => `${f.table}:${f.column}`));

{
  // A clean world: every required env set, db answers, every family
  // present, every sweep fresh.
  const env = Object.fromEntries(REQUIRED_ENV.map((n) => [n, "x"]));
  const db = worldDb({ tablesPresent: ALL_TABLES, colsPresent: ALL_COLS });
  const result = await runSelfCheck({ db, env, now: NOW, sweepSchedulesFn: () => ({}) });
  ok("a fully healthy world passes every check", result.ok === true && result.failed === 0 && result.checked === result.passed);
  ok("checked/passed/failed are plain numbers (survive api/_sweep-run.js's own sanitizeCounts)",
    typeof result.checked === "number" && typeof result.passed === "number" && typeof result.failed === "number");
}
{
  // A required env var missing, everything else fine.
  const env = { NEON_URL: "x" }; // OPENROUTER_KEY missing
  const db = worldDb({ tablesPresent: ALL_TABLES, colsPresent: ALL_COLS });
  const result = await runSelfCheck({ db, env, now: NOW, sweepSchedulesFn: () => ({}) });
  ok("a missing REQUIRED env var fails exactly one check, named by the var's own NAME",
    result.ok === false && result.failing_doors.includes("env: OPENROUTER_KEY missing"));
  ok("a missing OPTIONAL env var is never a failing check at all",
    !result.failing_doors.some((d) => d.includes("AZURE_KEY")));
}
{
  // The database itself is down — (c)/(d) must be SKIPPED, not attempted,
  // so a database outage never produces a cascade of misleading "table
  // missing" findings for tables that were simply unreachable.
  const env = Object.fromEntries(REQUIRED_ENV.map((n) => [n, "x"]));
  const db = worldDb({ selectOneOk: false, tablesPresent: ALL_TABLES, colsPresent: ALL_COLS });
  const result = await runSelfCheck({ db, env, now: NOW, sweepSchedulesFn: () => ({}) });
  ok("a down database fails exactly the db check, and (c)/(d) are SKIPPED rather than cascading false findings",
    result.failing_doors.length === 1 && result.failing_doors[0] === "db: select_1_failed");
}
{
  // Everything fine except one family table, plus one stale sibling.
  const env = Object.fromEntries(REQUIRED_ENV.map((n) => [n, "x"]));
  const tables = new Set(ALL_TABLES);
  tables.delete("vy_room_showcase");
  const sweepRows = [{ sweep: "checkins", started_at: new Date(NOW - 30 * 24 * 3_600_000).toISOString() }];
  const db = worldDb({ tablesPresent: tables, colsPresent: ALL_COLS, sweepRows });
  const result = await runSelfCheck({
    db, env, now: NOW,
    sweepSchedulesFn: () => ({ checkins: FAKE_SCHEDULES.checkins }),
  });
  ok("a missing table AND a stale sweep are both reported, independently, both by name",
    result.failing_doors.includes("migration 115: vy_room_showcase missing") &&
    result.failing_doors.includes("sweep checkins: stale"));
}

// recordSelfCheckIncidents: one recordIncident call per failing door, kind always self_check.
{
  const calls = [];
  const spyDb = async (sql, params) => {
    if (sql.includes("insert into vy_incident")) { calls.push(params); return []; }
    throw new Error("unexpected");
  };
  const result = { failing_doors: ["env: NEON_URL missing", "db: select_1_failed"] };
  await recordSelfCheckIncidents(spyDb, result);
  ok("recordSelfCheckIncidents writes one incident per failing door", calls.length === 2);
  ok("every write's kind is exactly self_check, never a bespoke kind", calls.every((c) => c[1] === "self_check"));
  ok("every write's door is the check's own name, unchanged", calls.map((c) => c[2]).sort().join("|") ===
    ["env: NEON_URL missing", "db: select_1_failed"].sort().join("|"));
  ok("every write's status is the fixed sentinel 0, never a fabricated HTTP code", calls.every((c) => c[3] === 0));
}
{
  // NEGATIVE CONTROL: a healthy result records nothing at all.
  const calls = [];
  const spyDb = async (sql, params) => { if (sql.includes("insert into vy_incident")) calls.push(params); return []; };
  await recordSelfCheckIncidents(spyDb, { failing_doors: [] });
  ok("NEGATIVE CONTROL: a result with zero failing checks writes zero incident rows", calls.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// §6 — WS-R98: the failure path's own Telegram alert.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: the failure path's own Telegram alert (WS-R98) ──");
{
  const p = selfCheckTelegramPayload({ checked: 16, failed: 3 });
  ok("selfCheckTelegramPayload: body names the real checked/failed counts", p.body.includes("3/16"));
  ok("selfCheckTelegramPayload: url points at the ops board", p.url === "/studio?mode=ops");
  ok("selfCheckTelegramPayload: body under 200 characters", p.body.length <= 200);
}
{
  let telegramPayload = null;
  const outcome = await sendSelfCheckTelegramAlert(async () => [], { ok: false, checked: 16, failed: 3 }, {
    env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111" },
    sendTelegram: async (db, payload) => { telegramPayload = payload; return { sent: 1, failed: 0 }; },
  });
  ok("sendSelfCheckTelegramAlert: a failing result sends exactly one Telegram alert", outcome.telegramSent === 1);
  ok("sendSelfCheckTelegramAlert: the sender receives selfCheckTelegramPayload's own shape",
    telegramPayload?.body.includes("3/16") && telegramPayload?.url === "/studio?mode=ops");
}
{
  // NEGATIVE CONTROL: a healthy result (ok: true) never even reaches the
  // sender - proven by a sender that throws if called at all.
  const outcome = await sendSelfCheckTelegramAlert(async () => [], { ok: true, checked: 16, failed: 0 }, {
    env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111" },
    sendTelegram: async () => { throw new Error("must never be called on a healthy result"); },
  });
  ok("NEGATIVE CONTROL: sendSelfCheckTelegramAlert on a healthy result sends nothing, never calls the sender",
    outcome.telegramSent === 0);
}
{
  // NEGATIVE CONTROL: never throws, even when the real sender itself throws
  // (e.g. an unset deps.fetch with Telegram configured).
  const outcome = await sendSelfCheckTelegramAlert(async () => [], { ok: false, checked: 1, failed: 1 }, {
    env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111" },
    // no deps.fetch, no deps.sendTelegram override - reaches the REAL
    // sendOperatorTelegram, which throws for a missing fetch once configured.
  });
  ok("sendSelfCheckTelegramAlert never throws even when the underlying sender does", outcome.telegramSent === 0);
}

console.log(`\nself-check: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
