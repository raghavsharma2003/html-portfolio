// api/_env-manifest.js — WS-R116. The generated env-manifest data
// (`api/_env-manifest.gen.json`, `scripts/build-env-manifest.mjs`), loaded
// once at module scope and shaped into the two things a caller actually
// needs: a name -> entry lookup, and a "group these absent names by
// manifest section" reducer.
//
// DELIBERATELY A LEAF. `api/_self-check.js` and `api/_ops.js` both need
// this (self-check to WIDEN `envPresence`, ops to GROUP `optional_absent`
// for the board) and neither may import the other for it —
// `context/rejected.md#ops-importing-self-check-closed-a-load-order-cycle-
// on-the-incident-kinds`'s own law, restated: a module-scope read across an
// import cycle is a crash that only some entry points see. This file
// imports NOTHING from `api/`, so it cannot be part of any cycle either of
// those two files are already in — both import it directly.
//
// Reads the COMMITTED JSON via `readFileSync`, never `import ... assert
// {type:"json"}` — `api/_drift-watch.js`'s own `readFileSync` + `JSON.parse`
// precedent for a generated/logged JSON file, avoiding any Node-version
// dependence on import-assertion syntax this repo's two runtimes (Node 22
// locally, Node 24 on Vercel, `ws-common.md`'s own note) might disagree on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN_PATH = join(HERE, "_env-manifest.gen.json");

/** `[{name, section, sectionTitle, target, required}]`, every manifest
 *  name whose target list includes `vercel-app` — the ONE deployment this
 *  process ever runs inside, `scripts/build-env-manifest.mjs`'s own filter.
 *  Frozen so nothing downstream can mutate the shared array by accident. */
export const ENV_MANIFEST_ENTRIES = Object.freeze(JSON.parse(readFileSync(GEN_PATH, "utf8")));

export const ENV_MANIFEST_BY_NAME = new Map(ENV_MANIFEST_ENTRIES.map((e) => [e.name, e]));

/** Natural sort for a manifest section id ("1", "10b", "15c", "25", ...):
 *  numeric prefix first, then any trailing letter suffix — so "2" sorts
 *  before "10b" the way a human reading the doc's own numbering would
 *  expect, not the way a plain string sort ("10b" < "2") would produce. */
function sectionSortKey(id) {
  const m = /^(\d+)([a-z]*)$/.exec(String(id));
  if (!m) return [Number.MAX_SAFE_INTEGER, String(id)];
  return [Number(m[1]), m[2]];
}
function compareSectionKeys(a, b) {
  const [an, as] = sectionSortKey(a);
  const [bn, bs] = sectionSortKey(b);
  if (an !== bn) return an - bn;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * Groups a list of absent-by-name entries (`runSelfCheck`'s own
 * `optional_absent`, or `api/_ops.js`'s own today's-doors read of the
 * SAME shape) by the manifest section that documents each name.
 *
 * Returns `{sections, ungrouped}`:
 *   - `sections`: one entry per manifest section that has at least one
 *     absent name here, `{section, sectionTitle, names}`, `names` sorted,
 *     sections themselves sorted by `compareSectionKeys` (reading order).
 *   - `ungrouped`: every absent name this file's own manifest does not
 *     know — the pre-Rooms `write-config.mjs` mirror
 *     (`REQUIRED_ENV`/`OPTIONAL_ENV`, unchanged, WS-R116 law 2) has no
 *     manifest section of its own, so its names land here rather than
 *     being silently dropped or force-fit into a section that does not
 *     describe them. Sorted.
 *
 * Pure — takes the name list in, reads only the frozen module-scope map,
 * never a db or an env — so `evals/env-manifest/run.mjs` can drive every
 * branch with a fixture list, no network, no file write.
 */
export function groupAbsentBySection(names) {
  const bySection = new Map();
  const ungrouped = [];
  for (const name of Array.isArray(names) ? names : []) {
    const entry = ENV_MANIFEST_BY_NAME.get(name);
    if (!entry) {
      ungrouped.push(name);
      continue;
    }
    if (!bySection.has(entry.section)) {
      bySection.set(entry.section, { section: entry.section, sectionTitle: entry.sectionTitle, names: [] });
    }
    bySection.get(entry.section).names.push(name);
  }
  const sections = [...bySection.values()].sort((a, b) => compareSectionKeys(a.section, b.section));
  for (const s of sections) s.names.sort();
  ungrouped.sort();
  return { sections, ungrouped };
}
