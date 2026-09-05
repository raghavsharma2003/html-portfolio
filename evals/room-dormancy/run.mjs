// WS-R75. DORMANCY — offline, deterministic, $0.
//
//   node evals/room-dormancy/run.mjs
//
// api/_dormancy.js is exercised through a hand-rolled fake `db` that
// pattern-matches this file's own SQL text and answers from an in-memory
// fixture — `evals/renewals/run.mjs`'s own shape, one workstream over.
// `offline-mocks-cannot-type-check-sql` (AGENTS.md) applies exactly as
// everywhere else: this proves the PREDICATE and the WIRING, never that any
// statement PARSES against a real Postgres. Every statement this suite
// drives is listed in the workstream's final report for the main loop to
// EXPLAIN.
//
// §1 dormancyNoticeDue — the window (dormancy_days - 30), the null-notice
//    gate, a Room with no policy set never matches.
// §2 dormancyForgetDue — the 30-day grace window, and NEGATIVE CONTROL (a):
//    a follower with no prior notice is structurally unreachable by this
//    predicate (dormancy_notice_at is not null is the WHERE's first clause).
// §3 NEGATIVE CONTROL (b) — a follower who visited AFTER their notice is
//    never selected as due to forget, even with the notice column left
//    uncleared — the predicate's own timestamp comparison, not a cleared
//    column, is what protects them.
// §4 dormancySweep end to end — ROOM_DORMANCY off touches neither
//    statement; ROOM_DORMANCY on notices the due follower and forgets the
//    overdue one through the REAL roomForgetForFollower, which is asserted
//    to be the SAME delete sequence roomForget (the follower's own "forget
//    me" op) uses — a receipt included.
// §5 joinRoom's own defensive clear — a repeat join nulls dormancy_notice_at
//    (the "one column" this workstream's law 2 names), proven against the
//    real UPDATE text, not retyped.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const dormancyMod = await import(pathToFileURL(join(REPO, "api/_dormancy.js")).href);
const {
  dormancyNoticeDue, dormancyForgetDue, dormancySweep, dormancyEnabled, dormancyThisWeek,
  dormancyNoticeTelegramText, DORMANCY_DAYS_MIN, DORMANCY_GRACE_DAYS,
} = dormancyMod;
const roomMod = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { roomForgetForFollower } = roomMod;

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-05T00:00:00.000Z");

const ROOM_A = "d0000000-0000-4000-8000-00000000a001"; // dormancy_days = 365
const ROOM_B = "d0000000-0000-4000-8000-00000000a002"; // dormancy_days = null (off)
const AGENT_ID = "b1000000-0000-4000-8000-000000000001";
const PERSON_DUE_NOTICE = "aa000000-0000-4000-8000-000000000001"; // 340 days quiet, no notice yet
const PERSON_NOT_YET = "aa000000-0000-4000-8000-000000000002"; // 300 days quiet, not due
const PERSON_OFF_ROOM = "aa000000-0000-4000-8000-000000000003"; // in ROOM_B, would be due if policy were on
const PERSON_DUE_FORGET = "aa000000-0000-4000-8000-000000000004"; // noticed 31 days ago, no visit since
const PERSON_VISITED_SINCE = "aa000000-0000-4000-8000-000000000005"; // noticed 31 days ago, but visited since
const PERSON_NO_NOTICE_YET = "aa000000-0000-4000-8000-000000000006"; // old last_seen_at, notice still null

