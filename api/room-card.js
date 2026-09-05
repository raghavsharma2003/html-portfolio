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
// WS-R126 (join from WhatsApp): the ONE env read this door adds, for the
// poster's own `?channel=whatsapp` variant — `_room-card.js` stays pure
// (that file's own `whatsappJoinUrl` paragraph states why), so this thin
// door resolves the link and hands it straight through, `originFromRequest`
// below's own precedent for "compute at the door, pass through as data".
import { whatsappJoinLink } from "./_room-whatsapp-chat.js";

/** `api/room-page.js`'s own `originFromRequest`, restated here — WS-R78's
 *  poster is the first `kind` this door draws that needs one at all (its
 *  QR encodes an absolute URL); `og`/`story` never read it. Every thin
 *  handler in this codebase derives its own origin from the request rather
 *  than sharing a helper across an HTTP module boundary for two lines,
 *  `api/room-page.js`'s own header on why. */
function originFromRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

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
  // WS-R126: the ONE recognised value; anything else is silently treated as
  // "no channel" (`ordinary poster`) rather than a 400 — `kindParam`'s own
  // fail-soft precedent immediately above, restated, since a mistyped or
  // stale `?channel=` should degrade to the honest default picture, never
  // an error page in place of a poster.
  const channelParam = typeof req.query?.channel === "string" ? req.query.channel : "";
  const channel = channelParam === "whatsapp" ? "whatsapp" : "";

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

  const origin = originFromRequest(req);
  // Structurally absent unless every one of `kind==="poster"`, `channel===
  // "whatsapp"` and a real, published row all hold — `whatsappJoinLink`'s own
  // "no half-configured deploy" law folds in here too (an unset business
  // number or a disabled chat lane silently falls back to the ordinary
  // poster, never a broken link).
  const whatsappJoinUrl = kind === "poster" && channel === "whatsapp" && row
    ? whatsappJoinLink(row.slug, process.env)
    : "";
  const etag = roomCardEtag(row, kind, origin, whatsappJoinUrl);
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
    const png = await rasterizeRoomCardForRoom(row, kind, origin, whatsappJoinUrl);
    return res.status(200).send(png);
  } catch (error) {
    console.error("[room-card] render failure:", error?.message || "unknown");
    // A render failure must still answer 200 with SOME picture rather than
    // a broken-image icon on someone else's platform — fall back to the
    // platform-only card the same way an unknown slug does.
    try {
      const fallback = await rasterizeRoomCardForRoom(null, kind, origin);
      return res.status(200).send(fallback);
    } catch {
      return res.status(200).end();
    }
  }
}
