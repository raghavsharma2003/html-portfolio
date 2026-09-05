// WS-R88 (migration 125). The operator's morning digest:
// `api/_operator-digest.js` (config, the pure counts reduction, the payload
// builder, the send sweep, the test-send op, the board's own read), driven
// through a small dedicated fake `vy_operator_digest` table and a canned
// `opsOverview()`-shaped fixture rather than the full Room/Pulse world
// `evals/ops/run.mjs` already builds — this file's own boundary (that
// suite's own §5c2 header states the reverse boundary: it proves the
// PLUMBING that wires `lastOperatorDigest` into `opsOverview`, never the
// send/claim logic tested here).
//
//   node evals/operator-digest/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres, no model call,
// no GPU.
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
const threwAsync = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};

const {
  operatorDigestConfig,
  digestCounts,
  operatorDigestPayload,
  sendOperatorDigest,
  sendTestOperatorDigest,
  lastOperatorDigest,
  OPERATOR_DIGEST_CONTENT_NAMES,
} = await import(pathToFileURL(join(REPO, "api/_operator-digest.js")).href);

const OWNER = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const ENV = {
  OPS_OWNER_USER_IDS: OWNER,
  ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:x@example.test",
};
const SUB = {
  endpoint: "https://push.example.test/operator-digest-1",
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

// ═════════════════════════════════════════════════════════════════════════
// §1 — operatorDigestConfig: pure function of env, no db. No new env var
// (workstream law: "no new env vars") — the SAME ROOM_PUSH_VAPID_* triple
// api/_ops.js#operatorPushConfig and api/_creator-push.js#creatorPushConfig
// already read.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: operatorDigestConfig ──");
{
  ok("operatorDigestConfig: unset VAPID reports honestly unconfigured, no public key",
    operatorDigestConfig({}).configured === false && operatorDigestConfig({}).vapid_public === null);
  const configured = operatorDigestConfig(ENV);
  ok("operatorDigestConfig: all three set reports configured, WITH the public key",
    configured.configured === true && configured.vapid_public === "pub");
  ok("operatorDigestConfig: the PRIVATE key never appears on the returned shape",
    !("vapid_private" in configured) && !JSON.stringify(configured).includes("priv"));
  const src = fs.readFileSync(join(REPO, "api/_operator-digest.js"), "utf8");
  ok("no new env var: this file reads only ROOM_PUSH_VAPID_PUBLIC/PRIVATE/SUBJECT, OPS_OWNER_USER_IDS and CRON_SECRET (the last read only by the cron door, not this file)",
    src.includes("ROOM_PUSH_VAPID_PUBLIC") && src.includes("ROOM_PUSH_VAPID_PRIVATE") && src.includes("ROOM_PUSH_VAPID_SUBJECT") && src.includes("OPS_OWNER_USER_IDS")
      && !/[A-Z_]+_PUSH_VAPID_(?!PUBLIC|PRIVATE|SUBJECT)/.test(src) && !src.includes("CRON_SECRET"));
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — digestCounts: pure reduction of an opsOverview()-shaped object. THE
// n>=5 FOLLOWER FLOOR (workstream law 2, verbatim: "one follower joined one
// Room is fewer than 5") is decided HERE, before the payload builder ever
// runs.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: digestCounts ──");
function overviewWith(rooms, selfCheck, incidents) {
  return {
    rooms,
    self_check: selfCheck ?? { checked: 0, passed: 0, failed: 0, last_outcome: "never_ran" },
    incidents: incidents ?? { by_kind_door: [], new_kinds: [] },
  };
}
{
  const c = digestCounts(overviewWith([]));
  ok("digestCounts: an empty overview reports real zeros, never omitted fields",
    c.rooms_published === 0 && c.followers_joined_7d === 0 && c.messages_last_24h === 0 && c.revenue_this_month_inr === 0);
  ok("digestCounts: zero followers platform-wide is BELOW the floor", c.followers_joined_below_floor === true);
  ok("digestCounts: no self-check has run reports self_check_ran = false", c.self_check_ran === false);
}
{
  const rooms = [
    { published: true, joined_last_7d: 2, messages_last_24h: 10, revenue_this_month_inr: 500, slug: "should-never-be-read", display_name: "should-never-be-read" },
    { published: true, joined_last_7d: 2, messages_last_24h: 5, revenue_this_month_inr: 0, slug: "also-never", display_name: "also-never" },
    { published: false, joined_last_7d: 9, messages_last_24h: 0, revenue_this_month_inr: 0, slug: "unpub", display_name: "unpub" },
  ];
  const c = digestCounts(overviewWith(rooms, { checked: 12, passed: 10, failed: 2, last_outcome: "partial" }, { by_kind_door: [{ kind: "door_5xx", door: "room.js", count: 3 }], new_kinds: ["door_5xx"] }));
  ok("digestCounts: rooms_published counts only PUBLISHED rooms", c.rooms_published === 2);
  ok("digestCounts: followers_joined_7d sums joined_last_7d across EVERY room (published or not)", c.followers_joined_7d === 2 + 2 + 9);
  ok("digestCounts: 13 followers platform-wide clears the floor", c.followers_joined_below_floor === false);
  ok("digestCounts: messages_last_24h sums across every room", c.messages_last_24h === 15);
  ok("digestCounts: revenue_this_month_inr sums across every room", c.revenue_this_month_inr === 500);
  ok("digestCounts: self_check_checked/failed come from overview.self_check, as plain numbers", c.self_check_checked === 12 && c.self_check_failed === 2);
  ok("digestCounts: self_check_ran is true once last_outcome is not never_ran", c.self_check_ran === true);
  ok("digestCounts: incidents_today sums the by_kind_door counts", c.incidents_today === 3);
  ok("digestCounts: incidents_new_kinds is the length of new_kinds", c.incidents_new_kinds === 1);
}
{
  // Exactly at the floor: 5 clears it, never below.
  const rooms = [{ published: true, joined_last_7d: 5, messages_last_24h: 0, revenue_this_month_inr: 0 }];
  const c = digestCounts(overviewWith(rooms));
  ok("digestCounts: exactly 5 followers platform-wide is NOT below the floor (n>=5, not n>5)", c.followers_joined_below_floor === false);
}
{
  // NEGATIVE CONTROL (a): digestCounts' own source never reads a Room's
  // slug or display name — proven by static scan of the function body, the
  // same technique creatorWeeklyPushPayload's own §3 uses one file over.
  const src = fs.readFileSync(join(REPO, "api/_operator-digest.js"), "utf8");
  const fnMatch = src.match(/export function digestCounts\([\s\S]*?\n}\n/);
  ok("digestCounts is found in api/_operator-digest.js (not moved/renamed)", Boolean(fnMatch));
  const body = fnMatch ? fnMatch[0] : "";
  ok("NEGATIVE CONTROL (a): digestCounts' own source never reads .slug or .display_name off a room",
    !body.includes(".slug") && !body.includes(".display_name"));
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — operatorDigestPayload: pure, WS-R22 "parameter list is the
// enforcement" shape, under 200 characters (workstream law 2).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: operatorDigestPayload ──");
{
  const counts = {
    rooms_published: 3, followers_joined_7d: 12, followers_joined_below_floor: false,
    messages_last_24h: 240, revenue_this_month_inr: 4500,
    self_check_checked: 12, self_check_failed: 0, self_check_ran: true,
    incidents_today: 0, incidents_new_kinds: 0,
  };
  const p = operatorDigestPayload(counts);
  ok("operatorDigestPayload: shape matches push-sw.js's own {title, body, kind, route} contract",
    typeof p.title === "string" && typeof p.body === "string" && p.kind === "operatorDigest" && p.route === "/studio?mode=ops");
  ok("operatorDigestPayload: body under 200 characters (workstream law 2)", p.body.length <= 200);
  ok("operatorDigestPayload: body names the real counts", p.body.includes("3 Room") && p.body.includes("12 follower") && p.body.includes("240 message"));
  ok("operatorDigestPayload: a clean self-check reads N/N passing", p.body.includes("12/12 passing"));
  ok("operatorDigestPayload: zero incidents reports honestly", p.body.includes("no incidents today"));
}
{
  const belowFloor = {
    rooms_published: 1, followers_joined_7d: 2, followers_joined_below_floor: true,
    messages_last_24h: 3, revenue_this_month_inr: 0,
    self_check_checked: 5, self_check_failed: 5, self_check_ran: true,
    incidents_today: 4, incidents_new_kinds: 2,
  };
  const p = operatorDigestPayload(belowFloor);
  ok("NEGATIVE CONTROL (b): a follower count under 5 NEVER appears as an exact number — the floored sentence is used instead",
    p.body.includes("fewer than 5 followers joined") && !p.body.includes("2 follower"));
  ok("operatorDigestPayload: a failing self-check reads N/M failing", p.body.includes("5/5 failing"));
  ok("operatorDigestPayload: new incident kinds are named as a count", p.body.includes("2 new"));
}
{
  const neverRan = { rooms_published: 0, followers_joined_7d: 0, followers_joined_below_floor: true, messages_last_24h: 0, revenue_this_month_inr: 0, self_check_checked: 0, self_check_failed: 0, self_check_ran: false, incidents_today: 0, incidents_new_kinds: 0 };
  const p = operatorDigestPayload(neverRan);
  ok("operatorDigestPayload: a self-check that has never run says so honestly, never a fabricated 0/0 passing", p.body.includes("self-check has not run yet"));
}
{
  // NEGATIVE CONTROL (c): a static scan of the function's own source proves
  // it names none of this repo's follower/Room-content columns — the
  // WS-R22 shape, `evals/creator-push/run.mjs`'s own §3 restated a third
  // time.
  ok("OPERATOR_DIGEST_CONTENT_NAMES is not vacuously empty", OPERATOR_DIGEST_CONTENT_NAMES.length >= 5);
  const src = fs.readFileSync(join(REPO, "api/_operator-digest.js"), "utf8");
  const fnMatch = src.match(/export function operatorDigestPayload\([\s\S]*?\n}\n/);
  ok("operatorDigestPayload is found in api/_operator-digest.js (not moved/renamed)", Boolean(fnMatch));
  const body = fnMatch ? fnMatch[0] : "";
  const hits = OPERATOR_DIGEST_CONTENT_NAMES.filter((n) => body.includes(n));
  ok("NEGATIVE CONTROL (c): operatorDigestPayload's own source names none of this repo's follower/Room-content columns",
    hits.length === 0, hits.join(","));
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — sendOperatorDigest: the sweep's own claim, over a small dedicated
// fake vy_operator_digest table (no room, no follower, no replica — this
// table has nothing fixtures.mjs already models, `evals/creator-push/
// run.mjs`'s own §2 header names the identical reason for growing a tiny
// fixture here instead).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: sendOperatorDigest ──");
function freshDigestState() {
  return { rows: [] };
}
function digestDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("insert into vy_operator_digest")) {
      const [digestId, day, counts] = params;
      if (state.rows.some((r) => r.day === day)) return []; // ON CONFLICT (day) DO NOTHING
      state.rows.push({ digest_id: digestId, day, sent_at: new Date().toISOString(), counts: JSON.parse(counts) });
      return [{ digest_id: digestId }];
    }
    throw new Error(`§4 fake db: unmatched SQL: ${sql}`);
  };
}
const OVERVIEW = overviewWith(
  [{ published: true, joined_last_7d: 6, messages_last_24h: 40, revenue_this_month_inr: 1000 }],
  { checked: 10, passed: 10, failed: 0, last_outcome: "ok" },
  { by_kind_door: [], new_kinds: [] },
);
const NOW = Date.parse("2026-09-10T03:15:00.000Z");

// (a) unset VAPID: nothing runs, no ledger row attempted, honestly.
{
  const state = freshDigestState();
  const db = digestDb(state);
  const summary = await sendOperatorDigest(db, { now: NOW, env: { OPS_OWNER_USER_IDS: OWNER }, opsOverviewFn: async () => OVERVIEW });
  ok("sendOperatorDigest: unset VAPID sends nothing and claims no ledger row (honest, never a fake send)",
    summary.sent_ledger === 0 && summary.pushed === 0 && state.rows.length === 0);
}
// (a2) VAPID configured but no operator on the allowlist: same honest no-op.
{
  const state = freshDigestState();
  const db = digestDb(state);
  const summary = await sendOperatorDigest(db, { now: NOW, env: { ...ENV, OPS_OWNER_USER_IDS: "" }, opsOverviewFn: async () => OVERVIEW });
  ok("sendOperatorDigest: an empty operator allowlist sends nothing and claims no ledger row",
    summary.sent_ledger === 0 && summary.pushed === 0 && state.rows.length === 0);
}
// (b) the real path.
{
  const state = freshDigestState();
  const db = digestDb(state);
  const sent = [];
  const summary = await sendOperatorDigest(db, {
    now: NOW, env: ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async (d, ownerId) => (ownerId === OWNER ? [{ id: "sub-1", ...SUB }] : []),
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
  });
  ok("sendOperatorDigest: the real sweep claims exactly one ledger row and sends one push (the fixture is sound)",
    summary.sent_ledger === 1 && summary.pushed === 1 && sent.length === 1 && state.rows.length === 1);
  ok("sendOperatorDigest: the claimed row's day matches NOW's own UTC calendar day", state.rows[0].day === "2026-09-10");
  ok("sendOperatorDigest: the ledger row's own counts are the sanitized digest — numbers/booleans only",
    Object.values(state.rows[0].counts).every((v) => typeof v === "number" || typeof v === "boolean"));

  // NEGATIVE CONTROL: a second sweep tick, SAME day, sends nothing more —
  // the ledger's own unique `day` index, not a JS guard, refuses the resend.
  const summary2 = await sendOperatorDigest(db, {
    now: NOW + 3_600_000, env: ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async () => [{ id: "sub-1", ...SUB }],
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
  });
  ok("NEGATIVE CONTROL: a second sweep tick the SAME day sends ZERO further pushes, refused by the ledger's own unique day WHERE",
    summary2.sent_ledger === 0 && summary2.pushed === 0 && sent.length === 1 && state.rows.length === 1);

  // The NEXT day claims cleanly — this is not a permanent lock.
  const summary3 = await sendOperatorDigest(db, {
    now: NOW + 24 * 3_600_000, env: ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async () => [{ id: "sub-1", ...SUB }],
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
  });
  ok("sendOperatorDigest: the NEXT day's digest sends cleanly", summary3.sent_ledger === 1 && summary3.pushed === 1 && state.rows.length === 2);
}
// (c) a 404 from the push service revokes that ONE subscription and never
// touches another.
{
  const state = freshDigestState();
  const db = digestDb(state);
  const revoked = [];
  const summary = await sendOperatorDigest(db, {
    now: NOW, env: ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async () => [
      { id: "dead", endpoint: "https://push.example.test/dead", p256dh: SUB.p256dh, auth: SUB.auth },
      { id: "alive", endpoint: "https://push.example.test/alive", p256dh: SUB.p256dh, auth: SUB.auth },
    ],
    sendPush: async (sub) => (sub.id === "dead" ? { ok: false, status: 404 } : { ok: true, status: 201 }),
    revokeOperatorSubscription: async (d, id) => revoked.push(id),
  });
  ok("sendOperatorDigest: a 404 revokes ONLY the dead subscription", revoked.length === 1 && revoked[0] === "dead");
  ok("sendOperatorDigest: the other, alive subscription still received its push", summary.pushed === 1);
}
// (d) missing deps.opsOverviewFn throws loudly rather than silently no-op-ing.
{
  const state = freshDigestState();
  const db = digestDb(state);
  const err = await threwAsync(() => sendOperatorDigest(db, { now: NOW, env: ENV }));
  ok("sendOperatorDigest: a missing opsOverviewFn throws loudly (never a silent no-op)", err?.message === "operator_digest_overview_required");
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — sendTestOperatorDigest: law 4's own scope. Sends to the CALLER's own
// subscription only, marks the title as a test, and writes NO ledger row.
// The class-e allowlist attack itself is exercised in
// evals/room-doors/run.mjs's own §17d, over the identical function — this
// section proves the OTHER half of law 4: the ledger stays untouched and
// the title carries the "TEST" marker.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: sendTestOperatorDigest ──");
{
  const state = freshDigestState();
  // Seed a REAL digest already sent today, so a bug that claimed the ledger
  // on the test path would be visible as a second row.
  state.rows.push({ digest_id: "real-1", day: "2026-09-10", sent_at: NOW, counts: {} });
  const db = digestDb(state);
  const sent = [];
  const summary = await sendTestOperatorDigest(db, OWNER, {
    now: NOW, env: ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async (d, ownerId) => (ownerId === OWNER ? [{ id: "sub-1", ...SUB }] : []),
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
  });
  ok("sendTestOperatorDigest: sends exactly one push to the real operator's own subscription", summary.pushed === 1 && sent.length === 1);
  ok("NEGATIVE CONTROL: sendTestOperatorDigest writes NO ledger row — the real digest's own row is the ONLY row still present",
    state.rows.length === 1 && state.rows[0].digest_id === "real-1");
  const payload = JSON.parse(sent[0].payload);
  ok("sendTestOperatorDigest: the payload title is marked as a test", payload.title.startsWith("TEST"));
  ok("sendTestOperatorDigest: the payload otherwise carries the SAME shape as the real digest", payload.kind === "operatorDigest" && payload.route === "/studio?mode=ops");
}
{
  // NEGATIVE CONTROL: unconfigured VAPID sends nothing, even to a real operator.
  const state = freshDigestState();
  const db = digestDb(state);
  const summary = await sendTestOperatorDigest(db, OWNER, { now: NOW, env: {}, opsOverviewFn: async () => OVERVIEW });
  ok("sendTestOperatorDigest: unset VAPID sends nothing, honestly", summary.pushed === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// §6 — lastOperatorDigest: the board's own read, pure and small.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: lastOperatorDigest ──");
{
  const noRows = await lastOperatorDigest(async () => []);
  ok("lastOperatorDigest: no row ever sent reports an honest null", noRows.sent_at === null);
  const withRow = await lastOperatorDigest(async () => [{ sent_at: "2026-09-10T03:15:00.000Z" }]);
  ok("lastOperatorDigest: a real row's sent_at surfaces unchanged", withRow.sent_at === "2026-09-10T03:15:00.000Z");
  const notADb = await lastOperatorDigest(null);
  ok("lastOperatorDigest: a non-function db reports the same honest null, never a throw", notADb.sent_at === null);
}

// ═════════════════════════════════════════════════════════════════════════
// §7 — WS-R98: the digest's own Telegram fallback, beside the push, on the
// SAME `sendOperatorDigest` and the SAME §4 fixtures.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: the Telegram fallback (WS-R98) ──");
const TELEGRAM_ENV = { ...ENV, ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111,222" };
{
  // (a) both channels configured: both fire, each folding its OWN summary
  // field (workstream law #2).
  const state = freshDigestState();
  const db = digestDb(state);
  const pushSent = [];
  let telegramCalls = 0;
  const summary = await sendOperatorDigest(db, {
    now: NOW, env: TELEGRAM_ENV, opsOverviewFn: async () => OVERVIEW,
    operatorSubscriptionsFor: async () => [{ id: "sub-1", ...SUB }],
    sendPush: async (sub, payload) => { pushSent.push(payload); return { ok: true, status: 201 }; },
    sendTelegram: async () => { telegramCalls++; return { sent: 2, failed: 0 }; },
  });
  ok("sendOperatorDigest: both channels configured fire both, each its own summary field",
    summary.pushed === 1 && summary.telegramSent === 2 && pushSent.length === 1 && telegramCalls === 1);
}
{
  // (b) Telegram alone (no VAPID at all): still claims the ledger and sends
  // - the widened claim, `context/decisions.md
  // #ws-r98-notify-claim-widened-to-either-channel`.
  const state = freshDigestState();
  const db = digestDb(state);
  let telegramPayload = null;
  const summary = await sendOperatorDigest(db, {
    now: NOW, env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111" }, // no VAPID, no OPS_OWNER_USER_IDS
    opsOverviewFn: async () => OVERVIEW,
    sendTelegram: async (d, payload) => { telegramPayload = payload; return { sent: 1, failed: 0 }; },
  });
  ok("sendOperatorDigest: Telegram alone claims the ledger row (widened from push-only)",
    summary.sent_ledger === 1 && state.rows.length === 1);
  ok("sendOperatorDigest: pushed stays honestly 0 (push was never configured), telegramSent carries the real send",
    summary.pushed === 0 && summary.telegramSent === 1);
  ok("sendOperatorDigest: the Telegram sender receives the SAME operatorDigestPayload shape the push channel would have",
    telegramPayload?.kind === "operatorDigest" && telegramPayload?.route === "/studio?mode=ops");
}
{
  // NEGATIVE CONTROL: neither channel configured still claims nothing -
  // unchanged from §4(a), restated with the Telegram env vars present but
  // incomplete (token only, no chat ids - still unconfigured).
  const state = freshDigestState();
  const db = digestDb(state);
  const summary = await sendOperatorDigest(db, {
    now: NOW, env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token" }, opsOverviewFn: async () => OVERVIEW,
  });
  ok("NEGATIVE CONTROL: a bot token with no OPS_TELEGRAM_CHAT_IDS is still unconfigured - claims and sends nothing",
    summary.sent_ledger === 0 && summary.pushed === 0 && summary.telegramSent === 0 && state.rows.length === 0);
}

console.log(`\noperator-digest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
