// WS-R58. The incident ledger's offline suite: `api/_incidents.js`'s
// `recordIncident`, `withDoor`, `claimNewKindNotification`,
// `notifyNewIncidentKinds`, `pruneOldIncidents`, plus the static scan that
// keeps a future edit from turning this table's INSERT into a place a
// message string could hide.
//
//   node evals/incidents/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres. The fake `db`
// below is a small self-contained `vy_incident` table (day/kind/door/
// status/count/notified_at) rather than a slice of `evals/room/fixtures.mjs`
// — this table has no follower, no room, no replica, nothing that fixture
// already knows about, and reusing it here would be importing weight this
// suite does not need (`dead-writers`'s own "two fakes for the same shape"
// risk runs the other way too: a fixture pulled in for one field it does
// not use is a fixture nobody notices drifting for that field).
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

const {
  recordIncident,
  withDoor,
  claimNewKindNotification,
  notifyNewIncidentKinds,
  pruneOldIncidents,
  INCIDENT_KINDS,
  INCIDENT_RETENTION_DAYS,
} = await import(pathToFileURL(join(REPO, "api/_incidents.js")).href);

// ═════════════════════════════════════════════════════════════════════════
// THE FAKE `vy_incident` TABLE — one file's worth of SQL shapes, matched by
// substring exactly the way every other fake `db` in this repo already does
// (`evals/ops/run.mjs`'s own `opsDb`, one file over).
// ═════════════════════════════════════════════════════════════════════════

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function freshState(today = "2026-09-04") {
  return { today, rows: [], nextId: 1 };
}

function fakeDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    if (has("insert into vy_incident")) {
      const [incidentId, kind, door, status] = params;
      const existing = state.rows.find(
        (r) => r.day === state.today && r.kind === kind && r.door === door && r.status === status,
      );
      if (existing) {
        existing.count += 1;
      } else {
        state.rows.push({
          incident_id: incidentId,
          day: state.today,
          kind,
          door,
          status,
          count: 1,
          notified_at: null,
        });
      }
      return [];
    }

    if (has("update vy_incident") && has("set notified_at = now()")) {
      const [kind] = params;
      const todays = state.rows
        .filter((r) => r.day === state.today && r.kind === kind)
        .sort((a, b) => (a.door === b.door ? a.status - b.status : a.door.localeCompare(b.door)));
      const candidate = todays[0];
      const alreadyNotifiedToday = todays.some((r) => r.notified_at);
      const priorFloor = addDays(state.today, -7);
      const seenInPriorWeek = state.rows.some(
        (r) => r.kind === kind && r.day >= priorFloor && r.day < state.today,
      );
      if (!candidate || alreadyNotifiedToday || seenInPriorWeek) return [];
      candidate.notified_at = "claimed";
      return [{ incident_id: candidate.incident_id }];
    }

    if (has("select distinct kind from vy_incident where day = current_date")) {
      const kinds = [...new Set(state.rows.filter((r) => r.day === state.today).map((r) => r.kind))];
      return kinds.map((kind) => ({ kind }));
    }

    // WS-R62: the push payload's own count read — today's total for one
    // kind, across every door and status.
    if (has("select coalesce(sum(count), 0)::int as n from vy_incident where day = current_date")) {
      const [kind] = params;
      const n = state.rows
        .filter((r) => r.day === state.today && r.kind === kind)
        .reduce((sum, r) => sum + Number(r.count || 0), 0);
      return [{ n }];
    }

    if (has("delete from vy_incident where day <")) {
      const [retentionDays] = params;
      const cutoff = addDays(state.today, -Number(retentionDays));
      const deleted = state.rows.filter((r) => r.day < cutoff);
      state.rows = state.rows.filter((r) => r.day >= cutoff);
      return deleted.map((r) => ({ incident_id: r.incident_id }));
    }

    throw new Error(`fakeDb: unhandled SQL: ${sql.slice(0, 120)}`);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// recordIncident — the one write, and its negative controls
// ═════════════════════════════════════════════════════════════════════════

