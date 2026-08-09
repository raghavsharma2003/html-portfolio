// Meme GIF search — extracts direct CDN gif URLs from Tenor's public search
// pages (no API key exists for this app; the discontinued public keys are
// dead). POST { q } → { url }. Small in-memory cache per warm lambda.

import { allow, ipOf } from "./_ratelimit.js";

const cache = new Map();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "gif", 30)) return res.status(429).json({ error: "slow down" });

  try {
    const q = String(req.body?.q || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
      .slice(0, 60);
    if (!q) return res.status(400).json({ error: "q required" });

    let urls = cache.get(q);
    if (!urls) {
      const slug = q.replace(/\s+/g, "-");
      const page = await fetch(`https://tenor.com/search/${slug}-gifs`, {
        headers: { "User-Agent": UA, "Accept-Language": "en" },
      });
      if (!page.ok) return res.status(502).json({ error: "search failed" });
      const html = await page.text();
      // AAAAC = medium-size gif rendition; slugs describe the meme
      urls = [
        ...new Set(html.match(/https:\/\/media[0-9]*\.tenor\.com\/m\/[A-Za-z0-9_-]+AAAAC\/[^"']+\.gif/g) || []),
      ].slice(0, 10);
      if (urls.length) cache.set(q, urls);
    }
    if (!urls || !urls.length) return res.status(404).json({ error: "no gifs" });
    const url = urls[Math.floor(Math.random() * Math.min(6, urls.length))];
    return res.status(200).json({ url });
  } catch {
    return res.status(500).json({ error: "gif failure" });
  }
}
