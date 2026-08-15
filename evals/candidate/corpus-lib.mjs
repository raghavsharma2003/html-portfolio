// evals/candidate/corpus-lib.mjs — WS-CORPUS shared regeneration logic.
//
// The full compiled corpus (2,304 rows x full system/tail/messages text)
// serializes to ~134MB — well over the ~25MB ceiling
// docs/SWAP-TEST-PREREG.md Amendment 1 sets for what gets committed. Per
// that ceiling's own fallback ("store {id, refs, sha256} rows plus a
// deterministic regeneration script instead, and say so" — see
// corpus-generate.mjs's header for the full note), evals/candidate/corpus/
// corpus.jsonl commits only the compact index; this file is the
// "deterministic regeneration script", factored out so BOTH
// corpus-generate.mjs (writes the compact index + proves determinism) and
// generate.mjs (reconstructs full {system, messages} on demand to actually
// serve a row to the two swap-test arms) call the exact same code path —
// never two independent reimplementations that could silently drift.
//
// Regeneration is fully deterministic (see the file header's two notes on
// why: the 72-distinct-text stimulus fix, and the global Date pin) — given
// the same corpus.entry.ts bundle and the same evals/archives/ contents,
// calling buildCorpusRows() twice, or calling it here vs. in
// corpus-generate.mjs, produces byte-identical rows. That is the property
// that makes shipping only {id, refs, sha256} safe: any consumer can
// recompute the full row and check its sha256 against the committed one.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStimulusPool } from "./stimulus-pool.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const ARCHIVES = join(ROOT, "evals", "archives");
const BUNDLE = join(HERE, ".bundle.mjs");

export function buildBundle() {
  execSync(
    `npx esbuild ${join(HERE, "corpus.entry.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    { stdio: "inherit", cwd: ROOT },
  );
}

// ── global Date pin — see corpus-generate.mjs's file header for the full
// argument. Exported so a caller can also use setPin(null) to restore real
// time once regeneration is done (this module installs the pin as a side
// effect of being imported, matching corpus-generate.mjs's original
// behavior, since anything importing this module intends to call compile()
// through it). ──
const RealDate = globalThis.Date;
let fixedMs = null;
class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && fixedMs !== null) super(fixedMs);
    else super(...args);
  }
  static now() {
    return fixedMs !== null ? fixedMs : RealDate.now();
  }
}
export function setPin(iso) {
  fixedMs = iso == null ? null : new RealDate(iso).getTime();
}
if (globalThis.Date !== PinnedDate) globalThis.Date = PinnedDate;

export function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

let _loaded = null;
/** Bundles + imports corpus.entry.ts exactly once per process. */
export async function loadCompiler() {
  if (_loaded) return _loaded;
  buildBundle();
  const mod = await import(`file://${BUNDLE}?t=${RealDate.now()}`);
  _loaded = mod;
  return mod;
}

/** The 72-distinct-text stimulus pool — see corpus-generate.mjs header for
 *  why pool-position identity (288) is deliberately NOT used here. */
export function loadStimuli() {
  const pool = buildStimulusPool(ARCHIVES);
  const seen = new Map();
  for (const p of pool) if (!seen.has(p.user)) seen.set(p.user, p);
  return {
    poolSize: pool.length,
    stimuli: [...seen.values()].map((p) => ({
      id: `stim-${p.id}`,
      text: p.user,
      sourceArchive: p.archive,
      sourceBeat: p.beat,
      sourceTurn: p.turn,
      duplicateCount: pool.filter((q) => q.user === p.user).length,
    })),
  };
}

/**
 * Builds every (stimulus, state-variant) row, full content included.
 * Deterministic: same inputs on disk -> byte-identical output, always.
 * Returns { rows, collisions, poolSize, stimuli, STATE_VARIANTS, sectionsSeen }.
 * `rows` excludes hash collisions (see corpus-generate.mjs's header); each
 * excluded pair is counted in `collisions` but not present in `rows`.
 */
export async function buildCorpusRows() {
  const { compile, STATE_VARIANTS } = await loadCompiler();
  const { poolSize, stimuli } = loadStimuli();

  const rows = [];
  const byHash = new Map();
  let collisions = 0;
  const sectionsSeen = new Set();

  for (const variant of STATE_VARIANTS) {
    setPin(variant.pinnedNowIso);
    for (const stim of stimuli) {
      const input = { ...variant.input, latestUserText: stim.text };
      const compiled = compile(input);
      const messages = [{ role: "user", content: stim.text }];
      const id = `${stim.id}__${variant.id}`;
      const payload = JSON.stringify({ system: compiled.system, tail: compiled.tail, messages });
      const hash = sha256(payload);
      for (const k of Object.keys(compiled.sections || {})) sectionsSeen.add(k);

      if (byHash.has(hash)) {
        collisions++;
        continue;
      }
      byHash.set(hash, id);
      rows.push({ id, stimulus_ref: stim.id, state_variant_ref: variant.id, system: compiled.system, tail: compiled.tail, messages, sha256: hash });
    }
  }
  setPin(null);

  return { rows, collisions, poolSize, stimuli, STATE_VARIANTS, sectionsSeen };
}

/** Regenerates ONE row by id (cheaper than buildCorpusRows() when a
 *  consumer — generate.mjs — only needs a handful of rows for a smoke
 *  run). Still recomputes the full grid internally (compile() is cheap,
 *  pure, local; the cost here is the esbuild rebuild, done once). */
export async function getRowsByIds(ids) {
  const { rows } = await buildCorpusRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const want = new Set(ids);
  const found = rows.filter((r) => want.has(r.id));
  const missing = ids.filter((id) => !byId.has(id));
  return { found, missing };
}
