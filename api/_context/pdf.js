// The PDF TEXT-LAYER extractor — dependency-light, and loud about its limits.
//
// This reads the text a PDF already contains. It is NOT an OCR engine and it
// is not a font-mapping engine, and the whole design of this file is about
// making those two absences VISIBLE rather than letting them produce something
// plausible.
//
// ── what it does ─────────────────────────────────────────────────────────
// Walk the raw bytes for `stream … endstream` bodies, inflate the FlateDecode
// ones with node:zlib (the only filter in practice for text content), and scan
// the resulting content streams for the five text-showing operators — Tj, TJ,
// ' and " — collecting their literal string arguments. For a PDF whose fonts
// use a standard encoding (which is almost every PDF produced by a word
// processor, a browser print, or LaTeX with Type1 fonts) those literal bytes
// ARE the text.
//
// ── what it refuses, and why refusing is the feature ─────────────────────
// For a SUBSET-EMBEDDED font with a custom /Differences encoding, or a 2-byte
// CID font, the literal bytes are not text at all — they are glyph indices, and
// decoding them as characters produces confident-looking garbage. That garbage
// would be stored, mined, cited, and eventually told to a person as "these are
// your habitual phrases". `plausible-return-hides-a-dead-pipeline` is the
// rejection this repo already paid for; this file's answer to it is
// `assertReadable`, which fails the extraction with `pdf_text_layer_unreadable`
// rather than returning byte soup.
//
// A scanned PDF — pages of images, no text operators — hits the same wall from
// the other side and is refused as `pdf_no_text_layer`, naming OCR as the thing
// this platform does not have. The alternative (store it, extract nothing, show
// the item as fine) is exactly the silent-ignore the brief forbids.
//
// The reversal condition is written in context/decisions.md: if a measured
// sample of real owner PDFs refuses above ~20%, the answer is a real font-map
// pass or a vendored parser, not a loosening of the readability gate.
import { inflateSync, inflateRawSync } from "node:zlib";
import { assertReadable, canonicalText, paragraphSegments, refuse } from "./limits.js";

const HEADER = Buffer.from("%PDF-");

/** PDF string escapes, per the spec's §7.3.4.2 table. Octal included because
 *  every generator emits it for non-ASCII. */
function unescapeLiteral(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "b" || next === "f") out += " ";
    else if (next === "\n") { /* line continuation: nothing */ }
    else if (next >= "0" && next <= "7") {
      let oct = next;
      while (oct.length < 3 && raw[i + 1] >= "0" && raw[i + 1] <= "7") oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += next;
  }
  return out;
}

/** Balanced-paren literal string scan. A regex cannot do this: `(a (b) c)` is
 *  ONE string and `(a \) b)` is one too, and both are ordinary in real PDFs. */
function readLiteral(text, open) {
  let depth = 1;
  let i = open + 1;
  let raw = "";
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "\\") { raw += ch + (text[i + 1] ?? ""); i += 2; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) break; }
    raw += ch;
    i++;
  }
  return { value: unescapeLiteral(raw), end: i + 1 };
}

function readHex(text, open) {
  const close = text.indexOf(">", open);
  if (close < 0) return { value: "", end: text.length };
  const digits = text.slice(open + 1, close).replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < digits.length; i += 2) out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
  return { value: out, end: close + 1 };
}

/**
 * One content stream → its shown text.
 *
 * Strings are buffered until a text-positioning operator that implies a line
 * break (`Td`, `TD`, `T*`, `'`, `"`, `ET`) flushes them. This is a heuristic
 * about LAYOUT, and it is the only heuristic in this file — it affects where
 * the newlines fall, never which characters are present, so a wrong guess costs
 * paragraph shape and cannot invent words.
 */
function textFromContentStream(content) {
  const lines = [];
  let current = "";
  let pending = [];
  const flushRun = () => { if (pending.length) { current += pending.join(""); pending = []; } };
  const flushLine = () => { flushRun(); if (current.trim()) lines.push(current.trim()); current = ""; };

  let i = 0;
  let inText = false;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") { const r = readLiteral(content, i); if (inText) pending.push(r.value); i = r.end; continue; }
    if (ch === "<" && content[i + 1] !== "<") { const r = readHex(content, i); if (inText) pending.push(r.value); i = r.end; continue; }
    if (ch === "B" && content.startsWith("BT", i)) { inText = true; i += 2; continue; }
    if (ch === "E" && content.startsWith("ET", i)) { flushLine(); inText = false; i += 2; continue; }
    if (inText && (content.startsWith("Td", i) || content.startsWith("TD", i) || content.startsWith("T*", i))) {
      flushLine(); i += 2; continue;
    }
    if (inText && content.startsWith("TJ", i)) { flushRun(); i += 2; continue; }
    if (inText && content.startsWith("Tj", i)) { flushRun(); i += 2; continue; }
    i++;
  }
  flushLine();
  return lines.join("\n");
}

