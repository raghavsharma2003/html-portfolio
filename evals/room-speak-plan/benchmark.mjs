// WS-R156. The measurement the brief names: "time to first audio for a
// five-sentence reply, before and after, n=10, in a real Chromium page,
// against a fake synthesiser with a fixed per-sentence delay."
//
//   node evals/room-speak-plan/benchmark.mjs
//
// `evals/echosim/build.mjs`'s own precedent: transpile the REAL client
// source rather than hand-simulate it, so the number measured is of the
// code that ships. `src/room/voiceSequence.ts` is esbuild-transpiled (no
// bundling needed — it imports nothing) to plain ESM and loaded, unmodified,
// into a real Chromium page launched exactly the way `scripts/
// check-performance.mjs` already launches one in this repo (same binary
// resolution order, same `--no-sandbox --disable-background-networking`
// flags) — this is a MEASUREMENT script, not a gate: it prints its numbers
// and this workstream copies them into `context/measurements.md` by hand,
// the same relationship `scripts/prosody-baseline.mjs` and
// `scripts/run-hindi-observer-pair.mjs` already have to the numbers they
// print.
//
// THE FAKE SYNTHESISER: a fixed 400 ms delay per sentence, both arms, so the
// two arms differ ONLY in how much text one delay has to cover — never in
// how long the delay itself is. "BEFORE" is the shape this workstream
// replaced: one call that cannot return ANY audio until the WHOLE reply
// (five sentences) has been synthesised — `docs/gurukul/
// AZURE-DEPLOY-STATE.md` §8's "complete signed result under a GPU lock"
// read literally, as one lock held across all five sentences serially, the
// only honest way to fake a single-clip call that must finish producing
// SATN audio before returning anything. "AFTER" is `runVoiceSequence`
// itself, real and unmodified, with `fetchClip` paying the SAME 400 ms once
// per call rather than once per reply.
//
// $0: no network beyond loopback to the browser's own devtools protocol, no
// model call, no GPU.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchRehearsalBrowser } from "../rehearsal/browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const N = 10;
const PER_SENTENCE_MS = 400;
const SENTENCE_COUNT = 5;

const outDir = mkdtempSync(join(tmpdir(), "room-speak-plan-benchmark-"));
const bundlePath = join(outDir, "voiceSequence.mjs");
// `node_modules/esbuild/bin/esbuild` is a native binary on this platform
// (`node_modules/.bin/esbuild` symlinks straight to it) — run it directly,
// never through `node`, which is what `evals/run.mjs`'s own `npx esbuild`
// invocation does under the hood for the same reason.
execFileSync(
  join(REPO, "node_modules", ".bin", "esbuild"),
  [
    join(REPO, "src", "room", "voiceSequence.ts"),
    "--format=esm",
    `--outfile=${bundlePath}`,
    "--log-level=error",
  ],
  { cwd: REPO, stdio: "inherit" },
);
const bundleSource = readFileSync(bundlePath, "utf8");

// Shared launcher (`evals/rehearsal/browser.mjs`, WS-R165) owns binary
// resolution; this call's own `--disable-background-networking` rides its
// `extraArgs` param alongside the launcher's own `--no-sandbox`.
const { browser, reason } = await launchRehearsalBrowser(["--disable-background-networking"]);
if (!browser) {
  console.error(`no chromium binary available: ${reason}`);
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

const page = await browser.newPage();
await page.setContent("<!doctype html><title>room-speak-plan benchmark</title>");

// The bundle defines `export async function runVoiceSequence(...)`. Loaded
// as a `text/javascript` module URL via a Blob, so the exact esbuild output
// runs unmodified in the page — no re-typing of the loop in page-context
// JavaScript, which would measure a paraphrase instead of the real file.
const moduleUrl = await page.evaluate((src) => {
  const blob = new Blob([src], { type: "text/javascript" });
  return URL.createObjectURL(blob);
}, bundleSource);

const results = await page.evaluate(
  async ({ moduleUrl: url, n, perSentenceMs, sentenceCount }) => {
    const { runVoiceSequence } = await import(url);

    /** BEFORE: one call, must synthesise every sentence before returning
     *  anything — the shape this workstream replaced. */
    async function runBefore() {
      const t0 = performance.now();
      // Serial: a GPU-locked, single synthesis call producing the WHOLE
      // reply cannot start returning bytes until every sentence in it has
      // been synthesised — modelled here as `sentenceCount` sequential
      // delays inside the one call, never `sentenceCount` PARALLEL delays,
      // which would model a capability (concurrent synthesis of one reply)
      // this deployment does not have.
      for (let i = 0; i < sentenceCount; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, perSentenceMs));
      }
      const firstAudioAt = performance.now();
      return firstAudioAt - t0;
    }

    /** AFTER: the REAL `runVoiceSequence`, with a fake `fetchClip` paying
     *  the SAME 400 ms once per SENTENCE rather than once per REPLY. */
    async function runAfter() {
      const t0 = performance.now();
      let firstAudioAt = null;
      await runVoiceSequence({
        fetchClip: (index) =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ audio: `clip-${index}`, count: sentenceCount }), perSentenceMs);
          }),
        // Playback itself is not what this measurement is about (this
        // workstream never changed how long a clip takes to PLAY, only how
        // long the FIRST one takes to become available) — resolves on the
        // next microtask so the loop advances to fetching/playing the next
        // clip without a real audio duration inflating the run's own total
        // time, which this benchmark does not report.
        playClip: () => Promise.resolve(),
        isActive: () => true,
        waitForResume: () => Promise.resolve(),
        onFirstAudio: () => {
          firstAudioAt = performance.now();
        },
      });
      return firstAudioAt - t0;
    }

    const before = [];
    const after = [];
    for (let i = 0; i < n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      before.push(await runBefore());
      // eslint-disable-next-line no-await-in-loop
      after.push(await runAfter());
    }
    return { before, after };
  },
  { moduleUrl, n: N, perSentenceMs: PER_SENTENCE_MS, sentenceCount: SENTENCE_COUNT },
);

await browser.close();
rmSync(outDir, { recursive: true, force: true });

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const fmt = (xs) => xs.map((x) => x.toFixed(1)).join(", ");

console.log(`n = ${N}, fake synthesiser = ${PER_SENTENCE_MS} ms/sentence, reply = ${SENTENCE_COUNT} sentences\n`);
console.log(`BEFORE (one call, whole reply): [${fmt(results.before)}] ms`);
console.log(`  mean   ${mean(results.before).toFixed(1)} ms`);
console.log(`  median ${median(results.before).toFixed(1)} ms`);
console.log(`\nAFTER (runVoiceSequence, one call per sentence): [${fmt(results.after)}] ms`);
console.log(`  mean   ${mean(results.after).toFixed(1)} ms`);
console.log(`  median ${median(results.after).toFixed(1)} ms`);
console.log(`\nspeedup (mean):   ${(mean(results.before) / mean(results.after)).toFixed(2)}x`);
console.log(`speedup (median): ${(median(results.before) / median(results.after)).toFixed(2)}x`);
