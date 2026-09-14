import { fail, finiteScore } from "./errors.js";
import { abortAfter, boundedJson } from "./http.js";

function authHeaders(config) {
  return { "Ocp-Apim-Subscription-Key": config.document.key };
}

function sameAnalyzeLocation(value, config) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail("document_operation_location_invalid"); }
  const expected = new URL(config.document.endpoint);
  const pathPrefix = `/documentintelligence/documentModels/${encodeURIComponent(config.document.model)}/analyzeResults/`;
  const resultId = url.pathname.slice(pathPrefix.length);
  if (url.origin !== expected.origin || url.username || url.password || url.hash ||
      !url.pathname.startsWith(pathPrefix) || !/^[A-Za-z0-9-]{8,128}$/.test(resultId) ||
      url.searchParams.size !== 1 || url.searchParams.get("api-version") !== config.document.apiVersion)
    fail("document_operation_location_invalid");
  return url.toString();
}

export async function analyzeIdentityDocument(bytes, mime, config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startUrl = `${config.document.endpoint}/documentintelligence/documentModels/${config.document.model}:analyze?_overload=analyzeDocument&api-version=${config.document.apiVersion}`;
  let start;
  try {
    start = await fetchImpl(startUrl, {
      method: "POST",
      headers: { ...authHeaders(config), "Content-Type": mime },
      body: bytes,
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("document_intelligence_unreachable"); }
  if (start.status !== 202) fail(`document_intelligence_http_${start.status}`, start.status >= 500 ? 503 : 409);
  const location = sameAnalyzeLocation(start.headers.get("operation-location"), config);
  for (let attempt = 0; attempt < config.document.maxPolls; attempt++) {
    if (attempt) await sleep(config.document.pollMs);
    let response;
    try {
      response = await fetchImpl(location, {
        method: "GET",
        headers: authHeaders(config),
        redirect: "error",
        signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
      });
    } catch { fail("document_intelligence_unreachable"); }
    if (!response.ok) fail(`document_intelligence_http_${response.status}`, response.status >= 500 ? 503 : 409);
    const result = await boundedJson(response, config.limits.providerBytes, "document_intelligence_response_invalid");
    const status = String(result?.status || "").toLowerCase();
    if (["notstarted", "running"].includes(status)) continue;
    if (status !== "succeeded") fail("document_intelligence_analysis_failed", 409);
    if (result?.analyzeResult?.apiVersion !== config.document.apiVersion || result?.analyzeResult?.modelId !== config.document.model)
      fail("document_intelligence_model_binding_invalid");
    return Object.freeze({ resultId: new URL(location).pathname.split("/").at(-1), analyzeResult: result.analyzeResult });
  }
  fail("document_intelligence_timeout");
}

function exactDate(field) {
  const raw = String(field?.valueDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date;
}

function yearsAt(birth, now) {
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) years--;
  return years;
}

export function extractIdentityFacts(analyzeResult, now = new Date()) {
  const documents = Array.isArray(analyzeResult?.documents) ? analyzeResult.documents : [];
  if (documents.length !== 1) fail("identity_document_count_invalid", 409);
  const fields = documents[0]?.fields || {};
  const birth = exactDate(fields.DateOfBirth);
  const expiration = exactDate(fields.DateOfExpiration);
  const birthConfidence = finiteScore(fields.DateOfBirth?.confidence, "identity_birth_confidence_invalid");
  const expirationConfidence = expiration
    ? finiteScore(fields.DateOfExpiration?.confidence, "identity_expiry_confidence_invalid")
    : 1;
  const documentConfidence = finiteScore(documents[0]?.confidence ?? 0, "identity_document_confidence_invalid");
  if (!birth) fail("identity_birth_date_unavailable", 409);
  return Object.freeze({
    adultEvidence: yearsAt(birth, now) >= 18,
    documentExpired: expiration ? expiration.getTime() < now.getTime() : false,
    expiration,
    extractionConfidence: Math.min(birthConfidence, expirationConfidence, documentConfidence),
  });
}
