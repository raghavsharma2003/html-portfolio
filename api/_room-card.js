// The Room's pictures (WS-R55): a generated unfurl image per Room and a
// story card the creator can post. Every decision lives here, where a fake
// `db` never has to reach it at all — `renderRoomCard`, `computeCardLayout`
// and `buildRoomCardSvg` below are PURE (data in, string/object out), and
// `rasterizeRoomCard` is the one function in this file that touches the
// filesystem (reading the bundled font once) or a native addon (the
// canvas). `api/room-card.js` is the thin HTTP door one file over.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────
//
// `api/_room-page.js`'s own header names the gap: no picture field exists on
// `vy_room`, so its crawler-only unfurl never emits `og:image`, and a shared
// Room link on WhatsApp, Telegram or Instagram shows text alone. This file
// does not add a picture FIELD — nobody uploads anything, and no new column
// exists. It renders the picture, every time, from the same three columns
// `publicRoomBySlug` already exposes (`api/_room-publish.js`) — the identical
// public read `api/_room-page.js` uses, and no other. A static scan in
// `evals/room-card/run.mjs` proves this file's own source never mentions a
// follower table, a follower id, or a count.
//
// ── THE RASTERISER THIS FILE DOES NOT USE, AND WHY ──────────────────────
//
// The brief this workstream shipped from named `@resvg/resvg-js` (SVG in,
// PNG out, no browser). It was built, installed, and measured on real
// Devanagari text before a single line of the HTTP door was written — and
// it corrupts ordinary Hindi. `ब` + `ा` (vowel sign AA, U+093E) + `त`, three
// codepoints that spell the everyday word "बात" ("talk" — also the first
// word of `roomDisclosureCard`'s own Hindi sentence, "आप ... से बात कर रहे
// हैं"), rendered as a different, wrong glyph, reproduced on the CURRENT
// Google Fonts release of Noto Sans Devanagari (decoded from
// `@fontsource/noto-sans-devanagari`'s own `.woff2`, so this is not a
// stale-font problem) and on resvg-js 2.6.2 (latest stable) AND 2.7.0-alpha.2
// (latest prerelease) alike — not a version regression to wait out. Isolated
// two-character syllables (`बा`, `ता`) rendered correctly; the same two
// glyphs joined into one three-character run did not, and a space
// immediately after certain vowel-sign clusters vanished outright ("प्रिया
// AI" rendered "प्रियाAI"). That is rustybuzz's Indic shaper mishandling an
// extremely common consonant+matra+consonant cluster — not this repo's font
// file, not a resvg-js release bug. `context/rejected.md`'s own entry for
// this (search `ws-r55-resvg-devanagari-shaping`) is the full measurement; the
// short version is that a library named in a brief is a plan, and this
// product's own law is to measure before shipping the plan.
//
// `@napi-rs/canvas` (Skia's own text shaper, the same engine Chrome and
// Android use) renders every one of the same strings correctly — verified
// against the identical font bytes before this file was written the second
// time. It draws directly (`fillText`, no SVG-to-raster step), so
// `computeCardLayout` below is the one place that decides where every line
// sits, and `renderRoomCard` (SVG, for the copy scan and for a human to
// preview) and `rasterizeRoomCard` (PNG, for the wire) both read it rather
// than either one re-deriving layout its own way.
//
// ── THE FONT FILE, AND THE ONE THAT DID NOT WORK EITHER ─────────────────
//
// `@fontsource/noto-sans-devanagari` ships only `.woff`/`.woff2` — resvg-js's
// native `fontFiles` loader parses sfnt (ttf/otf/ttc) bytes, not a
// compressed web-font container, and failed SILENTLY: no error, an entirely
// blank card. `@napi-rs/canvas`'s own Skia font manager DOES parse woff2
// directly (verified), so that specific failure is moot once resvg is gone
// — but `@fontsource`'s Devanagari-only subset carries no Latin glyphs
// (`AI`, the brand mark, an English bio all need one), and this card is
// always mixed-script. `@expo-google-fonts/noto-sans-devanagari` ships a
// single raw `.ttf` per weight covering BOTH scripts from one file
// (`MIT AND OFL-1.1` — OFL-1.1 for the font itself, the same licence every
// other Noto face already carries into this product, MIT for Expo's own
// packaging; both permissive, both cited in `context/decisions.md`). Only
// the 400 (regular) weight is bundled — see `FONT_PATH` below.
//
// ── PLATFORM CARD: THE SAME RULE AS THE UNFURL, RESTATED FOR A PICTURE ─────
//
// `api/_room-page.js`'s `buildRoomPageHtml` renders the IDENTICAL
// platform-only card for an unpublished Room and an unknown slug, because a
// bot must never learn whether a slug exists. A picture is the same
// question asked in pixels: `cardInputFor(null, kind)` always hands
// `renderRoomCard`/`rasterizeRoomCard` the exact same literal
// `PLATFORM_TITLE`/`PLATFORM_DESCRIPTION` strings (imported from
// `api/_room-page.js`, never retyped — the identical "one source of truth"
// reasoning that file's own header gives for reusing `roomDisclosureCard`),
// in the fixed "en" locale, so the bytes produced for a paused Room and for
// a slug that was never registered are byte-identical, proven in
// `evals/room-card/run.mjs` by hashing both.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { PLATFORM_TITLE, PLATFORM_DESCRIPTION } from "./_room-page.js";
import { roomDisclosureCard, normalizeLocale } from "./_room-surface.js";

