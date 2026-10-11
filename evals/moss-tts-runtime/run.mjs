import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("services/moss-tts-runtime/app.py");
const contract = read("services/moss-tts-runtime/contract.py");
const fetchModels = read("services/moss-tts-runtime/fetch_models.py");
const dockerfile = read("services/moss-tts-runtime/Dockerfile");
const requirements = read("services/moss-tts-runtime/requirements.txt");
const accessCheck = read("services/moss-tts-runtime/access-check.mjs");
const acrTask = read("services/moss-tts-runtime/acr-task.yaml");
const bicep = read("services/moss-tts-runtime/infra/main.bicep");
const readme = read("services/moss-tts-runtime/README.md");
let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
};

console.log("\nMOSS-TTS Local v1.5 isolated candidate");
const pins = [
  "be7766a6735b98bd793f7c79fb720b4d0f5d13b8",
  "f6e20e543b33d2c252a7ef71bdf8aa71e5ff9169",
  "58b20a0d5fcc6766658d50967a90a9d890009a46",
];
ok("model, codec and source revisions are immutable across build and runtime", pins.every((pin) =>
  fetchModels.includes(pin) && (app.includes(pin) || dockerfile.includes(pin))));
ok("all four large weight files have exact byte and SHA-256 commitments", [
  "608f1ff64bc6caa9be836060fc7c78a15c4658c4a07b8d73c78d6f70d1b39c23",
  "2d9f9182f17b143a23937feb87c63c08221bd28e685e4bc2fa55dcdce17fcde7",
  "d4e48106d0254fe3b00ea0707e88fc6aee076993825e108dd9cef847f9db236e",
  "d0449fe1b0ef1f6045946867148d8166b9a91a58d0feca4a18b641494d0b22da",
].every((sha) => fetchModels.includes(sha) && accessCheck.includes(sha)));
ok("remote code and codec load only from baked local paths", /HF_HUB_OFFLINE=1/.test(dockerfile) &&
  /TRANSFORMERS_OFFLINE=1/.test(dockerfile) && (app.match(/local_files_only=True/g) || []).length >= 2 &&
  /codec_path=str\(CODEC_ROOT\)/.test(app));
ok("PyTorch, Transformers and TorchCodec match the pinned upstream runtime", dockerfile.includes("pytorch:2.9.1-cuda12.8") &&
  requirements.includes("transformers==5.0.0") && requirements.includes("torchcodec==0.8.1"));
ok("the base image is digest pinned and access preflight verifies that digest", dockerfile.includes("@sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385") &&
  accessCheck.includes("docker-content-digest") && accessCheck.includes("base_digest_mismatch"));
ok("public model access and projected image size are bounded before ACR", accessCheck.includes("gated !== false") &&
  accessCheck.includes("private !== false") && accessCheck.includes("30 * 1024 ** 3") &&
  accessCheck.includes("projected_image_too_large"));
ok("ACR is the only declared build path and no Hugging Face token enters it", acrTask.includes("$Registry/vyakti/moss-tts-local-v1-5-eval:$ID") &&
  !acrTask.includes("hf_token") && !dockerfile.includes("HF_TOKEN") && readme.includes("Never invoke Docker or Docker Desktop locally"));
ok("localized disclosure, explicit language tag and reference cloning bind generation", contract.includes("localized_disclosure_required") &&
  app.includes('language=value["language_label"]') && app.includes('reference=[reference_file.name]'));
ok("Hindi accepts Devanagari or mixed Hinglish but refuses Latin-only Hindi", contract.includes('script_mode not in ("devanagari", "mixed")') &&
  contract.includes("hindi_devanagari_required"));
ok("owner identity and third-party stress scopes cannot impersonate one another", contract.includes("owner_identity_binding_required") &&
  contract.includes("third_party_release_denied") && contract.includes("third_party_use_binding_required"));
ok("the third-party lecture is structurally barred from training and identity claims", contract.includes('payload.get("training_allowed") is not False') &&
  contract.includes('payload.get("identity_claim_allowed") is not False') && readme.includes("third_party_language_stress"));
ok("upstream v1.5 decoding controls are fixed and auditable", [
  '"audio_temperature": 1.7', '"audio_top_p": 0.8', '"audio_top_k": 25',
  '"audio_repetition_penalty": 1.0', '"max_new_tokens": 1024',
].every((value) => app.includes(value)));
ok("48 kHz stereo is explicitly downmixed and resampled for the matched 24 kHz pack", app.includes("MODEL_SAMPLE_RATE = 48_000") &&
  app.includes("tensor.mean(dim=0") && app.includes("torchaudio.functional.resample") && app.includes('"model_channels": model_channels'));
ok("PerTh is applied after synthesis and verified before any audio bytes return", app.indexOf("apply_watermark(") < app.indexOf("get_watermark(") &&
  app.indexOf("get_watermark(") < app.indexOf('"audio_base64"'));
ok("response evidence binds model, codec, input, reference and identity scope", [
  '"model_commitment"', '"model_revision"', '"codec_revision"', '"text_sha256"',
  '"reference_sha256"', '"evaluation_scope"', '"identity_scope"', '"release_eligible"',
].every((value) => app.includes(value)));
ok("the runtime refuses the existing 16 GiB T4 before loading weights", app.includes("MIN_GPU_MEMORY_BYTES = 22 * 1024**3") &&
  app.indexOf("moss_tts_gpu_memory_insufficient") < app.indexOf("AutoProcessor.from_pretrained"));
