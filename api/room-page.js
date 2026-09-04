// GET /api/room-page?slug=<slug> — the crawler-only unfurl for /r/<slug>
// (WS-R40, migration 102). vercel.json routes a request here ONLY when its
// `user-agent` matches a named unfurl-bot pattern; every other visitor still
// gets the existing static `/room.html` rewrite, unchanged.
//
// Thin by construction, `api/room-embed.js`'s own shape one file over: every
// decision — the read, the predicate, the HTML — lives in
// `api/_room-page.js`, where a fake `db` can reach it.
//
// PUBLIC and UNAUTHENTICATED: this is metadata about a Room its creator
// already chose to publish, read by a bot on someone else's platform. No
// bearer token, no session, no cookie.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { resolveRoomPage, buildRoomPageHtml } from "./_room-page.js";

/** `api/sitemap.js`'s own `originFromRequest`, restated here — each thin
 *  handler in this codebase derives its own origin from the request rather
 *  than sharing a helper across an HTTP module boundary for two lines. */
function originFromRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).send("GET only");
  }
  if (!allow(ipOf(req), "room_page", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";
  const origin = originFromRequest(req);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Public and cached: the response is the same shape for an unpublished
  // slug as for one that never existed, so caching it publicly reveals
  // nothing an uncached read would not — a bot can never learn whether a
  // slug exists any faster by watching this endpoint be slow versus cached.
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const row = await resolveRoomPage(q, slug);
    // Unpublished or unknown: the SAME platform-only card, status 200 —
    // `api/_room-embed.js`'s own law, a crawler never learns whether a
    // slug exists.
    return res.status(200).send(buildRoomPageHtml(row, { origin, slug }));
  } catch (error) {
    console.error("[room-page] failure:", error?.message || "unknown");
    // Never a shape that differs from "not available" — `api/room-embed.js`'s
    // own posture, restated: an error here must read exactly like an
    // unknown slug to anyone but this deployment's own logs.
    return res.status(200).send(buildRoomPageHtml(null, { origin, slug }));
  }
}
