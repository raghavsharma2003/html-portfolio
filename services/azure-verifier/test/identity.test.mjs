import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, hmac, sha256, validHmac } from "../src/canonical.js";
import { extractIdentityFacts } from "../src/document-intelligence.js";
import { verifyIdentityRequest } from "../src/identity.js";

const NOW = new Date("2026-08-24T10:00:00.000Z");
const BROKER_KEY = Buffer.alloc(32, 11);
const REVIEW_KEY = Buffer.alloc(32, 12);
const IMAGE = Buffer.alloc(2_048, 0xa5);
const SHA = sha256(IMAGE);

function config() {
  return Object.freeze({
    protocol: "vyakti-azure-identity-broker/v1",
    version: "identity-2026.08.24+1",
    hmacKey: BROKER_KEY,
    sourceOrigin: "https://project.supabase.co",
    document: Object.freeze({
      endpoint: "https://vyakti-doc.cognitiveservices.azure.com",
      key: "document-key",
      apiVersion: "2024-11-30",
      model: "prebuilt-idDocument",
      pollMs: 100,
      maxPolls: 3,
    }),
    face: Object.freeze({
      endpoint: "https://vyakti-face.cognitiveservices.azure.com",
      key: "face-key",
      apiVersion: "v1.2",
      detectionModel: "detection_03",
      recognitionModel: "recognition_04",
    }),
    review: Object.freeze({
      endpoint: "https://vyakti-review.azurecontainerapps.io/v1/document/review",
      hmacKey: REVIEW_KEY,
      version: "review-2026.08.24+1",
    }),
    limits: Object.freeze({
      requestBytes: 65_536,
      mediaBytes: 8 * 1_024 * 1_024,
      providerBytes: 1_048_576,
      mediaDeadlineMs: 2_000,
      providerDeadlineMs: 2_000,
      totalDeadlineMs: 5_000,
      concurrency: 2,
    }),
  });
}

function request(overrides = {}) {
  return {
    protocol: "vyakti-azure-identity-broker/v1",
    request_id: "10000000-0000-4000-8000-000000000001:1",
    identity_case_id: "10000000-0000-4000-8000-000000000001",
    replica_id: "20000000-0000-4000-8000-000000000002",
    source_id: "30000000-0000-4000-8000-000000000003",
    minimum_age: 18,
    verifier_version: "identity-2026.08.24+1",
    document: {
      url: "https://project.supabase.co/storage/v1/object/sign/replica-private/a/b?token=opaque",
      expires_at: "2026-08-24T10:02:00.000Z",
      sha256: SHA,
      byte_size: IMAGE.length,
      mime: "image/jpeg",
    },
    ...overrides,
  };
}

function analysis(birth = "2000-08-24", expiration = "2030-08-24") {
  return {
    status: "succeeded",
    analyzeResult: {
      apiVersion: "2024-11-30",
      modelId: "prebuilt-idDocument",
      documents: [{
        confidence: 0.97,
        fields: {
          DateOfBirth: { valueDate: birth, confidence: 0.98 },
          DateOfExpiration: { valueDate: expiration, confidence: 0.96 },
        },
      }],
    },
  };
}

function fakeProviders(options = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://project.supabase.co/storage/v1/object/")) {
      const bytes = options.media || IMAGE;
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) },
      });
    }
    if (url.includes(":analyze?")) {
      const location = options.operationLocation ||
        "https://vyakti-doc.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/result-1234?api-version=2024-11-30";
      return new Response(null, { status: 202, headers: { "operation-location": location } });
    }
    if (url.includes("/analyzeResults/")) return Response.json(options.analysis || analysis());
    if (url.includes("/face/v1.2/detect?")) {
      return Response.json(options.faces || [{ faceAttributes: { qualityForRecognition: "high" } }]);
    }
    if (url === "https://vyakti-review.azurecontainerapps.io/v1/document/review") {
      const inputBody = JSON.parse(String(init.body));
      assert.equal(init.headers["X-Vyakti-Protocol"], "vyakti-document-authenticity-review/v1");
      assert.ok(validHmac(REVIEW_KEY, String(init.body), init.headers["X-Vyakti-Signature"]));
      const review = canonicalJson({
        request_id: inputBody.request_id,
        input_sha256: inputBody.input_sha256,
        review_version: "review-2026.08.24+1",
        decision: options.reviewDecision || "approved",
        document_authentic: options.reviewDecision === "denied" ? false : true,
        document_current: true,
        non_expiring: false,
        authenticity_score: options.reviewDecision === "denied" ? 0.1 : 0.97,
      });
      return new Response(review, {
        status: 200,
        headers: { "content-type": "application/json", "x-vyakti-response-signature": `sha256=${hmac(REVIEW_KEY, review)}` },
      });
    }
    throw new Error(`unexpected provider URL: ${url}`);
  };
  return { calls, fetchImpl };
}

