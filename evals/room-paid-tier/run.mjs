// WS-R19. The paid tier: fair-use ceilings as predicates, voice replies in
// the Room, voice minutes metered (migration 081).
//
//   node evals/room-paid-tier/run.mjs
//
// WS-R11's own report named the gap this closes, verbatim: "the paid tier's
// fair-use ceiling (500 messages / 30 voice minutes a month, named in the
// Rooms plan's own product paragraph) is not enforced anywhere in this
// workstream ... voice minutes have no metering surface anywhere in this
// codebase yet." This suite proves both predicates hold, that voice never
// reaches a free follower, that a clip cannot leave unwatermarked, and that
// the ledger row `roomSpeak` writes is the shape drift watch's sweep reads.
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  SLUG,
  ROOM_ID,
  AGENT_ID,
  USER_A,
  USER_B,
  PERSON_A,
  PERSON_B,
  loadFixtureAgent,
  freshState,
  fakeDb,
} from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "s".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomSay, roomSpeak, RoomError } = room;
const roomVoice = await import(pathToFileURL(join(REPO, "api/_room-voice.js")).href);
const { estimateClipSeconds, ROOM_VOICE_CHARS_PER_SECOND } = roomVoice;
const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "acknowledged.";
const personTables = async () => [];
const memory = { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] };

/** The shared fixture's fakeDb, extended with the ONE new insert WS-R19 adds
 *  (`vy_room_voice_usage`, migration 081) - kept out of `evals/room/
 *  fixtures.mjs` itself because no OTHER suite that shares that file calls
 *  `roomSpeak`, and a handler nothing exercises is dead weight in a fixture
 *  three suites read. `usage` is exposed on the returned function so this
 *  suite can assert on it directly, `fakeDb.calls`'s own pattern one field
 *  over. */
function extendedDb(state) {
  const base = fakeDb(state);
  const usage = [];
  const db = async (sql, params = []) => {
    if (sql.includes("insert into vy_room_voice_usage")) {
      const [roomId, personId, followerId, day, seconds] = params;
      let row = usage.find((u) => u.room_id === String(roomId) && u.person_id === String(personId) && u.day === String(day));
      if (!row) {
        row = { room_id: String(roomId), person_id: String(personId), follower_id: String(followerId), day: String(day), seconds: 0, clips: 0 };
        usage.push(row);
      }
      row.seconds += Number(seconds);
      row.clips += 1;
      return [{ ...row }];
    }
    return base(sql, params);
  };
  db.calls = base.calls;
  db.usage = usage;
  return db;
}

/** A RE-ITERABLE fake stream over one chunk — `[Symbol.asyncIterator]` hands
 *  back a FRESH cursor on every `for await`, unlike a plain async generator
 *  instance (single-use: a second `for await` over the same generator yields
 *  nothing, `done` immediately). That distinction matters here specifically:
 *  section 5's struck copy reads `synthesized.stream` a SECOND time, after
 *  `deps.protect`'s own fake has already drained it once collecting the
 *  chunks it watermarks — a single-use stream would make the struck copy
 *  throw `room_voice_audio_empty` (an honest failure, but the WRONG one: it
 *  proves nothing about raw bytes leaving, only that a stream was read twice).
 *  A real PCM provider stream is drained once in production too, so this
 *  re-iterability is a fixture convenience for proving what the struck code
 *  WOULD do with fresh bytes, not a claim about the real stream's shape. */
function repeatableStream(chunk) {
  return { [Symbol.asyncIterator]: async function* () { yield chunk; } };
}

/** A fake, tagged synth + protect pair. `RAW:` marks what the provider
 *  produced; `WATERMARKED:` marks what left the protection step. The two are
 *  disjoint on purpose, so "the returned audio carries the watermark tag and
 *  not the raw one" is a real assertion about WHICH bytes travelled, not a
 *  restatement of the fake's own plumbing. `calls` counts synth invocations,
 *  so a refusal that never reaches synthesis is provable, not assumed. */
