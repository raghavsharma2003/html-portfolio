// WS-R140 (the door battery's fifth pass): TIME AND ORDER.
//
//   node evals/room-doors/order.mjs
//
// Four passes (WS-R38/WS-R51/WS-R95/WS-R109 in `run.mjs`) attacked identity,
// scope and shape. None attacked ORDER. This file does: money and forgetting
// are where order bites — a charge landing after a forget, a reward counted
// twice by two webhooks in flight, a reminder sent after a cancel, a webhook
// applied out of the order it actually happened in. Every scenario below
// drives the REAL exported decision functions (`applyWebhook`,
// `roomForgetForFollower`, `dueReminders`, `recordAndSend`,
// `cancelThroughSeam`) with their own statements INTERLEAVED by a small
// cooperative scheduler over a shared in-memory `db`, enumerating every
// distinguishable order of a bounded schedule rather than picking one and
// hoping — `evals/room-doors/run.mjs`'s own header names the same discipline
// ("through the REAL decision modules... never a re-implemented check") and
// this file holds to it: only the DATA STORE is faked, every decision is the
// real one this repo ships.
//
// ── WHY THIS FILE, NOT `evals/room-doors/fixtures.mjs`'s SHARED WORLD ──────
//
// `doorsDb`/`freshDoorsState` (fixtures.mjs) do not model two things this
// suite needs: (1) the referral-reward CTE (`with this_follower_first as`,
// only ever fixture-modelled in `evals/payments/run.mjs`, a single-file
// suite with no exports to reuse) and (2) the real FK cascade a follower's
// own `roomForget` triggers through `vy_room_subscription` ->
// `vy_payment_event` -> `vy_receipt` (the base Room fixture only ever
// simulated the ONE cascade `roomForget` needed before this workstream —
// `vy_room_follower_channel`, per that file's own comment). Extending the
// shared fixture to carry both, correctly, under concurrent access from a
// scheduler neither fixture was built to expect, was a larger and riskier
// change than a small, self-contained world built for exactly the five
// statements this suite drives. `evals/room-doors/fixtures.mjs` stays
// untouched by this file; `run.mjs` imports this module's own battery
// runner (see the bottom of this file) so the door battery's ONE printed
// total still covers it.
//
// Offline, deterministic, $0, no DB, no network, no GPU, no model call.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const API = join(ROOT, "api");

const { applyWebhook, NO_REGRESSION_MARKER } = await import(pathToFileURL(join(API, "_payments.js")).href);
const { roomForgetForFollower } = await import(pathToFileURL(join(API, "_room-surface.js")).href);
const { dueReminders, recordAndSend, cancelThroughSeam, REMINDER_ELIGIBILITY_MARKER } =
  await import(pathToFileURL(join(API, "_renewals.js")).href);
const { isQuietHoursOk } = await import(pathToFileURL(join(API, "_quiet-hours.js")).href);
const FAKE_PROVIDER = await import(pathToFileURL(join(API, "_payments/providers/fake.js")).href);

let pass = 0;
let fail = 0;
let ordersEnumerated = 0;
const lines = [];
function log(line) {
  lines.push(line);
}
function ok(name, cond, extra = "") {
  if (cond) pass++;
  else fail++;
  log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
}

// ═════════════════════════════════════════════════════════════════════════
// THE WORLD — one small in-memory store, five real functions' worth of SQL
// ═════════════════════════════════════════════════════════════════════════

const PROVIDER = "fake";
const WH_SECRET = "order-battery-secret";
const PAY_ENV = { PAYMENTS_PROVIDER: PROVIDER, PAYMENTS_FAKE_WEBHOOK_SECRET: WH_SECRET };
const NO_TABLES = async () => false;

function freshWorld() {
  return {
    rooms: [],
    prices: [],
    followers: [],
    threads: [],
    subscriptions: [],
    events: [],
    receipts: [],
    receiptCounters: [],
    referralCredits: [],
    referralRewards: [],
    renewalReminders: [],
    checkins: [],
    forgetReceipts: [],
    consents: 0,
  };
}

const STATE_RANK = { created: 0, authenticated: 1, active: 2, paused: 2, cancelled: 3, expired: 3 };
function stateRank(s) {
  return Object.prototype.hasOwnProperty.call(STATE_RANK, s) ? STATE_RANK[s] : -1;
}

function quietHoursBlocks(state, followerId, nowMs) {
  return state.checkins.some(
    (c) => c.follower_id === followerId && c.state === "active" &&
      !isQuietHoursOk(nowMs, c.timezone, c.quiet_from, c.quiet_to),
  );
}

/** ONE db function for the whole battery. Most-specific pattern first
 *  throughout — `context/rejected.md`'s own warning about a shared fake `db`
 *  keyed by `sql.includes(...)` being an ORDERED list, restated here as the
 *  rule this file's own matcher order follows. */
function makeOrderDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push(sql);
    const has = (s) => sql.includes(s);

    // ── dueReminders: the follower due-select (WS-R129's quiet-hours
    //    fragment evaluated for REAL via the exported `isQuietHoursOk`,
    //    never re-guessed). ──────────────────────────────────────────────
    if (has("join vy_room_follower f") && has("from vy_room_subscription s")) {
      const [nowIso, windowEndIso] = params;
      const nowMs = Date.parse(nowIso);
      return state.subscriptions
        .filter((s) =>
          s.state === "active" &&
          ["none", "active"].includes(s.mandate_state) &&
          s.cancel_at_period_end === false &&
          s.current_period_end &&
          s.current_period_end >= nowIso &&
          s.current_period_end < windowEndIso &&
          !state.renewalReminders.some(
            (r) => r.subject_kind === "follower" && r.subject_id === s.follower_id && r.period_end === s.current_period_end,
          ) &&
          !quietHoursBlocks(state, s.follower_id, nowMs),
        )
        .sort((a, b) => a.current_period_end.localeCompare(b.current_period_end))
        .map((s) => {
          const room = state.rooms.find((r) => r.room_id === s.room_id);
          const follower = state.followers.find((f) => f.follower_id === s.follower_id);
          return {
            subject_id: s.follower_id, room_id: s.room_id, person_id: s.person_id,
            period_end: s.current_period_end, slug: room?.slug ?? null, display_name: room?.display_name ?? null,
            locale: follower?.locale ?? "en", amount_inr: null, currency: "INR",
          };
        });
    }
    // ── recordAndSend: the guarded INSERT (THE FIX), and its two UPDATEs.
    //    Checked BEFORE the two broad dueReminders creator/org markers just
    //    below — THE FIX's own eligibility re-check embeds `exists (select
    //    1 from vy_creator_subscription s ...)` and `... from
    //    vy_org_subscription s ...` INSIDE this very INSERT statement, so a
    //    matcher ordered the other way round would catch this statement on
    //    those two broad substrings first and silently short-circuit to
    //    `return []` before ever reaching the real handler — exactly the
    //    "a shared fake db keyed by sql.includes(...) is an ORDERED list"
    //    trap `context/rejected.md` already warns this repo's own fixtures
    //    about, found here by this suite's own §2 sanity check going FAIL
    //    with every schedule inserting nothing at all
    //    (`context/rejected.md#ws-r140-broad-creator-org-marker-shadowed-
    //    the-fixed-inserts-own-embedded-exists-subqueries`). ─────────────
    if (has("insert into vy_renewal_reminder")) {
      const [subjectKind, subjectId, roomId, personId, followerId, ownerUserId, replicaId, orgId, periodEndIso, channel] = params;
      // GENUINELY DIFFERENTIAL: only re-check eligibility when THIS text
      // actually carries THE FIX's own marker — a fake db that always
      // re-derived the guard itself, whatever the real SQL said, would
      // test its own copy of the rule rather than `recordAndSend`'s real
      // one (`context/rejected.md#ws-r140-fake-db-reimplemented-the-fix-
      // instead-of-detecting-it`, this suite's own found-and-fixed defect).
      // Pre-fix text has no marker at all and behaves exactly as the old
      // unconditional INSERT did: always eligible.
      const guarded = has(REMINDER_ELIGIBILITY_MARKER);
      let eligible = true;
      if (guarded) {
        eligible = subjectKind === "follower" && state.subscriptions.some(
          (s) => s.follower_id === String(subjectId) && s.state === "active" &&
            s.cancel_at_period_end === false && ["none", "active"].includes(s.mandate_state) &&
            s.current_period_end === periodEndIso,
        );
        // creator/org: never eligible in this world (no fixtures for either lane).
      }
      if (!eligible) return [];
      const dup = state.renewalReminders.some(
        (r) => r.subject_kind === subjectKind && r.subject_id === String(subjectId) &&
          r.period_end === periodEndIso && r.channel === channel,
      );
      if (dup) return [];
      const row = {
        reminder_id: `rr-${state.renewalReminders.length + 1}`, subject_kind: subjectKind, subject_id: String(subjectId),
        room_id: roomId, person_id: personId, follower_id: followerId, owner_user_id: ownerUserId, replica_id: replicaId,
        org_id: orgId, period_end: periodEndIso, channel, sent_at: null, reason: null,
      };
      state.renewalReminders.push(row);
      return [{ reminder_id: row.reminder_id }];
    }
    if (has("update vy_renewal_reminder set sent_at")) {
      const row = state.renewalReminders.find((r) => r.reminder_id === String(params[0]));
      if (row) row.sent_at = new Date().toISOString();
      return [];
    }
    if (has("update vy_renewal_reminder set reason")) {
      const row = state.renewalReminders.find((r) => r.reminder_id === String(params[0]));
      if (row) row.reason = params[1];
      return [];
    }
    // dueReminders' creator/org selects — never modelled in this world (no
    // creator-tier or Suite fixtures here), always empty, exactly what
    // proves this suite drives the follower lane alone. Checked AFTER the
    // INSERT/UPDATE block immediately above — see that block's own header.
    if (has("from vy_creator_subscription s")) return [];
    if (has("from vy_org_subscription s")) return [];

    // ── cancelThroughSeam: the follower's own cancel. ─────────────────────
    if (has("set cancel_at_period_end = true")) {
      const row = state.subscriptions.find((s) => s.subscription_id === String(params[0]));
      if (!row) return [];
      row.cancel_at_period_end = true;
      return [{
        subscription_id: row.subscription_id, state: row.state,
        current_period_end: row.current_period_end, cancel_at_period_end: true,
      }];
    }

    // ── applyWebhook: the follower-lane context read. ─────────────────────
    if (has("coalesce(p.platform_take_bp")) {
      const [providerName, ref, defaultBp] = params;
      const sub = state.subscriptions.find((s) => s.provider === providerName && s.provider_subscription_ref === ref);
      if (!sub) return [];
      const price = state.prices.find((p) => p.room_id === sub.room_id);
      return [{ subscription_id: sub.subscription_id, room_id: sub.room_id, platform_take_bp: price ? price.platform_take_bp : defaultBp }];
    }
    if (has("from vy_org_subscription where provider")) return [];
    if (has("from vy_creator_subscription where provider")) return [];

    // ── applyWebhook: THE BIG WRITE, follower lane — THE FIX (state/period
    //    leaving-guard) mirrored exactly, using the SAME rank table the real
    //    SQL's `stateRankCaseSql`/`periodNoRegressionCaseSql` build. ───────
    if (has("with candidate as") && has("update vy_room_subscription s")) {
      const [providerName, ref, roomId, subId, kind, amountInr, takeInr, shareInr, payloadHash,
        nextState, periodStart, periodEnd, nextMandateState] = params;
      const dup = state.events.find((e) => e.provider === providerName && e.provider_event_ref === ref);
      if (dup) return []; // on conflict do nothing
      const sub = state.subscriptions.find((s) => s.subscription_id === String(subId));
      if (!sub) {
        // THE FK THE REAL SCHEMA ENFORCES: `vy_payment_event.subscription_id
        // references vy_room_subscription(subscription_id) on delete
        // cascade` — a webhook whose subscription row a forget already
        // cascaded away cannot land a new ledger row for it at all. A safe
        // refusal (this INSERT never happens, no row is ever created), not
        // a silent no-op — exactly what "no row for a forgotten follower"
        // requires when this write loses the race.
        const err = new Error("fk_violation: vy_payment_event.subscription_id -> vy_room_subscription (row already deleted)");
        err.code = "23503";
        throw err;
      }
      const event = {
        event_id: `evt-${state.events.length + 1}`, provider: providerName, provider_event_ref: ref,
        room_id: String(roomId), subscription_id: String(subId), kind, amount_inr: amountInr,
        platform_take_inr: takeInr, creator_share_inr: shareInr, signature_verified: true,
        payload_hash: payloadHash, received_at: new Date().toISOString(),
      };
      state.events.push(event);
      // GENUINELY DIFFERENTIAL, on the SAME reasoning as the reminder
      // INSERT's own marker check above: only enforce the no-regression
      // guard when THIS statement's own text actually carries
      // `NO_REGRESSION_MARKER`. Unguarded (pre-fix) text behaves exactly as
      // the old `case when $x='' then s.state else $x end` /
      // `coalesce($x, s.current_period_*)` shapes did — always overwrite
      // once a value is present, no rank or timestamp comparison at all.
      const guarded = has(NO_REGRESSION_MARKER);
      if (nextState !== "" && (!guarded || stateRank(nextState) >= stateRank(sub.state))) sub.state = nextState;
      if (periodStart && (!guarded || !sub.current_period_start || periodStart >= sub.current_period_start)) {
        sub.current_period_start = periodStart;
      }
      if (periodEnd && (!guarded || !sub.current_period_end || periodEnd >= sub.current_period_end)) {
        sub.current_period_end = periodEnd;
      }
      if (nextMandateState && sub.mandate_state !== nextMandateState) {
        sub.mandate_state = nextMandateState;
        sub.mandate_state_at = new Date().toISOString();
      }
      let tier = null;
      const follower = state.followers.find((f) => f.follower_id === sub.follower_id);
      if (follower && ["active", "cancelled", "expired"].includes(sub.state)) {
        follower.tier = sub.state === "active" ? "paid" : "free";
        tier = follower.tier;
      }
      return [{
        event_id: event.event_id, subscription_id: sub.subscription_id, state: sub.state,
        mandate_state: sub.mandate_state, person_id: sub.person_id, follower_id: sub.follower_id, tier,
      }];
    }

    // ── issueFollowerReceipt (WS-R100). Ported verbatim from
    //    evals/payments/run.mjs's own fixture — one shared statement, one
    //    honest reimplementation, never two that could drift. ─────────────
    if (has("insert into vy_receipt_counter")) {
      const [fy, eventId, roomId, personId, issuedAt] = params;
      let counter = state.receiptCounters.find((c) => c.fy === fy);
      if (!counter) { counter = { fy, next: 1 }; state.receiptCounters.push(counter); }
      if (state.receipts.some((r) => r.payment_event_id === String(eventId))) return [];
      const claimed = counter.next;
      counter.next += 1;
      const row = {
        receipt_id: `r-${state.receipts.length + 1}`, receipt_no: claimed,
        payment_event_id: String(eventId), room_id: String(roomId),
        person_id: personId ? String(personId) : null, issued_at: issuedAt || new Date().toISOString(),
      };
      state.receipts.push(row);
      return [{ receipt_id: row.receipt_id, receipt_no: row.receipt_no, issued_at: row.issued_at }];
    }

    // ── maybeGrantReferralReward (WS-R130). Ported from evals/payments/
    //    run.mjs's own fixture, unchanged logic — this is the ATOMICITY
    //    this suite's §3 exists to prove holds under concurrency, not a
    //    place this workstream found anything to fix. ─────────────────────
    if (has("with this_follower_first as")) {
      const [followerId, eventId, roomId, threshold, yearKey, chargeKinds, rewardId, reason] = params;
      const fid = String(followerId);
      const landedKinds = new Set(chargeKinds);
      const landed = (fId, excludeEventId) => state.events.some((e) => {
        if (excludeEventId != null && e.event_id === excludeEventId) return false;
        const sub = state.subscriptions.find((s) => s.subscription_id === e.subscription_id);
        return sub && sub.follower_id === fId && landedKinds.has(e.kind) && e.amount_inr > 0;
      });
      const isFirst = !landed(fid, String(eventId));
      if (!isFirst) return [];
      const credit = state.referralCredits.find((c) => c.referred_follower_id === fid && c.room_id === String(roomId));
      if (!credit) return [];
      const siblings = state.referralCredits.filter((c) => c.referrer_follower_id === credit.referrer_follower_id);
      const n = siblings.filter((c) => landed(c.referred_follower_id, null)).length;
      if (n < Number(threshold)) return [];
      const already = state.referralRewards.find(
        (r) => r.referrer_follower_id === credit.referrer_follower_id &&
          r.room_id === String(roomId) && r.year_key === String(yearKey),
      );
      if (already) return [];
      const referrerSub = state.subscriptions.find((s) => s.follower_id === credit.referrer_follower_id && s.state === "active");
      const base = referrerSub ? new Date(referrerSub.current_period_end) : new Date();
      const extended = new Date(base.getTime());
      extended.setUTCMonth(extended.getUTCMonth() + 1);
      const reward = {
        reward_id: String(rewardId), room_id: String(roomId), referrer_follower_id: credit.referrer_follower_id,
        referrer_person_id: credit.referrer_person_id, granted_at: new Date().toISOString(),
        period_extended_to: extended.toISOString(), year_key: String(yearKey), reason: String(reason),
      };
      state.referralRewards.push(reward);
      if (referrerSub) referrerSub.current_period_end = reward.period_extended_to;
      return [{ ...reward }];
    }
    if (has("insert into vy_payment_event") && has("'referral_reward'")) {
      // The reward's own synthetic ledger row — best-effort in the real code
      // (`.catch(() => null)` wraps the WHOLE caller), and unneeded for this
      // suite's own "exactly one reward" invariant, which is decided
      // entirely by the CTE above. Honest empty, evals/payments/run.mjs's
      // own precedent restated.
      return [];
    }

    // ── roomForgetForFollower / roomForgetCore. ───────────────────────────
    if (has("select t.thread_id from vy_room_thread")) {
      const [roomId, personId, agentId] = params.map(String);
      return state.threads
        .filter((t) => t.room_id === roomId && t.person_id === personId && t.agent_id === agentId)
        .map((t) => ({ thread_id: t.thread_id }));
    }
    if (has("delete from vy_room_subscription") && has("state in ('cancelled','expired')")) {
      const [roomId, personId] = params.map(String);
      const gone = state.subscriptions.filter(
        (s) => s.room_id === roomId && s.person_id === personId && ["cancelled", "expired"].includes(s.state),
      );
      const goneIds = new Set(gone.map((s) => s.subscription_id));
      state.subscriptions = state.subscriptions.filter((s) => !goneIds.has(s.subscription_id));
      return gone.map(() => ({ gone: 1 }));
    }
    if (has("delete from vy_room_thread")) {
      const [roomId, personId, agentId] = params.map(String);
      const gone = state.threads.filter((t) => t.room_id === roomId && t.person_id === personId && t.agent_id === agentId);
      state.threads = state.threads.filter((t) => !gone.includes(t));
      return gone.map(() => ({ gone: 1 }));
    }
    if (has("delete from vy_room_follower")) {
      const [roomId, personId, agentId] = params.map(String);
      const gone = state.followers.filter((f) => f.room_id === roomId && f.person_id === personId && f.agent_id === agentId);
      state.followers = state.followers.filter((f) => !gone.includes(f));
      // WS-R140: the real schema's own cascade chain, simulated —
      // `vy_room_subscription.follower_id ... on delete cascade`,
      // `vy_payment_event.subscription_id ... on delete cascade`,
      // `vy_receipt.payment_event_id ... on delete cascade`
      // (db/schema.sql) — `evals/room/fixtures.mjs`'s own precedent for
      // `vy_room_follower_channel` restated for the money tables the base
      // fixture never had to know about.
      const goneFollowerIds = new Set(gone.map((f) => f.follower_id));
      const goneSubs = state.subscriptions.filter((s) => goneFollowerIds.has(s.follower_id));
      const goneSubIds = new Set(goneSubs.map((s) => s.subscription_id));
      state.subscriptions = state.subscriptions.filter((s) => !goneSubIds.has(s.subscription_id));
      const goneEvents = state.events.filter((e) => goneSubIds.has(e.subscription_id));
      const goneEventIds = new Set(goneEvents.map((e) => e.event_id));
      state.events = state.events.filter((e) => !goneEventIds.has(e.event_id));
      state.receipts = state.receipts.filter((r) => !goneEventIds.has(r.payment_event_id));
      return gone.map(() => ({ gone: 1 }));
    }
    if (has("insert into meera_consent")) {
      state.consents++;
      return [];
    }
    if (has("insert into vy_room_forget_receipt")) {
      state.forgetReceipts.push({ receipt_id: String(params[0]) });
      return [];
    }

    throw new Error(`[order.mjs] unmodelled statement: ${sql.slice(0, 120)}`);
  };
  db.calls = calls;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// THE SCHEDULER — merge two (or three) actors' own call sequences into
