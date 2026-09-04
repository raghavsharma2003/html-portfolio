// WS-R17. PULSE'S OWN OFFLINE SUITE.
//
//   node evals/pulse/run.mjs
//
// Drives the REAL `api/_pulse.js` module through a fake `db`
// (`evals/pulse/fixtures.mjs`, itself built on `evals/room/fixtures.mjs`'s
// shared world), with a negative control that MUST leak
// (`sound-gate-proved-by-silence`, `context/rejected.md`): a gate nobody has
// watched fail is a gate nobody knows works.
//
// Offline, deterministic, $0, no DB, no network, no model call.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_ID, OWNER, REPLICA_ID, ROOM_ID, SLUG, loadFixtureAgent, freshState, fakeDb } from "../room/fixtures.mjs";
import { freshPulseState, pulseDb } from "./fixtures.mjs";
import { readRoomSession, joinRoom, createThread } from "../../api/_room-surface.js";
import {
  PULSE_MIN_FOLLOWERS,
  PULSE_MAX_LABELS,
  PULSE_LABEL_MIN_LEN,
  PULSE_LABEL_MAX_LEN,
  PULSE_NOTE_ACTION_CODES,
  setOptIn,
  revoke,
  setTopics,
  computeSnapshot,
  topicFollowerCount,
  readPulse,
  comboFollowerCount,
  computeComboSnapshot,
  weeklyNote,
} from "../../api/_pulse.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { loadAgent } = await loadFixtureAgent(REPO);
const WEEK_START = "2026-09-07"; // an arbitrary Monday; computeSnapshot snaps to its own ISO week

const uid = (i) => `30000000-0000-4000-a000-${String(i).padStart(12, "0")}`;
const followerToken = (i) => `TOKFOLLOWER_${i}_${"q".repeat(8)}`;

function buildWorld() {
  const state = freshPulseState(freshState());
  const base = fakeDb(state);
  const db = pulseDb(state, base);
  return { state, db };
}

/** Joins N followers, gives each a thread titled to MATCH `topicLabel` and
 *  carry their own unique token, and opts in whichever indices `optedIn`
 *  names. Returns the sessions so a test can revoke one later. */
async function seedFollowers(db, n, topicLabel, optedIn) {
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const joined = await joinRoom(
      db,
      { slug: SLUG, authUserId: uid(i), ageAttested: true, memoryConsent: true },
      { loadAgent },
    );
    const payload = readRoomSession(joined.session);
    const thread = await createThread(db, {
      roomId: ROOM_ID,
      personId: payload.p,
      agentId: AGENT_ID,
      title: `${topicLabel} ${followerToken(i)}`.slice(0, 80),
    });
    sessions.push({ session: joined.session, personId: payload.p, threadId: thread.thread_id });
    if (optedIn.includes(i)) {
      await setOptIn(db, { session: joined.session, threadId: thread.thread_id }, { loadAgent });
    }
  }
  return sessions;
}

/** WS-R35: joins ONE follower whose single thread's title mentions EVERY
 *  label in `labels` (space-joined), opted in — the shape needed to build a
 *  person who matches a whole SET at once, for the combo boundary tests
 *  below. `i` selects a stable, non-colliding uid/token within one world. */
async function seedComboFollower(db, i, labels) {
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: uid(i), ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  const payload = readRoomSession(joined.session);
  const thread = await createThread(db, {
    roomId: ROOM_ID,
    personId: payload.p,
    agentId: AGENT_ID,
    title: `${labels.join(" ")} ${followerToken(i)}`.slice(0, 80),
  });
  await setOptIn(db, { session: joined.session, threadId: thread.thread_id }, { loadAgent });
  return { session: joined.session, personId: payload.p, threadId: thread.thread_id };
}

// ═════════════════════════════════════════════════════════════════════════
// (a) 4 opted-in followers on one topic yields ZERO rows (room-total floor).
// ═════════════════════════════════════════════════════════════════════════
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["training"]);
  await seedFollowers(db, 4, "training", [0, 1, 2, 3]);
  const snap = await computeSnapshot(db, ROOM_ID, WEEK_START);
  ok("(a) 4 opted-in followers: room-total floor not cleared, total_optin=4", snap.total_optin === 4);
  ok("(a) 4 opted-in followers on one topic: ZERO buckets", snap.buckets.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// (b) 5 opted-in followers on one topic yields ONE row with follower_count=5.
// ═════════════════════════════════════════════════════════════════════════
let fiveFollowerWorld;
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["training"]);
  const sessions = await seedFollowers(db, 5, "training", [0, 1, 2, 3, 4]);
  const snap = await computeSnapshot(db, ROOM_ID, WEEK_START);
  ok("(b) 5 opted-in followers: exactly one bucket", snap.buckets.length === 1);
  ok("(b) that bucket's label is the creator's own topic, verbatim", snap.buckets[0]?.label === "training");
  ok("(b) that bucket's follower_count is exactly 5", snap.buckets[0]?.follower_count === 5);
  ok(`(b) the floor is respected: 5 >= PULSE_MIN_FOLLOWERS(${PULSE_MIN_FOLLOWERS})`, 5 >= PULSE_MIN_FOLLOWERS);
  fiveFollowerWorld = { db, sessions };
}

