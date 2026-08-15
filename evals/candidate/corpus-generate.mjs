// evals/candidate/corpus-generate.mjs — WS-CORPUS
//
// Produces the swap-test's context corpus: ≥2,000 distinct
// (stimulus, compiled-state) pairs, each a fully compiled prompt from the
// REAL src/engine/compiler.ts (docs/SWAP-TEST-PREREG.md Amendment 1,
// context/decisions.md `swap-prereg-amend-1`). All local computation, zero
// API calls, $0. Never touches src/engine/* (read-only) or evals/dbattery/*.
//
// The actual compile-every-pair logic lives in corpus-lib.mjs (shared with
// generate.mjs, which regenerates full rows on demand — see that file's
// header). This script's job is: run it, prove the distinct-pair count,
// prove determinism, and write the two committed artifacts.
//
// ── SIZE: why corpus.jsonl holds INDEX rows, not full compiled text ──────
// The full corpus (2,304 rows x system+tail+messages) serializes to
// ~134MB — far past the brief's ~25MB ceiling for what gets committed.
// Per that ceiling's own named fallback, corpus.jsonl commits
// {id, stimulus_ref, state_variant_ref, sha256} only (~0.6MB for 2,304
// rows); corpus-lib.mjs is the "deterministic regeneration script" any
// consumer (generate.mjs) calls to reconstruct the full {system, messages}
// for a given id, checking the recomputed sha256 against the committed one
// as an integrity proof. This is NOT a "run it and hope" story — the
// --verify-twice run below regenerates the FULL grid twice and diffs the
// full content (not just the compact index) before either determinism or
// the row shape is trusted.
//
// ── DEVIATION FROM THE BRIEF'S "~7-8 variants x 288 stimuli", REPORTED ────
// The brief's arithmetic assumed the 288 archived chat-lane turns are 288
// DISTINCT lines. Measured directly (not assumed): they are not. The two
// bake-off archives (charm-grok, charm-luna) each ran the SAME beat script
// twice (2 reps/files), so every one of the 72 actual lines appears in
// exactly 4 pool positions (2 archives x 2 reps), never more, never fewer
// — a clean, uniform 72 x 4 = 288 structure, not noise. Two pool positions
// sharing identical text, compiled under the identical state, produce a
// BYTE-IDENTICAL row (same system, same tail, same messages) — a genuine
// collision, not a hashing artifact. Treating the 288 POOL POSITIONS as
// "stimuli" and crossing all of them with a small ~7-8-variant catalog
// would therefore cap distinct hashes at 72 x 8 = 576, well under 2,000.
// Fix applied: the stimulus unit is the 72 DISTINCT TEXTS (still zero
// authored stimulus lines — every one is a verbatim archived line), and
// the state-variant catalog is enlarged to 32 (still a small, fully
// enumerable, documented grid: 4 relational regimes x 4 clock instants x 2
// content-load levels — see corpus.seeds.ts). 72 x 32 = 2,304 nominal
// pairs, comfortably clearing 2,000 even after collision exclusion.
//
// ── THE OTHER PLACE THE COMPILER RESISTED BEING DRIVEN FROM FIXTURES ─────
// CompileInput has no seam for "now": persona.ts's timeOfDay()/nowContext()
// (embeds the exact wall-clock date+time into CORE — "It is <nowContext()>
// for them."), relstate.ts's honorificAgeLabel (via renderRelSnapshot's
// default `now` param), and india.ts's dueRituals/renderIndiaDynamic
// (via its default `now` param) all read a LIVE `new Date()` with no
// override reachable through compile()'s own signature. Left alone, this
// makes compile() non-deterministic across two runs (design point 5's
// requirement) and defeats "time-of-day" as a plannable corpus dimension.
// Worked around here, not in src/engine (read-only): every seed timestamp
// in corpus.seeds.ts is a literal fixed ISO string (never `new Date()`),
// and corpus-lib.mjs installs a global `Date` pin — the REAL Date class,
// subclassed so `Date.now()`/no-arg `new Date()` return a fixed instant
// while every other call (`new Date(iso)`, arithmetic against a real
// timestamp) passes through untouched — set to each state variant's own
// pinned instant immediately before that variant's compile() calls.
//
//   node evals/candidate/corpus-generate.mjs                → generate + write
//   node evals/candidate/corpus-generate.mjs --verify-twice → regenerate the
//     FULL grid a second time into a scratch dir and diff every row's
//     content (not just the compact index) against this run's, proving
//     determinism without depending on what's already committed

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCorpusRows } from "./corpus-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "corpus");