const require = createRequire(import.meta.url);

/** The two shapes this product hands a platform: a landscape unfurl card
 *  (WhatsApp/Telegram/iMessage/Twitter's `og:image`) and a portrait story
 *  card sized for Instagram/WhatsApp Status. Both a fixed pixel size, per
 *  law 1 of this workstream's brief. */
export const ROOM_CARD_SIZES = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};

export const ROOM_CARD_KINDS = Object.keys(ROOM_CARD_SIZES);

/** `studio.css`'s own palette (`--paper`, `--forest`, `--forest-deep`,
 *  `--signal`), copied here as plain hex rather than imported: this file has
 *  no CSS pipeline of its own (it draws to a canvas / emits raw SVG, never a
 *  browser), and the four values it needs are stable brand constants, not
 *  the kind of thing that drifts week to week. If `studio.css`'s own values
 *  ever move, this is the one other place to change them - named here so a
 *  future search for `--forest` finds it. */
const PAPER = "#f4f1e9";
const FOREST_DEEP = "#0e352a";
const FOREST = "#17493b";
const SIGNAL = "#ed693d";

/** The one wordmark this card ever draws — never a fabricated logo, never a
 *  claim of scale or a testimonial (DESIGN-SYSTEM.md's own "no superlatives,
 *  no fabricated proof" law, law 7). Plain text in the brand's own accent
 *  colour is the whole mark. */
const BRAND_MARK = "Vyakti";

const FONT_FAMILY = "Noto Sans Devanagari";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Word-wrap by character count into at most `maxLines` lines, each at most
 * `maxChars` wide, with the last line ellipsised if there was more to say.
 * Not a font-metrics wrap (measuring real glyph widths needs either the
 * canvas this file rasterises with, which `computeCardLayout` below is
 * deliberately kept independent of so it stays a plain, fast, pure
 * function, or a browser — `scripts/check-layout.mjs`'s own job, reused
 * for THIS font in `roomCardGlyphFixture`, not reimplemented here); a
 * character-count wrap is a deliberately generous approximation, tuned so
 * it wraps EARLY rather than overflows the card, because a short line
 * inside a card is a minor waste of a picture and an overflowing line is a
 * card that fails to render at all.
 */
