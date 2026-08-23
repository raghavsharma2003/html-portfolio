// Owner-only typed behavioral calibration API.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  approveOwnedCalibration,
  buildOwnedCalibration,
  ownedCalibrationStatus,
  recordOwnedPreference,
} from "./_replica-calibration.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
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
      return calibration ? res.status(200).json({ calibration }) : res.status(404).json({ error: "replica_not_found" });
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
