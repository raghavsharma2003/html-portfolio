// WS-R64. Every expectation `scripts/probe-live.mjs` checks a real
// deployment against, derived from THIS repo's own source rather than typed
// twice — the brief's own law: "Every expectation is derived from the
// repo's own source where one exists, never a second literal." Shared by
// the live script and by `evals/probe-live/run.mjs` (the offline gate that
// proves this file's own parsing against a fake server), so the two can
// never silently disagree about what a deploy is supposed to look like.
//
// Nothing in this file makes a network call, touches a database, or
// imports a server module that might (api/_room-surface.js, api/_db.js,
// ...). It only reads static bytes already on disk — vercel.json, the
// public/ assets, and a handful of api/*.js files parsed as TEXT for the
// literal constants and error codes their own source already commits to.
// That is deliberate: importing the real handlers would pull in `_db.js`
// and friends at module-load time, which is exactly the kind of accidental
// live dependency this workstream's whole brief exists to avoid.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");

function read(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}
function readBytes(relPath) {
  return readFileSync(join(ROOT, relPath));
}

// A slug nobody will ever register — random per process so two runs never
// collide with each other's rate-limit buckets, but stable long enough for
// one probe run's "two unknown slugs must render identical bytes" check to
// use two of these deterministically-different values.
export function unknownSlug(tag) {
  return `vyakti-probe-unknown-${tag}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// vercel.json — routes, header promises, and the cron list. Same `source`
// matching Vercel itself uses (literal segments, `:param` for one path
// segment, a literal `(.*)` group), copied from `scripts/check-headers.mjs`'s
// own `sourceToRegExp` rather than imported from it: that file is an
// existing release gate this workstream must not risk destabilizing, and
// the parsing rule itself is a few lines of pure text -> RegExp, not a
// live expectation that could drift out from under a second copy.
// ─────────────────────────────────────────────────────────────────────────
function sourceToRegExp(source) {
  const ESCAPE = /[.+?^${}|[\]\\]/g;
  let pattern = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === ":") {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      pattern += "[^/]+";
      i = j;
    } else if (source.startsWith("(.*)", i)) {
      pattern += "(?:.*)";
      i += 4;
    } else {
      pattern += source[i].replace(ESCAPE, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export function loadVercelConfig() {
  return JSON.parse(read("vercel.json"));
}

export function loadHeaderRules(config = loadVercelConfig()) {
  return (config.headers || []).map((h) => ({
    source: h.source,
    re: sourceToRegExp(h.source),
    headers: Object.fromEntries(h.headers.map((kv) => [kv.key, kv.value])),
  }));
}

export function headersFor(rules, pathname) {
  const matched = rules.filter((r) => r.re.test(pathname));
  const merged = {};
  for (const m of matched) Object.assign(merged, m.headers); // last match wins, same as Vercel
  return { merged, matchedSources: matched.map((m) => m.source) };
}

// A concrete, safe (GET/HEAD, no side effect) path to probe for each
// `headers[].source` in vercel.json, so a route class added to that array
// is probed the day it ships with no change to this function for the two
// shapes this repo actually uses: a literal path, and `:slug`. A bare
// wildcard group is special-cased to the API's own three sample doors
// (`/api/chat`, `/api/room`, `/api/account`) because "the rest of any path"
// has no single generic concrete instance — named here rather than left to
// silently probe nothing.
export function routeTargetsFromHeaderRules(rules, slug) {
  const targets = [];
  for (const rule of rules) {
    if (rule.source === "/api/(.*)") {
      for (const p of ["/api/chat", "/api/room", "/api/account"]) {
        targets.push({ source: rule.source, path: p, rule });
      }
      continue;
    }
    if (rule.source.includes(":slug")) {
      targets.push({ source: rule.source, path: rule.source.replace(":slug", encodeURIComponent(slug)), rule });
      continue;
    }
    if (rule.source.includes("(.*)") || rule.source.includes(":")) {
      // No other parametric shape exists in vercel.json today; a future one
      // is flagged rather than silently skipped or guessed at.
      targets.push({ source: rule.source, path: null, rule, unsupported: true });
      continue;
    }
    targets.push({ source: rule.source, path: rule.source, rule });
  }
  return targets;
}

export function cronPaths(config = loadVercelConfig()) {
  return (config.crons || []).map((c) => c.path);
}

// ─────────────────────────────────────────────────────────────────────────
// The Room unfurl (api/_room-page.js) — platform-only literals for an
// unpublished-or-unknown slug.
// ─────────────────────────────────────────────────────────────────────────
export function roomPageFacts() {
  const src = read("api/_room-page.js");
  const title = /export const PLATFORM_TITLE\s*=\s*"([^"]*)"/.exec(src)?.[1];
  const description = /export const PLATFORM_DESCRIPTION\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(src)?.[1];
  const ogWidth = Number(/const OG_IMAGE_WIDTH\s*=\s*(\d+)/.exec(src)?.[1]);
  const ogHeight = Number(/const OG_IMAGE_HEIGHT\s*=\s*(\d+)/.exec(src)?.[1]);
  if (!title || !description || !ogWidth || !ogHeight) {
    throw new Error("probeLiveExpectations: could not parse api/_room-page.js's platform literals");
  }
  return { title, description, ogWidth, ogHeight };
}

// ─────────────────────────────────────────────────────────────────────────
// The Room card raster (api/_room-card.js) — the two fixed pixel sizes.
// ─────────────────────────────────────────────────────────────────────────
export function roomCardSizes() {
  const src = read("api/_room-card.js");
  const og = /og:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/.exec(src);
  const story = /story:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/.exec(src);
  if (!og || !story) throw new Error("probeLiveExpectations: could not parse api/_room-card.js's ROOM_CARD_SIZES");
  return {
    og: { width: Number(og[1]), height: Number(og[2]) },
    story: { width: Number(story[1]), height: Number(story[2]) },
  };
}

// PNG signature + IHDR width/height, no image library needed — both are
// fixed-offset bytes in every valid PNG (ISO/IEC 15948).
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function pngDimensions(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ─────────────────────────────────────────────────────────────────────────
// The Room manifest (api/_room-manifest.js) — the platform fallback IS
// public/room.webmanifest's own bytes (that file's own header explains
// why), so the expectation is simply those bytes, read once.
// ─────────────────────────────────────────────────────────────────────────
export function platformManifestBytes() {
  return readBytes("public/room.webmanifest");
}

export function roomSwBytes() {
  return readBytes("public/room-sw.js");
}

export function robotsTxtBytes() {
  return readBytes("site/robots.txt");
}

// ─────────────────────────────────────────────────────────────────────────
// The embed script (api/_room-embed.js) — the exact bytes served at
// `/room-embed.js` (no `?slug=`). Extracted as text rather than imported:
// importing the module would also import `./_room-surface.js`, which this
// file must never do (see this file's own header).
// ─────────────────────────────────────────────────────────────────────────
export function roomEmbedJs() {
  const src = read("api/_room-embed.js");
  const marker = "export const ROOM_EMBED_JS = String.raw`";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("probeLiveExpectations: ROOM_EMBED_JS marker not found in api/_room-embed.js");
  const bodyStart = start + marker.length;
  const end = src.lastIndexOf("`");
  if (end <= bodyStart) throw new Error("probeLiveExpectations: could not find ROOM_EMBED_JS's closing backtick");
  return src.slice(bodyStart, end);
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/room — the closing "unknown_op" 400 and the "no session" 401
// `readRoomSession` throws before any op's own logic runs. Both parsed from
// source so a future rename of either code fails this file loudly rather
// than the live probe silently checking a stale literal.
// ─────────────────────────────────────────────────────────────────────────
export function roomKnownOps() {
  const src = read("api/room.js");
  return [...src.matchAll(/op === "([a-z_]+)"/g)].map((m) => m[1]);
}

export function roomUnknownOpExpectation() {
  const src = read("api/room.js");
  const m = /return res\.status\((\d+)\)\.json\(\{\s*error:\s*"unknown_op"\s*\}\)/.exec(src);
  if (!m) throw new Error("probeLiveExpectations: could not find the unknown_op fallthrough in api/room.js");
  return { status: Number(m[1]), body: { error: "unknown_op" } };
}

export function roomNoSessionExpectation() {
  const src = read("api/_room-surface.js");
  // Scoped to `readRoomSession`'s own body so a DIFFERENT `room_session_*`
  // error elsewhere in the file (there are several) is never picked up by
  // accident -- this greps only between the function's own declaration and
  // its closing brace.
  const fnMatch = /export function readRoomSession\([\s\S]*?\n\}/.exec(src);
  if (!fnMatch) throw new Error("probeLiveExpectations: could not find readRoomSession in api/_room-surface.js");
  const body = fnMatch[0];
  const m = /new RoomError\("(room_session_invalid)",\s*(\d+)\)/.exec(body);
  if (!m) throw new Error("probeLiveExpectations: could not find readRoomSession's own thrown RoomError");
  return { status: Number(m[2]), body: { error: m[1] } };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/room-embed?slug=<unknown> — `buildRoomEmbedJson(null)`'s own
// shape, parsed rather than retyped.
// ─────────────────────────────────────────────────────────────────────────
export function roomEmbedUnknownExpectation() {
  const src = read("api/_room-embed.js");
  const m = /if \(!resolved \|\| !resolved\.room\) return (\{[^}]*\})/.exec(src);
  if (!m) throw new Error("probeLiveExpectations: could not find buildRoomEmbedJson's null-shape in api/_room-embed.js");
  // The literal is JS object syntax (`{ room: null }`), not JSON -- `room`
  // is unquoted -- so a small rewrite before JSON.parse is required rather
  // than assuming the source text already IS the JSON body.
  const asJson = m[1].replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
  return { status: 200, body: JSON.parse(asJson) };
}

// ─────────────────────────────────────────────────────────────────────────
// The 12 cron sweeps in vercel.json's `crons` array -- each file's OWN
// `authorized(req)` failure line, parsed rather than assumed uniform: two
// of the twelve answer 403 with a different error string than the other
// ten's 401, and both are correct per that file's own choice.
// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// WS-R90: the creator page's <head> literals — hreflang codes, the "hi"
// alternate's own query suffix, and the og:locale mapping — parsed from
// `api/_creator-page.js`'s own `HREFLANG_CODES`/`HI_LANG_QUERY`/`OG_LOCALE`
// constants rather than retyped, the identical discipline every other
// `*Facts()`/`*Expectation()` function in this file already follows.
// ─────────────────────────────────────────────────────────────────────────
export function creatorPageHeadFacts() {
  const src = read("api/_creator-page.js");
  const codesMatch = /const HREFLANG_CODES\s*=\s*\[([^\]]*)\]/.exec(src);
  const hreflangCodes = codesMatch ? [...codesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : null;
  const hiQueryMatch = /const HI_LANG_QUERY\s*=\s*"([^"]+)"/.exec(src);
  const ogLocaleMatch = /const OG_LOCALE\s*=\s*\{\s*en:\s*"([^"]+)",\s*hi:\s*"([^"]+)"\s*\}/.exec(src);
  if (!hreflangCodes || !hreflangCodes.length || !hiQueryMatch || !ogLocaleMatch) {
    throw new Error("probeLiveExpectations: could not parse api/_creator-page.js's HREFLANG_CODES/HI_LANG_QUERY/OG_LOCALE");
  }
  return {
    hreflangCodes,
    hiQuery: hiQueryMatch[1],
    ogLocale: { en: ogLocaleMatch[1], hi: ogLocaleMatch[2] },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// WS-R90: a small, hand-written schema.org validator for exactly the two
// JSON-LD types `api/_creator-page.js#buildCreatorPageJsonLd` emits (Person
// always, FAQPage only with a showcase) — required fields only, never a
// full schema.org conformance suite, and no network call of any kind: the
// brief's own law for this check ("write a small validator for the two
// types' required fields; no network"). Shared by `evals/creator-page/
// run.mjs` (against the real builder's output) and `scripts/probe-live.mjs`
// (against whatever JSON-LD a real deployment actually serves), so the two
// can never disagree about what "valid" means here.
// ─────────────────────────────────────────────────────────────────────────
export function validatePersonJsonLd(obj) {
  const errors = [];
  if (obj?.["@context"] !== "https://schema.org") errors.push('@context must be "https://schema.org"');
  if (obj?.["@type"] !== "Person") errors.push('@type must be "Person"');
  if (typeof obj?.name !== "string" || !obj.name) errors.push("name must be a non-empty string");
  if (typeof obj?.url !== "string" || !obj.url) errors.push("url must be a non-empty string");
  return errors;
}

export function validateFaqPageJsonLd(obj) {
  const errors = [];
  if (obj?.["@context"] !== "https://schema.org") errors.push('@context must be "https://schema.org"');
  if (obj?.["@type"] !== "FAQPage") errors.push('@type must be "FAQPage"');
  if (!Array.isArray(obj?.mainEntity) || obj.mainEntity.length === 0) {
    errors.push("mainEntity must be a non-empty array");
    return errors;
  }
  obj.mainEntity.forEach((question, i) => {
    if (question?.["@type"] !== "Question") errors.push(`mainEntity[${i}].@type must be "Question"`);
    if (typeof question?.name !== "string" || !question.name) errors.push(`mainEntity[${i}].name must be a non-empty string`);
    if (question?.acceptedAnswer?.["@type"] !== "Answer") errors.push(`mainEntity[${i}].acceptedAnswer.@type must be "Answer"`);
    if (typeof question?.acceptedAnswer?.text !== "string" || !question.acceptedAnswer.text) {
      errors.push(`mainEntity[${i}].acceptedAnswer.text must be a non-empty string`);
    }
  });
  return errors;
}

export function cronAuthExpectation(apiPath) {
  const rel = `api${apiPath.replace(/^\/api/, "")}.js`;
  if (!existsSync(join(ROOT, rel))) return null;
  const src = read(rel);
  const m = /if\s*\(!\s*authorized\w*\(req\)\)\s*return\s+res\.status\((\d{3})\)\.json\(\{\s*error:\s*"([^"]+)"\s*\}\)/.exec(src);
  if (!m) return null;
  return { status: Number(m[1]), body: { error: m[2] } };
}
