import { sha256 } from "./canonical.js";
import { fail } from "./errors.js";
import { abortAfter, boundedBytes } from "./http.js";

const SHA256 = /^[0-9a-f]{64}$/;
const MIMES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const ORIGINAL_PATH = new RegExp(`^/${UUID}/${UUID}/${UUID}/original$`);
const SAS_KEYS = Object.freeze(["sp", "st", "se", "spr", "sv", "sr", "sig"]);
const SAS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function validateAzureDocumentUrl(url, raw, config, expiresAt, now) {
  const prefix = `/${config.sourceAzureContainer}`;
  // Reject URL-parser normalization (dot segments, escaping, credentials/ports)
  // and permit only the original document layout emitted by privateObjectPath.
  if (raw !== url.toString() || !url.pathname.startsWith(`${prefix}/`) ||
      !ORIGINAL_PATH.test(url.pathname.slice(prefix.length))) fail("document_url_invalid", 400);
  const query = url.searchParams;
  if ([...query.keys()].length !== SAS_KEYS.length || SAS_KEYS.some((key) => query.getAll(key).length !== 1) ||
      query.get("sp") !== "r" || query.get("sr") !== "b" || query.get("spr") !== "https" ||
      query.get("sv") !== "2026-04-06" || query.get("sig")?.length !== 44 ||
      !/^[A-Za-z0-9+/]{43}=$/.test(query.get("sig") || "")) {
    fail("document_capability_invalid", 400);
  }
  const start = query.get("st"), end = query.get("se");
  const startsAt = Date.parse(start), endsAt = Date.parse(end);
  if (!SAS_TIME.test(start) || !SAS_TIME.test(end) || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) ||
      new Date(startsAt).toISOString() !== start.replace("Z", ".000Z") ||
      new Date(endsAt).toISOString() !== end.replace("Z", ".000Z") ||
      startsAt > now || startsAt < now - 600_000 || endsAt !== expiresAt || startsAt >= endsAt) {
    fail("document_capability_expiry_invalid", 400);
  }
}

export function validateDocumentDescriptor(value, config, now = Date.now()) {
  const descriptor = value && typeof value === "object" ? value : {};
  let url;
  try { url = new URL(String(descriptor.url || "")); } catch { fail("document_url_invalid", 400); }
  if (url.protocol !== "https:" || url.origin !== config.sourceOrigin || url.username || url.password || url.hash ||
      (config.sourceProvider !== "azure_blob" && !url.pathname.startsWith("/storage/v1/object/"))) fail("document_url_invalid", 400);
  const expiresAt = Date.parse(String(descriptor.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 5_000 || expiresAt > now + 180_000)
    fail("document_capability_expiry_invalid", 400);
  if (config.sourceProvider === "azure_blob") validateAzureDocumentUrl(url, descriptor.url, config, expiresAt, now);
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
