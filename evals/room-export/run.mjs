// WS-R27. THE EXPORT COMPLETENESS BATTERY — the 16th named release gate.
//
//   node evals/room-export/run.mjs
//
// Two things were missing since WS-R1 for "export and forget" (api/
// _room-surface.js's `roomExport`/`roomForget`) to be trustworthy rather than
// merely present, and this battery proves both:
//
//   1. A FORGET RECEIPT. `roomForget` returned counts and then nothing a
//      follower could keep - unlike a replica's own erasure
//      (`vy_replica_deletion_receipt`, migration 015), a Room forget left no
//      row behind at all. Migration 090 adds `vy_room_forget_receipt`; this
//      battery proves it is written, content-free, and its counts are real.
//   2. EXPORT/FORGET COMPLETENESS. Nine person-lane Room tables landed after
//      WS-R1's original two, and nothing proved `roomExport` named all of
//      them or `roomForget` cleared all of them. STATIC (layer 1): every
//      `PERSON_TABLES` entry that carries both `room_id` and `person_id` in
//      the checked-in DDL must be named by `roomExportManifest()`. DYNAMIC
//      (layer 2): a real world through the real follower lane, one follower
//      touching every surface, `roomExport` must contain a row/count from
//      each, `roomForget` must leave zero rows in every one of them for that
//      person, and the receipt's counts must equal what was deleted.
//
// Offline, deterministic, $0, no DB, no network, no model call. Reuses
// `evals/room/fixtures.mjs` (WS-R1's fake db) through this suite's OWN
// wrapper (`evals/room-export/fixtures.mjs`) rather than editing the shared
// file - see that file's own header for why.
import fs from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSchema } from "../sqlcast/schema.mjs";
import {
  PERSON_TABLES, roomForgetReceiptHash, ROOM_FORGET_RECEIPT_POLICY_VERSION, purgeRoomForgetReceipts,
} from "../../api/memory.js";
import { freshExportState, exportDb, ROOM_ID } from "./fixtures.mjs";
import { loadFixtureAgent, SLUG } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "e".repeat(48);

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, createThread, readRoomSession, roomExport, roomForget, roomExportManifest } = room;
const { loadAgent } = await loadFixtureAgent(REPO);

const UID = "60000000-0000-4000-a000-000000000001";
const FACT_TOKEN = "TOKFACT_EXPORT_zzzzzzzz";

// The deps every call below shares: the REAL PERSON_TABLES manifest (not a
// stripped fixture - `evals/room-leak/run.mjs`'s own reason for using a
// narrow one does not apply here, since completeness IS the question this
// suite asks) and `tableApplied` forced true, standing in for "every
// migration through 090 has landed", the offline seam `roomForget` and
// `roomExport` already use for exactly this purpose.
const FULL_DEPS = { loadAgent, personTables: async () => PERSON_TABLES, tableApplied: async () => true };

// ═════════════════════════════════════════════════════════════════════════
// LAYER 1 — STATIC. Every PERSON_TABLES entry with both room_id and
// person_id in the checked-in DDL must be named by roomExportManifest().
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 1: static (DDL scan vs roomExportManifest) ──");

const schema = loadSchema(REPO);
ok(`DDL parse found ${Object.keys(schema).length} tables (expected 100+)`, Object.keys(schema).length >= 100);

/** Every PERSON_TABLES table that carries BOTH room_id and person_id columns
 *  in `schema` - the workstream brief's own words, made a pure function so
 *  the negative control below can run it against a DELIBERATELY WRONG input
 *  without touching a single real file. */
function roomPersonEntries(personTables, schemaMap) {
  return personTables
    .map((t) => t.table)
    .filter((name) => {
      const cols = schemaMap[name];
      return cols && "room_id" in cols && "person_id" in cols;
    });
}

/** The problems: every table `roomPersonEntries` finds that `covered` (the
 *  real `roomExportManifest()`'s own returned table list) does not name. */
