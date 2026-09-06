// WS-R116. `scripts/envManifest.mjs`'s own offline proof, plus
// `scripts/build-env-manifest.mjs`'s freshness check against the REAL
// committed `api/_env-manifest.gen.json` — folded in here (this workstream's
// brief: touch `scripts/verify-release.mjs` only to add the assertion to an
// EXISTING check, never a new named gate) so `eval suite`, which already
// runs this whole registry, is the one thing that proves the generated file
// has not drifted from the document.
//
//   node evals/env-manifest/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseEnvManifest,
  loadEnvManifest,
  MANIFEST_PATH,
  NAME_RE,
  KNOWN_TARGETS,
} from "../../scripts/envManifest.mjs";
import { buildManifestData, OUT_PATH } from "../../scripts/build-env-manifest.mjs";
import { ENV_MANIFEST_ENTRIES, ENV_MANIFEST_BY_NAME, groupAbsentBySection } from "../../api/_env-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -- ${detail}` : ""}`);
  }
}

// ── §1: the real document, parsed ───────────────────────────────────────
console.log("── §1: parseEnvManifest against the real document ──");
{
  const { entries } = loadEnvManifest();
  check("parses to a non-trivial number of names", entries.length > 100, `${entries.length} names`);
  const names = entries.map((e) => e.name);
  check("no duplicate names", new Set(names).size === names.length, `${names.length} entries, ${new Set(names).size} unique`);
  check("every name matches NAME_RE", entries.every((e) => NAME_RE.test(e.name)), entries.find((e) => !NAME_RE.test(e.name))?.name);
  check("every entry has a non-empty target array", entries.every((e) => Array.isArray(e.target) && e.target.length > 0),
    JSON.stringify(entries.find((e) => !e.target?.length)));
  check("every target named is in KNOWN_TARGETS", entries.every((e) => e.target.every((t) => KNOWN_TARGETS.includes(t))));

  // Known names, hand-checked against the real doc (2026-09-05), present
  // with the right shape.
  const cron = entries.find((e) => e.name === "CRON_SECRET");
  check("CRON_SECRET present, section 15, target vercel-app, required",
    cron && cron.section === "15" && cron.target.includes("vercel-app") && cron.required === true, JSON.stringify(cron));

  const foundry = entries.find((e) => e.name === "AZURE_FOUNDRY_ENDPOINT");
  check("AZURE_FOUNDRY_ENDPOINT present, section 1, target vercel-app",
    foundry && foundry.section === "1" && foundry.target.includes("vercel-app"), JSON.stringify(foundry));

  const roomWa = entries.find((e) => e.name === "ROOM_WHATSAPP_CHAT");
  check("ROOM_WHATSAPP_CHAT present, section 34 (Rooms-era)", roomWa && roomWa.section === "34", JSON.stringify(roomWa));

  // WS-R136: the join number's own optional env, same section as ROOM_WHATSAPP_CHAT.
  const waDisplayNumber = entries.find((e) => e.name === "WHATSAPP_DISPLAY_PHONE_NUMBER");
  check("WHATSAPP_DISPLAY_PHONE_NUMBER present, section 34, target vercel-app, optional",
    waDisplayNumber && waDisplayNumber.section === "34" && waDisplayNumber.target.includes("vercel-app") &&
      waDisplayNumber.required === false,
    JSON.stringify(waDisplayNumber));

  // A name documented in more than one section (the manifest's own "not one
  // setting" example, §4 and §5) collapses to ONE entry, target the UNION.
  const shared = entries.find((e) => e.name === "AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED");
  check("a name documented in multiple sections collapses to one entry",
    !!shared, "AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED not found");
  check("its section is the FIRST one it is declared in (§4)", shared?.section === "4", shared?.section);
  check("its target is the union across every occurrence (includes azure-verifier, not just vercel-app)",
    shared?.target.includes("vercel-app") && shared?.target.includes("azure-verifier"), JSON.stringify(shared?.target));

  // A multi-name cell (the KEK pair, §13) splits into two entries sharing
  // one row's `required`.
  const kekId = entries.find((e) => e.name === "REPLICA_PROVIDER_CONSENT_KEK_ID");
  const kekB64 = entries.find((e) => e.name === "REPLICA_PROVIDER_CONSENT_KEK_B64");
  check("a '/'-joined name cell splits into two separate entries", !!kekId && !!kekB64, JSON.stringify({ kekId, kekB64 }));
  check("both halves of a split cell share the row's own required flag",
    kekId?.required === true && kekB64?.required === true, JSON.stringify({ kekId: kekId?.required, kekB64: kekB64?.required }));

  // A citation table (§28-29, "| mark | status | citation |") is NOT
  // mistaken for an env-var table.
  check("no entry named 'mark' or 'status' leaked from a citation table",
    !entries.some((e) => e.name === "MARK" || e.name === "STATUS"));
}

