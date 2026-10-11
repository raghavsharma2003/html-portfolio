#!/usr/bin/env node
// Produce an opaque Hindi/Hinglish owner-reference pack. Private reference
// audio, its transcript, the signing key and arm labels never enter the served
// manifest.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { q } from "../../api/_db.js";
import { readPrivateReplicaObject, REPLICA_STORAGE_BUCKET } from "../../api/_replica-storage.js";
import { sha256, wavPcm, wrapWav } from "../../evals/earbench/audio.mjs";

const PROTOCOL = "vyakti-open-voice/v1";
const PATH = "/v1/synthesize";
const DISCLOSURE = "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।";
const OWNER_REFERENCE_OBJECT = "reference/owner-voice-20260826.wav";
const OWNER_REFERENCE_SHA256 = "c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6";
const OWNER_REPLICA_ID = process.env.INDICF5_OWNER_REPLICA_ID || "6aff3202-abbd-4ca6-976b-4009ed5af028";
const SAMPLE_RATE = 24_000;
const REFERENCE_SECONDS = 12;
const PRONUNCIATION_NORMALIZATION = Object.freeze({
  contract: "vyakti-indicf5-pronunciation-normalizer/v1",
  domain: "chemistry",
  locale: "hi-IN",
  mode: "required",
});
const OUT = resolve(process.env.INDICF5_EVAL_OUT || join("scratchpad", `indicf5-${Date.now()}`));
const SERVED = join(OUT, "blind");
const PRIVATE = join(OUT, "private");
const origin = String(process.env.INDICF5_EVAL_ORIGIN || "").replace(/\/+$/, "");
const secret = decodeSecret(process.env.INDICF5_HMAC_SECRET || "");
const sarvamKey = String(process.env.SARVAM_API_KEY || "");
const suppliedReferenceHypothesis = String(process.env.INDICF5_REFERENCE_TEXT || "").trim();

if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error("indicf5_eval_origin_required");
if (!sarvamKey && !suppliedReferenceHypothesis) throw new Error("reference_asr_hypothesis_required");

