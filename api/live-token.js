// Mints a short-lived, single-use ephemeral token for the Gemini Live API so
// the client can open its realtime WebSocket WITHOUT ever seeing the real
// Google key. The token expires in 30 minutes and admits one session.
import { GOOGLE_KEY } from "./_config.js";
import { withGeminiKey } from "./_gkeys.js";
import { classifyUpstream, QUOTA, TRANSIENT } from "./_lanes.js";
import { allow, ipOf } from "./_ratelimit.js";

// The model IS the latency. Measured end-to-end on real audio — wall clock
// from the last sample of their speech to her first audio chunk arriving, in
// an ESTABLISHED multi-turn session with the full production system
// instruction and VAD config (n per arm in brackets):
//
//   gemini-2.5-flash-native-audio-preview-09-2025   median 2536ms  [n=21]
//   gemini-2.5-flash-native-audio-preview-12-2025   median 3298ms  [n=8]
//   gemini-2.5-flash-native-audio-latest            3-5.5s (thinking-heavy)
//   gemini-3.1-flash-live-preview                   median 1550ms  [n=16]
//
// 3.1-flash-live is also far TIGHTER: its inter-quartile range is ~120ms
// against ~1400ms for 09-2025, which is what "she answers like a person"
// actually depends on — a reply that is sometimes 1.5s and sometimes 5.5s
// reads as broken in a way a steady 1.5s does not.
//
// Verified before pinning it: AUDIO-only modality and it accepts
// `proactivity` (both native-audio traits, so this is NOT a half-cascade
// TTS downgrade), the Aoede voice + hi-IN are genuinely supported (an
// invalid voice name is rejected by the server, so acceptance is real), and
// the ephemeral tokens this endpoint mints are not model-locked — a token
// minted here opens a 3.1 session fine.
//
// Do NOT go back to the "-latest" alias: it points at a thinking-heavy
// preview that takes 3-5.5s to first audio.
export const LIVE_MODEL = "models/gemini-3.1-flash-live-preview";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "livetok", 12)) return res.status(429).json({ error: "slow down" });

  const envKey = process.env.GOOGLE_API_KEY;
  if (!envKey && !GOOGLE_KEY) return res.status(503).json({ error: "live calls not configured" });

  try {
    const expire = new Date(Date.now() + 30 * 60_000).toISOString();
    // The window to START a session. Wide enough that the client can mint the
    // token while they are still in chat and spend it when they tap call —
    // taking the whole round trip off the call-start path, which is where it
    // costs them dead air (telemetry: live losing the pickup race on mobile).
    // Verified: a token minted 3 minutes early still opens a session.
    const newSession = new Date(Date.now() + 9 * 60_000).toISOString();
    // Rotates the free-key pool. A live call is the one surface where a 429
    // is unrecoverable — she simply never picks up — so trying the next key
    // costs one round trip during the ring, where there is slack, rather than
    // failing the call outright.
    const mint = async (key) => await fetch(
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
    // An explicit env key overrides the pool entirely (deployment escape hatch).
    let data = null;
    if (envKey) {
      const r = await mint(envKey);
      if (r.ok) data = await r.json();
    } else {
      // WS-RESILIENCE audit: this call site had api/chat.js's exact folding —
      // `isQuota` alone, everything else "stop, every key rejects it
      // identically". That sentence is true for 400/401/404 and FALSE for 5xx,
      // and here the consequence is that one transient Google 502 during the
      // ring means she never picks up at all. Classification now comes from the
      // one shared classifier; the same-key retry is deliberately NOT taken
      // here — the ring has slack for a rotation, not for a backoff sleep in
      // front of a call connecting.
      const got = await withGeminiKey(async (k) => {
        let r;
        try {
          r = await mint(k);
        } catch {
          return { ok: false, retry: true, error: "network" };
        }
        if (r.ok) return { ok: true, value: await r.json() };
        const cls = classifyUpstream(r.status);
        if (cls === QUOTA) return { ok: false, exhausted: true };
        if (cls === TRANSIENT) return { ok: false, retry: true, error: `mint ${r.status}` };
        return { ok: false, error: `mint ${r.status}` };
      });
      data = got.value ?? null;
    }
    if (!data?.name) return res.status(502).json({ error: "token mint failed" });
    return res.status(200).json({ token: data.name, model: LIVE_MODEL });
  } catch {
    return res.status(500).json({ error: "token failure" });
  }
}
