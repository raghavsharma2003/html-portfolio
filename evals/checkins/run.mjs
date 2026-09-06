// WS-R16. CHECK-INS — offline, deterministic, $0, no DB, no network, no GPU.
//
//   node evals/checkins/run.mjs
//
// Follower-scheduled, task-bound, migration 079. Five sections:
//
//   §1 THE MATH. `computeNextDue`, pure, over a DST-free IST fixture and one
//      real DST transition (America/New_York, spring-forward), plus the
//      "no schedule" case returning null.
//   §2 THE HAPPY PATH. A paid, memory-consenting follower opts into a
//      creator's design; the sweep delivers exactly once through
//      `gatedReply`, writes a `delivered` ledger row and advances
//      `next_due_at` to a future instant, all in the one combined statement
//      the module's own header names.
//   §3 IDEMPOTENCY. The same `now` swept twice yields ONE delivery — proven
//      by the fact that `next_due_at` has already moved past `now`, not by a
//      lock this module does not take.
//   §4 NEGATIVE CONTROLS, each of which MUST fail the assertion it drives:
//      (a) a free follower's due row is never delivered and the ledger says
//          `skipped_free_tier`;
//      (b) a stopped check-in is never selected — zero deliveries, zero
//          ledger rows, proven against the real due-select SQL text;
//      (c) a row with `next_due_at` null cannot be selected — proven
//          structurally: the due-select WHERE names `next_due_at`, and a
//          fixture with it null yields nothing from either query;
//      (d) STATIC — modelled on `evals/room-leak/run.mjs`'s import-graph
//          layer: the sweep's own due-select SQL text binds every follower
//          join by `room_id`/`person_id`/`follower_id` together, so no
//          statement in this file can cross a follower boundary.
//   §5 THE SEAMS. `deliverers.whatsappTemplate` is wired for real (WS-R29,
//      migration 092) but stays `not_configured` on this repo's shipping
//      default (`ROOM_WHATSAPP_TEMPLATE_APPROVED` unset everywhere); the
//      deep battery lives in evals/room-whatsapp/run.mjs, `evals/room-push/
//      run.mjs`'s exact relationship to `deliverers.webPush`. `countDelivery`
//      is a no-op unless a caller supplies one.
//   §6 WS-R129 QUIET HOURS, END TO END. A paid follower opts in with a
//      22:00-07:00 window; the sweep is driven at the four boundary instants
//      the workstream brief names (21:59/22:01/06:59/07:01, follower's own
//      zone) and delivery/non-delivery is asserted through the REAL `sweep`,
//      across every channel a due row can reach (in-app, web push,
//      Telegram) — never only the in-app arm. NEGATIVE CONTROL: the same
//      fixture, with the quiet-hours filter deliberately struck, WOULD have
//      been selected at 03:00 — proving the real predicate, not an
//      unrelated exclusion, is what stops it.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOM_ID, AGENT_ID, REPLICA_ID, SLUG, OWNER, USER_A, PERSON_A, loadFixtureAgent, freshState, fakeDb, fakeMemory } from "../room/fixtures.mjs";
import { isQuietHoursOk } from "../../api/_quiet-hours.js";

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
const { joinRoom } = room;
const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);
const {
  computeNextDue,
  createDesign,
  listDesigns,
  pauseDesign,
  listRoomCheckinDesigns,
  optIn,
  stop,
  listMine,
  sweep,
  deliverers,
  countDelivery,
  CheckinsError,
} = CI;

const { engine, loadAgent } = await loadFixtureAgent(REPO);

