import { fail } from "./errors.js";
import { abortAfter, boundedJson } from "./http.js";

export async function inspectIdentityPortrait(bytes, mime, config, options = {}) {
  if (mime === "application/pdf") return Object.freeze({ faceReferenceReady: false, portraitConfidence: 0 });
  // Azure Face detect accepts binary images from 1 KB through 6 MB. A larger
  // identity image may still be extracted by Document Intelligence, but it is
  // not silently resized or re-encoded here because that would break the exact
  // source digest bound to the verification decision.
  if (bytes.length < 1_024 || bytes.length > 6 * 1_024 * 1_024)
    return Object.freeze({ faceReferenceReady: false, portraitConfidence: 0 });
  const query = new URLSearchParams({
    _overload: "detect",
    detectionModel: config.face.detectionModel,
    recognitionModel: config.face.recognitionModel,
    returnFaceId: "false",
    returnFaceAttributes: "qualityForRecognition",
    returnFaceLandmarks: "false",
    returnRecognitionModel: "false",
  });
  let response;
  try {
    response = await (options.fetchImpl || fetch)(`${config.face.endpoint}/face/${config.face.apiVersion}/detect?${query}`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": config.face.key, "Content-Type": "application/octet-stream" },
      body: bytes,
      redirect: "error",
      signal: abortAfter(config.limits.providerDeadlineMs, options.signal),
    });
  } catch { fail("face_preflight_unreachable"); }
  if (!response.ok) fail(`face_preflight_http_${response.status}`, response.status >= 500 ? 503 : 409);
  const faces = await boundedJson(response, config.limits.providerBytes, "face_preflight_response_invalid");
  if (!Array.isArray(faces) || faces.length !== 1)
    return Object.freeze({ faceReferenceReady: false, portraitConfidence: 0 });
  const quality = String(faces[0]?.faceAttributes?.qualityForRecognition || "").toLowerCase();
  const score = quality === "high" ? 0.99 : quality === "medium" ? 0.8 : quality === "low" ? 0.4 : 0;
  return Object.freeze({ faceReferenceReady: quality === "high", portraitConfidence: score });
}
