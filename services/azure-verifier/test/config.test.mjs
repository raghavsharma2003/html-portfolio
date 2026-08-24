import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = Object.freeze({
  VYAKTI_PRIVATE_SOURCE_ORIGIN: "https://project.supabase.co",
  VYAKTI_BROKER_HMAC_KEY_B64: KEY,
  VERIFIER_VERSION: "identity-2026.08.24+1",
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://vyakti-doc.cognitiveservices.azure.com",
  AZURE_DOCUMENT_INTELLIGENCE_KEY: "document-key",
  AZURE_FACE_ENDPOINT: "https://vyakti-face.cognitiveservices.azure.com",
  AZURE_FACE_KEY: "face-key",
  AZURE_DOCUMENT_REVIEW_ENDPOINT: "https://vyakti-review.azurecontainerapps.io",
  AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64: KEY,
  AZURE_DOCUMENT_REVIEW_VERSION: "review-2026.08.24+1",
});

test("configuration pins providers and accepts only strict Azure/Supabase boundaries", () => {
  const config = loadConfig(ENV);
  assert.equal(config.document.apiVersion, "2024-11-30");
  assert.equal(config.document.model, "prebuilt-idDocument");
  assert.equal(config.face.apiVersion, "v1.2");
  assert.equal(config.sourceOrigin, "https://project.supabase.co");
  assert.equal(config.review.endpoint, "https://vyakti-review.azurecontainerapps.io/v1/document/review");
});

test("liveness remains disabled unless limited access is explicitly approved and every security parameter is pinned", () => {
  assert.equal(loadConfig(ENV).liveness.enabled, false);
  assert.throws(() => loadConfig({ ...ENV, AZURE_FACE_LIVENESS_ENABLED: "true" }),
    (error) => error.code === "face_liveness_approval_required");
  const liveness = loadConfig({
    ...ENV,
    AZURE_FACE_LIVENESS_ENABLED: "true",
    AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED: "true",
    AZURE_FACE_LIVENESS_MODEL_VERSION: "2025-05-20",
    AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD: "0.9",
    AZURE_LIVENESS_SESSION_SEAL_KEY_B64: KEY,
    VYAKTI_PUBLIC_APP_ORIGIN: "https://vyakti.example",
  }).liveness;
  assert.equal(liveness.enabled, true);
  assert.equal(liveness.modelVersion, "2025-05-20");
  assert.equal(liveness.returnUrl, "https://vyakti.example/studio?liveness=return");
});

for (const [name, value, code] of [
  ["VERIFIER_VERSION", "latest", "verifier_version_required"],
  ["PORT", "NaN", "port_invalid"],
  ["MAX_CONCURRENCY", "2.5", "max_concurrency_invalid"],
  ["DOCUMENT_MAX_POLLS", "999", "document_max_polls_invalid"],
  ["VYAKTI_BROKER_HMAC_KEY_B64", Buffer.alloc(31).toString("base64"), "broker_hmac_key_required"],
  ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "https://cognitiveservices.azure.com.evil.test", "document_endpoint_required"],
  ["VYAKTI_PRIVATE_SOURCE_ORIGIN", "https://project.supabase.co.evil.test", "source_origin_required"],
]) {
  test(`configuration rejects ${name}`, () => {
    assert.throws(() => loadConfig({ ...ENV, [name]: value }), (error) => error.code === code);
  });
}
