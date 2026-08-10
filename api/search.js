// Live web lookup for her brain — used ONLY when she decides a fresh fact
// would make the reply better ([search: …] protocol). One fast pass through
// OpenRouter's web plugin; returns compact facts, never raw pages.
import { allow, ipOf } from "./_ratelimit.js";
import { OPENROUTER_KEY } from "./_config.js";

const KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "search", 15)) return res.status(429).json({ error: "slow down" });
  if (!KEY) return res.status(500).json({ error: "no key configured" });

  try {
    const q = String(req.body?.q || "").slice(0, 200).trim();
    if (!q) return res.status(400).json({ error: "q required" });
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Meera",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        plugins: [{ id: "web", max_results: 4 }],
        max_tokens: 350,
        reasoning: { effort: "minimal" },
        messages: [
          {
            role: "system",
            content:
              "You are a fast lookup tool. Answer the query with current, dated facts in 2-5 short lines — numbers, names, dates. Today's context matters (scores, releases, news, prices, weather). No preamble, no disclaimers, no links.",
          },
          { role: "user", content: q },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) return res.status(502).json({ error: "search failed" });
    const data = await upstream.json();
    const facts = data?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ facts: String(facts).slice(0, 1500) });
  } catch {
    return res.status(500).json({ error: "search failure" });
  }
}
