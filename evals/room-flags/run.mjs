// WS-R67. FLAG THIS REPLY (migration 116) — offline, deterministic, $0.
//
//   node evals/room-flags/run.mjs
//
// Drives the REAL decision modules a follower's "Flag this" and a creator's
// review queue actually call — `api/_room-surface.js::flagReply`/
// `unflagReply`/`followerFlags`/`lastReplySha256` and
// `api/_review-queue.js::readFlaggedReplies`/`neverRuleFromFlaggedReply` —
// through a fake `db` (`evals/room-flags/fixtures.mjs`, wrapping
// `evals/room/fixtures.mjs`'s own), never a re-implemented check.
//
// THE BOUNDARY LAW THIS SUITE PROVES: the creator never receives a
// follower's words or identity through a flag. Concretely:
//
//   1. The text that lands in the creator's lane (`vy_room_reply_flag`) is
//      read back from the FOLLOWER'S OWN HISTORY by hash — never from a
//      body-supplied field. NEGATIVE CONTROL (a): a hash matching nothing in
//      that history is refused by name, never guessed at.
//   2. A follower may flag each reply once. NEGATIVE CONTROL (b): a second
//      flag of the same reply by the same follower is refused, and the
//      creator's row count does not move.
//   3. Ten followers flagging one reply is ONE creator-side entry with
//      n=10, never ten — proven with three followers here, the same
//      mechanism at any N.
//   4. Withdrawal deletes the follower's own row and decrements the
//      creator's count by exactly one, in the SAME statement.
//   5. STATIC: no file outside a closed set ever reads `vy_room_reply_flag`
//      alongside a follower/person/thread column — NEGATIVE CONTROL (c)
//      proves the scan itself is not vacuous by feeding it a deliberately
//      bad statement.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SLUG, ROOM_ID, AGENT_ID, REPLICA_ID, OWNER,
  loadFixtureAgent, freshState, fakeDb, fakeMemory,
} from "../room/fixtures.mjs";
import { freshFlagState, flagsDb } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const {
  joinRoom, roomThreadDevice, readRoomSession,
  flagReply, unflagReply, followerFlags, lastReplySha256, RoomError, FLAG_REASONS,
} = room;
const reviewQueue = await import(pathToFileURL(join(REPO, "api/_review-queue.js")).href);
const { readFlaggedReplies, neverRuleFromFlaggedReply, neverRulePattern } = reviewQueue;

const { loadAgent } = await loadFixtureAgent(REPO);
const DEPS = { loadAgent, tableApplied: async () => true };

// A user id per follower — three, so "ten followers, one card" is proven at
// N=3 (the mechanism does not change shape at 10).
const UID = (n) => `9000000${n}-0000-4000-a000-00000000000${n}`;

/** Seed one delivered reply into a follower's own default-thread history —
 *  standing in for a turn `gatedReply` already produced and `roomSay`
 *  already logged, `evals/room/fixtures.mjs`'s `fakeMemory` own shape. */
function seedReply(memlog, { roomId, personId, agentId, text }) {
  const device = roomThreadDevice(roomId, personId, null);
  memlog.push({ call: "logTurn", device, person: personId, role: "her", content: text, agentId });
}

// ═════════════════════════════════════════════════════════════════════════
// WORLD: three followers, one Room, one AI reply, three flags on it.
// ═════════════════════════════════════════════════════════════════════════
console.log("── world: three followers flag the same reply ──");

const state = freshFlagState(freshState());
const db = flagsDb(state, fakeDb(state));
const memlog = [];
const memory = fakeMemory(memlog);
const REPLY_TEXT = "The exam is on the 14th, not the 12th — I checked the notice again.";
const REPLY_HASH = sha256Hex(REPLY_TEXT);

