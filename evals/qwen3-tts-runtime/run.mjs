import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("services/qwen3-tts-runtime/app.py");
const contract = read("services/qwen3-tts-runtime/contract.py");
const fetchModels = read("services/qwen3-tts-runtime/fetch_models.py");
const dockerfile = read("services/qwen3-tts-runtime/Dockerfile");
const bicep = read("services/qwen3-tts-runtime/infra/main.bicep");
const qualify = read("services/qwen3-tts-runtime/qualify.mjs");
let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
};

console.log("\nQwen3-TTS isolated English candidate");
const revisions = [
  "fd4b254389122332181a7c3db7f27e918eec64e3",
  "022e286b98fbec7e1e916cb940cdf532cd9f488e",
];
ok("official source and weights are immutable and mirrored", revisions.every((revision) =>
  fetchModels.includes(revision) && (app.includes(revision) || dockerfile.includes(revision))));
ok("runtime model fetching is offline", /HF_HUB_OFFLINE=1/.test(dockerfile) && /TRANSFORMERS_OFFLINE=1/.test(dockerfile) && /local_files_only=True/.test(app));
ok("public weights require no account credential", !/HF_TOKEN|hf_token|build-arg/i.test(dockerfile + fetchModels));
ok("snapshot cannot look ready without both model and speech tokenizer", /qwen3_snapshot_incomplete/.test(fetchModels) && /speech_tokenizer\/model\.safetensors/.test(fetchModels));
ok("English disclosure and consent are hard predicates", contract.includes("english_disclosure_required") && contract.includes("consent_receipt_required"));
ok("non-English requests have a named hard refusal", contract.includes("raise ServiceError(\"qwen3_english_only\", 422)"));
ok("reference audio and transcript hypothesis are content addressed", contract.includes("reference_sha256") && contract.includes("reference_text_sha256") && contract.includes("reference_text_digest_invalid"));
ok("qualification labels the ASR transcript hypothesis as unreviewed evidence", qualify.includes('reference_text_evidence_scope: "asr_unreviewed"') && qualify.includes("transcribeReferenceHypothesis") && !qualify.includes("transcribeExact"));
ok("the sealed pack does not claim the spoken disclosure before listening", qualify.includes('disclosure_request_enforced: true') && qualify.includes('spoken_disclosure_verification: "pending_listener"') && !qualify.includes("disclosure_present"));
ok("post-hoc PerTh is applied then detector verified", app.indexOf("apply_watermark(") < app.indexOf("get_watermark(") && app.indexOf("get_watermark(") < app.indexOf("audio_base64"));
ok("model, reference, consent, parameters and PerTh appear in provenance", ["model_commitment", "reference_sha256", "consent_receipt_sha256", "generation_parameters", "perth_score"].every((key) => app.includes(`\"${key}\"`)));
ok("the sealed listening key retains returned final provenance", ["model_repo", "model_commitment", "reference_sha256", "consent_receipt_sha256", "output_sha256", "generation_parameters", "perth_score"].every((key) => qualify.includes(`${key}: result.${key}`)));
ok("CUDA is required and access logs are disabled", app.includes("qwen3_cuda_required") && dockerfile.includes("--no-access-log"));
ok("evaluation resources cannot overwrite production", bicep.includes("vyakti-qwen3-tts-en-eval") && bicep.includes("vyakti-qwen3-tts-en-gate") && !bicep.includes("vyakti-open-voice'"));
ok("GPU is private, scale-to-zero and single-replica", /external: false/.test(bicep) && /minReplicas: 0/.test(bicep) && /maxReplicas: 1/.test(bicep));
ok("infrastructure rejects budgets above USD 60", /@maxValue\(60\)/.test(bicep) && /approved_budget_usd/.test(bicep));
ok("explicit expiry and evaluation-only tags are mandatory", /expiryAt/.test(bicep) && /evaluation_only: 'true'/.test(bicep));
ok("private ACR pulls use only secure secret references", /registries:/.test(bicep) && /passwordSecretRef: 'acr-password'/.test(bicep) && /@secure\(\)\s*param registryPassword/.test(bicep));
ok("transport HMAC stays in Key Vault behind the shared evaluation identity", /keyVaultUrl: hmacSecretUri/.test(bicep) && /identity: userAssignedIdentityResourceId/.test(bicep) && !/param hmacSecret string/.test(bicep));

const python = String.raw`
import base64, hashlib, io, json, sys, uuid, wave
sys.path.insert(0, r"services/qwen3-tts-runtime")
from contract import DISCLOSURE, ServiceError, request_signature, sha256, validate_payload, verify_transport

buf = io.BytesIO()
with wave.open(buf, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
    wav.writeframes(bytes(24000 * 3 * 2))
audio = buf.getvalue()
ref_text = "This is the unreviewed English reference ASR hypothesis."
payload = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()),
    "language_id": "en", "text": DISCLOSURE + " Today we will balance a chemical equation.",
    "reference_audio_base64": base64.b64encode(audio).decode(),
    "reference_sha256": sha256(audio), "reference_text": ref_text,
    "reference_text_sha256": sha256(ref_text.encode()),
    "consent_receipt_sha256": "a" * 64, "seed": 17,
}
value = validate_payload(payload)
assert value["reference"].duration_ms == 3000
for field, code in (("consent_receipt_sha256", "consent_receipt_required"), ("reference_text_sha256", "reference_text_digest_invalid")):
    bad = dict(payload); bad[field] = ""
    try: validate_payload(bad); raise AssertionError("accepted " + field)
    except ServiceError as exc: assert exc.code == code
bad = dict(payload); bad["language_id"] = "hi"
try: validate_payload(bad); raise AssertionError("accepted Hindi")
except ServiceError as exc: assert exc.code == "qwen3_english_only"
bad = dict(payload); bad["text"] = "Today we will balance an equation."
try: validate_payload(bad); raise AssertionError("accepted missing disclosure")
except ServiceError as exc: assert exc.code == "english_disclosure_required"

body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
secret = b"s" * 32
timestamp = "2026-08-28T00:00:00Z"
now = 1787875200.0
nonce = "abcdefghijklmnopqrstuvwxyz1234"
headers = {"x-vyakti-protocol": "vyakti-open-voice/v1", "x-vyakti-timestamp": timestamp,
           "x-vyakti-nonce": nonce, "x-vyakti-content-sha256": hashlib.sha256(body).hexdigest()}
headers["x-vyakti-signature"] = request_signature(secret, "POST", "/v1/synthesize", timestamp, nonce, headers["x-vyakti-content-sha256"])
assert verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now) == nonce
headers["x-vyakti-signature"] = "wrong"
try: verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now); raise AssertionError("accepted bad HMAC")
except ServiceError as exc: assert exc.code == "transport_binding_invalid"
print("contract-execution-pass")
`;
const executed = spawnSync("python", ["-c", python], { cwd: root, encoding: "utf8" });
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
ok("stdlib contract executes positive and negative controls", executed.stdout.includes("contract-execution-pass"));

const compiled = spawnSync("python", ["-m", "py_compile",
  "services/qwen3-tts-runtime/contract.py", "services/qwen3-tts-runtime/fetch_models.py", "services/qwen3-tts-runtime/app.py"],
{ cwd: root, encoding: "utf8" });
ok("all Python sources compile", compiled.status === 0);

console.log(`\n${passed}/${passed} Qwen3-TTS candidate checks passed.`);
