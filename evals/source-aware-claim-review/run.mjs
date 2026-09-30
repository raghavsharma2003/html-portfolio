// Offline caller/projection and SQL-shape controls. This does not execute SQL.
import assert from "node:assert/strict";
import { CLAIMS_SQL, citedEvidenceAuthoritySql, clientClaim, ownedPersonModelStatus } from "../../api/_person-model.js";
import { createContextTextEvidence } from "../../api/_experience-compiler/context-evidence.js";
import { sha256Hex } from "../../api/_provenance/contracts.js";
import { CLAIM_EXTRACTION_JSON_SCHEMA, createExtractionBatch, validateExtractionOutput } from "../../api/_claim-extraction/contracts.js";

const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const ITEM = "40000000-0000-4000-8000-000000000004";
const EVIDENCE = "50000000-0000-4000-8000-000000000005";
const OTHER = "60000000-0000-4000-8000-000000000006";
const HASH = "a".repeat(64);
let checks = 0;
async function check(name, task) { await task(); console.log(`ok ${++checks} - ${name}`); }

const row = citations => ({
  claim_id: "1", domain: "knowledge", key: "art_method", body: "Start with observation, then explain the choice.",
  origin: "inferred", confidence: 0.86, status: "proposed", sensitive: false,
  source_ids: [SOURCE], citation_previews: citations, decision: null,
});
const text = "पहले देखो 🎨\r\n  then explain.\tKeep the spaces.";
function projection(format = "text", start = 0, end = text.length) {
  const record = createContextTextEvidence({
    replicaId: RID, ownerUserId: OWNER, sourceId: SOURCE, itemId: ITEM,
    inputSha256: HASH, body: text, format, authorship: "mine",
  })[0];
  const excerpt = record.value.text.slice(start, end);
  return {
    excerpt, entailment: 0.95, review_schema: "vyakti.source-aware-claim-review.v1",
    evidence_id: record.evidence_id, source_id: record.source_id, context_item_id: ITEM,
    evidence_type: record.evidence_type, source_kind: ["pdf", "docx"].includes(format) ? "document" : "text",
    source_format: format, source_locator: record.value.locator, evidence_text: record.value.text,
    span_start_ms: null, span_end_ms: null, start_char: start, end_char: end,
    input_sha256: record.input_sha256, record_hash: record.record_hash, quote_hash: sha256Hex(excerpt),
  };
}
function transcript(kind = "audio") {
  return { ...projection(), evidence_id: EVIDENCE, context_item_id: null,
    evidence_type: "transcript_span", source_kind: kind, source_format: null, source_locator: null,
    span_start_ms: 2_300, span_end_ms: 6_100 };
}
const previews = citation => clientClaim(row([citation])).citation_previews;

function authorityShape(sql) {
  assert.ok(sql.includes(citedEvidenceAuthoritySql("e", "s")), "existing current citation authority is embedded");
  for (const fragment of [
    "r.owner_user_id=$2::uuid", "c.replica_id=$1::uuid and c.owner_user_id=$2::uuid",
    "e.evidence_id=cc.evidence_id and e.source_id=cc.source_id",
    "e.replica_id=cc.replica_id and e.owner_user_id=cc.owner_user_id",
    "s.source_id=cc.source_id and s.replica_id=cc.replica_id and s.owner_user_id=cc.owner_user_id",
    "cc.claim_id=c.claim_id and cc.replica_id=c.replica_id and cc.owner_user_id=c.owner_user_id",
    "cc.source_id=any(c.source_ids)", "r.lifecycle not in ('revoked','purging')",
    "review_consent.replica_id=r.replica_id and review_consent.owner_user_id=r.owner_user_id",
    "review_consent.scope='training' and review_consent.policy_version=r.policy_version",
    "review_consent.revoked_at is null", "review_consent.expires_at is null or review_consent.expires_at>now()",
    "i.source_id=s.source_id and i.replica_id=s.replica_id and i.owner_user_id=s.owner_user_id",
    "i.item_id::text=e.value#>>'{provenance,context_item_id}'",
    "cc.end_char-cc.start_char between 1 and 500", "resolved.citation_quote is not null",
    "encode(digest(convert_to(resolved.citation_quote,'UTF8'),'sha256'),'hex')=cc.quote_hash",
    "order by cc.created_at,cc.start_char limit 5", "order by c.created_at desc limit 500",
  ]) assert.ok(sql.includes(fragment), `missing SQL boundary: ${fragment}`);
}

