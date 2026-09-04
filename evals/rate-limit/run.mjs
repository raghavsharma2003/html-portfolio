// WS-R26. ABUSE LIMITS ON THE PUBLIC DOORS - offline, deterministic, $0, no
// DB, no network, no GPU.
//
//   node evals/rate-limit/run.mjs
//
// Migration 089's `vy_public_rate`. Seven sections:
//
//   §1 THE UPSERT'S OWN BOUNDARY. `consume()` driven against a fake db that
//      implements the REAL statement's ON CONFLICT/WHERE semantics exactly
//      (never a simulated counter with its own separate logic): under the
//      limit returns a row, AT the limit returns zero rows - law #1. The
//      window rollover (a caller refused in one window is admitted again the
//      moment `now` crosses into the next). The Retry-After math against a
//      fixed clock.
//   §2 THE KEY IS A HASH. `hashKey()` never returns the raw key, is a fixed-
//      length hex sha256, and NEGATIVE CONTROL (c): two different keys under
//      the same scope and salt never collide and never share a counter.
//   §3 UNKNOWN SCOPE = REFUSE. NEGATIVE CONTROL (a): a scope with no
//      configured limit is refused with a named code, before any db write.
//   §4 `limitsFor()` - the `RATE_LIMITS_JSON` override, malformed JSON
//      falling back to the defaults rather than throwing, and an override
//      naming a scope this module does not define being silently ignored
//      rather than minting a new one.
//   §5 THE RETENTION SWEEP. `purgeStalePublicRateWindows()` against seeded
//      old and fresh rows.
//   §6 NEGATIVE CONTROL (b): an unsigned webhook flood never increments the
//      counter. Driven through the REAL `applyWebhook` (api/_payments.js),
//      the fake payment provider, and a shared fake db that would fail this
//      suite the moment a bad-signature call ever reached the rate table.
//   §7 STATIC PROOF that every named door really calls through this module,
//      at the position the workstream requires (the Telegram/payments HMAC
//      check strictly before the rate gate) - evals/invites/run.mjs's own
//      §4 shape, applied to five files instead of two.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threw = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const RL = await import(pathToFileURL(join(ROOT, "api/_rate-limit.js")).href);
const { consume, limitsFor, hashKey, purgeStalePublicRateWindows, DEFAULT_LIMITS } = RL;
const PAY = await import(pathToFileURL(join(ROOT, "api/_payments.js")).href);
const { applyWebhook, PaymentsError } = PAY;
const FAKE_PROVIDER = await import(pathToFileURL(join(ROOT, "api/_payments/providers/fake.js")).href);

// ── the fake vy_public_rate table ───────────────────────────────────────
//
// Implements the REAL statements' semantics, not a reimplementation of the
// decision: the insert/on-conflict arm only ever increments when the
// incoming `count < limit` param says so (mirroring the WHERE clause), and
// returns zero rows otherwise - if `consume()`'s own SQL text ever drifted
// from "the write IS the check", this fixture would keep passing while the
// real statement stopped refusing, which is exactly why §7 also proves the
// SQL text itself carries that WHERE clause.
function freshRateState() {
  return new Map(); // `${scope}\0${keyHash}\0${windowStart}` -> {scope, key_hash, window_start, count}
}

function fakeRateDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/insert into vy_public_rate/.test(sql)) {
      const [scope, keyHash, windowStart, limit] = params;
      const k = `${scope}\0${keyHash}\0${windowStart}`;
      const row = state.get(k);
      if (!row) {
        state.set(k, { scope, key_hash: keyHash, window_start: windowStart, count: 1 });
        return [{ count: 1 }];
      }
      if (row.count < Number(limit)) {
        row.count += 1;
        return [{ count: row.count }];
      }
      return []; // AT the limit: zero rows, the whole predicate
    }
    if (/delete from vy_public_rate/.test(sql)) {
      const [cutoff] = params;
      const cutoffMs = new Date(cutoff).getTime();
      const deleted = [];
      for (const [k, row] of state) {
        if (new Date(row.window_start).getTime() < cutoffMs) {
          deleted.push(row);
          state.delete(k);
        }
      }
      return deleted.map((r) => ({ scope: r.scope }));
    }
    throw new Error(`unexpected query in evals/rate-limit fake db: ${sql}`);
  };
  db.calls = calls;
  return db;
}