function voiceSeam() {
  const calls = { synth: 0, protect: 0 };
  const synth = async ({ authorized, text }) => {
    calls.synth += 1;
    const raw = Buffer.from(`RAW:${authorized.generation.generation_id}:${text}`);
    return {
      stream: repeatableStream(raw),
      format: { sampleRate: 24000, channels: 1 },
      renderedText: text,
      disclosureText: "This is an AI voice.",
      renderer: "fake",
    };
  };
  const protect = async ({ sourceStream }) => {
    calls.protect += 1;
    const chunks = [];
    for await (const c of sourceStream) chunks.push(Buffer.from(c));
    const watermarked = Buffer.concat([Buffer.from("WATERMARKED:"), ...chunks]);
    return {
      stream: repeatableStream(watermarked),
      completion: Promise.resolve({ watermark_algorithm: "fake@1", disclosure_scheme: "audible-prefix-v1" }),
    };
  };
  return { calls, synth, protect };
}

/** A fake `deps.authorize` — never touches `beginOwnedVoicePreview` or a real
 *  database, `roomSay`'s own `deps.reply` seam restated for the voice door.
 *  What THIS suite proves about the real authorization path is a STATIC
 *  claim (section 6, below), not a behavioural one — `offline-mocks-cannot-
 *  type-check-sql`, stated rather than dodged. */
function fakeAuthorize(replicaId = "c1000000-0000-4000-8000-000000000001", ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  let seq = 0;
  return async ({ text }) => {
    seq += 1;
    return {
      generation: { generation_id: `gen-${seq}`, preview_language_id: "en" },
      authorizationInput: { replicaId, ownerUserId: ownerId },
      previewStyle: { exaggeration: 0.35, cfg_weight: 0.65, temperature: 0.65 },
      previewSeed: 12345,
      reference: { sha256: "0".repeat(64), durationMs: 1000, languageMode: "unknown", languageEvidenceScope: "unverified" },
    };
  };
}

const monthKeyOf = (at) => new Date(at).toISOString().slice(0, 7);
const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const THIS_MONTH = monthKeyOf(NOW);

async function setupPaidFollower(db, state, userId, personId) {
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: userId, ageAttested: true, memoryConsent: true },
    { loadAgent, now: NOW },
  );
  const f = state.followers.find((x) => x.person_id === personId);
  f.tier = "paid";
  return joined.session;
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 1 — the message cap, both tiers, at the exact boundary
// ═════════════════════════════════════════════════════════════════════════
console.log("── section 1: the message cap, as a predicate ──");
{
  const state = freshState();
  const db = extendedDb(state);
  const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
  const f = state.followers.find((x) => x.person_id === PERSON_A);
  f.month_key = THIS_MONTH;
  f.month_message_count = 499;

  const turn500 = await roomSay(db, { session, message: "message 500" }, { loadAgent, memory, reply, now: NOW });
  ok("paid follower: message 500 succeeds", turn500.quota.messages_used === 500 && turn500.quota.tier === "paid");
  ok("paid follower: message 500's ceiling is the PAID column (500), not the free one",
    turn500.quota.messages_included === 500);
  ok("paid follower: messages_left is 0 at the ceiling, never null", turn500.quota.messages_left === 0);

  let refused = null;
  try {
    await roomSay(db, { session: turn500.session, message: "message 501" }, { loadAgent, memory, reply, now: NOW });
  } catch (e) {
    refused = e;
  }
  ok("paid follower: message 501 is refused", refused instanceof RoomError);
  ok("paid follower: refusal is NAMED room_paid_cap_reached, not the free code",
    refused?.code === "room_paid_cap_reached");
  ok("paid follower: refusal names the PAID ceiling (500)",
    refused?.details?.messages_included === 500);
}

