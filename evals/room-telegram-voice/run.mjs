// WS-R110. Voice replies on Telegram: the SAME watermarked clip `roomSpeak`
// already renders for the web Room (WS-R19), bound to the SAME gated reply,
// metered by the SAME per-second ceiling, sent through Telegram's own
// `sendVoice`.
//
//   node evals/room-telegram-voice/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no Telegram call, no model
// call, no GPU. Drives the REAL `api/_room-telegram.js` (through a fake `db`
// and a fake Telegram client, `evals/room-telegram/run.mjs`'s own fixture
// world) and the REAL `roomSpeak`/`pcmToWavBuffer` it imports — never a
// second synthesis path, never a hand-rolled voice reply.
//
// ── what this suite is actually guarding ────────────────────────────────
//
// 1. THE TOGGLE. `/voice on` and `/voice off` are parsed and answered
//    honestly — this deployment has no available column to store a
//    per-follower preference without a migration this workstream does not
//    have (`context/rejected.md#ws-r110-room-telegram-voice-preference-
//    no-available-column`) — and, the real correctness concern, NEITHER
//    command reaches `roomSay`: a follower typing either must never spend
//    a message from their monthly cap on a confused reply from the
//    creator's AI.
// 2. THE PAID GATE. A free follower's ordinary message never reaches
//    voice synthesis — NEGATIVE CONTROL, struck deliberately, proving
//    `roomSpeak`'s own structural gate (not this file's judgement) is what
//    refuses it.
// 3. THE CEILING, spent by the SAME predicate `roomSpeak` already uses
//    (a fake db counting seconds, `evals/room-paid-tier/run.mjs`'s own
//    fixture shape) — a refusal sends `voiceCappedCard` at most once a day.
// 4. THE REQUEST SHAPE pinned: `pcmToWavBuffer`'s header is a real,
//    byte-exact RIFF/WAVE container over the SAME PCM bytes `roomSpeak`
//    returned, never a re-encode; `tgSendVoice`'s own source names
//    `chat_id`, a `voice` multipart field, and Telegram's `sendVoice`
//    method by name — verified STATICALLY (a static scan, never a live
//    call — `defaultRoomTelegramClient`'s own header: "never called from
//    an offline eval").
// 5. A SYNTHESIS FAILURE records one incident (the existing `door_5xx`
//    kind, `door: "room-tg-voice"`) and sends nothing — the text reply has
//    already left by the time voice is even attempted.
// 6. `ROOM_VOICE` OFF (the default): nothing is attempted, nothing is
//    constructed, no fake is even asked for a reply.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SLUG, loadFixtureAgent, freshState, fakeDb } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const API = join(REPO, "api");

process.env.ROOM_SESSION_SECRET = "v".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const tg = await import(pathToFileURL(join(API, "_room-telegram.js")).href);
const {
  handleRoomTelegramUpdate,
  parseVoiceCommand,
  voiceCommandCard,
  voiceCappedCard,
} = tg;
const surface = await import(pathToFileURL(join(API, "_room-surface.js")).href);
const { roomSpeak, RoomError } = surface;
const roomVoice = await import(pathToFileURL(join(API, "_room-voice.js")).href);
const { pcmToWavBuffer, ROOM_TELEGRAM_VOICE_CONTAINER } = roomVoice;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const BASE_ENV = { ROOM_SESSION_SECRET: process.env.ROOM_SESSION_SECRET, ROOM_TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) };
const monthKeyOf = (at) => new Date(at).toISOString().slice(0, 7);
const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const THIS_MONTH = monthKeyOf(NOW);

// ── the fake `db`, extended with `vy_room_voice_usage` — `evals/room-
//    paid-tier/run.mjs`'s own `extendedDb`, unmodified in shape. ──────────
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

