// Meera voice proxy — Gemini expressive TTS via OpenRouter, key held
// server-side. POST { text, voice? } → audio/wav bytes.
// Gemini TTS returns raw PCM (24kHz, 16-bit, mono); we add the WAV header
// here so every browser can play it directly.

import { allow, ipOf } from "./_ratelimit.js";
import { withGeminiKey, isQuota, poolSize } from "./_gkeys.js";

import { OPENROUTER_KEY } from "./_config.js";

const MODEL = "google/gemini-3.1-flash-tts-preview";
const DEFAULT_VOICE = "Leda"; // young-sounding female
const ALLOWED_VOICES = new Set(["Leda", "Kore", "Aoede", "Zephyr"]);
const SAMPLE_RATE = 24000;

function wavHeader(pcmBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcmBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(pcmBytes, 40);
  return h;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // the native app is cross-origin: without this it pays a preflight RTT on
  // EVERY speech request — pure added latency on the hottest path
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "speech", 60)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  try {
    const { text, voice, style } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text required" });
    }
    // per-utterance delivery mood, improvised by her brain from the actual
    // conversation ("low and comforting", "teasing, mock-offended", …)
    const mood =
      typeof style === "string" && style.trim()
        ? style.replace(/[\[\]{}<>\n\r"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
        : "relaxed, natural, casual";
    // FREE TIER FIRST, and this lane needs it more than the others: if the paid
    // account is empty she has NO VOICE AT ALL, which is what happened once
    // today. Google's own TTS returns L16 PCM at 24kHz — the exact format this
    // proxy already wraps in a WAV header — so it is a drop-in, not a second
    // audio path to keep in sync.
    const geminiTts = async () => {
      if (!poolSize()) return null;
      const got = await withGeminiKey(async (k) => {
        const r = await fetch(
          // 3.1, not 2.5 — the same model the paid lane below already uses, so
          // this is not a different voice. I introduced 2.5 here when adding
          // the free lane, purely because it was the model I had probed, and
          // it cannot stream: it answers a streaming request with HTTP 200 and
          // ONE frame containing the whole file, so streaming looks unsupported
          // at the API level when it is unsupported at the MODEL level.
          // Measured on the same text: 2053ms p50 / 4177ms p90 / 20180ms worst
          // against 3.1's 579ms p50 / 722ms p90 / 722ms worst once streamed.
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
          {
            method: "POST",
            headers: { "x-goog-api-key": k, "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Say in a warm, natural Indian-accented Hinglish, ${mood}: ${text.slice(0, 1100)}` }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                // Her voice, not a hardcoded one. This lane ignored the `voice`
                // parameter it validates three lines below and always sent
                // "Kore", while the paid lane sends Leda — so which voice she
                // had depended on which key had quota, and could FLIP BETWEEN
                // PHRASES of the same sentence. Leda is what she has always
                // sounded like; Kore was introduced by accident today.
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE },
                  },
                },
              },
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!r.ok) return isQuota(r.status) ? { ok: false, exhausted: true } : { ok: false, error: `tts ${r.status}` };
        const j = await r.json();
        const b64 = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        // a 200 with no audio is the silent failure again — treat it as a spent
        // key so the next one, and then the paid lane, still get their turn
        if (!b64) return { ok: false, exhausted: true };
        return { ok: true, value: Buffer.from(b64, "base64") };
      });
      return got.value ?? null;
    };

    const generate = async () => {
      const upstream = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Meera",
        },
        body: JSON.stringify({
          model: MODEL,
          // Gemini TTS takes natural-language delivery direction in the input.
          // Kept SHORT — direction length adds real latency (~0.6s measured
          // between a full paragraph and none). Identity constant; the mood
          // comes from the conversation so delivery follows the call's flow.
          input: `Warm 24-year-old Mumbai woman on a casual phone call with a close friend: natural Indian accent, easy Hinglish, real pacing, never performative, no laughs unless the words are laughter. Mood: ${mood}. Say: ${text.slice(0, 1100)}`,
          voice: ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE,
          response_format: "pcm",
        }),
      });
      if (!upstream.ok) return null;
      return Buffer.from(await upstream.arrayBuffer());
    };
    // upstream occasionally returns an empty 200. A serial retry doubled
    // worst-case latency on the path the user waits on in silence — instead,
    // if the primary is slow a second request races it after 1200ms and the
    // first non-empty result wins.
    // Free first. If the pool yields audio we are done — no paid call, and no
    // dependence on the paid account having money in it.
    const freePcm = await geminiTts().catch(() => null);
    const pcm = freePcm && freePcm.length >= 1000 ? freePcm : await new Promise((resolve) => {
      let settled = false;
      let pending = 0;
      let hedged = false;
      const settle = (buf) => {
        if (settled) return;
        pending--;
        if (buf && buf.length >= 1000) {
          settled = true;
          clearTimeout(hedgeT);
          resolve(buf);
        } else if (!hedged) {
          launchHedge(); // fast empty/fail — retry immediately
        } else if (pending <= 0) {
          settled = true;
          resolve(null);
        }
      };
      const launchHedge = () => {
        if (settled || hedged) return;
        hedged = true;
        pending++;
        generate().then(settle, () => settle(null));
      };
      pending++;
      generate().then(settle, () => settle(null));
      // synthesis time scales with text length — a flat trigger would fire
      // the hedge on every long voice note (pure double cost, no win)
      const hedgeT = setTimeout(launchHedge, Math.min(4000, 900 + text.length * 15));
    });
    if (!pcm) {
      return res.status(502).json({ error: "upstream empty" });
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.concat([wavHeader(pcm.length), pcm]));
  } catch (e) {
    return res.status(500).json({ error: "speech failure" });
  }
}
