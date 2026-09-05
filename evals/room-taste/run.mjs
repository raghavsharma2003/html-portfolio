// WS-R53, migration 110. THE TASTE - offline, deterministic, $0, no DB, no
// network, no GPU.
//
//   node evals/room-taste/run.mjs
//
// A stranger asks a creator's AI three questions before joining, from
// creator material alone, remembering nothing, through the one door
// (`gatedReply`, api/_surface.js). Five sections:
//
//   §1 THREE ANSWERS THEN A 429. `roomTaste` (api/_room-taste.js) driven
//      through the REAL `api/_rate-limit.js` `consume()` and a fake
//      `vy_public_rate` (`evals/rate-limit/run.mjs`'s own fixture, copied
//      rather than imported - that file's fake is a local, unexported
//      const) - the same two-step `api/room.js`'s own `taste` op runs:
//      consume the gate, derive `turnIndex` from what it returns, call
//      `roomTaste`. Turn four never reaches `roomTaste` at all.
//   §2 THE DISCLOSURE. Carried on turn one only, and re-derivable: the SAME
//      creator name and locale produce the SAME card text `roomDisclosureCard`
//      gives the follower lane.
//   §3 THE SWITCH. `taste_enabled = false` on the room row refuses every
//      turn with a named code, before the model is ever asked.
//   §4 THE COMPILED PROMPT DIFFERS FROM A FOLLOWER'S ONLY IN THE ABSENCE OF
//      FOLLOWER MEMORY. A controlled `engine.compile()` comparison: the
//      SAME agent, medium, mode and message text, `memories` the only
//      field that varies - the resulting system prompt differs exactly
//      where a fact would render, and is byte-identical everywhere else.
//      Then the REAL source of both `roomSay` and `roomTaste` is read to
//      confirm each's own `engine.compile({...})` call site passes the
//      IDENTICAL field set (so a future field added to one and not the
//      other fails this line), with `roomTaste`'s own `memories` argument
//      a literal empty string rather than anything computed.
//   §5 NEGATIVE CONTROLS: (a) a taste turn built to import a real
//      follower-lane writer (`joinRoom`) fails `evals/room-leak/run.mjs`'s
//      own reach-proof technique, re-derived here rather than trusted
//      silently from a sibling suite; (b) the SAME fourth call that was
//      refused in §1 SUCCEEDS once the configured limit is struck to 4 -
//      proving §1's refusal is a real predicate, not a vacuously-passing
//      assertion; (c) the §4 comparator, pointed at a compiled prompt
//      deliberately seeded with a fake follower-memory string, DOES flag a
//      difference - proving the byte-diff is not vacuous either.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadFixtureAgent, freshState, fakeDb, SLUG, ROOM_ID } from "../room/fixtures.mjs";

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

const { engine, loadAgent, SHEET } = await loadFixtureAgent(REPO);
const { roomTaste, ROOM_TASTE_TURNS } = await import(pathToFileURL(join(REPO, "api/_room-taste.js")).href);
const { RoomError, roomDisclosureCard, roomNameFor, joinRoom, roomSay } = await import(
  pathToFileURL(join(REPO, "api/_room-surface.js")).href
);
const { consume, limitsFor } = await import(pathToFileURL(join(REPO, "api/_rate-limit.js")).href);

// ── the fake vy_public_rate table — evals/rate-limit/run.mjs's own fixture,
// copied rather than imported (that file's fake is a local, unexported
// const, its own precedent for the room-leak aggregate-only parser being
// copied rather than shared). Implements the REAL statement's semantics —
// the WHERE clause is the whole predicate — never a re-derived decision.
function freshRateState() {
  return new Map();
}
function fakeRateDb(state) {
  const db = async (sql, params = []) => {
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
      return [];
    }
    throw new Error(`unexpected query in evals/room-taste fake rate db: ${sql}`);
  };
  return db;
}

