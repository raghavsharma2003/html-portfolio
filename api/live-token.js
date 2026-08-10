// Mints a short-lived, single-use ephemeral token for the Gemini Live API so
// the client can open its realtime WebSocket WITHOUT ever seeing the real
// Google key. The token expires in 30 minutes and admits one session.
import { GOOGLE_KEY } from "./_config.js";
import { allow, ipOf } from "./_ratelimit.js";

// NOT the "-latest" alias: it points at a thinking-heavy preview that takes
// 3-5.5s to first audio. The 09-2025 native-audio preview with thinking
// disabled measures ~890ms — the floor for this API.
export const LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-09-2025";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "livetok", 12)) return res.status(429).json({ error: "slow down" });

  const key = process.env.GOOGLE_API_KEY || GOOGLE_KEY;
  if (!key) return res.status(503).json({ error: "live calls not configured" });

  try {
    const expire = new Date(Date.now() + 30 * 60_000).toISOString();
    const newSession = new Date(Date.now() + 2 * 60_000).toISOString();
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime: expire,
          newSessionExpireTime: newSession,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) {
      return res.status(502).json({ error: "token mint failed" });
    }
    const data = await upstream.json();
    if (!data?.name) return res.status(502).json({ error: "token mint failed" });
    return res.status(200).json({ token: data.name, model: LIVE_MODEL });
  } catch {
    return res.status(500).json({ error: "token failure" });
  }
}
