import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
import { createAzureFoundryClaimExtractor, AZURE_FOUNDRY_CLAIM_WIRE_SCHEMA } from "../../api/_claim-extraction/providers/azure-foundry.js";
import { createOpenRouterClaimExtractor } from "../../api/_claim-extraction/providers/openrouter.js";
import { createProductionClaimExtractor } from "../../api/_claim-extraction/registry.js";
import { ELIGIBLE_TRANSCRIPTS_SQL, extractOwnedClaims, ownedClaimExtractionStatus } from "../../api/_replica-claims.js";
import { createClaimRequestAbort } from "../../api/replica-claims.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const EVIDENCE = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const RUN = "50000000-0000-4000-8000-000000000005";
const text = "My name is Asha. I prefer short answers. In an SN1 reaction, the rate depends only on substrate concentration. Email asha@example.com and call +91 98765 43210.";
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
const knowledgeQuote = "In an SN1 reaction, the rate depends only on substrate concentration";
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
      domain: "knowledge", key: "chemistry_sn1_rate_law", body: "For an SN1 reaction, rate depends only on substrate concentration.", origin: "observed", confidence: 0.94, sensitive: false,
      valid_from: null, valid_to: null,
      citations: [{ evidence_id: EVIDENCE, start_char: redacted.text.indexOf(knowledgeQuote), end_char: redacted.text.indexOf(knowledgeQuote) + knowledgeQuote.length, quote: knowledgeQuote, entailment: 0.96 }],
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
ok("safe identity, style and subject-knowledge proposals survive validation", validated.proposals.length === 3 && validated.proposals.some((proposal) => proposal.domain === "knowledge") && validated.rejected.includes("direct_identifier_claim_blocked") && validated.rejected.includes("protected_trait_inference_blocked"));
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
ok("Azure adapter uses exact OpenAI v1 route without query or redirect and strict JSON schema",
  azureRequest.url === "https://vyakti.services.ai.azure.com/openai/v1/chat/completions"
  && azureRequest.init.redirect === "error" && azure.version === "openai-v1:claim-extractor/v2:raw-body/v2"
  && azureRequest.body.response_format.type === "json_schema" && azureRequest.body.response_format.json_schema.strict === true);
ok("Azure-only prompt states canonical key and body bounds omitted from its wire schema",
  /key must match \^\[a-z\]\[a-z0-9_\]\{1,63\}\$/.test(azureRequest.body.messages[0].content)
  && /body must be 3 to 500 characters/.test(azureRequest.body.messages[0].content)
  && /Never truncate or normalize/.test(azureRequest.body.messages[0].content));
ok("Azure reservation accounting receives the exact extended prompt messages",
  typeof azure.messagesForBudget === "function"
  && JSON.stringify(azure.messagesForBudget(batch)) === JSON.stringify(azureRequest.body.messages)
  && /messagesForBudget\(batch\)/.test(readFileSync(join(ROOT, "api", "_replica-claims.js"), "utf8")));
assert.deepEqual(azureRequest.body.response_format.json_schema.schema, AZURE_FOUNDRY_CLAIM_WIRE_SCHEMA);
const wireRemoved=[];
function compareWire(canonical,wire,path='schema') {
  if(!canonical || typeof canonical!=='object'){assert.deepEqual(wire,canonical);return;}
  if(Array.isArray(canonical)){assert.equal(wire.length,canonical.length);canonical.forEach((value,i)=>compareWire(value,wire[i],`${path}[${i}]`));return;}
  const unsupported=new Set(['minLength','maxLength','pattern','minimum','maximum','minItems','maxItems']);
  assert.deepEqual(Object.keys(wire),Object.keys(canonical).filter(key=>!unsupported.has(key)));
  for(const [key,value] of Object.entries(canonical)) {
    if(unsupported.has(key)){assert(!Object.hasOwn(wire,key));wireRemoved.push(`${path}.${key}`);}
    else compareWire(value,wire[key],`${path}.${key}`);
  }
}
compareWire(CLAIM_EXTRACTION_JSON_SCHEMA,azureRequest.body.response_format.json_schema.schema);
ok("wire projection removes only documented unsupported keywords and retains every other shape",
  wireRemoved.length === 14 && CLAIM_EXTRACTION_JSON_SCHEMA.properties.claims.maxItems === 50
  && CLAIM_EXTRACTION_JSON_SCHEMA.properties.claims.items.properties.key.pattern === '^[a-z][a-z0-9_]{1,63}$');