{
  const state = freshState();
  const db = fakeDb(state);

  const r1 = await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 });
  ok("recordIncident: a valid write reports ok", r1.ok === true);
  ok("recordIncident: one row exists after the first write", state.rows.length === 1);
  ok("recordIncident: the row's own count starts at 1", state.rows[0].count === 1);

  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 });
  ok("recordIncident: a SECOND identical (day,kind,door,status) upserts, never a second row",
    state.rows.length === 1 && state.rows[0].count === 2);

  await recordIncident(db, { kind: "door_5xx", door: "payments.js", status: 500 });
  ok("recordIncident: a different door is a DIFFERENT row", state.rows.length === 2);

  // NEGATIVE CONTROLS — an invalid input writes nothing at all.
  const before = state.rows.length;
  const badKind = await recordIncident(db, { kind: "totally_made_up", door: "room.js", status: 500 });
  ok("NEGATIVE CONTROL: an unrecognised kind is refused, not written", badKind.ok === false && state.rows.length === before);

  const badDoor = await recordIncident(db, { kind: "door_5xx", door: "", status: 500 });
  ok("NEGATIVE CONTROL: an empty door is refused, not written", badDoor.ok === false && state.rows.length === before);

  const badStatus = await recordIncident(db, { kind: "door_5xx", door: "room.js", status: -1 });
  ok("NEGATIVE CONTROL: an out-of-range status is refused, not written", badStatus.ok === false && state.rows.length === before);

  const badStatus2 = await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 1.5 });
  ok("NEGATIVE CONTROL: a non-integer status is refused, not written", badStatus2.ok === false && state.rows.length === before);

  // recordIncident must never throw, even with a db that always throws.
  const throwingDb = async () => { throw new Error("boom"); };
  let threw = false;
  try {
    await recordIncident(throwingDb, { kind: "door_5xx", door: "room.js", status: 500 });
  } catch { threw = true; }
  ok("recordIncident never throws, even when the db write itself throws", !threw);
}

// ═════════════════════════════════════════════════════════════════════════
// withDoor — a fake `res`, the door's own catch-all shape reproduced
// ═════════════════════════════════════════════════════════════════════════

function fakeRes() {
  const calls = { statusCodes: [], jsonBodies: [] };
  const res = {
    _calls: calls,
    status(code) {
      calls.statusCodes.push(code);
      return res;
    },
    json(body) {
      calls.jsonBodies.push(body);
      return res;
    },
    end() { return res; },
    setHeader() { return res; },
  };
  return res;
}

