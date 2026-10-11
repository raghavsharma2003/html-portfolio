#!/usr/bin/env node
// Build a merge-ready opaque English listening pack from the consented owner
// reference. The reference bytes and transcript never leave process memory or
// appear in the public manifest. The private key is written to a sibling tree.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { q } from "../../api/_db.js";
import { readPrivateReplicaObject, REPLICA_STORAGE_BUCKET } from "../../api/_replica-storage.js";
import { sha256, wavPcm, wrapWav } from "../../evals/earbench/audio.mjs";

const PROTOCOL = "vyakti-open-voice/v1";
const PATH = "/v1/synthesize";
const DISCLOSURE = "This is an AI-generated voice replica.";
const OWNER_REFERENCE_OBJECT = "reference/owner-voice-20260826.wav";
const OWNER_REFERENCE_SHA256 = "c242261b9caa779eb6ddeeda24623c11c2aec01f8f7acafe47970bc17a1cb9b6";
const OWNER_REPLICA_ID = process.env.QWEN3_OWNER_REPLICA_ID || "6aff3202-abbd-4ca6-976b-4009ed5af028";
const SAMPLE_RATE = 24_000;
const REFERENCE_SECONDS = 12;
const OUT = resolve(process.env.QWEN3_TTS_EVAL_OUT || join(process.env.TEMP || ".", "vyakti-qwen3-tts-english"));
const SERVED = join(OUT, "stimuli");
const KEYS = join(OUT, "private");
const PRIVATE_REFERENCE_EVIDENCE = resolve(
  process.env.QWEN3_TTS_REFERENCE_EVIDENCE_OUT || "scratchpad/qwen3-owner-reference-asr.private.json",
);

const origin = String(process.env.QWEN3_TTS_EVAL_ORIGIN || "").replace(/\/+$/, "");
const hmacSecret = decodeSecret(process.env.QWEN3_TTS_HMAC_SECRET || "");
const sarvamKey = String(process.env.SARVAM_API_KEY || "");
const azureSpeechKey = String(process.env.AZURE_SPEECH_KEY || "");
const azureSpeechRegion = String(process.env.AZURE_SPEECH_REGION || "");
if (!/^https:\/\/[^/]+$/.test(origin)) throw new Error("qwen3_eval_origin_required");
if (!sarvamKey && (!azureSpeechKey || !/^[a-z0-9-]+$/i.test(azureSpeechRegion)))
  throw new Error("reference_asr_provider_required");

function decodeSecret(raw) {
  let value;
  try { value = /^[0-9a-f]{64,}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url"); }
  catch { throw new Error("qwen3_hmac_secret_invalid"); }
  if (value.length < 32) throw new Error("qwen3_hmac_secret_required");
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function signature(...parts) {
  return createHmac("sha256", hmacSecret).update(parts.join("\n")).digest("base64url");
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
  const selected = pcm.subarray(winner.offset, winner.offset + windowBytes);
  return {
    wav: wrapWav(selected),
    offsetMs: Math.round(winner.offset / 2 / SAMPLE_RATE * 1000),
    durationMs: REFERENCE_SECONDS * 1000,
    rms: winner.rms,
    clippedSamples: winner.clipped,
  };
}

async function transcribeReferenceHypothesis(referenceWav) {
  if (azureSpeechKey && /^[a-z0-9-]+$/i.test(azureSpeechRegion)) {
    const response = await fetch(
      `https://${azureSpeechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-IN&format=detailed`,
      {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=24000",
          "Ocp-Apim-Subscription-Key": azureSpeechKey,
        },
        body: referenceWav,
        signal: AbortSignal.timeout(180_000),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(`reference_asr_azure_http_${response.status}`);
    const transcript = String(body?.DisplayText || body?.NBest?.[0]?.Display || "").trim();
    if (transcript.length < 12 || /[\u0900-\u097f]/u.test(transcript) || !/[A-Za-z]/.test(transcript))
      throw new Error("reference_asr_not_english_latin");
    return { text: transcript, provider: "azure-speech-rest" };
  }
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
  return { text: transcript, provider: "sarvam-saarika-v2.5" };
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

async function synthesize(payload, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
      throw new Error("qwen3_response_signature_invalid");
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("qwen3_response_json_invalid"); }
    if (response.ok) return value;
    if (attempt === attempts || ![502, 503, 504].includes(response.status))
      throw new Error(String(value?.error || `qwen3_http_${response.status}`));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30_000));
  }
  throw new Error("qwen3_attempts_exhausted");
}

const promptDoc = JSON.parse(await (await import("node:fs/promises")).readFile(
  new URL("../../evals/voice-bakeoff/prompts.v1.json", import.meta.url), "utf8",
));
const prompts = promptDoc.promptSets.flatMap((set) => set.variants)
  .filter((item) => item.locale === "en-IN");
if (prompts.length !== 6) throw new Error("qwen3_matched_prompt_set_changed");