async function status(citations, { consent = true, owned = true } = {}) {
  const calls = [];
  const result = await ownedPersonModelStatus(async (sql, params) => {
    calls.push({ sql, params });
    assert.deepEqual(params, [RID, OWNER]);
    if (sql === CLAIMS_SQL) { authorityShape(sql); return [row(citations)]; }
    if (sql.includes("select r.replica_id,exists")) return owned ? [{ replica_id: RID, training_consent: consent }] : [];
    if (sql.includes("from vy_replica_profile p")) return [];
    throw new Error("unexpected_read");
  }, OWNER, RID);
  return { result, calls };
}

await check("real owned status caller returns exact owner text with review still provisional", async () => {
  const { result, calls } = await status([projection()]);
  assert.equal(calls.length, 3);
  assert.equal(result.claims[0].decision, null);
  assert.equal(result.claims[0].origin, "inferred");
  assert.equal(result.claims[0].citation_previews[0].excerpt, text);
  assert.equal(result.claims[0].citation_previews[0].interpretation, "owner_supplied_text");
});

await check("source identity and actual distinct Context Locker item mapping survive the caller", async () => {
  const { result } = await status([projection()]);
  const citation = result.claims[0].citation_previews[0];
  assert.equal(citation.source_id, SOURCE);
  assert.equal(citation.context_item_id, ITEM);
  assert.notEqual(citation.context_item_id, citation.source_id);
  assert.equal(citation.evidence_type, "text_span");
});

await check("PDF and DOCX retain canonical text coordinates without invented pages or media times", () => {
  for (const format of ["pdf", "docx"]) {
    const citation = previews(projection(format, 0, 10))[0];
    assert.equal(citation.modality, "document");
    assert.equal(citation.format, format);
    assert.deepEqual(citation.citation, { unit: "utf16_code_units", relative_to: "evidence_text", start_char: 0, end_char: 10 });
    assert.deepEqual(citation.source_locator, { unit: "utf16_code_units", relative_to: "canonical_source_text",
      shape: "contiguous", start_char: 0, end_char: 10, page_mapping: "unavailable" });
    assert.ok(!JSON.stringify(citation).includes("start_ms"));
  }
});

await check("text quote offsets include the canonical chunk offset, not an evidence-relative source label", () => {
  const raw = projection("markdown", 0, 10);
  raw.source_locator = { ...raw.source_locator, start_char: 8_000, end_char: 8_000 + text.length };
  const citation = previews(raw)[0];
  assert.equal(citation.source_locator.start_char, 8_000);
  assert.equal(citation.source_locator.end_char, 8_010);
  assert.equal(citation.citation.start_char, 0);
});

await check("audio and video state transcription-input windows and unavailable original/word alignment", () => {
  for (const kind of ["audio", "video"]) {
    const citation = previews(transcript(kind))[0];
    assert.equal(citation.modality, kind);
    assert.equal(citation.interpretation, "machine_transcription");
    assert.equal(citation.context_item_id, null);
    assert.deepEqual(citation.source_locator, { unit: "transcript_window_ms", relative_to: "transcription_input", start_ms: 2_300, end_ms: 6_100 });
    assert.ok(citation.limitations.includes("original_source_time_mapping_unavailable"));
    assert.ok(citation.limitations.includes("word_alignment_unavailable"));
    assert.equal(citation.limitations.includes("visual_content_not_observed"), kind === "video");
  }
});

await check("private hashes, full evidence, URLs and arbitrary metadata cannot leave the projection", () => {
  const raw = projection("text", 0, 10);
  Object.assign(raw, { provider_ref: "secret-provider", object_path: "secret-path", source_url: "https://private.invalid/secret", owner_user_id: OWNER });
  const result = previews(raw)[0];
  assert.deepEqual(Object.keys(result).sort(), ["excerpt", "entailment", "source_id", "evidence_id", "context_item_id",
    "modality", "evidence_type", "format", "interpretation", "citation", "source_locator", "limitations"].sort());
  const serialized = JSON.stringify(result);
  for (const hidden of ["input_sha256", "record_hash", "quote_hash", "canonical_text_sha256", '"evidence_text":',
    "secret-provider", "secret-path", "private.invalid", OWNER, "Keep the spaces."]) assert.ok(!serialized.includes(hidden), hidden);
});

