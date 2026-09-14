import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "./errors.js";

const AAD = Buffer.from("vyakti-azure-liveness-session-handle/v1", "utf8");

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function exactPart(value, min, max) {
  const raw = String(value || "");
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) fail("liveness_session_handle_invalid", 400);
  let bytes;
  try { bytes = Buffer.from(raw, "base64url"); } catch { fail("liveness_session_handle_invalid", 400); }
  if (bytes.length < min || bytes.length > max || b64url(bytes) !== raw)
    fail("liveness_session_handle_invalid", 400);
  return bytes;
}

export function sealSession(value, key, options = {}) {
  const nonce = options.nonce || randomBytes(12);
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(nonce) || nonce.length !== 12)
    fail("liveness_session_seal_configuration_invalid", 500);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v1.${b64url(nonce)}.${b64url(ciphertext)}.${b64url(cipher.getAuthTag())}`;
}

export function openSession(handle, key) {
  const parts = String(handle || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || String(handle).length > 4_096)
    fail("liveness_session_handle_invalid", 400);
  const nonce = exactPart(parts[1], 12, 12);
  const ciphertext = exactPart(parts[2], 16, 3_072);
  const tag = exactPart(parts[3], 16, 16);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("liveness_session_seal_configuration_invalid", 500);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext);
  } catch { fail("liveness_session_handle_invalid", 400); }
}
