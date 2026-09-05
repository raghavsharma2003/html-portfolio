// WS-R37. THE RENEWAL REMINDER LEDGER, AND "RENEWED UNASKED" MADE REAL —
// offline, deterministic, $0.
//
//   node evals/renewals/run.mjs
//
// api/_renewals.js is exercised through hand-rolled fake `db`s that
// pattern-match this file's own SQL text and answer from an in-memory
// fixture - `evals/phase-gate/run.mjs`'s own shape, this suite's own small
// wrapper per section rather than one shared fixture, on the same
// "a new table/shape gets a NEW small wrapper" precedent
// (`rejected.md#ws-r30-*` names it for `withDayTable`).
// `offline-mocks-cannot-type-check-sql` (AGENTS.md) applies exactly as
// everywhere else: this proves the PREDICATE and the WIRING, never that any
// statement PARSES against a real Postgres. Every statement this suite
// drives is listed in the workstream's final report for the main loop to
// EXPLAIN.
//
// §1 dueReminders — the window and the NOT EXISTS, one section per subject
//    kind, and the cancel_at_period_end exclusion.
// §1b WS-R125 (migration 130) — mandate_state in ('none','active'): a
//    paused/halted/pending mandate is excluded from the due-select, proven
//    non-redundant with `state` via the 'pending' case (state stays
//    'active' while a charge retries), struck-predicate negative control.
// §2 recordAndSend — INSERT is the idempotency; a send failure leaves the
//    row with `sent_at` null and a `reason`.
// §3 the sweep — NEGATIVE CONTROL (a): a second sweep on the same due rows
//    inserts nothing and sends nothing.
// §4 cancel, per subject kind, through the seam — never immediately.
// §5 renewedUnaskedCount — the not-applied honest zero, and the wired count
//    on a fixture with three creators (one reminded, two not).
// §6 followerRenewalTelegramText — both locales, with and without a price.
// §7 NEGATIVE CONTROL (c) — a follower's reminder carries no message text of
//    theirs (static scan of the module's own source and the push payload
//    builder).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadFixtureAgent, freshState, fakeDb, SLUG, ROOM_ID } from "../room/fixtures.mjs";

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

const mod = await import(pathToFileURL(join(REPO, "api/_renewals.js")).href);
const {
  dueReminders, recordAndSend, sweep, cancelFollowerRenewal, cancelCreatorRenewal, cancelOrgRenewal,
  renewedUnaskedCount, followerRenewalTelegramText, RenewalsError,
} = mod;
const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, readRoomSession } = room;
const { loadAgent } = await loadFixtureAgent(REPO);

