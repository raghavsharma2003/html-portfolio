import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../..", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "vyakti-azure-build-"));
const checks = [];
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|PROGRAMFILES)$/i.test(key)));
const fake = {
  CI: "1",
  NEON_URL: "postgresql://synthetic-user:synthetic-pass@db.invalid/synthetic",
  AZURE_FOUNDRY_ENDPOINT: "https://synthetic-build.services.ai.azure.com",
  AZURE_FOUNDRY_API_KEY: "synthetic-azure-key-never-real",
  AZURE_FOUNDRY_DIALOGUE_MODEL: "synthetic-model",
  AZURE_REPLICA_APP_BUDGET_USD: "1",
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "0.4",
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "1.6",
};
const secrets = [fake.NEON_URL, fake.AZURE_FOUNDRY_API_KEY];
const closure = [
  "api/_azure-surface-reply.js",
  "api/_provider-budget.js",
  "api/_provenance/contracts.js",
  "api/_voice/contracts.js",
  "api/_replica.js",
  "api/_invites.js",
  "api/_dialogue/contracts.js",
  "api/_dialogue/provider-revision.js",
  "api/_dialogue/providers/azure-foundry.js",
];

const check = (name, fn) => { fn(); checks.push(name); console.log(`ok ${checks.length}: ${name}`); };
const copy = (dir, path) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  copyFileSync(join(root, path), join(dir, path));
};

function prepare() {
  const dir = join(workspace, "case");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(join(dir, "guard.mjs"), 'globalThis.fetch=()=>{throw new Error("NETWORK_FORBIDDEN")};\n');
  copy(dir, "scripts/write-config.mjs");
  copy(dir, "scripts/vercel-build.sh");
  copy(dir, "scripts/vercel-product.mjs");
  for (const path of closure) copy(dir, path);
  writeFileSync(join(dir, ".vercel-release-preinstall.json"), "{}");
  return dir;
}

function runWriter(vars, args = ["--vyakti-deploy"], existing) {
  const dir = prepare();
  if (existing !== undefined) writeFileSync(join(dir, "api/_config.js"), existing);
  const result = spawnSync(process.execPath,
    ["--import", pathToFileURL(join(dir, "guard.mjs")).href, "scripts/write-config.mjs", ...args],
    { cwd: dir, env: { ...safeEnv, ...vars }, encoding: "utf8", timeout: 12_000 });
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  for (const secret of secrets) assert.ok(!output.includes(secret), "configuration value leaked to output");
  const configPath = join(dir, "api/_config.js");
  return { ...result, output, config: existsSync(configPath) ? readFileSync(configPath, "utf8") : null };
}

