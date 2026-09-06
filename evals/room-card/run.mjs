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
//   6. THE POSTER'S QR, DECODED FROM REAL PIXELS (WS-R78, brief law 3).
//      `jsqr` (npm, zero dependencies, a devDependency here, never
//      imported by `api/`) decodes the QR from the ACTUAL rasterised
//      poster PNG this file draws — never a matrix comparison — and
//      asserts the recovered string against the exact expected
//      `/r/<slug>?via=poster` URL, for both locales; a paused-or-unknown
//      poster's QR points at the bare origin, revealing no slug (the
//      identical-bytes law, restated for a QR payload); the same URL
//      also appears as plain text under the QR (brief law 2, "for people
//      who cannot scan"); no origin resolved degrades to no QR rather
//      than a crash. The story card gains the SAME QR, small, in a
//      corner clear of its own edges (brief law 2's own last sentence),
//      meaningfully smaller than the poster's centrepiece one; the og
//      card carries none. NEGATIVE CONTROL: erasing the finder pattern's
//      own pixels in the real rendered PNG breaks the same real
//      scanner's read.
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
  slug: "anjali",
};
const ROW_HI = {
  display_name: "प्रिया",
  one_line_bio: "हिन्दी में बात करें, हर दिन।",
  default_locale: "hi",
  slug: "priya",
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
// WS-R78: `slug` joined the allowed set for the poster's own QR (an
// absolute `/r/<slug>?via=poster` URL) — still one of `publicRoomBySlug`'s
// own four public columns, never a follower-shaped one.
const ALLOWED_ROW_FIELDS = new Set(["display_name", "one_line_bio", "default_locale", "slug"]);
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
ok("the REAL api/_room-card.js and api/room-card.js touch only display_name/one_line_bio/default_locale/slug on `row`",
  realOffences.length === 0, realOffences.join(", "));

// WS-R136: `api/_room-card.js` stays pure (no change this workstream) — the
// number resolution now lives one file over, in the real door. A static
// check that the door actually AWAITS the resolved number (never a stale
// synchronous read of a promise object) and threads the real `fetch`
// through, exactly like `api/room-wa.js`'s own `fetch: globalThis.fetch`
// precedent — the offline complement to the pure-function absence proofs
// above, which cannot see the door's own async wiring at all.
ok("the REAL api/room-card.js awaits whatsappJoinLink (never reads a pending Promise as if it were the string)",
  /await\s+whatsappJoinLink\(/.test(realDoorSrc));
ok("the REAL api/room-card.js threads the real fetch through, never a business-logic module assuming a global",
  /whatsappJoinLink\([^)]*fetch:\s*globalThis\.fetch/.test(realDoorSrc));

// (b) a bio carrying a banned Rooms-vocabulary word is caught by the real
// scanner when it reaches this file's own rendered text — `api/_room-publish.js`'s
// `assertBioClean` already refuses this bio at WRITE time (WS-R45); this
// proves the SAME scanner also bites here, in case a future bio source
// ever bypasses that write path.
const dirtyRow = { display_name: "Test Creator", one_line_bio: "I am a clone of a real teacher.", default_locale: "en" };
const dirtyOffences = scanRenderedLines(cardInputFor(dirtyRow, "og"));
ok("NEGATIVE CONTROL (b): a bio containing the banned word 'clone' is caught by the real scanner",
  dirtyOffences.some((o) => o.rule === "rooms-vocabulary"));

// ═══ 6. THE POSTER'S QR, DECODED FROM REAL RENDERED PIXELS (WS-R78) ══════
console.log("\n── 6. the poster's QR: decoded from the real rasterised PNG, not compared as matrices ──");
{
  const jsQR = (await import("jsqr")).default;
  const ORIGIN = "https://vyakti-rooms.vercel.app";

  async function decodePosterQr(row, kind = "poster") {
    const png = await rasterizeRoomCard(cardInputFor(row, kind, ORIGIN));
    const sharp = await import("sharp").then((m) => m.default, () => null);
    if (!sharp) return { png, decoded: null, skipped: true };
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    return { png, decoded: result ? result.data : null, skipped: false };
  }

  const { decoded: enDecoded, skipped } = await decodePosterQr(ROW_EN);
  if (skipped) {
    ok("sharp not installed — cannot decode the poster's QR to check it", false);
  } else {
    ok("a real, independent scanner (jsqr) reads the poster's QR back to the exact expected URL",
      enDecoded === `${ORIGIN}/r/anjali?via=poster`, `decoded: ${enDecoded}`);

    const { decoded: hiDecoded } = await decodePosterQr(ROW_HI);
    ok("the Hindi Room's poster encodes its OWN slug, not the English one's",
      hiDecoded === `${ORIGIN}/r/priya?via=poster`, `decoded: ${hiDecoded}`);

    // Law 2: a paused-or-unknown poster is byte-identical to the platform
    // one — the QR must therefore point at the bare origin, never at a
    // slug that would tell a scanner whether it existed.
    const { decoded: platformDecoded } = await decodePosterQr(null);
    ok("a paused-or-unknown poster's QR encodes the bare origin, revealing no slug",
      platformDecoded === `${ORIGIN}/`, `decoded: ${platformDecoded}`);

    // The URL is ALSO printed in plain text under the QR, for people who
    // cannot scan (brief law 2) — asserted against the real SVG (the copy
    // scan's own artefact, never re-rendered a second way).
    const svg = renderRoomCard(cardInputFor(ROW_EN, "poster", ORIGIN));
    ok("the same URL the QR encodes also appears as plain text on the poster",
      svg.includes(`${ORIGIN}/r/anjali?via=poster`));

    const layout = computeCardLayout(cardInputFor(ROW_EN, "poster", ORIGIN));
    ok("the poster's own layout carries a qr field for a real Room with an origin", !!layout.qr);

    // The story card gains the SAME QR, small, in a corner (brief law 2's
    // own last sentence) — the identical `url` this workstream's
    // `cardInputFor` resolves, so a story and a poster from the same Room
    // always point at the same address.
    const { decoded: storyDecoded } = await decodePosterQr(ROW_EN, "story");
    ok("the story card's own corner QR reads back to the exact expected URL",
      storyDecoded === `${ORIGIN}/r/anjali?via=poster`, `decoded: ${storyDecoded}`);
    const storyLayout = computeCardLayout(cardInputFor(ROW_EN, "story", ORIGIN));
    ok("the story card's QR sits inside the card, clear of its own edges (a real corner, not clipped)",
      !!storyLayout.qr && storyLayout.qr.x >= 0 && storyLayout.qr.y >= 0 &&
      storyLayout.qr.x + storyLayout.qr.size <= storyLayout.width &&
      storyLayout.qr.y + storyLayout.qr.size <= storyLayout.height);
    ok("the story card's own QR is meaningfully smaller than the poster's centrepiece one (a corner mark, not a second poster)",
      storyLayout.qr.size < layout.qr.size);
    const { decoded: ogDecoded } = await decodePosterQr(ROW_EN, "og");
    ok("the og card carries NO QR — the brief names only the poster and the story card, never og:image",
      ogDecoded === null);

    // NEGATIVE CONTROL: corrupt the REAL rasterised poster's own pixels
    // (not a hand-built fixture matrix) by painting over the finder
    // pattern the QR's own layout coordinates name, and the same real
    // scanner must fail to read it — `evals/qr/run.mjs`'s own §8 negative
    // control, restated against the full poster this file actually ships
    // rather than a bare QR test fixture.
    const canvasMod = await import("@napi-rs/canvas");
    const posterPng = await rasterizeRoomCard(cardInputFor(ROW_EN, "poster", ORIGIN));
    const image = await canvasMod.loadImage(posterPng);
    const canvas = canvasMod.createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    ctx.fillStyle = "#f4f1e9"; // PAPER — erases rather than draws a new mark
    ctx.fillRect(layout.qr.x, layout.qr.y, layout.qr.moduleSize * 10, layout.qr.moduleSize * 10);
    const corrupted = canvas.toBuffer("image/png");
    const sharp2 = await import("sharp").then((m) => m.default);
    const { data: cData, info: cInfo } = await sharp2(corrupted).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corruptedResult = jsQR(new Uint8ClampedArray(cData.buffer, cData.byteOffset, cData.length), cInfo.width, cInfo.height);
    ok("NEGATIVE CONTROL: erasing the poster's own finder-pattern pixels breaks the real scanner's read",
      !corruptedResult || corruptedResult.data !== `${ORIGIN}/r/anjali?via=poster`);
  }

  // No origin resolved (a caller that never had a request to derive one
  // from) degrades to no QR rather than a thrown error — `computeCardLayout`'s
  // own header on why.
  const noOriginLayout = computeCardLayout(cardInputFor(ROW_EN, "poster"));
  ok("with no origin, the poster layout carries no QR (a graceful degradation, never a crash)",
    noOriginLayout.qr === null);
  const noOriginPng = await rasterizeRoomCard(cardInputFor(ROW_EN, "poster"));
  ok("with no origin, the poster still rasterises to a real, non-blank PNG", noOriginPng.length > 2000);
}

// ═══ 7. THE POSTER'S WHATSAPP-JOIN VARIANT (WS-R126) ═════════════════════
console.log("\n── 7. the poster's ?channel=whatsapp variant: QR, sentence, identical-bytes law ──");
{
  const JOIN_URL_EN = "https://wa.me/919999900001?text=join%20anjali";
  const JOIN_URL_HI = "https://wa.me/919999900001?text=join%20priya";
  const ORIGIN = "https://vyakti-rooms.vercel.app";

  const input = cardInputFor(ROW_EN, "poster", ORIGIN, JOIN_URL_EN);
  ok("cardInputFor sets channel:'whatsapp' when given a join url on a poster",
    input.channel === "whatsapp" && input.url === JOIN_URL_EN);
  ok("cardInputFor ignores a join url for kind !== 'poster' (og never gets a channel)",
    cardInputFor(ROW_EN, "og", ORIGIN, JOIN_URL_EN).channel !== "whatsapp");
  ok("cardInputFor ignores a join url for an unpublished/unknown row — the identical-bytes law restated for a second query param",
    cardInputFor(null, "poster", ORIGIN, JOIN_URL_EN).url === `${ORIGIN}/`);

  const layout = computeCardLayout(input);
  const urlBlock = layout.blocks.find((b) => b.id === "url");
  ok("the caption under the QR is the WhatsApp sentence, never the raw wa.me link (unreadable/unretypeable as printed text)",
    !urlBlock.lines.join(" ").includes("wa.me") && urlBlock.lines.join(" ").toLowerCase().includes("whatsapp"));

  const hiLayout = computeCardLayout(cardInputFor(ROW_HI, "poster", ORIGIN, JOIN_URL_HI));
  const hiUrlBlock = hiLayout.blocks.find((b) => b.id === "url");
  ok("the Hindi poster's own WhatsApp sentence is in Hindi, not the English one reused",
    hiUrlBlock.lines.join(" ").includes("WhatsApp") && hiUrlBlock.lines.join(" ") !== urlBlock.lines.join(" "));

  // The copy scan (§3's own `scanRenderedLines`, reused rather than
  // re-implemented): this new sentence must clear the REAL check-copy.mjs
  // scanner exactly like every other line this file draws, in both locales.
  const enOffences = scanRenderedLines(input);
  ok("the WhatsApp poster's English sentence clears the real copy scanner (no em/en dash, no banned Rooms vocabulary)",
    enOffences.length === 0, enOffences.map((o) => `${o.rule}:${o.text}`).join(" | "));
  const hiOffences = scanRenderedLines(cardInputFor(ROW_HI, "poster", ORIGIN, JOIN_URL_HI));
  ok("the WhatsApp poster's Hindi sentence clears the real copy scanner too",
    hiOffences.length === 0, hiOffences.map((o) => `${o.rule}:${o.text}`).join(" | "));

  const jsQR = (await import("jsqr")).default;
  const sharp = await import("sharp").then((m) => m.default, () => null);
  if (!sharp) {
    ok("sharp not installed — cannot decode the whatsapp poster's QR to check it", false);
  } else {
    const png = await rasterizeRoomCard(input);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    ok("the whatsapp poster's QR decodes to the wa.me join link, not the ordinary ?via=poster address",
      decoded && decoded.data === JOIN_URL_EN, `decoded: ${decoded?.data}`);

    // Identical-bytes law, restated once more: an unpublished/unknown slug's
    // whatsapp-channel poster must hash the SAME as its ordinary poster —
    // the channel query param must never let a scanner learn a slug exists.
    const platformOrdinary = await rasterizeRoomCard(cardInputFor(null, "poster", ORIGIN));
    const platformWhatsapp = await rasterizeRoomCard(cardInputFor(null, "poster", ORIGIN, JOIN_URL_EN));
    ok("an unpublished/unknown slug's poster is BYTE-IDENTICAL whether or not ?channel=whatsapp is requested",
      sha256(platformOrdinary) === sha256(platformWhatsapp));
    ok("...and the ETag agrees (never a per-channel cache key for a slug that does not exist)",
      roomCardEtag(null, "poster", ORIGIN) === roomCardEtag(null, "poster", ORIGIN, JOIN_URL_EN));

    // A real Room's own ETag DOES change with the channel — two real,
    // distinct pictures must never share a cache entry.
    ok("a real Room's poster ETag changes between the ordinary and whatsapp variants",
      roomCardEtag(ROW_EN, "poster", ORIGIN) !== roomCardEtag(ROW_EN, "poster", ORIGIN, JOIN_URL_EN));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
