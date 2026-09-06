// The follower's receipt (WS-R100, migration 126) - offline, deterministic,
// $0, no DB, no network, no model call.
//
//   node evals/room-receipt/run.mjs
//
// Drives the REAL `api/_receipt.js` (a pure builder, no db of its own), the
// REAL `api/_payments.js` (`issueFollowerReceipt`, the counter's own atomic
// claim), and the REAL `api/_room-surface.js` (`roomReceipt`/`roomReceipts`/
// `roomExport`) through the SAME shared fake `db` `evals/room-referrals/
// run.mjs` uses (`evals/room/fixtures.mjs`), extended with the small set of
// SQL shapes migration 126 adds and none of that fixture's siblings need.
//
// ── what this suite is actually guarding ───────────────────────────────────
//
// 1. THE PURE MATH IS RIGHT. `financialYearFor` (India's 1 April boundary),
//    `formatReceiptNumber` (the `VY/<FY>/<n>` shape, and Rule 46(b)'s own
//    sixteen-character cap enforced as a THROW, never a silently-too-long
//    string), `gstSplit` (every branch's own arithmetic identity: taxable
//    value plus tax equals the amount charged, and a split branch's two
//    halves sum to the whole).
// 2. THE COUNTER IS ATOMIC, NEVER A JS INCREMENT. `issueFollowerReceipt`
//    claims a number inside one `UPDATE ... RETURNING`; two DIFFERENT
//    payment events claimed together get two different, sequential numbers
//    (never a gap, never a collision); the SAME payment event claimed twice
//    (`bump`'s own `not exists` guard) burns no second number and the
//    unique index is what refuses the second INSERT - the required negative
//    control.
// 3. THE BUILDER RENDERS BOTH LOCALES, AND THE PLACEHOLDER PATH IS HONEST.
//    `PLATFORM_LEGAL_NAME`/`PLATFORM_GSTIN` unset (or a malformed GSTIN)
//    renders the named placeholder sentence, never a fabricated identity;
//    set, it renders the real one, in `en` and in `hi`.
// 4. THE READ IS SCOPED, AND THE REQUIRED NEGATIVE CONTROL. `roomReceipt`'s
//    own WHERE names room_id AND person_id, both off the verified session -
//    a follower naming ANOTHER follower's real payment_event_id in the body
//    is refused, never handed that follower's receipt.
// 5. EXPORT CARRIES IT. `roomExport`'s own `ROOM_EXPORT_EXTRA` entry surfaces
//    a follower's own receipts in full.
// 6. FORGET NULLS, NEVER DELETES - proven statically against the real
//    source, `evals/room-doors/run.mjs`'s own technique (a regex read of the
//    real file) for the one door this suite cannot reach with a fake `db`:
//    `api/memory.js`'s `q` is imported directly from `api/_db.js`, not
//    injectable, so the account-wide wipe's own live SQL is proven by
//    `EXPLAIN` against the real database at the merge
//    (`offline-mocks-cannot-type-check-sql`), not by this suite.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SLUG, ROOM_ID, AGENT_ID, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent, freshState, fakeDb,
} from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "q".repeat(48);
process.env.RATE_SALT = process.env.RATE_SALT || "test-rate-salt-ws-r100";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const receiptMod = await import(pathToFileURL(join(REPO, "api/_receipt.js")).href);
const {
  GST_RATE_BP, SAC_PLACEHOLDER, financialYearFor, formatReceiptNumber,
  gstSplit, platformSupplierInfo, buildReceiptContext, buildReceiptHtml,
} = receiptMod;

