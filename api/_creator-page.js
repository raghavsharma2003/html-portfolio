// api/_creator-page.js — the creator's own public page at /c/<slug> (WS-R66,
// migration 115).
//
// ── WS-R90: SEARCH PRESENCE ─────────────────────────────────────────────
//
// This page already had a canonical (WS-R66) and Person/FAQPage JSON-LD
// (WS-R66) and per-node language tags (WS-R79). WS-R90 adds the other three
// things a search engine needs to index a bilingual page correctly: the
// hreflang alternates and x-default (`HREFLANG_CODES` below), og:locale,
// and — outside this file — an `xhtml:link` hreflang cluster for `/c/:slug`
// in `api/_sitemap.js`. Nothing here changes what the PAGE renders for a
// visitor; every addition is a `<link>`/`<meta>` tag in `<head>` a browser
// already ignores if it does not recognize it.
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
//
// ── WS-R80: THE TASTE, RIGHT HERE ───────────────────────────────────────
//
// A search visitor used to have to click through to `/r/<slug>` before they
// could ask anything. Below, `publicCreatorPageRoomBySlug`'s own SELECT now
// carries `taste_enabled` (migration 110's column, already read by
// `roomBySlug` for the follower lane) so this page can decide, from the SAME
// row the follower lane trusts, whether to render the island at all — never
// a second, JS-side guess. Nothing on the server is new: `buildTasteSection`
// below only emits markup and copy; the actual turn is the SAME `taste` op
// on `api/room.js`, through the SAME `roomTaste` (`api/_room-taste.js`) and
// the SAME 3-a-day `room_taste` rate scope every other taste caller already
// goes through. The island's own script (`public/creator-taste.js`) is a
// STATIC file served under `script-src 'self'` — never inline — so the
// `/c/:slug` CSP (`vercel.json`) needs no widening at all
// (`context/decisions.md#ws-r80-island-not-a-second-app`).
//
// THE COPY is `src/room/copy.ts`'s own `taste` section (and its shared
// `errors.generic`), restated here as `TASTE_COPY` rather than imported —
// this file runs as a plain Vercel Node function and cannot import a `.ts`
// module the way `src/studio/pulseApi.ts`'s own header already explains the
// front end cannot import a server module (the identical import boundary,
// crossed in the other direction). `evals/creator-page/run.mjs` bundles the
// REAL `src/room/copy.ts` with esbuild (`evals/room-locale/run.mjs`'s own
// technique) and asserts `TASTE_COPY` is byte-identical to it, both locales
// — a real proof, not a comment promising one, so a future edit to the
// Room's own taste copy that forgets this page is caught mechanically
// rather than trusted. `public/creator-taste.js` itself carries NONE of
// this text: every string it renders is either read off a `data-*`
// attribute this file already wrote into the HTML, or comes back verbatim
// in the server's own JSON reply (`turn.reply`, `turn.disclosure`) — the
// SAME "the disclosure is RETURNED, never asked for" law `api/_room-embed.js`
// states for its own script, restated a third surface over.
import { readRoomShowcase } from "./_room-publish.js";
import { roomDisclosureCard, normalizeLocale, slugOf } from "./_room-surface.js";
import { PLATFORM_TITLE, PLATFORM_DESCRIPTION } from "./_room-page.js";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `src/room/copy.ts`'s own `withName`, restated (the trivial one-liner it
 *  is) rather than imported — see this file's own header for why a `.ts`
 *  module cannot be imported here. */
