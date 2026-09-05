// api/_creator-page.js — the creator's own public page at /c/<slug> (WS-R66,
// migration 115).
//
// ── THE PROBLEM ─────────────────────────────────────────────────────────
//
// WS-R45 lists a creator on `/creators` (a name, a one-line bio, a
// language) and WS-R40 gives `/r/<slug>` a `<head>` a bot can unfurl (a
// title and one sentence). Neither gives a search engine, or a person who
// followed a link from one, anything to actually READ. This is that page:
// who the creator is, up to five answers their AI gave that they chose to
// show, and the door in — creator material only, ever, the same boundary
// law every other Rooms surface holds.
//
// ── SERVER-RENDERED FOR EVERYONE, not a bot-only unfurl ────────────────────
//
// Unlike `api/_room-page.js` (which exists ONLY for the ~1% of requests to
// `/r/:slug` that are a crawler, because the real screen there is
// `RoomApp.tsx`, a client app with no server-rendered state for anyone), a
// stranger arriving at `/c/<slug>` has no client app to hand off to — this
// page's whole job is to BE the content. So every request to `/c/:slug`
// reaches this handler (vercel.json's own rewrite, no user-agent condition),
// person and bot alike, and there is no static fallback underneath it.
//
// ── LISTED AND PUBLISHED ONLY, identical unknown/unlisted answer ───────────
//
// `publicCreatorPageRoomBySlug` restates `api/_room-publish.js`'s
// `publicRoomBySlug` predicate (`published_at is not null and paused_at is
// null`) PLUS `api/_creators.js`'s own listing condition
// (`listed_at is not null`) in ONE where clause — deliberately not a call to
// `publicRoomBySlug` followed by a second check of `listed_at` on the row it
// returns, because `publicRoomBySlug`'s own SELECT never carries that column
// and checking a gate "after a row is already in hand" is exactly the
// anti-pattern `api/_disclosure.js`'s standing rule (a predicate belongs in
// the WHERE clause, never applied after) exists to name. A Room a creator
// never opted into being FOUND on gets the identical platform-only card an
// unknown slug gets — `api/_room-embed.js`'s law, restated a third surface
// over: nobody may learn whether a slug exists from this page's shape.
//
// ── NO IMPORT OF ./_db.js ────────────────────────────────────────────────
//
// `db` is a parameter, `api/_creators.js`'s own shape, so a fake `db` in an
// offline eval can reach every line below it.
import { readRoomShowcase } from "./_room-publish.js";
import { roomDisclosureCard, normalizeLocale } from "./_room-surface.js";
import { PLATFORM_TITLE, PLATFORM_DESCRIPTION } from "./_room-page.js";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── WS-R79: language tagging for screen readers ───────────────────────────
// `renderPage`'s own `<html lang="${htmlLang}">` names ONE thing: the
// visitor's own requested locale (`?lang=`, or the Room's `default_locale`
// when they asked for neither). Four things this page shows are the
// CREATOR'S own words, written once in whichever script they used, and are
// not guaranteed to be in that locale: their own name, their one-line bio,
// a showcase question or answer, and the "Talk to {name} AI" join link. A
// visitor who requests the OTHER locale via `?lang=` (a search engine, or a
// person who followed a link with the "wrong" query string attached) reads
// the platform's OWN copy correctly, in the requested locale, wrapping the
// creator's words exactly as authored - unless those words are tagged on
// their own.
//
// `detectPageTextLang` is `src/room/copy.ts`'s own `detectRoomTextLang`,
// restated rather than imported: `api/` never imports from `src/` in this
// repo (this file's own header, "no import of ./_db.js" - the same
// deliberate boundary, extended to every module across that line) and this
// page has no client bundle to share one with anyway - it is pure server
// HTML.
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;
function detectPageTextLang(text) {
  return DEVANAGARI_RANGE.test(String(text || "")) ? "hi" : "en";
}

/** One piece of creator-authored text, tagged with the language it is
 *  actually IN - the node, never the document
 *  (`context/decisions.md#ws-r79-tag-at-the-node-not-the-document`). */
function langSpan(tag, text, attrs = "") {
  const t = String(text || "");
  return `<${tag} lang="${detectPageTextLang(t)}"${attrs}>${esc(t)}</${tag}>`;
}