function wrapLines(text, maxChars, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join(" ").length;
  const fullText = words.join(" ");
  if (lines.length === maxLines && consumed < fullText.length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, last.length - 1).trimEnd()}…` : last;
  }
  return lines;
}

/**
 * PURE. `{name, bio, locale, kind}` -> a plain layout object: pixel size,
 * the two background rectangles, and a list of text blocks, each an array
 * of already-wrapped lines with an ABSOLUTE `x`/`y` per line (never a
 * relative offset) — the one shared source both `renderRoomCard` (SVG, for
 * the copy scan and a human preview) and `rasterizeRoomCard` (canvas, for
 * the wire) read, so the two can never draw a different picture from the
 * same inputs. Never reads a file, never touches the network, never sees a
 * follower — only the four values a caller hands it, which is what makes
 * `evals/room-card/run.mjs`'s negative control possible: a fifth,
 * follower-shaped field simply has nowhere to plug in.
 */
export function computeCardLayout({ name, bio, locale, kind } = {}) {
  const size = ROOM_CARD_SIZES[kind] || ROOM_CARD_SIZES.og;
  const { width, height } = size;
  const isStory = kind === "story";
  const loc = normalizeLocale(locale);
  const displayName = String(name || "").trim() || PLATFORM_TITLE;
  const bioText = String(bio || "").trim();
  const disclosure = name ? roomDisclosureCard(displayName, loc).split("\n")[0] : PLATFORM_DESCRIPTION;

  const pad = isStory ? 96 : 88;
  const nameSize = isStory ? 84 : 68;
  const bioSize = isStory ? 40 : 32;
  const discSize = isStory ? 30 : 24;
  const markSize = isStory ? 34 : 26;
  const nameChars = isStory ? 14 : 20;
  const bioChars = isStory ? 26 : 40;
  const discChars = isStory ? 30 : 52;

  const nameLines = wrapLines(displayName, nameChars, 2);
  const bioLines = bioText ? wrapLines(bioText, bioChars, isStory ? 4 : 3) : [];
  const discLines = wrapLines(disclosure, discChars, isStory ? 4 : 2);

  const blocks = [];
  let y = isStory ? 640 : 260;
  const nameGap = nameSize * 1.18;
  blocks.push({ id: "name", lines: nameLines, x: pad, y, fontSize: nameSize, color: FOREST_DEEP, lineHeight: nameGap });
  y += nameGap * nameLines.length + (isStory ? 56 : 40);

  if (bioLines.length) {
    const bioGap = bioSize * 1.4;
    blocks.push({ id: "bio", lines: bioLines, x: pad, y, fontSize: bioSize, color: FOREST, lineHeight: bioGap });
  }

  const discY = height - (isStory ? 220 : 150);
  const discGap = discSize * 1.5;
  blocks.push({ id: "disclosure", lines: discLines, x: pad, y: discY, fontSize: discSize, color: FOREST, lineHeight: discGap });

  const markY = height - (isStory ? 88 : 56);
  blocks.push({ id: "mark", lines: [BRAND_MARK], x: pad, y: markY, fontSize: markSize, color: SIGNAL, lineHeight: 0 });

  return {
    width,
    height,
    background: PAPER,
    accent: { color: SIGNAL, width: 14 },
    fontFamily: FONT_FAMILY,
    blocks,
  };
}

/**
 * PURE. `renderRoomCard({name, bio, locale, kind})` -> an SVG document
 * string, built from `computeCardLayout`. Used for the copy scan
 * (`evals/room-card/run.mjs` runs every rendered string through the REAL
 * `scripts/check-copy.mjs` scanner, `api/_room-publish.js`'s `assertBioClean`
 * precedent) and as a human-inspectable artefact; NOT what ships to a
 * browser — `rasterizeRoomCard` below draws the same layout independently.
 */
export function renderRoomCard(input) {
  const layout = computeCardLayout(input);
  const { width, height, background, accent, fontFamily, blocks } = layout;
  const textEls = blocks
    .filter((b) => b.lines.length)
    .map((b) => {
      const tspans = b.lines
        .map((line, i) => `<tspan x="${b.x}" y="${b.y + b.lineHeight * i}">${esc(line)}</tspan>`)
        .join("");
      return `<text font-family="${fontFamily}, sans-serif" font-size="${b.fontSize}" fill="${b.color}">${tspans}</text>`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${background}" />
  <rect x="0" y="0" width="${accent.width}" height="${height}" fill="${accent.color}" />
  ${textEls}
</svg>`;
}

