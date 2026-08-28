// Format detection and the one extraction entry point.
//
// ── the matrix this file IS ──────────────────────────────────────────────
// Every row is either an extractor or a NAMED refusal. There is no third
// column, and that is the point: the brief's rule is that a format we cannot
// extract honestly is refused with a reason and never silently stored-and-
// ignored, and the only way to keep that rule is for the dispatcher to have no
// default branch that stores something.
//
//   .txt / .md / .markdown / .log   → text or, when it sniffs as one, a chat
//                                     export (speaker-attributed)
//   .pdf                            → pdf-text-layer/v1, refusing scans,
//                                     encrypted files and unmappable fonts
//   .docx                           → docx-ooxml/v1
//   audio/video bytes or extension  → ROUTED to the voice-evidence lane
//   .doc (legacy binary)            → refused `doc_legacy_binary_unsupported`
//   .rtf                            → refused `rtf_unsupported`
//   .pages/.odt/.epub/.zip          → refused, each by name
//   anything else                   → refused `format_unsupported`, naming the
//                                     extension, never stored as "received"
//
// Detection is by MAGIC BYTES first and extension second. A `.txt` that is
// really a PDF is a PDF; a `.pdf` that is really a zip is refused rather than
// handed to a parser that would read it as a malformed PDF and blame the file.
import { extractPdf } from "./pdf.js";
import { extractDocx } from "./docx.js";
import { extractWhatsAppExport, looksLikeChatExport } from "./whatsapp.js";
import { audioRouting } from "./link.js";
import {
  MAX_EXTRACTED_CHARS,
  assertReadable,
  canonicalText,
  paragraphSegments,
  refuse,
} from "./limits.js";

/** Extensions this lane names in a refusal rather than lumping into "other".
 *  A named refusal is actionable ("save it as .docx"); `format_unsupported` is
 *  not, and every entry here is a format a real person really does upload. */
const NAMED_REFUSALS = {
  doc: ["doc_legacy_binary_unsupported", "the legacy .doc binary format is not read. Save as .docx or export as text."],
  rtf: ["rtf_unsupported", "RTF is not read. Save as .docx or export as text."],
  odt: ["odt_unsupported", "OpenDocument is not read. Export as .docx or text."],
  pages: ["pages_unsupported", "Apple Pages files are not read. Export as .docx or PDF with a text layer."],
  epub: ["epub_unsupported", "EPUB is not read."],
  zip: ["archive_unsupported", "archives are not unpacked. Upload the files inside it."],
  rar: ["archive_unsupported", "archives are not unpacked. Upload the files inside it"],
  csv: ["csv_unsupported", "a spreadsheet is not prose and mining it as prose would put column headers in your phrase bank."],
  xlsx: ["spreadsheet_unsupported", "a spreadsheet is not prose."],
  pptx: ["slides_unsupported", "slide decks are titles and fragments, not how you talk. Export the speaker notes as text if that is what you meant."],
  json: ["structured_data_unsupported", "structured data is not prose."],
  html: ["html_upload_unsupported", "paste the page's LINK instead — an uploaded HTML file has no source to cite."],
};

function extensionOf(filename) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(filename || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/** Magic-byte sniff for the container formats. Returns "" when the bytes carry
 *  no signature, which for a text file is the normal case. */
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer.readUInt32LE(0) === 0x04034b50) return "zip";
  if (buffer.subarray(0, 8).toString("latin1") === "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") return "ole";
  return "";
}

/** UTF-8 in, or a named refusal. `fatal: true` is the whole point — the default
 *  decoder replaces undecodable bytes with U+FFFD and returns a string, which
 *  is the `plausible-return` failure at the very first step. */
function decodeUtf8(buffer, ext) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    refuse("text_not_utf8", { extension: ext, note: "the file is not valid UTF-8 text. Re-save it as UTF-8." });
  }
}

/**
 * @param filename the owner's own filename, used for the extension hint only
 * @param buffer   raw bytes
 * @returns `{ format, extractor, body, segments, ... }` or
 *          `{ route: { routedTo, note } }`
 * @throws {ContextRefusal} — always with a reason the studio renders verbatim
 */
export function extractFile(filename, buffer) {
  const ext = extensionOf(filename);
  const magic = sniff(buffer);

  // Audio first, and by bytes as well as name: it is the one case that is not a
  // refusal at all, and mis-handing an m4a to the text decoder would surface as
  // `text_not_utf8`, which tells the owner nothing true.
  if (audioRouting(filename, buffer)) {
    return { route: { routedTo: "voice_evidence_lane", note: "Audio belongs to the Voice step, which carries the biometric consent gate and the diarization this lane does not have." } };
  }

  if (magic === "pdf") return withCap(extractPdf(buffer));
  if (magic === "ole") {
    refuse("doc_legacy_binary_unsupported", { note: "this is a legacy Microsoft binary document. Save it as .docx or export as text." });
  }
  if (magic === "zip") {
    // A zip is a .docx, or it is an archive. `word/document.xml` is what
    // decides, and extractDocx refuses by name when it is absent.
    if (ext === "docx" || ext === "") return withCap(extractDocx(buffer));
    const named = NAMED_REFUSALS[ext];
    if (named) refuse(named[0], { extension: ext, note: named[1] });
    return withCap(extractDocx(buffer));
  }

  const named = NAMED_REFUSALS[ext];
  if (named) refuse(named[0], { extension: ext, note: named[1] });

  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "log" || ext === "text" || ext === "") {
    const raw = decodeUtf8(buffer, ext);
    if (looksLikeChatExport(raw)) return withCap(extractWhatsAppExport(raw));
    const body = assertReadable(canonicalText(raw), "text_unreadable", { extension: ext });
    return withCap({
      format: ext === "md" || ext === "markdown" ? "markdown" : "text",
      extractor: ext === "md" || ext === "markdown" ? "markdown-plain/v1" : "text-plain/v1",
      body,
      segments: paragraphSegments(body),
    });
  }

  refuse("format_unsupported", {
    extension: ext || "(none)",
    note: "this file type is not read. Supported: .txt, .md, .pdf (with a real text layer), .docx, and WhatsApp .txt exports. Audio goes to the Voice step and YouTube to the Channel step.",
  });
}

/** The extracted-text ceiling, applied in ONE place so no extractor can forget
 *  it. Over the cap is a refusal that names both numbers — never a slice.
 *  `silent-truncation` is why. */
function withCap(result) {
  if (result.body.length > MAX_EXTRACTED_CHARS) {
    refuse("extracted_text_too_large", {
      chars: result.body.length,
      max: MAX_EXTRACTED_CHARS,
      note: "split the document and upload the parts — nothing here is trimmed silently",
    });
  }
  return result;
}
