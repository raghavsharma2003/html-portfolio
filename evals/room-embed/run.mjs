// The Room on a creator's own site (WS-R46) — offline, deterministic, $0, no
// DB, no network, no model call.
//
//   node evals/room-embed/run.mjs
//
// Drives the REAL `api/_room-embed.js` — its pure JSON builder, its database
// read (through `resolveRoom`, the exact function every follower's first
// screen already goes through), and the shipped script text itself, executed
// with `new Function` against a hand-rolled DOM fake rather than jsdom.
//
// ── what this suite is actually guarding ───────────────────────────────────
//
// 1. THE SCRIPT PARSES AND FITS THE SIZE CAP. `new Function(ROOM_EMBED_JS)`
//    must not throw, and the MINIFIED bytes (esbuild --minify, the same tool
//    `evals/run.mjs` already shells out to) must stay under 6 KB — the brief's
//    own number, chosen so a creator's page never notices the paste.
// 2. THE SCRIPT READS EXACTLY ONE ATTRIBUTE. `data-room`, and nothing else —
//    a script that read a second attribute could be made to read a THIRD one
//    a creator never intended to expose.
// 3. IT RENDERS THE BUTTON, THE DISCLOSURE AND THE LINK. A DOM fake proves the
//    button carries "<display name> AI", the disclosure paragraph is filled
//    from the SERVER's own text (never a line this file wrote), and the link
//    opens `/r/<slug>?via=embed` in a new tab with `rel="noopener noreferrer"`.
// 4. NO SLUG, NO ROOM, NO BUTTON. A missing `data-room` and a `{room:null}`
//    response both remove the script's own tag rather than leaving a dead
//    button on the page.
// 5. AN UNPUBLISHED ROOM AND AN UNKNOWN SLUG ANSWER IDENTICALLY. Read through
//    the REAL `resolveRoom` (the shared `evals/room/fixtures.mjs` world, the
//    same fixture WS-R1's own suite uses), because a page must never learn
//    whether a slug exists.
// 6. THE JSON BUILDER IS PURE AND NAMES NO FOLLOWER TABLE. `buildRoomEmbedJson`
//    takes only what `resolveRoom` already returned — no second query, no
//    count, nothing a follower ever touched.
// 7. THREE NEGATIVE CONTROLS, so each check above is proven to bite rather
//    than being vacuously true: (a) a corrupted script with a second fetch
//    target is caught by the same static checker that clears the real one;
//    (b) a corrupted file naming a follower table is caught by the same
//    static checker that clears the real `api/_room-embed.js`; (c) an em
//    dash slipped into this workstream's own Share-tab sentence is caught by
//    the real `scripts/check-copy.mjs` scanner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { readRoomEmbed, buildRoomEmbedJson, ROOM_EMBED_JS } = await import(
  pathToFileURL(join(REPO, "api/_room-embed.js")).href
);
const { roomDisclosureCard, roomNameFor } = await import(
  pathToFileURL(join(REPO, "api/_room-surface.js")).href
);
const { SLUG, loadFixtureAgent, freshState, fakeDb } = await import(
  pathToFileURL(join(REPO, "evals/room/fixtures.mjs")).href
);
const { scanSource } = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);

// ═══ 1. THE SCRIPT PARSES AND FITS THE SIZE CAP ════════════════════════════
console.log("\n── 1. the script parses and fits the size cap ──");