async function extractAzureFixture(claims, extractionBatch=batch) {
  const adapter=createAzureFoundryClaimExtractor({endpoint:'https://vyakti.services.ai.azure.com',model:'gpt-4.1-mini',apiKey:'synthetic-key-only-123456',
    fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims})}}],usage:{prompt_tokens:100,completion_tokens:40}}))});
  return adapter.extract({batch:extractionBatch});
}
const validWireClaim=structuredClone(rawOutput.claims[1]);
const invalidWireClaims=[
  {...validWireClaim,key:'INVALID KEY'},
  {...validWireClaim,citations:Array.from({length:6},()=>validWireClaim.citations[0])},
  {...validWireClaim,citations:[]},
  {...validWireClaim,body:'x'},
  {...validWireClaim,citations:[{...validWireClaim.citations[0],entailment:0.54}]},
  {...validWireClaim,citations:[{...validWireClaim.citations[0],entailment:1.01}]},
  {...validWireClaim,citations:[{...validWireClaim.citations[0],start_char:0.5}]},
  {...validWireClaim,citations:[{...validWireClaim.citations[0],quote:'not present in this source',start_char:-2,end_char:999}]},
  {...validWireClaim,citations:[{...validWireClaim.citations[0],quote:'x'.repeat(501)}]},
];
const invalidWireResult=await extractAzureFixture(invalidWireClaims);
ok("actual Azure output still rejects invalid keys, counts, quote bounds, coordinates and entailment",
  invalidWireResult.output.proposals.length===0 && invalidWireResult.output.rejected.length===9);
const strictKeyResult=await extractAzureFixture([
  {...validWireClaim,key:'SN1_rate_law'},
  {...validWireClaim,key:'bad-key'},
]);
ok("Azure output strictly rejects uppercase subject labels and non-snake keys",
  strictKeyResult.output.proposals.length===0
  && strictKeyResult.output.rejected.filter(code=>code==='invalid_claim_shape').length===2);
await assert.rejects(()=>extractAzureFixture(Array.from({length:51},()=>validWireClaim)));
ok("actual Azure output refuses more than fifty claims despite omitted wire count bound",true);
const repairedWire=await extractAzureFixture([{...validWireClaim,confidence:99,
  citations:[{...validWireClaim.citations[0],start_char:-2,end_char:999}]}]);
ok("actual Azure output preserves unique exact quote repair and evidence confidence cap",
  repairedWire.output.proposals.length===1 && repairedWire.output.proposals[0].confidence===0.91
  && repairedWire.output.proposals[0].citations[0].start_char===redacted.text.indexOf(shortQuote));
const trailingCondition='Only when temperature and solvent remain constant.';
const conditionalBody='I prefer short answers. '+'The rate depends only on substrate concentration. '.repeat(11)+trailingCondition;
const conditionalBatch=createExtractionBatch([transcript({text:conditionalBody})]);
const oversizedClaim={...validWireClaim,domain:'knowledge',key:'conditional_rate_law',body:conditionalBody,
  citations:[{...validWireClaim.citations[0],start_char:0,end_char:shortQuote.length},
    {evidence_id:EVIDENCE,start_char:conditionalBody.indexOf(trailingCondition),end_char:conditionalBody.length,quote:trailingCondition,entailment:0.92}]};
const priorTruncation=validateExtractionOutput({claims:[oversizedClaim]},conditionalBatch);
assert(conditionalBody.length>500 && priorTruncation.proposals[0].body.length===500 && !priorTruncation.proposals[0].body.includes(trailingCondition));
const guardedBody=await extractAzureFixture([oversizedClaim,validWireClaim],conditionalBatch);
ok("Azure guard rejects the condition-losing raw body while preserving valid sibling and measured usage",
  guardedBody.output.proposals.length===1 && guardedBody.output.proposals[0].key===validWireClaim.key
  && guardedBody.output.rejected.includes('claim_body_too_long')
  && guardedBody.usage.input_tokens===100 && guardedBody.usage.output_tokens===40);
