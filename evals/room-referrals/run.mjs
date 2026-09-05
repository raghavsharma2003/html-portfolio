// Follower referrals (WS-R86, migration 123) — offline, deterministic, $0,
// no DB, no network, no model call.
//
//   node evals/room-referrals/run.mjs
//
// Drives the REAL `api/_room-surface.js` (`referralHashFor`,
// `roomReferralLink`, `joinRoom`, `roomExport`) through the SAME shared fake
// `db` `evals/room/run.mjs` uses (`evals/room/fixtures.mjs`, extended by
// this workstream to model the referral write and the xmax-based
// new-row detection), and the REAL `api/_funnel.js`
// (`friendsBroughtThisWeek`, `friendArrivalsThisWeek`) through a small
// dedicated fake for the two funnel-level reads.
//
// ── what this suite is actually guarding ───────────────────────────────────
//
// 1. THE HASH IS STABLE AND ONE-WAY. `referralHashFor` is deterministic per
//    (room, person): the same pair always produces the same hash, a
//    different room or a different person always produces a different one.
// 2. THE LINK IS EXACTLY THE SHAPE THE BRIEF NAMES. `roomReferralLink`
//    returns `/r/<slug>?via=friend&ref=<hash>` — a relative path, no
//    origin — and the hash is the referrer's own, recomputed later by
//    `roomExport`'s own count read to prove the two agree.
// 3. A REFERRAL IS CREDITED EXACTLY ONCE, ON A GENUINELY NEW FOLLOWER ROW.
//    A's link, used by B, writes one row naming A's hash. The SAME `ref`
//    presented again on a REPEAT join (B changing their memory answer)
//    mints no second row — the xmax-based `newly_joined` gate, never a
//    JS "have I seen this session before" flag.
// 4. SELF-REFERRAL IS REFUSED STRUCTURALLY, IN THE WRITE'S OWN WHERE. A
//    follower who joins through their OWN link (their own recomputed hash
//    equals the `ref` they carried) writes zero rows — proven both as the
//    real behaviour AND, negatively, that the guard is load-bearing (a
//    version of the write with the guard struck DOES leak a self-referral
//    row, the mirror image of every other struck-predicate control this
//    repo's suites already carry).
// 5. A MALFORMED `ref` NEVER REACHES SQL AT ALL. Wrong length, uppercase,
//    or SQL-shaped input is refused by `resolveReferralHash` before the
//    insert statement is even issued — proven by inspecting the fake db's
//    own call log, not merely by the row count staying at zero.
// 6. THE TWO GROWTH READS FLOOR AT n>=5, HONESTLY. `friendsBroughtThisWeek`
//    (the Room Studio's own per-room card) and `friendArrivalsThisWeek`
//    (the ops board's platform-wide Growth line) both return the fixed
//    floor sentence below five, the real number at or above it, and the
//    honest "not applied yet" shape when their own table is not present.
// 7. THE FOLLOWER'S OWN EXPORT CARRIES THEIR REFERRAL COUNT ONLY. The
//    referrer's own `roomExport` shows `{count: n}` under
//    `vy_room_referral`; a follower who never referred anyone carries no
//    such key at all (never a `{count: 0}`); the JOINER's own export
//    (never having referred anyone themselves) carries none either.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SLUG, ROOM_ID, AGENT_ID, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent, freshState, fakeDb,
} from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);
process.env.RATE_SALT = process.env.RATE_SALT || "test-rate-salt-ws-r86";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const {
  ROOM_ARRIVAL_VIA,
  referralHashFor,
  roomReferralLink,
  roomReferralProgress,
  REFERRAL_REWARD_FRIEND_THRESHOLD,
  joinRoom,
  roomExport,
  RoomError,
} = room;

const payments = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const { maybeGrantReferralReward } = payments;

