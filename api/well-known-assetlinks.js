// api/well-known-assetlinks.js — GET /.well-known/assetlinks.json
// (vercel.json rewrite). Thin by construction, `api/sitemap.js`'s own
// shape: no cors (Android's own app-links verifier fetches this, not
// browser JS; no script on this platform ever fetches its own asset
// links), method guard, dispatch, error shape. Every decision lives in
// api/_well-known-assetlinks.js, where a fake `env` can reach it.
import { buildAssetLinksDocument } from "./_well-known-assetlinks.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("GET only");

  try {
    const doc = buildAssetLinksDocument(process.env);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // Cached but short: this is re-fetched by Android's verifier at
    // install/update time, never on a hot request path, so an hour is
    // plenty of relief without leaving a stale fingerprint statement live
    // for long after a real key rotation.
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(JSON.stringify(doc));
  } catch (error) {
    console.error("[well-known-assetlinks] failure:", error?.message || "unknown");
    // Even on an unexpected failure, answer with the same honest-empty
    // shape rather than a 500 page — Android's verifier expects a JSON
    // array at this exact path, not an HTML error body it cannot parse.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send("[]");
  }
}