function runBuild(vars, existing) {
  const dir = prepare();
  if (existing !== undefined) writeFileSync(join(dir, "api/_config.js"), existing);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "bin/npx"), '#!/usr/bin/env bash\nprintf "VITE_SENTINEL\\n"\nexit 73\n', { mode: 0o755 });
  const candidates = process.platform === "win32"
    ? [join(process.env.LOCALAPPDATA || "", "Programs/Git/bin/bash.exe"), join(process.env.ProgramFiles || "", "Git/bin/bash.exe")]
    : ["/bin/bash", "/usr/bin/bash"];
  const bash = candidates.find(existsSync);
  assert.ok(bash, "Bash is required; this suite cannot silently skip the build shell");
  const pathKey = Object.keys(safeEnv).find((key) => key.toLowerCase() === "path") || "PATH";
  const result = spawnSync(bash, ["-c", 'export PATH="$PWD/bin:$PATH"; exec bash scripts/vercel-build.sh'], {
    cwd: dir,
    env: { ...safeEnv, ...vars, [pathKey]: safeEnv[pathKey], NODE_OPTIONS: `--import=${pathToFileURL(join(dir, "guard.mjs")).href}` },
    encoding: "utf8",
    timeout: 12_000,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  for (const secret of secrets) assert.ok(!output.includes(secret), "configuration value leaked to output");
  return { ...result, output };
}

try {
  check("valid shared Azure dialogue configuration writes the private config without network", () => {
    const r = runWriter(fake);
    assert.equal(r.status, 0);
    assert.ok(r.config?.includes(JSON.stringify(fake.NEON_URL)));
    assert.ok(!r.config.includes(fake.AZURE_FOUNDRY_API_KEY), "runtime Azure key must not be baked into _config.js");
  });

  const invalid = [
    ["endpoint absent", { AZURE_FOUNDRY_ENDPOINT: "" }, "azure_reply_endpoint_required"],
    ["endpoint deceptive", { AZURE_FOUNDRY_ENDPOINT: "https://ok.services.ai.azure.com.invalid" }, "azure_reply_endpoint_invalid"],
    ["endpoint uses HTTP", { AZURE_FOUNDRY_ENDPOINT: "http://ok.services.ai.azure.com" }, "azure_reply_endpoint_invalid"],
    ["key absent", { AZURE_FOUNDRY_API_KEY: "" }, "azure_reply_auth_required"],
    ["dialogue model absent", { AZURE_FOUNDRY_DIALOGUE_MODEL: "" }, "azure_reply_model_required"],
    ["shared input rate absent", { AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "" }, "provider_input_rate_required"],
    ["shared output rate invalid", { AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "NaN" }, "provider_output_rate_required"],
    ["budget absent", { AZURE_REPLICA_APP_BUDGET_USD: "" }, "provider_budget_limit_required"],
    ["Neon whitespace", { NEON_URL: " " }, "NEON_URL_required"],
  ];
  for (const [name, patch, code] of invalid) check(`${name} refuses before config write`, () => {
    const r = runWriter({ ...fake, ...patch });
    assert.equal(r.status, 1);
    assert.equal(r.config, null);
    assert.ok(r.output.includes(code));
  });

  const terra = {
    ...fake,
    AZURE_FOUNDRY_DIALOGUE_MODEL: "gpt-5.6-terra",
    AZURE_FOUNDRY_DIALOGUE_RATE_MODEL: "gpt-5.6-terra",
    AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL: "gpt-5.6-terra-2026-07-09",
    AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS: "0.8",
    AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS: "3.2",
  };
  check("Terra accepts an exact dialogue revision and separate verified rate card", () => {
    assert.equal(runWriter(terra).status, 0);
  });
  check("Terra refuses a missing exact rate-model binding", () => {
    const r = runWriter({ ...terra, AZURE_FOUNDRY_DIALOGUE_RATE_MODEL: "" });
    assert.equal(r.status, 1);
    assert.ok(r.output.includes("dialogue_azure_rate_model_mismatch"));
  });
  check("Terra refuses a missing expected response revision", () => {
    const r = runWriter({ ...terra, AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL: "" });
    assert.equal(r.status, 1);
    assert.ok(r.output.includes("dialogue_azure_expected_model_required"));
  });
  check("retired selector and reply-specific names cannot satisfy deployment admission", () => {
    const retired = {
      CI: "1", NEON_URL: fake.NEON_URL, VYAKTI_MODEL_SERVING: "azure_only", VYAKTI_REPLY_PROVIDER: "azure_foundry",
      AZURE_FOUNDRY_REPLY_ENDPOINT: fake.AZURE_FOUNDRY_ENDPOINT,
      AZURE_FOUNDRY_REPLY_API_KEY: fake.AZURE_FOUNDRY_API_KEY,
      AZURE_FOUNDRY_REPLY_MODEL: fake.AZURE_FOUNDRY_DIALOGUE_MODEL,
      AZURE_REPLICA_APP_BUDGET_USD: "1",
      AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: "0.4",
      AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: "1.6",
    };
    assert.equal(runWriter(retired).status, 1);
  });
  check("--stub remains available for offline gates without provider admission", () => {
    const r = runWriter({ CI: "1" }, ["--stub"]);
    assert.equal(r.status, 0);
    assert.ok(r.output.includes("gate use only"));
  });
  check("invalid deploy cannot overwrite an existing generated config", () => {
    const r = runWriter({ ...fake, AZURE_FOUNDRY_API_KEY: "" }, ["--vyakti-deploy"], "// retained\n");
    assert.equal(r.status, 1);
    assert.equal(r.config, "// retained\n");
  });
  check("invalid Azure build stops before Vite", () => {
    const r = runBuild({ ...fake, AZURE_FOUNDRY_API_KEY: "" });
    assert.equal(r.status, 1);
    assert.ok(!r.output.includes("VITE_SENTINEL"));
  });
  check("valid Azure build reaches Vite without stub fallback", () => {
    const r = runBuild(fake);
    assert.equal(r.status, 73);
    assert.ok(r.output.includes("VITE_SENTINEL"));
    assert.ok(!r.output.includes("Building with stub config"));
  });
  check("unconfigured build refuses instead of producing a static preview artifact", () => {
    const r = runBuild({});
    assert.equal(r.status, 1);
    assert.ok(!r.output.includes("VITE_SENTINEL"));
  });
} finally {
  assert.equal(dirname(workspace), resolve(tmpdir()));
  assert.ok(workspace.includes("vyakti-azure-build-"));
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(JSON.stringify({
  at: new Date().toISOString(),
  passed: checks.length,
  checks,
  method: "actual writer and Bash build in isolated temp trees; Vite replaced by sentinel; network blocked; synthetic credentials only",
}, null, 2));
