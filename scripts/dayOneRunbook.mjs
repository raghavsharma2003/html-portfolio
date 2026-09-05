// WS-R96. THE RUNBOOK'S OWN TABLE, PARSED — never retyped. `scripts/day-one.mjs`
// and `evals/day-one/run.mjs` both import this file rather than each holding
// their own copy of the runbook's steps, so the two can never silently
// disagree about what "the day-one path" contains — the same law
// `scripts/probeLiveExpectations.mjs`'s own header states for vercel.json and
// the Room's literals, applied here to a markdown doc instead of source code.
//
// The table lives in `docs/gurukul/DAY-ONE.md` between two HTML comments,
// `<!-- DAY-ONE-TABLE:START -->` and `<!-- DAY-ONE-TABLE:END -->`, as a plain
// GitHub-flavoured markdown table with exactly these eight columns, in order:
//
//   # | Step | Env vars | Vercel project / target | Cost | Proving command | Expected output | Failure if skipped
//
// PROVING COMMAND GRAMMAR — every row's cell in that column must start with
// one of three prefixes, matching this workstream's brief verbatim ("the
// command that proves it: node scripts/probe-live.mjs <url>, the self-check's
// incident row, scripts/first-room.mjs"):
//
//   probe-live                 whole probe-live run must report zero findings
//   probe-live:<substring>     no probe-live finding whose `surface` field
//                              contains <substring> (case-sensitive, exact
//                              substring — not a regex, so a literal that
//                              needs escaping is a sign the row should read
//                              differently, not that this parser should grow
//                              a regex dialect)
//   self-check:env:<NAME>      via the ops door (GET /api/ops, an operator
//                              bearer), the `self_check.failing_checks` list
//                              must not contain "env: <NAME> missing"
//   self-check:door:<substring> same list must not contain any entry
//                              containing <substring>
//   manual:<instruction>       never run automatically by day-one.mjs — every
//                              row whose proof is `scripts/first-room.mjs`,
//                              a studio panel, or a dashboard setting is
//                              `manual:`, by design (day-one.mjs's own law:
//                              free GET/HEAD only, never a paid or
//                              data-writing call)
//
// A row whose Proving Command cell is empty, whitespace-only, or does not
// start with one of the three prefixes above is a DOC DEFECT — `parseRunbook`
// throws rather than silently treating it as "manual" or skipping it. This is
// the negative control `evals/day-one/run.mjs` exercises directly: a runbook
// row with no proving command must fail the whole parse, not one row of it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const RUNBOOK_PATH = join(ROOT, "docs", "gurukul", "DAY-ONE.md");

const START_MARKER = "<!-- DAY-ONE-TABLE:START -->";
const END_MARKER = "<!-- DAY-ONE-TABLE:END -->";
const PROVING_PREFIXES = Object.freeze(["probe-live", "self-check:env:", "self-check:door:", "manual:"]);

/** Splits one markdown table row (`| a | b | c |`) into trimmed cells,
 *  tolerant of a row that omits the leading/trailing pipe. Never touches a
 *  pipe inside a backtick-quoted span — every cell in this table is plain
 *  text or a single backtick-quoted token, never a pipe-bearing code span,
 *  so a plain split is exact rather than an approximation for this table. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function classifyProvingCommand(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("probe-live:")) return { kind: "probe-live-scoped", substring: trimmed.slice("probe-live:".length).trim() };
  if (trimmed === "probe-live") return { kind: "probe-live-whole" };
  if (trimmed.startsWith("self-check:env:")) return { kind: "self-check-env", name: trimmed.slice("self-check:env:".length).trim() };
  if (trimmed.startsWith("self-check:door:")) return { kind: "self-check-door", substring: trimmed.slice("self-check:door:".length).trim() };
  if (trimmed.startsWith("manual:")) return { kind: "manual", instruction: trimmed.slice("manual:".length).trim() };
  return null;
}

/**
 * Parses the runbook's own table out of markdown TEXT (never reads a file
 * itself — `loadRunbook()` below is the file-reading half, kept separate so
 * `evals/day-one/run.mjs` can feed this a MUTATED copy of the doc for its
 * negative control without writing a second file to disk).
 *
 * Returns `{steps}`, each step: `{n, step, envVars, target, cost, provingRaw,
 * proving, expected, failure}`. `proving` is the classified object above;
 * `provingRaw` is the untouched cell text, kept for error messages and for
 * `day-one.mjs`'s own printed report.
 *
 * THROWS on: no table found; a row with the wrong cell count; a row whose
 * Proving Command cell is empty or unrecognised; a non-sequential `#` column
 * (steps must read 1, 2, 3, ... with no gap and no repeat, so a doc edit that
 * drops a row is caught here rather than silently renumbering everything
 * after it).
 */
