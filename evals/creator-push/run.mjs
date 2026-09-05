// WS-R74 (migration 118). The creator's weekly push: `api/_creator-push.js`
// (config, subscribe/revoke, the payload builder, the sweep), driven
// through a fake `db` layered exactly the way `evals/ops/run.mjs` layers
// its own (`fakeDb` + `pulseDb`, `evals/pulse/fixtures.mjs`'s own shared
// world) rather than a fourth hand-rolled Room/Pulse fixture -
// `evals/pulse/fixtures.mjs`'s own header names the risk two fakes for the
// same tables would create.
//
//   node evals/creator-push/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres, no model call,
// no GPU.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshState, fakeDb, ROOM_ID, REPLICA_ID, OWNER, SLUG } from "../room/fixtures.mjs";
import { freshPulseState, pulseDb } from "../pulse/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threwAsync = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};

const {
  CreatorPushError,
  creatorPushConfig,
  subscribeCreatorPush,
  revokeCreatorPush,
  creatorPushSubscriptionsFor,
  revokeCreatorPushById,
  creatorWeeklyPushPayload,
  sendCreatorWeeklyPushes,
  CREATOR_PUSH_FOLLOWER_CONTENT_NAMES,
} = await import(pathToFileURL(join(REPO, "api/_creator-push.js")).href);

const OWNER_B = "22222222-2222-4222-8222-222222222222"; // USER_B, a different owner entirely