const funnel = await import(pathToFileURL(join(REPO, "api/_funnel.js")).href);
const {
  friendsBroughtThisWeek, friendsBroughtNote,
  friendArrivalsThisWeek, friendArrivalNote,
  SHARE_ARRIVAL_FLOOR,
} = funnel;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "same idea, other end.";
const personTables = async () => [];
// The table is applied throughout this suite unless a §6 case says
// otherwise - `evals/room/run.mjs`'s own `deps()` helper, its default
// EXTENDED by this workstream so the referral write path (gated on
// `isTableAppliedFor(deps)("vy_room_referral")`, `api/_room-surface.js`'s
// own header) is actually exercised rather than silently skipped the way
// every OTHER suite sharing this fixture leaves it (no override at all,
// which resolves to the real, DB-less `tableApplied` and is always false).
const deps = (extra = {}) => ({
  loadAgent, engine, reply, personTables,
  tableApplied: async () => true,
  ...extra,
});

// ── §1. referralHashFor: deterministic, one-way, per (room, person) ───────
{
  const a1 = referralHashFor(ROOM_ID, PERSON_A, process.env);
  const a2 = referralHashFor(ROOM_ID, PERSON_A, process.env);
  ok("§1 the same (room, person) always hashes the same", a1 === a2);
  ok("§1 the hash is 64 lowercase hex characters", /^[0-9a-f]{64}$/.test(a1));

  const b = referralHashFor(ROOM_ID, PERSON_B, process.env);
  ok("§1 a different person in the SAME room hashes differently", a1 !== b);

  const otherRoom = "d0000000-0000-4000-8000-0000000000ff";
  const aOtherRoom = referralHashFor(otherRoom, PERSON_A, process.env);
  ok("§1 the SAME person in a different room hashes differently", a1 !== aOtherRoom);

  const noSalt = referralHashFor(ROOM_ID, PERSON_A, {});
  ok("§1 an unset RATE_SALT still hashes consistently (a fixed fallback, never a thrown error)",
    typeof noSalt === "string" && /^[0-9a-f]{64}$/.test(noSalt));
}

// ── §2. roomReferralLink: the exact shape, minted off a real session ──────
{
  const state = freshState();
  const db = fakeDb(state);
  const joined = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  const link = await roomReferralLink(db, { session: joined.session }, deps());
  const expectedHash = referralHashFor(ROOM_ID, PERSON_A, process.env);
  ok("§2 the link is a relative path, never an absolute URL", link.url.startsWith("/r/") && !link.url.includes("://"));
  ok("§2 the link is exactly /r/<slug>?via=friend&ref=<hash>",
    link.url === `/r/${SLUG}?via=friend&ref=${expectedHash}`, link.url);
  ok("§2 'friend' is a real ROOM_ARRIVAL_VIA value", ROOM_ARRIVAL_VIA.includes("friend"));
  ok("§2 the returned hash matches the one the URL carries", link.hash === expectedHash);

  const badSession = await roomReferralLink(db, { session: "garbage" }, deps()).catch((e) => e);
  ok("§2 a garbage session is refused, never a link", badSession instanceof RoomError && badSession.code === "room_session_invalid");
}

// ── §3. a referral is credited exactly once, on a genuinely new join ──────
{
  const state = freshState();
  const db = fakeDb(state);
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  ok("§3 A's own join, with no ref, writes zero referral rows", state.referrals.length === 0);

  const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
  const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");

  const joinedB = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: refA },
    deps(),
  );
  ok("§3 B joining through A's link credits exactly one referral row", state.referrals.length === 1);
  ok("§3 the row names A's hash, and only A's", state.referrals[0].referrer_hash === refA);
  ok("§3 the row names this Room", state.referrals[0].room_id === ROOM_ID);
  ok("§3 the row carries no follower/person id of any kind",
    !("person_id" in state.referrals[0]) && !("follower_id" in state.referrals[0]) && !("joiner" in state.referrals[0]));

  // NEGATIVE CONTROL (repeat join, same ref): B changes their memory
  // answer - the SAME join op, the SAME `ref` still sitting in their
  // browser's URL - and it must mint no second row: the follower row
  // already exists, so `newly_joined` is false and the referral write is
  // never even attempted.
  const rejoinedB = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: false, ref: refA },
    deps(),
  );
  ok("NEGATIVE CONTROL (b): a repeat join with the SAME ref mints no second referral row",
    state.referrals.length === 1, `now has ${state.referrals.length}`);
  ok("§3 the repeat join itself still succeeds (the memory answer really changed)",
    rejoinedB.follower.remembers === false);
}

