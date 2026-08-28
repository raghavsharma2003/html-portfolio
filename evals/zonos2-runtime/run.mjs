import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("services/zonos2-runtime/app.py");
const contract = read("services/zonos2-runtime/contract.py");
const fetchModels = read("services/zonos2-runtime/fetch_models.py");
const dockerfile = read("services/zonos2-runtime/Dockerfile");
const acrTask = read("services/zonos2-runtime/acr-task.yaml");
const access = read("services/zonos2-runtime/access-check.mjs");
const bicep = read("services/zonos2-runtime/infra/main.bicep");
const readme = read("services/zonos2-runtime/README.md");
const dependencyNote = read("services/zonos2-runtime/requirements-lock.md");
const qualify = read("services/zonos2-runtime/qualify.mjs");
let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
};

console.log("\nZONOS2 isolated candidate");
const pins = [
  "65f1e80f94b599d474bb6af9094a803dc52f60bd",
  "194c0a3ab67b90383a67646289f28d4ecb1c1f64",
  "7577f61c42737fc8064bba773e2a18602df92803",
  "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa",
];
ok("model, source, speaker encoder and DAC revisions are immutable", pins.every((pin) =>
  fetchModels.includes(pin) && (app.includes(pin) || dockerfile.includes(pin)) && access.includes(pin)));
ok("the 15.3 GB checkpoint, speaker encoder and DAC have exact size and SHA-256 commitments", [
  ["15336390655", "5f6aa0fff9036ee44ccbc625d40aa6bdd8ea223480a5447e9f6aad70c38b6ecd"],
  ["24010000", "df60a638e7f4a29331c0af2bd2984ee5b992fee9d5923c776f7e4bdc3dedea48"],
  ["306717287", "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa"],
].every(([bytes, sha]) => fetchModels.replaceAll("_", "").includes(bytes) && access.replaceAll("_", "").includes(bytes) && fetchModels.includes(sha)));
ok("commercially permissive license truth is component-specific", readme.includes("Apache-2.0 model metadata") &&
  readme.includes("MIT and unsigned") && app.includes('"model_license": "Apache-2.0"') &&
  app.includes('"source_license": "MIT"') && app.includes('"dac_license": "MIT"'));
ok("the unsigned source commit is reported rather than described as verified", access.includes('source_commit_signature=${sourceValue.commit?.verification?.verified === true ? "verified" : "unsigned"}') &&
  dependencyNote.includes("immutable but unsigned"));
ok("the exact upstream lock is installed and runtime Hub access is disabled", dockerfile.includes("uv sync --frozen --no-dev") &&
  dockerfile.includes("HF_HUB_OFFLINE=1") && dockerfile.includes("TRANSFORMERS_OFFLINE=1") &&
  dockerfile.includes("Qwen3SpeakerEmbedding.MODEL_NAME") === false && app.includes("Qwen3SpeakerEmbedding.MODEL_NAME = str(SPEAKER_ROOT)"));
ok("the DAC network downloader is replaced with the hash-checked baked asset", app.includes("zonos2_vocoder._get_dac = _load_local_dac") &&
  app.includes("zonos2_dac_commitment_mismatch") && app.indexOf("_load_local_dac") < app.indexOf("TTSLLM(model_path=str(MODEL_ROOT)"));
ok("ACR remote build is the only declared image build path", /Never invoke Docker or Docker\s+Desktop locally/.test(readme) &&
  dockerfile.includes("FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime@sha256:") && !dockerfile.includes("HF_TOKEN"));
ok("both remote build and the 15.3 GB layer push have explicit two-hour bounds", (acrTask.match(/timeout: 7200/g) || []).length === 2);
ok("the official runtime's JIT kernels have a version-pinned CUDA compiler and NCCL linker target",
  dockerfile.includes("cuda-nvcc-12-8=12.8.93-1") && dockerfile.includes("libnccl.so.2") &&
  dockerfile.includes("d93190d50b98ad4699ff40f4f7af50f16a76dac3bb8da1eaaf366d47898ff8df") &&
  dockerfile.includes("nvcc --version") && /JIT-compiles CUDA and NCCL\s+extensions/.test(dependencyNote) &&
  app.includes('CUDA_COMPILER_PACKAGE = "cuda-nvcc-12-8=12.8.93-1"') &&
  app.includes('"cuda_compiler_package": CUDA_COMPILER_PACKAGE'));
ok("preflight bounds public access, licenses and a 30 GiB projected image", access.includes("gated !== false") &&
  access.includes("private !== false") && access.includes("cardData?.license") && access.includes("30 * 1024 ** 3"));

