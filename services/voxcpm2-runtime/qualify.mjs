#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const PROTOCOL = "vyakti-open-voice/v1";
const PATH = "/v1/synthesize";
const SAMPLE_RATE = 24_000;
const DISCLOSURE = {
  hi: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
  en: "This is an AI-generated voice replica.",
};
const PROMPTS = [
  { id: "hi", languageId: "hi", body: "आज हम रासायनिक समीकरण को संतुलित करेंगे और हर चरण को ध्यान से समझेंगे।" },
  { id: "hinglish", languageId: "hi", body: "आज हम chemical equation को balance करेंगे, और फिर reaction का logic समझेंगे।" },
  { id: "en", languageId: "en", body: "Today we will balance the chemical equation and explain every step clearly." },
];

const sha = (value) => createHash("sha256").update(value).digest("hex");
const b64url = (value) => Buffer.from(value).toString("base64url");
const secretBytes = (value) => /^[0-9a-f]{64,}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
const signature = (secret, ...parts) => b64url(createHmac("sha256", secret).update(parts.join("\n")).digest());
const canonical = (value) => Buffer.from(JSON.stringify(value, Object.keys(value).sort()));

function wavPcm(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("reference_wav_invalid");
  let offset = 12;
  let format = null;
  let pcm = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") format = { codec: bytes.readUInt16LE(body), channels: bytes.readUInt16LE(body + 2), rate: bytes.readUInt32LE(body + 4), width: bytes.readUInt16LE(body + 14) };
    if (id === "data") pcm = bytes.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  if (!format || !pcm || format.codec !== 1 || format.channels !== 1 || format.rate !== SAMPLE_RATE || format.width !== 16) throw new Error("reference_wav_invalid");
  return pcm;
}

function wrapWav(pcm) {
  const out = Buffer.alloc(44 + pcm.length);
  out.write("RIFF", 0); out.writeUInt32LE(36 + pcm.length, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24); out.writeUInt32LE(SAMPLE_RATE * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36);
  out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return out;
}

function cropReference(bytes, startSeconds = 25, seconds = 10) {
  const pcm = wavPcm(bytes);
  const start = Math.min(pcm.length, SAMPLE_RATE * 2 * startSeconds);
  const end = Math.min(pcm.length, start + SAMPLE_RATE * 2 * seconds);
  return { bytes: wrapWav(pcm.subarray(start, end)), startMs: Math.round(start / 2 / SAMPLE_RATE * 1000), endMs: Math.round(end / 2 / SAMPLE_RATE * 1000) };
}

