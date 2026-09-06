// WS-R64. A fixture server that answers every surface `scripts/
// probe-live.mjs` checks, well-behaved by default, with two switches this
// suite's negative controls flip on purpose (a dropped header, a mangled
// manifest byte). This is the thing `evals/probe-live/run.mjs` runs
// `probe-live.mjs` against -- it proves the PROBE's own checking logic
// (does it actually notice a missing header? a wrong PNG size? a wrong
// error code?), not the real handlers, which already have their own
// suites (`evals/room-card`, `evals/room-doors`, `evals/room-install`, ...).
import { createServer } from "node:http";
import {
  loadVercelConfig,
  loadHeaderRules,
  headersFor,
  roomPageFacts,
  roomCardSizes,
  platformManifestBytes,
  roomSwBytes,
  robotsTxtBytes,
  roomEmbedJs,
  roomUnknownOpExpectation,
  roomNoSessionExpectation,
  roomEmbedUnknownExpectation,
  cronPaths,
  cronAuthExpectation,
} from "../../scripts/probeLiveExpectations.mjs";
import { makePng } from "./fakePng.mjs";
import { buildCreatorPageHtml } from "../../api/_creator-page.js";
import { buildRoomAboutHtml } from "../../api/_room-about.js";
import { buildSuitesAboutHtml } from "../../api/_suites-about.js";

const BOT_RE = /.*(facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Googlebot).*/;

// WS-R90: the ONE slug this fixture treats as "listed, published, and real"
// -- `buildCreatorPageHtml` is the REAL builder from `api/_creator-page.js`
// (imported above, never reimplemented), fed fixture Room/showcase data
// rather than a fake `db`, exactly what `scripts/probe-live.mjs`'s own
// `--creator-slug` flag expects a real deployment to answer with. Any OTHER
// slug still gets `buildCreatorPageHtml(null, ...)`, the platform-only
// fallback -- proving the probe's `--creator-slug` path checks the NAMED
// slug, not merely whatever `/c/:slug` happens to return.
export const CREATOR_FIXTURE_SLUG = "probe-fixture-creator";
const CREATOR_FIXTURE_DATA = {
  room: {
    display_name: "Fixture Creator",
    one_line_bio: "A fixture Room the live probe's own offline proof serves.",
    default_locale: "en",
    taste_enabled: false,
  },
  showcase: [
    { id: "s1", question: "What do you teach?", answer: "Everything this fixture needs to prove.", position: 1 },
  ],
};

