#!/usr/bin/env node
// Prepare private Azure managed Run Command scripts, then seal returned audio
// into an opaque owner-listening pack. No transport secret enters a script.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROTOCOL = "vyakti-open-voice/v1";
const PATH = "/v1/synthesize";
const SAMPLE_RATE = 24_000;
const MODEL_REVISION = "65f1e80f94b599d474bb6af9094a803dc52f60bd";
const SOURCE_COMMIT = "194c0a3ab67b90383a67646289f28d4ecb1c1f64";
const SPEAKER_REVISION = "7577f61c42737fc8064bba773e2a18602df92803";
const DAC_SHA256 = "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa";
const CUDA_COMPILER_PACKAGE = "cuda-nvcc-12-8=12.8.93-1";
const DISCLOSURE = {
  hi: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
  hinglish: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
  en: "This is an AI-generated voice replica.",
};
const PROMPTS = [
  { id: "hi", languageId: "hi", body: "आज हम रासायनिक समीकरण को संतुलित करेंगे और हर चरण को ध्यान से समझेंगे।" },
  { id: "hinglish", languageId: "hinglish", body: "आज हम chemical equation को balance करेंगे, और फिर reaction का logic समझेंगे।" },
  { id: "en", languageId: "en", body: "Today we will balance the chemical equation and explain every step clearly." },
];

const sha = (value) => createHash("sha256").update(value).digest("hex");
const b64url = (value) => Buffer.from(value).toString("base64url");
const secretBytes = (value) => /^[0-9a-f]{64,}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
const signature = (secret, ...parts) => b64url(createHmac("sha256", secret).update(parts.join("\n")).digest());

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
  if (end - start !== SAMPLE_RATE * 2 * seconds) throw new Error("owner_reference_window_missing");
  return { bytes: wrapWav(pcm.subarray(start, end)), startMs: startSeconds * 1000, endMs: (startSeconds + seconds) * 1000 };
}

