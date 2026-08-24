import { sha256 } from "./canonical.js";
import { fail } from "./errors.js";
import { abortAfter, boundedBytes } from "./http.js";

const SHA256 = /^[0-9a-f]{64}$/;
const MIMES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function validateDocumentDescriptor(value, config, now = Date.now()) {
  const descriptor = value && typeof value === "object" ? value : {};
  let url;
  try { url = new URL(String(descriptor.url || "")); } catch { fail("document_url_invalid", 400); }
  if (url.protocol !== "https:" || url.origin !== config.sourceOrigin || url.username || url.password || url.hash ||
      !url.pathname.startsWith("/storage/v1/object/")) fail("document_url_invalid", 400);
  const expiresAt = Date.parse(String(descriptor.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 5_000 || expiresAt > now + 180_000)
    fail("document_capability_expiry_invalid", 400);
  const expectedHash = String(descriptor.sha256 || "").toLowerCase();
  const byteSize = Number(descriptor.byte_size);
  const mime = String(descriptor.mime || "").split(";", 1)[0].toLowerCase();
  if (!SHA256.test(expectedHash) || !Number.isSafeInteger(byteSize) || byteSize < 1 ||
      byteSize > config.limits.mediaBytes || !MIMES.has(mime)) fail("document_descriptor_invalid", 400);
  return Object.freeze({ url: url.toString(), expectedHash, byteSize, mime, expiresAt });
}

export async function fetchVerifiedDocument(descriptor, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(descriptor.url, {
      method: "GET",
      redirect: "error",
      signal: abortAfter(config.limits.mediaDeadlineMs, options.signal),
    });
  } catch { fail("document_fetch_unreachable"); }
  if (!response.ok) fail("document_fetch_unavailable", response.status >= 500 ? 503 : 409);
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  if (contentType && contentType !== descriptor.mime) fail("document_fetch_mime_mismatch", 409);
  const bytes = await boundedBytes(response, config.limits.mediaBytes, "document_fetch_too_large");
  if (bytes.length !== descriptor.byteSize) fail("document_fetch_size_mismatch", 409);
  if (sha256(bytes) !== descriptor.expectedHash) fail("document_fetch_hash_mismatch", 409);
  return bytes;
}