{
  const state = freshState();
  const db = fakeDb(state);

  // A door whose OWN catch-all does exactly what every real door here does:
  // console.error, then res.status(500).json({error: "<door>_failure"}).
  async function throwingDoor(req, res) {
    try {
      throw new Error("unexpected");
    } catch (error) {
      return res.status(500).json({ error: "test_door_failure" });
    }
  }
  const wrapped = withDoor(db, "test-door.js", throwingDoor);
  const res1 = fakeRes();
  await wrapped({}, res1);
  ok("withDoor: a thrown door still answers 500 with the SAME body as before",
    res1._calls.statusCodes[res1._calls.statusCodes.length - 1] === 500 &&
    JSON.stringify(res1._calls.jsonBodies[0]) === JSON.stringify({ error: "test_door_failure" }));
  // The write is fire-and-forget inside withDoor's own `finally` — give the
  // microtask queue one tick to let it land before asserting on it.
  await new Promise((r) => setTimeout(r, 0));
  ok("withDoor: exactly one incident row was recorded for the thrown door",
    state.rows.length === 1 && state.rows[0].kind === "door_5xx" && state.rows[0].door === "test-door.js" && state.rows[0].status === 500);

  // A door that succeeds writes nothing.
  async function okDoor(req, res) { return res.status(200).json({ ok: true }); }
  const wrappedOk = withDoor(db, "test-door.js", okDoor);
  const res2 = fakeRes();
  await wrappedOk({}, res2);
  await new Promise((r) => setTimeout(r, 0));
  ok("withDoor: a 200 door records nothing", state.rows.length === 1);

  // A door that MASKS an internal failure as 200 (tg.js/whatsapp.js's own
  // shape) also records nothing — the wrapper is a pure observer of the
  // status actually sent, never a second opinion on what it should be.
  async function maskingDoor(req, res) {
    try {
      throw new Error("telegram will retry forever on a real 5xx");
    } catch {
      return res.status(200).json({ ok: true, handled: false });
    }
  }
  const wrappedMasking = withDoor(db, "tg.js", maskingDoor);
  const res3 = fakeRes();
  await wrappedMasking({}, res3);
  await new Promise((r) => setTimeout(r, 0));
  ok("withDoor: a door that masks failure as 200 (tg.js/whatsapp.js's own shape) records nothing",
    state.rows.length === 1);

  // A 503 (a known custom error mapped to a real status, e.g. room_voice_
  // not_configured) is still >=500 and gets recorded.
  async function serviceUnavailableDoor(req, res) { return res.status(503).json({ error: "not_configured" }); }
  const wrapped503 = withDoor(db, "room.js", serviceUnavailableDoor);
  const res4 = fakeRes();
  await wrapped503({}, res4);
  await new Promise((r) => setTimeout(r, 0));
  ok("withDoor: a 503 (not only a bare 500) is recorded too",
    state.rows.some((r) => r.door === "room.js" && r.status === 503));

  // A 4xx (an ordinary refusal, never an incident) records nothing.
  async function refusalDoor(req, res) { return res.status(429).json({ error: "slow_down" }); }
  const wrapped429 = withDoor(db, "room.js", refusalDoor);
  const res5 = fakeRes();
  const before = state.rows.length;
  await wrapped429({}, res5);
  await new Promise((r) => setTimeout(r, 0));
  ok("NEGATIVE CONTROL: withDoor never records a 4xx", state.rows.length === before);
}

// ═════════════════════════════════════════════════════════════════════════
// claimNewKindNotification / notifyNewIncidentKinds — at most once per kind
// per day, and only for a kind genuinely new against the previous 7 days
// ═════════════════════════════════════════════════════════════════════════

{
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "provider_telegram", door: "_checkins.js", status: 502 });

  const claim1 = await claimNewKindNotification(db, "provider_telegram");
  ok("claimNewKindNotification: a genuinely new kind today is claimed", claim1 === true);

  const claim2 = await claimNewKindNotification(db, "provider_telegram");
  ok("NEGATIVE CONTROL: a second claim attempt the SAME day for the SAME kind fails", claim2 === false);

  // A second door/status row of the SAME kind, same day, must not re-open
  // the claim — idempotency is per (day, kind), not per row.
  await recordIncident(db, { kind: "provider_telegram", door: "tg.js", status: 429 });
  const claim3 = await claimNewKindNotification(db, "provider_telegram");
  ok("NEGATIVE CONTROL: a new row of an already-claimed kind, same day, still fails to claim", claim3 === false);
}

{
  // A kind seen in the previous 7 days is NOT "new" and is never claimed.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  state.today = "2026-08-30"; // seed a row 5 days before the "today" below
  await recordIncident(db, { kind: "provider_whatsapp", door: "_checkins.js", status: 500 });
  state.today = "2026-09-04";
  await recordIncident(db, { kind: "provider_whatsapp", door: "_checkins.js", status: 500 });

  const claimed = await claimNewKindNotification(db, "provider_whatsapp");
  ok("claimNewKindNotification: a kind already seen in the previous 7 days is never claimed", claimed === false);
}