function staticProblems(personTables, schemaMap, covered) {
  const coveredSet = new Set(covered);
  return roomPersonEntries(personTables, schemaMap).filter((t) => !coveredSet.has(t));
}

const realCovered = await roomExportManifest(FULL_DEPS);
ok("roomExportManifest() returns a non-trivial list (not vacuously empty)", realCovered.length >= 11,
  `got ${realCovered.length}: ${realCovered.join(",")}`);

const realProblems = staticProblems(PERSON_TABLES, schema, realCovered);
ok("every PERSON_TABLES entry carrying room_id+person_id is named by roomExportManifest()",
  realProblems.length === 0, realProblems.join(","));

// The nine tables WS-R27's own brief names, present by name rather than only
// by count - a sanity floor against "the count matched by accident."
const EXPECTED = [
  "vy_room_thread", "vy_room_follower", "vy_room_follower_day", "vy_room_checkin",
  "vy_room_checkin_delivery", "vy_room_voice_usage", "vy_room_subscription",
  "vy_room_pulse_optin", "vy_room_follower_channel", "vy_room_push_subscription",
  "vy_room_handoff",
];
const missingExpected = EXPECTED.filter((t) => !realCovered.includes(t));
ok("all eleven named Room-scoped person tables are in roomExportManifest()'s coverage",
  missingExpected.length === 0, missingExpected.join(","));