await check("wrong-source membership and mismatched excerpt/hash are omitted, never downgraded", () => {
  for (const raw of [{ ...projection(), source_id: OTHER }, { ...projection(), excerpt: "Invented" },
    { ...projection(), quote_hash: "b".repeat(64) }, { ...projection(), start_char: 1 },
    { ...projection(), end_char: text.length + 1 }]) assert.deepEqual(previews(raw), []);
});

await check("UTF-16 pair splits, malformed Unicode and changed normalization cannot pass exact proof", () => {
  const emoji = text.indexOf("🎨");
  for (const raw of [projection("text", emoji, emoji + 1), projection("text", emoji + 1, emoji + 2),
    { ...projection(), excerpt: text.replace(/\s+/g, " ") },
    { ...projection(), evidence_text: text + "\uD800" }]) assert.deepEqual(previews(raw), []);
});

await check("every missing typed field refuses the citation rather than returning a legacy fallback", () => {
  for (const key of ["review_schema", "evidence_type", "source_kind", "source_format", "source_locator",
    "evidence_text", "start_char", "end_char", "context_item_id", "source_id", "evidence_id", "input_sha256", "record_hash"]) {
    const raw = projection(); delete raw[key]; assert.deepEqual(previews(raw), [], key);
  }
});

await check("unsupported image semantics and mismatched modality or format are unavailable", () => {
  for (const patch of [{ evidence_type: "image_region" }, { evidence_type: "untyped_text" },
    { source_kind: "image" }, { source_kind: "audio" }, { source_format: "whatsapp_export" },
    { source_format: "pdf" }, { review_schema: "future-unverified-schema" }])
    assert.deepEqual(previews({ ...projection(), ...patch }), []);
});

await check("invalid or fabricated source locator fields never reach the client", () => {
  for (const patch of [{ page_mapping: "page_1" }, { source_url: "https://private.invalid" },
    { unit: "code_points" }, { canonical_text_sha256: "not-a-hash" }, { shape: "fragment_map" },
    { end_char: text.length + 1 }, { start_char: -1 }])
    assert.deepEqual(previews({ ...projection(), source_locator: { ...projection().source_locator, ...patch } }), []);
  assert.deepEqual(previews({ ...projection(), span_start_ms: 0, span_end_ms: 100 }), []);
});

await check("missing transcript time, invented original mapping and partial timing refuse", () => {
  for (const patch of [{ span_start_ms: null }, { span_end_ms: null }, { span_end_ms: 1 },
    { span_start_ms: -1 }, { source_locator: { relative_to: "original_audio", start_ms: 0 } },
    { source_format: "wav" }]) assert.deepEqual(previews({ ...transcript(), ...patch }), []);
});

await check("invalid or missing text item mapping cannot be used as a selected-source identity", () => {
  for (const context_item_id of [null, undefined, "not-an-item", 1]) assert.deepEqual(previews({ ...projection(), context_item_id }), []);
});

await check("legacy excerpt-only callers remain compatible without manufacturing modality or identity", () => {
  const citation = previews({ excerpt: "Original\r\n  words", entailment: 0.8, source_id: SOURCE,
    evidence_id: EVIDENCE, source_url: "https://private.invalid" })[0];
  assert.deepEqual(citation, { excerpt: "Original\r\n  words", entailment: 0.8 });
  assert.deepEqual(previews({ excerpt: "Original", entailment: 0.8, source_kind: "audio" }), []);
});

await check("invalid and oversized quotations refuse without truncation; output stays capped", () => {
  for (const excerpt of ["", "   ", "x".repeat(501), "\u0000", "\uD800", null, {}])
    assert.deepEqual(previews({ excerpt, entailment: 0.8 }), []);
  assert.equal(clientClaim(row(Array.from({ length: 6 }, () => projection()))).citation_previews.length, 5);
});

await check("review cap follows the actual five-citation extraction contract and validator", () => {
  assert.equal(CLAIM_EXTRACTION_JSON_SCHEMA.properties.claims.items.properties.citations.maxItems, 5);
  const raw = transcript();
  const batch = createExtractionBatch([{ ...raw, text: raw.evidence_text, confidence: 0.95 }]);
  const candidate = { domain: "knowledge", key: "art_method", body: "Start with observation.", origin: "inferred",
    confidence: 0.95, sensitive: false, valid_from: null, valid_to: null,
    citations: Array.from({ length: 5 }, () => ({ evidence_id: EVIDENCE, start_char: 0, end_char: text.length,
      quote: text, entailment: 0.95 })) };
  assert.equal(validateExtractionOutput({ claims: [candidate] }, batch).proposals.length, 1);
  const excessive = validateExtractionOutput({ claims: [{ ...candidate, citations: [...candidate.citations, candidate.citations[0]] }] }, batch);
  assert.equal(excessive.proposals.length, 0);
  assert.deepEqual(excessive.rejected, ["claim_citation_required"]);
  assert.ok(CLAIMS_SQL.includes("order by cc.created_at,cc.start_char limit 5"));
});

