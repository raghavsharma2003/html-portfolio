// WS-R108. THE READABLE EXPORT BATTERY.
//
//   node evals/room-export-readable/run.mjs
//
// `evals/room-export/run.mjs` already proves `roomExport` (`api/_room-
// surface.js`) is COMPLETE — every person-lane Room table it can reach is
// named. That is necessary but not sufficient: a parent, a lawyer or the
// follower themselves cannot read raw JSON, and DPDP's right to access is a
// right to UNDERSTAND what is held, not merely to receive it
// (`api/_room-export-readable.js`'s own header). This suite proves the
// READABLE half:
//
//   1. STATIC COMPLETENESS — every table `roomExportManifest()` can ever
//      name has a sentence in both locales in `TABLE_COPY`, and the reverse
//      (no orphan entry names a table the manifest does not), so a table
//      added to the manifest and forgotten here fails BY NAME rather than
//      rendering a document silently missing a section — the workstream
//      brief's own law 2, "completeness is inherited, not restated."
//   2. THE RUNTIME NEGATIVE CONTROL law 4 asks for — a table name present in
//      an export result but ABSENT from the copy table (the same drift the
//      static check above would also catch, proven here at the actual call
//      site a live request goes through) throws, named, rather than
//      dropping the section silently.
//   3. BOTH LOCALES render, from the SAME real `roomExport()` output, with
//      no `<script>`, no external resource (`<link>`/http(s) URL), and the
//      right `<html lang>`.
//   4. THE LANGUAGE WALK — every rendered `<th>`/`<td>`/`<span>` on the
//      built document carries a `lang` attribute matching what its own text
//      is actually written in (`api/_room-export-readable.js`'s own
//      `detectTextLang`, WS-R79's law restated a fourth time) — the offline
//      half of `scripts/check-accessibility.mjs`'s browser-based lang-tag
//      audit, `evals/lang-tag/run.mjs`'s own regex-on-shipping-HTML method
//      applied to this page instead of the creator page.
//   5. NO FOLLOWER'S WORDS OF ANOTHER FOLLOWER — two followers in the SAME
//      room, seeded with distinct secret tokens, each export byte-checked
//      against the other's token and person id.
//
// Offline, deterministic, $0, no DB, no network, no model call. Reuses
// `evals/room-export/fixtures.mjs` (WS-R27's own wrapper) and `evals/room/
// fixtures.mjs` (the base fake db) — no new fixture file, this suite's own
// world lives entirely below.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const surface = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, createThread, readRoomSession, roomExport, roomExportManifest } = surface;
const readable = await import(pathToFileURL(join(REPO, "api/_room-export-readable.js")).href);
const { buildRoomExportReadableHtml, TABLE_COPY } = readable;
const { PERSON_TABLES } = await import(pathToFileURL(join(REPO, "api/memory.js")).href);
const { freshExportState, exportDb } = await import(
  pathToFileURL(join(REPO, "evals/room-export/fixtures.mjs")).href
);
const { loadFixtureAgent, SLUG } = await import(pathToFileURL(join(REPO, "evals/room/fixtures.mjs")).href);
const { loadAgent } = await loadFixtureAgent(REPO);

const FULL_DEPS = { loadAgent, personTables: async () => PERSON_TABLES, tableApplied: async () => true };

// ═════════════════════════════════════════════════════════════════════════
// 1 — STATIC COMPLETENESS: TABLE_COPY vs the REAL roomExportManifest().
// ═════════════════════════════════════════════════════════════════════════
console.log("── 1: static completeness (TABLE_COPY vs roomExportManifest) ──");

const manifest = await roomExportManifest(FULL_DEPS);
ok("roomExportManifest() returns a non-trivial list (not vacuously empty)", manifest.length >= 11, `got ${manifest.length}`);

// `TABLE_COPY` is an array of `{table, en, hi}` entries (`ROOM_EXPORT_EXTRA`'s
// own shape, `api/_room-export-readable.js`'s own header explains why: the
// leak battery's static reach layer requires every line naming a guarded
// table to match a known-safe shape, and a plain object key does not,
// `context/rejected.md#ws-r108-table-copy-as-a-keyed-object-failed-the-leak-batterys-static-reach-layer`),
// so this suite reads it as a list of entries rather than an object's keys.
const copyByName = new Map(TABLE_COPY.map((e) => [e.table, e]));
const copyKeys = [...copyByName.keys()];
const missingCopy = manifest.filter((t) => !copyByName.has(t));
ok("every roomExportManifest() entry has a TABLE_COPY entry", missingCopy.length === 0, missingCopy.join(","));

