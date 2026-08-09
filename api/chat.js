// Meera brain proxy — keeps the OpenRouter key server-side so the app and
// public repo never contain it. POST { system, messages, model? } → reply text.

import { allow, ipOf } from "./_ratelimit.js";

import { OPENROUTER_KEY } from "./_config.js";

const DEFAULT_MODEL = "google/gemini-3.6-flash";
const ALLOWED_MODEL = /^[a-z0-9-]+\/[a-z0-9.:-]+$/i;

// voice calls stream tokens so she can start speaking on the first sentence
export const config = { supportsResponseStreaming: true };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "chat", 40)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  try {
    const { system, messages, model, max_tokens, stream } = req.body || {};
    if (!system || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "system + messages required" });
    }
    const wantStream = stream === true;
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
        ...(wantStream ? { stream: true } : {}),
        // Minimal hidden thinking, always. Gemini's default reasoning grows
        // with context length, eats the max_tokens budget, and the reply
        // comes out truncated or as leaked planning scaffolding ("Bubble 1:")
        // — the "she types random stuff in long chats" bug. It also delays a
        // call's first token by ~1s. (reasoning cannot be fully disabled on
        // this endpoint; "minimal" is the floor and keeps replies intact.)
        reasoning: { effort: "minimal" },
      }),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: "upstream " + upstream.status });
    }
    if (wantStream) {
      // pipe OpenRouter's SSE straight through — the client parses deltas
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } catch {
        /* client or upstream dropped — end what we have */
      }
      return res.end();
    }
    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "proxy failure" });
  }
}