mkdirSync(SERVED, { recursive: true });
mkdirSync(KEYS, { recursive: true });
const stored = await readPrivateReplicaObject({
  storageBucket: REPLICA_STORAGE_BUCKET,
  objectPath: OWNER_REFERENCE_OBJECT,
}, { maxBytes: 64 * 1024 * 1024 });
const ownerWav = Buffer.from(stored.body);
if (sha256(ownerWav) !== OWNER_REFERENCE_SHA256) throw new Error("owner_reference_commitment_mismatch");
const reference = bestReferenceWindow(ownerWav);
const referenceHypothesis = await transcribeReferenceHypothesis(reference.wav);
const referenceText = referenceHypothesis.text;
const referenceHash = sha256(reference.wav);
mkdirSync(resolve(PRIVATE_REFERENCE_EVIDENCE, ".."), { recursive: true });
writeFileSync(PRIVATE_REFERENCE_EVIDENCE, JSON.stringify({
  contract: "vyakti-private-reference-asr/v1",
  evidence_scope: "asr_unreviewed",
  provider: referenceHypothesis.provider,
  source_object_sha256: OWNER_REFERENCE_SHA256,
  reference_sha256: referenceHash,
  reference_offset_ms: reference.offsetMs,
  reference_duration_ms: reference.durationMs,
  reference_sample_rate: SAMPLE_RATE,
  transcript_hypothesis: referenceText,
  transcript_hypothesis_sha256: sha256(Buffer.from(referenceText)),
}, null, 2), { mode: 0o600 });
if (process.env.QWEN3_TTS_PREPARE_REFERENCE_ONLY === "1") {
  console.log(`QWEN3_TTS_REFERENCE_EVIDENCE_READY ${PRIVATE_REFERENCE_EVIDENCE}`);
  process.exit(0);
}
const receipt = await activeConsentReceipt();
const referenceTextHash = sha256(Buffer.from(referenceText));
const key = [];
const publicItems = [];

for (let index = 0; index < prompts.length; index += 1) {
  const prompt = prompts[index];
  const generationId = randomUUID();
  const seed = promptDoc.seeds[index % promptDoc.seeds.length];
  const result = await synthesize({
    request_id: randomUUID(),
    generation_id: generationId,
    language_id: "en",
    text: `${DISCLOSURE} ${prompt.text}`,
    reference_audio_base64: reference.wav.toString("base64"),
    reference_sha256: referenceHash,
    reference_text: referenceText,
    reference_text_sha256: referenceTextHash,
    consent_receipt_sha256: receipt,
    seed,
  });
  const pcm = Buffer.from(String(result.audio_base64 || ""), "base64");
  if (!pcm.length || sha256(pcm) !== result.output_sha256 || result.perth_watermark_verified !== true)
    throw new Error("qwen3_output_binding_invalid");
  const blindId = createHash("sha256").update(`${generationId}:${randomBytes(16).toString("hex")}`).digest("hex").slice(0, 12);
  const filename = `${blindId}.wav`;
  const wav = wrapWav(pcm);
  writeFileSync(join(SERVED, filename), wav);
  publicItems.push({
    id: blindId,
    filename,
    prompt_sha256: sha256(Buffer.from(prompt.text)),
    wav_sha256: sha256(wav),
    duration_ms: result.duration_ms,
    sample_rate: result.sample_rate,
    perth_watermark_verified: result.perth_watermark_verified,
  });
  key.push({
    id: blindId,
    prompt_id: prompt.id,
    generation_id: generationId,
    model: result.model,
    model_repo: result.model_repo,
    model_commitment: result.model_commitment,
    model_revision: result.model_revision,
    reference_sha256: result.reference_sha256,
    reference_duration_ms: result.reference_duration_ms,
    reference_text_sha256: result.reference_text_sha256,
    consent_receipt_sha256: result.consent_receipt_sha256,
    output_sha256: result.output_sha256,
    sample_rate: result.sample_rate,
    duration_ms: result.duration_ms,
    generation_parameters: result.generation_parameters,
    elapsed_ms: result.elapsed_ms,
    real_time_factor: result.real_time_factor,
    perth_score: result.perth_score,
  });
  console.log(`sealed ${index + 1}/${prompts.length}: ${blindId}`);
}

const publicManifest = {
  contract: "vyakti-qwen3-tts-blind-pack/v1",
  created_at: new Date().toISOString(),
  arm_identity: "sealed",
  human_listening_status: "not_started",
  disclosure_request_enforced: true,
  spoken_disclosure_verification: "pending_listener",
  evaluation_only: true,
  prompt_set_sha256: sha256(Buffer.from(canonical(prompts.map(({ id, text }) => ({ id, text }))))),
  reference_sha256: referenceHash,
  reference_duration_ms: reference.durationMs,
  reference_offset_ms: reference.offsetMs,
  reference_rms: Number(reference.rms.toFixed(8)),
  reference_clipped_samples: reference.clippedSamples,
  reference_text_sha256: referenceTextHash,
  reference_text_evidence_scope: "asr_unreviewed",
  reference_text_provider: referenceHypothesis.provider,
  items: publicItems,
};
writeFileSync(join(SERVED, "manifest.json"), JSON.stringify(publicManifest, null, 2));
writeFileSync(join(KEYS, "key.json"), JSON.stringify({
  ...publicManifest,
  arm_identity: "qwen3-tts-12hz-1.7b-base",
  owner_reference_object: OWNER_REFERENCE_OBJECT,
  owner_replica_id: OWNER_REPLICA_ID,
  items: key,
}, null, 2));
console.log(`QWEN3_TTS_PACK_READY ${SERVED}`);
