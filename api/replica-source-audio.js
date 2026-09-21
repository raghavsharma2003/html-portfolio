// GET /api/replica-source-audio?replica_id=...
//
// Streams back the owner's own CURRENT primary voice recording -- the
// listening test's reference player (src/studio/ListeningTest.tsx) hits
// this once per test, alongside WS-R163's own
// GET /api/replica-generation-audio for each candidate. A thin adapter:
// every decision (ownership, ready state, the storage read) lives in
// api/_replica-source-audio.js.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { withDoor } from "./_incidents.js";
import { ownedPrimaryVoiceReferenceAudio } from "./_replica-source-audio.js";

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
  if (!allow(ipOf(req), "replica_source_audio", 30)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_source_audio_user", 60)) return res.status(429).json({ error: "slow_down" });
    const audio = await ownedPrimaryVoiceReferenceAudio(q, user.id, req.query?.replica_id);
    res.setHeader("Content-Type", audio.mime);
    res.setHeader("Content-Length", String(audio.body.length));
    return res.status(200).send(audio.body);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "replica_source_audio_failure" : String(error.code || error.message) });
  }
}

export default withDoor(q, "replica-source-audio.js", handler);