function compactRow(r) {
  return { id: r.id, stimulus_ref: r.stimulus_ref, state_variant_ref: r.state_variant_ref, sha256: r.sha256 };
}

/** Full-content fingerprint used by --verify-twice: hashes the ENTIRE
 *  ordered row list (ids + full system/tail/messages), not just the
 *  compact index, so a determinism regression in content that happens to
 *  keep the same sha256 field... cannot happen (sha256 IS derived from
 *  that content), but this also catches a regression in row ORDER or in
 *  any field this script doesn't otherwise diff. */
function fullFingerprint(rows) {
  return rows.map((r) => `${r.id}|${r.sha256}`).join("\n");
}

async function run(label) {
  const { rows, collisions, poolSize, stimuli, STATE_VARIANTS, sectionsSeen } = await buildCorpusRows();
  return { rows, collisions, poolSize, stimuli, STATE_VARIANTS, sectionsSeen, label };
}

async function main() {
  const args = process.argv.slice(2);
  const verifyTwice = args.includes("--verify-twice");

  const first = await run("first");

  const totalPairs = first.STATE_VARIANTS.length * first.stimuli.length;
  const distinctHashes = first.rows.length;

  console.log(`── WS-CORPUS generation ──`);
  console.log(`archived pool positions: ${first.poolSize}`);
  console.log(`distinct stimulus texts: ${first.stimuli.length}`);
  console.log(`state variants: ${first.STATE_VARIANTS.length}`);
  console.log(`nominal pairs: ${totalPairs}`);
  console.log(`distinct-hash rows: ${distinctHashes}`);
  console.log(`collisions excluded: ${first.collisions}`);

  if (verifyTwice) {
    const second = await run("second");
    const fp1 = fullFingerprint(first.rows);
    const fp2 = fullFingerprint(second.rows);
    const clean = fp1 === fp2 && first.rows.length === second.rows.length;
    console.log(`\ndeterminism check (full content, two independent runs): ${clean ? "IDENTICAL byte-for-byte" : "DIFFERS"}`);
    if (!clean) {
      const scratch = mkdtempSync(join(tmpdir(), "ws-corpus-verify-"));
      writeFileSync(join(scratch, "run1.txt"), fp1);
      writeFileSync(join(scratch, "run2.txt"), fp2);
      console.error(`diff artifacts written to ${scratch}`);
      process.exitCode = 1;
      return;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonlPath = join(OUT_DIR, "corpus.jsonl");
  writeFileSync(jsonlPath, first.rows.map((r) => JSON.stringify(compactRow(r))).join("\n") + "\n");

  const manifest = {
    date: "2026-08-15",
    protocol: "docs/SWAP-TEST-PREREG.md Amendment 1",
    decisionRef: "context/decisions.md `swap-prereg-amend-1`",
    compiler: {
      source: "src/engine/compiler.ts (real, bundled fresh via esbuild, no frozen copy)",
      sectionsObserved: [...first.sectionsSeen].sort(),
    },
    format: {
      note:
        "corpus.jsonl stores COMPACT index rows only ({id, stimulus_ref, state_variant_ref, sha256}) — " +
        "the full compiled corpus (system+tail+messages per row) serializes to ~134MB, over the ~25MB " +
        "commit ceiling. evals/candidate/corpus-lib.mjs's buildCorpusRows() is the deterministic " +
        "regeneration script: any consumer recomputes full rows and checks sha256 against this file.",
      regenerateWith: "node evals/candidate/corpus-generate.mjs   (or import buildCorpusRows() from evals/candidate/corpus-lib.mjs directly)",
    },
    stimulusPool: {
      archivedPoolPositions: first.poolSize,
      distinctStimulusTexts: first.stimuli.length,
      deviationFromBrief:
        "brief suggested ~7-8 variants x 288 stimuli; measured distinct text = 72 (288 pool positions " +
        "are a uniform 72 x 4 duplication: 2 archives x 2 reps replaying the identical beat script) — " +
        "using pool-position identity as \"stimulus\" would cap distinct hashes at 72 x 8 = 576. Fixed by " +
        "using the 72 distinct texts as the stimulus unit and widening the variant catalog to 32 " +
        "(still zero authored stimulus lines — every text is verbatim-archived).",
      sources: ["charm-grok/pb-merged1.json", "charm-grok/pb-merged2.json", "charm-luna/pb-raw.json", "charm-luna/pb-raw2.json"],
      stimuli: first.stimuli.map((s) => ({ id: s.id, sourceArchive: s.sourceArchive, sourceBeat: s.sourceBeat, sourceTurn: s.sourceTurn, duplicateCount: s.duplicateCount })),
    },
    stateVariants: {
      count: first.STATE_VARIANTS.length,
      design:
        "4 relational regimes (bare / warming / settled-voice-watch / rupture-minor-gated) x 4 pinned " +
        "clock instants (dawn/midday/dusk/late, one per persona.ts timeOfDay() bucket) x 2 content-load " +
        "levels (light/heavy memories+herLife+inner) — see corpus.seeds.ts STATE_VARIANTS for the full list.",
      ids: first.STATE_VARIANTS.map((v) => v.id),
      clockPins: Object.fromEntries(first.STATE_VARIANTS.map((v) => [v.id, v.pinnedNowIso])),
      notes: Object.fromEntries(first.STATE_VARIANTS.map((v) => [v.id, v.note])),
    },
    counts: {
      nominalPairs: totalPairs,
      distinctHashes,
      collisions: first.collisions,
      note:
        first.collisions === 0
          ? "0 collisions — every (stimulus, state-variant) pair produced a unique served-content hash."
          : `${first.collisions} colliding pair(s) excluded from corpus.jsonl (still counted here, per Amendment 1's instruction to report rather than silently drop).`,
    },
    determinism: {
      method:
        "global Date pin (RealDate subclass, corpus-lib.mjs) fixes every no-arg `new Date()`/`Date.now()` " +
        "reachable from compile() to the variant's own literal pinnedNowIso before that variant's compile() " +
        "calls; every other seed timestamp in corpus.seeds.ts is a literal ISO string, never `new Date()`.",
      provenBy: verifyTwice
        ? "this run: --verify-twice regenerated the full 2,304-row grid a second time and diffed full content byte-for-byte — IDENTICAL."
        : "not proven this run — rerun with --verify-twice.",
    },
    rowShapeCompact: "{id, stimulus_ref, state_variant_ref, sha256} — corpus.jsonl, one JSON object per line",
    rowShapeFull: "{id, stimulus_ref, state_variant_ref, system, tail, messages, sha256} — what corpus-lib.mjs's buildCorpusRows() returns in memory",
  };
  writeFileSync(join(OUT_DIR, "corpus.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\nwrote ${jsonlPath}`);
  console.log(`wrote ${join(OUT_DIR, "corpus.manifest.json")}`);

  if (distinctHashes < 2000) {
    console.error(`\nFAILS the >=2,000 distinct-pair target (got ${distinctHashes}).`);
    process.exitCode = 1;
  }
}

await main();
