// GET /api/room-card?slug=<slug>&kind=og|story — the Room's picture
// (WS-R55). `vercel.json` rewrites `/r/:slug/og.png` and
// `/r/:slug/story.png` here, BELOW WS-R40's bot rewrite for `/r/:slug`
// itself (that one still only fires for a named crawler user-agent; this
// one is a distinct path suffix and fires for anyone — the picture is
// public the same way the unfurl HTML it decorates is).
//
// Thin by construction, `api/room-page.js`'s own shape one file over: every
// decision — the read, the layout, the pixels — lives in
// `api/_room-card.js`, where a fake `db` can reach it.
//
// PUBLIC and UNAUTHENTICATED, on purpose: this is the SAME public row
// `api/room-page.js` already serves to any crawler, drawn as a picture
// instead of typeset as `<head>` tags — `publicRoomBySlug`'s own four
// columns, nothing a follower ever said, nothing a follower ever will.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { resolveRoomPage } from "./_room-page.js";
import { ROOM_CARD_KINDS, rasterizeRoomCardForRoom, roomCardEtag } from "./_room-card.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).send("GET only");
  }
  if (!allow(ipOf(req), "room_card", 60)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";
  const kindParam = typeof req.query?.kind === "string" ? req.query.kind : "";
  const kind = ROOM_CARD_KINDS.includes(kindParam) ? kindParam : "og";

  let row = null;
  try {
    row = await resolveRoomPage(q, slug);
  } catch (error) {
    // Never a shape that differs from "not available" — `api/room-page.js`'s
    // own posture, restated: an error here must read exactly like an
    // unknown slug to anyone but this deployment's own logs, or a
    // stranger's request becomes a way to fingerprint a database failure.
    console.error("[room-card] failure:", error?.message || "unknown");
    row = null;
  }

  const etag = roomCardEtag(row, kind);
  res.setHeader("Content-Type", "image/png");
  // `public, max-age=3600, stale-while-revalidate=86400` per this
  // workstream's brief (law 4) — an unpublished/unknown slug renders the
  // SAME platform card as a real one hashes differently from, so caching it
  // publicly reveals nothing an uncached read would not (the identical
  // "a picture must never learn whether a slug exists" reasoning
  // `api/room-page.js` states for its own Cache-Control).
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const png = await rasterizeRoomCardForRoom(row, kind);
    return res.status(200).send(png);
  } catch (error) {
    console.error("[room-card] render failure:", error?.message || "unknown");
    // A render failure must still answer 200 with SOME picture rather than
    // a broken-image icon on someone else's platform — fall back to the
    // platform-only card the same way an unknown slug does.
    try {
      const fallback = await rasterizeRoomCardForRoom(null, kind);
      return res.status(200).send(fallback);
    } catch {
      return res.status(200).end();
    }
  }
}
