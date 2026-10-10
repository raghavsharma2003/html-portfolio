export class ServiceError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export function fail(code, status = 503) {
  throw new ServiceError(code, status);
}

export function finiteScore(value, code) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) fail(code);
  return Math.round(score * 1_000_000) / 1_000_000;
}
