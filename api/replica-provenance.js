import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { createReplicaProvenanceHandler } from "./_replica-provenance.js";

const serve = createReplicaProvenanceHandler({ db: q });

function headers(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

export default async function handler(req, res) {
  headers(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!allow(ipOf(req), "replica_provenance", 120)) return res.status(429).json({ error: "slow_down" });
  try {
    return await serve(req, res);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 400 ? error.message : "provenance_failure" });
  }
}

