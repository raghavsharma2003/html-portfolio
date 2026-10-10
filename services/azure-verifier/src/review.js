import { canonicalJson, hmac, validHmac } from "./canonical.js";
import { fail, finiteScore } from "./errors.js";
import { abortAfter, boundedBytes } from "./http.js";

const PROTOCOL = "vyakti-document-authenticity-review/v1";

export async function independentDocumentReview(input, config, options = {}) {
  const payload = canonicalJson({
    protocol: PROTOCOL,
    request_id: input.requestId,
    input_sha256: input.sha256,
    document: {
      url: input.url,
      expires_at: input.expiresAt,
      mime: input.mime,
      byte_size: input.byteSize,
    },
    review_version: config.review.version,
  });
  let response;
  try {
    response = await (options.fetchImpl || fetch)(config.review.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vyakti-Protocol": PROTOCOL,
        "X-Vyakti-Signature": `sha256=${hmac(config.review.hmacKey, payload)}`,
      },
      body: payload,
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("document_review_unreachable"); }
  const bytes = await boundedBytes(response, config.limits.providerBytes, "document_review_response_too_large");
  const body = bytes.toString("utf8");
  if (!response.ok) fail(`document_review_http_${response.status}`, response.status >= 500 ? 503 : 409);
  if (!validHmac(config.review.hmacKey, body, response.headers.get("x-vyakti-response-signature")))
    fail("document_review_signature_invalid");
  let result;
  try { result = JSON.parse(body); } catch { fail("document_review_response_invalid"); }
  if (result?.request_id !== input.requestId || result?.input_sha256 !== input.sha256 ||
      result?.review_version !== config.review.version) fail("document_review_binding_invalid");
  if (result?.decision === "pending") fail("document_review_pending");
  if (!["approved", "denied"].includes(result?.decision)) fail("document_review_decision_invalid");
  return Object.freeze({
    documentAuthentic: result.decision === "approved" && result.document_authentic === true,
    documentCurrent: result.document_current === true,
    nonExpiring: result.non_expiring === true,
    authenticityScore: finiteScore(result.authenticity_score, "document_review_score_invalid"),
  });
}
