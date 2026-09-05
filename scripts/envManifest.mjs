// WS-R116. `docs/gurukul/ENV-MANIFEST.md`'s own tables, parsed — never
// retyped into a second hand-maintained list. `scripts/dayOneRunbook.mjs`'s
// own precedent, restated for the manifest instead of the runbook: the
// table lives inside a markdown doc a human edits in prose, and every
// hand-typed mirror of it (`api/_self-check.js`'s old `OPTIONAL_ENV`, which
// only ever mirrored `scripts/write-config.mjs`'s pre-Rooms surface) drifted
// the moment a new subsystem's env vars were documented here and nowhere
// else — `context/rejected.md#ws-r96-self-check-optional-env-never-becomes-
// a-finding` and `context/decisions.md#ws-r102-no-day-one-row-converts-
// from-manual` both name the same gap from two different angles. This file
// is the one parser both a build script and an eval can share.
//
// ── WHAT COUNTS AS AN ENV-VAR TABLE ──────────────────────────────────────
// 36 of the manifest's tables (checked by hand, 2026-09-05) are env-var
// tables, in one of TWO literal five-column header shapes — `ENV_TABLE_
// HEADERS` below names both and why there are two, matched case-
// insensitively. This is deliberately narrower than "any markdown table" —
// the manifest also carries citation tables (§28-29, `| mark | status |
// citation |`) and a two-column cron-consumer table (§25) that are not
// env-var rows at all, and a naive "every `| \`X\` |` row" scan would
// swallow both. Matching a header's text exactly is what makes "which
// tables are env-var tables" mechanical rather than a judgment call this
// parser would have to keep making by hand as the doc grows.
//
// ── SECTIONS AND TARGETS ─────────────────────────────────────────────────
// A `## N. Title (\`target\` [+ \`target\`], ...)` heading opens a section;
// every env-var table until the next heading belongs to it. `KNOWN_TARGETS`
// below is the manifest's own closed vocabulary (its header's own "six
// deployment targets" plus `web build`, the one WS-R2 introduced for a
// Vite-baked flag) — a backtick-quoted token in the heading that is NOT one
// of these (e.g. `write-config.mjs` in §15's own heading) is prose, not a
// target, and is silently dropped rather than mis-tagged.
//
// ── DEDUPLICATION ────────────────────────────────────────────────────────
// A name can appear in more than one table — `AZURE_FACE_LIVENESS_LIMITED_
// ACCESS_APPROVED` is read by three independent deployments (§4, §5, and
// the azure-verifier service), and the manifest's own header says this is
// deliberate ("two independent settings... that happen to share a name",
// never one). For THIS parser's purpose — "is this name set, in the ONE
// process that can ever ask" — that distinction does not matter: one env
// var name is one presence check, however many places document reading it.
// So `parseEnvManifest` merges every occurrence of a name into ONE entry:
// `target` is the UNION of every occurrence's targets, `required` is true
// if ANY occurrence says required, and `section`/`sectionTitle` are the
// FIRST section the name is declared in (a deliberate, arbitrary tie-break,
// named here rather than left to whichever occurrence happened to parse
// last — `context/decisions.md#ws-r116-manifest-names-dedup-to-first-
// section` states the reversal condition). The returned `entries` list is
// therefore guaranteed to carry no duplicate `name`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const MANIFEST_PATH = join(ROOT, "docs", "gurukul", "ENV-MANIFEST.md");

