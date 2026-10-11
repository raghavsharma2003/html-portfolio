import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_ID = /^[A-Za-z0-9._-]{3,80}$/;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function keyConfig(env = process.env) {
  const keyId = String(env.REPLICA_FEEDBACK_KEK_ID || "").trim();
  const encoded = String(env.REPLICA_FEEDBACK_KEK_B64 || "").trim();
  if (!KEY_ID.test(keyId)) fail("feedback_encryption_key_id_required");
  let key;
  try { key = Buffer.from(encoded, "base64"); } catch { fail("feedback_encryption_key_required"); }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
    fail("feedback_encryption_key_required");
  return { keyId, key };
}

function aadFor(binding) {
  const values = [binding.feedback_id, binding.replica_id, binding.turn_id, binding.text_sha256];
  if (values.some((value) => !String(value || "").trim())) fail("feedback_encryption_binding_invalid", 400);
  return Buffer.from(`vyakti.turn-exemplar.v1|${values.join("|")}`, "utf8");
}

export function exemplarTextHash(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function encryptTurnExemplar(text, binding, env = process.env) {
  const plaintext = String(text || "");
  if (!plaintext) return null;
  const { keyId, key } = keyConfig(env);
  const dataKey = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = aadFor(binding);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const wrapNonce = randomBytes(12);
  const wrapper = createCipheriv("aes-256-gcm", key, wrapNonce);
  wrapper.setAAD(Buffer.concat([aad, Buffer.from("|dek", "utf8")]));
  const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
  return Object.freeze({
    algorithm: "AES-256-GCM",
    key_id: keyId,
    nonce_b64: nonce.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    auth_tag_b64: cipher.getAuthTag().toString("base64"),
    wrapped_dek_b64: wrappedKey.toString("base64"),
    wrap_nonce_b64: wrapNonce.toString("base64"),
    wrap_auth_tag_b64: wrapper.getAuthTag().toString("base64"),
    aad_sha256: createHash("sha256").update(aad).digest("hex"),
  });
}

export function decryptTurnExemplar(record, binding, env = process.env) {
  if (!record) return "";
  const { keyId, key } = keyConfig(env);
  if (record.algorithm !== "AES-256-GCM" || record.key_id !== keyId) fail("feedback_encryption_key_unavailable");
  const aad = aadFor(binding);
  const aadHash = createHash("sha256").update(aad).digest("hex");
  if (aadHash !== record.aad_sha256) fail("feedback_exemplar_binding_invalid", 409);
  try {
    const unwrapper = createDecipheriv("aes-256-gcm", key, Buffer.from(record.wrap_nonce_b64, "base64"));
    unwrapper.setAAD(Buffer.concat([aad, Buffer.from("|dek", "utf8")]));
    unwrapper.setAuthTag(Buffer.from(record.wrap_auth_tag_b64, "base64"));
    const dataKey = Buffer.concat([unwrapper.update(Buffer.from(record.wrapped_dek_b64, "base64")), unwrapper.final()]);
    if (dataKey.length !== 32) fail("feedback_exemplar_decryption_failed", 409);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(record.nonce_b64, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(record.auth_tag_b64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext_b64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    fail("feedback_exemplar_decryption_failed", 409);
  }
}
