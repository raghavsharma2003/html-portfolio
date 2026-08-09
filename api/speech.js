// Meera voice proxy — Gemini expressive TTS via OpenRouter, key held
// server-side. POST { text, voice? } → audio/wav bytes.
// Gemini TTS returns raw PCM (24kHz, 16-bit, mono); we add the WAV header
// here so every browser can play it directly.

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
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  try {
    const { text, voice } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text required" });
    }
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
          input: text.slice(0, 1200),
          voice: ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE,
          response_format: "pcm",
        }),
      });
      if (!upstream.ok) return null;
      return Buffer.from(await upstream.arrayBuffer());
    };
    // upstream occasionally returns an empty 200 — one retry covers it
    let pcm = await generate();
    if (!pcm || pcm.length < 1000) pcm = await generate();
    if (!pcm || pcm.length < 1000) {
      return res.status(502).json({ error: "upstream empty" });
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.concat([wavHeader(pcm.length), pcm]));
  } catch (e) {
    return res.status(500).json({ error: "speech failure" });
  }
}