const ENV = {
  PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: "x".repeat(32),
  ROOM_SESSION_SECRET: process.env.ROOM_SESSION_SECRET,
};
const T0 = new Date("2026-09-04T12:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`.slice(0, 36);

// ═════════════════════════════════════════════════════════════════════════
// A hand-rolled fake db over the three subscription tables plus the
// reminder ledger. Not the shared evals/room/fixtures.mjs fakeDb -
// dueReminders/recordAndSend/renewedUnaskedCount never touch
// vy_room_follower/vy_room_thread at all (api/_renewals.js's own header
// names this as the reason the file needs no room-leak-battery allowlist
// entry), so a dedicated, smaller fixture proves exactly what this file
// does without carrying the weight of the whole Room world.
// ═════════════════════════════════════════════════════════════════════════
function freshRenewalsState() {
  return {
    roomSubs: [], creatorSubs: [], orgSubs: [], reminders: [],
    rooms: [{ room_id: ROOM_ID, slug: SLUG, display_name: "Anjali", locale: "en" }],
    prices: [{ room_id: ROOM_ID, follower_price_inr: 399, currency: "INR" }],
    orgs: [],
  };
}

function renewalsDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    // ── dueReminders: follower ──
    if (has("from vy_room_subscription s") && has("s.follower_id as subject_id")) {
      const [nowIso, endIso] = params;
      return state.roomSubs
        // WS-R125 (migration 130): `s.mandate_state in ('none', 'active')`
        // is now part of the REAL query's own WHERE - a row with no
        // `mandate_state` set defaults to 'none' (migration 130's own
        // column default), so every existing fixture row above this
        // workstream's own section stays eligible unchanged.
        .filter((s) => s.state === "active" && ["none", "active"].includes(s.mandate_state ?? "none")
          && s.cancel_at_period_end !== true && s.current_period_end
          && s.current_period_end >= nowIso && s.current_period_end < endIso
          && !state.reminders.some((r) => r.subject_kind === "follower" && r.subject_id === s.follower_id && r.period_end === s.current_period_end))
        .map((s) => {
          const r = state.rooms.find((x) => x.room_id === s.room_id);
          const p = state.prices.find((x) => x.room_id === s.room_id);
          return {
            subject_id: s.follower_id, room_id: s.room_id, person_id: s.person_id,
            period_end: s.current_period_end, slug: r?.slug, display_name: r?.display_name, locale: r?.locale,
            amount_inr: p?.follower_price_inr ?? null, currency: p?.currency ?? "INR",
          };
        });
    }
    // ── dueReminders: creator ──
    if (has("from vy_creator_subscription s") && has("s.replica_id as subject_id")) {
      const [nowIso, endIso] = params;
      return state.creatorSubs
        // WS-R125 (migration 130): the SAME mandate_state predicate as the
        // follower select above.
        .filter((s) => s.state === "active" && ["none", "active"].includes(s.mandate_state ?? "none")
          && s.cancel_at_period_end !== true && s.current_period_end
          && s.current_period_end >= nowIso && s.current_period_end < endIso
          && !state.reminders.some((r) => r.subject_kind === "creator" && r.subject_id === s.replica_id && r.period_end === s.current_period_end))
        .map((s) => ({
          subject_id: s.replica_id, owner_user_id: s.owner_user_id, replica_id: s.replica_id,
          period_end: s.current_period_end, plan: s.plan, amount_inr: s.price_inr, currency: s.currency,
        }));
    }
    // ── dueReminders: org ──
    if (has("from vy_org_subscription s") && has("s.org_id as subject_id")) {
      const [nowIso, endIso] = params;
      return state.orgSubs
        .filter((s) => s.state === "active" && s.cancel_at_period_end !== true && s.current_period_end
          && s.current_period_end >= nowIso && s.current_period_end < endIso
          && !state.reminders.some((r) => r.subject_kind === "org" && r.subject_id === s.org_id && r.period_end === s.current_period_end))
        .map((s) => {
          const o = state.orgs.find((x) => x.org_id === s.org_id);
          return {
            subject_id: s.org_id, period_end: s.current_period_end, plan: s.plan,
            amount_inr: s.price_per_seat_inr * s.seats, currency: s.currency, slug: o?.slug, name: o?.name,
          };
        });
    }

    // ── recordAndSend ──
    if (has("insert into vy_renewal_reminder")) {
      const [subjectKind, subjectId, roomId, personId, followerId, ownerUserId, replicaId, orgId, periodEnd, channel] = params;
      const dup = state.reminders.some((r) =>
        r.subject_kind === subjectKind && r.subject_id === subjectId && r.period_end === periodEnd && r.channel === channel);
      if (dup) return [];
      const row = {
        reminder_id: `rem${state.reminders.length + 1}`, subject_kind: subjectKind, subject_id: subjectId,
        room_id: roomId, person_id: personId, follower_id: followerId, owner_user_id: ownerUserId,
        replica_id: replicaId, org_id: orgId, period_end: periodEnd, channel, sent_at: null, reason: "",
      };
      state.reminders.push(row);
      return [{ reminder_id: row.reminder_id }];
    }
    if (has("set sent_at = now()")) {
      const row = state.reminders.find((r) => r.reminder_id === params[0]);
      if (row) row.sent_at = new Date(T0).toISOString();
      return [];
    }
    if (has("set reason = $2")) {
      const row = state.reminders.find((r) => r.reminder_id === params[0]);
      if (row) row.reason = params[1];
      return [];
    }

    throw new Error(`renewals fixture: unrecognised statement: ${sql.slice(0, 90)}`);
  };
}

