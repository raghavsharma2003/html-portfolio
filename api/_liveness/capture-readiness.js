// Source-supported operation inventory, not a deployment/configuration flag.
// The current broker implements official face sessions, but does not implement
// /v1/liveness/verify (speech/nonce, synthetic risk and speaker continuity).
// Reverse only with an implemented, version-bound composite caller contract and
// accepted provider evidence. A constructor or health200 cannot supply it.
export function modernCaptureReadiness() {
  return Object.freeze({
    ready: false,
    waiting_on: "us",
    code: "liveness_verifier_unavailable",
  });
}

export function requireModernCaptureReadiness() {
  const readiness = modernCaptureReadiness();
  if (!readiness.ready) {
    throw Object.assign(new Error(readiness.code), {
      code: readiness.code, status: 503, waiting_on: readiness.waiting_on,
    });
  }
  return readiness;
}
