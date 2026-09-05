// The unfurl a crawler sees at /r/<slug> (WS-R40, share and arrival,
// migration 102).
//
// ── THE PROBLEM ─────────────────────────────────────────────────────────
//
// `/r/:slug` is one static `room.html` for every Room (vercel.json's own
// rewrite) — the same bytes whichever creator's link a browser opens. That
// is correct for a PERSON: the real screen is `RoomApp.tsx`, rendered client
// side once JS runs, and no server-rendered state exists for anyone signed
// in or not. It is wrong for a CRAWLER, which never runs the app's JS and
// reads only the `<head>` it was served — WhatsApp, Telegram, iMessage and
// every other unfurl bot read exactly the static file's bytes, which carry
// no `og:title`, no `og:description`, nothing. A follower who forwards a
// bio link today gets a bare blue URL in the recipient's chat.
//
// ── WHY THIS IS A FUNCTION AND room.html STAYS STATIC (decision, WS-R40) ──
//
// Rendering per-Room metadata needs a database read, and a database read
// needs a function — but only for the ~1% of requests to `/r/:slug` that are
// a bot, never for the person a link is actually for. `vercel.json`'s own
// rewrite order (this file's own vercel.json comment) sends a request to
// THIS handler only when its `user-agent` header matches a named unfurl-bot
// pattern; every other request still falls through to the existing
// `/room.html` rewrite below it, unchanged, at zero function cost. The
// reversal condition: the day a person's own first paint needs
// server-rendered state too (an SEO push, a no-JS fallback), this file
// becomes the answer for everyone and the two rewrites collapse into one —
// until then, splitting them is what keeps a person's Room load exactly as
// cheap as it always was.
//
// ── WHAT THIS FILE READS AND WHAT IT DOES NOT ─────────────────────────────
//
// `api/_room-publish.js`'s `publicRoomBySlug` — four columns off `vy_room`,
// scoped by the SAME published/unpaused predicate every public reader in
// this codebase already enforces. No agent sheet, no follower table, no
// count, ever. An unpublished OR unknown slug produce the IDENTICAL
// platform-only card — `api/_room-embed.js`'s own law, restated: a crawler
// must never learn whether a slug exists.
import { publicRoomBySlug } from "./_room-publish.js";
import { roomDisclosureCard, normalizeLocale } from "./_room-surface.js";

/** The platform's own name and sentence when a slug is unpublished or
 *  unknown — `site/vyakti.html`'s own `<title>`/`og:description` bytes,
 *  reused verbatim rather than a second, drifting copy of the same idea. */
export const PLATFORM_TITLE = "Vyakti";
export const PLATFORM_DESCRIPTION =
  "A private AI built from a creator's own material. Every follower gets their own continuing relationship with it, and none of them can hear each other.";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * slug -> the Room's public row, or null. Thin wrapper over
 * `publicRoomBySlug` so `buildRoomPageHtml` below stays pure and this
 * function stays the only thing an offline eval has to give a fake `db` to.
 */
export async function resolveRoomPage(db, slug) {
  return publicRoomBySlug(db, slug);
}

/**
 * PURE. `row` is exactly what `resolveRoomPage` returns (or null), `origin`
 * is the caller's own scheme+host (`api/room-page.js`'s own
 * `originFromRequest`, `api/sitemap.js`'s precedent). Builds the whole HTML
 * document — a minimal `<head>` (og:title, og:description, og:image only
 * when a URL is present, og:url, twitter:card) plus a body carrying the
 * SAME sentence and a link to `/r/<slug>`.
 *
 * `og:image` is never emitted here because no avatar/photo field exists
 * anywhere in this schema today (`vy_room` carries no such column) — this is
 * an honest absence, never a placeholder image invented to fill the tag,
 * `context/rejected.md`'s no-fake-numbers law applied to a picture instead
 * of a metric. The tag is written conditionally on a future `row.avatar_url`
 * so the day that column exists this file needs no structural change, only
 * a value.
 *
 * The disclosure sentence is `roomDisclosureCard`'s FIRST line only — the
 * never-deny-AI sentence, api/_room-surface.js's own three-sentence card,
 * §1 of it — never the whole card: an og:description a few hundred
 * characters long is what most unfurl surfaces truncate anyway, and the
 * first sentence is the one clause that must survive that truncation
 * intact. The full card still renders wherever `RoomApp.tsx` itself does —
 * this page is read by a bot, never by the person who taps through.
 *
 * `og:image` (WS-R55): this file used to leave it out entirely — the
 * comment that sat here said "no avatar field exists anywhere in this
 * schema", true then and still true now, but the fix was never a picture
 * FIELD, it was a picture RENDERED from the same three columns this
 * function already reads. Every url built here, published Room or not,
 * gets `/og.png` appended — `api/room-card.js` (via `vercel.json`'s own
 * rewrite one path segment over) re-resolves the SAME slug independently
 * and answers with the identical platform-only picture for an unpublished
 * or unknown one, `api/_room-card.js`'s own restatement of this file's
 * "a bot must never learn whether a slug exists" law. The width/height
 * mirror `api/_room-card.js`'s `ROOM_CARD_SIZES.og` as a literal rather
 * than an import, deliberately: that file already imports `PLATFORM_TITLE`/
 * `PLATFORM_DESCRIPTION` FROM this one (the "one source of truth" reuse
 * this function's own header names above), and importing back would make
 * the two files a cycle — ES module cycles resolve, sometimes, in whichever
 * order happens to load first, which is not a property to depend on
 * deliberately. `evals/room-card/run.mjs` asserts these two literals equal
 * `ROOM_CARD_SIZES.og`'s real values, so a future resize of the picture
 * fails a test here rather than drifting silently.
 */
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

export function buildRoomPageHtml(row, { origin, slug } = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = `/r/${encodeURIComponent(String(slug || ""))}`;
  const url = base ? `${base}${path}` : path;
  const imageUrl = `${url}/og.png`;

  if (!row) {
    return renderHead({
      title: PLATFORM_TITLE,
      description: PLATFORM_DESCRIPTION,
      url,
      imageUrl,
    });
  }

  const locale = normalizeLocale(row.default_locale);
  const name = row.display_name || "";
  // The FIRST sentence of the disclosure card only — see this function's
  // own header on why. `roomDisclosureCard` always returns three lines
  // joined by "\n"; splitting on that is safe because the card itself is
  // app-voiced data, never user-authored text that could contain one.
  const description = roomDisclosureCard(name, locale).split("\n")[0];
  const title = name ? `${name} AI` : PLATFORM_TITLE;

  return renderHead({
    title,
    description,
    url,
    imageUrl,
  });
}

function renderHead({ title, description, url, imageUrl }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  const image = imageUrl
    ? `\n    <meta property="og:image" content="${esc(imageUrl)}" />
    <meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
    <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
    <meta name="twitter:card" content="summary_large_image" />`
    : `\n    <meta name="twitter:card" content="summary" />`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />${image}
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
  </head>
  <body>
    <p>${d}</p>
    <p><a href="${u}">${u}</a></p>
  </body>
</html>
`;
}
