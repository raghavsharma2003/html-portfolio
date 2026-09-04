// WS-R20. Handoff v0's own offline suite.
//
//   node evals/handoff/run.mjs
//
// Drives the REAL api/_handoff.js through a fake `db` (evals/handoff/fixtures.mjs,
// which wraps evals/room/fixtures.mjs's own `fakeDb` rather than reimplementing
// room/follower/thread behaviour - `evals/pulse/fixtures.mjs`'s own precedent).
// Offline, deterministic, $0, no DB, no network, no model call.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SLUG, ROOM_ID, AGENT_ID, REPLICA_ID, OWNER, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent, freshState, fakeDb, fakeMemory,
} from "../room/fixtures.mjs";
import { freshHandoffState, handoffDb } from "./fixtures.mjs";
import { joinRoom, roomThreadDevice, createThread, RoomError } from "../../api/_room-surface.js";
import {
  HandoffError,
  getHandoffConfig, setHandoffConfig, handoffQueue, answerHandoff,
  draftHandoffPayload, sendHandoffRequest, withdrawHandoffRequest, myHandoffs,
} from "../../api/_handoff.js";

process.env.ROOM_SESSION_SECRET = "r".repeat(48);

const REPO = new URL("../..", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");
const codeOf = async (fn) => {
  try { await fn(); return null; }
  catch (e) { return e instanceof HandoffError || e instanceof RoomError ? e.code : `unexpected:${e?.message}`; }
};

const { loadAgent } = await loadFixtureAgent(REPO);

function world() {
  const state = freshHandoffState(freshState());
  const db = handoffDb(state, fakeDb(state));
  return { state, db };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── owner config: off by default, a real toggle ──");
{
  const { db } = world();
  const before = await getHandoffConfig(db, OWNER, REPLICA_ID);
  ok("a fresh room has handoff off, cap at the migration's own default (5)",
    before.enabled === false && before.monthly_cap === 5);
  const after = await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 2 });
  ok("the owner can turn it on and set the cap", after.enabled === true && after.monthly_cap === 2);
  const code = await codeOf(() => setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 51 }));
  ok("a cap outside the migration's own 0-50 band is refused by name", code === "handoff_cap_invalid");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── draft: exact bytes and a hash that matches them ──");
{
  const { state, db } = world();
  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 5 });
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });

  const draft = await draftHandoffPayload(db, { session: joined.session, note: "please call me back today" }, { loadAgent });
  ok("a fresh-note draft returns the exact trimmed text",
    draft.payload_text === "please call me back today");
  ok("the draft's hash is sha256 of the exact returned text, not merely well-formed",
    draft.payload_sha256 === sha256Hex(draft.payload_text) && /^[0-9a-f]{64}$/.test(draft.payload_sha256));

  // message-pick path: seed the follower's OWN thread device with two turns
  // through `fakeMemory`, the same seam `roomSay` itself uses in production.
  const log = [];
  const memory = fakeMemory(log);
  const device = roomThreadDevice(ROOM_ID, PERSON_A, null);
  await memory.logTurn({ device, role: "me", content: "my card was charged twice" });
  await memory.logTurn({ device, role: "her", content: "let me look into that for you" });
  await memory.logTurn({ device, role: "me", content: "thank you, it happened yesterday" });
  const picked = await draftHandoffPayload(
    db, { session: joined.session, messageIndexes: [0, 1] }, { loadAgent, memory },
  );
  ok("message-pick draft carries only the follower's OWN messages, in order, never the AI's",
    picked.payload_text === "my card was charged twice\n\nthank you, it happened yesterday");
  ok("message-pick draft's hash matches its own exact text",
    picked.payload_sha256 === sha256Hex(picked.payload_text));

  const emptyCode = await codeOf(() => draftHandoffPayload(db, { session: joined.session, note: "   " }, { loadAgent }));
  ok("an empty note is refused rather than sent as a blank payload", emptyCode === "handoff_payload_empty");
  void state;
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── send: refused by name when disabled, over cap, or by a session that does not match this room ──");
{
  const { db } = world();
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const draft = await draftHandoffPayload(db, { session: joined.session, note: "hello" }, { loadAgent }).catch(() => null);
  // handoff is OFF (fresh room) - draft itself refuses first, by name.
  ok("draft refuses on a Room with handoff off, by name", draft === null);
  const draftCode = await codeOf(() => draftHandoffPayload(db, { session: joined.session, note: "hello" }, { loadAgent }));
  ok("...specifically handoff_disabled", draftCode === "handoff_disabled");
  const sendCode = await codeOf(() =>
    sendHandoffRequest(db, { session: joined.session, payloadText: "hello", payloadSha256: sha256Hex("hello") }, { loadAgent }));
  ok("send refuses on a Room with handoff off, by name (handoff_disabled)", sendCode === "handoff_disabled");

  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 1 });
  const first = await sendHandoffRequest(
    db, { session: joined.session, payloadText: "first ask", payloadSha256: sha256Hex("first ask") }, { loadAgent },
  );
  ok("the first request within the cap succeeds and lands 'sent'", first.state === "sent");
  const overCapCode = await codeOf(() =>
    sendHandoffRequest(db, { session: joined.session, payloadText: "second ask", payloadSha256: sha256Hex("second ask") }, { loadAgent }));
  ok("a second request past a cap of 1 is refused by name (handoff_cap_reached)", overCapCode === "handoff_cap_reached");

  const hashMismatchCode = await codeOf(() =>
    sendHandoffRequest(db, { session: joined.session, payloadText: "real text", payloadSha256: sha256Hex("different text") }, { loadAgent }));
  ok("a payload whose hash does not match its own text is refused before ever reaching the insert",
    hashMismatchCode === "handoff_payload_hash_mismatch");

  // "the follower is another Room's": a thread_id that is REAL but belongs
  // to a DIFFERENT follower is refused by the same predicate that scopes
  // every thread read in this repo (`ownedThread`, room+person+agent
  // together, not merely "does this uuid exist"). Raise the cap back up
  // first - A already spent their cap-of-1 above, and this test is about
  // thread scoping, not the cap.
  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 10 });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });
  const bThread = await createThread(db, { roomId: ROOM_ID, personId: PERSON_B, agentId: AGENT_ID, title: "B's own thread" });
  const foreignThreadCode = await codeOf(() =>
    sendHandoffRequest(
      db,
      { session: joined.session, payloadText: "not my thread", payloadSha256: sha256Hex("not my thread"), threadId: bThread.thread_id },
      { loadAgent },
    ));
  ok("A sending against B's real thread_id is refused (room_thread_unknown), never silently reassigned",
    foreignThreadCode === "room_thread_unknown");

  const unknownThreadCode = await codeOf(() =>
    sendHandoffRequest(
      db,
      { session: joinedB.session, payloadText: "no such thread", payloadSha256: sha256Hex("no such thread"), threadId: "99999999-0000-4000-8000-000000000099" },
      { loadAgent },
    ));
  ok("a thread_id that does not exist at all is refused the same way (room_thread_unknown)",
    unknownThreadCode === "room_thread_unknown");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── queue: counts first, then only hash-matched 'sent' rows, one at a time ──");
{
  const { state, db } = world();
  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 10 });
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });

  const a1 = await sendHandoffRequest(db, { session: joinedA.session, payloadText: "A asks first", payloadSha256: sha256Hex("A asks first") }, { loadAgent });
  const b1 = await sendHandoffRequest(db, { session: joinedB.session, payloadText: "B asks second", payloadSha256: sha256Hex("B asks second") }, { loadAgent });
  void b1;

  const q1 = await handoffQueue(db, OWNER, REPLICA_ID);
  ok("queue counts are exactly {sent:2}", q1.counts.sent === 2 && q1.counts.answered === 0 && q1.counts.withdrawn === 0);
  ok("queue's 'next' is the OLDEST sent row, one at a time", q1.next?.handoff_id === a1.handoff_id && q1.next.payload_text === "A asks first");

  // NEGATIVE CONTROL (a): tamper the stored text in a copy, hash untouched.
  const tampered = state.roomHandoffs.find((h) => h.handoff_id === a1.handoff_id);
  const realText = tampered.payload_text;
  tampered.payload_text = "an attacker's substituted words";
  const qTampered = await handoffQueue(db, OWNER, REPLICA_ID);
  ok("NEGATIVE CONTROL (a): a tampered row (text changed, hash not) is never returned as 'next'",
    qTampered.next?.handoff_id !== a1.handoff_id);
  ok("...the untampered B row surfaces instead, proving the scan is not vacuous",
    qTampered.next?.handoff_id === b1.handoff_id);
  const answerTamperedCode = await codeOf(() =>
    answerHandoff(db, OWNER, REPLICA_ID, a1.handoff_id, { replyText: "trying to answer the tampered row" }));
  ok("the SAME predicate refuses to let the tampered row be ANSWERED, not only read",
    answerTamperedCode === "handoff_not_answerable");
  tampered.payload_text = realText; // restore for the tests below

  // NEGATIVE CONTROL (b): a message the follower said in ordinary chat, never
  // submitted through `send`, must never appear in any creator-facing read -
  // evals/room-leak's own `leakedTokens` technique, applied to this table.
  const UNREQUESTED = "TOKUNREQUESTED_never_sent_to_anyone";
  const log = [];
  const memory = fakeMemory(log);
  await memory.logTurn({ device: roomThreadDevice(ROOM_ID, PERSON_A, null), role: "me", content: UNREQUESTED });
  const qAfterChat = await handoffQueue(db, OWNER, REPLICA_ID);
  ok("NEGATIVE CONTROL (b): a chat message never submitted via send() never appears in the queue",
    !JSON.stringify(qAfterChat).includes(UNREQUESTED));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── answer: lands once, in the right follower's own scope, never another's ──");
{
  const { db } = world();
  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 5 });
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });
  const sent = await sendHandoffRequest(db, { session: joinedA.session, payloadText: "A's real ask", payloadSha256: sha256Hex("A's real ask") }, { loadAgent });

  const answered = await answerHandoff(db, OWNER, REPLICA_ID, sent.handoff_id, { replyText: "here is my answer, A" });
  ok("answering succeeds against the real sent row", answered.state === "answered");
  const answerAgainCode = await codeOf(() =>
    answerHandoff(db, OWNER, REPLICA_ID, sent.handoff_id, { replyText: "trying to answer twice" }));
  ok("the SAME row cannot be answered a second time (state is no longer 'sent')", answerAgainCode === "handoff_not_answerable");

  const mineA = await myHandoffs(db, { session: joinedA.session }, { loadAgent });
  ok("the reply lands in A's OWN read, marked answered with the reply text present",
    mineA[0]?.state === "answered" && mineA[0]?.reply_text === "here is my answer, A");

  const mineB = await myHandoffs(db, { session: joinedB.session }, { loadAgent });
  ok("the reply NEVER appears in B's own read - not the request, not the reply", mineB.length === 0);

  const withdrawCode = await codeOf(() => withdrawHandoffRequest(db, { session: joinedA.session, handoffId: sent.handoff_id }, { loadAgent }));
  ok("an answered request can no longer be withdrawn", withdrawCode === "handoff_not_withdrawable");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── withdraw: the follower's own, before answered ──");
{
  const { db } = world();
  await setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 5 });
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const sent = await sendHandoffRequest(db, { session: joinedA.session, payloadText: "changed my mind soon", payloadSha256: sha256Hex("changed my mind soon") }, { loadAgent });
  const withdrawn = await withdrawHandoffRequest(db, { session: joinedA.session, handoffId: sent.handoff_id }, { loadAgent });
  ok("withdrawal succeeds on a follower's own sent-not-yet-answered row", withdrawn.state === "withdrawn");
  const q = await handoffQueue(db, OWNER, REPLICA_ID);
  ok("a withdrawn row never surfaces as the owner's 'next'", q.next === null);
  const capAfterWithdraw = await sendHandoffRequest(
    db, { session: joinedA.session, payloadText: "one more, please", payloadSha256: sha256Hex("one more, please") }, { loadAgent },
  );
  ok("a withdrawn request does not count against the monthly cap", capAfterWithdraw.state === "sent");
}

console.log(`\nhandoff: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
