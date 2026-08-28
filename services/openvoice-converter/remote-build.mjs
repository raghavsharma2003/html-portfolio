#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOCKERFILE = "services/openvoice-converter/Dockerfile";
const TASK_FILE = "services/openvoice-converter/acr-task.yaml";

export const RUNTIME_COPY_FILES = Object.freeze([
  "services/openvoice-converter/requirements.txt",
  "services/openvoice-converter/fetch_models.py",
  "services/openvoice-converter/contract.py",
  "services/openvoice-converter/app.py",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function dockerCopyFiles(root = ROOT) {
  const dockerfile = readFileSync(resolve(root, DOCKERFILE), "utf8");
  return [...dockerfile.matchAll(/^COPY\s+(services\/openvoice-converter\/[^\s]+)\s+/gm)]
    .map((match) => match[1]);
}

export function createSourceManifest(root = ROOT) {
  const copied = dockerCopyFiles(root);
  if (JSON.stringify(copied) !== JSON.stringify(RUNTIME_COPY_FILES)) {
    fail("openvoice_remote_build_copy_set_drift");
  }
  const manifest = {
    contract: "vyakti-openvoice-runtime-copy-manifest/v1",
    files: RUNTIME_COPY_FILES.map((path) => {
      const bytes = readFileSync(resolve(root, path));
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
  const bytes = Buffer.from(canonical(manifest));
  return Object.freeze({ manifest: Object.freeze(manifest), bytes, sha256: sha256(bytes) });
}

export function buildAcrArguments({ registry, sourceManifestSha256 }) {
  if (!/^[a-z0-9]{5,50}$/i.test(String(registry || ""))) {
    fail("openvoice_remote_build_registry_required");
  }
  if (!/^[0-9a-f]{64}$/.test(String(sourceManifestSha256 || ""))) {
    fail("openvoice_remote_build_source_manifest_required");
  }
  return Object.freeze([
    "acr", "run",
    "--registry", registry,
    "--file", TASK_FILE,
    "--set", `SOURCE_MANIFEST_SHA256=${sourceManifestSha256}`,
    ".",
  ]);
}

function regularFile(path) {
  try { return existsSync(path) && statSync(path).isFile(); }
  catch { return false; }
}

function windowsPathLookup(command, env) {
  const raw = String(command || "");
  if (!raw || /[\0\r\n"]/.test(raw)) fail("openvoice_remote_build_azure_cli_invalid");
  const extension = extname(raw).toLowerCase();
  const names = extension ? [raw] : [`${raw}.cmd`, `${raw}.exe`];
  if (isAbsolute(raw) || /[\\/]/.test(raw)) {
    for (const name of names) {
      const path = resolve(name);
      if (regularFile(path)) return path;
    }
    return "";
  }
  const entries = String(env.Path || env.PATH || "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  for (const directory of entries) {
    for (const name of names) {
      const path = join(directory, name);
      if (regularFile(path)) return resolve(path);
    }
  }
  return "";
}

export function resolveAzureCli({
  requested = "",
  env = process.env,
  platform = process.platform,
} = {}) {
  const override = String(requested || env.VYAKTI_AZURE_CLI || "").trim();
  if (platform !== "win32") return override || "az";
  const executable = windowsPathLookup(override || "az", env);
  if (!executable || !/\.(?:cmd|exe)$/i.test(executable)) {
    fail("openvoice_remote_build_azure_cli_not_found");
  }
  return executable;
}

export function quoteWindowsCommandArgument(value) {
  const text = String(value);
  if (!text || /[\0\r\n"%!&|<>^]/.test(text)) {
    fail("openvoice_remote_build_windows_argument_invalid");
  }
  return `"${text}"`;
}

export function spawnAzureCli({
  executable,
  args,
  cwd = ROOT,
  env = process.env,
  platform = process.platform,
  stdio = "inherit",
  spawn = spawnSync,
}) {
  if (!Array.isArray(args) || !args.length) fail("openvoice_remote_build_arguments_required");
  if (platform !== "win32") {
    return spawn(executable || "az", args, { cwd, env, stdio, shell: false });
  }
  const cli = resolveAzureCli({ requested: executable, env, platform });
  if (/\.exe$/i.test(cli)) return spawn(cli, args, { cwd, env, stdio, shell: false });
  const comspec = resolve(String(env.ComSpec || ""));
  if (!regularFile(comspec) || !/\.exe$/i.test(comspec)) {
    fail("openvoice_remote_build_comspec_required");
  }
  const command = `call ${[cli, ...args].map(quoteWindowsCommandArgument).join(" ")}`;
  return spawn(comspec, ["/d", "/q", "/v:off", "/s", "/c", command], {
    cwd,
    env,
    stdio,
    shell: false,
    windowsVerbatimArguments: true,
  });
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

export function createBuildPlan({ registry, root = ROOT }) {
  const source = createSourceManifest(root);
  const azureArguments = buildAcrArguments({ registry, sourceManifestSha256: source.sha256 });
  return Object.freeze({
    contract: "vyakti-openvoice-remote-build-plan/v1",
    registry,
    taskFile: TASK_FILE,
    context: ".",
    sourceManifest: source.manifest,
    sourceManifestSha256: source.sha256,
    azureExecutable: "az",
    azureArguments,
    localDockerInvoked: false,
  });
}

function main() {
  const mode = process.argv[2];
  if (mode !== "plan" && mode !== "run") fail("usage: remote-build.mjs plan|run --registry <acr-name>");
  const plan = createBuildPlan({ registry: option("--registry") });
  if (mode === "plan") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const executable = resolveAzureCli({ requested: option("--az") });
  const result = spawnAzureCli({ executable, args: plan.azureArguments });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`openvoice_remote_build_failed_${result.status}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