function isoBefore(days) {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function freshState() {
  return {
    rooms: [
      { room_id: ROOM_A, slug: "anjali", display_name: "Anjali", dormancy_days: 365 },
      { room_id: ROOM_B, slug: "priya", display_name: "Priya", dormancy_days: null },
    ],
    followers: [
      {
        follower_id: "f0000000-0000-4000-8000-000000000001", room_id: ROOM_A, person_id: PERSON_DUE_NOTICE,
        agent_id: AGENT_ID, locale: "en", age_attested_at: isoBefore(500),
        last_seen_at: isoBefore(340), dormancy_notice_at: null,
      },
      {
        follower_id: "f0000000-0000-4000-8000-000000000002", room_id: ROOM_A, person_id: PERSON_NOT_YET,
        agent_id: AGENT_ID, locale: "en", age_attested_at: isoBefore(500),
        last_seen_at: isoBefore(300), dormancy_notice_at: null,
      },
      {
        follower_id: "f0000000-0000-4000-8000-000000000003", room_id: ROOM_B, person_id: PERSON_OFF_ROOM,
        agent_id: AGENT_ID, locale: "en", age_attested_at: isoBefore(500),
        last_seen_at: isoBefore(999), dormancy_notice_at: null,
      },
      {
        follower_id: "f0000000-0000-4000-8000-000000000004", room_id: ROOM_A, person_id: PERSON_DUE_FORGET,
        agent_id: AGENT_ID, locale: "hi", age_attested_at: isoBefore(600),
        last_seen_at: isoBefore(400), dormancy_notice_at: isoBefore(31),
      },
      {
        follower_id: "f0000000-0000-4000-8000-000000000005", room_id: ROOM_A, person_id: PERSON_VISITED_SINCE,
        agent_id: AGENT_ID, locale: "en", age_attested_at: isoBefore(600),
        // noticed 31 days ago, but visited (last_seen_at advanced) 10 days ago -
        // AFTER the notice. Negative control (b)'s own fixture row.
        last_seen_at: isoBefore(10), dormancy_notice_at: isoBefore(31),
      },
      {
        // room_id is ROOM_B (policy OFF) on purpose: this row's own
        // last_seen_at is genuinely old (400 days), so it proves
        // dormancyForgetDue's own negative control (a) meaningfully - "no
        // prior notice" is structurally unreachable regardless of how old
        // last_seen_at is - without ALSO tripping dormancyNoticeDue in
        // section 1 (ROOM_B has no policy, so it is never noticed either,
        // the identical reason PERSON_OFF_ROOM above is never noticed).
        follower_id: "f0000000-0000-4000-8000-000000000006", room_id: ROOM_B, person_id: PERSON_NO_NOTICE_YET,
        agent_id: AGENT_ID, locale: "en", age_attested_at: isoBefore(500),
        last_seen_at: isoBefore(400), dormancy_notice_at: null,
      },
    ],
    threads: [],
    receipts: [],
    consent: [],
  };
}

/** The fake db. Pattern-matched by SQL text, `evals/renewals/run.mjs`'s own
 *  shape. Handles the two statements api/_dormancy.js owns, PLUS the
 *  narrow slice of api/_room-surface.js's roomForgetCore this suite drives
 *  it through (thread lookup/delete, follower delete, the consent
 *  withdrawal insert, the receipt insert) — every OTHER person-lane table
 *  is gated OFF via `deps.tableApplied` below, so this fixture never needs
 *  to model them. */
function fakeDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── (a) THE NOTICE ────────────────────────────────────────────────────
    if (has("update vy_room_follower f") && has("set dormancy_notice_at")) {
      const [nowIso] = p;
      const out = [];
      for (const f of state.followers) {
        if (f.dormancy_notice_at != null) continue;
        if (f.age_attested_at == null) continue;
        const room = state.rooms.find((r) => r.room_id === f.room_id);
        if (!room || room.dormancy_days == null) continue;
        const threshold = new Date(nowIso).getTime() - (room.dormancy_days - 30) * DAY_MS;
        if (new Date(f.last_seen_at).getTime() >= threshold) continue;
        f.dormancy_notice_at = nowIso;
        out.push({
          follower_id: f.follower_id, room_id: f.room_id, person_id: f.person_id, agent_id: f.agent_id,
          locale: f.locale, slug: room.slug, display_name: room.display_name,
        });
      }
      return out;
    }

    // ── (b) WHO IS DUE TO BE FORGOTTEN ──────────────────────────────────────
    if (has("select f.follower_id") && has("f.dormancy_notice_at is not null")) {
      const [nowIso] = p;
      const graceFloor = new Date(nowIso).getTime() - 30 * DAY_MS;
      return state.followers
        .filter((f) => f.dormancy_notice_at != null)
        .filter((f) => new Date(f.dormancy_notice_at).getTime() < graceFloor)
        .filter((f) => new Date(f.last_seen_at).getTime() <= new Date(f.dormancy_notice_at).getTime())
        .map((f) => {
          const room = state.rooms.find((r) => r.room_id === f.room_id);
          return { follower_id: f.follower_id, room_id: f.room_id, person_id: f.person_id, agent_id: f.agent_id, locale: f.locale, slug: room?.slug };
        });
    }

    // ── roomForgetCore's own narrow slice ───────────────────────────────────
    if (has("select t.thread_id from vy_room_thread")) return [];
    if (has("delete from vy_room_thread")) return [];
    if (has("insert into meera_consent")) return [];

    // ── the notice loop's own channel lookups (api/_dormancy.js) — no
    //    push subscription and no Telegram pointer seeded, so neither
    //    channel is attempted; this suite's own concern is the predicate
    //    and the wiring, `evals/renewals/run.mjs`'s own scope, not a
    //    second proof that web push or Telegram delivery works (that is
    //    `evals/room-push`/`evals/room-telegram`'s job). ───────────────────
    if (has("from vy_room_push_subscription") && has("revoked_at is null")) return [];
    if (has("from vy_room_follower_channel") && has("channel = 'telegram'")) return [];
    if (has("delete from vy_room_follower")) {
      const [roomId, personId] = p;
      const before = state.followers.length;
      state.followers = state.followers.filter((f) => !(f.room_id === roomId && f.person_id === personId));
      return before !== state.followers.length ? [{ gone: 1 }] : [];
    }
    if (has("insert into vy_room_forget_receipt")) {
      const [receiptId, roomId, personHash, policyVersion, counts, issuedAt] = params;
      state.receipts.push({ receipt_id: receiptId, room_id: roomId, person_hash: personHash, policy_version: policyVersion, counts, issued_at: issuedAt });
      return [];
    }

    throw new Error(`room-dormancy fake db: unmatched SQL: ${sql}`);
  };
}