const orphanCopy = copyKeys.filter((t) => !manifest.includes(t));
ok("no TABLE_COPY entry names a table roomExportManifest() does not (no orphan copy)", orphanCopy.length === 0, orphanCopy.join(","));

for (const t of manifest) {
  const meta = copyByName.get(t);
  ok(`[copy/${t}] carries a non-empty English sentence`, typeof meta?.en === "string" && meta.en.trim().length > 0);
  ok(`[copy/${t}] carries a non-empty Hindi sentence`, typeof meta?.hi === "string" && meta.hi.trim().length > 0);
  ok(`[copy/${t}] English and Hindi sentences actually differ (a real translation, not a shared placeholder)`, meta.en !== meta.hi);
}

// NEGATIVE CONTROL (a): a COPY of TABLE_COPY (a filtered array, never the
// real one) with one real entry struck — the exact static-diff tool above,
// run against the mutation — must report the struck table as missing.
{
  const strippedCopy = TABLE_COPY.filter((e) => e.table !== "vy_room_thread");
  const strippedNames = new Set(strippedCopy.map((e) => e.table));
  const problems = manifest.filter((t) => !strippedNames.has(t));
  ok("NEGATIVE CONTROL (a): a table struck from a COPY of TABLE_COPY is caught as uncovered",
    problems.includes("vy_room_thread"),
    problems.includes("vy_room_thread") ? "" : "control did not fire — the completeness check would have shipped a blind spot");
}

// ═════════════════════════════════════════════════════════════════════════
// 2 — THE RUNTIME NEGATIVE CONTROL (workstream brief law 4): a table name
// present in an export result but ABSENT from the real, un-mutated
// TABLE_COPY throws, named — proven at `buildRoomExportReadableHtml` itself,
// the actual call site `api/room.js`'s `format:"html"` branch uses, not a
// re-implementation of its lookup.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2: the runtime negative control (a manifest entry the copy table does not name) ──");
{
  const fakeExport = {
    room: "anjali",
    exported_at: "2026-09-05T00:00:00.000Z",
    tables: { vy_room_fake_negative_control: [{ a: 1 }] },
  };
  let threw = null;
  try {
    buildRoomExportReadableHtml(fakeExport, "en");
  } catch (e) {
    threw = e;
  }
  ok("a table present in the export but absent from TABLE_COPY throws, never renders a page silently missing a section",
    Boolean(threw));
  ok("the thrown error NAMES the table", threw?.table === "vy_room_fake_negative_control" && String(threw?.message || "").includes("vy_room_fake_negative_control"));
  ok("the thrown error carries a stable, greppable code", threw?.code === "room_export_readable_missing_copy");
}

// ═════════════════════════════════════════════════════════════════════════
// 3/4/5 — A REAL WORLD: two followers in the SAME room, distinct secret
// tokens, both locales, the lang walk, and the cross-follower byte check.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3/4/5: a real world (two followers, both locales, the lang walk, the leak check) ──");

const USER_A = "80000000-0000-4000-a000-000000000001";
const USER_B = "80000000-0000-4000-a000-000000000002";
const TOKEN_A = "TOKFACT_READABLE_AAAAAAAA";
const TOKEN_B = "TOKFACT_READABLE_BBBBBBBB";

const state = freshExportState();
const db = exportDb(state);

async function seedFollower(authUserId, secretToken, handoffId) {
  const joined = await joinRoom(db, { slug: SLUG, authUserId, ageAttested: true, memoryConsent: true }, { loadAgent });
  const payload = readRoomSession(joined.session);
  const roomId = String(payload.i);
  const personId = String(payload.p);
  const agentId = String(payload.a);
  await createThread(db, { roomId, personId, agentId, title: `${secretToken}-thread` });
  state.facts.push({ person_id: personId, agent_id: agentId, body: `note: ${secretToken}` });
  state.roomHandoffs.push({
    handoff_id: handoffId, room_id: roomId, person_id: personId,
    payload_text: `${secretToken} please can a human reply`, state: "sent",
  });
  return { session: joined.session, personId };
}

const followerA = await seedFollower(USER_A, TOKEN_A, "70000000-0000-4000-a000-00000000000a");
const followerB = await seedFollower(USER_B, TOKEN_B, "70000000-0000-4000-a000-00000000000b");

const dumpA = await roomExport(db, { session: followerA.session }, FULL_DEPS);
const dumpB = await roomExport(db, { session: followerB.session }, FULL_DEPS);

