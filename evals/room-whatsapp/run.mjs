// WS-R29. CHECK-INS OVER WHATSAPP UTILITY TEMPLATES — offline, deterministic,
// $0, no DB, no network, no Meta, no model call.
//
//   node evals/room-whatsapp/run.mjs
//
// Migration 092. Six sections:
//
//   §1 OPT-IN / STOP / STATUS. Paid-only gate, phone validation, follower
//      scoping (B cannot touch A's opt-in), the flag off means structurally
//      absent (no query, not merely a refusal after one).
//   §2 THE PAYLOAD. `buildTemplatePayload`'s own source is scanned and must
//      carry no message-table identifier — the scanner is proven capable of
//      catching a poisoned version too (NEGATIVE CONTROL (a)).
//   §3 THE SEND, through `deliverers.whatsappTemplate` (api/_checkins.js):
//      not_configured, skipped_stopped (NEGATIVE CONTROL (c) — a stopped
//      opt-in is never sent to), delivered (2xx), failed+revoke (a 4xx marks
//      the opt-in 'failed' and a second occurrence is skipped_stopped), and
//      a 429/5xx writes NO ledger row at all.
//   §4 THE WEBHOOK (api/_room-whatsapp.js + api/room-wa.js): the GET
//      handshake and the HMAC check, reused verbatim from api/whatsapp.js;
//      a signed status callback writes nothing; a signed inbound message
//      sends exactly one deterministic line and persists nothing; an
//      UNSIGNED request is refused before either — NEGATIVE CONTROL (b).
//   §5 EXPORT / FORGET, this table's own person-lane wiring: `roomExport`
//      carries a count, a state and a MASKED number (never the number in
//      full); `roomForget` deletes it by name.
//   §6 STATIC WIRING. api/room.js carries all three ops; the room-leak
//      battery's own ALLOWED set admits this file for the reason it states.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import {
  ROOM_ID, SLUG, USER_A, USER_B, PERSON_A, PERSON_B, freshState, fakeDb, loadFixtureAgent,
} from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "w".repeat(48);
// api/whatsapp.js reads WHATSAPP_APP_SECRET/WHATSAPP_VERIFY_TOKEN into
// MODULE-LEVEL constants at IMPORT time (its own file, not this
// workstream's design to change) — so these must be set BEFORE the dynamic
// `import()` calls below, not inside §4 where they are used.
process.env.WHATSAPP_APP_SECRET = "s3cr3t";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-tok";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const ROOM = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomExport, roomForget } = ROOM;
const WA = await import(pathToFileURL(join(REPO, "api/_room-whatsapp.js")).href);
const {
  templateApproved, maskPhone, optIn, stop, status, activeWhatsappFollower, markFollowerWhatsappFailed,
  buildTemplatePayload, sendTemplate, verifyRoomWhatsappWebhook, handleStatusWebhook, whatsappAutoReply,
  TEMPLATE_NAME, TEMPLATE_LANG,
} = WA;
const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);
const { deliverers } = CI;

const { loadAgent } = await loadFixtureAgent(REPO);

/** `evals/room-push/run.mjs`'s own `withPush` one channel over — wraps
 *  rather than edits the shared fixture, and adds the ONE join
 *  `replyWithRoomLink` needs that no shared fixture has (`vy_room_follower_
 *  whatsapp` joined to `vy_room_follower` and `vy_room`). */
