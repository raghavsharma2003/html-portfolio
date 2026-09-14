import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_json_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw new TypeError("unsupported_json_value");
}

export function canonicalJson(value) {
  return canonical(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(key, body) {
  return createHmac("sha256", key).update(body).digest("hex");
}

export function signatureBytes(value) {
  const raw = String(value || "").replace(/^sha256=/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.alloc(0);
}

export function validHmac(key, body, presented) {
  const expected = Buffer.from(hmac(key, body), "hex");
  const actual = signatureBytes(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