ok("English is Tier 1 while Hindi and Hinglish are truthfully Tier 3", app.includes('"language_tier": 1 if value["language_id"] == "en" else 3') &&
  app.includes('"hindi_text_normalization_available": False') && /Hindi\s+as Tier 3/.test(readme));
ok("Hindi and Hinglish use raw UTF-8 while only English uses the supported normalizer", app.includes('text_normalization=value["language_id"] == "en"') &&
  contract.includes("hindi_devanagari_required") && contract.includes("hinglish_mixed_script_required"));
ok("accurate speaker-embedding cloning is fixed and receipt-bound", app.includes("embed_speaker_file") && app.includes("accurate_mode=True") &&
  contract.includes('payload.get("clone_mode") != "accurate_speaker_embedding"') && app.includes('"accurate_mode": True'));
ok("owner identity and third-party stress scopes cannot impersonate one another", contract.includes("owner_identity_binding_required") &&
  contract.includes("third_party_release_denied") && contract.includes("third_party_use_binding_required"));
ok("localized spoken disclosure is structurally required", contract.includes('"hinglish": "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।"') &&
  contract.includes("localized_disclosure_required") && app.includes('"spoken_disclosure": value["disclosure"]'));
ok("signed replay-resistant transport wraps every response", app.includes("verify_transport") && app.includes("transport_replay_denied") &&
  app.includes("response_signature") && app.includes('response.headers["Cache-Control"] = "no-store"'));
ok("post-synthesis PerTh is applied and detected before audio return", app.indexOf("apply_watermark(") < app.indexOf("get_watermark(") &&
  app.indexOf("get_watermark(") < app.indexOf('"audio_base64"') && app.includes("perth_watermark_verification_failed"));
ok("44.1 kHz model audio is explicitly converted to the matched 24 kHz delivery format", app.includes("MODEL_SAMPLE_RATE = 44_100") &&
  app.includes("DELIVERY_SAMPLE_RATE = 24_000") && app.includes("torchaudio.functional.resample"));
ok("A10 fit is a measured gate and peak GPU memory is returned", app.includes("MIN_GPU_MEMORY_BYTES = 22 * 1024**3") &&
  app.includes("zonos2_gpu_memory_insufficient") && app.includes("gpu_peak_allocated_bytes") && app.includes("gpu_peak_reserved_bytes"));

ok("the evaluation VM is A10 Spot, bounded by USD 75 and four hours", bicep.includes("Standard_NV36ads_A10_v5") &&
  bicep.includes("priority: 'Spot'") && bicep.includes("maxPrice: json('4.16')") && bicep.includes("@maxValue(75)") && bicep.includes("@maxValue(4)") &&
  readme.includes("USD 0.768768 per allocated hour") && readme.includes("USD 3.075072"));
ok("the runtime has no public IP or inbound route and binds loopback only", !bicep.includes("publicIPAddress: { id:") &&
  bicep.includes("deny-all-inbound") && bicep.includes("-p 127.0.0.1:8080:8080") && bicep.includes("output publicIngress bool = false"));
ok("explicit NAT is egress-only and the subnet rejects implicit outbound", bicep.includes("Microsoft.Network/natGateways") &&
  bicep.includes("defaultOutboundAccess: false") && bicep.includes("networkSecurityGroup: { id: nsg.id }"));
ok("the non-root HMAC mount is owner-readable and ACR uses a scoped one-day token", bicep.includes("zonos2_hmac:/run/secrets/zonos2_hmac:ro") &&
  bicep.includes("chown 10013:10013") && bicep.includes("az keyvault secret show") &&
  bicep.includes("registryTokenPassword") && bicep.includes("unset ACR_TOKEN_NAME ACR_TOKEN_PASSWORD") &&
  bicep.includes("docker logout __REGISTRY_LOGIN_SERVER__") && !bicep.includes("registryPassword") &&
  app.includes("zonos2_plaintext_hmac_forbidden"));
ok("the non-root read-only image avoids recursive ownership-copy layers and has bounded executable scratch space for official JIT kernels", dockerfile.includes("USER 10013:10013") &&
  !dockerfile.includes("chown -R zonos2:zonos2 /srv/zonos2 /models /opt/zonos2-src") && bicep.includes("--read-only") &&
  bicep.includes("--tmpfs /tmp:rw,exec,nosuid,nodev,size=2g") &&
  bicep.includes("--tmpfs /home/zonos2:rw,exec,nosuid,nodev,size=4g,uid=10013,gid=10013"));
ok("managed Run Command exchange is encrypted and never anonymously public", bicep.includes("run-command") &&
  bicep.includes("allowBlobPublicAccess: false") && bicep.includes("publicAccess: 'None'") && bicep.includes("productionRoutingAllowed bool = false"));