// WS-R97. `/r/<slug>/about` has no `listed_at` gate at all (its own
// predicate, `api/_room-about.js`'s header) so this fixture reuses the
// SAME `CREATOR_FIXTURE_SLUG` `--creator-slug` already names, rather than
// inventing a second flag: a real deployment's `--creator-slug` is
// guaranteed published-and-unpaused, which is all this page ever requires.
const ROOM_ABOUT_FIXTURE_ROOM = {
  slug: CREATOR_FIXTURE_SLUG,
  display_name: "Fixture Creator",
  default_locale: "en",
  dormancy_days: 365,
  free_monthly_messages: 20,
  paid_monthly_messages: 500,
  paid_monthly_voice_seconds: 1800,
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function json(res, status, body, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(bytes);
}

/**
 * `defects` (all optional, all default off -- the well-behaved server):
 *   dropHeader: { path, key }     -- omit one promised header on one route
 *   corruptManifestByte: true     -- flip one byte of the manifest.webmanifest response
 *   dropCreatorHreflang: "hi"     -- strip one named hreflang <link> from /c/<slug>'s <head>
 *   corruptCreatorJsonLd: true    -- rename the Person JSON-LD block's @type so it fails schema validation
 *   dropAboutHreflang: "hi"       -- strip one named hreflang <link> from /r/<slug>/about's <head> (WS-R97)
 *   dropSuitesAboutHreflang: "hi" -- strip one named hreflang <link> from /suites/about's <head> (WS-R117)
 */
export function startFakeServer(port, defects = {}) {
  const config = loadVercelConfig();
  const rules = loadHeaderRules(config);
  const facts = roomPageFacts();
  const cardSizes = roomCardSizes();
  const manifestBytes = platformManifestBytes();
  const swBytes = roomSwBytes();
  const robotsBytes = robotsTxtBytes();
  const embedJs = roomEmbedJs();
  const unknownOpExp = roomUnknownOpExpectation();
  const noSessionExp = roomNoSessionExpectation();
  const embedUnknownExp = roomEmbedUnknownExpectation();
  const crons = cronPaths(config);

  function applyHeaders(res, pathname) {
    const { merged } = headersFor(rules, pathname);
    for (const [k, v] of Object.entries(merged)) {
      if (defects.dropHeader && defects.dropHeader.path === pathname && defects.dropHeader.key.toLowerCase() === k.toLowerCase()) continue;
      res.setHeader(k, v);
    }
  }

  function sendHtmlPage(res, pathname, title) {
    applyHeaders(res, pathname);
    const body = Buffer.from(`<!doctype html><html><head><title>${esc(title)}</title></head><body>${esc(title)}</body></html>`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const pathname = url.pathname;
      const method = req.method;

      // ── consume the body for POST, mirroring api/room.js's json parsing ──
      let body = {};
      if (method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
      }

      // ── the twelve cron endpoints, unauthenticated ──────────────────────
      if (crons.includes(pathname)) {
        applyHeaders(res, pathname);
        const exp = cronAuthExpectation(pathname);
        return json(res, exp.status, exp.body);
      }

      // ── POST /api/room ──────────────────────────────────────────────────
      if (pathname === "/api/room" && method === "POST") {
        applyHeaders(res, pathname);
        if (body.op === "say") {
          // The real readRoomSession throws before anything else runs when
          // `session` is absent -- mirrored here as the same status/body.
          if (!body.session) return json(res, noSessionExp.status, noSessionExp.body);
          return json(res, 200, { ok: true }); // never exercised by the probe
        }
        return json(res, unknownOpExp.status, unknownOpExp.body);
      }
      if (pathname === "/api/room" || pathname === "/api/chat" || pathname === "/api/account") {
        applyHeaders(res, "/api/(.*)");
        return json(res, 405, { error: "POST only" }, { "cache-control": "no-store" });
      }

      // ── GET /api/room-embed?slug= ───────────────────────────────────────
      if (pathname === "/api/room-embed") {
        applyHeaders(res, pathname);
        if (url.searchParams.get("slug")) return json(res, embedUnknownExp.status, embedUnknownExp.body);
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
        return res.end(Buffer.from(embedJs));
      }

      // ── /room-embed.js (vercel.json rewrite -> the same handler) ────────
      if (pathname === "/room-embed.js") {
        applyHeaders(res, pathname);
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
        return res.end(Buffer.from(embedJs));
      }

      // ── /room-sw.js (Vite public/ passthrough, static) ──────────────────
      if (pathname === "/room-sw.js") {
        applyHeaders(res, pathname);
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
        return res.end(swBytes);
      }

      // ── /r/:slug/manifest.webmanifest ───────────────────────────────────
      const manifestMatch = /^\/r\/([^/]+)\/manifest\.webmanifest$/.exec(pathname);
      if (manifestMatch) {
        // No vercel.json headers[] rule matches this path (only exactly
        // "/r/:slug" does, one segment) -- real deploy carries no CSP/HSTS
        // here either, only what the handler itself sets below.
        const out = Buffer.from(manifestBytes);
        if (defects.corruptManifestByte) out[0] = out[0] ^ 0xff;
        res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300" });
        return res.end(out);
      }

      // ── /r/:slug/og.png and /story.png ──────────────────────────────────
      const cardMatch = /^\/r\/([^/]+)\/(og|story)\.png$/.exec(pathname);
      if (cardMatch) {
        // Same note as the manifest above: no headers[] rule matches this
        // one-segment-deeper path.
        const kind = cardMatch[2];
        const size = cardSizes[kind];
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600, stale-while-revalidate=86400" });
        // Deterministic for a given kind, independent of slug -- the same
        // "a bot must never learn whether a slug exists" collapse the real
        // handler implements, mirrored here as the identical-bytes property
        // the probe's own check depends on.
        return res.end(makePng(size.width, size.height));
      }

      // ── WS-R90: /c/:slug -- the REAL buildCreatorPageHtml's own output ──
      const creatorMatch = /^\/c\/([^/]+)$/.exec(pathname);
      if (creatorMatch) {
        const slug = decodeURIComponent(creatorMatch[1]);
        const data = slug === CREATOR_FIXTURE_SLUG ? CREATOR_FIXTURE_DATA : null;
        let html = buildCreatorPageHtml(data, { origin: `http://127.0.0.1:${port}`, slug });
        if (defects.dropCreatorHreflang) {
          const code = defects.dropCreatorHreflang.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
          html = html.replace(new RegExp(`<link rel="alternate" hreflang="${code}"[^>]*/>\\s*`), "");
        }
        if (defects.corruptCreatorJsonLd) {
          html = html.replace('"@type":"Person"', '"@type":"NotAPerson"');
        }
        // `/c/:slug` already carries a vercel.json headers[] rule (WS-R66) --
        // section 1's own route-class loop probes it with an UNKNOWN slug
        // before this workstream ever runs, so this handler must promise the
        // same headers the generic 404 fallback used to supply by accident.
        applyHeaders(res, "/c/:slug");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(Buffer.from(html));
      }

      // ── WS-R97: /r/:slug/about -- the REAL buildRoomAboutHtml's own
      // output. Matched BEFORE the bare `/r/:slug` regex below, the
      // identical ordering `vercel.json`'s own rewrites array uses.
      const aboutMatch = /^\/r\/([^/]+)\/about$/.exec(pathname);
      if (aboutMatch) {
        const slug = decodeURIComponent(aboutMatch[1]);
        const room = slug === CREATOR_FIXTURE_SLUG ? ROOM_ABOUT_FIXTURE_ROOM : null;
        let html = buildRoomAboutHtml(room, { origin: `http://127.0.0.1:${port}`, slug });
        if (defects.dropAboutHreflang) {
          const code = defects.dropAboutHreflang.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
          html = html.replace(new RegExp(`<link rel="alternate" hreflang="${code}"[^>]*/>\\s*`), "");
        }
        // `/r/:slug/about` already carries a vercel.json headers[] rule
        // (WS-R97) -- `/c/:slug`'s own comment above, restated.
        applyHeaders(res, "/r/:slug/about");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(Buffer.from(html));
      }

      // ── WS-R117: /suites/about -- the REAL buildSuitesAboutHtml's own
      // output. Not slug-scoped and reads no row (`api/_suites-about.js`'s
      // own header), so unlike `/r/:slug/about` above this route needs no
      // fixture row at all -- one match, `lang` from the query string.
      if (pathname === "/suites/about") {
        const lang = url.searchParams.get("lang") || "";
        let html = buildSuitesAboutHtml({ origin: `http://127.0.0.1:${port}`, lang });
        if (defects.dropSuitesAboutHreflang) {
          const code = defects.dropSuitesAboutHreflang.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
          html = html.replace(new RegExp(`<link rel="alternate" hreflang="${code}"[^>]*/>\\s*`), "");
        }
        // `/suites/about` already carries a vercel.json headers[] rule
        // (WS-R117) -- `/r/:slug/about`'s own comment above, restated.
        applyHeaders(res, "/suites/about");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(Buffer.from(html));
      }

      // ── /r/:slug itself: bot unfurl vs. the static person page ──────────
      const roomMatch = /^\/r\/([^/]+)$/.exec(pathname);
      if (roomMatch) {
        const ua = req.headers["user-agent"] || "";
        if (BOT_RE.test(ua)) {
          applyHeaders(res, "/r/:slug");
          const origin = `http://127.0.0.1:${port}`;
          const imageUrl = `${origin}/r/${roomMatch[1]}/og.png`;
          const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
            `<title>${esc(facts.title)}</title>` +
            `<meta name="description" content="${esc(facts.description)}" />` +
            `<meta property="og:title" content="${esc(facts.title)}" />` +
            `<meta property="og:description" content="${esc(facts.description)}" />` +
            `<meta property="og:image" content="${esc(imageUrl)}" />` +
            `<meta property="og:image:width" content="${facts.ogWidth}" />` +
            `<meta property="og:image:height" content="${facts.ogHeight}" /></head><body></body></html>`;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(Buffer.from(html));
        }
        return sendHtmlPage(res, "/r/:slug", "Room");
      }

      // ── the literal route classes vercel.json's headers[] names ─────────
      if (pathname === "/room.html") return sendHtmlPage(res, pathname, "Room");
      if (pathname === "/studio") return sendHtmlPage(res, pathname, "Studio");
      if (pathname === "/studio.html") return sendHtmlPage(res, pathname, "Studio");
      if (pathname === "/") return sendHtmlPage(res, pathname, "Vyakti");
      if (pathname === "/vyakti") return sendHtmlPage(res, pathname, "Vyakti");
      if (pathname === "/suites" || pathname === "/suites.html") return sendHtmlPage(res, pathname, "Vyakti Suites");
      if (pathname === "/creators" || pathname === "/creators.html") return sendHtmlPage(res, pathname, "Rooms directory");

      // ── the remaining static/marketing surfaces ─────────────────────────
      if (pathname === "/sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
        return res.end(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>'));
      }
      if (pathname === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        return res.end(Buffer.from(robotsBytes));
      }
      if (pathname === "/privacy" || pathname === "/delete-account") {
        return sendHtmlPage(res, pathname, "Vyakti");
      }

      applyHeaders(res, pathname);
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e && e.stack ? e.stack : e));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${port}`, stop: () => new Promise((r) => server.close(r)) }));
  });
}
