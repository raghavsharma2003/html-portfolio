// GET /api/creator-page?slug=<slug>[&lang=hi] — the creator's own public page
// at /c/<slug> (WS-R66, migration 115). vercel.json rewrites EVERY request
// to `/c/:slug` here, person and crawler alike — unlike `/r/:slug`'s
// bot-only unfurl, there is no client app underneath this page to hand off
// to; this handler IS the page.
//
// Thin by construction, `api/room-page.js`'s own shape one surface over:
// every decision — the read, the predicate, the HTML, the JSON-LD — lives in
// `api/_creator-page.js`, where a fake `db` can reach it.
//
// PUBLIC and UNAUTHENTICATED: this is material its creator already chose to
// publish AND list, read by anyone (or anyone's crawler). No bearer token,
// no session, no cookie.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { resolveCreatorPage, buildCreatorPageHtml } from "./_creator-page.js";

/** `api/room-page.js`'s own `originFromRequest`, restated here — each thin
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
  if (!allow(ipOf(req), "creator_page", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";
  const lang = typeof req.query?.lang === "string" ? req.query.lang : "";
  const origin = originFromRequest(req);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Public and cached: the response is the same shape for an unlisted slug as
  // for one that never existed, so caching it publicly reveals nothing an
  // uncached read would not — `api/room-page.js`'s own reasoning, restated.
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const data = await resolveCreatorPage(q, slug);
    // Unlisted, unpublished, paused, or unknown: the SAME platform-only
    // card, status 200 — `api/_room-page.js`'s law, a third surface over:
    // nobody may learn whether a slug exists from this page's shape.
    return res.status(200).send(buildCreatorPageHtml(data, { origin, slug, lang }));
  } catch (error) {
    console.error("[creator-page] failure:", error?.message || "unknown");
    return res.status(200).send(buildCreatorPageHtml(null, { origin, slug, lang }));
  }
}
