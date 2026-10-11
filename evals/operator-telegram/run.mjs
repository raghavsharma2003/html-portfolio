// WS-R98. The operator digest/incident/self-check alert reaching Telegram:
// `api/_operator-telegram.js`'s `operatorTelegramChatIds`,
// `operatorTelegramConfigured`, `sendOperatorTelegram` (over a fake
// Telegram client - `evals/room-telegram-checkins/run.mjs`'s own fake
// fetch shape, restated), and the three real callers
// (`api/_operator-digest.js#sendOperatorDigest`,
// `api/_incidents.js#notifyNewIncidentKinds`,
// `api/_self-check.js#sendSelfCheckTelegramAlert`) each folding exactly one
// new summary field into their own return value. NEGATIVE CONTROLS: a chat
// id not on `OPS_TELEGRAM_CHAT_IDS` is never sent to (proven by construction
// - only listed ids are ever dialed - and directly, by asserting the exact
// set of urls a fake fetch was called with); a body carrying a forbidden
// content name (a Room's slug, among others) fails the content scan and is
// never sent at all, to any chat.
//
//   node evals/operator-telegram/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres, no model call,
// no GPU. No call to Telegram from this file - every fetch is a fake.
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
  operatorTelegramChatIds,
  operatorTelegramConfigured,
  sendOperatorTelegram,
  OPERATOR_TELEGRAM_CONTENT_NAMES,
} = await import(pathToFileURL(join(REPO, "api/_operator-telegram.js")).href);

const TOKEN_ENV = { ROOM_TELEGRAM_BOT_TOKEN: "test-token" };
const PAYLOAD = { title: "Vyakti ops alert", body: "door_5xx: 3 today", url: "/studio?mode=ops" };

// A Telegram sendMessage-shaped fake fetch, `evals/room-telegram-checkins/
// run.mjs`'s own precedent (its own `okFetch`/`badFetch` shapes) restated.
function fakeFetch(byUrl) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const outcome = byUrl(url, calls.length);
    return { ok: outcome.ok !== false, status: outcome.status, json: async () => outcome.json ?? { ok: outcome.status === 200 } };
  };
  fn.calls = calls;
  return fn;
}

