import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RUNTIME_COPY_FILES,
  buildAcrArguments,
  createBuildPlan,
  quoteWindowsCommandArgument,
  resolveAzureCli,
  spawnAzureCli,
} from "../../services/openvoice-converter/remote-build.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const service = "services/openvoice-converter/";
const app = read(`${service}app.py`);
const contract = read(`${service}contract.py`);
const broker = read(`${service}broker.py`);
const fetchModels = read(`${service}fetch_models.py`);
const dockerfile = read(`${service}Dockerfile`);
const brokerfile = read(`${service}Dockerfile.broker`);
const acrTask = read(`${service}acr-task.yaml`);
const remoteBuild = read(`${service}remote-build.mjs`);
const accessCheck = read(`${service}access-check.mjs`);
const bicep = read(`${service}infra/main.bicep`);
const readme = read(`${service}README.md`);
let passed = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
};

console.log("\nOpenVoice tone-color candidate");
const pins = [
  "74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
  "fd981100305a0e4291f93a9ad169c6d9f7bed54a",
  "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e",
  "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47",
];
ok("source, official snapshot, checkpoint and config are immutable and mirrored",
  pins.every((pin) => fetchModels.includes(pin) && app.includes(pin))
    && dockerfile.includes(pins[0])
    && dockerfile.includes("VYAKTI_RUNTIME_SOURCE_SHA256")
    && app.includes('"runtime_source_sha256": RUNTIME_SOURCE_SHA256'));
ok("runtime model access is offline and startup rehashes both artifacts",
  /HF_HUB_OFFLINE=1/.test(dockerfile) && /TRANSFORMERS_OFFLINE=1/.test(dockerfile)
    && app.includes("_file_sha256(checkpoint_path)") && app.includes("_file_sha256(config_path)"));
ok("the public model fetch needs no password, token, ARG or secret",
  !/HF_TOKEN|password|--mount=type=secret/i.test(fetchModels + dockerfile + acrTask + accessCheck));
ok("the exact OpenVoice source is installed without dependency drift",
  /OpenVoice\.git@\$\{OPENVOICE_SOURCE_COMMIT\}/.test(dockerfile) && /--no-deps/.test(dockerfile));
ok("owner identity, reference subject, consent and spoken disclosure are hard predicates",
  contract.includes("owner_reference_required") && contract.includes("consent_receipt_required")
    && contract.includes("spoken_disclosure_required"));
ok("base audio, base receipt, owner reference, converter and final PerTh are bound",
  ["base_generation_receipt_sha256", "reference_audio_sha256", "converted_pcm_sha256",
    "final_pcm_sha256", "receipt_sha256"].every((field) => contract.includes(field)));
ok("OpenVoice native watermark is disabled and PerTh runs after conversion",
  app.includes("class PerThOnlyToneColorConverter") && app.includes("self.watermark_model = None")
    && contract.includes('"native_watermark": "disabled_before_perth"')
    && app.indexOf("converter.convert(") < app.indexOf("_apply_perth_watermark(converted)")
    && app.indexOf("_apply_perth_watermark(converted)") < app.lastIndexOf("get_watermark("));
ok("arbitrary converter lengths are frame-padded for PerTh then restored exactly",
  app.includes("PERTH_FRAME_SAMPLES = 240")
    && app.includes("padding_samples = (-samples.size) % PERTH_FRAME_SAMPLES")
    && app.includes("protected[: samples.size]"));
ok("audio cannot leave before PerTh verification and receipt construction",
  app.indexOf("get_watermark(") < app.indexOf("build_receipt(")
    && app.indexOf("build_receipt(") < app.indexOf('"audio_base64"'));
ok("synthetic fixtures are explicitly disabled by deployed infrastructure",
  app.includes("synthetic_fixture_disabled")
    && /OPENVOICE_CONVERTER_ALLOW_SYNTHETIC_FIXTURE.*value: 'false'/.test(bicep));
ok("the broker wakes privately then freshly re-signs instead of forwarding stale HMAC",
  broker.indexOf("_runtime_is_ready()") < broker.indexOf("_internal_headers(body_hash)")
    && broker.includes("internal_nonce") && broker.includes("runtime_response_signature_invalid"));
ok("remote ACR builds both isolated images without invoking local Docker",
  /openvoice-converter-eval/.test(acrTask) && /openvoice-converter-gate/.test(acrTask)
    && /Dockerfile\.broker/.test(acrTask)
    && /--build-arg VYAKTI_RUNTIME_SOURCE_SHA256=\$SOURCE_MANIFEST_SHA256/.test(acrTask)
    && /''\|\*\[!0-9a-f\]\*/.test(dockerfile)
    && /test "\$\{#VYAKTI_RUNTIME_SOURCE_SHA256\}" -eq 64/.test(dockerfile)
    && !/docker\.exe|Docker Desktop/i.test(acrTask));
