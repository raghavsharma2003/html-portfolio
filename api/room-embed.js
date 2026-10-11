// GET /room-embed.js               -> the script (vercel.json rewrite)
// GET /room-embed.js?slug=<slug>   -> the Room's public JSON
//
// One route, two shapes, `api/embed.js`'s own split between the HEAD/GET
// script response and nothing else — this file adds the `?slug=` branch
// because the script and the data it fetches share one address on purpose
// (a creator pastes one line; nothing on their page ever names a second
// endpoint). Thin by construction: every decision — the read, the JSON
// shape, the script text — lives in `api/_room-embed.js`, where a fake `db`
// can reach it.
//
// PUBLIC and UNAUTHENTICATED, on purpose: this is metadata about a Room a
// creator already chose to publish, read by a stranger's browser on a page
// this platform does not control. No bearer token to check, no session to
// mint. Rate-limited by IP like every other public read in this repo.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { readRoomEmbed, buildRoomEmbedJson, ROOM_EMBED_JS } from "./_room-embed.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "GET only" });
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";

  if (!slug) {
    // The script itself. Cached hard, `api/embed.js`'s own reasoning: a
    // creator's page should not pay a round trip for this on every view,
    // and the script carries no per-Room data — that lives behind the
    // `?slug=` branch below, cached far shorter, so a creator who renames
    // their Room does not wait an hour for their own site to catch up.
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(ROOM_EMBED_JS);
  }

  if (!allow(ipOf(req), "room_embed", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).json({ error: "slow_down" });
  }

  // `public, max-age=300` — the JSON is the same shape for a real-not-found
  // slug as for one that never existed, so caching it publicly reveals
  // nothing an uncached read would not: nobody can learn whether a slug
  // exists any faster by watching this endpoint be slow versus cached.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const resolved = await readRoomEmbed(q, slug);
    return res.status(200).json(buildRoomEmbedJson(resolved));
  } catch {
    // Never a 500 that differs from "not available" — an error here must
    // read exactly like an unknown slug to anyone but this deployment's own
    // logs, or a stranger's page becomes a way to fingerprint a database
    // hiccup as "this Room does not exist".
    return res.status(200).json({ room: null });
  }
}
