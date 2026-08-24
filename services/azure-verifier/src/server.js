import http from "node:http";
import { canonicalJson, hmac, sha256, validHmac } from "./canonical.js";
import { ServiceError } from "./errors.js";
import { jsonResponse, readBody } from "./http.js";
import { verifyIdentityRequest } from "./identity.js";
import { createLivenessSession, deleteLivenessSession, getLivenessResult } from "./liveness.js";

function safeCode(error) {
  return error instanceof ServiceError && /^[a-z0-9_]{3,80}$/.test(error.code) ? error.code : "verification_failed";
}

export function createVerifierServer(config, options = {}) {
  const routes = new Map([
    ["/v1/identity/verify", { protocol: config.protocol, run: options.verify || verifyIdentityRequest }],
    ["/v1/liveness/session", { protocol: config.liveness?.protocol, run: options.createLiveness || createLivenessSession }],
    ["/v1/liveness/result", { protocol: config.liveness?.protocol, run: options.getLiveness || getLivenessResult }],
    ["/v1/liveness/delete", { protocol: config.liveness?.protocol, run: options.deleteLiveness || deleteLivenessSession }],
  ]);
  const replay = new Map();
  let active = 0;
  const now = options.now || (() => Date.now());
  function sweepReplay() {
    const cutoff = now() - 10 * 60_000;
    for (const [key, seenAt] of replay) if (seenAt < cutoff) replay.delete(key);
  }
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health/live") return jsonResponse(res, 200, { ok: true });
    if (req.method === "GET" && req.url === "/health/ready") {
      return jsonResponse(res, 200, { ok: true, version: config.version, dependencies: [
        "document_intelligence", "face", "independent_review", ...(config.liveness?.enabled ? ["face_liveness"] : []),
      ] });
    }
    const route = req.method === "POST" ? routes.get(req.url) : null;
    if (!route) return jsonResponse(res, 404, { error: "not_found" });
    if (!route.protocol) return jsonResponse(res, 503, { error: "face_liveness_disabled" });
    if (active >= config.limits.concurrency) return jsonResponse(res, 429, { error: "verification_capacity_reached" }, { "Retry-After": "2" });
    active++;
    try {
      if (req.headers["content-type"]?.split(";", 1)[0] !== "application/json" ||
          req.headers["x-vyakti-protocol"] !== route.protocol) throw new ServiceError("protocol_required", 400);
      const body = await readBody(req, config.limits.requestBytes);
      if (!validHmac(config.hmacKey, body, req.headers["x-vyakti-signature"])) throw new ServiceError("request_signature_invalid", 401);
      const replayKey = sha256(`${req.headers["x-vyakti-signature"]}:${body}`);
      sweepReplay();
      if (replay.has(replayKey)) throw new ServiceError("request_replayed", 409);
      replay.set(replayKey, now());
      let payload;
      try { payload = JSON.parse(body); } catch { throw new ServiceError("request_json_invalid", 400); }
      const result = await route.run(payload, config, { ...options, signal: AbortSignal.timeout(config.limits.totalDeadlineMs) });
      const responseBody = canonicalJson(result);
      return jsonResponse(res, 200, responseBody, { "X-Vyakti-Response-Signature": `sha256=${hmac(config.hmacKey, responseBody)}` });
    } catch (error) {
      const status = error instanceof ServiceError ? error.status : Number(error?.status) || 500;
      const responseBody = canonicalJson({ error: safeCode(error) });
      return jsonResponse(res, status, responseBody, { "X-Vyakti-Response-Signature": `sha256=${hmac(config.hmacKey, responseBody)}` });
    } finally {
      active--;
    }
  });
}
