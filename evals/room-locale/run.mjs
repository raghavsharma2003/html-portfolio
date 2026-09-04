// The Room in Hindi (WS-R24, migration 087) — offline, deterministic, $0.
//
//   node evals/room-locale/run.mjs
//
// What this suite is actually guarding:
//
// 1. KEY PARITY. `ROOM_COPY_TABLE.en` and `ROOM_COPY_TABLE.hi` carry the
//    EXACT same keys at every level, asserted against the REAL export rather
//    than a hand-maintained list — a key added to one locale and forgotten in
//    the other is a follower who taps a button and reads nothing.
// 2. THE DISCLOSURE CARD'S THREE FACTS, IN BOTH LANGUAGES. never-deny-AI
//    first, then the creator-built-it fact, then the private-scope fact —
//    checked against the REAL `roomDisclosureCard`, not a copy of its words.
// 3. setLocale IS SCOPED OFF THE SESSION. A follower cannot set another
//    follower's locale — proven by actually trying, through the real
//    `roomSetLocale`, against a fake db with two followers in one room.
// 4. THE TELEGRAM language_code MAPPING. Real `classifyRoomTelegramUpdate`
//    plus the real `normalizeLocale`, over the shapes Telegram actually
//    sends (`"hi"`, `"hi-IN"`, `"en-US"`, absent, garbage, a DIFFERENT
//    Indian language).
// 5. THREE NEGATIVE CONTROLS: (a) a Hindi string with an em dash fails
//    `scripts/check-copy.mjs`'s dash rule; (b) a Hindi string containing
//    क्लोन fails its rooms-vocabulary rule; (c) the compiled prompt handed to
//    the model is BYTE IDENTICAL whether the follower's chrome locale is
//    English or Hindi — proven dynamically, through the real `roomSay`, by
//    capturing what actually reaches `deps.reply` on both runs and diffing
//    them, not by trusting that persona.ts was never touched.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  SLUG, ROOM_ID, AGENT_ID, USER_A, USER_B,
  loadFixtureAgent, freshState, fakeDb,
} from "../room/fixtures.mjs";

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

const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const {
  openRoom, joinRoom, roomSay, roomSetLocale, roomDisclosureCard,
  followerRow, normalizeLocale: normalizeLocaleServer, ROOM_LOCALES: SERVER_LOCALES,
} = room;

const telegram = await import(pathToFileURL(join(REPO, "api/_room-telegram.js")).href);
const { classifyRoomTelegramUpdate } = telegram;

const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
const { scanSource } = checkCopy;

