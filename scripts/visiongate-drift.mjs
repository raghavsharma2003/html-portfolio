// Weekly vision-drift probe — #56 VISIONGATE INTO DRIFT MONITOR.
//
// `context/measurements.md` `vision-drift-4day`: the grok-4-20-non-reasoning
// Azure Foundry deployment shifted engagement behaviour under us in 4 days
// ("a beta build that could change underneath us" — config/models.json).
// That measurement's own conclusion: "the weekly drift monitor should re-run
// this exact archived battery ... rather than a proxy." This is that re-run,
// wired into .github/workflows/drift.yml the same way the existing drift
// jobs are: gated on secret presence with a PRINTED skip (never silent —
// context/decisions.md `silent-truncation`), tiny probe deck (pennies/run,
// same discipline as derive-adapter.mjs's `--mode drift`).
//
// Scope, deliberately narrow: this checks ENGAGEMENT RATE drift only (does
// the shipped v4b directive still comment vs NO_COMMENT at roughly the
// archived rate) on a handful of the archived stimulus frames. It does NOT
// re-run fabrication judging — that needs the full LLM-judge pass
// (evals/archives/visiongate-confirm/harness/judge.mjs) against a
// statistically powered n (fab-noise-floor: n>=300), which is a paid,
// multi-thousand-call battery, not a weekly pennies job. Run that by hand
// per the archive's README when engagement drift here actually fires.
//
// The directive text is pulled LIVE off src/engine/persona.ts (via the
// archived harness's own persona.mjs, unmodified) so this never drifts from
// what's actually shipped — the same reason evals/run.mjs re-bundles from
// real source (context/rejected.md `gates-that-live-nowhere`).
//
// Deliberately does NOT reuse evals/archives/visiongate-confirm/harness/az.mjs
// as-is: that file hardcodes a session-scratchpad path for both its Azure
// creds file and its output directory (`export const S = "/tmp/claude-0/..."`)
// — an ephemeral container path that will not exist in CI and is exactly the
// frozen/ephemeral-path trap logged in context/rejected.md
// `gates-that-live-nowhere`. This script talks to Azure directly using the
// same env-first credential resolution api/consolidate.js and api/memory.js
// already use, and reads stimuli straight from the committed archive.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = path.join(ROOT, "evals", "archives", "visiongate-confirm");
const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = "grok-4-20-non-reasoning";

// Same probe-deck-tiny discipline as .github/workflows/drift.yml's other
// job — a handful of frames, one rep, one arm (the SHIPPED directive; the
// pre-retune baseline is a fixed historical artifact, not something that can
// drift, so re-probing it weekly buys nothing).
const PROBE_FRAMES = ["s01_feed", "s02_chat", "s06_video", "s11_privatemsg"];

// Archived reference point (gate-bundle.json, vy_gate_run id 35, 2026-08-15)
// — NOT a statistically valid comparator at this probe's n, only a coarse
// "did this fall off a cliff" signal.
const ARCHIVED_V4B_ENGAGEMENT = 0.417; // canonical n=240/arm figure
const ARCHIVED_V4B_ENGAGEMENT_LATEST = 0.571; // most recent archived batch