{
  // notifyNewIncidentKinds end to end, with an injected fake subscription
  // and a fake sendPush spy — `deps.operatorSubscriptionsFor`/`deps.
  // sendPush` are the SAME injection seam WS-R62 wires to the real
  // `vy_operator_push_subscription` store in production (api/_checkins.js);
  // this eval still drives it with a fake, `evals/room-doors/run.mjs`'s own
  // §17b being the one that attacks the real store's OWN write/read
  // functions directly.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 });
  await recordIncident(db, { kind: "door_5xx", door: "payments.js", status: 500 });

  let pushCalls = 0;
  let lastPayload = null;
  const deps = {
    env: {
      ROOM_PUSH_VAPID_PUBLIC: "pub",
      ROOM_PUSH_VAPID_PRIVATE: "priv",
      ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.test",
      OPS_OWNER_USER_IDS: "11111111-1111-4111-8111-111111111111",
    },
    fetch: async () => ({ ok: true, status: 201 }),
    operatorSubscriptionsFor: async () => [{ id: "sub-1", endpoint: "https://push.example.test/x", p256dh: "a", auth: "b" }],
    sendPush: async (sub, payload) => { pushCalls++; lastPayload = payload; return { ok: true, status: 201 }; },
  };

  const first = await notifyNewIncidentKinds(db, deps);
  ok("notifyNewIncidentKinds: the first run claims the new kind and pushes once",
    first.claimed === 1 && first.pushed === 1 && pushCalls === 1);
  const parsed = JSON.parse(lastPayload);
  ok("notifyNewIncidentKinds: the push payload carries today's TOTAL count for the kind (both doors summed)",
    parsed.body.includes("door_5xx") && parsed.body.includes("2"));

  const second = await notifyNewIncidentKinds(db, deps);
  ok("NEGATIVE CONTROL: a second push the SAME day for the SAME kind is refused",
    second.claimed === 0 && second.pushed === 0 && pushCalls === 1);
}

{
  // A 404/410 from the push service revokes THAT subscription — workstream
  // law #3, `_checkins.js`'s own `webPush` deliverer's posture for a
  // follower restated for the operator lane. `deps.revokeOperatorSubscription`
  // is the injection seam `api/_checkins.js` wires to the real
  // `revokeOperatorPushById` in production.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "provider_telegram", door: "tg.js", status: 500 });

  let revokedIds = [];
  const deps = {
    env: {
      ROOM_PUSH_VAPID_PUBLIC: "pub",
      ROOM_PUSH_VAPID_PRIVATE: "priv",
      ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.test",
      OPS_OWNER_USER_IDS: "op-1",
    },
    fetch: async () => ({ ok: false, status: 410 }),
    operatorSubscriptionsFor: async () => [{ id: "sub-dead", endpoint: "https://push.example.test/gone", p256dh: "a", auth: "b" }],
    sendPush: async () => ({ ok: false, status: 410 }),
    revokeOperatorSubscription: async (id) => { revokedIds.push(id); },
  };
  const result = await notifyNewIncidentKinds(db, deps);
  ok("notifyNewIncidentKinds: a 410 from the push service revokes that ONE subscription by id",
    result.claimed === 1 && result.pushed === 0 && revokedIds.length === 1 && revokedIds[0] === "sub-dead");
}

// ═════════════════════════════════════════════════════════════════════════
// incidentPushPayload — NEGATIVE CONTROL, STATIC: the payload builder can
// carry no door name and no person id — only `kind` and `count`,
// `evals/room-push/run.mjs`'s own "STATIC" scan of `checkinPushPayload`,
// restated for the operator's own payload builder.
// ═════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(join(REPO, "api/_incidents.js"), "utf8");
  const start = src.indexOf("function incidentPushPayload");
  ok("incidentPushPayload is present in the source", start >= 0);
  const closingBrace = src.indexOf("\n}\n", start);
  const body = src.slice(start, closingBrace < 0 ? src.length : closingBrace + 2);
  const banned = ["\\bdoor\\b", "person_id", "personId", "follower_id", "followerId", "owner_user_id", "ownerUserId", "replica_id", "replicaId"];
  const bannedRegex = new RegExp(banned.join("|"), "i");
  const clean = !bannedRegex.test(body);
  ok("the REAL incidentPushPayload's own source names no door and no person/owner/replica id",
    clean, clean ? "" : body);

  // Prove the detector actually catches a bad version, not merely passes a
  // good one — `evals/room-push/run.mjs`'s own required shape for a static
  // check restated.
  const poisoned = `function incidentPushPayload(kind, count, door, personId) {\n  return JSON.stringify({ kind, count, door, personId });\n}`;
  ok("NEGATIVE CONTROL: the same scan DOES flag a poisoned version that carries door/personId",
    bannedRegex.test(poisoned));
}

