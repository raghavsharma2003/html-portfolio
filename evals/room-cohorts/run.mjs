// WS-R12. THE NUMBER THAT DECIDES THE COMPANY — offline, deterministic, $0.
//
//   node evals/room-cohorts/run.mjs
//
// The Rooms plan, verbatim: "Not signups, not messages, not MAU. Week-six
// retention of followers who arrived in week one. Below 25% this product does
// not work... Above 40% it is a category." Nothing measured this before
// migration 077 and api/_room-cohorts.js existed. This suite proves four
// things, each a separate section below:
//
//   §1 THE WRITE. `roomSay` (api/_room-surface.js) upserts one row into
//      `vy_room_follower_day` per accepted turn — an increment, never a
//      message — gated on the migration having landed, and skipped silently
//      (not a 500) when it has not.
//   §2 THE FORGET. `roomForget`'s explicit room_id+person_id delete reaches
//      the same table, gated the same way.
//   §3 THE MATH. `cohortRow`/`verdictFor` (api/_room-cohorts.js), pure
//      functions, driven with the exact counts the workstream brief names: a
//      2-week cohort (not measurable), a 7-week cohort at 3/10 (30%), an
//      8-week cohort at 5/10 (50%), and paid-conversion arithmetic.
//   §4 THE READ. `roomFollowerCohorts`/`readOwnedRoomCohorts` driven through a
//      small fake db that returns fixture counts, proving the assembly is
//      correct end to end and that ownership scoping still answers "not
//      yours" and "does not exist" identically.
//   §5 CONTENT-FREE, NEGATIVE CONTROL. The migration's own column list is
//      read and asserted against an allow-list; a fixture copy of the DDL
//      with an added text column MUST fail the same assertion, proving the
//      checker is not vacuous (`sound-gate-proved-by-silence`,
//      context/rejected.md).
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOM_ID, SLUG, loadFixtureAgent, freshState, fakeDb, fakeMemory } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomSay, roomForget } = room;
const cohorts = await import(pathToFileURL(join(REPO, "api/_room-cohorts.js")).href);
const {
  DAY_MS,
  WEEK_MS,
  isoWeekStart,
  isoWeekLabel,
  cohortRow,
  verdictFor,
  roomFollowerCohorts,
  readOwnedRoomCohorts,
} = cohorts;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "same idea, one step further out.";
const personTables = async () => [];
const USER_A = "11111111-1111-4111-8111-111111111111";
const PERSON_A = "aa111111-1111-4111-8111-111111111111";

/** Wraps the shared `evals/room/fixtures.mjs` fake db with the one table it
 *  does not know about — `vy_room_follower_day` — rather than editing the
 *  shared fixture, which `evals/room-leak/run.mjs` also depends on.
 *  Everything else is delegated unchanged. */
