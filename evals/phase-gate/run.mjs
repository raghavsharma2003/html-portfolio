// WS-R30. THE CONVERSION MOMENT, AND THE THREE PHASE 2 NUMBERS — offline,
// deterministic, $0.
//
//   node evals/phase-gate/run.mjs
//
// api/_phase-gate.js (migration 093, `vy_room_upgrade_offer`) is exercised
// through a hand-written fake `db` that pattern-matches this file's own SQL
// text and answers from an in-memory fixture — the same shape every sibling
// suite in this repo uses (`evals/room-cohorts/run.mjs`'s `withDayTable`,
// `evals/room-export/run.mjs`'s own wrapper). `offline-mocks-cannot-type-
// check-sql` (AGENTS.md) applies here exactly as everywhere else: this
// proves the PREDICATE and the WIRING, never that any statement PARSES
// against a real Postgres. Every statement this suite drives is listed in
// the workstream's final report for the main loop to EXPLAIN.
//
// §1 sessionWorked — the 30-minute-gap session count, each of the three
//    clauses tested to fail independently, plus the happy path.
// §2 recordOffer — the 14-day cooldown IS the write (INSERT...WHERE NOT
//    EXISTS), boundary-tested.
// §3 markOfferOutcome — the most recent OPEN offer only, never an already-
//    resolved one, never a different follower's.
// §4 conversionReport — the ratio and the funnel, pure arithmetic over
//    fixture counts.
// §5 renewedUnasked — the honest zero, and the note.
// §6 phaseGate — composition: below / at_or_above / not_enough_data, and the
//    one sentence.
// §7 roomSay integration — `offer` rides on a real turn through the real
//    follower lane; the cap-reached path records an offer on refusal too.
// §8 the payments webhook — the inline `offer_update` CTE marks 'paid',
//    gated on the table's own migration.
// NEGATIVE CONTROLS: (a) a sessionWorked-shaped select that reads a message
// BODY column is caught by room-leak's own aggregate-only parser, copied
// inline (that file exports no entry point, by design — the same reason
// every other suite that reuses this parser copies it); (b) a second offer
// inside 14 days never inserts; (c) the reply bytes are byte-identical with
// and without an offer attached.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadFixtureAgent, freshState, fakeDb, fakeMemory, SLUG, ROOM_ID } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "p".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const pg = await import(pathToFileURL(join(REPO, "api/_phase-gate.js")).href);
const {
  sessionWorked, recordOffer, markOfferOutcome, conversionReport, renewedUnasked, phaseGate,
  SESSION_MIN_MESSAGES, SESSION_GAP_MINUTES, OFFER_COOLDOWN_DAYS,
  PAID_CONVERSION_FLOOR_PCT, PHASE2_FLOOR_PCT, MIN_FOLLOWERS_FOR_DATA, MIN_CREATORS_FOR_DATA,
  RENEWED_UNASKED_TARGET, PhaseGateError,
} = pg;
const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomSay, roomDismissOffer, readRoomSession, roomThreadDevice, createThread } = room;
const payments = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const { applyWebhook } = payments;
const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "same idea, one step further out.";
const personTables = async () => [];

const ROOM = { room_id: ROOM_ID, free_monthly_messages: 20, paid_monthly_messages: 500 };
const PERSON = "aa111111-1111-4111-8111-111111111111";
const AGENT = "b0000000-0000-4000-8000-000000000001";
const THREAD = "70000000-0000-4000-a000-00000000dead";
const FOLLOWER = "60000000-0000-4000-a000-00000000beef";
const DEVICE = roomThreadDevice(ROOM_ID, PERSON, THREAD);

// ═════════════════════════════════════════════════════════════════════════
// A hand-rolled fake db — this suite's own, not the shared `evals/room/
// fixtures.mjs` one, exactly `evals/room-cohorts/run.mjs`'s `withDayTable`
// precedent: a new table/shape gets a NEW small wrapper rather than a shared
// file edited under one suite's own assumptions.
// ═════════════════════════════════════════════════════════════════════════

/** Mirrors `sessionWorked`'s own SQL, by hand, over fixture rows — NOT a
 *  second implementation asserted equal to the first (that would prove
 *  nothing but that two copies of the same bug agree); every case below is
 *  picked so the RIGHT ANSWER is checkable by inspection of the timestamps
 *  alone, and the assertions below check that answer, not this function's
 *  own output. */
function computeSession(meeraLog, { personId, agentId, deviceId }) {
  const lane = meeraLog
    .filter((m) => m.speaker_person_id === personId && m.agent_id === agentId && m.device_id === deviceId && m.role === "me")
    .map((m) => m.at)
    .sort((a, b) => a - b);
  let sessionStart = -Infinity;
  for (let i = 1; i < lane.length; i++) {
    if (lane[i] - lane[i - 1] > SESSION_GAP_MINUTES * 60_000) sessionStart = lane[i];
  }
  const sessionMsgs = lane.filter((t) => t >= sessionStart);
  return { count: sessionMsgs.length, last: sessionMsgs.length ? Math.max(...sessionMsgs) : null };
}

