// WS-R137 (migration 136). The follower's monthly note:
// `api/_room-month-note.js` (the pure counts builder, the due-select, the
// claim/idempotency, the sweep). Driven through a small self-contained fake
// db - this feature's own tables (`vy_room_follower_day`, `vy_room_thread`,
// `vy_room_checkin_delivery`, `vy_fact`, `vy_room_follower`,
// `vy_room_follower_month_note`) are simple enough that a dedicated fixture
// is cheaper and clearer than threading `evals/room/fixtures.mjs`'s much
// larger world through a feature that touches none of its session/thread
// machinery.
//
//   node evals/room-month-note/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres, no model call,
// no GPU.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const MONTHNOTE = await import(pathToFileURL(join(REPO, "api/_room-month-note.js")).href);
const {
  computeFollowerMonthNote,
  previousMonthKey,
  monthKeyBounds,
  followerMonthNoteTelegramText,
  claimFollowerMonthNote,
  dueFollowerMonthNoteCandidates,
} = MONTHNOTE;
const { monthNotePushPayload } = await import(pathToFileURL(join(REPO, "api/_push/webpush.js")).href);
const { QUIET_HOURS_MARKER } = await import(pathToFileURL(join(REPO, "api/_quiet-hours.js")).href);

const ROOM = "e1000000-0000-4000-8000-000000000001";
const AGENT = "e1000000-0000-4000-8000-000000000002";
const FOLLOWER_A = "e1000000-0000-4000-8000-0000000000a1";
const PERSON_A = "e1000000-0000-4000-8000-0000000000a2";
const FOLLOWER_B = "e1000000-0000-4000-8000-0000000000b1";
const PERSON_B = "e1000000-0000-4000-8000-0000000000b2";
const MONTH_KEY = "2026-08";

// ═════════════════════════════════════════════════════════════════════════
// §1 — pure month-key arithmetic.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §1: month-key arithmetic ──");
ok("previousMonthKey: mid-month, ordinary rollover", previousMonthKey(Date.parse("2026-09-05T00:00:00Z")) === "2026-08");
ok("previousMonthKey: January rolls back into December of the PREVIOUS year",
  previousMonthKey(Date.parse("2026-01-15T00:00:00Z")) === "2025-12");
ok("monthKeyBounds: August 2026 starts and ends on the correct UTC instants",
  monthKeyBounds("2026-08").startIso === "2026-08-01T00:00:00.000Z" &&
    monthKeyBounds("2026-08").endIso === "2026-09-01T00:00:00.000Z");
ok("monthKeyBounds: December rolls the end bound into January of the NEXT year",
  monthKeyBounds("2026-12").endIso === "2027-01-01T00:00:00.000Z");
ok("monthKeyBounds: a malformed key throws by name, never silently produces a bogus range",
  (() => { try { monthKeyBounds("2026-8"); return false; } catch (e) { return e.code === "month_note_month_key_invalid"; } })());

// ═════════════════════════════════════════════════════════════════════════
// §2 — the builder: a small, honest fake db, one follower.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: computeFollowerMonthNote — floor-free counts, real streak, memory predicate ──");

function buildFakeDb(dayRows, threadCount, checkinCount, factRows) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));
    if (has("from vy_room_follower_day") && has("coalesce(sum(turns)")) {
      const [roomId, personId, start, end] = p;
      const rows = dayRows.filter((r) => r.room_id === roomId && r.person_id === personId && r.day >= start && r.day < end);
      return [{ turns: rows.reduce((s, r) => s + r.turns, 0), days_active: rows.filter((r) => r.turns > 0).length }];
    }
    if (has("from vy_room_follower_day") && has("order by day desc")) {
      const [roomId, personId, end] = p;
      return dayRows
        .filter((r) => r.room_id === roomId && r.person_id === personId && r.day < end)
        .sort((a, b) => (a.day < b.day ? 1 : -1));
    }
    if (has("from vy_room_thread")) return [{ n: threadCount }];
    if (has("from vy_room_checkin_delivery")) return [{ n: checkinCount }];
    if (has("from vy_fact")) {
      const [personId, agentId] = p;
      return [{ n: factRows.filter((f) => f.person_id === personId && f.agent_id === agentId).length }];
    }
    throw new Error(`unmatched SQL: ${sql}`);
  };
}

// A follower with exactly ONE turn on ONE day — the smallest real activity
// this feature can ever count. FLOOR-FREE means this shows up as `1`, never
// nulled or rounded away the way api/_org-weekly-note.js's admin-facing
// count would be below its own n>=5 floor — there is no floor here at all,
// because this note is shown back to the SAME person the row is about.
const tinyDb = buildFakeDb(
  [{ room_id: ROOM, person_id: PERSON_A, day: "2026-08-14", turns: 1 }], 0, 0, [],
);
const tinyNote = await computeFollowerMonthNote(tinyDb, {
  roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, agentId: AGENT, memoryConsentAt: "2026-08-01T00:00:00.000Z",
}, MONTH_KEY);
ok("a single turn on a single day is reported as exactly 1 — floor-free, never nulled",
  tinyNote.turns_this_month === 1 && tinyNote.days_active_this_month === 1);