// ═════════════════════════════════════════════════════════════════════════
// §1 — operatorTelegramChatIds / operatorTelegramConfigured: pure, no db.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: config, pure functions of env ──");
{
  ok("operatorTelegramChatIds: unset reports empty", operatorTelegramChatIds({}).length === 0);
  ok("operatorTelegramChatIds: a comma list is split/trimmed",
    JSON.stringify(operatorTelegramChatIds({ OPS_TELEGRAM_CHAT_IDS: " 111 , 222 ,,333" })) === JSON.stringify(["111", "222", "333"]));
  ok("operatorTelegramConfigured: token alone, no chat ids, is unconfigured",
    operatorTelegramConfigured(TOKEN_ENV) === false);
  ok("operatorTelegramConfigured: chat ids alone, no token, is unconfigured",
    operatorTelegramConfigured({ OPS_TELEGRAM_CHAT_IDS: "111" }) === false);
  ok("operatorTelegramConfigured: both set is configured",
    operatorTelegramConfigured({ ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111,222" }) === true);
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — sendOperatorTelegram: the real send path, over a fake fetch.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: sendOperatorTelegram, the real path ──");
{
  const fetch = fakeFetch(() => ({ status: 200, json: { ok: true, result: { message_id: 1 } } }));
  const summary = await sendOperatorTelegram(async () => [], PAYLOAD, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111,222,333" },
    fetch,
  });
  ok("sendOperatorTelegram: sends once per configured chat id", summary.sent === 3 && summary.failed === 0);
  ok("sendOperatorTelegram: calls fetch exactly once per chat id, no more, no fewer", fetch.calls.length === 3);
  // NEGATIVE CONTROL: a chat id not on the list is never sent to - proven
  // directly, not only by construction, by inspecting every url/body a real
  // fetch call carried.
  const sentChatIds = fetch.calls.map((c) => c.body.chat_id).sort();
  ok("NEGATIVE CONTROL: only the three listed chat ids were ever dialed, nothing else",
    JSON.stringify(sentChatIds) === JSON.stringify(["111", "222", "333"]));
  ok("sendOperatorTelegram: the message body is title + body + url, one message, three lines",
    fetch.calls[0].body.text === "Vyakti ops alert\n\ndoor_5xx: 3 today\n/studio?mode=ops");
}
{
  // No config at all: sends nothing, never even reaches fetch (no fetch
  // injected here at all - if this reached the fetch-required check it
  // would throw, so a clean return proves the early exit fired).
  const summary = await sendOperatorTelegram(async () => [], PAYLOAD, { env: {} });
  ok("sendOperatorTelegram: unconfigured (no token, no chat ids) sends nothing, no throw", summary.sent === 0 && summary.failed === 0);
}
{
  // `route` fallback - `api/_operator-digest.js#operatorDigestPayload`'s own
  // older field name, WS-R81's own push-sw.js alias restated.
  const fetch = fakeFetch(() => ({ status: 200, json: { ok: true } }));
  await sendOperatorTelegram(async () => [], { title: "t", body: "b", route: "/r" }, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" },
    fetch,
  });
  ok("sendOperatorTelegram: `route` is read as an alias of `url` for the older payload shape",
    fetch.calls[0].body.text === "t\n\nb\n/r");
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — 403/400 recorded as a provider_telegram incident; 429/5xx are not
// (workstream law #1).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: 403/400 recorded, 429/5xx are not, the list is never edited ──");
{
  const fetch = fakeFetch((url, n) => (n === 1 ? { status: 403, json: { ok: false, error_code: 403 } } : { status: 200, json: { ok: true } }));
  const recorded = [];
  const summary = await sendOperatorTelegram(async () => [], PAYLOAD, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "dead,alive" },
    fetch,
    recordIncident: async (db, args) => recorded.push(args),
  });
  ok("sendOperatorTelegram: a 403 counts as failed, the OTHER chat still gets through",
    summary.sent === 1 && summary.failed === 1);
  ok("sendOperatorTelegram: a 403 records exactly one provider_telegram incident, door named operator-telegram, status 403",
    recorded.length === 1 && recorded[0].kind === "provider_telegram" && recorded[0].door === "operator-telegram" && recorded[0].status === 403);
  ok("NEGATIVE CONTROL: OPS_TELEGRAM_CHAT_IDS itself is never edited - both ids are still dialed, `sendOperatorTelegram` holds no state of its own",
    fetch.calls.length === 2);
}
{
  const fetch = fakeFetch(() => ({ status: 400, json: { ok: false, error_code: 400 } }));
  const recorded = [];
  await sendOperatorTelegram(async () => [], PAYLOAD, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" },
    fetch,
    recordIncident: async (db, args) => recorded.push(args),
  });
  ok("sendOperatorTelegram: a 400 (chat no longer exists) is also recorded", recorded.length === 1 && recorded[0].status === 400);
}
{
  const fetch = fakeFetch(() => ({ status: 429, json: { ok: false, error_code: 429, parameters: { retry_after: 5 } } }));
  const recorded = [];
  const summary = await sendOperatorTelegram(async () => [], PAYLOAD, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" },
    fetch,
    recordIncident: async (db, args) => recorded.push(args),
  });
  ok("NEGATIVE CONTROL: a 429 (try again later) counts as failed but records NOTHING - only 403/400 are 'stop trying'",
    summary.failed === 1 && recorded.length === 0);
}
{
  // No recordIncident injected at all - never throws, the default is a
  // silent no-op, `api/_operator-telegram.js`'s own header on why.
  const fetch = fakeFetch(() => ({ status: 403, json: { ok: false } }));
  const err = await threwAsync(() =>
    sendOperatorTelegram(async () => [], PAYLOAD, { env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" }, fetch }));
  ok("sendOperatorTelegram: a 403 with no deps.recordIncident injected never throws", err === null);
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — the content scan: a body carrying a forbidden name fails and the
// WHOLE send is refused, no chat is ever dialed.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: the content scan ──");
{
  ok("OPERATOR_TELEGRAM_CONTENT_NAMES is not vacuously empty", OPERATOR_TELEGRAM_CONTENT_NAMES.length >= 5);
  const fetch = fakeFetch(() => ({ status: 200, json: { ok: true } }));
  const poisoned = { title: "Vyakti ops alert", body: "the Room slug my-room-slug just published", url: "/studio?mode=ops" };
  const summary = await sendOperatorTelegram(async () => [], poisoned, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111,222" },
    fetch,
  });
  ok("NEGATIVE CONTROL: a body carrying a forbidden content name (here, 'slug') fails the scan and sends ZERO messages",
    summary.sent === 0 && summary.failed === 0 && fetch.calls.length === 0);
}
{
  // The scan is not vacuous - a clean payload of the same shape still sends.
  const fetch = fakeFetch(() => ({ status: 200, json: { ok: true } }));
  const summary = await sendOperatorTelegram(async () => [], PAYLOAD, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" },
    fetch,
  });
  ok("the content scan is not vacuous: a clean payload of the same shape still sends", summary.sent === 1);
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — deps.fetch is REQUIRED once configured - "no calls to Telegram from
// any eval" as a loud throw, never a silent real network call.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: deps.fetch is required once configured ──");
{
  const err = await threwAsync(() =>
    sendOperatorTelegram(async () => [], PAYLOAD, { env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" } }));
  ok("sendOperatorTelegram: configured but no deps.fetch throws loudly rather than risking a real network call",
    err?.message === "operator_telegram_send_fetch_required");
}

// ═════════════════════════════════════════════════════════════════════════
// §6 — the three real callers, each folding exactly one summary field
// (workstream law #2: "one summary field per channel").
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: the three callers ──");

const { sendOperatorDigest } = await import(pathToFileURL(join(REPO, "api/_operator-digest.js")).href);
const { notifyNewIncidentKinds, recordIncident: incidentsRecordIncident } = await import(
  pathToFileURL(join(REPO, "api/_incidents.js")).href
);
const { runSelfCheck, sendSelfCheckTelegramAlert } = await import(pathToFileURL(join(REPO, "api/_self-check.js")).href);

{
  // (a) sendOperatorDigest: Telegram alone (no VAPID at all) still claims
  // the ledger and sends - workstream's own "an operator with no push
  // subscription still gets the same digest" restated for "no push AT ALL".
  const state = { rows: [] };
  const digestDb = async (sql, params = []) => {
    if (sql.includes("insert into vy_operator_digest")) {
      const [digestId, day, counts] = params;
      if (state.rows.some((r) => r.day === day)) return [];
      state.rows.push({ digest_id: digestId, day, counts: JSON.parse(counts) });
      return [{ digest_id: digestId }];
    }
    throw new Error(`unmatched SQL: ${sql}`);
  };
  const OVERVIEW = {
    rooms: [{ published: true, joined_last_7d: 6, messages_last_24h: 10, revenue_this_month_inr: 0 }],
    self_check: { checked: 1, passed: 1, failed: 0, last_outcome: "ok" },
    incidents: { by_kind_door: [], new_kinds: [] },
  };
  let telegramSent = null;
  const summary = await sendOperatorDigest(digestDb, {
    now: Date.parse("2026-09-10T03:15:00.000Z"),
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111,222" }, // no VAPID at all
    opsOverviewFn: async () => OVERVIEW,
    sendTelegram: async (db, payload) => { telegramSent = payload; return { sent: 2, failed: 0 }; },
  });
  ok("sendOperatorDigest: Telegram alone (no VAPID) still claims the ledger row", summary.sent_ledger === 1 && state.rows.length === 1);
  ok("sendOperatorDigest: pushed stays 0 (push was never configured), telegramSent carries the real count",
    summary.pushed === 0 && summary.telegramSent === 2);
  ok("sendOperatorDigest: the SAME payload shape (title/body/kind/route) reaches the Telegram sender",
    telegramSent?.kind === "operatorDigest" && typeof telegramSent?.body === "string");
}
{
  // NEGATIVE CONTROL: neither channel configured still claims nothing - the
  // widened claim gate is "either channel", never "always".
  const state = { rows: [] };
  const digestDb = async (sql, params = []) => {
    if (sql.includes("insert into vy_operator_digest")) {
      if (state.rows.some((r) => r.day === params[1])) return [];
      state.rows.push({ digest_id: params[0], day: params[1] });
      return [{ digest_id: params[0] }];
    }
    throw new Error(`unmatched SQL: ${sql}`);
  };
  const summary = await sendOperatorDigest(digestDb, {
    now: Date.parse("2026-09-10T03:15:00.000Z"),
    env: {},
    opsOverviewFn: async () => ({ rooms: [], self_check: {}, incidents: {} }),
  });
  ok("NEGATIVE CONTROL: sendOperatorDigest with NEITHER channel configured claims nothing, sends nothing",
    summary.sent_ledger === 0 && summary.pushed === 0 && summary.telegramSent === 0 && state.rows.length === 0);
}
{
  // (b) notifyNewIncidentKinds: Telegram alone (no VAPID) still claims and
  // sends - the identical widening, one file over.
  const state = { today: "2026-09-04", rows: [] };
  const incDb = async (sql, params = []) => {
    if (sql.includes("insert into vy_incident")) {
      const [incidentId, kind, door, status] = params;
      state.rows.push({ incident_id: incidentId, day: state.today, kind, door, status, count: 1, notified_at: null });
      return [];
    }
    if (sql.includes("update vy_incident") && sql.includes("set notified_at = now()")) {
      const [kind] = params;
      const candidate = state.rows.find((r) => r.day === state.today && r.kind === kind && !r.notified_at);
      if (!candidate) return [];
      candidate.notified_at = "claimed";
      return [{ incident_id: candidate.incident_id }];
    }
    if (sql.includes("select distinct kind from vy_incident where day = current_date")) {
      return [...new Set(state.rows.filter((r) => r.day === state.today).map((r) => r.kind))].map((kind) => ({ kind }));
    }
    if (sql.includes("select coalesce(sum(count), 0)::int as n from vy_incident where day = current_date")) {
      const [kind] = params;
      return [{ n: state.rows.filter((r) => r.day === state.today && r.kind === kind).length }];
    }
    throw new Error(`unmatched SQL: ${sql}`);
  };
  await incidentsRecordIncident(incDb, { kind: "provider_whatsapp", door: "_room-whatsapp.js", status: 500 });
  let telegramCalls = 0;
  const result = await notifyNewIncidentKinds(incDb, {
    env: { ...TOKEN_ENV, OPS_TELEGRAM_CHAT_IDS: "111" }, // no VAPID, no OPS_OWNER_USER_IDS
    sendTelegram: async () => { telegramCalls++; return { sent: 1, failed: 0 }; },
  });
  ok("notifyNewIncidentKinds: Telegram alone (no VAPID, no operator allowlist) still claims and sends",
    result.claimed === 1 && result.pushed === 0 && result.telegramSent === 1 && telegramCalls === 1);
}
{
  // (c) sendSelfCheckTelegramAlert: fires only on the failure path.
  const env = { OPENROUTER_KEY: "x", NEON_URL: "y" };
  const worldDb = async (sql) => {
    if (sql === "select 1") return [{ "?column?": 1 }];
    if (sql.includes("from information_schema.tables")) return [];
    if (sql.includes("from information_schema.columns")) return [];
    if (sql.includes("distinct on (sweep)")) return [];
    throw new Error(`unmatched: ${sql}`);
  };
  const failingResult = await runSelfCheck({ db: worldDb, env, now: Date.parse("2026-09-10T02:30:00Z"), sweepSchedulesFn: () => ({}) });
  ok("fixture sanity: this world genuinely fails self-check (missing migration tables)", failingResult.ok === false);

  let telegramPayload = null;
  const outcome = await sendSelfCheckTelegramAlert(async () => [], failingResult, {
    env: { OPS_TELEGRAM_CHAT_IDS: "111" },
    sendTelegram: async (db, payload) => { telegramPayload = payload; return { sent: 1, failed: 0 }; },
  });
  ok("sendSelfCheckTelegramAlert: a failing self-check sends exactly one Telegram alert", outcome.telegramSent === 1);
  ok("sendSelfCheckTelegramAlert: the body carries only checked/failed COUNTS, never a failing door's own name",
    typeof telegramPayload?.body === "string" &&
    failingResult.failing_doors.every((door) => !telegramPayload.body.includes(door)));

  const healthyOutcome = await sendSelfCheckTelegramAlert(async () => [], { ok: true, checked: 5, failed: 0 }, {
    env: { OPS_TELEGRAM_CHAT_IDS: "111" },
    sendTelegram: async () => { throw new Error("must never be called on a healthy result"); },
  });
  ok("NEGATIVE CONTROL: a healthy self-check (result.ok === true) sends NOTHING, never reaches the sender at all",
    healthyOutcome.telegramSent === 0);
}

console.log(`\noperator-telegram: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