async function signedCall(origin, secret, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const bodyHash = sha(body);
  const response = await fetch(`${origin}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vyakti-protocol": PROTOCOL,
      "x-vyakti-timestamp": timestamp,
      "x-vyakti-nonce": nonce,
      "x-vyakti-content-sha256": bodyHash,
      "x-vyakti-signature": signature(secret, PROTOCOL, "POST", PATH, timestamp, nonce, bodyHash),
    },
    body,
    signal: AbortSignal.timeout(240_000),
  });
  const responseBody = Buffer.from(await response.arrayBuffer());
  const expected = signature(secret, PROTOCOL, "response", PATH, nonce, String(response.status), sha(responseBody));
  if (response.headers.get("x-vyakti-response-signature") !== expected) throw new Error("response_signature_invalid");
  const result = JSON.parse(responseBody.toString("utf8"));
  if (!response.ok) throw Object.assign(new Error(result.error || `http_${response.status}`), { code: result.error, status: response.status });
  return { result, responseSignature: expected };
}

async function warmGate(origin) {
  let last = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(20_000) });
      const body = response.ok ? await response.json() : null;
      if (response.ok && body?.ready === true) return attempt;
      last = new Error(`voxcpm2_gate_health_${response.status}`);
    } catch (error) {
      last = error;
    }
    if (attempt < 8) await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw Object.assign(new Error("voxcpm2_gate_unreachable"), { cause: last });
}

async function callWithWake(origin, secret, payload) {
  let last = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return { ...(await signedCall(origin, secret, payload)), attempt };
    } catch (error) {
      last = error;
      if (!["open_voice_runtime_unreachable", "voxcpm2_synthesis_failed"].includes(error.code) || attempt === 8) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30_000));
    }
  }
  throw last;
}

const [referenceArg, outArg] = process.argv.slice(2);
if (!referenceArg) throw new Error("usage: node qualify.mjs reference.wav [output-dir]");
const origin = String(process.env.VOXCPM2_EVAL_ORIGIN || "").replace(/\/$/, "");
const rawSecret = String(process.env.VOXCPM2_HMAC_SECRET || "");
const replicaId = String(process.env.VOXCPM2_REPLICA_ID || "");
const consentReceipt = String(process.env.VOXCPM2_CONSENT_RECEIPT_SHA256 || "");
if (!origin || !rawSecret || !replicaId || !/^[0-9a-f]{64}$/.test(consentReceipt)) throw new Error("voxcpm2_qualification_env_missing");
const secret = secretBytes(rawSecret);
if (secret.length < 32) throw new Error("voxcpm2_hmac_secret_invalid");
const sourceReference = readFileSync(resolve(referenceArg));
const sourceReferenceSha = sha(sourceReference);
const cropped = cropReference(sourceReference);
const reference = cropped.bytes;
const referenceSha = sha(reference);
const out = resolve(outArg || join("scratchpad", `voxcpm2-${Date.now()}`));
mkdirSync(join(out, "blind"), { recursive: true });
mkdirSync(join(out, "receipts"), { recursive: true });
const key = [];
const gateWakeAttempt = await warmGate(origin);

for (let index = 0; index < PROMPTS.length; index += 1) {
  const prompt = PROMPTS[index];
  const payload = {
    request_id: randomUUID(), generation_id: randomUUID(), replica_id: replicaId,
    language_id: prompt.languageId, text: `${DISCLOSURE[prompt.languageId]} ${prompt.body}`,
    reference_audio_base64: reference.toString("base64"), reference_sha256: referenceSha,
    reference_source_sha256: sourceReferenceSha, reference_window_start_ms: cropped.startMs, reference_window_end_ms: cropped.endMs,
    consent_receipt_sha256: consentReceipt, evaluation_scope: "verified_owner_identity",
    identity_scope: "verified_owner_self", release_eligible: true,
    clone_mode: "reference_only", seed: 260828 + index,
  };
  const { result, responseSignature, attempt } = await callWithWake(origin, secret, payload);
  const pcm = Buffer.from(result.audio_base64, "base64");
  if (result.output_sha256 !== sha(pcm) || result.reference_sha256 !== referenceSha || result.perth_watermark_verified !== true) throw new Error("voxcpm2_receipt_binding_invalid");
  const blindId = sha(Buffer.from(`${result.generation_id}:${result.output_sha256}`)).slice(0, 24);
  const wavPath = join(out, "blind", `${blindId}.wav`);
  writeFileSync(wavPath, wrapWav(pcm));
  const receipt = { ...result, audio_base64: undefined, response_signature: responseSignature, response_signature_verified: true, gate_wake_attempt: gateWakeAttempt, wake_attempt: attempt, blind_id: blindId };
  writeFileSync(join(out, "receipts", `${blindId}.json`), JSON.stringify(receipt, null, 2));
  key.push({ blindId, promptId: prompt.id, generationId: result.generation_id, wav: basename(wavPath), receipt: `${blindId}.json` });
  console.log(`${prompt.id}: ${blindId} ${result.duration_ms}ms rtf=${result.real_time_factor} wake_attempt=${attempt}`);
}

writeFileSync(join(out, "key.json"), JSON.stringify({ schemaVersion: "vyakti-voxcpm2-blind-key/v1", model: "voxcpm2", sourceReferenceSha256: sourceReferenceSha, referenceSha256: referenceSha, referenceWindow: { startMs: cropped.startMs, endMs: cropped.endMs }, items: key }, null, 2));
console.log(out);
