// Invented evidence only. No owner material, storage paths, provider calls or keys.
export const RID = '10000000-0000-4000-8000-000000000001';
export const OTHER_RID = '10000000-0000-4000-8000-000000000002';
export const ITEM = '20000000-0000-4000-8000-000000000001';
export const OTHER_ITEM = '20000000-0000-4000-8000-000000000002';
export const SOURCE = '30000000-0000-4000-8000-000000000001';
export const EVIDENCE = '40000000-0000-4000-8000-000000000001';
export const EXCERPT = 'रंग 🙂\r\nपहले आकृति, फिर छाया।';
export const SOURCE_NAME = 'रंग और आकार की मेरी अभ्यास-पुस्तिका.pdf';
export const CLAIM_TEXT = 'I start with shapes before adding shadows.';
export const OTHER_TEXT = 'I practise scales before a song.';
export const FIFTH_TEXT = 'The fifth cited passage supports this proposal.';
export function citation(patch = {}) {
  return {
    excerpt: EXCERPT, entailment: 0.91, source_id: SOURCE, evidence_id: EVIDENCE,
    context_item_id: ITEM, modality: 'document', evidence_type: 'text_span', format: 'pdf',
    interpretation: 'owner_supplied_text',
    citation: { unit: 'utf16_code_units', relative_to: 'evidence_text', start_char: 3, end_char: 3 + EXCERPT.length },
    source_locator: { unit: 'utf16_code_units', relative_to: 'canonical_source_text', shape: 'contiguous', start_char: 103, end_char: 103 + EXCERPT.length, page_mapping: 'unavailable' },
    limitations: ['page_mapping_unavailable', 'speaker_identity_not_asserted'], ...patch,
  };
}
export function transcript(modality = 'audio') {
  return citation({ modality, evidence_type: 'transcript_span', format: null, interpretation: 'machine_transcription',
    source_locator: { unit: 'transcript_window_ms', relative_to: 'transcription_input', start_ms: 1200, end_ms: 4800 },
    limitations: ['transcription_may_be_incorrect', 'word_alignment_unavailable', 'original_source_time_mapping_unavailable', 'speaker_identity_not_asserted', ...(modality === 'video' ? ['visual_content_not_observed'] : [])],
  });
}
export function claim(index, body, previews) {
  return { claim_id: `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`, domain: 'behavior', key: 'art_method', body,
    origin: 'inferred', confidence: 0.91, status: 'proposed', sensitive: false, source_count: previews.length,
    citation_previews: previews, decision: null, reason_code: '', reviewed_at: null, created_at: '2026-09-29T00:00:00Z' };
}
export function claims() {
  return [
    claim(1, CLAIM_TEXT, [citation()]),
    claim(2, OTHER_TEXT, [citation({ context_item_id: OTHER_ITEM })]),
    claim(3, FIFTH_TEXT, [...Array.from({ length: 4 }, () => citation({ context_item_id: OTHER_ITEM })), citation()]),
    claim(4, 'Audio evidence remains a fallible transcription.', [transcript()]),
    claim(5, 'Video audio is not an interpretation of the picture.', [transcript('video')]),
    claim(6, 'An older saved proposal has no typed source provenance.', [{ excerpt: 'Saved words from an older synthetic note.', entailment: 0.8 }]),
    claim(7, 'Malformed metadata must not become an exact source preview.', [citation({ modality: 'image', excerpt: 'MALFORMED_PREVIEW_MUST_NOT_RENDER' })]),
  ];
}
export function personStatus(replicaId = RID, scenario = 'normal') {
  return { replica_id: replicaId, claims: scenario === 'empty' ? [] : claims(), profiles: [],
    readiness: { ready: false, blockers: ['boundary_evidence_required'], conflicts: [], accepted_claims: 0 } };
}
export const extractionStatus = replicaId => ({ replica_id: replicaId, readiness: { ready: false, blockers: [], eligible_spans: 0 }, runs: [] });
export const locker = () => ({ items: [ITEM, OTHER_ITEM].map(item_id => ({ item_id, kind: 'file', format: 'pdf', source_name: SOURCE_NAME, source_url: '', byte_size: 1800,
  extracted_chars: 200, extractor: 'synthetic', status: 'extracted', refusal_reason: '', routed_to: '', mine_skip_reason: 'no_candidates_cleared_held_out',
  authorship: 'mine', owner_speaker: '', consent_scope: 'own_context', proposal: null, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z' })),
  quota: { items: 2, bytes: 3600, max_items: 20, max_bytes: 2000000 }, limits: { max_item_bytes: 1000000, accepted_file_formats: ['pdf'], routed_elsewhere: {} } });