ok("qualification scripts carry owner audio but never the HMAC and finalize a sealed mapping", qualify.includes("ZONOS2_RESULT") &&
  qualify.includes("/run/vyakti/zonos2_hmac") && !qualify.includes("az keyvault secret show") &&
  qualify.includes('arm_identity: "sealed"') && qualify.includes('arm_identity: "zonos2"'));
ok("qualification verifies response HMAC, exact dependency pins, input hashes and final PerTh", qualify.includes("timingSafeEqual") &&
  qualify.includes("zonos2_provenance_binding_invalid") && qualify.includes("zonos2_input_binding_invalid") &&
  qualify.includes("zonos2_runtime_binding_invalid") && qualify.includes("zonos2_output_binding_invalid") &&
  qualify.includes('CUDA_COMPILER_PACKAGE = "cuda-nvcc-12-8=12.8.93-1"') &&
  qualify.includes("consentReceiptSha256"));
ok("a platform shutdown schedule deallocates independently of the guest", bicep.includes("ComputeVmShutdownTask") &&
  bicep.includes("shutdown-computevm-") && bicep.includes("timeZoneId: 'India Standard Time'"));

const pythonSmoke = String.raw`
import base64, hashlib, hmac, io, json, time, uuid, wave
from contract import DISCLOSURES, ServiceError, canonical, request_signature, sha256, validate_payload, verify_transport

buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(b"\x00\x00" * 24000 * 6)
audio = buf.getvalue()
base = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()), "replica_id": str(uuid.uuid4()),
    "language_id": "hi", "text": DISCLOSURES["hi"] + " आज हम रासायनिक समीकरण समझेंगे।",
    "reference_audio_base64": base64.b64encode(audio).decode(), "reference_sha256": sha256(audio),
    "reference_source_sha256": "1" * 64, "reference_window_start_ms": 0, "reference_window_end_ms": 6000,
    "consent_receipt_sha256": "2" * 64, "evaluation_scope": "verified_owner_identity",
    "identity_scope": "verified_owner_self", "release_eligible": True,
    "clone_mode": "accurate_speaker_embedding", "seed": 260828,
}
assert validate_payload(base)["script_mode"] == "devanagari"
mixed = {**base, "language_id": "hinglish", "text": DISCLOSURES["hinglish"] + " आज chemical equation समझेंगे।"}
assert validate_payload(mixed)["script_mode"] == "mixed"
english = {**base, "language_id": "en", "text": DISCLOSURES["en"] + " Today we will balance an equation."}
assert validate_payload(english)["script_mode"] == "latin"
bad = [
    {**base, "text": DISCLOSURES["hi"] + " Aaj equation samjhenge."},
    {**mixed, "text": DISCLOSURES["hinglish"] + " आज समीकरण समझेंगे।"},
    {**base, "text": "आज हम रासायनिक समीकरण समझेंगे।"},
    {**base, "evaluation_scope": "third_party_language_stress", "identity_scope": "third_party_not_owner", "release_eligible": False,
     "training_allowed": True, "identity_claim_allowed": False, "consent_receipt_sha256": None, "third_party_policy_receipt_sha256": "3" * 64},
    {**base, "consent_receipt_sha256": None},
]
for item in bad:
    try: validate_payload(item); raise AssertionError("negative control accepted")
    except ServiceError: pass
secret = b"s" * 32
body = canonical(base); body_hash = sha256(body); nonce = "a" * 24
timestamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
headers = {"x-vyakti-protocol": "vyakti-open-voice/v1", "x-vyakti-timestamp": timestamp, "x-vyakti-nonce": nonce,
           "x-vyakti-content-sha256": body_hash, "x-vyakti-signature": request_signature(secret, "POST", "/v1/synthesize", timestamp, nonce, body_hash)}
assert verify_transport(secret, "POST", "/v1/synthesize", headers, body) == nonce
try: verify_transport(secret, "POST", "/v1/synthesize", {**headers, "x-vyakti-signature": "bad"}, body); raise AssertionError("bad HMAC accepted")
except ServiceError: pass
print("zonos2_contract_smoke_ok")
`;
const smoke = spawnSync("python", ["-c", pythonSmoke], {
  cwd: new URL("../../services/zonos2-runtime/", import.meta.url),
  encoding: "utf8",
  env: { ...process.env, PYTHONUTF8: "1" },
});
ok("executable contract accepts three intended scripts and rejects five unsafe controls plus bad HMAC", smoke.status === 0 && smoke.stdout.includes("zonos2_contract_smoke_ok"));

ok("the README makes no unmeasured fit or quality claim", /No model load, A10 fit, synthesis, latency, naturalness, pronunciation or\s+speaker likeness is established/.test(readme));
console.log(`ZONOS2_CANDIDATE_PASS ${passed}/${passed}`);
