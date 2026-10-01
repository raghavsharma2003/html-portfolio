// A bounded projection of evidence already selected by the claim authority SQL.
// This adapter neither authorizes a source nor establishes speaker identity.
// It does not read media or promote image geometry into textual knowledge.
import { verifyContextCanonicalEvidence } from "./context-evidence.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const METADATA = ["evidence_type", "source_kind", "source_locator", "source_format"];
const TEXT_FORMATS = new Set(["text", "markdown"]);
const DOCUMENT_FORMATS = new Set(["pdf", "docx"]);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function own(value, key) { return Object.hasOwn(value, key); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }

function timing(row) {
  const start = own(row, "span_start_ms") ? row.span_start_ms : row.span?.start_ms ?? null;
  const end = own(row, "span_end_ms") ? row.span_end_ms : row.span?.end_ms ?? null;
  if (start === null && end === null) return { start_ms: null, end_ms: null };
  if (!integer(start) || !integer(end) || end <= start) fail("claim_evidence_time_range_invalid");
  return { start_ms: start, end_ms: end };
}

function projectedMetadata(row) {
  if (METADATA.every(key => own(row, key))) return row;
  if (METADATA.every(key => !own(row, key))) return null;
  // Existing offline callers sometimes supply the complete canonical record
  // instead of its SQL projection. Verify its immutable commitment before
  // deriving the documented text format. Partial metadata never gets guessed.
  if (row.evidence_type === "text_span" && !METADATA.slice(1).some(key => own(row, key)) && row.value && row.adapter) {
    const keys = ["schema_version", "replica_id", "owner_user_id", "source_id", "artifact_id", "created_by_job_id",
      "evidence_type", "span", "confidence", "value", "input_sha256", "adapter", "evidence_id", "record_hash"];
    verifyContextCanonicalEvidence(Object.fromEntries(keys.map(key => [key, row[key]])));
    if (own(row, "text") && row.text !== row.value.text) fail("claim_evidence_text_mismatch");
    const format = row.value.provenance.format;
    if (!TEXT_FORMATS.has(format) && !DOCUMENT_FORMATS.has(format)) fail("claim_evidence_format_invalid");
    return {
      evidence_type: "text_span",
      source_kind: DOCUMENT_FORMATS.has(format) ? "document" : "text",
      source_format: format,
      source_locator: row.value.locator,
    };
  }
  fail("claim_evidence_metadata_incomplete");
}

function textLocator(value, text) {
  const keys = ["unit", "shape", "start_char", "end_char", "canonical_text_sha256", "page_mapping"];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key)) || !keys.every(key => own(value, key))
      || value.unit !== "utf16_code_units" || value.shape !== "contiguous"
      || !integer(value.start_char) || !integer(value.end_char) || value.end_char <= value.start_char
      || value.end_char - value.start_char !== text.length
      || !HASH.test(value.canonical_text_sha256) || value.page_mapping !== "unavailable") {
    fail("claim_evidence_text_locator_invalid");
  }
  return {
    unit: value.unit, shape: value.shape,
    start_char: value.start_char, end_char: value.end_char,
    canonical_text_sha256: value.canonical_text_sha256,
    page_mapping: "unavailable",
  };
}

/** Normalize selected data only; current SQL authority remains a separate gate. */
export function normalizeClaimEvidence(row) {
  if (!row || typeof row !== "object") fail("invalid_transcript_lineage");
  if (typeof row.evidence_id !== "string" || typeof row.source_id !== "string"
      || !UUID.test(row.evidence_id) || !UUID.test(row.source_id)) fail("invalid_transcript_lineage");
  if (typeof row.input_sha256 !== "string" || typeof row.record_hash !== "string"
      || !HASH.test(row.input_sha256) || !HASH.test(row.record_hash)) fail("claim_evidence_hash_invalid");
  const text = typeof row.text === "string" ? row.text : row.value?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 8_000
      || /[\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) fail("invalid_transcript_text");
  if (row.evidence_type === "image_region") fail("claim_evidence_image_semantics_unavailable");
  const time = timing(row);
  const metadata = projectedMetadata(row);
  let descriptor;
  if (!metadata) {
    descriptor = {
      modality: "unknown", evidence_type: "untyped_text", format: null,
      interpretation: "untyped_text", source_locator: { unit: "unavailable" },
      limitations: ["source_modality_unavailable", "source_mapping_unavailable", "speaker_identity_not_asserted"],
    };
  } else if (metadata.evidence_type === "text_span") {
    const document = metadata.source_kind === "document" && DOCUMENT_FORMATS.has(metadata.source_format);
    const plain = metadata.source_kind === "text" && TEXT_FORMATS.has(metadata.source_format);
    if (!document && !plain) fail("claim_evidence_modality_invalid");
    if (time.start_ms !== null || time.end_ms !== null) fail("claim_evidence_text_time_forbidden");
    descriptor = {
      modality: document ? "document" : "text", evidence_type: "text_span", format: metadata.source_format,
      interpretation: "owner_supplied_text", source_locator: textLocator(metadata.source_locator, text),
      limitations: ["page_mapping_unavailable", "speaker_identity_not_asserted"],
    };
  } else if (metadata.evidence_type === "transcript_span") {
    if (!new Set(["audio", "video"]).has(metadata.source_kind)) fail("claim_evidence_modality_invalid");
    if (time.start_ms === null || metadata.source_locator !== null || metadata.source_format !== null) fail("claim_evidence_transcript_locator_invalid");
    descriptor = {
      modality: metadata.source_kind, evidence_type: "transcript_span", format: null,
      interpretation: "machine_transcription",
      source_locator: { unit: "transcript_window_ms", relative_to: "transcription_input", ...time },
      limitations: ["transcription_may_be_incorrect", "word_alignment_unavailable", "original_source_time_mapping_unavailable", "speaker_identity_not_asserted",
        ...(metadata.source_kind === "video" ? ["visual_content_not_observed"] : [])],
    };
  } else fail("claim_evidence_type_unsupported");
  return freeze({
    evidence_id: row.evidence_id.toLowerCase(), source_id: row.source_id.toLowerCase(),
    input_sha256: row.input_sha256, record_hash: row.record_hash, text, ...time,
    evidence: {
      ...descriptor,
      citation: { unit: "utf16_code_units", relative_to: "evidence_text", start_char: 0, end_char: text.length },
    },
  });
}