export function parseRunbook(text) {
  const startIdx = text.indexOf(START_MARKER);
  const endIdx = text.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`dayOneRunbook: could not find ${START_MARKER} / ${END_MARKER} markers`);
  }
  const body = text.slice(startIdx + START_MARKER.length, endIdx);
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) throw new Error("dayOneRunbook: table has no header/separator/data rows");

  const header = splitRow(lines[0]);
  const EXPECTED_HEADER = ["#", "Step", "Env vars", "Vercel project / target", "Cost", "Proving command", "Expected output", "Failure if skipped"];
  if (header.length !== EXPECTED_HEADER.length || header.some((h, i) => h !== EXPECTED_HEADER[i])) {
    throw new Error(`dayOneRunbook: table header does not match the expected ${EXPECTED_HEADER.length} columns: ${JSON.stringify(EXPECTED_HEADER)}, got ${JSON.stringify(header)}`);
  }
  if (!isSeparatorRow(splitRow(lines[1]))) {
    throw new Error("dayOneRunbook: second table row is not a markdown separator row");
  }

  const steps = [];
  let expectedN = 1;
  for (let i = 2; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length !== EXPECTED_HEADER.length) {
      throw new Error(`dayOneRunbook: row ${i - 1} has ${cells.length} cells, expected ${EXPECTED_HEADER.length}: ${lines[i]}`);
    }
    const [nRaw, step, envVars, target, cost, provingRaw, expected, failure] = cells;
    const n = Number(nRaw);
    if (!Number.isInteger(n) || n !== expectedN) {
      throw new Error(`dayOneRunbook: row "#"=${JSON.stringify(nRaw)} out of sequence — expected ${expectedN}`);
    }
    expectedN += 1;
    const proving = classifyProvingCommand(provingRaw);
    if (!proving) {
      throw new Error(
        `dayOneRunbook: step ${n} ("${step}") has no recognised Proving Command — cell was ${JSON.stringify(provingRaw)}. ` +
          `Must start with one of: ${PROVING_PREFIXES.join(", ")}`,
      );
    }
    if (!step.trim()) throw new Error(`dayOneRunbook: step ${n} has an empty Step name`);
    if (!expected.trim()) throw new Error(`dayOneRunbook: step ${n} ("${step}") has an empty Expected output cell`);
    if (!failure.trim()) throw new Error(`dayOneRunbook: step ${n} ("${step}") has an empty Failure-if-skipped cell`);
    steps.push({ n, step, envVars, target, cost, provingRaw, proving, expected, failure });
  }
  if (!steps.length) throw new Error("dayOneRunbook: table has a header but zero data rows");
  return { steps };
}

/** Reads the real `docs/gurukul/DAY-ONE.md` and parses it. The one function
 *  `scripts/day-one.mjs` actually calls; `evals/day-one/run.mjs` calls
 *  `parseRunbook` directly against text it builds in memory instead, so the
 *  eval never has to write a temp file to exercise the negative control. */
export function loadRunbook(path = RUNBOOK_PATH) {
  return parseRunbook(readFileSync(path, "utf8"));
}

export { PROVING_PREFIXES };
