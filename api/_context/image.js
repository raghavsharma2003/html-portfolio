// Dependency-free image admission for Context Locker.
//
// This module reads only container headers. It does not decode pixels, run
// OCR, recognize a face, infer a protected trait, or guess what a screenshot
// means. The canonical evidence adapter may therefore cite the exact full
// pixel rectangle and byte commitment, but it may not create a visual fact.
import { refuse } from "./limits.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function dimensions(width, height, format, mime) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > 65_535 || height > 65_535) {
    refuse("image_dimensions_invalid", { format, width, height });
  }
  return Object.freeze({ format, mime, width, height });
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]).has(marker)) {
      if (length < 7) break;
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3), "jpeg", "image/jpeg");
    }
    offset += length;
  }
  refuse("image_dimensions_unreadable", { format: "jpeg" });
}

function u24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes) {
  if (bytes.length < 30) refuse("image_dimensions_unreadable", { format: "webp" });
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") return dimensions(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1, "webp", "image/webp");
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f || bytes.length < 25) refuse("image_dimensions_unreadable", { format: "webp" });
    const bits = bytes.readUInt32LE(21);
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, "webp", "image/webp");
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return dimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff, "webp", "image/webp");
  }
  refuse("image_dimensions_unreadable", { format: "webp" });
}

export function looksLikeImage(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  return (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG)) ||
    (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (bytes.length >= 16 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP");
}

export function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) refuse("image_malformed");
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG)) {
    if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") refuse("image_malformed", { format: "png" });
    return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20), "png", "image/png");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes);
  if (bytes.length >= 16 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return webpDimensions(bytes);
  }
  refuse("image_format_unsupported", { note: "Only PNG, JPEG and WebP images have a verified local dimension parser." });
}