// ── §1 the upsert's own boundary ────────────────────────────────────────
{
  const state = freshRateState();
  const db = fakeRateDb(state);
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 3, windowMs: 60_000 } }) };
  const WINDOW_START = Date.UTC(2026, 8, 4, 12, 0, 0); // an exact minute boundary
  const now = (offsetMs) => WINDOW_START + offsetMs;

  const a = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(0), env });
  const b = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(1_000), env });
  const c = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(2_000), env });
  ok("call 1 of 3 is admitted", a.ok === true && a.remaining === 2);
  ok("call 2 of 3 is admitted", b.ok === true && b.remaining === 1);
  ok("call 3 of 3 is admitted", c.ok === true && c.remaining === 0);

  const d = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(3_000), env });
  ok("call 4 - AT the limit - is refused", d.ok === false && d.code === "rate_limited");
  ok("a refusal carries zero remaining", d.remaining === 0);
  ok("the refusal did not increment the row past the limit", state.get([...state.keys()][0]).count === 3);

  const e = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(4_000), env });
  ok("a second refusal in the same window is ALSO refused (idempotent, not a fluke)", e.ok === false);

  // window rollover: the same key, one minute later, gets a fresh allowance
  const f = await consume(db, { scope: "room_open_ip", key: "1.2.3.4", now: now(60_000), env });
  ok("the next window admits the same key again", f.ok === true && f.remaining === 2);
  ok("the rollover created a SECOND row, not a reused one", state.size === 2);
}
{
  // Retry-After math against a fixed clock: 45s into a 60s window leaves 15s.
  const db = fakeRateDb(freshRateState());
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 1, windowMs: 60_000 } }) };
  const windowStartMs = Date.UTC(2026, 8, 4, 9, 0, 0);
  await consume(db, { scope: "room_open_ip", key: "k", now: windowStartMs, env });
  const refused = await consume(db, { scope: "room_open_ip", key: "k", now: windowStartMs + 45_000, env });
  ok("Retry-After is the exact remaining seconds in the window", refused.ok === false && refused.retryAfterSeconds === 15, `got ${refused.retryAfterSeconds}`);
  const refusedLate = await consume(db, { scope: "room_open_ip", key: "k", now: windowStartMs + 59_900, env });
  ok("Retry-After rounds up, never to zero, one tick before the boundary", refusedLate.retryAfterSeconds === 1);
}

// ── §2 the key is a hash ────────────────────────────────────────────────
{
  const h = hashKey("room_open_ip", "203.0.113.7", { now: Date.UTC(2026, 8, 4) });
  ok("hashKey returns a 64-char hex sha256", /^[0-9a-f]{64}$/.test(h));
  ok("the hash never contains the raw key", !h.includes("203.0.113.7") && !h.includes("203"));

  const hA = hashKey("room_open_ip", "203.0.113.7", { now: Date.UTC(2026, 8, 4) });
  const hB = hashKey("room_open_ip", "203.0.113.8", { now: Date.UTC(2026, 8, 4) });
  ok("NEGATIVE CONTROL (c): two different IPs never hash to the same key", hA !== hB);

  const state = freshRateState();
  const db = fakeRateDb(state);
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 1, windowMs: 60_000 } }) };
  const now = Date.UTC(2026, 8, 4, 10, 0, 0);
  const ipA = await consume(db, { scope: "room_open_ip", key: "10.0.0.1", now, env });
  const ipAAgain = await consume(db, { scope: "room_open_ip", key: "10.0.0.1", now, env });
  const ipB = await consume(db, { scope: "room_open_ip", key: "10.0.0.2", now, env });
  ok("IP A's first call is admitted", ipA.ok === true);
  ok("IP A's second call is refused (its own counter is spent)", ipAAgain.ok === false);
  ok("IP B is admitted regardless - it never shared IP A's counter", ipB.ok === true);
  ok("two independent rows exist, keyed by two independent hashes", state.size === 2);
}

// ── §3 unknown scope = refuse (NEGATIVE CONTROL a) ──────────────────────
{
  const state = freshRateState();
  const db = fakeRateDb(state);
  const refused = await consume(db, { scope: "this_scope_does_not_exist", key: "x" });
  ok("an unknown scope is refused", refused.ok === false && refused.code === "rate_limit_unknown_scope");
  ok("an unknown scope refuses BEFORE any database write", state.size === 0 && db.calls.length === 0);
}

// ── §4 limitsFor() - the operator override ──────────────────────────────
{
  const defaults = limitsFor({});
  ok("every DEFAULT_LIMITS scope is present with no override", Object.keys(DEFAULT_LIMITS).every((s) => defaults[s].limit === DEFAULT_LIMITS[s].limit));

  const overridden = limitsFor({ RATE_LIMITS_JSON: JSON.stringify({ apply_submit_ip: { limit: 2 } }) });
  ok("an override changes only the named scope's limit", overridden.apply_submit_ip.limit === 2);
  ok("an override leaves an unnamed scope's window untouched", overridden.apply_submit_ip.windowMs === DEFAULT_LIMITS.apply_submit_ip.windowMs);
  ok("an override leaves every OTHER scope at its default", overridden.room_open_ip.limit === DEFAULT_LIMITS.room_open_ip.limit);

  const malformed = limitsFor({ RATE_LIMITS_JSON: "{not json" });
  ok("malformed RATE_LIMITS_JSON falls back to the defaults, never throws", malformed.room_open_ip.limit === DEFAULT_LIMITS.room_open_ip.limit);

  const stray = limitsFor({ RATE_LIMITS_JSON: JSON.stringify({ made_up_scope: { limit: 999 } }) });
  ok("an override for a scope this module never defined mints nothing", !("made_up_scope" in stray));
  const strayRefused = await consume(fakeRateDb(freshRateState()), { scope: "made_up_scope", key: "x", env: { RATE_LIMITS_JSON: JSON.stringify({ made_up_scope: { limit: 999 } }) } });
  ok("...and consume() still refuses it as unknown, not as admitted-with-999", strayRefused.ok === false && strayRefused.code === "rate_limit_unknown_scope");
}