const sessions = [];
const personIds = [];
for (let i = 1; i <= 3; i++) {
  const joined = await joinRoom(
    db, { slug: SLUG, authUserId: UID(i), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  sessions.push(joined.session);
  const payload = readRoomSession(joined.session);
  personIds.push(String(payload.p));
  seedReply(memlog, { roomId: ROOM_ID, personId: String(payload.p), agentId: AGENT_ID, text: REPLY_TEXT });
}

const REASONS = ["wrong", "harmful", "harmful"];
for (let i = 0; i < 3; i++) {
  const result = await flagReply(
    db, { session: sessions[i], replySha256: REPLY_HASH, reason: REASONS[i] }, { ...DEPS, memory },
  );
  ok(`follower ${i + 1}'s flag lands`, result.flagged === true && result.reply_sha256 === REPLY_HASH);
}

ok("the follower lane holds THREE rows - one per follower", state.roomFollowerReplyFlags.length === 3);
// THE CREATOR LANE IS NOT DEDUPLICATED AT THE ROW LEVEL - migration 116's
// own header, verbatim: "ten followers flagging the same reply write TEN
// rows here (no follower identity survives to distinguish them, so there is
// nothing to deduplicate against on this side)". The ONE-CARD, n=10
// property is `readFlaggedReplies`' own GROUP BY, checked two lines down -
// a property of the READ, never of the table.
ok("the creator lane holds THREE rows for this reply - one per flag, undeduplicated by design",
  state.roomReplyFlags.filter((r) => r.reply_sha256 === REPLY_HASH).length === 3);
ok("every one of those rows carries the AI's own words, read back from history",
  state.roomReplyFlags.filter((r) => r.reply_sha256 === REPLY_HASH).every((r) => r.reply_text === REPLY_TEXT));
ok("none of those rows names a follower, a person, or a thread at all",
  state.roomReplyFlags.every((r) => !("follower_id" in r) && !("person_id" in r) && !("thread_id" in r)));

const aggregate = await readFlaggedReplies(db, OWNER, REPLICA_ID, { tableApplied: async () => true });
const entry = aggregate.find((a) => a.reply_sha256 === REPLY_HASH);
ok("readFlaggedReplies groups the three flags into ONE card with n=3", Boolean(entry) && entry.count === 3);
ok("...with the right reason breakdown (1 wrong, 2 harmful)",
  entry.reasons.wrong === 1 && entry.reasons.harmful === 2, JSON.stringify(entry?.reasons));
ok("...and suggest_never is true — 'harmful' pre-selects 'Never say this'", entry.suggest_never === true);

// ═════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROL (a). A hash matching nothing in this follower's own
// history is refused by name, never guessed at.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── negative control (a): a fabricated hash is refused ──");
{
  const fabricated = sha256Hex("words this AI never actually said to anyone");
  const err = await flagReply(
    db, { session: sessions[0], replySha256: fabricated, reason: "wrong" }, { ...DEPS, memory },
  ).catch((e) => e);
  ok("a hash matching nothing in this follower's real history is refused",
    err instanceof RoomError && err.code === "room_flag_reply_not_found");
  ok("...and nothing was written for it", !state.roomReplyFlags.some((r) => r.reply_sha256 === fabricated));
}

// ═════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROL (b). A second flag of the SAME reply by the SAME
// follower is refused by the unique index, and the creator's count does
// not move.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── negative control (b): a duplicate flag is refused ──");
{
  const before = state.roomReplyFlags.filter((r) => r.reply_sha256 === REPLY_HASH).length;
  const err = await flagReply(
    db, { session: sessions[0], replySha256: REPLY_HASH, reason: "wrong" }, { ...DEPS, memory },
  ).catch((e) => e);
  ok("a second flag of the same reply by the same follower is refused",
    err instanceof RoomError && err.code === "room_flag_already_flagged");
  ok("the follower lane still holds exactly THREE rows, not four",
    state.roomFollowerReplyFlags.length === 3);
  ok("the creator lane's count for this reply is unchanged",
    state.roomReplyFlags.filter((r) => r.reply_sha256 === REPLY_HASH).length === before);
}

// ═════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROL — a body-supplied `reply_text` is refused BY ABSENCE.
// `flagReply` has no such parameter; passing one anyway must have no effect
// on what is written.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── negative control: a body-supplied reply_text is ignored ──");
{
  const joined2 = await joinRoom(
    db, { slug: SLUG, authUserId: UID(4), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  const payload2 = readRoomSession(joined2.session);
  const otherText = "A second real reply, different from the first.";
  seedReply(memlog, { roomId: ROOM_ID, personId: String(payload2.p), agentId: AGENT_ID, text: otherText });
  const otherHash = sha256Hex(otherText);
  const tampered = await flagReply(
    db,
    // reply_text here is NOT a parameter flagReply reads at all - included
    // to prove that fact rather than assumed.
    { session: joined2.session, replySha256: otherHash, reason: "harmful", reply_text: "fabricated words a follower typed" },
    { ...DEPS, memory },
  );
  ok("the flag lands (the extra field did not break anything)", tampered.flagged === true);
  const row = state.roomReplyFlags.find((r) => r.reply_sha256 === otherHash);
  ok("the creator lane's stored text is the REAL reply, never the fabricated field",
    row?.reply_text === otherText);
}

// ═════════════════════════════════════════════════════════════════════════
// WITHDRAWAL. Deletes the follower's own row and decrements the creator's
// count by exactly one, in the same op.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── withdrawal decrements the creator's count by one ──");
{
  const before = await readFlaggedReplies(db, OWNER, REPLICA_ID, { tableApplied: async () => true });
  const beforeCount = before.find((a) => a.reply_sha256 === REPLY_HASH)?.count ?? 0;
  const withdrawn = await unflagReply(db, { session: sessions[0], replySha256: REPLY_HASH }, { ...DEPS, memory });
  ok("the withdrawal reports success", withdrawn.withdrawn === true);
  ok("the follower's own row is gone",
    !state.roomFollowerReplyFlags.some((r) => r.follower_id && r.reply_sha256 === REPLY_HASH && r.person_id === personIds[0]));
  const after = await readFlaggedReplies(db, OWNER, REPLICA_ID, { tableApplied: async () => true });
  const afterCount = after.find((a) => a.reply_sha256 === REPLY_HASH)?.count ?? 0;
  ok("the creator's count for this reply went down by exactly one",
    afterCount === beforeCount - 1, `before=${beforeCount} after=${afterCount}`);

  // Withdrawing a flag that was never made is a no-op, never a crash.
  const noop = await unflagReply(db, { session: sessions[0], replySha256: REPLY_HASH }, { ...DEPS, memory });
  ok("withdrawing an already-gone flag reports withdrawn: false, not an error", noop.withdrawn === false);
}

// ═════════════════════════════════════════════════════════════════════════
// followerFlags — the account page's own read.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── the follower's own account-page list ──");
{
  const mine = await followerFlags(db, { session: sessions[1] }, { ...DEPS, memory });
  ok("follower 2's own list contains their flag on the reply", mine.flags.some((f) => f.reply_sha256 === REPLY_HASH));
  ok("...with the AI's own reply text joined back in", mine.flags.find((f) => f.reply_sha256 === REPLY_HASH)?.reply_text === REPLY_TEXT);
  const other = await followerFlags(db, { session: sessions[0] }, { ...DEPS, memory });
  ok("follower 1 (who withdrew) no longer sees this reply in their own list",
    !other.flags.some((f) => f.reply_sha256 === REPLY_HASH));
}

// ═════════════════════════════════════════════════════════════════════════
// Telegram law 5: `/flag` on the LAST reply.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── lastReplySha256 (Telegram's /flag) ──");
{
  const hash = await lastReplySha256(db, { session: sessions[1] }, { ...DEPS, memory });
  ok("lastReplySha256 finds the follower's most recent assistant reply", hash === REPLY_HASH);
  const joinedFresh = await joinRoom(
    db, { slug: SLUG, authUserId: UID(5), ageAttested: true, memoryConsent: true }, { loadAgent },
  );
  const none = await lastReplySha256(db, { session: joinedFresh.session }, { ...DEPS, memory });
  ok("a follower with no history yet gets null, never a guess", none === null);
}

// ═════════════════════════════════════════════════════════════════════════
// "Never say this," off a flagged reply — api/_review-queue.js.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── neverRuleFromFlaggedReply ──");
{
  const otherHash = sha256Hex("A second real reply, different from the first.");
  const first = await neverRuleFromFlaggedReply(
    db, OWNER, { replica_id: REPLICA_ID, reply_sha256: otherHash, reason: "flagged as harmful" }, { tableApplied: async () => true },
  );
  ok("a never-rule is created off the flagged reply", Boolean(first.rule_id));
  ok("its pattern is the REAL reply text run through neverRulePattern, never body-supplied",
    first.pattern === neverRulePattern("A second real reply, different from the first."));
  ok("the rule really landed in the table", state.neverRules.some((r) => r.rule_id === first.rule_id));

  const second = await neverRuleFromFlaggedReply(
    db, OWNER, { replica_id: REPLICA_ID, reply_sha256: otherHash }, { tableApplied: async () => true },
  );
  ok("calling it again for the SAME reply is idempotent - the SAME rule, not a duplicate",
    second.rule_id === first.rule_id);
  ok("no duplicate rule was created", state.neverRules.length === 1);

  const missing = await neverRuleFromFlaggedReply(
    db, OWNER, { replica_id: REPLICA_ID, reply_sha256: sha256Hex("never flagged") }, { tableApplied: async () => true },
  ).catch((e) => e);
  ok("a hash naming no flagged reply is refused by name", missing?.code === "review_flag_not_found");
}

// ═════════════════════════════════════════════════════════════════════════
// STATIC (5). No file outside a closed set ever names vy_room_reply_flag
// alongside a follower/person/thread column.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── static: the creator lane never carries a follower column ──");

/**
 * The scan under test — pure, so the negative control can drive it against a
 * DELIBERATELY BAD string without touching a single real file.
 *
 * NOT a backtick-delimited-string extraction: this table's own writer
 * (`flagReply`) shares ONE template literal with the follower lane's insert
 * (`vy_room_follower_reply_flag`, which legitimately carries `follower_id`
 * a few lines away), and the owner-wide erasure cascade
 * (`api/_replica-full-erasure.js`) is ONE multi-thousand-line template
 * literal for the whole database - either whole-literal extraction grabs
 * a NEIGHBOURING statement's columns and reports a leak that is not there
 * (found running this exact check against the real tree the first time).
 * Instead, three shapes, each bounded to what it can actually mean:
 * an INSERT's own column list (bounded by its own parens), a SELECT's own
 * list (bounded to the NEAREST preceding `select`), and a DELETE's own
 * short forward window (these are simple room_id-scoped deletes in this
 * codebase, never longer than a couple of clauses).
 */
function creatorLaneOffenders(sourcesByFile) {
  const offenders = [];
  const BANNED = /\b(follower_id|person_id|thread_id)\b/;
  const MAX_CLAUSE = 600; // generous over the real 453-char select list; still
                          // far short of reaching a NEIGHBOURING statement.
  for (const [file, src] of Object.entries(sourcesByFile)) {
    for (const m of src.matchAll(/insert into vy_room_reply_flag\s*\(([^)]*)\)/g)) {
      if (BANNED.test(m[1])) offenders.push(file);
    }
    // SELECT ... FROM vy_room_reply_flag: found by INDEX, walking BACKWARD
    // from each "from vy_room_reply_flag" occurrence to the NEAREST
    // preceding "select" - never a regex scan from the start of the whole
    // file, which (found running this exact check once) pairs with the
    // FIRST "select" anywhere and the wrong "from" thousands of lines away.
    let at = src.indexOf("from vy_room_reply_flag");
    while (at !== -1) {
      // "delete FROM vy_room_reply_flag" contains this same substring - skip
      // it here, the DELETE pattern below is what checks it, and checking
      // it here too would walk backward past "delete" into whatever
      // PRECEDING statement's own "select" happens to be nearest (a real
      // false positive found running this exact check: a neighbouring
      // CTE's subquery, or even this migration's own comment prose).
      const immediatelyBefore = src.slice(Math.max(0, at - 10), at).toLowerCase();
      if (!immediatelyBefore.trimEnd().endsWith("delete")) {
        const windowStart = Math.max(0, at - MAX_CLAUSE);
        const before = src.slice(windowStart, at);
        const selectAt = before.toLowerCase().lastIndexOf("select");
        if (selectAt !== -1) {
          const clause = before.slice(selectAt + "select".length);
          if (BANNED.test(clause)) offenders.push(file);
        }
      }
      at = src.indexOf("from vy_room_reply_flag", at + 1);
    }
    for (const m of src.matchAll(/delete from vy_room_reply_flag\b/g)) {
      const window = src.slice(m.index + "delete from vy_room_reply_flag".length, m.index + 260);
      if (BANNED.test(window)) offenders.push(file);
    }
  }
  return [...new Set(offenders)];
}

{
  const ALLOWED = new Set([
    "_room-surface.js", "room.js", "_review-queue.js", "review-queue.js", "_replica-full-erasure.js",
    // Manifest-entry-and-comment-only, `evals/room-leak/run.mjs`'s own
    // layer 6a precedent for the identical shape: api/memory.js's
    // PERSON_TABLES header explains why vy_room_reply_flag is ABSENT from
    // the manifest, which is itself a mention of the name, never a query.
    "memory.js",
  ]);
  const sources = {};
  for (const f of fs.readdirSync(join(REPO, "api"))) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(join(REPO, "api", f), "utf8");
    if (src.includes("vy_room_reply_flag")) sources[f] = src;
  }
  ok("at least one real file names vy_room_reply_flag (the scan is not vacuous)", Object.keys(sources).length > 0);
  const outsideAllowed = Object.keys(sources).filter((f) => !ALLOWED.has(f));
  ok("every file naming vy_room_reply_flag is in the closed, reviewed set",
    outsideAllowed.length === 0, outsideAllowed.join(","));
  const offenders = creatorLaneOffenders(sources);
  ok("no real statement naming vy_room_reply_flag also carries a follower/person/thread column",
    offenders.length === 0, offenders.join(","));

  // NEGATIVE CONTROL (c): a deliberately bad statement, fed to the SAME
  // scan function, on a COPY of the sources - never a real file.
  const bad = { ...sources, "FAKE-negative-control.js":
    "`select follower_id, thread_id from vy_room_reply_flag where room_id = $1`" };
  const caught = creatorLaneOffenders(bad);
  ok("NEGATIVE CONTROL (c): a card shaped to carry a thread id is CAUGHT by the scan",
    caught.includes("FAKE-negative-control.js"),
    caught.includes("FAKE-negative-control.js") ? "" : "control did not fire - the scan would have shipped a blind spot");
}

// ═════════════════════════════════════════════════════════════════════════
// STATIC. flagReply's own source never reads a body-supplied reply_text.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── static: flagReply reads no body-supplied reply text ──");
{
  const src = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const fnBody = (name) => {
    const m = src.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n}\\n`));
    return m ? m[0] : "";
  };
  const body = fnBody("flagReply");
  ok("flagReply is found (not moved/renamed)", Boolean(body));
  ok("flagReply's own body contains no input.reply_text / body.reply_text",
    !/\b(input|body)\.reply_text\b/.test(body));
  ok("flagReply's own body DOES call the read-back", /replyTextFromOwnHistory/.test(body));
  ok("FLAG_REASONS is the closed four-item list the workstream brief names",
    JSON.stringify([...FLAG_REASONS]) === JSON.stringify(["wrong", "harmful", "not_them", "other"]));
}

console.log(`\n── verdict ──`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("room-flags: FAILED");
  process.exit(1);
}
console.log("room-flags: ok");