const remotePlan = createBuildPlan({ registry: "vyaktitestacr", root: fileURLToPath(root) });
const copiedFiles = [...dockerfile.matchAll(/^COPY\s+(services\/openvoice-converter\/[^\s]+)\s+/gm)]
  .map((match) => match[1]);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const expectedManifestHash = createHash("sha256")
  .update(canonical(remotePlan.sourceManifest))
  .digest("hex");
assert.throws(() => buildAcrArguments({ registry: "vyaktitestacr", sourceManifestSha256: "" }),
  /openvoice_remote_build_source_manifest_required/);
ok("remote build wrapper derives the exact COPY manifest and passes it fail closed",
  JSON.stringify(copiedFiles) === JSON.stringify(RUNTIME_COPY_FILES)
    && remotePlan.sourceManifest.files.length === RUNTIME_COPY_FILES.length
    && remotePlan.sourceManifestSha256 === expectedManifestHash
    && remotePlan.azureArguments.includes(`SOURCE_MANIFEST_SHA256=${expectedManifestHash}`)
    && /spawnAzureCli\(\{ executable, args: plan\.azureArguments \}\)/.test(remoteBuild)
    && !remoteBuild.includes("shell: true")
    && /source-manifest value is\s+rejected before Azure/.test(readme));
let directInvocation;
spawnAzureCli({
  executable: "az",
  args: ["acr", "run"],
  platform: "linux",
  stdio: "pipe",
  spawn: (executable, args, options) => {
    directInvocation = { executable, args, options };
    return { status: 0 };
  },
});
assert.deepEqual(directInvocation.executable, "az");
assert.deepEqual(directInvocation.args, ["acr", "run"]);
assert.equal(directInvocation.options.shell, false);
assert.throws(() => quoteWindowsCommandArgument("unsafe&whoami"),
  /openvoice_remote_build_windows_argument_invalid/);
let windowsShimVerified = process.platform !== "win32";
if (process.platform === "win32") {
  const fixture = mkdtempSync(join(tmpdir(), "vyakti az shim "));
  try {
    const capture = join(fixture, "captured args.json");
    const captureScript = join(fixture, "capture args.mjs");
    const shim = join(fixture, "fake az.cmd");
    writeFileSync(captureScript,
      "import{writeFileSync}from'node:fs';writeFileSync(process.env.VYAKTI_AZ_CAPTURE,JSON.stringify(process.argv.slice(2)));\n");
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${captureScript}" %*\r\n`);
    const args = ["acr", "run", "--file", "path with spaces/task.yaml", "--set", "SOURCE_MANIFEST_SHA256=" + "a".repeat(64), "."];
    const oldDirect = spawnSync(shim, args, { shell: false, stdio: "pipe" });
    assert.ok(oldDirect.error || oldDirect.status !== 0, "old direct az.cmd spawn unexpectedly succeeded");
    const executable = resolveAzureCli({ requested: shim });
    const result = spawnAzureCli({
      executable,
      args,
      cwd: fileURLToPath(root),
      env: { ...process.env, VYAKTI_AZ_CAPTURE: capture },
      stdio: "pipe",
    });
    assert.equal(result.status, 0, result.error?.message || result.stderr?.toString());
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), args);
    windowsShimVerified = true;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
ok("Azure CLI execution is direct off Windows and quotes Windows cmd shims without shell mode",
  windowsShimVerified && /--az <absolute-az\.cmd>/.test(readme)
    && /VYAKTI_AZURE_CLI/.test(readme));
ok("GPU ingress is private, scale-to-zero and one replica",
  /external: false/.test(bicep) && /minReplicas: 0/.test(bicep) && /maxReplicas: 1/.test(bicep));
