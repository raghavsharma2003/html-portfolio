import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("services/voxcpm2-runtime/app.py");
const contract = read("services/voxcpm2-runtime/contract.py");
const fetchModels = read("services/voxcpm2-runtime/fetch_models.py");
const dockerfile = read("services/voxcpm2-runtime/Dockerfile");
const requirements = read("services/voxcpm2-runtime/requirements.txt");
const bicep = read("services/voxcpm2-runtime/infra/main.bicep");
const qualify = read("services/voxcpm2-runtime/qualify.mjs");
let passed = 0;
const ok = (name, condition) => { assert.ok(condition, name); passed += 1; console.log(`  PASS ${name}`); };

console.log("\nVoxCPM2 isolated multilingual candidate");
const revisions = ["32279effe8c19989596f05d353d1447f51d9e915", "f5a1c6a6b901bc732e20f0d59a369f6829ad717a"];
ok("official source and weights are immutable and mirrored", revisions.every((revision) => fetchModels.includes(revision) && (app.includes(revision) || dockerfile.includes(revision))));
ok("Apache-2.0 source and model license is bound into provenance", fetchModels.includes('"license": "Apache-2.0"') && app.includes('"license": "Apache-2.0"'));
ok("runtime model access is offline", /HF_HUB_OFFLINE=1/.test(dockerfile) && /TRANSFORMERS_OFFLINE=1/.test(dockerfile) && /local_files_only=True/.test(app));
ok("public weights cannot consume the pasted full-access token", !/HF_TOKEN|hf_token|build-arg/i.test(dockerfile + fetchModels));
ok("PEP 639 metadata uses a setuptools version that accepts the upstream SPDX license string", /setuptools==(?:8[0-9]|7[7-9])\./.test(requirements));
ok("Hindi must contain Devanagari and every language has a localized disclosure", contract.includes("hindi_devanagari_required") && contract.includes("localized_disclosure_required"));
ok("owner identity is an explicit self binding", contract.includes("verified_owner_identity") && contract.includes("verified_owner_self") && contract.includes("owner_identity_binding_required"));
ok("third-party lecture use can never become training, identity or release", ["third_party_language_stress", "third_party_not_owner", "third_party_release_denied", "third_party_use_binding_required"].every((value) => contract.includes(value)));
ok("source, reference window and optional ultimate transcript are content addressed", contract.includes("reference_source_sha256") && contract.includes("reference_window_duration_mismatch") && contract.includes("reference_text_sha256") && contract.includes("reference_text_digest_invalid"));
ok("post-synthesis PerTh is applied then detector verified", app.indexOf("apply_watermark(") < app.indexOf("get_watermark(") && app.indexOf("get_watermark(") < app.indexOf("audio_base64"));
ok("48 kHz model output is explicitly resampled into the 24 kHz protected delivery contract", app.includes("MODEL_SAMPLE_RATE = 48_000") && app.includes("DELIVERY_SAMPLE_RATE = 24_000") && app.includes("torchaudio.functional.resample"));
ok("final provenance binds model, text, reference, consent or policy, scope and PerTh", ["model_commitment", "text_sha256", "reference_sha256", "consent_receipt_sha256", "third_party_policy_receipt_sha256", "evaluation_scope", "perth_score"].every((key) => app.includes(`\"${key}\"`)));
ok("CUDA is required and access logs are disabled", app.includes("voxcpm2_cuda_required") && dockerfile.includes("--no-access-log"));
ok("runtime is non-root without duplicating the baked model in a recursive chown layer", /USER 10009:10009/.test(dockerfile) && !/chown\s+-R[^\n]*\/models/.test(dockerfile));
ok("evaluation resources cannot overwrite production", bicep.includes("vyakti-voxcpm2-eval") && bicep.includes("vyakti-voxcpm2-eval-gate") && !bicep.includes("name: 'vyakti-open-voice'"));
ok("GPU stays private, scale-to-zero and single replica", /external: false/.test(bicep) && /minReplicas: 0/.test(bicep) && /maxReplicas: 1/.test(bicep));
ok("transport key is a versioned Key Vault reference under managed identity", /param evalIdentityId string/.test(bicep) && /param hmacSecretUri string/.test(bicep) && /environment\(\)\.suffixes\.keyvaultDns/.test(bicep) && /contains\(hmacSecretUri, '\$\{keyVaultDnsSuffix\}\/secrets\/transport-hmac\/'\)/.test(bicep) && !/contains\(hmacSecretUri, '\.\$\{keyVaultDnsSuffix\}/.test(bicep) && /length\(last\(split\(hmacSecretUri/.test(bicep) && /type: 'UserAssigned'/.test(bicep) && /keyVaultUrl: versionedHmacSecretUri, identity: managedIdentityId/.test(bicep) && !/param hmacSecret string/.test(bicep));
ok("infrastructure rejects budgets above USD 75", /@maxValue\(75\)/.test(bicep) && /approved_budget_usd/.test(bicep));
ok("explicit expiry and disabled production routing are mandatory", /expiryAt/.test(bicep) && /production_routing: 'disabled'/.test(bicep));
ok("CPU admission is warmed before signing and every GPU cold retry is freshly signed", qualify.indexOf("await warmGate(origin)") < qualify.indexOf("for (let index = 0; index < PROMPTS.length") && /for \(let attempt = 1; attempt <= 8/.test(qualify) && qualify.indexOf("const timestamp = new Date().toISOString()") < qualify.indexOf("fetch(`${origin}${PATH}`"));

const python = String.raw`
import base64, hashlib, io, json, sys, uuid, wave
sys.path.insert(0, r"services/voxcpm2-runtime")
from contract import DISCLOSURES, ServiceError, request_signature, sha256, validate_payload, verify_transport

buf = io.BytesIO()
with wave.open(buf, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(bytes(24000 * 3 * 2))
audio = buf.getvalue()
base = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()), "replica_id": str(uuid.uuid4()),
    "language_id": "hi", "text": DISCLOSURES["hi"] + " आज हम chemical equation को संतुलित करेंगे।",
    "reference_audio_base64": base64.b64encode(audio).decode(), "reference_sha256": sha256(audio),
    "reference_source_sha256": "c" * 64, "reference_window_start_ms": 25000, "reference_window_end_ms": 28000,
    "consent_receipt_sha256": "a" * 64, "evaluation_scope": "verified_owner_identity",
    "identity_scope": "verified_owner_self", "release_eligible": True, "clone_mode": "reference_only", "seed": 17,
}
value = validate_payload(base)
assert value["script_mode"] == "mixed" and value["release_eligible"] is True
bad = dict(base); bad["text"] = DISCLOSURES["hi"] + " Namaste, aaj chemistry padhenge."
try: validate_payload(bad); raise AssertionError("accepted Roman-only Hindi")
except ServiceError as exc: assert exc.code == "hindi_devanagari_required"
stress = dict(base); stress.pop("consent_receipt_sha256"); stress.update({
    "evaluation_scope": "third_party_language_stress", "identity_scope": "third_party_not_owner",
    "release_eligible": False, "training_allowed": False, "identity_claim_allowed": False,
    "third_party_policy_receipt_sha256": "b" * 64,
})
assert validate_payload(stress)["release_eligible"] is False
bad = dict(stress); bad["release_eligible"] = True
try: validate_payload(bad); raise AssertionError("released third-party stress identity")
except ServiceError as exc: assert exc.code == "third_party_release_denied"
ultimate = dict(base); ultimate["clone_mode"] = "ultimate"; ultimate["reference_text"] = "यह सही प्रतिलेख है।"; ultimate["reference_text_sha256"] = sha256(ultimate["reference_text"].encode())
assert validate_payload(ultimate)["clone_mode"] == "ultimate"
body = json.dumps(base, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(); secret = b"s" * 32
timestamp = "2026-08-28T00:00:00Z"; now = 1787875200.0; nonce = "abcdefghijklmnopqrstuvwxyz1234"
headers = {"x-vyakti-protocol": "vyakti-open-voice/v1", "x-vyakti-timestamp": timestamp, "x-vyakti-nonce": nonce, "x-vyakti-content-sha256": hashlib.sha256(body).hexdigest()}
headers["x-vyakti-signature"] = request_signature(secret, "POST", "/v1/synthesize", timestamp, nonce, headers["x-vyakti-content-sha256"])
assert verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now) == nonce
headers["x-vyakti-signature"] = "wrong"
try: verify_transport(secret, "POST", "/v1/synthesize", headers, body, now=now); raise AssertionError("accepted bad HMAC")
except ServiceError as exc: assert exc.code == "transport_binding_invalid"
print("contract-execution-pass")
`;
const executed = spawnSync("python", ["-c", python], { cwd: root, encoding: "utf8" });
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
ok("stdlib contract executes owner, third-party and HMAC controls", executed.stdout.includes("contract-execution-pass"));

const compiled = spawnSync("python", ["-m", "py_compile", "services/voxcpm2-runtime/contract.py", "services/voxcpm2-runtime/fetch_models.py", "services/voxcpm2-runtime/app.py"], { cwd: root, encoding: "utf8" });
ok("all Python sources compile", compiled.status === 0);
console.log(`\n${passed}/${passed} VoxCPM2 candidate checks passed.`);
