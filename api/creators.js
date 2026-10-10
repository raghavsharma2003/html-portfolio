// api/creators.js — GET /api/creators, the public creator directory's one
// door (WS-R45). Thin by construction, `api/room-publish.js`'s own shape:
// cors, rate limit, dispatch, error shape. Every decision lives in
// `api/_creators.js`, where a fake `db` can reach it.
//
// PUBLIC and UNAUTHENTICATED, on purpose: this is the page a stranger reads
// before they are anyone's follower, so there is no `requireUser` here to
// require in the first place — `api/culture.js`'s own shape, one surface
// over. Rate-limited by IP only, `api/culture.js`'s own number, because
// there is no signed-in user to key a second bucket off.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { readCreatorsPage } from "./_creators.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "creators", 60)) return res.status(429).json({ error: "slow_down" });

  try {
    const { creators, next_cursor } = await readCreatorsPage(q, {
      cursor: req.query?.cursor,
      limit: req.query?.limit,
    });
    // Five minutes: this page changes only when a creator lists, unlists, or
    // publishes, none of which a stranger reading the directory needs to see
    // within seconds of happening — `api/culture.js`'s own reasoning, one
    // surface over, at the brief's own number.
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ creators, next_cursor });
  } catch (error) {
    console.error("[creators] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "creators_failure" });
  }
}
