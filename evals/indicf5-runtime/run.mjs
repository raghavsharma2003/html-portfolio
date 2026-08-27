import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("services/indicf5-runtime/app.py");
const offlineVocoder = read("services/indicf5-runtime/offline_vocoder.py");
const durationControl = read("services/indicf5-runtime/duration_control.py");
const pronunciationNormalizer = read("services/indicf5-runtime/pronunciation_normalizer.py");
const contract = read("services/indicf5-runtime/contract.py");
const fetchModels = read("services/indicf5-runtime/fetch_models.py");
const dockerfile = read("services/indicf5-runtime/Dockerfile");
const repairDockerfile = read("services/indicf5-runtime/Dockerfile.repair");
const patchDockerfile = read("services/indicf5-runtime/Dockerfile.patch");
const repairVocoderManifest = read("services/indicf5-runtime/repair_vocoder_manifest.py");
const requirements = read("services/indicf5-runtime/requirements.txt");
const acrTask = read("services/indicf5-runtime/acr-task.yaml");
const bicep = read("services/indicf5-runtime/infra/main.bicep");
const qualify = read("services/indicf5-runtime/qualify.mjs");
let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
};

console.log("\nIndicF5 isolated candidate");
const revisions = [
  "ba85abedf18dc479a447eaa0eccbd76ab78a47d5",
  "13f7c4d627cc10111aea8fe9c0039462cacacdc7",
  "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21",
];
ok("source, weights and vocoder are immutable and mirrored", revisions.every((revision) =>
  fetchModels.includes(revision) && (app.includes(revision) || dockerfile.includes(revision))));
ok("runtime model fetching is offline", /HF_HUB_OFFLINE=1/.test(dockerfile) && /TRANSFORMERS_OFFLINE=1/.test(dockerfile) && /local_files_only=True/.test(app));
ok("Vocos is baked and forced through a local-only loader before model construction",
  /local_dir=VOCODER_ROOT/.test(fetchModels) &&
  /vocoder_files/.test(fetchModels) &&
  /install_offline_vocos\(VOCODER_ROOT\)/.test(app) &&
  app.indexOf("install_offline_vocos(VOCODER_ROOT)") < app.indexOf("AutoModel.from_pretrained(") &&
  /is_local=True/.test(offlineVocoder) &&
  /hf_cache_dir=None/.test(offlineVocoder));
ok("the gated vocabulary lookup is pinned to the local model snapshot",
  fetchModels.includes('"checkpoints/vocab.txt"') &&
  /install_offline_vocab\(MODEL_ROOT\)/.test(app) &&
  app.indexOf("install_offline_vocab(MODEL_ROOT)") < app.indexOf("AutoModel.from_pretrained(") &&
  /indicf5_runtime_hub_access_denied/.test(offlineVocoder) &&
  /filename != "checkpoints\/vocab.txt"/.test(offlineVocoder));
ok("the bounded repair reuses the exact first image and performs no model fetch",
  repairDockerfile.includes("@sha256:276104f9bcc9719ce00010da3b58f71c506fd32ec02d59f906f170f1d7e4949a") &&
  repairDockerfile.includes("python repair_vocoder_manifest.py") &&
  !/HF_TOKEN|snapshot_download|curl|wget|git clone/.test(repairDockerfile) &&
  repairVocoderManifest.includes("indicf5_baked_vocoder_missing") &&
  repairVocoderManifest.includes('manifest.pop("commitment", None)'));
ok("the PerTh frame repair reuses the qualified offline image without model fetch",
  patchDockerfile.includes("@sha256:22c4477cb70fdb3d3c43feab7b70e36a6948ed8c1933da63b13a829b4289e71c") &&
  patchDockerfile.includes("COPY app.py ./app.py") &&
  !/HF_TOKEN|snapshot_download|curl|wget|git clone/.test(patchDockerfile));
ok("the runtime-only image patch includes the contract and pronunciation frontend",
  patchDockerfile.includes("COPY contract.py ./contract.py") &&
  patchDockerfile.includes("COPY pronunciation_normalizer.py ./pronunciation_normalizer.py") &&
  dockerfile.includes("COPY pronunciation_normalizer.py ./pronunciation_normalizer.py"));
