import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_ID = /^[A-Za-z0-9._-]{3,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function keyConfig(env = process.env) {
  const keyId = String(env.REPLICA_PROVIDER_CONSENT_KEK_ID || "").trim();
  const encoded = String(env.REPLICA_PROVIDER_CONSENT_KEK_B64 || "").trim();
  if (!KEY_ID.test(keyId)) fail("provider_consent_encryption_key_id_required");
  let key;
  try { key = Buffer.from(encoded, "base64"); }
  catch { fail("provider_consent_encryption_key_required"); }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
    fail("provider_consent_encryption_key_required");
  return { keyId, key };
}

function aadFor(binding) {
  const values = [
    binding.provider_consent_id,
    binding.replica_id,
    binding.owner_user_id,
    binding.provider,
    binding.template_version,
    binding.statement_sha256,
  ].map((value) => String(value || "").trim());
  if (values.some((value) => !value) || !SHA256.test(values.at(-1)))
    fail("provider_consent_encryption_binding_invalid", 400);
  return Buffer.from(`vyakti.provider-consent-name.v1|${values.join("|")}`, "utf8");
}

export function encryptProviderConsentName(name, binding, env = process.env) {
  const plaintext = String(name || "");
  if (!plaintext) fail("provider_consent_name_required", 400);
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

export function decryptProviderConsentName(record, binding, env = process.env) {
  const { keyId, key } = keyConfig(env);
  if (record?.algorithm !== "AES-256-GCM" || record?.key_id !== keyId)
    fail("provider_consent_encryption_key_unavailable");
  const aad = aadFor(binding);
  if (createHash("sha256").update(aad).digest("hex") !== record.aad_sha256)
    fail("provider_consent_name_binding_invalid", 409);
  try {
    const unwrapper = createDecipheriv("aes-256-gcm", key, Buffer.from(record.wrap_nonce_b64, "base64"));
    unwrapper.setAAD(Buffer.concat([aad, Buffer.from("|dek", "utf8")]));
    unwrapper.setAuthTag(Buffer.from(record.wrap_auth_tag_b64, "base64"));
    const dataKey = Buffer.concat([
      unwrapper.update(Buffer.from(record.wrapped_dek_b64, "base64")),
      unwrapper.final(),
    ]);
    if (dataKey.length !== 32) fail("provider_consent_name_decryption_failed", 409);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(record.nonce_b64, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(record.auth_tag_b64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext_b64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    fail("provider_consent_name_decryption_failed", 409);
  }
}