const paymentsMod = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const { issueFollowerReceipt } = paymentsMod;

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomReceipt, roomReceipts, roomExport, RoomError } = room;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "same idea, other end.";
const deps = (extra = {}) => ({
  loadAgent, engine, reply, personTables: async () => [], tableApplied: async () => true, ...extra,
});

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 THE PURE MATH — financial year and the receipt number");
// ═════════════════════════════════════════════════════════════════════════
{
  ok("§1 a date in April opens the FY it sits in",
    financialYearFor(Date.parse("2026-04-01T00:00:00.000Z")) === "2026-27");
  ok("§1 the last instant of March still belongs to the PRIOR FY",
    financialYearFor(Date.parse("2026-03-31T23:59:59.999Z")) === "2025-26");
  ok("§1 mid-year (September) belongs to the FY that opened the prior April",
    financialYearFor(Date.parse("2026-09-05T00:00:00.000Z")) === "2026-27");
  ok("§1 a December-to-January FY-year rollover renders the right pair (2099-00)",
    financialYearFor(Date.parse("2099-05-01T00:00:00.000Z")) === "2099-00");

  ok("§1 formatReceiptNumber renders VY/<FY>/<n>",
    formatReceiptNumber("2026-27", 1) === "VY/2026-27/1");
  ok("§1 the five-digit ceiling (99999) still fits Rule 46(b)'s sixteen-character cap",
    formatReceiptNumber("2026-27", 99999).length <= 16);
  // NEGATIVE CONTROL: a number that would push the formatted string past
  // sixteen characters THROWS rather than silently emitting an invalid
  // invoice number.
  const overCap = (() => { try { return formatReceiptNumber("2026-27", 100000); } catch (e) { return e; } })();
  ok("NEGATIVE CONTROL: a six-digit receipt number in one FY throws, never silently exceeds Rule 46(b)'s cap",
    overCap instanceof Error && overCap.code === "receipt_number_over_rule_46b_cap",
    `formatted length would be ${"VY/2026-27/100000".length}`);
  const badFy = (() => { try { return formatReceiptNumber("bad-fy", 1); } catch (e) { return e; } })();
  ok("§1 a malformed FY throws rather than rendering garbage", badFy instanceof Error);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 THE PURE MATH — gstSplit's three modes, every arithmetic identity");
// ═════════════════════════════════════════════════════════════════════════
{
  const unknown = gstSplit({ amountInr: 399 });
  ok("§2 unknown_state is the default (no follower state supplied)", unknown.mode === "unknown_state");
  ok("§2 taxable value plus total tax equals the amount charged (unknown_state)",
    unknown.taxable_value_inr + unknown.total_tax_inr === 399, JSON.stringify(unknown));
  ok("§2 the rate is the named constant, never a different one silently applied", unknown.rate_bp === GST_RATE_BP);

  const sameState = gstSplit({ amountInr: 599, followerState: "Karnataka", platformState: "Karnataka" });
  ok("§2 the same follower/platform state produces CGST+SGST", sameState.mode === "cgst_sgst");
  ok("§2 CGST+SGST sum to the total tax exactly (paisa-rounding remainder lands on SGST)",
    sameState.cgst_inr + sameState.sgst_inr === sameState.total_tax_inr, JSON.stringify(sameState));
  ok("§2 taxable value plus total tax equals the amount charged (cgst_sgst)",
    sameState.taxable_value_inr + sameState.total_tax_inr === 599);

  const diffState = gstSplit({ amountInr: 599, followerState: "Karnataka", platformState: "Delhi" });
  ok("§2 a different follower/platform state produces IGST", diffState.mode === "igst");
  ok("§2 IGST alone equals the total tax", diffState.igst_inr === diffState.total_tax_inr);
  ok("§2 state comparison is case-insensitive (the same state, typed differently, is still intra-state)",
    gstSplit({ amountInr: 299, followerState: "karnataka", platformState: "KARNATAKA" }).mode === "cgst_sgst");

  ok("§2 a zero amount never throws and produces zero everywhere",
    JSON.stringify(gstSplit({ amountInr: 0 })).includes('"taxable_value_inr":0'));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 THE BUILDER — both locales, and the honest placeholder path");
// ═════════════════════════════════════════════════════════════════════════
{
  const paymentEvent = { event_id: "e1", amount_inr: 399, kind: "subscription.charged" };
  const receiptRow = { receipt_no: 7, issued_at: "2026-09-05T10:00:00.000Z" };
  const roomPublic = { name: "Anjali" };

  // No PLATFORM_LEGAL_NAME/PLATFORM_GSTIN set - the honest placeholder.
  const noEnv = {};
  const supplierUnset = platformSupplierInfo(noEnv);
  ok("§3 an unset supplier identity is honestly incomplete", supplierUnset.complete === false);

  const ctxEn = buildReceiptContext({ paymentEvent, receipt: receiptRow, room: roomPublic, locale: "en", env: noEnv });
  ok("§3 the receipt number is VY/<FY>/<n>, FY derived from issued_at", ctxEn.receipt_number === "VY/2026-27/7");
  ok("§3 the amount is carried through unchanged", ctxEn.amount_inr === 399);
  const htmlEn = buildReceiptHtml(ctxEn);
  ok("§3 the placeholder path: unconfigured HTML states the identity is not yet set, never a fabricated name",
    htmlEn.includes("not yet configured"));
  ok("§3 the SAC line states it is unconfirmed, never a guessed code",
    htmlEn.includes(SAC_PLACEHOLDER.en));
  ok("§3 the receipt number appears in the rendered page", htmlEn.includes("VY/2026-27/7"));

  // Configured: a real name and a shape-valid GSTIN.
  const withEnv = { PLATFORM_LEGAL_NAME: "Vyakti Platforms Private Limited", PLATFORM_GSTIN: "29ABCDE1234F1Z5" };
  const supplierSet = platformSupplierInfo(withEnv);
  ok("§3 a shape-valid GSTIN is accepted", supplierSet.complete === true && supplierSet.gstin === "29ABCDE1234F1Z5");
  const htmlConfigured = buildReceiptHtml(buildReceiptContext({ paymentEvent, receipt: receiptRow, room: roomPublic, locale: "en", env: withEnv }));
  ok("§3 configured: the real legal name and GSTIN render, never the placeholder sentence",
    htmlConfigured.includes("Vyakti Platforms Private Limited") && htmlConfigured.includes("29ABCDE1234F1Z5")
    && !htmlConfigured.includes("not yet configured"));

  // NEGATIVE CONTROL: a malformed GSTIN (wrong shape) is treated exactly
  // like an unset one - never printed as though it were valid.
  const badGstin = platformSupplierInfo({ PLATFORM_LEGAL_NAME: "X", PLATFORM_GSTIN: "not-a-real-gstin" });
  ok("NEGATIVE CONTROL: a malformed GSTIN is refused, treated as unset rather than printed",
    badGstin.complete === false && badGstin.gstin === "");

  // Hindi.
  const ctxHi = buildReceiptContext({ paymentEvent, receipt: receiptRow, room: roomPublic, locale: "hi", env: noEnv });
  const htmlHi = buildReceiptHtml(ctxHi);
  ok("§3 Hindi: the title renders in Devanagari", htmlHi.includes("रसीद"));
  ok("§3 Hindi: the placeholder sentence renders in Hindi, not a leftover English string",
    htmlHi.includes("सेट नहीं हुए हैं") && !htmlHi.includes("not yet configured"));
  ok("§3 Hindi and English render the SAME receipt number (a name is not translated)",
    ctxHi.receipt_number === ctxEn.receipt_number);
  for (const s of [htmlEn, htmlHi]) {
    ok(`§3 no em-dash or en-dash in the rendered page (${s === htmlEn ? "en" : "hi"})`,
      !s.includes("—") && !s.includes("–"));
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE COUNTER — atomic, never a JS increment; the required negative control");
// ═════════════════════════════════════════════════════════════════════════
{
  // A tiny, dedicated fake modelling ONLY the two statements
  // `issueFollowerReceipt` issues - `evals/payments/run.mjs`'s own
  // `makeDb` precedent, scoped to migration 126's own SQL.
  function receiptCounterDb() {
    const counters = new Map(); // fy -> next
    const receipts = new Map(); // payment_event_id -> row
    let nextReceiptId = 1;
    const db = async (sql, params) => {
      if (sql.includes("insert into vy_receipt_counter")) {
        const [fy, eventId, roomId, personId, issuedAt] = params;
        if (!counters.has(fy)) counters.set(fy, 1);
        if (receipts.has(String(eventId))) return []; // bump's own not-exists guard
        const claimed = counters.get(fy);
        counters.set(fy, claimed + 1);
        const row = {
          receipt_id: `r${nextReceiptId++}`, receipt_no: claimed,
          payment_event_id: String(eventId), room_id: String(roomId),
          person_id: personId ? String(personId) : null,
          issued_at: issuedAt || new Date().toISOString(),
        };
        receipts.set(row.payment_event_id, row);
        return [{ receipt_id: row.receipt_id, receipt_no: row.receipt_no, issued_at: row.issued_at }];
      }
      throw new Error(`receiptCounterDb: unmodelled statement: ${sql.slice(0, 80)}`);
    };
    return { db, counters, receipts };
  }

  // Two DIFFERENT payment events, claimed "concurrently" (fired together
  // with Promise.all - `evals/payments/run.mjs`'s own idempotent-replay
  // suite proves the SQL's own on-conflict shape; this proves the counter's
  // arithmetic never collides or skips across two real claims).
  {
    const { db, counters } = receiptCounterDb();
    const [a, b] = await Promise.all([
      issueFollowerReceipt(db, { eventId: "ev-a", roomId: ROOM_ID, personId: PERSON_A, issuedAt: "2026-09-05T00:00:00.000Z" }),
      issueFollowerReceipt(db, { eventId: "ev-b", roomId: ROOM_ID, personId: PERSON_B, issuedAt: "2026-09-05T00:00:01.000Z" }),
    ]);
    ok("§4 two different claims land two different numbers", a.receipt_no !== b.receipt_no, `${a.receipt_no} vs ${b.receipt_no}`);
    const numbers = [a.receipt_no, b.receipt_no].sort((x, y) => x - y);
    ok("§4 the two numbers are exactly {1,2} - sequential, no gap", numbers[0] === 1 && numbers[1] === 2);
    ok("§4 the counter's own next-value ends at 3 (both claims accounted for)", counters.get("2026-27") === 3);
  }

  // NEGATIVE CONTROL: the SAME payment event claimed twice - the unique
  // index (`vy_receipt`'s own `unique (payment_event_id)`) is what refuses
  // the second attempt, modelled here as the second call returning nothing
  // new and burning no second counter number.
  {
    const { db, counters, receipts } = receiptCounterDb();
    const first = await issueFollowerReceipt(db, { eventId: "ev-dup", roomId: ROOM_ID, personId: PERSON_A, issuedAt: "2026-09-05T00:00:00.000Z" });
    const second = await issueFollowerReceipt(db, { eventId: "ev-dup", roomId: ROOM_ID, personId: PERSON_A, issuedAt: "2026-09-05T00:00:00.000Z" });
    ok("§4 the first claim lands receipt_no 1", first?.receipt_no === 1);
    ok("NEGATIVE CONTROL: a duplicate claim for the SAME payment event is refused - no second row",
      second === null, JSON.stringify(second));
    ok("NEGATIVE CONTROL: the duplicate attempt burned no second counter number", counters.get("2026-27") === 2);
    ok("§4 exactly one receipt exists for this payment event", receipts.size === 1);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 THE READ — scoped, and the required negative control");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.events = [{
    event_id: "e5000000-0000-4000-8000-000000000001", amount_inr: 399, kind: "subscription.charged",
  }];
  state.receipts = [{
    receipt_id: "f5000000-0000-4000-8000-000000000001", receipt_no: 3,
    payment_event_id: "e5000000-0000-4000-8000-000000000001", room_id: ROOM_ID,
    person_id: PERSON_A, issued_at: "2026-09-05T00:00:00.000Z",
  }];
  const baseDb = fakeDb(state);
  const db = async (sql, params) => {
    const has = (s) => sql.includes(s);
    // ORDER MATTERS: roomReceipt's own single-row query text also contains
    // the substring "r.payment_event_id" (it names that column in both the
    // JOIN clause and, for roomReceipts, the SELECT list too), so the LIST
    // query's own distinguishing feature ("order by") must be checked
    // FIRST or it is silently swallowed by the single-row branch below,
    // which would then misread `[roomId, personId]` as
    // `[paymentEventId, roomId]` - found the hard way, by this suite's own
    // §5 failing with an empty list where a real receipt existed.
    if (has("from vy_receipt r") && has("join vy_payment_event e") && has("order by r.issued_at desc")) {
      const [roomId, personId] = params.map(String);
      return state.receipts
        .filter((r) => r.room_id === roomId && r.person_id === personId)
        .map((r) => {
          const ev = state.events.find((e) => e.event_id === r.payment_event_id);
          return { receipt_id: r.receipt_id, receipt_no: r.receipt_no, payment_event_id: r.payment_event_id, issued_at: r.issued_at, amount_inr: ev?.amount_inr };
        });
    }
    if (has("from vy_receipt r") && has("join vy_payment_event e") && has("r.payment_event_id")) {
      const [paymentEventId, roomId, personId] = params.map(String);
      const row = state.receipts.find((r) => r.payment_event_id === paymentEventId && r.room_id === roomId && r.person_id === personId);
      if (!row) return [];
      const ev = state.events.find((e) => e.event_id === row.payment_event_id);
      return [{ receipt_no: row.receipt_no, issued_at: row.issued_at, event_id: ev?.event_id, amount_inr: ev?.amount_inr, kind: ev?.kind }];
    }
    if (has("select * from vy_receipt where")) {
      // roomExport's ROOM_EXPORT_EXTRA generic "rows" reader.
      const [roomId, personId] = params.map(String);
      return state.receipts.filter((r) => r.room_id === roomId && r.person_id === personId);
    }
    return baseDb(sql, params);
  };

  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps());
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, deps());

  const mine = await roomReceipt(db, { session: joinedA.session, paymentEventId: "e5000000-0000-4000-8000-000000000001" }, deps());
  ok("§5 the real follower reads their own receipt, correctly numbered", mine.receipt_number.endsWith("/3"));
  ok("§5 the amount comes from the real ledger row", mine.amount_inr === 399);

  const stolen = await roomReceipt(db, { session: joinedB.session, paymentEventId: "e5000000-0000-4000-8000-000000000001" }, deps())
    .then(() => null, (e) => e);
  ok("NEGATIVE CONTROL: a follower naming ANOTHER follower's real payment_event_id is refused by the WHERE",
    stolen instanceof RoomError && stolen.code === "room_receipt_not_found");

  const list = await roomReceipts(db, { session: joinedA.session }, deps());
  ok("§5 the follower's own list carries exactly their one receipt", list.receipts.length === 1 && list.receipts[0].receipt_no === 3);
  const listB = await roomReceipts(db, { session: joinedB.session }, deps());
  ok("§5 a follower with no receipts gets an empty list, never someone else's", listB.receipts.length === 0);

  const exportA = await roomExport(db, { session: joinedA.session }, deps());
  ok("§5 roomExport carries the follower's own receipt row in full",
    Array.isArray(exportA.tables.vy_receipt) && exportA.tables.vy_receipt.length === 1
    && exportA.tables.vy_receipt[0].receipt_no === 3, JSON.stringify(exportA.tables.vy_receipt));

  const gone404 = await roomReceipt(db, { session: joinedA.session, paymentEventId: "00000000-0000-4000-8000-000000000000" }, deps())
    .then(() => null, (e) => e);
  ok("§5 an unknown payment_event_id is refused, the same shape as a stolen one", gone404 instanceof RoomError && gone404.code === "room_receipt_not_found");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 FORGET NULLS, NEVER DELETES — proven statically against the real source");
// ═════════════════════════════════════════════════════════════════════════
{
  const memorySrc = readFileSync(join(REPO, "api/memory.js"), "utf8");
  ok("§6 api/memory.js contains the explicit door, gated on the table existing",
    /tableApplied\("vy_receipt"\)/.test(memorySrc));
  ok("§6 the door is an UPDATE that NULLS person_id, never a DELETE of the row",
    /update vy_receipt set person_id = null where person_id = \$1/.test(memorySrc));
  ok("§6 vy_receipt is NOT listed in PERSON_TABLES (it would be blind-DELETEd by the generic loop if it were)",
    !/\{ table: "vy_receipt"/.test(memorySrc.slice(0, memorySrc.indexOf("export async function tableApplied"))));

  const relcheckSrc = readFileSync(join(REPO, "scripts/relcheck.mjs"), "utf8");
  ok("§6 scripts/relcheck.mjs's EXEMPT map carries a written reason for vy_receipt",
    /vy_receipt:\s*\n\s*"person-keyed/.test(relcheckSrc));

  const erasureSrc = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
  ok("§6 a full REPLICA erasure DOES delete vy_receipt by name, child-before-parent",
    /delete from vy_receipt x using target t/.test(erasureSrc));
  ok("§6 the receipts delete sits BEFORE the payment_events delete (child before parent)",
    erasureSrc.indexOf("delete from vy_receipt x using target t") < erasureSrc.indexOf("delete from vy_payment_event x using target t"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 WS-R130 (migration 133) — the referral reward's own zero-amount receipt");
// ═════════════════════════════════════════════════════════════════════════
{
  // THE BUILDER RENDERS THE REWARD LINE, NEVER THE ORDINARY ONE, for a
  // `kind: 'referral_reward'` event — the SAME `buildReceiptContext`/
  // `buildReceiptHtml` this suite's §3 already proves for a real charge,
  // branching on `paymentEvent.kind` alone (`api/_receipt.js`'s own new
  // header names why: `amount_inr: 0` already makes every OTHER number
  // come out zero unchanged).
  const rewardEvent = { event_id: "evt_reward_1", amount_inr: 0, kind: "referral_reward" };
  const receiptRow = { receipt_no: 7, issued_at: "2026-09-10T00:00:00.000Z" };
  const roomPublic = { name: "Anjali" };
  const ctxEn = buildReceiptContext({ paymentEvent: rewardEvent, receipt: receiptRow, room: roomPublic, locale: "en" });
  ok("§7 a reward receipt's plan line names the free month, not the ordinary membership line",
    ctxEn.plan_line === "Anjali AI - one free month (referral reward)", ctxEn.plan_line);
  ok("§7 a reward receipt's total is honestly zero", ctxEn.amount_inr === 0 && ctxEn.split.total_tax_inr === 0);
  const ctxHi = buildReceiptContext({ paymentEvent: rewardEvent, receipt: receiptRow, room: roomPublic, locale: "hi" });
  ok("§7 the reward line exists in Hindi too", ctxHi.plan_line.includes("मुफ़्त"));
  const htmlReward = buildReceiptHtml(ctxEn);
  ok("§7 the printable page actually contains the reward line", htmlReward.includes("one free month"));

  // A REAL CHARGE's receipt is BYTE-UNCHANGED by this branch — the
  // negative control this addition needs: `kind` absent (every receipt
  // built before this workstream never set it) still renders the
  // ORDINARY plan line, never the reward one by accident.
  const ordinaryEvent = { event_id: "evt_ordinary_1", amount_inr: 39900 };
  const ctxOrdinary = buildReceiptContext({ paymentEvent: ordinaryEvent, receipt: receiptRow, room: roomPublic, locale: "en" });
  ok("NEGATIVE CONTROL: an ordinary event with no kind at all still renders the ORDINARY plan line",
    ctxOrdinary.plan_line === "Anjali AI - monthly membership", ctxOrdinary.plan_line);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§8 WS-R130 (migration 133) — the credit/reward tables' own forget doors, proven statically");
// ═════════════════════════════════════════════════════════════════════════
{
  const memorySrc = readFileSync(join(REPO, "api/memory.js"), "utf8");
  for (const table of ["vy_room_referral_credit", "vy_room_referral_reward"]) {
    ok(`§8 api/memory.js contains the explicit door for ${table}, gated on the table existing`,
      new RegExp(`tableApplied\\("${table}"\\)`).test(memorySrc));
    ok(`§8 the ${table} door is an UPDATE that NULLS referrer_person_id, never a DELETE of the row`,
      new RegExp(`update ${table} set referrer_person_id = null where referrer_person_id = \\$1`).test(memorySrc));
    ok(`§8 ${table} is NOT listed in PERSON_TABLES (it would be blind-DELETEd by the generic loop if it were)`,
      !new RegExp(`\\{ table: "${table}"`).test(memorySrc.slice(0, memorySrc.indexOf("export async function tableApplied"))));
  }

  const erasureSrc = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
  ok("§8 a full REPLICA erasure DOES delete vy_room_referral_credit by name",
    /delete from vy_room_referral_credit x using target t/.test(erasureSrc));
  ok("§8 a full REPLICA erasure DOES delete vy_room_referral_reward by name",
    /delete from vy_room_referral_reward x using target t/.test(erasureSrc));
  ok("§8 both sit BEFORE the rooms delete (child before parent)",
    erasureSrc.indexOf("delete from vy_room_referral_credit x using target t") < erasureSrc.indexOf("rooms as (delete from vy_room x using target t") &&
    erasureSrc.indexOf("delete from vy_room_referral_reward x using target t") < erasureSrc.indexOf("rooms as (delete from vy_room x using target t"));
}

console.log(`\nroom-receipt: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