const bodyBoundary=await extractAzureFixture([
  {...validWireClaim,body:'x'.repeat(500)}, {...validWireClaim,body:'x'.repeat(501)},
  {...validWireClaim,body:'😀'.repeat(251)},
]);
ok("Azure raw body bound is 500 UTF-16 units including astral characters",
  bodyBoundary.output.proposals.length===1 && bodyBoundary.output.proposals[0].body.length===500
  && bodyBoundary.output.rejected.filter(code=>code==='claim_body_too_long').length===2);
await assert.rejects(()=>extractAzureFixture(Array.from({length:51},()=>oversizedClaim),conditionalBatch));
ok("overlong body filtering cannot bypass original fifty-claim limit",true);
ok("Azure adapter returns validated proposals and bounded usage", azureResult.output.proposals.length === 2 && azureResult.usage.input_tokens === 100);
assert.throws(() => createAzureFoundryClaimExtractor({ endpoint: "https://evil.example.com", model: "x", apiKey: "x".repeat(20) }), /azure_foundry_endpoint_invalid/);
ok("Azure adapter refuses non-Azure endpoints", true);

let openRouterRequest;
const openRouter = createOpenRouterClaimExtractor({
  model: "google/gemini-2.5-flash",
  apiKey: "test-key-not-a-real-secret-123",
  fetchImpl: async (url, init) => {
    openRouterRequest = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ claims: rawOutput.claims.slice(0, 2) }) } }],
      usage: { prompt_tokens: 101, completion_tokens: 41 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
const openRouterResult = await openRouter.extract({ batch });
ok("OpenRouter fallback pins one model and requires strict structured-output routing",
  openRouterRequest.url === "https://openrouter.ai/api/v1/chat/completions"
  && openRouterRequest.body.model === "google/gemini-2.5-flash"
  && openRouterRequest.body.provider.require_parameters === true
  && openRouterRequest.body.response_format.json_schema.strict === true);
ok("OpenRouter fallback returns the same validated proposal and metered usage contract",
  openRouterResult.output.proposals.length === 2 && openRouterResult.usage.input_tokens === 101
  && openRouter.billing.meter === "openrouter_tokens");
const openRouterEnv = {
  OPENROUTER_KEY: "test-key-not-a-real-secret-123",
  OPENROUTER_CLAIM_MODEL: "google/gemini-2.5-flash",
};
const productionFallback = createProductionClaimExtractor(openRouterEnv);
ok("production registry uses the bounded OpenRouter arm only when Azure Foundry is absent",
  productionFallback.name === "openrouter-structured-output" && productionFallback.model === "google/gemini-2.5-flash");
const productionPreferred = createProductionClaimExtractor({
  ...openRouterEnv,
  AZURE_FOUNDRY_ENDPOINT: "https://unit.services.ai.azure.com",
  AZURE_FOUNDRY_CLAIM_MODEL: "claim-model-v1",
  AZURE_FOUNDRY_API_KEY: "test-key-not-a-real-secret-456",
});
ok("production registry keeps a fully configured Azure deployment ahead of the fallback",
  productionPreferred.name === "azure-foundry-structured-output" && productionPreferred.model === "claim-model-v1");
assert.throws(() => createProductionClaimExtractor({
  AZURE_FOUNDRY_ENDPOINT: "https://unit.services.ai.azure.com",
  AZURE_FOUNDRY_CLAIM_MODEL: "claim-model-v1",
}), /claim_extractor_unavailable/);
ok("partial Azure configuration without a complete fallback fails closed", true);

const preAborted = new AbortController();
preAborted.abort(Object.assign(new Error("already-gone"), { code: "client_aborted" }));
let preAbortedFetchCalled = false;
const preAbortedAdapter = createOpenRouterClaimExtractor({
  ...openRouterEnv,
  apiKey: openRouterEnv.OPENROUTER_KEY,
  model: openRouterEnv.OPENROUTER_CLAIM_MODEL,
  fetchImpl: async (_url, init) => {
    preAbortedFetchCalled = true;
    if (init.signal.aborted) throw init.signal.reason;
    throw new Error("unexpected_unaborted_fetch");
  },
});
await assert.rejects(preAbortedAdapter.extract({ batch, signal: preAborted.signal }), /claim_extraction_aborted/);
ok("an already-aborted request cannot begin a provider request", preAbortedFetchCalled === false);

const oversizedAdapter = createOpenRouterClaimExtractor({
  apiKey: openRouterEnv.OPENROUTER_KEY,
  model: openRouterEnv.OPENROUTER_CLAIM_MODEL,
  fetchImpl: async () => new Response(`{"padding":"${"x".repeat(1_000_001)}"}`, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
});
await assert.rejects(oversizedAdapter.extract({ batch }), /openrouter_response_too_large/);
ok("chunked provider responses are stopped at the one-megabyte bound", true);

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
  if (/from vy_replica_claim_extraction_queue q/i.test(sql)) return [];
  throw new Error(`unexpected status SQL ${sql.slice(0, 80)}`);
}, OWNER, RID);
ok("status exposes counts and blockers without transcript content", status.readiness.ready && status.readiness.eligible_spans === 1 && status.nearline.state === "ready_for_manual_extraction" && !JSON.stringify(status).includes("Asha"));
ok("eligible transcripts require accepted target-speaker overlap and reject declared third parties or test adapters", /d\.decision='accepted'/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /s\.contains_third_parties=false/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && /!~ '\(fake\|fixture\|test\|mock\)'/i.test(ELIGIBLE_TRANSCRIPTS_SQL));
ok("eligible transcript spans preserve each source's audio chronology before UUID tie-breaking",
  /order by s\.created_at asc,s\.source_id asc,e\.span_start_ms asc nulls last,\s*e\.span_end_ms asc nulls last,e\.created_at asc,e\.evidence_id asc/i.test(ELIGIBLE_TRANSCRIPTS_SQL));