// The manifest uses TWO literal five-column header shapes for the exact
// same kind of table, checked by hand 2026-09-05: 30 tables (§1-27) read
// "name | consumed at | required | fallback | breaks without it"; six later
// ones (§30-35, every Dormancy-through-recall-run addition) read "Var |
// Read by | Required? | Exact value | What changes with it" instead — a
// different column-naming convention from a later workstream, same shape,
// same meaning. `ROOM_WHATSAPP_CHAT` (§34) is the row that first proved the
// first shape's own header was NOT actually universal — `evals/env-
// manifest/run.mjs`'s own assertion for that name is the negative-control-
// shaped catch. Both are matched, case-insensitively; a doc that introduces
// a THIRD shape needs this list widened by hand, which is the honest
// trade-off of matching literal header text rather than a looser heuristic
// (a heuristic loose enough to catch a third unknown shape would also catch
// the citation tables in §28-29, which are NOT env-var tables at all).
const ENV_TABLE_HEADERS = [
  ["name", "consumed at", "required", "fallback", "breaks without it"],
  ["var", "read by", "required?", "exact value", "what changes with it"],
];
const SECTION_RE = /^##\s+(\S+)\.\s+(.*)$/;
export const NAME_RE = /^[A-Z][A-Z0-9_]+$/;
// A name cell is not always ONE name: a handful of rows document a pair or
// a small group together (`REPLICA_PROVIDER_CONSENT_KEK_ID` / `..._B64`,
// "required (both)"; `MEDIA_EXTRACT_PROVIDER` + `..._KEY`; a three- or
// four-name restatement in §20 pointing back at an earlier section) —
// every case checked by hand, 2026-09-05, is names joined by `/`, `+` or
// `,` and nothing else. `parseNameCell` accepts exactly that shape: every
// backtick-quoted token in the cell, with everything OUTSIDE the backticks
// required to be only those three separators and whitespace — anything
// else (stray prose, an unbalanced backtick) is a malformed cell, not a
// best-effort scrape.
const CELL_SEPARATORS_RE = /^[\s/+,]*$/;