// The free tier's own boundary — unchanged behaviour, reconfirmed because the
// UPDATE's WHERE clause changed shape (a bare tier check to a CASE) to make
// section 1 above possible, and a shared predicate that regressed silently
// for the tier it already served would be the exact failure this suite
// exists to catch for the NEW tier.
{
  const state = freshState();
  const db = extendedDb(state);
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW });
  const f = state.followers.find((x) => x.person_id === PERSON_B);
  f.month_key = THIS_MONTH;
  f.month_message_count = 19;

  const turn20 = await roomSay(db, { session: joined.session, message: "message 20" }, { loadAgent, memory, reply, now: NOW });
  ok("free follower: message 20 succeeds, unchanged", turn20.quota.messages_used === 20 && turn20.quota.messages_included === 20);

  let refused = null;
  try {
    await roomSay(db, { session: turn20.session, message: "message 21" }, { loadAgent, memory, reply, now: NOW });
  } catch (e) {
    refused = e;
  }
  ok("free follower: message 21 is refused room_free_cap_reached, unchanged",
    refused instanceof RoomError && refused.code === "room_free_cap_reached");
  ok("free follower: refusal names the FREE ceiling (20)", refused?.details?.messages_included === 20);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 2 — the voice cap, spent before any synthesis
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 2: the voice cap, spent before any synthesis ──");
{
  const state = freshState();
  const db = extendedDb(state);
  const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
  const said = await roomSay(db, { session, message: "hi" }, { loadAgent, memory, reply, now: NOW });

  const f = state.followers.find((x) => x.person_id === PERSON_A);
  // The clip charged is always the clip the ACTUAL reply produces
  // (`said.reply`, the fixed fixture reply text) - never a different string,
  // which would test nothing about what `roomSpeak` really charges.
  const clip = estimateClipSeconds(said.reply);
  ok("estimateClipSeconds is deterministic and positive", clip > 0 && Number.isInteger(clip));

  f.voice_month_key = THIS_MONTH;
  f.voice_seconds_month = 1800 - clip;

  const seam1 = voiceSeam();
  const spoken = await roomSpeak(
    { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam1.synth, protect: seam1.protect },
    said.session,
    { text: said.reply },
  );
  ok("paid follower: a clip that lands EXACTLY at the ceiling succeeds", spoken.voice.seconds_used === 1800);
  ok("paid follower: seconds_included is the room's real column (1800)", spoken.voice.seconds_included === 1800);
  ok("paid follower: seconds_left is 0 at the ceiling", spoken.voice.seconds_left === 0);
  ok("the usage row was written with a real clip count", db.usage.some((u) => u.person_id === PERSON_A && u.clips === 1));

  const said2 = await roomSay(db, { session: spoken.session, message: "one more" }, { loadAgent, memory, reply, now: NOW });
  const seam2 = voiceSeam();
  let refused = null;
  try {
    await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam2.synth, protect: seam2.protect },
      said2.session,
      { text: said2.reply },
    );
  } catch (e) {
    refused = e;
  }
  ok("paid follower: the clip that would CROSS the ceiling is refused", refused instanceof RoomError && refused.code === "room_voice_cap_reached");
  ok("the refused clip never reached synthesis (charged-before-synth law)", seam2.calls.synth === 0);
  ok("refusal names the real voice ceiling (1800)", refused?.details?.voice_seconds_included === 1800);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 3 — month rollover resets BOTH numbers
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 3: month rollover resets both numbers ──");
{
  const state = freshState();
  const db = extendedDb(state);
  // A session survives 12 hours (`ROOM_SESSION_TTL_MS`), so it must be MINTED
  // near the month boundary it is about to cross, not months earlier - the
  // point of this section is the ROLLOVER, not an expired token.
  const mintNow = Date.parse("2026-08-31T23:30:00.000Z");
  const rolloverNow = Date.parse("2026-09-01T02:00:00.000Z");
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true },
    { loadAgent, now: mintNow },
  );
  const session = joined.session;
  const f = state.followers.find((x) => x.person_id === PERSON_A);
  f.tier = "paid";
  f.month_key = "2026-01";
  f.month_message_count = 500;
  f.voice_seconds_month = 1800;

  const turn = await roomSay(db, { session, message: "hello again, next month" }, { loadAgent, memory, reply, now: rolloverNow });
  ok("message count resets to 1 on a new month, not refused off last month's spend",
    turn.quota.messages_used === 1);
  ok("the follower row's own month_key rolled to the new month", f.month_key === monthKeyOf(rolloverNow));

  const seam = voiceSeam();
  const spoken = await roomSpeak(
    { db, loadAgent, now: rolloverNow, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
    turn.session,
    { text: turn.reply },
  );
  ok("voice seconds reset to just this clip on a new month, not refused off last month's spend",
    spoken.voice.seconds_used === estimateClipSeconds(turn.reply));
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 4 — NEGATIVE CONTROL (a): a free follower gets a named refusal and
// zero audio bytes
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 4: negative control (a) — free follower, roomSpeak ──");
{
  const state = freshState();
  const db = extendedDb(state);
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW });
  const said = await roomSay(db, { session: joined.session, message: "hi" }, { loadAgent, memory, reply, now: NOW });

  const seam = voiceSeam();
  let refused = null;
  let result = undefined;
  try {
    result = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said.session,
      { text: said.reply },
    );
  } catch (e) {
    refused = e;
  }
  ok("NEGATIVE CONTROL (a): a free follower's roomSpeak is refused, named room_voice_paid_only",
    refused instanceof RoomError && refused.code === "room_voice_paid_only",
    refused ? "" : "control did not fire — a free follower received a result, which must never happen");
  ok("NEGATIVE CONTROL (a): zero audio bytes — synth is never even called", seam.calls.synth === 0 && seam.calls.protect === 0);
  ok("NEGATIVE CONTROL (a): no result object was ever produced", result === undefined);
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 5 — NEGATIVE CONTROL (b): strike the watermark read in a COPY,
// prove the eval catches raw audio leaving
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 5: negative control (b) — strike the watermark read ──");
{
  const state = freshState();
  const db = extendedDb(state);
  const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
  const said = await roomSay(db, { session, message: "speak this back to me" }, { loadAgent, memory, reply, now: NOW });

  const seamReal = voiceSeam();
  const realSpoken = await roomSpeak(
    { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamReal.synth, protect: seamReal.protect },
    said.session,
    { text: said.reply },
  );
  const realBytes = Buffer.from(realSpoken.audio, "base64").toString("utf8");
  ok("the REAL module's returned audio carries the WATERMARK tag",
    realBytes.startsWith("WATERMARKED:"));
  ok("the REAL module's returned audio does not equal the raw synth bytes verbatim",
    !realBytes.startsWith("RAW:"));

  // THE STRIKE. A byte-for-byte copy of the real source with ONE line
  // changed: the audio-collection loop reads `synthesized.stream` (the
  // provider's raw PCM) instead of `protectedAudio.stream` (the watermarked,
  // disclosure-prefixed output of `deps.protect`) — the exact defect law 2
  // exists to make structurally impossible.
  const src = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const needle = "for await (const chunk of protectedAudio.stream) chunks.push(Buffer.from(chunk));";
  ok("the real source contains the exact line this control strikes (not moved/renamed)",
    src.includes(needle));
  const struck = src.replace(needle, "for await (const chunk of synthesized.stream) chunks.push(Buffer.from(chunk));");
  ok("the strike actually changed the source (the control is not a no-op)", struck !== src);

  const outDir = mkdtempSync(join(tmpdir(), "room-voice-strike-"));
  // The struck copy still lives at the same relative depth inside api/, so
  // its own relative imports (./_room-voice.js etc.) resolve unchanged.
  const struckPath = join(REPO, "api", `_room-surface.STRUCK-${Date.now()}.mjs`);
  writeFileSync(struckPath, struck);
  void outDir;
  try {
    const struckModule = await import(pathToFileURL(struckPath).href);
    const state2 = freshState();
    const db2 = extendedDb(state2);
    const session2 = await setupPaidFollower(db2, state2, USER_A, PERSON_A);
    const said2 = await struckModule.roomSay(db2, { session: session2, message: "speak this back to me" }, { loadAgent, memory, reply, now: NOW });
    const seamStruck = voiceSeam();
    const struckSpoken = await struckModule.roomSpeak(
      { db: db2, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamStruck.synth, protect: seamStruck.protect },
      said2.session,
      { text: said2.reply },
    );
    const struckBytes = Buffer.from(struckSpoken.audio, "base64").toString("utf8");
    ok("NEGATIVE CONTROL (b): the STRUCK copy leaks RAW, unwatermarked audio",
      struckBytes.startsWith("RAW:"),
      struckBytes.startsWith("RAW:") ? "" : "control did not fire — the strike produced watermarked audio anyway, which means this check is not load-bearing");
    ok("NEGATIVE CONTROL (b): the struck copy's leak would have been CAUGHT by the same assertion the real module passed",
      !struckBytes.startsWith("WATERMARKED:"));
  } finally {
    fs.rmSync(struckPath, { force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 6 — NEGATIVE CONTROL (c): the ledger row shape matches the preview
// lane's, so it is noticed by the same sweep (static, source-level proof)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 6: negative control (c) — same ledger shape, same sweep ──");
{
  const voiceSrc = fs.readFileSync(join(REPO, "api/_room-voice.js"), "utf8");
  ok("api/_room-voice.js imports beginOwnedVoicePreview (never re-implements the ledger insert)",
    /import\s*\{[^}]*\bbeginOwnedVoicePreview\b[^}]*\}\s*from\s+"\.\/_replica-voice-preview\.js"/.test(voiceSrc));
  ok("api/_room-voice.js actually CALLS beginOwnedVoicePreview (imported, not merely imported and unused)",
    /return\s+await\s+beginOwnedVoicePreview\s*\(/.test(voiceSrc));

  const previewSrc = fs.readFileSync(join(REPO, "api/_replica-voice-preview.js"), "utf8");
  const insertMatch = previewSrc.match(/insert into vy_replica_generation[\s\S]*?on conflict/);
  ok("api/_replica-voice-preview.js's INSERT literal is found (not moved/renamed)", Boolean(insertMatch));
  const insertText = insertMatch ? insertMatch[0] : "";
  ok("the INSERT writes purpose='voice_preview'", insertText.includes("'voice_preview'"));
  ok("the INSERT writes channel='studio_preview'", insertText.includes("'studio_preview'"));

  const driftSrc = fs.readFileSync(join(REPO, "api/_drift-watch.js"), "utf8");
  const commitMatch = driftSrc.match(/GENERATION_COMMITMENTS_SQL = `[\s\S]*?`;/);
  ok("api/_drift-watch.js's GENERATION_COMMITMENTS_SQL is found (not moved/renamed)", Boolean(commitMatch));
  const commitText = commitMatch ? commitMatch[0] : "";
  ok("the sweep's own lane filter reads purpose='voice_preview'", commitText.includes("purpose='voice_preview'"));
  ok("the sweep's own lane filter reads channel='studio_preview'", commitText.includes("channel='studio_preview'"));

  // THE CONTROL. A copy of the preview lane's insert with 'studio_preview'
  // swapped for a different channel string — the shape a Room-specific fork
  // of the ledger (the thing law 4 and this file's own header say never to
  // build) would actually produce. Proves the check above is not vacuous: a
  // real divergence between the writer and the sweep's filter is exactly
  // what it would catch.
  const diverged = insertText.replace(/'studio_preview'/g, "'room_voice_preview'");
  const sweepWantsChannel = commitText.match(/channel='([^']*)'/)?.[1] ?? "";
  ok("NEGATIVE CONTROL (c): a diverged channel literal no longer contains what the sweep filters for",
    !diverged.includes(`'${sweepWantsChannel}'`),
    diverged.includes(`'${sweepWantsChannel}'`) ? "control did not fire" : "");
}

console.log("\n── verdict ──");
console.log(`  total assertions   ${pass + fail}`);
console.log(`\nroom-paid-tier: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