ok("completed older extraction schemas remain eligible for the knowledge-capable extractor", /xr\.schema_version=\$3/i.test(ELIGIBLE_TRANSCRIPTS_SQL) && CLAIM_EXTRACTION_SCHEMA === "vyakti.claim-extraction.v2");
ok("all extraction status reads remain owner-bound", statusCalls.every((call) => call.params[0] === RID && call.params[1] === OWNER));

const serviceCalls = [];
let providerBatch;
const fakeExtractor = {
  family: "claim-extraction", name: "offline-fixture", version: "1", model: "offline",
  async extract({ batch: input }) { providerBatch = input; return { output: validated }; },
};
const completed = await extractOwnedClaims(async (sql, params) => {
  serviceCalls.push({ sql, params });
  if (/jsonb_to_recordset/i.test(sql)) return [{ run_id: RUN, state: "complete", proposed_count: 3, rejected_count: 2, attempt: 1, created_at: "2026-08-24T00:00:00.000Z", completed_at: "2026-08-24T00:00:01.000Z" }];
  if (/insert into vy_replica_claim_extraction/i.test(sql)) return [{ run_id: RUN, state: "extracting", acquired: true, proposed_count: 0, rejected_count: 0, attempt: 1, created_at: "2026-08-24T00:00:00.000Z", completed_at: null }];
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned()];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  if (/from vy_replica_claim_extraction_queue q/i.test(sql)) return [];
  throw new Error(`unexpected extraction SQL ${sql.slice(0, 80)}`);
}, OWNER, RID, fakeExtractor);
ok("extraction completes with subject knowledge still pending owner review", completed.state === "complete" && completed.proposed_count === 3);
ok("provider receives redacted spans and no owner or source id", providerBatch.spans[0].redactions === 2 && !providerBatch.spans[0].text.includes("example.com") && !JSON.stringify(providerBatch.spans.map(({ source_id: _, ...span }) => span)).includes(OWNER));
const persistCall = serviceCalls.find((call) => /jsonb_to_recordset/i.test(call.sql));
ok("persistence inserts proposed claims and exact citation lineage atomically", /'proposed'/.test(persistCall.sql) && /insert into vy_replica_claim_citation/i.test(persistCall.sql) && /state='complete'/i.test(persistCall.sql));
ok("persistence payload has quote hashes but no transcript quotes", !persistCall.params[6].includes(shortQuote) && /quote_hash/.test(persistCall.params[6]));
ok("persistence rechecks both consents at the mutation boundary", /transcription_consent=true and a\.training_consent=true/i.test(persistCall.sql));
ok("persistence rechecks latest accepted speaker evidence after the provider returns",
  /latest_speaker_decision as materialized/.test(persistCall.sql)
  && /sd\.evidence_id=speaker\.evidence_id and sd\.decision='accepted'/.test(persistCall.sql)
  && /speaker\.span_start_ms<e\.span_end_ms/.test(persistCall.sql));