const SUB = {
  endpoint: "https://push.example.test/creator-device-1",
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

// ═════════════════════════════════════════════════════════════════════════
// §1 — creatorPushConfig: pure function of env, no db.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: creatorPushConfig ──");
{
  ok("creatorPushConfig: unset VAPID reports honestly unconfigured, no public key",
    creatorPushConfig({}).configured === false && creatorPushConfig({}).vapid_public === null);
  const configured = creatorPushConfig({
    ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:x@example.test",
  });
  ok("creatorPushConfig: all three set reports configured, WITH the public key",
    configured.configured === true && configured.vapid_public === "pub");
  ok("creatorPushConfig: the PRIVATE key never appears on the returned shape",
    !("vapid_private" in configured) && JSON.stringify(configured).includes("priv") === false);
  // Workstream law: reuses ROOM_PUSH_VAPID_* rather than a new env var.
  const src = fs.readFileSync(join(REPO, "api/_creator-push.js"), "utf8");
  ok("creatorPushConfig reads ROOM_PUSH_VAPID_PUBLIC/PRIVATE/SUBJECT - no new env var introduced",
    src.includes("ROOM_PUSH_VAPID_PUBLIC") && src.includes("ROOM_PUSH_VAPID_PRIVATE") && src.includes("ROOM_PUSH_VAPID_SUBJECT")
      && !/[A-Z_]+_PUSH_VAPID_(?!PUBLIC|PRIVATE|SUBJECT)/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — subscribe / revoke, over a small dedicated fake table (this table
// has no room, no follower, no replica, `evals/room-doors/run.mjs`'s own
// §17b header names the identical reason for growing a tiny fixture here
// rather than fixtures.mjs).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: subscribeCreatorPush / revokeCreatorPush / creatorPushSubscriptionsFor ──");
function freshSubState() {
  return { rows: [] };
}
function subDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    // WS-R89: subscribeCreatorPush's own new pre-check — an endpoint
    // already ACTIVELY bound to a DIFFERENT owner.
    if (has("select owner_user_id from vy_creator_push_subscription") && has("owner_user_id <> ($2)::uuid")) {
      const [endpoint, ownerUserId] = params;
      return state.rows
        .filter((r) => r.endpoint === endpoint && !r.revoked_at && r.owner_user_id !== ownerUserId)
        .map((r) => ({ owner_user_id: r.owner_user_id }));
    }
    if (has("insert into vy_creator_push_subscription")) {
      const [id, ownerUserId, endpoint, p256dh, auth] = params;
      let row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint);
      if (row) {
        row.p256dh = p256dh;
        row.auth = auth;
        row.revoked_at = null;
      } else {
        row = { id, owner_user_id: ownerUserId, endpoint, p256dh, auth, revoked_at: null };
        state.rows.push(row);
      }
      return [{ id: row.id }];
    }
    if (has("update vy_creator_push_subscription") && has("endpoint = $2")) {
      const [ownerUserId, endpoint] = params;
      const row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint && !r.revoked_at);
      if (!row) return [];
      row.revoked_at = "revoked";
      return [{ id: row.id }];
    }
    if (has("select id, endpoint, p256dh, auth") && has("from vy_creator_push_subscription")) {
      const [ownerUserId] = params;
      return state.rows.filter((r) => r.owner_user_id === ownerUserId && !r.revoked_at)
        .map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
    }
    if (has("update vy_creator_push_subscription set revoked_at = now() where id")) {
      const [id] = params;
      const row = state.rows.find((r) => r.id === id);
      if (row) row.revoked_at = "revoked";
      return [];
    }
    throw new Error(`§2 fake db: unmatched SQL: ${sql}`);
  };
}
{
  const state = freshSubState();
  const db = subDb(state);
  const subscribed = await subscribeCreatorPush(db, OWNER, SUB);
  ok("subscribeCreatorPush: a valid subscription from the real creator succeeds", subscribed.subscribed === true);

  const resubscribed = await subscribeCreatorPush(db, OWNER, SUB);
  ok("subscribeCreatorPush: re-subscribing the SAME endpoint upserts, never a second row",
    resubscribed.subscribed === true && state.rows.length === 1);

  const active = await creatorPushSubscriptionsFor(db, OWNER);
  ok("creatorPushSubscriptionsFor: the creator's own active subscription is readable", active.length === 1);

  // NEGATIVE CONTROL (class e): OWNER_B, a stranger, tries to revoke
  // OWNER's own subscription by guessing their endpoint. The WHERE
  // (owner_user_id = $1 AND endpoint = $2) is what refuses this, not a JS
  // check above it - proven by calling revokeCreatorPush DIRECTLY.
  const stolen = await revokeCreatorPush(db, OWNER_B, SUB.endpoint);
  ok("NEGATIVE CONTROL: a stranger (OWNER_B) revoking OWNER's own endpoint changes NOTHING, decided by the UPDATE's own WHERE",
    stolen.revoked === false && state.rows[0].revoked_at === null);

  const revoked = await revokeCreatorPush(db, OWNER, SUB.endpoint);
  ok("revokeCreatorPush: the real creator's own revoke succeeds (the fixture is sound)",
    revoked.revoked === true && state.rows[0].revoked_at !== null);

  const afterRevoke = await creatorPushSubscriptionsFor(db, OWNER);
  ok("creatorPushSubscriptionsFor: a revoked row is no longer returned", afterRevoke.length === 0);

  // A second revoke of the SAME endpoint is a no-op, never a throw.
  const revokedAgain = await revokeCreatorPush(db, OWNER, SUB.endpoint);
  ok("revokeCreatorPush: revoking an already-revoked row is a clean no-op", revokedAgain.revoked === false);

  // WS-R89 (class d, replay/reuse): re-subscribing a REVOKED endpoint under
  // a DIFFERENT owner is fine (the prior owner's row is inactive) —
  // proves the pre-check is scoped to ACTIVE rows, not the endpoint string
  // forever.
  const reusedAfterRevoke = await subscribeCreatorPush(db, OWNER_B, SUB);
  ok("subscribeCreatorPush: a REVOKED endpoint may be claimed by a different owner",
    reusedAfterRevoke.subscribed === true);
  await revokeCreatorPush(db, OWNER_B, SUB.endpoint);

  // WS-R89 (class d): the same endpoint, ACTIVELY bound to OWNER_B, is
  // refused for OWNER — the real finding this workstream fixed. Before the
  // fix this silently inserted a SECOND row, `owner_user_id=OWNER`, leaving
  // the browser bound to two different creators at once.
  await subscribeCreatorPush(db, OWNER_B, SUB);
  const stolenSub = await threwAsync(() => subscribeCreatorPush(db, OWNER, SUB));
  ok("subscribeCreatorPush: an endpoint already ACTIVELY bound to a DIFFERENT owner is refused, never a second row",
    stolenSub instanceof CreatorPushError && stolenSub.code === "creator_push_endpoint_bound_elsewhere");
  ok("subscribeCreatorPush: the refusal left exactly ONE row for this endpoint, still OWNER_B's",
    state.rows.filter((r) => r.endpoint === SUB.endpoint && !r.revoked_at).length === 1 &&
    state.rows.find((r) => r.endpoint === SUB.endpoint && !r.revoked_at).owner_user_id === OWNER_B);
  await revokeCreatorPush(db, OWNER_B, SUB.endpoint);

  // Malformed input throws BEFORE any SQL runs (assertCreatorPushSubscription).
  const badEndpoint = await threwAsync(() => subscribeCreatorPush(db, OWNER, { ...SUB, endpoint: "http://not-https.example.test" }));
  ok("subscribeCreatorPush: a non-https endpoint is refused before any write", badEndpoint instanceof CreatorPushError && badEndpoint.code === "creator_push_endpoint_invalid");
  const badKey = await threwAsync(() => subscribeCreatorPush(db, OWNER, { ...SUB, p256dh: "short" }));
  ok("subscribeCreatorPush: a malformed p256dh key is refused before any write", badKey instanceof CreatorPushError && badKey.code === "creator_push_key_invalid");
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — the payload builder: pure, and a static scan proving its own source
// names none of this repo's follower-facing content columns (workstream
// law 3/4's own negative control (a)).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: creatorWeeklyPushPayload ──");
{
  const p = creatorWeeklyPushPayload("anjali", "Anjali", 3, 42, null);
  ok("creatorWeeklyPushPayload: shape matches push-sw.js's own {title, body, kind, route} contract",
    typeof p.title === "string" && typeof p.body === "string" && p.kind === "creatorWeeklyPush" && p.route === "/r/anjali");
  ok("creatorWeeklyPushPayload: body names the follower/message counts", p.body.includes("3") && p.body.includes("42"));
  ok("creatorWeeklyPushPayload: no headline given, none appears", !p.body.includes("null") && !p.body.includes("undefined"));

  const withHeadline = creatorWeeklyPushPayload("anjali", "Anjali", 3, 42, "The top one was JEE prep.");
  ok("creatorWeeklyPushPayload: a real headline is appended", withHeadline.body.includes("JEE prep"));

  const longHeadline = creatorWeeklyPushPayload("anjali", "Anjali", 3, 42, "x".repeat(1000));
  ok("creatorWeeklyPushPayload: an overlong headline is truncated, never sent whole", longHeadline.body.length <= 400);

  ok("CREATOR_PUSH_FOLLOWER_CONTENT_NAMES is not vacuously empty", CREATOR_PUSH_FOLLOWER_CONTENT_NAMES.length >= 5);
  const src = fs.readFileSync(join(REPO, "api/_creator-push.js"), "utf8");
  const fnMatch = src.match(/export function creatorWeeklyPushPayload\([\s\S]*?\n}\n/);
  ok("creatorWeeklyPushPayload is found in api/_creator-push.js (not moved/renamed)", Boolean(fnMatch));
  const body = fnMatch ? fnMatch[0] : "";
  const hits = CREATOR_PUSH_FOLLOWER_CONTENT_NAMES.filter((n) => body.includes(n));
  ok("NEGATIVE CONTROL (a): creatorWeeklyPushPayload's own source names none of this repo's follower-facing content columns",
    hits.length === 0, hits.join(","));
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — the sweep, over a real Room/Pulse world.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: sendCreatorWeeklyPushes ──");

function buildWorld() {
  const state = freshPulseState(freshState());
  state.followerDays = [];
  const base = fakeDb(state);
  const withPulse = pulseDb(state, base);
  state.creatorWeeklyPushes = [];
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("from vy_room") && has("published_at is not null") && has("paused_at is null") && has("order by published_at asc")) {
      return state.rooms
        .filter((r) => r.published_at != null && r.paused_at == null)
        .map((r) => ({ room_id: r.room_id, slug: r.slug, display_name: r.display_name, replica_id: r.replica_id, owner_user_id: r.owner_user_id }));
    }
    if (has("count(*)::int as n") && has("from vy_room_follower") && has("joined_at >=")) {
      const [roomId, nowIso] = params.map(String);
      const now = new Date(nowIso).getTime();
      const weekAgo = now - 7 * 86_400_000;
      const n = state.followers.filter((f) => f.room_id === roomId
        && new Date(f.joined_at).getTime() >= weekAgo && new Date(f.joined_at).getTime() < now).length;
      return [{ n }];
    }
    if (has("sum(turns)") && has("from vy_room_follower_day")) {
      const [roomId] = params.map(String);
      const n = state.followerDays.filter((d) => d.room_id === roomId).reduce((s, d) => s + Number(d.turns || 0), 0);
      return [{ n }];
    }
    if (has("insert into vy_creator_weekly_push")) {
      const [pushId, roomId, weekStart, followers, messages, headlineIncluded] = params;
      const dup = state.creatorWeeklyPushes.find((r) => r.room_id === roomId && r.week_start === weekStart);
      if (dup) return [];
      state.creatorWeeklyPushes.push({ push_id: pushId, room_id: roomId, week_start: weekStart, followers, messages, headline_included: headlineIncluded });
      return [{ push_id: pushId }];
    }
    return withPulse(sql, params);
  };
  return { state, db };
}