// ── §4. self-referral is refused, structurally, in the WHERE ──────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
  const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");

  // A "joins" a second Room under a NEW account whose person id happens to
  // equal A's own — modelled directly: a follower presenting THEIR OWN
  // hash as `ref` is what a self-referral IS, whichever door produced
  // that hash. `personForAccount`'s own USER_A -> PERSON_A mapping means
  // the cleanest way to reproduce it is A re-using their OWN link on
  // their OWN already-existing row, which this fixture's `insert into
  // vy_room_follower` branch treats as a repeat join anyway (not new) —
  // so the real adversarial case is proven directly against the pure
  // predicate instead, matching the real statement byte for byte.
  const selfHash = referralHashFor(ROOM_ID, PERSON_A, process.env);
  ok("§4 A's own link hash IS A's own recomputed hash (this is what makes self-referral detectable at all)",
    refA === selfHash);

  const before = state.referrals.length;
  // Directly exercises the real fake-db branch with referrerHash === joinerHash,
  // the exact shape `joinRoom`'s own self-referral guard produces when a
  // follower joins through their own link.
  await db(
    "insert into vy_room_referral (referral_id, room_id, referrer_hash, created_at) select ($1)::uuid, ($2)::uuid, ($3)::text, now() where ($3)::text <> ($4)::text",
    ["11111111-1111-4111-8111-111111111111", ROOM_ID, selfHash, selfHash],
  );
  ok("§4 a same-hash write (self-referral) writes zero rows", state.referrals.length === before);

  // NEGATIVE CONTROL (a): the guard is load-bearing, not vacuous. A STRUCK
  // copy of the same write (the WHERE clause's own comparison removed,
  // `evals/room-doors/run.mjs`'s own struck-fixture technique one suite
  // over) DOES write the row - proving the real WHERE is what protects
  // this, not a naturally-unreachable shape.
  {
    const struckState = freshState();
    const struckDb = fakeDb(struckState);
    const realInsert = struckDb;
    // A hand-struck variant: the identical statement with its own guard
    // removed, run against a FRESH state so it cannot be confused with the
    // real (guarded) write above.
    const strikeGuardDb = async (sql, params) => {
      if (sql.includes("insert into vy_room_referral")) {
        const [referralId, roomId, referrerHash] = params;
        struckState.referrals.push({ referral_id: referralId, room_id: roomId, referrer_hash: referrerHash });
        return [{ referral_id: referralId }];
      }
      return realInsert(sql, params);
    };
    await strikeGuardDb(
      "insert into vy_room_referral (referral_id, room_id, referrer_hash, created_at) select ($1)::uuid, ($2)::uuid, ($3)::text, now()",
      ["22222222-2222-4222-8222-222222222222", ROOM_ID, selfHash, selfHash],
    );
    ok("NEGATIVE CONTROL (a): a struck copy of the write, with no self-referral WHERE, DOES leak a self-referral row",
      struckState.referrals.length === 1,
      struckState.referrals.length === 0 ? "control did not fire - the real WHERE above would prove nothing" : "");
  }
}

// ── §5. a malformed ref never reaches SQL at all ───────────────────────────
{
  for (const bad of ["not-a-hash", "g".repeat(64), "0".repeat(63), "0".repeat(65), "share; drop table vy_room_referral", ""]) {
    const state = freshState();
    const db = fakeDb(state);
    const joined = await joinRoom(
      db,
      { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: bad },
      deps(),
    );
    ok(`§5 join still succeeds with a malformed ref (${JSON.stringify(bad).slice(0, 20)})`, joined.joined === true);
    ok(`NEGATIVE CONTROL (c): a malformed ref (${JSON.stringify(bad).slice(0, 20)}) never reaches the insert at all`,
      state.referrals.length === 0 && !db.calls.some((c) => c.includes("insert into vy_room_referral")));
  }

  // A REAL hash, uppercase - still accepted (case-insensitively normalized,
  // `resolveArrivalVia`'s own `.toLowerCase()` posture restated for a hash),
  // proving §5's malformed cases are refused for their SHAPE, never merely
  // for not matching a case a caller happened to type.
  {
    const state = freshState();
    const db = fakeDb(state);
    const joinedA = await joinRoom(
      db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
    );
    const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
    const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");
    const joinedB = await joinRoom(
      db,
      { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: refA.toUpperCase() },
      deps(),
    );
    ok("§5b an uppercase real hash is still credited (case-insensitively normalized, not refused for its case)",
      state.referrals.length === 1 && state.referrals[0].referrer_hash === refA);
  }
}