ok("an all-or-nothing authorization guard precedes every claim and citation write",
  persistCall.sql.indexOf("authorization_guard as materialized") < persistCall.sql.indexOf("insert into vy_replica_claim")
  && /from active_run r cross join proposal_rows p cross join authorization_guard g/.test(persistCall.sql)
  && /from valid_citations v join claim_rows c/.test(persistCall.sql)
  && /count\(\*\) from valid_citations\)=\$10::int4/.test(persistCall.sql));
ok("the mutation boundary rechecks exact run inputs source state and immutable transcript lineage",
  /vy_replica_claim_extraction_input/.test(persistCall.sql)
  && /s\.contains_third_parties=false/.test(persistCall.sql)
  && /s\.state='quarantined' and s\.capture_mode='derived'/.test(persistCall.sql)
  && /e\.value#>>'\{provenance,origin\}'='mirror_call'/.test(persistCall.sql));

let racedProviderCalled = false;
let racedPersistSql = "";
await assert.rejects(extractOwnedClaims(async (sql) => {
  if (/jsonb_to_recordset/i.test(sql)) {
    racedPersistSql = sql;
    return [];
  }
  if (/insert into vy_replica_claim_extraction/i.test(sql)) return [{ run_id: RUN, state: "extracting", acquired: true }];
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned()];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  if (/from vy_replica_claim_extraction_queue q/i.test(sql)) return [];
  if (/update vy_replica_claim_extraction/i.test(sql)) return [];
  return [];
}, OWNER, RID, { ...fakeExtractor, async extract() {
  racedProviderCalled = true;
  return { output: validated };
} }), /claim_extraction_persist_denied/);
ok("NEGATIVE CONTROL: speaker rejection during provider work denies persistence after the paid call",
  racedProviderCalled && /latest_speaker_decision/.test(racedPersistSql)
  && /authorization_guard/.test(racedPersistSql));

let providerCalled = false;
await assert.rejects(extractOwnedClaims(async (sql) => {
  if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned(false)];
  if (/latest_speaker_decision/i.test(sql)) return [transcript()];
  if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
  if (/from vy_replica_claim_extraction_queue q/i.test(sql)) return [];
  return [];
}, OWNER, RID, { ...fakeExtractor, async extract() { providerCalled = true; } }), /claim_extraction_not_ready/);
ok("missing training consent prevents any provider call", providerCalled === false);