ok("gated token uses BuildKit secret mount and never ARG or ENV", /--mount=type=secret,id=hf_token,required=true/.test(dockerfile) && !/ARG HF_TOKEN/.test(dockerfile) && !/ENV[^\n]*HF_TOKEN/.test(dockerfile));
ok("ACR task supplies the token as a mounted secret", /DOCKER_BUILDKIT=1/.test(acrTask) && /--secret id=hf_token,src=/.test(acrTask) && /hf_token: '\{\{\.Values\.hfToken \| b64enc\}\}'/.test(acrTask));
ok("the Hugging Face pin satisfies both cached-path and transformers",
  requirements.includes("cached_path==1.6.7") &&
  requirements.includes("huggingface-hub==0.27.1") &&
  requirements.includes("transformers==4.49.0"));
ok("model snapshot cannot look ready when required files are absent", /indicf5_snapshot_incomplete/.test(fetchModels) && /config\.json/.test(fetchModels) && /model\.safetensors/.test(fetchModels));
ok("Hindi disclosure and consent are hard predicates", contract.includes("hindi_disclosure_required") && contract.includes("consent_receipt_required"));
ok("source text and pronunciation mode are explicit request predicates",
  contract.includes("text_digest_invalid") &&
  contract.includes("pronunciation_normalization_contract_invalid") &&
  contract.includes('"mode": "required"') &&
  contract.includes("MAX_TEXT_CHARS = MAX_SOURCE_CODEPOINTS"));
ok("reference audio and transcript are both content addressed", contract.includes("reference_sha256") && contract.includes("reference_text_sha256") && contract.includes("reference_text_digest_invalid"));
ok("post-hoc PerTh is applied then detector verified", app.indexOf("apply_watermark(") < app.indexOf("get_watermark(") && app.indexOf("get_watermark(") < app.indexOf("audio_base64"));
ok("arbitrary IndicF5 lengths are frame-padded before PerTh and restored exactly",
  app.includes("PERTH_FRAME_SAMPLES = 240") &&
  app.includes("padding_samples = (-samples.size) % PERTH_FRAME_SAMPLES") &&
  app.includes('np.pad(samples, (0, padding_samples), mode="constant")') &&
  app.includes("protected.size != framed.size") &&
  app.includes("return protected[: samples.size]") &&
  !app.includes("protected.size != samples.size"));
ok("the runtime refuses CUDA absence and hides access logs", app.includes("indicf5_cuda_required") && dockerfile.includes("--no-access-log"));
ok("unexpected synthesis faults retain a content-free server diagnostic",
  app.includes('LOGGER.exception(') &&
  app.includes('"indicf5_synthesis_failed exception_type=%s"') &&
  app.includes("type(error).__name__") &&
  !/LOGGER\.exception\([^)]*(?:value|payload|reference|text)/s.test(app));
ok("cross-script duration is normalized, bounded and returned as provenance",
  durationControl.includes('CONTRACT = "vyakti-indicf5-codepoint-duration/v1"') &&
  durationControl.includes("MAX_PREDICTED_GENERATION_MS = 30_000") &&
  durationControl.includes('_density(text) / _density(reference_text)') &&
  app.includes("duration_plan = plan_duration(") &&
  app.includes('"duration_contract": duration_plan.contract') &&
  qualify.includes('value.duration_contract !== "vyakti-indicf5-codepoint-duration/v1"'));
ok("only the audited synthesis text reaches duration planning and the model",
  pronunciationNormalizer.includes('CONTRACT = "vyakti-indicf5-pronunciation-normalizer/v1"') &&
  app.includes('synthesis_text = normalization["synthesis_text"]') &&
  app.includes('synthesis_text, value["reference_text"]') &&
  app.includes('raw = app.state.model(\n                    synthesis_text,') &&
  !app.includes('raw = app.state.model(\n                    value["text"],'));
ok("the signed result carries a reconstructable pronunciation receipt without whole source text",
  app.includes('"pronunciation_normalization_receipt"') &&
  app.includes('"source_text_sha256": normalization["source_sha256"]') &&
  app.includes('"synthesis_text_sha256": normalization["synthesis_sha256"]') &&
  app.includes('"transformations": normalization["transformations"]') &&
  app.includes('"audit_sha256": normalization["audit_sha256"]') &&
  !app.includes('"source_text": normalization["source_text"]'));