/** A template with exactly one occurrence of `name` inside it (`joinLabel`'s
 *  own shape below) - the name gets its own `lang`, the words around it stay
 *  untagged and inherit the page's own `htmlLang`, which is correct for
 *  them: they are `PAGE_COPY`'s own platform strings, always written in the
 *  locale they are shown in. Falls back to the whole string escaped, plain,
 *  if `name` is empty or not found - the same shape `withName`
 *  (`src/room/copy.ts`) falls back to when there is nothing to splice. */
function withLangSplicedName(label, name) {
  const n = String(name || "");
  const idx = n ? label.indexOf(n) : -1;
  if (idx === -1) return esc(label);
  return esc(label.slice(0, idx)) + langSpan("span", n) + esc(label.slice(idx + n.length));
}

/** Escapes a JSON-LD payload for embedding inside a `<script>` element: `<`
 *  becomes `<` so a value carrying the literal text `</script>` (a
 *  creator's own bio or showcase answer, however unlikely) can never close
 *  the element early and splice attacker-controlled markup into the page
 *  that follows it — the standard JSON-in-HTML escape, applied here because
 *  this page's JSON-LD is built from creator-authored free text, never a
 *  fixed platform string the way `_room-page.js`'s meta tags are. */
function jsonLdScript(obj) {
  if (!obj) return "";
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>\n  `;
}

// ─────────────────────────────────────────────────────────────────────────
// THE READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * slug -> the Room's public, LISTED fields, or null for anything not
 * currently showable — unpublished, paused, unlisted, or unknown. The one
 * caller is `resolveCreatorPage` below and the eval that drives this
 * directly.
 */
export async function publicCreatorPageRoomBySlug(db, slug) {
  if (typeof db !== "function") throw new Error("creator_page_db_required");
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;
  const rows = await db(
    `select room_id, slug, display_name, one_line_bio, default_locale, listed_at
       from vy_room
      where lower(slug) = $1
        and published_at is not null
        and paused_at is null
        and listed_at is not null
      limit 1`,
    [s],
  );
  return rows[0] || null;
}

/**
 * slug -> `{ room, showcase }` or null. `showcase` reuses
 * `api/_room-publish.js`'s own read (`readRoomShowcase`) rather than a
 * second copy of the same query — the Share tab and this public page must
 * never quietly stop agreeing about what "the Room's showcase" means.
 */
export async function resolveCreatorPage(db, slug) {
  const room = await publicCreatorPageRoomBySlug(db, slug);
  if (!room) return null;
  const showcase = await readRoomShowcase(db, room.room_id);
  return { room, showcase };
}

// ─────────────────────────────────────────────────────────────────────────
// THE COPY — both locales, plain functional prose, no dash of any kind
// ─────────────────────────────────────────────────────────────────────────

const PAGE_COPY = {
  en: {
    aboutLabel: "About",
    showcaseLabel: (name) => `Questions ${name} chose to answer`,
    joinLabel: (name) => `Talk to ${name} AI`,
    poweredBy: "An AI built from this creator's own material.",
  },
  hi: {
    aboutLabel: "परिचय",
    showcaseLabel: (name) => `${name} ने जिन सवालों के जवाब चुने`,
    joinLabel: (name) => `${name} AI से बात करें`,
    poweredBy: "यह इस क्रिएटर की अपनी सामग्री से बनाया गया AI है.",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// THE JSON-LD — Person + FAQPage, built from exactly what the page shows
// ─────────────────────────────────────────────────────────────────────────

/**
 * PURE. Never a fifth field the page itself does not render — a stranger's
 * page and a search engine's structured read of it must describe the exact
 * same thing. `faq` is `null` when there is no showcase yet (an empty
 * `mainEntity` array is a worse signal to a crawler than no FAQPage block at
 * all).
 */
export function buildCreatorPageJsonLd({ room, showcase, url }) {
  const name = String(room?.display_name || "").trim();
  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    url,
    ...(room?.one_line_bio ? { description: room.one_line_bio } : {}),
  };
  const items = Array.isArray(showcase) ? showcase : [];
  const faq = items.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;
  return { person, faq };
}

// ─────────────────────────────────────────────────────────────────────────
// THE PAGE — PURE. `data` is exactly what `resolveCreatorPage` returns, or
// null. `lang` is the raw `?lang=` query value; `normalizeLocale` decides.
// ─────────────────────────────────────────────────────────────────────────

export function buildCreatorPageHtml(data, { origin, slug, lang } = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = `/c/${encodeURIComponent(String(slug || ""))}`;
  const url = base ? `${base}${path}` : path;
  const roomImageUrl = `${base}/r/${encodeURIComponent(String(slug || ""))}/og.png`;

  if (!data || !data.room) {
    return renderPage({
      title: PLATFORM_TITLE,
      description: PLATFORM_DESCRIPTION,
      url,
      imageUrl: roomImageUrl,
      locale: "en",
      body: `<p>${esc(PLATFORM_DESCRIPTION)}</p>`,
      jsonLd: "",
    });
  }

  const { room, showcase } = data;
  const locale = normalizeLocale(lang ?? room.default_locale);
  const c = PAGE_COPY[locale];
  const name = room.display_name || "";
  const title = name ? `${name} AI` : PLATFORM_TITLE;
  const description = room.one_line_bio || roomDisclosureCard(name, locale).split("\n")[0];
  const joinUrl = `${base}/r/${encodeURIComponent(String(slug || ""))}?via=search`;
  const items = Array.isArray(showcase) ? showcase : [];

  const showcaseHtml = items.length
    ? `<section aria-labelledby="showcase-title">
    <h2 id="showcase-title">${withLangSplicedName(c.showcaseLabel(name), name)}</h2>
    <dl>
      ${items
        .map(
          (item) => `<div class="qa">
        ${langSpan("dt", item.question)}
        ${langSpan("dd", item.answer)}
      </div>`,
        )
        .join("\n      ")}
    </dl>
  </section>`
    : "";

  // WS-R79: `name` and `description` are the creator's own words - tagged on
  // their own node rather than trusted to match `htmlLang` (see this file's
  // own comment above `detectPageTextLang`). `c.poweredBy` stays a plain
  // `esc()`: it is `PAGE_COPY`'s own platform sentence, always written in
  // the locale it is shown in, never the creator's.
  const h1Html = name ? `${langSpan("span", name)} AI` : esc(title);
  const body = `<main>
    <h1>${h1Html}</h1>
    <section aria-labelledby="about-title">
      <h2 id="about-title">${esc(c.aboutLabel)}</h2>
      ${langSpan("p", description)}
      <p class="disclosure">${esc(c.poweredBy)}</p>
    </section>
    ${showcaseHtml}
    <p><a href="${esc(joinUrl)}">${withLangSplicedName(c.joinLabel(name), name)}</a></p>
  </main>`;

  const ld = buildCreatorPageJsonLd({ room, showcase: items, url });
  const jsonLd = [jsonLdScript(ld.person), jsonLdScript(ld.faq)].join("");

  return renderPage({ title, description, url, imageUrl: roomImageUrl, locale, body, jsonLd });
}

function renderPage({ title, description, url, imageUrl, locale, body, jsonLd }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  const i = esc(imageUrl);
  const htmlLang = locale === "hi" ? "hi" : "en";
  return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    <meta property="og:type" content="profile" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <style>${PAGE_STYLE}</style>
  </head>
  <body>
    ${body}
    ${jsonLd}</body>
</html>
`;
}

/** Plain, small, no build step — `site/creators.html`'s own token values
 *  restated (this file has no CSS bundling step to share them through), kept
 *  to the one page's own needs rather than pulled in as a stylesheet. Zero
 *  script, zero web font — the performance gate's font budget is 0KB by
 *  construction everywhere this repo renders text, this page included. */
const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 3rem; max-width: 40rem; margin-inline: auto;
    background: #f4f1e9; color: #171915;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Devanagari", sans-serif;
  }
  h1 { font-size: 1.75rem; margin: 0 0 1rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
  p { margin: 0 0 0.75rem; }
  .disclosure { color: #52564e; font-size: 0.9rem; }
  dl { margin: 0; }
  .qa { border-top: 1px solid rgba(28, 32, 26, 0.12); padding: 1rem 0; }
  .qa dt { font-weight: 600; margin-bottom: 0.4rem; }
  .qa dd { margin: 0; color: #292c26; }
  a { color: #17493b; font-weight: 600; }
`;