ok("private ACR pull credentials are secure inputs wired to both isolated apps",
  /@secure\(\)\s*@description\('Azure Container Registry pull password/.test(bicep)
    && /param registryPassword string/.test(bicep)
    && (bicep.match(/passwordSecretRef: 'acr-password'/g) || []).length === 2
    && (bicep.match(/name: 'acr-password', value: registryPassword/g) || []).length === 2);
ok("infrastructure is evaluation-only, expires and rejects more than USD 40",
  /evaluation_only: 'true'/.test(bicep) && /expiryAt/.test(bicep)
    && /@maxValue\(40\)/.test(bicep) && /approved_budget_usd/.test(bicep));
ok("production application names cannot be overwritten",
  bicep.includes("vyakti-openvoice-converter-eval")
    && bicep.includes("vyakti-openvoice-converter-gate")
    && !bicep.includes("vyakti-open-voice'"));
ok("documentation refuses quality claims and third-party identity audio",
  /no quality claim/i.test(readme) && /Do not use the third-party lecture as an identity reference/.test(readme)
    && /blinded owner ABX/.test(readme));
ok("the broker uses a pinned non-root image and hides access logs",
  /python:3\.11\.11-slim@sha256:/.test(brokerfile) && /USER 10010:10010/.test(brokerfile)
    && brokerfile.includes("--no-access-log"));

const python = String.raw`
import base64, hashlib, io, json, math, struct, sys, uuid, wave
sys.path.insert(0, r"services/openvoice-converter")
from contract import DISCLOSURES, ServiceError, build_receipt, canonical, request_signature, sha256, validate_payload, verify_transport

owner = str(uuid.uuid4())
pcm = b"".join(struct.pack("<h", round(5000 * math.sin(2 * math.pi * 220 * i / 24000))) for i in range(24000))
ref = io.BytesIO()
with wave.open(ref, "wb") as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
    wav.writeframes(pcm * 3)
ref_bytes = ref.getvalue()
text = DISCLOSURES["en"] + " This is a synthetic contract fixture."
payload = {
    "request_id": str(uuid.uuid4()), "generation_id": str(uuid.uuid4()),
    "owner_id": owner, "reference_subject_id": owner,
    "consent_receipt_sha256": "a" * 64, "language_id": "en",
    "base_text": text, "base_text_sha256": sha256(text.encode()),
    "base_provider": "synthetic-fixture", "base_model": "fixture-sine-v1",
    "base_model_commitment": "b" * 64, "base_generation_receipt_sha256": "c" * 64,
    "base_encoding": "pcm_s16le", "base_sample_rate": 24000, "base_channels": 1,
    "base_audio_base64": base64.b64encode(pcm).decode(), "base_audio_sha256": sha256(pcm),
    "reference_audio_base64": base64.b64encode(ref_bytes).decode(),
    "reference_audio_sha256": sha256(ref_bytes), "converter_tau": 0.3,
}
value = validate_payload(payload)
assert value["base"].duration_ms == 1000 and value["reference"].duration_ms == 3000
converter = {"engine": "openvoice-v2-tone-color-converter", "commitment": "d" * 64}
receipt = build_receipt(value, converter, "e" * 64, "f" * 64, 0.91, 0.5)
assert receipt["base"]["audio_sha256"] == sha256(pcm)
assert receipt["reference"]["subject_id"] == owner
assert receipt["protection"]["final_pcm_sha256"] == "f" * 64
assert receipt["receipt_sha256"] == sha256(canonical({k: v for k, v in receipt.items() if k != "receipt_sha256"}))
assert canonical({"score": 1.0}) == b'{"score":1}'
integral_receipt = build_receipt(value, converter, "e" * 64, "f" * 64, 1.0, 0.5)
integral_round_trip = json.loads(json.dumps(integral_receipt))
integral_hash = integral_round_trip.pop("receipt_sha256")
assert integral_hash == sha256(canonical(integral_round_trip))

for mutate, code in (
    ({"reference_subject_id": str(uuid.uuid4())}, "owner_reference_required"),
    ({"base_text": "No disclosure here"}, "spoken_disclosure_required"),
    ({"converter_tau": 0.4}, "converter_tau_invalid"),
):
    bad = dict(payload); bad.update(mutate)
    try: validate_payload(bad); raise AssertionError("accepted " + code)
    except ServiceError as exc: assert exc.code == code

body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
secret = b"s" * 32; timestamp = "2026-08-28T00:00:00Z"; now = 1787875200.0
nonce = "abcdefghijklmnopqrstuvwxyz1234"; body_hash = hashlib.sha256(body).hexdigest()
headers = {"x-vyakti-protocol": "vyakti-tone-color-converter/v1", "x-vyakti-timestamp": timestamp,
           "x-vyakti-nonce": nonce, "x-vyakti-content-sha256": body_hash}
headers["x-vyakti-signature"] = request_signature(secret, "POST", "/v1/convert", timestamp, nonce, body_hash)
assert verify_transport(secret, "POST", "/v1/convert", headers, body, now=now) == nonce
headers["x-vyakti-signature"] = "wrong"
try: verify_transport(secret, "POST", "/v1/convert", headers, body, now=now); raise AssertionError("accepted bad HMAC")
except ServiceError as exc: assert exc.code == "transport_binding_invalid"
print("converter-contract-pass")
`;
const executed = spawnSync("python", ["-c", python], { cwd: root, encoding: "utf8" });
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
ok("contract executes valid, identity, disclosure, tau, receipt and HMAC controls",
  executed.stdout.includes("converter-contract-pass"));

const compiled = spawnSync("python", ["-m", "py_compile",
  `${service}contract.py`, `${service}fetch_models.py`, `${service}app.py`, `${service}broker.py`],
{ cwd: root, encoding: "utf8" });
ok("all Python sources compile", compiled.status === 0);

console.log(`\n${passed}/${passed} OpenVoice converter checks passed.`);