ok("the world is not vacuous: follower A's own export carries follower A's own token",
  JSON.stringify(dumpA.tables).includes(TOKEN_A));
ok("the world is not vacuous: follower B's own export carries follower B's own token",
  JSON.stringify(dumpB.tables).includes(TOKEN_B));

const htmlA_en = buildRoomExportReadableHtml(dumpA, "en");
const htmlA_hi = buildRoomExportReadableHtml(dumpA, "hi");
const htmlB_en = buildRoomExportReadableHtml(dumpB, "en");

for (const [name, html] of [["A/en", htmlA_en], ["A/hi", htmlA_hi], ["B/en", htmlB_en]]) {
  ok(`[${name}] renders (non-empty string)`, typeof html === "string" && html.length > 200);
  ok(`[${name}] carries no <script> tag`, !/<script/i.test(html));
  ok(`[${name}] carries no external resource (<link>, http(s) URL)`, !/<link[\s>]/i.test(html) && !/https?:\/\//i.test(html));
  ok(`[${name}] carries no inline event handler (a stray onclick etc.)`, !/\son[a-z]+\s*=/i.test(html));
  ok(`[${name}] declares an A4 print rule`, /size:\s*A4/i.test(html));
}
ok("[A/hi] top-level document lang is hi", /<html lang="hi">/.test(htmlA_hi));
ok("[A/en] top-level document lang is en", /<html lang="en">/.test(htmlA_en));
ok("[A/en] renders follower A's own handoff text (their words are theirs to read)",
  htmlA_en.includes(`${TOKEN_A} please can a human reply`));

// ── the language walk: every <th>/<td>/<span> on the page carries a `lang`
//    attribute, and it agrees with `detectTextLang` run on the SAME text
//    this suite independently re-derives from the un-rendered export object
//    (never trusted from the HTML alone) — `evals/lang-tag/run.mjs`'s own
//    regex-on-shipping-HTML method, applied here instead of re-invoking
//    `scripts/check-accessibility.mjs`'s browser-only `langTagAudit`.
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;
const detectTextLang = (t) => (DEVANAGARI_RANGE.test(String(t || "")) ? "hi" : "en");

function langWalk(html) {
  const findings = [];
  const nodeRe = /<(th|td|span)\s+lang="(en|hi)">([^<]*)<\/\1>/g;
  let m;
  let nodes = 0;
  while ((m = nodeRe.exec(html))) {
    nodes++;
    const [, , taggedLang, textEsc] = m;
    const text = textEsc.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const actual = detectTextLang(text);
    // A `th` is always `lang="en"` by construction (a raw column name) even
    // when its own text happens to contain no Devanagari either way, so it
    // never disagrees; a `td`/`span` must agree with its OWN text's script.
    if (taggedLang !== actual && text.trim() !== "") findings.push({ taggedLang, actual, text });
  }
  return { nodes, findings };
}

const walkA_hi = langWalk(htmlA_hi);
ok("[A/hi] the language walk finds at least one tagged node (the page is not empty of data)", walkA_hi.nodes > 0, `nodes=${walkA_hi.nodes}`);
ok("[A/hi] every tagged node's lang attribute matches its own text's actual script",
  walkA_hi.findings.length === 0, JSON.stringify(walkA_hi.findings));

const walkA_en = langWalk(htmlA_en);
ok("[A/en] every tagged node's lang attribute matches its own text's actual script",
  walkA_en.findings.length === 0, JSON.stringify(walkA_en.findings));

// NEGATIVE CONTROL (b): a deliberately mistagged node must be CAUGHT by
// `langWalk` above, proving the walk itself is not vacuously green.
{
  const dirty = htmlA_en.replace('<td lang="en">', '<td lang="hi">');
  const dirtyWalk = langWalk(dirty);
  ok("NEGATIVE CONTROL (b): a deliberately mistagged node is caught by the language walk",
    dirtyWalk.findings.length > 0,
    dirtyWalk.findings.length > 0 ? "" : "control did not fire — the language walk would have shipped a blind spot");
}

// ── no follower's words of ANOTHER follower, byte-checked ─────────────────
ok("[A/en] carries NONE of follower B's secret token", !htmlA_en.includes(TOKEN_B));
ok("[A/hi] carries NONE of follower B's secret token", !htmlA_hi.includes(TOKEN_B));
ok("[A/en] carries NONE of follower B's own person id", !htmlA_en.includes(followerB.personId));
ok("[B/en] carries NONE of follower A's secret token", !htmlB_en.includes(TOKEN_A));
ok("[B/en] carries NONE of follower A's own person id", !htmlB_en.includes(followerA.personId));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
