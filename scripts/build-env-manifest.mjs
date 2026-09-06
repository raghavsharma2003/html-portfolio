// WS-R116. Writes `api/_env-manifest.gen.json` from `docs/gurukul/
// ENV-MANIFEST.md`'s own tables (`scripts/envManifest.mjs`'s parser) —
// `scripts/build-engine-bundle.mjs`'s own "generated file must be fresh"
// precedent, restated for a JSON data file instead of a bundled script.
//
// `api/_self-check.js` reads the COMMITTED JSON at module load, never the
// markdown, never this script, at request time — a Vercel function cannot
// read `docs/` at runtime the way a build-time script can, and re-parsing a
// 1400-line markdown doc on every cron tick would be real, pointless work
// for a table that changes maybe once a workstream. This script is the one
// place the translation from doc to data happens.
//
//   node scripts/build-env-manifest.mjs           # (re)writes the file
//   node scripts/build-env-manifest.mjs --check   # fails if it is stale/missing
//
// Filtered to names whose manifest target list includes `vercel-app` — the
// ONE deployment `api/_self-check.js` itself ever runs inside, so it is the
// only environment a presence check can honestly answer for. A name whose
// every occurrence is a standalone service's own deployment (azure-verifier,
// voice-evidence, ...) is real and documented, but checking it against
// `process.env` from inside the studio Vercel app would always read absent
// regardless of whether that OTHER deployment has it set — a plausible
// return hiding a fact this process cannot know, `AGENTS.md`'s own law,
// which is why this filter exists rather than shipping every one of the
// manifest's 155 names.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnvManifest } from "./envManifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const OUT_PATH = join(ROOT, "api", "_env-manifest.gen.json");

/** Pure: the manifest's already-parsed `{entries}` in, the exact JSON-ready
 *  array out — `target` filter plus a stable sort by name, so the committed
 *  file's diff is small and meaningful when the doc changes one entry. */
export function buildManifestData({ entries }) {
  return entries
    .filter((e) => e.target.includes("vercel-app"))
    .map((e) => ({ name: e.name, section: e.section, sectionTitle: e.sectionTitle, target: e.target, required: e.required }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function serialize(data) {
  return JSON.stringify(data, null, 2) + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  const { entries } = loadEnvManifest();
  const data = buildManifestData({ entries });
  const fresh = serialize(data);

  if (check) {
    if (!existsSync(OUT_PATH)) {
      console.log(`FAIL  build-env-manifest --check: ${OUT_PATH} does not exist — run "node scripts/build-env-manifest.mjs"`);
      process.exit(1);
    }
    const committed = readFileSync(OUT_PATH, "utf8");
    if (committed !== fresh) {
      console.log(`FAIL  build-env-manifest --check: api/_env-manifest.gen.json is stale against docs/gurukul/ENV-MANIFEST.md — run "node scripts/build-env-manifest.mjs" and commit the result`);
      process.exit(1);
    }
    console.log(`  ok    env manifest fresh: ${data.length} vercel-app name(s), matches a fresh parse`);
    process.exit(0);
  }

  writeFileSync(OUT_PATH, fresh);
  console.log(`wrote ${OUT_PATH}: ${data.length} vercel-app name(s) (of ${entries.length} manifest name(s) total)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