/** Every `stream … endstream` body in the file, inflated where it is Flate and
 *  taken raw where it is not. Image XObjects are skipped by dictionary, not by
 *  guess: inflating a 4 MB JPEG and running a text scan over it is how a
 *  "text" extraction ends up citing pixel noise. */
function contentStreams(buffer) {
  const latin = buffer.toString("latin1");
  const streams = [];
  let cursor = 0;
  let sawStream = false;
  let unsupportedFilter = false;
  for (;;) {
    const at = latin.indexOf("stream", cursor);
    if (at < 0) break;
    // `stream` must be preceded by a dictionary close, or it is the word
    // "stream" inside some other token (e.g. `endstream`).
    const dictEnd = latin.lastIndexOf(">>", at);
    const dictStart = dictEnd < 0 ? -1 : latin.lastIndexOf("<<", dictEnd);
    if (dictStart < 0 || at - dictEnd > 4) { cursor = at + 6; continue; }
    sawStream = true;
    const dict = latin.slice(dictStart, dictEnd);
    let bodyStart = at + 6;
    if (latin[bodyStart] === "\r") bodyStart++;
    if (latin[bodyStart] === "\n") bodyStart++;
    const bodyEnd = latin.indexOf("endstream", bodyStart);
    cursor = bodyEnd < 0 ? at + 6 : bodyEnd + 9;
    if (bodyEnd < 0) continue;
    if (/\/Subtype\s*\/(Image|Form)?/.test(dict) && /\/Subtype\s*\/Image/.test(dict)) continue;
    if (/\/Type\s*\/(XRef|ObjStm|Metadata)\b/.test(dict)) continue;
    const raw = buffer.subarray(bodyStart, bodyEnd);
    if (/\/Filter/.test(dict) && !/\/FlateDecode/.test(dict)) { unsupportedFilter = true; continue; }
    if (!/\/Filter/.test(dict)) { streams.push(raw.toString("latin1")); continue; }
    try {
      streams.push(inflateSync(raw).toString("latin1"));
    } catch {
      try { streams.push(inflateRawSync(raw).toString("latin1")); } catch { /* a stream we cannot read contributes nothing, and the readability gate decides */ }
    }
  }
  return { streams, sawStream, unsupportedFilter };
}

/**
 * @param buffer the raw file bytes
 * @returns `{ format, extractor, body, segments }`
 * @throws {ContextRefusal} with one of:
 *   `pdf_malformed`, `pdf_encrypted`, `pdf_no_text_layer`,
 *   `pdf_unsupported_filter`, `pdf_text_layer_unreadable`
 */
export function extractPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 5).equals(HEADER)) {
    refuse("pdf_malformed", { note: "no %PDF- header — the bytes are not a PDF" });
  }
  const latin = buffer.toString("latin1");
  // Encryption is checked BEFORE anything is inflated. An encrypted PDF's
  // streams inflate to ciphertext, which is byte soup that the readability gate
  // would catch — but it would catch it with the wrong reason, and "this file
  // is password-protected" is something the owner can act on while "unreadable
  // text layer" is not.
  if (/\/Encrypt\b/.test(latin)) {
    refuse("pdf_encrypted", { note: "the document is encrypted; remove the password and re-upload" });
  }

  const { streams, sawStream, unsupportedFilter } = contentStreams(buffer);
  if (!sawStream) refuse("pdf_malformed", { note: "no stream objects found" });

  const text = canonicalText(streams.map(textFromContentStream).filter(Boolean).join("\n\n"));
  if (!text) {
    if (unsupportedFilter) {
      refuse("pdf_unsupported_filter", { note: "the content streams use a filter this extractor does not implement (only FlateDecode and unfiltered streams are read)" });
    }
    refuse("pdf_no_text_layer", {
      note: "the PDF contains no text-showing operators — it is almost certainly a scan. This platform has no OCR lane, so the file is refused rather than stored empty.",
    });
  }
  const body = assertReadable(text, "pdf_text_layer_unreadable", {
    note: "text was recovered but does not read as language — the fonts most likely use a subset or CID encoding this extractor does not map. Export the document as text or DOCX and upload that.",
  });
  return { format: "pdf", extractor: "pdf-text-layer/v1", body, segments: paragraphSegments(body) };
}