// ── the fake Telegram wire, extended with sendVoice ────────────────────
function fakeTgClient(sent) {
  return {
    sendMessage: async (chatId, text) => {
      (sent[chatId] ??= []).push({ kind: "text", text: String(text) });
      return { ok: true };
    },
    sendDocument: async (chatId, buffer, filename, caption) => {
      (sent[chatId] ??= []).push({ kind: "document", filename, caption });
      return { ok: true };
    },
    sendVoice: async (chatId, buffer, mimeType) => {
      (sent[chatId] ??= []).push({ kind: "voice", buffer, mimeType });
      return { ok: true };
    },
    answerCallbackQuery: async () => ({ ok: true }),
  };
}
const texts = (sent, chatId) => (sent[chatId] || []).filter((m) => m.kind === "text").map((m) => m.text);
const voices = (sent, chatId) => (sent[chatId] || []).filter((m) => m.kind === "voice");

const textUpdate = (tgUserId, text) => ({
  message: { chat: { id: Number(tgUserId), type: "private" }, from: { id: Number(tgUserId), username: `u${tgUserId}` }, text, message_id: 1 },
});
const callbackUpdate = (tgUserId, data) => ({
  callback_query: { id: `cbq${tgUserId}${data}`, from: { id: Number(tgUserId), username: `u${tgUserId}` }, message: { chat: { id: Number(tgUserId) } }, data },
});

function fakePersonBridge(state) {
  const findPerson = async (surfaceName, surfaceUserId) => {
    const key = String(surfaceUserId);
    const row = state.surfaceIdentities.find((r) => r.surface === surfaceName && r.surface_user_id === key);
    return row ? { person_id: row.person_id, username: row.handle || "", via: "vy_surface_identity" } : null;
  };
  const linkPerson = async (surfaceName, surfaceUserId, { handle = "" } = {}) => {
    const existing = await findPerson(surfaceName, surfaceUserId);
    if (existing) return { personId: existing.person_id, created: false };
    const key = String(surfaceUserId);
    const pid = `pp-${surfaceName}-${key}`;
    if (!state.persons.some((p) => p.person_id === pid)) state.persons.push({ person_id: pid, age_tier: "unverified" });
    state.surfaceIdentities.push({ surface: surfaceName, surface_user_id: key, person_id: pid, handle: String(handle || "").slice(0, 64) });
    return { personId: pid, created: true };
  };
  return { findPerson, linkPerson };
}

const personTables = async () => [];
const memory = { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] };

function depsFor(state, db, tgClient, extra = {}) {
  const bridge = fakePersonBridge(state);
  return {
    db, tg: tgClient, loadAgent, engine, env: { ...BASE_ENV },
    memory, personTables, tableApplied: async () => false,
    personForSurfaceUser: bridge.findPerson,
    linkSurfacePerson: bridge.linkPerson,
    now: NOW,
    ...extra,
  };
}

async function fullJoin(state, db, tgClient, tgUserId, extra = {}) {
  await handleRoomTelegramUpdate(textUpdate(tgUserId, `/start ${SLUG}`), depsFor(state, db, tgClient, extra));
  await handleRoomTelegramUpdate(callbackUpdate(tgUserId, `a1:${SLUG}`), depsFor(state, db, tgClient, extra));
  await handleRoomTelegramUpdate(callbackUpdate(tgUserId, `m1:${SLUG}`), depsFor(state, db, tgClient, extra));
}

function personIdFor(state, tgUserId) {
  return state.surfaceIdentities.find((r) => r.surface === "telegram" && r.surface_user_id === String(tgUserId))?.person_id;
}