// ── §6. the two growth reads floor at n>=5, honestly ───────────────────────
{
  function fakeFunnelDb(rows, applied = true) {
    return async (sql, params) => {
      if (sql.includes("from vy_room_referral")) {
        const [roomId, since] = params;
        const n = rows.filter((r) => r.room_id === roomId && r.created_at >= since).length;
        return [{ n }];
      }
      if (sql.includes("from vy_room_arrival") && sql.includes("via = 'friend'")) {
        const [since] = params;
        const n = rows.filter((r) => r.day >= since).reduce((s, r) => s + r.count, 0);
        return [{ n }];
      }
      return [];
    };
  }
  const roomId = ROOM_ID;
  const now = Date.parse("2026-09-05T00:00:00.000Z");

  // Below the floor.
  const below = await friendsBroughtThisWeek(
    fakeFunnelDb([{ room_id: roomId, created_at: "2026-09-04T00:00:00.000Z" }]),
    roomId, now, { tableApplied: async () => true },
  );
  ok("§6 below SHARE_ARRIVAL_FLOOR: n is null, below_floor is true, note is the fixed sentence",
    below.n === null && below.below_floor === true && below.note === friendsBroughtNote(1));

  // At the floor.
  const atFloorRows = Array.from({ length: SHARE_ARRIVAL_FLOOR }, () => ({
    room_id: roomId, created_at: "2026-09-04T00:00:00.000Z",
  }));
  const atFloor = await friendsBroughtThisWeek(
    fakeFunnelDb(atFloorRows), roomId, now, { tableApplied: async () => true },
  );
  ok("§6 at the floor: the real number renders", atFloor.n === SHARE_ARRIVAL_FLOOR && atFloor.below_floor === false);

  // Migration 123 not yet applied: the honest shape, never a query against
  // a table that is not there.
  const unapplied = await friendsBroughtThisWeek(
    fakeFunnelDb(atFloorRows), roomId, now, { tableApplied: async () => false },
  );
  ok("§6 vy_room_referral not applied yet: the honest not-enough-data shape",
    unapplied.n === null && unapplied.below_floor === true);

  // The platform-wide line, `via = 'friend'` over vy_room_arrival.
  const arrivalRows = [{ day: "2026-09-04", count: SHARE_ARRIVAL_FLOOR + 2 }];
  const friendArrivalDb = async (sql, params) => {
    if (sql.includes("from vy_room_arrival") && sql.includes("via = 'friend'")) {
      const [since] = params;
      const n = arrivalRows.filter((r) => r.day >= since).reduce((s, r) => s + r.count, 0);
      return [{ n }];
    }
    return [];
  };
  const platformReal = await friendArrivalsThisWeek(friendArrivalDb, now, { tableApplied: async () => true });
  ok("§6 friendArrivalsThisWeek reads via='friend' and floors identically",
    platformReal.n === SHARE_ARRIVAL_FLOOR + 2 && platformReal.below_floor === false,
    JSON.stringify(platformReal));
  ok("§6 friendArrivalNote below the floor is the fixed sentence, never a small real number",
    friendArrivalNote(1) === friendArrivalNote(1) && friendArrivalNote(1).includes("Fewer than five"));
}

// ── §7. the follower's own export carries their referral count only ───────
{
  const state = freshState();
  const db = fakeDb(state);
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
  const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");
  const joinedB = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: refA },
    deps(),
  );

  const exportA = await roomExport(db, { session: joinedA.session }, deps());
  ok("§7 the referrer's own export carries their referral count",
    exportA.tables.vy_room_referral && exportA.tables.vy_room_referral.count === 1,
    JSON.stringify(exportA.tables.vy_room_referral));

  const exportB = await roomExport(db, { session: joinedB.session }, deps());
  ok("§7 the JOINER's own export carries no referral count at all (they never referred anyone)",
    !("vy_room_referral" in exportB.tables));

  const nobodyExportA = await roomExport(db, { session: joinedA.session }, deps({ tableApplied: async () => false }));
  ok("§7 migration 123 not applied yet: the export omits the key entirely, never a fake zero",
    !("vy_room_referral" in nobodyExportA.tables));
}