/**
 * `row` is exactly what `publicRoomBySlug` returns, or `null` — the same
 * shape `api/_room-page.js`'s `buildRoomPageHtml` takes. `null` maps to the
 * SAME platform-only inputs `buildRoomPageHtml` renders for that case, so
 * the two "a bot/a picture must never learn whether a slug exists"
 * guarantees cannot drift apart from each other by one file changing its
 * own copy.
 */
export function cardInputFor(row, kind) {
  if (!row) return { name: null, bio: null, locale: "en", kind };
  return {
    name: row.display_name || "",
    bio: row.one_line_bio || "",
    locale: row.default_locale,
    kind,
  };
}

export function buildRoomCardSvg(row, kind) {
  return renderRoomCard(cardInputFor(row, kind));
}

// ─────────────────────────────────────────────────────────────────────────
// RASTERISATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * The bundled Latin+Devanagari face, read ONCE per cold start and cached in
 * module scope — `readFileSync` runs at most once per function instance,
 * never per request. `require.resolve` with a literal string (never a
 * computed path) is what lets Vercel's build tracer (`@vercel/nft`) find
 * this file and bundle it into the function — the identical reason
 * `assertBioClean` (`api/_room-publish.js`) imports `scanSource` by a
 * literal specifier rather than a dynamic one. No runtime fetch to any font
 * host, ever — the byte source is `npm install`, which already ran before
 * this function is ever invoked.
 */
const FONT_PATH = require.resolve(
  "@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf",
);

let fontRegistered = false;
let cachedCanvasModule = null;
async function registeredCanvasModule() {
  if (!cachedCanvasModule) cachedCanvasModule = await import("@napi-rs/canvas");
  if (!fontRegistered) {
    const key = cachedCanvasModule.GlobalFonts.register(readFileSync(FONT_PATH), FONT_FAMILY);
    if (!key) throw new Error("room_card_font_register_failed");
    fontRegistered = true;
  }
  return cachedCanvasModule;
}

/**
 * `{name, bio, locale, kind}` -> a PNG `Buffer`, sized per `kind`
 * (`ROOM_CARD_SIZES`). Draws the SAME `computeCardLayout` `renderRoomCard`
 * draws, with Skia's own text shaper (`@napi-rs/canvas`, the Chrome/Android
 * engine) rather than resvg's — see this file's own header for the
 * Devanagari measurement that made this the rasteriser rather than the one
 * the brief named.
 */
export async function rasterizeRoomCard(input) {
  const layout = computeCardLayout(input);
  const { createCanvas } = await registeredCanvasModule();
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = layout.accent.color;
  ctx.fillRect(0, 0, layout.accent.width, layout.height);
  ctx.textBaseline = "alphabetic";
  for (const block of layout.blocks) {
    if (!block.lines.length) continue;
    ctx.fillStyle = block.color;
    ctx.font = `${block.fontSize}px "${layout.fontFamily}"`;
    block.lines.forEach((line, i) => {
      ctx.fillText(line, block.x, block.y + block.lineHeight * i);
    });
  }
  return canvas.toBuffer("image/png");
}

export async function rasterizeRoomCardForRoom(row, kind) {
  return rasterizeRoomCard(cardInputFor(row, kind));
}

/**
 * The ETag law (WS-R55 brief, law 4): derived from the INPUTS, never from
 * wall-clock time, so two requests for the same Room render the same tag,
 * and — the part the "identical bytes" law (law 3) needs — every
 * unpublished-or-unknown slug hashes to the SAME tag, because `row` is
 * always the same fixed literal in that case. `kind` is folded in so `/og`
 * and `/story` for the same Room never collide.
 */
export function roomCardEtag(row, kind) {
  const basis = row
    ? JSON.stringify([row.display_name || "", row.one_line_bio || "", normalizeLocale(row.default_locale), kind])
    : JSON.stringify(["__platform__", kind]);
  return `"${createHash("sha256").update(basis).digest("hex").slice(0, 32)}"`;
}
