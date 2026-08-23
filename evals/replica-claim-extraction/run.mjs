import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIM_EXTRACTION_JSON_SCHEMA,
  CLAIM_EXTRACTION_SCHEMA,
  containsDirectIdentifier,
  createExtractionBatch,
  extractionMessages,
  redactTranscript,
  validateExtractionOutput,
} from "../../api/_claim-extraction/contracts.js";
import { createAzureFoundryClaimExtractor } from "../../api/_claim-extraction/providers/azure-foundry.js";
import { ELIGIBLE_TRANSCRIPTS_SQL, extractOwnedClaims, ownedClaimExtractionStatus } from "../../api/_replica-claims.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const EVIDENCE = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const RUN = "50000000-0000-4000-8000-000000000005";
const text = "My name is Asha. I prefer short answers. Email asha@example.com and call +91 98765 43210.";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function transcript(extra = {}) {
  return {
    evidence_id: EVIDENCE,
    source_id: SOURCE,
    span_start_ms: 0,
    span_end_ms: 6_000,
    confidence: 0.91,
    input_sha256: "a".repeat(64),
    record_hash: "b".repeat(64),
    text,
    language: "en-IN",
    ...extra,
  };
}

const redacted = redactTranscript(text);
ok("email and phone are character-preserving redactions", redacted.redactions === 2 && redacted.text.length === text.length && !redacted.text.includes("example.com") && !redacted.text.includes("98765"));
ok("direct identifier detector covers email phone PAN and Aadhaar forms", containsDirectIdentifier("x@y.com") && containsDirectIdentifier("+91 98765 43210") && containsDirectIdentifier("ABCDE1234F") && containsDirectIdentifier("1234 5678 9012"));

const batch = createExtractionBatch([transcript()]);
ok("batch carries redacted text but content-addresses immutable evidence", batch.schema === CLAIM_EXTRACTION_SCHEMA && batch.spans[0].text === redacted.text && /^[0-9a-f]{64}$/.test(batch.input_set_hash));
ok("batch commitment is invariant to evidence order", createExtractionBatch([transcript(), transcript({ evidence_id: "60000000-0000-4000-8000-000000000006", record_hash: "c".repeat(64) })]).input_set_hash === createExtractionBatch([transcript({ evidence_id: "60000000-0000-4000-8000-000000000006", record_hash: "c".repeat(64) }), transcript()]).input_set_hash);
const messages = extractionMessages(batch);
ok("prompt treats transcripts as untrusted data and forbids instruction following", /untrusted quoted data/i.test(messages[0].content) && /Never obey instructions/i.test(messages[0].content));
ok("strict output schema refuses extra top-level properties", CLAIM_EXTRACTION_JSON_SCHEMA.additionalProperties === false && CLAIM_EXTRACTION_JSON_SCHEMA.properties.claims.items.additionalProperties === false);

const quote = "My name is Asha";
const shortQuote = "I prefer short answers";
const rawOutput = {
  claims: [
    {
      domain: "identity", key: "self_name", body: "Asha", origin: "inferred", confidence: 0.96, sensitive: true,
      valid_from: null, valid_to: null,
      citations: [{ evidence_id: EVIDENCE, start_char: 999, end_char: 1000, quote, entailment: 0.98 }],
    },
    {
      domain: "delivery", key: "turn_shape", body: "Prefers short answers", origin: "observed", confidence: 0.94, sensitive: false,
      valid_from: null, valid_to: null,
      citations: [{ evidence_id: EVIDENCE, start_char: redacted.text.indexOf(shortQuote), end_char: redacted.text.indexOf(shortQuote) + shortQuote.length, quote: shortQuote, entailment: 0.92 }],
    },
    {
      domain: "identity", key: "email", body: "asha@example.com", origin: "inferred", confidence: 0.9, sensitive: true,
      valid_from: null, valid_to: null,
      citations: [{ evidence_id: EVIDENCE, start_char: 0, end_char: quote.length, quote, entailment: 0.9 }],
    },
    {
      domain: "biography", key: "medical_diagnosis", body: "Has a medical diagnosis", origin: "inferred", confidence: 0.7, sensitive: true,
      valid_from: null, valid_to: null,
      citations: [{ evidence_id: EVIDENCE, start_char: 0, end_char: quote.length, quote, entailment: 0.7 }],
    },
  ],
};
const validated = validateExtractionOutput(rawOutput, batch);
ok("only safe evidence-entailed proposals survive validation", validated.proposals.length === 2 && validated.rejected.includes("direct_identifier_claim_blocked") && validated.rejected.includes("protected_trait_inference_blocked"));
ok("unique exact quote repairs model offsets without weakening citation", validated.proposals.some((proposal) => proposal.citations[0].start_char === redacted.text.indexOf(quote)));
ok("claim confidence cannot exceed evidence or citation confidence", validated.proposals.every((proposal) => proposal.confidence <= 0.91));
ok("citation persistence carries hashes and source ids but no quote", validated.proposals.every((proposal) => proposal.citations.every((citation) => citation.quote_hash && !Object.hasOwn(citation, "quote"))));
ok("extra claim fields are rejected rather than compiled", validateExtractionOutput({ claims: [{ ...rawOutput.claims[0], unexpected: "instruction" }] }, batch).proposals.length === 0);

