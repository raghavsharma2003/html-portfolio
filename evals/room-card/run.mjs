// The Room's pictures (WS-R55) — offline, deterministic, $0, no DB, no
// network, no model call, no GPU.
//
//   node evals/room-card/run.mjs
//
// Drives the REAL modules `api/room-card.js`'s door calls:
// `computeCardLayout`/`renderRoomCard`/`buildRoomCardSvg`/`cardInputFor`/
// `rasterizeRoomCard`/`roomCardEtag` (`api/_room-card.js`). Proves:
//
//   1. THE SVG, for `en` and `hi`. `renderRoomCard` returns a well-formed
//      SVG document sized exactly to `ROOM_CARD_SIZES[kind]` for both
//      locales and both kinds (og/story).
//   2. THE IDENTICAL-BYTES RULE (brief law 3). A paused Room and an unknown
//      slug both resolve to `row = null` at this file's own boundary
//      (`api/_room-page.js`'s own `resolveRoomPage` already collapses the
//      two, WS-R40's law); `cardInputFor(null, kind)` renders the SAME
//      platform card either way, and the RASTERISED bytes hash identical.
//   3. THE COPY SCAN. Every line this file actually draws — the name, the
//      bio, the disclosure sentence, the brand mark — run through the REAL
//      `scripts/check-copy.mjs` scanner, `api/_room-publish.js`'s
//      `assertBioClean` precedent (wrap as a `const label = ...;` literal
//      so the scanner's visible-string extraction sees it).
//   4. THE ETAG. Stable for identical inputs, distinct per kind, distinct
//      per real Room, and — the identical-bytes law again, restated for
//      the door's own caching — the SAME for every unpublished-or-unknown
//      slug.
//   5. TWO NEGATIVE CONTROLS: (a) a follower-shaped field reachable from
//      the renderer fails a static scan of this file's own property
//      access (proven by first showing the SAME scan catches a poisoned
//      fixture); (b) a bio carrying a banned Rooms-vocabulary word is
//      caught by the real scanner when run through this file's own
//      rendered text.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const {
  ROOM_CARD_SIZES,
  ROOM_CARD_KINDS,
  computeCardLayout,
  renderRoomCard,
  buildRoomCardSvg,
  cardInputFor,
  rasterizeRoomCard,
  roomCardEtag,
} = await import(pathToFileURL(join(REPO, "api/_room-card.js")).href);
const { scanSource } = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const ROW_EN = {
  display_name: "Anjali Sharma",
  one_line_bio: "JEE physics, one doubt at a time.",
  default_locale: "en",
};
const ROW_HI = {
  display_name: "प्रिया",
  one_line_bio: "हिन्दी में बात करें, हर दिन।",
  default_locale: "hi",
};

// ═══ 1. THE SVG, en AND hi ══════════════════════════════════════════════
console.log("\n── 1. the SVG, en and hi ──");
for (const kind of ROOM_CARD_KINDS) {
  const { width, height } = ROOM_CARD_SIZES[kind];
  for (const [label, row] of [["en", ROW_EN], ["hi", ROW_HI]]) {
    const svg = buildRoomCardSvg(row, kind);
    ok(`${kind}/${label}: well-formed SVG document`, svg.startsWith("<svg") && svg.trim().endsWith("</svg>"));
    ok(`${kind}/${label}: sized exactly to ROOM_CARD_SIZES`,
      svg.includes(`width="${width}" height="${height}"`) && svg.includes(`viewBox="0 0 ${width} ${height}"`));
    ok(`${kind}/${label}: carries the creator's own name`, svg.includes(row.display_name));
    ok(`${kind}/${label}: carries the brand mark`, svg.includes("Vyakti"));
  }
}
ok("an unknown kind falls back to og's own size", (() => {
  const svg = renderRoomCard({ name: "X", bio: "", locale: "en", kind: "not-a-kind" });
  return svg.includes(`width="${ROOM_CARD_SIZES.og.width}" height="${ROOM_CARD_SIZES.og.height}"`);
})());

// ═══ 2. THE IDENTICAL-BYTES RULE ════════════════════════════════════════
console.log("\n── 2. identical bytes: paused and unknown are the same picture ──");
for (const kind of ROOM_CARD_KINDS) {
  // resolveRoomPage (api/_room-page.js) already collapses "paused" and
  // "unknown" to the identical `null` before this file ever sees a row -
  // WS-R40's own law. What THIS file must prove is that `null` always
  // produces the identical rendered picture, whatever request produced it.
  const pngPaused = await rasterizeRoomCard(cardInputFor(null, kind));
  const pngUnknown = await rasterizeRoomCard(cardInputFor(null, kind));
  ok(`${kind}: two platform-card renders hash identical`, sha256(pngPaused) === sha256(pngUnknown));
  ok(`${kind}: platform card carries the platform's own name, never a creator's`,
    !buildRoomCardSvg(null, kind).includes("Anjali") && !buildRoomCardSvg(null, kind).includes("प्रिया"));

  const pngReal = await rasterizeRoomCard(cardInputFor(ROW_EN, kind));
  ok(`${kind}: a real Room's picture differs from the platform card`, sha256(pngReal) !== sha256(pngPaused));

  const { width, height } = ROOM_CARD_SIZES[kind];
  ok(`${kind}: rasterised bytes are a real PNG of the right dimensions`, (() => {
    // PNG signature + IHDR: width/height are the 4-byte big-endian ints at
    // offset 16/20 - reading them directly is cheaper than a PNG library
    // for a single sanity check, and does not add a new dependency.
    const sig = pngReal.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const w = pngReal.readUInt32BE(16);
    const h = pngReal.readUInt32BE(20);
    return sig && w === width && h === height;
  })());
  ok(`${kind}: rasterised bytes are non-blank (more than a bare PNG header/footer)`, pngReal.length > 2000);
}