// A fake, tagged synth + protect pair — `evals/room-paid-tier/run.mjs`'s own
// `voiceSeam`, unmodified in shape.
function repeatableStream(chunk) {
  return { [Symbol.asyncIterator]: async function* () { yield chunk; } };
}
function voiceSeam() {
  const calls = { synth: 0, protect: 0 };
  const synth = async ({ authorized, text }) => {
    calls.synth += 1;
    const raw = Buffer.from(`RAW:${authorized.generation.generation_id}:${text}`);
    return { stream: repeatableStream(raw), format: { sampleRate: 24000, channels: 1 }, renderedText: text, disclosureText: "This is an AI voice.", renderer: "fake" };
  };
  const protect = async ({ sourceStream }) => {
    calls.protect += 1;
    const chunks = [];
    for await (const c of sourceStream) chunks.push(Buffer.from(c));
    const watermarked = Buffer.concat([Buffer.from("WATERMARKED:"), ...chunks]);
    return { stream: repeatableStream(watermarked), completion: Promise.resolve({ watermark_algorithm: "fake@1", disclosure_scheme: "audible-prefix-v1" }) };
  };
  return { calls, synth, protect };
}
function fakeAuthorize(replicaId = "c1000000-0000-4000-8000-000000000001", ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  let seq = 0;
  return async () => {
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

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: pcmToWavBuffer is a pure, byte-exact container ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  const wav = pcmToWavBuffer(pcm, { sampleRate: 24000, channels: 1 });
  ok("44-byte header + the exact PCM bytes, nothing more, nothing less", wav.length === 44 + pcm.length);
  ok("RIFF magic", wav.toString("ascii", 0, 4) === "RIFF");
  ok("WAVE magic", wav.toString("ascii", 8, 12) === "WAVE");
  ok("fmt chunk id", wav.toString("ascii", 12, 16) === "fmt ");
  ok("data chunk id", wav.toString("ascii", 36, 40) === "data");
  ok("PCM format code is 1 (no compression)", wav.readUInt16LE(20) === 1);
  ok("channel count is carried through", wav.readUInt16LE(22) === 1);
  ok("sample rate is carried through (24000)", wav.readUInt32LE(24) === 24000);
  ok("bits per sample is 16 (pcm_s16le, VOICE_PCM_FORMAT's only encoding)", wav.readUInt16LE(34) === 16);
  ok("data chunk size names the PCM byte length exactly", wav.readUInt32LE(40) === pcm.length);
  ok("the PCM samples themselves are byte-identical, untouched", wav.subarray(44).equals(pcm));
  ok("calling it twice on the same input is byte-identical (pure, deterministic)", pcmToWavBuffer(pcm, { sampleRate: 24000, channels: 1 }).equals(wav));
  const stereo = pcmToWavBuffer(pcm, { sampleRate: 16000, channels: 2 });
  ok("a different format is actually reflected (never a hardcoded header)", stereo.readUInt16LE(22) === 2 && stereo.readUInt32LE(24) === 16000);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: /voice on and /voice off — parsed, and answered honestly ──");
// ═════════════════════════════════════════════════════════════════════════
ok("/voice on parses", parseVoiceCommand("/voice on") === "on");
ok("/voice off parses", parseVoiceCommand("/voice off") === "off");
ok("/voice@bot on (the @-mention form) still parses", parseVoiceCommand("/voice@RoomBot on") === "on");
ok("a bare /voice (no argument) is not one of the two", parseVoiceCommand("/voice") === null);
ok("an unrecognised argument is not one of the two", parseVoiceCommand("/voice maybe") === null);

{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9001");
  const pid = personIdFor(state, "9001");
  const before = state.followers.find((f) => f.person_id === pid).month_message_count;

  await handleRoomTelegramUpdate(textUpdate("9001", "/voice off"), depsFor(state, db, tgClient));
  const afterOff = state.followers.find((f) => f.person_id === pid);
  ok("/voice off gets the honest acknowledgement card, verbatim", texts(sent, "9001").at(-1) === voiceCommandCard());
  ok("/voice off spends NO message from the monthly cap", afterOff.month_message_count === before);

  await handleRoomTelegramUpdate(textUpdate("9001", "/voice on"), depsFor(state, db, tgClient));
  const afterOn = state.followers.find((f) => f.person_id === pid);
  ok("/voice on gets the SAME honest acknowledgement card (nothing to toggle)", texts(sent, "9001").at(-1) === voiceCommandCard());
  ok("/voice on spends NO message from the monthly cap either", afterOn.month_message_count === before);

  let sayReached = false;
  const poisonedReply = async () => { sayReached = true; return "should never be called"; };
  await handleRoomTelegramUpdate(textUpdate("9001", "/voice off"), depsFor(state, db, tgClient, { reply: poisonedReply }));
  ok("neither command ever reaches the model (never treated as an ordinary chat message)", sayReached === false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: ROOM_VOICE off (the default) — nothing attempted, nothing built ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9002");
  const pid = personIdFor(state, "9002");
  state.followers.find((f) => f.person_id === pid).tier = "paid";

  let buildCalls = 0;
  const buildVoiceDeps = () => { buildCalls++; return voiceSeam(); };
  const out = await handleRoomTelegramUpdate(
    textUpdate("9002", "hello"),
    depsFor(state, db, tgClient, { reply: async () => "hi there", authorize: fakeAuthorize(), buildVoiceDeps }),
  );
  ok("ROOM_VOICE unset: the text reply still arrives", texts(sent, "9002").at(-1) === "hi there");
  ok("ROOM_VOICE unset: no voice was even attempted", out.voice.attempted === false && out.voice.reason === "off");
  ok("ROOM_VOICE unset: the real wiring factory was never even called", buildCalls === 0);
  ok("ROOM_VOICE unset: no voice bubble was sent", voices(sent, "9002").length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: a paid follower, ROOM_VOICE=1 — the happy path ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9003");
  const pid = personIdFor(state, "9003");
  state.followers.find((f) => f.person_id === pid).tier = "paid";

  const seam = voiceSeam();
  const env = { ...BASE_ENV, ROOM_VOICE: "1" };
  const out = await handleRoomTelegramUpdate(
    textUpdate("9003", "how are you"),
    depsFor(state, db, tgClient, { reply: async () => "doing well, and you?", authorize: fakeAuthorize(), buildVoiceDeps: () => seam, env }),
  );
  ok("the text reply arrives", texts(sent, "9003").at(-1) === "doing well, and you?");
  ok("the text reply lands BEFORE the voice clip in delivery order", sent["9003"].at(-2)?.kind === "text" && sent["9003"].at(-1)?.kind === "voice");
  ok("a voice clip was sent through sendVoice, after the text", voices(sent, "9003").length === 1);
  ok("the outer handler still reports success", out.ok === true && out.voice.attempted === true && out.voice.ok === true);
  const clip = voices(sent, "9003")[0];
  ok("the mime type sent is honestly what was actually sent (audio/wav)", clip.mimeType === "audio/wav");
  ok("the bytes are a real WAV container (RIFF/WAVE)", clip.buffer.toString("ascii", 0, 4) === "RIFF" && clip.buffer.toString("ascii", 8, 12) === "WAVE");
  ok("the container's data bytes are the SAME watermarked bytes protect() produced, not raw synth output", clip.buffer.subarray(44).toString("utf8").startsWith("WATERMARKED:RAW:"));
  ok("a usage row was written (the SAME ledger roomSpeak already writes)", db.usage.some((u) => u.person_id === pid));
  ok("exactly one synth call, exactly one protect call — never a second synthesis path", seam.calls.synth === 1 && seam.calls.protect === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: NEGATIVE CONTROL — a free follower never reaches synthesis ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9004"); // tier defaults to "free"

  const seam = voiceSeam();
  const env = { ...BASE_ENV, ROOM_VOICE: "1" };
  const out = await handleRoomTelegramUpdate(
    textUpdate("9004", "hello"),
    depsFor(state, db, tgClient, { reply: async () => "hi!", authorize: fakeAuthorize(), buildVoiceDeps: () => seam, env }),
  );
  ok("the text reply still arrives for a free follower", texts(sent, "9004").at(-1) === "hi!");
  ok("voice was attempted but refused, named room_voice_paid_only — roomSpeak's OWN structural gate, not this file's judgement", out.voice.attempted === true && out.voice.ok === false && out.voice.reason === "room_voice_paid_only");
  ok("NEGATIVE CONTROL: synth was NEVER called for a free follower", seam.calls.synth === 0);
  ok("no voice bubble was sent to a free follower", voices(sent, "9004").length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: the ceiling — spent by roomSpeak's own predicate, capped once a day ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9005");
  const pid = personIdFor(state, "9005");
  const f = state.followers.find((x) => x.person_id === pid);
  f.tier = "paid";
  f.voice_month_key = THIS_MONTH;
  f.voice_seconds_month = state.rooms.find((r) => r.room_id === f.room_id).paid_monthly_voice_seconds; // already spent

  const seam = voiceSeam();
  const env = { ...BASE_ENV, ROOM_VOICE: "1" };
  const consumeCalls = [];
  const fakeConsume = async (_db, { key }) => { consumeCalls.push(key); return { ok: true, remaining: 0, retryAfterSeconds: 60 }; };

  const out1 = await handleRoomTelegramUpdate(
    textUpdate("9005", "one more thing"),
    depsFor(state, db, tgClient, { reply: async () => "sure, go on", authorize: fakeAuthorize(), buildVoiceDeps: () => seam, env, consume: fakeConsume }),
  );
  ok("the text reply still arrives at the ceiling", texts(sent, "9005").includes("sure, go on"));
  ok("voice is refused, named room_voice_cap_reached, and never reaches synth", out1.voice.reason === "capped" && seam.calls.synth === 0);
  ok("the capped card was sent the FIRST time (the day's slot was free), right after the text reply",
    sent["9005"].at(-2)?.text === "sure, go on" && sent["9005"].at(-1)?.text === voiceCappedCard());
  ok("the day-scoped rate gate was actually consulted, keyed on the follower's own id", consumeCalls.includes(String(f.follower_id)));

  // A SECOND capped turn the same day must not send the card again.
  const fakeConsumeSecond = async () => ({ ok: false, remaining: 0, retryAfterSeconds: 60 }); // the day's slot is gone
  const beforeTextCount = texts(sent, "9005").length;
  await handleRoomTelegramUpdate(
    textUpdate("9005", "and one more"),
    depsFor(state, db, tgClient, { reply: async () => "still here", authorize: fakeAuthorize(), buildVoiceDeps: () => seam, env, consume: fakeConsumeSecond }),
  );
  ok("a SECOND capped turn the same day sends ONLY the new text reply (no second capped card)",
    texts(sent, "9005").length === beforeTextCount + 1 && texts(sent, "9005").at(-1) === "still here");
  ok("across both turns, the capped card was sent exactly ONCE", texts(sent, "9005").filter((t) => t === voiceCappedCard()).length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: a synthesis failure records one incident, sends nothing ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = extendedDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  await fullJoin(state, db, tgClient, "9006");
  const pid = personIdFor(state, "9006");
  state.followers.find((f) => f.person_id === pid).tier = "paid";

  const brokenSeam = { synth: async () => { throw Object.assign(new Error("provider timed out"), { code: "voice_provider_timeout" }); }, protect: async () => { throw new Error("unreachable"); } };
  const incidents = [];
  const fakeRecordIncident = async (_db, row) => { incidents.push(row); return { ok: true }; };
  const env = { ...BASE_ENV, ROOM_VOICE: "1" };

  const textCountBefore = texts(sent, "9006").length;
  const out = await handleRoomTelegramUpdate(
    textUpdate("9006", "tell me something"),
    depsFor(state, db, tgClient, { reply: async () => "here is something", authorize: fakeAuthorize(), buildVoiceDeps: () => brokenSeam, env, recordIncident: fakeRecordIncident }),
  );
  ok("the text reply still arrives despite the synthesis failure", texts(sent, "9006").at(-1) === "here is something");
  ok("voice reports a failure, named", out.voice.attempted === true && out.voice.ok === false && out.voice.reason === "failed");
  ok("no voice bubble, and no extra text bubble either — sends nothing, per law 3",
    voices(sent, "9006").length === 0 && texts(sent, "9006").length === textCountBefore + 1);
  ok("exactly one incident was recorded, under the EXISTING door_5xx kind (no new INCIDENT_KINDS member)", incidents.length === 1 && incidents[0].kind === "door_5xx" && incidents[0].door === "room-tg-voice");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: the request shape to Telegram, pinned STATICALLY ──");
// ═════════════════════════════════════════════════════════════════════════
//
// `defaultRoomTelegramClient`'s own header: "never called from an offline
// eval" — no real `fetch` is exercised here, `evals/room-telegram/run.mjs`'s
// own posture, restated. A source scan is what proves the SHAPE without a
// live call.
{
  const src = fs.readFileSync(join(API, "_room-telegram.js"), "utf8");
  ok('tgSendVoice posts to Telegram\'s own "sendVoice" method by name', /bot\$\{token\}\/sendVoice/.test(src));
  ok("the chat is named chat_id in the multipart body, matching every other Telegram send in this file", /form\.append\("chat_id"/.test(src));
  ok('the clip travels in a field literally named "voice" — Telegram\'s own Voice-carrying parameter', /form\.append\("voice"/.test(src));
  ok("the clip is sent as a real Blob (a multipart FILE part, not a string field)", /new Blob\(\[buffer\]/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9: no new person-lane writer — the leak battery's own aggregate is untouched ──");
// ═════════════════════════════════════════════════════════════════════════
//
// This workstream's own SQL surface is exactly two statements, neither of
// them a follower/person-lane table: `consume()` (vy_public_rate,
// api/_rate-limit.js) and `recordIncident()` (vy_incident,
// api/_incidents.js) — both already exist, already reused, and neither is
// scoped to a room/person/agent triple the leak battery's world model
// tracks. `roomSpeak` itself (the only NEW SQL this workstream's own reply
// path reaches) is WS-R19's, unmodified. Verified here as a static claim
// about this file's own import list — the behavioural proof is running
// `evals/room-leak/run.mjs` before and after this workstream's diff and
// diffing the two runs' own printed totals, done for this report rather
// than embedded as a runtime assertion no fixture world could make
// meaningfully stronger.
{
  const src = fs.readFileSync(join(API, "_room-telegram.js"), "utf8");
  ok("this file's own SQL surface for voice is exactly consume()/recordIncident() plus the reused roomSpeak — no raw `insert`/`update` was added for voice", !/insert into vy_room_(follower|thread)/i.test(src.split("VOICE DELIVERY")[1] || "") );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §10: WS-R114 — the codec requirement, pinned from the document's own words ──");
// ═════════════════════════════════════════════════════════════════════════
//
// WS-R110 shipped the WAV container marked UNVERIFIED whether it renders as
// a playable Telegram voice bubble. WS-R114 fetched `core.telegram.org/bots
// /api` in full (curl to a file, 860,075 bytes, HTTP 200 — the truncation
// WS-R41/WS-R60 hit on this exact page was the summarizing fetch tool, not
// the page itself) and read `sendVoice`'s own paragraph, fetched 2026-09-05:
// "your audio must be in an .OGG file encoded with OPUS, or in .MP3 format,
// or in .M4A format (other formats may be sent as Audio or Document)." This
// section pins that finding as a STRUCTURAL fact
// (`ROOM_TELEGRAM_VOICE_CONTAINER`, api/_room-voice.js) rather than leaving
// it only in a comment, so it cannot silently go stale the way the ORIGINAL
// unverified claim could have.
{
  ok("the container's own extension is 'wav'", ROOM_TELEGRAM_VOICE_CONTAINER.extension === "wav");
  ok("the container's own mime type is 'audio/wav'", ROOM_TELEGRAM_VOICE_CONTAINER.mimeType === "audio/wav");
  ok(
    "Telegram's own document lists exactly three sendVoice formats: OGG/Opus, MP3, M4A",
    JSON.stringify(ROOM_TELEGRAM_VOICE_CONTAINER.telegramSendVoiceDocumentedFormats) === JSON.stringify(["ogg-opus", "mp3", "m4a"]),
  );
  ok(
    "WAV is honestly none of the three — this is now VERIFIED against the document, not carried from general knowledge",
    ROOM_TELEGRAM_VOICE_CONTAINER.meetsSendVoiceFormatRequirement === false,
  );
  const clipMime = ROOM_TELEGRAM_VOICE_CONTAINER.mimeType;
  ok(
    "the actual outbound clip uses the SAME constant the compliance fact describes (single source of truth)",
    !ROOM_TELEGRAM_VOICE_CONTAINER.telegramSendVoiceDocumentedFormats.some((f) => clipMime.includes(f.replace("-opus", ""))),
  );
  const src = fs.readFileSync(join(API, "_room-telegram.js"), "utf8");
  ok(
    "tgSendVoice's filename is built from the container constant, never a second hardcoded extension",
    /`reply\.\$\{ROOM_TELEGRAM_VOICE_CONTAINER\.extension\}`/.test(src),
  );
  ok(
    "the shipping sendVoice call sends the container constant's own mime type, never a second hardcoded literal",
    /tg\.sendVoice\(ev\.chatId, wav, ROOM_TELEGRAM_VOICE_CONTAINER\.mimeType\)/.test(src),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