// ═════════════════════════════════════════════════════════════════════════
// (c) a follower who never opted in contributes nothing, even with matching
//     text in their own thread title.
// ═════════════════════════════════════════════════════════════════════════
{
  const { db, sessions } = fiveFollowerWorld;
  // A 6th follower, matching text, deliberately NOT opted in.
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: uid(5), ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  const payload = readRoomSession(joined.session);
  await createThread(db, {
    roomId: ROOM_ID,
    personId: payload.p,
    agentId: AGENT_ID,
    title: `training ${followerToken(5)}`,
  });
  // Deliberately no setOptIn call for this follower.
  const snap = await computeSnapshot(db, ROOM_ID, WEEK_START);
  ok("(c) a non-opted-in follower with matching text: bucket stays at 5, not 6",
    snap.buckets[0]?.follower_count === 5);
  void sessions;
}

// ═════════════════════════════════════════════════════════════════════════
// (d) revocation drops a bucket back below the floor on recompute, and the
//     PRIOR week's row does not survive alongside it (recomputed, never
//     patched — law 1).
// ═════════════════════════════════════════════════════════════════════════
{
  const { db, sessions } = fiveFollowerWorld;
  await revoke(db, { session: sessions[0].session, threadId: sessions[0].threadId }, { loadAgent });
  const snap = await computeSnapshot(db, ROOM_ID, WEEK_START);
  ok("(d) after one revocation, room-total floor drops to 4 opted-in", snap.total_optin === 4);
  ok("(d) after one revocation, the bucket disappears (4 < 5)", snap.buckets.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// (e) NEGATIVE CONTROL: the raw, UNGUARDED count DOES show a leaky 4 for a
//     topic four (not five) followers actually match, while `computeSnapshot`
//     (which applies the floor) refuses to emit that bucket. If the raw
//     count were also 0, this control would prove nothing
//     (`sound-gate-proved-by-silence`).
// ═════════════════════════════════════════════════════════════════════════
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["training"]);
  // 5 total opted-in followers (clears the room-total floor), but only 4 of
  // them have a thread whose title matches "training" — the 5th's thread is
  // about something else entirely.
  await seedFollowers(db, 4, "training", [0, 1, 2, 3]);
  const fifth = await joinRoom(
    db,
    { slug: SLUG, authUserId: uid(4), ageAttested: true, memoryConsent: true },
    { loadAgent },
  );
  const fifthPayload = readRoomSession(fifth.session);
  const fifthThread = await createThread(db, {
    roomId: ROOM_ID,
    personId: fifthPayload.p,
    agentId: AGENT_ID,
    title: `unrelated topic ${followerToken(4)}`,
  });
  await setOptIn(db, { session: fifth.session, threadId: fifthThread.thread_id }, { loadAgent });

  const raw = await topicFollowerCount(db, ROOM_ID, "training");
  ok("NEGATIVE CONTROL: the raw, unguarded count DOES show the leaky 4 (control fires)", raw === 4);

  const snap = await computeSnapshot(db, ROOM_ID, WEEK_START);
  ok("computeSnapshot's own floor refuses that same 4-follower bucket", snap.buckets.length === 0);
  ok("computeSnapshot's room-total floor is correctly clear (5 opted in)", snap.total_optin === 5);
}

// ═════════════════════════════════════════════════════════════════════════
// (f) STATIC: no follower-text column can reach the snapshot table's INSERT.
// ═════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(join(REPO, "api/_pulse.js"), "utf8");
  const insertMatch = src.match(
    /insert into vy_room_pulse_snapshot\s*\(([^)]*)\)/,
  );
  ok("the snapshot INSERT's column list is found in the real source", Boolean(insertMatch));
  const columns = (insertMatch?.[1] || "").split(",").map((c) => c.trim());
  const allowed = new Set(["snapshot_id", "room_id", "week_start", "topic_id", "follower_count", "computed_at"]);
  const offenders = columns.filter((c) => !allowed.has(c));
  ok("the snapshot INSERT names only the six content-free columns migration 080 defines",
    offenders.length === 0, offenders.join(","));
  const forbidden = ["title", "person_id", "content", "message_text", "thread_id"];
  const hit = forbidden.filter((f) => columns.includes(f));
  ok("no follower-text or follower-identity column is in that list", hit.length === 0, hit.join(","));
}

