// Protected replica cascade speech. No real provider/protection adapter means
// a deliberate 503; this endpoint never falls back to Meera or device TTS.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { createVoiceProvider } from "./_voice/registry.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { createReplicaSpeechHandler } from "./_replica-speech.js";

const serve = createReplicaSpeechHandler({
  db: q,
  requireUser,
  resolveVoiceProvider: async (profile) => createVoiceProvider(profile.provider, { db: q }),
  resolveProtectionAdapters: async () => createProductionProtectionAdapters(),
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_speech", 40)) return res.status(429).json({ error: "slow_down" });
  try {
    return await serve(req, res);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    return res.status(500).json({ error: "replica_speech_failed" });
  }
}

export const config = { supportsResponseStreaming: true };