const ENV = { ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:x@example.test" };
const NOW = Date.parse("2026-09-08T04:00:00.000Z"); // isoWeekStartDate normalizes this to its own Monday regardless

// (a) unset VAPID: nothing runs, honestly.
{
  const { db } = buildWorld();
  const summary = await sendCreatorWeeklyPushes(db, { now: NOW, env: {} });
  ok("sendCreatorWeeklyPushes: unset VAPID sends nothing, checks nothing (honest, never a fake send)",
    summary.checked === 0 && summary.sent_ledger === 0 && summary.pushed === 0);
}

// (b) the real path: one published Room, one active subscription, a real
// Pulse world with one combo bucket at the floor.
{
  const { state, db } = buildWorld();
  state.followers.push({ room_id: ROOM_ID, person_id: "p1", agent_id: "b1000000-0000-4000-8000-000000000001", joined_at: "2026-09-05T00:00:00.000Z", tier: "free", month_key: "", month_message_count: 0 });
  state.followerDays.push({ room_id: ROOM_ID, person_id: "p1", day: "2026-09-05", turns: 7 });
  state.pulseOptins.push({ room_id: ROOM_ID, person_id: "p1", thread_id: "th1", revoked_at: null });
  state.threads.push({ room_id: ROOM_ID, person_id: "p1", thread_id: "th1", title: "jee prep questions", archived_at: null });
  for (let i = 0; i < 4; i++) {
    const pid = `p-extra-${i}`;
    state.followers.push({ room_id: ROOM_ID, person_id: pid, agent_id: "b1000000-0000-4000-8000-000000000001", joined_at: "2026-08-01T00:00:00.000Z", tier: "free", month_key: "", month_message_count: 0 });
    const tid = `th-extra-${i}`;
    state.pulseOptins.push({ room_id: ROOM_ID, person_id: pid, thread_id: tid, revoked_at: null });
    state.threads.push({ room_id: ROOM_ID, person_id: pid, thread_id: tid, title: "jee prep help", archived_at: null });
  }
  const { setTopics, computeComboSnapshot } = await import(pathToFileURL(join(REPO, "api/_pulse.js")).href);
  await setTopics(db, OWNER, REPLICA_ID, ["JEE prep"]);
  await computeComboSnapshot(db, ROOM_ID, "2026-09-01");

  const sent = [];
  const summary = await sendCreatorWeeklyPushes(db, {
    now: NOW, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async (ownerUserId) => (ownerUserId === OWNER ? [{ id: "sub-1", endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: SUB.auth }] : []),
    revokeCreatorPushSubscription: async () => {},
  });
  ok("sendCreatorWeeklyPushes: the real sweep sent exactly one ledger row and one push (the fixture is sound)",
    summary.sent_ledger === 1 && summary.pushed === 1 && sent.length === 1);
  const payload = JSON.parse(sent[0].payload);
  ok("sendCreatorWeeklyPushes: the payload carries this week's real counts",
    payload.body.includes("1 new follower") && payload.body.includes("7 message"));
  ok("sendCreatorWeeklyPushes: the published Pulse combo's headline was included (JEE prep cleared the floor)",
    payload.body.toLowerCase().includes("jee prep"));
  ok("sendCreatorWeeklyPushes: the ledger row was written with headline_included = true",
    state.creatorWeeklyPushes[0].headline_included === true);

  // NEGATIVE CONTROL (b): a second sweep tick, same week, sends nothing
  // more - the ledger's own unique (room_id, week_start) WHERE, not a JS
  // guard, refuses the resend.
  const summary2 = await sendCreatorWeeklyPushes(db, {
    now: NOW + 3_600_000, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async () => [{ id: "sub-1", endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: SUB.auth }],
    revokeCreatorPushSubscription: async () => {},
  });
  ok("NEGATIVE CONTROL: a second sweep tick the SAME week sends ZERO further pushes, refused by the ledger's own unique (room_id, week_start) WHERE",
    summary2.sent_ledger === 0 && summary2.pushed === 0 && sent.length === 1);

  // A DIFFERENT week claims cleanly.
  const summary3 = await sendCreatorWeeklyPushes(db, {
    now: NOW + 7 * 86_400_000, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async () => [{ id: "sub-1", endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: SUB.auth }],
    revokeCreatorPushSubscription: async () => {},
  });
  ok("sendCreatorWeeklyPushes: the NEXT week's push sends cleanly (this is not a permanent lock on the Room)",
    summary3.sent_ledger === 1 && summary3.pushed === 1 && sent.length === 2);
}

// (c) NEGATIVE CONTROL: an unpublished Room and a paused Room are never
// selected at all.
{
  const { state, db } = buildWorld();
  state.rooms.push(
    { ...state.rooms[0], room_id: "e0000000-0000-4000-8000-000000000002", slug: "unpub", replica_id: "e1000000-0000-4000-8000-000000000002", published_at: null, paused_at: null },
    { ...state.rooms[0], room_id: "e0000000-0000-4000-8000-000000000003", slug: "paused", replica_id: "e1000000-0000-4000-8000-000000000003", published_at: "2026-08-01T00:00:00.000Z", paused_at: "2026-08-15T00:00:00.000Z" },
  );
  const summary = await sendCreatorWeeklyPushes(db, {
    now: NOW, env: ENV,
    sendPush: async () => ({ ok: true, status: 201 }),
    creatorPushSubscriptionsFor: async () => [],
  });
  ok("NEGATIVE CONTROL: an unpublished Room and a paused Room are never checked, only the one real published Room is",
    summary.checked === 1);
}

// (d) a 404 from the push service revokes THAT one subscription and never
// touches another.
{
  const { state, db } = buildWorld();
  state.followers.push({ room_id: ROOM_ID, person_id: "p1", agent_id: "b1000000-0000-4000-8000-000000000001", joined_at: "2026-09-05T00:00:00.000Z", tier: "free", month_key: "", month_message_count: 0 });
  const revoked = [];
  const summary = await sendCreatorWeeklyPushes(db, {
    now: NOW, env: ENV,
    sendPush: async (sub) => (sub.id === "dead" ? { ok: false, status: 404 } : { ok: true, status: 201 }),
    creatorPushSubscriptionsFor: async () => [
      { id: "dead", endpoint: "https://push.example.test/dead", p256dh: SUB.p256dh, auth: SUB.auth },
      { id: "alive", endpoint: "https://push.example.test/alive", p256dh: SUB.p256dh, auth: SUB.auth },
    ],
    revokeCreatorPushSubscription: async (db2, id) => revoked.push(id),
  });
  ok("sendCreatorWeeklyPushes: a 404 revokes ONLY the dead subscription", revoked.length === 1 && revoked[0] === "dead");
  ok("sendCreatorWeeklyPushes: the other, alive subscription still received its push", summary.pushed === 1);
}

console.log(`\ncreator-push: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
