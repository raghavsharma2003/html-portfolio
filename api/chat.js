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
  // the native app is cross-origin: cache the preflight so every call turn
  // doesn't pay an extra RTT before the request even starts
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "chat", 40)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  try {
    const { system, system_tail, messages, model, max_tokens, stream, no_think } = req.body || {};
    if (!system || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "system + messages required" });
    }
    // Prompt caching: the client sends the byte-stable persona core as
    // `system` and the per-turn volatile part as `system_tail`. A
    // cache_control breakpoint after the core makes Google serve it from
    // cache — measured ~85% input-cost reduction (5473/5477 tokens cached,
    // $0.0085 → ~$0.0012 per call in testing).
    const systemContent = [
      {
        type: "text",
        text: String(system).slice(0, 20000),
        cache_control: { type: "ephemeral" },
      },
    ];
    if (typeof system_tail === "string" && system_tail) {
      systemContent.push({ type: "text", text: system_tail.slice(0, 8000) });
    }
    // payload cap: recent user photos legitimately ride as data URLs when a
    // storage upload failed, but the total request must stay bounded —
    // vision-model cost per call is real money
    if (JSON.stringify(messages).length > 3_000_000) {
      return res.status(413).json({ error: "payload too large" });
    }
    const wantStream = stream === true;
    // a stalled upstream (or vanished client) must never hold the function
    // open until the platform kills it
    const aborter = new AbortController();
    const kill = setTimeout(() => aborter.abort(), wantStream ? 120_000 : 60_000);
    req.on?.("close", () => aborter.abort());
    let upstream;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Meera",
        },
        body: JSON.stringify({
          model: typeof model === "string" && ALLOWED_MODEL.test(model) ? model : DEFAULT_MODEL,
          // safety ceiling only — the client decides the real window. It used
          // to be 40, which silently clipped the context the client had
          // deliberately sent and made her contradict her own earlier turns.
          messages: [{ role: "system", content: systemContent }, ...messages.slice(-120)],
          max_tokens: Number.isFinite(max_tokens) ? Math.min(800, Math.max(50, max_tokens)) : 800,
          ...(wantStream ? { stream: true } : {}),
          // Bounded hidden thinking. Default (unbounded) reasoning grows with
          // context, eats the max_tokens budget, and truncates/leaks — but the
          // "minimal" floor costs conversational coherence (non-sequiturs,
          // context-free media sends). So: calls (no_think, latency-critical)
          // stay at the floor; chat gets one notch of planning ("low"), still
          // bounded far below the 700-token reply budget.
          reasoning: { effort: no_think === true ? "minimal" : "low" },
        }),
        signal: aborter.signal,
      });
    } catch {
      clearTimeout(kill);
      return res.status(504).json({ error: "upstream timeout" });
    }
    if (!upstream.ok) {
      clearTimeout(kill);
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
      } finally {
        clearTimeout(kill);
        reader.cancel().catch(() => {}); // stop upstream generation billing
      }
      return res.end();
    }
    const data = await upstream.json();
    clearTimeout(kill);
    const text = data?.choices?.[0]?.message?.content ?? "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "proxy failure" });
  }
}