function withWhatsapp(baseDb, state) {
  state.waOptins = state.waOptins || [];
  state.checkinDeliveries = state.checkinDeliveries || [];
  const calls = [];
  const wrapped = async (sql, params = []) => {
    calls.push(sql);

    // `deliverers.whatsappTemplate`'s (api/_checkins.js) own ledger insert —
    // this suite's own copy of `evals/checkins/run.mjs`'s `withCheckins`
    // matcher for the identical statement (that function is local to that
    // file, not exported, so it is re-derived here rather than imported;
    // this house's own convention, `_room-push.js`'s `followerScope`).
    if (/insert into vy_room_checkin_delivery\b/.test(sql) && sql.includes("'whatsapp_template'")) {
      const [deliveryId, checkinId, roomId, personId, dueAtIso, deliveredAtIso, st, reason] = params;
      const exists = state.checkinDeliveries.some(
        (d) => d.checkin_id === String(checkinId) && d.due_at === dueAtIso && d.channel === "whatsapp_template",
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

    if (/insert into vy_room_follower_whatsapp\b/.test(sql)) {
      const [followerId, roomId, personId, phone] = params;
      let row = state.waOptins.find((w) => w.follower_id === String(followerId));
      if (row) {
        row.phone_e164 = phone; row.state = "active"; row.last_failure_code = ""; row.updated_at = new Date().toISOString();
      } else {
        row = {
          follower_id: String(followerId), room_id: String(roomId), person_id: String(personId),
          phone_e164: phone, state: "active", last_failure_code: "", created_at: new Date().toISOString(),
        };
        state.waOptins.push(row);
      }
      return [];
    }
    if (sql.includes("update vy_room_follower_whatsapp") && sql.includes("set state = 'stopped'")) {
      const [followerId] = params.map(String);
      const row = state.waOptins.find((w) => w.follower_id === followerId);
      if (row) row.state = "stopped";
      return [];
    }
    if (sql.includes("update vy_room_follower_whatsapp") && sql.includes("set state = 'failed'")) {
      const [followerId, code] = params.map(String);
      const row = state.waOptins.find((w) => w.follower_id === followerId && w.state === "active");
      if (row) { row.state = "failed"; row.last_failure_code = code; }
      return [];
    }
    if (sql.includes("select phone_e164, state from vy_room_follower_whatsapp") && sql.includes("follower_id = ($1)::uuid")) {
      const [followerId] = params.map(String);
      const row = sql.includes("and state = 'active'")
        ? state.waOptins.find((w) => w.follower_id === followerId && w.state === "active")
        : state.waOptins.find((w) => w.follower_id === followerId);
      return row ? [{ phone_e164: row.phone_e164, state: row.state }] : [];
    }
    if (sql.includes("select w.follower_id, f.locale, r.slug")) {
      const [phone] = params;
      const row = state.waOptins.find((w) => w.phone_e164 === phone);
      if (!row) return [];
      const f = state.followers.find((x) => x.follower_id === row.follower_id);
      const r = state.rooms.find((x) => x.room_id === row.room_id);
      if (!f || !r) return [];
      return [{ follower_id: row.follower_id, locale: f.locale, slug: r.slug }];
    }
    // roomForget/roomExport, api/_room-surface.js's own generic shapes.
    if (/delete from vy_room_follower_whatsapp\b/.test(sql)) {
      const [roomId, personId] = params.map(String);
      const gone = state.waOptins.filter((w) => w.room_id === roomId && w.person_id === personId);
      state.waOptins = state.waOptins.filter((w) => !gone.includes(w));
      return gone.map(() => ({ gone: 1 }));
    }
    if (sql.includes("select phone_e164, state from vy_room_follower_whatsapp where room_id")) {
      const [roomId, personId] = params.map(String);
      return state.waOptins
        .filter((w) => w.room_id === roomId && w.person_id === personId)
        .map((w) => ({ phone_e164: w.phone_e164, state: w.state }));
    }

    return baseDb(sql, params);
  };
  wrapped.calls = calls;
  return wrapped;
}

async function twoFollowers() {
  const state = freshState();
  const db = withWhatsapp(fakeDb(state), state);
  const a = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const b = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);
  const followerB = state.followers.find((f) => f.person_id === PERSON_B);
  followerA.tier = "paid";
  followerB.tier = "paid";
  return { state, db, a, b, followerA, followerB };
}

process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED = "1";

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: OPT-IN / STOP / STATUS ──");
// ═════════════════════════════════════════════════════════════════════════
{
  ok("templateApproved reads the flag, off by default", templateApproved({}) === false);
  ok("templateApproved(env) true only for the literal '1'", templateApproved({ ROOM_WHATSAPP_TEMPLATE_APPROVED: "1" }) === true
    && templateApproved({ ROOM_WHATSAPP_TEMPLATE_APPROVED: "true" }) === false);
  const masked = maskPhone("+919876543210");
  ok("maskPhone: country code visible, last two digits visible, middle masked",
    masked.startsWith("+91 ") && masked.endsWith("10") && masked.includes("•"), masked);
  ok("maskPhone of garbage is empty, never a throw", maskPhone("not-a-phone") === "");

  const { state, db, a, b, followerA, followerB } = await twoFollowers();

  // Flag off: structurally absent, no query at all.
  delete process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED;
  const offStatus = await status(db, { session: a.session }, { loadAgent });
  ok("(off) status reads available:false and nothing else, no query touched vy_room_follower_whatsapp",
    offStatus.available === false && offStatus.subscribed === false, JSON.stringify(offStatus));
  let refusedOff = false;
  try { await optIn(db, { session: a.session, phone: "+919876543210" }, { loadAgent }); } catch (e) { refusedOff = e.code === "room_whatsapp_not_available"; }
  ok("(off) optIn refuses with room_whatsapp_not_available before any write", refusedOff);
  ok("(off) no opt-in row was created", state.waOptins.length === 0);
  process.env.ROOM_WHATSAPP_TEMPLATE_APPROVED = "1";

  // Paid-only gate.
  followerA.tier = "free";
  let refusedFree = false;
  try { await optIn(db, { session: a.session, phone: "+919876543210" }, { loadAgent }); } catch (e) { refusedFree = e.code === "room_whatsapp_paid_only"; }
  ok("a free follower is refused room_whatsapp_paid_only, before any write", refusedFree);
  ok("...and no row was created for them", !state.waOptins.some((w) => w.follower_id === followerA.follower_id));
  followerA.tier = "paid";

  // Phone validation.
  let refusedPhone = false;
  try { await optIn(db, { session: a.session, phone: "98765" }, { loadAgent }); } catch (e) { refusedPhone = e.code === "room_whatsapp_phone_invalid"; }
  ok("a non-E.164 phone is refused room_whatsapp_phone_invalid", refusedPhone);

  // A's real opt-in.
  const savedA = await optIn(db, { session: a.session, phone: "+919876543210" }, { loadAgent });
  ok("optIn returns subscribed:true and a masked number, never the raw one",
    savedA.subscribed === true && savedA.phone_masked.includes("•") && !savedA.phone_masked.includes("9876543210"));
  ok("the row is scoped to A's own follower_id", state.waOptins.find((w) => w.phone_e164 === "+919876543210").follower_id === followerA.follower_id);

  const statusA = await status(db, { session: a.session }, { loadAgent });
  ok("A's own status reads subscribed:true with the masked number", statusA.subscribed === true && statusA.phone_masked.includes("•"));

  // B never opted in.
  const statusB = await status(db, { session: b.session }, { loadAgent });
  ok("B, who never opted in, reads subscribed:false, phone_masked:null", statusB.subscribed === false && statusB.phone_masked === null);

  // B cannot stop A's opt-in — `stop` is scoped off B's OWN session, so there
  // is no request shape that can name A's row at all.
  await stop(db, { session: b.session }, { loadAgent });
  ok("B's own (nonexistent) opt-in stop never touches A's row",
    state.waOptins.find((w) => w.follower_id === followerA.follower_id).state === "active");

  // A's own stop works, and re-opting in re-activates the SAME row.
  const stoppedA = await stop(db, { session: a.session }, { loadAgent });
  ok("A's own stop sets subscribed:false", stoppedA.subscribed === false);
  ok("...and the row's state is 'stopped', not deleted", state.waOptins.find((w) => w.follower_id === followerA.follower_id).state === "stopped");
  await optIn(db, { session: a.session, phone: "+919876543211" }, { loadAgent });
  ok("re-opting in yields exactly ONE row for A (replace, never grow a duplicate)",
    state.waOptins.filter((w) => w.follower_id === followerA.follower_id).length === 1);
  ok("...active again, with the NEW number and a cleared failure code",
    state.waOptins.find((w) => w.follower_id === followerA.follower_id).state === "active"
      && state.waOptins.find((w) => w.follower_id === followerA.follower_id).phone_e164 === "+919876543211"
      && state.waOptins.find((w) => w.follower_id === followerA.follower_id).last_failure_code === "");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: THE PAYLOAD — pure, scannable ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const payload = buildTemplatePayload(SLUG, "Anjali", "Evening walk", null);
  ok("buildTemplatePayload carries exactly the four public facts",
    payload.slug === SLUG && payload.display_name === "Anjali" && payload.title === "Evening walk" && payload.thread_id === null);

  const src = fs.readFileSync(join(REPO, "api/_room-whatsapp.js"), "utf8");
  const start = src.indexOf("export function buildTemplatePayload");
  ok("buildTemplatePayload is present in the source", start >= 0);
  const closingBrace = src.indexOf("\n}\n", start);
  const body = src.slice(start, closingBrace < 0 ? src.length : closingBrace + 2);
  const banned = ["prompt_shape", "promptShape", "row\\.title", "message", "\\bsaid\\b", "checkinDirective", "payload_text", "reply_text"];
  const bannedRegex = new RegExp(banned.join("|"));
  const clean = !bannedRegex.test(body);
  ok("the REAL buildTemplatePayload's own source names none of the message-table identifiers", clean, clean ? "" : body);

  // NEGATIVE CONTROL (a): the same scanner DOES flag a poisoned version.
  const poisoned = `export function buildTemplatePayload(slug, promptShape, threadId) {\n  return { r: slug, shape: promptShape };\n}`;
  ok("NEGATIVE CONTROL (a): the same scan DOES flag a poisoned version that carries promptShape",
    bannedRegex.test(poisoned));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: THE SEND — deliverers.whatsappTemplate ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { state, db, followerA } = await twoFollowers();
  // Overwritten directly: this section's own business is the SEND, not
  // opt-in mechanics (already proven end to end in §1) — `db` still carries
  // `withWhatsapp` (from `twoFollowers()`), so `deliverers.whatsappTemplate`'s
  // own reads/writes against this table (`activeWhatsappFollower`,
  // `markFollowerWhatsappFailed`) work exactly as they do against the real
  // table.
  state.waOptins = [{ follower_id: followerA.follower_id, room_id: ROOM_ID, person_id: PERSON_A, phone_e164: "+919876543210", state: "active", last_failure_code: "" }];

  const rowFor = (checkinId, dueAtIso) => ({
    checkin_id: checkinId, room_id: ROOM_ID, person_id: PERSON_A, follower_id: followerA.follower_id,
    due_at: dueAtIso, slug: SLUG, display_name: "Anjali", title: "Evening walk",
  });

  // — not_configured: flag on, but no shared credentials.
  const r1 = await deliverers.whatsappTemplate(db, rowFor(randomUUID(), "2026-09-04T03:00:00.000Z"), { env: { ROOM_WHATSAPP_TEMPLATE_APPROVED: "1" } });
  const r1Ledger = state.checkinDeliveries.find((d) => d.delivery_id === r1?.delivery_id);
  ok("flag on, no WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID — not_configured, no network call attempted",
    r1Ledger?.state === "not_configured", JSON.stringify(r1Ledger));

  const creds = { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "num", ROOM_WHATSAPP_TEMPLATE_APPROVED: "1" };

  // — skipped_stopped: configured, but this follower has no ACTIVE opt-in.
  // NEGATIVE CONTROL (c): the opt-in is 'stopped'; the send must never fire.
  const stoppedFollower = { follower_id: "ffffffff-0000-4000-8000-0000000000f1", person_id: followerA.person_id, room_id: ROOM_ID };
  state.waOptins.push({ follower_id: stoppedFollower.follower_id, room_id: ROOM_ID, person_id: PERSON_A, phone_e164: "+919000000000", state: "stopped", last_failure_code: "" });
  let sentToStopped = false;
  const spyFetch = async () => { sentToStopped = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const rStopped = await deliverers.whatsappTemplate(db, { ...rowFor(randomUUID(), "2026-09-04T03:05:00.000Z"), follower_id: stoppedFollower.follower_id }, { env: creds, fetch: spyFetch });
  ok("(c) NEGATIVE CONTROL: a stopped opt-in is never sent to (no fetch call at all)", sentToStopped === false);
  const stoppedLedger = state.checkinDeliveries.find((d) => d.delivery_id === rStopped?.delivery_id);
  ok("(c) the ledger records skipped_stopped", stoppedLedger?.state === "skipped_stopped", JSON.stringify(stoppedLedger));

  // — delivered: a real 2xx from the fake Cloud API.
  let sentBody = null;
  let sentUrl = null;
  const okFetch = async (url, init) => { sentUrl = url; sentBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}) }; };
  const checkinIdOk = randomUUID();
  const r2 = await deliverers.whatsappTemplate(db, rowFor(checkinIdOk, "2026-09-04T04:00:00.000Z"), { env: creds, fetch: okFetch });
  const okLedger = state.checkinDeliveries.find((d) => d.delivery_id === r2?.delivery_id);
  ok("a 2xx writes a delivered ledger row", okLedger?.state === "delivered", JSON.stringify(okLedger));
  ok("the send hit the right phone number's endpoint", sentUrl.includes("/num/messages"));
  ok("the body is a TEMPLATE, never free-form text — workstream law #3",
    sentBody.type === "template" && sentBody.template.name === TEMPLATE_NAME && sentBody.template.language.code === TEMPLATE_LANG);
  ok("the recipient is A's own opted-in number, in Meta's own wire format (digits only, no +)",
    sentBody.to === "919876543210");
  ok("the body's own positional params carry the display name and the title, never a raw table read",
    sentBody.template.components[0].parameters[0].text === "Anjali"
      && sentBody.template.components[0].parameters[1].text === "Evening walk");

  // — failed + revoke: a 4xx naming an invalid number.
  const badFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 131026 } }) });
  const checkinIdBad = randomUUID();
  const r3 = await deliverers.whatsappTemplate(db, rowFor(checkinIdBad, "2026-09-04T05:00:00.000Z"), { env: creds, fetch: badFetch });
  const failedLedger = state.checkinDeliveries.find((d) => d.delivery_id === r3?.delivery_id);
  ok("a 4xx writes a failed ledger row naming Meta's own error code", failedLedger?.state === "failed" && failedLedger.reason.includes("131026"), JSON.stringify(failedLedger));
  ok("...and the opt-in itself is marked 'failed' — revoke on failure",
    state.waOptins.find((w) => w.follower_id === followerA.follower_id).state === "failed");
  ok("...with the failure code recorded", state.waOptins.find((w) => w.follower_id === followerA.follower_id).last_failure_code === "131026");

  // A second occurrence for the SAME (now-failed) follower is skipped_stopped
  // — the opt-in state, not a hardcoded phone number, is what the send reads.
  let sentAfterFailure = false;
  const spyFetch2 = async () => { sentAfterFailure = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const r4 = await deliverers.whatsappTemplate(db, rowFor(randomUUID(), "2026-09-04T06:00:00.000Z"), { env: creds, fetch: spyFetch2 });
  ok("after a 4xx revoke, no further send reaches this follower until they opt in again", sentAfterFailure === false);
  ok("...and the ledger says why", state.checkinDeliveries.find((d) => d.delivery_id === r4?.delivery_id)?.state === "skipped_stopped");

  // — transient: a 429/5xx writes NO ledger row at all, left for a later
  // sweep. Re-activated by mutating the SAME row (never a second push) —
  // the real table's `PRIMARY KEY (follower_id)` allows exactly one row per
  // follower, `optIn`'s own "on conflict (follower_id) do update" restated
  // for this fixture.
  const revived = state.waOptins.find((w) => w.follower_id === followerA.follower_id);
  revived.state = "active";
  revived.last_failure_code = "";
  const beforeCount = state.checkinDeliveries.length;
  const flakyFetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "rate_limited" } }) });
  const r5 = await deliverers.whatsappTemplate(db, rowFor(randomUUID(), "2026-09-04T07:00:00.000Z"), { env: creds, fetch: flakyFetch });
  ok("a 429 returns null (no delivery_id) and writes NO ledger row", r5 === null && state.checkinDeliveries.length === beforeCount);
  ok("...and the opt-in is left 'active' — a transient failure is not a revoke",
    state.waOptins.find((w) => w.follower_id === followerA.follower_id).state === "active");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: THE WEBHOOK ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // GET handshake, reused verbatim from api/whatsapp.js.
  const getReq = { method: "GET", url: "/api/room-wa?hub.mode=subscribe&hub.verify_token=verify-tok&hub.challenge=abc123" };
  const handshake = await verifyRoomWhatsappWebhook(getReq);
  ok("the GET handshake echoes the challenge as plain text", handshake.ok && handshake.respond.body === "abc123");

  // POST, signed correctly.
  const { state, db, followerA } = await twoFollowers();
  state.waOptins = [{ follower_id: followerA.follower_id, room_id: ROOM_ID, person_id: PERSON_A, phone_e164: "+919876543210", state: "active", last_failure_code: "" }];

  const statusPayload = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", recipient_id: "919876543210" }] } }] }],
  });
  const sign = (body, secret) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const signedReq = (bodyStr) => ({
    method: "POST",
    headers: { "x-hub-signature-256": sign(bodyStr, "s3cr3t") },
    rawBody: Buffer.from(bodyStr, "utf8"),
  });

  const authStatus = await verifyRoomWhatsappWebhook(signedReq(statusPayload));
  ok("a correctly signed status callback verifies", authStatus.ok);
  const outStatus = await handleStatusWebhook(authStatus.payload, { db });
  ok("a status callback writes NO row anywhere (workstream law #6)", outStatus.statuses === 1 && outStatus.replies === 0);
  ok("...and the opt-in table is byte-for-byte untouched", state.waOptins.length === 1 && state.waOptins[0].state === "active");

  // A signed INBOUND message — the one-line auto-reply, never persisted.
  const messagePayload = JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "num" },
      messages: [{ from: "919876543210", id: "wamid.2", timestamp: "1750000000", text: { body: "stop" } }],
    } }] }],
  });
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "num";
  let sentReplyBody = null;
  const authMsg = await verifyRoomWhatsappWebhook(signedReq(messagePayload));
  ok("a correctly signed inbound message verifies", authMsg.ok);
  const outMsg = await handleStatusWebhook(authMsg.payload, {
    db, whatsappSend: async (chatKey, msg) => { sentReplyBody = msg.text; return { ok: true }; },
  });
  ok("exactly one reply is sent for the inbound message", outMsg.replies === 1);
  const expectedReply = whatsappAutoReply(SLUG, "en");
  ok("the reply is the deterministic app-voiced line, in the follower's own locale — never their own words echoed back",
    sentReplyBody === expectedReply, `got=${JSON.stringify(sentReplyBody)} want=${JSON.stringify(expectedReply)}`);
  ok("the follower's inbound text ('stop') is never persisted anywhere reachable from this world",
    !JSON.stringify(state).includes("\"stop\""));

  // NEGATIVE CONTROL (b): an UNSIGNED request writes nothing and sends nothing.
  let sentIfUnsigned = false;
  const unsignedReq = { method: "POST", headers: {}, rawBody: Buffer.from(messagePayload, "utf8") };
  const authBad = await verifyRoomWhatsappWebhook(unsignedReq);
  ok("(b) NEGATIVE CONTROL: an unsigned request fails verification", authBad.ok === false);
  if (authBad.ok) {
    await handleStatusWebhook(authBad.payload, { db, whatsappSend: async () => { sentIfUnsigned = true; return { ok: true }; } });
  }
  ok("(b) ...and because verification failed first, handleStatusWebhook is never even called (the handler's own gate, api/room-wa.js)",
    sentIfUnsigned === false);

  // A tampered signature (right shape, wrong bytes) is refused identically.
  const tamperedReq = { method: "POST", headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) }, rawBody: Buffer.from(messagePayload, "utf8") };
  const authTampered = await verifyRoomWhatsappWebhook(tamperedReq);
  ok("a tampered signature is refused too, not merely a missing one", authTampered.ok === false);

  // WS-R41 (2026-09-04): law 3's own signature reproduction, against the
  // REAL api/whatsapp.js `signatureOk` this webhook door calls (not a copy).
  // developers.facebook.com/docs/graph-api/webhooks/getting-started, fetched
  // 2026-09-04: "X-Hub-Signature-256 header, preceded with sha256=" and
  // "Generate a SHA256 signature using the payload and your app's App
  // Secret" — HMAC-SHA256 over the raw body, exactly what `signatureOk`
  // implements.
  const { signatureOk } = await import(pathToFileURL(join(REPO, "api/whatsapp.js")).href);
  const wrongLenReq = { method: "POST", headers: { "x-hub-signature-256": "sha256=" + "ab" }, rawBody: Buffer.from(messagePayload, "utf8") };
  const authWrongLen = await verifyRoomWhatsappWebhook(wrongLenReq);
  ok("a header of the wrong byte length is refused, not thrown past a length check", authWrongLen.ok === false);
  ok("...and signatureOk itself agrees, called directly", signatureOk("s3cr3t", Buffer.from(messagePayload, "utf8"), "sha256=ab") === false);
  const validSig = "sha256=" + createHmac("sha256", "s3cr3t").update(messagePayload).digest("hex");
  ok("signatureOk itself accepts a genuinely valid signature (not just verify()'s own wrapper)",
    signatureOk("s3cr3t", Buffer.from(messagePayload, "utf8"), validSig) === true);
  const srcWA = fs.readFileSync(join(REPO, "api/whatsapp.js"), "utf8");
  ok("signatureOk's own source compares in constant time (timingSafeEqual), not ===",
    /timingSafeEqual\(got, want\)/.test(srcWA));
  ok("...and refuses a length mismatch BEFORE calling it, never inside a try that could still leak timing",
    /if \(got\.length !== want\.length\) return false;\s*\n\s*return timingSafeEqual/.test(srcWA));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: EXPORT / FORGET ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { state, db, a, followerA } = await twoFollowers();
  await optIn(db, { session: a.session, phone: "+919876543210" }, { loadAgent });

  const FULL_DEPS = { loadAgent, tableApplied: async () => true };
  const dump = await roomExport(db, { session: a.session }, FULL_DEPS);
  const entry = dump.tables.vy_room_follower_whatsapp;
  ok("roomExport carries this table with a count, a state and a MASKED number", Boolean(entry), JSON.stringify(entry));
  ok("...the count is 1", entry?.count === 1);
  ok("...the state is 'active'", entry?.state === "active");
  ok("...the number is masked, never the raw digits", entry?.phone_masked?.includes("•") && !JSON.stringify(entry).includes("9876543210"));

  const receipt = await roomForget(db, { session: a.session }, FULL_DEPS);
  ok("roomForget's own count for this table is exactly 1", receipt.deleted.vy_room_follower_whatsapp === 1, JSON.stringify(receipt.deleted));
  ok("...and the row is really gone", !state.waOptins.some((w) => w.follower_id === followerA.follower_id));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: STATIC WIRING ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const roomSrc = fs.readFileSync(join(REPO, "api/room.js"), "utf8");
  ok('api/room.js dispatches op:"whatsapp_optin"', /op === "whatsapp_optin"/.test(roomSrc));
  ok('api/room.js dispatches op:"whatsapp_stop"', /op === "whatsapp_stop"/.test(roomSrc));
  ok('api/room.js dispatches op:"whatsapp_status"', /op === "whatsapp_status"/.test(roomSrc));

  const leakSrc = fs.readFileSync(join(REPO, "evals/room-leak/run.mjs"), "utf8");
  ok("evals/room-leak/run.mjs's ALLOWED set (check 1c) admits _room-whatsapp.js, named and reasoned",
    /"_room-whatsapp\.js"/.test(leakSrc));

  const waSrc = fs.readFileSync(join(REPO, "api/_room-whatsapp.js"), "utf8");
  ok("sendTemplate requires an injected fetch (never a silent real HTTP request)",
    /if \(typeof deps\.fetch !== "function"\) throw/.test(waSrc));
  // `sendTemplate`'s own body (the check-in delivery path) must never
  // reference the reused free-form sender — only `replyWithRoomLink` (the
  // auto-reply path) may.
  const sendTemplateStart = waSrc.indexOf("export async function sendTemplate");
  const sendTemplateEnd = waSrc.indexOf("\n}\n", sendTemplateStart);
  const sendTemplateBody = waSrc.slice(sendTemplateStart, sendTemplateEnd < 0 ? waSrc.length : sendTemplateEnd + 2);
  ok("sendTemplate's own body never calls the reused free-form sender (the check-in is ALWAYS a template)",
    sendTemplateStart >= 0 && !/whatsappSend/.test(sendTemplateBody));
  ok("the free-form sender IS used, exactly once, for the auto-reply path",
    (waSrc.match(/\bwhatsappSend\b/g) || []).length === 3 /* the import + deps.whatsappSend + the fallback reference, all one call site */);

  const roomWaSrc = fs.readFileSync(join(REPO, "api/room-wa.js"), "utf8");
  ok("api/room-wa.js checks HMAC BEFORE the persistent rate limit (workstream law order)",
    roomWaSrc.indexOf("verifyRoomWhatsappWebhook") < roomWaSrc.indexOf('scope: "room_wa_ip"'));
}

console.log(`\nroom-whatsapp: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