function withDayTable(baseDb, state) {
  state.followerDays = state.followerDays || [];
  const calls = [];
  const wrapped = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("insert into vy_room_follower_day")) {
      const [roomId, personId, day] = params.map(String);
      let row = state.followerDays.find(
        (d) => d.room_id === roomId && d.person_id === personId && d.day === day,
      );
      if (row) row.turns += 1;
      else {
        row = { room_id: roomId, person_id: personId, day, turns: 1 };
        state.followerDays.push(row);
      }
      return [{ ...row }];
    }
    if (sql.includes("delete from vy_room_follower_day")) {
      const [roomId, personId] = params.map(String);
      const gone = state.followerDays.filter((d) => d.room_id === roomId && d.person_id === personId);
      state.followerDays = state.followerDays.filter((d) => !gone.includes(d));
      return gone.map(() => ({ gone: 1 }));
    }
    return baseDb(sql, params);
  };
  wrapped.calls = calls;
  return wrapped;
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: THE WRITE — one upsert per accepted turn, gated ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = withDayTable(fakeDb(state), state);
  const day1 = new Date("2026-09-03T10:00:00.000Z").getTime();
  const depsFor = (now, tableApplied) => ({
    loadAgent,
    engine,
    reply,
    personTables,
    memory: fakeMemory([]),
    now,
    tableApplied,
  });

  const gateOpen = async () => true;
  const gateClosed = async () => false;

  // `iat` freezes at join time and the session's 12h TTL never refreshes on a
  // turn (it carries the original payload forward unchanged), so a turn a day
  // later is, correctly, a re-open with a fresh session — exactly what a real
  // client does when `room_session_expired` comes back.
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true },
    { loadAgent, now: day1 },
  );

  await roomSay(db, { session: joined.session, message: "one" }, depsFor(day1, gateOpen));
  ok("turn 1: exactly one day row exists", state.followerDays.length === 1);
  ok("turn 1: the row is content-free — room id, person id, day, an integer, nothing else",
    Object.keys(state.followerDays[0]).sort().join(",") === "day,person_id,room_id,turns");
  ok("turn 1: turns = 1", state.followerDays[0].turns === 1);
  ok("turn 1: the bound params carry no message text",
    !db.calls.some((c) => c.sql.includes("insert into vy_room_follower_day") &&
      c.params.some((p) => String(p).includes("one"))));

  await roomSay(db, { session: joined.session, message: "two" }, depsFor(day1 + 60_000, gateOpen));
  ok("turn 2, same day: incremented in place, not a second row",
    state.followerDays.length === 1 && state.followerDays[0].turns === 2);

  const day2 = day1 + DAY_MS;
  const reopened = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true },
    { loadAgent, now: day2 },
  );
  await roomSay(db, { session: reopened.session, message: "three" }, depsFor(day2, gateOpen));
  ok("turn 3, a different day: a second row, the first untouched",
    state.followerDays.length === 2 &&
      state.followerDays.some((d) => d.turns === 2) &&
      state.followerDays.some((d) => d.turns === 1));

  const before = state.followerDays.length;
  await roomSay(db, { session: reopened.session, message: "four" }, depsFor(day2 + 1000, gateClosed));
  ok("the migration not yet landed: the write is skipped, not a 500 (the turn still succeeds)",
    state.followerDays.length === before);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: THE FORGET — roomForget's explicit delete, gated ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = withDayTable(fakeDb(state), state);
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  state.followerDays.push({ room_id: ROOM_ID, person_id: PERSON_A, day: "2026-09-03", turns: 3 });
  state.followerDays.push({ room_id: ROOM_ID, person_id: PERSON_A, day: "2026-09-04", turns: 1 });

  const receiptClosedGate = await roomForget(db, { session: joined.session }, {
    loadAgent, personTables, now: Date.now(), tableApplied: async () => false,
  });
  ok("gate closed: forget succeeds and does not count the day table at all",
    !("vy_room_follower_day" in receiptClosedGate.deleted) && state.followerDays.length === 2);

  // Re-join (the previous forget already removed the membership row, so this
  // is a fresh INSERT under the same person_id) and forget again with a fresh
  // session, this time with the gate open. The two day rows pushed above
  // were untouched by the closed-gate forget, so they are still there for
  // this one to actually reach.
  const rejoined = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  const receipt = await roomForget(db, { session: rejoined.session }, {
    loadAgent, personTables, now: Date.now(), tableApplied: async () => true,
  });
  ok("gate open: the receipt counts exactly the two day rows this follower had",
    receipt.deleted.vy_room_follower_day === 2);
  ok("gate open: the day rows are actually gone", state.followerDays.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: THE MATH — cohortRow / verdictFor, pure ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const NOW = new Date("2026-09-03T00:00:00.000Z").getTime();
  const weeksAgo = (n) => new Date(NOW - n * WEEK_MS);

  ok("isoWeekStart lands on a Monday", isoWeekStart(NOW).getUTCDay() === 1);
  ok("isoWeekLabel reads YYYY-Www", /^\d{4}-W\d{2}$/.test(isoWeekLabel(NOW)));

  const young = cohortRow({ weekStart: weeksAgo(2), now: NOW, followersJoined: 10, returnedWeek6: 0, paidFollowers: 0 });
  ok("a 2-week-old cohort is not measurable", young.measurable === false);
  ok("...and names the date it becomes measurable", typeof young.not_measurable_until === "string" && young.not_measurable_until.length === 10);
  ok("an unmeasurable cohort reports no share, not a fabricated zero", young.week6_return_share === null);

  const seven = cohortRow({ weekStart: weeksAgo(7), now: NOW, followersJoined: 10, returnedWeek6: 3, paidFollowers: 1 });
  ok("a 7-week-old cohort IS measurable", seven.measurable === true);
  ok("...3 of 10 returning is exactly 30%", seven.week6_return_share === 0.3);
  ok("...1 of 10 paid is exactly 10% conversion", seven.paid_conversion_share === 0.1);

  const eight = cohortRow({ weekStart: weeksAgo(8), now: NOW, followersJoined: 10, returnedWeek6: 5, paidFollowers: 2 });
  ok("an 8-week-old cohort IS measurable", eight.measurable === true);
  ok("...5 of 10 returning is exactly 50%", eight.week6_return_share === 0.5);
  ok("...2 of 10 paid is exactly 20% conversion", eight.paid_conversion_share === 0.2);

  const zero = cohortRow({ weekStart: weeksAgo(9), now: NOW, followersJoined: 0, returnedWeek6: 0, paidFollowers: 0 });
  ok("a cohort with no followers reports no share rather than dividing by zero",
    zero.week6_return_share === null && zero.paid_conversion_share === null);

  // The verdict bands, at the OLDEST measurable cohort.
  const v30 = verdictFor([young, seven, eight]);
  ok("verdict picks the OLDEST measurable cohort (8 weeks, not 7)", v30.cohort_week === eight.cohort_week);
  ok("50% is above the category floor", v30.verdict === "above_40");

  const below = cohortRow({ weekStart: weeksAgo(7), now: NOW, followersJoined: 10, returnedWeek6: 1, paidFollowers: 0 });
  ok("10% (below the Phase 0 floor) verdicts below_25", verdictFor([below]).verdict === "below_25");

  const between = cohortRow({ weekStart: weeksAgo(7), now: NOW, followersJoined: 10, returnedWeek6: 3, paidFollowers: 0 });
  ok("30% (Phase 0 pass, short of the category) verdicts between_25_and_40",
    verdictFor([between]).verdict === "between_25_and_40");

  ok("no measurable cohort yet: an honest 'not measurable yet', never a guess",
    verdictFor([young]).verdict === "not_measurable_yet" && verdictFor([]).verdict === "not_measurable_yet");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: THE READ — roomFollowerCohorts / readOwnedRoomCohorts ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const NOW = new Date("2026-09-03T00:00:00.000Z").getTime();
  const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const REPLICA_ID = "c1000000-0000-4000-8000-000000000001";
  const publishedAt = new Date(NOW - 8 * WEEK_MS - DAY_MS).toISOString();
  const room = { room_id: ROOM_ID, created_at: publishedAt, published_at: publishedAt };

  // A minimal aggregate-shaped fake: every call is inspected structurally
  // (never selects a person's own column, matches the real predicate shape),
  // and answers with fixture counts keyed on which week the WHERE clause's
  // date range names — the oldest cohort (week 0, 8+ weeks old) gets 5/10
  // paid 2, everything else gets 0.
  const calls = [];
  const readDb = async (sql, params = []) => {
    calls.push({ sql, params });
    ok("every §4 statement selects only count() expressions",
      /^\s*select\s+count\(/i.test(sql.replace(/\n/g, " ").trim()) || sql.includes("from vy_room\n"),
    );
    if (sql.includes("from vy_room\n") || /from vy_room\s+where/i.test(sql)) {
      // the owner lookup
      if (String(params[0]) === OWNER.toLowerCase() && String(params[1]) === REPLICA_ID.toLowerCase()) {
        return [{ room_id: ROOM_ID, created_at: publishedAt, published_at: publishedAt }];
      }
      return [];
    }
    const weekStart = new Date(params[1]);
    const isOldestWeek = weekStart.getTime() === isoWeekStart(publishedAt).getTime();
    if (sql.includes("returned_week6")) {
      return [{ returned_week6: isOldestWeek ? 5 : 0 }];
    }
    return [{ followers_joined: isOldestWeek ? 10 : 0, paid_followers: isOldestWeek ? 2 : 0 }];
  };

  const rows = await roomFollowerCohorts(readDb, room, { now: NOW });
  ok("one row per ISO week from the room's published_at through now",
    rows.length === Math.floor((NOW - isoWeekStart(publishedAt).getTime()) / WEEK_MS) + 1);
  const oldest = rows[0];
  ok("the oldest cohort's numbers match the fixture: 5/10 = 50%", oldest.week6_return_share === 0.5);
  ok("...and 2/10 paid = 20% conversion", oldest.paid_conversion_share === 0.2);
  ok("a week with zero followers reports zero, not a gap", rows.some((r) => r.followers_joined === 0));

  const owned = await readOwnedRoomCohorts(readDb, OWNER, REPLICA_ID, { now: NOW });
  ok("readOwnedRoomCohorts returns the same cohort table plus a verdict",
    Array.isArray(owned.cohorts) && owned.cohorts.length === rows.length && typeof owned.verdict === "object");
  ok("the verdict is above_40 for this fixture's oldest cohort", owned.verdict.verdict === "above_40");

  const notOwner = await readOwnedRoomCohorts(readDb, "99999999-9999-4999-8999-999999999999", REPLICA_ID, { now: NOW });
  ok("a replica that is not this owner's answers null, same as 'does not exist'", notOwner === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: CONTENT-FREE — the migration's own column list ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const ALLOWED = new Set(["room_id", "person_id", "day", "turns"]);
  // Splits on top-level commas only (`evals/room-leak/run.mjs`'s own method):
  // `primary key (room_id, person_id, day)` is ONE clause, not three, so a
  // naive `.split(",")` would misread its inner commas as new column lines.
  function tableColumns(sql, tableName) {
    const re = new RegExp(`create table if not exists ${tableName} \\(([\\s\\S]*?)\\n\\);`);
    const m = sql.match(re);
    if (!m) return null;
    const body = m[1];
    const lines = [];
    let depth = 0, cur = "";
    for (const ch of body) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { lines.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) lines.push(cur);
    return lines
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^primary key/i.test(l))
      .map((l) => l.split(/\s+/)[0]);
  }

  const migrationSrc = fs.readFileSync(join(REPO, "db/migrations/077_room_cohorts.sql"), "utf8");
  const cols = tableColumns(migrationSrc, "vy_room_follower_day");
  ok("the migration's CREATE TABLE was found and parsed", Array.isArray(cols) && cols.length > 0, cols?.join(","));
  const disallowed = (cols || []).filter((c) => !ALLOWED.has(c));
  ok("vy_room_follower_day has no column beyond room_id/person_id/day/turns",
    disallowed.length === 0, disallowed.join(","));

  const schemaSrc = fs.readFileSync(join(REPO, "db/schema.sql"), "utf8");
  const schemaCols = tableColumns(schemaSrc, "vy_room_follower_day");
  ok("db/schema.sql's mirror carries the identical column list",
    JSON.stringify(schemaCols) === JSON.stringify(cols));

  // NEGATIVE CONTROL. A day table with a text column MUST fail the same
  // assertion — proving the checker actually looks, rather than always
  // passing (`sound-gate-proved-by-silence`, context/rejected.md).
  const poisoned = `create table if not exists vy_room_follower_day (
  room_id   uuid not null references vy_room(room_id) on delete cascade,
  person_id uuid not null,
  day       date not null,
  turns     integer not null default 0 check (turns >= 0),
  message   text,
  primary key (room_id, person_id, day)
);`;
  const poisonedCols = tableColumns(poisoned, "vy_room_follower_day");
  const poisonedBad = (poisonedCols || []).filter((c) => !ALLOWED.has(c));
  ok("NEGATIVE CONTROL: a day table with a message column IS caught",
    poisonedBad.length === 1 && poisonedBad[0] === "message");
}

console.log(`\nroom-cohorts: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