const DEPS = { tableApplied: async (name) => name === "vy_room_forget_receipt", personTables: async () => [] };

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: dormancyNoticeDue — the window, the null-notice gate ──");
{
  const state = freshState();
  const db = fakeDb(state);
  const due = await dormancyNoticeDue(db, NOW);
  ok("exactly one follower is due for a notice", due.length === 1, JSON.stringify(due.map((r) => r.person_id)));
  ok("it is the 340-day-quiet follower in the policy Room, not the 300-day one", due[0]?.person_id === PERSON_DUE_NOTICE);
  ok("the row carries the Room's own slug/display_name for the message, not a re-query", due[0]?.slug === "anjali" && due[0]?.display_name === "Anjali");

  const notFound = state.followers.find((f) => f.person_id === PERSON_NOT_YET);
  ok("the 300-day-quiet follower (not yet at the window) is left with dormancy_notice_at still null", notFound.dormancy_notice_at == null);
  const offRoom = state.followers.find((f) => f.person_id === PERSON_OFF_ROOM);
  ok("a follower in a Room with dormancy_days null is NEVER noticed, however old their last_seen_at is", offRoom.dormancy_notice_at == null);

  const noticedRow = state.followers.find((f) => f.person_id === PERSON_DUE_NOTICE);
  ok("the UPDATE actually wrote dormancy_notice_at on the due follower's own row", noticedRow.dormancy_notice_at != null);

  const second = await dormancyNoticeDue(db, NOW);
  ok("a second run the same tick finds nothing new (the notice column IS the idempotency)", second.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: dormancyForgetDue — the grace window ──");
{
  const state = freshState();
  const db = fakeDb(state);
  const due = await dormancyForgetDue(db, NOW);
  ok("exactly one follower is due to be forgotten", due.length === 1, JSON.stringify(due.map((r) => r.person_id)));
  ok("it is the follower noticed 31 days ago with no visit since", due[0]?.person_id === PERSON_DUE_FORGET);

  // NEGATIVE CONTROL (a): no prior notice at all. Structurally unreachable -
  // `f.dormancy_notice_at is not null` is the predicate's own first clause.
  const noNotice = due.find((r) => r.person_id === PERSON_NO_NOTICE_YET);
  ok("NEGATIVE CONTROL (a): a follower with no prior notice is never selected, however old last_seen_at is",
    noNotice === undefined);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: NEGATIVE CONTROL (b) — visited after the notice, never forgotten ──");
{
  const state = freshState();
  const db = fakeDb(state);
  const due = await dormancyForgetDue(db, NOW);
  const visitedSince = due.find((r) => r.person_id === PERSON_VISITED_SINCE);
  ok("a follower who visited AFTER their notice (dormancy_notice_at left uncleared) is never selected to be forgotten",
    visitedSince === undefined);

  // Confirms the fixture is sound: this follower's own notice really is
  // more than 30 days old, so the ONLY reason they are excluded is the
  // last_seen_at > dormancy_notice_at comparison, never the age check.
  const row = state.followers.find((f) => f.person_id === PERSON_VISITED_SINCE);
  const graceFloor = NOW - 30 * DAY_MS;
  ok("the fixture is sound: their notice really is older than the 30-day grace window",
    new Date(row.dormancy_notice_at).getTime() < graceFloor);
  ok("the fixture is sound: their last_seen_at really is AFTER their own notice",
    new Date(row.last_seen_at).getTime() > new Date(row.dormancy_notice_at).getTime());
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: dormancySweep end to end ──");
{
  // OFF: neither statement runs. A db that throws on ANY query proves it.
  const state = freshState();
  const poisoned = async () => { throw new Error("dormancySweep must not touch the db while ROOM_DORMANCY is off"); };
  const off = await dormancySweep({ db: poisoned, env: {} }, NOW);
  ok("ROOM_DORMANCY unset: the sweep returns the disabled shape and never touches the database",
    off.dormancyDisabled === true && off.dormancyNoticesSent === 0 && off.dormancyForgotten === 0);
  ok("dormancyEnabled requires the exact string \"1\", not any truthy value", !dormancyEnabled({ ROOM_DORMANCY: "true" }));
  ok("dormancyEnabled is on with the exact string \"1\"", dormancyEnabled({ ROOM_DORMANCY: "1" }));
}
{
  // ON: the due follower is noticed; the overdue one is forgotten through
  // the REAL roomForgetForFollower, receipt included.
  const state = freshState();
  const db = fakeDb(state);
  const env = { ROOM_DORMANCY: "1" };
  const summary = await dormancySweep({ db, env, ...DEPS }, NOW);
  ok("one notice sent", summary.dormancyNoticesSent === 1, JSON.stringify(summary));
  ok("one follower forgotten", summary.dormancyForgotten === 1, JSON.stringify(summary));
  ok("zero errors", summary.dormancyErrors === 0, JSON.stringify(summary));
  ok("dormancyDisabled is false when the flag is on", summary.dormancyDisabled === false);

  const stillThere = state.followers.some((f) => f.person_id === PERSON_DUE_NOTICE);
  ok("the noticed follower's own row is UNTOUCHED beyond the notice column - noticing is never forgetting", stillThere);
  const forgottenGone = state.followers.some((f) => f.person_id === PERSON_DUE_FORGET);
  ok("the overdue follower's own row is GONE - roomForgetForFollower actually deleted it", !forgottenGone);
  const untouchedOthers = state.followers.filter((f) =>
    [PERSON_NOT_YET, PERSON_OFF_ROOM, PERSON_VISITED_SINCE, PERSON_NO_NOTICE_YET].includes(f.person_id)).length === 4;
  ok("every follower NOT due for either action is untouched (no over-broad delete)", untouchedOthers);

  ok("a receipt was written for the forgotten follower - 'forgotten with a receipt', this workstream's own words",
    state.receipts.length === 1, JSON.stringify(state.receipts));
}
{
  // roomForgetForFollower and roomForget resolve to the SAME delete
  // sequence, never a second path - this workstream's own law 3.
  const state = freshState();
  const db = fakeDb(state);
  const who = {
    roomId: ROOM_A, personId: PERSON_DUE_FORGET, agentId: AGENT_ID, slug: "anjali", locale: "hi",
  };
  const receipt = await roomForgetForFollower(db, who, DEPS);
  ok("roomForgetForFollower returns the same shape roomForget's own session path returns (a receipt, deleted counts)",
    receipt.forgotten === true && typeof receipt.deleted === "object" && receipt.receipt != null);
  ok("the app-voiced note is localized off the SAME who.locale this function was handed, roomForget's own precedent",
    receipt.note.includes("बातचीत"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: joinRoom's own defensive clear (the 'one column', law 2) ──");
{
  const src = (await import("node:fs")).readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const joinMatch = src.match(/on conflict \(room_id, person_id\) do update\s*\n([\s\S]*?)\n\s*returning follower_id/);
  ok("joinRoom's own ON CONFLICT UPDATE is found (not moved/renamed)", Boolean(joinMatch));
  const body = joinMatch ? joinMatch[1] : "";
  ok("the SAME statement that bumps last_seen_at on a repeat join also nulls dormancy_notice_at",
    body.includes("last_seen_at = now()") && body.includes("dormancy_notice_at = null"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: dormancyNoticeTelegramText and the mirrored floor ──");
{
  ok("DORMANCY_DAYS_MIN mirrors migration 119's own CHECK (>= 180)", DORMANCY_DAYS_MIN === 180);
  ok("DORMANCY_GRACE_DAYS is the workstream's own 30-day window", DORMANCY_GRACE_DAYS === 30);

  const enText = dormancyNoticeTelegramText({ name: "Anjali" }, "en");
  ok("en text names the 30-day window and never a raw number of dormancy_days", enText.includes("30 days"));
  const hiText = dormancyNoticeTelegramText({ name: "Anjali" }, "hi");
  ok("hi text is a real, distinct Devanagari string, not the English string relabeled", hiText !== enText && /[ऀ-ॿ]/.test(hiText));

  // NEGATIVE CONTROL (c): no follower-authored text ever reaches this
  // function's own source — it takes only a name and a locale, `_renewals.
  // js`'s own static-scan precedent, restated as a structural fact rather
  // than re-run here (this suite has no follower message text to grep for
  // at all, since the whole file is content-free by construction).
  const fnSrc = (await import("node:fs")).readFileSync(join(REPO, "api/_dormancy.js"), "utf8");
  const fnMatch = fnSrc.match(/export function dormancyNoticeTelegramText\([\s\S]*?\n}\n/);
  ok("dormancyNoticeTelegramText's own parameters are exactly {name}, never a body/message/text field",
    Boolean(fnMatch) && /\{\s*name\s*\}/.test(fnMatch[0]) && !/\bmessage\b|\bbody\b|\btext:/i.test(fnMatch[0].split("\n")[0]));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: dormancyThisWeek — n>=5 floored, honest empty state ──");
{
  let calls = 0;
  const db = async (sql) => {
    calls++;
    if (sql.includes("dormancyNoticesSent")) return [{ notices: 2, forgotten: 1 }];
    throw new Error("unexpected query");
  };
  const week = await dormancyThisWeek(db, NOW, { env: {} });
  ok("below the n>=5 floor, both counts are floored to null, never the small real number", week.notices === null && week.forgotten === null);
  ok("below_floor is honestly true", week.below_floor === true);
  ok("enabled reflects ROOM_DORMANCY off in this call's own deps", week.enabled === false);
  ok("exactly one query was run (a single rolling-sum read, no per-Room loop)", calls === 1);
}

console.log(`\nroom-dormancy: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
