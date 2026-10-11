#!/usr/bin/env node
// Deploy through one source-identity boundary.
//
// Raw `vercel deploy` is intentionally insufficient: the remote build
// workspace is mutable before install hooks run. This wrapper commits the
// local upload bytes and carries that non-secret identity as deployment-scoped
// build metadata. The remote install fails closed when any field is absent.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeploymentRelease, DEPLOY_PRODUCTS } from "./deploy-commitment.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const product = valueAfter("--product");
const planOnly = args.includes("--plan");

if (!DEPLOY_PRODUCTS.includes(product)) {
  throw new Error(`--product must be one of: ${DEPLOY_PRODUCTS.join(", ")}`);
}

const forwarded = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--product") {
    index += 1;
    continue;
  }
  if (arg === "--plan") continue;
  if (/VYAKTI_SOURCE_(?:PRODUCT|COMMITMENT|INPUT_FILES|INPUT_BYTES)/.test(arg)) {
    throw new Error("reserved source-identity build metadata cannot be supplied by the caller");
  }
  if (!/^[A-Za-z0-9._:/=@+,-]+$/.test(arg)) {
    throw new Error(`unsafe or unsupported Vercel argument ${JSON.stringify(arg)}`);
  }
  forwarded.push(arg);
}

const release = createDeploymentRelease(ROOT, product);
const buildMetadata = [
  `VYAKTI_SOURCE_PRODUCT=${release.product}`,
  `VYAKTI_SOURCE_COMMITMENT=${release.source_commitment}`,
  `VYAKTI_SOURCE_INPUT_FILES=${release.input_files}`,
  `VYAKTI_SOURCE_INPUT_BYTES=${release.input_bytes}`,
];
const vercelArgs = ["--yes", "vercel@latest", "deploy", ...forwarded];
for (const value of buildMetadata) vercelArgs.push("--build-env", value);

if (planOnly) {
  console.log(JSON.stringify({ release, command: "npx", args: vercelArgs }, null, 2));
  process.exit(0);
}

let result;
if (process.platform === "win32") {
  const commandLine = ["npx", ...vercelArgs].join(" ");
  result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
} else {
  result = spawnSync("npx", vercelArgs, { cwd: ROOT, stdio: "inherit", shell: false });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
