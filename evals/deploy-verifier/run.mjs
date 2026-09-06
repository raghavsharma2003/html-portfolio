#!/usr/bin/env node
// Offline contract for scripts/verify-deploy.mjs.
//
// The fixture deliberately serves an arbitrary environment-specific studio
// chunk name. A correct verifier accepts it because source identity comes from
// the release commitment, then rejects both a stale commitment and the wrong
// product. It also records every request so the old chat/speech probes cannot
// quietly return to the generic clone release gate.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDeploymentRelease } from "../../scripts/deploy-commitment.mjs";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const NODE = process.execPath;
const VERIFY = fileURLToPath(new URL("../../scripts/verify-deploy.mjs", import.meta.url));
const DEPLOY = fileURLToPath(new URL("../../scripts/deploy-vercel.mjs", import.meta.url));
const WRITE_MARKER = fileURLToPath(new URL("../../scripts/write-deploy-marker.mjs", import.meta.url));
const vercelConfig = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
const installSource = readFileSync(new URL("../../scripts/vercel-install.sh", import.meta.url), "utf8");
const buildSource = readFileSync(new URL("../../scripts/vercel-build.sh", import.meta.url), "utf8");
if (vercelConfig.installCommand !== "bash scripts/vercel-install.sh") {
  throw new Error(
    "Vercel must use the guarded install phase that captures source identity before dependency installation",
  );
}
if (!installSource.includes("write-deploy-marker.mjs") || !installSource.includes("npm ci --no-audit --no-fund")) {
  throw new Error("guarded install must accept explicit upload identity before an immutable npm ci install");
}
if (!buildSource.includes('cp "$RELEASE_MARKER" dist/vyakti-release.json')) {
  throw new Error("Vercel build must publish the pre-install marker without recomputing it from a mutable workspace");
}
const release = createDeploymentRelease(ROOT, "vyakti-clone");
const meeraRelease = createDeploymentRelease(ROOT, "meera-companion");
const arbitraryChunk = "assets/studio-environment-specific-fixture.js";
const arbitraryStudioAppChunk = "assets/clone-app-environment-specific-fixture.js";
const arbitraryMeeraChunk = "assets/index-environment-specific-fixture.js";
const landing = `<!doctype html><title>Vyakti | Make your personal AI clone</title><a href="/studio">Open</a>`;
const studio = `<!doctype html><div id="studio-root"></div><script type="module" src="/${arbitraryChunk}"></script>`;
const meeraLanding = `<!doctype html><title>Maya companion</title><a href="/chat">Open</a>`;
const chat = `<!doctype html><div id="root"></div><script type="module" src="/${arbitraryMeeraChunk}"></script>`;
const asset = `export default ${JSON.stringify("x".repeat(2_000))};`;
const studioLoader = `import app from "./${arbitraryStudioAppChunk.split("/").at(-1)}";document.getElementById("studio-root").replaceChildren(app);`;

let mode = "correct";
const requests = [];

const deployPlan = JSON.parse((await run(NODE, [
  DEPLOY,
  "--product",
  "vyakti-clone",
  "--plan",
  "--prod",
  "--yes",
], { cwd: ROOT })).stdout);
if (deployPlan.release.source_commitment !== release.source_commitment) {
  throw new Error("deploy wrapper did not carry the current source commitment");
}
for (const field of ["PRODUCT", "COMMITMENT", "INPUT_FILES", "INPUT_BYTES"]) {
  if (!deployPlan.args.some((arg) => arg.startsWith(`VYAKTI_SOURCE_${field}=`))) {
    throw new Error(`deploy wrapper omitted VYAKTI_SOURCE_${field}`);
  }
}

const markerDirectory = mkdtempSync(join(tmpdir(), "vyakti-deploy-marker-"));
try {
  const markerEnvironment = {
    ...process.env,
    STUDIO_ROOT: "1",
    VERCEL_GIT_COMMIT_REF: "",
    VYAKTI_SOURCE_PRODUCT: release.product,
    VYAKTI_SOURCE_COMMITMENT: release.source_commitment,
    VYAKTI_SOURCE_INPUT_FILES: String(release.input_files),
    VYAKTI_SOURCE_INPUT_BYTES: String(release.input_bytes),
  };
  await run(NODE, [WRITE_MARKER], { cwd: markerDirectory, env: markerEnvironment });
  const writtenMarker = JSON.parse(readFileSync(join(markerDirectory, ".vercel-release-preinstall.json"), "utf8"));
  if (writtenMarker.source_commitment !== release.source_commitment) {
    throw new Error("remote marker writer did not preserve the explicit upload commitment");
  }
  const missingCommitment = { ...markerEnvironment };
  delete missingCommitment.VYAKTI_SOURCE_COMMITMENT;
  let failedClosed = false;
  try {
    await run(NODE, [WRITE_MARKER], { cwd: markerDirectory, env: missingCommitment });
  } catch (error) {
    failedClosed = String(error.stderr || "").includes("deployment source commitment is missing or invalid");
  }
  if (!failedClosed) throw new Error("remote marker writer accepted missing source identity");
} finally {
  rmSync(markerDirectory, { recursive: true, force: true });
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  requests.push(path);
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(mode === "meera" ? meeraLanding : landing);
  }
  if (path === "/studio") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(studio);
  }
  if (path === "/chat") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(chat);
  }
  if (path === `/${arbitraryChunk}`) {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(studioLoader);
  }
  if (path === `/${arbitraryStudioAppChunk}` || path === `/${arbitraryMeeraChunk}`) {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(asset);
  }
  if (path === "/vyakti-release.json") {
    if (mode === "meera") return json(response, 200, meeraRelease);
    if (mode === "stale") return json(response, 200, { ...release, source_commitment: `sha256:${"0".repeat(64)}` });
    if (mode === "wrong-product") return json(response, 200, { ...release, product: "meera-companion" });
    return json(response, 200, release);
  }
  if (["/api/replica", "/api/replica-source", "/api/voice-preview"].includes(path)) {
    return json(response, 401, { error: "bearer_token_required" });
  }
  return json(response, 404, { error: "not_found" });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

async function verify(product, expectSuccess, expectedOutput) {
  try {
    const result = await run(NODE, [VERIFY, base, "--product", product], {
      cwd: ROOT,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!expectSuccess) throw new Error(`negative control unexpectedly passed:\n${result.stdout}`);
    if (!result.stdout.includes(expectedOutput)) throw new Error(`missing verifier output ${JSON.stringify(expectedOutput)}`);
  } catch (error) {
    if (expectSuccess) throw error;
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    if (!output.includes(expectedOutput)) {
      throw new Error(`negative control missed ${JSON.stringify(expectedOutput)}:\n${output}`);
    }
  }
}

try {
  await verify("vyakti-clone", true, "(6/6)");
  mode = "stale";
  await verify("vyakti-clone", false, "stale or wrong project");
  mode = "wrong-product";
  await verify("vyakti-clone", false, "wrong project");
  mode = "meera";
  await verify("meera-companion", true, "(3/3)");

  const forbidden = requests.filter((path) => path === "/api/chat" || path === "/api/speech");
  if (forbidden.length) throw new Error(`generic verifier called legacy provider route(s): ${forbidden.join(", ")}`);
  console.log(
    `deploy verifier ok - 6 Vyakti and 3 companion positive checks, 2 stale/wrong-project negative controls, ` +
    `${requests.length} fixture requests, 0 legacy provider requests`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
