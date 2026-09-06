// api/_sitemap.js — the crawler feed's one read and one render (WS-R45).
//
// The SAME predicate `api/_creators.js` reads by, restated rather than
// imported for the identical reason that file's own header gives: a
// directory read and a sitemap read are two different modules with no owner
// scope, and the predicate is one line, not a shared abstraction worth a
// third file to own.
//
//   listed_at is not null and published_at is not null
//
// An unlisted or unpublished Room is absent from the sitemap exactly as it
// is absent from the directory page — a crawler must learn nothing from the
// absence, never a 404 or a noindex tag that itself confirms a slug exists.
//
// No import of `./_db.js` here on purpose, `api/_creators.js`'s own shape:
// this module takes `db` as a parameter so a fake `db` in an offline eval
// can reach every line below it.

/** A v1 scale bound, not a product ceiling: 5,000 listed-and-published Rooms
 *  is well past anything this platform has ever had a live row for
 *  (`context/STATE.md`'s LIVE table), and an unbounded `select *` is the
 *  wrong shape for a feed a crawler polls on its own schedule regardless of
 *  how large the table gets. Raise it, do not remove it, if the directory
 *  ever approaches this many real listings. */
const SITEMAP_MAX_ROOMS = 5000;

function xmlEscape(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function urlEntry(loc, lastmodIso) {
  const lastmod = lastmodIso ? `<lastmod>${xmlEscape(new Date(lastmodIso).toISOString().slice(0, 10))}</lastmod>` : "";
  return `  <url><loc>${xmlEscape(loc)}</loc>${lastmod}</url>`;
}

// ── WS-R90 ───────────────────────────────────────────────────────────────
// `/c/<slug>`'s own hreflang cluster, per Google's sitemap-method doc
// ("Indicate alternate language pages using sitemaps"): each `<url>` names
// EVERY language version as a child `<xhtml:link rel="alternate"
// hreflang="...">`, "including itself" — the same three codes and the same
// `?lang=hi` address `api/_creator-page.js`'s own `HREFLANG_CODES`/
// `HI_LANG_QUERY` put in the page's own `<head>`, restated here rather than
// imported (this module's own header: no cross-module import, a fake `db`
// must reach every line). `evals/creator-directory/run.mjs` and
// `evals/creator-page/run.mjs` both assert the two files agree.
const HREFLANG_CODES = ["en", "hi", "x-default"];
const HI_LANG_QUERY = "?lang=hi";

function creatorPageUrlEntry(origin, slug, lastmodIso) {
  const loc = `${origin}/c/${slug}`;
  const hiLoc = `${loc}${HI_LANG_QUERY}`;
  const lastmod = lastmodIso ? `<lastmod>${xmlEscape(new Date(lastmodIso).toISOString().slice(0, 10))}</lastmod>` : "";
  const alternates = HREFLANG_CODES
    .map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${xmlEscape(code === "hi" ? hiLoc : loc)}" />`)
    .join("\n");
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmod}\n${alternates}\n  </url>`;
}

/**
 * The full sitemap: the landing page, the directory, and every listed AND
 * published Room's `/r/<slug>`. `origin` is the caller's own scheme+host
 * (no new env var — the brief names none, and a hardcoded production origin
 * would print the wrong sitemap on every preview deployment, the same
 * reasoning `roomPublishApi.ts`'s `roomLink` gives for building a Room's own
 * link from `window.location.origin` rather than a constant).
 */
export async function buildSitemapXml(db, { origin }) {
  const rows = await db(
    `select slug, listed_at
       from vy_room
      where listed_at is not null
        and published_at is not null
      order by listed_at desc
      limit ($1)::int`,
    [SITEMAP_MAX_ROOMS],
  );

  const entries = [
    urlEntry(`${origin}/`, null),
    urlEntry(`${origin}/creators`, null),
    // WS-R66. `/c/<slug>` sits beside `/r/<slug>` for every listed-and-
    // published Room, the same `listed_at` lastmod: it is the crawlable
    // content page for the identical Room the link right before it opens.
    ...rows.flatMap((r) => [
      urlEntry(`${origin}/r/${r.slug}`, r.listed_at),
      // WS-R90: `/c/<slug>` carries its hreflang cluster; `/r/<slug>` (the
      // Room itself, a client app with no language-selecting query string
      // of its own) does not — this workstream's brief names only the
      // creator page for this addition.
      creatorPageUrlEntry(origin, r.slug, r.listed_at),
    ]),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}