ok("the evaluation resources cannot overwrite production names", bicep.includes("vyakti-indicf5-eval") && bicep.includes("vyakti-indicf5-eval-gate") && !bicep.includes("vyakti-open-voice'") );
ok("GPU is private, scale-to-zero and single-replica", /external: false/.test(bicep) && /minReplicas: 0/.test(bicep) && /maxReplicas: 1/.test(bicep));
ok("private images use a secure registry pull secret", /@secure\(\)[\s\S]*param registryPassword string/.test(bicep) && (bicep.match(/passwordSecretRef: 'acr-password'/g) || []).length === 2);
ok("transport HMAC remains a versioned Key Vault reference", /versionedHmacSecretUri/.test(bicep) && /\$\{keyVaultDnsSuffix\}\/secrets\/transport-hmac\//.test(bicep) && !/\.\$\{keyVaultDnsSuffix\}/.test(bicep) && (bicep.match(/keyVaultUrl: versionedHmacSecretUri/g) || []).length === 2);
ok("the infrastructure rejects budgets above USD 40", /@maxValue\(40\)/.test(bicep) && /approved_budget_usd/.test(bicep));
ok("an explicit expiry and evaluation-only tag are mandatory", /expiryAt/.test(bicep) && /evaluation_only: 'true'/.test(bicep));
ok("qualification uses six frozen Hindi and Hinglish prompts", qualify.includes('prompts.length !== 6') && qualify.includes('["devanagari", "mixed"]'));
ok("qualification keeps the arm sealed and binds owner consent", qualify.includes('arm_identity: "sealed"') && qualify.includes("activeConsentReceipt") && qualify.includes("consent_receipt_sha256"));
ok("qualification verifies model, reference, transcript and PerTh receipts", qualify.includes("indicf5_output_binding_invalid") && qualify.includes("model_revision") && qualify.includes("reference_text_sha256") && qualify.includes("perth_watermark_verified"));
ok("ASR reference text is labeled unreviewed rather than exact", qualify.includes('referenceTranscriptEvidenceScope = "asr_unreviewed"') && qualify.includes("transcribeReferenceHypothesis") && !qualify.includes("transcribeExact"));
ok("cold-start transport timeouts retry instead of aborting qualification", qualify.includes('error?.name === "TimeoutError"') && qualify.includes('error?.code === "UND_ERR_CONNECT_TIMEOUT"'));
ok("a short unscored canary separates cold start from the six blind clips",
  qualify.includes("const canaryPayload = {") &&
  qualify.includes("...normalizationRequest(canaryText)") &&
  qualify.includes("indicf5_canary_binding_invalid") &&
  qualify.indexOf("const canary = await synthesize") < qualify.indexOf("for (let index = 0; index < prompts.length") &&
  qualify.includes("scored: false"));
ok("same-process generation retries are content-bound and do not rerun the GPU",
  app.includes('value["_request_binding_sha256"] = sha256(body)') &&
  app.includes("generation_binding_conflict") &&
  app.includes('result = {**cached["result"], "generation_reused": True}') &&
  app.includes("while len(app.state.generation_results) > 16"));

const python = String.raw`
import base64, hashlib, io, json, sys, time, uuid, wave
sys.path.insert(0, r"services/indicf5-runtime")
from contract import DISCLOSURE, ServiceError, request_signature, sha256, validate_payload, verify_transport

buf = io.BytesIO()
with wave.open(buf, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
    wav.writeframes(bytes(24000 * 3 * 2))
audio = buf.getvalue()
ref_text = "आज हम रासायनिक अभिक्रियाओं को आसान तरीके से समझेंगे।"
payload = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()),
    "language_id": "hi", "text": DISCLOSURE + " नमस्ते, आज हम विज्ञान पढ़ेंगे।",
    "reference_audio_base64": base64.b64encode(audio).decode(),
    "reference_sha256": sha256(audio), "reference_text": ref_text,
    "reference_text_sha256": sha256(ref_text.encode()),
    "consent_receipt_sha256": "a" * 64, "seed": 17,
}
payload["text_sha256"] = sha256(payload["text"].encode())
payload["pronunciation_normalization"] = {
    "contract": "vyakti-indicf5-pronunciation-normalizer/v1",
    "domain": "chemistry", "locale": "hi-IN", "mode": "required",
}
value = validate_payload(payload)
assert value["reference"].duration_ms == 3000
assert value["text_language_mode"] == "devanagari"
assert value["text_sha256"] == payload["text_sha256"]
assert value["pronunciation_normalization"]["mode"] == "required"

for field, code in (("consent_receipt_sha256", "consent_receipt_required"), ("reference_text_sha256", "reference_text_digest_invalid")):
    bad = dict(payload); bad[field] = ""
    try: validate_payload(bad); raise AssertionError("accepted " + field)
    except ServiceError as exc: assert exc.code == code
for field, code in (("text_sha256", "text_digest_invalid"), ("pronunciation_normalization", "pronunciation_normalization_contract_invalid")):
    bad = dict(payload); bad.pop(field)
    try: validate_payload(bad); raise AssertionError("accepted missing " + field)
    except ServiceError as exc: assert exc.code == code
bad = dict(payload); bad["text"] = "Namaste"
try: validate_payload(bad); raise AssertionError("accepted missing disclosure")
except ServiceError as exc: assert exc.code == "hindi_disclosure_required"

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
ok("stdlib contract executes valid and negative controls", executed.stdout.includes("contract-execution-pass"));

const offlineVocoderPython = String.raw`
import sys, tempfile
from pathlib import Path
sys.path.insert(0, r"services/indicf5-runtime")
from offline_vocoder import force_offline_vocos

class FakeUtils:
    def __init__(self): self.calls = []
    def load_vocoder(self, **kwargs):
        self.calls.append(kwargs)
        return "local-vocoder"

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    (root / "config.yaml").write_text("test", encoding="utf-8")
    (root / "pytorch_model.bin").write_bytes(b"test")
    fake = FakeUtils()
    force_offline_vocos(fake, root)
    assert fake.load_vocoder(vocoder_name="vocos", is_local=False, local_path="remote", hf_cache_dir="remote") == "local-vocoder"
    call = fake.calls[0]
    assert call["is_local"] is True
    assert call["local_path"] == str(root.resolve())
    assert call["hf_cache_dir"] is None
    try:
        fake.load_vocoder(vocoder_name="bigvgan")
        raise AssertionError("accepted unexpected vocoder")
    except RuntimeError as exc:
        assert str(exc) == "indicf5_unexpected_vocoder"
print("offline-vocoder-pass")
`;
const offlineVocoderExecuted = spawnSync("python", ["-c", offlineVocoderPython], { cwd: root, encoding: "utf8" });
assert.equal(offlineVocoderExecuted.status, 0, offlineVocoderExecuted.stderr || offlineVocoderExecuted.stdout);
ok("offline Vocos loader executes with no Hub fallback", offlineVocoderExecuted.stdout.includes("offline-vocoder-pass"));

const offlineVocabPython = String.raw`
import sys, tempfile
from pathlib import Path
sys.path.insert(0, r"services/indicf5-runtime")
from offline_vocoder import force_offline_vocab

class FakeHub:
    def hf_hub_download(self, *args, **kwargs):
        raise AssertionError("original Hub loader reached")

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp); (root / "checkpoints").mkdir()
    vocab = root / "checkpoints" / "vocab.txt"; vocab.write_text("test", encoding="utf-8")
    fake = FakeHub(); force_offline_vocab(fake, root)
    assert fake.hf_hub_download(str(root.resolve()), "checkpoints/vocab.txt") == str(vocab.resolve())
    for repo, filename in (("other/repo", "checkpoints/vocab.txt"), (str(root.resolve()), "config.json")):
        try:
            fake.hf_hub_download(repo, filename)
            raise AssertionError("accepted unpinned runtime Hub asset")
        except RuntimeError as exc:
            assert str(exc) == "indicf5_runtime_hub_access_denied"