const budgetEnvKeys = ["AZURE_REPLICA_BUDGET_ID", "AZURE_REPLICA_APP_BUDGET_USD", "AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS", "AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS"];
const priorBudgetEnv = Object.fromEntries(budgetEnvKeys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  AZURE_REPLICA_BUDGET_ID: "synthetic-claim-begin-ack",
  AZURE_REPLICA_APP_BUDGET_USD: "1",
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "0.4",
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "1.6",
});
const beginAckCalls = [];
let beginAckProviderCalled = false;
let beginAckError = null;
try {
  try { await extractOwnedClaims(async (sql, params) => {
    beginAckCalls.push({ sql, params });
    if (/insert into vy_replica_claim_extraction/i.test(sql)) return [{ run_id: RUN, state: "extracting", acquired: true }];
    if (/select r\.replica_id,r\.lifecycle/i.test(sql)) return [owned()];
    if (/latest_speaker_decision/i.test(sql)) return [transcript()];
    if (/from vy_replica_claim_extraction x join/i.test(sql)) return [];
    if (/from vy_replica_claim_extraction_queue q/i.test(sql)) return [];
    if (/insert into vy_provider_budget/i.test(sql)) return [];
    if (/insert into vy_provider_spend/i.test(sql)) return [{ reservation_id: "90000000-0000-4000-8000-000000000009", budget_id: params[0], request_hash: params[7], state: "reserved", reserved_microusd: params[10] }];
    if (/set state='in_flight'/i.test(sql)) throw Object.assign(new Error("synthetic begin acknowledgement lost"), { code: "synthetic_begin_ack_lost" });
    if (/set state='reconcile_required'/i.test(sql) || /update vy_replica_claim_extraction/i.test(sql)) return [];
    throw new Error(`unexpected begin-ack SQL ${sql.slice(0, 80)}`);
  }, OWNER, RID, {
    ...fakeExtractor,
    billing: { meter: "azure_foundry_tokens", max_output_tokens: 100 },
    async extract() { beginAckProviderCalled = true; throw new Error("provider_must_not_run"); },
  }); } catch (error) { beginAckError = error; }
} finally {
  for (const key of budgetEnvKeys) priorBudgetEnv[key] === undefined ? delete process.env[key] : process.env[key] = priorBudgetEnv[key];
}
ok("ambiguous spend-begin acknowledgement retains the reservation and does not dispatch or release",
  /synthetic begin acknowledgement lost/.test(beginAckError?.message || "")
  && beginAckProviderCalled === false
  && beginAckCalls.some((call) => /set state='reconcile_required'/i.test(call.sql))
  && !beginAckCalls.some((call) => /set state='released'/i.test(call.sql)));

const migration = readFileSync(join(ROOT, "db/migrations/026_claim_extraction.sql"), "utf8");
ok("claim extraction migration remains one-statement-runner safe", splitSql(migration).length === 9);
ok("citation lineage is composite owner claim evidence and source bound", /foreign key \(claim_id,replica_id,owner_user_id\)/i.test(migration) && /foreign key \(evidence_id,replica_id,owner_user_id\)/i.test(migration) && /foreign key \(source_id,replica_id,owner_user_id\)/i.test(migration));
const knowledgeMigration = readFileSync(join(ROOT, "db/migrations/160_replica_knowledge_domain.sql"), "utf8");
ok("knowledge domain migration is one statement and preserves every prior claim domain", splitSql(knowledgeMigration).length === 1 && /'preference','knowledge',[\s\r\n]*'value'/.test(knowledgeMigration) && /'delivery','visual'/.test(knowledgeMigration));
const route = readFileSync(join(ROOT, "api/replica-claims.js"), "utf8");
ok("production route derives bearer ownership and has no fake override", /const user = await requireUser\(req\)/.test(route) && /createProductionClaimExtractor\(\)/.test(route) && !/allowFake|testOnly/.test(route));

const request = new EventEmitter();
request.aborted = false;
const response = new EventEmitter();
response.writableEnded = false;
response.headersSent = false;
response.destroyed = false;
const requestAbort = createClaimRequestAbort(request, response, { timeoutMs: 5_000 });
request.emit("close");
ok("a normal completed request close does not cancel paid extraction", requestAbort.signal.aborted === false);
request.emit("aborted");
ok("the actual client-aborted event cancels provider work with a named reason",
  requestAbort.signal.aborted && requestAbort.signal.reason?.code === "client_aborted");
requestAbort.dispose();

const completedRequest = new EventEmitter();
const completedResponse = new EventEmitter();
completedResponse.writableEnded = true;
const completedAbort = createClaimRequestAbort(completedRequest, completedResponse, { timeoutMs: 5_000 });
completedResponse.emit("close");
ok("a response close after the response ended is not misclassified as a client abort", !completedAbort.signal.aborted);
completedAbort.dispose();
ok("claim extraction owns a bounded deadline below the platform wall",
  /Math\.min\(45_000/.test(route) && /claim_extraction_timeout/.test(route)
  && !/req\.on\?\.\("close"/.test(route));

console.log(`\n${checks} replica claim extraction checks passed`);
