// The scheduled decider for voice identity challenges (WS-R2).
//
// maxDuration is 300 because the first tick after a scale-to-zero pays for
// the voice-evidence wake: measured 176 s to ready from zero
// (measurements.md#first-real-clone), plus about 5 s for a ten-second clip on
// a warm replica. That fits, and if it ever does not, the adapter raises a
// retryable error and the challenge returns to the queue for the tick five
// minutes later, which finds a service this tick already warmed. Nothing here
// widens the evidence service's 60 s anti-replay window to make a cold start
// fit inside it — see rejected.md#hmac-skew-shorter-than-cold-start for why
// that is the wrong fix and what the right one is.
//
// maxJobs is 1 for the same reason: two cold clips in one invocation would
// serialise two wakes into one function budget.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { runVoiceChallengeSweep, voiceIdentityChallengeEnabled } from "./_replica-voice-identity.js";
import { configuredVoiceChallengeVerifier } from "./_voice-identity/verifier.js";
import { withSweepRun } from "./_sweep-run.js";

export const config = { maxDuration: 300 };

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    // WS-R21: the ops board's heartbeat (migration 084) - wraps the disabled
    // short-circuit too, so a feature-flagged-off sweep shows as "ran,
    // disabled" rather than looking indistinguishable from "never ran".
    const summary = await withSweepRun(q, "replica-voice-identity", async () => {
      if (!voiceIdentityChallengeEnabled()) return { disabled: true };
      const verifier = configuredVoiceChallengeVerifier();
      if (!verifier) return { disabled: true };
      return runVoiceChallengeSweep({ db: q, verifier, maxJobs: 1 });
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "voice_identity_sweep_failed" : error.code || error.message });
  }
}