print("offline-vocab-pass")
`;
const offlineVocabExecuted = spawnSync("python", ["-c", offlineVocabPython], { cwd: root, encoding: "utf8" });
assert.equal(offlineVocabExecuted.status, 0, offlineVocabExecuted.stderr || offlineVocabExecuted.stdout);
ok("offline vocabulary loader executes and rejects every other Hub asset", offlineVocabExecuted.stdout.includes("offline-vocab-pass"));

const repairPython = String.raw`
import hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    model = root / "model"; cache = root / "cache"; vocoder = root / "vocoder"
    model.mkdir(); cache.mkdir()
    (cache / "config.yaml").write_text("config", encoding="utf-8")
    (cache / "pytorch_model.bin").write_bytes(b"weights")
    (model / "checkpoints").mkdir(); (model / "checkpoints" / "vocab.txt").write_text("vocab", encoding="utf-8")
    manifest = {"contract":"vyakti-indicf5-model-manifest/v1", "vocoder_revision":"0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21", "commitment":"0" * 64}
    (model / ".vyakti-model-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    env = dict(os.environ, INDICF5_MODEL_ROOT=str(model), INDICF5_VOCODER_ROOT=str(vocoder), INDICF5_VOCODER_CACHE_ROOT=str(cache))
    result = subprocess.run([sys.executable, "services/indicf5-runtime/repair_vocoder_manifest.py"], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    repaired = json.loads((model / ".vyakti-model-manifest.json").read_text(encoding="utf-8"))
    assert [item["path"] for item in repaired["vocoder_files"]] == ["config.yaml", "pytorch_model.bin"]
    assert repaired["vocoder_files"][1]["sha256"] == hashlib.sha256(b"weights").hexdigest()
    assert repaired["commitment"] != "0" * 64
print("repair-vocoder-pass")
`;
const repairExecuted = spawnSync("python", ["-c", repairPython], { cwd: root, encoding: "utf8" });
assert.equal(repairExecuted.status, 0, repairExecuted.stderr || repairExecuted.stdout);
ok("the no-network image repair copies and commits exact baked Vocos files", repairExecuted.stdout.includes("repair-vocoder-pass"));

const durationPython = String.raw`
import sys
sys.path.insert(0, r"services/indicf5-runtime")
from duration_control import plan_duration
reference = "Today we will study chemical reactions and balanced equations in a simple classroom example."
devanagari = "यह एआई से बनाई गई आवाज़ की प्रतिकृति है। आज हम रासायनिक अभिक्रियाओं को आसान उदाहरण से समझेंगे।"
latin = "This is an AI generated voice replica. Today we will study chemical reactions with one simple example."
hi = plan_duration(devanagari, reference, 12000)
en = plan_duration(latin, reference, 12000)
assert hi.speed > 2.0
assert 10000 <= hi.predicted_generation_ms <= 18000
assert 0.75 <= en.speed <= 1.25
assert hi.predicted_generation_ms <= 30000
try:
    plan_duration("क" * 1000, "short", 12000)
    raise AssertionError("accepted excessive generation")
except ValueError as exc:
    assert str(exc) == "indicf5_duration_plan_too_long"
print("duration-control-pass")
`;
const durationExecuted = spawnSync("python", ["-c", durationPython], { cwd: root, encoding: "utf8" });
assert.equal(durationExecuted.status, 0, durationExecuted.stderr || durationExecuted.stdout);
ok("Devanagari duration normalization executes with a long-output refusal", durationExecuted.stdout.includes("duration-control-pass"));

const compiled = spawnSync("python", ["-m", "py_compile",
  "services/indicf5-runtime/contract.py", "services/indicf5-runtime/fetch_models.py",
  "services/indicf5-runtime/offline_vocoder.py", "services/indicf5-runtime/duration_control.py",
  "services/indicf5-runtime/pronunciation_normalizer.py",
  "services/indicf5-runtime/repair_vocoder_manifest.py",
  "services/indicf5-runtime/app.py"],
{ cwd: root, encoding: "utf8" });
ok("all Python sources compile", compiled.status === 0);

const qualified = spawnSync(process.execPath, ["--check", "services/indicf5-runtime/qualify.mjs"],
{ cwd: root, encoding: "utf8" });
ok("qualification script parses", qualified.status === 0);

console.log(`\n${passed}/${passed} IndicF5 candidate checks passed.`);
