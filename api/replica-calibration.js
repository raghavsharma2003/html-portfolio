// Owner-only typed behavioral calibration API.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { consume } from "./_rate-limit.js";
import {
  approveOwnedCalibration,
  buildOwnedCalibration,
  ownedCalibrationStatus,
  ownedVoiceListeningHistory,
  recordOwnedPreference,
  recordVoiceListeningVerdict,
} from "./_replica-calibration.js";
import { ownedVoiceLikenessSummary } from "./_replica-voice-preview.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

/** WS-R170. `api/room.js`'s `refused` and `api/account.js`'s own copy of
 *  it, same shape, restated here rather than imported (no shared module
 *  owns it). */
async function refused(res, scope, key) {
  const gate = await consume(q, { scope, key });
  if (gate.ok) return false;
  res.setHeader("Retry-After", String(gate.retryAfterSeconds));
  res.status(429).json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
  return true;
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_calibration", 60)) return res.status(429).json({ error: "slow_down" });
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_calibration_user", 120)) return res.status(429).json({ error: "slow_down" });
    if (req.method === "GET") {
      const calibration = await ownedCalibrationStatus(q, user.id, req.query?.replica_id);
      if (!calibration) return res.status(404).json({ error: "replica_not_found" });
      // WS-R155: "sounds like you" rides on the same GET the calibration
      // scenarios already answer -- one owner-authenticated read, not a
      // second door. A voice_likeness of null (no replica row visible under
      // this owner) cannot happen here: ownedCalibrationStatus already
      // proved the replica exists and is owned above.
      const [voiceLikeness, listeningHistory] = await Promise.all([
        ownedVoiceLikenessSummary(q, user.id, req.query?.replica_id),
        ownedVoiceListeningHistory(q, user.id, req.query?.replica_id, 5),
      ]);
      return res.status(200).json({ calibration, voice_likeness: voiceLikeness, listening_history: listeningHistory });
    }
    const body = req.body || {};
    if (body.op === "choose") {
      const preference = await recordOwnedPreference(q, user.id, body);
      return preference ? res.status(201).json({ preference }) : res.status(409).json({ error: "approved_profile_required" });
    }
    if (body.op === "build") {
      const calibration = await buildOwnedCalibration(q, user.id, body.replica_id);
      return calibration ? res.status(201).json({ calibration }) : res.status(404).json({ error: "replica_not_found" });
    }
    if (body.op === "approve") {
      const calibration = await approveOwnedCalibration(q, user.id, body);
      return calibration ? res.status(200).json({ calibration }) : res.status(409).json({ error: "calibration_stale_or_unavailable" });
    }
    if (body.op === "listening_submit") {
      // WS-R170: the persistent second layer, `replica_listening_submit_
      // owner`'s own header in api/_rate-limit.js - survives a cold start
      // the shared `replica_calibration_user` bucket above does not, and is
      // its own tighter ceiling than that door-wide number.
      if (await refused(res, "replica_listening_submit_owner", user.id)) return;
      const verdict = await recordVoiceListeningVerdict(q, user.id, body);
      return res.status(201).json({ verdict });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "calibration_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
