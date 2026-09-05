// WS-R42, "the money reconciles" — law 3. A mirrored constant is a number or
// string this repo keeps in TWO files on purpose (the front end cannot
// import a server module, `src/studio/pulseApi.ts`'s own header names the
// reason: "src/studio never imports from api/, confirmed by grep before
// adding this"). Every mirror this repo has ever built the same way as WS-R35's
// two Pulse constants (a same-line trailing comment, `// mirror of
// api/<file>.js#<NAME>`, right next to the literal it decorates) is a place
// two numbers can silently drift apart — the enrollment sample-rate mirror
// drifted exactly once (AGENTS.md's own cited example) and cost a real
// deploy. This gate finds every marker, reads the literal on both sides, and
// fails the moment they disagree.
//
// ── WHAT COUNTS AS A MIRROR MARKER ──────────────────────────────────────
// A same-line trailing comment `// mirror of api/<relpath>#<NAME>` (relpath
// already carries `.js`, e.g. `api/_org.js`). The marker must share its line
// with the literal it decorates — this is a deliberate, narrow definition:
// it is what makes "parse the literal, never import a server module" (the
// brief's own words) mechanical rather than a best-effort scrape of
// surrounding prose. A `<!-- mirror of ... -->` HTML comment that documents a
// rendered price string (site/suites.html carries a few, ahead of literal
// rupee text in the page body) is NOT a marker this gate parses — there is
// no single JS literal on that line to compare, and inventing a markup-text
// parser for a handful of doc-comments is exactly the kind of "a naive regex
// over whole files is a useless gate here" trap `scripts/check-copy.mjs`'s
// own header already names for a different problem. Those stay
// human-readable documentation; the enforceable copy lives in the same
// file's own JS block, which DOES carry markers this gate reads.
//
// ── WHERE THIS LOOKS ─────────────────────────────────────────────────────
// `src/studio/`, `src/room/`, `src/gurukul/`, `src/replica/`,
// `src/components/`, `site/`, plus the root `studio.html`/`room.html` entry
// points — `scripts/check-copy.mjs`'s own SCOPES list, restated for `.ts`,
// `.tsx`, `.js` and `.html` rather than re-deriving a second file walk. The
// brief's own words ("grep 'mirror' in src/") name `src/`; `site/suites.html`
// is included too because WS-R48 (merged beneath this workstream) built its
// own markers ANTICIPATING this gate by name ("a `// mirror of
// api/_org.js#NAME` marker comment WS-R42's own mirror gate can key on") —
// leaving them unchecked would mean a real, already-shipped mirror pair sits
// outside the one gate built to watch it.
//
// ── SELF-TEST FIRST ──────────────────────────────────────────────────────
// `scripts/check-copy.mjs`'s own law: a gate nobody has watched fail is a
// gate nobody knows is wired. `selfTest()` runs on every invocation, over an
// inline fixture pair that must disagree and one that must not.
import { readFileSync, readdirSync, statSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;

export const SCAN_DIRS = ["src/studio/", "src/room/", "src/gurukul/", "src/replica/", "src/components/", "site/"];
export const SCAN_FILES = ["studio.html", "room.html"];
const EXT = /\.(tsx?|jsx?|html?)$/;

const MARKER = /\/\/\s*mirror of (api\/[\w./-]+)#([A-Za-z_][A-Za-z0-9_]*)\s*$/;
// A literal immediately before the marker on the same line, after any
// trailing `,`/`;`/whitespace is stripped: a number, or a single/double
// quoted string. `var x = 2999,   // mirror of ...` and `export const X =
// 12; // mirror of ...` both land here.
const LITERAL = /(-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\s*[,;]?\s*$/;

function parseLiteral(text) {
  const m = LITERAL.exec(text.trim());
  if (!m) return { ok: false };
  const raw = m[1];
  if (/^["']/.test(raw)) return { ok: true, kind: "string", value: raw.slice(1, -1) };
  return { ok: true, kind: "number", value: Number(raw) };
}

/** Every same-line `// mirror of ...` marker in `src`, as `{file, line,
 *  lineNo, target, name, literal}`. Pure: takes source text in, never reads
 *  a file itself — so a fixture string drives this exactly like a real file
 *  does. */
export function findMarkers(file, src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = MARKER.exec(line);
    if (!m) continue;
    const [, target, name] = m;
    const before = line.slice(0, m.index);
    const literal = parseLiteral(before);
    out.push({ file, lineNo: i + 1, line, target, name, literal });
  }
  return out;
}

/** The named `export const NAME = <literal>` in an api file's own source —
 *  the ONE place this gate reads a server file, and only to parse a literal
 *  off it, never to import it (the front end structurally cannot, and this
 *  gate holds itself to the same rule so a future refactor cannot make it
 *  true by accident and false by drift). */
export function findExportedConst(apiSrc, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?|"[^"]*"|'[^']*')`);
  const m = re.exec(apiSrc);
  if (!m) return { ok: false };
  const raw = m[1];
  if (/^["']/.test(raw)) return { ok: true, kind: "string", value: raw.slice(1, -1) };
  return { ok: true, kind: "number", value: Number(raw) };
}

/** Pure: `frontendFiles` is `{path: source}` for every scanned file,
 *  `apiFiles` is `{path: source}` for every api file a marker names.
 *  Returns `{markers, mismatches}` — `mismatches` is empty on a clean tree. */
export function checkMirrors(frontendFiles, apiFiles) {
  const markers = [];
  const mismatches = [];
  for (const [file, src] of Object.entries(frontendFiles)) {
    for (const marker of findMarkers(file, src)) {
      markers.push(marker);
      if (!marker.literal.ok) {
        mismatches.push({ ...marker, reason: "no literal found on the marker's own line" });
        continue;
      }
      const apiSrc = apiFiles[marker.target];
      if (apiSrc == null) {
        mismatches.push({ ...marker, reason: `target file not found: ${marker.target}` });
        continue;
      }
      const canonical = findExportedConst(apiSrc, marker.name);
      if (!canonical.ok) {
        mismatches.push({ ...marker, reason: `export const ${marker.name} not found in ${marker.target}` });
        continue;
      }
      if (canonical.kind !== marker.literal.kind || canonical.value !== marker.literal.value) {
        mismatches.push({
          ...marker,
          reason: `mirror disagrees: ${marker.file}:${marker.lineNo} has ${JSON.stringify(marker.literal.value)}, ` +
            `${marker.target}#${marker.name} is ${JSON.stringify(canonical.value)}`,
        });
      }
    }
  }
  return { markers, mismatches };
}

function walk(dir, acc = []) {
  for (const e of readdirSync(ROOT + dir)) {
    const rel = dir + e;
    if (statSync(ROOT + rel).isDirectory()) { walk(rel + "/", acc); continue; }
    if (!EXT.test(e)) continue;
    acc.push(rel);
  }
  return acc;
}

function selfTest() {
  const problems = [];
  // A mismatched pair must be caught.
  {
    const front = { "fixture/front.ts": 'export const N = 12; // mirror of api/fixture.js#N\n' };
    const api = { "api/fixture.js": "export const N = 13;\n" };
    const { mismatches } = checkMirrors(front, api);
    if (mismatches.length !== 1) problems.push("self-test: a one-off mismatch was not caught");
  }
  // A string mirror that disagrees must be caught too, not only numbers.
  {
    const front = { "fixture/front.ts": 'export const NAME = "room"; // mirror of api/fixture.js#NAME\n' };
    const api = { "api/fixture.js": 'export const NAME = "studio";\n' };
    const { mismatches } = checkMirrors(front, api);
    if (mismatches.length !== 1) problems.push("self-test: a string mismatch was not caught");
  }
  // A clean, matching pair must NOT be flagged (the false-positive control).
  {
    const front = { "fixture/front.ts": 'export const N = 12; // mirror of api/fixture.js#N\n' };
    const api = { "api/fixture.js": "export const N = 12;\n" };
    const { mismatches } = checkMirrors(front, api);
    if (mismatches.length !== 0) problems.push("self-test: a clean pair was flagged (false positive)");
  }
  // A trailing-comma shape (an object literal field) must parse.
  {
    const front = { "fixture/front.ts": "  starter: 2999,   // mirror of api/fixture.js#STARTER\n" };
    const api = { "api/fixture.js": "export const STARTER = 2999;\n" };
    const { mismatches } = checkMirrors(front, api);
    if (mismatches.length !== 0) problems.push("self-test: the object-literal comma shape did not parse clean");
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dead = selfTest();
  if (dead.length) {
    console.log(`FAIL  check-mirrors self-test: the gate is not biting (${dead.length}):`);
    for (const d of dead) console.log("  " + d);
    process.exit(1);
  }

  const frontendFiles = {};
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) frontendFiles[rel] = readFileSync(ROOT + rel, "utf8");
  }
  for (const rel of SCAN_FILES) frontendFiles[rel] = readFileSync(ROOT + rel, "utf8");

  const { markers, mismatches } = checkMirrors(frontendFiles, new Proxy({}, {
    get: (_t, prop) => {
      if (typeof prop !== "string") return undefined;
      try {
        return readFileSync(ROOT + prop, "utf8");
      } catch {
        return undefined;
      }
    },
  }));

  if (mismatches.length) {
    console.log(`FAIL  check-mirrors: ${mismatches.length} of ${markers.length} marker(s) disagree:`);
    for (const m of mismatches) console.log(`  ${m.file}:${m.lineNo}  ${m.reason}`);
    process.exit(1);
  }
  console.log(`  ok    mirrored constants: ${markers.length} marker(s) checked across ${Object.keys(frontendFiles).length} file(s), 0 disagree`);
  process.exit(0);
}