// ── §2: negative controls — DOC DEFECTS throw, never silently degrade ───
console.log("\n── §2: negative controls ──");
{
  const real = readFileSync(MANIFEST_PATH, "utf8");
  const lines = real.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim() === "| name | consumed at | required | fallback | breaks without it |");
  check("found at least one real env-var table header to mutate", headerIdx > -1);

  // (a) an env-var table header before any section heading.
  {
    const mutated = [
      lines[headerIdx],
      lines[headerIdx + 1],
      lines[headerIdx + 2],
    ].join("\n");
    let threw = null;
    try {
      parseEnvManifest(mutated);
    } catch (e) {
      threw = e;
    }
    check("NEGATIVE CONTROL: an env-var table header before any '## N.' heading throws",
      threw instanceof Error && /before any/.test(threw.message), threw?.message);
  }

  // (b) a data row with the wrong cell count.
  {
    const droppedCell = real.replace(
      lines[headerIdx + 2],
      lines[headerIdx + 2].replace(/\s\|[^|]*\|\s*$/, " |"), // drop the last cell
    );
    check("mutation actually changed a row's cell count", droppedCell !== real);
    let threw = null;
    try {
      parseEnvManifest(droppedCell);
    } catch (e) {
      threw = e;
    }
    check("NEGATIVE CONTROL: a data row with the wrong cell count throws", threw instanceof Error, threw?.message);
  }

  // (c) a malformed name cell (no backtick at all).
  {
    const firstDataRow = lines[headerIdx + 2];
    const nameCellMatch = /^\|\s*`([^`]+)`/.exec(firstDataRow);
    check("first data row after a header has a real backtick name cell", !!nameCellMatch, firstDataRow);
    const mangled = firstDataRow.replace(`\`${nameCellMatch?.[1]}\``, nameCellMatch?.[1] || "X");
    const mutatedDoc = real.replace(firstDataRow, mangled);
    check("mutation actually changed the name cell", mutatedDoc !== real);
    let threw = null;
    try {
      parseEnvManifest(mutatedDoc);
    } catch (e) {
      threw = e;
    }
    check("NEGATIVE CONTROL: a name cell missing its backticks throws", threw instanceof Error && /malformed name cell/.test(threw.message), threw?.message);
  }

  // (d) a document with zero env-var tables (every header line, EITHER of
  // the two known shapes, blanked).
  {
    const knownHeaders = new Set([
      "| name | consumed at | required | fallback | breaks without it |",
      "| Var | Read by | Required? | Exact value | What changes with it |",
    ]);
    const noTables = real
      .split("\n")
      .map((l) => (knownHeaders.has(l.trim()) ? "| x | y | z | w | v |" : l))
      .join("\n");
    let threw = null;
    try {
      parseEnvManifest(noTables);
    } catch (e) {
      threw = e;
    }
    check("NEGATIVE CONTROL: a document with zero env-var tables throws rather than returning []",
      threw instanceof Error && /zero env-var entries/.test(threw.message), threw?.message);
  }

  // (e) a name that does not match NAME_RE (lowercase).
  {
    const firstDataRow = lines[headerIdx + 2];
    const nameCellMatch = /^\|\s*`([^`]+)`/.exec(firstDataRow);
    const lowered = firstDataRow.replace(`\`${nameCellMatch?.[1]}\``, `\`${(nameCellMatch?.[1] || "x").toLowerCase()}\``);
    const mutatedDoc = real.replace(firstDataRow, lowered);
    let threw = null;
    try {
      parseEnvManifest(mutatedDoc);
    } catch (e) {
      threw = e;
    }
    check("NEGATIVE CONTROL: a lowercase name fails NAME_RE and throws", threw instanceof Error && /does not match/.test(threw.message), threw?.message);
  }
}