test("composite verification binds exact bytes, pinned providers, independent review and one high-quality portrait", async () => {
  const providers = fakeProviders();
  const result = await verifyIdentityRequest(request(), config(), {
    fetchImpl: providers.fetchImpl,
    sleep: async () => {},
    now: () => NOW.getTime(),
  });
  assert.deepEqual(result, {
    request_id: "10000000-0000-4000-8000-000000000001:1",
    input_sha256: SHA,
    provider_accepted: true,
    extraction_confidence: 0.96,
    authenticity_score: 0.97,
    portrait_confidence: 0.99,
    document_authentic: true,
    document_current: true,
    adult_evidence: true,
    face_reference_ready: true,
    credential_expires_at: "2027-08-24T10:00:00.000Z",
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["2000-08-24", "2030-08-24", "DateOfBirth", "document-key", "opaque"])
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  const start = providers.calls.find((call) => call.url.includes(":analyze?"));
  assert.match(start.url, /api-version=2024-11-30$/);
  const face = providers.calls.find((call) => call.url.includes("/face/v1.2/detect"));
  assert.match(face.url, /returnFaceId=false/);
  assert.match(face.url, /detectionModel=detection_03/);
  assert.match(face.url, /recognitionModel=recognition_04/);
});

test("an authenticity denial remains a hard false instead of being averaged with OCR confidence", async () => {
  const providers = fakeProviders({ reviewDecision: "denied" });
  const result = await verifyIdentityRequest(request(), config(), {
    fetchImpl: providers.fetchImpl, sleep: async () => {}, now: NOW,
  });
  assert.equal(result.document_authentic, false);
  assert.equal(result.authenticity_score, 0.1);
  assert.equal(result.provider_accepted, true);
});

test("a mismatched source digest fails before any provider can create a proof", async () => {
  const providers = fakeProviders({ media: Buffer.alloc(IMAGE.length, 0xff) });
  await assert.rejects(
    verifyIdentityRequest(request(), config(), { fetchImpl: providers.fetchImpl, now: NOW }),
    (error) => error.code === "document_fetch_hash_mismatch" && error.status === 409,
  );
  assert.equal(providers.calls.length, 1);
});

test("Document Intelligence polling is bound to the exact account, model and API version", async () => {
  const providers = fakeProviders({
    operationLocation: "https://vyakti-doc.cognitiveservices.azure.com/documentintelligence/documentModels/other/analyzeResults/result-1234?api-version=2024-11-30",
  });
  await assert.rejects(
    verifyIdentityRequest(request(), config(), { fetchImpl: providers.fetchImpl, now: NOW }),
    (error) => error.code === "document_operation_location_invalid",
  );
});

test("18th birthday uses the exact UTC calendar boundary", () => {
  assert.equal(extractIdentityFacts(analysis("2008-08-24").analyzeResult, NOW).adultEvidence, true);
  assert.equal(extractIdentityFacts(analysis("2008-08-25").analyzeResult, NOW).adultEvidence, false);
});

test("PDF extraction never claims a usable portrait without an explicit image extraction path", async () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2_038, 0x20)]);
  const providers = fakeProviders({ media: pdf });
  const payload = request({
    document: {
      ...request().document,
      sha256: sha256(pdf),
      byte_size: pdf.length,
      mime: "application/pdf",
    },
  });
  const original = providers.fetchImpl;
  providers.fetchImpl = async (url, init) => {
    if (String(url).startsWith("https://project.supabase.co/")) {
      return new Response(pdf, { headers: { "content-type": "application/pdf", "content-length": String(pdf.length) } });
    }
    return original(url, init);
  };
  const result = await verifyIdentityRequest(payload, config(), {
    fetchImpl: providers.fetchImpl, sleep: async () => {}, now: NOW,
  });
  assert.equal(result.face_reference_ready, false);
  assert.equal(providers.calls.some((call) => call.url.includes("/face/")), false);
});
