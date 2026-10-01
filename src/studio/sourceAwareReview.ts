import type { ClaimCitationPreview, ReplicaClaim, SourceAwareClaimCitation } from "./types";

export type ReviewSourceSelection = { itemId: string; label?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const typedKeys = ["source_id", "evidence_id", "context_item_id", "modality", "evidence_type", "format", "interpretation", "citation", "source_locator", "limitations"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const range = (start: unknown, end: unknown): boolean => Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number(start) >= 0 && Number(end) > Number(start);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Display projection only. The authenticated server, never this filter, grants authority. */
export function reviewCitation(value: unknown): ClaimCitationPreview | SourceAwareClaimCitation | null {
  if (!record(value) || typeof value.excerpt !== "string" || !value.excerpt.trim() || value.excerpt.length > 8000
      || typeof value.entailment !== "number" || !Number.isFinite(value.entailment) || value.entailment < 0 || value.entailment > 1) return null;
  if (!typedKeys.some(key => Object.hasOwn(value, key))) {
    return exactKeys(value, ["excerpt", "entailment"]) ? { excerpt: value.excerpt, entailment: value.entailment } : null;
  }
  if (!exactKeys(value, ["excerpt", "entailment", ...typedKeys])
      || typeof value.source_id !== "string" || !UUID.test(value.source_id)
      || typeof value.evidence_id !== "string" || !UUID.test(value.evidence_id)
      || (value.context_item_id !== null && (typeof value.context_item_id !== "string" || !UUID.test(value.context_item_id)))
      || !record(value.citation) || !exactKeys(value.citation, ["unit", "relative_to", "start_char", "end_char"])
      || value.citation.unit !== "utf16_code_units" || value.citation.relative_to !== "evidence_text"
      || !range(value.citation.start_char, value.citation.end_char)
      || Number(value.citation.end_char) - Number(value.citation.start_char) !== value.excerpt.length
      || !record(value.source_locator) || !Array.isArray(value.limitations)) return null;
  const locator = value.source_locator;
  const suppliedLimitations = value.limitations;
  let limitations: string[];
  if (value.evidence_type === "text_span") {
    const validFormat = value.modality === "text" ? ["text", "markdown"].includes(String(value.format))
      : value.modality === "document" && ["pdf", "docx"].includes(String(value.format));
    if (!validFormat || value.interpretation !== "owner_supplied_text"
        || !exactKeys(locator, ["unit", "relative_to", "shape", "start_char", "end_char", "page_mapping"])
        || locator.unit !== "utf16_code_units" || locator.relative_to !== "canonical_source_text" || locator.shape !== "contiguous"
        || locator.page_mapping !== "unavailable" || !range(locator.start_char, locator.end_char)
        || Number(locator.end_char) - Number(locator.start_char) !== value.excerpt.length) return null;
    limitations = ["page_mapping_unavailable", "speaker_identity_not_asserted"];
  } else if (value.evidence_type === "transcript_span") {
    if (!["audio", "video"].includes(String(value.modality)) || value.format !== null || value.interpretation !== "machine_transcription"
        || !exactKeys(locator, ["unit", "relative_to", "start_ms", "end_ms"])
        || locator.unit !== "transcript_window_ms" || locator.relative_to !== "transcription_input" || !range(locator.start_ms, locator.end_ms)) return null;
    limitations = ["transcription_may_be_incorrect", "word_alignment_unavailable", "original_source_time_mapping_unavailable", "speaker_identity_not_asserted"];
    if (value.modality === "video") limitations.push("visual_content_not_observed");
  } else return null;
  if (suppliedLimitations.length !== limitations.length || !limitations.every(item => suppliedLimitations.includes(item))) return null;
  return value as unknown as SourceAwareClaimCitation;
}

export function isSourceAwareCitation(value: ClaimCitationPreview | SourceAwareClaimCitation): value is SourceAwareClaimCitation {
  return "source_id" in value;
}

export function claimMatchesReviewSource(claim: ReplicaClaim, itemId: string): boolean {
  if (!UUID.test(itemId) || !Array.isArray(claim.citation_previews)) return false;
  return claim.citation_previews.some(value => {
    const citation = reviewCitation(value);
    return citation && isSourceAwareCitation(citation) && citation.context_item_id?.toLowerCase() === itemId.toLowerCase();
  });
}

export function reviewSourceLabel(value: unknown): string {
  if (typeof value !== "string") return "Selected source";
  const label = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
  if (!label || /(?:https?:\/\/|www\.)/i.test(label) || UUID.test(label)) return "Selected source";
  return Array.from(label).slice(0, 160).join("");
}

export function citationSourceLabel(citation: SourceAwareClaimCitation): string {
  if (citation.modality === "audio") return "Audio transcript";
  if (citation.modality === "video") return "Video transcript";
  if (citation.format === "pdf") return "PDF document";
  if (citation.format === "docx") return "Word document";
  if (citation.format === "markdown") return "Markdown text";
  return "Written text";
}
