// GET /api/room-about?slug=<slug>[&lang=hi] — the follower's transparency
// page at /r/<slug>/about (WS-R97). vercel.json rewrites EVERY request to
// `/r/:slug/about` here, no user-agent condition — like `/c/:slug`
// (api/creator-page.js's own header), this page has no client app underneath
// it to hand off to; this handler IS the page.
//
// Thin by construction, `api/creator-page.js`'s own shape: every decision —
// the read, the predicate, the HTML — lives in `api/_room-about.js`, where a
// fake `db` can reach it.
//
// PUBLIC and UNAUTHENTICATED: a follower reads this before deciding whether
// to join, or after joining, without ever proving who they are. No bearer
// token, no session, no cookie, and no follower's own data is ever read
// here — `api/_room-about.js`'s own header.
import { q } from "./_db.js";
import { withDoor } from "./_incidents.js";
import { allow, ipOf } from "./_ratelimit.js";
import { publicRoomAboutBySlug, buildRoomAboutHtml } from "./_room-about.js";

/** `api/creator-page.js`'s own `originFromRequest`, restated — each thin
 *  handler in this codebase derives its own origin from the request rather
 *  than sharing a helper across an HTTP module boundary for two lines. */
function originFromRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).send("GET only");
  }
  if (!allow(ipOf(req), "room_about", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";
  const lang = typeof req.query?.lang === "string" ? req.query.lang : "";
  const origin = originFromRequest(req);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Public and cached: the response is the same shape for a paused or
  // unpublished Room as for a slug that never existed, so caching it
  // publicly reveals nothing an uncached read would not —
  // `api/creator-page.js`'s own reasoning, restated a second time.
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const room = await publicRoomAboutBySlug(q, slug);
    // Unpublished, paused, or unknown: the SAME platform-only card, status
    // 200 — `api/_room-page.js`'s law, a fourth surface over: nobody may
    // learn whether a slug exists from this page's shape.
    return res.status(200).send(buildRoomAboutHtml(room, { origin, slug, lang }));
  } catch (error) {
    console.error("[room-about] failure:", error?.message || "unknown");
    return res.status(200).send(buildRoomAboutHtml(null, { origin, slug, lang }));
  }
}

export default withDoor(q, "room-about.js", handler);