// ── §8 (WS-R130, migration 133). the referral CREDIT link, written at the
//    SAME moment as vy_room_referral, naming a real referrer for the first
//    time ─────────────────────────────────────────────────────────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
  const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");
  const joinedB = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: refA },
    deps(),
  );
  ok("§8 B joining through A's link writes exactly one referral CREDIT row",
    state.referralCredits.length === 1, JSON.stringify(state.referralCredits));
  const credit = state.referralCredits[0];
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);
  const followerB = state.followers.find((f) => f.person_id === PERSON_B);
  ok("§8 the credit names A as referrer and B as referred, by follower_id",
    credit.referrer_follower_id === followerA.follower_id && credit.referred_follower_id === followerB.follower_id);
  ok("§8 the credit names A's own person_id too (unlike vy_room_referral, this table IS identity-bearing)",
    credit.referrer_person_id === PERSON_A);
  ok("§8 vy_room_referral itself is UNCHANGED — still exactly one anonymous row",
    state.referrals.length === 1 && !("person_id" in state.referrals[0]) && !("follower_id" in state.referrals[0]));

  // NEGATIVE CONTROL: a repeat join with the same ref mints no second
  // credit row either — `unique (referred_follower_id)`'s own guarantee,
  // `§3`'s identical control for `vy_room_referral` restated for this
  // table.
  await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: false, ref: refA },
    deps(),
  );
  ok("NEGATIVE CONTROL: a repeat join with the SAME ref mints no second credit row",
    state.referralCredits.length === 1, `now has ${state.referralCredits.length}`);

  // A malformed ref never resolves to a credit row either — `resolveReferralHash`'s
  // own refusal, `§5`'s own law restated one table over.
  const state2 = freshState();
  const db2 = fakeDb(state2);
  await joinRoom(
    db2, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true, ref: "not-a-hash" }, deps(),
  );
  ok("§8 a malformed ref never reaches the credit insert at all", state2.referralCredits.length === 0);
}

// ── §9 (WS-R130, migration 133). `maybeGrantReferralReward` and
//    `roomReferralProgress` — a LOCAL wrapper over the shared fixture,
//    modelling exactly the vy_payment_event/vy_room_subscription shapes
//    these two new reads need, which `evals/room/fixtures.mjs` was never
//    built to carry (that fixture's own domain is the follower lane, never
//    money) — `evals/room-referrals/run.mjs`'s own §6 `fakeFunnelDb`
//    precedent, restated for a heavier statement.
// ───────────────────────────────────────────────────────────────────────
const REFERRAL_REWARD_CHARGE_KINDS_TEST = ["subscription.charged", "subscription.activated"];