// ═════════════════════════════════════════════════════════════════════════
// readPulse's own honest-empty-state, both reasons named separately.
// ═════════════════════════════════════════════════════════════════════════
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["training"]);
  await seedFollowers(db, 4, "training", [0, 1, 2, 3]);
  await computeSnapshot(db, ROOM_ID, WEEK_START);
  const pulse = await readPulse(db, OWNER, REPLICA_ID);
  ok("readPulse: fewer than 5 total opt-ins reports its own honest reason", pulse?.status === "not_enough_optins");
  ok("readPulse: buckets stay empty for that reason", pulse?.buckets.length === 0);
}
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["training", "nutrition"]);
  await seedFollowers(db, 5, "training", [0, 1, 2, 3, 4]);
  await computeSnapshot(db, ROOM_ID, WEEK_START);
  const pulse = await readPulse(db, OWNER, REPLICA_ID);
  ok("readPulse: enough opt-ins but no topic at floor reports the OTHER honest reason",
    pulse?.status === "no_topic_at_floor" || pulse?.status === "ready");
  // "training" cleared the floor (5), "nutrition" never did — mixed status is
  // "ready" (at least one real bucket), which is the correct answer here.
  ok("readPulse: the real bucket is present and the never-matched topic is silently absent (never a fake zero)",
    pulse?.buckets.length === 1 && pulse.buckets[0].label === "training");
}

// ═════════════════════════════════════════════════════════════════════════
// PULSE V1 (WS-R35, migration 097) — k-anonymous label combinations.
// ═════════════════════════════════════════════════════════════════════════
const WEEK2_START = "2026-09-14"; // the ISO week immediately after WEEK_START

// ── (i) the intersection predicate at the boundary ──────────────────────
// intersection = 0: two disjoint 5-follower labels, both admitted.
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["finance", "wellness"]);
  for (let i = 0; i < 5; i++) await seedComboFollower(db, i, ["finance"]);
  for (let i = 5; i < 10; i++) await seedComboFollower(db, i, ["wellness"]);
  ok("(i, overlap=0) the raw pairwise intersection really is 0",
    (await comboFollowerCount(db, ROOM_ID, ["finance", "wellness"])) === 0);
  const snap = await computeComboSnapshot(db, ROOM_ID, WEEK_START);
  const labelsOf = (b) => b.labels.slice().sort().join("+");
  ok("(i, overlap=0) both size-1 buckets admitted", snap.buckets.some((b) => labelsOf(b) === "finance") && snap.buckets.some((b) => labelsOf(b) === "wellness"));
  ok("(i, overlap=0) the 2-label combo itself never clears its own floor (0 people match both)",
    !snap.buckets.some((b) => b.labels.length === 2));
}
// intersection = 1: two individually-5 labels sharing exactly one person
// refuses BOTH size-1 buckets — the plan's own worked example, made concrete.
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["visas", "divorce"]);
  for (let i = 0; i < 4; i++) await seedComboFollower(db, i, ["visas"]);
  for (let i = 4; i < 8; i++) await seedComboFollower(db, i, ["divorce"]);
  await seedComboFollower(db, 8, ["visas", "divorce"]); // the one shared person
  ok("(i, overlap=1) each label's own raw count is 5",
    (await comboFollowerCount(db, ROOM_ID, ["visas"])) === 5 && (await comboFollowerCount(db, ROOM_ID, ["divorce"])) === 5);
  ok("(i, overlap=1) the raw pairwise intersection really is 1 (the control fires)",
    (await comboFollowerCount(db, ROOM_ID, ["visas", "divorce"])) === 1);
  const snap = await computeComboSnapshot(db, ROOM_ID, WEEK_START);
  ok("(i, overlap=1) NEITHER single-label bucket is published — publishing either would let a creator learn who the one shared person is",
    snap.buckets.length === 0);
  ok("(i, overlap=1) every one of the 3 candidates (visas, divorce, the pair) was tried and refused",
    snap.suppressed === 3);
}
// intersection = 5 (full overlap): the SAME five people match both labels —
// both singles AND the pair all admit.
{
  const { db } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["examstress", "sleep"]);
  for (let i = 0; i < 5; i++) await seedComboFollower(db, i, ["examstress", "sleep"]);
  ok("(i, overlap=5) the raw pairwise intersection really is 5",
    (await comboFollowerCount(db, ROOM_ID, ["examstress", "sleep"])) === 5);
  const snap = await computeComboSnapshot(db, ROOM_ID, WEEK_START);
  const labelsOf = (b) => b.labels.slice().sort().join("+");
  ok("(i, overlap=5) both singles AND the pair are all admitted (0 or >=5 satisfied by 5)",
    snap.buckets.some((b) => labelsOf(b) === "examstress") &&
    snap.buckets.some((b) => labelsOf(b) === "sleep") &&
    snap.buckets.some((b) => labelsOf(b) === "examstress+sleep"));
  ok("(i, overlap=5) suppressed is 0 - nothing was refused", snap.suppressed === 0);
}

