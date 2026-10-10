// Deterministic membership selection over canonical, already-authorized text
// evidence. This module never queries storage and never infers new facts.
import { canonicalJson, sha256Hex } from './_provenance/contracts.js';

export const PRIVATE_TEXT_EVIDENCE_BUDGET = 8_000;
const MAX_RECORDS = 128;
const MAX_SELECTED = 32;
const MAX_QUERY_TOKENS = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const GENERIC = new Set(['a','an','and','are','can','did','do','does','explain','how','i','is','it','that','the','these','this','those','what','why','you',
  'aur','hai','ho','hum','ka','kaise','ke','ki','ko','kya','kyun','main','mera','mere','meri','tha','thi','us','woh','yeh']);

function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
function tokens(value, limit) {
  const out = new Set();
  for (const token of String(value || '').normalize('NFKC').toLowerCase().match(TOKEN) || []) {
    out.add(token);
    if (out.size === limit) break;
  }
  return [...out];
}
function signalToken(token) {
  return !GENERIC.has(token);
}
function directRecord(record) {
  const locator = record?.value?.locator;
  const body = record?.value?.text;
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || typeof record.evidence_id !== 'string' || !UUID.test(record.evidence_id)
      || typeof record.record_hash !== 'string' || !HASH.test(record.record_hash)
      || typeof body !== 'string' || !body.length || body.length > PRIVATE_TEXT_EVIDENCE_BUDGET
      || locator?.shape !== 'contiguous' || !Number.isSafeInteger(locator.start_char)
      || !Number.isSafeInteger(locator.end_char) || locator.start_char < 0
      || locator.end_char <= locator.start_char || locator.end_char - locator.start_char !== body.length) {
    fail('rehearsal_evidence_selection_invalid');
  }
  return { record, body, start: locator.start_char, end: locator.end_char };
}
function basis(questionHash, selected) {
  if (typeof questionHash !== 'string' || !HASH.test(questionHash)) fail('rehearsal_evidence_selection_invalid');
  return {
    schema: 'private-text-evidence-selection/v1',
    question_hash: questionHash,
    records: selected.map(({ record, body, start, end }) => ({
      evidence_id: record.evidence_id,
      record_hash: record.record_hash,
      start_char: start,
      end_char: end,
      body_sha256: sha256Hex(body),
    })),
  };
}

export function selectPrivateTextEvidence(records, question, questionHash, fallbackEvidenceIds = []) {
  if (!Array.isArray(records) || !records.length || records.length > MAX_RECORDS
      || typeof question !== 'string' || !question.trim() || question.length > 2_000
      || !Array.isArray(fallbackEvidenceIds) || fallbackEvidenceIds.length > MAX_SELECTED) {
    fail('rehearsal_evidence_selection_invalid');
  }
  const candidates = records.map(directRecord).sort((a, b) => a.start - b.start || a.record.evidence_id.localeCompare(b.record.evidence_id));
  const query = tokens(question, MAX_QUERY_TOKENS).filter(signalToken);
  const querySet = new Set(query);
  const frequency = new Map();
  const terms = candidates.map(candidate => {
    // Each body is already capped at 8k units. Scan the complete chunk so a
    // distinctive term after hundreds of different words cannot disappear.
    const row = new Set(tokens(candidate.body, Number.POSITIVE_INFINITY));
    for (const term of querySet) if (row.has(term)) frequency.set(term, (frequency.get(term) || 0) + 1);
    return row;
  });
  const scored = candidates.map((candidate, index) => {
    const matched = query.filter(term => terms[index].has(term));
    const weighted = matched.reduce((sum, term) => sum + candidates.length + 1 - (frequency.get(term) || 0), 0);
    return { candidate, index, matched: matched.length, weighted };
  }).filter(row => row.matched > 0)
    .sort((a, b) => b.weighted - a.weighted || b.matched - a.matched || a.index - b.index);
  const fallback = new Map(fallbackEvidenceIds.map((id, index) => [String(id), index]));
  const ranked = scored.length
    ? scored.map(row => row.candidate)
    : fallback.size
      ? [...candidates].sort((a, b) => (fallback.get(a.record.evidence_id) ?? Number.MAX_SAFE_INTEGER)
        - (fallback.get(b.record.evidence_id) ?? Number.MAX_SAFE_INTEGER) || a.start - b.start)
      : candidates;
  const selected = [];
  let used = 0;
  for (const candidate of ranked) {
    if (selected.length >= MAX_SELECTED || used + candidate.body.length > PRIVATE_TEXT_EVIDENCE_BUDGET) continue;
    selected.push(candidate); used += candidate.body.length;
  }
  if (!selected.length) fail('rehearsal_evidence_selection_unavailable');
  selected.sort((a, b) => a.start - b.start || a.record.evidence_id.localeCompare(b.record.evidence_id));
  const unsigned = basis(questionHash, selected);
  const commitment = { ...unsigned, selection_hash: sha256Hex(canonicalJson(unsigned)) };
  return { selected, commitment, matched: scored.length > 0 };
}