{
  // Unset VAPID: no claim is even attempted (so a kind that appeared before
  // VAPID was configured can still fire once it is).
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 });
  const result = await notifyNewIncidentKinds(db, { env: { OPS_OWNER_USER_IDS: "u1" } });
  ok("notifyNewIncidentKinds: unset VAPID config claims nothing", result.claimed === 0);
  const notified = state.rows.some((r) => r.notified_at);
  ok("notifyNewIncidentKinds: unset VAPID config leaves notified_at untouched, so a later config can still fire", !notified);
}

{
  // Unset OPS_OWNER_USER_IDS: same posture.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 });
  const result = await notifyNewIncidentKinds(db, {
    env: { ROOM_PUSH_VAPID_PUBLIC: "p", ROOM_PUSH_VAPID_PRIVATE: "p", ROOM_PUSH_VAPID_SUBJECT: "s" },
  });
  ok("notifyNewIncidentKinds: an empty operator allowlist claims nothing", result.claimed === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R98: notifyNewIncidentKinds's own Telegram fallback, beside the push.
// ═════════════════════════════════════════════════════════════════════════

{
  // Telegram alone (no VAPID, no OPS_OWNER_USER_IDS): still claims and
  // sends - the widened claim gate, `context/decisions.md
  // #ws-r98-notify-claim-widened-to-either-channel`.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "provider_payments", door: "payments.js", status: 500 });

  let telegramPayload = null;
  const result = await notifyNewIncidentKinds(db, {
    env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111" },
    sendTelegram: async (d, payload) => { telegramPayload = payload; return { sent: 1, failed: 0 }; },
  });
  ok("notifyNewIncidentKinds: Telegram alone (no VAPID, no operator allowlist) still claims and sends",
    result.claimed === 1 && result.pushed === 0 && result.telegramSent === 1);
  ok("notifyNewIncidentKinds: the Telegram sender receives the SAME incidentPushPayload shape the push channel would have",
    telegramPayload?.t === "incident" && telegramPayload?.body.includes("provider_payments"));
}
{
  // Both channels configured: both fire, each its own summary field.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "provider_webpush", door: "_push/webpush.js", status: 500 });

  let telegramCalls = 0;
  const result = await notifyNewIncidentKinds(db, {
    env: {
      ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.test",
      OPS_OWNER_USER_IDS: "op-1", ROOM_TELEGRAM_BOT_TOKEN: "tg-token", OPS_TELEGRAM_CHAT_IDS: "111",
    },
    fetch: async () => ({ ok: true, status: 201 }),
    operatorSubscriptionsFor: async () => [{ id: "sub-1", endpoint: "https://push.example.test/x", p256dh: "a", auth: "b" }],
    sendPush: async () => ({ ok: true, status: 201 }),
    sendTelegram: async () => { telegramCalls++; return { sent: 1, failed: 0 }; },
  });
  ok("notifyNewIncidentKinds: both channels configured fire both, each its own field",
    result.pushed === 1 && result.telegramSent === 1 && telegramCalls === 1);
}
{
  // NEGATIVE CONTROL: a bot token with no chat ids is still unconfigured.
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  await recordIncident(db, { kind: "provider_payments", door: "payments.js", status: 500 });
  const result = await notifyNewIncidentKinds(db, { env: { ROOM_TELEGRAM_BOT_TOKEN: "tg-token" } });
  ok("NEGATIVE CONTROL: a bot token with no OPS_TELEGRAM_CHAT_IDS is still unconfigured - claims nothing",
    result.claimed === 0 && result.telegramSent === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// pruneOldIncidents — 90 days, best-effort
// ═════════════════════════════════════════════════════════════════════════

{
  const state = freshState("2026-09-04");
  const db = fakeDb(state);
  state.today = addDays("2026-09-04", -(INCIDENT_RETENTION_DAYS + 5));
  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 }); // old
  state.today = addDays("2026-09-04", -10);
  await recordIncident(db, { kind: "door_5xx", door: "room.js", status: 500 }); // recent
  state.today = "2026-09-04";

  ok("pruneOldIncidents fixture: two rows exist before pruning", state.rows.length === 2);
  const deletedCount = await pruneOldIncidents(db);
  ok(`pruneOldIncidents deletes exactly the row older than ${INCIDENT_RETENTION_DAYS} days`, deletedCount === 1);
  ok("pruneOldIncidents leaves the recent row alone", state.rows.length === 1);

  const neverThrows = await pruneOldIncidents(async () => { throw new Error("boom"); });
  ok("pruneOldIncidents never throws, even when the delete itself throws", neverThrows === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// THE STATIC SCAN — this table's INSERT can never carry a message column,
// checked against api/_incidents.js's own real source, with a negative
// control proving the scan itself actually catches a bad shape.
// ═════════════════════════════════════════════════════════════════════════

const ALLOWED_INSERT_COLUMNS = new Set([
  "incident_id", "day", "kind", "door", "status", "count", "created_at", "updated_at",
]);

function insertColumnsOk(sourceText) {
  const m = /insert into vy_incident\s*\(([^)]*)\)/i.exec(sourceText);
  if (!m) return false;
  const cols = m[1].split(",").map((c) => c.trim()).filter(Boolean);
  return cols.length > 0 && cols.every((c) => ALLOWED_INSERT_COLUMNS.has(c));
}

const realSource = fs.readFileSync(join(REPO, "api/_incidents.js"), "utf8");
ok("static scan: the REAL api/_incidents.js INSERT names only the allowed columns",
  insertColumnsOk(realSource));

// The kind list this file exports must still be the exact set the CHECK
// (migration 109, widened to six by migration 120's own `self_check` kind,
// WS-R76) and this suite's own tests above agree on — a widening here with
// no matching migration change is exactly the drift this repo names
// everywhere else.
ok("INCIDENT_KINDS is the exact six-member closed list",
  Array.isArray(INCIDENT_KINDS) &&
  INCIDENT_KINDS.length === 6 &&
  new Set(INCIDENT_KINDS).size === 6 &&
  ["door_5xx", "provider_payments", "provider_telegram", "provider_whatsapp", "provider_webpush", "self_check"]
    .every((k) => INCIDENT_KINDS.includes(k)));

// NEGATIVE CONTROL: a helper that stores a message string. Two shapes, so
// the control does not rely on one single keyword.
const messageColumnFixture = `
  await db(
    \`insert into vy_incident (incident_id, day, kind, door, status, count, message, created_at, updated_at)
     values ($1, current_date, $2, $3, $4, 1, $5, now(), now())\`,
    [randomUUID(), kind, door, status, detail],
  );
`;
ok("NEGATIVE CONTROL: a fixture INSERT that adds a `message` column FAILS the static scan",
  !insertColumnsOk(messageColumnFixture));

const errorTextColumnFixture = `
  insert into vy_incident (incident_id, day, kind, door, status, count, error_text)
  values ($1, current_date, $2, $3, $4, 1, $5)
`;
ok("NEGATIVE CONTROL, second shape: a fixture INSERT with an `error_text` column also FAILS",
  !insertColumnsOk(errorTextColumnFixture));

// And the control is not vacuous — a clean fixture with the exact allowed
// list still passes, so `insertColumnsOk` is discriminating, not just
// always-false.
const cleanFixture = `insert into vy_incident (incident_id, day, kind, door, status, count, created_at, updated_at)`;
ok("the static scan is not vacuous: a clean fixture with only allowed columns still passes",
  insertColumnsOk(cleanFixture));

console.log(`\nincidents: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
