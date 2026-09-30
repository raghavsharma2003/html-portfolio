// GET /api/replica-generation-audio?replica_id=...&generation_id=...
//
// Streams back one SEALED voice-preview generation's own bytes to its
// owner — the listening test's players (src/studio/ListeningTest.tsx) hit
// this once per candidate/reference clip. A thin adapter: every decision
// (ownership, sealed state, the storage read) lives in
// api/_replica-generation-audio.js.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { withDoor } from "./_incidents.js";
import { ownedSealedGenerationAudio } from "./_replica-generation-audio.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  res.setHeader("Cache-Control", "no-store");
}

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "replica_generation_audio", 30)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_generation_audio_user", 60)) return res.status(429).json({ error: "slow_down" });
    const audio = await ownedSealedGenerationAudio(q, user.id, req.query?.replica_id, req.query?.generation_id);
    res.setHeader("Content-Type", audio.mime);
    res.setHeader("Content-Length", String(audio.body.length));
    return res.status(200).send(audio.body);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_generation_audio_failure" : String(error.code || error.message) });
  }
}

export default withDoor(q, "replica-generation-audio.js", handler);