/** The one row `sessionWorked`'s real SQL returns, computed by hand over
 *  fixture rows. Shared between §1's own small fixture and §7's real
 *  follower-lane fixture, so the two never define "worked" two different
 *  ways. `meeraLog` is passed separately from `state` because §7's own
 *  private message lane is populated by intercepting `memory.logTurn`
 *  (`evals/room/fixtures.mjs`'s shared `fakeDb` knows nothing about
 *  `meera_log`), never by `state` itself. */
function sessionWorkedRow({ rooms, followers, threads, followerDays, meeraLog }, params) {
  const [roomId, personId, threadId, deviceId, agentId, nowIso] = params;
  const follower = followers.find((f) => f.room_id === roomId && f.person_id === personId);
  const roomRow = rooms.find((r) => r.room_id === roomId);
  const thread = threads.find((t) => t.thread_id === threadId && t.room_id === roomId && t.person_id === personId);
  const now = new Date(nowIso).getTime();
  const included = follower
    ? (follower.tier === "paid" ? roomRow.paid_monthly_messages : roomRow.free_monthly_messages)
    : null;
  const used = follower ? follower.month_message_count : null;
  const remaining = Math.max((included ?? 0) - (used ?? 0), 0);
  const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
  const thisMonth = monthOf(now);
  const byMonth = {};
  for (const d of followerDays) {
    if (d.room_id !== roomId || d.person_id !== personId) continue;
    const m = d.day.slice(0, 7);
    if (m === thisMonth) continue;
    byMonth[m] = (byMonth[m] || 0) + d.turns;
  }
  const hitCapBefore = Object.values(byMonth).some((sum) => sum >= (included ?? Infinity));
  const threadCreated = thread ? thread.created_at : null;
  const today = new Date(now).toISOString().slice(0, 10);
  const continuedFromEarlierDay = threadCreated != null && threadCreated.slice(0, 10) < today;
  const session = computeSession(meeraLog, { personId, agentId, deviceId });
  const worked =
    follower?.tier === "free" &&
    session.count >= SESSION_MIN_MESSAGES &&
    continuedFromEarlierDay &&
    (remaining < 5 || hitCapBefore);
  return {
    tier: follower?.tier ?? null,
    messages_used: used,
    messages_included: included,
    messages_remaining: remaining,
    hit_cap_before: hitCapBefore,
    thread_continued_from_earlier_day: continuedFromEarlierDay,
    session_message_count: session.count,
    session_last_at: session.last ? new Date(session.last).toISOString() : null,
    worked,
  };
}

function phaseGateDb(state) {
  return async (sql, params = []) => {
    // §sessionWorked's one big statement.
    if (sql.includes("from follower_scope fs, thread_scope ts, cap_history ch")) {
      return [sessionWorkedRow(state, params)];
    }
    // §recordOffer.
    if (sql.includes("insert into vy_room_upgrade_offer")) {
      const [offerId, roomId, personId, followerId, reason, nowIso] = params;
      const cooldownDays = params[6];
      const now = new Date(nowIso).getTime();
      const withinWindow = state.offers.some(
        (o) => o.follower_id === followerId && now - new Date(o.shown_at).getTime() < cooldownDays * 86_400_000,
      );
      if (withinWindow) return [];
      const row = { offer_id: offerId, room_id: roomId, person_id: personId, follower_id: followerId,
        shown_at: nowIso, reason, outcome: null, outcome_at: null };
      state.offers.push(row);
      return [{ offer_id: row.offer_id, reason: row.reason, shown_at: row.shown_at }];
    }
    // §markOfferOutcome.
    if (sql.includes("update vy_room_upgrade_offer o")) {
      const [followerId, outcome, nowIso] = params;
      const open = state.offers
        .filter((o) => o.follower_id === followerId && o.outcome == null)
        .sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at))[0];
      if (!open) return [];
      open.outcome = outcome;
      open.outcome_at = nowIso;
      return [{ offer_id: open.offer_id, reason: open.reason, outcome: open.outcome }];
    }
    // §conversionReport's eligible/paying read.
    if (sql.includes("as eligible") && sql.includes("as paying")) {
      const [roomId, nowIso, eligibilityDays, windowDays] = params;
      const now = new Date(nowIso).getTime();
      const rows = state.followers.filter((f) => f.room_id === roomId &&
        new Date(f.joined_at).getTime() <= now - eligibilityDays * 86_400_000 &&
        new Date(f.joined_at).getTime() >= now - windowDays * 86_400_000);
      return [{ eligible: rows.length, paying: rows.filter((f) => f.tier === "paid").length }];
    }
    // §conversionReport's funnel read.
    if (sql.includes("from vy_room_upgrade_offer") && sql.includes("group by reason")) {
      const [roomId, nowIso, windowDays] = params;
      const now = new Date(nowIso).getTime();
      const rows = state.offers.filter((o) => o.room_id === roomId &&
        now - new Date(o.shown_at).getTime() <= windowDays * 86_400_000);
      const byReason = {};
      for (const o of rows) {
        const r = byReason[o.reason] || { shown: 0, started: 0, paid: 0 };
        r.shown++;
        if (o.outcome === "started") r.started++;
        if (o.outcome === "paid") r.paid++;
        byReason[o.reason] = r;
      }
      return Object.entries(byReason).map(([reason, v]) => ({ reason, ...v }));
    }
    // §renewedUnasked.
    if (sql.includes("count(distinct owner_user_id)")) {
      return [{ creators: new Set(state.rooms.map((r) => r.owner_user_id)).size }];
    }
    // §phaseGate's own room list.
    if (sql.includes("select room_id, created_at, published_at") && sql.includes("from vy_room")) {
      return state.rooms.map((r) => ({ room_id: r.room_id, created_at: r.created_at, published_at: r.published_at }));
    }
    // roomFollowerCohorts's two statements (api/_room-cohorts.js) — the
    // simplest honest fixture: no room in this suite's own state is old
    // enough to have a measurable cohort, so both read as empty/zero, which
    // §6 asserts against directly rather than assuming.
    if (sql.includes("followers_joined") && sql.includes("paid_followers")) return [{ followers_joined: 0, paid_followers: 0 }];
    if (sql.includes("returned_week6")) return [{ returned_week6: 0 }];
    throw new Error(`phase-gate fixture: unrecognised statement: ${sql.slice(0, 80)}`);
  };
}