export function restorePrivateTextEvidenceSelection({ commitment, questionHash, evidenceRecords, canonicalRecords, body, itemId, sourceId }) {
  if (!commitment || typeof commitment !== 'object' || Array.isArray(commitment)
      || commitment.schema !== 'private-text-evidence-selection/v1'
      || commitment.question_hash !== questionHash || !Array.isArray(commitment.records)
      || !commitment.records.length || commitment.records.length > MAX_SELECTED
      || typeof commitment.selection_hash !== 'string' || !HASH.test(commitment.selection_hash)
      || typeof body !== 'string' || typeof itemId !== 'string' || !UUID.test(itemId)
      || typeof sourceId !== 'string' || !UUID.test(sourceId) || !Array.isArray(evidenceRecords)
      || evidenceRecords.length < commitment.records.length || evidenceRecords.length > MAX_RECORDS
      || !Array.isArray(canonicalRecords) || canonicalRecords.length < commitment.records.length || canonicalRecords.length > MAX_RECORDS) {
    fail('rehearsal_evidence_selection_invalid');
  }
  const unsigned = { schema: commitment.schema, question_hash: commitment.question_hash, records: commitment.records };
  if (sha256Hex(canonicalJson(unsigned)) !== commitment.selection_hash) fail('rehearsal_evidence_selection_changed');
  const available = new Map(evidenceRecords.map(record => [record.id, record.hash]));
  const canonical = new Map(canonicalRecords.map(record => {
    const direct = directRecord(record);return[record.evidence_id,direct];
  }));
  const seen = new Set(); let used = 0; let previousEnd = -1;
  const contexts = commitment.records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || typeof record.evidence_id !== 'string' || !UUID.test(record.evidence_id) || seen.has(record.evidence_id)
        || typeof record.record_hash !== 'string' || !HASH.test(record.record_hash)
        || available.get(record.evidence_id) !== record.record_hash || canonical.get(record.evidence_id)?.record?.record_hash !== record.record_hash
        || !Number.isSafeInteger(record.start_char) || !Number.isSafeInteger(record.end_char)
        || record.start_char < 0 || record.end_char <= record.start_char || record.start_char < previousEnd
        || record.end_char > body.length || typeof record.body_sha256 !== 'string' || !HASH.test(record.body_sha256)) {
      fail('rehearsal_evidence_selection_changed');
    }
    const selectedBody = body.slice(record.start_char, record.end_char);
    const exact=canonical.get(record.evidence_id);
    if (!exact||exact.start!==record.start_char||exact.end!==record.end_char||exact.body!==selectedBody
        || !selectedBody || selectedBody.length > PRIVATE_TEXT_EVIDENCE_BUDGET
        || sha256Hex(selectedBody) !== record.body_sha256) fail('rehearsal_evidence_selection_changed');
    used += selectedBody.length;
    if (used > PRIVATE_TEXT_EVIDENCE_BUDGET) fail('rehearsal_evidence_selection_changed');
    seen.add(record.evidence_id); previousEnd = record.end_char;
    return { itemId, sourceId, hash: record.body_sha256, body: selectedBody };
  });
  return { contexts, commitment };
}