async function main() {
  const azureKey = process.env.AZURE_API_KEY || process.env.AZURE_KEY;
  const azureEndpoint = process.env.AZURE_ENDPOINT;
  let cfgKey, cfgEndpoint;
  if (!azureKey || !azureEndpoint) {
    try {
      const cfg = await import(path.join(ROOT, "api", "_config.js") + "?v=" + Date.now());
      cfgKey = cfg.AZURE_KEY;
      cfgEndpoint = cfg.AZURE_ENDPOINT;
    } catch {
      // api/_config.js does not exist in this checkout — fine, env vars are
      // the CI path (drift.yml reconstructs it before this runs anyway).
    }
  }
  const KEY = azureKey || cfgKey;
  const ENDPOINT = azureEndpoint || cfgEndpoint;

  if (!KEY || !ENDPOINT) {
    console.log(
      "SKIP visiongate-drift: AZURE_KEY/AZURE_ENDPOINT not set. " +
        "Vision-drift probe needs Azure Foundry credentials (context/decisions.md `vision-model`); " +
        "set the AZURE_KEY and AZURE_ENDPOINT repo secrets to enable this leg.",
    );
    return;
  }

  console.log(`visiongate-drift: probing ${PROBE_FRAMES.length} frames on ${MODEL} (shipped v4b directive)`);

  if (DRY_RUN) {
    console.log("visiongate-drift: --dry-run, skipping model calls.");
    return;
  }

  const truth = JSON.parse(fs.readFileSync(path.join(ARCHIVE, "stimuli", "truth.json"), "utf8"));
  const persona = await import(path.join(ARCHIVE, "harness", "persona.mjs"));
  const dirText = fs
    .readFileSync(path.join(ARCHIVE, "harness", "dirs", "v4b_comment.txt"), "utf8")
    .trim();

  const url = ENDPOINT.replace(/\/$/, "") + "/chat/completions";
  const headers = { "api-key": KEY, "Content-Type": "application/json" };

  const b64 = (id) => fs.readFileSync(path.join(ARCHIVE, "stimuli", id + ".jpg")).toString("base64");

  let spoken = 0,
    ok = 0,
    errs = 0;
  const rows = [];
  for (const id of PROBE_FRAMES) {
    if (!truth[id]) {
      console.log(`  ${id}: SKIP (no truth entry)`);
      continue;
    }
    let last = "";
    let got = null;
    for (let attempt = 0; attempt < 3 && !got; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 300,
            temperature: 1.0,
            messages: [
              { role: "system", content: persona.SYSTEM },
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64(id)}` } },
                  { type: "text", text: dirText },
                ],
              },
            ],
          }),
        });
        const j = await r.json();
        if (r.ok && !j.error && j.choices?.[0]) {
          got = j.choices[0].message?.content ?? "";
        } else {
          last = JSON.stringify(j.error || j).slice(0, 200);
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
      } catch (e) {
        last = "throw: " + e.message;
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    if (got === null) {
      errs++;
      console.log(`  ${id}: ERROR (${last})`);
      continue;
    }
    ok++;
    const isSpoken = got.trim() !== "NO_COMMENT";
    if (isSpoken) spoken++;
    rows.push({ id, spoken: isSpoken, chars: got.length });
    console.log(`  ${id}: ${isSpoken ? "spoke" : "silent"}`);
  }

  const rate = ok > 0 ? spoken / ok : null;
  console.log("");
  console.log(`visiongate-drift: ${ok} ok, ${errs} error(s), engagement ${spoken}/${ok}` + (rate !== null ? ` = ${(rate * 100).toFixed(1)}%` : ""));
  console.log(
    `  archived reference: 41.7% (n=240 canonical), 57.1% (latest archived batch) — ` +
      `this probe (n=${ok}) is NOT statistically powered and cannot confirm or refute drift on its own.`,
  );

  if (rate !== null && rate < 0.15) {
    console.log(
      "ALERT visiongate-drift: engagement collapsed relative to both archived reference points. " +
        "Run the full confirmatory battery by hand (evals/archives/visiongate-confirm/README.md) before trusting this alone.",
    );
    process.exitCode = 1;
  } else if (rate !== null && rate < ARCHIVED_V4B_ENGAGEMENT * 0.5) {
    console.log(
      "WATCH visiongate-drift: engagement well below archived reference. Worth a closer look, not yet an alarm at this n.",
    );
  } else {
    console.log("visiongate-drift: no collapse detected at this n.");
  }
}

main().catch((e) => {
  console.error("visiongate-drift: fatal:", e.message);
  process.exitCode = 1;
});
