// ── THE PRE-REGISTRATION HASH (the terra idiom, mechanised) ───────────────
//
// docs/SWAP-TEST-PREREG.md pre-registers by CONVENTION: "the commit that
// introduces this file is the pre-registration timestamp; changes after that
// commit are amendments and must say what they changed and why." That
// convention held because a human read the diff. This battery has 33 rubrics
// and a decision rule, and the thing a judged run is most tempted to do is
// soften one rubric after seeing what came back — which no diff review catches
// once the diff is large enough to skim.
//
// So the convention gets a mechanism: every byte of the fixtures, the probes,
// the rubrics and the decision rule is hashed into prereg.manifest.json, and
// run.mjs REFUSES --live unless the recomputed hash matches. Editing a rubric
// after the fact does not become impossible — it becomes loud, and it lands in
// the manifest's own amendment log where it has to say what changed.
//
//   node evals/feltmem/prereg.mjs             → verify, print the table
//   node evals/feltmem/prereg.mjs --write     → (re)write the manifest
//   node evals/feltmem/prereg.mjs --write --amend "why"   → same, with a
//                                               required amendment reason
//                                               appended to the log
//
// --write with an existing, MATCHING manifest is a no-op that says so.
// --write with an existing, MISMATCHING manifest refuses without --amend:
// silently restamping a changed pre-registration is the failure this file is
// for, and it is exactly the failure a convention cannot prevent.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PREREG_FILES, RUBRICS, PROBES, LAWS, ACCEPTANCE, SCOPE, PREWAVE_REF, DRAWS_PER_PROBE } from "./fixtures/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, "fixtures");
export const MANIFEST_PATH = join(HERE, "prereg.manifest.json");

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** Per-file hashes, the combined hash, and per-rubric hashes.
 *  The per-rubric hashes are not redundant with the file hash: when the
 *  combined hash fails, they are what names WHICH rubric moved, which is the
 *  difference between "the pre-registration changed" and a usable amendment
 *  entry. */
export function computePrereg() {
  const onDisk = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".mjs")).sort();
  const declared = [...PREREG_FILES].sort();
  const undeclared = onDisk.filter((f) => !declared.includes(f));
  const missing = declared.filter((f) => !onDisk.includes(f));

  const files = PREREG_FILES.map((f) => {
    // Git's text checkout may materialize CRLF on Windows. The registration
    // describes source content, so hash its repository-stable LF form.
    const bytes = readFileSync(join(FIXTURE_DIR, f), "utf8").replace(/\r\n/g, "\n");
    return { file: f, bytes: Buffer.byteLength(bytes, "utf8"), sha256: sha256(bytes) };
  });
  // order-dependent by construction: PREREG_FILES fixes the order, so a
  // reordering IS a change and the hash says so.
  const combined = sha256(files.map((f) => `${f.file}:${f.sha256}`).join("\n"));

  const rubricHashes = Object.fromEntries(
    Object.entries(RUBRICS).map(([id, r]) => [
      id,
      sha256(JSON.stringify({ best: r.best, failures: r.failures, twin_note: r.twin_note ?? null })),
    ]),
  );

  const perLaw = {};
  for (const p of PROBES) perLaw[p.law] = (perLaw[p.law] ?? 0) + 1;

  return {
    combined,
    files,
    rubricHashes,
    counts: {
      dyads: new Set(PROBES.map((p) => p.dyad)).size,
      probes: PROBES.length,
      laws: Object.keys(LAWS).length,
      probesPerLaw: perLaw,
      twins: PROBES.filter((p) => p.twin_of).length / 2,
      drawsPerProbe: DRAWS_PER_PROBE,
      judgedUnitsPerArm: PROBES.length * DRAWS_PER_PROBE,
    },
    directory: { undeclared, missing },
  };
}