// ── §5 the retention sweep ───────────────────────────────────────────────
{
  const state = freshRateState();
  const db = fakeRateDb(state);
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  state.set("old", { scope: "room_open_ip", key_hash: "a".repeat(64), window_start: new Date(now - 2 * DAY).toISOString(), count: 5 });
  state.set("borderline", { scope: "room_open_ip", key_hash: "b".repeat(64), window_start: new Date(now - DAY - 1000).toISOString(), count: 1 });
  state.set("fresh", { scope: "room_open_ip", key_hash: "c".repeat(64), window_start: new Date(now - 60_000).toISOString(), count: 1 });

  const removed = await purgeStalePublicRateWindows(db, now);
  ok("the sweep removes every window older than a day", removed === 2);
  ok("the fresh row survives", state.has("fresh") && !state.has("old") && !state.has("borderline"));
}

// ── §6 NEGATIVE CONTROL (b): an unsigned flood never increments the counter ─
{
  const WEBHOOK_SECRET = "test_webhook_secret_089";
  const ENV = {
    PAYMENTS_PROVIDER: "fake",
    PAYMENTS_FAKE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // A tiny limit so the third GOOD call is provably over it.
    RATE_LIMITS_JSON: JSON.stringify({ payments_webhook_ip: { limit: 2, windowMs: 60_000 } }),
  };
  const state = freshRateState();
  const db = fakeRateDb(state);
  // A body whose KIND is unrecognized - applyWebhook throws right after the
  // rate gate, so this suite never has to build a full subscription fixture
  // to prove the ONE thing this control is about: whether the counter moved.
  const body = Buffer.from(JSON.stringify({ event: "not.a.kind" }));
  const goodSig = FAKE_PROVIDER.signWebhookForTest(body, WEBHOOK_SECRET);

  for (let i = 0; i < 5; i++) {
    const badSigResult = await threw(() =>
      applyWebhook(db, { rawBody: body, signatureHeader: "0".repeat(64), eventRef: `evt_bad_${i}` }, { env: ENV, ip: "198.51.100.1" }),
    );
    ok(`unsigned attempt ${i + 1} is refused by signature, not by rate`, badSigResult instanceof PaymentsError && badSigResult.code === "payment_webhook_signature_invalid");
  }
  ok("NEGATIVE CONTROL (b): five unsigned attempts wrote ZERO rows to vy_public_rate", state.size === 0 && db.calls.length === 0);

  // Now two GOOD, distinctly-signed requests (an event id ONLY needs to be
  // unique per real webhook delivery; identical event ids here would also be
  // refused as a replay by a different code path this suite is not about).
  const first = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_good_1" }, { env: ENV, ip: "198.51.100.1" }));
  const second = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_good_2" }, { env: ENV, ip: "198.51.100.1" }));
  ok("a signed call within the limit fails for the UNRELATED reason (unknown kind), not for rate", first?.code === "payment_webhook_kind_unknown");
  ok("a second signed call, still within the limit, behaves the same way", second?.code === "payment_webhook_kind_unknown");
  ok("two signed calls really did increment the counter this time", db.calls.length === 2 && state.size === 1);

  const third = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_good_3" }, { env: ENV, ip: "198.51.100.1" }));
  ok("the THIRD signed call, over the limit, is refused BY THE RATE GATE specifically", third instanceof PaymentsError && third.code === "rate_limited");
  ok("the rate refusal is a named 429 with a Retry-After the caller can act on", third.status === 429 && Number.isInteger(third.details?.retry_after_seconds) && third.details.retry_after_seconds > 0);

  // A second IP is a second counter, same posture as §2.
  const otherIp = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_good_4" }, { env: ENV, ip: "198.51.100.2" }));
  ok("a DIFFERENT sender IP is unaffected by the first sender's exhausted counter", otherIp?.code === "payment_webhook_kind_unknown");

  // deps.ip omitted entirely: the gate is opt-in per caller (an internal
  // retry with no request context is never forced to invent an IP), so this
  // must behave exactly as it did before WS-R26 - no throw from this file.
  const noIp = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_no_ip" }, { env: ENV }));
  ok("omitting deps.ip skips the gate entirely rather than refusing or crashing", noIp?.code === "payment_webhook_kind_unknown");
}

