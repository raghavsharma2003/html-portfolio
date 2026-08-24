import http from "node:http";
import { canonicalJson, hmac, sha256, validHmac } from "./canonical.js";
import { ServiceError } from "./errors.js";
import { jsonResponse, readBody } from "./http.js";
import { verifyIdentityRequest } from "./identity.js";
import {
  cleanupExpiredLivenessSessions,
  createLivenessSession,
  deleteLivenessSession,
  getLivenessResult,
  resumeLivenessSession,
} from "./liveness.js";

function safeCode(error) {
  return error instanceof ServiceError && /^[a-z0-9_]{3,80}$/.test(error.code) ? error.code : "verification_failed";
}

export function createVerifierServer(config, options = {}) {
  const routes = new Map([
    ["/v1/identity/verify", { enabled: true, protocol: config.protocol, run: options.verify || verifyIdentityRequest }],
    ["/v1/liveness/session", { enabled: config.liveness?.enabled, protocol: config.liveness?.protocol, run: options.createLiveness || createLivenessSession }],
    ["/v1/liveness/resume", { enabled: config.liveness?.enabled, protocol: config.liveness?.protocol, run: options.resumeLiveness || resumeLivenessSession }],
    ["/v1/liveness/result", { enabled: config.liveness?.enabled, protocol: config.liveness?.protocol, run: options.getLiveness || getLivenessResult }],
    ["/v1/liveness/delete", { enabled: config.liveness?.erasureEnabled, protocol: config.liveness?.protocol, run: options.deleteLiveness || deleteLivenessSession }],
    ["/v1/liveness/cleanup", { enabled: config.liveness?.erasureEnabled, protocol: config.liveness?.protocol, run: options.cleanupLiveness || cleanupExpiredLivenessSessions }],
  ]);
  const replay = new Map();
  const completed = new Map();
  const inflight = new Map();
  let active = 0;
  const now = options.now || (() => Date.now());
  function sweepReplay() {
    const cutoff = now() - 10 * 60_000;
    for (const [key, seenAt] of replay) if (seenAt < cutoff) replay.delete(key);
    for (const [key, value] of completed) {
      if (value.seenAt < cutoff || value.expiresAt <= now()) completed.delete(key);
    }
  }
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health/live") return jsonResponse(res, 200, { ok: true });
    if (req.method === "GET" && req.url === "/health/ready") {
      return jsonResponse(res, 200, { ok: true, version: config.version, dependencies: [
        "document_intelligence", "face", "independent_review",
        ...(config.liveness?.enabled ? ["face_liveness"] : []),
        ...(!config.liveness?.enabled && config.liveness?.erasureEnabled ? ["face_liveness_erasure"] : []),
      ] });
    }
    const route = req.method === "POST" ? routes.get(req.url) : null;
    if (!route) return jsonResponse(res, 404, { error: "not_found" });
    if (!route.enabled || !route.protocol) return jsonResponse(res, 503, { error: "face_liveness_disabled" });
    if (active >= config.limits.concurrency) return jsonResponse(res, 429, { error: "verification_capacity_reached" }, { "Retry-After": "2" });
    active++;
    try {
      if (req.headers["content-type"]?.split(";", 1)[0] !== "application/json" ||
          req.headers["x-vyakti-protocol"] !== route.protocol) throw new ServiceError("protocol_required", 400);
      const body = await readBody(req, config.limits.requestBytes);
      if (!validHmac(config.hmacKey, body, req.headers["x-vyakti-signature"])) throw new ServiceError("request_signature_invalid", 401);
      let payload;
      try { payload = JSON.parse(body); } catch { throw new ServiceError("request_json_invalid", 400); }
      const issuedAt = Date.parse(String(payload?.broker_issued_at || ""));
      if (!/^[0-9a-f]{32}$/.test(String(payload?.broker_nonce || "")) || !Number.isFinite(issuedAt) ||
          Math.abs(now() - issuedAt) > 120_000) throw new ServiceError("request_freshness_invalid", 401);
      sweepReplay();
      const requestId = String(payload?.request_id || "");
      const idempotencyKey = req.url === "/v1/liveness/session" && requestId
        ? `${req.url}:${requestId}`
        : "";
      const semanticPayload = { ...payload };
      delete semanticPayload.broker_nonce;
      delete semanticPayload.broker_issued_at;
      if (req.url === "/v1/liveness/session" && semanticPayload.identity_reference) {
        semanticPayload.identity_reference = { ...semanticPayload.identity_reference };
        delete semanticPayload.identity_reference.url;
        delete semanticPayload.identity_reference.expires_at;
      }
      const requestDigest = sha256(canonicalJson(semanticPayload));
      const cached = idempotencyKey ? completed.get(idempotencyKey) : null;
      if (cached) {
        if (cached.requestDigest !== requestDigest) throw new ServiceError("idempotency_conflict", 409);
        return jsonResponse(res, 200, cached.body, {
          "X-Vyakti-Response-Signature": `sha256=${hmac(config.hmacKey, cached.body)}`,
        });
      }
      let operation = idempotencyKey ? inflight.get(idempotencyKey) : null;
      if (operation && operation.requestDigest !== requestDigest) throw new ServiceError("idempotency_conflict", 409);
      if (!operation) {
        const replayKey = sha256(`${req.headers["x-vyakti-signature"]}:${body}`);
        if (replay.has(replayKey)) throw new ServiceError("request_replayed", 409);
        replay.set(replayKey, now());
        const task = Promise.resolve().then(() => route.run(payload, config, {
          ...options,
          signal: AbortSignal.timeout(config.limits.totalDeadlineMs),
        }));
        operation = { requestDigest, task };
        if (idempotencyKey) inflight.set(idempotencyKey, operation);
      }
      let result;
      try { result = await operation.task; }
      finally { if (idempotencyKey && inflight.get(idempotencyKey) === operation) inflight.delete(idempotencyKey); }
      const responseBody = canonicalJson(result);
      if (idempotencyKey) {
        const declaredExpiry = Date.parse(String(result?.session_expires_at || ""));
        completed.set(idempotencyKey, {
          body: responseBody,
          requestDigest,
          seenAt: now(),
          expiresAt: Number.isFinite(declaredExpiry)
            ? Math.min(declaredExpiry, now() + 10 * 60_000)
            : now() + 10 * 60_000,
        });
      }
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