function decodeSecret(raw) {
  let value;
  try { value = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { throw new Error("indicf5_hmac_secret_invalid"); }
  if (value.length < 32) throw new Error("indicf5_hmac_secret_required");
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizationRequest(text) {
  return {
    text,
    text_sha256: sha256(Buffer.from(text)),
    pronunciation_normalization: PRONUNCIATION_NORMALIZATION,
  };
}

function verifyNormalizationReceipt(sourceText, receipt) {
  if (!receipt || receipt.contract !== PRONUNCIATION_NORMALIZATION.contract ||
      receipt.domain !== PRONUNCIATION_NORMALIZATION.domain ||
      receipt.locale !== PRONUNCIATION_NORMALIZATION.locale ||
      receipt.source_text_sha256 !== sha256(Buffer.from(sourceText)) ||
      !/^[0-9a-f]{64}$/.test(String(receipt.synthesis_text_sha256 || "")) ||
      !/^[0-9a-f]{64}$/.test(String(receipt.audit_sha256 || "")) ||
      !Array.isArray(receipt.transformations) || !Array.isArray(receipt.warnings) ||
      !Number.isInteger(receipt.transformation_count) || receipt.transformation_count < 0 ||
      receipt.transformation_count > 64 || receipt.transformation_count !== receipt.transformations.length) {
    throw new Error("indicf5_pronunciation_receipt_invalid");
  }
  const sourceCodepoints = [...sourceText];
  const rebuilt = [];
  let cursor = 0;
  const coverage = { chemical_symbol_units: 0, numeral_units: 0, operator_units: 0 };
  for (let index = 0; index < receipt.transformations.length; index += 1) {
    const item = receipt.transformations[index];
    const start = item?.source_start_codepoint;
    const end = item?.source_end_codepoint;
    if (item?.sequence !== index + 1 || !Number.isInteger(start) || !Number.isInteger(end) ||
        start < cursor || end <= start || end > sourceCodepoints.length) {
      throw new Error("indicf5_pronunciation_transform_span_invalid");
    }
    const source = sourceCodepoints.slice(start, end).join("");
    const synthesis = String(item.synthesis_text || "");
    if (!source || !synthesis || source !== item.source_text ||
        sha256(Buffer.from(source)) !== item.source_sha256 ||
        sha256(Buffer.from(synthesis)) !== item.synthesis_sha256) {
      throw new Error("indicf5_pronunciation_transform_binding_invalid");
    }
    const covered = item.covered_units;
    if (!covered || ![covered.chemical_symbols, covered.numerals, covered.operators]
      .every((value) => Number.isInteger(value) && value >= 0)) {
      throw new Error("indicf5_pronunciation_coverage_invalid");
    }
    coverage.chemical_symbol_units += covered.chemical_symbols;
    coverage.numeral_units += covered.numerals;
    coverage.operator_units += covered.operators;
    rebuilt.push(sourceCodepoints.slice(cursor, start).join(""), synthesis);
    cursor = end;
  }
  rebuilt.push(sourceCodepoints.slice(cursor).join(""));
  const synthesisText = rebuilt.join("");
  if (sha256(Buffer.from(synthesisText)) !== receipt.synthesis_text_sha256 ||
      receipt.changed !== (sourceText !== synthesisText) ||
      canonical(receipt.coverage) !== canonical(coverage)) {
    throw new Error("indicf5_pronunciation_receipt_binding_invalid");
  }
  const core = {
    contract: receipt.contract,
    domain: receipt.domain,
    locale: receipt.locale,
    source_text: sourceText,
    source_sha256: receipt.source_text_sha256,
    synthesis_text: synthesisText,
    synthesis_sha256: receipt.synthesis_text_sha256,
    changed: receipt.changed,
    transformation_count: receipt.transformation_count,
    transformations: receipt.transformations,
    coverage: receipt.coverage,
    warnings: receipt.warnings,
  };
  if (sha256(Buffer.from(canonical(core))) !== receipt.audit_sha256) {
    throw new Error("indicf5_pronunciation_audit_invalid");
  }
  return { synthesisText, coverage };
}

function signature(...parts) {
  return createHmac("sha256", secret).update(parts.join("\n")).digest("base64url");
}

function equal(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

function bestReferenceWindow(wav) {
  const pcm = wavPcm(wav);
  const windowBytes = REFERENCE_SECONDS * SAMPLE_RATE * 2;
  const stepBytes = SAMPLE_RATE * 2;
  if (pcm.length < windowBytes) throw new Error("owner_reference_too_short");
  let winner = null;
  for (let offset = 0; offset + windowBytes <= pcm.length; offset += stepBytes) {
    let sumSquares = 0;
    let clipped = 0;
    for (let cursor = offset; cursor < offset + windowBytes; cursor += 2) {
      const sample = pcm.readInt16LE(cursor) / 32768;
      sumSquares += sample * sample;
      if (Math.abs(sample) >= 0.99) clipped += 1;
    }
    const rms = Math.sqrt(sumSquares / (windowBytes / 2));
    const score = rms - clipped * 0.001;
    if (!winner || score > winner.score) winner = { offset, rms, clipped, score };
  }
  return {
    wav: wrapWav(pcm.subarray(winner.offset, winner.offset + windowBytes)),
    offsetMs: Math.round(winner.offset / 2 / SAMPLE_RATE * 1000),
    durationMs: REFERENCE_SECONDS * 1000,
    rms: winner.rms,
    clippedSamples: winner.clipped,
  };
}

async function transcribeReferenceHypothesis(referenceWav) {
  const form = new FormData();
  form.append("file", new Blob([referenceWav], { type: "audio/wav" }), "owner-reference.wav");
  form.append("model", "saarika:v2.5");
  form.append("language_code", "en-IN");
  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": sarvamKey },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`reference_asr_http_${response.status}`);
  const transcript = String(body?.transcript || "").trim();
  if (transcript.length < 12 || /[\u0900-\u097f]/u.test(transcript) || !/[A-Za-z]/.test(transcript))
    throw new Error("reference_asr_not_english_latin");
  return transcript;
}

async function activeConsentReceipt() {
  const rows = await q(
    `select c.receipt_hash
       from vy_replica r join vy_replica_consent c
         on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
      where r.replica_id=$1::uuid and r.subject_mode='self'
        and r.lifecycle not in ('revoked','purging') and c.scope='inference'
        and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
      order by c.granted_at desc limit 1`,
    [OWNER_REPLICA_ID],
  );
  const receipt = String(rows[0]?.receipt_hash || "");
  if (!/^[0-9a-f]{64}$/i.test(receipt)) throw new Error("active_owner_consent_receipt_required");
  return receipt.toLowerCase();
}

async function signedCall(payload) {
  const body = Buffer.from(canonical(payload));
  const bodyHash = sha256(body);
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(18).toString("base64url");
  const response = await fetch(`${origin}${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Vyakti-Protocol": PROTOCOL,
      "X-Vyakti-Timestamp": timestamp,
      "X-Vyakti-Nonce": nonce,
      "X-Vyakti-Content-SHA256": bodyHash,
      "X-Vyakti-Signature": signature(PROTOCOL, "POST", PATH, timestamp, nonce, bodyHash),
    },
    body,
    signal: AbortSignal.timeout(240_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = signature(PROTOCOL, "response", PATH, nonce, String(response.status), sha256(bytes));
  if (!equal(response.headers.get("x-vyakti-response-signature"), expected))
    throw new Error("indicf5_response_signature_invalid");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("indicf5_response_json_invalid"); }
  if (!response.ok) throw Object.assign(new Error(value?.error || `indicf5_http_${response.status}`), { code: value?.error, status: response.status });
  return value;
}

async function synthesize(payload) {
  let last;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try { return { value: await signedCall(payload), attempt }; }
    catch (error) {
      last = error;
      const retryable = [502, 503, 504].includes(error.status) ||
        error?.name === "TimeoutError" || error?.code === "UND_ERR_CONNECT_TIMEOUT";
      if (attempt === 12 || !retryable) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30_000));
    }
  }
  throw last;
}

const promptDoc = JSON.parse(await (await import("node:fs/promises")).readFile(
  new URL("../../evals/voice-bakeoff/prompts.v1.json", import.meta.url), "utf8",
));
const selectedSets = new Set(["reaction-definition", "equation-reading", "student-correction"]);
const prompts = promptDoc.promptSets
  .filter((set) => selectedSets.has(set.id))
  .flatMap((set) => set.variants)
  .filter((item) => item.locale === "hi-IN" && ["devanagari", "mixed"].includes(item.script));
if (prompts.length !== 6) throw new Error("indicf5_matched_prompt_set_changed");

mkdirSync(SERVED, { recursive: true });
mkdirSync(PRIVATE, { recursive: true });
const stored = await readPrivateReplicaObject({
  storageBucket: REPLICA_STORAGE_BUCKET,
  objectPath: OWNER_REFERENCE_OBJECT,
}, { maxBytes: 64 * 1024 * 1024 });
const ownerWav = Buffer.from(stored.body);
if (sha256(ownerWav) !== OWNER_REFERENCE_SHA256) throw new Error("owner_reference_commitment_mismatch");
const reference = bestReferenceWindow(ownerWav);
const referenceText = suppliedReferenceHypothesis || await transcribeReferenceHypothesis(reference.wav);
const hasInvalidControl = [...referenceText].some((character) => character.codePointAt(0) < 32 && character !== "\n" && character !== "\t");
if (referenceText.length < 12 || referenceText.length > 2_000 || hasInvalidControl)
  throw new Error("reference_asr_hypothesis_invalid");
const referenceTranscriptEvidenceScope = "asr_unreviewed";
const receipt = await activeConsentReceipt();
const referenceHash = sha256(reference.wav);
const referenceTextHash = sha256(Buffer.from(referenceText));
const publicItems = [];
const privateItems = [];

const canaryText = `${DISCLOSURE} नमस्ते।`;
const canaryPayload = {
  request_id: randomUUID(),
  generation_id: randomUUID(),
  language_id: "hi",
  ...normalizationRequest(canaryText),
  reference_audio_base64: reference.wav.toString("base64"),
  reference_sha256: referenceHash,
  reference_text: referenceText,
  reference_text_sha256: referenceTextHash,
  consent_receipt_sha256: receipt,
  seed: promptDoc.seeds[0],
};
const canary = await synthesize(canaryPayload);
const canaryNormalization = verifyNormalizationReceipt(
  canaryText, canary.value.pronunciation_normalization_receipt,
);
if (canary.value.model_revision !== "ba85abedf18dc479a447eaa0eccbd76ab78a47d5" ||
    canary.value.reference_sha256 !== referenceHash ||
    canary.value.reference_text_sha256 !== referenceTextHash ||
    canary.value.consent_receipt_sha256 !== receipt ||
    canary.value.perth_watermark_verified !== true ||
    canary.value.duration_contract !== "vyakti-indicf5-codepoint-duration/v1" ||
    canaryNormalization.synthesisText !== canaryText ||
    canary.value.pronunciation_normalization_receipt.transformation_count !== 0)
  throw new Error("indicf5_canary_binding_invalid");
console.log(`canary ready after ${canary.attempt} attempt(s)`);

for (let index = 0; index < prompts.length; index += 1) {
  const prompt = prompts[index];
  const generationId = randomUUID();
  const sourceText = `${DISCLOSURE} ${prompt.text}`;
  const { value, attempt } = await synthesize({
    request_id: randomUUID(),
    generation_id: generationId,
    language_id: "hi",
    ...normalizationRequest(sourceText),
    reference_audio_base64: reference.wav.toString("base64"),
    reference_sha256: referenceHash,
    reference_text: referenceText,
    reference_text_sha256: referenceTextHash,
    consent_receipt_sha256: receipt,
    seed: promptDoc.seeds[index % promptDoc.seeds.length],
  });
  const normalization = verifyNormalizationReceipt(
    sourceText, value.pronunciation_normalization_receipt,
  );
  const expectedCoverage = prompt.id === "equation-reading-code-switch"
    ? { chemical_symbol_units: 4, numeral_units: 3, operator_units: 0 }
    : { chemical_symbol_units: 0, numeral_units: 0, operator_units: 0 };
  const expectedTransformations = prompt.id === "equation-reading-code-switch" ? 4 : 0;
  const pcm = Buffer.from(String(value.audio_base64 || ""), "base64");
  if (!pcm.length || sha256(pcm) !== value.output_sha256 || value.perth_watermark_verified !== true ||
      value.model_revision !== "ba85abedf18dc479a447eaa0eccbd76ab78a47d5" ||
      value.reference_sha256 !== referenceHash || value.reference_text_sha256 !== referenceTextHash ||
      value.consent_receipt_sha256 !== receipt ||
      value.duration_contract !== "vyakti-indicf5-codepoint-duration/v1" ||
      value.text_sha256 !== sha256(Buffer.from(sourceText)) ||
      canonical(normalization.coverage) !== canonical(expectedCoverage) ||
      value.pronunciation_normalization_receipt.transformation_count !== expectedTransformations ||
      (expectedTransformations === 0 && normalization.synthesisText !== sourceText) ||
      !Number.isFinite(value.duration_speed) || value.duration_speed < 0.75 || value.duration_speed > 3.5 ||
      !Number.isInteger(value.predicted_generation_ms) || value.predicted_generation_ms > 30_000)
    throw new Error("indicf5_output_binding_invalid");
  const wav = wrapWav(pcm);
  const blindId = createHash("sha256").update(`${generationId}:${randomBytes(16).toString("hex")}`).digest("hex").slice(0, 24);
  const filename = `${blindId}.wav`;
  writeFileSync(join(SERVED, filename), wav);
  publicItems.push({
    id: blindId,
    filename,
    prompt_sha256: sha256(Buffer.from(prompt.text)),
    wav_sha256: sha256(wav),
    duration_ms: value.duration_ms,
    sample_rate: value.sample_rate,
    perth_watermark_verified: true,
  });
  privateItems.push({
    id: blindId,
    prompt_id: prompt.id,
    generation_id: generationId,
    model: value.model,
    model_commitment: value.model_commitment,
    model_revision: value.model_revision,
    reference_sha256: value.reference_sha256,
    reference_text_sha256: value.reference_text_sha256,
    consent_receipt_sha256: value.consent_receipt_sha256,
    elapsed_ms: value.elapsed_ms,
    real_time_factor: value.real_time_factor,
    perth_score: value.perth_score,
    wake_attempt: attempt,
    duration_contract: value.duration_contract,
    duration_speed: value.duration_speed,
    predicted_generation_ms: value.predicted_generation_ms,
    pronunciation_normalization_receipt: value.pronunciation_normalization_receipt,
  });
  console.log(`sealed ${index + 1}/${prompts.length}: ${blindId}`);
}

const manifest = {
  contract: "vyakti-indicf5-blind-pack/v1",
  created_at: new Date().toISOString(),
  arm_identity: "sealed",
  human_listening_status: "not_started",
  disclosure_present: true,
  evaluation_only: true,
  reference_sha256: referenceHash,
  reference_duration_ms: reference.durationMs,
  reference_offset_ms: reference.offsetMs,
  reference_rms: Number(reference.rms.toFixed(8)),
  reference_clipped_samples: reference.clippedSamples,
  reference_text_sha256: referenceTextHash,
  reference_transcript_evidence_scope: referenceTranscriptEvidenceScope,
  canary: {
    scored: false,
    duration_ms: canary.value.duration_ms,
    elapsed_ms: canary.value.elapsed_ms,
    wake_attempt: canary.attempt,
    duration_speed: canary.value.duration_speed,
    predicted_generation_ms: canary.value.predicted_generation_ms,
    perth_watermark_verified: true,
    pronunciation_normalization_contract: PRONUNCIATION_NORMALIZATION.contract,
    pronunciation_audit_sha256: canary.value.pronunciation_normalization_receipt.audit_sha256,
  },
  items: publicItems,
};
writeFileSync(join(SERVED, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(PRIVATE, "key.json"), JSON.stringify({
  ...manifest,
  arm_identity: "ai4bharat-indicf5",
  owner_reference_object: OWNER_REFERENCE_OBJECT,
  owner_replica_id: OWNER_REPLICA_ID,
  items: privateItems,
}, null, 2));
console.log(`INDICF5_PACK_READY ${SERVED}`);