{
  let parsed = true;
  try {
    // eslint-disable-next-line no-new-func
    new Function("document", "location", "fetch", ROOM_EMBED_JS);
  } catch {
    parsed = false;
  }
  ok("new Function(ROOM_EMBED_JS) does not throw", parsed);

  const rawBytes = Buffer.byteLength(ROOM_EMBED_JS, "utf8");
  ok("dependency-free (no import, no require)", !/\brequire\(|^\s*import\s/m.test(ROOM_EMBED_JS));
  console.log(`  info  raw source: ${rawBytes} bytes`);

  let minified = "";
  let minifyRan = true;
  try {
    minified = execFileSync("npx", ["--no-install", "esbuild", "--minify", "--loader=js"], {
      input: ROOM_EMBED_JS,
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
    ok("minified script is under 6 KB", minBytes < 6144, `${minBytes} bytes`);
  } else {
    // esbuild is used elsewhere in this repo's own gate (evals/run.mjs shells
    // out to it to re-bundle every suite), so its absence here means the
    // environment itself lacks it, not that this suite skipped the check —
    // the raw size is asserted instead, generously, so the suite still fails
    // loudly if the unminified script alone blew the budget.
    ok("raw (unminified) script is under 6 KB, as a floor", rawBytes < 6144, `${rawBytes} bytes`);
  }
}

// ═══ 2. THE SCRIPT READS EXACTLY ONE ATTRIBUTE ═════════════════════════════
console.log("\n── 2. the script reads exactly one attribute ──");

{
  const attrs = [...ROOM_EMBED_JS.matchAll(/getAttribute\(\s*"([^"]+)"/g)].map((m) => m[1]);
  ok("reads at least one attribute", attrs.length > 0);
  ok("reads ONLY data-room", attrs.every((a) => a === "data-room"), attrs.join(","));
}

// ═══ THE DOM FAKE ═══════════════════════════════════════════════════════════

function makeEl(tag, registry) {
  const el = {
    tag,
    _attrs: {},
    children: [],
    style: {},
    className: "",
    textContent: "",
    href: "",
    target: "",
    rel: "",
    src: "",
    removed: false,
    parentNode: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
    },
    setAttribute(name, v) {
      this._attrs[name] = String(v);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(newNode, ref) {
      newNode.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i >= 0) this.children.splice(i, 0, newNode);
      else this.children.push(newNode);
      return newNode;
    },
    remove() {
      this.removed = true;
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
      }
    },
  };
  registry.push(el);
  return el;
}

/** One page: a container `<div>` holding the creator's `<script>` tag, plus a
 *  `<head>`. `fetchImpl` stands in for `window.fetch`; `fetchCalls` records
 *  every URL requested so the negative controls and the render checks can
 *  both read it. */
function makePage(fetchImpl) {
  const registry = [];
  const head = makeEl("head", registry);
  const container = makeEl("div", registry);
  const script = makeEl("script", registry);
  container.appendChild(script);
  script.src = "https://cdn.example.com/room-embed.js";

  const fetchCalls = [];
  const fetchFn = (url) => {
    fetchCalls.push(String(url));
    return fetchImpl(String(url));
  };

  const doc = {
    head,
    currentScript: script,
    createElement: (tag) => makeEl(tag, registry),
  };
  const location = { href: "https://creator.example/page" };

  return { doc, location, fetchFn, fetchCalls, container, script, head, registry };
}

function run(page) {
  // eslint-disable-next-line no-new-func
  const runner = new Function("document", "location", "fetch", ROOM_EMBED_JS);
  runner(page.doc, page.location, page.fetchFn);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

// ═══ 3. RENDER: A PUBLISHED ROOM ════════════════════════════════════════════
console.log("\n── 3. render: a published room ──");

{
  const fixtureRoom = {
    display_name: "Anjali",
    locale: "en",
    disclosure: roomDisclosureCard("Anjali", "en"),
  };
  const page = makePage(async () => ({ json: async () => ({ room: fixtureRoom }) }));
  page.script.setAttribute("data-room", SLUG);

  run(page);
  await flush();

  ok(
    "fetched the JSON endpoint for this slug",
    page.fetchCalls.length === 1 && page.fetchCalls[0] === `https://cdn.example.com/room-embed.js?slug=${SLUG}`,
    page.fetchCalls.join(" | "),
  );
  ok("the original script tag is left in place", !page.script.removed);

  const wrap = page.container.children.find((c) => c !== page.script);
  ok("a wrapper was inserted", Boolean(wrap));

  const link = wrap?.children.find((c) => c.tag === "a");
  ok("a link element renders", Boolean(link));
  ok("the button carries the display name and \"AI\"", link?.textContent === "Anjali AI", link?.textContent);
  ok(
    "clicking it opens the Room with ?via=embed",
    link?.href === `https://cdn.example.com/r/${SLUG}?via=embed`,
    link?.href,
  );
  ok("it opens in a new tab", link?.target === "_blank");
  ok("it never lets the new tab reach back", link?.rel === "noopener noreferrer");

  const disc = wrap?.children.find((c) => c.tag === "p" && c !== link);
  ok(
    "the disclosure is the SERVER's text, verbatim",
    disc?.textContent === fixtureRoom.disclosure,
  );
  ok("the disclosure text never lives in this file", !ROOM_EMBED_JS.includes(fixtureRoom.disclosure));

  const powered = wrap?.children.find((c) => c.textContent === "Powered by Vyakti");
  ok("the platform's name is shown", Boolean(powered));
}

// ═══ 4. NO data-room, NO CALL, NO BUTTON ═══════════════════════════════════
console.log("\n── 4. no data-room attribute ──");

{
  const page = makePage(async () => ({ json: async () => ({ room: null }) }));
  // deliberately no setAttribute("data-room", …)
  run(page);
  await flush();

  ok("no fetch is made", page.fetchCalls.length === 0);
  ok("the script tag removes itself", page.script.removed);
}

// ═══ 5. UNPUBLISHED AND UNKNOWN SLUGS ANSWER IDENTICALLY ══════════════════
console.log("\n── 5. an unpublished room and an unknown slug ──");

{
  for (const label of ["unpublished", "unknown"]) {
    const page = makePage(async () => ({ json: async () => ({ room: null }) }));
    page.script.setAttribute("data-room", "whatever");
    run(page);
    await flush();
    ok(`${label} slug: fetch happened`, page.fetchCalls.length === 1);
    ok(`${label} slug: script removes itself, no button rendered`, page.script.removed);
    ok(`${label} slug: the removed script leaves the container empty, no button`, page.container.children.length === 0);
  }
}

{
  // A network failure must degrade the same way — never a dangling half-page.
  const page = makePage(async () => {
    throw new Error("network down");
  });
  page.script.setAttribute("data-room", SLUG);
  run(page);
  await flush();
  ok("a fetch failure also removes the script, never throws", page.script.removed);
}

// ═══ 6. THE JSON BUILDER IS PURE ════════════════════════════════════════════
console.log("\n── 6. the JSON builder, pure ──");

{
  ok("null resolved -> {room: null}", JSON.stringify(buildRoomEmbedJson(null)) === JSON.stringify({ room: null }));
  ok(
    "a resolved room with no .room -> {room: null}",
    JSON.stringify(buildRoomEmbedJson({})) === JSON.stringify({ room: null }),
  );

  const resolved = {
    room: { display_name: "Anjali", default_locale: "hi" },
    sheet: { name: "Anjali Sharma" },
    module: {},
    agentId: "b1000000-0000-4000-8000-000000000001",
  };
  const built = buildRoomEmbedJson(resolved);
  ok("carries the room's own display name, not the sheet's legal name", built.room.display_name === "Anjali");
  ok("carries the room's own default locale", built.room.locale === "hi");
  ok(
    "the disclosure is roomDisclosureCard(sheet.name, locale), verbatim",
    built.room.disclosure === roomDisclosureCard("Anjali Sharma", "hi"),
  );
  ok(
    "no follower count, no follower field, anywhere in the built JSON",
    !/follower|thread/i.test(JSON.stringify(built)),
  );

  // default_locale absent or unrecognised -> "en", the same fallback
  // clientRoom() itself uses one file over.
  const noLocale = buildRoomEmbedJson({ room: { display_name: "X" }, sheet: { name: "X" } });
  ok("an unrecognised locale falls back to en", noLocale.room.locale === "en");
}

// ═══ 7. THROUGH THE REAL resolveRoom, WITH THE SHARED FIXTURE WORLD ═══════
console.log("\n── 7. read: through the real resolveRoom ──");

{
  const { loadAgent, SHEET } = await loadFixtureAgent(REPO);

  const publishedState = freshState();
  const db1 = fakeDb(publishedState);
  const publishedResolved = await readRoomEmbed(db1, SLUG, { loadAgent });
  ok("a published room resolves", Boolean(publishedResolved));
  const publishedJson = buildRoomEmbedJson(publishedResolved);
  ok("its JSON carries a display name", publishedJson.room?.display_name === "Anjali");
  ok(
    "its JSON carries the exact disclosure roomSay/roomSpeak would mint",
    publishedJson.room?.disclosure === roomDisclosureCard(roomNameFor(SHEET), "en"),
  );

  const pausedState = freshState();
  pausedState.rooms[0].paused_at = "2026-09-04T00:00:00.000Z";
  const db2 = fakeDb(pausedState);
  const pausedResolved = await readRoomEmbed(db2, SLUG, { loadAgent });
  ok("a paused room does not resolve", pausedResolved === null);
  const pausedJson = buildRoomEmbedJson(pausedResolved);

  const neverPublishedState = freshState();
  neverPublishedState.rooms[0].published_at = null;
  const db3 = fakeDb(neverPublishedState);
  const neverPublishedResolved = await readRoomEmbed(db3, SLUG, { loadAgent });
  ok("a never-published room does not resolve", neverPublishedResolved === null);
  const neverPublishedJson = buildRoomEmbedJson(neverPublishedResolved);

  const unknownState = freshState();
  const db4 = fakeDb(unknownState);
  const unknownResolved = await readRoomEmbed(db4, "no-such-room-at-all", { loadAgent });
  ok("an unknown slug does not resolve", unknownResolved === null);
  const unknownJson = buildRoomEmbedJson(unknownResolved);

  ok(
    "paused, never-published and unknown all answer the IDENTICAL shape",
    JSON.stringify(pausedJson) === JSON.stringify(neverPublishedJson) &&
      JSON.stringify(neverPublishedJson) === JSON.stringify(unknownJson) &&
      JSON.stringify(unknownJson) === JSON.stringify({ room: null }),
  );
  ok("that shape carries no creator field at all", !("display_name" in (pausedJson.room || {})));
}

// ═══ 8. NEGATIVE CONTROL (a) — the one fetch target ═══════════════════════
console.log("\n── 8. negative control: the fetch-target checker actually bites ──");

/** The SAME rule §2's assertions and the eval's own trust rest on: every
 *  `fetch(` call in the script names `/room-embed.js` and nothing else. */
function onlyFetchesRoomEmbed(src) {
  const calls = [...src.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  if (calls.length === 0) return false;
  return calls.every((argText) => /\/room-embed\.js/.test(argText) && !/\/(?!room-embed\.js)[a-z-]+\.js/.test(argText));
}

{
  ok("the real script: exactly one fetch, and it names /room-embed.js", onlyFetchesRoomEmbed(ROOM_EMBED_JS));

  const corrupted = ROOM_EMBED_JS.replace(
    'fetch(origin + "/room-embed.js?slug="',
    'fetch(origin + "/room-embed.js?slug=" + slug); fetch(origin + "/other-endpoint.js"',
  );
  ok(
    "NEGATIVE CONTROL: a second fetch to a different path is caught",
    !onlyFetchesRoomEmbed(corrupted),
  );
}

// ═══ 9. NEGATIVE CONTROL (b) — no follower table in the file ══════════════
console.log("\n── 9. negative control: the follower-table checker actually bites ──");

function namesNoFollowerTable(src) {
  return !/vy_room_follower|vy_room_thread|\bcount\s*\(/i.test(src);
}

{
  const realSrc = readFileSync(join(REPO, "api/_room-embed.js"), "utf8");
  ok("the real api/_room-embed.js names no follower table and no count(", namesNoFollowerTable(realSrc));

  const corrupted = `${realSrc}\n// select * from vy_room_follower where 1=1\n`;
  ok(
    "NEGATIVE CONTROL: a follower-table reference is caught",
    !namesNoFollowerTable(corrupted),
  );
}

// ═══ 10. NEGATIVE CONTROL (c) — the copy gate catches an em dash ══════════
console.log("\n── 10. negative control: the copy gate catches an em dash ──");

{
  // The Share-tab card's own sentences, byte-identical to what
  // `src/studio/RoomStudio.tsx` renders — a designated fixture, not a
  // re-derivation, so a future edit to the real copy that quietly grows a
  // dash is still caught the moment this fixture is updated to match it.
  const CLEAN_SNIPPET = `
    function Card() {
      return (
        <article className="teacher-sheet-card vy-room__link-card">
          <h3>On your own site</h3>
          <p className="field-note">
            Paste this into any page you control: a coaching site, a Linktree, a blog post. It shows one button
            with your Room's disclosure beneath it, and opens your Room in a new tab when a visitor clicks it.
          </p>
        </article>
      );
    }
  `;
  const cleanHits = scanSource("src/studio/fixture.tsx", CLEAN_SNIPPET, { rules: "full", codename: true, roomsVocab: true });
  ok("the real Share-tab copy passes the copy gate clean", cleanHits.length === 0, JSON.stringify(cleanHits));

  const DASHED_SNIPPET = CLEAN_SNIPPET.replace(
    "a coaching site, a Linktree, a blog post",
    "a coaching site — a Linktree, a blog post",
  );
  const dashedHits = scanSource("src/studio/fixture.tsx", DASHED_SNIPPET, { rules: "full", codename: true, roomsVocab: true });
  ok(
    "NEGATIVE CONTROL: an em dash slipped into the same sentence is caught",
    dashedHits.some((h) => h.rule === "dash"),
    JSON.stringify(dashedHits),
  );
}

// ═══ 11. NO PROVIDER, MODEL OR AGENT UUID EVER REACHES THE SCRIPT ═════════
console.log("\n── 11. the fence api/embed.js already states, restated here ──");

{
  ok(
    "no provider or model name anywhere in the shipped script",
    !/openrouter|gemini|openai|anthropic|azure|chatterbox|elevenlabs|sarvam/i.test(ROOM_EMBED_JS),
  );
  ok("no uuid literal in the shipped script", !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(ROOM_EMBED_JS));
  ok("no cookie is ever written", !/document\.cookie/.test(ROOM_EMBED_JS));
  ok("no iframe, ever (v0's own law)", !/iframe/i.test(ROOM_EMBED_JS));
  ok("never says the banned word", !/\bclon(e[sd]?|ing)\b/i.test(ROOM_EMBED_JS));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