function parseNameCell(raw) {
  const tokens = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (tokens.length === 0) return null;
  const stripped = raw.replace(/`[^`]+`/g, "");
  if (!CELL_SEPARATORS_RE.test(stripped)) return null;
  return tokens;
}

// The manifest header's own "six deployment targets" (`vercel-app` plus the
// five standalone services) plus `web build`, the one Vite-baked-flag
// target WS-R2 introduced (§25). Order here is the order a heading's own
// prose would naturally introduce them, not load-bearing.
export const KNOWN_TARGETS = Object.freeze([
  "vercel-app",
  "web build",
  "azure-verifier",
  "voice-evidence",
  "audio-protection",
  "open-voice-runtime",
  "media-extract",
  "processing-worker",
]);

/** Splits one markdown table row into trimmed cells, tolerant of a row that
 *  omits the leading/trailing pipe — `scripts/dayOneRunbook.mjs#splitRow`'s
 *  own function, restated here rather than imported: that file lives one
 *  level up in "what it parses" (a runbook step, not an env-var row) and
 *  the two must be free to diverge without either editor wondering whether
 *  a change to one is safe for the other. Never touches a pipe inside a
 *  backtick span — every cell in this table's `name` column is a single
 *  backtick-quoted token and the other four are plain prose, never a
 *  pipe-bearing code span, so a plain split is exact for this table. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** Every backtick-quoted token anywhere on a section heading's own line,
 *  filtered to `KNOWN_TARGETS` — deliberately not anchored to "inside the
 *  first parenthesis", since a heading's target parenthetical is not
 *  guaranteed to be the only one (§7's own heading has descriptive prose
 *  trailing the parenthetical, on the SAME line, outside it) and a token
 *  match against a closed, known vocabulary is a stronger guarantee than a
 *  position-based guess would be. */
function sectionTargets(headingText) {
  const tokens = [...headingText.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return [...new Set(tokens.filter((t) => KNOWN_TARGETS.includes(t)))];
}

/**
 * Parses env-var entries out of manifest markdown TEXT (never reads a file
 * itself — `loadEnvManifest` below is the file-reading half, kept separate
 * so `evals/env-manifest/run.mjs` can feed this a MUTATED copy for its
 * negative controls without writing a second file to disk).
 *
 * Returns `{entries}`, each `{name, section, sectionTitle, target, required}`
 * — `target` an array (possibly `[]` if no occurrence's section heading
 * named a known target, which the manifest's own §22/§23 headings do on
 * purpose, `context/decisions.md#ws-r116-manifest-names-dedup-to-first-
 * section` names why those two sections carry no env-var tables anyway).
 * `entries` is deduplicated by `name` — see this file's own header.
 *
 * THROWS on: an env-var table header appearing before any `##` section
 * heading; a table with a header but no valid separator row; a row with the
 * wrong cell count; a name cell that is not a single backtick-quoted token,
 * or whose contents do not match `NAME_RE`; a table with a header and
 * separator but zero data rows; zero entries parsed from the whole
 * document (the marker/shape drifted). Every throw is a DOC DEFECT,
 * `scripts/dayOneRunbook.mjs`'s own "throws rather than silently treating
 * it as something it is not" law restated for this table.
 */
export function parseEnvManifest(text) {
  const lines = text.split("\n");
  let section = null;
  const byName = new Map();
  const order = [];

  for (let i = 0; i < lines.length; i++) {
    const secMatch = SECTION_RE.exec(lines[i].trim());
    if (secMatch) {
      section = { id: secMatch[1], title: secMatch[2].trim(), targets: sectionTargets(secMatch[2]) };
      continue;
    }
    if (!lines[i].trim().startsWith("|")) continue;
    const cells = splitRow(lines[i]);
    if (cells.length !== 5) continue;
    const lowered = cells.map((c) => c.toLowerCase()).join("|");
    if (!ENV_TABLE_HEADERS.some((h) => h.join("|") === lowered)) continue;

    // Found an env-var table header. The next line must be its separator.
    if (!section) throw new Error(`envManifest: env-var table header at line ${i + 1} appears before any "## N. Title" section heading`);
    const sepCells = splitRow(lines[i + 1] || "");
    if (sepCells.length !== 5 || !isSeparatorRow(sepCells)) {
      throw new Error(`envManifest: env-var table at line ${i + 1} (section ${section.id}) has no valid 5-column separator row on line ${i + 2}`);
    }

    let j = i + 2;
    let rowsInTable = 0;
    for (; j < lines.length; j++) {
      if (!lines[j].trim().startsWith("|")) break;
      const rcells = splitRow(lines[j]);
      if (rcells.length !== 5) {
        throw new Error(`envManifest: row at line ${j + 1} (section ${section.id}) has ${rcells.length} cell(s), expected 5: ${lines[j]}`);
      }
      const names = parseNameCell(rcells[0]);
      if (!names) {
        throw new Error(`envManifest: row at line ${j + 1} (section ${section.id}) has a malformed name cell (backtick-quoted token(s), only "/"/"+"/"," between them): ${JSON.stringify(rcells[0])}`);
      }
      for (const name of names) {
        if (!NAME_RE.test(name)) {
          throw new Error(`envManifest: row at line ${j + 1} (section ${section.id}) has a name that does not match ${NAME_RE}: ${JSON.stringify(name)}`);
        }
      }
      const required = rcells[2].toLowerCase().startsWith("required");
      rowsInTable++;

      for (const name of names) {
        const existing = byName.get(name);
        if (!existing) {
          byName.set(name, { name, section: section.id, sectionTitle: section.title, target: [...section.targets], required });
          order.push(name);
        } else {
          existing.target = [...new Set([...existing.target, ...section.targets])];
          existing.required = existing.required || required;
        }
      }
    }
    if (rowsInTable === 0) {
      throw new Error(`envManifest: env-var table in section ${section.id} (starting line ${i + 1}) has a header and separator but zero data rows`);
    }
    i = j - 1;
  }

  if (!order.length) throw new Error("envManifest: parsed zero env-var entries from the whole document — the table shape or marker drifted");
  return { entries: order.map((n) => byName.get(n)) };
}

/** Reads the real `docs/gurukul/ENV-MANIFEST.md` and parses it —
 *  `scripts/dayOneRunbook.mjs#loadRunbook`'s own shape. */
export function loadEnvManifest(path = MANIFEST_PATH) {
  return parseEnvManifest(readFileSync(path, "utf8"));
}
