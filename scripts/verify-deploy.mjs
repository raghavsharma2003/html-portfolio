#!/usr/bin/env node
// Assert that production is serving the release in this checkout.
//
// A Vercel deployment can be READY while an old alias, a wrong project, or a
// broken serverless bundle is still what users reach. The source commitment is
// the stale/wrong-project fence. Product-specific HTML and unauthenticated API
// boundary probes then verify the generic clone surface without spending GPU or
// depending on the separate companion chat/speech providers.

import { fileURLToPath } from "node:url";
import { createDeploymentRelease, DEPLOY_PRODUCTS } from "./deploy-commitment.mjs";

const argv = process.argv.slice(2);
const valueAfter = (name) => {
  const exact = argv.indexOf(name);
  if (exact >= 0) return argv[exact + 1];
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || null;
};
const positionalBase = argv.find((arg) => /^https?:\/\//i.test(arg));
const BASE = (positionalBase || "https://vyakti-replica-lab.vercel.app").replace(/\/$/, "");
const PRODUCT = valueAfter("--product") || (BASE.includes("meera-silk") ? "meera-companion" : "vyakti-clone");
const TIMEOUT = 45_000;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

if (!DEPLOY_PRODUCTS.includes(PRODUCT)) {
  console.error(`unknown --product ${JSON.stringify(PRODUCT)}; expected ${DEPLOY_PRODUCTS.join(" or ")}`);
  process.exit(2);
}

const expectedRelease = createDeploymentRelease(ROOT, PRODUCT);
const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const get = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init,
  cache: "no-store",
  headers: { "Cache-Control": "no-cache", ...(init.headers || {}) },
  signal: AbortSignal.timeout(TIMEOUT),
});

function assertIncludes(text, marker, label) {
  if (!text.includes(marker)) throw new Error(`missing ${label}`);
}

check("source commitment matches checkout", async () => {
  const cacheBust = expectedRelease.source_commitment.slice(-16);
  const response = await get(`/vyakti-release.json?release=${cacheBust}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const actual = await response.json().catch(() => null);
  if (!actual || actual.schema !== expectedRelease.schema) {
    throw new Error(`release marker schema mismatch (wanted ${expectedRelease.schema})`);
  }
  if (actual.product !== PRODUCT) {
    throw new Error(`live product is ${JSON.stringify(actual.product)}, expected ${JSON.stringify(PRODUCT)} - wrong project`);
  }
  if (actual.source_commitment !== expectedRelease.source_commitment) {
    throw new Error(
      `live commitment ${String(actual.source_commitment || "missing")} does not match ` +
      `${expectedRelease.source_commitment} - stale or wrong project`,
    );
  }
  return `${actual.source_commitment.slice(0, 23)}... (${actual.input_files} inputs)`;
});

check("landing identifies selected product", async () => {
  const response = await get("/");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (PRODUCT === "vyakti-clone") {
    assertIncludes(html, "<title>Vyakti | Make your personal AI clone</title>", "Vyakti landing title");
    assertIncludes(html, 'href="/studio"', "studio entry link");
  } else {
    assertIncludes(html, "<title>Maya", "Maya landing title");
    assertIncludes(html, 'href="/chat"', "chat entry link");
  }
  return `${response.status} ${PRODUCT}`;
});

check("product app shell and entry asset respond", async () => {
  const route = PRODUCT === "vyakti-clone" ? "/studio" : "/chat";
  const response = await get(route);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const marker = PRODUCT === "vyakti-clone" ? '<div id="studio-root"></div>' : '<div id="root"></div>';
  const entryPattern = PRODUCT === "vyakti-clone"
    ? /(?:src=["'])\/?(assets\/studio-[A-Za-z0-9_-]+\.js)(?:["'])/
    : /(?:src=["'])\/?(assets\/index-[A-Za-z0-9_-]+\.js)(?:["'])/;
  assertIncludes(html, marker, "app mount point");
  const entry = html.match(entryPattern)?.[1];
  if (!entry) throw new Error("no product entry asset referenced");
  const asset = await get(`/${entry}`);
  if (!asset.ok) throw new Error(`entry asset HTTP ${asset.status}`);
  const entrySource = await asset.text();
  const entryBytes = Buffer.byteLength(entrySource);
  let loadedBytes = entryBytes;

  // Rolldown may emit a deliberately tiny HTML entry that imports the real
  // application chunk. Rejecting that loader by size produced a false red on
  // the real Studio release. Follow only its static, same-directory JS
  // imports and require the reachable bootstrap graph to contain real code;
  // no module is executed and no third-party URL is followed.
  if (entryBytes < 1_000) {
    if (PRODUCT === "vyakti-clone" && !entrySource.includes("studio-root")) {
      throw new Error(`small Studio loader does not bind studio-root (${entryBytes} bytes)`);
    }
    const imports = [...entrySource.matchAll(/(?:from|import)\s*["'](\.\/[A-Za-z0-9_.-]+\.js)["']/g)]
      .map((match) => match[1]);
    if (!imports.length) throw new Error(`entry asset is only ${entryBytes} bytes and imports no local JS`);
    for (const reference of [...new Set(imports)]) {
      const dependencyPath = new URL(reference, `https://release.invalid/${entry}`).pathname;
      const dependency = await get(dependencyPath);
      if (!dependency.ok) throw new Error(`entry dependency ${dependencyPath} HTTP ${dependency.status}`);
      loadedBytes += (await dependency.arrayBuffer()).byteLength;
    }
  }
  if (loadedBytes < 1_000) throw new Error(`entry bootstrap graph is only ${loadedBytes} bytes`);
  return `${route} -> ${entry} (${entryBytes} entry bytes; ${loadedBytes} bootstrap bytes)`;
});

if (PRODUCT === "vyakti-clone") {
  const protectedBoundary = (name, path, method) => check(name, async () => {
    const response = await get(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== 401 || body.error !== "bearer_token_required") {
      throw new Error(`expected 401 bearer_token_required, got HTTP ${response.status} ${String(body.error || "no error code")}`);
    }
    return "401 owner authentication enforced";
  });

  // These are zero-cost boundary probes. They prove that the lifecycle,
  // private-upload and synthesis functions were deployed and can import their
  // generated config, without creating a clone, touching storage, or waking a
  // GPU. A missing function is 404; a missing/broken config is 500.
  protectedBoundary("clone lifecycle API is deployed", "/api/replica", "GET");
  protectedBoundary("private upload API is deployed", "/api/replica-source", "POST");
  protectedBoundary("voice preview API is deployed", "/api/voice-preview", "POST");
}

let failed = 0;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`  ok    ${name.padEnd(43)} ${detail}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name.padEnd(43)} ${error.message}`);
  }
}

console.log(
  failed
    ? `\n${failed} of ${checks.length} checks failed against ${BASE}`
    : `\n${PRODUCT} production is serving this checkout (${checks.length}/${checks.length})`,
);
// Let Undici close its sockets naturally. A forced process.exit() after the
// final fetch can trip Node's Windows libuv closing-handle assertion even
// after every check printed green, turning a correct release into a false red.
process.exitCode = failed ? 1 : 0;
