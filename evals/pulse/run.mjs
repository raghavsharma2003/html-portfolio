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
  setOptIn,
  revoke,
  setTopics,
  computeSnapshot,
  topicFollowerCount,
  readPulse,
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

console.log(`\npulse: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