// `src/room/copy.ts` is plain TS with no JSX, bundled the same way
// `evals/room/fixtures.mjs`'s `loadFixtureAgent` bundles a source module —
// `evals/room/run.mjs` itself never needed this because `copy.ts` was a
// component-free data file even before this workstream; it still is.
async function loadRoomCopy() {
  const OUT = mkdtempSync(join(tmpdir(), "room-locale-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { ROOM_COPY_TABLE, ROOM_LOCALES, normalizeLocale } from ${JSON.stringify(
      join(REPO, "src/room/copy"),
    )};\n`,
  );
  const BUNDLE = join(OUT, "copy.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  return import(pathToFileURL(BUNDLE).href);
}
const { ROOM_COPY_TABLE, ROOM_LOCALES, normalizeLocale } = await loadRoomCopy();

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const personTables = async () => [];

// ── 1. KEY PARITY ───────────────────────────────────────────────────────────
{
  /** Every leaf path (dot-joined) under an object, recursively. An array
   *  leaf (e.g. `memory.keeps`) is compared by LENGTH too — two locales
   *  whose bullet lists have a different number of bullets is the same
   *  defect shape as a missing key, just inside a leaf. */
  function paths(obj, prefix = "") {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) out.push(`${p}[${v.length}]`);
      else if (v && typeof v === "object") out.push(...paths(v, p));
      else out.push(p);
    }
    return out.sort();
  }

  ok("both locales are exactly {en, hi}", JSON.stringify(ROOM_LOCALES) === JSON.stringify(["en", "hi"]));
  ok("ROOM_LOCALES here agrees with the server's own", JSON.stringify(ROOM_LOCALES) === JSON.stringify(SERVER_LOCALES));

  const enPaths = paths(ROOM_COPY_TABLE.en);
  const hiPaths = paths(ROOM_COPY_TABLE.hi);
  ok("en and hi carry the exact same key set (and the same array lengths)",
    JSON.stringify(enPaths) === JSON.stringify(hiPaths),
    enPaths.length !== hiPaths.length
      ? `en has ${enPaths.length} leaves, hi has ${hiPaths.length}`
      : "",
  );
  ok("neither locale table is empty", enPaths.length > 20);

  // Every leaf is a non-empty string (after `withName` substitution is
  // irrelevant here — this checks the RAW template, which must never be "").
  const blankHi = hiPaths.filter((p) => {
    const leafKey = p.replace(/\[\d+\]$/, "");
    const val = leafKey.split(".").reduce((o, k) => o?.[k], ROOM_COPY_TABLE.hi);
    return Array.isArray(val) ? val.some((s) => !String(s).trim()) : !String(val ?? "").trim();
  });
  ok("no blank Hindi string anywhere in the table", blankHi.length === 0, blankHi.join(", "));
}

// ── 2. THE DISCLOSURE CARD'S THREE FACTS, IN BOTH LANGUAGES ────────────────
{
  const en = roomDisclosureCard("Anjali", "en");
  const hi = roomDisclosureCard("Anjali", "hi");
  ok("English and Hindi cards are different bytes", en !== hi);
  ok("both cards are exactly three lines", en.split("\n").length === 3 && hi.split("\n").length === 3);

  // Fact 1: never-deny-AI, stated first, checkably in each language.
  ok("en fact 1 (never-deny-AI, first line): names the AI and denies it is the person",
    /\bAI\b/.test(en.split("\n")[0]) && /\bnot Anjali\b/i.test(en.split("\n")[0]));
  ok("hi fact 1 (never-deny-AI, first line): names the AI and denies it is the person",
    /\bAI\b/.test(hi.split("\n")[0]) && hi.split("\n")[0].includes("नहीं है"));

  // Fact 2: the creator built and published it, and does not read this.
  ok("en fact 2: built-by and does-not-read", /built it/i.test(en) && /does not read/i.test(en));
  ok("hi fact 2: built-by and does-not-read", hi.includes("बनाया") && hi.includes("नहीं पढ़"));

  // Fact 3: private scope, nobody else sees it.
  ok("en fact 3: private scope", /own thread/i.test(en) && /nobody else/i.test(en));
  ok("hi fact 3: private scope", hi.includes("थ्रेड") && hi.includes("कोई और"));

  ok("neither card ever says the banned word", !/\bclone\b/i.test(en) && !/क्लोन/.test(hi));

  ok("an unrecognised locale falls back to English", roomDisclosureCard("Anjali", "fr") === en);
  ok("normalizeLocale agrees with the fallback", normalizeLocaleServer("fr") === "en" && normalizeLocale("fr") === "en");
}

// ── 3. setLocale IS SCOPED OFF THE SESSION ──────────────────────────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const deps = () => ({ loadAgent, engine, reply: async () => "ok", personTables });

  const joinedA = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: false, locale: "en" }, deps(),
  );
  const joinedB = await joinRoom(
    db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: false, locale: "en" }, deps(),
  );
  ok("both followers start on the room's default locale (en)",
    joinedA.follower.remembers === false && joinedA.locale === "en" && joinedB.locale === "en");

  const changed = await roomSetLocale(db, { session: joinedA.session, locale: "hi" }, deps());
  ok("setLocale returns the locale it just wrote", changed.locale === "hi");
  ok("setLocale returns a FRESH session (the digest changed with the card)",
    changed.session !== joinedA.session);

  const personA = state.accounts.find((a) => a.auth_user_id === USER_A)?.person_id;
  const personB = state.accounts.find((a) => a.auth_user_id === USER_B)?.person_id;
  const freshA = await followerRow(db, ROOM_ID, personA, AGENT_ID);
  const freshB = await followerRow(db, ROOM_ID, personB, AGENT_ID);
  ok("A's OWN row changed to hi", freshA.locale === "hi");
  ok("B's row is COMPLETELY untouched by A's setLocale call", freshB.locale === "en");

  // THE STRUCTURAL HALF: there is no parameter on this call through which a
  // caller could even NAME a different follower — proven by reading the
  // real function's own source and asserting it never destructures anything
  // resembling `person`/`personId`/`follower` from its OWN request body
  // shape, only from the verified session payload.
  const src = readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const fnStart = src.indexOf("export async function roomSetLocale");
  const fnBody = src.slice(fnStart, src.indexOf("\n}\n", fnStart) + 3);
  ok("roomSetLocale's own source names no request-supplied person/follower field",
    fnStart > -1 && !/\{\s*session\s*,\s*locale\s*,\s*person/.test(fnBody) &&
      /readRoomSession\(session/.test(fnBody) &&
      /payload\.p/.test(fnBody),
  );

  const badValue = await roomSetLocale(db, { session: joinedB.session, locale: "fr" }, deps()).catch((e) => e);
  ok("an unrecognised locale is REFUSED by name, never silently folded into English",
    badValue?.code === "room_locale_invalid");
  const freshBAfterBad = await followerRow(db, ROOM_ID, personB, AGENT_ID);
  ok("the refused write changed nothing", freshBAfterBad.locale === "en");

  const emptyValue = await roomSetLocale(db, { session: joinedB.session, locale: "" }, deps()).catch((e) => e);
  ok("an empty locale is refused the same way, not read as \"no change\" silently",
    emptyValue?.code === "room_locale_invalid");
}

// ── 4. THE TELEGRAM language_code MAPPING ───────────────────────────────────
{
  const cases = [
    ["hi", "hi"],
    ["hi-IN", "hi"],
    ["hi-Latn", "hi"],
    ["en", "en"],
    ["en-US", "en"],
    ["", "en"],
    [undefined, "en"],
    // A DIFFERENT Indian language must NOT be guessed into Hindi — this
    // product ships exactly two locales, and a follower who reads Marathi
    // did not ask for either of the wrong ones.
    ["mr", "en"],
    ["ta-IN", "en"],
    ["garbage-value", "en"],
  ];
  for (const [input, expected] of cases) {
    const update = {
      message: { chat: { id: 1, type: "private" }, from: { id: 2, language_code: input }, text: "/start anjali" },
    };
    const ev = classifyRoomTelegramUpdate(update);
    const got = normalizeLocaleServer(ev.languageCode);
    ok(`Telegram language_code ${JSON.stringify(input)} -> ${expected}`, got === expected);
  }

  // The callback branch carries the same field, for the same reason (the
  // age/memory questions have no follower row to read a locale off yet).
  const cbUpdate = {
    callback_query: {
      id: "cb1", data: "a1:anjali", from: { id: 2, language_code: "hi-IN" },
      message: { chat: { id: 1 } },
    },
  };
  const cbEv = classifyRoomTelegramUpdate(cbUpdate);
  ok("callback_query updates also carry language_code", normalizeLocaleServer(cbEv.languageCode) === "hi");
}

// ── 5a/5b. NEGATIVE CONTROLS: the copy gate bites Hindi exactly as English ──
{
  const dashHit = scanSource(
    "bad.tsx",
    'const z = { label: "यह रुका — फिर शुरू होगा।" };',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("(a) a Hindi string with an em dash fails the dash rule",
    dashHit.some((o) => o.rule === "dash"));

  const vocabHit = scanSource(
    "bad.tsx",
    'const z = <p>यह आपका AI क्लोन है।</p>;',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("(b) a Hindi string containing क्लोन fails the rooms-vocabulary rule",
    vocabHit.some((o) => o.rule === "rooms-vocabulary"));

  const modelHit = scanSource("bad.html", "<p>अपने वॉइस मॉडल को ट्रेन करें।</p>", {
    rules: "full", codename: true, roomsVocab: true,
  });
  ok("(b again) मॉडल fails the same rule from a pure-Devanagari HTML text node",
    modelHit.some((o) => o.rule === "rooms-vocabulary"));

  const clean = scanSource(
    "clean.tsx",
    'const z = { label: "आप {name} AI से बात कर रहे हैं। यह {name} नहीं है।" };',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("clean, real Hindi copy trips nothing", clean.length === 0, JSON.stringify(clean));
}

// ── 5c. NEGATIVE CONTROL: the compiled prompt never sees the chrome locale ──
{
  const state = freshState();
  const db = fakeDb(state);
  const captured = [];
  const reply = async (compiled, turns) => {
    captured.push(JSON.stringify(compiled));
    return "yes, that one is the same idea seen from the other end.";
  };
  const deps = () => ({ loadAgent, engine, reply, personTables });

  // Memoryless on purpose (`memoryConsent: false`): the whole point is to
  // hold identity, room and history constant across the two calls and vary
  // ONLY the follower's own `locale` column, so anything that differs
  // between the two captured prompts is attributable to locale and nothing
  // else. A remembering follower's second turn would legitimately compile a
  // longer prompt (more history) for a reason that has nothing to do with
  // language, which would make this control noisy rather than sharp.
  const joined = await joinRoom(
    db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: false, locale: "en" }, deps(),
  );
  await roomSay(db, { session: joined.session, message: "why does the block not slide?" }, deps());
  ok("setup: the English-locale turn compiled a prompt", captured.length === 1);

  const switched = await roomSetLocale(db, { session: joined.session, locale: "hi" }, deps());
  await roomSay(db, { session: switched.session, message: "why does the block not slide?" }, deps());
  ok("setup: the Hindi-locale turn compiled a prompt too", captured.length === 2);

  ok("(c) the COMPILED PROMPT is byte identical whether the follower's chrome is en or hi — only chrome moves, never the model's own input",
    captured[0] === captured[1]);

  // The static half of the same claim: `roomSay`'s own source never reads
  // `follower.locale` (or the session's locale-derived variable) anywhere
  // between resolving the follower and calling `deps.reply`/`gatedReply` —
  // a grep-shaped proof, `evals/room-leak/run.mjs`'s own static layer one
  // file over.
  const src = readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  const sayStart = src.indexOf("export async function roomSay(");
  const sayEnd = src.indexOf("\nexport async function roomSpeak", sayStart);
  const sayBody = src.slice(sayStart, sayEnd);
  ok("roomSay's own source never mentions follower.locale at all",
    sayStart > -1 && sayEnd > sayStart && !/follower\.locale|f\.locale/.test(sayBody));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
