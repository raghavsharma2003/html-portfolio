// GET /api/suites-about[?lang=hi] — the Suite admin's transparency page at
// /suites/about (WS-R117). vercel.json rewrites `/suites/about` here.
//
// Thin by construction, `api/room-about.js`'s own shape: every decision —
// the copy, the numbers, the HTML — lives in `api/_suites-about.js`, a pure
// function with no `db` argument at all (this page is not slug-scoped and
// reads no row).
//
// PUBLIC and UNAUTHENTICATED: an institute's admin reads this before
// attaching a Room, or a signed-in Suite admin reads it from the Suite
// board. No bearer token, no session, no cookie, no follower table touched.
import { allow, ipOf } from "./_ratelimit.js";
import { buildSuitesAboutHtml } from "./_suites-about.js";

/** `api/room-about.js`'s own `originFromRequest`, restated — each thin
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
  if (!allow(ipOf(req), "suites_about", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const lang = typeof req.query?.lang === "string" ? req.query.lang : "";
  const origin = originFromRequest(req);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Public and cached: the page is identical for every visitor at a given
  // locale, no per-Suite or per-follower data of any kind — `api/room-about.js`'s
  // own reasoning, restated a second time.
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    return res.status(200).send(buildSuitesAboutHtml({ origin, lang }));
  } catch (error) {
    console.error("[suites-about] failure:", error?.message || "unknown");
    return res.status(200).send(buildSuitesAboutHtml({ origin, lang: "" }));
  }
}