// every distinguishable interleaving, run each real function pair against a
// FRESH world copy per schedule, cooperative "skip if this actor is already
// done" turn-taking so a data-dependent call count (an actor that branches
// into fewer db calls on one outcome than another) never hangs the run.
// ═════════════════════════════════════════════════════════════════════════

function enumerateMerges(counts) {
  const labels = Object.keys(counts);
  const results = [];
  const remaining = { ...counts };
  const seq = [];
  (function rec() {
    if (labels.every((l) => remaining[l] === 0)) {
      results.push(seq.slice());
      return;
    }
    for (const l of labels) {
      if (remaining[l] > 0) {
        remaining[l]--;
        seq.push(l);
        rec();
        seq.pop();
        remaining[l]++;
      }
    }
  })();
  return results;
}

function makeConductor(order) {
  let pos = 0;
  const done = new Set();
  const waiting = new Map();
  function pump() {
    while (pos < order.length) {
      const label = order[pos];
      if (done.has(label)) { pos++; continue; }
      const resolve = waiting.get(label);
      if (!resolve) return;
      waiting.delete(label);
      pos++;
      resolve();
      return;
    }
  }
  return {
    turn(label) {
      return new Promise((resolve) => {
        waiting.set(label, resolve);
        pump();
      });
    },
    finish(label) {
      done.add(label);
      pump();
    },
  };
}