ok("remembered_things_count is 0 (not null) when memory is on but this follower has no facts yet",
  tinyNote.remembered_things_count === 0);

// A real consecutive streak ending on the month's own last day (31 Aug).
const streakDb = buildFakeDb(
  [
    { room_id: ROOM, person_id: PERSON_A, day: "2026-08-29", turns: 2 },
    { room_id: ROOM, person_id: PERSON_A, day: "2026-08-30", turns: 1 },
    { room_id: ROOM, person_id: PERSON_A, day: "2026-08-31", turns: 4 },
    // A gap on the 28th — the streak must stop there, not count through it.
    { room_id: ROOM, person_id: PERSON_A, day: "2026-08-27", turns: 3 },
  ], 0, 0, [],
);
const streakNote = await computeFollowerMonthNote(streakDb, {
  roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, agentId: AGENT, memoryConsentAt: null,
}, MONTH_KEY);
ok("streak_days is exactly 3 (29th/30th/31st), stopping at the gap on the 28th, not counting the 27th",
  streakNote.streak_days === 3, String(streakNote.streak_days));
ok("a follower who turned memory off gets remembered_things_count: null, never a fabricated zero",
  streakNote.remembered_things_count === null);

// ═════════════════════════════════════════════════════════════════════════
// §3 — idempotency: the unique index is the whole mechanism.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: idempotency — one claim per (follower, room, month) ──");
{
  const ledger = new Set();
  const claimDb = async (sql) => {
    if (sql.includes("insert into vy_room_follower_month_note")) {
      const key = `${FOLLOWER_A}|${ROOM}|${MONTH_KEY}`;
      if (ledger.has(key)) return [];
      ledger.add(key);
      return [{ note_id: "note-1" }];
    }
    throw new Error(`unmatched SQL: ${sql}`);
  };
  const first = await claimFollowerMonthNote(claimDb, { roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, monthKey: MONTH_KEY });
  const second = await claimFollowerMonthNote(claimDb, { roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, monthKey: MONTH_KEY });
  ok("the first claim for a (follower, room, month) wins and returns a note_id", first.length === 1 && first[0].note_id === "note-1");
  ok("the second claim for the SAME (follower, room, month) returns zero rows - the whole idempotency",
    second.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — quiet hours: the shared fragment is spliced into the due-select.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: quiet hours — the shared fragment is spliced into the due-select ──");
{
  let seenSql = "";
  const dueDb = async (sql) => {
    seenSql = sql;
    return [];
  };
  await dueFollowerMonthNoteCandidates(dueDb, MONTH_KEY, Date.now(), 50);
  ok("the due-select carries QUIET_HOURS_MARKER — the shared fragment, not a second hand-typed copy",
    seenSql.includes(QUIET_HOURS_MARKER));
  ok("the due-select excludes a follower who already has a row for this exact month (idempotency-by-absence)",
    /not exists/i.test(seenSql) && seenSql.includes("vy_room_follower_month_note"));

  // NEGATIVE CONTROL: a frozen copy of the due-select's WHERE clause exactly
  // as it would read WITHOUT the fragment spliced in — proves the scan above
  // is a real, load-bearing check rather than one that would pass on
  // anything (`evals/quiet-hours/run.mjs`'s own required negative control,
  // restated here for this feature's own due-select).
  const src = fs.readFileSync(join(REPO, "api/_room-month-note.js"), "utf8");
  ok("the real source contains the quiet-hours splice (not moved/renamed)",
    src.includes("quietHoursOkForFollowerSql(\"f\", 1)"));
  const noQuietHours = src.replace(
    "        and ${quietHoursOkForFollowerSql(\"f\", 1)}\n",
    "",
  );
  ok("NEGATIVE CONTROL (a): striking the splice actually changes the source (the control is not a no-op)",
    noQuietHours !== src);
  let struckSeenSql = "";
  const struckPath = join(REPO, "api", `_room-month-note.STRUCK-${Date.now()}.mjs`);
  writeFileSync(struckPath, noQuietHours);
  try {
    const struckModule = await import(pathToFileURL(struckPath).href);
    const struckDb = async (sql) => { struckSeenSql = sql; return []; };
    await struckModule.dueFollowerMonthNoteCandidates(struckDb, MONTH_KEY, Date.now(), 50);
    ok("NEGATIVE CONTROL (a): the struck copy's due-select does NOT carry QUIET_HOURS_MARKER — the scan above would have caught this",
      !struckSeenSql.includes(QUIET_HOURS_MARKER));
  } finally {
    rmSync(struckPath, { force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — NEGATIVE CONTROL: the builder handed another follower's rows must
// refuse by the WHERE. A struck copy of `computeFollowerMonthNote` with the
// `person_id` predicate removed from its own turns query, run against a
// world holding BOTH followers' rows in the SAME table.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: NEGATIVE CONTROL — handed another follower's rows, the builder must refuse by the WHERE ──");
{
  const twoFollowerDays = [
    { room_id: ROOM, person_id: PERSON_A, day: "2026-08-05", turns: 2 },
    { room_id: ROOM, person_id: PERSON_B, day: "2026-08-05", turns: 90 },
  ];
  // A fake db that applies EXACTLY the predicate the real SQL text asks for
  // — if the query's own WHERE clause names `person_id`, only that
  // follower's rows come back; if it does not (the struck copy below), every
  // row in the table for this room comes back, mixed. This is what "refuse
  // by the WHERE" means: the fixture does not filter on its own opinion of
  // who asked, it filters on what the real SQL text actually constrains.
  const twoFollowerDb = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));
    if (has("from vy_room_follower_day") && has("coalesce(sum(turns)")) {
      const [roomId, personId] = p;
      const scoped = has("person_id = ($2)::uuid");
      const rows = twoFollowerDays.filter((r) => r.room_id === roomId && (!scoped || r.person_id === personId));
      return [{ turns: rows.reduce((s, r) => s + r.turns, 0), days_active: rows.length }];
    }
    if (has("from vy_room_follower_day") && has("order by day desc")) return [];
    if (has("from vy_room_thread") || has("from vy_room_checkin_delivery")) return [{ n: 0 }];
    if (has("from vy_fact")) return [{ n: 0 }];
    throw new Error(`unmatched SQL: ${sql}`);
  };

  const realNoteA = await computeFollowerMonthNote(twoFollowerDb, {
    roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, agentId: AGENT, memoryConsentAt: null,
  }, MONTH_KEY);
  ok("the REAL builder, handed a world with another follower's rows in the same table, refuses them by the WHERE (2, never 92)",
    realNoteA.turns_this_month === 2, String(realNoteA.turns_this_month));

  // The struck copy: the SAME function with `and person_id = ($2)::uuid`
  // removed from the turns query's own WHERE clause.
  const src = fs.readFileSync(join(REPO, "api/_room-month-note.js"), "utf8");
  const needle =
    `      where room_id = ($1)::uuid and person_id = ($2)::uuid\n` +
    `        and day >= ($3)::date and day < ($4)::date`;
  ok("the real source contains the exact WHERE clause this control strikes (not moved/renamed)", src.includes(needle));
  const struckSrc = src.replace(needle, `      where room_id = ($1)::uuid\n        and day >= ($3)::date and day < ($4)::date`);
  ok("the strike actually changed the source (the control is not a no-op)", struckSrc !== src);

  const struckPath = join(REPO, "api", `_room-month-note.STRUCK2-${Date.now()}.mjs`);
  writeFileSync(struckPath, struckSrc);
  try {
    const struckModule = await import(pathToFileURL(struckPath).href);
    const struckNoteA = await struckModule.computeFollowerMonthNote(twoFollowerDb, {
      roomId: ROOM, followerId: FOLLOWER_A, personId: PERSON_A, agentId: AGENT, memoryConsentAt: null,
    }, MONTH_KEY);
    ok("NEGATIVE CONTROL: the struck copy (no person_id in its own WHERE) DOES leak follower B's 90 turns into follower A's own note (92, not 2)",
      struckNoteA.turns_this_month === 92, String(struckNoteA.turns_this_month));
  } finally {
    rmSync(struckPath, { force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// §6 — static: the builder's own extracted source, no import, no
// creator-lane table name. `evals/room-leak/run.mjs`'s own layer 17 restates
// this same scan as a release-gate layer; this is its home suite.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: static — the builder stands alone ──");
{
  const src = fs.readFileSync(join(REPO, "api/_room-month-note.js"), "utf8");
  const fnMatch = src.match(/export async function computeFollowerMonthNote\([\s\S]*?\n}\n/);
  ok("computeFollowerMonthNote is found in api/_room-month-note.js", Boolean(fnMatch));
  const fnBody = fnMatch ? fnMatch[0] : "";
  ok("computeFollowerMonthNote's own source contains no `import`", !/\bimport\b/.test(fnBody));
  ok("computeFollowerMonthNote's own source names no other follower-facing content column",
    !/\b(referrer_hash|phone_hash|referrer_person_id|referrer_follower_id|content|message_text|payload_text|reply_text)\b/.test(fnBody));
}

// ═════════════════════════════════════════════════════════════════════════
// §7 — payload builders: pure, content-bounded.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: payload builders ──");
{
  const note = { turns_this_month: 12, streak_days: 4, days_active_this_month: 6, threads_revisited: 2, checkins_kept: 3, remembered_things_count: 5 };
  const payload = JSON.parse(monthNotePushPayload("anjali", "Anjali", note));
  ok("monthNotePushPayload has the {t, title, body, url} contract, t: month_note",
    payload.t === "month_note" && typeof payload.title === "string" && typeof payload.body === "string" && payload.url === "/r/anjali?via=push");
  ok("monthNotePushPayload never mentions remembered_things_count on the lock screen",
    !payload.body.includes("5") || !/remember/i.test(payload.body));
  const text = followerMonthNoteTelegramText("Anjali", note);
  ok("followerMonthNoteTelegramText is a non-empty plain string carrying the turn count",
    typeof text === "string" && text.includes("12"));
}

console.log(`\nroom-month-note: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
