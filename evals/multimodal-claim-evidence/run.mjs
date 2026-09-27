import assert from "node:assert/strict";
import { normalizeClaimEvidence } from "../../api/_experience-compiler/claim-evidence.js";
import { createContextTextEvidence } from "../../api/_experience-compiler/context-evidence.js";
import {
  CLAIM_EXTRACTION_SCHEMA, CLAIM_EXTRACTION_PROMPT, createExtractionBatch,
  extractionMessages, redactTranscript, validateExtractionOutput,
} from "../../api/_claim-extraction/contracts.js";
import { createAzureFoundryClaimExtractor } from "../../api/_claim-extraction/providers/azure-foundry.js";
import {
  ELIGIBLE_TRANSCRIPTS_SQL, CLAIM_EXTRACTION_OPEN_SQL, CLAIM_EXTRACTION_PERSIST_SQL,
  OWNED_EXTRACTION_SQL, CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL, extractOwnedClaims,
} from "../../api/_replica-claims.js";

const uid = value => `60000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const OWNER = uid(1), REPLICA = uid(2), RUN = uid(3);
const text = "Contact asha@example.com.\r\nमेरी कला 🙂 tells stories.";
let checks = 0;
const test = async (name, action) => { await action(); console.log(`PASS ${++checks}: ${name}`); };
const refuses = (row, code) => assert.throws(() => createExtractionBatch([row]), error => error.code === code);

function legacy(overrides = {}) {
  return {
    evidence_id: uid(10), source_id: uid(11), input_sha256: "a".repeat(64), record_hash: "b".repeat(64),
    text, language: "hi-IN", confidence: 0.94, span_start_ms: null, span_end_ms: null, ...overrides,
  };
}
function typed(modality = "text", overrides = {}) {
  const speech = modality === "audio" || modality === "video";
  return legacy({
    evidence_type: speech ? "transcript_span" : "text_span", source_kind: modality,
    source_format: speech ? null : modality === "document" ? "pdf" : "text",
    source_locator: speech ? null : {
      unit: "utf16_code_units", shape: "contiguous", start_char: 80, end_char: 80 + text.length,
      canonical_text_sha256: "c".repeat(64), page_mapping: "unavailable",
    },
    span_start_ms: speech ? 1200 : null, span_end_ms: speech ? 9500 : null,
    ...overrides,
  });
}

await test("legacy rows remain explicitly untyped and null time remains null", () => {
  const row = createExtractionBatch([legacy()]).spans[0];
  assert.equal(row.evidence.modality, "unknown");
  assert.equal(row.evidence.interpretation, "untyped_text");
  assert.equal(row.start_ms, null); assert.equal(row.end_ms, null);
  assert.deepEqual(row.evidence.source_locator, { unit: "unavailable" });
});
await test("sparse or inherited array entries cannot become null prompt evidence", () => {
  const sparse = new Array(2);
  sparse[1] = typed();
  assert.throws(() => createExtractionBatch(sparse), error => error.code === "claim_evidence_sparse_batch");
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: typed() }));
  assert.throws(() => createExtractionBatch(inherited), error => error.code === "claim_evidence_sparse_batch");
});
await test("document source coordinates remain distinct from evidence-relative UTF-16 citations", () => {
  const row = createExtractionBatch([typed("document")]).spans[0];
  assert.equal(row.evidence.modality, "document"); assert.equal(row.evidence.format, "pdf");
  assert.equal(row.evidence.source_locator.start_char, 80);
  assert.equal(row.evidence.citation.start_char, 0); assert.equal(row.evidence.citation.end_char, text.length);
  assert.equal(row.evidence.source_locator.page_mapping, "unavailable");
  assert.equal(row.start_ms, null); assert.equal(row.end_ms, null);
});
await test("ASR remains machine transcription and video audio never claims visual knowledge", () => {
  for (const kind of ["audio", "video"]) {
    const row = createExtractionBatch([typed(kind)]).spans[0];
    assert.equal(row.evidence.modality, kind);
    assert.equal(row.evidence.interpretation, "machine_transcription");
    assert.deepEqual(row.evidence.source_locator, { unit: "transcript_window_ms", relative_to: "transcription_input", start_ms: 1200, end_ms: 9500 });
    assert.ok(row.evidence.limitations.includes("speaker_identity_not_asserted"));
    assert.ok(row.evidence.limitations.includes("word_alignment_unavailable"));
    assert.ok(row.evidence.limitations.includes("original_source_time_mapping_unavailable"));
    assert.equal(row.evidence.limitations.includes("visual_content_not_observed"), kind === "video");
  }
});
await test("redaction preserves CRLF, Hindi, emoji and all evidence-relative offsets", () => {
  const redacted = redactTranscript(text);
  assert.equal(redacted.text.length, text.length); assert.ok(redacted.text.includes("\r\nमेरी कला 🙂"));
  assert.ok(!redacted.text.includes("asha@example.com"));
  const quote = "मेरी कला 🙂 tells stories";
  assert.equal(redacted.text.indexOf(quote), text.indexOf(quote));
  const batch = createExtractionBatch([typed()]);
  const output = validateExtractionOutput({ claims: [{
    domain: "knowledge", key: "art_storytelling", body: "My art tells stories.", origin: "observed",
    confidence: 0.9, sensitive: false, valid_from: null, valid_to: null,
    citations: [{ evidence_id: uid(10), start_char: text.indexOf(quote), end_char: text.indexOf(quote) + quote.length, quote, entailment: 0.95 }],
  }] }, batch);
  assert.equal(output.proposals.length, 1);
  const citation = output.proposals[0].citations[0];
  assert.equal(text.slice(citation.start_char, citation.end_char), quote);
});
await test("only selected metadata and redacted text reach the provider message", () => {
  const row = typed("audio", { owner_user_id: OWNER, source_url: "https://private.invalid/secret",
    value: { provenance: { private_notes: "do not send this" }, speaker: { owner_verified: true } } });
  const wire = JSON.stringify(extractionMessages(createExtractionBatch([row])));
  for (const privateValue of [OWNER, row.source_id, row.source_url, "do not send this", "asha@example.com", "owner_verified"]) {
    assert.ok(!wire.includes(privateValue), privateValue);
  }
  assert.ok(wire.includes("speaker_identity_not_asserted"));
  const document = typed("document");
  const documentWire = JSON.stringify(extractionMessages(createExtractionBatch([document])));
  assert.ok(!documentWire.includes(document.source_locator.canonical_text_sha256));
  assert.ok(!documentWire.includes("canonical_text_sha256"));
});
await test("complete canonical text records retain an exact verified compatibility path", () => {
  const [record] = createContextTextEvidence({
    replicaId: REPLICA, ownerUserId: OWNER, sourceId: uid(11), itemId: uid(12), inputSha256: "a".repeat(64),
    body: text, authorship: "mine", format: "text", extractor: "text-plain/v1", segments: [],
  });
  const batch = createExtractionBatch([{ ...record, text: record.value.text, language: record.value.language }]);
  assert.equal(batch.spans[0].evidence.modality, "text");
  refuses({ ...record, text: "different projected text" }, "claim_evidence_text_mismatch");
  refuses({ ...record, record_hash: "d".repeat(64) }, "context_evidence_commitment_invalid");
});
await test("partial typed projection is refused instead of silently downgraded", () => {
  for (const key of ["evidence_type", "source_kind", "source_locator", "source_format"]) {
    const row = typed(); delete row[key]; refuses(row, "claim_evidence_metadata_incomplete");
  }
  refuses({ ...legacy(), evidence_type: "transcript_span" }, "claim_evidence_metadata_incomplete");
});
await test("image geometry cannot be promoted to textual owner knowledge", () => {
  refuses(typed("text", { evidence_type: "image_region", source_kind: "image" }), "claim_evidence_image_semantics_unavailable");
  refuses(typed("text", { source_kind: "image" }), "claim_evidence_modality_invalid");
  refuses(typed("audio", { source_kind: "image" }), "claim_evidence_modality_invalid");
});
await test("invalid identities hashes duplicated evidence and unsupported type refuse", () => {
  refuses(legacy({ evidence_id: "not-a-uuid" }), "invalid_transcript_lineage");
  for (const key of ["input_sha256", "record_hash"]) {
    for (const bad of [null, "", "A".repeat(64), "g".repeat(64)]) refuses(legacy({ [key]: bad }), "claim_evidence_hash_invalid");
  }
  assert.throws(() => createExtractionBatch([legacy(), legacy()]), /claim_evidence_duplicate_id/);
  refuses(typed("text", { evidence_type: "language_span" }), "claim_evidence_type_unsupported");
});
await test("invalid or fabricated time ranges cannot acquire source coordinates", () => {
  for (const pair of [[null, 10], [0, null], [false, 10], ["0", 10], [-1, 10], [10, 10], [10, 9], [0, Infinity]]) {
    refuses(typed("audio", { span_start_ms: pair[0], span_end_ms: pair[1] }), "claim_evidence_time_range_invalid");
  }
  refuses(typed("audio", { span_start_ms: null, span_end_ms: null }), "claim_evidence_transcript_locator_invalid");
  refuses(typed("text", { span_start_ms: 0, span_end_ms: 10 }), "claim_evidence_text_time_forbidden");
});
await test("source text coordinates reject gaps, new units, invented pages and hidden metadata", () => {
  for (const delta of [{ end_char: 81 }, { start_char: -1 }, { unit: "utf8_bytes" }, { page_mapping: "page_1" },
    { canonical_text_sha256: "bad" }, { private_text: "hidden" }, { shape: "fragment_map" }]) {
    const row = typed(); row.source_locator = { ...row.source_locator, ...delta };
    refuses(row, "claim_evidence_text_locator_invalid");
  }
  refuses(typed("document", { source_format: "image" }), "claim_evidence_modality_invalid");
});
await test("source descriptors are deeply immutable and exclude malformed Unicode", () => {
  const normalized = normalizeClaimEvidence(typed());
  assert.ok(Object.isFrozen(normalized.evidence.source_locator));
  assert.ok(Object.isFrozen(normalized.evidence.limitations));
  refuses(legacy({ text: "bad\ud800" }), "invalid_transcript_text");
  refuses(legacy({ text: "bad\u0000text" }), "invalid_transcript_text");
});
await test("every outbound metadata change changes the extraction commitment", () => {
  const original = typed("document");
  const hash = createExtractionBatch([original]).input_set_hash;
  const changes = [
    { language: "en" }, { confidence: 0.8 }, { source_format: "docx" },
    { source_locator: { ...original.source_locator, start_char: 180, end_char: 180 + text.length } },
    { source_locator: { ...original.source_locator, canonical_text_sha256: "d".repeat(64) } },
  ];
  for (const delta of changes) assert.notEqual(createExtractionBatch([{ ...original, ...delta }]).input_set_hash, hash);
  assert.notEqual(createExtractionBatch([typed("audio")]).input_set_hash, createExtractionBatch([typed("video")]).input_set_hash);
  const two = [typed(), typed("audio", { evidence_id: uid(20), source_id: uid(21) })];
  assert.equal(createExtractionBatch(two).input_set_hash, createExtractionBatch([...two].reverse()).input_set_hash);
  assert.equal(CLAIM_EXTRACTION_SCHEMA, "vyakti.claim-extraction.v2");
  assert.equal(CLAIM_EXTRACTION_PROMPT, "claim-extractor/v3");
});
await test("batch and text bounds remain enforced without truncation", () => {
  assert.throws(() => createExtractionBatch([]), /transcript_batch_required/);
  assert.throws(() => createExtractionBatch(Array.from({ length: 41 }, (_, i) => legacy({ evidence_id: uid(100 + i) }))), /transcript_batch_required/);
  refuses(legacy({ text: "x".repeat(8001) }), "invalid_transcript_text");
  assert.throws(() => createExtractionBatch(Array.from({ length: 4 }, (_, i) => legacy({ evidence_id: uid(100 + i), text: "x".repeat(8000) }))), /transcript_batch_too_large/);
});

function database(rows, { open = true, persist = true, consent = true } = {}) {
  const writes = [];
  const db = async (sql, params = []) => {
    if (sql === OWNED_EXTRACTION_SQL) return [{ replica_id: REPLICA, consent_ids: [uid(50), uid(51)], transcription_consent: consent, training_consent: consent }];
    if (sql === ELIGIBLE_TRANSCRIPTS_SQL) return rows;
    if (sql === CLAIM_EXTRACTION_OPEN_SQL) { writes.push({ sql, params }); return open ? [{ run_id: RUN, state: "extracting", acquired: true }] : []; }
    if (sql === CLAIM_EXTRACTION_PERSIST_SQL) { writes.push({ sql, params }); return persist ? [{ run_id: RUN, state: "complete", proposed_count: 0 }] : []; }
    if (sql.includes("from vy_replica_claim_extraction x join") || sql.includes("from vy_replica_claim_extraction_queue q") || sql.includes("update vy_replica_claim_extraction")) return [];
    throw Error("unexpected_synthetic_database_statement");
  };
  return { db, writes };
}

await test("actual extraction caller carries text PDF audio video metadata into the Azure request", async () => {
  const rows = ["text", "document", "audio", "video"].map((kind, index) => typed(kind, { evidence_id: uid(100 + index), source_id: uid(200 + index) }));
  const { db, writes } = database(rows);
  let calls = 0, sent;
  const azure = createAzureFoundryClaimExtractor({ endpoint: "https://offline-fixture.services.ai.azure.com", model: "offline-fixture",
    apiKey: "synthetic-offline-key-no-authority", fetchImpl: async (_url, options) => {
      calls++; sent = JSON.parse(options.body);
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"claims":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 },
      }) };
    },
  });
  // The genuine Azure serializer runs against an injected response; this fake
  // orchestration adapter has no billing meter and cannot reserve real money.
  const extractor = { family: "claim-extraction", name: "offline-fixture", version: "1", model: "offline-fixture",
    extract: azure.extract, messagesForBudget: azure.messagesForBudget };
  const result = await extractOwnedClaims(db, OWNER, REPLICA, extractor);
  assert.equal(result.state, "complete"); assert.equal(calls, 1);
  const outbound = JSON.parse(sent.messages[1].content).spans;
  assert.deepEqual(outbound.map(row => row.evidence.modality), ["text", "document", "audio", "video"]);
  assert.ok(outbound.every(row => !row.text.includes("asha@example.com")));
  assert.ok(outbound[3].evidence.limitations.includes("visual_content_not_observed"));
  assert.equal(writes[0].params[8], createExtractionBatch(rows).input_set_hash);
  assert.equal(writes[1].params[4], writes[0].params[8]);
  assert.ok(!writes.some(row => /insert into vy_replica_claim_decision|insert into vy_replica_profile/.test(row.sql)));
});
await test("unavailable authority or revoked consent prevents every provider invocation", async () => {
  let calls = 0;
  const extractor = { family: "claim-extraction", name: "offline-fixture", version: "1", model: "offline-fixture",
    extract: async () => { calls++; return { output: { proposals: [], rejected: [] } }; } };
  for (const options of [{ rows: [], code: "claim_extraction_not_ready" },
    { rows: [typed()], consent: false, code: "claim_extraction_not_ready" },
    { rows: [typed()], open: false, code: "claim_extraction_authorization_changed" }]) {
    const { db } = database(options.rows, options);
    await assert.rejects(() => extractOwnedClaims(db, OWNER, REPLICA, extractor), error => error.code === options.code);
  }
  assert.equal(calls, 0);
});
await test("post-provider source authority refusal cannot return a successful candidate", async () => {
  const { db } = database([typed()], { persist: false });
  let calls = 0;
  const extractor = { family: "claim-extraction", name: "offline-fixture", version: "1", model: "offline-fixture",
    extract: async () => { calls++; return { output: { proposals: [], rejected: [] } }; } };
  await assert.rejects(() => extractOwnedClaims(db, OWNER, REPLICA, extractor), /claim_extraction_persist_denied/);
  assert.equal(calls, 1);
});
await test("existing authority and completed-schema exclusion remain explicit SQL predicates", () => {
  assert.ok(ELIGIBLE_TRANSCRIPTS_SQL.includes("xr.schema_version=$3 and xr.state='complete'"));
  assert.ok(ELIGIBLE_TRANSCRIPTS_SQL.includes(CONTEXT_TEXT_EVIDENCE_AUTHORITY_SQL));
  assert.match(ELIGIBLE_TRANSCRIPTS_SQL, /speaker\.evidence_type='speaker_segment'/);
  assert.match(ELIGIBLE_TRANSCRIPTS_SQL, /d\.decision='accepted'/);
  assert.match(ELIGIBLE_TRANSCRIPTS_SQL, /s\.contains_third_parties=false/);
  assert.match(ELIGIBLE_TRANSCRIPTS_SQL, /order by s\.created_at asc,s\.source_id asc,e\.span_start_ms asc nulls last/);
});
console.log(`\n${checks} multimodal claim-evidence checks passed (synthetic/offline only).`);