function freshPhaseGateState() {
  return { rooms: [], followers: [], threads: [], followerDays: [], offers: [], meeraLog: [] };
}

const T0 = new Date("2026-09-04T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: sessionWorked — the three clauses, each tested to fail alone ──");
// ═════════════════════════════════════════════════════════════════════════
{
  function baseState() {
    const s = freshPhaseGateState();
    s.rooms.push({ room_id: ROOM_ID, owner_user_id: "own", created_at: new Date(T0 - 90 * DAY).toISOString(),
      published_at: new Date(T0 - 90 * DAY).toISOString(), free_monthly_messages: 20, paid_monthly_messages: 500 });
    s.followers.push({ room_id: ROOM_ID, person_id: PERSON, tier: "free", month_message_count: 17, joined_at: new Date(T0 - 60 * DAY).toISOString() });
    s.threads.push({ thread_id: THREAD, room_id: ROOM_ID, person_id: PERSON, created_at: new Date(T0 - 3 * DAY).toISOString() });
    for (let i = 0; i < 4; i++) {
      s.meeraLog.push({ speaker_person_id: PERSON, agent_id: AGENT, device_id: DEVICE, role: "me", at: T0 + i * 60_000 });
    }
    return s;
  }
  const argsFor = (now = T0 + 10 * 60_000) => ({ roomId: ROOM_ID, personId: PERSON, threadId: THREAD, agentId: AGENT, deviceId: DEVICE, now });

  const happy = await sessionWorked(phaseGateDb(baseState()), argsFor());
  ok("happy path: free tier, 4 messages this session, old thread, near the cap -> worked",
    happy.worked === true, JSON.stringify(happy));
  ok("...and it reports the real session count", happy.session_message_count === 4);

  const s2 = baseState();
  s2.meeraLog = s2.meeraLog.slice(0, 3); // only 3 messages
  const tooFew = await sessionWorked(phaseGateDb(s2), argsFor());
  ok("clause 1 alone fails: 3 messages in session, not 4 -> not worked", tooFew.worked === false && tooFew.session_message_count === 3);

  const s3 = baseState();
  s3.threads[0].created_at = new Date(T0 - 60_000).toISOString(); // thread created moments ago, same day
  const freshThread = await sessionWorked(phaseGateDb(s3), argsFor());
  ok("clause 2 alone fails: thread created today, not an earlier day -> not worked",
    freshThread.worked === false && freshThread.thread_continued_from_earlier_day === false);

  const s4 = baseState();
  s4.followers[0].month_message_count = 2; // plenty of room left, no prior cap hit
  const plentyLeft = await sessionWorked(phaseGateDb(s4), argsFor());
  ok("clause 3 alone fails: 18 messages remaining this month and no prior cap hit -> not worked",
    plentyLeft.worked === false && plentyLeft.messages_remaining === 18 && plentyLeft.hit_cap_before === false);

  const s5 = baseState();
  s5.followers[0].tier = "paid";
  const paidTier = await sessionWorked(phaseGateDb(s5), argsFor());
  ok("a paid follower never worked=true, whatever else is true", paidTier.worked === false);

  const s6 = baseState();
  s6.followers[0].month_message_count = 2; // plenty left THIS month...
  s6.followerDays.push({ room_id: ROOM_ID, person_id: PERSON, day: "2026-07-15", turns: 21 }); // ...but hit the cap in July
  const priorCapHit = await sessionWorked(phaseGateDb(s6), argsFor());
  ok("prior-month cap hit satisfies clause 3 even with plenty left THIS month",
    priorCapHit.worked === true && priorCapHit.hit_cap_before === true);

  for (const [name, v] of [["roomId", ""], ["personId", "not-a-uuid"], ["threadId", null]]) {
    let threw = false;
    try { await sessionWorked(phaseGateDb(baseState()), { ...argsFor(), [name]: v }); } catch (e) { threw = e instanceof PhaseGateError; }
    ok(`sessionWorked refuses a bad ${name} before any query`, threw);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: recordOffer — the 14-day cooldown IS the write ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshPhaseGateState();
  const db = phaseGateDb(state);
  const first = await recordOffer(db, { roomId: ROOM_ID, personId: PERSON, followerId: FOLLOWER, reason: "session_worked", now: T0 });
  ok("first offer inserts", first.inserted === true && state.offers.length === 1);

  const secondSameDay = await recordOffer(db, { roomId: ROOM_ID, personId: PERSON, followerId: FOLLOWER, reason: "session_worked", now: T0 + 60_000 });
  ok("NEGATIVE CONTROL (b): a second offer inside 14 days never inserts",
    secondSameDay.inserted === false && state.offers.length === 1);

  const justInside = await recordOffer(db, { roomId: ROOM_ID, personId: PERSON, followerId: FOLLOWER, reason: "cap_reached",
    now: T0 + (OFFER_COOLDOWN_DAYS * DAY) - 60_000 });
  ok("one minute before the 14-day boundary: still refused", justInside.inserted === false && state.offers.length === 1);

  const justOutside = await recordOffer(db, { roomId: ROOM_ID, personId: PERSON, followerId: FOLLOWER, reason: "cap_reached",
    now: T0 + (OFFER_COOLDOWN_DAYS * DAY) + 60_000 });
  ok("one minute after the 14-day boundary: inserts again", justOutside.inserted === true && state.offers.length === 2);

  let threw = false;
  try { await recordOffer(db, { roomId: ROOM_ID, personId: PERSON, followerId: FOLLOWER, reason: "made_up", now: T0 }); }
  catch (e) { threw = e instanceof PhaseGateError; }
  ok("an unknown reason is refused before any write", threw);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: markOfferOutcome — the most recent OPEN offer only ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshPhaseGateState();
  const db = phaseGateDb(state);
  state.offers.push(
    { offer_id: "o1", room_id: ROOM_ID, person_id: PERSON, follower_id: FOLLOWER, shown_at: new Date(T0 - 2 * DAY).toISOString(), reason: "cap_reached", outcome: "dismissed", outcome_at: new Date(T0 - 2 * DAY + 1000).toISOString() },
    { offer_id: "o2", room_id: ROOM_ID, person_id: PERSON, follower_id: FOLLOWER, shown_at: new Date(T0 - 1 * DAY).toISOString(), reason: "session_worked", outcome: null, outcome_at: null },
  );
  const marked = await markOfferOutcome(db, { followerId: FOLLOWER, outcome: "started", now: T0 });
  ok("marks the MOST RECENT open offer (o2), never the already-resolved one (o1)", marked.offer_id === "o2");
  ok("o1 is untouched", state.offers.find((o) => o.offer_id === "o1").outcome === "dismissed");
  ok("o2 now carries the outcome and its timestamp", state.offers.find((o) => o.offer_id === "o2").outcome === "started");

  const noneOpen = await markOfferOutcome(db, { followerId: "99999999-9999-4999-8999-999999999999", outcome: "paid", now: T0 });
  ok("a follower with no open offer gets null, not an error", noneOpen === null);

  let threw = false;
  try { await markOfferOutcome(db, { followerId: FOLLOWER, outcome: "made_up", now: T0 }); } catch (e) { threw = e instanceof PhaseGateError; }
  ok("an unknown outcome is refused before any write", threw);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: conversionReport — the ratio and the funnel ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshPhaseGateState();
  state.followers.push(
    { room_id: ROOM_ID, person_id: "p1", tier: "paid", joined_at: new Date(T0 - 30 * DAY).toISOString() },
    { room_id: ROOM_ID, person_id: "p2", tier: "free", joined_at: new Date(T0 - 20 * DAY).toISOString() },
    { room_id: ROOM_ID, person_id: "p3", tier: "free", joined_at: new Date(T0 - 5 * DAY).toISOString() }, // too new, excluded
    { room_id: ROOM_ID, person_id: "p4", tier: "free", joined_at: new Date(T0 - 90 * DAY).toISOString() }, // too old, excluded
  );
  state.offers.push(
    { room_id: ROOM_ID, follower_id: "f1", reason: "session_worked", outcome: "paid", shown_at: new Date(T0 - 10 * DAY).toISOString() },
    { room_id: ROOM_ID, follower_id: "f2", reason: "session_worked", outcome: "started", shown_at: new Date(T0 - 9 * DAY).toISOString() },
    { room_id: ROOM_ID, follower_id: "f3", reason: "session_worked", outcome: null, shown_at: new Date(T0 - 8 * DAY).toISOString() },
    { room_id: ROOM_ID, follower_id: "f4", reason: "cap_reached", outcome: "paid", shown_at: new Date(T0 - 7 * DAY).toISOString() },
  );
  const report = await conversionReport(phaseGateDb(state), ROOM_ID, T0);
  ok("exactly 2 followers are eligible (30d and 20d old; 5d too new, 90d too old)", report.eligible === 2, String(report.eligible));
  ok("1 of the eligible 2 is paid = 50% conversion", report.paying === 1 && report.pct === 50, String(report.pct));
  const sessionWorkedFunnel = report.funnel.find((f) => f.reason === "session_worked");
  ok("the session_worked funnel: 3 shown, 1 started, 1 paid",
    sessionWorkedFunnel.shown === 3 && sessionWorkedFunnel.started === 1 && sessionWorkedFunnel.paid === 1);
  const capFunnel = report.funnel.find((f) => f.reason === "cap_reached");
  ok("the cap_reached funnel: 1 shown, 1 paid, 0 started", capFunnel.shown === 1 && capFunnel.paid === 1 && capFunnel.started === 0);

  const empty = await conversionReport(phaseGateDb(freshPhaseGateState()), ROOM_ID, T0);
  ok("zero eligible followers reports null pct, never a division by zero", empty.eligible === 0 && empty.pct === null);

  let threw = false;
  try { await conversionReport(phaseGateDb(freshPhaseGateState()), "not-a-uuid", T0); } catch (e) { threw = e instanceof PhaseGateError; }
  ok("a bad room id is refused before any query", threw);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: renewedUnasked — the honest zero, and now the wired count (WS-R37) ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshPhaseGateState();
  state.rooms.push(
    { room_id: "r1", owner_user_id: "owner-a" }, { room_id: "r2", owner_user_id: "owner-b" }, { room_id: "r3", owner_user_id: "owner-a" },
  );
  // WS-R37: `renewedUnasked` now reads through `api/_renewals.js`'s
  // `renewedUnaskedCount`, which is gated on migration 099
  // (`vy_renewal_reminder`) being applied. `tableApplied: async () => false`
  // reproduces exactly what this section always tested - a database that has
  // not applied 099 yet - without this offline suite ever calling the REAL
  // `tableApplied` (which reaches the real database, `api/_renewals.js`'s
  // own header names this as the reason the gate exists at all). See
  // `evals/renewals/run.mjs` for the WIRED path (`tableApplied: async () =>
  // true`), which this suite does not re-test.
  const r = await renewedUnasked(phaseGateDb(state), T0, { tableApplied: async () => false });
  ok("counts DISTINCT owners (2), not rooms (3)", r.creators_total === 2, String(r.creators_total));
  ok("renewed_unasked is a real, honest zero when migration 099 has not been applied",
    r.renewed_unasked === 0);
  ok("n is 0 (nothing measurable yet), never the creator count", r.n === 0, String(r.n));
  ok("the note names exactly why", r.note === "no reminder mechanism has been applied to this database yet");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: phaseGate — composition, and the three honest states ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // not_enough_data everywhere: no rooms, no followers, no creators.
  const empty = await phaseGate(phaseGateDb(freshPhaseGateState()), T0, { tableApplied: async () => false });
  ok("no data anywhere: all three states are not_enough_data", empty.conversion.state === "not_enough_data" &&
    empty.retention.state === "not_enough_data" && empty.renewed_unasked.state === "not_enough_data");
  ok("phase2_may_start is false when nothing is measurable", empty.phase2_may_start === false);
  ok("the sentence says 'may not start yet', never implying a failure", empty.summary === "Phase 2 may not start yet");

  // conversion at_or_above, everything else not_enough_data.
  const s = freshPhaseGateState();
  s.rooms.push({ room_id: ROOM_ID, owner_user_id: "owner-a", created_at: new Date(T0 - 90 * DAY).toISOString(), published_at: new Date(T0 - 90 * DAY).toISOString() });
  for (let i = 0; i < 20; i++) {
    s.followers.push({ room_id: ROOM_ID, person_id: `p${i}`, tier: i < 3 ? "paid" : "free", joined_at: new Date(T0 - 30 * DAY).toISOString() });
  }
  const withConversion = await phaseGate(phaseGateDb(s), T0, { tableApplied: async () => false });
  ok("20 eligible, 3 paid = 15%, at or above the 12% floor", withConversion.conversion.pct === 15 &&
    withConversion.conversion.state === "at_or_above", String(withConversion.conversion.pct));
  ok("retention and renewed-unasked are STILL not_enough_data - one number clearing its bar never implies another did",
    withConversion.retention.state === "not_enough_data" && withConversion.renewed_unasked.state === "not_enough_data");
  ok("phase2_may_start is still false - ALL THREE must clear", withConversion.phase2_may_start === false);

  // below floor.
  const below = freshPhaseGateState();
  below.rooms.push({ room_id: ROOM_ID, owner_user_id: "owner-a", created_at: new Date(T0 - 90 * DAY).toISOString(), published_at: new Date(T0 - 90 * DAY).toISOString() });
  for (let i = 0; i < 25; i++) below.followers.push({ room_id: ROOM_ID, person_id: `q${i}`, tier: "free", joined_at: new Date(T0 - 30 * DAY).toISOString() });
  const belowResult = await phaseGate(phaseGateDb(below), T0, { tableApplied: async () => false });
  ok("25 eligible, 0 paid: below, never not_enough_data (n is well above the floor)",
    belowResult.conversion.state === "below" && belowResult.conversion.pct === 0);

  ok("the named constants match the plan's own numbers", PAID_CONVERSION_FLOOR_PCT === 12 && PHASE2_FLOOR_PCT === 35 &&
    MIN_FOLLOWERS_FOR_DATA === 20 && MIN_CREATORS_FOR_DATA === 3 && RENEWED_UNASKED_TARGET === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: roomSay integration — a real turn through the real follower lane ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  // The shared room fixture's own fakeDb (evals/room/fixtures.mjs), wrapped
  // with the phase-gate tables it does not know about - `withDayTable`'s own
  // shape, one more table over.
  const offerRows = [];
  const meeraLog = [];
  function withPhaseGateTables(baseDb) {
    return async (sql, params = []) => {
      if (sql.includes("insert into vy_room_upgrade_offer")) {
        const [offerId, roomId, personId, followerId, reason, nowIso] = params;
        const cooldownDays = params[6];
        const now = new Date(nowIso).getTime();
        const within = offerRows.some((o) => o.follower_id === followerId && now - new Date(o.shown_at).getTime() < cooldownDays * 86_400_000);
        if (within) return [];
        offerRows.push({ offer_id: offerId, room_id: roomId, person_id: personId, follower_id: followerId, shown_at: nowIso, reason, outcome: null });
        return [{ offer_id: offerId, reason, shown_at: nowIso }];
      }
      if (sql.includes("update vy_room_upgrade_offer o")) {
        const [followerId, outcome, nowIso] = params;
        const open = offerRows.filter((o) => o.follower_id === followerId && o.outcome == null).sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at))[0];
        if (!open) return [];
        open.outcome = outcome;
        return [{ offer_id: open.offer_id, reason: open.reason, outcome }];
      }
      if (sql.includes("from vy_room_price")) return [{ follower_price_inr: 349, currency: "INR" }];
      if (sql.includes("from follower_scope fs, thread_scope ts, cap_history ch")) {
        return [sessionWorkedRow(
          { rooms: state.rooms, followers: state.followers, threads: state.threads, followerDays: [], meeraLog },
          params,
        )];
      }
      return baseDb(sql, params);
    };
  }
  const base = fakeDb(state);
  const db = withPhaseGateTables(base);
  // meera_log: `roomSay` writes through `memory.logTurn`, and the shared
  // `evals/room/fixtures.mjs` fake (`fakeMemory`) keeps its own log with no
  // timestamp — this suite needs one (`sessionWorked`'s own reason for
  // existing), so `memoryFor(now)` builds a fresh memory object per turn,
  // closing over that turn's own `now`, and stamps EVERY logged turn into
  // the SAME `meeraLog` array `withPhaseGateTables` above reads.
  const underlyingMemory = fakeMemory([]);
  function memoryFor(now) {
    return {
      ...underlyingMemory,
      logTurn: async (args) => {
        meeraLog.push({ speaker_person_id: args.person, agent_id: args.agentId, device_id: args.device, role: args.role, at: now });
        return underlyingMemory.logTurn(args);
      },
    };
  }

  const day0 = T0 - 3 * DAY;
  // The SESSION is minted close to T0 (the token's own 12-hour TTL, unlike
  // the thread, must hold for every turn below); the THREAD is backdated by
  // hand to day0 AFTER creation, since `createThread`'s own insert (this
  // suite's shared `fakeDb`) always stamps `created_at` with the real clock -
  // the same reason `evals/room-cohorts/run.mjs` never asks that fake for a
  // controllable timestamp either.
  const joined = await joinRoom(db, { slug: SLUG, authUserId: "11111111-1111-4111-8111-111111111111", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 - 60_000 });
  const payload0 = readRoomSession(joined.session);
  const thread = await createThread(db, { roomId: payload0.i, personId: payload0.p, agentId: payload0.a, title: "day one" }, {});
  state.threads.find((t) => t.thread_id === thread.thread_id).created_at = new Date(day0).toISOString();
  // Push the follower close to the cap so clause 3 holds after the four
  // turns below spend one message each (12 -> 16, leaving 4 of 20, under the
  // <5-remaining bar) without ever actually HITTING the cap.
  const followerRow = state.followers.find((f) => f.person_id === payload0.p);
  followerRow.month_message_count = 12;

  const depsFor = (now) => ({ loadAgent, engine, reply, personTables, memory: memoryFor(now), now, tableApplied: async () => true });

  // Four messages inside one session, on a LATER day than the thread.
  let turn;
  for (let i = 0; i < 4; i++) {
    turn = await roomSay(db, { session: i === 0 ? joined.session : turn.session, message: `msg ${i}`, threadId: thread.thread_id },
      depsFor(T0 + i * 60_000));
  }
  ok("the fourth turn of a real session carries an offer", turn.offer !== null && turn.offer.reason === "session_worked", JSON.stringify(turn.offer));
  ok("the offer carries the real price this suite's price fixture returned", turn.offer.price_inr === 349 && turn.offer.currency === "INR");
  ok("exactly one offer row was written, not one per turn", offerRows.length === 1);

  // NEGATIVE CONTROL (c): the reply bytes are identical with and without an
  // offer - proven by comparing this turn's own reply against what the SAME
  // module produces on a turn that structurally cannot carry one (a paid
  // follower, `!paid` guards the whole block).
  const state2 = freshState();
  const db2 = withPhaseGateTables(fakeDb(state2));
  const joined2 = await joinRoom(db2, { slug: SLUG, authUserId: "22222222-2222-4222-8222-222222222222", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 - 60_000 });
  const payload2 = readRoomSession(joined2.session);
  state2.followers.find((f) => f.person_id === payload2.p).tier = "paid";
  const noOffer = await roomSay(db2, { session: joined2.session, message: "msg 0" }, depsFor(T0));
  ok("NEGATIVE CONTROL (c): a paid follower's reply is generated by the exact same reply function with offer=null",
    noOffer.offer === null && typeof noOffer.reply === "string" && noOffer.reply === turn.reply,
    "both turns share the fixture's fixed reply() function, so byte-identical text across the offer/no-offer branches proves the branch never touches `said`");

  // Cap-reached: a fresh follower right at the boundary, refused, and the
  // refusal itself still records a cap_reached offer.
  const state3 = freshState();
  const db3 = withPhaseGateTables(fakeDb(state3));
  // `evals/room/fixtures.mjs` only maps `USER_A`/`USER_B` to clean hex
  // person ids - any other auth id falls back to a `pp<slice>` shape
  // (`unknownUserFallback`'s own header) that fails `recordOffer`'s strict
  // UUID check exactly the way it should for a real malformed id. Reusing
  // `USER_A` here is safe: `state3` is a fresh, isolated fixture, so there is
  // no collision with §7's first world.
  const joined3 = await joinRoom(db3, { slug: SLUG, authUserId: "11111111-1111-4111-8111-111111111111", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 - 60_000 });
  const payload3 = readRoomSession(joined3.session);
  state3.followers.find((f) => f.person_id === payload3.p).month_message_count = 20;
  let threw = false;
  try { await roomSay(db3, { session: joined3.session, message: "one more" }, depsFor(T0)); }
  catch (e) { threw = e?.code === "room_free_cap_reached"; }
  ok("a capped follower is still refused with the named code (the refusal itself is unchanged)", threw);
  ok("...and the refusal ALSO recorded a cap_reached offer",
    offerRows.some((o) => o.reason === "cap_reached" && o.person_id === payload3.p));

  // roomDismissOffer.
  const dismissed = await roomDismissOffer(db, { session: turn.session }, depsFor(T0 + 10 * 60_000));
  ok("roomDismissOffer marks the follower's own open offer dismissed", dismissed.dismissed === true);
  ok("...and the row itself now carries that outcome", offerRows.find((o) => o.person_id === payload0.p).outcome === "dismissed");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: the payments webhook — the inline offer_update CTE ──");
// ═════════════════════════════════════════════════════════════════════════
{
  process.env.PAYMENTS_PROVIDER = "fake";
  process.env.PAYMENTS_FAKE_WEBHOOK_SECRET = "s".repeat(32);
  const fakeProvider = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);

  const calls = [];
  function paymentsDb(gated) {
    const events = [];
    const subs = [{ subscription_id: "sub-1", room_id: ROOM_ID, follower_id: FOLLOWER, provider: "fake",
      provider_subscription_ref: "razpay_sub_1", state: "created" }];
    const followers = [{ follower_id: FOLLOWER, tier: "free" }];
    const offers = [{ offer_id: "o1", follower_id: FOLLOWER, shown_at: new Date(T0 - DAY).toISOString(), reason: "session_worked", outcome: null }];
    return async (sql, params = []) => {
      calls.push(sql);
      if (sql.includes("select s.subscription_id, s.room_id")) {
        return [{ subscription_id: "sub-1", room_id: ROOM_ID, platform_take_bp: 2500 }];
      }
      if (sql.includes("with candidate as")) {
        const [, ref] = params;
        if (events.some((e) => e.ref === ref)) return [];
        events.push({ ref });
        const sub = subs[0];
        sub.state = "active";
        const follower = followers.find((f) => f.follower_id === sub.follower_id);
        follower.tier = "paid";
        let offerMarked = null;
        if (gated) {
          const open = offers.filter((o) => o.follower_id === sub.follower_id && o.outcome == null)
            .sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at))[0];
          if (open) { open.outcome = "paid"; offerMarked = open.offer_id; }
        }
        return [{ event_id: randomUUID(), subscription_id: sub.subscription_id, state: sub.state, tier: follower.tier,
          ...(gated ? { offer_marked_paid: offerMarked } : {}) }];
      }
      // WS-R100 (migration 126). `tableApplied: async () => true` above is
      // blanket - it also admits "vy_receipt", so `applyWebhook`'s own new
      // receipt-issuance call reaches this fixture too, even though this
      // section's own subject is migration 093's offer gating, not
      // receipts. This fixture has no `sub.person_id` at all (§8's own
      // rows never needed one before this workstream), so a real receipt
      // row cannot be modelled here without widening `subs`/`followers`
      // for a fact this section's own assertions never read - returning no
      // row is the SAME "not applied" shape `issueFollowerReceipt`'s own
      // caller already handles honestly (`receipt_id: null`), and neither
      // assertion below reads that field.
      if (sql.includes("insert into vy_receipt_counter")) return [];
      throw new Error(`payments fixture: unrecognised statement: ${sql.slice(0, 80)}`);
    };
  }

  const body = JSON.stringify({ event: "subscription.charged",
    payload: { subscription: { entity: { id: "razpay_sub_1", current_start: 1, current_end: 2 } }, payment: { entity: { amount: 29900 } } } });
  const bodyBuf = Buffer.from(body, "utf8");
  const sig = fakeProvider.signWebhookForTest(bodyBuf, process.env.PAYMENTS_FAKE_WEBHOOK_SECRET);

  const gatedResult = await applyWebhook(paymentsDb(true), { rawBody: bodyBuf, signatureHeader: sig, eventRef: "evt-1" },
    { tableApplied: async () => true });
  ok("migration 093 applied: the webhook marks the offer paid IN THE SAME response as the tier flip",
    gatedResult.tier === "paid" && gatedResult.offer_marked_paid === "o1", JSON.stringify(gatedResult));

  const ungatedResult = await applyWebhook(paymentsDb(false), { rawBody: bodyBuf, signatureHeader: sig, eventRef: "evt-2" },
    { tableApplied: async () => false });
  ok("migration 093 NOT applied: the webhook still flips the tier (never a 500 for a newer table's absence)",
    ungatedResult.tier === "paid" && ungatedResult.offer_marked_paid === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL (a): room-leak's own aggregate-only parser catches a message-body read ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Copied inline from evals/room-leak/run.mjs, which exports no entry point
  // by design — every suite that reuses this parser (evals/funnel/run.mjs's
  // own §7 comment names the same reason) copies it rather than importing a
  // private implementation detail of a sibling suite.
  function aggregateOnlyCheck(stmt) {
    const selectList = (stmt.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
    const items = []; let depth = 0, cur = "";
    for (const ch of selectList) {
      if (ch === "(") depth++; else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) items.push(cur);
    const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min)\s*\(/i.test(c));
    const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
    return aggregateOnly && !touchesPerson;
  }

  const src = readFileSync(join(REPO, "api/_phase-gate.js"), "utf8");
  const real = (src.match(/`[^`]*vy_room_(?:follower|thread)[^`]*`/g) || [])
    .filter((s) => /\bfrom\s+vy_room_(?:follower|thread)\b/i.test(s));
  ok("the real file's own follower/thread statement(s) pass the aggregate-only parser",
    real.length > 0 && real.every(aggregateOnlyCheck), `${real.length} statement(s) checked`);

  const poisoned = `select f.tier, f.month_message_count, m.content as body
       from vy_room_follower f join meera_log m on m.speaker_person_id = f.person_id
      where f.room_id = ($1)::uuid`;
  ok("NEGATIVE CONTROL (a): a select that reads a message-body-shaped column IS caught",
    aggregateOnlyCheck(poisoned) === false,
    aggregateOnlyCheck(poisoned) === false ? "" : "control did not fire — the parser would have shipped a blind spot");
}

console.log(`\nphase-gate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