// ── §3: a minimal, self-contained fixture doc (isolates the parser from
//    the real document's own size and edits) ───────────────────────────
console.log("\n── §3: a minimal fixture document ──");
{
  const fixture = [
    "# Fixture",
    "",
    "## 1. Alpha (`vercel-app`)",
    "",
    "| name | consumed at | required | fallback | breaks without it |",
    "|---|---|---|---|---|",
    "| `FIXTURE_ONE` | `x.js:1` | required | none | breaks |",
    "| `FIXTURE_TWO` / `FIXTURE_THREE` | `x.js:2` | required (both) | none | breaks |",
    "",
    "## 2. Beta (`azure-verifier`)",
    "",
    "| name | consumed at | required | fallback | breaks without it |",
    "|---|---|---|---|---|",
    "| `FIXTURE_ONE` | `y.py:1` | optional | default | none |",
    "",
  ].join("\n");
  const { entries } = parseEnvManifest(fixture);
  check("fixture parses to 3 entries", entries.length === 3, entries.map((e) => e.name).join(","));
  const one = entries.find((e) => e.name === "FIXTURE_ONE");
  check("FIXTURE_ONE's target is the union across both sections",
    one?.target.includes("vercel-app") && one?.target.includes("azure-verifier"), JSON.stringify(one));
  check("FIXTURE_ONE's section stays the FIRST one (1, Alpha)", one?.section === "1", one?.section);
  check("FIXTURE_ONE's required stays true (required in section 1, optional in section 2 -> ANY)", one?.required === true, one?.required);
  const three = entries.find((e) => e.name === "FIXTURE_THREE");
  check("FIXTURE_THREE (second half of a split cell) parsed with the row's own required", three?.required === true, JSON.stringify(three));
}

// ── §4: buildManifestData — the vercel-app filter and stable sort ───────
console.log("\n── §4: buildManifestData ──");
{
  const data = buildManifestData({
    entries: [
      { name: "Z_NAME", section: "1", sectionTitle: "Z", target: ["vercel-app"], required: false },
      { name: "A_NAME", section: "1", sectionTitle: "A", target: ["processing-worker"], required: true },
      { name: "M_NAME", section: "2", sectionTitle: "M", target: ["vercel-app", "processing-worker"], required: false },
    ],
  });
  check("filters to only vercel-app-target entries", data.length === 2, JSON.stringify(data.map((d) => d.name)));
  check("sorted by name", data[0].name === "M_NAME" && data[1].name === "Z_NAME", JSON.stringify(data.map((d) => d.name)));
  check("NEGATIVE CONTROL: a processing-worker-only entry never appears",
    !data.some((d) => d.name === "A_NAME"));
}

