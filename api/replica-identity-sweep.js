import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { configuredIdentityVerifier } from "./_identity/registry.js";
import { expireIdentityEvidence, runIdentityVerificationSweep } from "./_replica-identity.js";

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
    const verifier = configuredIdentityVerifier();
    const expired = await expireIdentityEvidence(q);
    if (!verifier) return res.status(200).json({ ok: true, disabled: true, expired });
    const summary = await runIdentityVerificationSweep({ db: q, verifier, maxJobs: 2, expire: async () => 0 });
    return res.status(200).json({ ok: true, ...summary, expired });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "identity_sweep_failed" : error.code || error.message });
  }
}
