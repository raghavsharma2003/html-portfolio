// WS-R160 ("the Room and the landing for any person") — offline,
// deterministic, $0, no DB, no network, no model call, no GPU.
//
//   node evals/room-copy/run.mjs
//
// The Room was built for creators and teachers ("your sheet", "doubts",
// "students"). This workstream's brief: rewrite every user-visible string of
// the Room, its transparency page and its cards so a stranger reads "the
// person" / "<Name>", never "creator" — "follower" stays only where it
// names the paid relationship. Four sections:
//
//   §1 THE REAL COPY TABLE, WALKED. Every string leaf of the REAL, bundled
//      `ROOM_COPY_TABLE.en` and `.hi` (function leaves called with
//      placeholder arguments so their template bodies are inspected too)
//      carries no "creator" / "क्रिएटर" anywhere — walked against the
//      shipping export, never a re-typed list of "the strings we changed".
//   §2 NEGATIVE CONTROL for §1: a copy tree with one word swapped back to
//      "creator" IS caught by the same walker — proving §1 is not vacuously
//      passing over an empty or wrongly-shaped tree.
//   §3 THE SERVER-RENDERED PAGES. `api/_room-about.js`'s
//      `buildRoomAboutHtml` and `api/_room-page.js`'s `buildRoomPageHtml`,
//      driven for a real Room in both locales: no "creator" in the
//      rendered bytes, and the title carries `roomAiTitleLine`'s exact
//      "<Name> AI, made by <Name>, on Vyakti" phrase (the brief's own law
//      4), not a re-typed copy of it.
//   §4 THE SHEET-KIND PARITY. The Room's own chrome (the taste turn's
//      disclosure name, `openRoom`'s bio/name fields) is IDENTICAL whether
//      the loaded sheet carries teacher-shaped fields (`subjectDomain`,
//      `subjectStrands`) or not — proving today's Room copy layer is
//      already sheet-kind-agnostic (the brief's law 2: "until [R151] lands,
//      the person wording is the default"), which for a Room with no
//      teacher-vs-person copy SWITCH at all means both kinds get the exact
//      same, already-person-neutral wording. A REQUIRED NEGATIVE CONTROL
//      (§4b) proves the comparator actually detects a real divergence
//      between the two sheets, so §4's parity claim is not vacuous.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// ── bundle src/room/copy.ts + its two lazy Hindi chunks, `evals/room-locale/
// run.mjs`'s own technique restated: this is a second suite reading the
// same TS-with-dynamic-import module, and the two must not silently
// disagree about how it is bundled. ──────────────────────────────────────
async function bundleRoomCopy() {
  const OUT = mkdtempSync(join(tmpdir(), "room-copy-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { ROOM_COPY_TABLE, loadRoomCopy } from ${JSON.stringify(join(REPO, "src/room/copy"))};\n`,
  );
  const BUNDLE = join(OUT, "copy.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  return import(pathToFileURL(BUNDLE).href);
}
const { ROOM_COPY_TABLE, loadRoomCopy } = await bundleRoomCopy();
await loadRoomCopy("hi");

const roomAbout = await import(pathToFileURL(join(REPO, "api/_room-about.js")).href);
const { buildRoomAboutHtml } = roomAbout;
const roomPage = await import(pathToFileURL(join(REPO, "api/_room-page.js")).href);
const { buildRoomPageHtml, roomAiTitleLine } = roomPage;
const { roomTaste } = await import(pathToFileURL(join(REPO, "api/_room-taste.js")).href);
const { openRoom } = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { consume, limitsFor } = await import(pathToFileURL(join(REPO, "api/_rate-limit.js")).href);

/** Every string this copy table could ever render, from the REAL export —
 *  function leaves are called with a handful of representative placeholder
 *  arguments (a name, a count, a price/date label) so their TEMPLATE BODY is
 *  inspected too, never skipped because it happens to be a function rather
 *  than a plain string. Mirrors `evals/room-locale/run.mjs`'s own `paths()`
 *  walk in spirit (enumerate the real tree, never a hand-typed key list),
 *  restated here because that suite collects KEYS for parity while this one
 *  needs the rendered STRING VALUES for a vocabulary scan. */
function collectStrings(node, out = []) {
  if (typeof node === "string") {
    out.push(node);
  } else if (typeof node === "function") {
    // Call with a handful of placeholder argument shapes; concatenate every
    // result so a function that branches on its argument (singular/plural,
    // `n === 1`) still has both branches inspected.
    for (const args of [[], ["Anjali"], [1], [2, 3], ["Anjali", "₹299"], ["12 Sep 2026"]]) {
      try {
        const r = node(...args);
        if (typeof r === "string") out.push(r);
      } catch {
        // A function whose placeholder args do not match its real shape is
        // not this scan's problem — every ACTUAL leaf in the real tree is
        // still reached via at least one other node in the walk, and a
        // template's own literal pieces are already plain strings beside it
        // (`withName`/`withPrice`-templated strings, `taste.turnsLeft`, ...).
      }
    }
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) collectStrings(v, out);
  }
  return out;
}

const BANNED = [
  { word: "creator", re: /\bcreator\b/i },
  { word: "क्रिएटर", re: /क्रिएटर/ },
];

function findBanned(strings) {
  const hits = [];
  for (const s of strings) {
    for (const b of BANNED) {
      if (b.re.test(s)) hits.push({ word: b.word, text: s.slice(0, 90) });
    }
  }
  return hits;
}

// ═══ §1: the real copy table, walked ════════════════════════════════════
console.log("── §1: the real ROOM_COPY_TABLE carries no \"creator\" anywhere ──");
{
  const enStrings = collectStrings(ROOM_COPY_TABLE.en);
  const hiStrings = collectStrings(ROOM_COPY_TABLE.hi);
  ok("the walk actually found a nontrivial number of English strings", enStrings.length > 80, String(enStrings.length));
  ok("the walk actually found a nontrivial number of Hindi strings", hiStrings.length > 80, String(hiStrings.length));
  const enHits = findBanned(enStrings);
  const hiHits = findBanned(hiStrings);
  ok("no \"creator\" in the real English copy table", enHits.length === 0, JSON.stringify(enHits));
  ok("no \"क्रिएटर\" in the real Hindi copy table", hiHits.length === 0, JSON.stringify(hiHits));
}

// ═══ §2: negative control for §1 ═════════════════════════════════════════
console.log("\n── §2: NEGATIVE CONTROL — the walker actually catches the word ──");
{
  const poisoned = JSON.parse(JSON.stringify(ROOM_COPY_TABLE.en, (_k, v) => (typeof v === "function" ? undefined : v)));
  poisoned.pay.priceNotSet = "The creator has not set a price for this room yet.";
  const hits = findBanned(collectStrings(poisoned));
  ok("a deliberately reintroduced \"creator\" string IS caught", hits.some((h) => h.word === "creator"));

  const poisonedHi = { note: "यह लिंक शेयर करें। अगर कोई दोस्त इससे जुड़ता है, तो क्रिएटर को पता चलता है।" };
  const hitsHi = findBanned(collectStrings(poisonedHi));
  ok("a deliberately reintroduced \"क्रिएटर\" string IS caught", hitsHi.some((h) => h.word === "क्रिएटर"));
}

// ═══ §3: the server-rendered pages ═══════════════════════════════════════
console.log("\n── §3: the transparency page and the crawler head ──");
{
  const room = {
    slug: SLUG, display_name: "Anjali", default_locale: "en", dormancy_days: null,
    free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
  };
  for (const lang of ["en", "hi"]) {
    const aboutHtml = buildRoomAboutHtml(room, { origin: "https://vyakti-rooms.vercel.app", slug: SLUG, lang });
    ok(`about (${lang}): no "creator"/"क्रिएटर" in the rendered bytes`,
      !/creator/i.test(aboutHtml) && !aboutHtml.includes("क्रिएटर"), );
    const expectedTitle = roomAiTitleLine("Anjali", lang);
    ok(`about (${lang}): the <title> is exactly roomAiTitleLine's own phrase`,
      aboutHtml.includes(`<title>${expectedTitle}</title>`), expectedTitle);

    const pageHtml = buildRoomPageHtml(room, { origin: "https://vyakti-rooms.vercel.app", slug: SLUG });
    ok("crawler head: no \"creator\" in the rendered bytes", !/creator/i.test(pageHtml));
  }
  // The page's own default_locale drives buildRoomPageHtml's locale (no
  // `?lang=` on a crawler request) — proven separately, against the Hindi
  // default, so this suite does not just re-render the same English bytes
  // twice under two different names.
  const hiRoom = { ...room, default_locale: "hi" };
  const hiPageHtml = buildRoomPageHtml(hiRoom, { origin: "https://vyakti-rooms.vercel.app", slug: SLUG });
  const expectedHi = roomAiTitleLine("Anjali", "hi");
  ok("crawler head (hi default_locale): title is the Hindi roomAiTitleLine phrase",
    hiPageHtml.includes(`<title>${expectedHi}</title>`), expectedHi);

  // The platform-only card (unpublished/unknown Room) never carries a name
  // to make a claim about at all — `roomAiTitleLine(null)` degrades to
  // `PLATFORM_TITLE`, proven directly rather than assumed.
  ok("roomAiTitleLine with no name returns the bare platform title",
    roomAiTitleLine("", "en") === "Vyakti" && roomAiTitleLine(null, "hi") === "Vyakti");
}

// ═══ §4: the sheet-kind parity ════════════════════════════════════════════
console.log("\n── §4: the Room's chrome does not depend on teacher-shaped sheet fields ──");
{
  const { engine, SHEET } = await loadFixtureAgent(REPO);

  async function tasteWith(sheetOverrides) {
    const sheet = { ...SHEET, ...sheetOverrides };
    const loadAgent = async (slug) => {
      if (slug !== SLUG) throw new Error("teacher_sheet_unavailable");
      return { module: engine.sheetToModule(sheet), sheet, row: {} };
    };
    const state = freshState();
    const db = fakeDb(state);
    const rateDb = (() => {
      const m = new Map();
      return async (sql, params = []) => {
        if (/insert into vy_public_rate/.test(sql)) {
          const [scope, keyHash, windowStart, limit] = params;
          const k = `${scope}\0${keyHash}\0${windowStart}`;
          const row = m.get(k);
          if (!row) { m.set(k, { count: 1 }); return [{ count: 1 }]; }
          if (row.count < Number(limit)) { row.count += 1; return [{ count: row.count }]; }
          return [];
        }
        throw new Error(`unexpected: ${sql}`);
      };
    })();
    const now = Date.parse("2026-09-13T10:00:00.000Z");
    const gate = await consume(rateDb, { scope: "room_taste", key: `${SLUG}:parity`, now, env: process.env });
    const turnIndex = limitsFor(process.env).room_taste.limit - gate.remaining;
    const taste = await roomTaste(db, { slug: SLUG, message: "hello", turnIndex }, { loadAgent, now, reply: () => "reply" });
    const open = await openRoom(db, { slug: SLUG }, { loadAgent, now });
    return { taste, open };
  }

  const withTeacherFields = await tasteWith({});
  const withoutTeacherFields = await tasteWith({ subjectDomain: undefined, subjectStrands: undefined });

  ok("taste: the disclosure name is IDENTICAL with and without subjectDomain/subjectStrands",
    withTeacherFields.taste.disclosure === withoutTeacherFields.taste.disclosure);
  ok("taste: room.name is IDENTICAL either way", withTeacherFields.taste.room.name === withoutTeacherFields.taste.room.name);
  ok("open: the bio/name fields are IDENTICAL either way",
    withTeacherFields.open.bio === withoutTeacherFields.open.bio &&
    withTeacherFields.open.name === withoutTeacherFields.open.name);
  ok("open: the disclosure card is IDENTICAL either way",
    withTeacherFields.open.disclosure === withoutTeacherFields.open.disclosure);

  // ── §4b: NEGATIVE CONTROL — the comparator above is not vacuously
  // permissive. A sheet with a genuinely DIFFERENT name (not merely
  // different teacher fields) DOES produce a different disclosure — proving
  // this suite's own equality checks can fail when there is a real
  // difference to catch, the same shape `room-taste`'s own §7 negative
  // control uses one file over. ──────────────────────────────────────────
  const differentName = await tasteWith({ name: "Priya" });
  ok("NEGATIVE CONTROL: a genuinely different name DOES change the disclosure",
    differentName.taste.disclosure !== withTeacherFields.taste.disclosure);
}

console.log(`\nroom-copy: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