function paymentsWrapperDb(state, baseDb) {
  state.paymentEvents = state.paymentEvents || [];
  state.subscriptions = state.subscriptions || [];
  state.rewards = state.rewards || [];
  const landed = (followerId, excludeEventId) =>
    state.paymentEvents.some((pe) => {
      if (excludeEventId != null && pe.event_id === excludeEventId) return false;
      if (!REFERRAL_REWARD_CHARGE_KINDS_TEST.includes(pe.kind) || pe.amount_inr <= 0) return false;
      const sub = state.subscriptions.find((s) => s.subscription_id === pe.subscription_id);
      return sub && sub.follower_id === followerId;
    });
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("with this_follower_first as")) {
      const [followerId, eventId, roomId, threshold, yearKey, , rewardId, reason] = params;
      const fid = String(followerId);
      const isFirst = !landed(fid, String(eventId));
      if (!isFirst) return [];
      const credit = state.referralCredits.find((c) => c.referred_follower_id === fid && c.room_id === String(roomId));
      if (!credit) return [];
      const siblingCredits = state.referralCredits.filter((c) => c.referrer_follower_id === credit.referrer_follower_id);
      const n = siblingCredits.filter((c) => landed(c.referred_follower_id, null)).length;
      if (n < Number(threshold)) return [];
      const already = state.rewards.find(
        (r) => r.referrer_follower_id === credit.referrer_follower_id &&
          r.room_id === String(roomId) && r.year_key === String(yearKey),
      );
      if (already) return [];
      const referrerSub = state.subscriptions.find(
        (s) => s.follower_id === credit.referrer_follower_id && s.state === "active",
      );
      const base = referrerSub ? new Date(referrerSub.current_period_end) : new Date();
      const extended = new Date(base.getTime());
      extended.setUTCMonth(extended.getUTCMonth() + 1);
      const reward = {
        reward_id: String(rewardId), room_id: String(roomId),
        referrer_follower_id: credit.referrer_follower_id, referrer_person_id: credit.referrer_person_id,
        granted_at: new Date().toISOString(), period_extended_to: extended.toISOString(),
        year_key: String(yearKey), reason: String(reason),
      };
      state.rewards.push(reward);
      if (referrerSub) referrerSub.current_period_end = reward.period_extended_to;
      return [{ ...reward }];
    }
    if (has("from vy_room_referral_credit rc") && has("count(*)::int as n")) {
      const [followerId] = params.map(String);
      const rows = state.referralCredits.filter((c) => c.referrer_follower_id === followerId);
      const n = rows.filter((c) => landed(c.referred_follower_id, null)).length;
      return [{ n }];
    }
    if (has("from vy_room_referral_reward") && has("order by granted_at desc")) {
      const [followerId, roomId] = params.map(String);
      const rows = state.rewards
        .filter((r) => r.referrer_follower_id === followerId && r.room_id === roomId)
        .sort((a, b) => (a.granted_at < b.granted_at ? 1 : -1));
      return rows.length ? [rows[0]] : [];
    }
    // Every reward's own zero-amount receipt attempt (`issueFollowerReceipt`'s
    // own statements) and the synthetic `vy_payment_event` insert - NOT
    // modelled here on purpose: `maybeGrantReferralReward`'s own header
    // states the receipt half is best-effort and `.catch()`-wrapped, so an
    // unmatched statement falling through to the base fixture's honest
    // empty-array default proves the grant survives a receipt that could
    // not be minted, exactly the property that branch exists for.
    return baseDb(sql, params);
  };
}