await check("all five distinct authorized sources remain selectable including fourth and fifth", async () => {
  const entries = Array.from({ length: 5 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return { ...projection(), source_id: `30000000-0000-4000-8000-${suffix}`,
      evidence_id: `50000000-0000-4000-8000-${suffix}`, context_item_id: `40000000-0000-4000-8000-${suffix}` };
  });
  const sources = entries.map(entry => entry.source_id);
  const claims = [{ ...row(entries), source_ids: sources }];
  const result = await ownedPersonModelStatus(async (sql, params) => {
    assert.deepEqual(params, [RID, OWNER]);
    if (sql === CLAIMS_SQL) { authorityShape(sql); return claims; }
    if (sql.includes("select r.replica_id,exists")) return [{ replica_id: RID, training_consent: true }];
    if (sql.includes("from vy_replica_profile p")) return [];
    throw new Error("unexpected_read");
  }, OWNER, RID);
  assert.equal(result.claims[0].citation_previews.length, 5);
  assert.deepEqual(result.claims[0].citation_previews.map(citation => citation.source_id), sources);
  for (const index of [3, 4]) assert.ok(result.claims.some(claim => claim.citation_previews.some(citation => citation.context_item_id === entries[index].context_item_id)));
  assert.ok(!Object.hasOwn(result.claims[0], "source_ids"));

  const mixed = { ...claims[0], citation_previews: [{ ...entries[0], quote_hash: "invalid" }, ...entries,
    { ...entries[0], source_id: OTHER }, entries[0]] };
  const bounded = clientClaim(mixed);
  assert.equal(bounded.citation_previews.length, 5);
  assert.deepEqual(bounded.citation_previews.map(citation => citation.source_id), sources);
});

await check("authenticated-owner not-found returns no claims even if another mocked read returned rows", async () => {
  const { result } = await status([projection()], { owned: false }); assert.equal(result, null);
});

await check("current training consent loss leaves claim review state but removes all evidence previews", async () => {
  const { result } = await status([projection()], { consent: false });
  assert.equal(result.claims.length, 1);
  assert.deepEqual(result.claims[0].citation_previews, []);
  assert.ok(result.readiness.blockers.includes("training_consent_required"));
});

await check("actual read SQL retains ownership, source-state, consent, exact quote and item mapping guards", () => {
  authorityShape(CLAIMS_SQL);
  // The complete existing authority expression includes current canonical text
  // commitment checks and the explicit quarantined Mirror exception.
  assert.ok(CLAIMS_SQL.includes("context_item.content_sha256=context_source.sha256"));
  assert.ok(CLAIMS_SQL.includes("e.input_sha256=context_source.sha256"));
  assert.ok(CLAIMS_SQL.includes("s.state='ready'"));
  assert.ok(CLAIMS_SQL.includes("s.provenance->>'purpose'='mirror_window'"));
});

await check("authority guard deletion mutants are rejected, including wrong-owner and stale-source omissions", () => {
  const fragments = [
    "e.owner_user_id=cc.owner_user_id", "s.owner_user_id=cc.owner_user_id", "s.replica_id=cc.replica_id",
    "cc.source_id=any(c.source_ids)", "r.lifecycle not in ('revoked','purging')",
    "review_consent.scope='training'", "review_consent.policy_version=r.policy_version",
    "review_consent.revoked_at is null", "review_consent.expires_at>now()",
    "i.owner_user_id=s.owner_user_id", "i.replica_id=s.replica_id", "i.source_id=s.source_id",
    "i.item_id::text=e.value#>>'{provenance,context_item_id}'", "s.state='ready'",
    "context_source.state='ready'", "context_item.content_sha256=context_source.sha256",
    "e.input_sha256=context_source.sha256", "resolved.citation_quote is not null",
  ];
  for (const fragment of fragments) {
    assert.ok(CLAIMS_SQL.includes(fragment));
    const mutant = CLAIMS_SQL.replace(fragment, "true");
    assert.throws(() => authorityShape(mutant), undefined, fragment);
  }
});

console.log(`source-aware claim review: ${checks} offline groups passed (no SQL/provider/browser execution)`);
