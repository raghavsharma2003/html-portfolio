// The DOCX extractor — a zip walk and a `<w:t>` scan, no dependency.
//
// A .docx is an OOXML package: a zip whose `word/document.xml` holds the text
// in `<w:t>` runs inside `<w:p>` paragraphs. Unlike a PDF there is no font
// indirection at all — the characters in the XML are the characters on the
// page — so this extractor is strictly MORE reliable than api/_context/pdf.js
// and needs no readability heuristic to know it understood the file. It still
// runs one, because a zip whose `document.xml` inflates to something else is a
// case worth failing loudly.
//
// The zip is walked by LOCAL FILE HEADERS rather than the central directory.
// That is the simpler half of the format and it is sufficient here: we need one
// named entry, not a faithful archive reader, and a local-header walk cannot be
// fooled by a mismatched central directory into reading a different member than
// the one it names.
import { inflateRawSync } from "node:zlib";
import { assertReadable, canonicalText, paragraphSegments, refuse } from "./limits.js";

const LOCAL_HEADER = 0x04034b50;

/** Every entry in the zip, by name. Stored (method 0) and deflated (method 8)
 *  are the only two methods Word emits; anything else is reported rather than
 *  guessed at. */
function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== LOCAL_HEADER) {
      // The local headers are contiguous at the front of a Word-written
      // package; the first non-header is the central directory and we are done.
      break;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameAt = offset + 30;
    const name = buffer.subarray(nameAt, nameAt + nameLength).toString("utf8");
    const dataAt = nameAt + nameLength + extraLength;
    if (flags & 0x08 && compressedSize === 0) {
      // A streamed entry writes its size to a trailing data descriptor. Rather
      // than guess the length, find the next local header and stop before its
      // 16-byte descriptor. Word does not emit these for document.xml, so this
      // branch exists to fail cleanly rather than to be relied on.
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataAt);
      compressedSize = (next < 0 ? buffer.length : next) - dataAt - 16;
      if (compressedSize <= 0) break;
    }
    entries.set(name, { method, data: buffer.subarray(dataAt, dataAt + compressedSize) });
    offset = dataAt + compressedSize;
  }
  return entries;
}

function inflateEntry(entry) {
  if (!entry) return null;
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) return null;
  try { return inflateRawSync(entry.data); } catch { return null; }
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return XML_ENTITIES[code] ?? whole;
  });
}

/** `<w:p>` is a paragraph, `<w:t>` is a text run, `<w:br/>` and `<w:tab/>` are
 *  in-paragraph breaks. Deleted runs (`<w:delText>`) are deliberately NOT read:
 *  text a person struck out is text they decided not to say. */
function textFromDocumentXml(xml) {
  const paragraphs = [];
  for (const para of xml.split(/<w:p[ >]/).slice(1)) {
    let line = "";
    const re = /<w:(t|tab|br|cr)(\s[^>]*)?(\/)?>/g;
    let m;
    while ((m = re.exec(para))) {
      if (m[1] === "t") {
        if (m[3]) continue;
        const close = para.indexOf("</w:t>", re.lastIndex);
        if (close < 0) break;
        line += decodeXml(para.slice(re.lastIndex, close));
        re.lastIndex = close + 6;
      } else if (m[1] === "tab") line += "\t";
      else line += "\n";
    }
    if (line.trim()) paragraphs.push(line.trim());
  }
  return paragraphs.join("\n\n");
}

/**
 * @throws {ContextRefusal} `docx_malformed`, `docx_encrypted`,
 *   `docx_no_text`, `docx_unreadable`
 */
export function extractDocx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30 || buffer.readUInt32LE(0) !== LOCAL_HEADER) {
    refuse("docx_malformed", { note: "not a zip package — the bytes are not a .docx" });
  }
  const entries = zipEntries(buffer);
  // A password-protected OOXML file is a CFB container holding an
  // EncryptedPackage, not a zip with word/document.xml. Named separately from
  // "malformed" because the owner can act on it.
  if (entries.has("EncryptedPackage") || entries.has("EncryptionInfo")) {
    refuse("docx_encrypted", { note: "the document is password-protected; remove the password and re-upload" });
  }
  const document = inflateEntry(entries.get("word/document.xml"));
  if (!document) {
    refuse("docx_malformed", {
      note: "no readable word/document.xml in the package",
      entries: [...entries.keys()].slice(0, 12),
    });
  }
  const text = canonicalText(textFromDocumentXml(document.toString("utf8")));
  if (!text) refuse("docx_no_text", { note: "the document body contains no text runs" });
  const body = assertReadable(text, "docx_unreadable", { note: "document.xml inflated but does not read as text" });
  return { format: "docx", extractor: "docx-ooxml/v1", body, segments: paragraphSegments(body) };
}