export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/** The gate run.mjs --live calls before it is allowed to spend anything. */
export function verifyPrereg() {
  const computed = computePrereg();
  const manifest = readManifest();
  if (!manifest)
    return {
      ok: false,
      computed,
      manifest: null,
      why: `no pre-registration manifest at ${MANIFEST_PATH} — write one and COMMIT it before any judged run (node evals/feltmem/prereg.mjs --write)`,
      movedRubrics: [],
      movedFiles: [],
    };
  const movedFiles = computed.files
    .filter((f) => (manifest.files || []).find((m) => m.file === f.file)?.sha256 !== f.sha256)
    .map((f) => f.file);
  const movedRubrics = Object.entries(computed.rubricHashes)
    .filter(([id, h]) => (manifest.rubricHashes || {})[id] !== h)
    .map(([id]) => id);
  const ok =
    manifest.combined === computed.combined &&
    computed.directory.undeclared.length === 0 &&
    computed.directory.missing.length === 0;
  return {
    ok,
    computed,
    manifest,
    movedFiles,
    movedRubrics,
    why: ok
      ? null
      : computed.directory.undeclared.length
        ? `fixture file(s) present but not covered by the pre-registration hash: ${computed.directory.undeclared.join(", ")}`
        : computed.directory.missing.length
          ? `pre-registered fixture file(s) missing: ${computed.directory.missing.join(", ")}`
          : `pre-registration hash mismatch — committed ${manifest.combined.slice(0, 12)}, computed ${computed.combined.slice(0, 12)}`,
  };
}

function write({ amend }) {
  const computed = computePrereg();
  const prior = readManifest();
  if (prior && prior.combined === computed.combined) {
    console.log(`manifest already matches (${computed.combined.slice(0, 12)}) — nothing to write.`);
    return 0;
  }
  if (prior && !amend) {
    console.log(
      `REFUSING to restamp: the manifest on disk pre-registers ${prior.combined.slice(0, 12)} and the fixtures now hash to ${computed.combined.slice(0, 12)}.\n` +
        `That is an AMENDMENT and it has to say what it changed and why (docs/SWAP-TEST-PREREG.md's own rule):\n` +
        `  node evals/feltmem/prereg.mjs --write --amend "<what changed, and why, before any judged run>"`,
    );
    const v = verifyPrereg();
    if (v.movedFiles.length) console.log(`  files moved:   ${v.movedFiles.join(", ")}`);
    if (v.movedRubrics.length) console.log(`  rubrics moved: ${v.movedRubrics.join(", ")}`);
    return 1;
  }
  const manifest = {
    what: "docs/MEMORY-FELT.md §9 — the felt-memory judged battery, pre-registered",
    idiom:
      "docs/SWAP-TEST-PREREG.md / context/decisions.md `swap-prereg-1`: the commit that introduces this manifest is the pre-registration timestamp; every later change is an amendment and says so in `amendments` below.",
    written_at: new Date().toISOString().slice(0, 10),
    combined: computed.combined,
    files: computed.files,
    rubricHashes: computed.rubricHashes,
    counts: computed.counts,
    arms: {
      prewave: { ref: PREWAVE_REF, what: "the last commit before the memory wave (482b01b)" },
      current: { ref: "working tree", what: "the tree under acceptance" },
      note:
        "same brain, same lane, same stimulus, same sampling; the COMPILED CONTEXT is the independent variable, so byte-identity across arms is impossible and is not claimed.",
    },
    scope: SCOPE,
    acceptance: ACCEPTANCE,
    amendments: amend ? [{ at: new Date().toISOString().slice(0, 10), what: amend, from: prior?.combined ?? null }] : [],
  };
  if (prior?.amendments) manifest.amendments = [...prior.amendments, ...manifest.amendments];
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${MANIFEST_PATH}\ncombined hash: ${computed.combined}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    const i = argv.indexOf("--amend");
    process.exit(write({ amend: i >= 0 ? argv[i + 1] : null }));
  }
  const v = verifyPrereg();
  console.log(`── felt-memory pre-registration ──`);
  for (const f of v.computed.files) console.log(`  ${f.file.padEnd(16)} ${String(f.bytes).padStart(7)}B  ${f.sha256.slice(0, 12)}`);
  console.log(`  combined         ${v.computed.combined}`);
  console.log(
    `  ${v.computed.counts.dyads} dyads, ${v.computed.counts.probes} probes, ${v.computed.counts.twins} twin pairs, ` +
      `${v.computed.counts.judgedUnitsPerArm} judged units/arm at ${v.computed.counts.drawsPerProbe} draws`,
  );
  console.log(v.ok ? "\nMATCHES the committed manifest — a judged run is permitted." : `\nDOES NOT MATCH: ${v.why}`);
  if (!v.ok && v.movedRubrics?.length) console.log(`  rubrics moved: ${v.movedRubrics.join(", ")}`);
  process.exit(v.ok ? 0 : 1);
}