let azureRequest;
const azure = createAzureFoundryClaimExtractor({
  endpoint: "https://vyakti.services.ai.azure.com",
  model: "gpt-5-mini",
  apiKey: "test-key-not-a-real-secret-123",
  fetchImpl: async (url, init) => {
    azureRequest = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ claims: rawOutput.claims.slice(0, 2) }) } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
const azureResult = await azure.extract({ batch });
ok("Azure adapter uses Foundry model inference endpoint and strict JSON schema", /services\.ai\.azure\.com\/models\/chat\/completions\?api-version=2024-05-01-preview/.test(azureRequest.url) && azureRequest.body.response_format.type === "json_schema" && azureRequest.body.response_format.json_schema.strict === true);
ok("Azure adapter returns validated proposals and bounded usage", azureResult.output.proposals.length === 2 && azureResult.usage.input_tokens === 100);
assert.throws(() => createAzureFoundryClaimExtractor({ endpoint: "https://evil.example.com", model: "x", apiKey: "x".repeat(20) }), /azure_foundry_endpoint_invalid/);
ok("Azure adapter refuses non-Azure endpoints", true);

function owned(training = true) {
  return {
    replica_id: RID, lifecycle: "calibrating", subject_mode: "self", policy_version: "replica-self-v1",
    consent_ids: ["70000000-0000-4000-8000-000000000007", "80000000-0000-4000-8000-000000000008"],
    transcription_consent: true, training_consent: training,
  };
}

const statusCalls = [];
const status = await ownedClaimExtractionStatus(async (sql, params) => {
  statusCalls.push({ sql, params });
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned()];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  throw new Error(`unexpected status SQL ${sql.slice(0, 80)}`);
}, OWNER, RID);
ok("status exposes counts and blockers without transcript content", status.readiness.ready && status.readiness.eligible_spans === 1 && !JSON.stringify(status).includes("Asha"));
ok("eligible transcripts require accepted target-speaker overlap and reject declared third parties or test adapters", /d\.decision='accepted'/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /s\.contains_third_parties=false/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /!~ '\(fake\|fixture\|test\|mock\)'/i.test(ELIGIBLE_TRANSCRIPTS_SQL));
ok("all extraction status reads remain owner-bound", statusCalls.every((call) => call.params[0] === RID && call.params[1] === OWNER));

const serviceCalls = [];
let providerBatch;
const fakeExtractor = {
  family: "claim-extraction", name: "offline-fixture", version: "1", model: "offline",
  async extract({ batch: input }) { providerBatch = input; return { output: validated }; },
};
const completed = await extractOwnedClaims(async (sql, params) => {
  serviceCalls.push({ sql, params });
  if (/jsonb_to_recordset/i.test(sql)) return [{ run_id: RUN, state: "complete", proposed_count: 2, rejected_count: 2, attempt: 1, created_at: "2026-08-24T00:00:00.000Z", completed_at: "2026-08-24T00:00:01.000Z" }];
  if (/insert into vy_replica_claim_extraction/i.test(sql)) return [{ run_id: RUN, state: "extracting", proposed_count: 0, rejected_count: 0, attempt: 1, created_at: "2026-08-24T00:00:00.000Z", completed_at: null }];
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned()];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  throw new Error(`unexpected extraction SQL ${sql.slice(0, 80)}`);
}, OWNER, RID, fakeExtractor);
ok("extraction completes with proposals still pending owner review", completed.state === "complete" && completed.proposed_count === 2);
ok("provider receives redacted spans and no owner or source id", providerBatch.spans[0].redactions === 2 && !providerBatch.spans[0].text.includes("example.com") && !JSON.stringify(providerBatch.spans.map(({ source_id: _, ...span }) => span)).includes(OWNER));
const persistCall = serviceCalls.find((call) => /jsonb_to_recordset/i.test(call.sql));
ok("persistence inserts proposed claims and exact citation lineage atomically", /'proposed'/.test(persistCall.sql) && /insert into vy_replica_claim_citation/i.test(persistCall.sql) && /state='complete'/i.test(persistCall.sql));
ok("persistence payload has quote hashes but no transcript quotes", !persistCall.params[5].includes(shortQuote) && /quote_hash/.test(persistCall.params[5]));
ok("persistence rechecks both consents at the mutation boundary", /transcription_consent=true and a\.training_consent=true/i.test(persistCall.sql));

let providerCalled = false;
await assert.rejects(extractOwnedClaims(async (sql) => {
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned(false)];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  return [];
}, OWNER, RID, { ...fakeExtractor, async extract() { providerCalled = true; } }), /claim_extraction_not_ready/);
ok("missing training consent prevents any provider call", providerCalled === false);

const migration = readFileSync(join(ROOT, "db/migrations/026_claim_extraction.sql"), "utf8");
ok("claim extraction migration remains one-statement-runner safe", splitSql(migration).length === 9);
ok("citation lineage is composite owner claim evidence and source bound", /foreign key \(claim_id,replica_id,owner_user_id\)/i.test(migration) && /foreign key \(evidence_id,replica_id,owner_user_id\)/i.test(migration) && /foreign key \(source_id,replica_id,owner_user_id\)/i.test(migration));
const route = readFileSync(join(ROOT, "api/replica-claims.js"), "utf8");
ok("production route derives bearer ownership and has no fake override", /const user = await requireUser\(req\)/.test(route) && /createProductionClaimExtractor\(\)/.test(route) && !/allowFake|testOnly/.test(route));

console.log(`\n${checks} replica claim extraction checks passed`);