function withName(template, name) {
  return String(template || "").split("{name}").join(name);
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
// WS-R90: SEARCH PRESENCE — hreflang alternates, x-default, and og:locale.
//
// Google's own hreflang doc ("Tell Google about localized versions of your
// page") states the rule this page follows exactly: "The set of links is
// identical for every version of the page" — every response to `/c/:slug`,
// whichever locale it actually renders, carries the SAME three `<link>`
// tags below, because they describe the URL STRUCTURE (which query string
// reaches which language), not which language happened to render this one
// time. That is also why this is computed from `url`/`slug` alone, never
// from `locale` — the same reasoning `renderPage`'s existing `<link
// rel="canonical">` already follows one line up (a fixed, query-string-free
// address, "the en page" per this workstream's own brief, regardless of
// which locale a Room's own `default_locale` renders there by default).
//
// HREFLANG_CODES and HI_LANG_QUERY are named constants, not inline
// literals, so `scripts/probeLiveExpectations.mjs` can parse them straight
// out of this file's own source for the live probe — WS-R64's law,
// restated a second workstream over: "never a second literal."
const HREFLANG_CODES = ["en", "hi", "x-default"];
const HI_LANG_QUERY = "?lang=hi";

// Open Graph's own two-part locale code (language_TERRITORY per the Open
// Graph protocol, e.g. "en_US"), distinct from this product's plain "en"/
// "hi" locale value — mapped once, here, so the probe can parse the exact
// values this file actually emits rather than assuming the convention.
const OG_LOCALE = { en: "en_US", hi: "hi_IN" };

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
  // WS-R89: was `String(slug || "").trim().toLowerCase()` — a second,
  // weaker slug shape than `api/_room-surface.js`'s own `slugOf` (no ASCII
  // check, no NFKC normalisation, no length ceiling), so a homoglyph or an
  // oversized slug reached this SELECT as a "near-miss lookup" (0 rows,
  // indistinguishable from an ordinary unknown slug) rather than being
  // refused BY NAME at the door — `context/decisions.md#ws-r89-creator-page-
  // slug-read-shares-slugof`.
  const s = slugOf(slug);
  if (!s) return null;
  const rows = await db(
    `select room_id, slug, display_name, one_line_bio, default_locale, listed_at, taste_enabled
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
    askTitle: "Ask a question",
  },
  hi: {
    aboutLabel: "परिचय",
    showcaseLabel: (name) => `${name} ने जिन सवालों के जवाब चुने`,
    joinLabel: (name) => `${name} AI से बात करें`,
    poweredBy: "यह इस क्रिएटर की अपनी सामग्री से बनाया गया AI है.",
    askTitle: "एक सवाल पूछें",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// THE TASTE COPY — `src/room/copy.ts`'s `taste` section plus its shared
// `errors.generic`, restated (see this file's own header for why). Every
// field here is asserted byte-identical to the real, bundled `copy.ts`
// export in `evals/creator-page/run.mjs` — never trust this comment alone.
// ─────────────────────────────────────────────────────────────────────────
export const TASTE_COPY = {
  en: {
    lede: "Ask {name} AI a question before you sign in. Nothing you say here is kept.",
    placeholder: "Ask something",
    send: "Send",
    thinking: "Typing",
    join: "Join to keep talking",
    turnsLeftOne: "One more question before you join.",
    turnsLeft: "{n} more questions before you join.",
    spent: "That is three for today. Join to keep talking.",
    rateLimited: "That is enough taste questions from this connection for today. Join to keep talking.",
    errorGeneric: "That did not go through. Try again.",
  },
  hi: {
    lede: "साइन इन करने से पहले {name} AI से एक सवाल पूछें। यहां कही बात रखी नहीं जाती।",
    placeholder: "कुछ पूछें",
    send: "भेजें",
    thinking: "लिख रहे हैं",
    join: "बात जारी रखने के लिए जुड़ें",
    turnsLeftOne: "जुड़ने से पहले एक और सवाल बचा है।",
    turnsLeft: "जुड़ने से पहले {n} और सवाल बचे हैं।",
    spent: "आज के लिए तीन सवाल हो गए। बात जारी रखने के लिए जुड़ें।",
    rateLimited: "इस कनेक्शन से आज के लिए इतने सवाल काफ़ी हैं। बात जारी रखने के लिए जुड़ें।",
    errorGeneric: "वह नहीं भेजा जा सका। फिर कोशिश करें।",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// THE TASTE WIDGET — the island's markup and its no-JS form. Absent
// entirely (both the section and the deferred script tag) when the Room's
// own `taste_enabled` switch is off — never rendered-then-hidden, so an
// operator who turns it off ships zero extra bytes to this page, not a
// dead form.
//
// THE FORM'S `action` carries NO query string on purpose: a GET form
// submission replaces whatever query string `action` had with the
// serialized form fields (the HTML living standard's own rule for
// `<form method="get">`), so `via=search` rides as a HIDDEN FIELD instead —
// the only way it survives into the no-JS navigation to
// `/r/<slug>?via=search`, the Room's own taste screen for a signed-out
// visitor (`RoomApp.tsx`'s default `phase === "join"` branch, `WS-R53`'s own
// screen, no query param this page invents).
// ─────────────────────────────────────────────────────────────────────────
function buildTasteSection(room, name, locale, slugParam) {
  if (room.taste_enabled === false) return "";
  const t = TASTE_COPY[locale];
  const c = PAGE_COPY[locale];
  // The outer `slug` (the URL's own `/c/<slug>`), never `room.slug` — the
  // SAME choice `joinUrl`/`roomImageUrl` already make a few lines above this
  // function's own call site, restated so this page never carries two
  // different ideas of "this Room's slug".
  const slugRaw = String(slugParam || "");
  const slug = encodeURIComponent(slugRaw);
  // WS-R79's rule applied to WS-R80's lede at their merge: the creator's
  // name inside this sentence is the creator's own word in the creator's
  // own language, so it is spliced in with its own `lang` (the same
  // `withLangSplicedName` the join link below uses) rather than trusted to
  // match the page's locale. `withLangSplicedName` escapes what it returns,
  // so the result is rendered as-is, never through `esc()` a second time.
  const lede = withLangSplicedName(withName(t.lede, name), name);
  return `<section class="taste" aria-labelledby="taste-title">
      <h2 id="taste-title">${esc(c.askTitle)}</h2>
      <p class="room-lede" id="vy-taste-lede">${lede}</p>
      <p class="disclosure" id="vy-taste-disclosure" hidden></p>
      <div id="vy-taste-turns" aria-live="polite"></div>
      <form id="vy-taste-form" method="get" action="/r/${slug}" data-room="${esc(slugRaw)}" data-locale="${locale}">
        <input type="hidden" name="via" value="search" />
        <label class="sr-only" for="vy-taste-input">${esc(t.placeholder)}</label>
        <input id="vy-taste-input" name="q" type="text" placeholder="${esc(t.placeholder)}" autocomplete="off" required />
        <button id="vy-taste-submit" type="submit" data-send="${esc(t.send)}" data-thinking="${esc(t.thinking)}">${esc(t.send)}</button>
      </form>
      <p id="vy-taste-status" aria-live="polite"
         data-turns-left-one="${esc(t.turnsLeftOne)}"
         data-turns-left="${esc(t.turnsLeft)}"
         data-spent="${esc(t.spent)}"
         data-rate-limited="${esc(t.rateLimited)}"
         data-generic-error="${esc(t.errorGeneric)}"></p>
      <p><a id="vy-taste-join" href="/r/${slug}?via=search" hidden>${esc(t.join)}</a></p>
    </section>`;
}

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
  // The `hi` hreflang alternate's own address — built from the SAME `url`
  // every other address on this page is built from, so it can never drift
  // out of sync with a slug change the way a second, independently-built
  // URL could.
  const hreflangHiUrl = `${url}${HI_LANG_QUERY}`;
  const roomImageUrl = `${base}/r/${encodeURIComponent(String(slug || ""))}/og.png`;

  if (!data || !data.room) {
    return renderPage({
      title: PLATFORM_TITLE,
      description: PLATFORM_DESCRIPTION,
      url,
      hreflangHiUrl,
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

  const tasteHtml = buildTasteSection(room, name, locale, slug);

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
    ${tasteHtml}
    ${showcaseHtml}
    <p><a href="${esc(joinUrl)}">${withLangSplicedName(c.joinLabel(name), name)}</a></p>
  </main>`;

  const ld = buildCreatorPageJsonLd({ room, showcase: items, url });
  const jsonLd = [jsonLdScript(ld.person), jsonLdScript(ld.faq)].join("");

  return renderPage({
    title, description, url, hreflangHiUrl, imageUrl: roomImageUrl, locale, body, jsonLd,
    // The deferred island script, only when there is a form on the page for
    // it to enhance — `buildTasteSection` returns "" the instant
    // `taste_enabled` is false, and this line reads that same absence
    // rather than re-deciding it.
    tasteScript: Boolean(tasteHtml),
  });
}

function renderPage({ title, description, url, hreflangHiUrl, imageUrl, locale, body, jsonLd, tasteScript = false }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  const hiU = esc(hreflangHiUrl);
  const i = esc(imageUrl);
  const htmlLang = locale === "hi" ? "hi" : "en";
  const ogLocale = OG_LOCALE[htmlLang] || OG_LOCALE.en;
  // `defer`, never inline: `/creator-taste.js` is a static file the `/c/:slug`
  // CSP already admits under `script-src 'self'` — WS-R80's own law 2 — and
  // `defer` executes it after parsing, before `load`, without blocking the
  // render this page exists to serve fast.
  const script = tasteScript ? '\n    <script src="/creator-taste.js" defer></script>' : "";
  // WS-R90: the hreflang alternates, ONE per HREFLANG_CODES entry, "en" and
  // "x-default" both pointing at the bare address (`u`), "hi" at the
  // `?lang=hi` address (`hiU`) — the same set on every response, per this
  // file's own header above `HREFLANG_CODES`.
  const hreflangLinks = HREFLANG_CODES
    .map((code) => `<link rel="alternate" hreflang="${code}" href="${code === "hi" ? hiU : u}" />`)
    .join("\n    ");
  return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    ${hreflangLinks}
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta property="og:image" content="${i}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <style>${PAGE_STYLE}</style>${script}
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
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .taste { margin-top: 1.5rem; }
  .taste form { display: flex; gap: 0.5rem; margin: 0.75rem 0; flex-wrap: wrap; }
  .taste input[type="text"] {
    flex: 1 1 auto; min-width: 0; padding: 0.6rem 0.75rem; font: inherit;
    border: 1px solid rgba(28, 32, 26, 0.25); border-radius: 0.5rem;
    background: #fff; color: #171915;
  }
  .taste button {
    padding: 0.6rem 1.1rem; border: none; border-radius: 0.5rem;
    background: #17493b; color: #fff; font: 600 1em/1.2 inherit; cursor: pointer;
  }
  .taste button:disabled { opacity: 0.6; cursor: default; }
  @media (prefers-reduced-motion: no-preference) {
    .taste button { transition: background 0.15s ease; }
  }
  .taste button:hover:not(:disabled) { background: #123a2f; }
  .room-taste-turn { border-top: 1px solid rgba(28, 32, 26, 0.12); padding: 0.75rem 0; }
  .room-taste-q { font-weight: 600; margin: 0 0 0.35rem; }
  .room-taste-a { margin: 0; color: #292c26; }
  #vy-taste-status { font-size: 0.85rem; color: #52564e; min-height: 1.2em; }
  #vy-taste-join { display: inline-block; margin-top: 0.5rem; }
`;