ok("A10 qualification is private Spot capacity with no public IP or inbound path", bicep.includes("Standard_NV36ads_A10_v5") &&
  bicep.includes("priority: 'Spot'") && !bicep.includes("publicIPAddress") && bicep.includes("deny-all-inbound") &&
  bicep.includes("127.0.0.1:8080:8080"));
ok("the remote VM uses managed identity for ACR, Key Vault and self-deallocation", bicep.includes("az login --identity") &&
  bicep.includes("AcrPull") === false && bicep.includes("7f951dda-4ed3-4680-a7ca-43fe172d538d") &&
  bicep.includes("az keyvault secret show") && bicep.includes("az vm deallocate"));
ok("the secret is a read-only file and never a cloud-init environment value", bicep.includes("MOSS_TTS_HMAC_SECRET_FILE=/run/secrets/moss_hmac") &&
  app.includes("MOSS_TTS_HMAC_SECRET_FILE") && !bicep.includes("MOSS_TTS_HMAC_SECRET="));
ok("USD 25, four hours, expiry and daily shutdown are independent rails", /@maxValue\(25\)/.test(bicep) &&
  /@maxValue\(4\)/.test(bicep) && bicep.includes("expiry_at") &&
  bicep.includes("ComputeVmShutdownTask") && bicep.includes("production_routing: 'forbidden'"));

const python = String.raw`
import base64, hashlib, io, json, sys, uuid, wave
sys.path.insert(0, r"services/moss-tts-runtime")
from contract import DISCLOSURES, ServiceError, request_signature, sha256, validate_payload, verify_transport

buf = io.BytesIO()
with wave.open(buf, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
    wav.writeframes(bytes(24000 * 3 * 2))
audio = buf.getvalue()
base = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()), "replica_id": str(uuid.uuid4()),
    "language_id": "hi", "text": DISCLOSURES["hi"] + " आज हम physics और chemistry को आसान तरीके से समझेंगे।",
    "clone_mode": "zero_shot_reference", "reference_audio_base64": base64.b64encode(audio).decode(),
    "reference_sha256": sha256(audio), "evaluation_scope": "verified_owner_identity",
    "identity_scope": "verified_owner_self", "release_eligible": True, "training_allowed": True,
    "identity_claim_allowed": True, "consent_receipt_sha256": "a" * 64, "seed": 17,
}
owner = validate_payload(base)
assert owner["script_mode"] == "mixed" and owner["language_label"] == "Hindi" and owner["release_eligible"] is True

latin = dict(base); latin["text"] = DISCLOSURES["en"] + " Namaste, aaj hum physics padhenge."
try: validate_payload(latin); raise AssertionError("accepted Latin-only Hindi")
except ServiceError as exc: assert exc.code in {"localized_disclosure_required", "hindi_devanagari_required"}

stress = dict(base)
stress.update({"evaluation_scope": "third_party_language_stress", "identity_scope": "third_party_not_owner",
               "release_eligible": False, "training_allowed": False, "identity_claim_allowed": False,
               "third_party_policy_receipt_sha256": "b" * 64})
stress.pop("consent_receipt_sha256")
third_party = validate_payload(stress)
assert third_party["release_eligible"] is False and third_party["consent_receipt_sha256"] is None
bad = dict(stress); bad["training_allowed"] = True
try: validate_payload(bad); raise AssertionError("accepted third-party training")
except ServiceError as exc: assert exc.code == "third_party_use_binding_required"

body = json.dumps(base, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
secret = b"s" * 32
timestamp = "2026-08-28T00:00:00Z"; now = 1787875200.0; nonce = "abcdefghijklmnopqrstuvwxyz1234"
headers = {"x-vyakti-protocol": "vyakti-open-voice/v1", "x-vyakti-timestamp": timestamp,
           "x-vyakti-nonce": nonce, "x-vyakti-content-sha256": hashlib.sha256(body).hexdigest()}
headers["x-vyakti-signature"] = request_signature(secret, "POST", "/v1/synthesize", timestamp, nonce, headers["x-vyakti-content-sha256"])
assert verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now) == nonce
headers["x-vyakti-signature"] = "wrong"
try: verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now); raise AssertionError("accepted bad HMAC")
except ServiceError as exc: assert exc.code == "transport_binding_invalid"
print("moss-contract-pass")
`;
const executed = spawnSync("python", ["-c", python], { cwd: root, encoding: "utf8" });
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
ok("stdlib contract executes owner, third-party and HMAC controls", executed.stdout.includes("moss-contract-pass"));

const compiled = spawnSync("python", ["-m", "py_compile",
  "services/moss-tts-runtime/contract.py", "services/moss-tts-runtime/fetch_models.py", "services/moss-tts-runtime/app.py"],
{ cwd: root, encoding: "utf8" });
ok("all Python sources compile", compiled.status === 0);

console.log(`\n${passed}/${passed} MOSS-TTS candidate checks passed.`);