// ── §5: the freshness check against the REAL committed file ─────────────
console.log("\n── §5: the committed api/_env-manifest.gen.json is fresh ──");
{
  const { entries } = loadEnvManifest();
  const fresh = buildManifestData({ entries });
  let committed;
  try {
    committed = JSON.parse(readFileSync(OUT_PATH, "utf8"));
  } catch (e) {
    committed = null;
    check("api/_env-manifest.gen.json exists and parses as JSON", false, e.message);
  }
  if (committed) {
    check("committed file has the same entry count as a fresh parse", committed.length === fresh.length, `committed ${committed.length}, fresh ${fresh.length}`);
    check("committed file is byte-identical to a fresh build (run: node scripts/build-env-manifest.mjs)",
      JSON.stringify(committed) === JSON.stringify(fresh),
      "stale — the committed api/_env-manifest.gen.json no longer matches docs/gurukul/ENV-MANIFEST.md; run scripts/build-env-manifest.mjs and commit the result");
  }
}

// ── §6: api/_env-manifest.js — the leaf module both self-check and ops
//    import, and groupAbsentBySection ─────────────────────────────────
console.log("\n── §6: api/_env-manifest.js ──");
{
  check("ENV_MANIFEST_ENTRIES is non-empty and matches the committed file's own count",
    ENV_MANIFEST_ENTRIES.length > 0 && ENV_MANIFEST_ENTRIES.length === JSON.parse(readFileSync(OUT_PATH, "utf8")).length,
    ENV_MANIFEST_ENTRIES.length);
  check("ENV_MANIFEST_BY_NAME has one entry per ENV_MANIFEST_ENTRIES row",
    ENV_MANIFEST_BY_NAME.size === ENV_MANIFEST_ENTRIES.length);
  check("ENV_MANIFEST_ENTRIES is frozen", Object.isFrozen(ENV_MANIFEST_ENTRIES));

  const known = ENV_MANIFEST_ENTRIES.find((e) => e.name === "CRON_SECRET");
  check("CRON_SECRET reachable via ENV_MANIFEST_BY_NAME", ENV_MANIFEST_BY_NAME.get("CRON_SECRET")?.section === known?.section);

  const grouped = groupAbsentBySection(["CRON_SECRET", "AZURE_FOUNDRY_ENDPOINT", "AZURE_KEY"]);
  check("groupAbsentBySection: a name from the pre-Rooms write-config mirror (AZURE_KEY) lands in ungrouped",
    grouped.ungrouped.includes("AZURE_KEY"), JSON.stringify(grouped.ungrouped));
  check("groupAbsentBySection: manifest names land under their own section, not ungrouped",
    !grouped.ungrouped.includes("CRON_SECRET") && !grouped.ungrouped.includes("AZURE_FOUNDRY_ENDPOINT"), JSON.stringify(grouped));
  check("groupAbsentBySection: sections are sorted in reading order (1 before 15)",
    grouped.sections.findIndex((s) => s.section === "1") < grouped.sections.findIndex((s) => s.section === "15"), JSON.stringify(grouped.sections.map((s) => s.section)));
  check("groupAbsentBySection: names within a section are sorted",
    grouped.sections.every((s) => JSON.stringify(s.names) === JSON.stringify([...s.names].sort())));

  const empty = groupAbsentBySection([]);
  check("NEGATIVE CONTROL: an empty absent list groups to zero sections and zero ungrouped",
    empty.sections.length === 0 && empty.ungrouped.length === 0, JSON.stringify(empty));

  const junk = groupAbsentBySection(["NOT_A_REAL_NAME_AT_ALL"]);
  check("NEGATIVE CONTROL: a name on neither list lands in ungrouped, never dropped silently",
    junk.ungrouped.includes("NOT_A_REAL_NAME_AT_ALL") && junk.sections.length === 0, JSON.stringify(junk));

  // A value can never leak through this module — it only ever handles
  // NAMES, never a value read off `process.env`. Static scan of the real
  // source, `api/_self-check.js`'s own established discipline restated.
  const src = readFileSync(join(ROOT, "api", "_env-manifest.js"), "utf8");
  check("static scan: api/_env-manifest.js never reads process.env or env[",
    !/process\.env/.test(src) && !/\benv\s*\[/.test(src), "found an env read in a file that must only ever handle names");
}

console.log(`\nenv-manifest: ${failures} failing check(s)`);
if (failures) process.exit(1);
