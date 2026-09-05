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

const BOT_RE = /.*(facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Googlebot).*/;

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