// ═══ 3. THE COPY SCAN ═══════════════════════════════════════════════════
console.log("\n── 3. the copy scan: every rendered line, through the real scanner ──");
function scanRenderedLines(input) {
  const layout = computeCardLayout(input);
  const offences = [];
  for (const block of layout.blocks) {
    for (const line of block.lines) {
      const fixture = `const label = ${JSON.stringify(line)};`;
      offences.push(...scanSource("room-card-line.tsx", fixture, { rules: "full", codename: true, roomsVocab: true }));
    }
  }
  return offences;
}
for (const [label, row] of [["en", ROW_EN], ["hi", ROW_HI], ["platform", null]]) {
  for (const kind of ROOM_CARD_KINDS) {
    const offences = scanRenderedLines(cardInputFor(row, kind));
    ok(`${kind}/${label}: every rendered line scans clean`, offences.length === 0,
      offences.map((o) => `${o.rule}:${o.text}`).join(" | "));
  }
}

// ═══ 4. THE ETAG ═════════════════════════════════════════════════════════
console.log("\n── 4. the ETag ──");
ok("stable for identical inputs", roomCardEtag(ROW_EN, "og") === roomCardEtag(ROW_EN, "og"));
ok("distinct per kind", roomCardEtag(ROW_EN, "og") !== roomCardEtag(ROW_EN, "story"));
ok("distinct per real Room", roomCardEtag(ROW_EN, "og") !== roomCardEtag(ROW_HI, "og"));
ok("distinct once the bio changes", roomCardEtag(ROW_EN, "og") !== roomCardEtag({ ...ROW_EN, one_line_bio: "different" }, "og"));
ok("the SAME for every unpublished-or-unknown slug (identical-bytes law, restated for caching)",
  roomCardEtag(null, "og") === roomCardEtag(null, "og"));
ok("a real Room's ETag never collides with the platform card's", roomCardEtag(ROW_EN, "og") !== roomCardEtag(null, "og"));

// ═══ 5. NEGATIVE CONTROLS ════════════════════════════════════════════════
console.log("\n── 5. negative controls ──");

// (a) a follower-shaped field reachable from the renderer fails a static
// scan of this file's own property access. `row.<name>` is the only shape
// a follower id, a follower count, or a memory-consent flag could enter
// this file through — `cardInputFor` is the one function that reads `row`
// at all, so scanning ITS OWN property access is exhaustive, not sampled.
const ALLOWED_ROW_FIELDS = new Set(["display_name", "one_line_bio", "default_locale"]);
function rowFieldOffences(src) {
  const found = [...src.matchAll(/row\.([a-zA-Z_]+)/g)].map((m) => m[1]);
  return found.filter((name) => !ALLOWED_ROW_FIELDS.has(name));
}
const poisoned = `
export function cardInputFor(row, kind) {
  if (!row) return { name: null, bio: null, locale: "en", kind };
  return {
    name: row.display_name || "",
    bio: row.one_line_bio || "",
    locale: row.default_locale,
    followers: row.follower_count,
    kind,
  };
}`;
ok("NEGATIVE CONTROL (a): a poisoned fixture with row.follower_count is caught",
  rowFieldOffences(poisoned).includes("follower_count"));

const realCardSrc = readFileSync(join(REPO, "api/_room-card.js"), "utf8");
const realDoorSrc = readFileSync(join(REPO, "api/room-card.js"), "utf8");
const realOffences = [...rowFieldOffences(realCardSrc), ...rowFieldOffences(realDoorSrc)];
ok("the REAL api/_room-card.js and api/room-card.js touch only display_name/one_line_bio/default_locale on `row`",
  realOffences.length === 0, realOffences.join(", "));

// (b) a bio carrying a banned Rooms-vocabulary word is caught by the real
// scanner when it reaches this file's own rendered text — `api/_room-publish.js`'s
// `assertBioClean` already refuses this bio at WRITE time (WS-R45); this
// proves the SAME scanner also bites here, in case a future bio source
// ever bypasses that write path.
const dirtyRow = { display_name: "Test Creator", one_line_bio: "I am a clone of a real teacher.", default_locale: "en" };
const dirtyOffences = scanRenderedLines(cardInputFor(dirtyRow, "og"));
ok("NEGATIVE CONTROL (b): a bio containing the banned word 'clone' is caught by the real scanner",
  dirtyOffences.some((o) => o.rule === "rooms-vocabulary"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
