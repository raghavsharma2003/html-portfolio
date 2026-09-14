#!/usr/bin/env node
// Offline contract for the one-product Vercel build and deploy verifier.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDeploymentRelease, DEPLOY_PRODUCTS } from "../../scripts/deploy-commitment.mjs";
import { vercelProduct } from "../../scripts/vercel-product.mjs";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const NODE = process.execPath;
const VERIFY = fileURLToPath(new URL("../../scripts/verify-deploy.mjs", import.meta.url));
const DEPLOY = fileURLToPath(new URL("../../scripts/deploy-vercel.mjs", import.meta.url));
const WRITE_MARKER = fileURLToPath(new URL("../../scripts/write-deploy-marker.mjs", import.meta.url));
const vercelConfig = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
const installSource = readFileSync(new URL("../../scripts/vercel-install.sh", import.meta.url), "utf8");
const buildSource = readFileSync(new URL("../../scripts/vercel-build.sh", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../../.github/workflows/deploy-web.yml", import.meta.url), "utf8");

function assertGatedDeployment(config, workflow) {
  if (config.git?.deploymentEnabled !== false) {
    throw new Error("Vercel Git deployments must stay disabled for every branch");
  }
  for (const required of [
    "workflow_dispatch:",
    "node scripts/verify-release.mjs",
    "node scripts/deploy-vercel.mjs --product vyakti-clone --prod --yes --archive=tgz",
  ]) {
    if (!workflow.includes(required)) {
      throw new Error(`manual gated deploy workflow lost ${required}`);
    }
  }
}

assertGatedDeployment(vercelConfig, workflowSource);
let automaticGitDeployCaught = false;
try {
  assertGatedDeployment({ ...vercelConfig, git: { deploymentEnabled: true } }, workflowSource);
} catch (error) {
  automaticGitDeployCaught = String(error.message).includes("Vercel Git deployments must stay disabled");
}
if (!automaticGitDeployCaught) throw new Error("automatic Git deployment negative control was not detected");
let missingManualDeployCaught = false;
try {
  assertGatedDeployment(
    vercelConfig,
    workflowSource.replace("node scripts/deploy-vercel.mjs --product vyakti-clone --prod --yes --archive=tgz", "echo deploy removed"),
  );
} catch (error) {
  missingManualDeployCaught = String(error.message).includes("manual gated deploy workflow lost");
}
if (!missingManualDeployCaught) throw new Error("missing manual deployment negative control was not detected");

if (DEPLOY_PRODUCTS.length !== 1 || DEPLOY_PRODUCTS[0] !== "vyakti-clone") {
  throw new Error(`deployment products must be exactly Vyakti, got ${DEPLOY_PRODUCTS.join(", ")}`);
}
for (const environment of [{}, { STUDIO_ROOT: "1" }, { VERCEL_GIT_COMMIT_REF: "main" }]) {
  if (vercelProduct(environment) !== "vyakti-clone") throw new Error("environment changed the one-product selector");
}
if (vercelConfig.installCommand !== "bash scripts/vercel-install.sh") {
  throw new Error("Vercel must use the guarded install phase");
}
if (!installSource.includes("write-deploy-marker.mjs") || !installSource.includes("npm ci --no-audit --no-fund")) {
  throw new Error("guarded install must accept upload identity before npm ci");
}
if (!buildSource.includes('cp "$RELEASE_MARKER" dist/vyakti-release.json')) {
  throw new Error("Vercel build must publish the source marker");
}
if (!buildSource.includes("cp site/vyakti.html dist/index.html") || buildSource.includes("dist/chat.html") || buildSource.includes("STUDIO_ROOT")) {
  throw new Error("Vercel build must serve Vyakti at root without a chat artifact or project split");
}
if (vercelConfig.rewrites.some(({ source, destination }) => source === "/chat" || destination === "/chat.html")) {
  throw new Error("vercel.json still exposes the removed chat surface");
}
const apiHeaders = vercelConfig.headers.find(({ source }) => source === "/api/(.*)")?.headers || [];
if (!apiHeaders.some(({ key, value }) => key === "Cache-Control" && value === "no-store") ||
    !apiHeaders.some(({ key, value }) => key === "X-Content-Type-Options" && value === "nosniff")) {
  throw new Error("the shared API no-store/nosniff headers were weakened");
}
const REQUIRED_CRONS = [
  "/api/consolidate-sweep", "/api/replica-erasure-sweep", "/api/replica-liveness-sweep",
  "/api/replica-identity-sweep", "/api/replica-face-session-sweep", "/api/replica-voice-identity-sweep",
  "/api/replica-model-build-sweep", "/api/channel-ingest-sweep", "/api/drift-watch-sweep",
  "/api/checkins-sweep", "/api/pulse-sweep", "/api/renewals-sweep", "/api/creator-push-sweep",
  "/api/self-check", "/api/operator-digest-sweep", "/api/receipt-sweep", "/api/org-weekly-note-sweep",
  "/api/room-month-note-sweep", "/api/replica-pipeline-watchdog", "/api/voice-preview-result-cleanup",
  "/api/expression-observation-sweep", "/api/replica-claim-sweep", "/api/text-publication-expire",
];
const actualCrons = vercelConfig.crons.map(({ path }) => path);
if (JSON.stringify(actualCrons) !== JSON.stringify(REQUIRED_CRONS)) {
  throw new Error(`cron contract drifted: expected ${REQUIRED_CRONS.length}, got ${actualCrons.length}`);
}
for (const forbidden of ["meera-silk", "meera-companion", "STUDIO_ROOT", "--product meera"]) {
  if (workflowSource.includes(forbidden)) throw new Error(`deploy workflow still contains ${forbidden}`);
}

const release = createDeploymentRelease(ROOT, "vyakti-clone");
const arbitraryChunk = "assets/studio-environment-specific-fixture.js";
const arbitraryStudioAppChunk = "assets/vyakti-app-environment-specific-fixture.js";
const landing = '<!doctype html><title>Vyakti</title><a href="/studio">Open</a>';
const studio = `<!doctype html><div id="studio-root"></div><script type="module" src="/${arbitraryChunk}"></script>`;
const asset = `export default ${JSON.stringify("x".repeat(2_000))};`;
const studioLoader = `import app from "./${arbitraryStudioAppChunk.split("/").at(-1)}";document.getElementById("studio-root").replaceChildren(app);`;

const deployPlan = JSON.parse((await run(NODE, [
  DEPLOY, "--product", "vyakti-clone", "--plan", "--prod", "--yes",
], { cwd: ROOT })).stdout);
if (deployPlan.release.source_commitment !== release.source_commitment) {
  throw new Error("deploy wrapper did not carry the current source commitment");
}
for (const field of ["PRODUCT", "COMMITMENT", "INPUT_FILES", "INPUT_BYTES"]) {
  if (!deployPlan.args.some((arg) => arg.startsWith(`VYAKTI_SOURCE_${field}=`))) {
    throw new Error(`deploy wrapper omitted VYAKTI_SOURCE_${field}`);
  }
}
let oldProductRefused = false;
try {
  await run(NODE, [DEPLOY, "--product", "meera-companion", "--plan"], { cwd: ROOT });
} catch (error) {
  oldProductRefused = String(error.stderr || "").includes("--product must be one of: vyakti-clone");
}
if (!oldProductRefused) throw new Error("deploy wrapper accepted the removed companion product");

const markerDirectory = mkdtempSync(join(tmpdir(), "vyakti-deploy-marker-"));
try {
  const markerEnvironment = {
    ...process.env,
    VYAKTI_SOURCE_PRODUCT: release.product,
    VYAKTI_SOURCE_COMMITMENT: release.source_commitment,
    VYAKTI_SOURCE_INPUT_FILES: String(release.input_files),
    VYAKTI_SOURCE_INPUT_BYTES: String(release.input_bytes),
  };
  await run(NODE, [WRITE_MARKER], { cwd: markerDirectory, env: markerEnvironment });
  const written = JSON.parse(readFileSync(join(markerDirectory, ".vercel-release-preinstall.json"), "utf8"));
  if (written.source_commitment !== release.source_commitment) throw new Error("marker lost upload commitment");
  const missing = { ...markerEnvironment };
  delete missing.VYAKTI_SOURCE_COMMITMENT;
  let failedClosed = false;
  try {
    await run(NODE, [WRITE_MARKER], { cwd: markerDirectory, env: missing });
  } catch (error) {
    failedClosed = String(error.stderr || "").includes("deployment source commitment is missing or invalid");
  }
  if (!failedClosed) throw new Error("marker accepted missing source identity");
} finally {
  rmSync(markerDirectory, { recursive: true, force: true });
}

let mode = "correct";
const requests = [];
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  requests.push(path);
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(landing);
  }
  if (path === "/studio") {
    response.writeHead(200, { "Content-Type": "text/html" });
    return response.end(studio);
  }
  if (path === `/${arbitraryChunk}`) {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(studioLoader);
  }
  if (path === `/${arbitraryStudioAppChunk}`) {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    return response.end(asset);
  }
  if (path === "/vyakti-release.json") {
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
const base = `http://127.0.0.1:${server.address().port}`;

async function verify(expectSuccess, expectedOutput) {
  try {
    const result = await run(NODE, [VERIFY, base, "--product", "vyakti-clone"], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
    if (!expectSuccess) throw new Error(`negative control unexpectedly passed:\n${result.stdout}`);
    if (!result.stdout.includes(expectedOutput)) throw new Error(`missing verifier output ${JSON.stringify(expectedOutput)}`);
  } catch (error) {
    if (expectSuccess) throw error;
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    if (!output.includes(expectedOutput)) throw new Error(`negative control missed ${JSON.stringify(expectedOutput)}:\n${output}`);
  }
}

try {
  await verify(true, "(6/6)");
  mode = "stale";
  await verify(false, "stale or wrong project");
  mode = "wrong-product";
  await verify(false, "wrong project");
  const forbidden = requests.filter((path) => ["/chat", "/api/chat", "/api/speech"].includes(path));
  if (forbidden.length) throw new Error(`verifier called removed route(s): ${forbidden.join(", ")}`);
  console.log(
    `deploy verifier ok - 6 Vyakti checks, 2 stale/wrong-project controls, 2 Git/manual-deploy controls, ${REQUIRED_CRONS.length} crons, ` +
    `${requests.length} fixture requests, 0 removed-route requests`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
