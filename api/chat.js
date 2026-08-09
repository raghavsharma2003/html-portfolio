// Meera brain proxy — keeps the OpenRouter key server-side so the app and
// public repo never contain it. POST { system, messages, model? } → reply text.

import { allow, ipOf } from "./_ratelimit.js";

import { OPENROUTER_KEY } from "./_config.js";

const DEFAULT_MODEL = "google/gemini-3.6-flash";
const ALLOWED_MODEL = /^[a-z0-9-]+\/[a-z0-9.:-]+$/i;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "chat", 30)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  try {
    const { system, messages, model, max_tokens } = req.body || {};
    if (!system || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "system + messages required" });
    }
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Meera",
      },
      body: JSON.stringify({
        model: typeof model === "string" && ALLOWED_MODEL.test(model) ? model : DEFAULT_MODEL,
        messages: [{ role: "system", content: String(system).slice(0, 20000) }, ...messages.slice(-40)],
        max_tokens: Number.isFinite(max_tokens) ? Math.min(800, Math.max(50, max_tokens)) : 800,
      }),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: "upstream " + upstream.status });
    }
    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "proxy failure" });
  }
}
