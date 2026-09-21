// GET /r/<slug>/manifest.webmanifest (WS-R59) — `vercel.json`'s rewrite for
// this path. `api/room-page.js`'s own shape, one file over: every decision
// lives in `api/_room-manifest.js`, this file only turns a request into a
// call and a response.
//
// PUBLIC and UNAUTHENTICATED, `api/room-page.js`'s own posture restated: an
// installer reads a manifest before ever signing in, and the response is
// identical for a paused Room and an unknown slug — see `_room-manifest.js`'s
// own header.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  resolveRoomManifest,
  buildRoomManifestJson,
  PLATFORM_ROOM_MANIFEST_JSON,
} from "./_room-manifest.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).send("GET only");
  }
  if (!allow(ipOf(req), "room_manifest", 120)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(429).send("slow down");
  }

  const slug = typeof req.query?.slug === "string" ? req.query.slug : "";

  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  // Public and cached, same shape whichever of unpublished/paused/unknown a
  // slug is — `api/room-page.js`'s own posture: caching this publicly
  // reveals nothing an uncached read would not.
  res.setHeader("Cache-Control", "public, max-age=300");
  if (req.method === "HEAD") return res.status(200).end();

  try {
    const row = await resolveRoomManifest(q, slug);
    return res.status(200).send(buildRoomManifestJson(row, { slug }));
  } catch (error) {
    console.error("[room-manifest] failure:", error?.message || "unknown");
    // Never a shape that differs from "not available" — `api/room-page.js`'s
    // own law, restated: a failure here must read exactly like an unknown
    // slug to anyone but this deployment's own logs.
    return res.status(200).send(PLATFORM_ROOM_MANIFEST_JSON);
  }
}