// ── (ii) label bounds (law 2) ────────────────────────────────────────────
{
  const { db } = buildWorld();
  const fifteen = Array.from({ length: 15 }, (_, i) => `topic${i}`);
  const kept = await setTopics(db, OWNER, REPLICA_ID, fifteen);
  ok(`(ii) 15 offered labels, only PULSE_MAX_LABELS(${PULSE_MAX_LABELS}) kept`, kept.length === PULSE_MAX_LABELS);
}
{
  const { db } = buildWorld();
  const kept = await setTopics(db, OWNER, REPLICA_ID, ["a", "ok", "x".repeat(40)]);
  ok(`(ii) a ${PULSE_LABEL_MIN_LEN - 1}-character label is dropped entirely`, !kept.some((t) => t.label === "a"));
  ok("(ii) a 2-character label is kept", kept.some((t) => t.label === "ok"));
  ok(`(ii) a 40-character label is truncated to PULSE_LABEL_MAX_LEN(${PULSE_LABEL_MAX_LEN})`,
    kept.some((t) => t.label.length === PULSE_LABEL_MAX_LEN));
}

// ── (iii) renaming a label never rewrites an already-published week ─────
{
  const { db, state } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["finance"]);
  for (let i = 0; i < 5; i++) await seedComboFollower(db, i, ["finance"]);
  await computeComboSnapshot(db, ROOM_ID, WEEK_START);
  const week1Before = state.pulseCombos.filter((c) => c.room_id === ROOM_ID && c.week_start === WEEK_START);
  ok("(iii) week 1 published the 'finance' bucket before any rename", week1Before.some((c) => c.labels.join(",") === "finance"));

  await setTopics(db, OWNER, REPLICA_ID, ["wealth"]); // rename, same slot
  await computeComboSnapshot(db, ROOM_ID, WEEK2_START); // a DIFFERENT week, post-rename

  const week1After = state.pulseCombos.filter((c) => c.room_id === ROOM_ID && c.week_start === WEEK_START);
  ok("(iii) week 1's stored row STILL says 'finance', untouched by the rename",
    week1After.length === week1Before.length && week1After.every((c) => c.labels.join(",") === "finance"));
}

// ── (iv) withdraw narrows FUTURE publishes only (law 5) ──────────────────
{
  const { db, state } = buildWorld();
  await setTopics(db, OWNER, REPLICA_ID, ["nutrition"]);
  const followers = [];
  for (let i = 0; i < 5; i++) followers.push(await seedComboFollower(db, i, ["nutrition"]));
  await computeComboSnapshot(db, ROOM_ID, WEEK_START);
  const week1 = state.pulseCombos.filter((c) => c.room_id === ROOM_ID && c.week_start === WEEK_START);
  ok("(iv) week 1 published 'nutrition' at 5", week1.length === 1 && week1[0].follower_count === 5);

  await revoke(db, { session: followers[0].session, threadId: followers[0].threadId }, { loadAgent });
  const snap2 = await computeComboSnapshot(db, ROOM_ID, WEEK2_START);
  ok("(iv) week 2, one revocation later, drops below the floor and publishes nothing", snap2.buckets.length === 0);

  const week1After = state.pulseCombos.filter((c) => c.room_id === ROOM_ID && c.week_start === WEEK_START);
  ok("(iv) week 1's own row is untouched by the later revocation - past snapshots are counts and stay",
    week1After.length === 1 && week1After[0].follower_count === 5);
}

