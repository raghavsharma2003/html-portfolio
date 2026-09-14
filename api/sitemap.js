// api/sitemap.js — GET /sitemap.xml (vercel.json rewrite), the crawler
// feed's one door (WS-R45). Thin by construction, `api/creators.js`'s own
// shape: cors is unnecessary (a crawler is not a browser origin, and no
// script on this platform ever fetches its own sitemap), rate limit,
// dispatch, error shape. Every decision lives in `api/_sitemap.js`, where a
// fake `db` can reach it.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { buildSitemapXml } from "./_sitemap.js";

function originFromRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("GET only");
  if (!allow(ipOf(req), "sitemap", 60)) return res.status(429).send("slow down");

  try {
    const origin = originFromRequest(req);
    if (!origin) return res.status(503).send("origin unavailable");
    const xml = await buildSitemapXml(q, { origin });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    // Same five minutes as the directory page this feed mirrors.
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(xml);
  } catch (error) {
    console.error("[sitemap] failure:", error?.message || "unknown");
    return res.status(500).send("sitemap unavailable");
  }
}