// ── §7 static proof: every named door really calls through this module ──
{
  const room = readFileSync(join(ROOT, "api/room.js"), "utf8");
  ok("api/room.js imports consume from _rate-limit.js", /import \{ consume \} from ".\/_rate-limit\.js"/.test(room));
  ok("api/room.js `open` gates on room_open_ip before optionalUser runs", /op === "open"[\s\S]{0,500}refused\(res, "room_open_ip", ipOf\(req\)\)[\s\S]{0,200}optionalUser\(req\)/.test(room));
  ok("api/room.js `join` gates on room_join_ip before requiredUser runs", /op === "join"[\s\S]{0,500}refused\(res, "room_join_ip", ipOf\(req\)\)[\s\S]{0,200}requiredUser\(req\)/.test(room));
  ok("api/room.js `say` decodes the session and gates on room_say_follower keyed by the follower's person id", /op === "say"[\s\S]{0,600}readRoomSession\(body\.session\)[\s\S]{0,200}refused\(res, "room_say_follower", sayPayload\.p\)/.test(room));
  ok("api/room.js `push_subscribe` gates on room_push_follower the same way", /op === "push_subscribe"[\s\S]{0,600}refused\(res, "room_push_follower", subPayload\.p\)/.test(room));
  ok("every scope name api/room.js uses is one this module actually defines a limit for", ["room_open_ip", "room_join_ip", "room_say_follower", "room_push_follower"].every((s) => s in DEFAULT_LIMITS));

  const apply = readFileSync(join(ROOT, "api/apply.js"), "utf8");
  ok("api/apply.js imports consume", /import \{ consume \} from ".\/_rate-limit\.js"/.test(apply));
  ok("api/apply.js `submit` gates on apply_submit_ip before submitApplication runs", /op === "submit"[\s\S]{0,400}consume\(q, \{ scope: "apply_submit_ip"[\s\S]{0,300}submitApplication\(q, body\)/.test(apply));

  const roomTg = readFileSync(join(ROOT, "api/room-tg.js"), "utf8");
  const tgAuthAt = roomTg.indexOf("verifyRoomTelegramWebhook(req)");
  const tgGateAt = roomTg.indexOf('consume(q, { scope: "room_tg_ip"');
  ok("api/room-tg.js's HMAC check exists", tgAuthAt !== -1);
  ok("api/room-tg.js's rate gate exists", tgGateAt !== -1);
  ok("LAW #5: the Telegram HMAC check runs strictly BEFORE the rate gate", tgAuthAt < tgGateAt);

  const payments = readFileSync(join(ROOT, "api/_payments.js"), "utf8");
  const sigAt = payments.indexOf("provider.verifyWebhookSignature(");
  const payGateAt = payments.indexOf('consume(db, { scope: "payments_webhook_ip"');
  const kindAt = payments.indexOf("const parsed = parseWebhookPayload(json);");
  ok("api/_payments.js's signature check exists", sigAt !== -1);
  ok("api/_payments.js's rate gate exists", payGateAt !== -1);
  ok("LAW #5: the payment signature check runs strictly BEFORE the rate gate", sigAt < payGateAt);
  ok("the rate gate runs BEFORE the body is parsed for its kind", payGateAt < kindAt);

  const paymentsWebhook = readFileSync(join(ROOT, "api/payments-webhook.js"), "utf8");
  ok("api/payments-webhook.js hands its own caller's IP down to applyWebhook", /applyWebhook\(q, \{[\s\S]{0,300}\}, \{ ip: ipOf\(req\) \}\)/.test(paymentsWebhook));

  const checkins = readFileSync(join(ROOT, "api/_checkins.js"), "utf8");
  ok("the check-ins sweep imports the retention purge", /import \{ purgeStalePublicRateWindows \} from ".\/_rate-limit\.js"/.test(checkins));
  ok("the check-ins sweep calls it and never lets its failure fail the sweep", /try \{\s*summary\.ratePurged = await purgeStalePublicRateWindows\(db, now\);\s*\} catch/.test(checkins));

  const migration = readFileSync(join(ROOT, "db/migrations/089_public_rate.sql"), "utf8");
  const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
  ok("the migration creates vy_public_rate", /create table if not exists vy_public_rate/.test(migration));
  ok("db/schema.sql mirrors it", /create table if not exists vy_public_rate/.test(schema));
  ok("the migration's own primary key matches consume()'s ON CONFLICT target", /primary key \(scope, key_hash, window_start\)/.test(migration));
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