// NEGATIVE CONTROL (a): a fake person-lane table with room_id+person_id,
// added to a COPY of PERSON_TABLES and a COPY of the schema map (never the
// real files) - the static check MUST report it as uncovered.
{
  const fakeTable = "vy_room_fake_negative_control";
  const fakePersonTables = [...PERSON_TABLES, { table: fakeTable, key: "person_id", lane: "relational" }];
  const fakeSchema = { ...schema, [fakeTable]: { room_id: "uuid", person_id: "uuid" } };
  const problems = staticProblems(fakePersonTables, fakeSchema, realCovered);
  ok("NEGATIVE CONTROL (a): a fake person-lane table added to a COPY of the manifest is caught as uncovered",
    problems.includes(fakeTable),
    problems.includes(fakeTable) ? "" : "control did not fire — the static check would have shipped a blind spot");
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 2 — DYNAMIC. One follower through the real follower lane, touching
// every surface. roomExport must carry a row/count from each; roomForget
// must leave zero; the receipt's counts must equal what was deleted.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 2: dynamic (a real world through the real follower lane) ──");

/** Seeds every one of the (now ten, WS-R67's own addition) extra tables plus
 *  one agent-scoped fact, for ONE follower. Subscription is seeded in a
 *  TERMINAL state ('cancelled') -
 *  `vy_room_subscription`'s own PERSON_TABLES `wipeWhere` restriction, and
 *  `roomForget`'s own new statement, both restated: neither wipe may remove
 *  a LIVE mandate's row, so a world proving "forget leaves zero rows" must
 *  hand it a subscription that is honestly safe to delete. */
function seedEverySurface(state, { roomId, personId, threadId, agentId }) {
  state.facts.push({ person_id: personId, agent_id: agentId, body: `note: ${FACT_TOKEN}` });
  state.followerDays.push({ room_id: roomId, person_id: personId, day: "2026-09-01", turns: 3 });
  state.checkins.push({
    checkin_id: "70000000-0000-4000-a000-000000000001", room_id: roomId, person_id: personId,
    days_of_week: [1, 3, 5], local_time: "09:00", timezone: "Asia/Kolkata", state: "active",
  });
  state.checkinDeliveries.push({
    delivery_id: "70000000-0000-4000-a000-000000000002", room_id: roomId, person_id: personId,
    state: "delivered",
  });
  state.voiceUsages.push({ room_id: roomId, person_id: personId, day: "2026-09-01", seconds: 42, clips: 2 });
  state.subscriptions.push({
    subscription_id: "70000000-0000-4000-a000-000000000003", room_id: roomId, person_id: personId,
    provider: "razorpay", state: "cancelled",
  });
  state.pulseOptinsX.push({ optin_id: "70000000-0000-4000-a000-000000000004", room_id: roomId, person_id: personId, thread_id: threadId });
  state.channelMap.push({
    channel_map_id: "70000000-0000-4000-a000-000000000005", room_id: roomId, person_id: personId,
    channel: "telegram", channel_ref: "tg-chat-9001",
  });
  state.pushSubscriptions.push({
    subscription_id: "70000000-0000-4000-a000-000000000006", room_id: roomId, person_id: personId,
    endpoint: "https://push.example/ep1", p256dh: "p", auth: "a",
  });
  state.roomHandoffs.push({
    handoff_id: "70000000-0000-4000-a000-000000000007", room_id: roomId, person_id: personId,
    payload_text: "please can a human reply", state: "sent",
  });
  // WS-R67 (migration 116). The FOLLOWER lane only - `EXTRA_STATE_KEYS`'s
  // own header explains why the creator's mirror is absent from this whole
  // file.
  state.followerReplyFlags.push({
    flag_id: "70000000-0000-4000-a000-000000000008", room_id: roomId, person_id: personId,
    reply_sha256: "a".repeat(64), reason: "wrong",
  });
}

/** Every extra-table state array WS-R27 added, keyed by the manifest table
 *  name each one stands in for - the single source both the main run and the
 *  struck-copy negative control below scan for survivors. */
const EXTRA_STATE_KEYS = {
  vy_room_follower_day: "followerDays",
  vy_room_checkin: "checkins",
  vy_room_checkin_delivery: "checkinDeliveries",
  vy_room_voice_usage: "voiceUsages",
  vy_room_subscription: "subscriptions",
  vy_room_pulse_optin: "pulseOptinsX",
  vy_room_push_subscription: "pushSubscriptions",
  vy_room_handoff: "roomHandoffs",
  vy_room_follower_reply_flag: "followerReplyFlags",
};

function survivorTables(state, roomId, personId) {
  const survivors = [];
  for (const [table, key] of Object.entries(EXTRA_STATE_KEYS)) {
    if (state[key].some((r) => r.room_id === roomId && r.person_id === personId)) survivors.push(table);
  }
  if (state.channelMap.some((c) => c.room_id === roomId && c.person_id === personId)) survivors.push("vy_room_follower_channel");
  if (state.followers.some((f) => f.room_id === roomId && f.person_id === personId)) survivors.push("vy_room_follower");
  if (state.threads.some((t) => t.room_id === roomId && t.person_id === personId)) survivors.push("vy_room_thread");
  if (state.facts.some((f) => f.person_id === personId)) survivors.push("vy_fact");
  return survivors;
}

async function runRealWorld() {
  const state = freshExportState();
  const db = exportDb(state);
  const joined = await joinRoom(db, { slug: SLUG, authUserId: UID, ageAttested: true, memoryConsent: true }, { loadAgent });
  const payload = readRoomSession(joined.session);
  const roomId = String(payload.i);
  const personId = String(payload.p);
  const agentId = String(payload.a);
  const thread = await createThread(db, { roomId, personId, agentId, title: "getting started" });

  seedEverySurface(state, { roomId, personId, threadId: thread?.thread_id, agentId });

  // WS-R75 (migration 119). No new table - `dormancy_notice_at` rides the
  // EXISTING `vy_room_follower` row, already reached by roomScopedTables()'s
  // own generic `select *` (this file's own header names the mechanism).
  // Set directly on the fixture's own follower row rather than through a
  // new insert path, since no op in this codebase writes this column except
  // the sweep and joinRoom's own defensive clear - neither of which this
  // suite's world otherwise exercises.
  const followerRow = state.followers.find((f) => f.person_id === personId);
  followerRow.dormancy_notice_at = "2026-09-01T00:00:00.000Z";

  const dump = await roomExport(db, { session: joined.session }, FULL_DEPS);
  ok("roomExport's vy_room_follower row carries dormancy_notice_at when set - no code change needed, the generic select * already carries it",
    Array.isArray(dump.tables.vy_room_follower) && dump.tables.vy_room_follower[0]?.dormancy_notice_at === "2026-09-01T00:00:00.000Z");
  const EXPECT_IN_EXPORT = [
    "vy_room_thread", "vy_room_follower", "vy_room_checkin", "vy_room_subscription",
    "vy_room_pulse_optin", "vy_room_follower_channel", "vy_room_push_subscription",
    "vy_room_handoff", "vy_room_follower_day", "vy_room_checkin_delivery", "vy_room_voice_usage",
    // WS-R67 (migration 116).
    "vy_room_follower_reply_flag",
  ];
  const missingFromExport = EXPECT_IN_EXPORT.filter((t) => !dump.tables[t]);
  ok("roomExport contains a row/count from every one of the ten extra tables (plus the thread)",
    missingFromExport.length === 0, missingFromExport.join(","));
  ok("roomExport's vy_fact rows carry this follower's own token (the world is not vacuous)",
    JSON.stringify(dump.tables.vy_fact ?? "").includes(FACT_TOKEN));
  ok("roomExport's COUNT-shape entries are counts, never rows (vy_room_follower_day)",
    typeof dump.tables.vy_room_follower_day?.count === "number" && dump.tables.vy_room_follower_day.count === 3);
  ok("roomExport's ROWS-shape entries are the real rows (vy_room_handoff carries the verbatim ask)",
    Array.isArray(dump.tables.vy_room_handoff) &&
      dump.tables.vy_room_handoff[0]?.payload_text === "please can a human reply");

  const receipt = await roomForget(db, { session: joined.session }, FULL_DEPS);
  ok("roomForget returns a receipt (migration 090 treated as applied)", Boolean(receipt.receipt));
  ok("the receipt names no person - no person_id/person anywhere on it",
    !("person_id" in receipt.receipt) && JSON.stringify(receipt.receipt).includes(personId) === false);
  ok("the receipt's person_hash is a 64-hex SHA-256", /^[0-9a-f]{64}$/.test(receipt.receipt.person_hash));
  const expectedHash = roomForgetReceiptHash(roomId, personId, ROOM_FORGET_RECEIPT_POLICY_VERSION);
  ok("the receipt's person_hash matches roomForgetReceiptHash recomputed independently",
    receipt.receipt.person_hash === expectedHash);
  ok("the receipt was actually written to the table (the fixture's own insert matcher fired)",
    (state.forgetReceipts ?? []).length === 1);

  ok("the receipt's counts equal the response's own deleted counts, table for table",
    JSON.stringify(receipt.receipt.counts) === JSON.stringify(receipt.deleted));

  for (const t of EXPECT_IN_EXPORT) {
    ok(`roomForget's counts for ${t} are a real positive number, not a phantom zero`,
      Number(receipt.deleted[t]) > 0, String(receipt.deleted[t]));
  }
  // vy_room_subscription's count is capped by the terminal-state restriction
  // - this world seeded exactly one CANCELLED subscription, so 1 is the
  // honest number, matching the wipeWhere restriction rather than merely a
  // positive one.
  ok("vy_room_subscription's deleted count is exactly 1 (the one terminal-state row this world seeded)",
    receipt.deleted.vy_room_subscription === 1);

  const survivors = survivorTables(state, roomId, personId);
  ok("roomForget leaves ZERO rows in every one of these tables for this person",
    survivors.length === 0, survivors.join(","));

  return { state, roomId, personId };
}

await runRealWorld();

// ═════════════════════════════════════════════════════════════════════════
// LAYER 3 — NEGATIVE CONTROL (b). A copy of roomForget with ONE delete
// struck must be caught by the survivor scan above.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 3: negative control (b) — a struck copy of roomForget ──");
{
  const src = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const needle =
    `    const pushRows = await db(\n` +
    `      \`delete from vy_room_push_subscription\n` +
    `        where room_id = ($1)::uuid and person_id = ($2)::uuid\n` +
    `       returning 1 as gone\`,\n` +
    `      [who.roomId, who.personId],\n` +
    `    );\n` +
    `    deleted.vy_room_push_subscription = pushRows.length;`;
  ok("the real source contains the exact block this control strikes (not moved/renamed)", src.includes(needle));
  const struck = src.replace(
    needle,
    `    deleted.vy_room_push_subscription = 0; // STRUCK: the delete itself removed`,
  );
  ok("the strike actually changed the source (the control is not a no-op)", struck !== src);

  const outDir = mkdtempSync(join(tmpdir(), "room-export-strike-"));
  void outDir;
  const struckPath = join(REPO, "api", `_room-surface.STRUCK-${Date.now()}.mjs`);
  writeFileSync(struckPath, struck);
  try {
    const struckModule = await import(pathToFileURL(struckPath).href);
    const state = freshExportState();
    const db = exportDb(state);
    const joined = await struckModule.joinRoom(db, { slug: SLUG, authUserId: UID, ageAttested: true, memoryConsent: true }, { loadAgent });
    const payload = readRoomSession(joined.session);
    const roomId = String(payload.i);
    const personId = String(payload.p);
    const agentId = String(payload.a);
    seedEverySurface(state, { roomId, personId, threadId: null, agentId });

    const receipt = await struckModule.roomForget(db, { session: joined.session }, FULL_DEPS);
    ok("NEGATIVE CONTROL (b): the struck copy's receipt claims zero push subscriptions deleted",
      receipt.deleted.vy_room_push_subscription === 0);

    const survivors = survivorTables(state, roomId, personId);
    ok("NEGATIVE CONTROL (b): the survivor scan CATCHES the row the struck copy left behind",
      survivors.includes("vy_room_push_subscription"),
      survivors.includes("vy_room_push_subscription") ? "" : "control did not fire — the completeness check would have shipped a silent survivor");
    ok("NEGATIVE CONTROL (b): every OTHER table the struck copy did not touch is still correctly cleared",
      survivors.length === 1 && survivors[0] === "vy_room_push_subscription", survivors.join(","));
  } finally {
    rmSync(struckPath, { force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 4 — RECEIPT SURVIVOR (WS-R32, closes ws-r27-whole-wipe-receipt-
// read-capped-at-10000). A person forgets Room A (a receipt is written,
// Room A's own follower row is deleted), then joins Room B - a DIFFERENT
// room, so the person's only CURRENT follower row now points at B, not A -
// then the account-wide whole wipe's own receipt door runs, and Room A's
// receipt must be gone even though no follower row names Room A any more.
// This is the exact case a walk over "the rooms this person currently
// follows" would silently miss, and the exact case `purgeRoomForgetReceipts`
// exists to reach instead, by walking every `vy_room` row this database has.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 4: receipt survivor (WS-R32) ──");
{
  const UID2 = "60000000-0000-4000-a000-000000000002";
  const state = freshExportState();
  const db = exportDb(state);

  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: UID2, ageAttested: true, memoryConsent: true }, { loadAgent });
  const payloadA = readRoomSession(joinedA.session);
  const roomIdA = String(payloadA.i);
  const personId = String(payloadA.p);

  const forgetA = await roomForget(db, { session: joinedA.session }, FULL_DEPS);
  ok("Room A's forget wrote a receipt", Boolean(forgetA.receipt));
  ok("Room A's follower row is really gone after the forget",
    !state.followers.some((f) => f.room_id === roomIdA && f.person_id === personId));

  // Room B - a second, DIFFERENT room the same person now follows. The same
  // demo sheet is reused (this scenario is not about modelling a second
  // creator) - only the room_id and slug differ, and `loadAgentAnySlug`
  // sidesteps `loadFixtureAgent`'s own single-slug check by always handing
  // back the one demo sheet regardless of which slug asked for it.
  const ROOM_ID_B = "d0000000-0000-4000-8000-00000000000b";
  const roomA = state.rooms.find((r) => r.room_id === roomIdA);
  state.rooms.push({ ...roomA, room_id: ROOM_ID_B, slug: "anjali-b" });
  const loadAgentAnySlug = async () => loadAgent(SLUG);
  const joinedB = await joinRoom(db, { slug: "anjali-b", authUserId: UID2, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentAnySlug });
  const payloadB = readRoomSession(joinedB.session);
  ok("Room B's join produced a follower row for the SAME person", String(payloadB.p) === personId);
  ok("the person's only CURRENT follower row is in Room B, not Room A",
    state.followers.some((f) => f.person_id === personId && f.room_id === String(payloadB.i)) &&
      !state.followers.some((f) => f.person_id === personId && f.room_id === roomIdA));

  // The whole wipe's own door.
  const removed = await purgeRoomForgetReceipts(db, personId);
  ok("the whole wipe removed exactly one receipt - Room A's", removed === 1, `got ${removed}`);
  ok("Room A's receipt is gone from the table even though no follower row named Room A any more",
    !state.forgetReceipts.some((r) => r.room_id === roomIdA));

  // NEGATIVE CONTROL: a stray receipt hashed for a DIFFERENT person, in a
  // THIRD room this person never touched, must be left standing - a room
  // this person was never in cannot produce a hash collision with theirs.
  const ROOM_ID_C = "d0000000-0000-4000-8000-00000000000c";
  state.rooms.push({ ...roomA, room_id: ROOM_ID_C, slug: "third-room" });
  const strayHash = roomForgetReceiptHash(ROOM_ID_C, "someone-else-entirely", ROOM_FORGET_RECEIPT_POLICY_VERSION);
  state.forgetReceipts.push({
    receipt_id: "d0000000-0000-4000-8000-0000000000fc",
    room_id: ROOM_ID_C,
    person_hash: strayHash,
    policy_version: ROOM_FORGET_RECEIPT_POLICY_VERSION,
    counts: {},
    issued_at: new Date().toISOString(),
  });
  const removedAgain = await purgeRoomForgetReceipts(db, personId);
  ok("NEGATIVE CONTROL: a stray receipt hashed for a DIFFERENT person is untouched", removedAgain === 0, `got ${removedAgain}`);
  ok("...and it is still in the table", state.forgetReceipts.some((r) => r.receipt_id === "d0000000-0000-4000-8000-0000000000fc"));

  // STATIC: the old bounded-by-receipts read is really gone, and the whole
  // wipe really calls through the new bounded-by-Rooms function.
  const src = fs.readFileSync(join(REPO, "api/memory.js"), "utf8");
  ok("api/memory.js no longer reads vy_room_forget_receipt with a limit 10000",
    !/vy_room_forget_receipt[\s\S]{0,120}limit 10000/.test(src));
  ok("purgeRelational's scope \"all\" branch calls purgeRoomForgetReceipts(q, person)",
    /purgeRoomForgetReceipts\(q, person\)/.test(src));
  ok("the migration for the new index exists and mirrors into schema.sql",
    fs.readFileSync(join(REPO, "db/migrations/094_receipt_hash_index.sql"), "utf8")
      .includes("create index if not exists vy_room_forget_receipt_person_hash_ix") &&
    fs.readFileSync(join(REPO, "db/schema.sql"), "utf8")
      .includes("create index if not exists vy_room_forget_receipt_person_hash_ix"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n── verdict ──`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("room-export: FAILED");
  process.exit(1);
}
console.log("room-export: ok");