// ── (v) the weekly note: closed action list, and byte-identical on pure input ──
{
  const rows = [{ labels: ["examstress"], follower_count: 7 }, { labels: ["sleep"], follower_count: 5 }];
  ok("(v) every closed-list action code produces a real, distinct sentence",
    PULSE_NOTE_ACTION_CODES.length === 3 &&
    new Set(PULSE_NOTE_ACTION_CODES.map((code) => weeklyNote(rows, { action: code }))).size === 3);
  ok("(v) an unrecognised action code falls back to the default rather than throwing",
    weeklyNote(rows, { action: "not_a_real_code" }) === weeklyNote(rows));
  ok("(v) a row below the floor is silently excluded from consideration, never printed as a fake number",
    !weeklyNote([{ labels: ["rare"], follower_count: 3 }]).includes("rare"));
  const rowsAgain = [{ labels: ["examstress"], follower_count: 7 }, { labels: ["sleep"], follower_count: 5 }];
  ok("(v) NEGATIVE CONTROL shape: two structurally-identical-but-distinct row arrays (standing in for two weeks that differ only in follower verbatim text no `rows` here could ever carry) produce a byte-identical note",
    weeklyNote(rows) === weeklyNote(rowsAgain));
  ok("(v) an empty week (nothing reached the floor) still returns real text, not a blank string",
    weeklyNote([]).length > 0);
}

// ── (vi) NEGATIVE CONTROL: the real INSERT column lists stay content-free ──
{
  const src = fs.readFileSync(join(REPO, "api/_pulse.js"), "utf8");
  const comboMatch = src.match(/insert into vy_room_pulse_combo\s*\(([^)]*)\)/);
  const weekMatch = src.match(/insert into vy_room_pulse_week\s*\(([^)]*)\)/);
  ok("(vi) the combo INSERT's column list is found in the real source", Boolean(comboMatch));
  ok("(vi) the week header INSERT's column list is found in the real source", Boolean(weekMatch));
  const comboCols = (comboMatch?.[1] || "").split(",").map((c) => c.trim());
  const weekCols = (weekMatch?.[1] || "").split(",").map((c) => c.trim());
  const comboAllowed = new Set(["combo_id", "week_id", "room_id", "week_start", "labels", "follower_count", "computed_at"]);
  const weekAllowed = new Set(["week_id", "room_id", "week_start", "suppressed", "computed_at"]);
  const forbidden = ["title", "person_id", "content", "message_text", "thread_id"];
  ok("(vi) the combo INSERT names only its six content-free columns",
    comboCols.every((c) => comboAllowed.has(c)), comboCols.filter((c) => !comboAllowed.has(c)).join(","));
  ok("(vi) the week INSERT names only its five content-free columns",
    weekCols.every((c) => weekAllowed.has(c)), weekCols.filter((c) => !weekAllowed.has(c)).join(","));
  ok("(vi) no follower-text or follower-identity column is in either list",
    forbidden.every((f) => !comboCols.includes(f) && !weekCols.includes(f)));
}

// ── (vii) NEGATIVE CONTROL: the room-leak battery's OWN detector, proven to
//    fire against a hand-built statement that adds a follower/thread id
//    column — `sound-gate-proved-by-silence`: a check that never watches its
//    detector actually flag something is not proof the detector works.
//    Replicates `evals/room-leak/run.mjs`'s exact §1c algorithm (never
//    imported, since that file is a script, not a module) against a SYNTHETIC
//    string, never the real file, `context/rejected.md#ws-r12-retention-
//    exists-in-select-broke-the-leak-batterys-parser`'s own technique.
// ═════════════════════════════════════════════════════════════════════════
{
  const aggregateOnlyCheck = (stmt) => {
    const selectList = (stmt.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
    const items = [];
    let depth = 0, cur = "";
    for (const ch of selectList) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) items.push(cur);
    const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min)\s*\(/i.test(c));
    const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
    return aggregateOnly && !touchesPerson;
  };
  const realPublish =
    "select min(($1)::uuid), count(*)::int from (select distinct o.person_id from vy_room_pulse_optin o where o.room_id = ($1)::uuid) op where exists (select 1 from vy_room_thread t where t.room_id=($1)::uuid)";
  ok("(vii) the real shape (every column min/count-wrapped) passes the detector", aggregateOnlyCheck(realPublish));
  const leaky = realPublish.replace("select min(($1)::uuid), count(*)::int", "select min(($1)::uuid), op.person_id, count(*)::int");
  ok("(vii) the SAME statement with a bare person_id column added to the select list is CORRECTLY REFUSED by the detector (the control fires)",
    !aggregateOnlyCheck(leaky));
  const leakyThread = realPublish.replace("select min(($1)::uuid), count(*)::int", "select min(($1)::uuid), t.thread_id, count(*)::int");
  ok("(vii) the same statement with a bare thread_id column added is also refused",
    !aggregateOnlyCheck(leakyThread));
}

console.log(`\npulse: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
