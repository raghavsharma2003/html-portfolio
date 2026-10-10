// Owner-only cited claim extraction. Raw transcripts never leave the server
// response boundary and model proposals can only enter as review-pending.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { createProductionClaimExtractor } from "./_claim-extraction/registry.js";
import { extractOwnedClaims, ownedClaimExtractionStatus, sweepOwnedClaims } from "./_replica-claims.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export function createClaimRequestAbort(req, res, options = {}) {
  const timeoutMs = Math.max(1_000, Math.min(45_000, Number(options.timeoutMs || 42_000)));
  const controller = new AbortController();
  const abort = (code) => {
    if (controller.signal.aborted) return;
    controller.abort(Object.assign(new Error(code), { code }));
  };
  const onAborted = () => abort("client_aborted");
  const onResponseClose = () => {
    if (!res?.writableEnded) abort("client_aborted");
  };
  req?.once?.("aborted", onAborted);
  res?.once?.("close", onResponseClose);
  if (req?.aborted) onAborted();
  const timer = setTimeout(() => abort("claim_extraction_timeout"), timeoutMs);
  timer.unref?.();
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      req?.removeListener?.("aborted", onAborted);
      res?.removeListener?.("close", onResponseClose);
    },
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "replica_claims", 20)) return res.status(429).json({ error: "slow_down" });
  let requestAbort = null;
  try {
    const user = await requireUser(req);
    if (!allow(user.id, "replica_claims_user", 30)) return res.status(429).json({ error: "slow_down" });
    if (req.method === "GET") {
      const extraction = await ownedClaimExtractionStatus(q, user.id, req.query?.replica_id);
      return extraction ? res.status(200).json({ extraction }) : res.status(404).json({ error: "replica_not_found" });
    }
    const body = req.body || {};
    if (body.op !== "extract" && body.op !== "sweep") return res.status(400).json({ error: "unknown_op" });
    requestAbort = createClaimRequestAbort(req, res);
    const extractor = createProductionClaimExtractor();
    const run = body.op === "sweep"
      ? await sweepOwnedClaims(q, user.id, body.replica_id, extractor, requestAbort.signal)
      : await extractOwnedClaims(q, user.id, body.replica_id, extractor, requestAbort.signal);
    return run ? res.status(200).json({ run }) : res.status(404).json({ error: "replica_not_found" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (requestAbort?.signal.aborted) {
      const code = String(requestAbort.signal.reason?.code || requestAbort.signal.reason?.message || "claim_extraction_timeout");
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      return res.status(code === "claim_extraction_timeout" ? 504 : 408).json({ error: code });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "claim_extraction_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  } finally {
    requestAbort?.dispose();
  }
}
