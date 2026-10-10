import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code, status: 503 }); };

export function authEmailKey(env = process.env) {
  const id = String(env.VYAKTI_AUTH_EMAIL_KEK_ID || "").trim();
  const encoded = String(env.VYAKTI_AUTH_EMAIL_KEK_B64 || "").trim();
  const key = Buffer.from(encoded, "base64");
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(id) || key.length !== 32
      || key.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
    fail("auth_email_encryption_unavailable");
  }
  return { id, key };
}

function associated(binding) {
  if (!binding || !UUID.test(String(binding.request_id || ""))
      || !HASH.test(String(binding.email_hash || ""))
      || !HASH.test(String(binding.redirect_hash || ""))
      || !HASH.test(String(binding.payload_hash || ""))) fail("auth_email_encryption_binding_invalid");
  return Buffer.from(canonicalJson({ domain: "vyakti.auth-email.v1", ...binding }));
}

export function encryptAuthEmailPayload(payload, binding, env = process.env) {
  const text = canonicalJson(payload);
  if (sha256Hex(text) !== binding.payload_hash) fail("auth_email_payload_hash_mismatch");
  const { id, key } = authEmailKey(env);
  const aad = associated(binding);
  const dataKey = randomBytes(32), nonce = randomBytes(12), wrapNonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const wrapper = createCipheriv("aes-256-gcm", key, wrapNonce);
  wrapper.setAAD(Buffer.concat([aad, Buffer.from("|dek")]));
  const wrapped = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
  return {
    algorithm: "AES-256-GCM", key_id: id,
    nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64"),
    wrap_nonce: wrapNonce.toString("base64"), wrapped_dek: wrapped.toString("base64"), wrap_auth_tag: wrapper.getAuthTag().toString("base64"),
    aad_hash: sha256Hex(aad),
  };
}

export function decryptAuthEmailPayload(envelope, binding, env = process.env) {
  const { id, key } = authEmailKey(env);
  const aad = associated(binding);
  if (!envelope || envelope.algorithm !== "AES-256-GCM" || envelope.key_id !== id || envelope.aad_hash !== sha256Hex(aad)) {
    fail("auth_email_encryption_binding_invalid");
  }
  try {
    const wrapper = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.wrap_nonce, "base64"));
    wrapper.setAAD(Buffer.concat([aad, Buffer.from("|dek")]));
    wrapper.setAuthTag(Buffer.from(envelope.wrap_auth_tag, "base64"));
    const dataKey = Buffer.concat([wrapper.update(Buffer.from(envelope.wrapped_dek, "base64")), wrapper.final()]);
    const cipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(envelope.nonce, "base64"));
    cipher.setAAD(aad);
    cipher.setAuthTag(Buffer.from(envelope.auth_tag, "base64"));
    const text = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "base64")), cipher.final()]).toString("utf8");
    if (sha256Hex(text) !== binding.payload_hash) fail("auth_email_payload_hash_mismatch");
    return JSON.parse(text);
  } catch (cause) {
    if (cause?.code) throw cause;
    fail("auth_email_decryption_failed");
  }
}