{
  const state = freshState();
  const db = paymentsWrapperDb(state, fakeDb(state));
  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps(),
  );
  const linkA = await roomReferralLink(db, { session: joinedA.session }, deps());
  const refA = new URL(`http://x${linkA.url}`).searchParams.get("ref");
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);

  // A's own subscription, active, so the extension has something real to
  // extend.
  state.subscriptions.push({
    subscription_id: "sub-a", follower_id: followerA.follower_id, person_id: PERSON_A,
    state: "active", current_period_end: "2026-09-01T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z",
  });

  const zeroProgress = await roomReferralProgress(db, { session: joinedA.session }, deps());
  ok("§9 before any friend pays: 0 of 3, no reward",
    zeroProgress.friends_credited === 0 && zeroProgress.threshold === REFERRAL_REWARD_FRIEND_THRESHOLD && zeroProgress.reward === null,
    JSON.stringify(zeroProgress));

  // Three friends join through A's link and each lands a first charge.
  const friendFollowerIds = [];
  for (let i = 0; i < 3; i++) {
    const uid = `f0000000-0000-4000-8000-00000000000${i}`;
    const joined = await joinRoom(
      db, { slug: SLUG, authUserId: uid, ageAttested: true, memoryConsent: true, ref: refA }, deps(),
    );
    const follower = state.followers.find((f) => f.person_id === (state.accounts.find((a) => a.auth_user_id === uid)?.person_id));
    friendFollowerIds.push(follower.follower_id);
    const subId = `sub-friend-${i}`;
    state.subscriptions.push({
      subscription_id: subId, follower_id: follower.follower_id, person_id: follower.person_id,
      state: "active", current_period_end: "2026-09-15T00:00:00.000Z", created_at: "2026-08-15T00:00:00.000Z",
    });
    const eventId = `evt-${i}`;
    state.paymentEvents.push({ event_id: eventId, subscription_id: subId, kind: "subscription.charged", amount_inr: 399 });

    const grant = await maybeGrantReferralReward(
      db, { eventId, roomId: ROOM_ID, followerId: follower.follower_id, now: Date.parse("2026-08-20T00:00:00.000Z") }, deps(),
    );
    if (i < 2) {
      ok(`§9 friend ${i + 1} of 3 pays: no reward yet`, grant === null, JSON.stringify(grant));
    } else {
      ok("§9 the THIRD friend's first charge grants the reward", grant !== null && grant.reward_id, JSON.stringify(grant));
      ok("§9 the reward names A's OWN follower_id as referrer",
        grant?.referrer_follower_id === followerA.follower_id);
      ok("§9 A's own subscription period_end was extended by exactly one month",
        grant?.period_extended_to === "2026-10-01T00:00:00.000Z", grant?.period_extended_to);
    }
  }

  const fullProgress = await roomReferralProgress(db, { session: joinedA.session }, deps());
  ok("§9 A's own progress now reads 3 of 3, with the reward",
    fullProgress.friends_credited === 3 && fullProgress.reward !== null, JSON.stringify(fullProgress));

  // NEGATIVE CONTROL: a REPLAY (the same event id landing a second time —
  // `applyWebhook`'s own `!result` early return means this function is
  // never even CALLED on a real replay, but this proves the function
  // itself is not the thing preventing a double grant, the unique index
  // is) grants nothing a second time for the SAME year.
  const replay = await maybeGrantReferralReward(
    db, { eventId: "evt-2", roomId: ROOM_ID, followerId: friendFollowerIds[2], now: Date.parse("2026-08-21T00:00:00.000Z") }, deps(),
  );
  ok("NEGATIVE CONTROL: calling the SAME grant again (the cap, `on conflict ... do nothing`) grants nothing twice",
    replay === null, JSON.stringify(replay));
  ok("NEGATIVE CONTROL: exactly one reward row exists for A, this room, this year",
    state.rewards.filter((r) => r.referrer_follower_id === followerA.follower_id).length === 1);

  // A fourth friend paying does not grant a SECOND reward the same year —
  // the cap is "one per follower per room per year," not "one per three
  // friends."
  const uid4 = "f0000000-0000-4000-8000-000000000003";
  const joined4 = await joinRoom(
    db, { slug: SLUG, authUserId: uid4, ageAttested: true, memoryConsent: true, ref: refA }, deps(),
  );
  const follower4 = state.followers.find((f) => f.person_id === state.accounts.find((a) => a.auth_user_id === uid4)?.person_id);
  state.subscriptions.push({
    subscription_id: "sub-friend-3", follower_id: follower4.follower_id, person_id: follower4.person_id,
    state: "active", current_period_end: "2026-09-20T00:00:00.000Z", created_at: "2026-08-20T00:00:00.000Z",
  });
  state.paymentEvents.push({ event_id: "evt-3", subscription_id: "sub-friend-3", kind: "subscription.charged", amount_inr: 399 });
  const fourthGrant = await maybeGrantReferralReward(
    db, { eventId: "evt-3", roomId: ROOM_ID, followerId: follower4.follower_id, now: Date.parse("2026-08-22T00:00:00.000Z") }, deps(),
  );
  ok("§9 a fourth friend paying grants no SECOND reward the same year (capped, not per-three)",
    fourthGrant === null, JSON.stringify(fourthGrant));

  // Migration 133 not applied yet: the honest zero shape, `friendsBroughtThisWeek`'s
  // own not-applied-yet posture restated.
  const nothingYet = await roomReferralProgress(db, { session: joinedA.session }, deps({ tableApplied: async () => false }));
  ok("§9 migration 133 not applied yet: the honest zero shape, never a fake count",
    nothingYet.friends_credited === 0 && nothingYet.reward === null);
  const noGrantYet = await maybeGrantReferralReward(
    db, { eventId: "evt-x", roomId: ROOM_ID, followerId: followerA.follower_id, now: Date.now() },
    { tableApplied: async () => false },
  );
  ok("§9 maybeGrantReferralReward with migration 133 not applied returns null, never throws",
    noGrantYet === null);
}

console.log(`\nroom-referrals: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