const T3 = new Date(T0 + 3 * DAY).toISOString();
const T10 = new Date(T0 + 10 * DAY).toISOString();

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: dueReminders — the window, the NOT EXISTS, one per subject kind ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshRenewalsState();
  state.roomSubs.push(
    { follower_id: uuid(1), room_id: ROOM_ID, person_id: uuid(101), state: "active", cancel_at_period_end: false, current_period_end: T3 },
    // outside the 7-day window
    { follower_id: uuid(2), room_id: ROOM_ID, person_id: uuid(102), state: "active", cancel_at_period_end: false, current_period_end: T10 },
    // cancelled - excluded regardless of date
    { follower_id: uuid(3), room_id: ROOM_ID, person_id: uuid(103), state: "cancelled", cancel_at_period_end: false, current_period_end: T3 },
    // cancel_at_period_end - excluded (law 5: "the select excludes cancelled")
    { follower_id: uuid(4), room_id: ROOM_ID, person_id: uuid(104), state: "active", cancel_at_period_end: true, current_period_end: T3 },
  );
  state.creatorSubs.push(
    { replica_id: uuid(5), owner_user_id: uuid(201), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR" },
  );
  state.orgs.push({ org_id: uuid(6), slug: "north-coaching", name: "North Coaching" });
  state.orgSubs.push(
    { org_id: uuid(6), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "starter", price_per_seat_inr: 2999, seats: 4, currency: "INR" },
  );

  const due = await dueReminders(renewalsDb(state), T0);
  ok("follower: exactly one due (in-window, active, not cancel-flagged)", due.follower.length === 1, String(due.follower.length));
  ok("follower: the due row carries the room's slug/display name/price", due.follower[0].slug === SLUG && due.follower[0].amount_inr === 399);
  ok("follower: outside-window row excluded", !due.follower.some((r) => r.subject_id === uuid(2)));
  ok("follower: cancelled row excluded", !due.follower.some((r) => r.subject_id === uuid(3)));
  ok("follower: cancel_at_period_end row excluded", !due.follower.some((r) => r.subject_id === uuid(4)));
  ok("creator: exactly one due, subject_kind tagged", due.creator.length === 1 && due.creator[0].subject_kind === "creator");
  ok("org: exactly one due, amount is price_per_seat * seats", due.org.length === 1 && due.org[0].amount_inr === 2999 * 4);

  // A reminder row already exists for the follower's period — NOT EXISTS
  // excludes it regardless of channel (law 1: "any reminder row for this
  // period", never per-channel).
  state.reminders.push({ subject_kind: "follower", subject_id: uuid(1), period_end: T3, channel: "in_app" });
  const due2 = await dueReminders(renewalsDb(state), T0);
  ok("a subject with ANY reminder row for this period is no longer due", due2.follower.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §1b WS-R125 (migration 130): a paused mandate is neither charged nor reminded ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Five otherwise-identical, otherwise-due follower subscriptions and five
  // otherwise-identical, otherwise-due creator subscriptions, one per
  // mandate_state value that actually occurs in practice. `'none'` (never
  // touched) and `'active'` (confirmed working) are due; `'paused'`/
  // `'halted'` are excluded, but so is `state = 'paused'` ALONE already
  // (KIND_TO_STATE flips both together) - the row that actually PROVES this
  // predicate does its own, non-redundant work is `'pending'`: a retry in
  // progress after `subscription.pending` (`api/_payments.js`'s own
  // `KIND_TO_STATE["subscription.pending"] === ""`, meaning `state` is left
  // exactly where it was - typically still `'active'` from the prior
  // successful cycle). Without `mandate_state`, THIS row's own `state`
  // alone would sail straight through the existing `state = 'active'`
  // clause and get reminded about a renewal while its last charge is
  // already failing and retrying.
  const state = freshRenewalsState();
  state.roomSubs.push(
    { follower_id: uuid(11), room_id: ROOM_ID, person_id: uuid(111), state: "active", cancel_at_period_end: false, current_period_end: T3, mandate_state: "none" },
    { follower_id: uuid(12), room_id: ROOM_ID, person_id: uuid(112), state: "active", cancel_at_period_end: false, current_period_end: T3, mandate_state: "active" },
    { follower_id: uuid(13), room_id: ROOM_ID, person_id: uuid(113), state: "paused", cancel_at_period_end: false, current_period_end: T3, mandate_state: "paused" },
    { follower_id: uuid(14), room_id: ROOM_ID, person_id: uuid(114), state: "paused", cancel_at_period_end: false, current_period_end: T3, mandate_state: "halted" },
    { follower_id: uuid(15), room_id: ROOM_ID, person_id: uuid(115), state: "active", cancel_at_period_end: false, current_period_end: T3, mandate_state: "pending" },
  );
  state.creatorSubs.push(
    { replica_id: uuid(21), owner_user_id: uuid(211), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR", mandate_state: "none" },
    { replica_id: uuid(22), owner_user_id: uuid(212), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR", mandate_state: "active" },
    { replica_id: uuid(23), owner_user_id: uuid(213), state: "paused", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR", mandate_state: "paused" },
    { replica_id: uuid(24), owner_user_id: uuid(214), state: "paused", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR", mandate_state: "halted" },
    { replica_id: uuid(25), owner_user_id: uuid(215), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR", mandate_state: "pending" },
  );

  const due = await dueReminders(renewalsDb(state), T0);
  ok("follower: 'none' and 'active' mandates are due", due.follower.some((r) => r.subject_id === uuid(11)) && due.follower.some((r) => r.subject_id === uuid(12)));
  ok("follower: a customer-paused mandate is NOT due", !due.follower.some((r) => r.subject_id === uuid(13)));
  ok("follower: a bank-halted mandate is NOT due either", !due.follower.some((r) => r.subject_id === uuid(14)));
  ok("follower: a 'pending' mandate is NOT due, even though `state` is still 'active'",
    !due.follower.some((r) => r.subject_id === uuid(15)));
  ok("follower: exactly two of the five seeded rows are due", due.follower.length === 2, String(due.follower.length));
  ok("creator: 'none' and 'active' mandates are due", due.creator.some((r) => r.subject_id === uuid(21)) && due.creator.some((r) => r.subject_id === uuid(22)));
  ok("creator: a customer-paused mandate is NOT due", !due.creator.some((r) => r.subject_id === uuid(23)));
  ok("creator: a bank-halted mandate is NOT due either", !due.creator.some((r) => r.subject_id === uuid(24)));
  ok("creator: a 'pending' mandate is NOT due, even though `state` is still 'active'",
    !due.creator.some((r) => r.subject_id === uuid(25)));
  ok("creator: exactly two of the five seeded rows are due", due.creator.length === 2, String(due.creator.length));

  // A full sweep on this exact fixture, proving the exclusion end to end
  // through `sweep()` rather than only through `dueReminders` in isolation:
  // none of the three non-eligible subjects (follower AND creator) ever
  // reaches `recordAndSend`, so no reminder row is ever written for them
  // and no channel is ever attempted - the SAME two facts "neither charged
  // nor reminded" needs, since a reminder row is this platform's only trace
  // of "we were about to act on this subscription" and `api/_renewals.js`
  // itself never charges anyone (Razorpay's own mandate debits the card/UPI
  // app directly, never this file).
  const swept = await sweep({ db: renewalsDb(state), env: {}, activeSubscriptionsFor: async () => [], activeTelegramChannelFor: async () => null }, T0);
  ok("the sweep itself only SEES the two eligible subjects per kind, never the excluded three",
    swept.seenFollower === 2 && swept.seenCreator === 2);
  ok("no reminder row was ever written for any excluded subject",
    !state.reminders.some((r) => [uuid(13), uuid(14), uuid(15), uuid(23), uuid(24), uuid(25)].includes(r.subject_id)));

  // THE REQUIRED STRUCK-PREDICATE NEGATIVE CONTROL: re-run `dueReminders`'
  // OWN due-select logic with ONLY the `mandate_state` clause physically
  // struck out (a hand-rolled db exposing everything else identically,
  // applied to the IDENTICAL fixture rows above) and confirm the `'pending'`
  // subjects WOULD have been due - the row `state = 'active'` alone can
  // never catch, since `mandate_state` is the ONLY thing distinguishing it
  // from an ordinary healthy subscription. Proof the exclusion above is the
  // predicate actually doing the work, not a coincidence of the fixture
  // (`rejected.md`'s own "a plausible return hides a dead pipeline" law,
  // applied to a WHERE clause instead of a whole function). The paused/
  // halted rows are deliberately NOT re-asserted here - `state = 'paused'`
  // alone already excludes them with or without this clause, so they would
  // prove nothing about mandate_state specifically.
  const struckDb = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const [nowIso, endIso] = params;
    if (has("from vy_room_subscription s") && has("s.follower_id as subject_id")) {
      return state.roomSubs
        .filter((s) => s.state === "active" && s.cancel_at_period_end !== true
          && s.current_period_end && s.current_period_end >= nowIso && s.current_period_end < endIso)
        .map((s) => ({ ...s, subject_id: s.follower_id }));
    }
    if (has("from vy_creator_subscription s") && has("s.replica_id as subject_id")) {
      return state.creatorSubs
        .filter((s) => s.state === "active" && s.cancel_at_period_end !== true
          && s.current_period_end && s.current_period_end >= nowIso && s.current_period_end < endIso)
        .map((s) => ({ ...s, subject_id: s.replica_id }));
    }
    if (has("from vy_org_subscription s") && has("s.org_id as subject_id")) return [];
    throw new Error("struck-predicate fixture: unrecognised statement");
  };
  const struckDue = await dueReminders(struckDb, T0);
  ok("STRUCK PREDICATE: without mandate_state, the 'pending' follower WOULD have been due (state alone cannot catch it)",
    struckDue.follower.some((r) => r.subject_id === uuid(15)));
  ok("STRUCK PREDICATE: without mandate_state, the 'pending' creator WOULD have been due too",
    struckDue.creator.some((r) => r.subject_id === uuid(25)));
  ok("STRUCK PREDICATE: three of the five follower rows are due once ONLY the mandate guard is removed ('none'/'active'/'pending' all pass state='active'; paused/halted still fail on state alone)",
    struckDue.follower.length === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: recordAndSend — INSERT is the idempotency, send second ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshRenewalsState();
  const db = renewalsDb(state);
  let calls = 0;
  const r1 = await recordAndSend(
    db,
    { subjectKind: "follower", subjectId: uuid(1), periodEnd: T3, channel: "in_app", roomId: ROOM_ID, personId: uuid(101), followerId: uuid(1) },
    async () => { calls++; return { ok: true }; },
  );
  ok("first call inserts and sends", r1.inserted === true && r1.sent === true);
  ok("sendFn called exactly once", calls === 1);
  ok("sent_at is set on the row", state.reminders[0].sent_at != null);

  const r2 = await recordAndSend(
    db,
    { subjectKind: "follower", subjectId: uuid(1), periodEnd: T3, channel: "in_app", roomId: ROOM_ID, personId: uuid(101), followerId: uuid(1) },
    async () => { calls++; return { ok: true }; },
  );
  ok("a second call for the SAME (subject, period, channel) inserts nothing", r2.inserted === false && r2.sent === false);
  ok("sendFn is NEVER called for a row that already existed", calls === 1);
  ok("still exactly one row", state.reminders.length === 1);

  // A send failure: the row stays, sent_at stays null, reason carries a code.
  const r3 = await recordAndSend(
    db,
    { subjectKind: "follower", subjectId: uuid(2), periodEnd: T3, channel: "web_push", roomId: ROOM_ID, personId: uuid(102), followerId: uuid(2) },
    async () => ({ ok: false, code: "no_subscription_accepted" }),
  );
  ok("a failed send still inserted the row", r3.inserted === true);
  ok("sent is false", r3.sent === false);
  const row = state.reminders.find((r) => r.subject_id === uuid(2));
  ok("sent_at stayed null", row.sent_at == null);
  ok("reason carries the code", row.reason === "no_subscription_accepted");

  // A THIRD sweep-shaped call for the SAME subject+period+channel after a
  // failure must still not call sendFn — the row exists, full stop.
  let thirdCalls = 0;
  await recordAndSend(
    db,
    { subjectKind: "follower", subjectId: uuid(2), periodEnd: T3, channel: "web_push", roomId: ROOM_ID, personId: uuid(102), followerId: uuid(2) },
    async () => { thirdCalls++; return { ok: true }; },
  );
  ok("a failed send is never silently retried by a later call", thirdCalls === 0);

  // Bad inputs are refused, named.
  let threwKind = false, threwChannel = false;
  try { await recordAndSend(db, { subjectKind: "nonsense", subjectId: uuid(1), periodEnd: T3, channel: "in_app" }, async () => ({ ok: true })); }
  catch (e) { threwKind = e instanceof RenewalsError && e.code === "renewal_subject_kind_invalid"; }
  try { await recordAndSend(db, { subjectKind: "follower", subjectId: uuid(1), periodEnd: T3, channel: "email" }, async () => ({ ok: true })); }
  catch (e) { threwChannel = e instanceof RenewalsError && e.code === "renewal_channel_invalid"; }
  ok("an unknown subject kind is refused, named", threwKind);
  ok("a channel outside the migration's own CHECK is refused, named ('email' does not exist - no SMTP path in this repo)", threwChannel);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: the sweep — NEGATIVE CONTROL (a): a second sweep inserts and sends nothing ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshRenewalsState();
  state.roomSubs.push({ follower_id: uuid(1), room_id: ROOM_ID, person_id: uuid(101), state: "active", cancel_at_period_end: false, current_period_end: T3 });
  state.creatorSubs.push({ replica_id: uuid(5), owner_user_id: uuid(201), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "room", price_inr: 4999, currency: "INR" });
  state.orgs.push({ org_id: uuid(6), slug: "north-coaching", name: "North Coaching" });
  state.orgSubs.push({ org_id: uuid(6), state: "active", cancel_at_period_end: false, current_period_end: T3, plan: "starter", price_per_seat_inr: 2999, seats: 4, currency: "INR" });
  const db = renewalsDb(state);
  // No push subscriptions, no telegram pointer, no env keys configured -
  // only `in_app` is ever attempted in this fixture, which is enough to
  // prove the idempotency law without a second fixture layer.
  const deps = {
    db, env: {}, fetch: async () => { throw new Error("must never be called - no push/telegram configured"); },
    activeSubscriptionsFor: async () => [], activeTelegramChannelFor: async () => null,
  };
  const first = await sweep(deps, T0);
  ok("first sweep: three subjects seen (one per kind)", first.seenFollower === 1 && first.seenCreator === 1 && first.seenOrg === 1);
  ok("first sweep: three in_app reminders sent", first.sentInApp === 3, String(first.sentInApp));
  ok("first sweep: three reminder rows now exist", state.reminders.length === 3);

  const second = await sweep(deps, T0 + 60_000);
  ok("NEGATIVE CONTROL (a): second sweep sees nothing due (all three already have a reminder row)",
    second.seenFollower === 0 && second.seenCreator === 0 && second.seenOrg === 0);
  ok("NEGATIVE CONTROL (a): second sweep sends nothing", second.sentInApp === 0);
  ok("NEGATIVE CONTROL (a): still exactly three reminder rows - nothing inserted twice", state.reminders.length === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: cancel, per subject kind, through the seam - never immediately ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // ── follower: real session, via the shared room fixture ──
  const roomState = freshState();
  const roomDb = fakeDb(roomState);
  const providerCalls = [];
  const cancelDb = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("from vy_room_subscription") && has("state in ('created','authenticated','active','paused')") && has("order by created_at desc")) {
      return roomState.subs
        .filter((s) => s.follower_id === params[0] && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((s) => ({ subscription_id: s.subscription_id, provider: s.provider, provider_subscription_ref: s.provider_subscription_ref }));
    }
    if (has("update vy_room_subscription") && has("set cancel_at_period_end = true")) {
      const row = roomState.subs.find((s) => s.subscription_id === params[0]);
      if (!row) return [];
      row.cancel_at_period_end = true;
      return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end, cancel_at_period_end: true }];
    }
    return roomDb(sql, params);
  };
  const followerIdFor = (payload) =>
    roomState.followers.find((f) => f.room_id === String(payload.i) && f.person_id === String(payload.p))?.follower_id;

  const joined = await joinRoom(cancelDb, { slug: SLUG, authUserId: "11111111-1111-4111-8111-111111111111", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 });
  const payload = readRoomSession(joined.session);
  roomState.subs = [];
  roomState.subs.push({
    subscription_id: "sub-follower-1", follower_id: followerIdFor(payload), room_id: String(payload.i),
    state: "active", provider: "fake", provider_subscription_ref: "fake_sub_abc123", current_period_end: T3,
  });

  // `providerSecrets("fake", ...)` and `providerFor("fake")` (both
  // api/_payments.js, reused verbatim) resolve the REAL fake provider
  // module - a real ref present means `cancelSubscription({atCycleEnd:true})`
  // actually runs (zero-network, deterministic), proving the call succeeds
  // rather than merely that this suite never exercised it.
  const result = await cancelFollowerRenewal(cancelDb, { session: joined.session }, { env: ENV, loadAgent, now: T0 });
  ok("follower cancel: cancel_at_period_end is now true (a real provider ref existed, the call succeeded)", result.cancel_at_period_end === true);
  ok("follower cancel: state itself is untouched - access continues until period_end (law 5)", result.state === "active");

  // A SECOND follower whose subscription has NO provider ref yet (still
  // 'created', never authenticated) - the provider is never called at all,
  // and the local flag still flips cleanly.
  const joined2 = await joinRoom(cancelDb, { slug: SLUG, authUserId: "22222222-2222-4222-8222-222222222222", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 });
  const payload2 = readRoomSession(joined2.session);
  roomState.subs.push({
    subscription_id: "sub-follower-2", follower_id: followerIdFor(payload2), room_id: String(payload2.i),
    state: "created", provider: "fake", provider_subscription_ref: null, current_period_end: null,
  });
  const result2 = await cancelFollowerRenewal(cancelDb, { session: joined2.session }, { env: ENV, loadAgent, now: T0 });
  ok("follower cancel with no provider ref yet: no network attempted, the flag still flips", result2.cancel_at_period_end === true);

  let noSub = false;
  const joined3 = await joinRoom(cancelDb, { slug: SLUG, authUserId: "33333333-3333-4333-8333-333333333333", ageAttested: true, memoryConsent: true }, { loadAgent, now: T0 });
  try { await cancelFollowerRenewal(cancelDb, { session: joined3.session }, { env: ENV, loadAgent, now: T0 }); }
  catch { noSub = true; }
  ok("follower cancel with no subscription at all is refused, named", noSub);

  // ── creator: no session, owner+replica scope only ──
  {
    const state = { creatorSubs: [{ subscription_id: "cs1", owner_user_id: uuid(201), replica_id: uuid(202), provider: "fake", provider_subscription_ref: "fake_sub_creator1", state: "active", current_period_end: T3 }] };
    const db = async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("from vy_creator_subscription") && has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid") && has("state in (")) {
        const row = state.creatorSubs.find((s) => s.owner_user_id === params[0] && s.replica_id === params[1]);
        return row ? [{ subscription_id: row.subscription_id, provider: row.provider, provider_subscription_ref: row.provider_subscription_ref }] : [];
      }
      if (has("update vy_creator_subscription") && has("set cancel_at_period_end = true")) {
        const row = state.creatorSubs.find((s) => s.subscription_id === params[0]);
        row.cancel_at_period_end = true;
        return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end, cancel_at_period_end: true }];
      }
      throw new Error(`creator-cancel fixture: unrecognised statement: ${sql.slice(0, 90)}`);
    };
    const out = await cancelCreatorRenewal(db, { ownerUserId: uuid(201), replicaId: uuid(202) }, { env: ENV });
    ok("creator cancel: cancel_at_period_end true, state untouched (still 'active' locally)",
      out.cancel_at_period_end === true && out.state === "active");
    let refused = false;
    try { await cancelCreatorRenewal(db, { ownerUserId: uuid(201), replicaId: uuid(999) }, { env: ENV }); }
    catch { refused = true; }
    ok("creator cancel: no subscription for this owner+replica is refused, named", refused);
  }

  // ── org: admin membership required, via orgAdminOrThrow ──
  {
    const state = {
      orgs: [{ org_id: uuid(6), slug: "north-coaching", plan: "starter", seat_limit: 5 }],
      members: [{ org_id: uuid(6), owner_user_id: uuid(301), role: "admin" }],
      orgSubs: [{ subscription_id: "os1", org_id: uuid(6), provider: "fake", provider_subscription_ref: "fake_sub_org1", state: "active", current_period_end: T3 }],
    };
    const db = async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("from vy_org o") && has("join vy_org_member m")) {
        const org = state.orgs.find((o) => o.org_id === params[0]);
        const member = state.members.find((m) => m.org_id === params[0] && m.owner_user_id === params[1] && m.role === "admin");
        return org && member ? [{ org_id: org.org_id, slug: org.slug, plan: org.plan, seat_limit: org.seat_limit }] : [];
      }
      if (has("from vy_org_subscription") && has("org_id = ($1)::uuid") && has("state in (")) {
        const row = state.orgSubs.find((s) => s.org_id === params[0]);
        return row ? [{ subscription_id: row.subscription_id, provider: row.provider, provider_subscription_ref: row.provider_subscription_ref }] : [];
      }
      if (has("update vy_org_subscription") && has("set cancel_at_period_end = true")) {
        const row = state.orgSubs.find((s) => s.subscription_id === params[0]);
        row.cancel_at_period_end = true;
        return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end, cancel_at_period_end: true }];
      }
      throw new Error(`org-cancel fixture: unrecognised statement: ${sql.slice(0, 90)}`);
    };
    const out = await cancelOrgRenewal(db, { ownerUserId: uuid(301), orgId: uuid(6) }, { env: ENV });
    ok("org cancel: cancel_at_period_end true", out.cancel_at_period_end === true);
    let refused = false;
    try { await cancelOrgRenewal(db, { ownerUserId: uuid(999), orgId: uuid(6) }, { env: ENV }); }
    catch { refused = true; }
    ok("org cancel: a non-admin caller is refused (orgAdminOrThrow, reused verbatim)", refused);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: renewedUnaskedCount — the honest zero, and the wired count ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Fixture: three creators. c1 renewed AND was reminded (in_app, sent).
  // c2 renewed with NO sent in_app reminder. c3 has never renewed (its
  // current_period_start equals its own created_at, so it does not count
  // toward the denominator at all).
  function fixture() {
    return {
      rooms: [
        { room_id: "r1", owner_user_id: "o1" }, { room_id: "r2", owner_user_id: "o2" }, { room_id: "r3", owner_user_id: "o3" },
      ],
      creatorSubs: [
        { replica_id: "c1", owner_user_id: "o1", state: "active", created_at: "2026-06-01T00:00:00.000Z", current_period_start: "2026-08-01T00:00:00.000Z" },
        { replica_id: "c2", owner_user_id: "o2", state: "active", created_at: "2026-06-01T00:00:00.000Z", current_period_start: "2026-08-01T00:00:00.000Z" },
        { replica_id: "c3", owner_user_id: "o3", state: "active", created_at: "2026-08-01T00:00:00.000Z", current_period_start: "2026-08-01T00:00:00.000Z" },
      ],
      reminders: [
        { subject_kind: "creator", subject_id: "c1", period_end: "2026-08-01T00:00:00.000Z", channel: "in_app", sent_at: "2026-07-25T00:00:00.000Z" },
      ],
    };
  }
  function db(state) {
    return async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("count(distinct owner_user_id)")) return [{ creators: new Set(state.rooms.map((r) => r.owner_user_id)).size }];
      if (has("from vy_creator_subscription s") && has("left join vy_renewal_reminder r")) {
        const rows = state.creatorSubs.filter((s) => s.state === "active" && s.current_period_start && s.created_at < s.current_period_start);
        let renewedTotal = 0, renewedUnasked = 0;
        for (const s of rows) {
          renewedTotal++;
          const reminded = state.reminders.some((r) =>
            r.subject_kind === "creator" && r.subject_id === s.replica_id && r.period_end === s.current_period_start
            && r.channel === "in_app" && r.sent_at != null);
          if (!reminded) renewedUnasked++;
        }
        return [{ renewed_total: renewedTotal, renewed_unasked: renewedUnasked }];
      }
      throw new Error(`renewed-unasked fixture: unrecognised statement: ${sql.slice(0, 90)}`);
    };
  }

  const notApplied = await renewedUnaskedCount(db(fixture()), T0, { tableApplied: async () => false });
  ok("not applied: creators_total still counts distinct owners (3)", notApplied.creators_total === 3);
  ok("not applied: honest zero, n is 0", notApplied.renewed_unasked === 0 && notApplied.n === 0);
  ok("not applied: the note names exactly why", notApplied.note === "no reminder mechanism has been applied to this database yet");

  const wired = await renewedUnaskedCount(db(fixture()), T0, { tableApplied: async () => true });
  ok("wired: renewed_total is 2 (c1 and c2 both renewed; c3 never has)", wired.renewed_total === 2, String(wired.renewed_total));
  ok("wired: renewed_unasked is 1 (only c2 had no sent in_app reminder)", wired.renewed_unasked === 1, String(wired.renewed_unasked));
  ok("wired: n is renewed_total, not creators_total", wired.n === 2);
  ok("wired: a positive renewed_total clears the note", wired.note === "");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: followerRenewalTelegramText — both locales, with and without a price ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const withPrice = followerRenewalTelegramText(
    { name: "Anjali", periodEnd: T3, amountInr: 399, currency: "INR", providerName: "fake" }, "en",
  );
  ok("EN, with price: names the date and the amount", withPrice.includes("Anjali") && withPrice.includes("Rs 399"));
  ok("no em-dash or en-dash", !/[–—]/.test(withPrice));

  const noProvider = followerRenewalTelegramText(
    { name: "Anjali", periodEnd: T3, amountInr: 399, currency: "INR", providerName: "none" }, "en",
  );
  ok("PAYMENTS_PROVIDER=none: never claims an amount that cannot be charged", !noProvider.includes("Rs 399"));

  const hi = followerRenewalTelegramText(
    { name: "Anjali", periodEnd: T3, amountInr: 399, currency: "INR", providerName: "fake" }, "hi",
  );
  ok("HI locale renders different text from EN", hi !== withPrice);
  ok("HI: no em-dash or en-dash", !/[–—]/.test(hi));

  ok("no urgency/discount/countdown language in either locale", !/\b(hurry|limited|offer|last chance|expires soon)\b/i.test(withPrice));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: NEGATIVE CONTROL (c) — a follower's reminder carries no words of theirs ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(join(REPO, "api/_renewals.js"), "utf8");
  // The push payload builder's own law (checkinPushPayload's precedent,
  // api/_push/webpush.js): this module must never read a message body, a
  // conversation transcript, or anything from meera_log/vy_room_thread —
  // there is no follower-authored text anywhere in this file's own scope.
  ok("api/_renewals.js never reads meera_log (no conversation content in scope)", !src.includes("meera_log"));
  ok("api/_renewals.js never reads vy_room_thread (no thread titles in scope)", !src.includes("vy_room_thread"));
  // At the merge (2026-09-04) the live EXPLAIN refused the follower
  // due-select's `r.locale` (no such column on `vy_room`; a follower's
  // locale lives on `vy_room_follower`, WS-R24). So this file now names
  // `vy_room_follower` EXACTLY ONCE: a join by the follower's own
  // `follower_id` that selects `f.locale` and nothing else - one column of
  // one row, delivered back to that same follower. The room-leak battery
  // admits `_renewals.js` to ALLOWED for that shape (`_checkins.js`'s own
  // reason). A second reference, or a select list reaching any other `f.`
  // column, fails here.
  const followerRefs = src.match(/vy_room_follower\b/g) || [];
  ok("api/_renewals.js names vy_room_follower exactly once (the locale join, nothing else)", followerRefs.length === 1);
  ok("the one vy_room_follower reference is a join by the follower's own follower_id",
    /join vy_room_follower f on f\.follower_id = s\.follower_id/.test(src));
  const fCols = [...src.matchAll(/\bf\.([a-z_]+)/g)].map((m) => m[1]).filter((c) => c !== "follower_id");
  ok("the only follower column the due-select reads is locale", fCols.length === 1 && fCols[0] === "locale");
  const webpushSrc = readFileSync(join(REPO, "api/_push/webpush.js"), "utf8");
  const renewalStart = webpushSrc.indexOf("export function renewalPushPayload");
  const renewalEnd = webpushSrc.indexOf("\n}\n", renewalStart);
  const renewalPayloadFn = webpushSrc.slice(renewalStart, renewalEnd < 0 ? webpushSrc.length : renewalEnd + 2);
  // WS-R81: the wire contract now legitimately carries `body:`/`title:`
  // FIELD KEYS (the bare words this check used to ban outright), so the
  // banned list is now the actual CONTENT a renewal must never carry - a
  // date, an amount, a currency - never the field names the contract itself
  // requires. `periodEnd`/`amount`/`currency` are the exact identifiers
  // `dueReminders` (this same file) hands a caller that DOES need them
  // (the Telegram text, the studio card); their total absence here is what
  // proves this function never reaches for them.
  const banned = ["periodEnd", "amountInr", "amount_inr", "currency", "₹", "\\bRs\\b"];
  const bannedRegex = new RegExp(banned.join("|"), "i");
  const clean = !bannedRegex.test(renewalPayloadFn);
  ok("renewalPushPayload's own source never mentions a date, an amount or a currency",
    clean, clean ? "" : renewalPayloadFn);
  // NEGATIVE CONTROL: the same scan DOES flag a version that reaches for
  // the amount.
  const poisoned = 'export function renewalPushPayload(slug, displayName, amountInr) {\n  return JSON.stringify({ body: `Rs ${amountInr}` });\n}';
  ok("NEGATIVE CONTROL: the same scan DOES flag a poisoned version that carries amountInr",
    bannedRegex.test(poisoned));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