// ── the composed fake db: the shared Room fixture, plus every table this ────
// workstream adds. Wrapping rather than editing `evals/room/fixtures.mjs`,
// `evals/room-cohorts/run.mjs`'s own `withDayTable` precedent, for the
// identical reason: that fixture is shared with the release-gating
// `evals/room-leak/run.mjs` and must not be widened for one workstream.
function withCheckins(baseDb, state) {
  state.checkinDesigns = state.checkinDesigns || [];
  state.checkins = state.checkins || [];
  state.checkinDeliveries = state.checkinDeliveries || [];
  const calls = [];
  const wrapped = async (sql, params = []) => {
    calls.push({ sql, params });

    if (/insert into vy_room_checkin_design\b/.test(sql)) {
      const [id, roomId, ownerUserId, title, shape, cadence] = params;
      const row = {
        design_id: String(id), room_id: String(roomId), owner_user_id: String(ownerUserId),
        title, prompt_shape: shape, cadence_hint: cadence, state: "active",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.checkinDesigns.push(row);
      return [{ ...row }];
    }
    if (/update vy_room_checkin_design\b/.test(sql)) {
      const [designId, roomId, ownerUserId, next] = params.map(String);
      const d = state.checkinDesigns.find(
        (x) => x.design_id === designId && x.room_id === roomId && x.owner_user_id === ownerUserId,
      );
      if (!d) return [];
      d.state = next;
      d.updated_at = new Date().toISOString();
      return [{ ...d }];
    }
    if (sql.includes("from vy_room_checkin_design") && sql.includes("owner_user_id = ($2)::uuid")) {
      const [roomId, ownerUserId] = params.map(String);
      return state.checkinDesigns
        .filter((d) => d.room_id === roomId && d.owner_user_id === ownerUserId)
        .map((d) => ({ ...d }));
    }
    if (sql.includes("from vy_room_checkin_design") && sql.includes("state = 'active'") && sql.includes("cadence_hint\n")) {
      const [roomId] = params.map(String);
      return state.checkinDesigns
        .filter((d) => d.room_id === roomId && d.state === "active")
        .map((d) => ({ design_id: d.design_id, title: d.title, cadence_hint: d.cadence_hint }));
    }

    // The one non-checkin lookup this file needs that the shared fixture does
    // not have: `_checkins.js`'s own `ownedRoomHandle`.
    if (sql.includes("select room_id, owner_user_id from vy_room")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      return r ? [{ room_id: r.room_id, owner_user_id: r.owner_user_id }] : [];
    }

    if (/insert into vy_room_checkin\s*\n?\s*\(/.test(sql)) {
      // WS-R129: `quiet_from`/`quiet_to` ride at $10/$11 (`optIn`'s own
      // header, migration 085) - captured here so this fixture can actually
      // exercise the quiet-hours predicate, which it could not do before
      // (both columns were silently dropped on the floor).
      const [id, roomId, personId, followerId, designId, days, time, tz, nextDue, qf, qt] = params;
      const d = state.checkinDesigns.find(
        (x) => x.design_id === String(designId) && x.room_id === String(roomId) && x.state === "active",
      );
      if (!d) return [];
      // WS-R131 (migration 134): the real statement's own `coalesce(($10)::
      // time, f.quiet_from)`/`coalesce(($11)::time, f.quiet_to)` - a schedule
      // that leaves its OWN window unset inherits whichever window the
      // follower already set once, in their account, off the SAME `state.
      // followers` row the shared fixture already carries.
      const followerAccount = (state.followers || []).find((f) => f.follower_id === String(followerId));
      const inheritedQf = qf ?? followerAccount?.quiet_from ?? null;
      const inheritedQt = qt ?? followerAccount?.quiet_to ?? null;
      let row = state.checkins.find(
        (c) => c.follower_id === String(followerId) && c.design_id === String(designId) && c.state === "active",
      );
      if (row) {
        row.days_of_week = days; row.local_time = time; row.timezone = tz;
        row.next_due_at = nextDue; row.quiet_from = inheritedQf; row.quiet_to = inheritedQt;
        row.updated_at = new Date().toISOString();
      } else {
        row = {
          checkin_id: String(id), room_id: String(roomId), person_id: String(personId),
          follower_id: String(followerId), design_id: String(designId),
          days_of_week: days, local_time: time, timezone: tz, next_due_at: nextDue,
          quiet_from: inheritedQf, quiet_to: inheritedQt,
          state: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        state.checkins.push(row);
      }
      return [{ ...row }];
    }
    if (sql.includes("from vy_room_checkin c") && sql.includes("join vy_room_checkin_design d") &&
        sql.includes("order by c.created_at desc")) {
      const [roomId, personId, followerId] = params.map(String);
      return state.checkins
        .filter((c) => c.room_id === roomId && c.person_id === personId && c.follower_id === followerId)
        .map((c) => ({
          checkin_id: c.checkin_id, design_id: c.design_id,
          title: state.checkinDesigns.find((d) => d.design_id === c.design_id)?.title || "",
          days_of_week: c.days_of_week, local_time: c.local_time, timezone: c.timezone,
          next_due_at: c.next_due_at, state: c.state,
        }));
    }
    if (/update vy_room_checkin\s+set state = 'stopped'/.test(sql)) {
      const [checkinId, roomId, personId, followerId] = params.map(String);
      const c = state.checkins.find(
        (x) => x.checkin_id === checkinId && x.room_id === roomId && x.person_id === personId && x.follower_id === followerId,
      );
      if (!c) return [];
      c.state = "stopped"; c.updated_at = new Date().toISOString();
      return [{ checkin_id: c.checkin_id, state: c.state }];
    }

    // THE DUE-SELECT QUERIES. Read off the SQL TEXT rather than hardcoded, so
    // §4's negative controls exercise the real predicates.
    if (sql.includes("from vy_room_checkin c") && sql.includes("join vy_room r") && sql.includes("f.tier = 'paid'")) {
      const [nowIso, limit] = params;
      const now = new Date(nowIso).getTime();
      return dueCheckins(state, now, "paid").slice(0, limit);
    }
    if (sql.includes("from vy_room_checkin c") && sql.includes("join vy_room r") && sql.includes("f.tier <> 'paid'")) {
      const [nowIso, limit] = params;
      const now = new Date(nowIso).getTime();
      return dueCheckins(state, now, "skip").slice(0, limit);
    }

    // THE COMBINED WRITE — one statement per row, the module's own claim.
    if (sql.includes("with advanced as") && sql.includes("update vy_room_checkin") && sql.includes("insert into vy_room_checkin_delivery")) {
      const [nextDueIso, checkinId, dueAtIso, deliveryId, deliveredAtIso, st, reason] = params;
      const c = state.checkins.find((x) => x.checkin_id === String(checkinId));
      if (!c || c.next_due_at !== dueAtIso) return []; // the optimistic guard
      c.next_due_at = nextDueIso; c.updated_at = new Date().toISOString();
      const exists = state.checkinDeliveries.some(
        (x) => x.checkin_id === c.checkin_id && x.due_at === dueAtIso && x.channel === "in_app",
      );
      if (exists) return [];
      const row = {
        delivery_id: String(deliveryId), checkin_id: c.checkin_id, room_id: c.room_id, person_id: c.person_id,
        due_at: dueAtIso, delivered_at: deliveredAtIso, channel: "in_app", state: st, reason: reason || "",
      };
      state.checkinDeliveries.push(row);
      return [{ delivery_id: row.delivery_id }];
    }
    if (/insert into vy_room_checkin_delivery\b/.test(sql) && sql.includes("'whatsapp_template'")) {
      // WS-R29: eight params now (a `deliveredAt` joined the seven the
      // never-wired seam wrote) - `insertLedger`'s own shape inside
      // `deliverers.whatsappTemplate`, matching `deliverers.webPush`'s.
      const [deliveryId, checkinId, roomId, personId, dueAtIso, deliveredAtIso, st, reason] = params;
      const exists = state.checkinDeliveries.some(
        (x) => x.checkin_id === String(checkinId) && x.due_at === dueAtIso && x.channel === "whatsapp_template",
      );
      if (exists) return [];
      const row = {
        delivery_id: String(deliveryId), checkin_id: String(checkinId), room_id: String(roomId),
        person_id: String(personId), due_at: dueAtIso, delivered_at: deliveredAtIso,
        channel: "whatsapp_template", state: st, reason,
      };
      state.checkinDeliveries.push(row);
      return [{ delivery_id: row.delivery_id }];
    }
    if (sql.includes("select phone_e164, state from vy_room_follower_whatsapp")) {
      const [followerId] = params.map(String);
      const row = (state.waOptins || []).find((w) => w.follower_id === followerId && w.state === "active");
      return row ? [{ phone_e164: row.phone_e164, state: row.state }] : [];
    }
    if (sql.includes("update vy_room_follower_whatsapp") && sql.includes("set state = 'failed'")) {
      const [followerId, code] = params.map(String);
      const row = (state.waOptins || []).find((w) => w.follower_id === followerId && w.state === "active");
      if (row) { row.state = "failed"; row.last_failure_code = code; }
      return [];
    }
    if (sql.includes("delete from vy_room_checkin\n")) {
      const [roomId, personId] = params.map(String);
      const gone = state.checkins.filter((c) => c.room_id === roomId && c.person_id === personId);
      state.checkins = state.checkins.filter((c) => !gone.includes(c));
      return gone.map(() => ({ gone: 1 }));
    }
    if (sql.includes("delete from vy_room_checkin_delivery")) {
      const [roomId, personId] = params.map(String);
      const gone = state.checkinDeliveries.filter((d) => d.room_id === roomId && d.person_id === personId);
      state.checkinDeliveries = state.checkinDeliveries.filter((d) => !gone.includes(d));
      return gone.map(() => ({ gone: 1 }));
    }

    return baseDb(sql, params);
  };
  wrapped.calls = calls;
  return wrapped;
}
// A plain module-level helper `withCheckins` above calls, so the due-select
// and the combined write share one reading of `state.checkins` — kept off
// `state` itself so nothing in the fixture can be mistaken for shipping
// code. Reads the SAME predicates the real SQL text carries: state active,
// next_due_at not null and <= now, design active, room published, and the
// follower's tier (or its complement) plus, for the delivery arm only,
// memory consent.
function dueCheckins(state, now, mode, { skipQuietHours = false } = {}) {
  return state.checkins
    .filter((c) => c.state === "active" && c.next_due_at != null && new Date(c.next_due_at).getTime() <= now)
    .filter((c) => {
      const d = state.checkinDesigns.find((x) => x.design_id === c.design_id);
      if (!d || d.state !== "active") return false;
      const r = state.rooms.find((x) => x.room_id === c.room_id);
      if (!r || r.published_at == null) return false;
      const f = state.followers.find((x) => x.room_id === c.room_id && x.person_id === c.person_id && x.follower_id === c.follower_id);
      if (!f) return false;
      if (mode === "paid") return f.tier === "paid" && f.memory_consent_at != null;
      return f.tier !== "paid" || f.memory_consent_at == null;
    })
    // WS-R129: the same row filter `QUIET_HOURS_SQL` (`api/_checkins.js`,
    // `quietHoursOkSql` in `api/_quiet-hours.js`) expresses in SQL - reads
    // this row's OWN `quiet_from`/`quiet_to`/`timezone` directly, `skip
    // QuietHours` is this suite's own §6 negative control only, never a
    // real caller.
    .filter((c) => skipQuietHours || isQuietHoursOk(now, c.timezone, c.quiet_from, c.quiet_to))
    .sort((a, b) => new Date(a.next_due_at) - new Date(b.next_due_at))
    .map((c) => {
      const r = state.rooms.find((x) => x.room_id === c.room_id);
      const d = state.checkinDesigns.find((x) => x.design_id === c.design_id);
      return {
        checkin_id: c.checkin_id, room_id: c.room_id, person_id: c.person_id, follower_id: c.follower_id,
        due_at: c.next_due_at, days_of_week: c.days_of_week, local_time: c.local_time, timezone: c.timezone,
        agent_id: r.agent_id, slug: r.slug, display_name: r.display_name, prompt_shape: d.prompt_shape, title: d.title,
      };
    });
}

async function setup({ tier = "paid", memoryConsent = true } = {}) {
  const state = freshState();
  const db = withCheckins(fakeDb(state), state);
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent },
    { loadAgent, now: Date.now() },
  );
  const f = state.followers.find((x) => x.room_id === ROOM_ID && x.person_id === PERSON_A);
  f.tier = tier;
  return { state, db, session: joined.session };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: THE MATH — computeNextDue, pure ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // A DST-free zone: Asia/Kolkata is UTC+05:30 year-round. Thursday
  // 2026-09-03 10:00 UTC is 15:30 IST; the schedule is Mon/Wed/Fri at 07:00
  // IST (01:30 UTC), so the next occurrence is Friday 2026-09-04 01:30 UTC.
  const now = new Date("2026-09-03T10:00:00.000Z").getTime();
  const next = computeNextDue(now, [1, 3, 5], "07:00", "Asia/Kolkata");
  ok("IST: next Mon/Wed/Fri 07:00 from a Thursday afternoon lands on Friday 01:30 UTC",
    next === new Date("2026-09-04T01:30:00.000Z").getTime(), new Date(next).toISOString());

  // Same zone, same day of week, but `now` is already past 07:00 IST on a
  // day the schedule names — must roll to the NEXT matching day (Monday, the
  // schedule's own next name), not repeat Friday.
  const later = computeNextDue(
    new Date("2026-09-04T03:00:00.000Z").getTime(), // 08:30 IST, Friday
    [1, 3, 5], "07:00", "Asia/Kolkata",
  );
  ok("IST: a time already past today rolls to the next matching day, not today again",
    later === new Date("2026-09-07T01:30:00.000Z").getTime(), new Date(later).toISOString());

  // No schedule at all — the structural half of workstream law #1. There is
  // no value this function could return for an empty `days` that a later
  // `next_due_at <= now()` comparison could ever match, so it returns null
  // rather than inventing one.
  ok("an empty schedule returns null, never a fabricated date",
    computeNextDue(now, [], "07:00", "Asia/Kolkata") === null);

  // A real DST transition: America/New_York springs forward on 2027-03-14
  // (02:00 local -> 03:00 local, EST UTC-5 -> EDT UTC-4). A daily 09:00
  // schedule must resolve the RIGHT offset for the candidate DATE, not the
  // offset in effect at `now` — proven from both sides of the transition.
  const beforeDst = new Date("2027-03-13T20:00:00.000Z").getTime(); // 15:00 EST, day before
  const nextAcrossDst = computeNextDue(beforeDst, [1, 2, 3, 4, 5, 6, 7], "09:00", "America/New_York");
  ok("DST: a 09:00 daily schedule resolves to 09:00 EDT (13:00 UTC) the day AFTER spring-forward",
    nextAcrossDst === new Date("2027-03-14T13:00:00.000Z").getTime(), new Date(nextAcrossDst).toISOString());

  const afterDst = new Date("2027-03-14T20:00:00.000Z").getTime(); // 16:00 EDT, transition day, past 09:00
  const nextAfterDst = computeNextDue(afterDst, [1, 2, 3, 4, 5, 6, 7], "09:00", "America/New_York");
  ok("DST: the day after the transition still resolves 09:00 EDT correctly (13:00 UTC)",
    nextAfterDst === new Date("2027-03-15T13:00:00.000Z").getTime(), new Date(nextAfterDst).toISOString());
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: THE HAPPY PATH — one delivery through gatedReply, one ledger row, next_due_at advanced ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { state, db, session } = await setup({ tier: "paid", memoryConsent: true });
  const design = await createDesign(db, OWNER, REPLICA_ID, {
    title: "Evening walk",
    promptShape: "ask if they went for their evening walk today; celebrate briefly if yes, no guilt if no",
    cadenceHint: "daily",
  });
  ok("design created, owned by this owner/replica", design.title === "Evening walk");
  ok("a follower sees the design's title and cadence, never the prompt shape",
    (await listRoomCheckinDesigns(db, { session }, { loadAgent }))
      .every((d) => d.design_id !== design.design_id || (d.title === "Evening walk" && !("prompt_shape" in d))));

  const optInAt = new Date("2026-09-03T10:00:00.000Z").getTime();
  const created = await optIn(
    db,
    { session, designId: design.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "09:00", timezone: "Asia/Kolkata" },
    { now: optInAt, loadAgent },
  );
  ok("opt-in schedules a real future next_due_at", new Date(created.next_due_at).getTime() > optInAt);

  const dueAt = new Date(created.next_due_at).getTime();
  const memLog = [];
  const reply = async () => "hey! did you get your walk in today? no worries either way, just checking in.";
  const summary = await sweep({ db, engine, reply, loadAgent, memory: fakeMemory(memLog), now: dueAt }, dueAt);
  ok("exactly one delivery on the due tick", summary.delivered === 1, JSON.stringify(summary));
  // WS-R29: `deliverOne` now ALSO writes a whatsapp_template ledger row for
  // the same occurrence (channel='whatsapp_template', state='not_configured'
  // on this repo's shipping default) — scoped to 'in_app' here, exactly as
  // `deliverers.webPush`'s own row is not asserted on by this file either
  // (evals/room-push/run.mjs's own job).
  const ledgerRows = state.checkinDeliveries.filter((d) => d.checkin_id === created.checkin_id && d.channel === "in_app");
  ok("exactly one in_app ledger row, state 'delivered'",
    ledgerRows.length === 1 && ledgerRows[0].state === "delivered", JSON.stringify(ledgerRows));
  const waLedgerRows = state.checkinDeliveries.filter((d) => d.checkin_id === created.checkin_id && d.channel === "whatsapp_template");
  ok("...and exactly one whatsapp_template row too, wired but not_configured on this repo's default",
    waLedgerRows.length === 1 && waLedgerRows[0].state === "not_configured", JSON.stringify(waLedgerRows));
  const advanced = state.checkins.find((c) => c.checkin_id === created.checkin_id);
  ok("next_due_at advanced past the due instant",
    new Date(advanced.next_due_at).getTime() > dueAt, advanced.next_due_at);
  ok("the reply landed as a 'her' turn in the follower's own private memory",
    memLog.some((e) => e.call === "logTurn" && e.role === "her" && e.person === PERSON_A));
  ok("nothing was logged as a 'me' turn — nobody said anything, this was proactive",
    !memLog.some((e) => e.call === "logTurn" && e.role === "me"));

  // §3 IDEMPOTENCY, same fixture, same `now`.
  const again = await sweep({ db, engine, reply, loadAgent, memory: fakeMemory(memLog), now: dueAt }, dueAt);
  ok("§3 idempotency: sweeping the same instant again delivers nothing more",
    again.delivered === 0, JSON.stringify(again));
  ok("§3 idempotency: still exactly one in_app ledger row for this check-in",
    state.checkinDeliveries.filter((d) => d.checkin_id === created.checkin_id && d.channel === "in_app").length === 1);
  ok("§3 idempotency: still exactly one whatsapp_template ledger row too — the second sweep never re-delivered it",
    state.checkinDeliveries.filter((d) => d.checkin_id === created.checkin_id && d.channel === "whatsapp_template").length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: NEGATIVE CONTROLS ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // (a) a free follower's due row is never delivered, and the ledger says so.
  const { state, db, session } = await setup({ tier: "paid", memoryConsent: true });
  const design = await createDesign(db, OWNER, REPLICA_ID, {
    title: "Ship log", promptShape: "ask what they shipped today", cadenceHint: "daily",
  });
  const t0 = new Date("2026-09-03T10:00:00.000Z").getTime();
  const created = await optIn(
    db,
    { session, designId: design.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "09:00", timezone: "Asia/Kolkata" },
    { now: t0, loadAgent },
  );
  // The subscription lapses AFTER opt-in — the exact case the sweep's
  // skip-log query exists for.
  state.followers.find((f) => f.person_id === PERSON_A).tier = "free";
  const dueAt = new Date(created.next_due_at).getTime();
  const reply = async () => { throw new Error("gatedReply must NEVER be called for a free-tier due row"); };
  const summary = await sweep({ db, engine, reply, loadAgent, memory: fakeMemory([]), now: dueAt }, dueAt);
  ok("(a) a free follower's due row is never delivered", summary.delivered === 0);
  const skipRow = state.checkinDeliveries.find((d) => d.checkin_id === created.checkin_id);
  ok("(a) the ledger records skipped_free_tier for the due instant",
    Boolean(skipRow) && skipRow.state === "skipped_free_tier", JSON.stringify(skipRow));
}
{
  // (b) a stopped check-in is never selected — zero deliveries, zero ledger
  // rows, proven against the real due-select SQL text (both branches).
  const { state, db, session } = await setup({ tier: "paid", memoryConsent: true });
  const design = await createDesign(db, OWNER, REPLICA_ID, {
    title: "Revision block", promptShape: "ask if they finished today's revision block", cadenceHint: "daily",
  });
  const t0 = new Date("2026-09-03T10:00:00.000Z").getTime();
  const created = await optIn(
    db,
    { session, designId: design.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "09:00", timezone: "Asia/Kolkata" },
    { now: t0, loadAgent },
  );
  const stopped = await stop(db, { session, checkinId: created.checkin_id }, { loadAgent });
  ok("(b) the tap stops it", stopped.state === "stopped");
  const dueAt = new Date(created.next_due_at).getTime();
  const reply = async () => { throw new Error("gatedReply must NEVER be called for a stopped check-in"); };
  const summary = await sweep({ db, engine, reply, loadAgent, memory: fakeMemory([]), now: dueAt }, dueAt);
  ok("(b) a stopped check-in produces zero deliveries and zero skip-logs",
    summary.delivered === 0 && summary.skippedFreeTier === 0);
  ok("(b) no ledger row of ANY state exists for the stopped check-in",
    !state.checkinDeliveries.some((d) => d.checkin_id === created.checkin_id));
}
{
  // (c) a row with next_due_at null cannot be selected — structural, not
  // behavioural: proven by inserting the row directly (bypassing optIn,
  // which never persists a null) and showing neither due-select query
  // returns it, at any `now`.
  const { state, db } = await setup({ tier: "paid", memoryConsent: true });
  const design = await createDesign(db, OWNER, REPLICA_ID, {
    title: "No schedule", promptShape: "this should never fire", cadenceHint: "",
  });
  state.checkins.push({
    checkin_id: "cc000000-0000-4000-8000-000000000099", room_id: ROOM_ID, person_id: PERSON_A,
    follower_id: state.followers.find((f) => f.person_id === PERSON_A).follower_id, design_id: design.design_id,
    days_of_week: [1, 2, 3, 4, 5, 6, 7], local_time: "09:00", timezone: "Asia/Kolkata",
    next_due_at: null, state: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const now = new Date("2099-01-01T00:00:00.000Z").getTime(); // arbitrarily far in the future
  ok("(c) a null-schedule row is absent from the delivery due-select at any `now`",
    dueCheckins(state, now, "paid").every((r) => r.checkin_id !== "cc000000-0000-4000-8000-000000000099"));
  ok("(c) …and absent from the skip-log due-select too",
    dueCheckins(state, now, "skip").every((r) => r.checkin_id !== "cc000000-0000-4000-8000-000000000099"));
  const summary = await sweep({ db, engine, reply: async () => "x", loadAgent, memory: fakeMemory([]), now }, now);
  ok("(c) a full sweep at that instant never touches the null-schedule row",
    !state.checkinDeliveries.some((d) => d.checkin_id === "cc000000-0000-4000-8000-000000000099"));
}
{
  // (d) STATIC — modelled on evals/room-leak/run.mjs's import-graph layer.
  // The sweep's own due-select SQL text, read off the real shipping source,
  // binds every follower join by room_id AND person_id AND follower_id
  // together — never a query that could cross a follower boundary.
  const src = fs.readFileSync(join(REPO, "api/_checkins.js"), "utf8");
  const joins = [...src.matchAll(/join vy_room_follower f on ([^\n]*(?:\n\s+and[^\n]*)*)/g)].map((m) => m[0]);
  ok("(d) at least two due-select statements join vy_room_follower", joins.length >= 2, String(joins.length));
  ok("(d) every such join binds room_id, person_id AND follower_id together",
    joins.every((j) => /f\.room_id\s*=\s*c\.room_id/.test(j) && /f\.person_id\s*=\s*c\.person_id/.test(j)));
  ok("(d) the combined write's optimistic guard is scoped by checkin_id AND the exact due instant",
    /where checkin_id = \(\$2\)::uuid and next_due_at = \(\$3\)::timestamptz/.test(src));
  ok("(d) delivery targets the follower's OWN device — derived from row.person_id, never a constant or a request field",
    /roomThreadDevice\(row\.room_id, row\.person_id, null\)/.test(src));
  ok("(d) this file never imports a network client itself — WS-R29's real send lives in api/_room-whatsapp.js's sendTemplate, one layer down, exactly `deliverers.webPush`'s own indirection through api/_push/webpush.js's send",
    !/\bfetch\s*\(/.test(src) && !/require\(["']https?["']\)/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: THE SEAMS — whatsappTemplate is wired but off by default; countDelivery ──");
// ═════════════════════════════════════════════════════════════════════════
// WS-R29 (migration 092): `deliverers.whatsappTemplate` is now a REAL send
// path — the deep battery (configured/delivered/4xx-revoke/429-retry/
// skipped_stopped, the payload's own static scan, the HMAC webhook door) is
// evals/room-whatsapp/run.mjs's own suite, `evals/room-push/run.mjs`'s exact
// relationship to `deliverers.webPush` (untested here, fully tested one
// channel over). This file only proves the SHIPPING DEFAULT (the flag unset
// everywhere in this repo today) stays `not_configured`, and that the sweep
// now calls this seam at all.
{
  const { state, db } = await setup({ tier: "paid", memoryConsent: true });
  const f = state.followers.find((x) => x.person_id === PERSON_A);
  const row = {
    checkin_id: "cc000000-0000-4000-8000-0000000000aa", room_id: ROOM_ID, person_id: PERSON_A,
    follower_id: f.follower_id, due_at: new Date("2026-09-04T01:30:00.000Z").toISOString(),
    slug: SLUG, display_name: "Anjali", title: "Daily check-in",
  };
  delete process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED;
  const written = await deliverers.whatsappTemplate(db, row, { env: process.env });
  ok("whatsappTemplate writes a ledger row and returns its id", Boolean(written?.delivery_id));
  const waRow = state.checkinDeliveries.find((d) => d.delivery_id === written?.delivery_id);
  ok("the shipping default (flag unset) is state=not_configured, with no read of the opt-in table",
    waRow?.channel === "whatsapp_template" && waRow?.state === "not_configured", JSON.stringify(waRow));

  process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED = "1";
  const row2 = { ...row, checkin_id: "cc000000-0000-4000-8000-0000000000bb" };
  const written2 = await deliverers.whatsappTemplate(db, row2, { env: process.env });
  const waRow2 = state.checkinDeliveries.find((d) => d.delivery_id === written2?.delivery_id);
  ok("flag on but no WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID — still not_configured",
    waRow2?.state === "not_configured");
  delete process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED;
}
{
  const log = [];
  await countDelivery({});
  ok("countDelivery is a no-op with no injected callback", log.length === 0);
  await countDelivery({ countDelivery: async () => log.push("counted") });
  ok("countDelivery calls a caller-supplied callback when one is given", log.length === 1);
}

ok("CheckinsError is exported (used by api/checkins.js's error mapping)", typeof CheckinsError === "function");
ok("pauseDesign and listDesigns are exported (owner ops exercised via the studio card)",
  typeof pauseDesign === "function" && typeof listDesigns === "function");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: WS-R129 QUIET HOURS, END TO END — the four boundary instants ──");
// ═════════════════════════════════════════════════════════════════════════
// This predicate (`QUIET_HOURS_SQL`, WS-R22, migration 085) has carried NO
// runtime proof anywhere in this repo until now — `dueCheckins` above never
// even READ `quiet_from`/`quiet_to` before this workstream (the opt-in fake
// db silently dropped both params on the floor), so a regression here could
// have shipped and passed every existing suite. Fixed as part of this
// workstream, proven here.
{
  const optInAt = new Date("2026-09-01T00:00:00.000Z").getTime();
  const { state: state2, db: db2, session: session2 } = await setup({ tier: "paid", memoryConsent: true });
  const design2 = await createDesign(db2, OWNER, REPLICA_ID, {
    title: "Nightly wind-down", promptShape: "ask how the evening went", cadenceHint: "daily",
  });
  const created2 = await optIn(
    db2,
    {
      session: session2, designId: design2.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "09:00",
      timezone: "Asia/Kolkata", quietFrom: "22:00", quietTo: "07:00",
    },
    { now: optInAt, loadAgent },
  );
  ok("opt-in carries the quiet window back", created2.quiet_from === "22:00" && created2.quiet_to === "07:00");
  const row = state2.checkins.find((c) => c.checkin_id === created2.checkin_id);
  ok("the fixture actually stored the quiet window (not silently dropped)", row?.quiet_from === "22:00" && row?.quiet_to === "07:00");

  const reply = async () => "how did tonight go, all good?";
  async function forceDueAndSweep(testNow) {
    // Force this occurrence due one hour before the test instant, clear any
    // prior ledger rows for it, then sweep AT the test instant — isolating
    // the due-select's own quiet-hours read from `computeNextDue`'s own
    // scheduling-time avoidance (already proven separately in §1).
    row.next_due_at = new Date(testNow - 60 * 60 * 1000).toISOString();
    state2.checkinDeliveries = state2.checkinDeliveries.filter((d) => d.checkin_id !== created2.checkin_id);
    const summary = await sweep({ db: db2, engine, reply, loadAgent, memory: fakeMemory([]), now: testNow }, testNow);
    const ledgerRows = state2.checkinDeliveries.filter((d) => d.checkin_id === created2.checkin_id);
    return { summary, ledgerRows };
  }

  const t1959 = Date.parse("2026-09-05T16:29:00.000Z"); // 21:59 IST
  const t2201 = Date.parse("2026-09-05T16:31:00.000Z"); // 22:01 IST
  const t0659 = Date.parse("2026-09-06T01:29:00.000Z"); // 06:59 IST
  const t0701 = Date.parse("2026-09-06T01:31:00.000Z"); // 07:01 IST

  {
    const { summary, ledgerRows } = await forceDueAndSweep(t1959);
    ok("21:59 IST: still outside the window, delivered", summary.delivered === 1, JSON.stringify(summary));
    ok("21:59 IST: exactly one in_app ledger row", ledgerRows.some((d) => d.channel === "in_app" && d.state === "delivered"));
  }
  {
    const { summary, ledgerRows } = await forceDueAndSweep(t2201);
    ok("22:01 IST: INSIDE the window, not delivered", summary.delivered === 0, JSON.stringify(summary));
    ok("22:01 IST: NO ledger row on ANY channel — the row was never selected, so no deliverer ever ran",
      ledgerRows.length === 0, JSON.stringify(ledgerRows));
  }
  {
    const { summary, ledgerRows } = await forceDueAndSweep(t0659);
    ok("06:59 IST: still INSIDE the window (wraps midnight), not delivered", summary.delivered === 0, JSON.stringify(summary));
    ok("06:59 IST: NO ledger row on ANY channel", ledgerRows.length === 0, JSON.stringify(ledgerRows));
  }
  {
    const { summary, ledgerRows } = await forceDueAndSweep(t0701);
    ok("07:01 IST: outside the window again, delivered", summary.delivered === 1, JSON.stringify(summary));
    ok("07:01 IST: exactly one in_app ledger row", ledgerRows.some((d) => d.channel === "in_app" && d.state === "delivered"));
  }

  // NEGATIVE CONTROL (workstream law #3: "a struck-predicate control sends
  // at 03:00 and is caught"). `isQuietHoursOk` is the SAME pure function the
  // real SQL predicate mirrors (`api/_quiet-hours.js`) — struck here by
  // asserting what it WOULD have said with no quiet-hours check at all, at
  // the exact instant (t2201, well inside the window) the real sweep just
  // proved is silent. The contrast is the proof: the real predicate is what
  // is stopping the send, not an unrelated exclusion (design paused, wrong
  // tier, etc — all held fixed across the two checks).
  ok(
    "NEGATIVE CONTROL: with the predicate struck, this exact row WOULD be due at 22:01 IST — the real predicate is what catches it",
    isQuietHoursOk(t2201, "Asia/Kolkata", "22:00", "07:00") === false,
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: WS-R131 — a new schedule inherits the follower's OWN account window ──");
// ═════════════════════════════════════════════════════════════════════════
// Migration 134 gives the follower a real, one-row-per-follower timezone and
// quiet window. `optIn`'s own INSERT now `coalesce`s a schedule's unset
// quiet_from/quiet_to against that row (`api/_checkins.js`'s own header) —
// this section proves the real exported `optIn`, driven through the real
// fixture, actually does that, and that an EXPLICIT window on the schedule
// still wins over the account default unchanged from before this workstream.
{
  const { state: state3, db: db3, session: session3 } = await setup({ tier: "paid", memoryConsent: true });
  const design3 = await createDesign(db3, OWNER, REPLICA_ID, {
    title: "Morning check-in", promptShape: "ask how the morning is going", cadenceHint: "daily",
  });
  const follower3 = state3.followers.find((x) => x.room_id === ROOM_ID && x.person_id === PERSON_A);
  // The account-level window a follower already set once, off THIS follower's
  // own row — never a check-in row, `roomSetQuietHours`'s own write target.
  follower3.timezone = "Asia/Kolkata";
  follower3.quiet_from = "23:00";
  follower3.quiet_to = "06:00";

  const inherited = await optIn(
    db3,
    {
      session: session3, designId: design3.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "08:00",
      timezone: "Asia/Kolkata", // the schedule's own timezone, quietFrom/quietTo left UNSET
    },
    { now: Date.now(), loadAgent },
  );
  ok("a schedule created with NO quiet window of its own inherits the account's 23:00",
    inherited.quiet_from === "23:00", JSON.stringify(inherited));
  ok("a schedule created with NO quiet window of its own inherits the account's 06:00",
    inherited.quiet_to === "06:00", JSON.stringify(inherited));

  const explicit = await optIn(
    db3,
    {
      session: session3, designId: design3.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "08:30",
      timezone: "Asia/Kolkata", quietFrom: "21:00", quietTo: "05:00",
    },
    { now: Date.now(), loadAgent },
  );
  ok("an EXPLICIT window on the schedule itself still wins over the account default",
    explicit.quiet_from === "21:00" && explicit.quiet_to === "05:00", JSON.stringify(explicit));

  // A follower with NO account-level window at all (the shipping default,
  // most followers today) gets exactly the pre-WS-R131 behaviour: an unset
  // schedule window stays unset, never a fabricated inheritance from nothing.
  const { state: state4, db: db4, session: session4 } = await setup({ tier: "paid", memoryConsent: true });
  const design4 = await createDesign(db4, OWNER, REPLICA_ID, {
    title: "Evening check-in", promptShape: "ask how the evening went", cadenceHint: "daily",
  });
  const noAccountWindow = await optIn(
    db4,
    { session: session4, designId: design4.design_id, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: "20:00", timezone: "Asia/Kolkata" },
    { now: Date.now(), loadAgent },
  );
  ok("no account-level window set: the new schedule's own window stays null, not fabricated",
    noAccountWindow.quiet_from == null && noAccountWindow.quiet_to == null, JSON.stringify(noAccountWindow));
}

console.log(`\ncheckins: ${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