function actorDb(conductor, label, rawDb) {
  return async (sql, params) => {
    await conductor.turn(label);
    return rawDb(sql, params);
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[order.mjs] schedule hung: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs ONE schedule: `actors` is `{label: (db) => Promise<result>}`; each
 *  actor's promise settling (resolve OR reject) marks it `finish()`d so the
 *  conductor can skip its remaining padded slots and let a sibling actor
 *  with more real calls left keep going. Returns `{results: {label:
 *  {ok, value, error}}, calls}` — the caller decides what a rejection means
 *  for its own invariant (a thrown FK violation is an EXPECTED outcome in
 *  §4, never a schedule failure by itself). */
async function runSchedule(rawDb, actors, order) {
  const conductor = makeConductor(order);
  const results = {};
  await withTimeout(
    Promise.all(
      Object.entries(actors).map(async ([label, fn]) => {
        const db = actorDb(conductor, label, rawDb);
        try {
          const value = await fn(db);
          results[label] = { ok: true, value };
        } catch (error) {
          results[label] = { ok: false, error };
        } finally {
          conductor.finish(label);
        }
      }),
    ),
    5000,
    order.join(","),
  );
  return results;
}

// ═════════════════════════════════════════════════════════════════════════
// FIXTURE IDENTITY
// ═════════════════════════════════════════════════════════════════════════

const ROOM_ID = "d0000000-0000-4000-8000-0000000000f1";
const AGENT_ID = "a0000000-0000-4000-8000-0000000000f1";

function seedRoom(state) {
  state.rooms.push({ room_id: ROOM_ID, slug: "order-battery-room", display_name: "Anjali" });
  state.prices.push({ room_id: ROOM_ID, follower_price_inr: 299, currency: "INR", platform_take_bp: 2500 });
}

function seedFollower(state, { followerId, personId, tier = "free", locale = "en" }) {
  state.followers.push({ follower_id: followerId, room_id: ROOM_ID, person_id: personId, agent_id: AGENT_ID, tier, locale });
}

function seedSubscription(state, {
  subscriptionId, followerId, personId, ref, state: subState = "created",
  periodStart = null, periodEnd = null, mandateState = "none", cancelAtPeriodEnd = false,
}) {
  state.subscriptions.push({
    subscription_id: subscriptionId, room_id: ROOM_ID, person_id: personId, follower_id: followerId,
    provider: PROVIDER, provider_subscription_ref: ref, state: subState,
    current_period_start: periodStart, current_period_end: periodEnd,
    mandate_state: mandateState, mandate_state_at: null, cancel_at_period_end: cancelAtPeriodEnd,
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
  });
}

function webhookBody(event, { ref, currentStartSec, currentEndSec, amountPaise }) {
  const entity = { id: ref };
  if (currentStartSec != null) entity.current_start = currentStartSec;
  if (currentEndSec != null) entity.current_end = currentEndSec;
  const payload = { subscription: { entity } };
  if (amountPaise != null) payload.payment = { entity: { id: `pay_${ref}`, amount: amountPaise, currency: "INR", status: "captured" } };
  return Buffer.from(JSON.stringify({ event, payload }));
}

function sign(body) {
  return FAKE_PROVIDER.signWebhookForTest(body, WH_SECRET);
}

async function callWebhook(db, { event, ref, eventRef, currentStartSec, currentEndSec, amountPaise, tableApplied }) {
  const body = webhookBody(event, { ref, currentStartSec, currentEndSec, amountPaise });
  return applyWebhook(
    db,
    { rawBody: body, signatureHeader: sign(body), eventRef },
    { env: PAY_ENV, tableApplied: tableApplied ?? NO_TABLES },
  );
}

// ═════════════════════════════════════════════════════════════════════════
// §1. A WEBHOOK FROM YESTERDAY, APPLIED AFTER TODAY, NEVER MOVES STATE OR
//     THE BILLING PERIOD BACKWARDS
// ═════════════════════════════════════════════════════════════════════════

async function scenarioWebhookOrder() {
  log("\n── §1: a webhook from yesterday, applied after today, never moves state or period backwards ──");

  // §1a — STATE: `subscription.authenticated` (rank 1, a genuinely EARLIER
  // mandate-lifecycle step) delivered late, racing `subscription.activated`
  // (rank 2). Whichever of the two actors' own write lands LAST must never
  // leave the row at a LOWER rank than the other already set it to.
  {
    const SUB = "51000000-0000-4000-8000-000000000001";
    const FOLLOWER = "f1000000-0000-4000-8000-000000000001";
    const PERSON = "b1000000-0000-4000-8000-000000000001";
    const REF = "ref-order-1a";
    const orders = enumerateMerges({ TODAY: 2, YESTERDAY: 2 });
    ordersEnumerated += orders.length;
    let allHeld = true;
    let sample = null;
    for (const order of orders) {
      const state = freshWorld();
      seedRoom(state);
      seedFollower(state, { followerId: FOLLOWER, personId: PERSON });
      seedSubscription(state, { subscriptionId: SUB, followerId: FOLLOWER, personId: PERSON, ref: REF, state: "created" });
      const db = makeOrderDb(state);
      await runSchedule(db, {
        TODAY: (adb) => callWebhook(adb, {
          event: "subscription.activated", ref: REF, eventRef: "evt-1a-today",
          currentStartSec: 1_757_000_000, currentEndSec: 1_759_600_000,
        }),
        YESTERDAY: (adb) => callWebhook(adb, {
          event: "subscription.authenticated", ref: REF, eventRef: "evt-1a-yesterday",
        }),
      }, order);
      const finalSub = state.subscriptions.find((s) => s.subscription_id === SUB);
      const held = finalSub?.state === "active";
      if (!held) { allHeld = false; sample = order; }
    }
    ok(
      "[order/webhook] §1a state: authenticated (rank 1) delivered after activated (rank 2), in every one of the enumerated orders, never reverts state below rank 2",
      allHeld,
      sample ? `first failing order: ${sample.join(",")}` : `${orders.length} orders held`,
    );
  }

  // §1b — PERIOD: a delayed retry of an EARLIER billing cycle's own
  // `subscription.charged` must never overwrite a LATER cycle's own period
  // bounds, whichever order the two deliveries land in.
  {
    const SUB = "51000000-0000-4000-8000-000000000002";
    const FOLLOWER = "f1000000-0000-4000-8000-000000000002";
    const PERSON = "b1000000-0000-4000-8000-000000000002";
    const REF = "ref-order-1b";
    const NEW_START = 1_759_305_600; // 2025-10-01T00:00:00Z-ish, the LATER cycle
    const NEW_END = 1_761_984_000;
    const OLD_START = 1_756_713_600; // an EARLIER cycle, delivered late
    const OLD_END = 1_759_305_600;
    const orders = enumerateMerges({ NEW: 2, OLD: 2 });
    ordersEnumerated += orders.length;
    let allHeld = true;
    let sample = null;
    for (const order of orders) {
      const state = freshWorld();
      seedRoom(state);
      seedFollower(state, { followerId: FOLLOWER, personId: PERSON });
      seedSubscription(state, { subscriptionId: SUB, followerId: FOLLOWER, personId: PERSON, ref: REF, state: "created" });
      const db = makeOrderDb(state);
      await runSchedule(db, {
        NEW: (adb) => callWebhook(adb, {
          event: "subscription.activated", ref: REF, eventRef: "evt-1b-new",
          currentStartSec: NEW_START, currentEndSec: NEW_END,
        }),
        OLD: (adb) => callWebhook(adb, {
          event: "subscription.activated", ref: REF, eventRef: "evt-1b-old",
          currentStartSec: OLD_START, currentEndSec: OLD_END,
        }),
      }, order);
      const finalSub = state.subscriptions.find((s) => s.subscription_id === SUB);
      const held = finalSub?.current_period_end === new Date(NEW_END * 1000).toISOString();
      if (!held) { allHeld = false; sample = order; }
    }
    ok(
      "[order/webhook] §1b period: an earlier cycle's own charge, delivered after a later one, never regresses current_period_end",
      allHeld,
      sample ? `first failing order: ${sample.join(",")}` : `${orders.length} orders held`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// §2. NO RENEWAL REMINDER ROW ONCE A CANCEL HAS LANDED; A QUIET-HOURS
//     WINDOW THAT CROSSES A DAY BOUNDARY IN THE FOLLOWER'S OWN ZONE HOLDS
// ═════════════════════════════════════════════════════════════════════════

async function scenarioReminderVsCancel() {
  log("\n── §2: no reminder row once a cancel has landed; quiet hours across a real day boundary ──");

  const NOW = Date.parse("2026-09-05T19:00:00.000Z"); // 2026-09-06T00:30 IST — one day LATER, local
  const NOW_ISO = new Date(NOW).toISOString();
  const PERIOD_END = new Date(NOW + 3 * 86_400_000).toISOString();

  const FOLLOWER = "f2000000-0000-4000-8000-000000000001";
  const PERSON = "b2000000-0000-4000-8000-000000000001";
  const SUB = "52000000-0000-4000-8000-000000000001";

  // The quiet-hours-blocked follower, present in the SAME world on every
  // schedule: Asia/Kolkata, 22:00-07:00 (wraps midnight), and `NOW` above is
  // 00:30 IST — squarely inside the window, on a UTC calendar date that is
  // still the day BEFORE. A predicate that read UTC's own clock or UTC's
  // own calendar date would get this follower wrong in either direction.
  const FOLLOWER_TZ = "f2000000-0000-4000-8000-0000000000b2";
  const PERSON_TZ = "b2000000-0000-4000-8000-0000000000b2";
  const SUB_TZ = "52000000-0000-4000-8000-0000000000b2";

  const orders = enumerateMerges({ SWEEP: 5, CANCEL: 1 });
  ordersEnumerated += orders.length;
  let allHeld = true;
  let sampleFail = null;
  let neverBlockedByQuietHours = true;
  let sweepEverInserted = false;
  let cancelBeforeInsertNeverLeavesRow = true;

  for (const order of orders) {
    const state = freshWorld();
    seedRoom(state);
    seedFollower(state, { followerId: FOLLOWER, personId: PERSON });
    seedSubscription(state, {
      subscriptionId: SUB, followerId: FOLLOWER, personId: PERSON, ref: null,
      state: "active", periodEnd: PERIOD_END, mandateState: "active",
    });
    seedFollower(state, { followerId: FOLLOWER_TZ, personId: PERSON_TZ, locale: "en" });
    seedSubscription(state, {
      subscriptionId: SUB_TZ, followerId: FOLLOWER_TZ, personId: PERSON_TZ, ref: null,
      state: "active", periodEnd: PERIOD_END, mandateState: "active",
    });
    state.checkins.push({
      follower_id: FOLLOWER_TZ, state: "active", timezone: "Asia/Kolkata", quiet_from: "22:00", quiet_to: "07:00",
    });
    const db = makeOrderDb(state);

    // The cancel index within the schedule (how many SWEEP turns precede
    // it) tells us, per schedule, whether the cancel landed BEFORE
    // recordAndSend's own INSERT (position <= 3, i.e. before or at the
    // point dueReminders' three selects finish) — the exact race window
    // the fix closes.
    const cancelIndex = order.indexOf("CANCEL");
    const sweepTurnsBeforeCancel = order.slice(0, cancelIndex).filter((l) => l === "SWEEP").length;
    const cancelBeforeInsert = sweepTurnsBeforeCancel <= 3; // 3 = dueReminders' three selects

    await runSchedule(db, {
      SWEEP: async (adb) => {
        const due = await dueReminders(adb, NOW);
        const out = [];
        for (const row of due.follower) {
          out.push(await recordAndSend(
            adb,
            { subjectKind: "follower", subjectId: row.subject_id, periodEnd: row.period_end, channel: "in_app", roomId: row.room_id, personId: row.person_id, followerId: row.subject_id },
            async () => ({ ok: true }),
          ));
        }
        return out;
      },
      CANCEL: (adb) => cancelThroughSeam(adb, { table: "vy_room_subscription", key: "subscription_id", subscriptionId: SUB, provider: null, providerRef: null }, {}),
    }, order);

    const reminderRow = state.renewalReminders.find((r) => r.subject_id === FOLLOWER);
    if (reminderRow) sweepEverInserted = true;
    if (cancelBeforeInsert && reminderRow) {
      cancelBeforeInsertNeverLeavesRow = false;
      allHeld = false;
      sampleFail = order;
    }
    if (state.renewalReminders.some((r) => r.subject_id === FOLLOWER_TZ)) {
      neverBlockedByQuietHours = false;
    }
  }

  ok(
    "[order/reminder] §2a a cancel that lands before recordAndSend's own INSERT leaves no reminder row, in every enumerated schedule",
    cancelBeforeInsertNeverLeavesRow,
    sampleFail ? `first failing order: ${sampleFail.join(",")}` : `${orders.length} orders held`,
  );
  ok(
    "[order/reminder] §2a sanity: the SAME follower DOES get a reminder in at least one schedule (the fix refuses on a real race, not unconditionally)",
    sweepEverInserted,
  );
  ok(
    "[order/reminder] §2b quiet hours, evaluated at a real day boundary (00:30 IST, still the day before in UTC): the follower is never sent a reminder, across every schedule",
    neverBlockedByQuietHours,
  );
  ok("[order/reminder] §2 invariant held across every schedule", allHeld);
}

// ═════════════════════════════════════════════════════════════════════════
// §3. EXACTLY ONE REFERRAL REWARD PER (REFERRER, ROOM, YEAR), WHICHEVER
//     ORDER TWO FRIENDS' OWN THRESHOLD-CROSSING CHARGES LAND IN
// ═════════════════════════════════════════════════════════════════════════

async function scenarioReferralReward() {
  log("\n── §3: exactly one referral reward per year, under every interleaving of two racing charges ──");

  const REFERRAL_REWARD_CHARGE_KINDS = ["subscription.charged", "subscription.activated"];
  const THRESHOLD = 3;
  const YEAR_KEY = "2026-27";

  const REFERRER = "f3000000-0000-4000-8000-00000000000f";
  const REFERRER_PERSON = "b3000000-0000-4000-8000-00000000000f";
  const REFERRER_SUB = "53000000-0000-4000-8000-00000000000f";
  const F = (n) => `f3000000-0000-4000-8000-0000000000${n}0`;
  const P = (n) => `b3000000-0000-4000-8000-0000000000${n}0`;
  const S = (n) => `53000000-0000-4000-8000-0000000000${n}0`;

  const orders = enumerateMerges({ F3: 5, F4: 5 });
  ordersEnumerated += orders.length;
  let exactlyOneEveryTime = true;
  let sampleFail = null;
  let rewardCounts = new Set();

  for (const order of orders) {
    const state = freshWorld();
    seedRoom(state);
    // The referrer, with their own active subscription (the reward extends it).
    seedFollower(state, { followerId: REFERRER, personId: REFERRER_PERSON });
    seedSubscription(state, {
      subscriptionId: REFERRER_SUB, followerId: REFERRER, personId: REFERRER_PERSON, ref: "ref-referrer",
      state: "active", periodEnd: "2026-10-01T00:00:00.000Z", mandateState: "active",
    });
    // Two friends who ALREADY landed a charge (seeded directly, WS-R100's
    // own fixture precedent — never through the webhook, since this suite's
    // job is the RACE, not the write path evals/payments already proves).
    for (const n of [1, 2]) {
      seedFollower(state, { followerId: F(n), personId: P(n) });
      seedSubscription(state, { subscriptionId: S(n), followerId: F(n), personId: P(n), ref: `ref-f${n}`, state: "active" });
      state.events.push({
        event_id: `evt-seed-${n}`, provider: PROVIDER, provider_event_ref: `evt-seed-${n}`,
        room_id: ROOM_ID, subscription_id: S(n), kind: "subscription.charged", amount_inr: 299,
        signature_verified: true, payload_hash: "0".repeat(64), received_at: "2026-08-15T00:00:00.000Z",
      });
      state.referralCredits.push({
        referred_follower_id: F(n), referrer_follower_id: REFERRER, referrer_person_id: REFERRER_PERSON, room_id: ROOM_ID,
      });
    }
    // Friends 3 and 4 — both about to land their OWN first charge at once,
    // BOTH would independently see the referrer's count reach the
    // threshold (2 already landed + themselves = 3).
    for (const n of [3, 4]) {
      seedFollower(state, { followerId: F(n), personId: P(n) });
      seedSubscription(state, { subscriptionId: S(n), followerId: F(n), personId: P(n), ref: `ref-f${n}`, state: "created" });
      state.referralCredits.push({
        referred_follower_id: F(n), referrer_follower_id: REFERRER, referrer_person_id: REFERRER_PERSON, room_id: ROOM_ID,
      });
    }

    const db = makeOrderDb(state);
    const tableApplied = async (name) => name === "vy_room_referral_credit" || name === "vy_room_referral_reward";
    await runSchedule(db, {
      F3: (adb) => callWebhook(adb, {
        event: "subscription.charged", ref: "ref-f3", eventRef: "evt-f3-charge",
        currentStartSec: 1_757_000_000, currentEndSec: 1_759_600_000, amountPaise: 29_900, tableApplied,
      }),
      F4: (adb) => callWebhook(adb, {
        event: "subscription.charged", ref: "ref-f4", eventRef: "evt-f4-charge",
        currentStartSec: 1_757_000_000, currentEndSec: 1_759_600_000, amountPaise: 29_900, tableApplied,
      }),
    }, order);

    const rewards = state.referralRewards.filter((r) => r.referrer_follower_id === REFERRER && r.year_key === YEAR_KEY);
    rewardCounts.add(rewards.length);
    if (rewards.length !== 1) {
      exactlyOneEveryTime = false;
      sampleFail = order;
    }
  }

  ok(
    "[order/referral] §3 exactly one reward per (referrer, room, year), whichever order F3's and F4's own threshold-crossing charges land in",
    exactlyOneEveryTime,
    sampleFail ? `first failing order: ${sampleFail.join(",")}   reward counts seen: ${[...rewardCounts].join(",")}` : `${orders.length} orders held`,
  );
}

// ═════════════════════════════════════════════════════════════════════════
// §4. NO ROW FOR A FORGOTTEN FOLLOWER SURVIVES A LANDING CHARGE, WHICHEVER
//     ORDER THE FORGET AND THE CHARGE TAKE
// ═════════════════════════════════════════════════════════════════════════

async function scenarioForgetVsCharge() {
  log("\n── §4: no row for a forgotten follower survives a landing charge, whichever order they race in ──");

  const FOLLOWER = "f4000000-0000-4000-8000-000000000001";
  const PERSON = "b4000000-0000-4000-8000-000000000001";
  const SUB = "54000000-0000-4000-8000-000000000001";
  const REF = "ref-order-4";

  // CHARGE's own call count is NOT fixed: when the follower's subscription
  // row is still there when its context SELECT runs, `applyWebhook` takes
  // exactly 2 calls (context + the main write, which itself may throw the
  // FK violation named above). But when FORGET's cascade has ALREADY
  // removed the row by the time that context SELECT runs, `applyWebhook`
  // finds no follower lane and falls through to try the Suite lane, then
  // the creator-tier lane (`api/_payments.js`'s own fixed lane-resolution
  // order, WS-R33's header), THEN throws `payments_subscription_unknown` —
  // 3 calls, never 2, on that branch. Padded to the true max (3) rather
  // than the follower-lane-only max (2) this suite's first draft assumed
  // and hung on (`context/rejected.md#ws-r140-charge-actor-call-count-
  // assumed-fixed-at-two`) — the scheduler's own "skip once an actor
  // finishes" design (see `makeConductor` above) makes the padding free
  // when the shorter branch is the one that actually runs.
  const orders = enumerateMerges({ FORGET: 6, CHARGE: 3 });
  ordersEnumerated += orders.length;
  let allClean = true;
  let sampleFail = null;
  let chargeEverThrewFk = false;
  let chargeEverLanded = false;

  for (const order of orders) {
    const state = freshWorld();
    seedRoom(state);
    seedFollower(state, { followerId: FOLLOWER, personId: PERSON });
    seedSubscription(state, { subscriptionId: SUB, followerId: FOLLOWER, personId: PERSON, ref: REF, state: "created" });

    const db = makeOrderDb(state);
    const who = { roomId: ROOM_ID, personId: PERSON, agentId: AGENT_ID, slug: "order-battery-room", locale: "en" };

    const results = await runSchedule(db, {
      FORGET: (adb) => roomForgetForFollower(adb, who, {
        tableApplied: async (name) => name === "vy_room_subscription" || name === "vy_room_forget_receipt",
        personTables: async () => [],
        now: Date.parse("2026-09-05T12:00:00.000Z"),
      }),
      CHARGE: (adb) => callWebhook(adb, {
        event: "subscription.charged", ref: REF, eventRef: "evt-order-4-charge",
        currentStartSec: 1_757_000_000, currentEndSec: 1_759_600_000, amountPaise: 29_900,
      }),
    }, order);

    if (results.CHARGE?.ok) chargeEverLanded = true;
    if (!results.CHARGE?.ok && results.CHARGE?.error?.code === "23503") chargeEverThrewFk = true;
    // FORGET must never itself throw — a real forget has no reason to fail
    // because a webhook happened to race it.
    if (!results.FORGET?.ok) {
      allClean = false;
      sampleFail = order;
      continue;
    }
    const clean =
      !state.followers.some((f) => f.follower_id === FOLLOWER) &&
      !state.subscriptions.some((s) => s.subscription_id === SUB) &&
      !state.events.some((e) => e.subscription_id === SUB) &&
      !state.receipts.some((r) => r.room_id === ROOM_ID && r.person_id === PERSON);
    if (!clean) {
      allClean = false;
      sampleFail = order;
    }
  }

  ok(
    "[order/forget] §4 no row naming the forgotten follower's subscription, ledger event, or receipt survives, whichever order the forget and the charge race in",
    allClean,
    sampleFail ? `first failing order: ${sampleFail.join(",")}` : `${orders.length} orders held`,
  );
  ok(
    "[order/forget] §4 sanity: the charge lands cleanly in at least one order (when it runs before the forget's own cascade)",
    chargeEverLanded,
  );
  ok(
    "[order/forget] §4 sanity: the charge is safely REFUSED (never a dangling row) in at least one order (when the forget's cascade already removed the subscription it would write against)",
    chargeEverThrewFk,
  );
}

// ═════════════════════════════════════════════════════════════════════════
// THE BATTERY'S OWN ENTRY POINT — imported by evals/room-doors/run.mjs so
// the door battery's ONE printed total covers this file too, and runnable
// standalone for a fast iteration loop while building it.
// ═════════════════════════════════════════════════════════════════════════

export async function runOrderBattery() {
  await scenarioWebhookOrder();
  await scenarioReminderVsCancel();
  await scenarioReferralReward();
  await scenarioForgetVsCharge();
  for (const line of lines) console.log(line);
  console.log(`\n  order battery: ${ordersEnumerated} orders enumerated across 4 scenarios, ${pass} ok, ${fail} failed`);
  return { pass, fail, ordersEnumerated };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await runOrderBattery();
  process.exit(result.fail ? 1 : 0);
}