function vmScript(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import base64, datetime, hashlib, hmac, json, secrets, time, urllib.error, urllib.request

PROTOCOL = "${PROTOCOL}"
PATH = "${PATH}"
payload = json.loads(base64.b64decode("${encoded}"))
for attempt in range(80):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/healthz", timeout=5) as health:
            ready = json.loads(health.read()).get("ready") is True
        if ready:
            break
    except Exception:
        pass
    if attempt == 79:
        raise SystemExit("zonos2_runtime_not_ready")
    time.sleep(15)

raw = open("/run/vyakti/zonos2_hmac", "r", encoding="utf-8").read().strip()
try:
    secret = bytes.fromhex(raw) if len(raw) >= 64 and all(c in "0123456789abcdefABCDEF" for c in raw) else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
except Exception as exc:
    raise SystemExit("zonos2_hmac_invalid") from exc
body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
body_hash = hashlib.sha256(body).hexdigest()
timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
nonce = secrets.token_urlsafe(24)
message = "\\n".join([PROTOCOL, "POST", PATH, timestamp, nonce, body_hash]).encode()
request_sig = base64.urlsafe_b64encode(hmac.new(secret, message, hashlib.sha256).digest()).rstrip(b"=").decode()
request = urllib.request.Request("http://127.0.0.1:8080" + PATH, data=body, method="POST", headers={
    "Content-Type": "application/json", "X-Vyakti-Protocol": PROTOCOL, "X-Vyakti-Timestamp": timestamp,
    "X-Vyakti-Nonce": nonce, "X-Vyakti-Content-SHA256": body_hash, "X-Vyakti-Signature": request_sig,
})
try:
    response = urllib.request.urlopen(request, timeout=900)
except urllib.error.HTTPError as error:
    response = error
response_body = response.read()
envelope = {
    "status": int(response.status), "nonce": nonce,
    "response_signature": response.headers.get("X-Vyakti-Response-Signature", ""),
    "body_base64": base64.b64encode(response_body).decode(),
}
print("ZONOS2_RESULT " + base64.b64encode(json.dumps(envelope, separators=(",", ":")).encode()).decode())
PY
`;
}

function prepare(referenceArg, outArg) {
  const replicaId = String(process.env.ZONOS2_REPLICA_ID || "");
  const consentReceipt = String(process.env.ZONOS2_CONSENT_RECEIPT_SHA256 || "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(replicaId) || !/^[0-9a-f]{64}$/.test(consentReceipt)) throw new Error("zonos2_owner_binding_env_missing");
  const sourceReference = readFileSync(resolve(referenceArg));
  const sourceReferenceSha = sha(sourceReference);
  const cropped = cropReference(sourceReference);
  const referenceSha = sha(cropped.bytes);
  const out = resolve(outArg);
  mkdirSync(join(out, "scripts"), { recursive: true });
  mkdirSync(join(out, "results"), { recursive: true });
  mkdirSync(join(out, "private"), { recursive: true });
  const items = [];
  for (let index = 0; index < PROMPTS.length; index += 1) {
    const prompt = PROMPTS[index];
    const blindId = sha(Buffer.concat([randomBytes(32), Buffer.from(prompt.id)])).slice(0, 24);
    const payload = {
      request_id: randomUUID(), generation_id: randomUUID(), replica_id: replicaId,
      language_id: prompt.languageId, text: `${DISCLOSURE[prompt.languageId]} ${prompt.body}`,
      reference_audio_base64: cropped.bytes.toString("base64"), reference_sha256: referenceSha,
      reference_source_sha256: sourceReferenceSha, reference_window_start_ms: cropped.startMs,
      reference_window_end_ms: cropped.endMs, consent_receipt_sha256: consentReceipt,
      evaluation_scope: "verified_owner_identity", identity_scope: "verified_owner_self",
      release_eligible: true, clone_mode: "accurate_speaker_embedding", seed: 260828 + index,
    };
    const scriptName = `${blindId}.sh`;
    writeFileSync(join(out, "scripts", scriptName), vmScript(payload), { mode: 0o600 });
    items.push({
      blindId, promptId: prompt.id, languageId: prompt.languageId, scriptName,
      resultName: `${blindId}.txt`, requestId: payload.request_id,
      generationId: payload.generation_id, textSha256: sha(Buffer.from(payload.text)),
      spokenDisclosure: DISCLOSURE[prompt.languageId],
    });
  }
  writeFileSync(join(out, "private", "plan.json"), JSON.stringify({
    schemaVersion: "vyakti-zonos2-run-command-plan/v1", model: "zonos2", sourceReferenceSha256: sourceReferenceSha,
    replicaId, consentReceiptSha256: consentReceipt, referenceSha256: referenceSha,
    referenceWindow: { startMs: cropped.startMs, endMs: cropped.endMs }, items,
  }, null, 2), { mode: 0o600 });
  console.log(`ZONOS2_RUN_COMMAND_PLAN_READY ${out}`);
}

function finalize(outArg) {
  const out = resolve(outArg);
  const rawSecret = String(process.env.ZONOS2_HMAC_SECRET || "");
  const secret = secretBytes(rawSecret);
  if (secret.length < 32) throw new Error("zonos2_hmac_secret_required");
  const plan = JSON.parse(readFileSync(join(out, "private", "plan.json"), "utf8"));
  mkdirSync(join(out, "blind"), { recursive: true });
  const keyItems = [];
  const publicItems = [];
  for (const item of plan.items) {
    const raw = readFileSync(join(out, "results", item.resultName), "utf8");
    const matches = [...raw.matchAll(/ZONOS2_RESULT ([A-Za-z0-9+/=]+)/g)];
    if (matches.length !== 1) throw new Error(`zonos2_result_envelope_missing:${item.blindId}`);
    const envelope = JSON.parse(Buffer.from(matches[0][1], "base64").toString("utf8"));
    const body = Buffer.from(envelope.body_base64, "base64");
    const expected = signature(secret, PROTOCOL, "response", PATH, envelope.nonce, String(envelope.status), sha(body));
    const left = Buffer.from(String(envelope.response_signature));
    const right = Buffer.from(expected);
    if (left.length !== right.length || left.length < 32 || !timingSafeEqual(left, right)) throw new Error("zonos2_response_signature_invalid");
    const result = JSON.parse(body.toString("utf8"));
    if (envelope.status !== 200) throw new Error(String(result.error || `zonos2_http_${envelope.status}`));
    const pcm = Buffer.from(result.audio_base64, "base64");
    if (!pcm.length || sha(pcm) !== result.output_sha256 || result.perth_watermark_verified !== true || result.perth_score < 0.5) throw new Error("zonos2_output_binding_invalid");
    if (result.model_revision !== MODEL_REVISION || result.source_commit !== SOURCE_COMMIT || result.speaker_revision !== SPEAKER_REVISION || result.dac_sha256 !== DAC_SHA256 ||
        result.cuda_compiler_package !== CUDA_COMPILER_PACKAGE || result.model_license !== "Apache-2.0" || result.source_license !== "MIT" ||
        result.speaker_license !== "Apache-2.0" || result.dac_license !== "MIT" || !/^[0-9a-f]{64}$/.test(String(result.model_commitment))) {
      throw new Error("zonos2_provenance_binding_invalid");
    }
    if (result.request_id !== item.requestId || result.generation_id !== item.generationId || result.replica_id !== plan.replicaId ||
        result.reference_sha256 !== plan.referenceSha256 || result.reference_source_sha256 !== plan.sourceReferenceSha256 ||
        result.consent_receipt_sha256 !== plan.consentReceiptSha256 || result.text_sha256 !== item.textSha256 ||
        result.language_id !== item.languageId || result.spoken_disclosure !== item.spokenDisclosure) {
      throw new Error("zonos2_input_binding_invalid");
    }
    if (result.sample_rate !== SAMPLE_RATE || result.model_sample_rate !== 44_100 || result.channels !== 1 || result.encoding !== "pcm_s16le" ||
        result.language_tier !== (item.languageId === "en" ? 1 : 3) || result.hindi_text_normalization_available !== false ||
        result.evaluation_scope !== "verified_owner_identity" || result.identity_scope !== "verified_owner_self" || result.release_eligible !== true ||
        result.clone_mode !== "accurate_speaker_embedding" || result.accurate_mode !== true ||
        !Number.isInteger(result.gpu_peak_allocated_bytes) || result.gpu_peak_allocated_bytes <= 0 ||
        !Number.isInteger(result.gpu_peak_reserved_bytes) || result.gpu_peak_reserved_bytes < result.gpu_peak_allocated_bytes) {
      throw new Error("zonos2_runtime_binding_invalid");
    }
    const wav = wrapWav(pcm);
    const filename = `${item.blindId}.wav`;
    writeFileSync(join(out, "blind", filename), wav);
    const receipt = { ...result, audio_base64: undefined, response_signature: envelope.response_signature, response_signature_verified: true, blind_id: item.blindId };
    writeFileSync(join(out, "private", `${item.blindId}.receipt.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    publicItems.push({ id: item.blindId, filename, wav_sha256: sha(wav), duration_ms: result.duration_ms, sample_rate: result.sample_rate, perth_watermark_verified: true });
    keyItems.push({ ...item, resultName: undefined, scriptName: undefined, filename, receipt: `${item.blindId}.receipt.json`, model: result.model, output_sha256: result.output_sha256 });
  }
  const publicManifest = {
    contract: "vyakti-zonos2-blind-pack/v1", created_at: new Date().toISOString(), arm_identity: "sealed",
    human_listening_status: "not_started", spoken_disclosure_verification: "pending_listener", evaluation_only: true,
    reference_sha256: plan.referenceSha256, reference_window: plan.referenceWindow, items: publicItems,
  };
  writeFileSync(join(out, "blind", "manifest.json"), JSON.stringify(publicManifest, null, 2));
  writeFileSync(join(out, "private", "key.json"), JSON.stringify({ ...publicManifest, arm_identity: "zonos2", source_reference_sha256: plan.sourceReferenceSha256, items: keyItems }, null, 2), { mode: 0o600 });
  console.log(`ZONOS2_BLIND_PACK_READY ${join(out, "blind")}`);
}

const [mode, referenceArg, outArg] = process.argv.slice(2);
if (mode === "prepare" && referenceArg && outArg) prepare(referenceArg, outArg);
else if (mode === "finalize" && referenceArg) finalize(referenceArg);
else throw new Error("usage: node qualify.mjs prepare reference.wav output-dir | finalize output-dir");