/** `api/room.js`'s own two-step `taste` op, reproduced exactly (consume the
 *  gate, derive `turnIndex`, call `roomTaste`) so this suite drives the SAME
 *  shape the real handler does rather than calling `roomTaste` directly with
 *  a hand-picked `turnIndex`. */
async function tasteThroughTheDoor(rateDb, roomDb, { slug, message, locale, env = process.env, now }) {
  const gate = await consume(rateDb, { scope: "room_taste", key: `${slug}:1.2.3.4`, now, env });
  if (!gate.ok) return { refused: true, code: gate.code, retryAfterSeconds: gate.retryAfterSeconds };
  const limit = limitsFor(env).room_taste.limit;
  const turnIndex = limit - gate.remaining;
  const turn = await roomTaste(roomDb, { slug, message, locale, turnIndex }, { loadAgent, now, reply: () => "a taste answer." });
  return { refused: false, turn };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: three answers then a 429 ──");
{
  const rateState = freshRateState();
  const rateDb = fakeRateDb(rateState);
  const roomState = freshState();
  const roomDb = fakeDb(roomState);
  const now = Date.parse("2026-09-04T12:00:00.000Z");

  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await tasteThroughTheDoor(rateDb, roomDb, { slug: SLUG, message: `question ${i}`, now }));
  }
  ok("turns 1-3 are accepted", results.slice(0, 3).every((r) => !r.refused));
  ok("turn 4 is refused, named, with a Retry-After",
    results[3].refused && results[3].code === "rate_limited" && Number.isFinite(results[3].retryAfterSeconds));
  ok("turn_index reads 1, 2, 3 in order",
    results.slice(0, 3).map((r) => r.turn.turn_index).join(",") === "1,2,3");
  ok("turns_left reads 2, 1, 0 in order",
    results.slice(0, 3).map((r) => r.turn.turns_left).join(",") === "2,1,0");

  // A new UTC day resets the counter - the fixed-window shape `_rate-limit.js`
  // documents, not a rolling one.
  const tomorrow = now + 24 * 60 * 60_000;
  const nextDay = await tasteThroughTheDoor(rateDb, roomDb, { slug: SLUG, message: "a new day", now: tomorrow });
  ok("the day after, the same (room, IP) gets a fresh allowance", !nextDay.refused && nextDay.turn.turn_index === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: the disclosure ──");
{
  const state = freshState();
  const db = fakeDb(state);
  const expected = roomDisclosureCard(roomNameFor(SHEET), "en");
  const t1 = await roomTaste(db, { slug: SLUG, message: "who are you?", turnIndex: 1 }, { loadAgent, reply: () => "hi." });
  ok("turn 1 carries the disclosure, and it is the SAME card text roomDisclosureCard gives the follower lane",
    t1.disclosure === expected);
  const t2 = await roomTaste(db, { slug: SLUG, message: "and now?", turnIndex: 2 }, { loadAgent, reply: () => "still here." });
  ok("turn 2 carries no disclosure", t2.disclosure === null);
  const hi = await roomTaste(db, { slug: SLUG, message: "namaste", locale: "hi", turnIndex: 1 }, { loadAgent, reply: () => "hi." });
  ok("a Hindi hint on turn 1 gets the Hindi card", hi.disclosure === roomDisclosureCard(roomNameFor(SHEET), "hi"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: the switch ──");
{
  const state = freshState();
  state.rooms[0].taste_enabled = false;
  const db = fakeDb(state);
  let threw = null;
  try {
    await roomTaste(db, { slug: SLUG, message: "hello?", turnIndex: 1 }, { loadAgent, reply: () => "should never run" });
  } catch (e) { threw = e; }
  ok("a Room with taste_enabled=false refuses every turn with a named code, before the model is asked",
    threw instanceof RoomError && threw.code === "room_taste_disabled");

  const onState = freshState();
  ok("a fixture room with no explicit taste_enabled column reads as enabled (migration 110's own default)",
    onState.rooms[0].taste_enabled === undefined);
  const onDb = fakeDb(onState);
  const t = await roomTaste(onDb, { slug: SLUG, message: "hello?", turnIndex: 1 }, { loadAgent, reply: () => "hi." });
  ok("...and a taste turn against it is accepted", Boolean(t.reply));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: the compiled prompt differs from a follower's only in the absence of memory ──");

/** The one comparator this whole section is built on: every key BOTH
 *  objects carry must be identical except the keys named in `expectedDiff`.
 *  Returns the list of keys that differ OUTSIDE the expected set - empty
 *  means "differs only where expected". */
function diffOutside(a, b, expectedDiff) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const bad = [];
  for (const k of keys) {
    if (expectedDiff.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(k);
  }
  return bad;
}

const COMPILE_BASE = {
  agent: engine.sheetToModule(SHEET),
  user: { name: "", vibe: [], facts: {} },
  messageCount: 0,
  medium: "text",
  mode: "chat",
  voiceEngine: "none",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  herLife: "",
  cultureNoteText: "",
  latestUserText: "what do you teach?",
};

{
  const noMemory = engine.compile({ ...COMPILE_BASE, memories: "" });
  const withMemory = engine.compile({ ...COMPILE_BASE, memories: "- prefers worked examples over theory" });
  ok("compile() with a follower memory string produces a DIFFERENT system prompt than with none",
    noMemory.system !== withMemory.system);
  ok("...and the difference is exactly the memory content appearing",
    withMemory.system.includes("prefers worked examples over theory") &&
      !noMemory.system.includes("prefers worked examples over theory"));
  // Three fields carry the memory dimension: `system` (the fact text itself),
  // `sections` (the compiler's own per-section length instrumentation - the
  // section that rendered the fact is naturally longer), and `tail` (the
  // relationship-stage framing, which legitimately reads "have we talked
  // before" off the same signal). Every OTHER field - the persona, the
  // safety floor, the never-rules, the register bullets - is byte-identical
  // either way, which is the actual claim this section exists to prove.
  ok("every OTHER compiled field (persona, safety floor, never-rules, register bullets) is byte-identical either way",
    diffOutside(noMemory, withMemory, new Set(["system", "sections", "tail"])).length === 0,
    diffOutside(noMemory, withMemory, new Set(["system", "sections", "tail"])).join(","));
}

{
  // Both call sites' OWN source, read rather than retyped - a field added to
  // one `engine.compile({...})` call and not the other fails this line the
  // day it happens.
  const roomSurfaceSrc = fs.readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const roomTasteSrc = fs.readFileSync(join(REPO, "api/_room-taste.js"), "utf8");
  const compileArgKeys = (src) => {
    const m = src.match(/engine\.compile\(\{([\s\S]*?)\n {2}\}\);/);
    if (!m) return null;
    return [...m[1].matchAll(/^\s*(\w+):/gm)].map((mm) => mm[1]);
  };
  const sayKeys = compileArgKeys(roomSurfaceSrc);
  const tasteKeys = compileArgKeys(roomTasteSrc);
  ok("roomSay's own engine.compile({...}) call is found in api/_room-surface.js (not moved/renamed)", Array.isArray(sayKeys));
  ok("roomTaste's own engine.compile({...}) call is found in api/_room-taste.js (not moved/renamed)", Array.isArray(tasteKeys));
  ok("both call sites pass the IDENTICAL set of fields to engine.compile()",
    Array.isArray(sayKeys) && Array.isArray(tasteKeys) &&
      JSON.stringify([...sayKeys].sort()) === JSON.stringify([...tasteKeys].sort()),
    JSON.stringify({ say: sayKeys, taste: tasteKeys }));
  ok("roomTaste's own memories argument is a literal empty string, never a computed one",
    /memories:\s*""/.test(roomTasteSrc));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: negative controls ──");

// (a) A hand-built "taste turn" that imports the real follower-lane writer
// (joinRoom) fails the SAME static reach technique evals/room-leak/run.mjs
// uses - re-derived here, not trusted silently from a sibling suite.
{
  const poisoned = `
import { joinRoom } from "./_room-surface.js";
export async function roomTaste() { return joinRoom(); }
`;
  const ALLOWED_FROM_ROOM_SURFACE = new Set([
    "RoomError", "roomUnavailable", "resolveRoom", "roomNameFor",
    "roomDisclosureCard", "normalizeLocale", "collector", "ROOM_INBOUND_LIMIT",
  ]);
  const m = poisoned.match(/import\s*\{([^}]*)\}\s*from\s+"\.\/_room-surface\.js"/);
  const got = m ? m[1].split(",").map((s) => s.trim()) : [];
  const disallowed = got.filter((n) => !ALLOWED_FROM_ROOM_SURFACE.has(n));
  ok("NEGATIVE CONTROL: a taste module importing joinRoom fails the allowlist check the real file passes",
    disallowed.length === 1 && disallowed[0] === "joinRoom");
}

// (b) Strike the configured limit to 4 (via RATE_LIMITS_JSON) and confirm
// the SAME fourth call §1 refused now succeeds - proving that refusal was a
// real predicate over the configured limit, not a vacuously-passing check.
{
  const rateState = freshRateState();
  const rateDb = fakeRateDb(rateState);
  const roomState = freshState();
  const roomDb = fakeDb(roomState);
  const env = { ...process.env, RATE_LIMITS_JSON: JSON.stringify({ room_taste: { limit: 4 } }) };
  const now = Date.parse("2026-09-04T12:00:00.000Z");
  const results = [];
  for (let i = 0; i < 4; i++) {
    results.push(await tasteThroughTheDoor(rateDb, roomDb, { slug: SLUG, message: `q${i}`, now, env }));
  }
  ok("NEGATIVE CONTROL: with the limit struck to 4, the fourth call that §1 refused now succeeds",
    results.every((r) => !r.refused));
}

// (c) The §4 comparator, pointed at a compiled prompt deliberately seeded
// with a fake follower-memory string standing in for a `roomTaste` that
// (hypothetically) leaked one, DOES flag the difference.
{
  const honest = engine.compile({ ...COMPILE_BASE, memories: "" });
  const leaked = engine.compile({ ...COMPILE_BASE, memories: "- a fake follower's own private fact" });
  const flagged = diffOutside(honest, leaked, new Set());
  ok("NEGATIVE CONTROL: the comparator (with NO expected-diff allowance) flags 'system' the moment memory leaks in",
    flagged.includes("system"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: WS-R80 — the island, static ──");

const ISLAND_PATH = join(REPO, "public/creator-taste.js");
const ISLAND_SRC = fs.readFileSync(ISLAND_PATH, "utf8");

// (a) parses, is dependency-free, and fits the size cap — `evals/room-embed/
// run.mjs`'s own §1 technique, applied to a real file on disk instead of an
// exported string constant (this island has no server-side counterpart to
// export it from: `/c/:slug` has no client bundle at all).
{
  let parsed = true;
  try {
    // eslint-disable-next-line no-new-func
    new Function("document", "fetch", ISLAND_SRC);
  } catch {
    parsed = false;
  }
  ok("new Function(ISLAND_SRC) does not throw", parsed);
  ok("dependency-free (no import, no require)", !/\brequire\(|^\s*import\s/m.test(ISLAND_SRC));

  const rawBytes = Buffer.byteLength(ISLAND_SRC, "utf8");
  console.log(`  info  raw source: ${rawBytes} bytes`);
  let minified = "";
  let minifyRan = true;
  try {
    minified = execFileSync("npx", ["--no-install", "esbuild", "--minify", "--loader=js"], {
      input: ISLAND_SRC,
      cwd: REPO,
      encoding: "utf8",
    });
  } catch (e) {
    minifyRan = false;
    console.log(`  info  esbuild minify unavailable offline: ${e.message.split("\n")[0]}`);
  }
  if (minifyRan) {
    const minBytes = Buffer.byteLength(minified, "utf8");
    console.log(`  info  minified: ${minBytes} bytes`);
    ok("minified island is under 6 KB (WS-R46's own room-embed.js budget)", minBytes < 6144, `${minBytes} bytes`);
  } else {
    ok("raw (unminified) island is under 6 KB, as a floor", rawBytes < 6144, `${rawBytes} bytes`);
  }
}

// (b) THE ONE FETCH TARGET, and THE ONE OP LITERAL — `api/_room-embed.js`'s
// own "one fetch, one target" technique, pointed at the op the request body
// carries rather than the URL. A follower op reaching this file (say, join
// or say) would mean a stranger's browser, on a page this platform does not
// control, could be made to mint a session or send a message it never
// showed a disclosure for — the exact boundary `api/_room-taste.js`'s own
// header states for the server side, checked here for the client the
// workstream brief actually ships.
function onlyFetchesApiRoom(src) {
  const calls = [...src.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  if (calls.length === 0) return false;
  return calls.every((argText) => /["']\/api\/room["']/.test(argText));
}

function opLiteralsSent(src) {
  // Every `op:` field value literal anywhere in the source — a JSON.stringify
  // call site's own op field, matched narrowly (a quoted literal right after
  // `op:`) so a computed op (which this house style never uses, `api/room.js`'s
  // own header states the op is always a literal string at every call site)
  // would fail to match and this function would rightly find zero op
  // literals rather than pretend to have proven anything about it.
  return [...src.matchAll(/\bop:\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
}

const FOLLOWER_OPS = new Set([
  "join", "say", "speak", "history", "thread", "locale", "pulse_optin", "pulse_revoke",
  "push_subscribe", "push_unsubscribe", "push_status", "whatsapp_optin", "whatsapp_stop",
  "whatsapp_status", "offer_dismiss", "settings", "settings_reviewed", "citations",
  "flag", "unflag", "flags", "export", "forget",
]);

{
  ok("the real island: exactly one fetch, and it names /api/room", onlyFetchesApiRoom(ISLAND_SRC));
  const ops = [...new Set(opLiteralsSent(ISLAND_SRC))];
  ok("the real island sends exactly one DISTINCT op literal (code, not this file's own comments)",
    ops.length === 1, JSON.stringify(ops));
  ok("...and it is \"taste\", never a follower op", ops[0] === "taste");
  ok("the real island's source names no follower op literal anywhere, not just in a fetch body",
    [...FOLLOWER_OPS].every((op) => !new RegExp(`["']${op}["']`).test(ISLAND_SRC)));

  const corruptedFetch = ISLAND_SRC.replace('fetch("/api/room"', 'fetch("/api/room"); fetch("/api/account"');
  ok("NEGATIVE CONTROL: a second fetch to a different address is caught",
    !onlyFetchesApiRoom(corruptedFetch));

  const corruptedOp = ISLAND_SRC.replace('op: "taste"', 'op: "join"');
  ok("NEGATIVE CONTROL: a follower op swapped in for \"taste\" is caught",
    opLiteralsSent(corruptedOp).includes("join") && !opLiteralsSent(corruptedOp).includes("taste"));
}

// (c) NEVER innerHTML — a visitor's own typed question, and the model's own
// reply text, are both attacker-reachable strings on a page this platform
// does not gate behind a session; this island must only ever place them on
// the page with `textContent`.
{
  ok("the real island never assigns .innerHTML", !/\.innerHTML\s*=/.test(ISLAND_SRC));
  ok("...it renders dynamic text with .textContent instead", /\.textContent\s*=/.test(ISLAND_SRC));
}

console.log(`\nroom-taste: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
